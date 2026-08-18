// PPV round segmentation — regression for the FKF2025000000378 finding:
// one root carrying THREE independent price-claim lifecycles.
//
//   Round 1: …PC        (3,977.51) → …PCRI       → IPV2025000002975  CLOSED
//   Round 2: …SCRPC     (4,896.16) → …SCRPCRI    → IPV2025000003603  CLOSED
//   Round 3: …SCRSCRPC  (1,745.23) → NO closure                       OPEN
//
// The previous chain-level evaluation aggregated all rounds: K2 compared
// Σ(both IPVs) = 8,873.67 against the gross of ONLY the last deduction
// (the open 1,745.23), failed, and the `hasFinal` branch emitted a single
// 'Reconciled with Slips' chain pointing at a CORRECT IPV — the open
// 1,745.23 deduction was never named. Per-round resolution must emit
// three chains and put the open round into a window state.
import { describe, it, expect } from 'vitest';
import { runPpvOperations } from '../cleaners/operations/PPV_Operations';
import { runPqvOperations } from '../cleaners/operations/PQV_Operations';
import { segmentRounds } from '../cleaners/operations/claimRounds';
import type { PaymentRecord, InvoiceCategory } from '../../types/regional.types';

const ROOT = 'FKF2025000000378';

let rowCounter = 0;

function makeRecord(
  overrides: Partial<PaymentRecord> & { invoiceType: InvoiceCategory },
): PaymentRecord {
  rowCounter += 1;
  return {
    rowNumber: rowCounter,
    payee: 'KONSEPT GIDA',
    supplierNumber: 'S1',
    vendorSite: 'SITE1',
    paymentNumber: `P${rowCounter}`,
    paymentDate: '29-AUG-25',
    currency: 'TRY',
    paymentAmount: 0,
    invoiceNumber: `INV${rowCounter}`,
    invoiceDate: '29-AUG-25',
    poNumber: '',
    description: '',
    discount: 0,
    credit: 0,
    debit: 0,
    ...overrides,
  };
}

/** The FKF chain exactly as observed on the remittance. */
function fkfChainRecords(): PaymentRecord[] {
  return [
    // Round 1 — closed and converted.
    makeRecord({
      invoiceType: 'Fiyat Farki Kesinti Bildirimi',
      invoiceNumber: `${ROOT}PC`,
      description: `Price Claim for Invoice - ${ROOT}`,
      debit: 3977.51,
      paymentDate: '12-SEP-25',
    }),
    makeRecord({
      invoiceType: 'Fiyat Farki Kesinti Bildirimi Ters Kayit',
      invoiceNumber: `${ROOT}PCRI`,
      description: `RI-REVERSAL|PPV|${ROOT}|${ROOT}`,
      credit: 3977.51,
      paymentDate: '30-SEP-25',
    }),
    makeRecord({
      invoiceType: 'Fiyat Farki Kesinti Faturasi',
      invoiceNumber: 'IPV2025000002975',
      description: `RI|PPV|${ROOT}|${ROOT}`,
      debit: 3977.51,
      paymentDate: '23-OCT-25',
    }),
    // Round 2 — closed and converted.
    makeRecord({
      invoiceType: 'Fiyat Farki Kesinti Bildirimi',
      invoiceNumber: `${ROOT}SCRPC`,
      description: `Price Claim for Invoice - ${ROOT}SCR`,
      debit: 4896.16,
      paymentDate: '24-OCT-25',
    }),
    makeRecord({
      invoiceType: 'Fiyat Farki Kesinti Bildirimi Ters Kayit',
      invoiceNumber: `${ROOT}SCRPCRI`,
      description: `RI|PPV|${ROOT}SCR|${ROOT}`,
      credit: 4896.16,
      paymentDate: '14-NOV-25',
    }),
    makeRecord({
      invoiceType: 'Fiyat Farki Kesinti Faturasi',
      invoiceNumber: 'IPV2025000003603',
      description: `RI|PPV|${ROOT}SCR|${ROOT}`,
      debit: 4896.16,
      paymentDate: '23-OCT-25',
    }),
    // Round 3 — OPEN: no PCR/PCRI, no IPV. Posted day 0; horizon below
    // puts it at day 77 — outside the 63-day window.
    makeRecord({
      invoiceType: 'Fiyat Farki Kesinti Bildirimi',
      invoiceNumber: `${ROOT}SCRSCRPC`,
      description: `Price Claim for Invoice - ${ROOT}SCRSCR`,
      debit: 1745.23,
      paymentDate: '12-SEP-25',
    }),
    // File horizon: 28-NOV-25 = 77 days after 12-SEP-25.
    makeRecord({
      invoiceType: 'Toptan Satis Faturasi',
      invoiceNumber: 'IB12025000099999',
      description: '6553UEPU/XTRA/|IB12025000099999',
      credit: 100000,
      paymentDate: '28-NOV-25',
    }),
  ];
}

