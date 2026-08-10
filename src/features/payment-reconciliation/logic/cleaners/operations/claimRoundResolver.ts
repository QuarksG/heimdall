import { DataSanitizer } from '../dataSanitizer';
import { segmentRounds } from './claimRounds';
import type { ClaimRound, ClaimToken } from './claimRounds';
import type { PaymentRecord } from '../../../types/regional.types';
import { CLOSED_STATES } from './operations.types';
import type { OperationChain, ChainState } from './operations.types';

/**
 * CLAIM ROUND RESOLVER — the shared PQV/PPV state machine, evaluated
 * PER ROUND instead of per aggregated chain.
 *
 * WHY (FKF2025000000378 finding): the previous chain-level evaluation
 * compared Σ(ALL final documents) against the gross of ONLY the last
 * deduction, and its `hasFinal` branch short-circuited the window
 * states — so a chain with two correctly converted rounds AND one open
 * deduction (…SCRSCRPC, 1,745.23, day 77) was reported as
 * 'Reconciled with Slips' pointing at a correct IPV, while the actual
 * open item was never named. Rounds are independent lifecycles and are
 * now resolved independently.
 *
 * EMISSION: one OperationChain PER ROUND (plus one per orphan closure /
 * unshaped document / unattached-finals group). This is not only
 * reporting granularity — the cashier model collects `chain.rows` of
 * chains in OPEN_ITEM_STATES, so closed rounds must not share a chain
 * with an open one or their rows would leak into the open-item ledger.
 *
 * FORMULAS (unchanged, now scoped to one round r):
 *   K1 (knock-out):    |res(r)| ≤ ε over the round's claim rows
 *   K2 (conversion):   |ipv(r) − g(d_r)| ≤ ε on grouped per-document
 *                      totals of the round's PAIRED finals only
 *   window position:   elapsed from d_r's OWN payment date (each
 *                      deduction posts on its own due date)
 */

/** Family-specific wording and vocabulary for the shared machine. */
export interface RoundResolverConfig {
  token: ClaimToken;
  windowDays: number;
  tolerance: number;
  /** Structured pipe reference on this family's final documents. */
  finalDocRefPattern: RegExp;
  /** 'IQV' | 'IPV' — the final-document series name. */
  finalSeries: string;
  /** Fully-converted closed state of this family. */
  convertedState: ChainState;
  /** Reversal-without-deduction state of this family. */
  noClaimState: ChainState;
  /** e.g. 'shortage' | 'price difference' (narratives). */
  claimKind: string;
  /** e.g. 'quantity matching' | 'price matching' (narratives). */
  matchingKind: string;
}

const round2 = DataSanitizer.roundAmount;
const fmt = DataSanitizer.formatNumber;

/** Gross value of a row: cash + indirim (signed). */
function grossSigned(row: PaymentRecord): number {
  return round2(row.credit - row.debit + row.discount);
}

function sumNet(rows: PaymentRecord[]): number {
  return round2(rows.reduce((s, r) => s + r.credit - r.debit, 0));
}

function sumDiscount(rows: PaymentRecord[]): number {
  return round2(rows.reduce((s, r) => s + r.discount, 0));
}

function baseChain(
  reference: string,
  rows: PaymentRecord[],
  claimRows: PaymentRecord[],
  state: ChainState,
  narrative: string,
  actionInvoice: string,
): OperationChain {
  const net = sumNet(claimRows);
  const discount = sumDiscount(claimRows);
  return {
    reference,
    rows,
    state,
    net,
    discount,
    residual: round2(net + discount),
    narrative,
    actionInvoice,
    invoiceDate: rows[0]?.invoiceDate,
    attention: !CLOSED_STATES.has(state),
  };
}

/**
 * Resolves ALL chains of one root reference: one chain per round, plus
 * flag chains for whatever could not be paired. `salesRows` (document
 * trail, display only) lead the FIRST round's rows, mirroring the
 * previous layout.
 */
