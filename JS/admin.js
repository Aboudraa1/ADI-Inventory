
import {
    db, el, guard, wireLogout, escapeHtml, message
} from './api.js';

const auth = await guard(true);

let categories = [];
let branches = [];
let items = [];
let rules = [];
let sessions = [];
let reorders = [];

let arrangedItems = [];
let savedOrder = [];
let draggedId = null;
let sortDirty = false;

const $ = id => document.getElementById(id);
const safe = value => escapeHtml(String(value ?? ''));

function notify(error) {
    console.error(error);
    message(error.message || String(error), true);
}

function dateText(value) {
    return value ? new Date(value).toLocaleString() : '';
}

async function get(table, select = '*') {
    const { data, error } = await db
        .from(table)
        .select(select)
        .limit(1000);

    if (error) throw error;
    return data || [];
}

if (auth) {
    wireLogout();
    try {
        await refresh();
    } catch (error) {
        notify(error);
    }
}

// =============================================
// LOAD ALL ADMIN DATA
// =============================================

async function refresh() {
    [
        categories,
        branches,
        items,
        rules,
        sessions,
        reorders
    ] = await Promise.all([
        get('categories'),
        get('branches'),
        get('items'),
        get('stock_rules'),
        get(
            'count_sessions',
            'id,branch_id,category_id,status,created_at,branches(code,name),categories(name)'
        ),
        get(
            'reorder_lines',
            'id,branch_id,item_id,counted_qty,suggested_qty,order_qty,status,items(item_no,description),branches(code)'
        )
    ]);

    categories.sort((a, b) =>
        a.name.localeCompare(b.name)
    );

    branches.sort((a, b) =>
        a.code.localeCompare(b.code)
    );

    items.sort((a, b) =>
        String(a.item_no).localeCompare(String(b.item_no))
    );

    renderCategories();
    renderItems();
    renderBranches();
    renderRules();
    renderSessions();
    renderOrders();
    initializeArrangeItems();

    await loadCountResults();
}

// =============================================
// CATEGORIES
// =============================================

function renderCategories() {
    $('categorySelect').innerHTML = categories.map(c => `
        <option value="${safe(c.id)}">
            ${safe(c.name)}
        </option>
    `).join('');

    $('categoryList').innerHTML = categories.map(c => `
        <span class="chip">${safe(c.name)}</span>
    `).join('');
}

// =============================================
// ITEMS
// =============================================

function renderItems() {
    $('itemSelect').innerHTML = items.map(i => `
        <option value="${safe(i.id)}">
            ${safe(i.item_no)} - ${safe(i.description)}
        </option>
    `).join('');
}

// =============================================
// BRANCHES
// =============================================

function renderBranches() {
    const ruleBranch = $('ruleBranch');
    const resultsBranch = $('resultsBranch');
    const resultsCategory = $('resultsCategory');

    const oldRule = ruleBranch.value;
    const oldResult = resultsBranch.value;
    const oldCategory = resultsCategory.value;

    const options = branches.map(b => `
        <option value="${safe(b.id)}">
            ${safe(b.code)} - ${safe(b.name)}
        </option>
    `).join('');

    ruleBranch.innerHTML =
        '<option value="">Select Branch</option>' + options;

    resultsBranch.innerHTML =
        '<option value="">All Branches</option>' + options;

    resultsCategory.innerHTML =
        '<option value="">All Categories</option>' +
        categories.map(c => `
            <option value="${safe(c.id)}">
                ${safe(c.name)}
            </option>
        `).join('');

    if (branches.some(b => b.id === oldRule)) {
        ruleBranch.value = oldRule;
    }

    if (branches.some(b => b.id === oldResult)) {
        resultsBranch.value = oldResult;
    }

    if (categories.some(c => c.id === oldCategory)) {
        resultsCategory.value = oldCategory;
    }

    updateRuleFields();
}

// =============================================
// MIN / MAX
// =============================================

function selectedRule() {
    return rules.find(r =>
        r.branch_id === $('ruleBranch').value &&
        r.item_id === $('itemSelect').value
    );
}

