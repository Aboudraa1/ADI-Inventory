
import { db } from '../api.js';

const $ = (id) => document.getElementById(id);

const searchForm = $('searchForm');
const itemNumber = $('itemNumber');
const description = $('description');
const labelQuantity = $('labelQuantity');
const printBtn = $('printBtn');
const addToQueueBtn = $('addToQueueBtn');
const searchBtn = $('searchBtn');
const status = $('status');

const queueBody = $('queueBody');
const printAllBtn = $('printAllBtn');
const clearQueueBtn = $('clearQueueBtn');
const totalItems = $('totalItems');
const totalLabels = $('totalLabels');

let selectedItem = null;
let printQueue = [];

const MAX_LABELS_PER_ITEM = 100;
const MAX_TOTAL_LABELS = 500;

function showStatus(message, type = '') {
  status.textContent = message;
  status.className = type;
}

function clearPreview() {
  selectedItem = null;
  description.value = '';
  $('previewDescription').textContent = 'Item Description';
  $('previewItemNo').textContent = '00000000';
  $('barcode').replaceChildren();

  printBtn.disabled = true;
  addToQueueBtn.disabled = true;
}

function generateBarcode(target, value) {
  if (typeof JsBarcode !== 'function') {
    throw new Error('Barcode library failed to load.');
  }

  JsBarcode(target, String(value), {
    format: 'CODE128',
    width: 1.6,
    height: 45,
    margin: 0,
    displayValue: false,
    lineColor: '#000000',
    background: '#ffffff'
  });
}

function getQuantity() {
  const quantity = Number(labelQuantity.value);

  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > MAX_LABELS_PER_ITEM
  ) {
    throw new Error('Quantity must be between 1 and 100.');
  }

  return quantity;
}

async function findItem() {
  const number = itemNumber.value.trim();

  clearPreview();

  if (!number) {
    showStatus('Please enter an Item Number.', 'error');
    return;
  }

  searchBtn.disabled = true;
  showStatus('Searching for item...');

  try {
    const { data, error } = await db
      .from('items')
      .select('id, item_no, description, barcode, active')
      .eq('item_no', number)
      .limit(2);

    if (error) throw error;

    if (!data || data.length === 0) {
      showStatus('Item not found in Supabase.', 'error');
      return;
    }

    if (data.length > 1) {
      showStatus(
        'Duplicate Item Number found. Contact admin.',
        'error'
      );
      return;
    }

    const item = data[0];

    if (item.active === false) {
      showStatus(
        'This item is inactive. Printing is disabled.',
        'error'
      );
      return;
    }

    generateBarcode('#barcode', String(item.item_no));

    selectedItem = item;

    description.value = item.description || '';
    $('previewDescription').textContent =
      item.description || 'No description';
    $('previewItemNo').textContent = String(item.item_no);

    printBtn.disabled = false;
    addToQueueBtn.disabled = false;

    showStatus('Item loaded successfully.', 'success');

  } catch (err) {
    console.error('Barcode search error:', err);
    showStatus('Error loading item: ' + err.message, 'error');
  } finally {
    searchBtn.disabled = false;
  }
}

