/**
 * CLAIM GRAMMAR — the SHARED root extractor for the claim families.
 *
 * WHY SHARED: the payment system is one system, not isolated procedures.
 * It appends round tokens to the CURRENT tail regardless of family, so a
 * single root can interleave shortage and price rounds:
 *
 *   SEA2022000248676 → …SC → …SCR → …SCRPC → …SCRPCRI → IPV
 *
 * Per-row FAMILY ownership is decided by the row's own terminal token
 * (classification: SC/SCR/SCRI ⇒ PQV types, PC/PCR/PCRI ⇒ PPV types) —
 * that already survives interleaving. What must NOT be family-local is
 * ROOT extraction: a family-only grammar applied to `…SCRPC` yields the
 * pseudo-root `…SCR`, which (a) never joins the final document whose
 * pipe reference carries the TRUE root, and (b) poisons the cross-family
 * claimed-root sets — both false negatives.
 *
 * ── NOTATION ──────────────────────────────────────────────────────────
 *   token   one matching round of EITHER family:
 *           (SC|PC) optionally closed by R (reversal) or RI (validation)
 *   tail    one or more tokens — the invoice's full claim history
 *   root    invoice number minus the LONGEST parseable tail
 * ───────────────────────────────────────────────────────────────────────
 */

/** Mixed-family tail: rounds of SC or PC, each optionally R / RI closed. */
export const CLAIM_CHAIN_PATTERN = /^([A-Z0-9]+?)((?:(?:SC|PC)(?:RI?)?)+)$/;

/**
 * TRUE root of a claim document — strips the longest mixed SC/PC tail.
 * Null when the number carries no claim tail at all.
 */
export function claimChainRoot(invoiceNumber: string): string | null {
  const match = invoiceNumber.toUpperCase().match(CLAIM_CHAIN_PATTERN);
  return match ? match[1] : null;
}
