/**
 * Characterization tests for the tax validation engine.
 *
 * These pin CURRENT behavior (including known gaps) before later tasks
 * change it deliberately. When Task 4 fixes the severity gate, the
 * Flormar and missing-fields expectations below flip — see comments.
 */
import { describe, it, expect } from 'vitest';
import { XMLToExcelConverter } from '../../../../invoice-parsing/utils/xmlParser';
import { validateAmazonTaxDetailsV2 } from './engine';
import { validateAmazonTaxDetails } from '../taxValidator';
import {
  buildInvoiceXml,
  parseInvoice,
  CLEAN_SPEC,
  FLORMAR_SPEC,
  SPLIT_EXEMPTION_SPEC,
  MISSING_FIELDS_SPEC,
  type FixtureSpec,
} from './testFixtures';

const converter = new XMLToExcelConverter();
const run = (spec: FixtureSpec) => {
  const doc = parseInvoice(buildInvoiceXml(spec));
  return {
    result: validateAmazonTaxDetailsV2(doc, converter),
    wrapperOutput: validateAmazonTaxDetails(doc, converter),
  };
};

const codesOf = (issues: { code: string }[]) => issues.map((i) => i.code).sort();

describe('engine: clean invoice', () => {
  it('produces no issues and the wrapper passes', () => {
    const { result, wrapperOutput } = run(CLEAN_SPEC);
    expect(result.issues).toEqual([]);
    expect(wrapperOutput).toEqual([]);
  });

  it('computes aggregates from line data', () => {
    const { result } = run(CLEAN_SPEC);
    expect(result.aggregates.lineNetTotal).toBe(5025);
    expect(result.aggregates.lineTaxTotal).toBe(904.5);
    expect(result.aggregates.calculatedInvoiceTotal).toBe(5929.5);
    expect(result.aggregates.diffs).toEqual({
      payableVsCalculated: 0,
      taxExclusiveVsLineNet: 0,
      docTaxTotalVsLineTax: 0,
      docTaxableVsLineNet: 0,
    });
    expect(result.reconciledTaxAmounts['KDV-TR-18.00%']).toBe(904.5);
  });
});

