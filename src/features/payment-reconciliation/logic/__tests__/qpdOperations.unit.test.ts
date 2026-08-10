// QPD operations — quick-pay-discount verification on the ONE merged
// 'QPD' type (settlement invoices are debit entries; clearing rows are
// credit noise). Unexplained debit rows are 'Açık' open items.
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

describe('runQpdOperations — settlement netting', () => {
  it('eliminates fully netted settlement/clearing pairs (nothing emitted)', () => {
    const records: PaymentRecord[] = [
      makeRecord({ invoiceType: 'QPD', invoiceNumber: 'QPD-1', credit: 125.5 }),
      makeRecord({ invoiceType: 'QPD', invoiceNumber: 'QPDTK-1', debit: 125.5 }),
    ];

    const result = runQpdOperations(records);

    expect(result.domain).toBe('QPD');
    expect(result.ownedTypes).toEqual(QPD_OWNED_TYPES);
    expect(result.chains).toHaveLength(0);
    expect(result.netEffect).toBeCloseTo(0, 2);
  });

  it("emits one 'Açık' chain per unmatched settlement, with attention and residual", () => {
    const records: PaymentRecord[] = [
      // Matched pair — eliminated.
      makeRecord({ invoiceType: 'QPD', invoiceNumber: 'QPD-1', credit: 100 }),
      makeRecord({ invoiceType: 'QPD', invoiceNumber: 'QPDTK-1', debit: 100 }),
      // Open settlement — no counterpart at this amount.
      makeRecord({ invoiceType: 'QPD', invoiceNumber: 'QPD-2', credit: 40, discount: 2 }),
    ];

    const result = runQpdOperations(records);

    expect(result.chains).toHaveLength(1);
    const [chain] = result.chains;
    expect(chain.reference).toBe('QPD-2');
    expect(chain.state).toBe('Açık');
    expect(chain.attention).toBe(true);
    expect(chain.net).toBeCloseTo(40, 2);
    expect(chain.discount).toBeCloseTo(2, 2);
    expect(chain.residual).toBeCloseTo(42, 2);
    expect(chain.actionInvoice).toBe('QPD-2');
    expect(chain.narrative).toContain('open quick-pay-discount settlement');

    // Conservation: net effect ties back to raw owned totals.
    expect(result.netEffect).toBeCloseTo(40, 2);
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

  it('output is deterministic: chains sorted by reference', () => {
    const records: PaymentRecord[] = [
      makeRecord({ invoiceType: 'QPD', invoiceNumber: 'QPD-Z', credit: 10 }),
      makeRecord({ invoiceType: 'QPD', invoiceNumber: 'QPD-A', credit: 20 }),
    ];

    const result = runQpdOperations(records);

    expect(result.chains.map(c => c.reference)).toEqual(['QPD-A', 'QPD-Z']);
  });
});
