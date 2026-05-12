# 04 — Features

Each section is a short technical brief: what the feature does, what it
expects, the pipeline, the output, and any notable implementation choices.
File paths are relative to the repository root.

---

## 4.1 Invoice Parsing

**Path:** `/invoice-parsing` · **Entry:** `src/features/invoice-parsing/components/InvoiceParsing.tsx`
· **Feature key:** `InvoiceParsing`

### Purpose
Bulk-extract structured data from many Turkish UBL 2.1 e-fatura XML files
and display them in a filterable table; export the selection as an Excel
spreadsheet.

### Inputs
- One or more `.xml` files, or `.zip` archives containing `.xml` files.
- No hard file-count limit in code; practical limit is browser memory.

### Pipeline
1. `useFileProcessor` (`hooks/useFileProcessor.ts`) iterates through files.
   For ZIPs, `JSZip.loadAsync(file)` extracts every `.xml` member.
2. Each XML string is fed to `XMLToExcelConverter.transformXML` which wraps
   `DOMParser.parseFromString(..., 'application/xml')`
   (`utils/xmlParser.ts` lines 101–108).
3. `extractDataForExcel` applies an array of `FieldDefinition`s, each with
   one or more XPath expressions and an optional XML attribute name.
   Custom handlers (e.g. `extractCustomerAddress`, `extractDeliveryNote`,
   `extractInvoiceRef`) run for fields that need multi-step logic
   (lines 225–275 of `xmlParser.ts`).
4. Line items are expanded: the parser detects `cac:InvoiceLine` or
   falls back to `cac:DespatchLine` and emits one row per line, carrying
   the header fields forward.
5. Duplicate detection is done by filename: a `useRef<Set<string>>` holds
   already-processed file names so dropping the same ZIP twice does not
   double-count (`useFileProcessor.ts` lines 13, 20–23).

### UI
- `FileUploader` — drag & drop plus browse.
- `DataTable` — client-side filter by `searchQuery` (case-insensitive
  substring over all visible fields).
- `HeaderSelector` — toggle which of ~35 defined fields are visible.
- `exportToExcel` (`utils/excelExporter.ts`) builds a single-sheet workbook
  with date-stamped filename. Numeric fields are left as numbers; all
  others are forced to text (`.z = '@'`) to prevent Excel auto-formatting
  of UBL identifiers.

### Limits and assumptions
- Assumes UBL namespaces as defined in `constants/namespaces.ts`.
- Unknown fields resolve to the literal string `"Unknown"`. This is
  intentional so exported spreadsheets show the gap.

---

## 4.2 Retail Invoice Validator

**Path:** `/invoice-validation/retail` · **Entry:**
`src/features/invoice-validation/retail/components/InvoiceControl.tsx`
· **Feature key:** `InvoiceControl`

### Purpose
Run a chat-style linter over a single Amazon Retail AP invoice (Satış or
İade) and report every policy violation in Turkish, with specific field
citations and fix suggestions.

### Inputs
- One `.xml` file, or one `.zip` containing one invoice.
- 100 MB size cap (`MAX_SIZE_BYTES`, line 31).

### Validators (invoked in this order)
1. `validateInvoiceHeader` — pulls invoice number, type code, VKN, TCKN,
   supplier name; emits header messages.
2. `validateAmazonAddress` — validates that the bill-to address matches
   the expected Amazon Turkey address block.
3. **IADE detection** — in-component logic (lines 44–154). Scans
   `OrderReference/ID`, `BuyersItemIdentification/ID`, `Note`, `Item/Name`,
   `Item/Description` for `IQV` or `IPV` prefixes followed by 10–20 digits.
   Strict 13-digit variant is distinguished for more pointed error
   messages. If any hit is found but `InvoiceTypeCode != IADE`, the
   invoice is flagged as miscategorized.
4. `validatePurchaseOrder` — PO format checks.
5. `performIADEValidations` (when invoice type is IADE) or
   `validateAsinDetails` (otherwise) — returns-specific rules or ASIN
   presence checks.
6. `validateAmazonTaxDetails` — required tax fields and cross-total
   arithmetic sanity.

### Output
A chat log of messages. Each validator contributes sanitized HTML
fragments (via `DOMPurify.sanitize`) rendered through
`dangerouslySetInnerHTML`. A successful validation emits a Turkish-language
acknowledgment that includes the invoice number and either VKN or TCKN.

