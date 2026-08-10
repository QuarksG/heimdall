import type { PaymentRecord, InvoiceCategory } from '../../types/regional.types';

/**
 * OPEN-ITEM FINDER — reusable, domain-named matching primitives.
 *
 * Extracted from the cashier engine so ANY module (cashier model, future
 * reference-based pair netting, ad-hoc analyses) uses the SAME open-item
 * semantics instead of re-implementing them. This module knows nothing
 * about classification or balance rules — it operates on already-typed
 * records and pure amounts.
 */

/** Currency tolerance for amount matching and reconciliation (rounding). */
export const AMOUNT_MATCH_TOLERANCE = 0.01;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Row net contribution to the vendor balance: Alacak − Borç.
 * Amounts are numeric on `PaymentRecord` (parsed once at the boundary) —
 * no string re-parsing happens here.
 */
export function rowNet(record: PaymentRecord): number {
  return round2(record.credit - record.debit);
}

/**
 * Groups records by invoice type, preserving input order within each
 * group. The shared first step of every per-category computation.
 */
export function groupByInvoiceType(
  records: PaymentRecord[],
): Map<InvoiceCategory, PaymentRecord[]> {
  const byType = new Map<InvoiceCategory, PaymentRecord[]>();
  records.forEach(record => {
    if (!byType.has(record.invoiceType)) byType.set(record.invoiceType, []);
    byType.get(record.invoiceType)!.push(record);
  });
  return byType;
}

/**
 * OPEN-ITEM FINDER (residual identification by exact amount).
 *
 * Deterministic amount-matching instead of guesswork:
 *  - rows whose own net is zero are self-netting → never open;
 *  - a +X row cancels a −X row (notification vs. its reversal, provision
 *    vs. its release), matched OLDEST-FIRST so the surviving open items
 *    are the most recent ones — consistent with the business expectation
 *    that residuals sit in the last payments;
 *  - whatever cannot be paired is OPEN and must be retained to keep the
 *    vendor balance correct.
 *
 * NOTE: amount-exact matching is CORRECT for categories with no reference
 * linkage (provisions, fees). For reference-linked pairs (SC/SCR, PC/PCR)
 * the release is gross while the deduction is net of discount, so amounts
 * legitimately differ — those pairs need reference-chain netting instead.
 */
export function findOpenItems(rows: PaymentRecord[]): PaymentRecord[] {
  const buckets = new Map<string, { pos: PaymentRecord[]; neg: PaymentRecord[] }>();

  rows.forEach(row => {
    const net = rowNet(row);
    if (Math.abs(net) <= AMOUNT_MATCH_TOLERANCE) return; // self-netting row
    const key = Math.abs(net).toFixed(2);
    if (!buckets.has(key)) buckets.set(key, { pos: [], neg: [] });
    const bucket = buckets.get(key)!;
    (net > 0 ? bucket.pos : bucket.neg).push(row);
  });

  const open: PaymentRecord[] = [];
  buckets.forEach(({ pos, neg }) => {
    const matched = Math.min(pos.length, neg.length);
    // Oldest-first cancellation → the most recent rows remain open.
    open.push(...pos.slice(matched), ...neg.slice(matched));
  });

  return open;
}
