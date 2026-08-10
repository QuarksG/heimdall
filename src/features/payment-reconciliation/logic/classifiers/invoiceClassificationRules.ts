import type { InvoiceCategory } from '../../types/regional.types';

/**
 * INVOICE CLASSIFICATION RULES — the single owner of RECOGNITION logic:
 * how a raw invoice row (number + description) is classified into an
 * invoice type. Named for its domain action: classification, nothing else.
 *
 * Balance impact is resolved by the OPEN-ITEM cashier model in
 * `logic/cashierModel.ts` (built on the cleaning operations); amount-based
 * open-item matching lives in
 * `logic/matchers/openItemFinder.ts`. This module has NO dependency on
 * either — classification is a pure function of the two text fields plus
 * an optional MONEY-DIRECTION context (Alacak/Borç) for the few rules
 * where the payment system reuses wording across directions.
 *
 * TRANSCRIBED VERBATIM from the original imperative chain in
 * `TrInvoiceClassifier.classify` — behavior is intentionally IDENTICAL,
 * including the known hazards, each flagged with its bug-register ID
 * (BC-nn, see the as-built design doc §6). Precedence is explicit data:
 * changing classification priority is a one-number business decision
 * reviewable in isolation, not an accident of statement order.
 */

/**
 * Warehouse codes — SINGLE SOURCE (fixes BC-37: this list was previously
 * duplicated between the PO-extraction regex and the wholesale keyword
 * check, which could silently desynchronize).
 *
 * ORDER MATTERS for the PO regex alternation: longer codes must precede
 * their prefixes (IST2/IST1 before IST) so the longest code wins.
 */
export const WAREHOUSE_CODES = [
  'IST2', 'XSA8', 'XTRA', 'XTRD', 'XTRC', 'IST1', 'IST',
  'XTRB', 'PTRA', 'PSR2', 'VECR', 'VEGX', 'XSA9','VMP3',
  'XSA7','EHMZ','XTR1',
] as const;

/**
 * PO token — full structural definition, proven on source data:
 *   exactly 8 alphanumeric chars, ALWAYS starts with a digit,
 *   ALWAYS ends with a letter (e.g. `6553UEPU`, `7W5XG4VS`, `48RWLA6F`).
 * Single source — reused by the TR classifier's PO extractor.
 */
export const PO_TOKEN = '\\d[A-Z0-9]{6}[A-Z]';

/**
 * Path separator between segments: the mandatory `/`, tolerating stray
 * non-alphanumeric characters around it (`|`, `?`, `.`, spaces …).
 */
const PATH_SEP = '[^A-Z0-9]*\\/[^A-Z0-9]*';

/**
 * Sales-invoice PO path — STRONG structural recognition (resolves BC-28).
 * A wholesale description carries `{PO}/{warehouse}/{tail}`:
 * capture group 1 = the PO token, capture group 2 = everything after the
 * warehouse segment (the tail), evaluated by `isSalesInvoicePath` (the
 * echo rule). Requiring the warehouse code to sit inside this
 * slash-delimited path — immediately after a valid PO token — kills the
 * bare-substring hazard (`IST` matching anywhere in free text).
 * The leading guard `(?:^|[^A-Z0-9])` ensures the PO token is not the
 * tail of a longer identifier.
 */
export const SALES_PO_PATH_PATTERN = new RegExp(
  `(?:^|[^A-Z0-9])(${PO_TOKEN})${PATH_SEP}(?:${WAREHOUSE_CODES.join('|')})${PATH_SEP}(.*)$`,
);

/** Dropship purchase-order marker in the invoice description. */
export const DROPSHIP_MARKER = 'DROPSHIP-PO-';

/**
 * Dropship-invoice recognition (rule 24) — the three-condition method,
 * mirroring the sales echo rule:
 *
 *   x = invoice number, z = description
 *
 *   CONDITION 1 (length):  len(x) ≥ 16 — dropship invoice numbers are
 *                          never shorter than the standard invoice length.
 *   CONDITION 2 (marker):  z carries 'DROPSHIP-PO-'.
 *   CONDITION 3 (echo):    x itself appears AFTER the marker — the path
 *                          shape is DROPSHIP-PO-{site}/{warehouse}/|{x}
 *                          (e.g. DROPSHIP-PO-EHMZ-TR/EHMZ/|AYT2023000002721).
 */
export function isDropshipInvoice(inv: string, desc: string): boolean {
  if (inv.length < 16) return false;
  const idx = desc.indexOf(DROPSHIP_MARKER);
  if (idx === -1) return false;
  return desc.slice(idx + DROPSHIP_MARKER.length).includes(inv);
}

