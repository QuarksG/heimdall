import * as XLSX from 'xlsx';
import type { CashierModelResult, AggregationBlock, BalanceCheck } from '../../logic/cashierModel';
import type {
  AuditStyleTargets,
  Layer1StyleTarget,
  Layer2StyleTarget,
} from '../../utils/auditStylePatcher';

/**
 * Cashier Audit renderer for the PIVOT HOST sheet ('Pivot Fatura Türü').
 *
 * The native PivotTable is injected post-serialization anchored at A3 and
 * spans columns A–D (row field + three value fields). The cashier audit
 * tables are laid out from column F onward so the analyst sees the pivot
 * and the model output SIDE BY SIDE on one sheet — and the pivot refresh
 * never collides with the audit cells. NO cells are written in columns
 * A–E (Requirement 4.8).
 *
 * RENDER ONLY: all business logic lives in `logic/cashierModel.ts`.
 * This builder consumes the precomputed `CashierModelResult` and writes
 * cells — it computes nothing.
 *
 * Layout (from F2), per currency block:
 *   [currency heading — multi-currency files only]
 *   KASİYER MODELİ — Layer 1: Fatura Türü Toplamları (Type-Level Aggregation)
 *   header: Fatura Türü | Invoice Type (English) | Sum of Alacak |
 *           Sum of Borç | Sum of Uygulanan indirim | Fark
 *   one row per invoice type present (vocabulary order, from the model)
 *   grand-total row: Kumile Tutar / Grand Total
 *   English column-explanation block (one line per amount column)
 *   [blank]
 *   Layer 2: Balance Check (Bakiye Kontrolü)
 *   header: Türkçe | English | Net Impact (with an Excel AutoFilter over
 *           the header + component rows — first Layer 2 table only, since
 *           a worksheet carries at most ONE AutoFilter range)
 *   component rows in the model's FIXED order — post-spec enhancement:
 *   rows whose cashNet is 0 are NOT rendered (zero items need no analyst
 *   attention); the model keeps emitting the fixed component set
 *   subtotal: Kesintileri Cikardikdan sonra / After the above deduction
 *             = Computed_Havale
 *   row: Actual Giden HAVALE = Actual_Havale
 *   row: Fark / Difference + mutually exclusive gate indication
 *        (GREEN → 'YEŞİL IŞIK — GREEN LIGHT', RED → 'KIRMIZI IŞIK — RED LIGHT')
 *   component audit annotations (when present): UNRESOLVED
 *   conservative-inclusion notes and the QPD-mismatch red flag
 *   (the derived QPD component's annotation — a QPD mismatch also
 *   forces the gate RED, so the Difference row shows RED LIGHT)
 *
 * Single-currency files render exactly one UNLABELED block (matching the
 * approved sample); multi-currency files repeat the pair of tables per
 * currency with a currency heading.
 */

/** 0-based column index of the first audit column ('F'). */
const AUDIT_START_COL = 5;

/** 0-based row index of the first audit row (F2). */
const AUDIT_START_ROW = 1;

/**
 * Layer 1 amount format — accounting-style display per the approved
 * screenshot (post-spec enhancement, supersedes the earlier leading-minus
 * rule of Requirement 2.6 for Layer 1 by explicit user instruction):
 * two decimals, negatives in parentheses, zero as a dash.
 */
const LAYER1_AMOUNT_NUMBER_FORMAT = '#,##0.00;(#,##0.00);"-"';

/**
 * Layer 2 Net Impact format: exactly two decimals, negative values with
 * a leading minus sign rather than parentheses (Requirement 2.6).
 */
const LAYER2_AMOUNT_NUMBER_FORMAT = '#,##0.00;-#,##0.00';

/** Layer 1 block title (Requirement 2.2 rendering). */
const LAYER1_TITLE =
  'KASİYER MODELİ — Layer 1: Fatura Türü Toplamları (Type-Level Aggregation)';

