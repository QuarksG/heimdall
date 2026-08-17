import { DataSanitizer } from '../dataSanitizer';
import { AMOUNT_MATCH_TOLERANCE } from '../../matchers/openItemFinder';
import { claimChainRoot } from './claimGrammar';
import { resolveClaimChains } from './claimRoundResolver';
import type { RoundResolverConfig } from './claimRoundResolver';
import type { PaymentRecord, InvoiceCategory } from '../../../types/regional.types';
import type { OperationResult, OperationChain } from './operations.types';

/**
 * PQV OPERATIONS — quantity-variance cleaning (shortage claims).
 *
 * BUSINESS PROCESS (proven on real chains): FinOps matches billed vs
 * received quantities when the invoice comes due. Unconfirmed units post
 * an SC deduction ON THE DUE DATE (the SC row's payment date IS the due
 * date). Matching re-rounds (SC→SCR→SCRSC→…) with the deduction shrinking
 * as goods are confirmed, until either the chain releases in full or the
 * variance is confirmed and converts — SCRI validation + final IQV-series
 * document — within due date + PQV_WINDOW_DAYS.
 *
 * MONEY MODEL (QPD round-1 rule): cash columns are NET of the quick-pay
 * discount; gross = cash + indirim on every row. Discount participates in
 * round 1 only: the SC claws −r·G₁, the SCR returns gross, later rounds
 * are discount-free. Hence K1 (gross knock-out) holds for released AND
 * converted chains alike. Whether the QPD settlement document was issued
 * is NOT this module's concern — QPD_Operations owns that.
 *
 * ── NOTATION (declared once, used everywhere) ─────────────────────────
 *   B          root invoice reference (the sales invoice number)
 *   C(B)       claim rows of B: numbers matching B(SC(R|RI)?)+
 *   F(B)       final documents of B: IQV/AQV rows whose structured
 *              reference RI|PQV|{a}|{b} names B in EITHER segment —
 *              attachment prefers the segment whose claim chain is in
 *              this file (Amazon may put a sibling invoice in the other)
 *   d_k        k-th deduction row (…SC / …SCRSC …); d_last = final one
 *   r_k        k-th reversal row (…SCR / …SCRI)
 *   g(row)     gross value of a row = cash + indirim,
 *              where cash = credit − debit (cash columns are NET of QPD)
 *   G₁         gross of the first claim = g(d₁) magnitude
 *   q_k        discount clawed in round k; q₁ = −indirim(d₁), q_k≥2 = 0
 *   net(B)     Σ (credit − debit) over C(B)              — cash netting
 *   disc(B)    Σ indirim over C(B)
 *   res(B)     round2(net(B) + disc(B))                  — GROSS netting
 *   iqv(B)     Σ (debit − credit) over F(B)              — final doc value
 *   due(B)     payment date of the FIRST SC row (SC posts on due date)
 *   H          file horizon = latest payment date in the file ("now")
 *   elapsed(B) days from due(B) to H
 *   L          matching window = PQV_WINDOW_DAYS (60d policy + 72h doc lag)
 *   ε          currency tolerance = 0.01 (one kuruş); "equal" means
 *              |difference| ≤ ε — floating-point guard, NOT a business value
 * ───────────────────────────────────────────────────────────────────────
 *
 * FORMULAS (approved), evaluated PER ROUND since the FKF2025000000378
 * finding in the PPV mirror — one root can carry several independent
 * lifecycles, so chain-level aggregation misdiagnosed multi-round
 * chains and hid open deductions behind converted rounds:
 *   K1 (round knock-out):    |res(r)| ≤ ε over the round's claim rows
 *   K2 (conversion match):   |iqv(r) − g(d_r)| ≤ ε on the round's
 *                            PAIRED finals (grouped per document)
 *   window position:         OPEN while elapsed(d_r) ≤ L, from the
 *                            round's OWN deduction date
 *
 * Everything is REFERENTIAL: chain membership via the invoice-number
 * grammar B(SC(R|RI)?)+; a deduction d is closed ONLY by d+'R'/d+'RI';
 * conversion linkage via the structured pipe reference
 * `RI|PQV|{chain-doc}|{root}` on IQV documents (the segment names the
 * round's predecessor document, so segment+SC identifies the round).
 * Descriptions as free text are never trusted.
 */

/** Matching window: 60-day policy + 72h document-creation lag. */
export const PQV_WINDOW_DAYS = 63;

/** Currency tolerance ε — shared with amount-based open-item matching. */
export const PQV_TOLERANCE = AMOUNT_MATCH_TOLERANCE;