function renderQueue() {
  queueBody.replaceChildren();

  if (printQueue.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');

    cell.colSpan = 4;
    cell.textContent = 'No items in print queue.';

    row.appendChild(cell);
    queueBody.appendChild(row);
  }

  printQueue.forEach((entry) => {
    const row = document.createElement('tr');

    const numberCell = document.createElement('td');
    numberCell.textContent = String(entry.item.item_no);

    const descriptionCell = document.createElement('td');
    descriptionCell.textContent =
      entry.item.description || 'No description';

    const quantityCell = document.createElement('td');
    const quantityInput = document.createElement('input');

    quantityInput.type = 'number';
    quantityInput.min = '1';
    quantityInput.max = String(MAX_LABELS_PER_ITEM);
    quantityInput.value = String(entry.quantity);

    quantityInput.addEventListener('change', () => {
      const newQuantity = Number(quantityInput.value);
      const otherLabels = printQueue.reduce(
        (sum, line) => sum + (
          line === entry ? 0 : line.quantity
        ),
        0
      );

      if (
        !Number.isInteger(newQuantity) ||
        newQuantity < 1 ||
        newQuantity > MAX_LABELS_PER_ITEM ||
        otherLabels + newQuantity > MAX_TOTAL_LABELS
      ) {
        showStatus(
          'Invalid quantity or batch exceeds 500 labels.',
          'error'
        );
        quantityInput.value = String(entry.quantity);
        return;
      }

      entry.quantity = newQuantity;
      renderQueue();
    });

    quantityCell.appendChild(quantityInput);

    const actionCell = document.createElement('td');
    const removeBtn = document.createElement('button');

    removeBtn.className = 'remove-btn';
    removeBtn.textContent = 'Remove';

    removeBtn.addEventListener('click', () => {
      printQueue = printQueue.filter(
        (line) => line !== entry
      );
      renderQueue();
    });

    actionCell.appendChild(removeBtn);

    row.append(
      numberCell,
      descriptionCell,
      quantityCell,
      actionCell
    );

    queueBody.appendChild(row);
  });

  const labels = printQueue.reduce(
    (sum, entry) => sum + entry.quantity,
    0
  );

  totalItems.textContent = String(printQueue.length);
  totalLabels.textContent = String(labels);

  printAllBtn.disabled = printQueue.length === 0;
  clearQueueBtn.disabled = printQueue.length === 0;
}

function addToQueue() {
  if (!selectedItem) {
    showStatus('Search for an item first.', 'error');
    return;
  }

  try {
    const quantity = getQuantity();
    const number = String(selectedItem.item_no);

    const existing = printQueue.find(
      (entry) => String(entry.item.item_no) === number
    );

    const currentTotal = printQueue.reduce(
      (sum, entry) => sum + entry.quantity,
      0
    );

    if (currentTotal + quantity > MAX_TOTAL_LABELS) {
      throw new Error('Maximum batch size is 500 labels.');
    }

    if (existing) {
      if (existing.quantity + quantity > MAX_LABELS_PER_ITEM) {
        throw new Error('Maximum 100 labels per item.');
      }

      existing.quantity += quantity;
    } else {
      printQueue.push({
        item: { ...selectedItem },
        quantity
      });
    }

    renderQueue();

    showStatus(
      `${number} added to print queue.`,
      'success'
    );

    itemNumber.value = '';
    labelQuantity.value = '1';
    clearPreview();
    itemNumber.focus();

  } catch (err) {
    showStatus(err.message, 'error');
  }
}

function createPrintLabel(doc, item) {
  const label = doc.createElement('div');
  label.className = 'print-label';

  const brand = doc.createElement('div');
  brand.className = 'brand';
  brand.textContent = 'ADI';

  const name = doc.createElement('div');
  name.className = 'item-description';
  name.textContent = item.description || 'No description';

  const barcodeWrapper = doc.createElement('div');
  barcodeWrapper.className = 'barcode-wrapper';

  const svg = doc.createElementNS(
    'http://www.w3.org/2000/svg',
    'svg'
  );

  generateBarcode(svg, String(item.item_no));
  barcodeWrapper.appendChild(svg);

  const number = doc.createElement('div');
  number.className = 'item-number';
  number.textContent = String(item.item_no);

  label.append(
    brand,
    name,
    barcodeWrapper,
    number
  );

  return label;
}

const PRINT_CSS = `
  @page {
    size: 65mm 40mm;
    margin: 0;
  }

  * {
    box-sizing: border-box;
  }

  html, body {
    margin: 0;
    padding: 0;
    background: white;
    font-family: Arial, Tahoma, sans-serif;
  }

  .print-label {
    width: 65mm;
    height: 40mm;
    padding: 2mm 3mm;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    text-align: center;
    break-after: page;
    page-break-after: always;
  }

  .print-label:last-child {
    break-after: auto;
    page-break-after: auto;
  }

  .brand {
    font-size: 13px;
    font-weight: 800;
    line-height: 1;
  }

  .item-description {
    font-size: 10px;
    font-weight: bold;
    line-height: 1.25;
    direction: auto;
    unicode-bidi: plaintext;
    overflow-wrap: anywhere;
    max-height: 10mm;
    overflow: hidden;
    width: 100%;
  }

  .barcode-wrapper {
    width: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .barcode-wrapper svg {
    display: block;
    max-width: 100%;
    max-height: 17mm;
  }

  .item-number {
    font-size: 12px;
    font-weight: bold;
    letter-spacing: 1px;
  }

  @media screen {
    body {
      background: #eeeeee;
    }

    .print-label {
      background: white;
      margin: 12px auto;
      box-shadow: 0 0 6px #cccccc;
    }
  }
`;