/** Layer 1 header row — bilingual amount headers (post-spec enhancement). */
const LAYER1_HEADERS = [
  'Fatura Türü',
  'Invoice Type (English)',
  'Sum of Alacak / Credit',
  'Sum of Borç / Debit',
  'Sum of Uygulanan indirim / Discount',
  'Fark / Difference',
] as const;

/** Grand-total row label. */
const GRAND_TOTAL_LABEL = 'Kumile Tutar / Grand Total';

/**
 * English column explanations — one non-empty line per amount column;
 * the Fark line states the Sum of Alacak − Sum of Borç computation
 * (Requirement 2.5).
 */
const COLUMN_EXPLANATIONS = [
  'Sum of Alacak / Credit: the total credit amount posted for the invoice type — amounts credited to the vendor account.',
  'Sum of Borç / Debit: the total debit amount posted for the invoice type — amounts debited from the vendor account.',
  'Sum of Uygulanan indirim / Discount: the total discount applied to the invoice type (informational; not part of Fark / Difference).',
  'Fark / Difference: the net cash-basis balance impact of the invoice type, computed as Sum of Alacak / Credit minus Sum of Borç / Debit.',
] as const;

/**
 * Offsets (from AUDIT_START_COL) of the four amount columns in a Layer 1
 * data or grand-total row: Sum of Alacak, Sum of Borç, Sum of Uygulanan
 * indirim, Fark.
 */
const LAYER1_AMOUNT_COLUMN_OFFSETS: readonly number[] = [2, 3, 4, 5];

/** Layer 2 table title (Requirement 4 rendering). */
const LAYER2_TITLE = 'Layer 2: Balance Check (Bakiye Kontrolü)';

/** Layer 2 header row (Requirement 4.1). */
const LAYER2_HEADERS = ['Türkçe', 'English', 'Net Impact'] as const;

/**
 * Subtotal row labels (Requirement 4.2): the row carries Computed_Havale,
 * split over the Türkçe / English label columns.
 */
const SUBTOTAL_TURKISH = 'Kesintileri Cikardikdan sonra';
const SUBTOTAL_ENGLISH = 'After the above deduction';

/** Actual_Havale row label (Requirement 4.3). */
const ACTUAL_HAVALE_LABEL = 'Actual Giden HAVALE';

/** Difference row labels (Requirement 4.4). */
const DIFFERENCE_TURKISH = 'Fark';
const DIFFERENCE_ENGLISH = 'Difference';

/**
 * Mutually exclusive gate indications (Requirements 4.5, 4.6): exactly
 * one renders on the Difference row, keyed on the model's Gate outcome.
 */
const GREEN_LIGHT_INDICATION = 'YEŞİL IŞIK — GREEN LIGHT';
const RED_LIGHT_INDICATION = 'KIRMIZI IŞIK — RED LIGHT';

/**
 * Offset (from AUDIT_START_COL) of the single Net Impact amount column
 * in a Layer 2 row.
 */
const LAYER2_AMOUNT_COLUMN_OFFSETS: readonly number[] = [2];

/** The Layer 1 sales row highlighted with gray fill + bold (styling). */
const LAYER1_SALES_TYPE = 'Toptan Satis Faturasi';

/** The Layer 1 provision rows highlighted with gray fill (styling). */
const LAYER1_PROVISION_TYPES: ReadonlySet<string> = new Set([
  'Alacak Provizyonu',
  'Vadesi Geçmis Alacak Provizyonu',
]);

/** The worksheet plus the styling metadata the OOXML style patcher consumes. */
export interface CashierAuditSheetOutput {
  sheet: XLSX.WorkSheet;
  /**
   * Styling target coordinates recorded while writing rows — the renderer
   * stays render-only; all visual styling (fills, fonts, borders,
   * alignment) is applied post-serialization by
   * `utils/auditStylePatcher.applyAuditStyles`.
   */
  styleTargets: AuditStyleTargets;
}

