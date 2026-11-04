
import {
    db,
    el,
    guard,
    wireLogout,
    escapeHtml,
    message
} from './api.js';

const auth = await guard(true);

let categories = [];
let branches = [];
let items = [];
let rules = [];
let sessions = [];
let reorders = [];

if (auth) {
    wireLogout();

    try {
        await refresh();
    } catch (error) {
        message(error.message, true);
    }
}

async function get(table, select = '*') {
    const { data, error } = await db
        .from(table)
        .select(select)
        .limit(1000);

    if (error) throw error;

    return data || [];
}

function safe(value) {
    return escapeHtml(String(value ?? ''));
}

function notify(error) {
    console.error(error);
    message(error.message || String(error), true);
}

function dateText(value) {
    return value
        ? new Date(value).toLocaleString()
        : '';
}

// --------------------------------------------------
// Load administration data
// --------------------------------------------------

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

    items.sort((a, b) =>
        a.item_no.localeCompare(b.item_no)
    );

    branches.sort((a, b) =>
        a.code.localeCompare(b.code)
    );

    renderCategories();
    renderItems();
    renderBranches();
    renderRules();
    renderSessions();
    renderOrders();

    await loadCountResults();
}

// --------------------------------------------------
// Categories
// --------------------------------------------------

function renderCategories() {
    el('categorySelect').innerHTML =
        categories.map(category => `
            <option value="${safe(category.id)}">
                ${safe(category.name)}
            </option>
        `).join('');

    el('categoryList').innerHTML =
        categories.map(category => `
            <span class="chip">
                ${safe(category.name)}
            </span>
        `).join('');
}

// --------------------------------------------------
// Items
// --------------------------------------------------

function renderItems() {
    el('itemSelect').innerHTML =
        items.map(item => `
            <option value="${safe(item.id)}">
                ${safe(item.item_no)} -
                ${safe(item.description)}
            </option>
        `).join('');
}

// --------------------------------------------------
// Branch dropdowns
// --------------------------------------------------

function renderBranches() {
    const ruleBranch = el('ruleBranch');
    const resultsBranch = el('resultsBranch');
    const resultsCategory = el('resultsCategory');

    const previousRule = ruleBranch.value;
    const previousResults = resultsBranch.value;
    const previousCategory = resultsCategory.value;

    const branchOptions = branches.map(branch => `
        <option value="${safe(branch.id)}">
            ${safe(branch.code)} -
            ${safe(branch.name)}
        </option>
    `).join('');

    ruleBranch.innerHTML =
        '<option value="">Select Branch</option>' +
        branchOptions;

    resultsBranch.innerHTML =
        '<option value="">All Branches</option>' +
        branchOptions;

    resultsCategory.innerHTML =
        '<option value="">All Categories</option>' +
        categories.map(category => `
            <option value="${safe(category.id)}">
                ${safe(category.name)}
            </option>
        `).join('');

    if (branches.some(b => b.id === previousRule)) {
        ruleBranch.value = previousRule;
    }

    if (branches.some(b => b.id === previousResults)) {
        resultsBranch.value = previousResults;
    }

    if (categories.some(c => c.id === previousCategory)) {
        resultsCategory.value = previousCategory;
    }

    updateRuleFields();
}

// --------------------------------------------------
// Min / Max per branch
// --------------------------------------------------

function selectedRule() {
    const branchId = el('ruleBranch').value;
    const itemId = el('itemSelect').value;

    return rules.find(rule =>
        rule.branch_id === branchId &&
        rule.item_id === itemId
    );
}

function updateRuleFields() {
    const rule = selectedRule();

    el('minQty').value = rule?.min_qty ?? 0;
    el('maxQty').value = rule?.max_qty ?? 0;
    el('ruleEnabled').checked = !!rule?.enabled;
}