function updateRuleFields() {
    const r = selectedRule();

    $('minQty').value = r?.min_qty ?? 0;
    $('maxQty').value = r?.max_qty ?? 0;
    $('ruleEnabled').checked = !!r?.enabled;
}

function renderRules() {
    const branchId = $('ruleBranch').value;

    if (!branchId) {
        $('rules').innerHTML = `
            <tr>
                <td colspan="5">
                    Select a branch to view stock rules.
                </td>
            </tr>
        `;
        return;
    }

    const filtered = rules.filter(r =>
        r.branch_id === branchId
    );

    $('rules').innerHTML = filtered.map(r => {
        const i = items.find(x => x.id === r.item_id);

        return `
            <tr>
                <td>${safe(i?.item_no)}</td>
                <td>${safe(i?.description)}</td>
                <td>${r.enabled ? 'Enabled' : 'Off'}</td>
                <td>${safe(r.min_qty)}</td>
                <td>${safe(r.max_qty)}</td>
            </tr>
        `;
    }).join('') || `
        <tr>
            <td colspan="5">No stock rules.</td>
        </tr>
    `;
}

// =============================================
// ARRANGE ITEMS - DRAG & DROP
// =============================================

function sortMessage(text, isError = false) {
    const target = $('sortMessage');
    if (!target) return;

    target.textContent = text;
    target.classList.toggle('error', isError);
}

function initializeArrangeItems() {
    if (!$('sortCategory') || !$('sortableItems')) return;

    const select = $('sortCategory');
    const previous = select.value;

    select.innerHTML =
        '<option value="">Select Category</option>' +
        categories.map(c => `
            <option value="${safe(c.id)}">
                ${safe(c.name)}
            </option>
        `).join('');

    if (categories.some(c => c.id === previous)) {
        select.value = previous;
    }

    loadArrangeItems();
}

function loadArrangeItems() {
    const categoryId = $('sortCategory')?.value;

    arrangedItems = [];
    savedOrder = [];
    sortDirty = false;

    if (!categoryId) {
        $('sortableItems').innerHTML =
            '<p>Select a category first.</p>';
        sortMessage('');
        return;
    }

    arrangedItems = items
        .filter(i =>
            i.category_id === categoryId &&
            i.active !== false
        )
        .sort((a, b) =>
            (a.sort_order ?? 999999) -
            (b.sort_order ?? 999999) ||
            String(a.item_no).localeCompare(String(b.item_no))
        );

    savedOrder = arrangedItems.map(i => i.id);

    if ($('sortSearch')) {
        $('sortSearch').value = '';
    }

    renderArrangeItems();
    sortMessage(`${arrangedItems.length} items loaded.`);
}

function moveItem(sourceId, targetId) {
    if (sourceId === targetId) return;

    const from = arrangedItems.findIndex(i =>
        i.id === sourceId
    );

    const to = arrangedItems.findIndex(i =>
        i.id === targetId
    );

    if (from < 0 || to < 0) return;

    const [moved] = arrangedItems.splice(from, 1);
    arrangedItems.splice(to, 0, moved);

    sortDirty = true;
    renderArrangeItems();
    sortMessage('Order changed. Click Save Order.');
}

function renderArrangeItems() {
    const container = $('sortableItems');
    if (!container) return;

    const search = ($('sortSearch')?.value || '')
        .trim()
        .toLowerCase();

    const filtered = arrangedItems.filter(i =>
        String(i.item_no).toLowerCase().includes(search) ||
        String(i.description).toLowerCase().includes(search)
    );

    // Prevent accidental reordering of a filtered list.
    const canDrag = search === '';

    container.innerHTML = filtered.map(i => {
        const position = arrangedItems.findIndex(
            x => x.id === i.id
        ) + 1;

        return `
            <div
                class="sortable-item"
                data-id="${safe(i.id)}"
                draggable="${canDrag}">

                <span class="drag-handle">
                    ${canDrag ? '☰' : '•'}
                </span>

                <span>${position}</span>

                <div class="sortable-item-info">
                    <strong>${safe(i.description)}</strong>
                    <small>${safe(i.item_no)}</small>
                </div>

            </div>
        `;
    }).join('') || '<p>No matching items.</p>';

    if (!canDrag) {
        sortMessage(
            'Search is active. Clear search to rearrange.'
        );
        return;
    }

    container.querySelectorAll('.sortable-item')
        .forEach(row => {

            row.addEventListener('dragstart', event => {
                draggedId = row.dataset.id;
                row.classList.add('dragging');

                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData(
                    'text/plain',
                    draggedId
                );
            });

            row.addEventListener('dragover', event => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
            });

            row.addEventListener('drop', event => {
                event.preventDefault();

                if (draggedId) {
                    moveItem(draggedId, row.dataset.id);
                }
            });

            row.addEventListener('dragend', () => {
                draggedId = null;
                row.classList.remove('dragging');
            });
        });
}

