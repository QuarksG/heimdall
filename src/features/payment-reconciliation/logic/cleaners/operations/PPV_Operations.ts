import { DataSanitizer } from '../dataSanitizer';
import { AMOUNT_MATCH_TOLERANCE } from '../../matchers/openItemFinder';
import { claimChainRoot } from './claimGrammar';
import { resolveClaimChains } from './claimRoundResolver';
import type { RoundResolverConfig } from './claimRoundResolver';
import type { PaymentRecord, InvoiceCategory } from '../../../types/regional.types';
import type { OperationResult, OperationChain } from './operations.types';

/**
 * PPV OPERATIONS — price-variance cleaning (price claims).
 *
 * BUSINESS PROCESS: the PQV lifecycle's PRICE twin (same logic, approved
 * as a mirror). A price mismatch against the PO posts a PC deduction on
 * the invoice due date (NET of quick-pay discount); the PCR reversal
 * releases it GROSS. Matching re-rounds (PC→PCR→PCRPC→…) until the chain
 * releases in full or the price difference is confirmed and converts —
 * RI validation + final IPV-series document (APV = archive) — within
 * due date + PPV_WINDOW_DAYS. Real chains show the direct short form
 * PC→PCRI (no intermediate PCR round); the grammar admits it.
 *
 * ── NOTATION (declared once, used everywhere) ─────────────────────────
 *   B          root invoice reference (the sales invoice number)
 *   C(B)       claim rows of B: numbers matching B(PC(R|RI)?)+
 *   F(B)       final documents of B: IPV/APV rows whose structured
 *              reference RI|PPV|{a}|{b} names B in EITHER segment —
 *              attachment prefers the segment whose claim chain is in
 *              this file (Amazon may put a sibling invoice in the other)
 *   d_k        k-th deduction row (…PC / …PCRPC …); d_last = final one
 *   r_k        k-th reversal row (…PCR / …PCRI)
 *   g(row)     gross value of a row = cash + indirim,
 *              where cash = credit − debit (cash columns are NET of QPD)
 *   net(B)     Σ (credit − debit) over C(B)              — cash netting
 *   disc(B)    Σ indirim over C(B)
 *   res(B)     round2(net(B) + disc(B))                  — GROSS netting
 *   ipv(B)     Σ (debit − credit) over F(B)              — final doc value
 *   due(B)     payment date of the FIRST PC row (PC posts on due date)
 *   H          file horizon = latest payment date in the file ("now")
 *   elapsed(B) days from due(B) to H
 *   L          matching window = PPV_WINDOW_DAYS (60d policy + 72h doc lag)
 *   ε          currency tolerance = 0.01 (one kuruş); "equal" means
 *              |difference| ≤ ε — floating-point guard, NOT a business value
 * ───────────────────────────────────────────────────────────────────────
 *
 * FORMULAS (mirror of the approved PQV set), evaluated PER ROUND since
 * the FKF2025000000378 finding — one root can carry several independent
 * lifecycles (round 1 PC→PCRI→IPV, round 2 SCRPC→PCRI→IPV, round 3
 * SCRSCRPC still open), so chain-level aggregation misdiagnosed every
 * multi-round chain and hid open deductions behind converted rounds:
 *   K1 (round knock-out):    |res(r)| ≤ ε over the round's claim rows
 *   K2 (conversion match):   |ipv(r) − g(d_r)| ≤ ε, on GROUPED
 *                            per-document totals of the round's PAIRED
 *                            finals (installment deduction)
 *   window position:         OPEN while elapsed(d_r) ≤ L, from the
 *                            round's OWN deduction date
 *
 * Everything is REFERENTIAL: chain membership via the invoice-number
 * grammar B(PC(R|RI)?)+; a deduction d is closed ONLY by d+'R'/d+'RI';
 * conversion linkage via the structured pipe reference on IPV documents
 * (the segment names the round's predecessor document, so segment+PC
 * identifies the round). Descriptions as free text are never trusted.
 */

