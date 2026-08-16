import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { PaymentDataSheet } from '../components/Excel/PaymentDataSheet';
import { HavaleSheet } from '../components/Excel/HavaleSheet';
import { FilteredInvoicesSheet } from '../components/Excel/FilteredInvoicesSheet';
import { PqvReconciliationSheet } from '../components/Excel/PqvReconciliationSheet';
import { VendorLedgerSheet } from '../components/Excel/VendorLedgerSheet';
import { CashierAuditSheet } from '../components/Excel/CashierAuditSheet';
import { DataQualitySheet } from '../components/Excel/DataQualitySheet';
import { DisclaimerSheet } from '../components/Excel/DisclaimerSheet';
import {
  runCashierModel,
  type CashierModelResult,
} from '../logic/cashierModel';
import { ThreeWayMatchingEngine } from '../logic/matchers/threeWayMatchingEngine';
import { computePqvLineage } from '../logic/matchers/pqvLineage';
import { injectPivotTable, type PivotInjectorConfig } from './pivotInjector';
import { disableSheetGridlines } from './gridlinePatcher';
import { applyAuditStyles, applyCellStyles } from './auditStylePatcher';
import type { PaymentRecord } from '../types/regional.types';

/**
 * Native pivot configuration (Requirements 5.3, 5.4, 5.5).
 *
 * The value-field labels match the ACTUAL serialized `Payment Data` headers —
 * `PaymentDataSheet.mapRecordsToRows` emits the UNSPACED labels
 * 'Uygulanan indirim' / 'Alacak' / 'Borç' (the injector matches exact-first,
 * then trim-tolerant, so the exact unspaced labels are the safest choice).
 *
 * MULTI-CURRENCY RULE: amounts in different currencies must NEVER be
 * summed together. When the remittance carries more than one distinct
 * currency code ('Ödeme para birimi'), the currency becomes the OUTER
 * row field of the pivot, grouping every Fatura Türü total per currency.
 * Single-currency files keep the plain Fatura Türü pivot.
 */
function buildPivotConfig(records: PaymentRecord[]): PivotInjectorConfig {
  const currencies = new Set(
    records.map(r => r.currency.trim()).filter(c => c !== ''),
  );
  const multiCurrency = currencies.size > 1;

  return {
    hostSheetName: 'Pivot Fatura Türü',
    sourceSheetName: 'Payment Data',
    rowFields: multiCurrency
      ? ['Ödeme para birimi', 'Fatura Türü']
      : ['Fatura Türü'],
    valueFields: [
      { sourceField: 'Alacak' },
      { sourceField: 'Borç' },
      { sourceField: 'Uygulanan indirim' },
    ],
  };
}

/**
 * The 15 `Payment Data` header labels exactly as
 * `PaymentDataSheet.mapRecordsToRows` emits them. Used ONLY for the
 * zero-record header fix below (Requirements 8.3, 5.8) — non-empty input
 * always takes its headers from the builder itself (Requirement 2.2).
 */
const PAYMENT_DATA_HEADERS: readonly string[] = [
  'Satır Numarası',
  'Ödeme yapılacak taraf',
  'Ödeme para birimi',
  'Tedarikçi site adı',
  'Ödeme Numarası',
  'Ödeme tarihi',
  'Fatura Türü',
  'Fatura Numarası',
  'Fatura Tarihi',
  'Yaş (Gün)',
  'PO: Sipariş Numarası',
  'Fatura Açıklaması',
  'Uygulanan indirim',
  'Alacak',
  'Borç',
  'Bakiye',
];

export class ExcelExporter {
  private paymentSheetBuilder: PaymentDataSheet;
  private havaleSheetBuilder: HavaleSheet;
  private invoiceSheetBuilder: FilteredInvoicesSheet;
  private pqvSheetBuilder: PqvReconciliationSheet;
  private vendorLedgerBuilder: VendorLedgerSheet;
  private cashierAuditBuilder: CashierAuditSheet;
  private dataQualityBuilder: DataQualitySheet;
  private disclaimerBuilder: DisclaimerSheet;
  private matcher: ThreeWayMatchingEngine;

  constructor() {
    this.paymentSheetBuilder = new PaymentDataSheet();
    this.havaleSheetBuilder = new HavaleSheet();
    this.invoiceSheetBuilder = new FilteredInvoicesSheet();
    this.pqvSheetBuilder = new PqvReconciliationSheet();
    this.vendorLedgerBuilder = new VendorLedgerSheet();
    this.cashierAuditBuilder = new CashierAuditSheet();
    this.dataQualityBuilder = new DataQualitySheet();
    this.disclaimerBuilder = new DisclaimerSheet();
    this.matcher = new ThreeWayMatchingEngine();
  }

