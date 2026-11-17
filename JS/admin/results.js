
/*
 * ADI Inventory - Admin Count Results
 * File: JS/admin/results.js
 *
 * Filters:
 * - Branch
 * - Category
 * - Date
 *
 * Shows the latest reading per item and branch.
 * Read-only: does not modify inventory data.
 */

export function initCountResults({
    db,
    getBranches,
    getCategories,
    onError
}) {
    const $ = id => document.getElementById(id);

    let requestId = 0;
    let currentResults = [];
    let resultsLoading = false;

    function updateExportButton() {
        const button = $('exportCountExcel');
        if (button) button.disabled = resultsLoading || currentResults.length === 0;
    }

    const escape = value =>
        String(value ?? '').replace(
            /[&<>"']/g,
            ch => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            }[ch])
        );

    function displayDate(value) {
        if (!value) return '';

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return String(value);
        }

        return date.toLocaleString('en-GB', {
            timeZone: 'Asia/Beirut',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    async function fetchAll(buildQuery) {
        const pageSize = 500;
        const all = [];

        for (let offset = 0; ; offset += pageSize) {
            const { data, error } = await buildQuery()
                .range(offset, offset + pageSize - 1);

            if (error) throw error;

            const rows = data || [];
            all.push(...rows);

            if (rows.length < pageSize) break;
        }

        return all;
    }

    function renderFilters() {
        const branches = getBranches();
        const categories = getCategories();

        const branchSelect = $('resultsBranch');
        const categorySelect = $('resultsCategory');

        const oldBranch = branchSelect.value;
        const oldCategory = categorySelect.value;

        branchSelect.innerHTML =
            '<option value="">All Branches</option>' +
            branches.map(b => `
                <option value="${escape(b.id)}">
                    ${escape(b.code)} - ${escape(b.name)}
                </option>
            `).join('');

        categorySelect.innerHTML =
            '<option value="">All Categories</option>' +
            categories.map(c => `
                <option value="${escape(c.id)}">
                    ${escape(c.name)}
                </option>
            `).join('');

        if (branches.some(b => String(b.id) === oldBranch)) {
            branchSelect.value = oldBranch;
        }

        if (categories.some(c => String(c.id) === oldCategory)) {
            categorySelect.value = oldCategory;
        }
    }

    async function load() {
        const currentRequest = ++requestId;
        currentResults = [];
        resultsLoading = true;
        updateExportButton();

        const tbody = $('countResults');
        const status = $('countResultsMessage');

        tbody.innerHTML =
            '<tr><td colspan="5">Loading...</td></tr>';

        status.textContent = '';
        status.classList.remove('error');

        try {
            const branchId = $('resultsBranch').value;
            const categoryId = $('resultsCategory').value;
            const selectedDate = $('resultsDate')?.value || '';

            // Filter sessions by branch and count date.
            const sessions = await fetchAll(() => {
                let query = db
                    .from('count_sessions')
                    .select(
                        'id,branch_id,category_id,count_date'
                    )
                    .order('id', { ascending: true });

                if (branchId) {
                    query = query.eq('branch_id', branchId);
                }

                if (selectedDate) {
                    query = query.eq('count_date', selectedDate);
                }

                return query;
            });

            if (currentRequest !== requestId) return;

            if (!sessions.length) {
                tbody.innerHTML =
                    '<tr><td colspan="5">No sessions found.</td></tr>';

                status.textContent = '0 counted items';
                resultsLoading = false;
                updateExportButton();
                return;
            }

            // Use the current category of each item.
            const allowedItems = new Map();

            if (categoryId) {
                const categoryItems = await fetchAll(() =>
                    db.from('items')
                        .select('id,item_no,description,category_id')
                        .eq('category_id', categoryId)
                        .order('id', { ascending: true })
                );

                for (const item of categoryItems) {
                    allowedItems.set(String(item.id), item);
                }

                if (!allowedItems.size) {
                    tbody.innerHTML =
                        '<tr><td colspan="5">No items in this category.</td></tr>';

                    status.textContent = '0 counted items';
                    return;
                }
            }

            const sessionMap = new Map(
                sessions.map(s => [String(s.id), s])
            );

            const latest = new Map();

            // Supabase/PostgREST IN filters have practical
            // URL-size limits, so query sessions in chunks.
            const chunkSize = 50;

            for (
                let start = 0;
                start < sessions.length;
                start += chunkSize
            ) {
                if (currentRequest !== requestId) return;

                const chunk = sessions.slice(
                    start,
                    start + chunkSize
                );

                const ids = chunk.map(s => s.id);

                const entries = await fetchAll(() =>
                    db.from('count_entries')
                        .select(
                            'id,session_id,item_id,qty,created_at,items(item_no,description,category_id)'
                        )
                        .in('session_id', ids)
                        .order('created_at', {
                            ascending: false
                        })
                        .order('id', {
                            ascending: false
                        })
                );

                for (const entry of entries) {
                    const session = sessionMap.get(
                        String(entry.session_id)
                    );

                    if (!session) continue;

                    if (
                        categoryId &&
                        !allowedItems.has(String(entry.item_id))
                    ) {
                        continue;
                    }

                    const key =
                        String(session.branch_id) + ':' +
                        String(entry.item_id);

                    const previous = latest.get(key);

                    const entryTime = new Date(
                        entry.created_at
                    ).getTime();

                    const previousTime = previous
                        ? new Date(previous.created_at).getTime()
                        : -Infinity;

                    if (
                        !previous ||
                        entryTime > previousTime ||
                        (
                            entryTime === previousTime &&
                            String(entry.id).localeCompare(
                                String(previous.id)
                            ) > 0
                        )
                    ) {
                        latest.set(key, {
                            ...entry,
                            branch_id: session.branch_id
                        });
                    }
                }
            }

            if (currentRequest !== requestId) return;

            const branches = getBranches();

            const results = [...latest.values()].sort(
                (a, b) => {
                    const branchA = branches.find(
                        x => String(x.id) === String(a.branch_id)
                    )?.code || '';

                    const branchB = branches.find(
                        x => String(x.id) === String(b.branch_id)
                    )?.code || '';

                    return branchA.localeCompare(branchB) ||
                        String(a.items?.item_no || '')
                            .localeCompare(
                                String(b.items?.item_no || ''),
                                undefined,
                                { numeric: true }
                            );
                }
            );

            currentResults = results;
            resultsLoading = false;
            updateExportButton();

            tbody.innerHTML = results.map(entry => {
                const branch = branches.find(
                    b => String(b.id) ===
                        String(entry.branch_id)
                );

                return `
                    <tr>
                        <td>${escape(branch?.code)}</td>
                        <td>${escape(entry.items?.item_no)}</td>
                        <td>${escape(entry.items?.description)}</td>
                        <td>${escape(entry.qty)}</td>
                        <td>${escape(displayDate(entry.created_at))}</td>
                    </tr>
                `;
            }).join('') ||
                '<tr><td colspan="5">No counted items.</td></tr>';

            status.textContent =
                `${results.length} unique counted items`;

        } catch (error) {
            if (currentRequest !== requestId) return;

            console.error('Count Results error:', error);

            status.textContent =
                error.message || 'Unable to load results';

            status.classList.add('error');

            tbody.innerHTML =
                '<tr><td colspan="5">Unable to load count results.</td></tr>';

            currentResults = [];
            resultsLoading = false;
            updateExportButton();
            if (onError) onError(error);
        }
    }

    $('resultsBranch').addEventListener('change', load);
    $('resultsCategory').addEventListener('change', load);

    $('resultsDate')?.addEventListener('change', load);

    $('clearResultsDate')?.addEventListener('click', () => {
        $('resultsDate').value = '';
        load();
    });

    $('refreshCounts').addEventListener('click', load);

    // Export only the latest results matching the current filters.
    // CSV is Excel-compatible and supports Arabic through UTF-8 BOM.
    function exportExcel() {
        if (resultsLoading || !currentResults.length) {
            alert('No count results available to export.');
            return;
        }

        const branches = getBranches();
        const branchById = new Map(branches.map(b => [String(b.id), b.code]));
        const headers = ['Branch', 'Item No.', 'Description', 'Counted Qty', 'Count Date'];
        const rows = currentResults.map(entry => [
            branchById.get(String(entry.branch_id)) || '',
            entry.items?.item_no ?? '',
            entry.items?.description ?? '',
            entry.qty ?? '',
            displayDate(entry.created_at)
        ]);

        const csvCell = value => {
            let text = String(value ?? '');
            if (/^\s*[=+@\-]/.test(text)) text = "'" + text;
            return '"' + text.replace(/"/g, '""') + '"';
        };
        const csv = [headers, ...rows]
            .map(row => row.map(csvCell).join(','))
            .join('\r\n');
        const blob = new Blob(['\ufeff' + csv], {type: 'text/csv;charset=utf-8;'});
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const selectedBranch = $('resultsBranch').selectedOptions[0]?.textContent.trim() || 'All-Branches';
        const selectedCategory = $('resultsCategory').selectedOptions[0]?.textContent.trim() || 'All-Categories';
        const selectedDate = $('resultsDate')?.value || 'All-Dates';
        const clean = text => text.replace(/[^a-zA-Z0-9_-]/g, '_');
        link.href = url;
        link.download = `ADI_Count_${clean(selectedBranch)}_${clean(selectedCategory)}_${selectedDate}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    $('exportCountExcel')?.addEventListener('click', exportExcel);
    updateExportButton();

    return {
        load,
        renderFilters,
        exportExcel
    };
}
