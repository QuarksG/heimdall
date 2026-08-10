import type { PaymentRecord, InvoiceCategory } from '../../../types/regional.types';

/**
 * OPERATIONS CONTRACT — shared shape for every cleaning-operations module
 * (PQV, PPV, Provision, QPD, and future commercial programs).
 *
 * Conservation invariant: every row of an owned type is assigned to
 * exactly one chain; Σ chain nets must reproduce the raw type totals.
 * Nothing disappears — everything is either EXPLAINED or FLAGGED.
 */

/**
 * Lifecycle state of a document chain under the governing policy —
 * the approved scenario vocabulary (PQV scenarios 1–4; PPV mirrors it).
 *
 * NAMING SCHEME (prefix tells the analyst what to do):
 *   CLOSED_  → resolved, no action
 *   OPEN_    → in progress inside its policy window, no danger
 *   WATCH_   → expected to resolve in a following remittance — monitor
 *   REVIEW_  → analyst action required
 */
export type ChainState =
  | 'Reconciled on due date'                            // sales invoice paid in full on its due date, no claims (PQV ∪ PPV) raised
  | 'Reconciled with Matching'                          // chain gross-nets to zero, ends on a reversal — paid in rounds
  | 'Reconciled with Invoice (IQV series invoice issued)' // PQV: final document issued, K1 ∧ K2 hold — shortage confirmed
  | 'Reconciled with Invoice (IPV series invoice issued)' // PPV: final document issued, K1 ∧ K2 hold — price difference confirmed
  | 'Pending Matching - Review'                         // scenario 1: suspense inside due+window — vendor note
  | 'Reconciled - Pending Invoice Creation'             // RI validated, final document not in this file yet
  | 'Partially Deducted - Pending'                      // final invoice deducting in installments as payment flows allow
  | 'Pending Invoice Cancelation / Stuck - Review'      // scenario 2: window exhausted, no official document — dispute
  | 'Reconciled with Slips'                             // final document disagrees with its chain
  | 'Reconciled without Shortage Claim'                 // PQV scenario 3: reversal without its deduction — cross-period or stuck
  | 'Reconciled without Price Claim'                    // PPV scenario 3: reversal without its deduction — cross-period or stuck
  | 'Excess Credit - Review'                            // orphan closure PAYING OUT (net > ε): credit released with no deduction withheld in this file — verify the prior period; if the deduction exists nowhere, Amazon paid excess and a clawback is expected
  | 'Açık'                                              // provision booked, not released — the open item behind the family residual
  | 'QPD Deduction Reconciled with Invoice'             // QPD: settlement document equals the family's legitimate discount — verified, closed
  | 'Duplicate QPD - Review'                            // >1 distinct QPD invoice charged against ONE deduction — claim the excess back
  | 'Anomaly - Check'                                   // residual the policy does not explain
  | 'Review Final Invoice';                             // final document without its chain in this file — cross-period

/** States that need NO analyst/vendor action — everything else carries attention. */
export const CLOSED_STATES: ReadonlySet<ChainState> = new Set<ChainState>([
  'Reconciled on due date',
  'Reconciled with Matching',
  'Reconciled with Invoice (IQV series invoice issued)',
  'Reconciled with Invoice (IPV series invoice issued)',
  'QPD Deduction Reconciled with Invoice',
]);

/** One referenced document chain with its resolved story. */
export interface OperationChain {
  /** Base reference the chain is keyed on (stripped invoice number). */
  reference: string;
  rows: PaymentRecord[];
  state: ChainState;
  /** Σ credit − debit across the chain (cash basis). */
  net: number;
  /** Σ Uygulanan indirim across the chain. */
  discount: number;
  /** GROSS netting: net + discount — must be ≈0 for closed chains (K1). */
  residual: number;
  /** Analyst-facing one-line story of what happened on this chain. */
  narrative: string;
  /**
   * Audit trail override for the "Zincir Belgeleri" column. When the
   * chain's invoice numbers alone are not auditable (provision batches
   * share one label), the owning module provides one locator per row —
   * e.g. label + payment number. Renderers fall back to the plain
   * invoice-number list when absent.
   */
  documentTrail?: string[];
  /**
   * ACTION INVOICE ("Aksiyon Faturası"): the chain's terminal document —
   * the final IQV/IPV when converted, otherwise the last chain document
   * (open SC, last reversal, RI, …). The one invoice number the analyst
   * acts on for this chain.
   */
  actionInvoice: string;
  /** Invoice date of the root document ("Fatura Tarihi"). */
  invoiceDate?: string;
  /** Whether an analyst/vendor action is expected on this chain. */
  attention: boolean;
  /** Number of deduction rounds observed. */
  rounds?: number;
  /** Net of linked final documents (debit − credit), when converted. */
  finalDocNet?: number;
  /** Days elapsed from the first deduction (= invoice due date) to the file horizon. */
  elapsedDays?: number;
}

/** Result of one operations module over a record population. */
export interface OperationResult {
  /** Domain name, e.g. 'PQV'. */
  domain: string;
  /** Invoice types this module owns (pipeline routing). */
  ownedTypes: readonly InvoiceCategory[];
  chains: OperationChain[];
  /** Net economic effect of the whole domain (ties back to raw totals). */
  netEffect: number;
}
