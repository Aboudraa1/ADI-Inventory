
import {
    db,
    el,
    guard,
    wireLogout,
    escapeHtml,
    message
} from './api.js';

// ==========================================
// AUTHENTICATION
// ==========================================

const auth = await guard();

let category = null;
let branch = null;
let session = null;
let items = [];
let selected = null;
let scanner = null;
let initializing = true;

if (auth) {
    wireLogout();

    init().catch(error => {
        console.error('Inventory initialization error:', error);
        message(error.message || String(error), true);
    }).finally(() => {
        initializing = false;
    });
}

// ==========================================
// LEBANON DATE
// ==========================================

function getLebanonDate() {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Beirut',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());

    const values = Object.fromEntries(
        parts.map(part => [part.type, part.value])
    );

    return `${values.year}-${values.month}-${values.day}`;
}

// ==========================================
// INITIALIZE INVENTORY
// ==========================================

async function init() {

    const params = new URLSearchParams(
        window.location.search
    );

    const categoryId = params.get('category');
    const branchId = params.get('branch');

    if (!categoryId || !branchId) {
        throw new Error(
            'Missing branch or category. Return to Home and select both.'
        );
    }

    // Load branch
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

    // Display heading
    el('heading').textContent =
        `${branch.name || branch.code} - ${category.name} Inventory`;

    // ======================================
    // LOAD ITEMS BY ADMIN SORT ORDER
    // ======================================

    result = await db
        .from('items')
        .select(
            'id,item_no,description,barcode,sort_order'
        )
        .eq('category_id', categoryId)
        .eq('active', true)
        .order('sort_order', {
            ascending: true,
            nullsFirst: false
        })
        .order('item_no', {
            ascending: true
        })
        .limit(1000);

    if (result.error) throw result.error;

    items = result.data || [];

    renderItems();

    // ======================================
    // FIND OR CREATE TODAY'S SESSION
    // ======================================

    await ensureTodaySession();

    await loadCounts();
}

// ==========================================
// DAILY COUNTING SESSION
// ==========================================

async function ensureTodaySession() {

    if (!auth || !branch || !category) {
        throw new Error(
            'Inventory branch or category is not ready.'
        );
    }

    const today = getLebanonDate();

    // Reuse current session only if it belongs
    // to the current Lebanon calendar day.
    if (
        session &&
        session.count_date === today &&
        session.status === 'open'
    ) {
        return session;
    }

    let result = await db
        .from('count_sessions')
        .select('id,status,count_date')
        .eq('branch_id', branch.id)
        .eq('category_id', category.id)
        .eq('created_by', auth.user.id)
        .eq('count_date', today)
        .eq('status', 'open')
        .order('created_at', {
            ascending: false
        })
        .limit(1);

    if (result.error) throw result.error;

    session = result.data?.[0] || null;

    // Create a new session for today
    if (!session) {

        result = await db
            .from('count_sessions')
            .insert({
                branch_id: branch.id,
                category_id: category.id,
                count_date: today
            })
            .select('id,status,count_date')
            .single();

        if (result.error) throw result.error;

        session = result.data;
    }

    el('sessionId').textContent =
        session.id.slice(0, 8);

    return session;
}

// ==========================================
// DISPLAY ITEMS
// ==========================================

function renderItems() {

    const query = el('search')
        .value
        .trim()
        .toLowerCase();

    const filtered = items.filter(item => {

        const description = String(
            item.description || ''
        ).toLowerCase();

        const itemNo = String(
            item.item_no || ''
        ).toLowerCase();

        const barcode = String(
            item.barcode || ''
        ).toLowerCase();

        return (
            description.includes(query) ||
            itemNo.includes(query) ||
            barcode.includes(query)
        );

    }).slice(0, 100);

    el('results').innerHTML = filtered.map(item => `
        <button
            class="result"
            type="button"
            data-id="${escapeHtml(item.id)}">

            <strong>
                ${escapeHtml(item.description || '')}
            </strong>

            <small>
                ${escapeHtml(item.item_no || '')}
            </small>

        </button>
    `).join('') || `
        <p class="muted">
            No matching items found.
        </p>
    `;

    el('results')
        .querySelectorAll('button[data-id]')
        .forEach(button => {

            button.addEventListener('click', () => {
                choose(button.dataset.id);
            });

        });
}

// ==========================================
// SELECT ITEM
// ==========================================

