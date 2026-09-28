# Deployment and continuation verification

The workspace schema contract is `supabase/migrations/002_workspaces.sql`. Keep its tables, fields, categories and RPCs intact.

## Confirmed HTTP 400 cause

A read-only, anonymous, **zero-row** probe of the configured hosted Supabase project returned:

| Query                   | HTTP | Code     | Finding                      |
| ----------------------- | ---- | -------- | ---------------------------- |
| profiles projection     | 400  | 42703    | `usage_mode` missing         |
| workspaces projection   | 404  | PGRST205 | table absent from API schema |
| goals projection        | 400  | 42703    | `workspace_id` missing       |
| transactions projection | 400  | 42703    | `workspace_id` missing       |

The frontend was ahead of the deployed database. Its selected columns and RPC arguments match migration 002; the hosted project still needs that migration. Separately, the corrected migration called `set_updated_at()` while the base schema only supplied the old helper name. The base schema now supplies the canonical helper, and migration 002 defines it too so older installations can upgrade by running 002 alone. The migration requests a PostgREST schema-cache reload on commit.

No live SQL, record changes, account creation or account deletion was performed during this diagnosis. `scripts/diagnose-supabase.cjs` can repeat these read-only checks; it reads local public configuration and logs only table/status/code/known missing-column names. An anonymous permission denial after migration is expected with RLS and revoked anonymous access; it does not test authenticated CRUD.

## Manual SQL

For your **existing project**, run the entire current **`supabase/migrations/002_workspaces.sql`** in Supabase SQL Editor as the project owner. It includes the helper repair; no separate helper SQL is necessary. Do not reset the project or replace the existing base tables. The migration is transactional and preserves existing users, profile values, goal IDs, financial records and associations in a default Personal workspace.

For a new empty project only, run `supabase/schema.sql`, then `supabase/migrations/002_workspaces.sql`.

After a successful commit, refresh NectarSpend. If Supabase still reports stale schema-cache errors, the migration already includes this harmless cache notification; you can repeat it manually:

```sql
NOTIFY pgrst, 'reload schema';
```

The local SQL suite verifies the actual migration, historical data preservation, repeat execution, canonical timestamp trigger, all selected columns, category rules, user/workspace foreign keys, goal unlinking and RLS. Do not bypass RLS to fix a loading error.

## Supabase Authentication → URL Configuration

**Site URL**:

```text
https://nectarspend.com
```

**Redirect URLs**, matching the requested environments:

```text
http://127.0.0.1:5500/**
http://localhost:5500/**
https://nectarspend.vercel.app/**
https://nectarspend.com/**
https://www.nectarspend.com/**
```

Keep Email/password and Google enabled, and **keep email confirmation disabled**. A successful signup session proceeds directly to onboarding. The app never requires a confirmation step; a missing signup session is reported as an account-configuration/login problem. Password-recovery emails remain necessary for password resets.

If the app's `redirectTo` is missing from Supabase's redirect allowlist, Supabase may fall back to the configured Site URL. A stale localhost Site URL can therefore send a production login back to localhost even when the frontend sends the correct production `redirectTo`. Verify both dashboard settings and redeploy any stale frontend build. The current frontend already sends the approved current origin explicitly for Google, signup and recovery; no redirect implementation change was needed for the social-sharing update.

The app generates `/?auth=callback` or `/?auth=recovery` on the current approved origin. `/index.html` is also supported when that is the entry path. It ignores `next`, `redirect` and other user-supplied destinations. Unlisted origins, lookalike domains and protocol-relative callback paths cannot select an external destination. The hostname wildcard `*.vercel.app` is not allowed by the app.

The included local server defaults to 4173, and the automated browser server uses 4174. Those explicit localhost/127.0.0.1 origins are retained as development compatibility origins. If using live auth on those ports, add their corresponding `/**` entries in Supabase as well. To use the requested port instead, run `$env:PORT='5500'` then `npm start`, or use VS Code Live Server.

Keep a callback on the same origin that started authentication: PKCE verifiers and sessions are origin-scoped. Configure any www-to-apex redirect before users start login, rather than redirecting an in-progress auth callback between origins.

Reference: [Supabase redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls).

## Google Cloud OAuth client

Use a **Web application** OAuth client. Verify its **Authorized JavaScript origins** (origins only, no paths or wildcards):

```text
http://127.0.0.1:5500
http://localhost:5500
https://nectarspend.vercel.app
https://nectarspend.com
https://www.nectarspend.com
```

The **Authorized redirect URI** is the existing Supabase Google provider callback, copied exactly from **Supabase → Authentication → Sign In / Providers → Google**:

```text
https://mefjhllaaintjxwqujyl.supabase.co/auth/v1/callback
```

It is your configured `SUPABASE_URL` followed by `/auth/v1/callback`. Do not substitute an application-domain callback here. Keep Google's client ID/secret in Supabase provider settings only. Check OAuth consent-screen publishing/test-user settings for the accounts you intend to use.

Reference: [Supabase Google OAuth setup](https://supabase.com/docs/guides/auth/social-login/auth-google).

## Vercel

- Framework preset: **Other**.
- Build command: **`npm run build`**.
- Output directory: **`dist`**.
- Environment variables: **`SUPABASE_URL`** and **`SUPABASE_PUBLISHABLE_KEY`**, using the same existing project and public key. A legacy public `SUPABASE_ANON_KEY` is supported instead. Never supply a service-role/secret key.
- Apply variables to the intended deployment environments and redeploy after changes. Local `config.js` is gitignored and will not arrive through a Git deployment.
- Attach `nectarspend.com` and `www.nectarspend.com` in Vercel Domains and complete the DNS/HTTPS verification shown there. Retain the `nectarspend.vercel.app` deployment alias.
- Keep the included minimal `vercel.json`. Only static browser assets/public configuration are copied to `dist`; no local development server is needed in production. Internal navigation uses the existing single document, and auth returns to `/` or `/index.html` with query parameters. No catch-all SPA rewrite or new framework is needed.

The build rejects privileged keys and serializes only the validated public URL/key, discarding unrelated configuration. SQL, tests, scripts, `.env`, and dependency folders are not part of the public output.

## What remains a live acceptance check

The browser suite uses the actual app and Supabase SDK with test-only Auth/PostgREST transport backed by PostgreSQL/RLS. Required origin tests serve local app assets under simulated origins; they do not validate deployed DNS, Google consent, real email delivery or Vercel dashboards.

After running SQL and deploying, verify a real signup, login, Google return, reset email, refresh, cross-device persistence and a second account's isolation. Confirm Personal and Business records remain separate. Password recovery links must be opened in the requesting browser/origin with this client-side PKCE setup.

Concurrent edits remain last-write-wins, and there is no immutable accounting audit log or full accounting-profit calculation. These are existing V1 limits; authorization is enforced by RLS and composite foreign keys rather than UI filtering alone.

## Authentication and social-sharing update

The redirect implementation was already correct and was preserved. Regression tests now verify the actual Google, signup email and recovery SDK arguments on each of the five requested origins, including malicious redirect query parameters. Remaining loopback references are approved development origins, local server configuration, diagnostics or tests; no production-to-localhost destination was found.

`index.html` includes the canonical public URL, product description, complete Open Graph tags and Twitter large-image card tags. `assets/nectarspend-social.png` exists at 1200 × 630 and is copied unchanged to `dist/assets/nectarspend-social.png` by the existing asset build. To regenerate the card with local Chrome and the installed Playwright dependency, run `node scripts/social-preview.cjs`.

Redeploy Vercel to publish the updated HTML and image. Dashboard URL settings must be verified separately; they are not changed by a deployment. Social platforms may cache older previews and may need their preview cache refreshed after deployment. No live production OAuth flow or dashboard configuration was tested for this update.

**Update validation:** `npm test`: **49 passed, 0 failed**. Existing browser regression suite: **1 passed, 0 failed, 0 page errors**, including all five required origins with local test transport. `npm run build`: **passed**, with the social image included. JavaScript syntax checks: **24 files passed**.

## Previous continuation result and changed files

Already complete before this continuation: the NectarSpend rebrand, existing paper UI, Supabase authentication, workspace onboarding/switching, personal/business records, goals, editing/deletion, savings calculations and summaries. These were preserved.

This continuation repaired the canonical timestamp-helper dependency, confirmed the hosted missing-schema error through zero-row probes, audited query projections/RPC arguments against the authoritative migration, added safe error categories/development diagnostics, restricted callback origins, handled unexpected signup-without-session responses without a confirmation requirement, and fixed wrapping of longer currency labels. No tables/RPCs were replaced, and no live data was modified.

**Validation:** `npm test`: **42 passed, 0 failed**. Browser regression suite: **1 passed, 0 failed, 0 page errors**, including seven widths and all five required origins served through local test transport. `npm run build`: **passed**. `node --check`: **22 JavaScript files passed**. Local server startup/asset responses: **passed**. No separate lint script is configured. The production bundle contains only static assets and validated public configuration.

**Created:** `js/errors.js`, `scripts/diagnose-supabase.cjs`, `tests/errors.test.cjs`, `tests/origins.test.cjs`, `DEPLOYMENT.md`.

**Modified:** `supabase/schema.sql`, `supabase/migrations/002_workspaces.sql`, `js/app.js`, `js/backend.js`, `js/data.js`, `index.html`, `css/style.css`, `README.md`, and `tests/backend.test.cjs`, `tests/browser.cjs`, `tests/build.test.cjs`, `tests/data.test.cjs`, `tests/schema.test.cjs`, `tests/supabase-fixture.cjs`.

The repository audit reviewed remaining legacy product identifiers, loopback origins, service-role references, demo/sample references and the retired RPC. Remaining matches are compatibility database/config names, negative test fixtures, development/redirect documentation, unused legacy CSS selectors, or unchanged third-party vendor code. No real public configuration key appears in tracked source; the only secret-key-shaped match is a deliberately invalid test fixture. `config.js` is ignored and untracked. No financial localStorage persistence or cross-workspace aggregation was introduced.

**Hosted status:** migration 002 is still a manual operator step; it was not applied remotely. Hosted authenticated CRUD, real Google consent, email delivery, production DNS and dashboard configuration were not tested. The zero-row schema probe is the only live Supabase API check performed. Local tests cannot replace post-migration live acceptance.

## PWA and branding update

Auth uses the exact approved current origin and now always returns to the root path, including when started at `/index.html`. Google and signup use `/?auth=callback`; recovery retains `/?auth=recovery` for the existing recovery screen. No query-string destination is accepted. The same-origin logic was already correct; the root-path normalization is the only auth change.

Keep Supabase **Site URL** set to `https://nectarspend.com` and these **Redirect URLs**:

```text
http://127.0.0.1:5500/**
http://localhost:5500/**
https://nectarspend.vercel.app/**
https://nectarspend.com/**
https://www.nectarspend.com/**
```

Leave the Supabase Google provider callback URL unchanged. Add test ports 4173/4174 only if using live auth there.

The supplied `assets/nectarspend-logo.png` produces `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` (180), and `favicon.png` (32), preserving its square proportions and existing safe padding. `scripts/generate-icons.ps1` regenerates these using Windows System.Drawing. The visible mark fits inside the maskable safe circle. The supplied flyer is preserved as `assets/nectarspend-social-original.png`; the production `assets/nectarspend-social.png` is proportionally fitted to 1200x630 to match the existing OG/Twitter metadata. Canonical remains `https://nectarspend.com/`.

`manifest.webmanifest` uses name/short name NectarSpend, description Know your money., root start URL/scope/id, standalone display, paper background/theme #f3efe6, and same-origin 192/512 PNG icons with any/maskable purposes.

`sw.js` precaches an explicit list of public shell files. Fetches use network first and fall back to the installed shell only on network failure. No runtime response is written to Cache Storage. Cross-origin requests, non-GET requests, authorization headers, query strings, API routes and config.js are bypassed. Supabase data stays online-only; offline opening offers the static UI, not offline balances, records or mutations. Existing SDK session handling is unchanged. Activation removes only older NectarSpend shell caches. Increment the cache version when changing shell assets. Updates wait until old controlled tabs close; no forced reload interrupts an active financial operation.

The paper install card uses the browser's saved beforeinstallprompt event after an explicit Install click. It is hidden without support or in standalone mode and removed after appinstalled. Not now and native prompt dismissal suppress it for seven days; blocked local storage still allows session dismissal. No simulated iOS installation is offered.

Build with `npm.cmd run build` on Windows (or `npm run build` elsewhere). The build includes the manifest, worker, PWA script and branding images. Vercel serves the worker with no-cache and manifest with application/manifest+json. Redeploy to publish these changes, then verify HTTP 200 and JSON content at:

- https://nectarspend.vercel.app/manifest.webmanifest
- https://nectarspend.com/manifest.webmanifest

Also verify `/sw.js`, icons and the social image. Use browser Application tools to inspect the manifest, worker and maskable icon. Test real Google/email/recovery flows separately on each configured origin, and installation on a supported device. Automated prompt events exercise the UI only, not real OS installation. Social platforms may require their preview caches to refresh after deployment.

Run `npm test`, `npm run build`, `npm run test:browser`, and `node tests/pwa-browser.cjs`. The browser scripts need the local server on port 4174. The PWA browser test checks actual service-worker registration, safe cached URLs and an offline shell; install events are simulated. Its screenshots are saved under `tests/artifacts/`.
