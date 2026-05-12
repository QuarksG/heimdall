# 03 — Security & Authorization

This is the honest section. Heimdall is a well-structured internal tool with
sensible baseline hygiene, and it has gaps that must be closed before it is
exposed beyond its current test population. Everything below is grounded in
the code.

## Identity

- **Identity provider:** AWS Cognito User Pool provisioned by Amplify Gen 2.
- **Sign-in method:** email + password (`amplify/auth/resource.ts` line 6).
- **Required user attributes:** `givenName`, `familyName`.
- **Groups:** `Admin`, `Staff`.
- **MFA:** not configured.
- **SSO / SAML / IdP federation:** not configured.
- **Email domain allow-list:** `amazon.cz`, `amazon.tr`, `amazon.com`,
  `amazon.com.tr` (enforced in `pre-sign-up/handler.ts` line 4).

**Gap.** MFA is off. For an internal Amazon tool handling vendor financial
data, MFA should be mandatory. Amplify supports this declaratively; it is a
configuration addition, not a re-architecture.

## Authentication posture

- **Password policy:** The client-side `Register.tsx` computes a strength
  meter and blocks submission below 8 chars
  (`getPasswordStrength` lines 17–40, `canSubmit` line 107). The Cognito
  pool also enforces its own default policy.
- **Email confirmation:** Required. Cognito sends a 6-digit code
  (`ConfirmSignUp.tsx`). `preSignUp` explicitly sets `autoConfirmUser = false`
  and `autoVerifyEmail = false`.
- **Forgot password:** Implemented via `ForgotPassword.tsx` using Amplify's
  `resetPassword` / `confirmResetPassword` flow.
- **Session:** Amplify SDK manages token refresh. The client holds tokens in
  memory via `AuthContext`; Amplify persists them in browser storage by
  default.

## Authorization model

### Three layers

1. **`ProtectedRoute`** — all non-auth routes require an authenticated
   Cognito session (`guards/ProtectedRoute.tsx`). Unauthenticated users are
   sent to `/auth/login`.
2. **`FeatureGate`** — per-route entitlement check via
   `usePermissions().isUnlocked(featureId)` (`guards/FeatureGate.tsx`).
3. **AppSync model authorization** — declared per model in
   `amplify/data/resource.ts`:
   - `TermsAcceptance`: Admin group only.
   - `AccessRequest`: owner can create/read own, Admin full CRUD.
   - `Entitlement`: Admin group only.

### Source of truth: the `Entitlement` table

- `userId` (Cognito `sub`) is the partition key.
- `country` is a comma-separated list of ISO country codes.
- `allowedFeatures` is a list of feature keys (e.g. `"invoice-parsing"`).
- Written by Admin via `AdminPanel.tsx` when approving an `AccessRequest`.
- Read at token time by `preTokenGeneration/handler.ts` and stamped into
  the ID token as `custom:entitlements` JSON.

This design is good: the client never self-asserts permissions. The token
is the binding document and the server is the issuer.

## Terms of Use flow — cryptographic binding review

This is worth describing precisely because an Amazon reviewer will ask.

1. Client calls `POST /onboarding/terms/accept` with
   `{ termsVersion, sessionId }`. Server creates a row in `TermsAcceptance`
   with a freshly generated UUID (`randomUUID()` from Node `crypto`) as the
   PK. The row has no email, no user identifier, because the user has not
   yet registered. Returns `{ acceptanceId, termsVersion }`.
   (`terms-api/handler.ts` lines 25–64)

2. Client stores the proof in `sessionStorage` as:
   `heimdall.acceptanceId`, `heimdall.termsVersion`, `heimdall.termsAccepted`.

3. On `signUp`, the client passes both fields as
   `clientMetadata: { acceptanceId, termsVersion }` (`Register.tsx` line 221).

4. `preSignUp` Lambda rejects the sign-up if `acceptanceId` is missing or if
   `termsVersion !== CURRENT_TERMS_VERSION`.

**What this gives you.** A durable record that a terms version was accepted
from some client before a given sign-up.

**What this does not give you.**

- The `preSignUp` Lambda **does not verify that the `acceptanceId` actually
  exists in the `TermsAcceptance` table.** It only checks that the field is
  non-empty and that the version string matches. A client that never called
  the terms API could pass a fabricated UUID string and a matching version
  constant and be admitted.
- There is no binding between the acceptance row and the user who later
  signs up. The row is orphan evidence.
- There is a dev fallback in `DisclosurePage.tsx` (lines 407–423) that, if
  the terms API fails *and* `import.meta.env.MODE === "development"`, writes
  a `local-<uuid>` acceptance id to session storage and proceeds. That path
  is gated by build mode, not by environment, so any developer build allows
  offline acceptance. Acceptable for dev, but worth calling out.

**Recommended fix.** In `preSignUp`, look up the `acceptanceId` in the
`TermsAcceptance` table before allowing sign-up, and write the user's email
onto the row once known (or make the subsequent sign-up create a linked
row). This closes the "passable without real acceptance" gap.

## Data plane

### Where customer-affecting data flows