export class CashierAuditSheet {
  /**
   * Builds the pivot host worksheet: columns A–E stay untouched for the
   * injected PivotTable (A–D) and the spacer (E); per currency, the
   * Layer 1 aggregation table renders from F2 with the Layer 2
   * balance-check table stacked directly below it.
   *
   * Alongside the worksheet, returns the styling target coordinates for
   * the post-serialization OOXML style patch (per-block, so the metadata
   * survives multi-currency files where the tables repeat).
   */
  public build(result: CashierModelResult): CashierAuditSheetOutput {
    const sheet = XLSX.utils.aoa_to_sheet([[]]);
    const styleTargets: AuditStyleTargets = { layer1: [], layer2: [] };

    const multiCurrency = result.aggregationBlocks.length > 1;
    const checksByCurrency = new Map<string, BalanceCheck>(
      result.balanceChecks.map(check => [check.currency, check]),
    );
    let row = AUDIT_START_ROW;

    for (const block of result.aggregationBlocks) {
      row = this.writeAggregationBlock(sheet, block, row, multiCurrency, styleTargets);
      // Blank separator row between Layer 1 and Layer 2.
      row += 1;

      const check = checksByCurrency.get(block.currency);
      if (check) {
        row = this.writeBalanceCheckTable(sheet, check, row, styleTargets);
      }

      // Blank separator row between currency blocks.
      row += 1;
    }

    this.applyColumnWidths(sheet);

    return { sheet, styleTargets };
  }

  /** Convenience wrapper: the worksheet only (see `build`). */
  public create(result: CashierModelResult): XLSX.WorkSheet {
    return this.build(result).sheet;
  }

  /**
   * Writes one currency's Layer 1 block starting at `startRow`; returns
   * the next free row so the caller (and the upcoming Layer 2 writer)
   * can stack content below it.
   */
  private writeAggregationBlock(
    sheet: XLSX.WorkSheet,
    block: AggregationBlock,
    startRow: number,
    labelled: boolean,
    styleTargets: AuditStyleTargets,
  ): number {
    let row = startRow;

    // Currency heading — multi-currency files only; single-currency
    // files render exactly one unlabeled block.
    if (labelled) {
      this.writeRow(sheet, row, [`Para Birimi / Currency: ${block.currency}`]);
      row += 1;
    }

    // SALES INVOICE PERIOD line (analyst instruction): first/last sales
    // invoice date, precomputed by the model — occupies one row directly
    // under the title, so the header row shifts down by one when present.
    const periodRows = block.salesInvoicePeriod ? 1 : 0;

    const target: Layer1StyleTarget = {
      titleRow: row,
      headerRow: row + 1 + periodRows,
      dataRows: [],
      provisionRows: [],
      totalRow: -1, // stamped below, once the data rows are written
      startCol: AUDIT_START_COL,
      endCol: AUDIT_START_COL + LAYER1_HEADERS.length - 1,
      amountCols: LAYER1_AMOUNT_COLUMN_OFFSETS.map(offset => AUDIT_START_COL + offset),
    };

    this.writeRow(sheet, row, [LAYER1_TITLE]);
    row += 1;

    if (block.salesInvoicePeriod) {
      this.writeRow(sheet, row, [
        `Dönem / Period (Toptan Satış — sales invoices only): ` +
          `${block.salesInvoicePeriod.first} → ${block.salesInvoicePeriod.last}`,
      ]);
      row += 1;
    }

    this.writeRow(sheet, row, [...LAYER1_HEADERS]);
    row += 1;

    // One row per invoice type present (order comes from the model).
    for (const typeRow of block.rows) {
      this.writeRow(sheet, row, [
        typeRow.invoiceType,
        typeRow.englishName,
        typeRow.sumCredit,
        typeRow.sumDebit,
        typeRow.sumDiscount,
        typeRow.fark,
      ]);
      this.formatAmountCells(sheet, row, LAYER1_AMOUNT_NUMBER_FORMAT);
      target.dataRows.push(row);
      if (typeRow.invoiceType === LAYER1_SALES_TYPE) target.salesRow = row;
      if (LAYER1_PROVISION_TYPES.has(typeRow.invoiceType)) target.provisionRows.push(row);
      row += 1;
    }

    // Grand-total row.
    this.writeRow(sheet, row, [
      GRAND_TOTAL_LABEL,
      '',
      block.totals.sumCredit,
      block.totals.sumDebit,
      block.totals.sumDiscount,
      block.totals.fark,
    ]);
    this.formatAmountCells(sheet, row, LAYER1_AMOUNT_NUMBER_FORMAT);
    target.totalRow = row;
    styleTargets.layer1.push(target);
    row += 1;

    // English column-explanation block — one line per amount column.
    for (const explanation of COLUMN_EXPLANATIONS) {
      this.writeRow(sheet, row, [explanation]);
      row += 1;
    }

    return row;
  }