/**
 * Family-pure chain grammar: root followed by rounds of `SC` each
 * optionally closed by `R` (reversal) or `RI` (conversion validation).
 * NOTE: kept for family-purity checks only — ROOT extraction uses the
 * shared MIXED grammar (claimGrammar.ts), because one root can
 * interleave SC and PC rounds (e.g. …SCRPCRI) and a family-only parse
 * would key the chain on a pseudo-root and break conversion linkage.
 */
export const PQV_CHAIN_PATTERN = /^([A-Z0-9]+?)((?:SC(?:RI?)?)+)$/;

/**
 * Structured conversion reference on IQV/AQV documents: RI|PQV|{a}|{b}.
 * BOTH segments are invoice references and EITHER can name the chain —
 * proven on source data: usually {chain-doc}|{root} (root last), but
 * also {root}|{sibling-invoice} (root in the MIDDLE, e.g.
 * RI|PQV|AN12024000000014|AND2024010002496 where the SC chain lives on
 * AN1…14). Attachment therefore tries both segments' roots, preferring
 * the one whose claim chain exists in this file.
 */
export const PQV_FINAL_DOC_REF_PATTERN = /RI\|PQV\|([A-Z0-9]+)\|([A-Z0-9]+)/;

export const PQV_OWNED_TYPES: readonly InvoiceCategory[] = [
  'Eksik Miktar Kesinti Bildirimi',
  'Eksik Miktar Kesinti Bildirimi Ters kayit',
  'Eksik Miktar Kesinti Faturasi',
  'Arsiv Eksik Miktar Kesinti Faturasi',
];

const DEDUCTION_TYPE: InvoiceCategory = 'Eksik Miktar Kesinti Bildirimi';
const REVERSAL_TYPE: InvoiceCategory = 'Eksik Miktar Kesinti Bildirimi Ters kayit';
const FINAL_DOC_TYPES: readonly InvoiceCategory[] = [
  'Eksik Miktar Kesinti Faturasi',
  'Arsiv Eksik Miktar Kesinti Faturasi',
];

const round2 = DataSanitizer.roundAmount;
const fmt = DataSanitizer.formatNumber;

/** Family wiring for the shared per-round state machine. */
const PQV_ROUND_CONFIG: RoundResolverConfig = {
  token: 'SC',
  windowDays: PQV_WINDOW_DAYS,
  tolerance: PQV_TOLERANCE,
  finalDocRefPattern: PQV_FINAL_DOC_REF_PATTERN,
  finalSeries: 'IQV',
  convertedState: 'Reconciled with Invoice (IQV series invoice issued)',
  noClaimState: 'Reconciled without Shortage Claim',
  claimKind: 'shortage',
  matchingKind: 'quantity matching',
};

/**
 * TRUE root of a claim document — strips the longest MIXED SC/PC tail
 * (shared grammar), so interleaved chains key on the same root as their
 * final documents and the cross-family claimed-root sets.
 */
export function pqvChainRoot(invoiceNumber: string): string | null {
  return claimChainRoot(invoiceNumber);
}

/**
 * Candidate chain roots carried by a final document's structured
 * reference, in preference order: LAST segment first (the usual root
 * position), then the middle segment — each stripped of any claim tail.
 */
export function pqvFinalDocCandidateRoots(description: string): string[] {
  const match = description.toUpperCase().match(PQV_FINAL_DOC_REF_PATTERN);
  if (!match) return [];
  const candidates = [match[2], match[1]].map(segment => claimChainRoot(segment) ?? segment);
  return [...new Set(candidates)];
}

/** First candidate root (kept for callers that need a single key). */
export function pqvFinalDocRoot(description: string): string | null {
  return pqvFinalDocCandidateRoots(description)[0] ?? null;
}

/** File horizon H: the latest parseable payment date — "now" for this remittance. */
function fileHorizon(records: PaymentRecord[]): string | null {
  let best: { raw: string; time: number } | null = null;
  records.forEach(record => {
    const parsed = DataSanitizer.parseDateOrNull(record.paymentDate);
    if (parsed && (best === null || parsed.getTime() > best.time)) {
      best = { raw: record.paymentDate, time: parsed.getTime() };
    }
  });
  return best === null ? null : (best as { raw: string; time: number }).raw;
}

interface ChainDraft {
  claimRows: PaymentRecord[];
  finalRows: PaymentRecord[];
  /** Root sales invoice row(s) — traceability + on-time reporting. */
  salesRows: PaymentRecord[];
}

/**
 * THE PQV cleaning operation. Receives the FULL record population (the
 * horizon needs every payment date); owns only the four PQV types.
 *
 * SALES ADJUDICATION (cross-family): this module also adjudicates the
 * on-time-paid population. 'Reconciled on due date' requires NO claim
 * from ANY family — the caller passes the claimed-root sets of the
 * OTHER families (PPV today) via `externalClaimedRoots`; a sales
 * invoice claimed elsewhere is not emitted here (its family's chain
 * carries it in its document trail).
 */
