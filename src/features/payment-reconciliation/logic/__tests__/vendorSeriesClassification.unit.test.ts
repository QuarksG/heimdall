// Vendor-series prefix demotion (analyst ruling) — regression for the
// two observed false negatives when the vendor's OWN sales series
// collides with Amazon's reserved prefixes:
//
//   1) C102024000008926QPD  "Creating QPD for parent invoice #C10…"
//      → was coop by bare C1 prefix (rule 13); must be QPD (rule 21).
//   2) C062021000006631     "… For Transaction: V11… Itiraz no: DSPT…"
//      → was coop by bare C0 prefix; must fall to the return rule's
//        EVIDENCE branch (FOR TRANSACTION + 16-char V-token, rule 14).
//
// The vendor's series is learned ONLY from the verified structural
// sales rule (PO path + echo); ≥95% share with ≥5 verified rows.
import { describe, it, expect } from 'vitest';
import {
  buildVendorSeriesNotes,
  classifyByRules,
  inferVendorOwnedSeries,
  VENDOR_SERIES_MIN_SAMPLE,
} from '../classifiers/invoiceClassificationRules';
import { PaymentTransformer } from '../cleaners/paymentTransformer';
import { TrInvoiceClassifier } from '../classifiers/implementations/TrInvoiceClassifier';

/** A verified sales row: PO path + echo in the description. */
function salesRow(invoiceNumber: string) {
  return {
    invoiceNumber,
    description: `6553UEPU/XTRA/|${invoiceNumber}`,
  };
}

/** Five verified C-series sales rows — the inference sample. */
function cSeriesSales() {
  return [
    salesRow('C062021000006631'),
    salesRow('C062021000006632'),
    salesRow('C102024000008926'),
    salesRow('C102024000008927'),
    salesRow('C062021000006633'),
  ];
}

const OWNS_C: ReadonlySet<string> = new Set(['C']);

describe('inferVendorOwnedSeries', () => {
  it('owns C when all verified sales start with C (C0 and C1 both count)', () => {
    expect([...inferVendorOwnedSeries(cSeriesSales())]).toEqual(['C']);
  });

  it('does not fire below the minimum sample', () => {
    const rows = cSeriesSales().slice(0, VENDOR_SERIES_MIN_SAMPLE - 1);
    expect(inferVendorOwnedSeries(rows).size).toBe(0);
  });

  it('does not fire below the 33% share threshold', () => {
    // 2 C-series + 8 IB-series verified sales → 20% share, below 33%.
    const rows = [
      ...cSeriesSales().slice(0, 2),
      salesRow('IB12022000018521'),
      salesRow('IB12022000018522'),
      salesRow('IB12022000018523'),
      salesRow('IB12022000018524'),
      salesRow('IB12022000018525'),
      salesRow('IB12022000018526'),
      salesRow('IB12022000018527'),
      salesRow('IB12022000018528'),
    ];
    expect(inferVendorOwnedSeries(rows).size).toBe(0);
  });

  it('fires at a one-third share (multi-series vendor: C + Y series)', () => {
    // 5 C-series + 10 Y-series verified sales → 33.3% share, ≥ 33%.
    const rows = [
      ...cSeriesSales(),
      ...Array.from({ length: 10 }, (_, i) => salesRow(`YK1202200001852${i}`)),
    ];
    expect([...inferVendorOwnedSeries(rows)]).toEqual(['C']);
  });

  it('ignores unverified rows entirely (no PO path — no vote)', () => {
    const rows = [
      ...cSeriesSales(),
      // C-prefixed rows WITHOUT the verified path do not count.
      { invoiceNumber: 'C199999999999999', description: 'CO-OP AGREEMENT' },
      { invoiceNumber: 'V108888888888888', description: 'VRET' },
    ];
    expect([...inferVendorOwnedSeries(rows)]).toEqual(['C']);
  });

  it('diagnostic notes explain WHY inference is or is not active', () => {
    // Active: 5 verified C-sales + one C-prefixed collision row.
    const active = buildVendorSeriesNotes([
      ...cSeriesSales(),
      { invoiceNumber: 'C102024000008926QPD', description: 'Creating QPD for parent invoice #C102024000008926' },
    ]);
    expect(active).toHaveLength(1);
    expect(active[0]).toContain("ACTIVE for 'C'");

    // Not active — sample too small: collision rows present, 2 verified sales.
    const small = buildVendorSeriesNotes([
      ...cSeriesSales().slice(0, 2),
      { invoiceNumber: 'C102024000008926QPD', description: 'Creating QPD for parent invoice #C102024000008926' },
    ]);
    expect(small).toHaveLength(1);
    expect(small[0]).toContain("NOT active for 'C'");
    expect(small[0]).toContain('only 2 verified sales row(s)');

    // Silent when nothing collides: IB-series vendor, no C/V rows.
    expect(buildVendorSeriesNotes([salesRow('IB12022000018526')])).toHaveLength(0);
  });

  it('never owns a non-reserved series (IB… vendor changes nothing)', () => {
    const rows = [
      salesRow('IB12022000018526'),
      salesRow('IB12022000018527'),
      salesRow('IB12022000018528'),
      salesRow('IB12022000018529'),
      salesRow('IB12022000018530'),
    ];
    expect(inferVendorOwnedSeries(rows).size).toBe(0);
  });
});