describe('engine: Flormar sample (doc TaxableAmount = tax-inclusive total)', () => {
  it('detects the two document-level base errors', () => {
    const { result } = run(FLORMAR_SPEC);
    expect(codesOf(result.issues)).toEqual(['DOC_SUBTOTAL_TAX_CALC_DEVIATION', 'DOC_TAXABLE_NOT_EQUAL_LINES']);
    // Hybrid-diacritics scheme name misses the alias map, so the taxCode
    // keeps the raw name; the rate-only fallback still matched line data.
    for (const issue of result.issues) {
      expect(issue.taxCode).toBe('KATMA DEĞER VERGISI-TR-20.00%');
      expect(issue.scope).toBe('document');
    }
  });

  it('carries a full audit trail on both errors', () => {
    const { result } = run(FLORMAR_SPEC);

    const calc = result.issues.find((i) => i.code === 'DOC_SUBTOTAL_TAX_CALC_DEVIATION')!;
    expect(calc.evidence.formula).toBe('TaxableAmount × Percent ÷ 100');
    expect(calc.evidence.expected).toBe(594);
    expect(calc.evidence.actual).toBe(495);
    expect(calc.evidence.diff).toBe(99);
    expect(calc.evidence.fields.taxableAmount).toEqual({ raw: '2970.00', parsed: 2970 });
    expect(calc.evidence.fields.percent).toEqual({ raw: '20.00', parsed: 20 });
    expect(calc.evidence.fields.taxAmount).toEqual({ raw: '495.00', parsed: 495 });

    const base = result.issues.find((i) => i.code === 'DOC_TAXABLE_NOT_EQUAL_LINES')!;
    expect(base.evidence.expected).toBe(2475);
    expect(base.evidence.actual).toBe(2970);
    expect(base.evidence.diff).toBe(495);
    expect(base.evidence.fields.groupLineNetTotal).toEqual({ raw: null, parsed: 2475 });
  });

  it('gate diffs reconcile to 0.00 while the taxable diff exposes the 495 TL base error', () => {
    const { result } = run(FLORMAR_SPEC);
    expect(result.aggregates.diffs).toEqual({
      payableVsCalculated: 0,
      taxExclusiveVsLineNet: 0,
      docTaxTotalVsLineTax: 0,
      docTaxableVsLineNet: 495, // 2970 (doc subtotal taxable) − 2475 (line nets)
    });
    expect(result.aggregates.documentTaxableTotal).toBe(2970);
  });

  /*
   * REGRESSION (severity-gate fix): both codes are downgradable:false in
   * the catalog, so they survive as errors even though all three invoice
   * totals reconcile to 0.00 — the doc KDV base (2970.00) being the
   * tax-INCLUSIVE amount is a genuine rejection cause at Amazon's side.
   * Before the fix this invoice passed as "hatasız".
   */
  it('REGRESSION: base-amount errors survive the gate and the invoice fails', () => {
    const { result, wrapperOutput } = run(FLORMAR_SPEC);
    expect(result.issues.every((i) => i.severity === 'error')).toBe(true);
    expect(wrapperOutput).toHaveLength(1);
  });

  it('renders an auditable failure message: summary, findings tables, guidance', () => {
    const { wrapperOutput } = run(FLORMAR_SPEC);
    const html = wrapperOutput[0];

    // 1. Aggregates summary card: counts in the header, and the doc KDV
    //    base line must expose WHY the errors fired (all gate diffs are 0).
    expect(html).toContain('Özet');
    expect(html).toContain('Hata: 2 | Uyarı: 0');
    expect(html).toContain('hd-card-header');
    expect(html).toContain('Dip toplam KDV matrahı (TaxableAmount): 2970.00');
    expect(html).toContain('tolerans dışı');

    // 2. Findings tables: one section per code, doc scope → Vergi Grubu column,
    //    with the recomputation evidence (594 expected vs 495 declared).
    expect(html).toContain('hd-findings-section');
    expect(html).toContain('Dip Toplam Vergi Tutarı Hesaplamayla Uyuşmuyor');
    expect(html).toContain('Dip Toplam KDV Matrahı Satır Net Toplamına Eşit Değil');
    expect(html).toContain('<th>Vergi Grubu</th>');
    expect(html).toContain('594.00');
    expect(html).toContain('2970.00');
    expect(html).toContain('hd-diff-cell">99.00');

    // 3. Guidance + sample XML retained
    expect(html).toContain('Vergi Detayları');
    expect(html).toContain('XML Örneği');
  });
});

describe('engine: split exemption codes', () => {
  it('raises SPLIT_EXEMPTION_CODES and survives the downgrade gate', () => {
    const { result, wrapperOutput } = run(SPLIT_EXEMPTION_SPEC);

    const split = result.issues.filter((i) => i.code === 'SPLIT_EXEMPTION_CODES');
    expect(split).toHaveLength(1);
    expect(split[0].severity).toBe('error');
    expect(split[0].taxCode).toBe('KDV-TR-20.00%');

    expect(result.splitExemptionIssues).toHaveLength(1);
    expect(result.splitExemptionIssues[0].entries.map((e) => e.exemptionCode).sort()).toEqual(['335', '350']);

    expect(wrapperOutput).toHaveLength(1);
    expect(wrapperOutput[0]).toContain('Birden Fazla Vergi İstisna Kodu');
  });
});

describe('engine: missing line tax fields', () => {
  it('raises MISSING_* issues for the incomplete line', () => {
    const { result } = run(MISSING_FIELDS_SPEC);
    const line2 = result.issues.filter((i) => i.lineId === '2');
    expect(codesOf(line2)).toEqual(['MISSING_TAXABLE_AMOUNT', 'MISSING_TAX_AMOUNT', 'MISSING_TAX_RATE'].sort());
  });

  it('attaches the item reference to line-scope issues', () => {
    const { result } = run(MISSING_FIELDS_SPEC);
    const line2 = result.issues.filter((i) => i.lineId === '2');
    for (const issue of line2) {
      expect(issue.itemRef).toEqual({ label: 'EKSİK ÜRÜN', source: 'name' });
      expect(issue.evidence.fields).toBeDefined();
    }
  });

  /*
   * REGRESSION (severity-gate fix): MISSING_* codes are structural and
   * downgradable:false — an invoice with a line lacking tax data fails
   * even when totals coincidentally reconcile. Previously it passed.
   */
  it('REGRESSION: structural MISSING_* errors survive the gate and the invoice fails', () => {
    const { result, wrapperOutput } = run(MISSING_FIELDS_SPEC);
    const missing = result.issues.filter((i) => i.code.startsWith('MISSING_'));
    expect(missing.length).toBe(3);
    expect(missing.every((i) => i.severity === 'error')).toBe(true);
    expect(wrapperOutput).toHaveLength(1);
  });
});