export function runPqvOperations(
  records: PaymentRecord[],
  externalClaimedRoots?: ReadonlySet<string>,
): OperationResult {
  const horizon = fileHorizon(records);
  const drafts = new Map<string, ChainDraft>();
  const draftFor = (reference: string): ChainDraft => {
    if (!drafts.has(reference)) {
      drafts.set(reference, { claimRows: [], finalRows: [], salesRows: [] });
    }
    return drafts.get(reference)!;
  };

  // ---- Chain assembly (strictly referential, two-pass) ----
  // Pass 1: claim rows — these define where the chains live.
  records.forEach(record => {
    if (record.invoiceType === DEDUCTION_TYPE || record.invoiceType === REVERSAL_TYPE) {
      const root = pqvChainRoot(record.invoiceNumber);
      // A claim row whose number does not parse is its own one-row chain —
      // conservation: no owned row may vanish.
      draftFor(root ?? record.invoiceNumber.toUpperCase()).claimRows.push(record);
    }
  });

  // Pass 2: final documents — the pipe reference names TWO invoices and
  // either can be the chain, so attach to the candidate whose claim
  // chain exists in this file (last segment preferred); when neither
  // chain is present, key on the first candidate → 'Review Final Invoice'.
  records.forEach(record => {
    if (FINAL_DOC_TYPES.includes(record.invoiceType)) {
      const candidates = pqvFinalDocCandidateRoots(record.description);
      const withChain = candidates.find(c => (drafts.get(c)?.claimRows.length ?? 0) > 0);
      draftFor(withChain ?? candidates[0] ?? record.invoiceNumber.toUpperCase()).finalRows.push(record);
    }
  });

  // Sales invoices join the process: each Toptan Satis row attaches to its
  // own reference. Without any claim chain it resolves to
  // "Reconciled on due date" — the on-time-paid-in-full population.
  records.forEach(record => {
    if (record.invoiceType === 'Toptan Satis Faturasi') {
      draftFor(record.invoiceNumber.toUpperCase()).salesRows.push(record);
    }
  });

  const chains: OperationChain[] = [];
  drafts.forEach((draft, reference) => {
    // Cross-family guard: a sales-only reference claimed by ANOTHER
    // family (PPV) is NOT on-time — that family's chain owns its story.
    const salesOnly = draft.claimRows.length === 0 && draft.finalRows.length === 0;
    if (salesOnly && externalClaimedRoots?.has(reference)) return;
    if (salesOnly) {
      chains.push(resolveSalesOnly(reference, draft.salesRows));
      return;
    }
    // Per-round resolution: each deduction lifecycle is evaluated
    // independently (FKF finding in the PPV mirror), so a converted
    // round can never mask an open one — and the cashier model receives
    // only the open round's rows.
    chains.push(...resolveClaimChains(reference, draft, horizon, PQV_ROUND_CONFIG));
  });

  // Deterministic output: attention first, then reference, then round.
  chains.sort((a, b) => {
    if (a.attention !== b.attention) return a.attention ? -1 : 1;
    if (a.reference !== b.reference) return a.reference.localeCompare(b.reference);
    return (a.rounds ?? 0) - (b.rounds ?? 0);
  });

  // Conservation: net effect over ALL owned rows (chains partition them).
  const netEffect = round2(
    records
      .filter(record => PQV_OWNED_TYPES.includes(record.invoiceType))
      .reduce((sum, record) => sum + record.credit - record.debit, 0),
  );

  return { domain: 'PQV', ownedTypes: PQV_OWNED_TYPES, chains, netEffect };
}

/**
 * SALES-ONLY reference: paid in full on its due date, no claims raised
 * by ANY family. Claim chains are resolved per round in the shared
 * machine (claimRoundResolver.ts) — see PQV_ROUND_CONFIG.
 */
function resolveSalesOnly(reference: string, salesRows: PaymentRecord[]): OperationChain {
  const salesNet = round2(salesRows.reduce((sum, row) => sum + row.credit - row.debit, 0));
  const salesDisc = round2(salesRows.reduce((sum, row) => sum + row.discount, 0));
  return {
    reference,
    rows: salesRows,
    state: 'Reconciled on due date',
    net: salesNet,
    discount: salesDisc,
    residual: 0,
    narrative:
      `Paid in full (${fmt(salesNet)}) on its due date ${salesRows[0].paymentDate} — ` +
      'no claims (PQV ∪ PPV) raised against this invoice. Closed, no action.',
    actionInvoice: salesRows[0].invoiceNumber,
    invoiceDate: salesRows[0].invoiceDate,
    attention: false,
    rounds: 0,
  };
}