describe('segmentRounds — referential round pairing', () => {
  it('pairs each deduction with EXACTLY its own R/RI extension and its own final doc', () => {
    const records = fkfChainRecords();
    const claimRows = records.filter(r =>
      r.invoiceType === 'Fiyat Farki Kesinti Bildirimi' ||
      r.invoiceType === 'Fiyat Farki Kesinti Bildirimi Ters Kayit',
    );
    const finalRows = records.filter(r => r.invoiceType === 'Fiyat Farki Kesinti Faturasi');

    const seg = segmentRounds(claimRows, finalRows, 'PC', /RI\|PPV\|([A-Z0-9]+)\|([A-Z0-9]+)/);

    expect(seg.rounds).toHaveLength(3);
    expect(seg.orphanClosures).toHaveLength(0);
    expect(seg.unshapedDocs).toHaveLength(0);
    expect(seg.unattachedFinals).toHaveLength(0);

    const [r1, r2, r3] = seg.rounds;
    expect(r1.deductionNumber).toBe(`${ROOT}PC`);
    expect(r1.closure).toBe('VALIDATED');
    expect(r1.finalRows.map(r => r.invoiceNumber)).toEqual(['IPV2025000002975']);

    expect(r2.deductionNumber).toBe(`${ROOT}SCRPC`);
    expect(r2.closure).toBe('VALIDATED');
    expect(r2.finalRows.map(r => r.invoiceNumber)).toEqual(['IPV2025000003603']);

    expect(r3.deductionNumber).toBe(`${ROOT}SCRSCRPC`);
    expect(r3.closure).toBeNull();
    expect(r3.finalRows).toHaveLength(0);
  });
});