describe('engine: unreconciled invoice keeps errors', () => {
  /** Doc tax total 90 vs line tax 100 → diff 10 TL > 2 TL gate → no downgrade. */
  const UNRECONCILED_SPEC: FixtureSpec = {
    lines: [{ id: '1', lineExtensionAmount: '500.00', taxableAmount: '500.00', percent: '20', taxAmount: '100.00', schemeName: 'KDV', itemName: 'ÜRÜN' }],
    docTaxAmount: '90.00',
    docSubtotals: [{ taxableAmount: '500.00', taxAmount: '90.00', percent: '20', schemeName: 'KDV' }],
    taxExclusiveAmount: '500.00',
    payableAmount: '600.00',
  };

  it('errors survive and the wrapper fails the invoice', () => {
    const { result, wrapperOutput } = run(UNRECONCILED_SPEC);

    expect(codesOf(result.issues.filter((i) => i.severity === 'error'))).toEqual([
      'DOC_SUBTOTAL_TAX_CALC_DEVIATION',
      'DOC_TAX_TOTAL_MISMATCH',
    ]);
    expect(result.aggregates.diffs.docTaxTotalVsLineTax).toBe(-10);

    // preferDocumentTotals records a correction and prefers the doc amount.
    expect(result.corrections['KDV-TR-20.00%']).toEqual({
      original: 100,
      corrected: 90,
      reason: 'document subtotal preferred',
    });
    expect(result.reconciledTaxAmounts['KDV-TR-20.00%']).toBe(90);

    expect(wrapperOutput).toHaveLength(1);
  });
});

describe('engine: item reference fallback chain', () => {
  /** Three incomplete lines with progressively sparser identification. */
  const ITEM_REF_SPEC: FixtureSpec = {
    lines: [
      { id: '1', lineExtensionAmount: '10.00', description: 'SADECE AÇIKLAMA VAR' },
      { id: '2', lineExtensionAmount: '10.00', buyersItemId: 'B0TESTASIN9' },
      { id: '3', lineExtensionAmount: '10.00' },
      { id: '4', lineExtensionAmount: '10.00', sellersItemId: 'SKU-42' },
      { id: '5', lineExtensionAmount: '10.00', manufacturersItemId: 'MFG-77' },
    ],
    taxExclusiveAmount: '50.00',
    payableAmount: '50.00',
  };

  it('resolves description → asin → sellerId → manufacturerId → line number', () => {
    const { result } = run(ITEM_REF_SPEC);
    const refOf = (lineId: string) => result.issues.find((i) => i.lineId === lineId)?.itemRef;

    expect(refOf('1')).toEqual({ label: 'SADECE AÇIKLAMA VAR', source: 'description' });
    expect(refOf('2')).toEqual({ label: 'B0TESTASIN9', source: 'asin' });
    expect(refOf('3')).toEqual({ label: 'Satır 3', source: 'lineNo' });
    expect(refOf('4')).toEqual({ label: 'SKU-42', source: 'sellerId' });
    expect(refOf('5')).toEqual({ label: 'MFG-77', source: 'manufacturerId' });
  });
});

describe('engine: malformed document subtotal', () => {
  /** Doc subtotal missing Percent — previously skipped silently. */
  const MALFORMED_SPEC: FixtureSpec = {
    lines: [{ id: '1', lineExtensionAmount: '100.00', taxableAmount: '100.00', percent: '20', taxAmount: '20.00', schemeName: 'KDV', itemName: 'ÜRÜN' }],
    docTaxAmount: '20.00',
    docSubtotals: [{ taxableAmount: '100.00', taxAmount: '20.00', schemeName: 'KDV' }],
    taxExclusiveAmount: '100.00',
    payableAmount: '120.00',
  };

  it('raises DOC_SUBTOTAL_MALFORMED with the raw values read', () => {
    const { result } = run(MALFORMED_SPEC);
    const malformed = result.issues.filter((i) => i.code === 'DOC_SUBTOTAL_MALFORMED');
    expect(malformed).toHaveLength(1);
    expect(malformed[0].taxCode).toBe('KDV (TaxSubtotal #1)');
    expect(malformed[0].evidence.fields.percent).toEqual({ raw: null, parsed: null });
    expect(malformed[0].evidence.fields.taxAmount).toEqual({ raw: '20.00', parsed: null });
    expect(malformed[0].evidence.fields.taxableAmount).toEqual({ raw: '100.00', parsed: null });
  });
});