describe('classifyByRules — prefix demotion when the vendor owns C', () => {
  it('screenshot 1: QPD settlement referencing a vendor C-invoice → QPD, not coop', () => {
    const inv = 'C102024000008926QPD';
    const desc = 'Creating QPD for parent invoice #C102024000008926';

    // Today's behavior without ownership: bare C1 prefix wins.
    expect(classifyByRules(inv, desc)).toBe('Ticari Isbirligi Faturasi');
    // With ownership: prefix demoted, referential QPD rule (21) wins.
    expect(classifyByRules(inv, desc, { credit: 0, debit: 264, vendorOwnedSeries: OWNS_C }))
      .toBe('QPD');
  });

  it('return-dispute signature: FOR TRANSACTION + V-token + DSPT → return, prefix irrelevant', () => {
    // Observed row: the description repeats the row's own C1 number, but
    // the cited transaction after FOR TRANSACTION is a V-token with a
    // DSPT dispute — the signature rule (12.5) classifies it as return
    // BEFORE coop is ever asked, with or without series ownership.
    const inv = 'C122019000002764';
    const desc = 'C122019000002764 For Transaction: V112019000011640 itiraz no: DSPT215290431';

    expect(classifyByRules(inv, desc))
      .toBe('Iade Edilen Ürünler Için Kesilen Iade Faturasi');
    expect(classifyByRules(inv, desc, { credit: 0, debit: 0, vendorOwnedSeries: OWNS_C }))
      .toBe('Iade Edilen Ürünler Için Kesilen Iade Faturasi');
  });

  it('return-dispute signature: the R1..R12 misfire population classifies as return', () => {
    // Observed rows C062021000006631R1..R12: self-echoed C0 numbers used
    // to satisfy coop's R{n}-suffix substring branch at 13.
    const rows = [
      ['C062021000006631R1', 'C062021000006631R1 For Transaction: V112021000000091 Itiraz no: DSPT2065070'],
      ['C062021000006631R10', 'C062021000006631R10 For Transaction: V112021000000097 Itiraz no: DSPT206507'],
      ['C062021000006631R12', 'C062021000006631R12 For Transaction: V112021000000142 Itiraz no: DSPT206507'],
    ] as const;

    rows.forEach(([inv, desc]) => {
      expect(classifyByRules(inv, desc)).toBe('Iade Edilen Ürünler Için Kesilen Iade Faturasi');
    });
  });

  it('return-dispute signature does NOT fire without the DSPT reference or the V-token', () => {
    // FOR TRANSACTION + V-token but no DSPT → not the signature.
    expect(classifyByRules('C122019000002764', 'For Transaction: V112019000011640 only'))
      .not.toBe('Iade Edilen Ürünler Için Kesilen Iade Faturasi');
    // FOR TRANSACTION + DSPT but the token is not V+digit → not the signature.
    expect(classifyByRules('C122019000002764', 'For Transaction: C155555555555555 Itiraz no: DSPT206507'))
      .toBe('Ticari Isbirligi Faturasi'); // C1-token reference → coop evidence
  });

  it('a C1-token naming a DIFFERENT document remains coop evidence (never demoted)', () => {
    const inv = 'C122019000002764';
    const desc = 'DSPT payback ref C155555555555555';
    expect(classifyByRules(inv, desc, { credit: 0, debit: 0, vendorOwnedSeries: OWNS_C }))
      .toBe('Ticari Isbirligi Faturasi');
  });

  it('screenshot 2: dispute-referenced vendor invoice → return via the signature rule', () => {
    const inv = 'C062021000006631';
    const desc = 'C062021000006631 For Transaction: V112021000000135 Itiraz no: DSPT206507033';

    // The return-dispute signature (12.5) wins with or without ownership.
    expect(classifyByRules(inv, desc))
      .toBe('Iade Edilen Ürünler Için Kesilen Iade Faturasi');
    expect(classifyByRules(inv, desc, { credit: 3, debit: 0, vendorOwnedSeries: OWNS_C }))
      .toBe('Iade Edilen Ürünler Için Kesilen Iade Faturasi');
  });

  it('a prefix-only coop row still classifies as coop — last resort, never unclassified', () => {
    const inv = 'C199999999999999R2'; // C1 prefix, no other signal anywhere
    expect(classifyByRules(inv, '', { credit: 0, debit: 10, vendorOwnedSeries: OWNS_C }))
      .toBe('Ticari Isbirligi Faturasi');
  });

  it('coop EVIDENCE branches are never demoted (keywords win at 13)', () => {
    const inv = 'C062021000006699';
    const desc = 'VOLUME INCENTIVE Q3';
    expect(classifyByRules(inv, desc, { credit: 0, debit: 10, vendorOwnedSeries: OWNS_C }))
      .toBe('Ticari Isbirligi Faturasi');
  });

  it('V-series mirror: QPD referencing a vendor V-invoice → QPD when V is owned', () => {
    const inv = 'V102024000001111QPD';
    const desc = 'QPD Return Invoice for Original Invoice : V102024000001111';
    expect(classifyByRules(inv, desc)).toBe('Iade Edilen Ürünler Için Kesilen Iade Faturasi');
    expect(classifyByRules(inv, desc, { credit: 0, debit: 5, vendorOwnedSeries: new Set(['V']) }))
      .toBe('QPD');
  });

  it('without vendorOwnedSeries the behavior is exactly today\'s (backward compatible)', () => {
    expect(classifyByRules('C102024000008926QPD', 'Creating QPD for parent invoice #C102024000008926'))
      .toBe('Ticari Isbirligi Faturasi');
    expect(classifyByRules('V108888888888888XX', 'no signals here'))
      .toBe('Iade Edilen Ürünler Için Kesilen Iade Faturasi');
  });
});