/**
 * QPD description signals (rule 21) — SINGLE SOURCE. ALL QPD documents
 * (settlements AND clearing rows) classify into the ONE merged 'QPD'
 * type; the debit/credit side separates invoices from clearing noise in
 * `QPD_Operations`. Matching is case-insensitive (inputs are uppercased
 * by `classifyByRules`, and rule 21 additionally folds the Turkish
 * dotted İ to I before comparing). Keywords MUST be uppercase.
 * BC-30 (ruled intended): 'AGANIST' (sic) matches the actual Oracle
 * source text — do NOT correct the spelling.
 */
export const QPD_INVOICE_SIGNALS = [
  'QPD RETURN INVOICE',
  'QPD KESINTI FATURASI',
  'CREATING QPD FOR PARENT INVOICE',
  'CLEARING INVOICE AGANIST QPD',
] as const;

/**
 * Wholesale invoice-number length CEILING. Sales invoice numbers are AT
 * MOST 16 chars (16-char IB… series AND shorter series like AH35387120).
 * Claim-family documents are the 16-char root PLUS a suffix — always
 * 18–20 chars — so anything longer than 16 can never be a sales invoice.
 */
export const WHOLESALE_MAX_INVOICE_LENGTH = 16;

/**
 * Sales-invoice recognition (the robust three-condition method):
 *
 *   y = invoice number, z = description, x = len(y)
 *
 *   CONDITION 1 (length):  0 < x ≤ 16 — claim documents (root + suffix,
 *                          18–20 chars) can never qualify.
 *   CONDITION 2 (path):    z carries `{PO}/{warehouse}/` with a valid
 *                          8-char PO token (digit-first, letter-last).
 *   CONDITION 3 (echo):    the tail after the warehouse segment is
 *                          either EMPTY (true — a bare path qualifies),
 *                          or its first alphanumeric token must equal y
 *                          EXACTLY. A claim document echoes its 16-char
 *                          ROOT, never its suffixed number, so the echo
 *                          can only ever match the true sales invoice.
 */
export function isSalesInvoicePath(inv: string, desc: string): boolean {
  // Condition 1 — x ≤ 16.
  if (inv.length === 0 || inv.length > WHOLESALE_MAX_INVOICE_LENGTH) return false;

  // Condition 2 — structural PO path.
  const match = desc.match(SALES_PO_PATH_PATTERN);
  if (!match) return false;

  // Condition 3 — the echo rule.
  const tail = match[2].trim();
  if (tail.length === 0) return true; // empty tail: valid (bare path)

  const echo = tail.match(/[A-Z0-9]+/); // first real token after separators
  if (!echo) return true; // separators only (`|`, spaces) — effectively empty
  return echo[0] === inv; // must repeat the invoice number EXACTLY
}

/**
 * RETURN-DISPUTE SIGNATURE (analyst ruling 2026-08): the description
 * carries 'FOR TRANSACTION' immediately followed by a V-series
 * transaction token (V + digit + 14 alphanumerics = the 16-char
 * transaction reference), with a DSPT dispute reference later in the
 * text — e.g.:
 *   "C062021000006631R1 For Transaction: V112021000000091 Itiraz no: DSPT2065070"
 * The referenced transaction IS a return: the row classifies as a
 * return invoice REGARDLESS of its own series prefix. Ordered on
 * purpose: the V-token must follow FOR TRANSACTION (it is the cited
 * transaction, never the row's own echo, which precedes the phrase).
 */
export const RETURN_TRANSACTION_DISPUTE_PATTERN =
  /FOR TRANSACTION\s*:?\s*V\d[A-Z0-9]{14}\b[\s\S]*DSPT/;

/**
 * Invoice numbers are EXACTLY 16 characters (BC-38 ruled intended).
 * Claim-family documents (SC/SCR/SCRI/PC/PCR/PCRI) are the 16-char root
 * PLUS a suffix — always 18–20 chars. Therefore a 16-char number is an
 * INVOICE and never a notification/reversal, regardless of what its
 * description says (e.g. SET2023000000008 "Price claim reversal IPV…"
 * is an invoice about a reversal, not the reversal itself). Rules 4–7
 * guard their ENTIRE predicate — suffix AND description branches — with
 * this rule; PQV and PPV are mirrored identically.
 */
function isWholesaleLength(inv: string): boolean {
  return inv.length === 16;
}