describe('runPpvOperations — FKF2025000000378 regression (per-round states)', () => {
  it('closes rounds 1–2 as converted and surfaces round 3 as the stuck open item', () => {
    const result = runPpvOperations(fkfChainRecords());

    const fkfChains = result.chains.filter(c => c.reference === ROOT);
    expect(fkfChains).toHaveLength(3);

    const closed = fkfChains.filter(
      c => c.state === 'Reconciled with Invoice (IPV series invoice issued)',
    );
    expect(closed).toHaveLength(2);
    expect(closed.every(c => !c.attention)).toBe(true);
    expect(closed.map(c => c.finalDocNet).sort()).toEqual([3977.51, 4896.16]);

    // THE previously hidden open item: named, amount exact, window state.
    const open = fkfChains.find(c => c.actionInvoice === `${ROOT}SCRSCRPC`);
    expect(open).toBeDefined();
    expect(open!.state).toBe('Pending Invoice Cancelation / Stuck - Review');
    expect(open!.attention).toBe(true);
    expect(open!.residual).toBeCloseTo(-1745.23, 2);
    expect(open!.elapsedDays).toBe(77);
    expect(open!.narrative).toContain('1,745.23');

    // No round is misreported as a conversion disagreement.
    expect(fkfChains.some(c => c.state === 'Reconciled with Slips')).toBe(false);

    // Conservation: net effect still ties back to raw owned totals:
    // −3977.51 +3977.51 −4896.16 +4896.16 −4896.16(IPV) −3977.51(IPV) −1745.23
    expect(result.netEffect).toBeCloseTo(-10618.9, 2);
  });

  it('keeps the open round inside the window as Pending Matching (boundary: day 63 of 63)', () => {
    const records = fkfChainRecords().map(r =>
      r.invoiceNumber === 'IB12025000099999' ? { ...r, paymentDate: '30-SEP-25' } : r,
    ); // horizon becomes round 2's reversal, 14-NOV-25 → open PC is exactly 63 days old

    const result = runPpvOperations(records);
    const open = result.chains.find(c => c.actionInvoice === `${ROOT}SCRSCRPC`);

    expect(open).toBeDefined();
    expect(open!.state).toBe('Pending Matching - Review');
    expect(open!.elapsedDays).toBe(63);
  });

  it('an orphan reversal that PAYS OUT is flagged as Excess Credit - Review', () => {
    const result = runPpvOperations([
      makeRecord({
        invoiceType: 'Fiyat Farki Kesinti Bildirimi Ters Kayit',
        invoiceNumber: `${ROOT}PCR`,
        credit: 500, // cash out, nothing withheld in this file
      }),
    ]);

    expect(result.chains).toHaveLength(1);
    expect(result.chains[0].state).toBe('Excess Credit - Review');
    expect(result.chains[0].attention).toBe(true);
    expect(result.chains[0].net).toBeCloseTo(500, 2);
    expect(result.chains[0].narrative).toContain('excess credit');
  });

  it('an orphan reversal WITHOUT payout keeps the cross-period state', () => {
    const result = runPpvOperations([
      makeRecord({
        invoiceType: 'Fiyat Farki Kesinti Bildirimi Ters Kayit',
        invoiceNumber: `${ROOT}PCR`,
        credit: 0, // bookkeeping echo, no cash out
      }),
    ]);

    expect(result.chains).toHaveLength(1);
    expect(result.chains[0].state).toBe('Reconciled without Price Claim');
    expect(result.chains[0].attention).toBe(true);
  });

  it('a released round (PC + PCR, gross knock-out) stays closed', () => {
    const result = runPpvOperations([
      makeRecord({
        invoiceType: 'Fiyat Farki Kesinti Bildirimi',
        invoiceNumber: `${ROOT}PC`,
        debit: 980, // cash clawed NET of quick-pay discount
        discount: -20, // q₁ = −indirim(d₁): gross −1,000 = −980 − 20
      }),
      makeRecord({
        invoiceType: 'Fiyat Farki Kesinti Bildirimi Ters Kayit',
        invoiceNumber: `${ROOT}PCR`,
        credit: 1000, // release GROSS
      }),
    ]);

    expect(result.chains).toHaveLength(1);
    expect(result.chains[0].state).toBe('Reconciled with Matching');
    expect(result.chains[0].attention).toBe(false);
    expect(result.chains[0].residual).toBeCloseTo(0, 2);
  });
});

