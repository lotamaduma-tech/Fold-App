# NectarSpend security hardening audit — 29 September 2026

Scope: current vanilla client, build/server configuration, Supabase schema/migrations and deletion function; locked dependencies; local configuration/environment categories; current source/build and reachable Git-history text blobs. No production account was created, no real financial data read/deleted and no migration or function deployed. Tests use two synthetic accounts and actual PostgreSQL via PGlite plus fixture Auth/REST transports. This is not a claim that all vulnerabilities have been found.

## Findings and targeted fixes

| Severity | Finding | Verified protection / remaining limit |
| --- | --- | --- |
| Medium | No CSP, leaving no browser-level containment for a future injection/supply-chain error | Added CSP: same-origin scripts, no inline script/event handlers or eval, no objects/frames/base changes, same-origin form submissions, limited connections/fonts/images. Existing escaped templates retained. Browser enforcement tests distinguish blocked probes from normal flows. This was a missing layer, not proof of an existing XSS exploit. |
| Medium | Deletion endpoint had no application-level per-account throttle | Added atomic PostgreSQL-backed limit of 3 verified-user deletion attempts per 15 minutes. Fourth and later attempts return 429. Missing migration/limiter failure returns 503 without deleting. This does not stop request traffic or Auth-verification costs before the limiter; gateway/project controls remain necessary. |
| Medium | Unbounded JSON parsing on custom deletion endpoint | 1 KiB body limit enforced by streamed byte count, not just a client Content-Length; 5-second body-read cancellation, bounded bearer header and 15-second provider timeout. Oversized requests are rejected before Auth verification. |
| Low | Local development origins were always allowed by deployed deletion CORS | Production permits only apex, www and nectarspend.vercel.app. Loopback origins require server-only NECTARSPEND_ENV=development. Origin is never authentication: bearer tokens are verified even when Origin is absent. |
| Low | Build copied hidden/arbitrary files placed in static directories | Hidden files and non-browser extensions are now excluded; tests place a fake assets/.env and private JSON and confirm neither is published. Public Supabase config still passes explicit credential validation. |
| Low | A loopback HTTP Supabase URL was accepted even when the app runs over HTTPS | HTTPS clients and Vercel/production builds now reject HTTP Supabase endpoints. Development over HTTP remains supported. |
| Low | No explicit HSTS or browser capability restrictions in checked-in deployment config | Added one-year HSTS on Vercel HTTPS, no preload/includeSubDomains assumption, and Permissions-Policy disabling camera/mic/location/payment/USB. Existing nosniff, no-referrer and DENY frame protection retained. |
| Low | History search had no length bound | Added 120-character DOM and JavaScript bound; search stays local, literal and escaped. No SQL/regex execution is derived from search input. |

No confirmed Critical/High vulnerability, exposed client-side private key, current stored XSS, RLS bypass or cross-user IDOR was found in this tested scope. Do not interpret absence of findings as assurance about production settings or all possible exploits.

## Secrets and dependencies

`scripts/audit-secrets.cjs` scans non-binary working-tree source/build and reachable historical text blobs, reporting only location/category. 139 historical blobs were examined in the initial scan. The only credential finding was a private Supabase key in ignored `.env` under SUPABASE_SECRET_KEY. That file is not tracked, has no commits at its path, is not served and is not included in dist. It also contains the public URL/key and JWKS URL. No relevant Supabase/database/secret variable was present in the shell environment at audit time. No secret value was printed or used. The public key in config.js is allowed; private/legacy service-role keys are rejected by validation and output tests.

**Rotation:** no credential was proven exposed in tracked history or browser output, so no mandatory rotation is established by these checks. Protect the private .env key, including any synced copies/backups; rotate/revoke it through Supabase if it was shared, logged, committed elsewhere or exposed outside trusted storage. A pattern scan cannot detect every secret format or prove a workstation is uncompromised. It does not examine unreachable Git objects, remote provider settings or third-party systems.

`npm audit --json` successfully queried npm on 29 September 2026: 0 critical/high/moderate/low/info vulnerabilities across the locked graph (12 total dependencies reported). No blind upgrades made. Supabase JS 2.112.4 is used at runtime; Playwright 1.63.0 and PGlite 0.5.8 are used in tests/tooling. The copied Supabase bundle is checked against the locked package. Vendored Lucide identifies itself as 0.468.0 and is outside npm's locked graph; its upstream security page reported no published advisories. This is not an integrity attestation or a guarantee of no vulnerabilities. Keep a provenance/update process for that separate vendored asset.

