# NectarSpend compliance readiness — 28 September 2026

This is a technical audit and pre-launch checklist, not certification, licensing, legal advice or a declaration of compliance. The legal pages remain clearly marked drafts. Product policy is 18+ as instructed by the owner; this does not verify anyone's age or guarantee compliance.

## Launch blockers and checklist

- [ ] Owner/legal review of Privacy Policy, Terms and Financial & Service Disclaimer.
- [ ] Complete [LEGAL NAME / OPERATOR NAME], [SUPPORT EMAIL], [PRIVACY EMAIL]. Establish monitored channels and test delivery. No messages have been sent and no addresses have been invented.
- [ ] Complete [BUSINESS ADDRESS IF APPLICABLE], or remove it after reviewing applicable identification obligations. No company registration, DPO or entity is asserted.
- [ ] Complete [OWNER-APPROVED EFFECTIVE DATE — NOT YET IN FORCE]. Last updated/version reflects implementation on 28 September 2026.
- [ ] Complete [GOVERNING LAW AND DISPUTE PROCESS — LEGAL REVIEW REQUIRED]. Preserve statutory consumer rights.
- [ ] Complete [PROCESSING LOCATIONS AND TRANSFER SAFEGUARDS — OWNER TO VERIFY]. Check actual project region, subprocessors, contracts and appropriate international-transfer basis.
- [ ] Complete [RETENTION PERIODS AND BACKUP DELETION SCHEDULE]. No numerical retention promise is invented.
- [x] Static legal pages, signup acknowledgement and persistent/settings links implemented.
- [x] Record, goal, profile-name/settings edits and logout exist; financial records remain authoritative in Supabase.
- [x] Authenticated server-side deletion code implemented with a server-only rate-limit migration and no browser privileged credentials.
- [ ] Deploy and test the deletion function in staging with two disposable users before production. Confirm all active records disappear only for the requesting user, expired sessions are rejected and other tabs lose access.
- [ ] Verify deployed RLS/schema matches the tested repository, including restrictive ownership policies and existing ON DELETE CASCADE references.
- [ ] Verify production Google OAuth, signup and recovery on every approved origin.
- [ ] Review lawful bases: service contract for requested features; legitimate-interest assessment for security; actual legal duties where relevant; separate consent only where necessary. No blanket consent is inferred from acknowledgement.
- [ ] Review 18+ wording and practical handling of suspected underage accounts; no DOB, fake verification or parental flow is implemented. Reassess safeguards and lawful processing before ever supporting minors.
- [ ] Determine NDPC registration/filing, audit-return, DPO and DPIA applicability using final processing, risk, business/user scale and current official guidance. No registration/certification is claimed.
- [ ] Adopt and rehearse the incident and privacy-request procedures below; assign accountable staff.
- [ ] Verify hosting dashboards: logging/retention, access permissions, optional analytics/integrations, backups and provider security settings cannot be inferred from source.
- [ ] Obtain Nigerian legal professional review before launch.

## Data inventory, flows and minimisation

Browser -> Supabase Auth: email/password for email sign-in, optional Google identity, sessions and PKCE. Passwords are not put into app local storage; SDK session credentials are. Auth user metadata can include Google name, email, avatar URL and provider identity; profile initialization uses name. Browser -> Supabase PostgREST: user-owned profiles, Personal/Business workspaces, transactions and goals, scoped by owner/workspace and enforced by RLS. Supabase -> browser memory: records used for rendering/search/calculation. Browser -> Vercel: static requests, IP/request metadata and possible operational logs. Browser -> Google Fonts: CSS/font requests even without OAuth. Google OAuth uses Google's sign-in service. No payment, bank connection, analytics, advertising pixel, fingerprinting or marketing-cookie integration was found in first-party source. No checkout/pricing/subscription feature was found.

Personal data includes account email/name/ID and authentication metadata; amounts, dates, categories, notes, savings allocations, goals/targets; workspace names/types/currency/caps/starting balances; onboarding and created/updated timestamps; selected workspace ID; provider request/security metadata. Business notes can accidentally contain third-party personal information; minimise this and avoid sensitive details. The app does not need DOB, identity documents or bank credentials and does not collect them.