describe('engine: rounding noise keeps the lenient path', () => {
  /**
   * Five lines each carry a 0.03 TL tax deviation (over the 0.02 per-check
   * tolerance) and the doc TaxTotal differs from the line sum by 0.15 TL,
   * but the whole invoice reconciles well within 2.00 TL. All fired codes
   * are downgradable, so the gate softens them and the invoice passes.
   */
  const ROUNDING_NOISE_SPEC: FixtureSpec = {
    lines: Array.from({ length: 5 }, (_, i) => ({
      id: String(i + 1),
      lineExtensionAmount: '100.00',
      taxableAmount: '100.00',
      percent: '20',
      taxAmount: '20.03',
      schemeName: 'KDV',
      itemName: `ÜRÜN ${i + 1}`,
    })),
    docTaxAmount: '100.00',
    docSubtotals: [{ taxableAmount: '500.00', taxAmount: '100.00', percent: '20', schemeName: 'KDV' }],
    taxExclusiveAmount: '500.00',
    payableAmount: '600.15',
  };

  it('downgrades per-line and doc-total noise to warnings and passes', () => {
    const { result, wrapperOutput } = run(ROUNDING_NOISE_SPEC);

    expect(codesOf(result.issues)).toEqual(
      ['DOC_TAX_TOTAL_MISMATCH', 'TAX_CALC_DEVIATION', 'TAX_CALC_DEVIATION', 'TAX_CALC_DEVIATION', 'TAX_CALC_DEVIATION', 'TAX_CALC_DEVIATION'].sort()
    );
    expect(result.issues.every((i) => i.severity === 'warning')).toBe(true);
    expect(wrapperOutput).toEqual([]);

    // The document subtotal is preferred over the noisy line sum.
    expect(result.corrections['KDV-TR-20.00%']).toEqual({
      original: 100.15,
      corrected: 100,
      reason: 'document subtotal preferred',
    });
  });
});

describe('engine: base-amount checks decided by their own diff (2 TL rule)', () => {
  /**
   * Real-world case: doc TaxableAmount off from line nets by 0.04 TL —
   * vendor rounding noise, not a base-amount mistake. Must be UYARI,
   * not HATA (contrast with the Flormar 495 TL gap, which stays HATA).
   */
  const SMALL_TAXABLE_DIFF_SPEC: FixtureSpec = {
    lines: [{ id: '1', lineExtensionAmount: '1000.04', taxableAmount: '1000.04', percent: '1', taxAmount: '10.00', schemeName: 'KDV', itemName: 'ÜRÜN' }],
    docTaxAmount: '10.00',
    docSubtotals: [{ taxableAmount: '1000.00', taxAmount: '10.00', percent: '1', schemeName: 'KDV' }],
    taxExclusiveAmount: '1000.04',
    payableAmount: '1010.04',
  };

  it('a 0.04 TL doc-taxable gap is a warning and the invoice passes', () => {
    const { result, wrapperOutput } = run(SMALL_TAXABLE_DIFF_SPEC);

    const issue = result.issues.find((i) => i.code === 'DOC_TAXABLE_NOT_EQUAL_LINES')!;
    expect(issue).toBeDefined();
    expect(issue.severity).toBe('warning');
    expect(issue.evidence.diff).toBe(0.04);

    expect(result.issues.some((i) => i.severity === 'error')).toBe(false);
    expect(wrapperOutput).toEqual([]);
  });

  it('a gap just above 2 TL stays an error', () => {
    const spec: FixtureSpec = {
      ...SMALL_TAXABLE_DIFF_SPEC,
      docSubtotals: [{ taxableAmount: '997.00', taxAmount: '10.00', percent: '1', schemeName: 'KDV' }],
    };
    const { result, wrapperOutput } = run(spec);

    const issue = result.issues.find((i) => i.code === 'DOC_TAXABLE_NOT_EQUAL_LINES')!;
    expect(issue.severity).toBe('error');
    expect(issue.evidence.diff).toBe(3.04);
    expect(wrapperOutput).toHaveLength(1);
  });
});