  /**
   * Builds the enhanced workbook and triggers the browser download
   * (Requirements 1.1, 8.1, 8.2). On any failure the error propagates and
   * `saveAs` is never reached — no partial workbook is downloaded
   * (Requirements 1.6, 1.7).
   */
  public async generateAndDownload(
    records: PaymentRecord[],
    fileNamePrefix: string = 'Vendor',
    warnings: string[] = [],
  ): Promise<void> {
    const { blob, fileName } = await this.generateBlob(records, fileNamePrefix, warnings);
    saveAs(blob, fileName);
  }

  /**
   * Full in-memory pipeline: build sheets → serialize → inject native pivot.
   * Exposed separately from `generateAndDownload` so the pipeline is testable
   * without file I/O.
   */
  public async generateBlob(
    records: PaymentRecord[],
    fileNamePrefix: string = 'Vendor',
    warnings: string[] = [],
  ): Promise<{ blob: Blob; fileName: string }> {
    // 0. Cashier model — runs FIRST, before ANY rendering preparation
    //    (Requirement 7.1). The three-layer gated pipeline lives in
    //    `logic/cashierModel.ts`: validation → Layer 1 aggregation →
    //    Layer 2 balance check + Gate → Layer 3 ledger with closure
    //    verification. A validation failure (`ok: false`) halts the
    //    export here with the bilingual failure message — no workbook
    //    bytes exist, no download happens (Requirements 1.6, 7.7).
    //    Model-thrown errors (Fark conservation, ledger closure
    //    discrepancy) propagate the same way, unchanged.
    //
    //    A RED gate is NOT an error: the export proceeds and the ledger
    //    sheet renders the withheld notice (Requirement 8.1).
    const outcome = runCashierModel(records);
    if (!outcome.ok) {
      throw new Error(outcome.failure.message);
    }
    const cashierResult: CashierModelResult = outcome.result;

    const workbook = XLSX.utils.book_new();

    // Fixed sheet order (Requirement 7.8): Payment Data, HAVALE,
    // Filtered Invoices, Pivot Fatura Türü, PQV-RI,
    // Tedarikçi Cari Hareketleri, Audit Trails (data quality), then
    // Disclaimer (static invoice-class explanations, always last).

    // 1. Payment Data Sheet (Main Ledger)
    const wsPayment = this.paymentSheetBuilder.create(records);
    // Empty-input fix — DEFENSIVE ONLY: empty input now fails cashier-model
    // validation (EMPTY_INPUT) in step 0, so this path is unreachable in
    // practice. Retained in case validation is ever bypassed: with zero
    // records, `json_to_sheet` emits no header row, leaving the pivot
    // source range unresolvable; writing the header labels into row 1
    // keeps the pivot cache defined over the header row. Non-empty input
    // is untouched.
    if (records.length === 0 && (!wsPayment['!ref'] || !wsPayment['A1'])) {
      XLSX.utils.sheet_add_aoa(wsPayment, [[...PAYMENT_DATA_HEADERS]], { origin: 'A1' });
    }
    XLSX.utils.book_append_sheet(workbook, wsPayment, 'Payment Data');

    // 2. Havale Sheet (Wire Transfer Summary)
    const wsHavale = this.havaleSheetBuilder.create(records);
    XLSX.utils.book_append_sheet(workbook, wsHavale, 'HAVALE');

    // 3. Filtered Invoices (Accounting View)
    const wsInvoices = this.invoiceSheetBuilder.create(records);
    XLSX.utils.book_append_sheet(workbook, wsInvoices, 'Filtered Invoices');

    // 4. Pivot host sheet: columns A–D stay empty for the injected native
    //    PivotTable (anchored at A3); the Layer 1 aggregation table and
    //    Layer 2 balance-check table render from F2 (columns A–E untouched)
    //    so the analyst reviews the pivot and the cashier model side by
    //    side (Requirements 4.7, 4.8, 7.5).
    //    The builder also records the styling target coordinates the
    //    post-serialization style patch (step 7c) consumes.
    const { sheet: wsPivotHost, styleTargets: auditStyleTargets } =
      this.cashierAuditBuilder.build(cashierResult);
    XLSX.utils.book_append_sheet(workbook, wsPivotHost, 'Pivot Fatura Türü');

    // 5. PQV Reconciliation — side-by-side trial (analyst decision):
    //    the legacy heuristic matcher's columns stay untouched, and the
    //    referential RI|PQV lineage columns render next to them so both
    //    approaches are compared on real files.
    const pqvMatches = this.matcher.matchPqvToSales(records);
    const pqvLineage = computePqvLineage(records);
    const wsPqv = this.pqvSheetBuilder.create(pqvMatches, pqvLineage);
    XLSX.utils.book_append_sheet(workbook, wsPqv, 'PQV-RI');

    // 6. Vendor Ledger (Tedarikçi Cari Hareketleri) — the Layer 3
    //    row-level ledger, rendered from the PRE-COMPUTED cashier-model
    //    result from step 0 (render-only: closure was already verified
    //    inside the model). On a RED gate the builder renders the
    //    bilingual withheld notice instead of population rows — the
    //    export still proceeds (Requirements 5.1, 7.6, 8.1).
    //    The builder also records the header styling cells (black fill,
    //    white bold — approved screenshot) for the post-serialization
    //    style patch (step 7d).
    const { sheet: wsVendorLedger, styleCells: ledgerStyleCells } =
      this.vendorLedgerBuilder.createFromComputed(cashierResult);
    XLSX.utils.book_append_sheet(workbook, wsVendorLedger, 'Tedarikçi Cari Hareketleri');

    // 6b. Audit Trails sheet — ALWAYS present. Every data-quality
    //     warning from the parse lives here in full; the UI only
    //     announces the count and directs the analyst to this page.
    //     A clean parse writes an explicit "no findings" row so absence of
    //     warnings is stated, never inferred.
    const wsAuditTrails = this.dataQualityBuilder.create(warnings);
    XLSX.utils.book_append_sheet(workbook, wsAuditTrails, DataQualitySheet.SHEET_NAME);

    // 6c. Disclaimer sheet — ALWAYS last, ALWAYS present. The static
    //     'Disclaimer of Reconciliation' reference: one bilingual
    //     (Turkish | English) section per invoice class with its
    //     dedicated explanation and dispute procedure. The builder also
    //     records the styling target cells (section-header fills, the
    //     thick TR|EN separator, wrapped text) the post-serialization
    //     style patch (step 7d) consumes.
    const { sheet: wsDisclaimer, styleCells: disclaimerStyleCells } =
      this.disclaimerBuilder.create();
    XLSX.utils.book_append_sheet(workbook, wsDisclaimer, DisclaimerSheet.SHEET_NAME);

    // 7. Serialize and inject the native, refresh-on-load PivotTable.
    //    A PivotInjectionError propagates unchanged and halts the export
    //    before download (Requirement 1.7).
    const bytes = new Uint8Array(
      XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer,
    );
    const pivotedBlob = await injectPivotTable(bytes, buildPivotConfig(records));

    // 7b. Gridline OOXML patches — AFTER pivot injection. SheetJS CE
    //     cannot serialize `showGridLines`, so the patch reuses the
    //     pivotInjector zip-surgery pattern on the already-injected
    //     package: the Vendor Ledger sheet (Requirement 5.5) and the
    //     pivot host sheet (per the approved screenshot — no gridlines).
    //     A GridlinePatchError propagates unchanged and halts the export
    //     before download — no partial workbook is downloaded.
    const ledgerPatchedBlob = await disableSheetGridlines(
      pivotedBlob,
      'Tedarikçi Cari Hareketleri',
    );
    const gridlessBlob = await disableSheetGridlines(ledgerPatchedBlob, 'Pivot Fatura Türü');

    // 7c. Cashier-audit style OOXML patch — registers the fills/fonts/
    //     borders in xl/styles.xml and stamps the style indices onto the
    //     pivot host's audit cells, driven by the coordinates the
    //     renderer recorded in step 4. An AuditStylePatchError propagates
    //     unchanged and halts the export before download.
    const auditStyledBlob = await applyAuditStyles(
      gridlessBlob,
      'Pivot Fatura Türü',
      auditStyleTargets,
    );

    // 7d. Disclaimer formatting — gridlines OFF (per the approved
    //     screenshot) and the bilingual layout styling: black/purple
    //     section-header fills, white bold header text, wrapped
    //     top-aligned paragraphs, and the thick vertical border
    //     separating the Turkish and English columns. Patch errors
    //     propagate unchanged and halt the export before download.
    const disclaimerGridlessBlob = await disableSheetGridlines(
      auditStyledBlob,
      DisclaimerSheet.SHEET_NAME,
    );
    const disclaimerStyledBlob = await applyCellStyles(
      disclaimerGridlessBlob,
      DisclaimerSheet.SHEET_NAME,
      disclaimerStyleCells,
    );

    // 7e. Vendor Ledger header styling — black fill, white bold labels
    //     (approved screenshot; gridlines were already turned off in
    //     step 7b). Patch errors propagate unchanged and halt the export.
    const blob = await applyCellStyles(
      disclaimerStyledBlob,
      'Tedarikçi Cari Hareketleri',
      ledgerStyleCells,
    );

    // 8. Filename convention `{prefix}_Amazon_Payments_{date}.xlsx` (Req 8.2).
    const safeName = this.sanitizeFileName(fileNamePrefix);
    const date = new Date().toISOString().split('T')[0];
    const fileName = `${safeName}_Amazon_Payments_${date}.xlsx`;

    return { blob, fileName };
  }

  private sanitizeFileName(name: string): string {
    return name.replace(/[\s\\/:"*?<>|]+/g, '_').replace(/__+/g, '_');
  }
}
