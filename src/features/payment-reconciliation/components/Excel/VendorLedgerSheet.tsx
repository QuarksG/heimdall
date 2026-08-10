import * as XLSX from 'xlsx';
import type { PaymentRecord } from '../../types/regional.types';
import type { CashierModelResult } from '../../logic/cashierModel';

/**
 * Vendor Ledger (Tedarikçi Cari Hareketleri) sheet builder — RENDER ONLY.
 *
 * REDESIGNED as the Layer 3 ROW-LEVEL ledger: the vendor-facing statement
 * of the balance-impact population, keyed off the Gate:
 *
 *   GREEN → a header row with the Payment Data column labels (minus
 *           Bakiye) followed by one row per `result.ledgerRecords` entry,
 *           preserved in Payment Data relative order.
 *   RED   → a single bilingual withheld notice and ZERO population rows
 *           (provisional Open Question 1 behavior).
 *
 * ALL business logic (dispositions, ledger membership, closure
 * verification) lives in `logic/cashierModel.ts` — this builder renders a
 * PRE-COMPUTED `CashierModelResult` and nothing else. Gridline handling is
 * NOT done here: the exporter's post-serialization OOXML patch sets
 * `showGridLines="0"` on this sheet.
 */

/**
 * The 15 Payment Data header labels, in Payment Data order, excluding
 * Bakiye (Requirement 5.3).
 */
export const VENDOR_LEDGER_HEADERS = [
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
] as const;

/** 0-based indices of the numeric amount columns (indirim, Alacak, Borç). */
const LEDGER_AMOUNT_COLUMNS = [12, 13, 14];

/** Non-accounting: two decimals, leading minus (Requirement 2.6 convention). */
const AMOUNT_NUMBER_FORMAT = '#,##0.00;-#,##0.00';

/**
 * The bilingual RED-gate withheld notice (provisional Open Question 1
 * behavior, Requirement 8.1). Small single-purpose builder so a changed
 * analyst ruling is a localized edit.
 */
export function buildRedGateNotice(tolerance: number): string {
  return (
    'DEFTER BEKLETİLİYOR / LEDGER WITHHELD: Bakiye Kontrolü Farkı toleransı ' +
    `(${tolerance.toFixed(2)}) aştığı için tedarikçi cari hareketleri bu dosyada bekletilmektedir; ` +
    'Kapı YEŞİL olduğunda yayınlanacaktır. / The vendor ledger is withheld because the ' +
    `Balance Check |Difference| exceeds the Tolerance (${tolerance.toFixed(2)}); it will be ` +
    'released when the Gate is GREEN.'
  );
}

export class VendorLedgerSheet {
  /** Renders a PRE-COMPUTED cashier-model result. No logic of its own. */
  public createFromComputed(result: CashierModelResult): XLSX.WorkSheet {
    if (result.overallGate === 'RED') {
      // Withheld notice only — zero population rows.
      return XLSX.utils.aoa_to_sheet([[buildRedGateNotice(result.tolerance)]]);
    }

    const dataRows = result.ledgerRecords.map(record => this.mapRecordToRow(record));

    const sheet = XLSX.utils.aoa_to_sheet([[...VENDOR_LEDGER_HEADERS], ...dataRows]);

    this.applyNumberFormatting(sheet, dataRows.length);
    this.applyColumnWidths(sheet);

    return sheet;
  }

  /**
   * Mirrors the Payment Data sheet's field-to-column mapping (minus
   * Bakiye), including its display conventions: zero credit/debit renders
   * as an EMPTY cell, and Yaş (Gün) is empty when unavailable.
   */
  private mapRecordToRow(record: PaymentRecord): (string | number | undefined)[] {
    return [
      record.rowNumber,
      record.payee,
      record.currency,
      record.vendorSite,
      record.paymentNumber,
      record.paymentDate,
      record.invoiceType,
      record.invoiceNumber,
      record.invoiceDate,
      record.agingDays ?? '',
      record.poNumber,
      record.description,
      record.discount,
      record.credit === 0 ? '' : record.credit,
      record.debit === 0 ? '' : record.debit,
    ];
  }

  private applyNumberFormatting(sheet: XLSX.WorkSheet, dataRowCount: number) {
    // Data rows start at 0-based row 1 (header row 0).
    for (let i = 0; i < dataRowCount; i++) {
      LEDGER_AMOUNT_COLUMNS.forEach(c => {
        const cell = sheet[XLSX.utils.encode_cell({ c, r: 1 + i })];
        if (cell && cell.t === 'n') cell.z = AMOUNT_NUMBER_FORMAT;
      });
    }
  }

  private applyColumnWidths(sheet: XLSX.WorkSheet) {
    sheet['!cols'] = [
      { wch: 12 }, // Satır Numarası
      { wch: 28 }, // Ödeme yapılacak taraf
      { wch: 14 }, // Ödeme para birimi
      { wch: 22 }, // Tedarikçi site adı
      { wch: 18 }, // Ödeme Numarası
      { wch: 12 }, // Ödeme tarihi
      { wch: 34 }, // Fatura Türü
      { wch: 22 }, // Fatura Numarası
      { wch: 12 }, // Fatura Tarihi
      { wch: 10 }, // Yaş (Gün)
      { wch: 20 }, // PO: Sipariş Numarası
      { wch: 40 }, // Fatura Açıklaması
      { wch: 18 }, // Uygulanan indirim
      { wch: 16 }, // Alacak
      { wch: 16 }, // Borç
    ];
  }
}
