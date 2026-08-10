/**
 * TR region configuration — parameterizes the remittance parser.
 *
 * CANONICAL KEYS (fixes BC-05): extraction writes raw values under the
 * ASCII keys in `headers.payment` / `headers.invoice`. The old versions of
 * these keys were mojibake header strings ('Odeme yap?lacak taraf:') that
 * made record access encoding-dependent. Source labels are matched via
 * `mappings` (normalized label prefix → canonical key); the canonical keys
 * themselves never appear in source files.
 */
export const trRegionConfig = {
  countryCode: 'TR',
  currency: 'TRY',
  dateFormat: 'DD-MMM-YYYY',
  markers: {
    paymentStart: 'odeme yap',
    emailDisclaimer: 'bu e-posta, izlenmeyen bir hesaptan gonderilmistir'
  },
  headers: {
    /**
     * Canonical payment-block field keys, in the order the 7 header rows
     * appear on the sheet (this order drives the positional fallback).
     */
    payment: [
      'payee',
      'supplierNumber',
      'vendorSite',
      'paymentNumber',
      'paymentDate',
      'currency',
      'paymentAmount'
    ],
    /** Canonical invoice-table column keys, in on-sheet column order. */
    invoice: [
      'invoiceNumber',
      'invoiceDate',
      'description',
      'discount',
      'paidAmount',
      'remainingAmount'
    ],
    /** Turkish display labels for the exported Payment Data sheet. */
    display: [
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
      'Bakiye'
    ]
  },
  /** Normalized source-label prefix → canonical payment field key. */
  mappings: {
    'odeme yapilacak taraf': 'payee',
    'tedarikci numaran': 'supplierNumber',
    'tedarikci site ad': 'vendorSite',
    'odeme numarasi': 'paymentNumber',
    'odeme tarihi': 'paymentDate',
    'odeme para birimi': 'currency',
    'odeme tutari': 'paymentAmount'
  }
};