Potentially unnecessary disclosures/collection to review (not silently removed): Google Fonts creates an avoidable third-party request; consider licensed self-hosted fonts separately. OAuth avatar/provider metadata may be stored by Auth though the app only uses name/email. Legacy profile-level currency/starting-balance/cap fields remain for compatibility with the existing migration; do not drop them without a separate migration audit. Free-text notes can contain more personal information than needed. No automatic retention expiry currently exists.

## Browser storage inventory

| Key/category | Purpose and lifetime |
| --- | --- |
| `sb-<project-ref>-auth-token` | Supabase SDK local-storage session/access/refresh credentials and user metadata; persisted until SDK sign-out/removal or invalidation. Never a financial ledger. |
| `sb-<project-ref>-auth-token-code-verifier` | SDK legacy PKCE verifier for sign-in/recovery. |
| `sb-<project-ref>-auth-token-flow-<flowId>-code-verifier` | SDK per-flow verifier; cleared on completion/SDK cleanup. |
| `sb-<project-ref>-auth-token-flows-code-verifier` | SDK index for pending PKCE flows/cleanup. |
| `sb-<project-ref>-auth-token-user` | SDK compatibility/separate-user-storage category; custom userStorage is not configured here, so not normally a separate app-created key. |
| `lswt-<random>` | SDK transient local-storage writability probe, immediately removed. |
| `nectarspend-workspace:<userId>` | Last selected workspace ID only; survives logout, removed for the deleted account on this device. Clearing site storage removes it. |
| `nectarspend-install-dismissed` | Timestamp suppressing installation UI for seven days; key may remain until site data is cleared. |
| `nectarspend-shell-v3` Cache Storage | Public static shell/legal pages/icons; older app caches removed during activation. No financial/API/config/auth-response cache. |
| Normal browser HTTP cache | Public site assets and fonts subject to response headers/browser settings. |

No first-party `document.cookie`, sessionStorage, IndexedDB financial database or optional tracking storage was found. Provider-domain cookies or dashboard-added tracking must be checked in production; this audit does not promise that third parties use no cookies. Use the clear privacy/storage notice, not an unnecessary marketing-consent banner. SDK uses BroadcastChannel/Web Locks for session coordination; these are not financial storage.

## Security review

Existing allowlisted same-origin callbacks ignore query-string destinations. User text rendered into HTML is escaped; fixed legal content is static. Repository queries scope writes/reads by owner and workspace. SQL enables and forces RLS with restrictive ownership guards; tests cover cross-user access and cross-workspace goal references. Diagnostic logs are development-only safe status/context; no record/token logging was found in first-party source. Current tracked-text scan checks privileged JWTs, long secret-key patterns, private keys and database-password URLs without printing values. Public config.js is tracked and contains only browser-public configuration validated by the build; .env is ignored and excluded from publishing. Vendor SDK API identifiers such as service_role are not embedded credentials. A source scan is not a complete audit of git history, provider dashboards, machines or leaked credentials elsewhere.

Remaining operational risks: active session tokens in localStorage depend on XSS/device protection; secure owner/admin access and patch dependencies. Deletion uses a verified live bearer session plus explicit typed confirmation, not a new password challenge. Assess whether fresh reauthentication is needed. A compromised session could exercise the user's controls. No CSP has been introduced without compatibility testing. Production access logs may capture callback request URLs; review redaction, access and retention. Do not add sensitive logs when deploying functions.

## Deletion deployment and retention runbook

`supabase/functions/delete-account/index.ts` uses the server environment's SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY only. It calls the independently tested handler in handler.mjs. Deploy with `supabase functions deploy delete-account`; the checked-in function config disables gateway legacy JWT verification because the handler itself always validates the supplied token with Auth getUser. Do not remove that verification. Admin deletion takes only the verified user ID; body IDs are rejected. The 29 September hardening pass adds migration 003_delete_rate_limit.sql and a service-role-only rate-limit RPC. Apply it before deploying the updated function; no financial-table policy change is needed. No browser service-role key is used. The function is never copied into dist or served by the local static server.

Deletion hard-deletes Auth and uses existing database cascades for profile, workspaces, goals and transactions. Test the exact deployed schema before enabling publicly. User presses Delete account, reads consequences, types DELETE and submits. Failure/unavailable function leaves UI in place with an explicit unconfirmed-deletion error; no fake local deletion. On confirmed success the app clears its in-memory data, requests local SDK sign-out and removes this user's workspace preference. Other devices may retain already-rendered memory/session metadata until refresh/sign-out, but must not regain deleted server data. Verify token revocation behaviour in staging. Google accounts/provider records are not deleted by this operation.

