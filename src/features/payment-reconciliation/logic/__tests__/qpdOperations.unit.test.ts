// QPD operations — quick-pay-discount verification (REFERENTIAL model).
// Credit QPD entries are manual-posting NOISE (never chains); debit QPD
// documents are verified per parent wholesale invoice against the
// family's Σ(Uygulanan indirim). Unreferenced debits fall back to the
// pre-referential 'Açık' open-item rule. Wholesale families with applied
// discount and NO settlement document aggregate into one pending chain.
import { describe, it, expect } from 'vitest';
import { runQpdOperations, QPD_OWNED_TYPES } from '../cleaners/operations/QPD_Operations';
import type { PaymentRecord, InvoiceCategory } from '../../types/regional.types';

let rowCounter = 0;

function makeRecord(
  overrides: Partial<PaymentRecord> & { invoiceType: InvoiceCategory },
): PaymentRecord {
  rowCounter += 1;
  return {
    rowNumber: rowCounter,
    payee: 'ACME AŞ',
    supplierNumber: 'S1',
    vendorSite: 'SITE1',
    paymentNumber: `P${rowCounter}`,
    paymentDate: '15-JUL-2026',
    currency: 'TRY',
    paymentAmount: 0,
    invoiceNumber: `INV${rowCounter}`,
    invoiceDate: '01-JUL-2026',
    poNumber: 'PO1',
    description: '',
    discount: 0,
    credit: 0,
    debit: 0,
    ...overrides,
  };
}

/** Wholesale sales root with an applied QPD discount. */
function salesRow(invoiceNumber: string, discount: number): PaymentRecord {
  return makeRecord({
    invoiceType: 'Toptan Satis Faturasi',
    invoiceNumber,
    credit: 10_000,
    discount,
  });
}

/** Referenced debit QPD settlement document. */
function qpdDoc(invoiceNumber: string, parent: string, debit: number): PaymentRecord {
  return makeRecord({
    invoiceType: 'QPD',
    invoiceNumber,
    debit,
    description: `QPD Return Invoice for Original Invoice : ${parent}`,
  });
}

