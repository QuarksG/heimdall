# 02 — Architecture

## System at a glance

```
┌──────────────────────────────────────────────────────────────────────┐
│                       Browser (user)                                 │
│                                                                      │
│   React 19 SPA (Vite 7 build, single bundle)                         │
│   ├── React Router 7  (src/App.tsx)                                  │
│   ├── AuthContext     (Cognito session in memory)                    │
│   ├── Feature views   (client-side XML/XLSX processing)              │
│   └── Amplify JS SDK  (amplify_outputs.json)                         │
└──────────────┬─────────────────────────────────┬─────────────────────┘
               │                                 │
     (Cognito SRP)                     (Amplify Data over AppSync)
               │                                 │
               ▼                                 ▼
     ┌──────────────────────┐        ┌─────────────────────────────┐
     │  Cognito User Pool   │        │   AWS AppSync GraphQL API   │
     │                      │        │                             │
     │  PreSignUp Lambda    │        │  Models: TermsAcceptance,   │
     │  PreTokenGen Lambda  │        │  AccessRequest, Entitlement │
     │  (email domain +     │        └──────────────┬──────────────┘
     │   terms + entitl.)   │                       │
     └──────────────────────┘        ┌──────────────▼──────────────┐
                                     │   DynamoDB: 3 tables         │
                                     └──────────────────────────────┘

                         (Separate REST plane for pre-auth writes)

     ┌─────────────────────────────────────────────────────────────┐
     │   API Gateway HTTP API   (amplify/backend.ts:50-65)          │
     │   POST /onboarding/terms/accept                              │
     │                           │                                  │
     │                           ▼                                  │
     │                  terms-api Lambda  ──▶  DDB: TermsAcceptance │
     └─────────────────────────────────────────────────────────────┘
```

## AWS resources (Amplify Gen 2)

All backend resources are defined as code in `amplify/` and composed in
`amplify/backend.ts`:

### `auth` — Cognito User Pool

Defined in `amplify/auth/resource.ts`:

- Login via email only (line 6).
- Required user attributes: `givenName`, `familyName` (lines 8–11).
- Groups: `Admin`, `Staff` (line 13).
- Triggers:
  - `preSignUp` — validates email domain + required Terms acceptance.
  - `preTokenGeneration` — injects `custom:entitlements` claim from DDB.

### `data` — AppSync + DynamoDB

Defined in `amplify/data/resource.ts`. Default authorization mode: `userPool`.
Three models:

| Model | Key | Authorization |
|---|---|---|
| `TermsAcceptance` | default `id` | Admin group can read/write via AppSync. The `terms-api` Lambda writes directly via the DDB SDK (lines 31–32 of `backend.ts`). |
| `AccessRequest` | default `id` | Owner can create and read their own records; Admin group has full CRUD. |
| `Entitlement` | `userId` (custom key) | Admin group only via AppSync. The `preTokenGeneration` Lambda reads via SDK. |

Fields captured in each model are in `amplify/data/resource.ts` lines 15–54.

### `termsApi` — Lambda + HTTP API

Lambda: `amplify/functions/terms-api/handler.ts`. HTTP API created
programmatically in `amplify/backend.ts` lines 50–65 with a single route:

- `POST /onboarding/terms/accept`
- CORS: origin `http://localhost:5173` (currently; see Risks), methods
  `POST, OPTIONS`, headers `authorization, content-type`.

The Lambda validates a required `termsVersion` and `sessionId`, rejects any
`termsVersion` other than the environment's `CURRENT_TERMS_VERSION`, and
writes one row to the `TermsAcceptance` DDB table with `PutItem` using a
`attribute_not_exists(id)` condition to prevent ID collisions. On success
it returns the generated `acceptanceId` and `termsVersion`.

### `preSignUp` Lambda

`amplify/auth/pre-sign-up/handler.ts`:

- Enforces email domain allow-list: `amazon.cz`, `amazon.tr`, `amazon.com`,
  `amazon.com.tr` (line 4).