Retain active records only for service purposes until user deletion/account deletion for now; set an inactivity policy. Owner must establish finite support/security-log retention and actual provider backup expiry, restoration controls that reapply erasures, and handling of valid legal preservation duties. Deletion is not guaranteed instantaneous backup erasure. If later adding uploads/storage, deletion must explicitly handle owned objects too. No storage buckets/uploads are used by this app today.

Privacy requests: establish a monitored address, record receipt/type/deadline, verify identity with minimal data, scope exports/changes to the requesting account, explain any lawful refusal/retention, respond within applicable deadlines and retain only a minimal request audit. Do not ask for passwords or sign-in codes. Full export and email correction currently require operator support. Until contacts are filled, support routes are not operational: launch blocker.

Incident procedure: assign an incident owner and restricted reporting channel; triage and contain access, preserve minimal evidence securely, revoke compromised credentials/sessions, determine data/people affected, assess notification duties and timing with counsel/NDPC guidance, communicate accurately, restore safely and document remediation. Do not promise a response time or claim this procedure has been rehearsed. No breach reporting has been sent.

## Sources reviewed and limits

- [NDPC: Nigeria Data Protection Act 2023](https://www.ndpc.gov.ng/ndp-act-2023/)
- [NDPC: 2025 implementation directive](https://ndpc.gov.ng/wp-content/uploads/2025/03/NDP-ACT-GAID-2025-MARCH-20TH.pdf)
- [NDPC: rights and complaints information](https://www.ndpc.gov.ng/)
- [Supabase: server-only admin deletion](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser)
- [Supabase: Edge Function authentication](https://supabase.com/docs/guides/functions/auth)

These sources inform review topics, not a conclusion about registration duties or compliance. Production contracts, transfers, backups, OAuth, provider cookies, admin settings and deployed deletion have not been verified. Source legal text is maintained in scripts/create-legal.cjs; regenerate the static HTML with node scripts/create-legal.cjs after edits. Rebuild and redeploy Vercel for legal pages/UI/SW changes, and separately deploy the Supabase function.

## Verification and remaining disclosure limits

At this implementation pass, the standard suite passed 63/63 tests (including destructive cascade isolation on the test database), and the built-output security/assets check passed 1/1. The compliance browser suite passed 23 assertions: static legal text without JavaScript, keyboard access, signup/settings links, cancellation, failed deletion, successful deletion through the tested handler and PostgreSQL, and preservation of another account. This uses fixture authentication, not production Supabase. JavaScript syntax checks passed; the Deno deployment wrapper has not been executed in a deployed Edge runtime. Run `node --test tests/compliance-build.cjs` after `npm run build`, and `node tests/compliance-browser.cjs` with a fresh local server on 4173 (or NECTARSPEND_TEST_URL). Screenshots are under tests/artifacts.

Legal drafts describe implemented behaviour and explicitly qualify missing deployment/operational information. Contacts are not yet usable; provider retention, transfer safeguards and incident handling are proposed/pending owner verification. There is no terms-version acceptance audit record; signup wording is visible but does not establish a legal evidentiary system. Review whether one is needed without unnecessarily collecting data. The social flyer depicts sample figures labelled Total Balance and a percentage trend; review the illustration before public marketing so these are not mistaken for live account balances or guaranteed performance. The app itself calls its totals calculated/recorded balances and says no money is held.

The existing browser suite passed on its isolated rerun with no page errors (record CRUD, savings/goals, workspace isolation, business summaries, seven widths, failure recovery, signup/onboarding, PKCE/recovery, two accounts, cross-tab logout and all five origins). Its first concurrent run timed out performing an Add record click; no assertions were weakened. The local-server checks were expanded for all three legal pages, legal CSS and denial of server-function source and passed 2/2 on rerun.


Security follow-up, 29 September 2026: see SECURITY.md for the hardened headers, production-only CORS, bounded request parsing and distributed deletion-attempt limit. A small server-only table stores user ID/count/expiry for rate limiting, cleaned on later calls after expiry or on account deletion. The user has intentionally removed PWA registration/install UI and the persistent legal footer from index.html; earlier implementation checks describe the previous entry point. Signup/settings links and static legal pages remain. Production deployment and review remain unverified.
