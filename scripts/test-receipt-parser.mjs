import test from 'node:test';
import assert from 'node:assert/strict';
import '../app/receipt-ocr.js';
const { parseReceipt } = globalThis.ReceiptOCR;
for (const label of ['TOTAL', 'TOTAL PRODUCTS', 'TOTAL AMOUNT', 'TOTAL OUTSTANDING AMOUNT', 'ROUNDED TOTAL', 'TOTAL PAYABLE']) {
  test(label, () => assert.deepEqual(parseReceipt(`Date: 09/10/2026\n${label} RM 49.40`), { date: '2026-10-09', total: 49.4 }));
}
test('payable outranks subtotal, item quantities, cash and lower totals', () => {
  assert.equal(parseReceipt('SUBTOTAL 49.00\nTOTAL ITEMS 8\nTOTAL 49.00\nROUNDED TOTAL 48.95\nCASH TENDER 100.00\nCHANGE 51.05').total, 48.95);
});
test('ambiguous totals remain blank', () => assert.equal(parseReceipt('TOTAL 40.00\nTOTAL 50.00').total, null));
test('valid dates and following-line totals', () => {
  assert.deepEqual(parseReceipt('09 Oct 2026\nTOTAL PAYABLE\nRM 1,234.50'), { date: '2026-10-09', total: 1234.5 });
  assert.equal(parseReceipt('2026-10-09').date, '2026-10-09');
  assert.equal(parseReceipt('31/02/2026').date, null);
  assert.equal(parseReceipt('TOTAL PRODUCTS 5').total, null);
});