$('sortCategory')?.addEventListener(
    'change',
    () => {
        if (sortDirty && !confirm(
            'Discard unsaved order changes?'
        )) {
            return;
        }
        loadArrangeItems();
    }
);

$('sortSearch')?.addEventListener(
    'input',
    renderArrangeItems
);

$('resetItemOrder')?.addEventListener(
    'click',
    () => {
        arrangedItems = savedOrder
            .map(id => arrangedItems.find(i => i.id === id))
            .filter(Boolean);

        sortDirty = false;

        if ($('sortSearch')) {
            $('sortSearch').value = '';
        }

        renderArrangeItems();
        sortMessage('Unsaved changes discarded.');
    }
);

$('saveItemOrder')?.addEventListener(
    'click',
    async () => {
        const button = $('saveItemOrder');

        if (!$('sortCategory').value) {
            sortMessage('Select a category first.', true);
            return;
        }

        if (!sortDirty) {
            sortMessage('No changes to save.');
            return;
        }

        button.disabled = true;
        sortMessage('Saving order...');

        try {
            // Save all positions, including items
            // not visible during previous searches.
            for (let index = 0;
                 index < arrangedItems.length;
                 index++) {

                const item = arrangedItems[index];

                const { data, error } = await db
                    .from('items')
                    .update({
                        sort_order: index + 1
                    })
                    .eq('id', item.id)
                    .select('id');

                if (error) throw error;

                if (!data || data.length !== 1) {
                    throw new Error(
                        'Item update was not permitted: ' +
                        item.item_no
                    );
                }
            }

            arrangedItems.forEach((item, index) => {
                item.sort_order = index + 1;
            });

            savedOrder = arrangedItems.map(i => i.id);
            sortDirty = false;

            sortMessage('Item order saved successfully.');
            message('Item order saved successfully.');

        } catch (error) {
            console.error(error);

            sortMessage(
                'Save failed: ' + error.message,
                true
            );

        } finally {
            button.disabled = false;
        }
    }
);

// =============================================
// COUNTING SESSIONS
// =============================================

function renderSessions() {
    sessions.sort((a, b) =>
        b.created_at.localeCompare(a.created_at)
    );

    $('sessions').innerHTML = sessions.map(s => `
        <tr>
            <td>
                ${safe(s.branches?.code)} -
                ${safe(s.categories?.name)}
            </td>

            <td>${safe(dateText(s.created_at))}</td>
            <td>${safe(s.status)}</td>

            <td>
                ${s.status === 'open'
                    ? `<button type="button"
                         data-close="${safe(s.id)}">
                         Close & Generate
                       </button>`
                    : ''}
            </td>
        </tr>
    `).join('');

    $('sessions')
        .querySelectorAll('[data-close]')
        .forEach(button => {

            button.addEventListener('click', async () => {
                if (!confirm(
                    'Close this session and generate orders?'
                )) return;

                button.disabled = true;

                try {
                    const { error } = await db.rpc(
                        'close_count_session',
                        { p_session: button.dataset.close }
                    );

                    if (error) throw error;

                    await refresh();
                    message('Session closed successfully.');

                } catch (error) {
                    notify(error);
                    button.disabled = false;
                }
            });
        });
}

// =============================================
// INVENTORY COUNT RESULTS
// =============================================