/**
 * MONEY CONTEXT — optional third input to recognition. Most rules are a
 * pure function of the two text fields; a few need the payment DIRECTION
 * (Alacak = credit = money went OUT to the vendor). The context is
 * optional: when absent, direction-dependent branches simply do not fire.
 */
export interface ClassificationContext {
  /** Alacak — money paid out to the vendor. */
  credit: number;
  /** Borç — money deducted from the vendor. */
  debit: number;
  /**
   * VENDOR-OWNED SERIES (analyst ruling — prefix demotion): the reserved
   * first-characters (C/V) that this vendor's own sales-invoice series
   * occupies, learned per file by `inferVendorOwnedSeries`. When a
   * character is present, the bare-prefix coop/return branches DEMOTE to
   * last-resort precedence (just before Siniflandirilmamis) so
   * referential rules (QPD signals, disputes, paybacks, dropship) are
   * asked first. Absent/empty set = today's behavior, unchanged.
   */
  vendorOwnedSeries?: ReadonlySet<string>;
}

/* ====================================================================
 * VENDOR SERIES INFERENCE (analyst ruling — prefix demotion)
 *
 * PROBLEM: rules 13/14 carry bare-prefix branches (C1/C0 → coop,
 * V1/V0 → return). A vendor whose OWN sales series starts with C or V
 * collides with them, and every derived document that references such
 * an invoice without a PO path (QPD settlements, disputes, claim rows)
 * is captured by two characters of prefix before the referential rules
 * are ever asked — systematic false negatives.
 *
 * SOLUTION: learn the vendor's series from the ONE verified determinant
 * with no known false positives — the structural sales rule
 * (isSalesInvoicePath: PO path + echo). If at least
 * VENDOR_SERIES_THRESHOLD of the file's verified sales invoices share a
 * reserved first character, that character is VENDOR-OWNED and the
 * colliding prefix branches are demoted for this file.
 * ==================================================================== */

/**
 * Reserved first-characters of Amazon's own series that bare-prefix
 * rules key on. Only these can ever be demoted; every other vendor
 * series (IB…, AH…, SEG…) never changes behavior.
 */
export const RESERVED_SERIES_CHARS: readonly string[] = ['C', 'V'];

/**
 * Share of verified sales invoices required to own a series char.
 * Analyst ruling (2026-08): lowered from 0.95 to 0.33 — multi-series
 * vendors (e.g. C-series + Y-series) never reach 95%, yet a one-third
 * share of no-margin-for-error verified sales proves the collision.
 */
export const VENDOR_SERIES_THRESHOLD = 0.33;

/**
 * Minimum verified sales rows before inference may fire — a tiny file
 * must not flip classification behavior on one or two invoices.
 */
export const VENDOR_SERIES_MIN_SAMPLE = 5;

/** Full inference detail — consumed by the diagnostics notes. */
export interface VendorSeriesInference {
  /** Rows passing the verified structural sales rule (the voters). */
  verifiedSales: number;
  /** Reserved chars owned by the vendor (threshold + sample met). */
  owned: ReadonlySet<string>;
  /** Share of verified sales per reserved char (0..1). */
  shares: Record<string, number>;
}

/**
 * Analyzes the vendor's sales series for one file. Counts ONLY rows
 * passing the verified structural sales rule; a reserved char is
 * vendor-owned when its share of that population is ≥ the threshold
 * and the sample is large enough.
 */
export function analyzeVendorSeries(
  rows: ReadonlyArray<{ invoiceNumber: string; description: string }>,
): VendorSeriesInference {
  const counts = new Map<string, number>();
  let verifiedSales = 0;

  rows.forEach(row => {
    const inv = (row.invoiceNumber || '').toUpperCase();
    const desc = (row.description || '').toUpperCase();
    if (!isSalesInvoicePath(inv, desc)) return;
    verifiedSales += 1;
    const first = inv.charAt(0);
    counts.set(first, (counts.get(first) ?? 0) + 1);
  });

  const owned = new Set<string>();
  const shares: Record<string, number> = {};
  RESERVED_SERIES_CHARS.forEach(char => {
    const share = verifiedSales > 0 ? (counts.get(char) ?? 0) / verifiedSales : 0;
    shares[char] = share;
    if (verifiedSales >= VENDOR_SERIES_MIN_SAMPLE && share >= VENDOR_SERIES_THRESHOLD) {
      owned.add(char);
    }
  });

  return { verifiedSales, owned, shares };
}

/** Learns the vendor-owned reserved series chars for one file. */
export function inferVendorOwnedSeries(
  rows: ReadonlyArray<{ invoiceNumber: string; description: string }>,
): ReadonlySet<string> {
  return analyzeVendorSeries(rows).owned;
}