function printItems(entries) {
  const total = entries.reduce(
    (sum, entry) => sum + entry.quantity,
    0
  );

  if (!entries.length || total > MAX_TOTAL_LABELS) {
    showStatus('Invalid print batch.', 'error');
    return;
  }

  const printWindow = window.open(
    '',
    '_blank',
    'width=650,height=650'
  );

  if (!printWindow) {
    showStatus(
      'Please allow pop-ups for this website.',
      'error'
    );
    return;
  }

  try {
    const doc = printWindow.document;

    doc.title = 'ADI Barcode Labels';

    const meta = doc.createElement('meta');
    meta.setAttribute('charset', 'UTF-8');
    doc.head.appendChild(meta);

    const style = doc.createElement('style');
    style.textContent = PRINT_CSS;
    doc.head.appendChild(style);

    const fragment = doc.createDocumentFragment();

    entries.forEach((entry) => {
      for (let i = 0; i < entry.quantity; i++) {
        fragment.appendChild(
          createPrintLabel(doc, entry.item)
        );
      }
    });

    doc.body.appendChild(fragment);

    printWindow.focus();

    printWindow.setTimeout(() => {
      printWindow.print();
    }, 350);

    showStatus(
      `Prepared ${total} labels for printing.`,
      'success'
    );

  } catch (err) {
    console.error('Print error:', err);
    printWindow.close();
    showStatus('Print error: ' + err.message, 'error');
  }
}

function printSelectedItem() {
  if (!selectedItem) {
    showStatus('Search for an item first.', 'error');
    return;
  }

  try {
    const quantity = getQuantity();

    printItems([{
      item: { ...selectedItem },
      quantity
    }]);

  } catch (err) {
    showStatus(err.message, 'error');
  }
}

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  findItem();
});

addToQueueBtn.addEventListener('click', addToQueue);

printBtn.addEventListener('click', printSelectedItem);

printAllBtn.addEventListener('click', () => {
  printItems(printQueue);
});

clearQueueBtn.addEventListener('click', () => {
  if (!confirm('Clear all items from print queue?')) {
    return;
  }

  printQueue = [];
  renderQueue();
  showStatus('Print queue cleared.', 'success');
});

itemNumber.addEventListener('input', () => {
  clearPreview();
  showStatus('');
});

renderQueue();
itemNumber.focus();

/* ======================================
   EXCEL IMPORT - ADI BARCODE PRINTING
====================================== */

const excelFile = $('excelFile');
const importExcelBtn = $('importExcelBtn');
const importStatus = $('importStatus');
const importErrors = $('importErrors');

const EXCEL_BATCH_SIZE = 50;

