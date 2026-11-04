
import {
    db,
    el,
    guard,
    wireLogout,
    escapeHtml,
    message
} from './api.js';

const auth = await guard();

let category = null;
let branch = null;
let session = null;
let items = [];
let selected = null;
let scanner = null;

if (auth) {
    wireLogout();

    init().catch(error => {
        message(error.message, true);
    });
}

// Initialize inventory page
async function init() {

    const params = new URLSearchParams(window.location.search);

    const categoryId = params.get('category');
    const branchId = params.get('branch');

    if (!categoryId || !branchId) {
        throw new Error(
            'Missing branch or category. Please return to Home and select both.'
        );
    }

    // Verify selected branch
    let result = await db
        .from('branches')
        .select('id,code,name')
        .eq('id', branchId)
        .eq('active', true)
        .single();

    if (result.error) throw result.error;

    branch = result.data;

    // Load category
    result = await db
        .from('categories')
        .select('id,name')
        .eq('id', categoryId)
        .eq('active', true)
        .single();

    if (result.error) throw result.error;

    category = result.data;

    // Display branch and category
    el('heading').textContent =
        `${branch.name} - ${category.name} Inventory`;

    // Load category items
    result = await db
        .from('items')
        .select('id,item_no,description,barcode')
        .eq('category_id', categoryId)
        .eq('active', true)
        .order('description')
        .limit(1000);

    if (result.error) throw result.error;

    items = result.data || [];

    renderItems();

    // Find an existing open session for this branch/category/user
    result = await db
        .from('count_sessions')
        .select('id,status')
        .eq('branch_id', branchId)
        .eq('category_id', categoryId)
        .eq('created_by', auth.user.id)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1);

    if (result.error) throw result.error;

    session = result.data?.[0] || null;

    // Create a new session when none exists
    if (!session) {

        result = await db
            .from('count_sessions')
            .insert({
                branch_id: branchId,
                category_id: categoryId
            })
            .select('id,status')
            .single();

        if (result.error) throw result.error;

        session = result.data;
    }

    el('sessionId').textContent =
        session.id.slice(0, 8);

    await loadCounts();
}

// Display matching items
function renderItems() {

    const query = el('search').value.trim().toLowerCase();

    const filtered = items.filter(item =>
        item.description.toLowerCase().includes(query) ||
        item.item_no.toLowerCase().includes(query) ||
        (item.barcode || '').toLowerCase().includes(query)
    ).slice(0, 80);

    el('results').innerHTML = filtered.map(item => `
        <button
            class="result"
            type="button"
            data-id="${escapeHtml(item.id)}">

            <strong>${escapeHtml(item.description)}</strong>
            <small>${escapeHtml(item.item_no)}</small>

        </button>
    `).join('') || '<p>No matching items</p>';

    el('results')
        .querySelectorAll('button')
        .forEach(button => {
            button.addEventListener('click', () => {
                choose(button.dataset.id);
            });
        });
}

// Select item
function choose(id) {

    selected = items.find(item => item.id === id);

    if (!selected) return;

    el('selected').hidden = false;

    el('itemName').textContent = selected.description;
    el('itemNo').textContent = selected.item_no;

    el('qty').value = '';
    el('qty').focus();
}

// Search
el('search').addEventListener('input', renderItems);

// Save count
el('save').addEventListener('click', async () => {

    if (!selected || !session) {
        message('Please select an item first.', true);
        return;
    }

    const raw = el('qty').value.trim();
    const quantity = Number(raw);

    if (
        raw === '' ||
        !Number.isFinite(quantity) ||
        quantity < 0
    ) {
        message('Enter a valid quantity. Zero is allowed.', true);
        return;
    }

    el('save').disabled = true;

    try {

        const { error } = await db.rpc('record_count', {
            p_session: session.id,
            p_item: selected.id,
            p_qty: quantity
        });

        if (error) throw error;

        selected = null;
        el('selected').hidden = true;

        await loadCounts();

        message('Count saved successfully.');

    } catch (error) {

        message(error.message, true);

    } finally {

        el('save').disabled = false;
    }
});

// Load saved counts
 async function loadCounts() {      if (!session) return;      const { data, error } = await db         .from('count_entries')         .select(             'id,item_id,qty,created_at,items(item_no,description)'         )         .eq('session_id', session.id)         .order('created_at', { ascending: false })         .order('id', { ascending: false });      if (error) throw error;      // Keep only the latest count for each item     const latestCounts = new Map();      for (const entry of (data || [])) {         if (!latestCounts.has(entry.item_id)) {             latestCounts.set(entry.item_id, entry);         }     }      const counts = Array.from(latestCounts.values());      el('countList').innerHTML = counts.map(entry => `         <tr>             <td>${escapeHtml(entry.items?.item_no)}</td>             <td>${escapeHtml(entry.items?.description)}</td>             <td>${escapeHtml(entry.qty)}</td>         </tr>     `).join('') ||         '<tr><td colspan="3">No items counted yet</td></tr>';      el('total').textContent = counts.length; } {

    if (!session) return;

    const { data, error } = await db
        .from('count_entries')
        .select(
            'id,qty,created_at,items(item_no,description)'
        )
        .eq('session_id', session.id)
        .order('created_at', { ascending: false });

    if (error) throw error;

    const counts = data || [];

    el('countList').innerHTML = counts.map(entry => `
        <tr>
            <td>${escapeHtml(entry.items?.item_no)}</td>
            <td>${escapeHtml(entry.items?.description)}</td>
            <td>${escapeHtml(entry.qty)}</td>
        </tr>
    `).join('') ||
        '<tr><td colspan="3">No items counted yet</td></tr>';

    el('total').textContent = counts.length;
}

// Barcode scanner
el('scan').addEventListener('click', async () => {

    const Html5Qrcode = window.Html5Qrcode;

    if (!Html5Qrcode) {
        message('Scanner unavailable. Use search instead.', true);
        return;
    }

    if (scanner) return;

    try {

        el('scanner').hidden = false;

        scanner = new Html5Qrcode('scanner');

        await scanner.start(
            { facingMode: 'environment' },
            {
                fps: 10,
                qrbox: { width: 250, height: 150 }
            },
            async code => {

                await stopScanner();

                const item = items.find(item =>
                    item.barcode === code ||
                    item.item_no === code
                );

                if (item) {
                    choose(item.id);
                } else {
                    message('Barcode not found in this category.', true);
                }
            },
            () => {}
        );

    } catch (error) {

        message('Camera unavailable: ' + error.message, true);

        await stopScanner();
    }
});

// Stop scanner
async function stopScanner() {

    if (scanner) {

        try {

            if (scanner.isScanning) {
                await scanner.stop();
            }

            await scanner.clear();

        } catch (error) {
            console.warn(error);
        }

        scanner = null;
    }

    el('scanner').hidden = true;
}

el('stopScan').addEventListener('click', stopScanner);