- Requires `clientMetadata.acceptanceId` to be set on the `signUp` call
  (lines 19–21). The client obtains this ID by first calling the terms API,
  establishing a binding between Terms acceptance and account creation.
- Requires `clientMetadata.termsVersion` to equal the current version
  (line 24).
- Does not auto-confirm; users still receive an email verification code.

### `preTokenGeneration` Lambda

`amplify/auth/pre-token-generation/handler.ts`:

- On every token issuance, looks up the user's Entitlement by Cognito `sub`
  and injects it as the `custom:entitlements` claim on the ID token.
- Discovery of the DDB table name is dynamic: reads
  `ENTITLEMENT_TABLE_NAME` from env, falls back to `ListTables` + name
  filter (`includes("Entitlement") && !includes("AccessRequest")`), with a
  module-level cache. See `discoverEntitlementTable` function.
- IAM: granted `GetItem`, `Query`, `Scan`, `ListTables`, `DescribeTable` on
  `*` via a role policy in `backend.ts` lines 36–47.

## Client architecture

Entry: `src/main.tsx` wraps `<App />` in `<BrowserRouter>`, `<AuthProvider>`,
and `<React.StrictMode>`, then configures Amplify with
`amplify_outputs.json` produced by the Amplify sandbox.

### Routing (`src/App.tsx`)

Public auth routes are rendered without layout. Authenticated routes nest
under `<ProtectedRoute><MainLayout /></ProtectedRoute>` so every protected
page shares the sidebar + header. Feature pages are additionally wrapped in
`<FeatureGate featureId="...">`. Denied users see an "Access Denied" card
(`FeatureGate.tsx` lines 22–70) rather than a redirect.

### Auth state (`src/features/authentication/context/AuthContext.tsx`)

`AuthProvider` exposes `{ isAuthenticated, user, entitlements, loading,
refresh, signOut }`. It hydrates from Amplify's `fetchAuthSession()`:

- `user.role` is derived from the `cognito:groups` claim.
- `user.userId` is the Cognito `sub`.
- `entitlements` is the JSON-decoded `custom:entitlements` claim.

All consumers use `useAuth()` (`hooks/useAuth.ts` re-exports from context).

### Feature access (`src/features/authentication/hooks/usePermissions.ts`)

`usePermissions()` exposes `isUnlocked(FeatureKey)`. The hook holds the
sidebar's feature-key → entitlement-key map:

```
Home            → always
AccessRequest   → always
InvoiceParsing  → "invoice-parsing"
InvoiceControl  → "invoice-validation"
InvoiceVerify   → "invoice-conversion"
InvoiceValidateDF → "invoice-validation"
Recon           → "payment-reconciliation"
CRTRExtraction  → "crtr-extraction"
Settings        → Admin role only
Help, Logout    → always
```

Admin users resolve to `isUnlocked === true` for every key. This is the
single source of truth for both the sidebar lock overlay and the route-level
`FeatureGate`.

### UI shell (`src/shared/components/layout/`)

- `MainLayout.tsx` — flex container: fixed sidebar + scrollable main.
- `Sidebar.tsx` — collapsible navigation. Icons are in-repo SVG components
  (see `.kiro/specs/sidebar-icons/design.md` for the full design history).
- `Home.tsx` — landing page: welcome, quick-start steps, feature cards,
  external resources, privacy notice.
- `PageHeader.tsx` — title bar used by some pages.

### Styling

Global CSS only. No CSS-in-JS library. Files: `src/styles/global.css`,
`variables.css`, `Home.css`, and per-component stylesheets under
`styles/components/`. Two theme files (`themes/default.css`,
`themes/dark.css`) exist but the app does not yet toggle themes.

### State management

No Redux, Zustand, or similar. State lives in:

- React context (auth).
- Component-local `useState` + `useMemo` (most features).
- Custom hooks per feature (e.g. `useInvoiceProcessor`,
  `useReconciliationProcess`, `useCrtrProcessor`) that wrap the pipeline.