/**
 * DIAGNOSTIC NOTES for the upload warnings: whenever the file carries
 * rows a reserved prefix rule could capture (C1/C0/V1/V0), state
 * whether the demotion is ACTIVE and, when it is not, exactly why —
 * so an unchanged classification is explainable instead of silent.
 */
export function buildVendorSeriesNotes(
  rows: ReadonlyArray<{ invoiceNumber: string; description: string }>,
): string[] {
  const { verifiedSales, owned, shares } = analyzeVendorSeries(rows);
  const notes: string[] = [];

  const prefixesOf = (char: string): string[] => [`${char}1`, `${char}0`];
  RESERVED_SERIES_CHARS.forEach(char => {
    const collisionRows = rows.filter(row => {
      const inv = (row.invoiceNumber || '').toUpperCase();
      return prefixesOf(char).some(p => inv.startsWith(p));
    }).length;
    if (collisionRows === 0) return; // nothing the rule could capture

    if (owned.has(char)) {
      notes.push(
        `Vendor series inference ACTIVE for '${char}': ${verifiedSales} verified sales row(s), ` +
          `${Math.round(shares[char] * 100)}% start with ${char} — bare ${prefixesOf(char).join('/')} ` +
          `prefix classification is demoted to last resort for this file (${collisionRows} row(s) affected).`,
      );
    } else if (verifiedSales < VENDOR_SERIES_MIN_SAMPLE) {
      notes.push(
        `Vendor series inference NOT active for '${char}': only ${verifiedSales} verified sales row(s) ` +
          `(PO path + echo) — minimum ${VENDOR_SERIES_MIN_SAMPLE}. The ${collisionRows} ${char}-prefixed ` +
          'row(s) classify by prefix at normal precedence. If this vendor is genuinely ' +
          `${char}-series, the sales descriptions may be missing the {PO}/{warehouse}/ path.`,
      );
    } else {
      notes.push(
        `Vendor series inference NOT active for '${char}': ${Math.round(shares[char] * 100)}% of ` +
          `${verifiedSales} verified sales rows start with ${char} — below the ` +
          `${Math.round(VENDOR_SERIES_THRESHOLD * 100)}% threshold. The ${collisionRows} ${char}-prefixed ` +
          'row(s) classify by prefix at normal precedence.',
      );
    }
  });

  return notes;
}

export interface ClassificationRule {
  /** Evaluation order — lowest wins. Ties are impossible (unique values). */
  precedence: number;
  /** The type this rule recognizes. */
  type: InvoiceCategory;
  /** Human-readable recognition condition (audit documentation). */
  note: string;
  /** Predicate over the UPPERCASED invoice number, description and money context. */
  when: (inv: string, desc: string, ctx?: ClassificationContext) => boolean;
}

/**
 * Coop bare-prefix branch — the ONLY coop evidence a vendor C-series
 * can collide with. Split out of `isCoopInvoice` (analyst ruling —
 * prefix demotion): fires at precedence 13 normally, at 25 (last
 * resort) when the vendor's own series owns 'C'.
 */
function isCoopByPrefix(inv: string): boolean {
  const prefix = inv.slice(0, 2);
  // ⚠ BC-31: dead branch — fully subsumed by the next line (prefix 'C1'
  // alone already returns true). Preserved verbatim pending a ruling.
  if (prefix === 'C1' && inv.slice(-2) === 'R1') return true;
  return prefix === 'C1' || prefix === 'C0';
}

/**
 * Coop evidence branches (precedence 13) — verbatim transcription minus
 * the bare-prefix branch (see `isCoopByPrefix`). Internal condition
 * order preserved from the original implementation.
 */
