/**
 * Numeric parsing and rounding helpers for the tax validation engine.
 *
 * Moved verbatim from taxValidator.ts — behavior must stay identical
 * (characterization tests in numberUtils.test.ts pin it down).
 */

/**
 * Lenient number parser tolerating Turkish/European formats:
 * - whitespace anywhere is stripped
 * - both comma and dot present  → commas are thousands separators ("1.234,56" is NOT
 *   supported as-is; "1,234.56" → 1234.56)
 * - only commas present         → commas become decimal points ("1234,56" → 1234.56)
 */
export const parseNumberLoose = (raw: string | null): number | null => {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;
  s = s.replace(/\s+/g, '');
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) s = s.replace(/,/g, '');
  else if (hasComma && !hasDot) s = s.replace(/,/g, '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** Half-up rounding to 2 decimals with an epsilon guard against FP noise. */
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
