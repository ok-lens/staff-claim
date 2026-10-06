const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const fs = require("node:fs/promises");
const path = require("node:path");

// All accounts and SDK operations here are browser-only mocks, never production users.
function mockSdk() {
  const ADMIN = "00000000-0000-4000-8000-000000000001";
  const STAFF = "00000000-0000-4000-8000-000000000002";
  const NEW = "00000000-0000-4000-8000-000000000003";
  let profiles = JSON.parse(sessionStorage.getItem("mock.profiles") || "null") || [
    { id: ADMIN, full_name: "Admin", email: "admin@example.com", role: "admin", is_active: true },
    { id: STAFF, full_name: "Employee", email: "staff@example.com", role: "staff", is_active: true }
  ];
  const save = () => sessionStorage.setItem("mock.profiles", JSON.stringify(profiles));
  const mode = () => sessionStorage.getItem("mock.mode") || "admin";
  const user = () => mode() === "invalid" ? null : {
    id: mode() === "admin" ? ADMIN : STAFF, email: mode() === "admin" ? "admin@example.com" : "staff@example.com",
    app_metadata: { must_change_password: mode() === "new" }
  };
  window.__calls = [];
  const client = {
    auth: {
      getUser: async () => ({ data: { user: user() }, error: mode() === "invalid" ? new Error("No session") : null }),
      signInWithPassword: async fields => {
        sessionStorage.setItem("mock.mode", fields.email === "admin@example.com" ? "admin" : "new");
        return { data: { user: user() }, error: null };
      },
      refreshSession: async () => ({ data: { user: user() }, error: null }),
      signOut: async () => { window.__calls.push({ action: "signout" }); sessionStorage.setItem("mock.mode", "invalid"); return { error: null }; }
    },
    from: table => {
      let id;
      const response = () => ({ data: table === "profiles" ? profiles.filter(p => !id || p.id === id) : [
        { id: "00000000-0000-4000-8000-000000000004", name_en: "Petrol", name_zh: "汽油", accounting_code: "908-0000", is_active: true }
      ], error: null });
      const query = {
        select: () => query, order: () => query,
        eq: (_, value) => { id = value; return query; },
        maybeSingle: async () => ({ data: profiles.find(p => p.id === id), error: null }),
        then: (resolve, reject) => Promise.resolve(response()).then(resolve, reject)
      };
      return query;
    },
    functions: { invoke: async (_, { body }) => {
      window.__calls.push({ ...body });
      const failure = code => ({ data: null, error: { context: { json: async () => ({ code }) } } });
      if (body.action === "change-password") {
        if (body.current_password !== "Temporary123!") return failure("wrong_password");
        sessionStorage.setItem("mock.mode", "staff");
        return { data: { success: true }, error: null };
      }
      if (body.action === "create") {
        if (profiles.some(p => p.email === body.email)) return failure("email_exists");
        const profile = { id: NEW, full_name: body.name, email: body.email, role: body.role, is_active: true };
        profiles.push(profile); save();
        return { data: { profile }, error: null };
      }
      const profile = { id: body.id, full_name: body.name, email: body.email, role: body.role, is_active: body.is_active };
      profiles = profiles.map(p => p.id === body.id ? profile : p); save();
      return { data: { profile }, error: null };
    } }
  };
  window.supabase = { createClient: () => client };
}