/** Matching window: 60-day policy + 72h document-creation lag. */
export const PPV_WINDOW_DAYS = 63;

/** Currency tolerance ε — shared with amount-based open-item matching. */
export const PPV_TOLERANCE = AMOUNT_MATCH_TOLERANCE;

/**
 * Family-pure chain grammar: root followed by rounds of `PC` each
 * optionally closed by `R` (reversal) or `RI` (conversion validation).
 * NOTE: kept for family-purity checks only — ROOT extraction uses the
 * shared MIXED grammar (claimGrammar.ts), because one root can
 * interleave SC and PC rounds (e.g. …SCRPCRI) and a family-only parse
 * would key the chain on the pseudo-root …SCR and break conversion
 * linkage against the IPV's true-root pipe reference.
 */
export const PPV_CHAIN_PATTERN = /^([A-Z0-9]+?)((?:PC(?:RI?)?)+)$/;

/**
 * Structured conversion reference on IPV/APV documents: RI|PPV|{a}|{b}.
 * BOTH segments are invoice references and EITHER can name the chain
 * (mirror of the PQV finding: usually the root is LAST, but Amazon may
 * put the root in the middle and a sibling invoice last). Attachment
 * tries both segments' roots, preferring the one whose claim chain
 * exists in this file.
 */
export const PPV_FINAL_DOC_REF_PATTERN = /RI\|PPV\|([A-Z0-9]+)\|([A-Z0-9]+)/;

export const PPV_OWNED_TYPES: readonly InvoiceCategory[] = [
  'Fiyat Farki Kesinti Bildirimi',
  'Fiyat Farki Kesinti Bildirimi Ters Kayit',
  'Fiyat Farki Kesinti Faturasi',
  'Arsiv Fiyat Farki Kesinti Faturasi',
];

const DEDUCTION_TYPE: InvoiceCategory = 'Fiyat Farki Kesinti Bildirimi';
const REVERSAL_TYPE: InvoiceCategory = 'Fiyat Farki Kesinti Bildirimi Ters Kayit';
const FINAL_DOC_TYPES: readonly InvoiceCategory[] = [
  'Fiyat Farki Kesinti Faturasi',
  'Arsiv Fiyat Farki Kesinti Faturasi',
];

const round2 = DataSanitizer.roundAmount;

/** Family wiring for the shared per-round state machine. */
const PPV_ROUND_CONFIG: RoundResolverConfig = {
  token: 'PC',
  windowDays: PPV_WINDOW_DAYS,
  tolerance: PPV_TOLERANCE,
  finalDocRefPattern: PPV_FINAL_DOC_REF_PATTERN,
  finalSeries: 'IPV',
  convertedState: 'Reconciled with Invoice (IPV series invoice issued)',
  noClaimState: 'Reconciled without Price Claim',
  claimKind: 'price difference',
  matchingKind: 'price matching',
};

/**
 * TRUE root of a claim document — strips the longest MIXED SC/PC tail
 * (shared grammar), so interleaved chains key on the same root as their
 * final documents and the cross-family claimed-root sets.
 */
export function ppvChainRoot(invoiceNumber: string): string | null {
  return claimChainRoot(invoiceNumber);
}

/**
 * Candidate chain roots carried by a final document's structured
 * reference, in preference order: LAST segment first (the usual root
 * position), then the middle segment — each stripped of any claim tail.
 */
export function ppvFinalDocCandidateRoots(description: string): string[] {
  const match = description.toUpperCase().match(PPV_FINAL_DOC_REF_PATTERN);
  if (!match) return [];
  const candidates = [match[2], match[1]].map(segment => claimChainRoot(segment) ?? segment);
  return [...new Set(candidates)];
}