  /**
   * Writes one currency's Layer 2 balance-check table starting at
   * `startRow`; returns the next free row.
   *
   * RENDER ONLY: the component rows arrive precomputed and pre-ordered
   * from the model (fixed order per Requirement 4.9) — this writer never
   * reorders or computes. Post-spec enhancement: component rows whose
   * cashNet is 0 are NOT rendered (zero items need no analyst attention);
   * the subtotal, Actual Giden HAVALE and Difference rows always render.
   *
   * An Excel AutoFilter covers the header + rendered component rows.
   * SheetJS supports ONE `!autofilter` range per worksheet, so in
   * multi-currency files only the FIRST Layer 2 table gets the filter.
   *
   * Row sequence: title → header (Türkçe | English | Net Impact) →
   * non-zero component rows → Computed_Havale subtotal → Actual_Havale →
   * Difference + gate indication → component annotations (if any):
   * UNRESOLVED notes and the QPD-mismatch red flag. The annotation loop
   * iterates ALL components regardless of the zero-row render filter,
   * so a flagged component renders its annotation even when its amount
   * row was skipped.
   */
  private writeBalanceCheckTable(
    sheet: XLSX.WorkSheet,
    check: BalanceCheck,
    startRow: number,
    styleTargets: AuditStyleTargets,
  ): number {
    let row = startRow;

    const target: Layer2StyleTarget = {
      titleRow: row,
      headerRow: row + 1,
      componentRows: [],
      subtotalRow: -1, // stamped below, once the component rows are written
      actualRow: -1,
      differenceRow: -1,
      startCol: AUDIT_START_COL,
      endCol: AUDIT_START_COL + LAYER2_HEADERS.length - 1,
      amountCol: AUDIT_START_COL + LAYER2_AMOUNT_COLUMN_OFFSETS[0],
    };

    this.writeRow(sheet, row, [LAYER2_TITLE]);
    row += 1;

    this.writeRow(sheet, row, [...LAYER2_HEADERS]);
    row += 1;

    // Identity component rows — the model's FIXED order; zero-cashNet
    // components are skipped at render time (the model still emits the
    // fixed component set).
    for (const component of check.components) {
      if (component.cashNet === 0) continue;
      this.writeRow(sheet, row, [component.turkishName, component.englishName, component.cashNet]);
      this.formatAmountCells(sheet, row, LAYER2_AMOUNT_NUMBER_FORMAT, LAYER2_AMOUNT_COLUMN_OFFSETS);
      target.componentRows.push(row);
      row += 1;
    }

    // AutoFilter over the header + component rows (first Layer 2 table
    // only — a worksheet supports a single AutoFilter range).
    if (!sheet['!autofilter']) {
      const lastFilterRow =
        target.componentRows.length > 0
          ? target.componentRows[target.componentRows.length - 1]
          : target.headerRow;
      sheet['!autofilter'] = {
        ref: XLSX.utils.encode_range({
          s: { r: target.headerRow, c: target.startCol },
          e: { r: lastFilterRow, c: target.endCol },
        }),
      };
    }

    // Subtotal row: Computed_Havale (Requirement 4.2).
    this.writeRow(sheet, row, [SUBTOTAL_TURKISH, SUBTOTAL_ENGLISH, check.computedHavale]);
    this.formatAmountCells(sheet, row, LAYER2_AMOUNT_NUMBER_FORMAT, LAYER2_AMOUNT_COLUMN_OFFSETS);
    target.subtotalRow = row;
    row += 1;

    // Actual_Havale row (Requirement 4.3).
    this.writeRow(sheet, row, [ACTUAL_HAVALE_LABEL, '', check.actualHavale]);
    this.formatAmountCells(sheet, row, LAYER2_AMOUNT_NUMBER_FORMAT, LAYER2_AMOUNT_COLUMN_OFFSETS);
    target.actualRow = row;
    row += 1;

    // Difference row (Requirement 4.4) with the mutually exclusive gate
    // indication (Requirements 4.5, 4.6): the Difference amount is
    // always shown — on RED even when it displays as zero.
    const gateIndication =
      check.gate === 'GREEN' ? GREEN_LIGHT_INDICATION : RED_LIGHT_INDICATION;
    this.writeRow(sheet, row, [
      DIFFERENCE_TURKISH,
      DIFFERENCE_ENGLISH,
      check.difference,
      gateIndication,
    ]);
    this.formatAmountCells(sheet, row, LAYER2_AMOUNT_NUMBER_FORMAT, LAYER2_AMOUNT_COLUMN_OFFSETS);
    target.differenceRow = row;
    styleTargets.layer2.push(target);
    row += 1;

    // Component audit annotations — rendered only when present, one
    // line per annotated component: UNRESOLVED conservative-inclusion
    // notes (Requirements 6.8, 8.2) and the QPD-mismatch red flag
    // (analyst ruling — the flag renders below the table even when the
    // component's amount row was filtered out as zero).
    for (const component of check.components) {
      if (component.annotation) {
        this.writeRow(sheet, row, [component.annotation]);
        row += 1;
      }
    }

    return row;
  }

