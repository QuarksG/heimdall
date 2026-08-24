/**
 * Error catalog — the single source of truth for every tax validation code.
 *
 * Each entry defines:
 *   - severity/scope the engine emits the issue with
 *   - downgrade: the policy by which the severity gate may soften the error
 *     to a warning (see DowngradePolicy). Structural gaps and split
 *     exemption codes never soften; base-amount checks soften only when
 *     their own diff is within the 2 TL tolerance.
 *   - Turkish title / explanation / fix shown to vendors
 *   - evidence columns the findings table renders for this code
 *
 * To change validation policy (e.g. make a code blocking or lenient),
 * edit the entry here — no engine or renderer changes needed.
 */
import type { Severity, Scope, TaxErrorCode } from './types';

export type EvidenceColumn = {
  /** 'field' resolves against evidence.fields[key]; 'computed' against evidence.expected|actual|diff. */
  kind: 'field' | 'computed';
  key: string;
  header: string;
};

/**
 * How the severity gate may soften an error to a warning:
 *  - 'whenInvoiceReconciles': downgraded when all invoice-level diffs are
 *    within reconciliationToleranceTL (rounding-noise leniency).
 *  - 'whenDiffWithinTolerance': decided by the finding's OWN diff — warning
 *    when |diff| ≤ reconciliationToleranceTL (2 TL), error above it.
 *    Used for base-amount checks where a few kuruş is noise but a large
 *    gap (e.g. tax-inclusive amount in TaxableAmount) means rejection.
 *  - 'never': always an error (structural gaps, split exemption codes).
 */
export type DowngradePolicy = 'whenInvoiceReconciles' | 'whenDiffWithinTolerance' | 'never';

export type ErrorCatalogEntry = {
  code: TaxErrorCode;
  severity: Severity;
  scope: Scope;
  downgrade: DowngradePolicy;
  title: string;
  explanation: string;
  fix: string;
  columns: EvidenceColumn[];
};

const field = (key: string, header: string): EvidenceColumn => ({ kind: 'field', key, header });
const computed = (key: 'expected' | 'actual' | 'diff', header: string): EvidenceColumn => ({ kind: 'computed', key, header });

const CALC_COLUMNS: EvidenceColumn[] = [
  computed('expected', 'Beklenen (TL)'),
  computed('actual', 'Beyan Edilen (TL)'),
  computed('diff', 'Fark (TL)'),
];

