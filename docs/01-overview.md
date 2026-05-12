# 01 — Overview

## What Heimdall is

Heimdall is an internal web application for Amazon staff who handle Turkish
e-invoice (e-fatura) operations. It gives AP/FinOps and vendor-management
teams six self-service tools that operate on UBL 2.1 XML invoices and Amazon
payment remittance files, eliminating repeated manual spreadsheet work.

The SPA runs in the browser; the backend is a small AWS Amplify Gen 2 stack
whose only job is authentication, authorization, and a single Lambda-backed
HTTP endpoint for capturing Terms of Use acceptance.

Verified in: `package.json` (name = `heimdall`, version `0.0.0`), `src/App.tsx`
(route table), `amplify/backend.ts` (backend composition),
`src/shared/components/layout/Home.tsx` lines 12–115 (feature inventory).

## Users and access model

Two roles exist (`amplify/auth/resource.ts` lines 11–13):

| Role | Granted by | Capabilities |
|---|---|---|
| `Staff` | Default on sign-up | Always sees Home and Access Request; sees other features only after Admin approval. |
| `Admin` | Added manually to the Cognito `Admin` group | Full feature access; reviews and approves access requests via a dedicated panel. |

A new user lifecycle:

1. Accept Terms of Use at `/auth/terms` (`DisclosurePage.tsx`).
2. Sign up with a corporate Amazon email (`Register.tsx`, domain allow-list
   enforced in `amplify/auth/pre-sign-up/handler.ts` line 4).
3. Confirm via 6-digit email code (`ConfirmSignUp.tsx`).
4. Sign in (`Login.tsx`).
5. Submit an Access Request for a country + feature set
   (`features/authentication/components/AccessRequest.tsx`).
6. An Admin approves, which creates an `Entitlement` DDB row
   (`features/authentication/components/AdminPanel.tsx` lines 86–104).
7. On the next sign-in, a Cognito pre-token trigger injects the entitlement
   as a `custom:entitlements` claim
   (`amplify/auth/pre-token-generation/handler.ts`).

## Surface area

The SPA has 13 routes (from `src/App.tsx` lines 37–126):

| Route | Element | Gate |
|---|---|---|
| `/auth/terms` | `DisclosurePage` | public |
| `/auth/login` | `Login` | public |
| `/auth/register` | `SignUp` | public |
| `/auth/confirm` | `ConfirmSignUp` | public |
| `/auth/forgot` | `ForgotPassword` | public |
| `/` | `Home` | `ProtectedRoute` |
| `/access-request` | `AccessRequest` | `ProtectedRoute` |
| `/invoice-parsing` | `InvoiceParsing` | `FeatureGate("InvoiceParsing")` |
| `/invoice-validation/retail` | `InvoiceControl` | `FeatureGate("InvoiceControl")` |
| `/invoice-validation/dropship` | `DFChatInterface` | `FeatureGate("InvoiceValidateDF")` |
| `/invoice-conversion` | `InvoiceVerify` | `FeatureGate("InvoiceVerify")` |
| `/payment-reconciliation` | `PaymentReconciliation` | `FeatureGate("Recon")` |
| `/crtr-extraction` | `CRTRExtraction` | `FeatureGate("CRTRExtraction")` |
| `/settings` | `AdminPanel` | `FeatureGate("Settings")` (Admin only) |
| `/auth-status` | `StatusDisplay` | `ProtectedRoute` (diagnostic) |

Unknown routes redirect to `/auth/login`.

## Feature inventory (detailed in `04-features.md`)

1. **Invoice Parsing** — Bulk-parse UBL 2.1 invoices; tabulate 35+ header and
   line-item fields; export Excel.
2. **Retail Invoice Validator** — Chat-style linter for Amazon Retail AP
   invoices; runs header, address, tax, PO, ASIN, and IADE (return) checks.
3. **Dropship (DF) Invoice Validator** — Separate validator tuned for
   drop-ship vendors; shared address/tax validators, DF-specific PO and ASIN
   rules.
4. **Invoice Convert** — XSLT-transform signed UBL invoices into browser-
   viewable HTML for previewing what the invoice looks like to a customer.
5. **E-Reconciliation** — Parse an OFA remittance Excel file into a
   dashboard with charts and a multi-sheet Excel export.
6. **CRTR Extraction** — Consolidate many UBL invoices into a CRTR-style
   summary report with configurable columns and a tax-mismatch reviewer.

Plus: **Access Request** (user-facing) and **AdminPanel** (admin-facing) for
permission management.

## What Heimdall is not

- It is not a customer-facing product. The Terms of Use explicitly classify
  the current deployment as a test environment through 2027
  (`DisclosurePage.tsx` lines 85–117, in the inline `TERMS` string).
- It does not persist uploaded invoices. All file processing happens in the
  browser; files are not uploaded to any backend service. The only server
  writes are Terms of Use acceptance records and permission records.
- It does not perform tax calculation. The validators check structural
  compliance against Amazon's billing-to addresses, expected tax fields,
  purchase order formats, and ASIN presence. They do not recompute tax.

## Hosting

Deployed via AWS Amplify Hosting. The production origin the backend allow-
lists is `https://main.d3p8snpek9jhao.amplifyapp.com`, currently inverted to
`http://localhost:5173` for local testing (`amplify/backend.ts` lines 28, 54;
`amplify/functions/terms-api/handler.ts` line 9 has an explicit
"revert before commit" comment). See `05-operations.md` and
`06-risks-and-roadmap.md` for the implications.

## Numbers, approximate

- Routes: 13 application routes + fallback.
- React components: ~70 (feature components + shared UI + layout + auth).
- Front-end dependencies: 18 runtime (`package.json` lines 11–29), notable
  ones: `aws-amplify` 6.16, `react` 19, `react-router-dom` 7,
  `xlsx` 0.18, `jszip` 3.10, `dompurify` 3.3, `recharts` 3.6,
  `lucide-react`, `react-icons`, `react-bootstrap`.
- Backend resources: 1 Cognito user pool, 3 DynamoDB tables, 3 Lambda
  functions, 1 HTTP API with 1 route.
- Production bundle: 1.84 MB JS (568 KB gzipped) + 304 KB CSS (45 KB
  gzipped), per the last `npm run build` output.

## One-sentence summary

Heimdall is a client-heavy, AWS-backed internal SPA that automates six
Turkish e-invoice workflows behind an Amplify Cognito auth plane and an
admin-curated feature entitlement model.
