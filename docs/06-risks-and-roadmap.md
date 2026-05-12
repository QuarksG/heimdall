# 06 — Risks & Roadmap

Inventoried honestly. Items are grouped by severity. Each item cites the
code path, the concrete risk, and the proposed remediation. Reviewers
should assume anything not listed here as a risk is either handled or not
yet relevant.

## Severity key

- **P0** — blocks production deploy; correctness or security impact.
- **P1** — must land before broader rollout; operational risk.
- **P2** — quality-of-life or longer-term cleanup.

---

## P0 — Blocks production deploy

### P0-1 · Development CORS origin committed to backend

**Where:** `amplify/backend.ts` lines 28, 54;
`amplify/functions/terms-api/handler.ts` line 9.

**Issue:** `ALLOWED_ORIGIN` is set to `http://localhost:5173` in both the
Lambda environment and the HTTP API's `corsPreflight.allowOrigins`. A code
comment in the Lambda reads `// LOCAL TESTING — revert before commit`. If
this ships, the hosted Amplify frontend at
`https://main.d3p8snpek9jhao.amplifyapp.com` will fail CORS on every Terms
acceptance call.

**Effect:** New users cannot complete sign-up because they cannot record
Terms acceptance. Sign-in is unaffected.

**Remediation:** Restore the production origin in both files before
deploying. These changes are currently staged locally but not committed;
they should remain un-committed or be replaced with an environment-based
config (see P1-2).

### P0-2 · `preSignUp` does not verify the `acceptanceId`

**Where:** `amplify/auth/pre-sign-up/handler.ts` lines 17–25.

**Issue:** The trigger enforces that a non-empty `acceptanceId` exists in
client metadata, but never looks it up in the `TermsAcceptance` DDB table.
A client that never called the terms API could submit a fabricated UUID
string and be admitted.

**Effect:** The "audit trail" Heimdall claims to keep can be bypassed by a
technically motivated user.

**Remediation:** In `preSignUp`, perform `GetItem` against
`TermsAcceptance` for the provided `acceptanceId` and reject if absent or
if its `termsVersion` does not match. Grant the preSignUp Lambda read
access to the table. Keep the response time low by using a consistent read
path.

### P0-3 · Dev fallback can bypass terms acceptance in builds

**Where:** `src/features/authentication/components/DisclosurePage.tsx`
lines 407–423.

**Issue:** If the terms API call fails and the build mode is
`development`, the client writes `acceptanceId = "local-<uuid>"` to
session storage and proceeds to sign-up. Combined with P0-2, a dev-mode
build served anywhere would allow uncontrolled sign-up.

**Effect:** Any engineer running `npm run dev` against the real backend
can sign up without ever touching the terms service.

**Remediation:** Remove the dev fallback entirely, or gate it on a
stricter signal than Vite `MODE === "development"` (e.g. a runtime flag
set only for true local development environments).

---

## P1 — Must land before broader rollout

### P1-1 · MFA is off for a financial-data tool

**Where:** `amplify/auth/resource.ts`.

**Issue:** No MFA configuration. Users authenticate with email + password
only.

**Remediation:** Enable MFA (TOTP preferred) via `defineAuth` options;
require for Admin role at minimum.

### P1-2 · CORS origin hardcoded across environments

**Where:** same files as P0-1.

**Issue:** Even after fixing P0-1, the origin is a string literal in both
the CDK config and the Lambda. Adding a staging environment requires
duplicating this pattern.

**Remediation:** Source `ALLOWED_ORIGIN` from an environment variable
bound per Amplify branch/stack. Pass it as a CDK context value or resolve
via `backend.<resource>.addEnvironment`.

### P1-3 · Broad IAM policy on `preTokenGeneration`

**Where:** `amplify/backend.ts` lines 36–47.

**Issue:** The Lambda role is granted `GetItem`, `Query`, `Scan`,
`ListTables`, `DescribeTable` on `Resource: "*"`. Scan alone on all tables
is wider than needed.

**Remediation:** Once the Entitlement table name is known at deploy time
(Amplify exposes it), scope the policy to the Entitlement table ARN and
drop `Scan`, `ListTables`, `DescribeTable`. Today those are used only as a
fallback discovery path that should be eliminated in favor of an
`ENTITLEMENT_TABLE_NAME` env var wired at build time (Amplify supports
this pattern).

### P1-4 · Non-atomic approval in AdminPanel

**Where:**
`src/features/authentication/components/AdminPanel.tsx` lines 70–104.

**Issue:** Approving a request performs two separate AppSync mutations:
update `AccessRequest` status, then create `Entitlement`. If the second
fails the system is inconsistent — the request is APPROVED but the user
has no entitlement.

**Remediation:** Wrap both operations in a single Lambda or AppSync
resolver that uses a DynamoDB `TransactWriteItems` call. Alternatively,
reorder: create the Entitlement first, then update the status; if the
status update fails, the worst case is a user who has access but whose
request is still marked PENDING, which is self-healing.

### P1-5 · No observability

**Where:** entire backend; `docs/05-operations.md` covers the inventory.

**Issue:** No CloudWatch dashboards, alarms, log retention policy, or
client-side error telemetry.

**Remediation:** minimum viable set listed in `05-operations.md`. Highest
priority: log retention + a single alarm on Lambda `Errors`.

### P1-6 · Build error in the reconciliation region registry

**Where:** `src/features/payment-reconciliation/config/regions/index.ts`.

**Issue:** Three `tsc --noEmit` errors:

