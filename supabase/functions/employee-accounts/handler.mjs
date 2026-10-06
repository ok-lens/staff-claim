const PROFILE_FIELDS = "id,full_name,email,role,is_active";
const ROLES = new Set(["staff", "accountant", "admin"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const strongPassword = value => typeof value === "string" && value.length >= 10 && value.length <= 128 && /[a-zA-Z]/.test(value) && /[0-9]/.test(value);
const temporaryPassword = value => typeof value === "string" && value.length >= 8 && value.length <= 14 && /[a-zA-Z]/.test(value) && /[0-9]/.test(value);
const accountFields = body => ({
  full_name: typeof body.name === "string" ? body.name.trim() : "",
  email: typeof body.email === "string" ? body.email.trim().toLowerCase() : "",
  role: body.role,
  is_active: body.is_active
});
const validFields = fields => fields.full_name.length > 0 && fields.full_name.length <= 100
  && fields.email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)
  && ROLES.has(fields.role) && typeof fields.is_active === "boolean";

export function createEmployeeHandler({ createClient, env }) {
  function key(bundle, fallback) {
    const value = env(bundle);
    return (value ? JSON.parse(value).default : null) || env(fallback);
  }
  return async request => {
    const origin = request.headers.get("origin");
    const allowed = !origin || origin === "https://staff-claim.onrender.com"
      || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const headers = {
      "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Origin",
      "Access-Control-Allow-Headers": "authorization,apikey,x-client-info,content-type",
      "Access-Control-Allow-Methods": "POST,OPTIONS"
    };
    if (allowed && origin) headers["Access-Control-Allow-Origin"] = origin;
    const reply = (status, data) => new Response(JSON.stringify(data), { status, headers });
    if (!allowed) return reply(403, { code: "origin_not_allowed" });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return reply(405, { code: "method_not_allowed" });
    const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) return reply(401, { code: "unauthorized" });
    try {
      const url = env("SUPABASE_URL");
      const secret = key("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
      if (!url || !secret) return reply(503, { code: "service_unavailable" });
      const options = { auth: { persistSession: false, autoRefreshToken: false } };
      const admin = createClient(url, secret, options);
      // Validate the session with Auth, then authorize against the live company profile.
      const auth = await admin.auth.getUser(token);
      if (auth.error || !auth.data.user) return reply(401, { code: "unauthorized" });
      const caller = auth.data.user;
      const own = await admin.from("profiles").select(PROFILE_FIELDS).eq("id", caller.id).maybeSingle();
      if (own.error) return reply(503, { code: "service_unavailable" });
      if (!own.data?.is_active) return reply(403, { code: "account_inactive" });
      const raw = await request.text();
      if (raw.length > 4096) return reply(413, { code: "invalid_input" });
      let body;
      try { body = JSON.parse(raw); } catch { return reply(400, { code: "invalid_input" }); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return reply(400, { code: "invalid_input" });

      if (body.action === "change-password") {
        if (!strongPassword(body.password) || typeof body.current_password !== "string"
          || body.current_password.length > 128 || body.password === body.current_password) {
          return reply(400, { code: "invalid_password" });
        }
        const publicKey = key("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
        if (!publicKey) return reply(503, { code: "service_unavailable" });
        const verifier = createClient(url, publicKey, options);
        const checked = await verifier.auth.signInWithPassword({ email: caller.email, password: body.current_password });
        if (checked.error || checked.data.user?.id !== caller.id) return reply(400, { code: "wrong_password" });
        await verifier.auth.signOut({ scope: "local" });
        const changed = await admin.auth.admin.updateUserById(caller.id, {
          password: body.password,
          app_metadata: { ...caller.app_metadata, must_change_password: false }
        });
        if (changed.error) return reply(400, { code: "password_update_failed" });
        return reply(200, { success: true });
      }

      if (!["admin", "boss"].includes(own.data.role)) return reply(403, { code: "admin_required" });
      if (caller.app_metadata?.must_change_password === true) return reply(403, { code: "password_change_required" });
      if (!["create", "update"].includes(body.action)) return reply(400, { code: "invalid_action" });
      const fields = accountFields({ ...body, is_active: body.action === "create" ? true : body.is_active });
      if (!validFields(fields)) return reply(400, { code: "invalid_input" });

      if (body.action === "create") {
        if (!temporaryPassword(body.password)) return reply(400, { code: "invalid_temporary_password" });
        const created = await admin.auth.admin.createUser({
          email: fields.email, password: body.password, email_confirm: true,
          user_metadata: { full_name: fields.full_name }, app_metadata: { must_change_password: true }
        });
        if (created.error || !created.data.user) {
          return reply(400, { code: ["email_exists", "user_already_exists"].includes(created.error?.code) ? "email_exists" : "account_create_failed" });
        }
        const id = created.data.user.id;
        const saved = await admin.from("profiles").insert({ id, ...fields }).select(PROFILE_FIELDS).single();
        if (saved.error) {
          const removed = await admin.auth.admin.deleteUser(id);
          return reply(500, { code: removed.error ? "account_cleanup_required" : "account_create_failed" });
        }
        return reply(201, { profile: saved.data });
      }

      if (!UUID.test(body.id || "")) return reply(400, { code: "invalid_input" });
      if (body.id === caller.id && (!fields.is_active || fields.role !== "admin")) {
        return reply(400, { code: "own_admin_required" });
      }
      const previous = await admin.from("profiles").select(PROFILE_FIELDS).eq("id", body.id).maybeSingle();
      if (previous.error) return reply(503, { code: "service_unavailable" });
      if (!previous.data) return reply(404, { code: "employee_not_found" });
      const oldAuth = await admin.auth.admin.getUserById(body.id);
      if (oldAuth.error || !oldAuth.data.user) return reply(404, { code: "employee_not_found" });
      const changed = await admin.auth.admin.updateUserById(body.id, { email: fields.email, email_confirm: true });
      if (changed.error) return reply(400, { code: changed.error.code === "email_exists" ? "email_exists" : "account_update_failed" });
      const saved = await admin.from("profiles").update(fields).eq("id", body.id).select(PROFILE_FIELDS).single();
      if (saved.error) {
        const reverted = await admin.auth.admin.updateUserById(body.id, { email: oldAuth.data.user.email, email_confirm: true });
        return reply(500, { code: reverted.error ? "account_cleanup_required" : "account_update_failed" });
      }
      return reply(200, { profile: saved.data });
    } catch {
      return reply(500, { code: "service_unavailable" });
    }
  };
}
