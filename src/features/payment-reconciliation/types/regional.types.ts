/**
 * THE invoice-type vocabulary — single source. The `InvoiceCategory` union
 * is DERIVED from this array, so tests and consumers can enumerate the
 * vocabulary without maintaining parallel manual lists.
 *
 * Adding a new invoice type: add the member HERE, then its recognition
 * rule in `logic/classifiers/invoiceClassificationRules.ts` and, when the
 * type belongs to a document lifecycle, its handling in the owning
 * operations module (`logic/cleaners/operations/`). Nothing else changes.
 */
export const INVOICE_CATEGORIES = [
  'Giden Havale',
  'Ticari Isbirligi Faturasi',
  'Eksik Miktar Kesinti Bildirimi',
  'Eksik Miktar Kesinti Bildirimi Ters kayit',
  'Fiyat Farki Kesinti Bildirimi',
  'Fiyat Farki Kesinti Bildirimi Ters Kayit',
  'Eksik Miktar Kesinti Faturasi',
  'Arsiv Eksik Miktar Kesinti Faturasi',
  'Fiyat Farki Kesinti Faturasi',
  'Arsiv Fiyat Farki Kesinti Faturasi',
  'Toptan Satis Faturasi',
  'Iade Edilen Ürünler Için Kesilen Iade Faturasi',
  'Vadesi Geçmis Alacak Provizyonu',
  'Alacak Provizyonu',
  'Bank Ücreti',
  'CRTR Geri Ödemesi',
  'AR Faturasi',
  'Amazon Itrazlari',
  'QPD',
  'Itraz Sonucu Geri Odeme',
  'DROPSHIP',
  'Siniflandirilmamis',
  'MISSING_ACTUAL_OR_BAN',
] as const;

export type InvoiceCategory = (typeof INVOICE_CATEGORIES)[number];

/**
 * The normalized payment record — the data contract between the parsing
 * boundary and every consumer (rulebook, matcher, sheets, dashboard).
 *
 * MONEY IS NUMERIC. All amount fields are parsed exactly once by the
 * processor (via `DataSanitizer.parseAmount`) and carried as 2-decimal
 * numbers. Formatting (`#,##0.00`) happens only at render time. Downstream
 * code MUST NOT re-parse amounts from strings.
 */
export interface PaymentRecord {
  rowNumber?: number;
  payee: string;
  supplierNumber: string;
  vendorSite: string;
  paymentNumber: string;
  paymentDate: string;
  currency: string;
  /** Declared payment total from the remittance header block ("Ödeme tutarı:"). */
  paymentAmount: number;
  invoiceNumber: string;
  invoiceDate: string;
  poNumber: string;
  description: string;
  /** Applied discount; may be negative. */
  discount: number;
  /** Alacak. Zero means no credit on this row. */
  credit: number;
  /** Borç. Zero means no debit on this row. */
  debit: number;
  /** Running balance within the payment group, stamped by the processor. */
  balance?: number;
  /**
   * AGE IN DAYS: payment date − invoice date ("Yaş (Gün)").
   * Amazon pays sales invoices on their due date, so the sales population
   * clusters at the vendor's payment term; other types have their own
   * clocks. `undefined` when either date is unparseable or the row is the
   * synthetic transfer row.
   */
  agingDays?: number;
  invoiceType: InvoiceCategory;
}

export interface ParsingResult {
  isValid: boolean;
  records: PaymentRecord[];
  message: string;
  /**
   * Non-blocking data-quality findings (e.g. a payment group whose declared
   * header total does not match its derived invoice net). The parse
   * succeeded; the analyst should review these.
   */
  warnings: string[];
}