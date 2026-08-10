// GROSS OPEN ITEMS (analyst ruling 2026-08): open SC/PC rounds withhold
// cash NET of the clawed QPD discount, while the KEEP_QPD component
// (−discount grand total) already carries that claw. With open items at
// Cash_Net the identity therefore missed exactly the open claw and the
// gate stayed RED by that amount (observed 1,166.64 on a real file).
// Open items now participate GROSS = Σ(cash + indirim) — the same
// Kalıntı (Brüt) the Filtered Invoices sheet shows per chain.
import { describe, it, expect } from 'vitest';
import { buildBalanceCheck, collectOpenChains } from '../cashierModel';
import type { PaymentRecord, InvoiceCategory } from '../../types/regional.types';

let rowCounter = 0;

function makeRecord(
  overrides: Partial<PaymentRecord> & { invoiceType: InvoiceCategory },
): PaymentRecord {
  rowCounter += 1;
  return {
    rowNumber: rowCounter,
    payee: 'VENDOR AŞ',
    supplierNumber: 'S1',
    vendorSite: 'SITE1_TR',
    paymentNumber: `P${rowCounter}`,
    paymentDate: '10-JUL-2026',
    currency: 'TRY',
    paymentAmount: 0,
    invoiceNumber: `INV${rowCounter}`,
    invoiceDate: '01-JUL-2026',
    poNumber: '',
    description: '',
    discount: 0,
    credit: 0,
    debit: 0,
    ...overrides,
  };
}

describe('buildBalanceCheck — open items GROSS of clawed discount', () => {
  it('identity closes to GREEN when an open SC round claws QPD discount', () => {
    // Sales: 1000 gross = 950 cash + 50 QPD discount.
    // Open SC: 100 gross claim = 95 cash withheld + 5 discount clawed.
    // Discount grand total: 50 − 5 = 45 → KEEP_QPD derived −45; invoiced
    // QPD debit 45 (with offsetting credit) keeps the mismatch flag off.
    // Cash identity: 1000 (sales gross) − 100 (open gross) − 45 (QPD)
    //              = 855 = actual havale.
    const records: PaymentRecord[] = [
      makeRecord({
        invoiceType: 'Toptan Satis Faturasi',
        invoiceNumber: 'SPI2026000000001',
        credit: 950,
        discount: 50,
      }),
      makeRecord({
        invoiceType: 'Eksik Miktar Kesinti Bildirimi',
        invoiceNumber: 'SPI2026000000001SC',
        debit: 95,
        discount: -5,
      }),
      makeRecord({ invoiceType: 'QPD', invoiceNumber: 'IFC2026000000001', debit: 45 }),
      makeRecord({ invoiceType: 'QPD', invoiceNumber: 'IFC2026000000001TK', credit: 45 }),
      makeRecord({ invoiceType: 'Giden Havale', invoiceNumber: 'GIDEN HAVALE: P1', debit: 855 }),
    ];

    const check = buildBalanceCheck('TRY', records, collectOpenChains(records));

    const openScScr = check.components.find(c => c.key === 'OPEN_SC_SCR');
    // GROSS: −95 cash + −5 claw = −100 — the chain's Kalıntı (Brüt).
    expect(openScScr?.cashNet).toBeCloseTo(-100, 2);

    expect(check.computedHavale).toBeCloseTo(855, 2);
    expect(check.actualHavale).toBeCloseTo(855, 2);
    expect(check.difference).toBeCloseTo(0, 2);
    expect(check.gate).toBe('GREEN');
    expect(check.qpdMismatch).toBe(false);

    // Ledger-closure offset carries the open claw: 50 (sales) + (−5)
    // (open SC claw) + (−45) (QPD derived) − 0 (QPD rows cash-net) = 0.
    expect(check.expectedLedgerOffset).toBeCloseTo(0, 2);
  });

  it('open rounds WITHOUT clawed discount behave exactly as before', () => {
    const records: PaymentRecord[] = [
      makeRecord({
        invoiceType: 'Toptan Satis Faturasi',
        invoiceNumber: 'SPI2026000000002',
        credit: 1000,
      }),
      makeRecord({
        invoiceType: 'Eksik Miktar Kesinti Bildirimi',
        invoiceNumber: 'SPI2026000000002SC',
        debit: 100,
      }),
      makeRecord({ invoiceType: 'Giden Havale', invoiceNumber: 'GIDEN HAVALE: P2', debit: 900 }),
    ];

    const check = buildBalanceCheck('TRY', records, collectOpenChains(records));

    const openScScr = check.components.find(c => c.key === 'OPEN_SC_SCR');
    expect(openScScr?.cashNet).toBeCloseTo(-100, 2); // gross = cash when claw is 0
    expect(check.difference).toBeCloseTo(0, 2);
    expect(check.gate).toBe('GREEN');
  });
});