describe('runPqvOperations — mirrored per-round behavior', () => {
  it('an open SC round beyond the window is Stuck, independent of a closed sibling round', () => {
    const result = runPqvOperations([
      // Round 1 closed: SC + SCR, gross knock-out.
      makeRecord({
        invoiceType: 'Eksik Miktar Kesinti Bildirimi',
        invoiceNumber: `${ROOT}SC`,
        debit: 161780.99,
        paymentDate: '12-SEP-25',
      }),
      makeRecord({
        invoiceType: 'Eksik Miktar Kesinti Bildirimi Ters kayit',
        invoiceNumber: `${ROOT}SCR`,
        credit: 161780.99,
        paymentDate: '30-SEP-25',
      }),
      // Round 2 OPEN: SCRSC without closure, 77 days before horizon.
      makeRecord({
        invoiceType: 'Eksik Miktar Kesinti Bildirimi',
        invoiceNumber: `${ROOT}SCRSC`,
        debit: 42390.44,
        paymentDate: '12-SEP-25',
      }),
      // Horizon carrier.
      makeRecord({
        invoiceType: 'Giden Havale',
        invoiceNumber: 'GIDEN HAVALE: P1',
        debit: 1,
        paymentDate: '28-NOV-25',
      }),
    ]);

    // Terminal-state folding: the released round 1 is an INTERIM event
    // (re-claimed by round 2) — no row of its own; its documents fold
    // into the open round's trail.
    const chains = result.chains.filter(c => c.reference === ROOT);
    expect(chains).toHaveLength(1);
    expect(chains.some(c => c.state === 'Reconciled with Matching')).toBe(false);

    const open = chains[0];
    expect(open.actionInvoice).toBe(`${ROOT}SCRSC`);
    expect(open.state).toBe('Pending Invoice Cancelation / Stuck - Review');
    expect(open.residual).toBeCloseTo(-42390.44, 2);
    expect(open.elapsedDays).toBe(77);
    expect(open.documentTrail).toContain(`${ROOT}SC`);
    expect(open.documentTrail).toContain(`${ROOT}SCR`);
    expect(open.narrative).toContain('released and re-claimed');
    // Cashier safety: folded records must NOT enter the open chain's rows.
    expect(open.rows.map(r => r.invoiceNumber)).toEqual([`${ROOT}SCRSC`]);
  });

  it('SPI2022000000504 regression: a foreign-referenced IQV must not glue onto a released round', () => {
    const SPI = 'SPI2022000000504';
    const result = runPqvOperations([
      // Round 1 — RELEASED: SC net-of-discount, SCR returns gross.
      makeRecord({
        invoiceType: 'Eksik Miktar Kesinti Bildirimi',
        invoiceNumber: `${SPI}SC`,
        debit: 385560.17,
        discount: -11924.54,
        paymentDate: '04-AUG-22',
      }),
      makeRecord({
        invoiceType: 'Eksik Miktar Kesinti Bildirimi Ters kayit',
        invoiceNumber: `${SPI}SCR`,
        credit: 397484.71,
        paymentDate: '12-SEP-22',
      }),
      // Round 2 — VALIDATED and converted by IQV2022000006283, whose
      // reference correctly names round 2's predecessor (…SCR).
      makeRecord({
        invoiceType: 'Eksik Miktar Kesinti Bildirimi',
        invoiceNumber: `${SPI}SCRSC`,
        debit: 397484.71,
        paymentDate: '20-SEP-22',
      }),
      makeRecord({
        invoiceType: 'Eksik Miktar Kesinti Bildirimi Ters kayit',
        invoiceNumber: `${SPI}SCRSCRI`,
        credit: 397484.71,
        paymentDate: '20-SEP-22',
      }),
      makeRecord({
        invoiceType: 'Eksik Miktar Kesinti Faturasi',
        invoiceNumber: 'IQV2022000006283',
        description: `RI|PQV|${SPI}SCR|${SPI}`,
        debit: 397484.71,
        paymentDate: '29-NOV-22',
      }),
      // Foreign-referenced IQV: first pipe segment names a SIBLING
      // invoice's chain doc; the second segment (the root) must NOT be
      // used for round pairing — previously it glued onto round 1.
      makeRecord({
        invoiceType: 'Eksik Miktar Kesinti Faturasi',
        invoiceNumber: 'IQV2023000000217',
        description: `RI|PQV|SPI2022000010365SCR|${SPI}`,
        debit: 397484.71,
        paymentDate: '06-JAN-23',
      }),
    ]);

    // Terminal-state folding: round 1 (cleanly released, no final doc)
    // is INTERIM — its documents fold into round 2's converted row.
    const chains = result.chains.filter(c => c.reference === SPI);
    expect(chains).toHaveLength(2);
    expect(chains.some(c => c.state === 'Reconciled with Matching')).toBe(false);

    // Round 2: converted, K1 ∧ K2 hold against ITS OWN IQV; round 1's
    // release documents travel in its trail.
    const round2 = chains.find(c => c.actionInvoice === 'IQV2022000006283');
    expect(round2?.state).toBe('Reconciled with Invoice (IQV series invoice issued)');
    expect(round2?.finalDocNet).toBeCloseTo(397484.71, 2);
    expect(round2?.documentTrail).toContain(`${SPI}SC`);
    expect(round2?.documentTrail).toContain(`${SPI}SCR`);

    // The foreign-referenced IQV surfaces for review, not hidden
    // under a 'Reconciled with Matching' round.
    const review = chains.find(c => c.state === 'Review Final Invoice');
    expect(review?.actionInvoice).toBe('IQV2023000000217');
    expect(review?.attention).toBe(true);
  });

  it('a final document genuinely referencing a RELEASED round → Reconciled with Slips', () => {
    const SPI = 'SPI2022000000700';
    const result = runPqvOperations([
      makeRecord({
        invoiceType: 'Eksik Miktar Kesinti Bildirimi',
        invoiceNumber: `${SPI}SC`,
        debit: 1000,
      }),
      makeRecord({
        invoiceType: 'Eksik Miktar Kesinti Bildirimi Ters kayit',
        invoiceNumber: `${SPI}SCR`,
        credit: 1000,
      }),
      // IQV whose reference names round 1's predecessor (the root):
      // released money re-invoiced — must NOT show as clean Matching.
      makeRecord({
        invoiceType: 'Eksik Miktar Kesinti Faturasi',
        invoiceNumber: 'IQV2023000000900',
        description: `RI|PQV|${SPI}|${SPI}`,
        debit: 400,
      }),
    ]);

    expect(result.chains).toHaveLength(1);
    expect(result.chains[0].state).toBe('Reconciled with Slips');
    expect(result.chains[0].attention).toBe(true);
    expect(result.chains[0].narrative).toContain('over-deduction');
  });

  it('SEG-style RI reversal paying out with no SC withheld → Excess Credit - Review', () => {
    const SEG = 'SEG2022000004383O';
    const result = runPqvOperations([
      // Round SCRSC ↔ SCRSCR nets — legitimate.
      makeRecord({
        invoiceType: 'Eksik Miktar Kesinti Bildirimi',
        invoiceNumber: `${SEG}SCRSC`,
        description: `Shortage Claim for Invoice - ${SEG}SCR`,
        debit: 1977.52,
      }),
      makeRecord({
        invoiceType: 'Eksik Miktar Kesinti Bildirimi Ters kayit',
        invoiceNumber: `${SEG}SCRSCR`,
        credit: 1977.52,
      }),
      // Orphan RI closure crediting cash: its SCR-round deduction (…SC)
      // is NOT in this file — excess credit candidate.
      makeRecord({
        invoiceType: 'Eksik Miktar Kesinti Bildirimi Ters kayit',
        invoiceNumber: `${SEG}SCRI`,
        description: `RI-REVERSAL|PQV|${SEG}SCR|${SEG}`,
        credit: 1977.52,
      }),
    ]);

    const excess = result.chains.find(c => c.state === 'Excess Credit - Review');
    expect(excess).toBeDefined();
    expect(excess!.actionInvoice).toBe(`${SEG}SCRI`);
    expect(excess!.net).toBeCloseTo(1977.52, 2);

    const netted = result.chains.find(c => c.actionInvoice === `${SEG}SCRSCR`);
    expect(netted?.state).toBe('Reconciled with Matching');
  });
});