### Notable implementation choices
- Output HTML is always DOMPurified at ingestion and again at render.
- The component holds its validators in memory only; there is no backend
  call in this feature.
- Invalid files or ZIPs with no XML receive concrete, named-file errors.

---

## 4.3 Dropship (DF) Invoice Validator

**Path:** `/invoice-validation/dropship` · **Entry:**
`src/features/invoice-validation/dropship/components/ChatInterface.tsx`
(exported as `DFChatInterface`) · **Feature key:** `InvoiceValidateDF`

### Purpose
A parallel validator for drop-ship (fulfilled-by-partner) invoices. Shares
address and tax validators with the Retail variant, adds DF-specific rules
for supplier party, purchase order format, and ASIN/ISBN acceptance.

### Key differences from Retail
- **Customer number check:** the supplier-provided customer number must
  resolve to `"310"` (Amazon Drop-Ship customer number)
  (`InvoiceValidateDF.tsx` lines 16–22).
- **Invoice-type guard:** `IADE` and `İRSALİYE` are rejected for DF.
- **Supplier validator** ensures the supplier party block is correctly
  populated (`validators/supplierValidator.ts`).
- **ASIN validator** accepts either a 10-char ASIN or an ISBN-10.

### Output
Same chat pattern as Retail. All emitted HTML is sanitized.

---

## 4.4 Invoice Convert (Preview)

**Path:** `/invoice-conversion` · **Entry:**
`src/features/invoice-conversion/components/InvoiceVerify.tsx`
· **Feature key:** `InvoiceVerify`

### Purpose
Render a signed UBL invoice in the browser exactly as it would appear to
the recipient, by applying the XSLT stylesheet embedded inside the invoice.

### Pipeline (`utils/xmlToHtml.ts`)
1. Parse XML; bail on parser errors.
2. Extract header metadata via `extractInvoiceData` (shared with the
   parsing feature).
3. Locate `EmbeddedDocumentBinaryObject` elements; base64-decode the one
   whose `filename` ends in `.xslt`/`.xsl` or whose `format == "xslt"`.
   Legacy untyped elements are also scanned as a fallback.
4. Construct an `XSLTProcessor`, import the stylesheet, call
   `transformToFragment(xmlDoc, document)` to get a DOM fragment.
5. Wrap the fragment in a minimal `<html>` shell and build a Blob URL.
6. Also build a Blob URL for the raw XML for download.
7. Extract `ds:DigestValue` for display (the XMLDSig digest).

### Output
- On-screen preview via a Blob URL the user can open.
- Raw XML download link.
- A summary row in the invoices table including taxable amount, tax amount,
  total with tax, currency.

### Risk note
See `03-security.md` for the XSLT execution discussion. The implementation
surfaces a helpful but non-trivial attack surface because XSLT content is
sourced from the uploaded invoice.

---

## 4.5 Payment Reconciliation (E-Reconciliation)

**Path:** `/payment-reconciliation` · **Entry:**
`src/features/payment-reconciliation/components/Recon.tsx`
· **Feature key:** `Recon`

### Purpose
Parse an Amazon OFA remittance advice Excel, classify each row (sales,
quantity variance, price variance, havale), run a three-way match between
negative-adjustment rows and positive sales rows, and render a dashboard
plus a multi-sheet Excel export.

### Inputs
- One `.xlsx` / `.xlsm` / `.xls` file.

### Pipeline (`hooks/useReconciliationProcess.ts`)
1. Read the workbook with SheetJS (`xlsx`), convert the first sheet to a 2D
   array.
2. Instantiate `TrOfaRemittanceProcessor` and call `.parse(rawData)`.
3. The processor applies region-specific header detection and row
   classification based on Turkish-labeled column headers
   (`config/regions/implementations/tr.config.ts`).
4. Result: either `{ isValid: false, message }` or
   `{ isValid: true, records: PaymentRecord[] }`.
5. If valid, each record is assigned a sequential `rowNumber` and stored in
   state.

### Dashboard
`components/Dashboard/ReconciliationDashboard.tsx` renders charts with
`recharts`: breakdown by payment type, invoice category distribution,
PPV / PQV totals, and exception lists.

### Three-way matching
`logic/matchers/threeWayMatchingEngine.ts` implements the match:

- Inputs: parsed records of types `Eksik Miktar Kesinti Faturası` (PQV) and
  `Toptan Satış Faturası` (sales).