/** First candidate root (kept for callers that need a single key). */
export function ppvFinalDocRoot(description: string): string | null {
  return ppvFinalDocCandidateRoots(description)[0] ?? null;
}

/**
 * Roots claimed by the PPV family in this file — chain roots plus final-
 * document roots. Consumed by the sales adjudication (PQV module): a
 * sales invoice is 'Reconciled on due date' only when NO family
 * (PQV ∪ PPV) raised a claim against it.
 */
export function collectPpvClaimedRoots(records: PaymentRecord[]): Set<string> {
  const roots = new Set<string>();
  records.forEach(record => {
    if (record.invoiceType === DEDUCTION_TYPE || record.invoiceType === REVERSAL_TYPE) {
      const root = ppvChainRoot(record.invoiceNumber);
      if (root) roots.add(root);
    } else if (FINAL_DOC_TYPES.includes(record.invoiceType)) {
      // Both pipe segments are claimed — either can be the chain's root.
      ppvFinalDocCandidateRoots(record.description).forEach(root => roots.add(root));
    }
  });
  return roots;
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
  /** Root sales invoice row(s) — traceability (display only). */
  salesRows: PaymentRecord[];
}

/**
 * THE PPV cleaning operation. Receives the FULL record population (the
 * horizon needs every payment date); owns only the four PPV types.
 * Sales-only references are NOT emitted here — the on-time population
 * is adjudicated once, in the PQV module, against PQV ∪ PPV claims.
 */
export function runPpvOperations(records: PaymentRecord[]): OperationResult {
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
      const root = ppvChainRoot(record.invoiceNumber);
      // A claim row whose number does not parse is its own one-row chain —
      // conservation: no owned row may vanish.
      draftFor(root ?? record.invoiceNumber.toUpperCase()).claimRows.push(record);
    }
  });

  // Pass 2: final documents — attach to the pipe-ref candidate whose
  // claim chain exists in this file (last segment preferred); when
  // neither chain is present, key on the first candidate.
  records.forEach(record => {
    if (FINAL_DOC_TYPES.includes(record.invoiceType)) {
      const candidates = ppvFinalDocCandidateRoots(record.description);
      const withChain = candidates.find(c => (drafts.get(c)?.claimRows.length ?? 0) > 0);
      draftFor(withChain ?? candidates[0] ?? record.invoiceNumber.toUpperCase()).finalRows.push(record);
    }
  });

  // Root sales rows attach to EXISTING chains for the document trail
  // (display only, never in the chain arithmetic).
  records.forEach(record => {
    if (record.invoiceType === 'Toptan Satis Faturasi') {
      const reference = record.invoiceNumber.toUpperCase();
      if (drafts.has(reference)) drafts.get(reference)!.salesRows.push(record);
    }
  });

  // Per-round resolution: each deduction lifecycle is evaluated
  // independently (FKF finding), so a converted round can never mask an
  // open one — and the cashier model receives only the open round's rows.
  const chains: OperationChain[] = [];
  drafts.forEach((draft, reference) =>
    chains.push(...resolveClaimChains(reference, draft, horizon, PPV_ROUND_CONFIG)),
  );

  // Deterministic output: attention first, then reference, then round.
  chains.sort((a, b) => {
    if (a.attention !== b.attention) return a.attention ? -1 : 1;
    if (a.reference !== b.reference) return a.reference.localeCompare(b.reference);
    return (a.rounds ?? 0) - (b.rounds ?? 0);
  });

  // Conservation: net effect over ALL owned rows (chains partition them).
  const netEffect = round2(
    records
      .filter(r => PPV_OWNED_TYPES.includes(r.invoiceType))
      .reduce((sum, r) => sum + r.credit - r.debit, 0),
  );

  return { domain: 'PPV', ownedTypes: PPV_OWNED_TYPES, chains, netEffect };
}

/* State evaluation lives in the shared per-round machine
 * (claimRoundResolver.ts) — see PPV_ROUND_CONFIG above. */
