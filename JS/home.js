
import {
    db,
    el,
    guard,
    wireLogout,
    escapeHtml,
    message
} from './api.js';

// Verify logged-in user
const auth = await guard();

if (auth) {
    wireLogout();

    // Display user name
    el('welcome').textContent =
        auth.profile.display_name;

    // Show Admin link only for admins
    if (auth.profile.role === 'admin') {
        el('adminLink').hidden = false;
    }

    // Load branches and categories
    await initialize();
}

async function initialize() {
    try {
        const [branchResult, categoryResult] =
            await Promise.all([
                db.from('branches')
                    .select('id,code,name')
                    .eq('active', true)
                    .order('name'),

                db.from('categories')
                    .select('id,name')
                    .eq('active', true)
                    .order('name')
            ]);

        if (branchResult.error) {
            throw branchResult.error;
        }

        if (categoryResult.error) {
            throw categoryResult.error;
        }

        const branches = branchResult.data || [];
        const categories = categoryResult.data || [];

        const branchSelect = el('branchSelect');
        const categoriesContainer = el('categories');

        // Populate branch dropdown
        branchSelect.innerHTML =
            '<option value="">-- Select Branch --</option>' +
            branches.map(branch => `
                <option value="${escapeHtml(branch.id)}">
                    ${escapeHtml(branch.code)} -
                    ${escapeHtml(branch.name)}
                </option>
            `).join('');

        // Display categories only after branch selection
        categoriesContainer.innerHTML =
            '<p class="muted">Please select a branch first.</p>';

        branchSelect.addEventListener('change', () => {
            const branchId = branchSelect.value;

            if (!branchId) {
                categoriesContainer.innerHTML =
                    '<p class="muted">Please select a branch first.</p>';
                return;
            }

            categoriesContainer.innerHTML =
                categories.map(category => `
                    <a class="tile"
                       href="./inventory.html?category=${encodeURIComponent(category.id)}&branch=${encodeURIComponent(branchId)}">

                        <span class="tile-icon">▦</span>

                        <strong>
                            ${escapeHtml(category.name)}
                        </strong>

                        <span>Start counting →</span>
                    </a>
                `).join('') ||
                '<p>No categories available.</p>';
        });

    } catch (error) {
        message(error.message, true);
    }
}