describe('runQpdOperations — referential verification', () => {
  it('credit QPD entries are noise: no chains, but they stay in netEffect', () => {
    const records: PaymentRecord[] = [
      makeRecord({ invoiceType: 'QPD', invoiceNumber: 'QPD-Z', credit: 10 }),
      makeRecord({ invoiceType: 'QPD', invoiceNumber: 'QPD-A', credit: 20 }),
    ];

    const result = runQpdOperations(records);

    expect(result.domain).toBe('QPD');
    expect(result.ownedTypes).toEqual(QPD_OWNED_TYPES);
    expect(result.chains).toHaveLength(0);
    expect(result.netEffect).toBeCloseTo(30, 2);
  });

  it("an unreferenced debit QPD document is an 'Açık' open item", () => {
    const records: PaymentRecord[] = [
      makeRecord({ invoiceType: 'QPD', invoiceNumber: 'QPD-1', credit: 125.5 }),
      makeRecord({ invoiceType: 'QPD', invoiceNumber: 'QPDTK-1', debit: 125.5 }),
    ];

    const result = runQpdOperations(records);

    expect(result.chains).toHaveLength(1);
    const [chain] = result.chains;
    expect(chain.reference).toBe('QPDTK-1');
    expect(chain.state).toBe('Açık');
    expect(chain.attention).toBe(true);
    expect(chain.net).toBeCloseTo(-125.5, 2);
    expect(chain.narrative).toContain('open quick-pay-discount item');
    // Conservation over ALL owned rows (credit noise included).
    expect(result.netEffect).toBeCloseTo(0, 2);
  });

  it('VERIFIED: settlement equals Σ(Uygulanan indirim) over the family', () => {
    const records: PaymentRecord[] = [
      salesRow('AND2024080032793', 4749.12),
      makeRecord({
        invoiceType: 'Eksik Miktar Kesinti Bildirimi',
        invoiceNumber: 'AND2024080032793SC',
        credit: 500,
        discount: -203.62,
      }),
      qpdDoc('QPDDOC-1', 'AND2024080032793', 4545.5),
    ];

    const result = runQpdOperations(records);

    expect(result.chains).toHaveLength(1);
    const [chain] = result.chains;
    expect(chain.reference).toBe('AND2024080032793');
    expect(chain.state).toBe('QPD Deduction Reconciled with Invoice');
    expect(chain.attention).toBe(false);
    expect(chain.residual).toBe(0);
    expect(chain.discount).toBeCloseTo(4545.5, 2);
    expect(chain.finalDocNet).toBeCloseTo(4545.5, 2);
  });

  it("MISMATCH: settlement disagreeing with the family discount is 'Anomaly - Check'", () => {
    const records: PaymentRecord[] = [
      salesRow('AND2024080032793', 4545.5),
      qpdDoc('QPDDOC-1', 'AND2024080032793', 4000),
    ];

    const result = runQpdOperations(records);

    expect(result.chains).toHaveLength(1);
    const [chain] = result.chains;
    expect(chain.state).toBe('Anomaly - Check');
    expect(chain.attention).toBe(true);
    expect(chain.residual).toBeCloseTo(545.5, 2);
    expect(chain.narrative).toContain('QPD MISMATCH');
  });

  it("CROSS-PERIOD: sales root absent → 'Review Final Invoice', never a false mismatch", () => {
    const records: PaymentRecord[] = [qpdDoc('QPDDOC-1', 'AND2023000000001', 999)];

    const result = runQpdOperations(records);

    expect(result.chains).toHaveLength(1);
    const [chain] = result.chains;
    expect(chain.reference).toBe('AND2023000000001');
    expect(chain.state).toBe('Review Final Invoice');
    expect(chain.attention).toBe(true);
    expect(chain.narrative).toContain('not in this file');
  });

  it("DUPLICATE: distinct QPD documents on one deduction → 'Duplicate QPD - Review'", () => {
    const records: PaymentRecord[] = [
      salesRow('AND2024080032793', 100),
      qpdDoc('QPDDOC-1', 'AND2024080032793', 100),
      qpdDoc('QPDDOC-2', 'AND2024080032793', 100),
    ];

    const result = runQpdOperations(records);

    expect(result.chains).toHaveLength(1);
    const [chain] = result.chains;
    expect(chain.state).toBe('Duplicate QPD - Review');
    expect(chain.attention).toBe(true);
    expect(chain.rounds).toBe(2); // how many QPD invoices issued
    expect(chain.narrative).toContain('DUPLICATE QPD issuance');
  });

  it('PENDING SETTLEMENT: applied discount with no QPD document aggregates into one chain', () => {
    const records: PaymentRecord[] = [
      salesRow('AND2024000000001', 150),
      salesRow('AND2024000000002', 250),
    ];

    const result = runQpdOperations(records);

    expect(result.chains).toHaveLength(1);
    const [chain] = result.chains;
    expect(chain.state).toBe('Reconciled - Pending Invoice Creation');
    expect(chain.attention).toBe(true);
    expect(chain.discount).toBeCloseTo(400, 2);
    expect(chain.documentTrail).toHaveLength(2);
    expect(chain.documentTrail?.[0]).toContain('AND2024000000001');
  });

  it('an unmatched clearing document is also an open item (reverse direction)', () => {
    const records: PaymentRecord[] = [
      makeRecord({ invoiceType: 'QPD', invoiceNumber: 'QPDTK-9', debit: 75 }),
    ];

    const result = runQpdOperations(records);

    expect(result.chains).toHaveLength(1);
    expect(result.chains[0].state).toBe('Açık');
    expect(result.chains[0].net).toBeCloseTo(-75, 2);
    expect(result.netEffect).toBeCloseTo(-75, 2);
  });

  it('ignores rows of other invoice types entirely', () => {
    const records: PaymentRecord[] = [
      makeRecord({ invoiceType: 'Toptan Satis Faturasi', credit: 1000 }),
      makeRecord({ invoiceType: 'Giden Havale', debit: 1000 }),
    ];

    const result = runQpdOperations(records);

    expect(result.chains).toHaveLength(0);
    expect(result.netEffect).toBeCloseTo(0, 2);
  });

  it('output is deterministic: attention first, then sorted by reference', () => {
    const records: PaymentRecord[] = [
      // Verified (attention=false) — must sort AFTER attention chains.
      salesRow('AND2024000000009', 50),
      qpdDoc('QPDDOC-9', 'AND2024000000009', 50),
      // Two unreferenced debits (attention=true) — reference order.
      makeRecord({ invoiceType: 'QPD', invoiceNumber: 'QPD-Z', debit: 10 }),
      makeRecord({ invoiceType: 'QPD', invoiceNumber: 'QPD-A', debit: 20 }),
    ];

    const result = runQpdOperations(records);

    expect(result.chains.map(c => c.reference)).toEqual([
      'QPD-A',
      'QPD-Z',
      'AND2024000000009',
    ]);
  });
});