function isCoopByEvidence(inv: string, desc: string): boolean {
  const hasKeywords = desc.includes('FOR TRANSACTION') || desc.includes('DSPT');
  // SELF-ECHO GUARD (analyst ruling — prefix demotion follow-up): a
  // C1-token that IS the row's own invoice number is the vendor's own
  // series echoing itself (e.g. "C122019000002764 For Transaction: …"),
  // NOT a reference to a coop document. Only a token naming a DIFFERENT
  // document counts as evidence.
  const c1Tokens = desc.match(/\bC1[A-Z0-9]{14}\b/g) ?? [];
  const hasC1Reference = c1Tokens.some(token => token !== inv);

  if (hasKeywords && hasC1Reference) {
    return true;
  }

  // ⚠ BC-32: 'SPA'/'AVS' are 3-char substring matches on the whole
  // description (e.g. 'SPARE' would hit). Preserved verbatim.
  // Inputs are UPPERCASED before rules run — keywords MUST be uppercase.
  const coopKeywords = [
    'VOLUME INCENTIVE',
    'CO-OP',
    'AVS',
    'SPA',
    'DAMAGE ALLOWANCE',
    'AVS - SVS',
    'CO-OP-',
  ];
  if (coopKeywords.some(key => desc.includes(key))) return true;

  if (inv.includes('DSPT') && desc.includes('C1')) return true;

  const rPattern = inv.match(/R(\d{1,2})$/);
  if (rPattern) {
    const rNumber = parseInt(rPattern[1]);
    if (rNumber >= 1 && rNumber <= 12) {
      if (desc.includes('C0') || desc.includes('C1')) return true;
    }
  }

  return false;
}

/**
 * Return bare-prefix branch — the ONLY return evidence a vendor
 * V-series can collide with. Split out of `isReturnInvoice` (analyst
 * ruling — prefix demotion): fires at precedence 14 normally, at 26
 * (last resort) when the vendor's own series owns 'V'.
 */
function isReturnByPrefix(inv: string): boolean {
  const prefix = inv.slice(0, 2);
  return prefix === 'V1' || prefix === 'V0';
}

/**
 * Return evidence branches (precedence 14) — verbatim transcription
 * minus the bare-prefix branch (see `isReturnByPrefix`).
 * ⚠ BC-34: unlike the coop twin, the R{n}-suffix rule here has NO 1..12
 * range check (R99 qualifies). Preserved verbatim pending a ruling.
 */
function isReturnByEvidence(inv: string, desc: string): boolean {
  const hasKeywords = desc.includes('FOR TRANSACTION') || desc.includes('DSPT');
  // Renamed from the misleading `hasC1Reference` (BC-33): this regex
  // matches 16-char V-tokens, not C1-tokens.
  // SELF-ECHO GUARD (mirror of the coop twin): a V-token that IS the
  // row's own invoice number is a self-echo, not a return reference —
  // protects V-series vendors identically.
  const vTokens = desc.match(/\bV[A-Z0-9]{15}\b/g) ?? [];
  const hasVReference = vTokens.some(token => token !== inv);

  if (hasKeywords && hasVReference) {
    return true;
  }

  const rPattern = inv.match(/R(\d{1,2})$/);
  if (rPattern && (desc.includes('V1') || desc.includes('V0'))) return true;

  if (desc.includes('VRET') || desc.includes('RETURNS')) return true;

  if (inv.includes('DSPT') && (desc.includes('V1') || desc.includes('V0'))) return true;

  return false;
}

/**
 * THE classification table. First match (lowest precedence) wins.
 * Every entry maps to exactly one rulebook type, so every classified row
 * is guaranteed a balance-impact rule.
 */