  /** Writes one row of values starting at the audit start column (F). */
  private writeRow(sheet: XLSX.WorkSheet, row: number, values: (string | number)[]): void {
    XLSX.utils.sheet_add_aoa(sheet, [values], {
      origin: { r: row, c: AUDIT_START_COL },
    });
  }

  /**
   * Applies the given amount number format to the cells of a row at the
   * given column offsets (from AUDIT_START_COL).
   */
  private formatAmountCells(
    sheet: XLSX.WorkSheet,
    row: number,
    format: string,
    offsets: readonly number[] = LAYER1_AMOUNT_COLUMN_OFFSETS,
  ): void {
    for (const offset of offsets) {
      const cell = sheet[XLSX.utils.encode_cell({ c: AUDIT_START_COL + offset, r: row })];
      if (cell && cell.t === 'n') cell.z = format;
    }
  }

  private applyColumnWidths(sheet: XLSX.WorkSheet): void {
    const widths: XLSX.ColInfo[] = [];
    // A–D: pivot output area; E: spacer.
    widths.push({ wch: 32 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 4 });
    // F..K: the Layer 1 table columns; Layer 2 shares F (Türkçe),
    // G (English), H (Net Impact) and puts the gate indication in I.
    widths.push(
      { wch: 44 }, // Fatura Türü / Türkçe / labels / explanations
      { wch: 44 }, // Invoice Type (English) / English
      { wch: 22 }, // Sum of Alacak / Net Impact
      { wch: 26 }, // Sum of Borç / gate indication
      { wch: 24 }, // Sum of Uygulanan indirim
      { wch: 22 }, // Fark
    );
    sheet['!cols'] = widths;
  }
}
