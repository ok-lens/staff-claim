const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { mockSdk } = require('./test-employee-ui.cjs');
function cloudMock() {
  const original = window.supabase.createClient;
  window.supabase.createClient = () => {
    const client = original();
    const from = client.from;
    client.from = table => {
      if (table !== 'claims') return from(table);
      const rows = [{ id: '00000000-0000-4000-8000-000000000010', claim_number: 'CLM-CLOUD', claimant_id: '00000000-0000-4000-8000-000000000002', category_id: '00000000-0000-4000-8000-000000000004', amount: 42.1, purchase_date: '2026-10-08', status: 'SUBMITTED', created_at: '2026-10-08T01:00:00Z', claim_attachments: [{ id: 'photo', attachment_type: 'RECEIPT', file_name: 'iphone.png', storage_bucket: 'claim-receipts', storage_path: 'staff/claim/iphone.png' }], claim_review_notes: [] }];
      const q = { select: () => q, is: () => q, order: () => q, range: async () => ({ data: rows, error: null }) };
      return q;
    };
    client.storage = { from: bucket => ({ createSignedUrl: async (file, expiry) => {
      window.__calls.push({ action: 'signed-url', bucket, file, expiry });
      return window.__imageFailure ? { error: new Error('offline') } : { data: { signedUrl: location.origin + '/test-receipt.png' }, error: null };
    } }) };
    return client;
  };
}
(async () => {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  try {
    await context.addInitScript(() => sessionStorage.setItem('mock.mode', 'admin'));
    await context.route('**/cdn.jsdelivr.net/**', route => route.fulfill({ contentType: 'application/javascript', body: `(${mockSdk.toString()})();(${cloudMock.toString()})();` }));
    await context.route('**/test-receipt.png', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=', 'base64') }));
    const page = await context.newPage();
    await page.goto('http://localhost:5183');
    await page.waitForFunction(() => !sessionChecking && state.claims.some(c => c.claim_number === 'CLM-CLOUD'));
    assert.equal(await page.evaluate(() => state.claims[0].claim_amount), 42.1);
    await page.evaluate(() => setRoute('detail', state.claims[0].id));
    await page.locator('.receipt-large').waitFor();
    assert.ok(await page.locator('.receipt-large').evaluate(img => img.complete && img.naturalWidth > 0));
    assert.equal(await page.locator('.app-version').textContent(), 'v1.12');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const artifacts = path.resolve(__dirname, '../test-results/cloud-receipts');
    await fs.mkdir(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, 'accounts-mobile.png') });
    await page.evaluate(() => { window.__imageFailure = true; setRoute('detail', state.claims[0].id); });
    await page.getByText('Photo unavailable / 照片暂时无法读取，请重新打开', { exact: true }).waitFor();
    await page.evaluate(() => { window.__imageFailure = false; setRoute('detail', state.claims[0].id); });
    await page.locator('.receipt-large').waitFor();
    await page.reload();
    await page.waitForFunction(() => !sessionChecking && state.claims.length === 1);
    assert.equal(await page.evaluate(() => state.claims[0].claim_number), 'CLM-CLOUD');
    await page.evaluate(() => setRoute('detail', state.claims[0].id));
    await page.locator('[data-action="delete"]').click();
    await page.locator('#modal [data-close]').click();
    assert.equal(await page.evaluate(() => state.claims.length), 1);
    await page.evaluate(() => { getSupabaseClient().rpc = async () => ({ error: new Error('Network failed') }); });
    await page.locator('[data-action="delete"]').click();
    await page.locator('#confirmDeleteClaim').click();
    await page.locator('#deleteClaimMessage', { hasText: '删除失败' }).waitFor();
    assert.equal(await page.evaluate(() => state.claims.length), 1);
    await page.locator('#modal [data-close]').click();
    await page.evaluate(() => {
      getSupabaseClient().rpc = async (name, args) => {
        window.__deleteRequest = { name, args };
        return { data: args.p_claim_id, error: null };
      };
    });
    await page.locator('[data-action="delete"]').click();
    await page.locator('#confirmDeleteClaim').click();
    await page.waitForFunction(() => state.claims.length === 0);
    assert.equal(await page.evaluate(() => window.__deleteRequest.name), 'soft_delete_claim');
    await page.reload();
    await page.waitForFunction(() => !sessionChecking && state.claims.length === 1);
    await page.evaluate(() => { state.claims[0].status = 'PAID'; setRoute('detail', state.claims[0].id); });
    assert.equal(await page.locator('[data-action="delete"]').count(), 0);
    console.log('PASS: clean-device cloud claims, amount mapping, protected receipt URL/render, failure/retry, reload, visible version and mobile layout.');
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