async function loadCountResults() {
    const tbody = $('countResults');
    const status = $('countResultsMessage');

    tbody.innerHTML = `
        <tr><td colspan="5">Loading...</td></tr>
    `;

    status.textContent = '';
    status.classList.remove('error');

    try {
        const branchId = $('resultsBranch').value;
        const categoryId = $('resultsCategory').value;

        let query = db
            .from('count_sessions')
            .select('id,branch_id,category_id')
            .order('created_at', {
                ascending: false
            });

        if (branchId) {
            query = query.eq('branch_id', branchId);
        }

        if (categoryId) {
            query = query.eq('category_id', categoryId);
        }

        const { data: sessionData, error: sessionError } =
            await query.limit(1000);

        if (sessionError) throw sessionError;

        const sessionList = sessionData || [];

        if (!sessionList.length) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5">No sessions found.</td>
                </tr>
            `;
            return;
        }

        const sessionMap = new Map(
            sessionList.map(s => [s.id, s])
        );

        const { data, error } = await db
            .from('count_entries')
            .select(
                'id,session_id,item_id,qty,created_at,items(item_no,description)'
            )
            .in(
                'session_id',
                sessionList.map(s => s.id)
            )
            .order('created_at', {
                ascending: false
            })
            .order('id', {
                ascending: false
            })
            .limit(1000);

        if (error) throw error;

        const latest = new Map();

        for (const entry of (data || [])) {
            const session = sessionMap.get(
                entry.session_id
            );

            if (!session) continue;

            const key =
                session.branch_id + ':' + entry.item_id;

            if (!latest.has(key)) {
                latest.set(key, {
                    ...entry,
                    branch_id: session.branch_id
                });
            }
        }

        const results = [...latest.values()];

        tbody.innerHTML = results.map(entry => {
            const branch = branches.find(
                b => b.id === entry.branch_id
            );

            return `
                <tr>
                    <td>${safe(branch?.code)}</td>
                    <td>${safe(entry.items?.item_no)}</td>
                    <td>${safe(entry.items?.description)}</td>
                    <td>${safe(entry.qty)}</td>
                    <td>${safe(dateText(entry.created_at))}</td>
                </tr>
            `;
        }).join('') || `
            <tr>
                <td colspan="5">No counted items.</td>
            </tr>
        `;

        status.textContent =
            `${results.length} unique counted items`;

    } catch (error) {
        console.error(error);

        status.textContent = error.message;
        status.classList.add('error');

        tbody.innerHTML = `
            <tr>
                <td colspan="5">
                    Unable to load count results.
                </td>
            </tr>
        `;
    }
}

// =============================================
// REORDER DRAFTS
// =============================================

function renderOrders() {
    $('orders').innerHTML = reorders.map(o => `
        <tr>
            <td>${safe(o.items?.item_no)}</td>
            <td>${safe(o.items?.description)}</td>
            <td>${safe(o.counted_qty)}</td>
            <td>${safe(o.suggested_qty)}</td>

            <td>
                <input
                    type="number"
                    min="0"
                    step="0.001"
                    id="qty-${safe(o.id)}"
                    value="${safe(o.order_qty)}">
            </td>

            <td>
                <select id="status-${safe(o.id)}">
                    <option value="draft"
                        ${o.status === 'draft' ? 'selected' : ''}>
                        draft
                    </option>

                    <option value="approved"
                        ${o.status === 'approved' ? 'selected' : ''}>
                        approved
                    </option>

                    <option value="cancelled"
                        ${o.status === 'cancelled' ? 'selected' : ''}>
                        cancelled
                    </option>
                </select>
            </td>

            <td>
                <button type="button"
                    data-save="${safe(o.id)}">
                    Save
                </button>
            </td>
        </tr>
    `).join('');

    $('orders')
        .querySelectorAll('[data-save]')
        .forEach(button => {

            button.addEventListener('click', async () => {
                const id = button.dataset.save;
                const raw = $('qty-' + id).value.trim();
                const quantity = Number(raw);
                const status = $('status-' + id).value;

                if (
                    raw === '' ||
                    !Number.isFinite(quantity) ||
                    quantity < 0
                ) {
                    message('Invalid order quantity.', true);
                    return;
                }

                button.disabled = true;

                try {
                    const { error } = await db.rpc(
                        'review_reorder',
                        {
                            p_line: id,
                            p_qty: quantity,
                            p_status: status
                        }
                    );

                    if (error) throw error;

                    await refresh();
                    message('Order updated.');

                } catch (error) {
                    notify(error);
                    button.disabled = false;
                }
            });
        });
}

// =============================================
// ADD CATEGORY
// =============================================

$('categoryForm').addEventListener(
    'submit',
    async event => {
        event.preventDefault();

        try {
            const name = $('categoryName').value.trim();
            if (!name) return;

            const { error } = await db
                .from('categories')
                .insert({ name });

            if (error) throw error;

            event.target.reset();
            await refresh();
            message('Category added.');

        } catch (error) {
            notify(error);
        }
    }
);

// =============================================
// ADD / UPDATE ITEM
// =============================================

$('itemForm').addEventListener(
    'submit',
    async event => {
        event.preventDefault();

        try {
            const payload = {
                item_no: $('itemNo').value.trim(),
                description: $('description').value.trim(),
                barcode: $('barcode').value.trim() || null,
                category_id: $('categorySelect').value
            };

            const { error } = await db
                .from('items')
                .upsert(payload, {
                    onConflict: 'item_no'
                });

            if (error) throw error;

            event.target.reset();
            await refresh();
            message('Item saved.');

        } catch (error) {
            notify(error);
        }
    }
);

// =============================================
// MIN / MAX EVENTS
// =============================================

$('ruleBranch').addEventListener('change', () => {
    updateRuleFields();
    renderRules();
});

$('itemSelect').addEventListener(
    'change',
    updateRuleFields
);

$('ruleForm').addEventListener(
    'submit',
    async event => {
        event.preventDefault();

        try {
            const branchId = $('ruleBranch').value;
            const itemId = $('itemSelect').value;

            const min = Number($('minQty').value);
            const max = Number($('maxQty').value);

            if (!branchId || !itemId) {
                throw new Error('Select branch and item.');
            }

            if (
                !Number.isFinite(min) ||
                !Number.isFinite(max) ||
                min < 0 ||
                max < min
            ) {
                throw new Error(
                    'Maximum must be >= minimum.'
                );
            }

            const { error } = await db
                .from('stock_rules')
                .upsert({
                    branch_id: branchId,
                    item_id: itemId,
                    min_qty: min,
                    max_qty: max,
                    enabled: $('ruleEnabled').checked
                }, {
                    onConflict: 'branch_id,item_id'
                });

            if (error) throw error;

            await refresh();
            message('Stock rule saved.');

        } catch (error) {
            notify(error);
        }
    }
);

// =============================================
// RESULTS EVENTS
// =============================================

$('resultsBranch').addEventListener(
    'change',
    loadCountResults
);

$('resultsCategory').addEventListener(
    'change',
    loadCountResults
);

$('refreshCounts').addEventListener(
    'click',
    loadCountResults
);

// =============================================
// EXPORT APPROVED ORDERS
// =============================================

$('exportOrders').addEventListener(
    'click',
    () => {
        const approved = reorders.filter(
            o => o.status === 'approved'
        );

        const rows = [
            [
                'Branch',
                'ItemNo',
                'Description',
                'CountedQty',
                'SuggestedQty',
                'OrderQty',
                'Status'
            ],
            ...approved.map(o => [
                branches.find(
                    b => b.id === o.branch_id
                )?.code,
                o.items?.item_no,
                o.items?.description,
                o.counted_qty,
                o.suggested_qty,
                o.order_qty,
                o.status
            ])
        ];

        const csv = rows.map(row =>
            row.map(value =>
                '"' +
                String(value ?? '').replace(/"/g, '""') +
                '"'
            ).join(',')
        ).join('\r\n');

        const blob = new Blob(
            ['\ufeff' + csv],
            { type: 'text/csv;charset=utf-8' }
        );

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = url;
        link.download = 'adi-approved-orders.csv';
        link.click();

        setTimeout(() => {
            URL.revokeObjectURL(url);
        }, 1000);
    }
);
