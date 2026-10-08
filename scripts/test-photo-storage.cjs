const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { mockSdk } = require('./test-employee-ui.cjs');
(async () => {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const errors = [];
  try {
    await context.addInitScript(() => sessionStorage.setItem('mock.mode', 'staff'));
    await context.route('**/cdn.jsdelivr.net/**', route => route.fulfill({ contentType: 'application/javascript', body: `(${mockSdk.toString()})();` }));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://localhost:5183');
    await page.locator('[data-route="new"]').click();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=', 'base64');
    const photo = Buffer.concat([png, Buffer.alloc(6 * 1024 * 1024)]);
    await page.locator('#receiptUpload').setInputFiles({ name: 'large-receipt.png', mimeType: 'image/png', buffer: photo });
    await page.waitForFunction(() => getDraft().receipt?.local_image && !photoBusy);
    assert.ok(await page.evaluate(() => getDraft().receipt.data_url.length > 8000000));
    const uploaded = await page.evaluate(async () => {
      let size;
      const client = { storage: { from: () => ({ upload: async (_, blob) => { size = blob.size; return { error: null }; } }) } };
      const row = await uploadAttachmentToSupabase(client, { id: 'test-claim', claimant_id: currentUserId }, getDraft().receipt);
      return { size, hash: row.file_hash, type: row.attachment_type };
    });
    assert.equal(uploaded.size, photo.length);
    assert.equal(uploaded.type, 'RECEIPT');
    assert.equal(uploaded.hash.length, 64);
    assert.ok(await page.evaluate(() => localStorage.getItem('staffClaimsMvp.v1').length < 100000));
    assert.ok(await page.evaluate(() => !validateDraft(getDraft()).some(error => error.includes('Receipt photo'))));
    await page.reload();
    await page.locator('[data-route="new"]').click();
    assert.ok(await page.evaluate(() => getDraft().receipt.data_url.length > 8000000));
    await page.locator('#proofUpload').setInputFiles({ name: 'large-proof.png', mimeType: 'image/png', buffer: photo });
    await page.waitForFunction(() => getDraft().proofs.length === 1 && !photoBusy);
    assert.ok(await page.evaluate(() => localStorage.getItem('staffClaimsMvp.v1').length < 100000));
    await page.evaluate(() => { storeImage = async () => { throw new DOMException('Full', 'QuotaExceededError'); }; });
    await page.locator('#receiptUpload').setInputFiles({ name: 'failed.png', mimeType: 'image/png', buffer: png });
    await page.waitForFunction(() => !photoBusy && document.body.textContent.includes('照片保存失败'));
    assert.equal(await page.evaluate(() => getDraft().receipt.original_filename), 'large-receipt.png');
    assert.deepEqual(errors, []);
    console.log('PASS: 6MB receipt/proof, small metadata cache, reload persistence, required-receipt validation, quota failure retains previous receipt; no unhandled errors.');
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
