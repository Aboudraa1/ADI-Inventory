
export function initStockRulesManagement({
  db,
  onRefresh,
  onError,
  onMessage,
  getCategories,
}) {
  const $ = (id) => document.getElementById(id);

  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char]);

  let rules = [];
  let items = [];
  let branches = [];
  let categories = [];

  const selected = () =>
    rules.find(
      (rule) =>
        String(rule.branch_id) === $("ruleBranch").value &&
        String(rule.item_id) === $("itemSelect").value
    );

  function updateFields() {
    const rule = selected();

    $("minQty").value = rule?.min_qty ?? 0;
    $("maxQty").value = rule?.max_qty ?? 0;
    $("ruleEnabled").checked = !!rule?.enabled;
  }

  function filterItems() {
    const categoryId = $("ruleCategory").value;
    const itemSelect = $("itemSelect");
    const previousItem = itemSelect.value;

    const filtered = items.filter(
      (item) =>
        !categoryId ||
        String(item.category_id) === categoryId
    );

    itemSelect.innerHTML =
      '<option value="">Select Item</option>' +
      filtered
        .map(
          (item) => `
            <option value="${esc(item.id)}">
              ${esc(item.item_no)} - ${esc(item.description)}
            </option>
          `
        )
        .join("");

    if (
      filtered.some(
        (item) => String(item.id) === previousItem
      )
    ) {
      itemSelect.value = previousItem;
    }

    updateFields();
    paint();
  }

  function paint() {
    const branchId = $("ruleBranch").value;
    const categoryId = $("ruleCategory").value;
    const itemId = $("itemSelect").value;

    const filteredRules = rules.filter((rule) => {
      const item = items.find(
        (entry) =>
          String(entry.id) === String(rule.item_id)
      );

      if (branchId &&
          String(rule.branch_id) !== branchId) {
        return false;
      }

      if (categoryId &&
          String(item?.category_id) !== categoryId) {
        return false;
      }

      if (itemId &&
          String(rule.item_id) !== itemId) {
        return false;
      }

      return true;
    });

    $("rules").innerHTML =
      filteredRules
        .map((rule) => {
          const item = items.find(
            (entry) =>
              String(entry.id) === String(rule.item_id)
          );

          return `
            <tr>
              <td>${esc(item?.item_no)}</td>
              <td>${esc(item?.description)}</td>
              <td>${rule.enabled ? "Enabled" : "Off"}</td>
              <td>${esc(rule.min_qty)}</td>
              <td>${esc(rule.max_qty)}</td>
            </tr>
          `;
        })
        .join("") ||
      '<tr><td colspan="5">No stock rules found.</td></tr>';
  }

  $("ruleBranch").addEventListener("change", () => {
    updateFields();
    paint();
  });

  $("ruleCategory").addEventListener("change", () => {
    filterItems();
  });

  $("itemSelect").addEventListener("change", () => {
    updateFields();
    paint();
  });

  $("ruleForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    const branch_id = $("ruleBranch").value;
    const item_id = $("itemSelect").value;

    const minRaw = $("minQty").value;
    const maxRaw = $("maxQty").value;

    const min_qty = Number(minRaw);
    const max_qty = Number(maxRaw);

    if (
      !branch_id ||
      !item_id ||
      minRaw === "" ||
      maxRaw === "" ||
      !Number.isFinite(min_qty) ||
      !Number.isFinite(max_qty) ||
      min_qty < 0 ||
      max_qty < min_qty
    ) {
      onMessage(
        "Select branch and item, and enter valid Min / Max."
      );
      return;
    }

    const button = $("ruleForm").querySelector(
      '[type="submit"]'
    );

    if (button) button.disabled = true;

    try {
      const { error } = await db
        .from("stock_rules")
        .upsert(
          {
            branch_id,
            item_id,
            min_qty,
            max_qty,
            enabled: $("ruleEnabled").checked,
          },
          {
            onConflict: "branch_id,item_id",
          }
        );

      if (error) throw error;

      await onRefresh();

      onMessage("Stock rule saved.");
    } catch (error) {
      onError(error);
    } finally {
      if (button) button.disabled = false;
    }
  });

  return {
    render(nextRules, nextItems, nextBranches) {
      rules = nextRules || [];
      items = nextItems || [];
      branches = nextBranches || [];
      categories = getCategories?.() || [];

      const branchSelect = $("ruleBranch");
      const categorySelect = $("ruleCategory");

      const oldBranch = branchSelect.value;
      const oldCategory = categorySelect.value;

      branchSelect.innerHTML =
        '<option value="">Select Branch</option>' +
        branches
          .map(
            (branch) => `
              <option value="${esc(branch.id)}">
                ${esc(branch.code)} - ${esc(branch.name)}
              </option>
            `
          )
          .join("");

      categorySelect.innerHTML =
        '<option value="">All Categories</option>' +
        categories
          .map(
            (category) => `
              <option value="${esc(category.id)}">
                ${esc(category.name)}
              </option>
            `
          )
          .join("");

      if (
        branches.some(
          (branch) => String(branch.id) === oldBranch
        )
      ) {
        branchSelect.value = oldBranch;
      }

      if (
        categories.some(
          (category) => String(category.id) === oldCategory
        )
      ) {
        categorySelect.value = oldCategory;
      }

      filterItems();
    },

    updateFields,
  };
}