| Data | Source | Destination | Lifetime |
|---|---|---|---|
| Uploaded invoice XML/ZIP | User disk | Browser memory | Session (not persisted) |
| Uploaded remittance XLSX | User disk | Browser memory | Session |
| Export Excel (XLSX) | Browser memory | User disk | Permanent on user disk |
| Access requests | Form in browser | AppSync → DDB | Retained until explicit delete |
| Entitlements | Admin action | AppSync → DDB | Retained; PK = Cognito sub |
| Terms acceptance | Client → HTTP API | DDB via Lambda | Retained; PK = UUID |

### What is not captured

- **No PII beyond what Cognito stores.** The app does not persist uploaded
  invoice contents, ASINs, tax numbers, vendor names, or payment amounts.
  All of that is client-side only. A reviewer can verify by searching the
  code for any network write of invoice payload: there are none.
- **No telemetry.** No user interaction tracking, no session replay, no
  third-party analytics. Good for privacy; a gap for operations.

### Input handling

- **ZIP decompression** uses `jszip`. File size is checked client-side (100
  MB limit in `InvoiceControl.tsx` line 31, per-file limit in the
  conversion page, and `maxSize` in react-dropzone). No server ever sees
  archive content.
- **XML parsing** uses the browser's native `DOMParser` and `XPathEvaluator`.
  Parser errors are detected and rejected
  (`invoice-conversion/utils/xmlToHtml.ts` line 22,
  `invoice-parsing/utils/xmlParser.ts` lines 102–108).
- **XSLT transformation** — Invoice Convert applies an XSLT embedded inside
  the UBL invoice to produce an HTML preview via `XSLTProcessor`. This is
  the highest-risk input handler because the XSLT comes from the upload.
  The HTML result is inserted into an iframe-scoped `Blob` URL and opened.
  Output from `transformToFragment` is DOM, not a string — so the classic
  innerHTML injection path is avoided — but an actively malicious XSLT
  could still exfiltrate via side-channels (`document.cookie` read, fetch
  to an attacker origin) if a real browser were to execute embedded
  scripting. Modern browsers disable `<script>` execution inside XSLT
  output in most contexts, but this is not a property we control.
  See Risks.
- **HTML sanitization** — validator outputs are built from
  strings and piped through `DOMPurify.sanitize(...)` before
  `dangerouslySetInnerHTML` (`InvoiceControl.tsx` lines 145, 478, 482).
  This is the right pattern.

## Secrets

- `amplify_outputs.json` is committed (standard Amplify practice — it
  contains only client-side config such as Cognito pool IDs, AppSync endpoint,
  HTTP API endpoint). No secrets.
- No `.env` secrets are used by the client.
- Lambda environment variables (`TERMS_TABLE_NAME`, `CURRENT_TERMS_VERSION`,
  `ALLOWED_ORIGIN`, and the inferred `ENTITLEMENT_TABLE_NAME`) are
  configuration, not secrets.

## CORS

The HTTP API is locked to a single origin at a time
(`amplify/backend.ts` line 54). Today that origin is `http://localhost:5173`
(local dev) in both the API Gateway preflight config and the Lambda's
response header builder. The production origin
`https://main.d3p8snpek9jhao.amplifyapp.com` is documented in the
`handler.ts` file but currently commented-out as the active value. **Fix
before any production deployment.**

The terms-api Lambda already echoes the allowed origin back only when the
request's `Origin` header matches, and adds `Vary: Origin`, both of which
are correct. It will *not* echo `*`.

## IAM

- `preTokenGeneration` Lambda role: `GetItem`, `Query`, `Scan`, `ListTables`,
  `DescribeTable` on `*` (`backend.ts` lines 36–47).
  **Gap.** `Resource: "*"` is broader than needed. A production tightening
  should scope to the `Entitlement` table ARN and drop `Scan` and
  `DescribeTable`.
- `termsApi` Lambda role: granted `grantWriteData` on the
  `TermsAcceptance` table (line 22). Scoped correctly.

## Logging

Lambdas use `console.log` / `console.error`, which land in CloudWatch Logs
by default. There is no structured log format, no correlation ID, no log
retention policy defined in code. Acceptable for a test deployment;
insufficient for a security audit.

## Content security headers

The SPA does not set a Content Security Policy. For a tool that executes
browser-side XSLT from untrusted-ish files, a CSP that disallows
`script-src` other than the app origin would materially reduce blast radius
for any pathological input. Can be added at Amplify Hosting via
response headers.

## Summary

**Solid:**
- Real identity, real per-user entitlement, token-based claims.
- Server-side authorization on every persisted model.
- Client never self-asserts role or country.
- No invoice data leaves the browser for the features most reviewers will
  worry about.
- DOMPurify on every bot-generated HTML output.

**Gaps worth closing before broader rollout:**
1. MFA on Cognito.
2. Verify `acceptanceId` exists in DDB inside `preSignUp`.
3. Narrow the `preTokenGeneration` IAM role to the Entitlement table ARN.
4. Restore the production `ALLOWED_ORIGIN` in `backend.ts` and `handler.ts`.
5. Add CSP headers via Amplify Hosting.
6. Define a CloudWatch log retention policy and a structured log format.