1. `./base/RegionConfig.interface` does not exist at that path. The
   `base/` folder is one level deeper, under
   `implementations/`.
2. The file imports `TurkeyConfig` but the actual export in
   `tr.config.ts` is `trRegionConfig`.
3. Re-exports `RegionConfig` from a non-existent module.

The runtime does not import this file (the UI hook instantiates
`TrOfaRemittanceProcessor` directly), so the bundle builds successfully.
The TypeScript errors are silent.

**Effect:** Future engineers who run `tsc` will see noise. Anyone
attempting to consume the registry (which looks like the intended path
forward for a multi-region recon) will find it non-functional.

**Remediation:** Either:
- Delete the registry file (and the `implementations/base/` nested folder)
  if the multi-region plan is not imminent.
- Or complete the refactor: move `base/RegionConfig.interface.ts` to
  `config/regions/base/`, rename the Turkey config export to
  `TurkeyConfig`, and migrate the recon hook to use
  `regionRegistry.getConfig("TR")`.

### P1-7 · Remaining Phosphor icon usages

**Where:**
- `src/features/authentication/guards/FeatureGate.tsx` line 47
  (`ph-lock-key`).
- `src/features/authentication/components/AdminPanel.tsx` line 231
  (`ph-arrows-clockwise`).
- `src/shared/components/layout/Home.tsx` lines 178, 220
  (`ph-*`, `ph-arrow-square-out`).

**Issue:** These `<i className="ph-bold ph-...">` tags require an external
Phosphor stylesheet to render. The stylesheet is not loaded anywhere in
the app (`index.html`, `main.tsx`, global CSS — none reference Phosphor).
As a result these icons render as empty `<i>` elements.

**Effect:** Cosmetic only. The affected pages look like they're missing
icons.

**Remediation:** Port these four call sites to the SVG icon set in
`src/assets/icons/`. `LockIcon` and `HomeIcon`'s siblings already cover
most of what's needed. This work is tracked in
`.kiro/specs/sidebar-icons/requirements.md` as PW-2.

---

## P2 — Longer-term cleanup

### P2-1 · Empty config files

**Where:** `src/config/app.config.ts`, `feature-flags.ts`,
`market.config.ts`.

All three files exist but are empty. If configuration is going to live
there, add it; otherwise delete. Mixed messages to future engineers.

### P2-2 · Empty `infrastructure/` subtree

**Where:** `src/infrastructure/api/`, `services/`, `storage/`.

All empty. Either populate with planned abstractions or remove.

### P2-3 · Bundle size

**Where:** `dist/assets/index-*.js` at 1.84 MB (568 KB gzipped).

Primary drivers: `xlsx`, `jszip`, `recharts`, `aws-amplify`. Use dynamic
imports for the features that need xlsx/jszip so the initial SPA load does
not pay for them. `react-bootstrap` and `bootstrap` both appear; one or
the other should probably go.

### P2-4 · Mixed UI libraries

`react-bootstrap`, `bootstrap`, `react-icons`, `lucide-react`,
`@aws-amplify/ui-react`, and raw Bootstrap CSS are all present. The
validators do inline styles, the auth pages have bespoke CSS, and the
admin panel uses bespoke CSS. Visual consistency will drift. Pick a
primary library (Bootstrap or a design-system-ish toolkit) and migrate.

### P2-5 · No test suite

There is no test runner configured (no Vitest, no Jest, no Playwright).
For a validator that is the core of a financial workflow, a small
snapshot + fixture-driven test suite against `validators/` would catch
regressions.

### P2-6 · `.DS_Store` committed in several directories

`src/.DS_Store`, `src/features/.DS_Store`,
`src/features/invoice-validation/.DS_Store`, and others. Add to
`.gitignore`.

### P2-7 · `AWSCLIV2.pkg` committed at repo root

A 20+ MB installer file. Remove; add to `.gitignore`.

---

## Roadmap

### Short term (next milestone)

1. Close P0-1, P0-2, P0-3.
2. Add MFA (P1-1) and log retention (subset of P1-5).
3. Fix the reconciliation build error (P1-6) and port the four Phosphor
   usages (P1-7).

### Medium term

4. Transactional approval (P1-4).
5. Observability v1: dashboard + error alarm + client error boundary
   (remainder of P1-5).
6. Decide and document a single UI-library convention (P2-4).
7. Bundle split (P2-3).

### Long term

8. Multi-region reconciliation: finish the registry refactor and add a
   second region config.
9. Unit tests for validators (P2-5) so invoice-format changes are caught
   early.
10. Path to external user support: Heimdall's Terms of Use explicitly call
    out a 2027 target for external-user capabilities
    (`DisclosurePage.tsx` TERMS string). Before that can happen, almost
    all the P1 items above must be closed, plus tenancy isolation, SOC
    controls, and an audit-log model need to be designed.

## Deliberate non-risks

Reviewers sometimes flag these; they are intentional:

- **Invoice data is never sent to a backend.** All parsing, validation,
  and conversion happen in the browser via `DOMParser`, `XPathEvaluator`,
  `XSLTProcessor`, `JSZip`, and `xlsx`. This is a privacy-positive design
  decision, not a missing feature.
- **`DOMPurify` on all bot output.** The validators build HTML fragments
  as strings and always sanitize before `dangerouslySetInnerHTML`. This
  is the correct pattern and is applied consistently.
- **No WebSockets, no push.** Request/response is sufficient for this
  workflow.
- **Role model is just Staff and Admin.** Fine-grained scopes are
  deliberately pushed to the entitlement array rather than to Cognito
  groups, which keeps Cognito simple.
