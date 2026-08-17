import { claimChainRoot } from '../cleaners/operations/claimGrammar';
import { runPqvOperations } from '../cleaners/operations/PQV_Operations';
import { collectPpvClaimedRoots } from '../cleaners/operations/PPV_Operations';
import { CLOSED_STATES } from '../cleaners/operations/operations.types';
import type { OperationChain } from '../cleaners/operations/operations.types';
import { DataSanitizer } from '../cleaners/dataSanitizer';
import type { PaymentRecord } from '../../types/regional.types';

/**
 * PQV LINEAGE — the referential dispute-cycle model for the PQV-RI sheet.
 *
 * SIDE-BY-SIDE TRIAL (analyst decision): these columns render NEXT TO the
 * existing RIGHT16 / PO#Amount heuristic columns, both computed per file,
 * so analysts can compare the two approaches on real data. Nothing in the
 * legacy matcher changes.
 *
 * MODEL (validated on 4EB5J_TR_Amazon_Payments_2026-08-16.xlsx —
 * 208/208 IQVs carried the reference; gross pairing produced 0 anomalies):
 *
 * Every IQV description carries `RI|PQV|{seg1}|{seg2}`:
 *   seg2 root = ORIGIN sales invoice — constant across the whole dispute;
 *   seg1 root = CYCLE DOC — the (re-issued) counter invoice whose SCR
 *               round THIS IQV clawed back.
 *
 * One dispute (lineage) = all cycle docs sharing an origin root, ordered
 * by document sequence (year+number — payment dates confirmed the order).
 * Per cycle k (analyst semantics):
 *   X_k = the cycle doc's INVOICE AMOUNT at gross —
 *         Σ(credit − debit + discount) over its sales rows (sales rows
 *         carry cash net of QPD discount while IQVs charge gross, so all
 *         comparisons are at gross; this eliminated every false
 *         "overclaw" on the validation file);
 *   Y_k = the NOT-PAID portion — Σ(debit − credit) over ALL IQV rows
 *         referencing the cycle doc (installments across payments and
 *         multiple IQV numbers SUM);
 *   paid_k = X_k − Y_k — the amount actually paid on the cycle.
 *
 * States (tolerance ε): |Y−X| ≤ ε → FULL CLAWBACK (the re-invoice loop:
 * input X, output X); Y < X − ε → PARTIAL; Y > X + ε → OVERCLAW (true
 * anomaly after the gross rule); sale absent → SALE NOT IN FILE
 * (cross-period; the origin root is the analyst's search key).
 *
 * Policy gates (dispute rules, rendered as flags, never filters):
 *   • re-issue amount gate: X_k ≈ Y_{k−1} (held 47/48 on the real file);
 *   • paid re-issue detection: a sales invoice on the ORIGIN's PO, gross
 *     ≈ the lineage's latest clawback, NOT referenced by any IQV in the
 *     file — the "dispute was paid, vendor may still be invoicing" case.
 *     Heuristic by nature (scoped to the lineage's own policy constraints)
 *     — reported as a CANDIDATE for verification, never asserted.
 */

/** Amount tolerance (currency units) for all lineage comparisons. */
export const LINEAGE_TOLERANCE = 0.8;

const IQV_TYPES = [
  'Eksik Miktar Kesinti Faturasi',
  'Arsiv Eksik Miktar Kesinti Faturasi',
] as const;

const SALES_TYPE = 'Toptan Satis Faturasi';

/** The structured conversion reference on IQV documents. */
const REF_PATTERN = /RI\|PQV\|([A-Z0-9]+)\|([A-Z0-9]+)/;

const round2 = DataSanitizer.roundAmount;