## Data flow: two representative paths

### Path A — New user accepts terms and signs up

```
User  → GET /auth/terms (SPA)
DisclosurePage  → POST /onboarding/terms/accept   (HTTP API)
                  body: { termsVersion, sessionId }
terms-api Lambda → PutItem on TermsAcceptance table
                   returns { acceptanceId, termsVersion }
DisclosurePage  → stores proof in sessionStorage
User             → /auth/register
Register         → signUp(email, password, ..., clientMetadata: { acceptanceId, termsVersion })
preSignUp Lambda → validates email domain + acceptanceId + termsVersion
Cognito          → sends email verification code
User             → /auth/confirm, enters 6-digit code
ConfirmSignUp    → confirmSignUp → Cognito confirms user
User             → /auth/login → signIn → ID token issued
preTokenGen Lambda → reads Entitlement (empty at this point)
                     sets custom:entitlements = { country: "", allowedFeatures: [] }
AuthContext      → user lands at Home; all feature tiles are locked
```

### Path B — User with entitlements opens a feature

```
User  → clicks "Retail Invoice Validator" in sidebar
Sidebar → navigate("/invoice-validation/retail")
React Router → ProtectedRoute (authenticated: yes)
            → MainLayout
            → FeatureGate(featureId="InvoiceControl")
            → usePermissions().isUnlocked("InvoiceControl")
               entitlements.allowedFeatures includes "invoice-validation" ? → true
            → InvoiceControl renders
User   → uploads invoice.xml (or invoice.zip)
InvoiceControl → JSZip reads archive (if ZIP)
              → DOMParser parses each XML
              → runs 6 validators (header, address, IADE detect, tax, PO, ASIN)
              → renders DOMPurify-sanitized HTML into chat messages
```

No invoice data leaves the browser in Path B.

## Process and trust boundaries

| Boundary | Crossed data | Authn | Integrity |
|---|---|---|---|
| Browser ↔ Cognito (SRP) | Credentials, tokens | Cognito SRP | TLS |
| Browser ↔ AppSync | Data model CRUD | `userPool` JWT | TLS; server-side authZ per model |
| Browser ↔ HTTP API | Terms acceptance only | **None** (pre-auth) | TLS; origin allow-list via CORS; body schema validated server-side |
| Lambda ↔ DDB | PutItem / GetItem | IAM role | AWS SigV4 |
| Lambda ↔ Cognito event | Triggered by Cognito | AWS service-to-service | — |

The terms-api is intentionally unauthenticated because it fires *before* the
user has a Cognito account. Binding comes from the `acceptanceId` that the
client later presents to `signUp` as `clientMetadata` and that the preSignUp
Lambda re-verifies against the terms version. See `03-security.md` for a
critique of that binding.

## Extensibility points

- **New feature:** add a `FeatureKey` in `usePermissions.ts`, register an
  icon in `src/assets/icons/index.ts`, add a sidebar item in `Sidebar.tsx`,
  add a `<Route><FeatureGate>...</FeatureGate></Route>` in `App.tsx`, and
  add an entitlement key in `ID_TO_FEATURE`.
- **New region for reconciliation:** the reconciliation module was designed
  for regional plug-ins under
  `src/features/payment-reconciliation/config/regions/` and
  `logic/processors/implementations/`. The current production path only
  supports Turkey (`TrOfaRemittanceProcessor`). The multi-region registry
  has a build error that is covered in `06-risks-and-roadmap.md`.

## What is deliberately absent

- **No server-side rendering, no Next.js, no caching layer.** The SPA is
  pure client render. File processing is done in the browser.
- **No WebSockets, no push, no GraphQL subscriptions.** The app is
  request/response only.
- **No feature flag service.** `src/config/feature-flags.ts` exists but is
  empty. Flags are therefore hardcoded or inferred from entitlements.
- **No observability stack.** No CloudWatch dashboards, no X-Ray, no
  client-side error telemetry. See `05-operations.md`.