## Authorization, authentication and database review

profiles, transactions, goals and workspaces retain ENABLE/FORCE RLS with owner USING and WITH CHECK expressions based on auth.uid(). Permissive owner policies are accompanied by restrictive owner guards. User IDs in repository filters are not the security boundary. Composite foreign keys and invoker triggers prevent cross-owner/cross-workspace goal links. SQL functions use empty search paths, parameter values and invoker rights; onboarding verifies the expected ID against auth.uid(). No user-input raw SQL is constructed in application code. Fixture/test SQL uses controlled identifiers and parameter values.

Expanded abuse test: while authenticated as B, known IDs belonging to A cannot select/update/delete A's profile, transactions, goals or workspaces; forged owner inserts fail; onboarding RPCs reject A's ID/workspace. SELECT/UPDATE/DELETE protected by RLS normally return zero rows rather than necessarily raising HTTP errors. Tests also preserve another account during deletion and reject ownership transfers. No financial-table RLS policy needed changing.

SDK sessions are restored using supported Supabase APIs, and getUser verifies identity before activating/loading data. State epochs prevent old asynchronous responses reappearing after account changes; logout clears page memory/forms and cross-tab sign-out is tested. The SDK owns token persistence; no passwords or financial-record database are manually saved in localStorage. Supported session/PKCE keys, workspace preference and install dismissal remain as documented in COMPLIANCE.md. Offline caching is limited to public assets and bypasses queries, Auth/REST/functions/config and authenticated requests.

Callback destinations still use the approved current origin, never redirect/next/query inputs. Signup, Google and recovery paths retain their existing destinations. Production OAuth/email delivery is not tested by fixture flows.

## Inputs, XSS and errors

Amounts, cent precision, dates, categories, savings semantics, goal limits and profile/workspace fields are validated in JavaScript and/or constrained in SQL; tests include NaN, Infinity, negatives, malformed dates, unknown categories and cross-workspace references. UUIDs are database-typed. Free-text lengths are bounded. Renderers use escaped text/attributes inside fixed templates; no untrusted raw HTML, dynamic script creation, eval or Function constructor was found in first-party production code. Test-only CSP probes intentionally attempt execution and are not shipped. Existing innerHTML rendering is retained to avoid a broad rewrite; future templates must escape every untrusted string. Toast/errors use safe text handling. Provider errors are mapped to safe categories; localhost-only diagnostics omit tokens, payloads and financial notes.

CSP allows inline **styles** because existing progress bars and responsive numeric sizing use style attributes; it does not allow inline **scripts** or unsafe-eval. Supabase connections permit HTTPS/WSS *.supabase.co plus same-origin; custom Supabase domains require an explicit reviewed CSP adjustment. Google Fonts CSS/font origins remain allowed. Normal Google OAuth is top-level navigation, not iframe embedding. CSP is defense in depth, not a replacement for escaping, and the Supabase-domain wildcard is broader than pinning a single project.

## Custom endpoint, rate-limit migration and CSRF

Apply `supabase/migrations/003_delete_rate_limit.sql` **before** deploying the updated delete-account function. The migration creates nectar_private.account_delete_limits and public.nectar_consume_delete_attempt(uuid). The table has RLS enabled/forced and no browser-role policies/grants. Only service_role receives schema/table access and RPC execution; function is security invoker with an empty search path. The service-role client supplies the live Auth-verified user ID, not a request-body ID. Table stores only ID, count and expiry; foreign-key cascade removes it on account deletion. Expired entries are removed on subsequent limiter calls; expiry is not a promise of background physical deletion exactly at 15 minutes. Migration is transactional/rerunnable and tested twice.

Production must leave NECTARSPEND_ENV unset (or set to production). Set development only in a separate local/test function environment when loopback CORS is needed. Never expose SUPABASE_SERVICE_ROLE_KEY in Vercel public config. Existing function gateway verify_jwt=false relies on mandatory live getUser verification in the handler; CORS is not an alternative to this. No Origin header still requires a valid bearer token. No cookie credential is accepted, and state-changing calls require POST JSON plus Authorization. A separate CSRF-token framework is unnecessary for this bearer-only endpoint. Tests cover missing/expired/anonymous tokens, arbitrary body IDs, origin, method and MIME rejection.