export function resolveClaimChains(
  reference: string,
  draft: { claimRows: PaymentRecord[]; finalRows: PaymentRecord[]; salesRows: PaymentRecord[] },
  horizon: string | null,
  config: RoundResolverConfig,
): OperationChain[] {
  const segmentation = segmentRounds(
    draft.claimRows,
    draft.finalRows,
    config.token,
    config.finalDocRefPattern,
  );
  const chains: OperationChain[] = [];

  segmentation.rounds.forEach(round => {
    const salesTrail = round.ordinal === 1 ? draft.salesRows : [];
    chains.push(resolveRound(reference, round, salesTrail, horizon, config));
  });

  // Orphan closures: reversal/validation without its deduction. Two
  // stories share this shape and are separated by MONEY DIRECTION:
  //   net > ε  — cash actually went OUT with nothing withheld in this
  //              file: EXCESS CREDIT candidate. Verify the prior
  //              period's Payment Data for the matching deduction; if
  //              it exists nowhere, Amazon paid excess and a clawback
  //              via a future deduction is expected — track it so the
  //              clawback is not later misread as a new withholding.
  //   net ≤ ε  — bookkeeping echo without payout: the deduction may
  //              live in an earlier remittance, or the chain is stuck.
  segmentation.orphanClosures.forEach(orphan => {
    const orphanNet = sumNet(orphan.rows);
    const isExcessCredit = orphanNet > config.tolerance;
    chains.push(
      baseChain(
        reference,
        orphan.rows,
        orphan.rows,
        isExcessCredit ? 'Excess Credit - Review' : config.noClaimState,
        isExcessCredit
          ? `Closure ${orphan.number} pays out ${fmt(orphanNet)} with NO deduction withheld in this file — ` +
            `excess credit candidate. Verify the prior remittance period for the matching ${config.token} ` +
            'at this amount: found → legitimate cross-period release; not found → Amazon paid excess and ' +
            'a clawback via a future deduction is expected.'
          : `Closure ${orphan.number} (${fmt(orphanNet)}) without its deduction in this file — ` +
            `the ${config.token} may belong to an earlier remittance period, or the chain is stuck; analyst attention.`,
        orphan.number,
      ),
    );
  });

  // Claim-typed rows whose number carries no recognizable terminal
  // token (description-classified strays) — referentially anomalous.
  segmentation.unshapedDocs.forEach(doc => {
    chains.push(
      baseChain(
        reference,
        doc.rows,
        doc.rows,
        'Anomaly - Check',
        `Claim-classified document ${doc.number} carries no ${config.token}/${config.token}R/${config.token}RI ` +
          'terminal token — it cannot join any matching round; analyst review required.',
        doc.number,
      ),
    );
  });

  // Final documents that could not be paired to any round.
  if (segmentation.unattachedFinals.length > 0) {
    const finals = segmentation.unattachedFinals;
    const finalDocNet = round2(finals.reduce((s, r) => s + r.debit - r.credit, 0));
    const chain = baseChain(
      reference,
      finals,
      [],
      'Review Final Invoice',
      `Final ${config.finalSeries} document ${fmt(finalDocNet)} without its claim round in this file — ` +
        'the round likely belongs to an earlier remittance period; verify against prior remittances.',
      finals[finals.length - 1].invoiceNumber,
    );
    chain.finalDocNet = finalDocNet;
    chains.push(chain);
  }

  return chains;
}

