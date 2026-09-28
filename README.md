# NectarSpend

**Know your money.**

A mobile-first personal and small-business record keeper, built on the existing HTML/CSS/vanilla JavaScript application. Users manually record activity that happened elsewhere. NectarSpend does not hold or move money.

## Upgrade the existing Supabase project

Your existing public configuration and Supabase authentication are preserved. **Keep email confirmation disabled**, as configured: signup with a session goes directly to onboarding. Google, persistent sessions, logout and password recovery still use the official Supabase SDK.

1. Back up the existing database before deploying a schema change.
2. In the existing project's SQL Editor, run **`supabase/migrations/002_workspaces.sql`** as the project owner. Do not rerun the base schema as a substitute for this upgrade. The migration runs transactionally and was tested on the included original schema, including rerunning it.
3. Deploy the updated frontend after that migration succeeds. Refresh any already-open app tabs.

For a completely new project only, run `supabase/schema.sql` first, then `supabase/migrations/002_workspaces.sql`. PostgreSQL 15+ is required for column-specific foreign-key unlinking.

The upgrade retains `profiles`, `goals` and `transactions`; it does not rename or recreate those tables. It adds `workspaces`, assigns existing records/goals to a Personal workspace, copies that user's currency/budget/setup state, and preserves IDs, amounts, dates and goal associations. Historical `saved` entries remain income marked as savings, preserving their original balance/progress effect. No sample records are inserted. The old sample-replacement RPC is removed. Legacy SQL object names and an old configuration-global fallback remain solely for compatibility.

## Use the app

New accounts choose **Personal, Business or Both**, then set each workspace's currency, starting balance and optional personal spending cap. Existing accounts keep their Personal records and can add a business through the workspace switcher. More named workspaces can be added later; their type is fixed to protect record semantics.

- **Personal:** Home / Activity / Goals / You. Record income and expenses, mark income as savings, or allocate existing balance to savings. Create targets and link savings to goals. Deleting a goal keeps its records and unlinks them.
- **Business:** Home / Activity / Records / You. Record sales, funding and loans separately from stock, operating costs, owner draws and loan repayments. There are no personal savings goals in a business workspace.
- **Activity:** search notes/categories/amounts; filter by type, category or date range; edit or delete records. Changes are saved to Supabase before updating the UI.
- **Summaries:** calendar weeks (Monday–Sunday) or months, cash in/out, difference, record count and expense categories. Personal also shows recorded savings. Empty periods do not invent insights.

### Calculation rules

`Calculated balance = starting balance + recorded income − recorded expenses`.

Savings from **new income** count once as income and are also tagged as savings. A savings allocation from **existing balance** affects savings/goal progress only; it does not increase or decrease total balance. Savings totals are recorded allocations, not a separate cash account or available-to-spend guarantee. Editing/deleting records recalculates totals.

Business summaries distinguish all cash movements from sales revenue. **Simple operating result = recorded Sales − Delivery/Rent/Utilities/Wages/Other operating expenses.** It excludes stock purchases, owner funding/draws and loans/repayments; it also lacks tax, cost of goods sold and unrecorded costs. The UI explicitly labels this as not accounting profit. Inventory, accrual accounting and full profit/loss reporting are deferred.

Amounts use integer-cent accumulation and `Intl.NumberFormat`. NGN is the default; USD, GBP, EUR, GHS and KES are supported. Changing workspace currency relabels numeric amounts; the form explicitly states that no currency conversion occurs. Different workspaces are never summed together.

## Run and build

```sh
npm ci
npm start
```

Open **http://127.0.0.1:4173/**. No framework or app compilation is required for local development. If that port is already in use, use another `PORT` and add its exact auth redirects if testing live authentication.

`config.js` remains gitignored. For a new checkout, copy `config.example.js` to `config.js` and supply the Supabase project URL and **public publishable key** (or legacy anon key). Never put a service-role key, secret key, database password or Google client secret in the frontend. Configuration validation rejects privileged keys.

```sh
npm run build
```

Creates `dist/` containing only `index.html`, browser scripts/styles/assets and public configuration. It reads `SUPABASE_URL` plus `SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_ANON_KEY`) from build environment variables, falling back to local `config.js`. It fails on missing/invalid configuration without printing keys. `dist/` is generated output and is replaced on each build. Tests, SQL, dependency folders and environment files are not published. `npm run vendor` refreshes the checked-in Supabase SDK from the pinned dependency.

## Vercel and authentication settings

`vercel.json` selects the static build command/output and sets no-sniff, anti-framing and no-referrer headers. In Vercel:

1. Import this existing project with the **Other** framework preset.
2. Set build environment variables `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` to this project's existing public values; apply to the intended deployment environments. Gitignored `config.js` will not be available in a Git deployment.
3. Build command is `npm run build`; output directory is `dist`. Redeploy after changing configuration. Do not deploy the repository root as static files.
4. In Supabase Auth URL Configuration, use the production HTTPS origin as Site URL and add exact redirects `https://YOUR_DOMAIN/?auth=callback` and `https://YOUR_DOMAIN/?auth=recovery`. For local use add `http://127.0.0.1:4173/?auth=callback` and `http://127.0.0.1:4173/?auth=recovery`. If using `/index.html`, also allow its callback/recovery equivalents.
5. Retain the working Email/password and Google provider settings. **Do not enable email confirmation for this requested flow.** Google client secrets belong only in Supabase provider settings. Google's allowed redirect is Supabase's provider callback (`https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`), not the application's callback.
6. Password reset still requires functioning Supabase recovery email delivery (configure SMTP as appropriate). Retain `{{ .ConfirmationURL }}` in the recovery template. With client-side PKCE, open the recovery link in the same browser/origin that requested it. Invalid/expired links fail closed. The profile password form also supports Supabase's reauthentication nonce when required.

No hosted migration, Vercel deployment, real Google consent or live email-delivery test was performed by the local regression suite. Apply the migration in your project, then verify a new signup, a returning Google login and a real reset email before release.

## Ownership, persistence and security

All four user-owned tables have enabled/forced RLS. Owner policies use `auth.uid()`, and restrictive owner guards prevent accidentally broad permissive policies from widening access. Anonymous financial-table privileges are revoked. Composite `(user_id, workspace_id)` foreign keys enforce workspace ownership; `(user_id, workspace_id, goal_id)` prevents cross-workspace goal links, even between two workspaces of the same user. Goal deletion atomically unlinks only `goal_id`.

The shared repository applies owner/workspace filters to reads, edits and deletes. PostgreSQL enforces ownership, allowed workspace/record types, categories, amounts, currencies and dates; frontend checks are additional validation. Onboarding RPCs are security-invoker, verify the expected authenticated owner, and initialize workspaces idempotently. Workspace type is immutable. There is no privileged frontend API.

The SDK manages persistent auth sessions and token refresh. Local financial state lives only in memory and comes from Supabase. The only app-specific localStorage value is a per-user selected workspace UUID; old demo storage is never loaded. Session changes clear UI/forms/state, and generation checks discard late responses after logout/account/workspace changes. Stable draft UUIDs make uncertain insert retries idempotent; pending forms block duplicate submissions. Failures retain input and display clean errors. Paging handles records beyond the API row limit.

Returning to a visible tab refreshes data when no modal is open. This is cross-device persistence, not continuous realtime collaboration. Concurrent edits to one record use the last successful write. RLS protects against other accounts, not against an authorized owner deliberately changing their own data. Financial records are not an immutable accounting audit log. Complete operator-specific terms/privacy information before public launch.

## Tests and live acceptance

```sh
npm test
```

Runs original ledger regressions, record engine/calculation/validation tests, SDK Auth/config tests, repository mapping/pagination/idempotency/scoping tests, original stylesheet preservation, static-server security, SDK bundle integrity, and the real SQL schema/migration in PGlite PostgreSQL. RLS tests use authenticated and anonymous roles, preserve historical data, exercise same-owner cross-workspace foreign keys, safe goal deletion, invalid data and Both onboarding.

For browser tests, start a separate server in one PowerShell terminal:

```powershell
$env:PORT = '4174'
node serve.cjs
```

Then run `npm run test:browser` in another. The suite uses installed Chrome on Windows; elsewhere install Playwright Chromium. Override with `NECTARSPEND_BROWSER_PATH` or `NECTARSPEND_TEST_URL` if needed. Browser tests use the real SDK with **test-only Auth/PostgREST transport backed by actual PostgreSQL/RLS**. They test signup, PKCE callbacks, recovery, reload persistence, record CRUD, savings allocations, workspace switching, Both onboarding, business summaries, failure/retry, two accounts/contexts, cross-tab logout and mobile/desktop widths. They do not contact your configured Supabase project or verify external providers. Screenshots go to `tests/artifacts/`.

After deployment, use two real accounts to verify isolation, create/edit/delete records in personal/business workspaces, reload on another browser, confirm goal deletion keeps records, and test live Google and recovery emails. A hosted SQL Editor uses privileged access; deployed RLS acceptance must use ordinary authenticated app sessions.

## Files and future work

- `js/backend.js`: preserved official Supabase authentication and public config validation.
- `js/data.js`: workspace-scoped persistence and mappings.
- `js/records.js`: shared personal/business record validation and calculations.
- `js/core.js`: existing dates, formatting, number words and compatible pure ledger helpers; test samples moved out of production.
- `js/app.js`, `css/style.css`, `index.html`: existing responsive paper interface extended for the new product/workspaces.
- `supabase/schema.sql`: base schema; `supabase/migrations/002_workspaces.sql`: additive upgrade.
- `scripts/build.cjs`, `vercel.json`: static deployment packaging/configuration; `serve.cjs`: restricted local server.
- `tests/`: unit, repository, SQL and browser regressions; sample fixtures exist only here.

Customers, money owed, inventory, recurring records, PDF/CSV export, notifications, workspace sharing and currency conversion are intentionally deferred. The workspace foreign keys and shared record module provide extension points without separate apps.

References: [Supabase Auth](https://supabase.com/docs/reference/javascript/auth-signup), [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow), [password recovery](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Vercel static configuration](https://vercel.com/docs/project-configuration/vercel-json).