/** Lineage columns of ONE rendered IQV row (all rows of a cycle share them). */
export interface PqvCycleInfo {
  /** seg2 root — the dispute's constant family key. */
  originRoot: string;
  /** seg1 root — the counter invoice this IQV clawed. */
  cycleDoc: string;
  /** 1-based position of the cycle doc within the lineage (doc order). */
  cycleIndex: number;
  /** Cycle docs of this lineage present in this file. */
  cycleCount: number;
  /**
   * X_k — the cycle doc's INVOICE amount at gross (Σ credit − debit +
   * discount over its sales rows); null when the sale is not in the file.
   */
  invoiceGross: number | null;
  /**
   * Y_k — the NOT-PAID portion: total gross charged back via IQV against
   * the cycle doc (installments across payments and IQV numbers summed).
   */
  iqvGross: number;
  /** X_k − Y_k — the amount actually PAID on this cycle; null when X unknown. */
  paidAmount: number | null;
  state: 'FULL CLAWBACK' | 'PARTIAL' | 'OVERCLAW' | 'SALE NOT IN FILE';
  /** Re-issue amount gate vs the previous cycle's clawback ('' on cycle 1). */
  amountGate: string;
  /** Σ(X−Y) over the lineage's cycles with known X — in this file. */
  lineageNet: number;
  /**
   * Candidate re-issued invoices matched for payment (same-PO,
   * gate-amount sales invoices not charged by any IQV) — INVOICE NUMBERS
   * ONLY, comma-separated, in the ACTION-DOCUMENT form Filtered Invoices
   * uses, so the number itself tells the cycle outcome:
   *   released via matching → the reversal doc  ("CLK…482SCR");
   *   still withheld        → the open claim doc ("CLK…542SC");
   *   no SC round at all    → the plain invoice  ("CLK…554").
   * The analyst cross-checks these numbers in their own tools.
   */
  counterInvoicesAfterIqv: string;
  /**
   * ONE explanatory verdict per lineage (rendered LAST on the sheet).
   * Every scenario shares the same anchor — Amazon issued an IQV against
   * the ROOT invoice — so the text always names the root, then explains
   * WHICH invoices triggered the flag and WHY:
   *   RED FLAG    — a re-issue was already PAID (named), yet later
   *                 cycle(s) (named) were raised after that payment;
   *   PAID        — a re-issue was paid (named), no cycles after it;
   *   ACTIVE LOOP — no paid re-issue found, latest cycle fully clawed.
   */
  lineageAlert: string;
}

/** Root of a reference segment: claim tokens stripped, else the segment. */
function rootOf(segment: string): string {
  const upper = segment.toUpperCase();
  return claimChainRoot(upper) ?? upper;
}

/**
 * Computes the lineage columns for every IQV invoice number in the file.
 * Returned map is keyed by UPPERCASED IQV invoice number; rows of the same
 * IQV invoice share one entry. IQVs without the RI|PQV reference are
 * absent from the map (the sheet renders their lineage columns empty —
 * exactly the population where only the legacy heuristic can help).
 */