function choose(id) {

    selected = items.find(item =>
        item.id === id
    );

    if (!selected) return;

    el('selected').hidden = false;

    el('itemName').textContent =
        selected.description || '';

    el('itemNo').textContent =
        selected.item_no || '';

    el('qty').value = '';

    el('qty').focus();
}

// ==========================================
// SEARCH EVENT
// ==========================================

el('search').addEventListener(
    'input',
    renderItems
);

// ==========================================
// SAVE INVENTORY COUNT
// ==========================================

el('save').addEventListener('click', async () => {

    if (initializing || !selected || !branch || !category) {
        message(
            'Please wait or select an item first.',
            true
        );
        return;
    }

    const raw = el('qty').value.trim();
    const quantity = Number(raw);

    if (
        raw === '' ||
        !Number.isFinite(quantity) ||
        quantity < 0
    ) {
        message(
            'Enter a valid quantity. Zero is allowed.',
            true
        );
        return;
    }

    el('save').disabled = true;

    try {

        // Check the session again before saving.
        // This also handles a page left open overnight.
        await ensureTodaySession();

        const { error } = await db.rpc(
            'record_count',
            {
                p_session: session.id,
                p_item: selected.id,
                p_qty: quantity
            }
        );

        if (error) throw error;

        selected = null;
        el('selected').hidden = true;

        await loadCounts();

        message(
            'Count saved successfully.'
        );

    } catch (error) {

        console.error(
            'Save count error:',
            error
        );

        message(
            error.message || String(error),
            true
        );

    } finally {

        el('save').disabled = false;

    }
});

// ==========================================
// LOAD LATEST COUNT PER ITEM
// ==========================================

async function loadCounts() {

    if (!session) return;

    const { data, error } = await db
        .from('count_entries')
        .select(
            'id,item_id,qty,created_at,items(item_no,description)'
        )
        .eq('session_id', session.id)
        .order('created_at', {
            ascending: false
        })
        .order('id', {
            ascending: false
        })
        .limit(1000);

    if (error) throw error;

    // Only display the latest reading
    // for each item in this session.
    const latestCounts = new Map();

    for (const entry of (data || [])) {

        if (!latestCounts.has(entry.item_id)) {
            latestCounts.set(
                entry.item_id,
                entry
            );
        }

    }

    const counts = Array.from(
        latestCounts.values()
    );

    el('countList').innerHTML = counts.map(entry => `
        <tr>
            <td>
                ${escapeHtml(
                    entry.items?.item_no ?? ''
                )}
            </td>

            <td>
                ${escapeHtml(
                    entry.items?.description ?? ''
                )}
            </td>

            <td>
                ${escapeHtml(entry.qty)}
            </td>
        </tr>
    `).join('') || `
        <tr>
            <td colspan="3">
                No items counted yet.
            </td>
        </tr>
    `;

    el('total').textContent =
        counts.length;
}

// ==========================================
// BARCODE SCANNER
// ==========================================

el('scan').addEventListener('click', async () => {

    const Html5Qrcode = window.Html5Qrcode;

    if (!Html5Qrcode) {

        message(
            'Scanner unavailable. Use search instead.',
            true
        );

        return;
    }

    if (scanner) return;

    try {

        el('scanner').hidden = false;

        scanner = new Html5Qrcode(
            'scanner'
        );

        await scanner.start(
            {
                facingMode: 'environment'
            },
            {
                fps: 10,
                qrbox: {
                    width: 250,
                    height: 150
                }
            },
            async code => {

                await stopScanner();

                const scannedCode =
                    String(code).trim();

                const item = items.find(item =>
                    String(item.barcode || '').trim() === scannedCode ||
                    String(item.item_no || '').trim() === scannedCode
                );

                if (item) {

                    choose(item.id);

                } else {

                    message(
                        'Barcode not found in this category.',
                        true
                    );

                }
            },
            () => {}
        );

    } catch (error) {

        console.error(
            'Scanner error:',
            error
        );

        message(
            'Camera unavailable: ' + error.message,
            true
        );

        await stopScanner();
    }
});

// ==========================================
// STOP BARCODE SCANNER
// ==========================================

async function stopScanner() {

    if (scanner) {

        try {

            if (scanner.isScanning) {
                await scanner.stop();
            }

            await scanner.clear();

        } catch (error) {

            console.warn(
                'Scanner stop error:',
                error
            );

        }

        scanner = null;
    }

    el('scanner').hidden = true;
}

el('stopScan').addEventListener(
    'click',
    stopScanner
);