Verified-session compromise could still authorize deletion: typed DELETE is an accident-prevention step, not fresh reauthentication. Consider a separate recent-login/step-up policy if warranted. Deletion throttling does not protect all Auth/REST usage. Supabase Auth has provider rate limits; review actual project settings, email/SMS limits, password policy, anonymous signup and CAPTCHA support before launch. Do not enable CAPTCHA in the dashboard until the client can provide the required token. Review gateway/WAF/budget controls for unauthenticated traffic; a per-isolate memory counter would not provide a distributed guarantee. There are no AI/paid API endpoints today. Future such features need authenticated server-only keys, shared quotas, request limits and cost ceilings before release.

No upload feature/bucket policy is present. Future uploads need private buckets, owner RLS, allowed content types, independent size/type validation, safe generated object paths and deletion handling before being enabled.

## Production and validation limits

Vercel must be redeployed to publish the headers/client/build changes. The local test server emits the same CSP/permissions/frame headers but omits HTTPS-only HSTS and upgrade-insecure-requests. HTTP-to-HTTPS redirect behaviour, production header delivery, live RLS/schema/grants, service-role environment, Auth settings, deployed rate limits and real OAuth need post-deployment verification. No live production vulnerability is claimed fixed based solely on local tests.

The user confirmed that existing uncommitted removals of PWA links/registration/install UI and legal footer in index.html, plus the changed social image, must be preserved. Those files were not changed by this audit. Baseline npm test already failed its legal-footer assertion (62/63 passed). That assertion remains intact; do not weaken it to hide the difference. The PWA script cannot register from the current entry point; its browser installation test is not evidence of an enabled PWA. Service-worker cache version advanced to v3 for existing installations/future re-enabling.

## Sources

- [Supabase Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits)
- [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
- [Supabase distributed Edge Function rate limits](https://supabase.com/docs/guides/functions/examples/rate-limiting)
- [MDN Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy)
- [Lucide upstream security advisories](https://github.com/lucide-icons/lucide/security)

## Final local results

- npm test: **74 total, 73 passed, 1 failed**. The failure is the unchanged pre-existing compliance assertion requiring legal footer links in index.html; preserving the user's intentional removal is the stated requirement. No assertion was disabled or weakened.
- npm run test:browser against a fresh server on 5500: **passed**, no page errors, including seven viewport widths and five approved callback origins under fixture Auth.
- node tests/security-browser.cjs: **15 assertions passed**. Stored malicious strings in profile/workspace/goal/record fields stayed text; inline script, event attributes, eval and unapproved fetches were blocked by the actual CSP; normal app flow had no CSP violation; logout removed sensitive displayed data.
- node --test tests/compliance-build.cjs: **1 passed, 0 failed** after the production build; no privileged credential pattern or server-function source in browser output.
- npm run build: **passed**. JavaScript/module syntax checks and git diff --check: **passed**.
- npm audit: **0 reported vulnerabilities**. Secret scan found only the ignored .env private key described above.

Run the security browser tests with `NECTARSPEND_TEST_URL=http://127.0.0.1:5500` after starting `serve.cjs` with PORT=5500 (PowerShell uses `$env:NAME='value'`; npm.cmd avoids local script-policy restrictions). The rate-limit migration tests use a separate test-only PostgreSQL instance and do not modify Supabase.

Files created: SECURITY.md, scripts/audit-secrets.cjs, supabase/migrations/003_delete_rate_limit.sql, tests/hardening.test.cjs, tests/rate-limit.test.cjs, tests/security-browser.cjs.

Files modified by this audit: vercel.json, serve.cjs, scripts/build.cjs, js/backend.js, js/app.js, supabase/functions/delete-account/handler.mjs, supabase/functions/delete-account/index.ts, sw.js, COMPLIANCE.md, tests/build.test.cjs, tests/compliance.test.cjs, tests/compliance-browser.cjs, tests/pwa-browser.cjs, tests/schema.test.cjs. User-owned index.html/social-image/other asset edits were preserved.

Final additional check: `node tests/compliance-browser.cjs` passed **23 assertions** under the hardened local headers, including deletion cancellation, failure and successful fixture-backed server deletion. The function's Deno deployment wrapper was not executed in a hosted Edge runtime. End-to-end distributed rate-limit behaviour in the deployed service remains a staging verification item; handler rejection and database persistence/permissions were verified locally.
