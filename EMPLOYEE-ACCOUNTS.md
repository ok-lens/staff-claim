# Employee Accounts

1. Sign in as Admin. Open Admin > Employees.
2. Enter name, a unique email, temporary password (8-14 characters with letters and numbers), and role. Staff is the default.
3. Add Employee creates the real Supabase Auth account and its company profile. Give the employee the email and temporary password privately.
4. First login requires the employee to replace the temporary password. Claims and receipts remain inaccessible until that step is complete.
5. Employee Settings persists names, emails, roles and active status. Inactive accounts cannot access claims. Restore enables the existing account; it does not create a duplicate or change its password.

Only active Admin/Boss profiles can provision or manage accounts. Accounts/Staff cannot provision accounts, self-register a company profile, or edit their own role. Existing users can change their password from the profile header. Passwords are never stored in app localStorage, profiles, or audit logs.

## Backend

- Migration: `database/migrations/20261006032433_employee_accounts.sql`.
- Edge Function: `supabase/functions/employee-accounts/index.ts` and `handler.mjs`.
- `verify_jwt` is disabled at the gateway because the handler itself validates each Bearer token with Auth `getUser(token)`, checks the live active profile, and checks the database role before any account mutation. Do not remove these checks.
- Secret/service keys come only from Supabase Edge Function environment variables, never from browser configuration.
- Allowed web origins: `https://staff-claim.onrender.com` and local HTTP previews. Add any future production domain to the explicit origin allowlist.
- RLS checks the live active profile and trusted Auth app metadata; temporary-password accounts cannot access claims/receipts, even by calling APIs directly.

## Verification

`node --test scripts/test-employee-accounts.mjs` runs backend authorization, validation and compensation tests using mocks only.

`scripts/test-employee-ui.cjs` tests the real HTML with a browser-only mocked SDK. Set `CDP_URL` to an agent-browser browser connection, `APP_URL` to the preview, and optionally `PLAYWRIGHT_PATH` to the installed Playwright module. It covers account creation, duplicates, persistent settings, first-login password gating, logout, and responsive layout without adding production test accounts.