(async () => {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL);
  const contexts = [];
  const errors = [];
  const artifacts = path.resolve(__dirname, "../test-results/employee-onboarding");
  await fs.mkdir(artifacts, { recursive: true });
  async function pageFor(mode, width = 390) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: "block" });
    contexts.push(context);
    await context.addInitScript(mode => {
      if (!sessionStorage.getItem("mock.mode")) sessionStorage.setItem("mock.mode", mode);
    }, mode);
    await context.route("**/cdn.jsdelivr.net/**", route => route.fulfill({ contentType: "application/javascript", body: `(${mockSdk.toString()})();` }));
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(process.env.APP_URL || "http://localhost:5183");
    return page;
  }
  async function noOverflow(page) {
    const bad = await page.evaluate(() => [...document.querySelectorAll("input, button, .employee-email")].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width && (r.left < 0 || r.right > innerWidth + 1 || el.scrollWidth > el.clientWidth + 2);
    }).map(el => el.id || el.textContent.trim()));
    assert.deepEqual(bad, []);
  }
  try {
    const admin = await pageFor("admin");
    await admin.locator('[data-route="admin"]').click();
    assert.equal(await admin.locator("#newUserPassword").getAttribute("minlength"), "6");
    assert.equal(await admin.locator("#newUserPassword").getAttribute("maxlength"), "14");
    await admin.locator("#newUserPassword").fill("abcdefgh");
    assert.equal(await admin.locator("#newUserPassword").evaluate(input => input.checkValidity()), false);
    await admin.locator("#newUserPassword").fill("Ab1234");
    assert.equal(await admin.locator("#newUserPassword").evaluate(input => input.checkValidity()), true);
    await admin.locator("#newUserName").fill("Mei Ling");
    await admin.locator("#newUserEmail").fill("meiling@example.com");
    await admin.locator("#newUserPassword").fill("Temporary123!");
    await admin.locator("[data-add-user]").click();
    await admin.locator('.employee-email', { hasText: 'meiling@example.com' }).waitFor();
    const stored = await admin.evaluate(() => JSON.stringify({ ...localStorage }));
    assert.ok(!stored.includes("Temporary123!"));
    assert.ok(stored.includes("00000000-0000-4000-8000-000000000003"));
    assert.equal(await admin.locator("#newUserPassword").inputValue(), "");
    await admin.reload();
    await admin.locator('[data-route="admin"]').click();
    await admin.locator('.employee-email', { hasText: 'meiling@example.com' }).waitFor();
    await admin.locator("#newUserName").fill("Duplicate");
    await admin.locator("#newUserEmail").fill("meiling@example.com");
    await admin.locator("#newUserPassword").fill("Temporary123!");
    await admin.locator("[data-add-user]").click();
    await admin.locator("#employeeMessage", { hasText: "电邮已注册" }).waitFor();
    assert.equal(await admin.locator('.employee-email', { hasText: 'meiling@example.com' }).count(), 1);
    await admin.locator('[data-edit-user="00000000-0000-4000-8000-000000000003"]').click();
    await admin.locator("#editUserStatus").selectOption("inactive");
    await admin.locator("#saveUserSettings").click();
    await admin.locator('[data-restore-user="00000000-0000-4000-8000-000000000003"]').waitFor();
    await admin.reload();
    await admin.locator('[data-route="admin"]').click();
    await admin.locator('[data-restore-user="00000000-0000-4000-8000-000000000003"]').click();
    await admin.locator('[data-edit-user="00000000-0000-4000-8000-000000000003"]').waitFor();
    assert.equal(await admin.locator('[data-restore-user="00000000-0000-4000-8000-000000000003"]').count(), 0);
    await noOverflow(admin);
    await admin.locator("#employeeForm").scrollIntoViewIfNeeded();
    await admin.screenshot({ path: path.join(artifacts, "admin-mobile.png") });

    const staff = await pageFor("new");
    await staff.locator("#passwordForm").waitFor();
    assert.equal(await staff.locator("#nav button").count(), 0);
    await staff.evaluate(() => setRoute("admin"));
    await staff.locator("#passwordForm").waitFor();
    await staff.reload();
    await staff.locator("#passwordForm").waitFor();
    await noOverflow(staff);
    await staff.screenshot({ path: path.join(artifacts, "first-login-mobile.png") });
    await staff.locator("#currentPassword").fill("Temporary123!");
    await staff.locator("#newPassword").fill("Personal456!");
    await staff.locator("#confirmPassword").fill("Different123!");
    await staff.locator("[data-password-save]").click();
    await staff.locator("#passwordMessage", { hasText: "不一致" }).waitFor();
    assert.equal(await staff.evaluate(() => window.__calls.length), 0);
    await staff.locator("#confirmPassword").fill("Personal456!");
    await staff.locator("#currentPassword").fill("Wrong123456!");
    await staff.locator("[data-password-save]").click();
    await staff.locator("#passwordMessage", { hasText: "不正确" }).waitFor();
    await staff.locator("#currentPassword").fill("Temporary123!");
    await staff.locator("[data-password-save]").click();
    await staff.locator('[data-route="new"]').waitFor();
    assert.equal(await staff.locator('[data-route="admin"]').count(), 0);
    const staffStorage = await staff.evaluate(() => JSON.stringify({ ...localStorage }));
    assert.ok(!staffStorage.includes("Temporary123!") && !staffStorage.includes("Personal456!"));
    await staff.reload();
    await staff.locator('[data-route="new"]').waitFor();
    assert.equal(await staff.locator("#passwordForm").count(), 0);
    await staff.locator('[data-change-password]').click();
    await staff.locator("#passwordForm").waitFor();
    await staff.locator("#cancelPassword").click();
    await staff.locator('[data-route="new"]').waitFor();
    await staff.locator('[data-logout]').click();
    await staff.locator('[data-real-login]').waitFor();
    assert.ok(await staff.evaluate(() => window.__calls.some(call => call.action === "signout")));
    await staff.reload();
    await staff.locator('[data-real-login]').waitFor();

    const invalid = await pageFor("invalid", 1280);
    await invalid.locator('[data-real-login]').waitFor();
    await invalid.evaluate(() => { localStorage.setItem("staffClaimsMvp.loggedIn", "true"); });
    await invalid.reload();
    await invalid.locator('[data-real-login]').waitFor();
    assert.equal(await invalid.locator("#nav button").count(), 0);
    await noOverflow(invalid);
    await invalid.screenshot({ path: path.join(artifacts, "login-desktop.png") });
    const desktop = await pageFor("new", 1280);
    await desktop.locator("#passwordForm").waitFor();
    await noOverflow(desktop);
    await desktop.screenshot({ path: path.join(artifacts, "first-login-desktop.png") });
    assert.deepEqual(errors, []);
    console.log("PASS: admin create/duplicate/persistence/settings/restore, first-login gate/reload/password validation, staff isolation, real logout, desktop/mobile layout; no page errors.");
  } finally {
    for (const context of contexts) await context.close();
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