export const CLASSIFICATION_RULES: readonly ClassificationRule[] = [
  {
    precedence: 1,
    type: 'Giden Havale',
    note: 'Invoice number starts with the synthetic transfer prefix. ⚠ BC-24: defensive — synthetic rows bypass classification; fires only if an exported report is re-imported.',
    when: inv => inv.startsWith('GIDEN HAVALE:'),
  },
  {
    precedence: 2,
    type: 'Ticari Isbirligi Faturasi',
    note: 'Description carries a FlexibleAgreements reference.',
    when: (_inv, desc) => desc.includes('FLEXIBLEAGREEMENTS'),
  },
  {
    precedence: 3,
    type: 'MISSING_ACTUAL_OR_BAN',
    note: 'Data-quality marker in either field.',
    when: (inv, desc) => desc.includes('MISSING_ACTUAL_OR_BAN') || inv.includes('MISSING_ACTUAL_OR_BAN'),
  },
  {
    precedence: 4,
    type: 'Eksik Miktar Kesinti Bildirimi',
    note:
      "Invoice number ends SC, OR the description carries 'Shortage Claim for Invoice' (two independent " +
      'signals for the same fact — validated against source data: they coincide on every known row; a ' +
      'disagreement is surfaced by the shortage-pattern validation). Reversal suffixes (SCR/SCRI) are ' +
      'guarded so a reversal whose description mentions the claim can never be captured here. ' +
      'CONFIRMED (BC-25 ruled intended): deliberately shadows precedence 8 — an IQV invoice ending SC IS a notification. ' +
      'LENGTH GUARD (whole rule, description signal included): a 16-char number is an INVOICE, never a ' +
      'notification — claim documents are root (16) + suffix, always longer.',
    when: (inv, desc) =>
      !isWholesaleLength(inv) &&
      (inv.endsWith('SC') ||
        (desc.includes('SHORTAGE CLAIM FOR INVOICE') && !inv.endsWith('SCR') && !inv.endsWith('SCRI'))),
  },
  {
    precedence: 5,
    type: 'Eksik Miktar Kesinti Bildirimi Ters kayit',
    note:
      'Invoice number ends SCR/SCRI (shortage claim reversal). LENGTH GUARD: reversals are root (16) + ' +
      'suffix, always longer than 16 — a coincidental 16-char tail must not qualify.',
    when: inv => (inv.endsWith('SCR') || inv.endsWith('SCRI')) && !isWholesaleLength(inv),
  },
  {
    precedence: 6,
    type: 'Fiyat Farki Kesinti Bildirimi',
    note:
      "Invoice ends PC, or description contains 'FOR PPV'. CONFIRMED (BC-26 ruled intended): FOR PPV wins " +
      'over the reversal rule (7) by design. LENGTH GUARD (whole rule, description signal included): a ' +
      '16-char number is an INVOICE, never a notification.',
    when: (inv, desc) => !isWholesaleLength(inv) && (inv.endsWith('PC') || desc.includes('FOR PPV')),
  },
  {
    precedence: 7,
    type: 'Fiyat Farki Kesinti Bildirimi Ters Kayit',
    note:
      "Invoice ends PCR/PCRI, or description contains 'PRICE CLAIM REVERSAL'. LENGTH GUARD (whole rule, " +
      "description signal included): a 16-char number is an INVOICE, never a reversal — e.g. " +
      "SEY2023000000008 'Price claim reversal IPV…' was previously mis-captured here by its description.",
    when: (inv, desc) =>
      !isWholesaleLength(inv) &&
      (inv.endsWith('PCR') || inv.endsWith('PCRI') || desc.includes('PRICE CLAIM REVERSAL')),
  },
  {
    precedence: 8,
    type: 'Eksik Miktar Kesinti Faturasi',
    note:
      "Invoice IS a proper IQV document: 'IQV' + 13 digits (= 16 chars, the invoice length rule). " +
      "RESOLVED (was: bare CONTAINS 'IQV', ⚠ BC-27): a suffixed derivative like IQV…R is a payback OF " +
      'the invoice, not the invoice — it falls through to rule 23. BC-25 shadowing is UNAFFECTED: an ' +
      'IQV…SC row is still captured as a notification by rule 4 (lower precedence, ends SC, length ≠ 16).',
    when: inv => /^IQV\d{13}$/.test(inv),
  },
  {
    precedence: 9,
    type: 'Arsiv Eksik Miktar Kesinti Faturasi',
    note:
      "Invoice IS a proper AQV document: 'AQV' + 13 digits (= 16 chars, the invoice length rule). " +
      "RESOLVED (was: bare CONTAINS 'AQV'): suffixed derivatives fall through.",
    when: inv => /^AQV\d{13}$/.test(inv),
  },
  {
    precedence: 10,
    type: 'Fiyat Farki Kesinti Faturasi',
    note:
      "Invoice IS a proper IPV document: 'IPV' + 13 digits (= 16 chars, the invoice length rule). " +
      "RESOLVED (was: bare startsWith 'IPV', ⚠ BC-27): a suffixed derivative like IPV…106R is NOT the " +
      'invoice — it is a payback/reversal OF the invoice and must fall through (rule 23 captures it by ' +
      "its 'Payback' description).",
    when: inv => /^IPV\d{13}$/.test(inv),
  },
  {
    precedence: 11,
    type: 'Arsiv Fiyat Farki Kesinti Faturasi',
    note:
      "Invoice IS a proper APV document: 'APV' + 13 digits (= 16 chars, the invoice length rule). " +
      "RESOLVED (was: bare STARTS WITH 'APV'): suffixed derivatives fall through.",
    when: inv => /^APV\d{13}$/.test(inv),
  },
  {
    precedence: 12,
    type: 'Toptan Satis Faturasi',
    note:
      'THREE-CONDITION sales recognition: (1) invoice number ≤ 16 chars (claim docs are root+suffix, ' +
      'always 18–20); (2) description carries the structured PO path `{PO}/{warehouse}/` where the PO is ' +
      '8 alphanumerics, digit-first and letter-last (e.g. 6553UEPU/XTRA/); (3) ECHO rule — the path tail ' +
      'is empty OR repeats the invoice number exactly (`…/XTRA/|IB12022000018526`). A claim document ' +
      'echoes its ROOT, never its suffixed number, so it can never pass the echo. ' +
      'RESOLVED BC-28: structural path matching replaced the bare warehouse-code substring. ' +
      'RESOLVED: the strict ===16 length rule created false negatives for short sales numbers (AH35387120).',
    when: (inv, desc) => isSalesInvoicePath(inv, desc),
  },
  {
    precedence: 12.5,
    type: 'Iade Edilen Ürünler Için Kesilen Iade Faturasi',
    note:
      "RETURN-DISPUTE SIGNATURE (analyst ruling 2026-08): description carries 'FOR TRANSACTION' followed " +
      'by a V-series transaction token (V + digit + 14 alphanumerics) and a DSPT dispute reference — the ' +
      'cited transaction is a return, so the row is a return invoice REGARDLESS of its own series prefix. ' +
      'Deliberately ABOVE coop (13): observed misfires C062021000006631R1..R12, whose self-echoed C0 ' +
      "numbers satisfied coop's R{n}-suffix substring branch before the return rule was ever asked.",
    when: (_inv, desc) => RETURN_TRANSACTION_DISPUTE_PATTERN.test(desc),
  },
  {
    precedence: 13,
    type: 'Ticari Isbirligi Faturasi',
    note:
      'Coop recognition: evidence branches (coop keywords, C1-token references, DSPT+C1) always fire ' +
      'here; the bare C1/C0 prefix branch fires here ONLY when the vendor does not own the C series — ' +
      'otherwise it demotes to precedence 25 (analyst ruling — prefix demotion). CONFIRMED (BC-29 ruled ' +
      'intended): DSPT rows carrying C1 references route to coop, not to the dispute rule (20).',
    when: (inv, desc, ctx) =>
      isCoopByEvidence(inv, desc) ||
      (isCoopByPrefix(inv) && !(ctx?.vendorOwnedSeries?.has('C') ?? false)),
  },
  {
    precedence: 14,
    type: 'Iade Edilen Ürünler Için Kesilen Iade Faturasi',
    note:
      'Return recognition: evidence branches (VRET/RETURNS keywords, V-token references) always fire ' +
      'here; the bare V1/V0 prefix branch fires here ONLY when the vendor does not own the V series — ' +
      'otherwise it demotes to precedence 26 (analyst ruling — prefix demotion).',
    when: (inv, desc, ctx) =>
      isReturnByEvidence(inv, desc) ||
      (isReturnByPrefix(inv) && !(ctx?.vendorOwnedSeries?.has('V') ?? false)),
  },
  {
    precedence: 15,
    type: 'Vadesi Geçmis Alacak Provizyonu',
    note: "Invoice contains 'PROVISION_FOR_AGED_'.",
    when: inv => inv.includes('PROVISION_FOR_AGED_'),
  },
  {
    precedence: 16,
    type: 'Alacak Provizyonu',
    note: "Invoice contains 'PROVISION_FOR_RECEIVABLE' or 'PROVISION_FOR_ACCRUAL'.",
    when: inv => inv.includes('PROVISION_FOR_RECEIVABLE') || inv.includes('PROVISION_FOR_ACCRUAL'),
  },
  {
    precedence: 17,
    type: 'Bank Ücreti',
    note: "Description contains 'BANK FEE'.",
    when: (_inv, desc) => desc.includes('BANK FEE'),
  },
  {
    precedence: 18,
    type: 'CRTR Geri Ödemesi',
    note: "Description contains 'CRTR', or either field contains 'CREATING PARENT INVOICE VIA TR'.",
    when: (inv, desc) =>
      desc.includes('CRTR') ||
      inv.includes('CREATING PARENT INVOICE VIA TR') ||
      desc.includes('CREATING PARENT INVOICE VIA TR'),
  },
  {
    precedence: 19,
    type: 'AR Faturasi',
    note: "Description contains 'DFP FOR AR INVOICE'.",
    when: (_inv, desc) => desc.includes('DFP FOR AR INVOICE'),
  },
  {
    precedence: 20,
    type: 'Amazon Itrazlari',
    note: "Description contains 'DSPT' while the invoice number does NOT.",
    when: (inv, desc) => desc.includes('DSPT') && !inv.includes('DSPT'),
  },
  {
    precedence: 21,
    type: 'QPD',
    note:
      'Description carries ANY QPD signal (case-insensitive) — settlements AND clearing rows merge into ' +
      "the ONE 'QPD' type: 'QPD RETURN INVOICE', 'QPD KESINTI FATURASI', 'CREATING QPD FOR PARENT " +
      "INVOICE', 'CLEARING INVOICE AGANIST QPD' (AGANIST sic — BC-30). Turkish dotted İ is folded to I " +
      'so source text like KESİNTİ cannot dodge the ASCII keyword.',
    when: (_inv, desc) => {
      const folded = desc.replace(/İ/g, 'I');
      return QPD_INVOICE_SIGNALS.some(signal => folded.includes(signal));
    },
  },
  {
    precedence: 23,
    type: 'Itraz Sonucu Geri Odeme',
    note:
      "Three signals. (a) Description contains 'PAYBACK' — covers suffixed IPV derivatives like " +
      "IPV…106R that rule 10 now correctly rejects. (b) Description contains 'IPV IADE FATURASI' (a " +
      'return invoice issued against an IPV — a dispute payback by another name). (c) MONEY-DIRECTION ' +
      'signal: the number IS a 16-char invoice AND the row is Alacak (credit — money went OUT to the ' +
      "vendor) AND the description carries 'CLAIM REVERSAL' (price OR quantity wording) or references " +
      'a proper final document of either family (IPV/IQV + 13 digits). Deliberately NOT keyed on any ' +
      "vendor-specific series prefix (SET was one vendor's example). The description signals only " +
      'reach this rule when the number itself is not an IQV/IPV document (captured at 8/10).',
    when: (inv, desc, ctx) =>
      desc.includes('PAYBACK') ||
      desc.includes('IPV IADE FATURASI') ||
      (inv.length === 16 &&
        (ctx?.credit ?? 0) > 0 &&
        (desc.includes('CLAIM REVERSAL') || /\bI[PQ]V\d{13}\b/.test(desc))),
  },
  {
    precedence: 24,
    type: 'DROPSHIP',
    note:
      "THREE-CONDITION dropship recognition: (1) invoice number ≥ 16 chars; (2) description carries the " +
      "'DROPSHIP-PO-' marker; (3) ECHO rule — the invoice number itself appears after the marker " +
      '(path shape DROPSHIP-PO-{site}/{warehouse}/|{x}, e.g. DROPSHIP-PO-EHMZ-TR/EHMZ/|AYT2023000002721). ' +
      'Previously these rows fell to Siniflandirilmamis.',
    when: isDropshipInvoice,
  },
  {
    precedence: 25,
    type: 'Ticari Isbirligi Faturasi',
    note:
      'DEMOTED coop bare-prefix branch (analyst ruling — prefix demotion): when the vendor owns the C ' +
      'series (VENDOR_SERIES_THRESHOLD share of verified sales invoices start with C), a C1/C0 prefix alone is asked LAST, after ' +
      'every referential rule (QPD 21, payback 23, dropship 24) — the last resort before Siniflandirilmamis. ' +
      'Fixes prefix capture of QPD settlements and disputes referencing vendor C-series invoices.',
    when: (inv, _desc, ctx) =>
      isCoopByPrefix(inv) && (ctx?.vendorOwnedSeries?.has('C') ?? false),
  },
  {
    precedence: 26,
    type: 'Iade Edilen Ürünler Için Kesilen Iade Faturasi',
    note:
      'DEMOTED return bare-prefix branch (analyst ruling — prefix demotion): when the vendor owns the V ' +
      'series, a V1/V0 prefix alone is asked LAST — the last resort before Siniflandirilmamis.',
    when: (inv, _desc, ctx) =>
      isReturnByPrefix(inv) && (ctx?.vendorOwnedSeries?.has('V') ?? false),
  },
] as const;

/** The assumed classification of last resort (see design doc §3.4). */
export const UNCLASSIFIED_FALLBACK: InvoiceCategory = 'Siniflandirilmamis';

/**
 * THE generic classification interpreter: normalizes both inputs
 * (null-safe uppercase), walks the table in precedence order, returns the
 * first match — or the fallback. Total: never throws, always returns a
 * vocabulary member, so every classified row has a rulebook impact rule.
 */
export function classifyByRules(
  invoiceNumber: string,
  description: string,
  context?: ClassificationContext,
): InvoiceCategory {
  const inv = (invoiceNumber || '').toUpperCase();
  const desc = (description || '').toUpperCase();

  for (const rule of CLASSIFICATION_RULES) {
    if (rule.when(inv, desc, context)) return rule.type;
  }
  return UNCLASSIFIED_FALLBACK;
}
