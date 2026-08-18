// Terminal-state folding — spec: claim-chain-terminal-states.
//
// Analyst ruling (KSA2024000014960 finding): 'Reconciled with Matching'
// means PAID — it may only appear on a chain's TERMINAL round. Interim
// released rounds (deducted → released → re-claimed) are net-zero
// bookkeeping echoes, not auditable events: no row of their own, their
// documents fold into the next emitted row's trail. A chain whose
// terminal closure is RI (…SCRI) must NEVER read Matching — an IQV
// series invoice must follow.
import { describe, it, expect } from 'vitest';
import { runPqvOperations } from '../cleaners/operations/PQV_Operations';
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
    paymentDate: '19-JUL-2024',
    currency: 'TRY',
    paymentAmount: 0,
    invoiceNumber: `INV${rowCounter}`,
    invoiceDate: '19-JUL-2024',
    poNumber: '2XGE1NAY',
    description: '',
    discount: 0,
    credit: 0,
    debit: 0,
    ...overrides,
  };
}

const KSA = 'KSA2024000014960';

/** The real KSA2024000014960 chain: 3 rounds, ending in IQV conversion. */
function ksaChainRecords(): PaymentRecord[] {
  return [
    makeRecord({
      invoiceType: 'Toptan Satis Faturasi',
      invoiceNumber: KSA,
      credit: 1210477.5,
    }),
    // Round 1 — SC in two installments, released in full by SCR.
    makeRecord({
      invoiceType: 'Eksik Miktar Kesinti Bildirimi',
      invoiceNumber: `${KSA}SC`,
      description: `Shortage Claim for Invoice - ${KSA}`,
      debit: 19444.01,
    }),
    makeRecord({
      invoiceType: 'Eksik Miktar Kesinti Bildirimi',
      invoiceNumber: `${KSA}SC`,
      description: `Shortage Claim for Invoice - ${KSA}`,
      debit: 1025437.09,
    }),
    makeRecord({
      invoiceType: 'Eksik Miktar Kesinti Bildirimi Ters kayit',
      invoiceNumber: `${KSA}SCR`,
      credit: 1044881.1,
    }),
    // Round 2 — re-claimed, released again.
    makeRecord({
      invoiceType: 'Eksik Miktar Kesinti Bildirimi',
      invoiceNumber: `${KSA}SCRSC`,
      description: `Shortage Claim for Invoice - ${KSA}SCR`,
      debit: 662385.6,
    }),
    makeRecord({
      invoiceType: 'Eksik Miktar Kesinti Bildirimi Ters kayit',
      invoiceNumber: `${KSA}SCRSCR`,
      credit: 662385.6,
    }),
    // Round 3 — re-claimed, shortage confirmed: SCRI validation + IQV.
    makeRecord({
      invoiceType: 'Eksik Miktar Kesinti Bildirimi',
      invoiceNumber: `${KSA}SCRSCRSC`,
      description: `Shortage Claim for Invoice - ${KSA}SCRSCR`,
      debit: 662385.6,
    }),
    makeRecord({
      invoiceType: 'Eksik Miktar Kesinti Bildirimi Ters kayit',
      invoiceNumber: `${KSA}SCRSCRSCRI`,
      description: `RI-REVERSAL|PQV|${KSA}SCRSCR|${KSA}`,
      credit: 662385.6,
    }),
    makeRecord({
      invoiceType: 'Eksik Miktar Kesinti Faturasi',
      invoiceNumber: 'IQV2024000010519',
      description: `RI|PQV|${KSA}SCRSCR|${KSA}`,
      debit: 662385.6,
    }),
  ];
}