export function computePqvLineage(records: PaymentRecord[]): Map<string, PqvCycleInfo> {
  // ---- Sales aggregates per invoice number: gross X and PO ----
  const salesGross = new Map<string, number>();
  const salesPo = new Map<string, string>();
  for (const record of records) {
    if (record.invoiceType !== SALES_TYPE) continue;
    const key = record.invoiceNumber.toUpperCase();
    salesGross.set(key, round2((salesGross.get(key) ?? 0) + record.credit - record.debit + record.discount));
    if (!salesPo.get(key) && record.poNumber) salesPo.set(key, record.poNumber);
  }

  // ---- PQV claim chains per root — THE SAME resolution Filtered
  // Invoices renders (runPqvOperations → per-round states, knock-out at
  // GROSS, 'Reconciled with Matching' etc.). Nothing re-implemented:
  // the paid/withheld verdict and the action document come straight
  // from the operations chains.
  const ppvClaimedRoots = collectPpvClaimedRoots(records);
  const pqvChainsByRoot = new Map<string, OperationChain[]>();
  runPqvOperations(records, ppvClaimedRoots).chains.forEach(chain => {
    const key = chain.reference.toUpperCase();
    const list = pqvChainsByRoot.get(key) ?? [];
    list.push(chain);
    pqvChainsByRoot.set(key, list);
  });

  /**
   * Verdict for one counter invoice root, read off its operations chains:
   * paid ⇔ every round of the root is in a CLOSED state; the displayed
   * document is the Filtered-Invoices action invoice (the …SCR reversal
   * for 'Reconciled with Matching', the open claim doc for open rounds).
   */
  const chainVerdict = (invoice: string): { paid: boolean; doc: string } => {
    const chains = pqvChainsByRoot.get(invoice);
    if (!chains || chains.length === 0) return { paid: true, doc: invoice }; // no claims raised
    const openChain = chains.find(c => !CLOSED_STATES.has(c.state));
    if (openChain) return { paid: false, doc: openChain.actionInvoice || invoice };
    const last = chains[chains.length - 1];
    return { paid: true, doc: last.actionInvoice || invoice };
  };

  // ---- IQV rows with references: Y per cycle doc, grouped per origin ----
  interface CycleDraft {
    cycleDoc: string;
    clawed: number;
    /** UPPERCASED IQV invoice numbers charging this cycle. */
    iqvInvoices: Set<string>;
  }
  const lineages = new Map<string, Map<string, CycleDraft>>(); // origin -> doc -> draft
  const referencedDocs = new Set<string>(); // every seg1/seg2 root seen

  for (const record of records) {
    if (!(IQV_TYPES as readonly string[]).includes(record.invoiceType)) continue;
    const match = record.description?.match(REF_PATTERN);
    if (!match) continue;
    const cycleDoc = rootOf(match[1]);
    const origin = rootOf(match[2]);
    referencedDocs.add(cycleDoc);
    referencedDocs.add(origin);

    let cycles = lineages.get(origin);
    if (!cycles) {
      cycles = new Map<string, CycleDraft>();
      lineages.set(origin, cycles);
    }
    let draft = cycles.get(cycleDoc);
    if (!draft) {
      draft = { cycleDoc, clawed: 0, iqvInvoices: new Set<string>() };
      cycles.set(cycleDoc, draft);
    }
    draft.clawed = round2(draft.clawed + record.debit - record.credit);
    draft.iqvInvoices.add(record.invoiceNumber.toUpperCase());
  }

  // ---- Resolve each lineage into per-cycle infos ----
  const byIqvInvoice = new Map<string, PqvCycleInfo>();

  lineages.forEach((cycles, originRoot) => {
    // Document sequence embeds year + number — the validated cycle order.
    const ordered = [...cycles.values()].sort((a, b) => a.cycleDoc.localeCompare(b.cycleDoc));
    const originPo = salesPo.get(originRoot) ?? '';

    // Pass 1 — per-cycle amounts and states.
    const resolved = ordered.map(draft => {
      const invoiceGross = salesGross.get(draft.cycleDoc) ?? null;
      const iqvGross = draft.clawed;
      let state: PqvCycleInfo['state'];
      if (invoiceGross === null) state = 'SALE NOT IN FILE';
      else if (Math.abs(iqvGross - invoiceGross) <= LINEAGE_TOLERANCE) state = 'FULL CLAWBACK';
      else if (iqvGross < invoiceGross) state = 'PARTIAL';
      else state = 'OVERCLAW';
      return { draft, invoiceGross, iqvGross, state };
    });

    const lineageNet = round2(
      resolved.reduce(
        (sum, c) => (c.invoiceGross === null ? sum : sum + c.invoiceGross - c.iqvGross),
        0,
      ),
    );

    // Pass 2 — counter invoices issued AFTER the IQV: unclawed sales
    // invoices on the ORIGIN's PO whose gross ≈ the LATEST clawback (the
    // policy says a re-issue must equal what the last cycle clawed).
    // Output is deliberately terse — count + invoice numbers + verdict —
    // the analyst cross-checks the numbers in their own tools.
    const lastClaw = resolved[resolved.length - 1].iqvGross;
    const paidCandidates: string[] = []; // invoice numbers, payment confirmed
    const paidDocs: string[] = []; // action docs of the PAID re-issues
    const entries: string[] = [];
    if (originPo !== '') {
      const found: string[] = [];
      salesGross.forEach((gross, invoice) => {
        if (referencedDocs.has(invoice)) return; // already part of a cycle
        if (salesPo.get(invoice) !== originPo) return;
        if (Math.abs(gross - lastClaw) > LINEAGE_TOLERANCE) return;
        found.push(invoice);
      });
      found.sort();
      for (const invoice of found) {
        const verdict = chainVerdict(invoice);
        if (verdict.paid) {
          paidCandidates.push(invoice);
          paidDocs.push(verdict.doc);
        }
        entries.push(verdict.doc);
      }
    }
    const counterInvoicesAfterIqv = entries.join(', ');

    // Pass 3 — the ONE explanatory verdict. Common anchor of every
    // scenario: Amazon issued an IQV against the ROOT invoice. From
    // there: cycles raised AFTER a confirmed-paid re-issue are duplicate
    // dispute rounds (the "112 paid, cycles continued" scenario) — the
    // alert names both the paid evidence and the offending cycle docs so
    // the analyst can check each scenario directly.
    const earliestPaid = paidCandidates[0] ?? null;
    const duplicateDocs: string[] = [];
    if (earliestPaid) {
      resolved.forEach(c => {
        if (c.draft.cycleDoc.localeCompare(earliestPaid) > 0) {
          // Name the cycle doc WITH the IQV invoice(s) that charged it —
          // the concrete documents the analyst pulls for each scenario.
          const iqvs = [...c.draft.iqvInvoices].sort().join('/');
          duplicateDocs.push(`${c.draft.cycleDoc} (${iqvs})`);
        }
      });
    }

    // The anchor of every scenario: the ACTUAL IQV invoice(s) issued
    // against the root (first cycle), named — never the generic "IQV".
    const rootIqvs = [...resolved[0].draft.iqvInvoices].sort().join(', ');
    const lastCycle = resolved[resolved.length - 1];
    const lastIqvs = [...lastCycle.draft.iqvInvoices].sort().join(', ');

    const lastState = lastCycle.state;
    let lineageAlert = '';
    if (duplicateDocs.length > 0) {
      lineageAlert =
        `RED FLAG – Recommendation — ${rootIqvs} issued against root ${originRoot}; ` +
        `re-issue already PAID (${paidDocs.join(', ')}), ` +
        `but ${duplicateDocs.length} later cycle(s) raised after that payment: ` +
        `${duplicateDocs.join(', ')} — duplicate invoicing, check each scenario.`;
    } else if (paidCandidates.length > 0) {
      lineageAlert =
        `PAID — ${rootIqvs} issued against root ${originRoot}; ` +
        `re-issue paid (${paidDocs.join(', ')}), no further cycles in file — verify closure.`;
    } else if (lastState === 'FULL CLAWBACK' && resolved.length >= 2) {
      lineageAlert =
        `ACTIVE LOOP — ${rootIqvs} issued against root ${originRoot}; ` +
        `${resolved.length} cycles in file, latest (${lastCycle.draft.cycleDoc}, ` +
        `charged by ${lastIqvs}) fully clawed back and no paid re-issue found — dispute still open.`;
    }

    // Pass 3 — emit one shared info per cycle, keyed by its IQV invoices.
    resolved.forEach((cycle, index) => {
      const previous = index > 0 ? resolved[index - 1] : null;
      let amountGate = '';
      if (previous && cycle.invoiceGross !== null) {
        amountGate =
          Math.abs(cycle.invoiceGross - previous.iqvGross) <= LINEAGE_TOLERANCE
            ? 'OK'
            : `BREAK (X=${cycle.invoiceGross.toFixed(2)}, prev Y=${previous.iqvGross.toFixed(2)})`;
      }

      const info: PqvCycleInfo = {
        originRoot,
        cycleDoc: cycle.draft.cycleDoc,
        cycleIndex: index + 1,
        cycleCount: resolved.length,
        invoiceGross: cycle.invoiceGross,
        iqvGross: cycle.iqvGross,
        paidAmount: cycle.invoiceGross === null ? null : round2(cycle.invoiceGross - cycle.iqvGross),
        state: cycle.state,
        amountGate,
        lineageNet,
        counterInvoicesAfterIqv,
        lineageAlert,
      };
      cycle.draft.iqvInvoices.forEach(inv => byIqvInvoice.set(inv, info));
    });
  });

  return byIqvInvoice;
}