function renderRules() {
    const branchId = el('ruleBranch').value;

    if (!branchId) {
        el('rules').innerHTML = `
            <tr>
                <td colspan="5">
                    Select a branch to view stock rules.
                </td>
            </tr>
        `;
        return;
    }

    const branchRules = rules.filter(rule =>
        rule.branch_id === branchId
    );

    el('rules').innerHTML =
        branchRules.map(rule => {
            const item = items.find(i =>
                i.id === rule.item_id
            );

            return `
                <tr>
                    <td>${safe(item?.item_no)}</td>
                    <td>${safe(item?.description)}</td>
                    <td>${rule.enabled ? 'Enabled' : 'Off'}</td>
                    <td>${safe(rule.min_qty)}</td>
                    <td>${safe(rule.max_qty)}</td>
                </tr>
            `;
        }).join('') || `
            <tr>
                <td colspan="5">
                    No stock rules for this branch.
                </td>
            </tr>
        `;
}

// --------------------------------------------------
// Counting sessions
// --------------------------------------------------

function renderSessions() {
    sessions.sort((a, b) =>
        b.created_at.localeCompare(a.created_at)
    );

    el('sessions').innerHTML =
        sessions.map(session => `
            <tr>
                <td>
                    ${safe(session.branches?.code)} -
                    ${safe(session.categories?.name)}
                </td>

                <td>${safe(dateText(session.created_at))}</td>

                <td>${safe(session.status)}</td>

                <td>
                    ${session.status === 'open'
                        ? `<button
                            type="button"
                            data-close="${safe(session.id)}">
                            Close & Generate
                           </button>`
                        : ''}
                </td>
            </tr>
        `).join('');

    el('sessions')
        .querySelectorAll('[data-close]')
        .forEach(button => {
            button.addEventListener('click', async () => {
                if (!confirm(
                    'Close this session and generate reorder suggestions?'
                )) return;

                button.disabled = true;

                try {
                    const { error } = await db.rpc(
                        'close_count_session',
                        {
                            p_session: button.dataset.close
                        }
                    );

                    if (error) throw error;

                    await refresh();

                    message(
                        'Session closed and reorder suggestions generated.'
                    );
                } catch (error) {
                    notify(error);
                    button.disabled = false;
                }
            });
        });
}

// --------------------------------------------------
// Inventory count results
// --------------------------------------------------

