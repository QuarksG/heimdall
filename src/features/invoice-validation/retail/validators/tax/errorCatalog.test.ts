import { describe, it, expect } from 'vitest';
import { ERROR_CATALOG, downgradePolicyOf } from './errorCatalog';
import type { TaxErrorCode } from './types';

const ALL_CODES: TaxErrorCode[] = [
  'MISSING_LINE_EXTENSION_AMOUNT',
  'MISSING_TAXABLE_AMOUNT',
  'MISSING_TAX_RATE',
  'MISSING_TAX_AMOUNT',
  'TAXABLE_NOT_EQUAL_LINE_NET',
  'TAX_CALC_DEVIATION',
  'TAX_EXCLUSIVE_NOT_EQUAL_LINES',
  'DOC_TAX_TOTAL_MISMATCH',
  'DOC_SUBTOTAL_MISSING_TAXABLE',
  'DOC_SUBTOTAL_TAX_CALC_DEVIATION',
  'DOC_TAXABLE_NOT_EQUAL_LINES',
  'DOC_SUBTOTAL_WITHOUT_LINES',
  'DOC_SUBTOTAL_MALFORMED',
  'PAYABLE_TOTAL_MISMATCH',
  'SPLIT_EXEMPTION_CODES',
];

describe('errorCatalog', () => {
  it('has a complete entry for every code', () => {
    for (const code of ALL_CODES) {
      const entry = ERROR_CATALOG[code];
      expect(entry, `missing catalog entry for ${code}`).toBeDefined();
      expect(entry.code).toBe(code);
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.explanation.length).toBeGreaterThan(0);
      expect(entry.fix.length).toBeGreaterThan(0);
      expect(entry.columns.length).toBeGreaterThan(0);
    }
  });

  it('never softens structural gaps and split exemption codes', () => {
    for (const code of [
      'SPLIT_EXEMPTION_CODES',
      'MISSING_LINE_EXTENSION_AMOUNT',
      'MISSING_TAXABLE_AMOUNT',
      'MISSING_TAX_RATE',
      'MISSING_TAX_AMOUNT',
    ] as TaxErrorCode[]) {
      expect(downgradePolicyOf(code), code).toBe('never');
    }
  });

  it('decides base-amount checks by their own diff magnitude (2 TL rule)', () => {
    expect(downgradePolicyOf('DOC_TAXABLE_NOT_EQUAL_LINES')).toBe('whenDiffWithinTolerance');
    expect(downgradePolicyOf('DOC_SUBTOTAL_TAX_CALC_DEVIATION')).toBe('whenDiffWithinTolerance');
  });

  it('keeps rounding-noise checks lenient via invoice reconciliation', () => {
    expect(downgradePolicyOf('TAX_CALC_DEVIATION')).toBe('whenInvoiceReconciles');
    expect(downgradePolicyOf('TAXABLE_NOT_EQUAL_LINE_NET')).toBe('whenInvoiceReconciles');
    expect(downgradePolicyOf('DOC_SUBTOTAL_MALFORMED')).toBe('whenInvoiceReconciles');
    expect(ERROR_CATALOG.PAYABLE_TOTAL_MISMATCH.severity).toBe('warning');
    expect(ERROR_CATALOG.DOC_SUBTOTAL_WITHOUT_LINES.severity).toBe('warning');
  });
});
