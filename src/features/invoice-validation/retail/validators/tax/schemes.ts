/**
 * Tax scheme name normalization and taxCode key construction.
 *
 * Moved verbatim from taxValidator.ts — behavior must stay identical
 * (characterization tests in schemes.test.ts pin it down).
 *
 * Turkish e-invoices use two conventions interchangeably:
 *   - Short code on InvoiceLine level:   "KDV", "ÖTV", "ÖİV", …
 *   - Full name on document TaxTotal:     "KATMA DEĞER VERGİSİ", "ÖZEL TÜKETİM VERGİSİ", …
 *
 * Both refer to the same tax. We normalize to the short canonical form
 * before building taxCode keys so that grouping/matching works correctly.
 */
export const TAX_SCHEME_ALIASES: Record<string, string> = {
  'KATMA DEĞER VERGİSİ': 'KDV',
  'KATMA DEGER VERGISI': 'KDV',
  'ÖZEL TÜKETİM VERGİSİ': 'ÖTV',
  'OZEL TUKETIM VERGISI': 'ÖTV',
  'ÖZEL İLETİŞİM VERGİSİ': 'ÖİV',
  'OZEL ILETISIM VERGISI': 'ÖİV',
  'DAMGA VERGİSİ': 'DV',
  'DAMGA VERGISI': 'DV',
  'BANKA VE SİGORTA MUAMELELERİ VERGİSİ': 'BSMV',
  'BANKA VE SIGORTA MUAMELELERI VERGISI': 'BSMV',
  'KONAKLAMA VERGİSİ': 'KV',
  'KONAKLAMA VERGISI': 'KV',
};

/**
 * Normalize a raw scheme name to its canonical short code.
 * Empty/whitespace input defaults to "KDV". Unknown names pass through
 * unchanged (including hybrid-diacritic spellings not in the alias map,
 * e.g. "KATMA DEĞER VERGISI" — see schemes.test.ts).
 */
export const normalizeTaxScheme = (raw: string): string => {
  const trimmed = (raw || '').trim();
  if (!trimmed) return 'KDV';

  const upper = trimmed.toLocaleUpperCase('tr-TR');

  const directMatch = TAX_SCHEME_ALIASES[trimmed];
  if (directMatch) return directMatch;

  const upperMatch = TAX_SCHEME_ALIASES[upper];
  if (upperMatch) return upperMatch;

  return trimmed;
};

/** Grouping key for a (scheme, rate) pair, e.g. "KDV-TR-18.00%". */
export const buildTaxCode = (scheme: string, rate: number): string => {
  const normalizedScheme = normalizeTaxScheme(scheme);
  const safeRate = Number.isFinite(rate) ? rate : 0;
  return `${normalizedScheme}-TR-${safeRate.toFixed(2)}%`;
};