async function loadCountResults() {
    const tbody = el('countResults');
    const status = el('countResultsMessage');

    tbody.innerHTML = `
        <tr>
            <td colspan="5">Loading...</td>
        </tr>
    `;

    status.textContent = '';

    try {
        const branchFilter = el('resultsBranch').value;
        const categoryFilter = el('resultsCategory').value;

        // Read sessions, including open and closed
        let sessionQuery = db
            .from('count_sessions')
            .select('id,branch_id,category_id')
            .order('created_at', {
                ascending: false
            });

        if (branchFilter) {
            sessionQuery = sessionQuery.eq(
                'branch_id',
                branchFilter
            );
        }

        if (categoryFilter) {
            sessionQuery = sessionQuery.eq(
                'category_id',
                categoryFilter
            );
        }

        const { data: filteredSessions, error: sessionError } =
            await sessionQuery.limit(1000);

        if (sessionError) throw sessionError;

        const sessionList = filteredSessions || [];

        if (!sessionList.length) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5">
                        No counting sessions found.
                    </td>
                </tr>
            `;
            return;
        }

        const sessionIds = sessionList.map(s => s.id);

        const { data, error } = await db
            .from('count_entries')
            .select(
                'id,session_id,item_id,qty,created_at,items(item_no,description)'
            )
            .in('session_id', sessionIds)
            .order('created_at', {
                ascending: false
            })
            .order('id', {
                ascending: false
            })
            .limit(1000);

        if (error) throw error;

        const sessionMap = new Map(
            sessionList.map(s => [s.id, s])
        );

        const branchMap = new Map(
            branches.map(b => [b.id, b])
        );

        // Latest reading per branch and item
        const latest = new Map();

        for (const entry of (data || [])) {
            const countSession =
                sessionMap.get(entry.session_id);

            if (!countSession) continue;

            const key =
                countSession.branch_id + ':' + entry.item_id;

            if (!latest.has(key)) {
                latest.set(key, {
                    ...entry,
                    branch_id: countSession.branch_id
                });
            }
        }

        const results = [...latest.values()];

        tbody.innerHTML =
            results.map(entry => {
                const branch =
                    branchMap.get(entry.branch_id);

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
                    <td colspan="5">
                        No counted items found.
                    </td>
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

// --------------------------------------------------
// Reorder drafts
// --------------------------------------------------

function renderOrders() {
    el('orders').innerHTML =
        reorders.map(order => `
            <tr>
                <td>${safe(order.items?.item_no)}</td>
                <td>${safe(order.items?.description)}</td>
                <td>${safe(order.counted_qty)}</td>
                <td>${safe(order.suggested_qty)}</td>

                <td>
                    <input
                        type="number"
                        min="0"
                        step="0.001"
                        id="qty-${safe(order.id)}"
                        value="${safe(order.order_qty)}">
                </td>

                <td>
                    <select id="status-${safe(order.id)}">
                        <option value="draft"
                            ${order.status === 'draft' ? 'selected' : ''}>
                            draft
                        </option>
                        <option value="approved"
                            ${order.status === 'approved' ? 'selected' : ''}>
                            approved
                        </option>
                        <option value="cancelled"
                            ${order.status === 'cancelled' ? 'selected' : ''}>
                            cancelled
                        </option>
                    </select>
                </td>

                <td>
                    <button
                        type="button"
                        data-save="${safe(order.id)}">
                        Save
                    </button>
                </td>
            </tr>
        `).join('');

    el('orders')
        .querySelectorAll('[data-save]')
        .forEach(button => {
            button.addEventListener('click', async () => {
                const id = button.dataset.save;

                const raw = el('qty-' + id).value.trim();
                const quantity = Number(raw);
                const status = el('status-' + id).value;

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
                    message('Order updated successfully.');

                } catch (error) {
                    notify(error);
                    button.disabled = false;
                }
            });
        });
}

// --------------------------------------------------
// Forms and events
// --------------------------------------------------

el('categoryForm').addEventListener('submit', async event => {
    event.preventDefault();

    try {
        const name = el('categoryName').value.trim();

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
});

el('itemForm').addEventListener('submit', async event => {
    event.preventDefault();

    try {
        const payload = {
            item_no: el('itemNo').value.trim(),
            description: el('description').value.trim(),
            barcode: el('barcode').value.trim() || null,
            category_id: el('categorySelect').value
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
});

el('ruleBranch').addEventListener('change', () => {
    updateRuleFields();
    renderRules();
});

el('itemSelect').addEventListener('change', updateRuleFields);

el('ruleForm').addEventListener('submit', async event => {
    event.preventDefault();

    try {
        const branchId = el('ruleBranch').value;
        const itemId = el('itemSelect').value;

        const min = Number(el('minQty').value);
        const max = Number(el('maxQty').value);

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
                'Maximum must be greater than or equal to minimum.'
            );
        }

        const { error } = await db
            .from('stock_rules')
            .upsert({
                branch_id: branchId,
                item_id: itemId,
                min_qty: min,
                max_qty: max,
                enabled: el('ruleEnabled').checked
            }, {
                onConflict: 'branch_id,item_id'
            });

        if (error) throw error;

        await refresh();
        message('Stock rule saved.');

    } catch (error) {
        notify(error);
    }
});

el('resultsBranch').addEventListener(
    'change',
    loadCountResults
);

el('resultsCategory').addEventListener(
    'change',
    loadCountResults
);

el('refreshCounts').addEventListener(
    'click',
    loadCountResults
);

// --------------------------------------------------
// Export approved orders
// --------------------------------------------------

el('exportOrders').addEventListener('click', () => {
    const approved = reorders.filter(order =>
        order.status === 'approved'
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
        ...approved.map(order => [
            branches.find(b =>
                b.id === order.branch_id
            )?.code,
            order.items?.item_no,
            order.items?.description,
            order.counted_qty,
            order.suggested_qty,
            order.order_qty,
            order.status
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

    setTimeout(() => URL.revokeObjectURL(url), 1000);
});