- For each PQV row, the engine attempts to identify a parent sales row by
  extracting the last 16 chars of the description (`extractParentId`).
- Matching is gated by a minimum date offset of 33 days and an amount
  tolerance of 0.8 units.
- Produces both exact (PO-match) and loose (no PO-match) candidate lists.

### Export
`utils/excelExporter.ts` generates a workbook with up to five sheets:
`PaymentData`, `FilteredInvoices`, `Havale`, `PpvReconciliation`,
`PqvReconciliation`. Each sheet has a corresponding builder component
under `components/Excel/`.

### Known defect
`src/features/payment-reconciliation/config/regions/index.ts` references
`./base/RegionConfig.interface` (file does not exist at that path) and
imports a `TurkeyConfig` named export (actual export is `trRegionConfig`).
This module is unreachable from the runtime UI (the hook uses the
processor directly), so the build succeeds, but `tsc --noEmit` reports
three errors in this file. Documented in `06-risks-and-roadmap.md`.

---

## 4.6 CRTR Extraction

**Path:** `/crtr-extraction` · **Entry:**
`src/features/crtr-extraction/CRTRExtraction.tsx` · **Feature key:**
`CRTRExtraction`

### Purpose
Consolidate many UBL invoices into a CRTR-style aggregate report with
per-user-configurable custom fields, tax-code reconciliation, and Excel
export.

### Inputs
- One or more `.xml` or `.zip` files (common pattern: a single ZIP of many
  invoices).

### Pipeline (`hooks/useCrtrProcessor.ts`)
1. Extract XMLs as in the parsing feature.
2. Run the CRTR-specific XML parser (`utils/crtrXmlParser.ts`) to pull
   fields relevant to the CRTR format.
3. Compute per-invoice summary (totals, tax breakdown, counts).
4. Surface a `TaxMismatchModal` when detected tax codes do not match the
   configured expected code.
5. Let the user toggle visible columns via `ColumnSelector` and configure
   custom-field values in `CustomFieldsPanel`.
6. Export with `utils/excelExporter.ts`.

### Notable choices
- All processing is client-side.
- The UI is split into a header area (upload, config, export buttons), a
  summary panel, a configurable data table, and a tax-mismatch modal.

---

## 4.7 Access Request (user-facing)

**Path:** `/access-request` · **Entry:**
`src/features/authentication/components/AccessRequest.tsx`

### Purpose
Let a signed-in Staff user submit a structured request for country + feature
access. The request is reviewed by an Admin.

### Inputs
- Countries: multi-select chips from a fixed list (16 ISO codes).
- Features: 6 feature checkboxes.
- Justification: freeform text, minimum 10 chars.

### Pipeline
- `client.models.AccessRequest.create(...)` via Amplify Data.
- `userId` is the current Cognito `sub`. This matches the `Entitlement`
  table PK so approval writes to the right user row.
- Status starts as `PENDING`.

### Output
A toast-style success banner; form is cleared on success.

---

## 4.8 Admin Panel (Settings)

**Path:** `/settings` · **Entry:**
`src/features/authentication/components/AdminPanel.tsx`
· **Feature key:** `Settings` (Admin role only)

### Purpose
List all access requests; approve, reject, revoke, or re-approve them; this
is the single place where entitlements are granted or removed.

### Actions
- **Approve** — updates `AccessRequest.status = APPROVED` and creates an
  `Entitlement` row keyed by `userId` with the requested country list and
  feature list (`handleApprove` lines 70–104).
- **Reject** — updates `AccessRequest.status = REJECTED`. No Entitlement
  side effect.
- **Revoke** — deletes the Entitlement row and sets the request back to
  `REJECTED`. Revoked users lose access on their next token refresh.
- **Re-approve** — re-runs `Approve` from a `REJECTED` state.

### UI
Four tab filters (`PENDING / APPROVED / REJECTED / ALL`), per-card summary
with country tags, feature tags, justification, reviewed-by, and
submission time. Actions are disabled while an action is in flight for
that row.

### Consistency note
Approval performs two writes (`AccessRequest.update` then
`Entitlement.create`) without a transaction. If the second write fails, the
request is marked approved but the entitlement is missing. In practice the
impact is minor because an Admin can retry or re-approve, but for
auditability a single atomic operation (or a compensating action on
failure) would be preferable.
