import test from "node:test";
import assert from "node:assert/strict";
import { createEmployeeHandler } from "../supabase/functions/employee-accounts/handler.mjs";

const ID = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const TEMP = "Temporary123!";
const NEW = "Personal456!";
const profile = { id: ID, full_name: "Admin", email: "admin@example.com", role: "admin", is_active: true };
function fixture(overrides = {}) {
  const calls = [];
  const own = { ...profile, ...overrides.profile };
  const caller = { id: ID, email: own.email, app_metadata: overrides.metadata || {} };
  const old = { id: OTHER, full_name: "Employee", email: "employee@example.com", role: "staff", is_active: true };
  const result = (data, error = null) => ({ data, error });
  const admin = {
    auth: {
      getUser: async token => token === "valid" ? result({ user: caller }) : result({ user: null }, new Error("invalid")),
      admin: {
        createUser: async fields => { calls.push(["create", fields]); return result({ user: { id: OTHER } }, overrides.createError); },
        deleteUser: async id => { calls.push(["delete", id]); return result({}, overrides.deleteError); },
        getUserById: async () => result({ user: { id: OTHER, email: old.email } }),
        updateUserById: async (id, fields) => { calls.push(["auth-update", id, fields]); return result({ user: caller }, overrides.updateError); }
      }
    },
    from: table => {
      assert.equal(table, "profiles");
      let selected = ID;
      let write;
      const query = {
        select: () => query,
        eq: (_, id) => { selected = id; return query; },
        maybeSingle: async () => result(selected === ID ? own : old),
        insert: fields => { calls.push(["insert", fields]); write = fields; return query; },
        update: fields => { calls.push(["profile-update", fields]); write = fields; return query; },
        single: async () => result({ ...old, ...write, id: selected === ID && !write?.id ? ID : OTHER }, overrides.saveError)
      };
      return query;
    }
  };
  const verifier = { auth: {
    signInWithPassword: async fields => { calls.push(["verify", fields]); return result({ user: caller }, fields.password === TEMP ? null : new Error("invalid")); },
    signOut: async () => { calls.push(["verifier-signout"]); return result({}); }
  } };
  const handler = createEmployeeHandler({
    env: name => ({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "server-only", SUPABASE_ANON_KEY: "public" })[name],
    createClient: (_, key) => key === "server-only" ? admin : verifier
  });
  async function request(body, token = "valid", origin = "https://staff-claim.onrender.com") {
    const response = await handler(new Request("https://example.test", { method: "POST", headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}), origin, "content-type": "application/json"
    }, body: typeof body === "string" ? body : JSON.stringify(body) }));
    return { status: response.status, data: await response.json() };
  }
  return { calls, request };
}
const create = { action: "create", name: "New Staff", email: "new@example.com", password: TEMP, role: "staff" };
test("missing and invalid sessions cannot provision", async () => {
  const f = fixture();
  assert.equal((await f.request(create, "")).status, 401);
  assert.equal((await f.request(create, "invalid")).status, 401);
  assert.equal(f.calls.length, 0);
});
for (const role of ["staff", "accountant"]) test(`${role} cannot create even with spoofed metadata`, async () => {
  const f = fixture({ profile: { role }, metadata: { role: "admin" } });
  assert.equal((await f.request(create)).status, 403);
  assert.equal(f.calls.length, 0);
});
test("inactive and first-login admins cannot provision", async () => {
  for (const option of [{ profile: { is_active: false } }, { metadata: { must_change_password: true } }]) {
    const f = fixture(option);
    assert.equal((await f.request(create)).status, 403);
    assert.equal(f.calls.length, 0);
  }
});
test("new auth user and matching profile created with forced password change", async () => {
  const f = fixture();
  const response = await f.request({ ...create, email: " New@Example.com " });
  assert.equal(response.status, 201);
  assert.equal(response.data.profile.email, "new@example.com");
  assert.deepEqual(f.calls[0][1].app_metadata, { must_change_password: true });
  assert.equal(f.calls[1][1].id, OTHER);
  assert.ok(!JSON.stringify(response.data).includes(TEMP));
  assert.ok(!JSON.stringify(f.calls[1]).includes(TEMP));
});
test("profile failure rolls back only the newly-created Auth account", async () => {
  const f = fixture({ saveError: new Error("failed") });
  assert.equal((await f.request(create)).status, 500);
  assert.deepEqual(f.calls.at(-1), ["delete", OTHER]);
});
test("failed rollback is surfaced and duplicate email is not overwritten", async () => {
  const f = fixture({ saveError: new Error("failed"), deleteError: new Error("failed") });
  assert.equal((await f.request(create)).data.code, "account_cleanup_required");
  const dup = fixture({ createError: { code: "email_exists" } });
  assert.equal((await dup.request(create)).data.code, "email_exists");
  assert.equal(dup.calls.length, 1);
});
for (const bad of [{ password: "short" }, { role: "root" }, { email: "invalid" }, { name: " " }]) {
  test(`invalid ${Object.keys(bad)[0]} is rejected before writes`, async () => {
    const f = fixture();
    assert.equal((await f.request({ ...create, ...bad })).status, 400);
    assert.equal(f.calls.length, 0);
  });
}
test("password change verifies current password and changes only caller", async () => {
  const f = fixture({ profile: { role: "staff" }, metadata: { must_change_password: true, existing: "keep" } });
  assert.equal((await f.request({ action: "change-password", id: OTHER, current_password: TEMP, password: NEW })).status, 200);
  const updated = f.calls.find(call => call[0] === "auth-update");
  assert.equal(updated[1], ID);
  assert.deepEqual(updated[2].app_metadata, { must_change_password: false, existing: "keep" });
});
test("wrong current password and reused password cannot unlock account", async () => {
  const f = fixture({ profile: { role: "staff" } });
  assert.equal((await f.request({ action: "change-password", current_password: "incorrect", password: NEW })).data.code, "wrong_password");
  assert.equal((await f.request({ action: "change-password", current_password: TEMP, password: TEMP })).data.code, "invalid_password");
  assert.ok(!f.calls.some(call => call[0] === "auth-update"));
});
test("settings persist to Auth and profiles; admin cannot deactivate itself", async () => {
  const f = fixture();
  const update = { action: "update", id: OTHER, name: "New Name", email: "updated@example.com", role: "staff", is_active: false };
  assert.equal((await f.request(update)).status, 200);
  assert.ok(f.calls.some(call => call[0] === "profile-update" && call[1].is_active === false));
  const self = fixture();
  assert.equal((await self.request({ ...update, id: ID })).data.code, "own_admin_required");
  assert.equal(self.calls.length, 0);
});
test("profile update failure compensates email change", async () => {
  const f = fixture({ saveError: new Error("failed") });
  assert.equal((await f.request({ action: "update", id: OTHER, name: "Staff", email: "new@example.com", role: "staff", is_active: true })).status, 500);
  assert.equal(f.calls.at(-1)[2].email, "employee@example.com");
});
test("unapproved origins and malformed JSON fail closed", async () => {
  const f = fixture();
  assert.equal((await f.request(create, "valid", "https://unapproved.test")).status, 403);
  assert.equal((await f.request("not-json")).status, 400);
  assert.equal(f.calls.length, 0);
});