describe('terminal-state folding — KSA2024000014960 regression', () => {
  it('emits exactly ONE chain: the IQV conversion; interim releases fold', () => {
    const result = runPqvOperations(ksaChainRecords());
    const chains = result.chains.filter(c => c.reference === KSA);

    expect(chains).toHaveLength(1);
    const chain = chains[0];
    expect(chain.state).toBe('Reconciled with Invoice (IQV series invoice issued)');
    expect(chain.actionInvoice).toBe('IQV2024000010519');
    expect(chain.rounds).toBe(3); // terminal ordinal = total rounds
    expect(chain.finalDocNet).toBeCloseTo(662385.6, 2);

    // The false-negative rows are GONE.
    expect(result.chains.some(c => c.state === 'Reconciled with Matching')).toBe(false);

    // Folded rounds' documents remain auditable in the trail.
    expect(chain.documentTrail).toContain(`${KSA}SC`);
    expect(chain.documentTrail).toContain(`${KSA}SCR`);
    expect(chain.documentTrail).toContain(`${KSA}SCRSC`);
    expect(chain.documentTrail).toContain(`${KSA}SCRSCR`);
    expect(chain.narrative).toContain('released and re-claimed');
  });

  it('a chain truly ENDING in a release keeps ONE Matching row naming the terminal doc', () => {
    const result = runPqvOperations([
      makeRecord({
        invoiceType: 'Eksik Miktar Kesinti Bildirimi',
        invoiceNumber: `${KSA}SC`,
        debit: 1000,
      }),
      makeRecord({
        invoiceType: 'Eksik Miktar Kesinti Bildirimi Ters kayit',
        invoiceNumber: `${KSA}SCR`,
        credit: 1000,
      }),
      makeRecord({
        invoiceType: 'Eksik Miktar Kesinti Bildirimi',
        invoiceNumber: `${KSA}SCRSC`,
        debit: 400,
      }),
      makeRecord({
        invoiceType: 'Eksik Miktar Kesinti Bildirimi Ters kayit',
        invoiceNumber: `${KSA}SCRSCR`,
        credit: 400,
      }),
    ]);

    const chains = result.chains.filter(c => c.reference === KSA);
    expect(chains).toHaveLength(1);
    expect(chains[0].state).toBe('Reconciled with Matching');
    // "Which cycle paid it": the TERMINAL release document.
    expect(chains[0].actionInvoice).toBe(`${KSA}SCRSCR`);
    expect(chains[0].documentTrail).toContain(`${KSA}SC`);
    expect(chains[0].documentTrail).toContain(`${KSA}SCR`);
  });

  it('guard: a terminal RI closure NEVER yields Reconciled with Matching', () => {
    // Direct short form SC → SCRI (no intermediate SCR), no IQV in file.
    const result = runPqvOperations([
      makeRecord({
        invoiceType: 'Eksik Miktar Kesinti Bildirimi',
        invoiceNumber: `${KSA}SC`,
        debit: 500,
      }),
      makeRecord({
        invoiceType: 'Eksik Miktar Kesinti Bildirimi Ters kayit',
        invoiceNumber: `${KSA}SCRI`,
        credit: 500,
      }),
    ]);

    const chains = result.chains.filter(c => c.reference === KSA);
    expect(chains).toHaveLength(1);
    expect(chains[0].state).toBe('Reconciled - Pending Invoice Creation');
    expect(chains[0].state).not.toBe('Reconciled with Matching');
    expect(chains[0].attention).toBe(true);
  });

  it('cashier invariance: folded rounds never inflate the open-item gross', () => {
    // Round 1 released (100), round 2 OPEN (50). The open component must
    // be exactly −50 — the folded round's SC/SCR records must not leak
    // into the open chain's rows.
    const records: PaymentRecord[] = [
      makeRecord({
        invoiceType: 'Toptan Satis Faturasi',
        invoiceNumber: 'SPI2026000000010',
        credit: 1000,
      }),
      makeRecord({
        invoiceType: 'Eksik Miktar Kesinti Bildirimi',
        invoiceNumber: 'SPI2026000000010SC',
        debit: 100,
      }),
      makeRecord({
        invoiceType: 'Eksik Miktar Kesinti Bildirimi Ters kayit',
        invoiceNumber: 'SPI2026000000010SCR',
        credit: 100,
      }),
      makeRecord({
        invoiceType: 'Eksik Miktar Kesinti Bildirimi',
        invoiceNumber: 'SPI2026000000010SCRSC',
        debit: 50,
      }),
      makeRecord({ invoiceType: 'Giden Havale', invoiceNumber: 'GIDEN HAVALE: PX', debit: 950 }),
    ];

    const check = buildBalanceCheck('TRY', records, collectOpenChains(records));

    const openScScr = check.components.find(c => c.key === 'OPEN_SC_SCR');
    expect(openScScr?.cashNet).toBeCloseTo(-50, 2); // NOT −150
    expect(check.computedHavale).toBeCloseTo(950, 2);
    expect(check.actualHavale).toBeCloseTo(950, 2);
    expect(check.difference).toBeCloseTo(0, 2);
    expect(check.gate).toBe('GREEN');
  });
});
