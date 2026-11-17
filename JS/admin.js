
/* ADI Inventory Admin - modular controller */

import { db, guard, wireLogout, message } from "./api.js";
import { initItemsManagement } from "./admin/items.js";
import { initCategoriesManagement } from "./admin/categories.js";
import { initCountResults } from "./admin/results.js";
import { initSessionsManagement } from "./admin/sessions.js";
import { initStockRulesManagement } from "./admin/stock-rules.js";
import { initReordersManagement } from "./admin/reorders.js";
import { initItemOrdering } from "./admin/ordering.js";
import { initDashboard } from "./admin/dashboard.js";

// Authentication
const auth = await guard(true);

if (!auth) {
  throw new Error("Admin authentication required.");
}

wireLogout();

// Helpers
const $ = (id) => document.getElementById(id);

const notify = (err) => {
  console.error("ADI Admin:", err);
  message(err?.message || String(err), true);
};

// Application state
const state = {
  categories: [],
  branches: [],
  items: [],
  rules: [],
  sessions: [],
  reorders: [],
};

let refreshing = null;

// Fetch all records with pagination
async function getAll(table, select = "*") {
  const all = [];
  const size = 500;

  for (let start = 0; ; start += size) {
    let query = db.from(table).select(select);

    // stock_rules does not have an "id" column.
    // Use its branch and item columns instead.
    if (table === "stock_rules") {
      query = query
        .order("branch_id", { ascending: true })
        .order("item_id", { ascending: true });
    } else {
      query = query.order("id", { ascending: true });
    }

    const { data, error } = await query.range(
      start,
      start + size - 1
    );

    if (error) {
      console.error(`Error loading ${table}:`, error);
      throw error;
    }

    all.push(...(data || []));

    if (!data || data.length < size) {
      break;
    }
  }

  return all;
}

// Shared module options
const options = {
  db,
  onRefresh: () => refresh(),
  onError: notify,
  onMessage: (text) => message(text),
};

// Initialize modules
const itemsModule = initItemsManagement(options);

const categoriesModule = initCategoriesManagement(options);

const resultsModule = initCountResults({
  db,
  getBranches: () => state.branches,
  getCategories: () => state.categories,
  onError: notify,
});

const sessionsModule = initSessionsManagement(options);

const rulesModule = initStockRulesManagement({
  ...options,
  getCategories: () => state.categories,
});

const reordersModule = initReordersManagement(options);

const orderingModule = initItemOrdering({
  db,
  onError: notify,
  onMessage: (text) => message(text),
});

const dashboardModule = initDashboard({
  onOpenResults: () => resultsModule.load(),
  onError: notify,
});

// Load and refresh admin data
async function performRefresh() {
  const [
    categories,
    branches,
    items,
    rules,
    sessions,
    reorders,
  ] = await Promise.all([
    getAll("categories"),
    getAll("branches"),
    getAll("items"),
    getAll("stock_rules"),

    getAll(
      "count_sessions",
      "id,branch_id,category_id,status,created_at,branches(code,name),categories(name)"
    ),

    getAll(
      "reorder_lines",
      "id,branch_id,item_id,counted_qty,suggested_qty,order_qty,status,items(item_no,description),branches(code)"
    ),
  ]);

  // Update application state
  state.categories = categories.sort((a, b) =>
    String(a.name).localeCompare(String(b.name))
  );

  state.branches = branches.sort((a, b) =>
    String(a.code).localeCompare(String(b.code))
  );

  state.items = items.sort((a, b) =>
    String(a.item_no).localeCompare(
      String(b.item_no),
      undefined,
      { numeric: true }
    )
  );

  state.rules = rules;
  state.sessions = sessions;
  state.reorders = reorders;

  // Render admin modules
  categoriesModule.render(state.categories);

  itemsModule.render(
    state.items,
    state.categories
  );

  resultsModule.renderFilters();

  sessionsModule.render(state.sessions);

  rulesModule.render(
    state.rules,
    state.items,
    state.branches
  );

  reordersModule.render(
    state.reorders,
    state.branches
  );

  orderingModule.render(
    state.items,
    state.categories
  );

  dashboardModule.updateStats(state);

  // Load inventory count results
  await resultsModule.load();
}

// Prevent overlapping refresh requests
function refresh() {
  if (refreshing) {
    return refreshing;
  }

  refreshing = performRefresh().finally(() => {
    refreshing = null;
  });

  return refreshing;
}

// Add or update an item
$("itemForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const item_no = $("itemNo").value.trim();
  const description = $("description").value.trim();
  const barcode = $("barcode").value.trim() || null;
  const category_id = $("categorySelect").value;

  if (!item_no || !description || !category_id) {
    return message(
      "Item number, description and category are required.",
      true
    );
  }

  const btn = e.currentTarget.querySelector(
    '[type="submit"]'
  );

  if (btn) {
    btn.disabled = true;
  }

  try {
    const { error } = await db
      .from("items")
      .upsert(
        {
          item_no,
          description,
          barcode,
          category_id,
        },
        {
          onConflict: "item_no",
        }
      );

    if (error) {
      throw error;
    }

    itemsModule.clearForm();

    await refresh();

    message("Item saved successfully.");
  } catch (err) {
    notify(err);
  } finally {
    if (btn) {
      btn.disabled = false;
    }
  }
});

// Start admin application
try {
  await refresh();

  console.log("ADI Admin modules loaded successfully.");
} catch (err) {
  notify(err);
}
