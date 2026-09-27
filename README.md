# FOLD

Your money, simply kept.

FOLD retains its approved HTML/CSS/vanilla JavaScript interface. Authentication and financial storage now use the official Supabase JavaScript client, Supabase Auth, and PostgreSQL. There is no demo login or local financial database. Until the configuration below is completed, Fold shows a connection notice and cannot authenticate.

## 1. Create and configure Supabase

1. Create a project in the [Supabase dashboard](https://supabase.com/dashboard).
2. From the project's Connect/API settings, copy the **Project URL** and **publishable key** (`sb_publishable_…`). A legacy `anon` key is also supported. Do **not** use `sb_secret_…`, `service_role`, a database password, or a Google client secret in browser code.
3. Open the existing **`config.js`** in the project root and fill only these two values:

   ```js
   window.FOLD_CONFIG = Object.freeze({
     SUPABASE_URL: "https://YOUR_PROJECT_REF.supabase.co",
     SUPABASE_PUBLISHABLE_KEY: "YOUR_PUBLIC_PUBLISHABLE_KEY",
   });
   ```

   `config.js` is gitignored. For a fresh checkout, copy `config.example.js` to `config.js`. Browser configuration is public by design; RLS, not hiding this key, protects the database. No real credentials are supplied in this repository.

4. Open the project's **SQL Editor**, paste all of **`supabase/schema.sql`**, and run it. Use a fresh project or inspect any pre-existing tables named `profiles`, `goals`, and `transactions` before applying. This is an initial migration, not a converter for unrelated existing schemas. It runs in a transaction and can be rerun against the same Fold schema. It requires PostgreSQL 15 or later (current hosted Supabase supports the column-specific foreign-key action used here).
5. Under **Authentication → Sign In / Providers**, enable Email/password. Set a minimum password length of at least 8. Keep email confirmation enabled for production. Configure an SMTP provider for dependable public email delivery and review the project's email rate limits. Fold handles both confirmation-required signup (no session yet) and immediate-session signup if confirmation is disabled.

## 2. Redirect URLs and Google

Use one consistent development origin: **`http://127.0.0.1:4173/`**. `localhost` is a different origin and cannot share the PKCE verifier/session with `127.0.0.1`.

In **Authentication → URL Configuration**:

- Set the development **Site URL** to `http://127.0.0.1:4173/`.
- Add these exact **Redirect URLs**:
  - `http://127.0.0.1:4173/?auth=callback`
  - `http://127.0.0.1:4173/?auth=recovery`
- If you deliberately open `/index.html`, also allow `/index.html?auth=callback` and `/index.html?auth=recovery` on that origin. Prefer using `/` consistently.
- Before deploying, set Site URL to your HTTPS production origin and add its exact callback/recovery equivalents. Avoid wildcard production redirects.

For Google:

1. Create a Google Cloud OAuth client of type **Web application** and configure the consent screen. Add your test users while the Google application is in testing mode.
2. Copy the **Supabase Google provider callback URL** from the Supabase dashboard (usually `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`) into Google's **Authorized redirect URIs**. This is different from Fold's application callback URL above.
3. Configure your app's origins in Google where requested.
4. Enable Google in Supabase Auth providers and place the Google Client ID and Client Secret **in Supabase's provider settings only**.

Fold uses the SDK's PKCE flow, `signInWithOAuth`, automatic callback code exchange, and auth-state events. It never reads or manually stores Google tokens. Redirect destinations are constructed from the current app origin/path, never from a user-supplied `next` URL.

## 3. Email confirmation and password reset

Leave the standard Supabase confirmation/recovery templates using `{{ .ConfirmationURL }}`, or ensure any customized template still preserves the requested redirect destination. Fold sends `?auth=callback` for confirmation and `?auth=recovery` for password recovery.

With this client-only PKCE setup, open confirmation/recovery links **in the same browser and origin that requested them**. Request a new recovery link from the desired browser if necessary. An expired or invalid link shows an error rather than granting access. Normal login works on any device after email confirmation.

The recovery link establishes a Supabase recovery session, then Fold shows the new-password form and calls `updateUser`. **You → Change password** also calls `updateUser`; when Secure Password Change requires recent authentication, the form can send a reauthentication code and submit its nonce. Enable and test this setting in your project.

## 4. Run locally or deploy

```sh
node serve.cjs
```

Open **http://127.0.0.1:4173/**. Use HTTP locally / HTTPS in production, not a `file://` page. No framework or application build step is required. The official SDK is bundled in `assets/supabase.js` from the exact dependency pinned in `package-lock.json`; Lucide has a local copy too.

To reinstall dependencies or update the bundled copy from the lockfile:

```sh
npm ci
npm run vendor
```

Deploy `index.html`, `config.js`, `css/`, `js/`, and `assets/` to a static HTTPS host. Supply the frontend-safe configuration during deployment because it is gitignored. Do not publish `.env` files, `node_modules`, tests, or SQL tooling. The local server deliberately serves only the app assets. Configure `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, and anti-framing headers on the host too. Final operator-specific service terms/privacy policy and production email/provider settings must be completed before public launch.

## Data and security behavior

- Every new account starts with an empty profile, no transactions, no goals, and onboarding required. Optional Google names may initialize the profile; email always comes from the authenticated user.
- `profiles`, `goals`, and `transactions` all have enabled/forced RLS, authenticated CRUD policies and restrictive owner guards using `auth.uid()`. Anonymous table privileges are revoked. Frontend owner filters provide additional scoping but are not the authorization boundary.
- A composite foreign key `(user_id, goal_id)` prevents cross-account goal links. Deleting a goal atomically sets only `goal_id` to null; transactions and amounts remain intact.
- Profile values, amounts, currencies, categories, date ranges, text lengths, and transaction types have database constraints. `updated_at` triggers and user/date/goal indexes are included.
- Confirmed **Restore sample data** calls an atomic, `SECURITY INVOKER` RPC. It replaces only the signed-in user's entries/goals, resets currency and budget to the NGN example, and retains their name/account. It never runs automatically.
- Confirmed **Clear everything** clears financial records and profile settings across devices, then returns to onboarding. It does not delete the Supabase Auth account.
- The Supabase SDK manages its own persisted session, refresh, and cross-tab auth events. Passwords are not saved by Fold. The old `fold-budget-v1` demo storage is **never read or imported**; it is left untouched for recovery of old demo records and can be removed via browser site storage if no longer needed. It cannot appear in any authenticated notebook.
- Financial state exists only in memory between server requests. Sign-out/account changes clear the UI, sheets, drafts, and memory. Generation checks discard late responses from old sessions. Session changes never fall back to sample records.
- Writes await server success. Pending controls prevent double submission; a stable draft UUID makes an insert retry after an uncertain response safe. Failed forms keep input and show an error. Loads have a retry state. A confirmed bulk reset whose follow-up read fails is clearly reported as saved, with a reload option.
- Returning to the browser tab refreshes data when no form is open; signing in or refreshing always loads the server notebook. This is cross-device persistence, not continuous realtime collaboration. Concurrent edits to the same profile field use the last successful write. Goals and transactions are paginated beyond the default API row limit.
- The existing ledger formula, monthly date semantics, number words, currencies, and goal totals are preserved. Currency changes relabel amounts; they do not convert exchange rates.

## Tests

```sh
npm test
```

Runs the original ledger tests, configuration/auth-adapter tests, unchanged-CSS check, and the **actual SQL migration in PGlite (PostgreSQL)**. Database tests exercise RLS as authenticated A/B and anonymous roles, ownership changes, cross-owner foreign keys, goal unlinking, constraints, RPC isolation, rollback, and rerunning the schema.

For browser regression tests, start a separate local server on 4174:

```powershell
$env:PORT = '4174'
node serve.cjs
```

Then, from another terminal:

```sh
npm run test:browser
```

The suite uses Chrome on Windows when available; on other systems install Playwright Chromium with `npx playwright install chromium`. Set `FOLD_BROWSER_PATH` to override the browser executable and `FOLD_TEST_URL` to override the app URL. Browser tests load the real bundled Supabase SDK, intercept only the test project's Auth/PostgREST transport, and execute data requests against the real migration/RLS in PostgreSQL. **They do not verify hosted Supabase, Google consent, or actual email delivery.** Test identities/credentials exist only in the test fixture and are never loaded by the app. Screenshots are written to `tests/artifacts/`.

### Required live acceptance checks after configuration

1. Sign up with a new real email. With confirmation enabled, see “Check your email” and no dashboard. Try an existing email and invalid input; the UI must not claim a new session.
2. Open the confirmation link in the requesting browser. Complete currency, starting balance, and optional cap; verify empty financial records.
3. Log out, try an incorrect password, then log in successfully. Refresh; session/data should persist and onboarding should not repeat.
4. Add spent/saved transactions, link saves to a goal, delete entries/goals, and edit profile/currency/budget. Refresh and verify totals. Deleting a goal must retain its transactions.
5. In a second device/browser, sign into the same account and verify records/settings. Sign into a different account and verify it is empty and cannot see the first account's records.
6. Use Google for a new user and returning user; verify consent, redirect, onboarding only for the new user, and cancellation feedback. Account linking for matching emails follows the Supabase project's policy.
7. Request a password reset, open the link, set a new password, log out, and confirm the new password works and the old one does not. Try an expired link. Test **You → Change password** and the security-code flow too.
8. Simulate offline/failed requests: no success toast for a failed write, form values remain, retry works, no replacement samples appear. Use two tabs to verify sign-out clears both and a delayed request never restores the signed-out user's UI.
9. From an authenticated client's API requests, attempt another user's IDs for select/update/delete and goal association. RLS/FK must reject or return no rows. SQL Editor normally runs with privileged owner rights; use the app JWT to test deployed RLS.
10. Check the unchanged mobile layouts at 320–430px and centered desktop layout, plus absence of browser console errors.

## Project map

`index.html` — existing shell and local script loading. `css/style.css` — unchanged approved styles. `js/core.js` — unchanged ledger utilities. `js/app.js` — existing screen renderers plus authenticated session/controller and server-confirmed event handlers. `js/backend.js` — public configuration validation, official SDK initialization and Auth adapter. `js/data.js` — owner-scoped PostgreSQL repository and mappings. `supabase/schema.sql` — complete initial database migration. `serve.cjs` — restricted local static server. `scripts/vendor.cjs` — reproducible SDK copy.

Implementation references: [Supabase JavaScript](https://supabase.com/docs/reference/javascript/introduction), [Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google), [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow), [password recovery](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