function normalizeHeader(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function normalizeItemNumber(value) {
  return String(value ?? '').trim();
}

function getExcelColumns(headers) {
  const normalized = headers.map(normalizeHeader);

  const itemIndex = normalized.findIndex(
    (header) =>
      ['itemnumber', 'itemno', 'item', 'barcode']
        .includes(header)
  );

  const quantityIndex = normalized.findIndex(
    (header) =>
      ['quantity', 'qty', 'labels', 'labelquantity']
        .includes(header)
  );

  if (itemIndex === -1 || quantityIndex === -1) {
    throw new Error(
      'Excel must contain Item Number and Quantity columns.'
    );
  }

  return { itemIndex, quantityIndex };
}

async function importExcel() {
  const file = excelFile.files[0];

  if (!file) {
    importStatus.textContent = 'Please select an Excel file.';
    return;
  }

  if (!/\.(xlsx|xls)$/i.test(file.name)) {
    importStatus.textContent = 'Only .xlsx or .xls files are supported.';
    return;
  }

  if (typeof XLSX === 'undefined') {
    importStatus.textContent = 'Excel library failed to load.';
    return;
  }

  importExcelBtn.disabled = true;
  importErrors.textContent = '';
  importStatus.textContent = 'Reading Excel file...';

  try {
    const buffer = await file.arrayBuffer();

    const workbook = XLSX.read(buffer, {
      type: 'array'
    });

    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    if (!sheet) {
      throw new Error('Excel file has no worksheet.');
    }

    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      raw: false
    });

    if (rows.length < 2) {
      throw new Error('Excel file is empty.');
    }

    const { itemIndex, quantityIndex } =
      getExcelColumns(rows[0]);

    const requested = new Map();
    const errors = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];

      const number = normalizeItemNumber(
        row[itemIndex]
      );

      const rawQuantity = String(
        row[quantityIndex] ?? ''
      ).trim();

      if (!number && !rawQuantity) {
        continue;
      }

      const quantity = Number(rawQuantity);

      if (!number) {
        errors.push(`Row ${i + 1}: Missing Item Number`);
        continue;
      }

      if (
        !rawQuantity ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > MAX_LABELS_PER_ITEM
      ) {
        errors.push(
          `Row ${i + 1}: Invalid quantity for ${number}`
        );
        continue;
      }

      const current = requested.get(number) || 0;

      if (current + quantity > MAX_LABELS_PER_ITEM) {
        errors.push(
          `Row ${i + 1}: ${number} exceeds 100 labels`
        );
        continue;
      }

      requested.set(number, current + quantity);
    }

    if (requested.size === 0) {
      throw new Error(
        'No valid items found in Excel.'
      );
    }

    importStatus.textContent =
      `Checking ${requested.size} items in Supabase...`;

    const numbers = [...requested.keys()];
    const foundItems = new Map();
    const duplicates = new Set();

    for (
      let start = 0;
      start < numbers.length;
      start += EXCEL_BATCH_SIZE
    ) {
      const batch = numbers.slice(
        start,
        start + EXCEL_BATCH_SIZE
      );

      const { data, error } = await db
        .from('items')
        .select('id, item_no, description, active')
        .in('item_no', batch);

      if (error) throw error;

      for (const item of data || []) {
        const number = String(item.item_no);

        if (foundItems.has(number)) {
          duplicates.add(number);
        } else {
          foundItems.set(number, item);
        }
      }
    }

    // Work on a copy so errors cannot partially
    // change the existing print queue.
    const nextQueue = printQueue.map((entry) => ({
      item: { ...entry.item },
      quantity: entry.quantity
    }));

    let total = nextQueue.reduce(
      (sum, entry) => sum + entry.quantity,
      0
    );

    let added = 0;
    let rejected = 0;

    for (const [number, quantity] of requested) {
      const item = foundItems.get(number);

      if (duplicates.has(number)) {
        errors.push(
          `${number}: Duplicate item in database`
        );
        rejected++;
        continue;
      }

      if (!item) {
        errors.push(`${number}: Item not found`);
        rejected++;
        continue;
      }

      if (item.active === false) {
        errors.push(`${number}: Inactive item`);
        rejected++;
        continue;
      }

      const existing = nextQueue.find(
        (entry) =>
          String(entry.item.item_no) === number
      );

      const existingQuantity = existing
        ? existing.quantity
        : 0;

      if (
        existingQuantity + quantity >
        MAX_LABELS_PER_ITEM
      ) {
        errors.push(
          `${number}: Exceeds 100 labels per item`
        );
        rejected++;
        continue;
      }

      if (total + quantity > MAX_TOTAL_LABELS) {
        errors.push(
          `${number}: Batch exceeds 500 labels`
        );
        rejected++;
        continue;
      }

      if (existing) {
        existing.quantity += quantity;
      } else {
        nextQueue.push({
          item: { ...item },
          quantity
        });
      }

      total += quantity;
      added++;
    }

    printQueue = nextQueue;
    renderQueue();

    importStatus.textContent =
      `Import completed!\n` +
      `Accepted items: ${added}\n` +
      `Rejected items: ${rejected}\n` +
      `Total labels in queue: ${total}`;

    if (errors.length > 0) {
      importErrors.textContent =
        'Warnings:\n' + errors.join('\n');
    }

    showStatus(
      `${added} items imported to print queue.`,
      'success'
    );

    excelFile.value = '';

  } catch (err) {
    console.error('Excel import error:', err);

    importStatus.textContent =
      'Import failed: ' + err.message;

  } finally {
    importExcelBtn.disabled = false;
  }
}

importExcelBtn.addEventListener(
  'click',
  importExcel
);