export const ERROR_CATALOG: Record<TaxErrorCode, ErrorCatalogEntry> = {
  MISSING_LINE_EXTENSION_AMOUNT: {
    code: 'MISSING_LINE_EXTENSION_AMOUNT',
    severity: 'error',
    scope: 'line',
    downgrade: 'never',
    title: 'Satır Net Tutarı (LineExtensionAmount) Eksik',
    explanation: 'Satırda LineExtensionAmount alanı bulunamadı veya sayısal olarak okunamadı. Bu alan iskonto sonrası net KDV matrahını taşımalıdır.',
    fix: 'Her ürün satırına iskonto sonrası net tutarı içeren <cbc:LineExtensionAmount> alanını ekleyin.',
    columns: [field('lineExtensionAmount', 'LineExtensionAmount')],
  },
  MISSING_TAXABLE_AMOUNT: {
    code: 'MISSING_TAXABLE_AMOUNT',
    severity: 'error',
    scope: 'line',
    downgrade: 'never',
    title: 'KDV Matrahı (TaxableAmount) Eksik',
    explanation: 'Satırın TaxSubtotal bloğunda TaxableAmount alanı bulunamadı veya okunamadı.',
    fix: 'Her satırın <cac:TaxSubtotal> bloğuna, LineExtensionAmount ile aynı değeri taşıyan <cbc:TaxableAmount> ekleyin.',
    columns: [field('taxableAmount', 'TaxableAmount')],
  },
  MISSING_TAX_RATE: {
    code: 'MISSING_TAX_RATE',
    severity: 'error',
    scope: 'line',
    downgrade: 'never',
    title: 'Vergi Oranı (Percent) Eksik',
    explanation: 'Satırda vergi oranı ne TaxSubtotal içinde ne de Item/ClassifiedTaxCategory içinde bulundu.',
    fix: 'Her satırın <cac:TaxSubtotal> bloğuna <cbc:Percent> alanını ekleyin (örn. 20).',
    columns: [field('percent', 'Oran (%)')],
  },
  MISSING_TAX_AMOUNT: {
    code: 'MISSING_TAX_AMOUNT',
    severity: 'error',
    scope: 'line',
    downgrade: 'never',
    title: 'Vergi Tutarı (TaxAmount) Eksik',
    explanation: 'Satırda vergi tutarı ne TaxSubtotal içinde ne de TaxTotal içinde bulundu.',
    fix: 'Her satırın <cac:TaxSubtotal> bloğuna <cbc:TaxAmount> alanını ekleyin.',
    columns: [field('taxAmount', 'TaxAmount')],
  },
  TAXABLE_NOT_EQUAL_LINE_NET: {
    code: 'TAXABLE_NOT_EQUAL_LINE_NET',
    severity: 'error',
    scope: 'line',
    downgrade: 'whenInvoiceReconciles',
    title: 'KDV Matrahı Satır Net Tutarına Eşit Değil',
    explanation: 'TaxableAmount, iskonto sonrası satır net tutarı olan LineExtensionAmount ile eşleşmiyor. Amazon sistemi bu iki alanın eşitliğini zorunlu tutar.',
    fix: 'TaxableAmount değerini LineExtensionAmount ile eşitleyin; iskonto varsa her iki alan da iskonto sonrası tutarı taşımalıdır.',
    columns: [field('lineExtensionAmount', 'LineExtensionAmount'), field('taxableAmount', 'TaxableAmount'), computed('diff', 'Fark (TL)')],
  },
  TAX_CALC_DEVIATION: {
    code: 'TAX_CALC_DEVIATION',
    severity: 'error',
    scope: 'line',
    downgrade: 'whenInvoiceReconciles',
    title: 'Satır Vergi Tutarı Hesaplamayla Uyuşmuyor',
    explanation: 'TaxableAmount × Percent ÷ 100 hesabı, beyan edilen TaxAmount ile 0.02 TL toleransın üzerinde farklılık gösteriyor. Amazon KDV\u2019yi virgülden sonra 2 basamağa yuvarlayarak hesaplar.',
    fix: 'TaxAmount değerini matrah × oran hesabına göre 2 basamağa yuvarlayarak düzeltin.',
    columns: [field('taxableAmount', 'TaxableAmount'), field('percent', 'Oran (%)'), field('taxAmount', 'TaxAmount'), ...CALC_COLUMNS],
  },
  TAX_EXCLUSIVE_NOT_EQUAL_LINES: {
    code: 'TAX_EXCLUSIVE_NOT_EQUAL_LINES',
    severity: 'error',
    scope: 'document',
    downgrade: 'whenInvoiceReconciles',
    title: 'TaxExclusiveAmount Satır Net Toplamına Eşit Değil',
    explanation: 'LegalMonetaryTotal/TaxExclusiveAmount, tüm satırların LineExtensionAmount toplamıyla eşleşmiyor.',
    fix: 'TaxExclusiveAmount değerini satır net tutarlarının toplamına eşitleyin.',
    columns: [field('taxExclusiveAmount', 'TaxExclusiveAmount'), field('lineNetTotal', 'Satır Net Toplamı'), computed('diff', 'Fark (TL)')],
  },
  DOC_TAX_TOTAL_MISMATCH: {
    code: 'DOC_TAX_TOTAL_MISMATCH',
    severity: 'error',
    scope: 'document',
    downgrade: 'whenInvoiceReconciles',
    title: 'Dip Toplam Vergi (TaxTotal) Satır Vergileriyle Uyuşmuyor',
    explanation: 'Belge düzeyindeki TaxTotal/TaxAmount, satırlardaki vergi tutarlarının toplamıyla eşleşmiyor.',
    fix: 'Dip toplam TaxAmount değerini satır vergi tutarlarının toplamına eşitleyin.',
    columns: [field('docTaxAmount', 'TaxTotal (Dip)'), field('lineTaxTotal', 'Satır Vergi Toplamı'), computed('diff', 'Fark (TL)')],
  },
  DOC_SUBTOTAL_MISSING_TAXABLE: {
    code: 'DOC_SUBTOTAL_MISSING_TAXABLE',
    severity: 'error',
    scope: 'document',
    downgrade: 'whenInvoiceReconciles',
    title: 'Dip Toplam TaxSubtotal İçinde KDV Matrahı Eksik',
    explanation: 'Belge düzeyindeki TaxSubtotal bloğunda TaxableAmount alanı bulunamadı.',
    fix: 'Dip toplam <cac:TaxSubtotal> bloğuna, satır matrahlarının toplamını taşıyan <cbc:TaxableAmount> ekleyin.',
    columns: [field('percent', 'Oran (%)'), field('taxAmount', 'TaxAmount')],
  },
  DOC_SUBTOTAL_TAX_CALC_DEVIATION: {
    code: 'DOC_SUBTOTAL_TAX_CALC_DEVIATION',
    severity: 'error',
    scope: 'document',
    downgrade: 'whenDiffWithinTolerance',
    title: 'Dip Toplam Vergi Tutarı Hesaplamayla Uyuşmuyor',
    explanation: 'Dip toplam TaxableAmount × Percent ÷ 100 hesabı, beyan edilen TaxAmount ile uyuşmuyor. Genellikle TaxableAmount alanına yanlışlıkla vergi DAHİL tutarın yazılmasından kaynaklanır.',
    fix: 'Dip toplam TaxableAmount alanına vergi HARİÇ matrahı (satır netlerinin toplamı, TaxExclusiveAmount ile aynı değer) yazın.',
    columns: [field('taxableAmount', 'TaxableAmount'), field('percent', 'Oran (%)'), field('taxAmount', 'TaxAmount'), ...CALC_COLUMNS],
  },
  DOC_TAXABLE_NOT_EQUAL_LINES: {
    code: 'DOC_TAXABLE_NOT_EQUAL_LINES',
    severity: 'error',
    scope: 'document',
    downgrade: 'whenDiffWithinTolerance',
    title: 'Dip Toplam KDV Matrahı Satır Net Toplamına Eşit Değil',
    explanation: 'Dip toplam TaxableAmount, aynı vergi grubundaki satırların net toplamıyla eşleşmiyor. Amazon sistemi TaxableAmount = LineExtensionAmount toplamı eşitliğini zorunlu tutar; sağlanmazsa fatura reddedilir.',
    fix: 'Dip toplam TaxableAmount değerini ilgili vergi grubundaki satır net tutarlarının toplamına eşitleyin.',
    columns: [field('taxableAmount', 'TaxableAmount (Dip)'), field('groupLineNetTotal', 'Grup Satır Net Toplamı'), computed('diff', 'Fark (TL)')],
  },
  DOC_SUBTOTAL_WITHOUT_LINES: {
    code: 'DOC_SUBTOTAL_WITHOUT_LINES',
    severity: 'warning',
    scope: 'document',
    downgrade: 'whenInvoiceReconciles',
    title: 'Dip Toplam Vergi Grubunun Satır Karşılığı Yok',
    explanation: 'Belge düzeyinde tanımlı bu vergi grubu (oran + tür) hiçbir satırla eşleştirilemedi.',
    fix: 'Dip toplam vergi gruplarının satırlardaki vergi türü ve oranlarıyla birebir örtüştüğünü kontrol edin.',
    columns: [field('taxableAmount', 'TaxableAmount'), field('percent', 'Oran (%)'), field('taxAmount', 'TaxAmount')],
  },
  DOC_SUBTOTAL_MALFORMED: {
    code: 'DOC_SUBTOTAL_MALFORMED',
    severity: 'error',
    scope: 'document',
    // Lenient for now: the code is new (subtotals used to be skipped
    // silently) and the blast radius of hard-blocking is unverified.
    downgrade: 'whenInvoiceReconciles',
    title: 'Dip Toplam TaxSubtotal Eksik Alanlar Nedeniyle İşlenemedi',
    explanation: 'Belge düzeyindeki bir TaxSubtotal bloğunda TaxAmount veya Percent eksik ya da okunamadı; bu blok doğrulamaya dahil edilemedi.',
    fix: 'Her dip toplam <cac:TaxSubtotal> bloğunda <cbc:TaxAmount> ve <cbc:Percent> alanlarının dolu ve sayısal olduğundan emin olun.',
    columns: [field('taxableAmount', 'TaxableAmount'), field('percent', 'Oran (%)'), field('taxAmount', 'TaxAmount')],
  },
  PAYABLE_TOTAL_MISMATCH: {
    code: 'PAYABLE_TOTAL_MISMATCH',
    severity: 'warning',
    scope: 'document',
    downgrade: 'whenInvoiceReconciles',
    title: 'PayableAmount Hesaplanan Toplama Eşit Değil',
    explanation: 'LegalMonetaryTotal/PayableAmount, satır net + satır vergi toplamından hesaplanan fatura toplamıyla eşleşmiyor.',
    fix: 'PayableAmount değerini net toplam + vergi toplamına eşitleyin.',
    columns: [field('payableAmount', 'PayableAmount'), field('calculatedTotal', 'Hesaplanan Toplam'), computed('diff', 'Fark (TL)')],
  },
  SPLIT_EXEMPTION_CODES: {
    code: 'SPLIT_EXEMPTION_CODES',
    severity: 'error',
    scope: 'document',
    downgrade: 'never',
    title: 'Aynı Vergi Grubunda Birden Fazla İstisna Kodu',
    explanation: 'Aynı vergi grubu (tür + oran) için birden fazla TaxSubtotal, farklı istisna kodlarıyla bildirilmiş. Amazon\u2019un alıcı sistemi her vergi grubu için yalnızca tek bir TaxSubtotal işler; bu durumda TaxableAmount ile satır net toplamı eşleşmez ve fatura reddedilir.',
    fix: 'Tüm vergi matrahlarını tek bir <cac:TaxSubtotal> altında, tek bir istisna koduyla birleştirin.',
    columns: [field('exemptionCodes', 'İstisna Kodları'), field('subtotalCount', 'TaxSubtotal Sayısı'), field('taxableAmount', 'TaxableAmount (Toplam)')],
  },
};

/** Downgrade policy for a code (unknown codes default to the strictest). */
export const downgradePolicyOf = (code: TaxErrorCode): DowngradePolicy =>
  ERROR_CATALOG[code]?.downgrade ?? 'never';