/** The per-round state machine (the approved vocabulary, unchanged). */
function resolveRound(
  reference: string,
  round: ClaimRound,
  salesTrail: PaymentRecord[],
  horizon: string | null,
  config: RoundResolverConfig,
): OperationChain {
  const claimRows = [...round.deductionRows, ...round.closureRows];
  const rows = [...salesTrail, ...claimRows, ...round.finalRows];

  const net = sumNet(claimRows);
  const discount = sumDiscount(claimRows);
  const residual = round2(net + discount);
  const k1 = Math.abs(residual) <= config.tolerance;

  // Confirmed variance of THIS round: gross of its own deduction doc.
  const roundGross = round2(-round.deductionRows.reduce((s, r) => s + grossSigned(r), 0));

  // K2 on grouped per-document totals of the round's PAIRED finals
  // (the same document may recur as installment slices).
  const perDoc = new Map<string, number>();
  round.finalRows.forEach(r =>
    perDoc.set(r.invoiceNumber, round2((perDoc.get(r.invoiceNumber) ?? 0) + r.debit - r.credit)),
  );
  const finalDocNet = round2([...perDoc.values()].reduce((s, v) => s + v, 0));
  const k2 = Math.abs(finalDocNet - roundGross) <= config.tolerance;
  const docBreakdown = [...perDoc.entries()].map(([n, v]) => `${n}: ${fmt(v)}`).join(', ');
  const hasFinal = round.finalRows.length > 0;

  // Window position from THIS deduction's own due date.
  const dueDate = round.deductionRows[0]?.paymentDate;
  const elapsedDays =
    dueDate !== undefined && horizon !== null
      ? DataSanitizer.daysBetween(dueDate, horizon)
      : undefined;

  let state: ChainState;
  let narrative: string;

  if (round.closure === 'VALIDATED' && hasFinal) {
    if (k1 && k2) {
      state = config.convertedState;
      narrative =
        `Round ${round.ordinal}: confirmed ${config.claimKind} ${fmt(finalDocNet)} — ` +
        `knocked out (K1) and the final document equals the round's variance (K2). Closed, no action.`;
    } else if (k1 && finalDocNet < roundGross - config.tolerance) {
      state = 'Partially Deducted - Pending';
      narrative =
        `Round ${round.ordinal}: final invoice deducting in installments — ${fmt(finalDocNet)} of ` +
        `${fmt(roundGross)} collected so far (${docBreakdown}); remainder expected in following remittances.`;
    } else {
      state = 'Reconciled with Slips';
      narrative =
        `Round ${round.ordinal}: final document total ${fmt(finalDocNet)} disagrees with its round ` +
        `(residual ${fmt(residual)}, confirmed variance ${fmt(roundGross)}; per document: ${docBreakdown}) — ` +
        'over-deduction or broken knock-out; review this conversion.';
    }
  } else if (round.closure === 'VALIDATED') {
    if (k1) {
      state = 'Reconciled - Pending Invoice Creation';
      narrative =
        `Round ${round.ordinal}: RI validation posted, round knocked out (${fmt(roundGross)} confirmed ` +
        `${config.claimKind}) but the ${config.finalSeries} document is not in this file yet — ` +
        'expect it in a following remittance; no action if it arrives.';
    } else {
      state = 'Anomaly - Check';
      narrative =
        `Round ${round.ordinal}: RI validation posted but the round does NOT knock out ` +
        `(residual ${fmt(residual)}) — the conversion arithmetic is broken; analyst review required.`;
    }
  } else if (round.closure === 'RELEASED') {
    if (hasFinal) {
      // A RELEASED round must not convert: the deduction was returned in
      // full, so a final document deducting against it means the money
      // was released and then re-invoiced — over-deduction risk. Never
      // report a clean matching state while a final document is present.
      state = 'Reconciled with Slips';
      narrative =
        `Round ${round.ordinal}: released in full (reversal returned gross) YET final document(s) ` +
        `totalling ${fmt(finalDocNet)} attached (${docBreakdown}) — a released round must not convert; ` +
        'possible over-deduction (released, then re-invoiced); review this conversion.';
    } else if (k1) {
      state = 'Reconciled with Matching';
      narrative =
        `Round ${round.ordinal}: released in full within reference ${reference} — deduction and ` +
        `reversal knock out at gross. Closed, no action.`;
    } else {
      state = 'Anomaly - Check';
      narrative =
        `Round ${round.ordinal}: reversal posted but the round does NOT knock out ` +
        `(residual ${fmt(residual)}) — the release arithmetic is broken; analyst review required.`;
    }
  } else if (hasFinal) {
    // Final document paired to an UNCLOSED deduction — the validation
    // step is missing from the record; never a confident state.
    state = 'Anomaly - Check';
    narrative =
      `Round ${round.ordinal}: final document ${fmt(finalDocNet)} paired to deduction ` +
      `${round.deductionNumber} which has NO closure (no R/RI) — validation missing; analyst review required.`;
  } else if (elapsedDays !== undefined && elapsedDays <= config.windowDays) {
    state = 'Pending Matching - Review';
    narrative =
      `Round ${round.ordinal}: ${fmt(Math.abs(residual))} in matching suspense ` +
      `(day ${elapsedDays} of ${config.windowDays}) — no danger yet, but the vendor sees this as unpaid ` +
      `overdue; inform them it is under ${config.matchingKind}.`;
  } else if (elapsedDays !== undefined) {
    state = 'Pending Invoice Cancelation / Stuck - Review';
    narrative =
      `Round ${round.ordinal}: ${fmt(Math.abs(residual))} withheld, window exhausted ` +
      `(day ${elapsedDays} > ${config.windowDays}) and no official document issued — dispute: possible causes ` +
      'are vendor balance below the remittance trigger, a one-sided cancellation (against policy), ' +
      'or another unprocessed condition.';
  } else {
    state = 'Anomaly - Check';
    narrative =
      `Round ${round.ordinal}: ${fmt(Math.abs(residual))} open but the round's dates are unparseable — ` +
      'window position unknown; analyst review required.';
  }

  const lastFinal = round.finalRows[round.finalRows.length - 1];
  const lastClosure = round.closureRows[round.closureRows.length - 1];
  const actionInvoice =
    lastFinal?.invoiceNumber ?? lastClosure?.invoiceNumber ?? round.deductionNumber;

  return {
    reference,
    rows,
    state,
    net,
    discount,
    residual,
    narrative,
    actionInvoice,
    invoiceDate: rows[0]?.invoiceDate,
    attention: !CLOSED_STATES.has(state),
    rounds: round.ordinal,
    finalDocNet: hasFinal ? finalDocNet : undefined,
    elapsedDays,
  };
}
