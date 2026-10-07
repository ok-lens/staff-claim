const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { mockSdk } = require('./test-employee-ui.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL);
  const contexts = [];
  const errors = [];
  const artifacts = path.resolve(__dirname, '../test-results/password-recovery');
  await fs.mkdir(artifacts, { recursive: true });
  async function pageFor(mode, hash = '', width = 390) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
    contexts.push(context);
    await context.addInitScript(mode => {
      if (!sessionStorage.getItem('mock.mode')) sessionStorage.setItem('mock.mode', mode);
    }, mode);
    await context.route('**/cdn.jsdelivr.net/**', route => route.fulfill({ contentType: 'application/javascript', body: `(${mockSdk.toString()})();` }));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto((process.env.APP_URL || 'http://localhost:5183') + '/' + hash);
    return page;
  }
  async function screenshot(page, name) {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(artifacts, name + '.png') });
  }
  try {
    const login = await pageFor('invalid');
    await login.locator('[data-forgot-password]').click();
    await login.locator('#recoveryEmail').fill('Employee@Example.com');
    await screenshot(login, 'forgot-mobile');
    await login.locator('#forgotPasswordForm button[type="submit"]').click();
    await login.waitForFunction(() => window.__calls.some(c => c.action === 'send-recovery'));
    const request = await login.evaluate(() => window.__calls.find(c => c.action === 'send-recovery'));
    assert.equal(request.email, 'employee@example.com');
    assert.equal(request.options.redirectTo, 'https://staff-claim.onrender.com/');
    assert.ok(await login.locator('#forgotPasswordForm button[type="submit"]').isDisabled());
    await login.reload();
    await login.locator('[data-forgot-password]').click();
    assert.ok(await login.locator('#forgotPasswordForm button[type="submit"]').isDisabled());

    for (const width of [320, 1280]) {
      const recovery = await pageFor('recovery-new', '#type=recovery', width);
      await recovery.locator('#passwordForm').waitFor();
      assert.equal(await recovery.locator('#currentPassword').count(), 0);
      assert.equal(await recovery.locator('#nav button').count(), 0);
      await recovery.reload();
      await recovery.locator('#passwordForm').waitFor();
      await screenshot(recovery, 'reset-' + width);
      await recovery.locator('#newPassword').fill('Personal456!');
      await recovery.locator('#confirmPassword').fill('Different123!');
      await recovery.locator('[data-password-save]').click();
      await recovery.locator('#passwordMessage', { hasText: '不一致' }).waitFor();
      assert.equal(await recovery.evaluate(() => window.__calls.length), 0);
      await recovery.locator('#confirmPassword').fill('Personal456!');
      await recovery.locator('[data-password-save]').click();
      await recovery.locator('[data-real-login]').waitFor();
      assert.deepEqual(await recovery.evaluate(() => window.__calls.find(c => c.action === 'recover-password')), { action: 'recover-password', password: 'Personal456!' });
      assert.ok(!(await recovery.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).includes('Personal456!'));
      assert.equal(await recovery.evaluate(() => sessionStorage.getItem('staffClaimsMvp.recoveryUser')), null);
    }
    for (const [mode, hash] of [['staff', '#type=recovery'], ['recovery-expired', '#type=recovery'], ['invalid', '#error=access_denied&error_code=otp_expired']]) {
      const expired = await pageFor(mode, hash);
      await expired.locator('#forgotPasswordForm').waitFor();
      assert.equal(await expired.locator('#passwordForm').count(), 0);
    }
    assert.deepEqual(errors, []);
    console.log('PASS: recovery email, cooldown, verified-link reset/reload, logout, no password storage, expired/forged links, desktop/mobile layout.');
  } finally {
    for (const context of contexts) await context.close();
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