describe('PaymentTransformer — end-to-end two-pass classification', () => {
  function rawRow(invoiceNumber: string, description: string, paid = '100'): Record<string, string> {
    return {
      payee: 'VENDOR AŞ',
      supplierNumber: 'S1',
      vendorSite: 'SITE1_TR',
      paymentNumber: 'P1',
      paymentDate: '29-NOV-2024',
      currency: 'TRY',
      paymentAmount: '100',
      invoiceNumber,
      invoiceDate: '01-NOV-2024',
      description,
      discount: '0',
      paidAmount: paid,
    };
  }

  it('learns the C series from the file and classifies the QPD settlement correctly', () => {
    const transformer = new PaymentTransformer(new TrInvoiceClassifier());
    const rows = [
      ...cSeriesSales().map(s => rawRow(s.invoiceNumber, s.description)),
      rawRow(
        'C102024000008926QPD',
        'Creating QPD for parent invoice #C102024000008926',
        '(264)', // debit — QPD settlements are debt entries
      ),
    ];

    const records = transformer.transform(rows);
    const qpdRow = records.find(r => r.invoiceNumber === 'C102024000008926QPD');
    expect(qpdRow?.invoiceType).toBe('QPD');

    const salesRows = records.filter(r => r.invoiceType === 'Toptan Satis Faturasi');
    expect(salesRows).toHaveLength(5);
  });
});
