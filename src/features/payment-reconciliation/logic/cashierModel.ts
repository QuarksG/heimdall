import { DataSanitizer } from './cleaners/dataSanitizer';
import { AMOUNT_MATCH_TOLERANCE } from './matchers/openItemFinder';
import { runPqvOperations } from './cleaners/operations/PQV_Operations';
import { runPpvOperations, collectPpvClaimedRoots } from './cleaners/operations/PPV_Operations';
import { runProvisionOperations } from './cleaners/operations/Provision_Operations';
import { runQpdOperations } from './cleaners/operations/QPD_Operations';
import { CLOSED_STATES } from './cleaners/operations/operations.types';
import type { OperationChain, ChainState } from './cleaners/operations/operations.types';
import { INVOICE_CATEGORIES } from '../types/regional.types';
import type { PaymentRecord, InvoiceCategory } from '../types/regional.types';

/**
 * CASHIER MODEL — the three-layer, gated accounting-identity pipeline.
 * =====================================================================
 *
 * REDESIGN (replaces the former open-item model): the model no longer
 * lists balance-impact chains. It proves, per remittance file, that the
 * deductions explain the payment:
 *
 *   Layer 1 — Type-Level Aggregation: one row per InvoiceCategory
 *             present, with Sum of Alacak / Sum of Borç / Sum of
 *             Uygulanan indirim / Fark (Alacak − Borç), English names
 *             and column explanations, plus a Fark conservation check.
 *   Layer 2 — Balance Check (the Gate): the cash-basis identity —
 *             sales (incl. DROPSHIP) minus INCLUDE deductions minus
 *             open items (from the operations modules) minus KEEP
 *             aggregates minus UNRESOLVED components = Computed_Havale,
 *             compared against Actual_Havale.
 *             |Difference| ≤ tolerance → GREEN, else RED.
 *             ANALYST RULING (discount treatment, supersedes the pure
 *             cash-net rule for exactly three components):
 *               • SALES participates GROSS of its own discount —
 *                 Σ(credit − debit + discount) over sales rows;
 *               • Price Claim Invoices (DEDUCTION_IPV) likewise
 *                 participate at Σ(credit − debit + discount);
 *               • the QPD component is DERIVED: −(grand total of
 *                 Uygulanan indirim over ALL rows of the currency) —
 *                 the invoiced QPD rows' own cash-net is untrustworthy
 *                 (such records can be created manually). The INVOICED
 *                 QPD amount is measured on the DEBIT side of the QPD
 *                 rows (Σ Borç — rule of the debit entry: the QPD's
 *                 debit side IS the invoice; the rows' cash-net is
 *                 ALWAYS ≈ 0 by design because every QPD invoice debit
 *                 is immediately offset by a credit). A mismatch
 *                 between the QPD debit total and the discount grand
 *                 total FORCES the currency's gate RED with a
 *                 bilingual red-flag annotation — enriched with the
 *                 QPD chain status breakdown from `runQpdOperations`
 *                 (annotation only) — regardless of the Difference.
 *             All other components stay pure Cash_Net (Alacak − Borç).
 *   Layer 3 — Vendor Ledger: the row-level balance-impact population
 *             ('Tedarikçi Cari Hareketleri'), closing to zero; rendered
 *             only on GREEN.
 *
 * The model is a PURE COMPUTATION stage: `runCashierModel(records)`
 * returns a discriminated outcome the renderers consume. All business
 * decisions (dispositions, identity composition, gate, ledger
 * population, closure verification) live here; the sheet builders and
 * the exporter are render/orchestration only. The operations modules
 * (PQV, PPV, Provision, QPD) and classification rules are untouched.
 */

/* ====================================================================
 * Contracts
 * ==================================================================== */

/** The pass/fail outcome of the Balance Check. */
export type GateOutcome = 'GREEN' | 'RED';

/** Validation checks, in strict precedence order. */
export type ValidationCheck = 'EMPTY_INPUT' | 'MALFORMED_AMOUNT' | 'ALL_ZERO_AMOUNTS';

export interface CashierValidationFailure {
  /** Precedence: EMPTY_INPUT > MALFORMED_AMOUNT > ALL_ZERO_AMOUNTS. */
  check: ValidationCheck;
  /** Bilingual (Turkish + English), identifies the failed check. */
  message: string;
}

/**
 * The per-InvoiceCategory ruling on how a type participates in the
 * Balance Check identity and the Vendor Ledger.
 */
export type Disposition =
  | 'TARGET' // Giden Havale — the Actual_Havale side of the identity
  | 'INCLUDE' // sales side + the seven deduction types (all rows)
  | 'KEEP' // aggregate Cash_Net, all rows in ledger
  | 'OPEN_ITEMS_ONLY' // SC/SCR, PC/PCR, provisions — open chains only
  | 'UNRESOLVED'; // Siniflandirilmamis, MISSING_ACTUAL_OR_BAN (provisional)

/** One Layer 1 aggregation row (one per distinct type present). */
export interface AggregationRow {
  invoiceType: InvoiceCategory;
  /** From ENGLISH_NAMES; falls back to the type name itself. */
  englishName: string;
  /** Sum of Alacak. */
  sumCredit: number;
  /** Sum of Borç. */
  sumDebit: number;
  /** Sum of Uygulanan indirim. */
  sumDiscount: number;
  /** Fark = sumCredit − sumDebit (cash-basis net impact). */
  fark: number;
}

/** One Layer 1 block — everything is currency-scoped. */
export interface AggregationBlock {
  currency: string;
  /** One row per distinct type present, in vocabulary order. */
  rows: AggregationRow[];
  totals: Omit<AggregationRow, 'invoiceType' | 'englishName'>;
  /** |Σ fark − Cash_Net(currency population)| ≤ 0.01 — asserted at build time. */
  farkConservationOk: true;
  /**
   * SALES INVOICE PERIOD (analyst instruction): first and last invoice
   * date over the currency's 'Toptan Satis Faturasi' rows ONLY — the
   * covered trading period of the file, rendered under the Layer 1
   * title. Absent when the currency has no parseable sales invoice date.
   * Values are the raw source date strings (e.g. '11-AUG-2022').
   */
  salesInvoicePeriod?: { first: string; last: string };
}

/** One Layer 2 identity component (fixed set, zero when population empty). */
export interface IdentityComponent {
  /** Stable id, e.g. 'SALES', 'DEDUCTION_CCOGS', 'OPEN_SC_SCR'. */
  key: string;
  turkishName: string;
  englishName: string;
  /** Alacak − Borç for this component (0 when population empty). */
  cashNet: number;
  /** UNRESOLVED audit note ("included conservatively …"). */
  annotation?: string;
}

/** One Layer 2 balance check (per currency). */
export interface BalanceCheck {
  currency: string;
  /** FIXED order per Requirement 4.9 (rendered even when zero). */
  components: IdentityComponent[];
  /** Σ components.cashNet. */
  computedHavale: number;
  /** Σ Borç − Alacak over 'Giden Havale' rows (this currency). */
  actualHavale: number;
  /** computedHavale − actualHavale. */
  difference: number;
  /**
   * |difference| ≤ CASHIER_TOLERANCE → GREEN (zero always GREEN) —
   * UNLESS `qpdMismatch` is true, which forces RED regardless of the
   * Difference (analyst ruling: manually creatable QPD records demand
   * manual review even when the identity balances via the derived
   * discount grand total).
   */
  gate: GateOutcome;
  /**
   * TRUE when the invoiced QPD amount — Σ Borç (total DEBIT) over the
   * currency's QPD rows, the debit side being the invoice (the rows'
   * cash-net is always ≈ 0 by design: every QPD invoice debit is
   * immediately offset by a credit) — deviates from the currency's
   * Uygulanan indirim grand total by more than the tolerance. Forces
   * the gate RED and carries a bilingual red-flag annotation on the
   * KEEP_QPD component, enriched with the QPD chain status breakdown
   * from the QPD operations module.
   */
  qpdMismatch: boolean;
  /**
   * The expected per-currency ledger-closure offset: the ledger rows
   * carry NO discount, so on a GREEN gate the raw cumulative
   * Σ Borç − Alacak no longer closes to zero — it is offset by exactly
   * the discount adjustments the identity applies over the pure row
   * cash-nets: salesDiscount + ipvDiscount +
   * (−discountGrandTotal − invoicedQpdRowsCashNet).
   * Closure verification asserts |cumulative − expectedLedgerOffset| ≤
   * tolerance.
   */
  expectedLedgerOffset: number;
}

/** The successful model output all three renderers consume. */
export interface CashierModelResult {
  /** One Layer 1 block per currency. */
  aggregationBlocks: AggregationBlock[];
  /** One Layer 2 balance check per currency. */
  balanceChecks: BalanceCheck[];
  /** GREEN iff every balanceChecks[i].gate === 'GREEN'. */
  overallGate: GateOutcome;
  /** Layer 3 population in Payment Data relative order (each record exactly once). */
  ledgerRecords: PaymentRecord[];
  /** Per-currency Σ Borç − Alacak over ledgerRecords — verified ≤ tolerance at build time. */
  ledgerClosures: Array<{ currency: string; cumulative: number }>;
  /** UNRESOLVED-type inclusions and other analyst-facing notes. */
  annotations: string[];
  /** CASHIER_TOLERANCE = AMOUNT_MATCH_TOLERANCE = 0.01. */
  tolerance: number;
}

/**
 * Discriminated outcome: validation failures are EXPECTED business
 * outcomes the exporter must message precisely (`ok: false`); internal
 * invariant violations (Fark conservation, ledger closure) throw
 * because they indicate the model itself is inconsistent.
 */
export type CashierModelOutcome =
  | { ok: true; result: CashierModelResult }
  | { ok: false; failure: CashierValidationFailure };

/** Currency tolerance for the Gate and all model assertions (one kuruş). */
export const CASHIER_TOLERANCE = AMOUNT_MATCH_TOLERANCE;

/* ====================================================================
 * Disposition map — TOTAL over the vocabulary (Requirement 6.9).
 *
 * Typed as Record<InvoiceCategory, Disposition>: adding a vocabulary
 * member to INVOICE_CATEGORIES without a ruling here is a COMPILE
 * ERROR, so no type can silently vanish from both the identity and
 * the ledger.
 * ==================================================================== */

export const DISPOSITIONS: Record<InvoiceCategory, Disposition> = {
  // TARGET — the reconciliation target (Actual_Havale side).
  'Giden Havale': 'TARGET',

  // INCLUDE — sales side.
  'Toptan Satis Faturasi': 'INCLUDE',
  DROPSHIP: 'INCLUDE',

  // INCLUDE — the seven full-row deduction types.
  'Ticari Isbirligi Faturasi': 'INCLUDE',
  'Iade Edilen Ürünler Için Kesilen Iade Faturasi': 'INCLUDE',
  'Eksik Miktar Kesinti Faturasi': 'INCLUDE',
  'Arsiv Eksik Miktar Kesinti Faturasi': 'INCLUDE',
  'Fiyat Farki Kesinti Faturasi': 'INCLUDE',
  'Arsiv Fiyat Farki Kesinti Faturasi': 'INCLUDE',
  'AR Faturasi': 'INCLUDE',

  // KEEP — aggregate Cash_Net participates; all rows in the ledger.
  'Bank Ücreti': 'KEEP',
  'CRTR Geri Ödemesi': 'KEEP',
  'Amazon Itrazlari': 'KEEP',
  QPD: 'KEEP',
  'Itraz Sonucu Geri Odeme': 'KEEP',

  // OPEN_ITEMS_ONLY — only open chains participate (netted chains and
  // netted provision families contribute nothing).
  'Eksik Miktar Kesinti Bildirimi': 'OPEN_ITEMS_ONLY', // SC via PQV
  'Eksik Miktar Kesinti Bildirimi Ters kayit': 'OPEN_ITEMS_ONLY', // SCR via PQV
  'Fiyat Farki Kesinti Bildirimi': 'OPEN_ITEMS_ONLY', // PC via PPV
  'Fiyat Farki Kesinti Bildirimi Ters Kayit': 'OPEN_ITEMS_ONLY', // PCR via PPV
  'Alacak Provizyonu': 'OPEN_ITEMS_ONLY', // via Provision
  'Vadesi Geçmis Alacak Provizyonu': 'OPEN_ITEMS_ONLY', // via Provision

  // UNRESOLVED — provisional conservative inclusion (Open Question 2).
  Siniflandirilmamis: 'UNRESOLVED',
  MISSING_ACTUAL_OR_BAN: 'UNRESOLVED',
};

/* ====================================================================
 * English name map (Layer 1) — complete over the vocabulary, with the
 * identity fallback of Requirement 2.8 for any unmapped member.
 * ==================================================================== */

export const ENGLISH_NAMES: Record<InvoiceCategory, string> = {
  'Giden Havale': 'Net receipt transfers',
  'Toptan Satis Faturasi': 'Sales Invoices-Vendor Debit Entries',
  DROPSHIP: 'Dropship Sales Invoices',
  'Ticari Isbirligi Faturasi': 'CCOGS (Contra Cost of Goods Sold)',
  'Iade Edilen Ürünler Için Kesilen Iade Faturasi': 'Vendor Returns',
  'Eksik Miktar Kesinti Faturasi': 'Shortage Claim Invoices',
  'Arsiv Eksik Miktar Kesinti Faturasi': 'Archived Shortage Claim Invoices',
  'Fiyat Farki Kesinti Faturasi': 'Price Claim Invoices',
  'Arsiv Fiyat Farki Kesinti Faturasi': 'Archived Price Claim Invoices',
  'AR Faturasi': 'AR Invoices-ADI prefixed',
  'Bank Ücreti': 'Bank Fee',
  'CRTR Geri Ödemesi': 'CRTR Refund',
  'Amazon Itrazlari': 'Amazon Disputes',
  QPD: 'QPD (Quick Pay Discount)',
  'Itraz Sonucu Geri Odeme': 'Dispute-Result Refund',
  'Eksik Miktar Kesinti Bildirimi': 'Shortage Claim Notifications',
  'Eksik Miktar Kesinti Bildirimi Ters kayit': 'Shortage Claim Reversal Notifications',
  'Fiyat Farki Kesinti Bildirimi': 'Price Claim Notifications',
  'Fiyat Farki Kesinti Bildirimi Ters Kayit': 'Price Claim Reversal Notifications',
  'Alacak Provizyonu': 'Provision',
  'Vadesi Geçmis Alacak Provizyonu': 'Aged Provisions',
  Siniflandirilmamis: 'Unclassified',
  MISSING_ACTUAL_OR_BAN: 'Missing Actual or BAN',
};

/**
 * English name with the identity fallback (Requirement 2.8): a member
 * missing from ENGLISH_NAMES — impossible at compile time, but
 * defensively possible for cast runtime data — renders as itself.
 */
export function englishNameFor(invoiceType: InvoiceCategory): string {
  return ENGLISH_NAMES[invoiceType] ?? invoiceType;
}

/* ====================================================================
 * Input validation (Requirement 1) — strict precedence:
 * EMPTY_INPUT > MALFORMED_AMOUNT > ALL_ZERO_AMOUNTS.
 * A failure short-circuits the model: no layer results are produced.
 * ==================================================================== */

/** The three amount columns validated on every record. */
const AMOUNT_FIELDS = ['credit', 'debit', 'discount'] as const;

function isMalformed(record: PaymentRecord): boolean {
  return AMOUNT_FIELDS.some(field => !Number.isFinite(record[field]));
}

function isAllZero(record: PaymentRecord): boolean {
  return AMOUNT_FIELDS.every(field => record[field] === 0);
}

/**
 * Validates the input population before any layer computes.
 * Returns `null` when the input is computable; otherwise the single
 * highest-precedence failure with a bilingual message.
 */
export function validate(records: PaymentRecord[]): CashierValidationFailure | null {
  if (records.length === 0) {
    return {
      check: 'EMPTY_INPUT',
      message:
        'Doğrulama hatası — BOŞ GİRDİ: Ödeme verisi hiç satır içermiyor; hesaplama yapılamadı. / ' +
        'Validation failure — EMPTY_INPUT: the payment data contains zero rows; nothing was computed.',
    };
  }

  if (records.some(isMalformed)) {
    return {
      check: 'MALFORMED_AMOUNT',
      message:
        'Doğrulama hatası — HATALI TUTAR: En az bir satırın Alacak, Borç veya Uygulanan indirim ' +
        'sütunu eksik ya da sayısal değil; hesaplama yapılamadı. / ' +
        'Validation failure — MALFORMED_AMOUNT: at least one row carries a missing or non-numeric ' +
        'Alacak (credit), Borç (debit) or Uygulanan indirim (discount) amount; nothing was computed.',
    };
  }

  if (records.every(isAllZero)) {
    return {
      check: 'ALL_ZERO_AMOUNTS',
      message:
        'Doğrulama hatası — TÜM TUTARLAR SIFIR: Her satırda Alacak, Borç ve Uygulanan indirim ' +
        'tutarları sıfır; hesaplama yapılamadı. / ' +
        'Validation failure — ALL_ZERO_AMOUNTS: the Alacak (credit), Borç (debit) and Uygulanan ' +
        'indirim (discount) amounts are all exactly zero across every row; nothing was computed.',
    };
  }

  return null;
}

/* ====================================================================
 * Currency partitioning — everything downstream is currency-scoped.
 *
 * Records are bucketed by their TRIMMED `currency`; blank currencies
 * land in the literal '(boş)' bucket so no record is ever dropped.
 * Layer 1 blocks, Layer 2 balance checks and the Layer 3 closure are
 * all computed per bucket so amounts are never mixed across
 * currencies (Requirement 8.3).
 * ==================================================================== */

/** The bucket label for records whose currency is blank after trimming. */
export const BLANK_CURRENCY_BUCKET = '(boş)';

/** The single currency-bucketing rule: trimmed `currency`, blank → '(boş)'. */
function currencyBucketOf(record: PaymentRecord): string {
  return record.currency.trim() || BLANK_CURRENCY_BUCKET;
}

/**
 * Partitions records by trimmed `currency`, preserving first-seen
 * bucket order and the Payment Data relative order within each bucket.
 * Every input record lands in exactly one bucket.
 */
export function partitionByCurrency(records: PaymentRecord[]): Map<string, PaymentRecord[]> {
  const buckets = new Map<string, PaymentRecord[]>();
  for (const record of records) {
    const currency = currencyBucketOf(record);
    const bucket = buckets.get(currency);
    if (bucket) {
      bucket.push(record);
    } else {
      buckets.set(currency, [record]);
    }
  }
  return buckets;
}

/* ====================================================================
 * Layer 1 — Type-Level Aggregation (Requirement 2).
 *
 * One row per distinct InvoiceCategory present in the currency
 * population, in vocabulary (INVOICE_CATEGORIES) order, each carrying
 * Sum of Alacak / Sum of Borç / Sum of Uygulanan indirim and the
 * computed Fark (Sum of Alacak − Sum of Borç), plus grand-total data.
 *
 * Fark conservation is ASSERTED at build time: Σ Fark over the rows
 * must equal the Cash_Net of the currency population within tolerance
 * (Requirement 2.7). A violation means the model itself is
 * inconsistent, so it throws rather than returning a result.
 * ==================================================================== */

const round2 = DataSanitizer.roundAmount;

/** Mutable accumulator for one invoice type's sums. */
interface TypeSums {
  sumCredit: number;
  sumDebit: number;
  sumDiscount: number;
}

/**
 * Builds the Layer 1 aggregation block for one currency population.
 *
 * Every record contributes to the sums of exactly one row (its
 * invoice type) — no record omitted, none double-counted
 * (Requirement 2.1). Sums are rounded at each accumulation step via
 * `DataSanitizer.roundAmount`, matching the codebase-wide money
 * convention, so drift can never accumulate past a kuruş.
 *
 * @throws Error (bilingual) when Fark conservation is violated.
 */
export function buildAggregationBlock(
  currency: string,
  records: PaymentRecord[],
): AggregationBlock {
  // Accumulate per-type sums in a single pass.
  const sumsByType = new Map<InvoiceCategory, TypeSums>();
  for (const record of records) {
    let sums = sumsByType.get(record.invoiceType);
    if (!sums) {
      sums = { sumCredit: 0, sumDebit: 0, sumDiscount: 0 };
      sumsByType.set(record.invoiceType, sums);
    }
    sums.sumCredit = round2(sums.sumCredit + record.credit);
    sums.sumDebit = round2(sums.sumDebit + record.debit);
    sums.sumDiscount = round2(sums.sumDiscount + record.discount);
  }

  // SALES INVOICE PERIOD (analyst instruction): earliest and latest
  // parseable invoice date over the SALES rows only — the covered
  // trading period. Unparseable dates never vote; raw source strings
  // are kept for display fidelity.
  let firstSale: { raw: string; time: number } | null = null;
  let lastSale: { raw: string; time: number } | null = null;
  for (const record of records) {
    if (record.invoiceType !== 'Toptan Satis Faturasi') continue;
    const parsed = DataSanitizer.parseDateOrNull(record.invoiceDate);
    if (!parsed) continue;
    const time = parsed.getTime();
    if (firstSale === null || time < firstSale.time) {
      firstSale = { raw: record.invoiceDate, time };
    }
    if (lastSale === null || time > lastSale.time) {
      lastSale = { raw: record.invoiceDate, time };
    }
  }
  const salesInvoicePeriod =
    firstSale !== null && lastSale !== null
      ? {
          first: (firstSale as { raw: string; time: number }).raw,
          last: (lastSale as { raw: string; time: number }).raw,
        }
      : undefined;

  // One row per distinct type PRESENT, in vocabulary order.
  const rows: AggregationRow[] = [];
  for (const invoiceType of INVOICE_CATEGORIES) {
    const sums = sumsByType.get(invoiceType);
    if (!sums) continue;
    rows.push({
      invoiceType,
      englishName: englishNameFor(invoiceType),
      sumCredit: sums.sumCredit,
      sumDebit: sums.sumDebit,
      sumDiscount: sums.sumDiscount,
      fark: round2(sums.sumCredit - sums.sumDebit),
    });
  }

  // Grand-total row data (Kumile Tutar / Grand Total).
  const totals: AggregationBlock['totals'] = {
    sumCredit: round2(rows.reduce((acc, row) => round2(acc + row.sumCredit), 0)),
    sumDebit: round2(rows.reduce((acc, row) => round2(acc + row.sumDebit), 0)),
    sumDiscount: round2(rows.reduce((acc, row) => round2(acc + row.sumDiscount), 0)),
    fark: round2(rows.reduce((acc, row) => round2(acc + row.fark), 0)),
  };

  // Fark conservation (Requirement 2.7): Σ Fark ≡ Cash_Net of the
  // currency population within tolerance. Asserted at build time —
  // a violation is an internal inconsistency, never a rendered artifact.
  const populationCashNet = records.reduce(
    (acc, record) => round2(acc + record.credit - record.debit),
    0,
  );
  const conservationGap = Math.abs(totals.fark - populationCashNet);
  if (conservationGap > CASHIER_TOLERANCE) {
    throw new Error(
      `Kasiyer modeli iç tutarlılık hatası — FARK KORUNUMU (${currency}): ` +
        `Fark sütununun toplamı (${DataSanitizer.formatNumber(totals.fark)}) bu para biriminin ` +
        `nakit netinden (${DataSanitizer.formatNumber(populationCashNet)}) ` +
        `${DataSanitizer.formatNumber(conservationGap)} kadar sapıyor; dışa aktarma durduruldu. / ` +
        `Cashier model internal-consistency failure — FARK CONSERVATION (${currency}): ` +
        `the Fark column total (${DataSanitizer.formatNumber(totals.fark)}) deviates from the ` +
        `currency population's cash net (${DataSanitizer.formatNumber(populationCashNet)}) ` +
        `by ${DataSanitizer.formatNumber(conservationGap)}; the export was halted.`,
    );
  }

  return { currency, rows, totals, farkConservationOk: true, salesInvoicePeriod };
}

/* ====================================================================
 * Open-chain collection from the operations modules
 * (Requirements 3.4, 3.5, 3.6, 3.8, 6.5, 6.6, 6.7, 7.2, 8.4).
 *
 * The model obtains open-item resolution EXCLUSIVELY from the existing
 * operations modules (Requirement 7.2) — exactly three, run once per
 * file: PQV (fed PPV's claimed roots for cross-family sales
 * adjudication, mirroring FilteredInvoicesSheet), PPV, and Provision.
 * QPD operations feed NO identity, ledger or open-item component:
 * 'QPD' carries the KEEP disposition (derived aggregate), so the
 * identity needs no QPD chain resolution. `runQpdOperations` IS run
 * once per file here (analyst instruction), but its chains inform the
 * QPD-mismatch red-flag ANNOTATION ONLY — the reconciliation status
 * breakdown the Filtered Invoices sheet shows for the QPD
 * classification.
 *
 * OPEN chains are:
 *   PQV/PPV   — states 'Pending Matching - Review' and
 *               'Pending Invoice Cancelation / Stuck - Review'
 *   Provision — state 'Açık', and only for families whose
 *               Σ Borç − Σ Alacak > 0 (Requirement 3.4)
 *
 * ROW-UNIQUENESS (Requirement 6.10): PQV/PPV chains carry root sales
 * rows and final IQV/IPV documents in `chain.rows` for traceability —
 * those types are INCLUDE and already counted at full-row Cash_Net.
 * The collection therefore takes from each open chain ONLY the rows
 * whose `invoiceType` belongs to the owned pair/family:
 *   SC/SCR for PQV, PC/PCR for PPV, and the two OPEN_ITEMS_ONLY
 *   provision types for Provision. ('MISSING_ACTUAL_OR_BAN' is a
 *   provision family in the operations module but UNRESOLVED here —
 *   its rows participate as their own labeled identity component, so
 *   its chains are excluded to prevent double counting.)
 * Netted chains and netted provision families contribute NOTHING:
 * they never reach an open state, so the state filter drops them.
 * ==================================================================== */

/** PQV/PPV chain states that participate as ordinary open items. */
export const OPEN_ITEM_STATES: ReadonlySet<ChainState> = new Set<ChainState>([
  'Pending Matching - Review',
  'Pending Invoice Cancelation / Stuck - Review',
]);

/** PQV state that participates as a distinct excess-shortage family. */
export const EXCESS_SHORTAGE_STATE: ChainState = 'Excess Credit - Review';

/** The SC/SCR claim-notice pair owned by PQV open chains. */
export const SC_SCR_TYPES: readonly InvoiceCategory[] = [
  'Eksik Miktar Kesinti Bildirimi',
  'Eksik Miktar Kesinti Bildirimi Ters kayit',
];

/** The PC/PCR claim-notice pair owned by PPV open chains. */
export const PC_PCR_TYPES: readonly InvoiceCategory[] = [
  'Fiyat Farki Kesinti Bildirimi',
  'Fiyat Farki Kesinti Bildirimi Ters Kayit',
];

/**
 * The provision families with the OPEN_ITEMS_ONLY disposition.
 * Deliberately NARROWER than the operations module's PROVISION_FAMILIES:
 * 'MISSING_ACTUAL_OR_BAN' is UNRESOLVED (Requirement 6.8) and counted
 * as its own identity component, never through open provision chains.
 */
export const OPEN_PROVISION_TYPES: readonly InvoiceCategory[] = [
  'Alacak Provizyonu',
  'Vadesi Geçmis Alacak Provizyonu',
];

/** One open chain with its identity-participating rows already filtered. */
export interface OpenChainRows {
  /** The chain exactly as its operations module emitted it. */
  chain: OperationChain;
  /**
   * Only the rows whose `invoiceType` belongs to the owned pair/family
   * (SC/SCR, PC/PCR, or open provision types) — the rows that
   * participate in the Layer 2 identity and the Layer 3 ledger.
   * Traceability rows (sales, final documents) are excluded here
   * because their INCLUDE types are already counted at full-row
   * Cash_Net (Requirement 6.10).
   */
  ownedRows: PaymentRecord[];
}

/** Open chains grouped by owning operations module (once per file). */
export interface OpenChainCollection {
  /** PQV ordinary open chains — SC/SCR rows only (Requirements 3.5, 6.5). */
  scScr: OpenChainRows[];
  /** PQV excess-credit chains — SC/SCR rows shown as their own cashier family. */
  excessScScr: OpenChainRows[];
  /** PPV Open_Item_Chains — PC/PCR rows only (Requirements 3.6, 6.6). */
  pcPcr: OpenChainRows[];
  /**
   * Open_Provision_Batch chains ('Açık') of families whose
   * Σ Borç − Σ Alacak > 0 — provision-type rows only
   * (Requirements 3.4, 6.7).
   */
  provision: OpenChainRows[];
  /**
   * ANNOTATION-ONLY (analyst instruction): the QPD operations chains,
   * exactly as `runQpdOperations` emitted them. They enrich the
   * QPD-mismatch red-flag annotation with the chain status breakdown
   * and MUST NOT feed the identity components, the ledger membership
   * or the open-item collection — 'QPD' stays KEEP with the derived
   * discount grand total.
   */
  qpdChains: OperationChain[];
}

/**
 * Runs the three operations modules once over the full record
 * population and collects the open chains with their owned pair/family
 * rows. Consumed by the Layer 2 balance check (open-item components at
 * Cash_Net, Requirement 3.8 — the gross residual stays on Filtered
 * Invoices only) and the Layer 3 ledger (only these rows of
 * OPEN_ITEMS_ONLY types enter the Balance_Impact_Population).
 *
 * A defensive identity set guarantees no record object is handed out
 * twice across all collected chains (Requirement 6.10) — structurally
 * unreachable because each module partitions its owned rows into
 * disjoint chains, but asserted cheaply here rather than trusted.
 */
export function collectOpenChains(records: PaymentRecord[]): OpenChainCollection {
  // Four operations modules, once per file. PQV receives PPV's
  // claimed roots first (cross-family sales adjudication), mirroring
  // the FilteredInvoicesSheet invocation. QPD participates for the
  // mismatch ANNOTATION only — its chains never feed the identity,
  // the ledger or the open-item components.
  const ppvClaimedRoots = collectPpvClaimedRoots(records);
  const pqvResult = runPqvOperations(records, ppvClaimedRoots);
  const ppvResult = runPpvOperations(records);
  const provisionResult = runProvisionOperations(records);
  const qpdResult = runQpdOperations(records);

  // Row-uniqueness guard: each PaymentRecord object is owned at most once.
  const counted = new Set<PaymentRecord>();
  const takeOwnedRows = (
    chain: OperationChain,
    ownedTypes: readonly InvoiceCategory[],
  ): PaymentRecord[] =>
    chain.rows.filter(row => {
      if (!ownedTypes.includes(row.invoiceType)) return false;
      if (counted.has(row)) return false;
      counted.add(row);
      return true;
    });

  // PQV/PPV: ordinary open states and PQV excess credits participate
  // as separate cashier families; netted (closed) chains and every
  // other lifecycle state contribute nothing.
  const scScr: OpenChainRows[] = pqvResult.chains
    .filter(chain => OPEN_ITEM_STATES.has(chain.state))
    .map(chain => ({ chain, ownedRows: takeOwnedRows(chain, SC_SCR_TYPES) }));

  const excessScScr: OpenChainRows[] = pqvResult.chains
    .filter(chain => chain.state === EXCESS_SHORTAGE_STATE)
    .map(chain => ({ chain, ownedRows: takeOwnedRows(chain, SC_SCR_TYPES) }));

  const pcPcr: OpenChainRows[] = ppvResult.chains
    .filter(chain => OPEN_ITEM_STATES.has(chain.state))
    .map(chain => ({ chain, ownedRows: takeOwnedRows(chain, PC_PCR_TYPES) }));

  // Provision: 'Açık' batches participate only when the FAMILY residual
  // Σ Borç − Σ Alacak > 0 (Requirement 3.4). Fully netted families are
  // never emitted by the module; negative-residual families (unreleased
  // credits) are emitted but do NOT qualify as open provisions here.
  const familyResiduals = new Map<InvoiceCategory, number>();
  for (const family of OPEN_PROVISION_TYPES) {
    familyResiduals.set(
      family,
      records
        .filter(record => record.invoiceType === family)
        .reduce((sum, record) => round2(sum + record.debit - record.credit), 0),
    );
  }

  const provision: OpenChainRows[] = provisionResult.chains
    .filter(chain => {
      if (chain.state !== 'Açık') return false;
      const family = chain.rows[0]?.invoiceType;
      if (family === undefined || !OPEN_PROVISION_TYPES.includes(family)) return false;
      return (familyResiduals.get(family) ?? 0) > 0;
    })
    .map(chain => ({ chain, ownedRows: takeOwnedRows(chain, OPEN_PROVISION_TYPES) }));

  return { scScr, excessScScr, pcPcr, provision, qpdChains: qpdResult.chains };
}

/* ====================================================================
 * Layer 2 — Balance Check + the Gate (Requirement 3, 4.9, 6.1–6.4,
 * 6.8, 6.10, 8.2, 8.3, 8.5).
 *
 * The cash-basis accounting identity from the vendor's perspective:
 * sales (incl. DROPSHIP) minus the INCLUDE deductions minus the open
 * items minus the KEEP aggregates minus the UNRESOLVED components
 * = Computed_Havale, compared against Actual_Havale.
 *
 * SIGN CONVENTION (design decision 4, explicit): every identity
 * component is Cash_Net = Σ Alacak − Σ Borç, so deductions come out
 * naturally negative and Computed_Havale is simply the Σ of all
 * component cash-nets. ANALYST-RULED EXCEPTIONS (three, exactly):
 * SALES and DEDUCTION_IPV participate GROSS of their own signed
 * discount (Σ Alacak − Borç + indirim), and KEEP_QPD is DERIVED as
 * −(Uygulanan indirim grand total over ALL rows of the currency) —
 * never the invoiced QPD rows' cash-net, which can be created
 * manually and is validated separately: Σ Borç over the QPD rows (the
 * debit side IS the invoice) is compared against the discount grand
 * total (mismatch ⇒ gate RED). Actual_Havale is Σ Borç − Σ Alacak over the
 * currency's 'Giden Havale' rows — the transfer MAGNITUDE (positive,
 * matching the worked sample's 86,539,086.67), zero when no such rows
 * exist (Requirement 3.14). Difference = Computed − Actual.
 *
 * The component row set is FIXED (Requirement 4.9): every fixed
 * component is emitted even when its population is empty (cash-net 0,
 * Requirement 3.13) so files are comparable side by side. Only the
 * UNRESOLVED components are data-dependent — one labeled row per
 * UNRESOLVED type PRESENT, always last (Requirement 6.8).
 *
 * Everything is currency-scoped (design decision 3): the caller hands
 * in one currency's record partition, and the open-chain components
 * take only the owned rows that belong to this currency bucket.
 * ==================================================================== */

/**
 * Cash_Net = Σ Alacak − Σ Borç over a row set — the discount column is
 * EXCLUDED (Requirements 3.8, 8.4: open items participate at Cash_Net;
 * the gross residual stays on Filtered Invoices only).
 */
function cashNetOf(rows: readonly PaymentRecord[]): number {
  return rows.reduce((acc, row) => round2(acc + row.credit - row.debit), 0);
}

/**
 * Gross net = Σ(Alacak − Borç + Uygulanan indirim) over a row set —
 * the discount is SIGNED and ADDED. Analyst ruling: exactly two
 * components participate gross of their own discount — SALES
 * (Toptan Satis + DROPSHIP) and Price Claim Invoices (DEDUCTION_IPV).
 * Every other component stays pure Cash_Net.
 */
function grossNetOf(rows: readonly PaymentRecord[]): number {
  return rows.reduce((acc, row) => round2(acc + row.credit - row.debit + row.discount), 0);
}

/**
 * Σ Uygulanan indirim over a row set (signed). Used for the
 * currency-wide discount grand total that DERIVES the QPD component,
 * and for the per-component discount adjustments feeding the expected
 * ledger-closure offset.
 */
function discountSumOf(rows: readonly PaymentRecord[]): number {
  return rows.reduce((acc, row) => round2(acc + row.discount), 0);
}

/** The seven full-row deduction components, in the FIXED identity order. */
const DEDUCTION_COMPONENTS: ReadonlyArray<{ key: string; invoiceType: InvoiceCategory }> = [
  { key: 'DEDUCTION_CCOGS', invoiceType: 'Ticari Isbirligi Faturasi' },
  {
    key: 'DEDUCTION_VENDOR_RETURNS',
    invoiceType: 'Iade Edilen Ürünler Için Kesilen Iade Faturasi',
  },
  { key: 'DEDUCTION_IPV', invoiceType: 'Fiyat Farki Kesinti Faturasi' },
  { key: 'DEDUCTION_ARCHIVED_IPV', invoiceType: 'Arsiv Fiyat Farki Kesinti Faturasi' },
  { key: 'DEDUCTION_IQV', invoiceType: 'Eksik Miktar Kesinti Faturasi' },
  { key: 'DEDUCTION_ARCHIVED_IQV', invoiceType: 'Arsiv Eksik Miktar Kesinti Faturasi' },
  { key: 'DEDUCTION_AR', invoiceType: 'AR Faturasi' },
];

/** The five KEEP components, one row per type, in the FIXED identity order. */
const KEEP_COMPONENTS: ReadonlyArray<{ key: string; invoiceType: InvoiceCategory }> = [
  { key: 'KEEP_BANK_FEE', invoiceType: 'Bank Ücreti' },
  { key: 'KEEP_CRTR_REFUND', invoiceType: 'CRTR Geri Ödemesi' },
  { key: 'KEEP_AMAZON_DISPUTES', invoiceType: 'Amazon Itrazlari' },
  { key: 'KEEP_QPD', invoiceType: 'QPD' },
  { key: 'KEEP_DISPUTE_RESULT_REFUND', invoiceType: 'Itraz Sonucu Geri Odeme' },
];

/**
 * The UNRESOLVED components — emitted LAST, one labeled row per type
 * PRESENT in the currency population (Requirement 6.8, Open Question 2
 * provisional conservative inclusion).
 */
const UNRESOLVED_COMPONENTS: ReadonlyArray<{ key: string; invoiceType: InvoiceCategory }> = [
  { key: 'UNRESOLVED_SINIFLANDIRILMAMIS', invoiceType: 'Siniflandirilmamis' },
  { key: 'UNRESOLVED_MISSING_ACTUAL_OR_BAN', invoiceType: 'MISSING_ACTUAL_OR_BAN' },
];

/**
 * The conservative-inclusion audit annotation for one UNRESOLVED
 * component (Requirements 6.8, 8.2) — bilingual, identifying the type
 * and its included amount.
 */
function buildUnresolvedAnnotation(
  invoiceType: InvoiceCategory,
  cashNet: number,
  currency: string,
): string {
  const amount = DataSanitizer.formatNumber(cashNet);
  return (
    `DENETİM NOTU (${currency}) — '${invoiceType}' (${englishNameFor(invoiceType)}): ` +
    `bu türün nakit neti (${amount}) analist kararı beklenirken bakiye kontrolü kimliğine ` +
    `İHTİYATLI olarak dahil edildi (Açık Soru 2). / ` +
    `AUDIT NOTE (${currency}) — '${invoiceType}' (${englishNameFor(invoiceType)}): ` +
    `this type's Cash_Net (${amount}) was included CONSERVATIVELY in the balance-check ` +
    `identity pending the analyst ruling of Open Question 2.`
  );
}

/**
 * The QPD chain status breakdown for one currency — how the currency's
 * QPD DEBIT total distributes over the QPD operations chains
 * (annotation only; the identity never consumes these chains).
 */
interface QpdStatusBreakdown {
  /** Σ Borç of this currency's QPD rows inside CLOSED-state chains. */
  reconciled: number;
  /** Σ Borç of this currency's QPD rows inside every other chain state. */
  other: number;
  /** Debit total not covered by any chain (sub-tolerance/unchained rows). */
  residual: number;
}

/**
 * Distributes one currency's QPD debit total over the QPD operations
 * chains: CLOSED-state chains ('Reconciled …') vs every other lifecycle
 * state (open/anomaly/duplicate/cross-period), plus the unchained
 * residual — the same status detail the Filtered Invoices sheet shows
 * for the QPD classification. QPD chain rows are the debit-side QPD
 * documents, so summing their Borç per currency partitions the debit
 * total exactly.
 */
function computeQpdStatusBreakdown(
  currency: string,
  qpdDebitTotal: number,
  qpdChains: readonly OperationChain[],
): QpdStatusBreakdown {
  let reconciled = 0;
  let other = 0;
  for (const chain of qpdChains) {
    const chainDebit = chain.rows
      .filter(row => currencyBucketOf(row) === currency)
      .reduce((acc, row) => round2(acc + row.debit), 0);
    if (chainDebit === 0) continue;
    if (CLOSED_STATES.has(chain.state)) {
      reconciled = round2(reconciled + chainDebit);
    } else {
      other = round2(other + chainDebit);
    }
  }
  return { reconciled, other, residual: round2(qpdDebitTotal - reconciled - other) };
}

/**
 * The bilingual red-flag annotation for a QPD mismatch (analyst
 * ruling): the invoiced QPD amount — Σ Borç over the currency's QPD
 * rows, the DEBIT side being the invoice (the rows' cash-net is always
 * ≈ 0 by design: every QPD invoice debit is immediately offset by a
 * credit) — deviates from the currency's Uygulanan indirim grand
 * total, so the records — which can be created manually — demand
 * manual review. Enriched with the QPD chain status breakdown from the
 * QPD operations module (analyst instruction). Attached to the
 * KEEP_QPD component and rendered below the Balance Check table.
 *
 * @param discountGrandTotal    Σ Uygulanan indirim over ALL rows of the
 *                              currency (what the identity uses).
 * @param invoicedQpdDebitTotal Σ Borç over the currency's QPD rows —
 *                              the invoiced QPD amount.
 * @param breakdown             The QPD chain status breakdown for this
 *                              currency (annotation detail only).
 */
function buildQpdMismatchAnnotation(
  currency: string,
  discountGrandTotal: number,
  invoicedQpdDebitTotal: number,
  breakdown: QpdStatusBreakdown,
): string {
  const grandTotal = DataSanitizer.formatNumber(discountGrandTotal);
  const invoiced = DataSanitizer.formatNumber(invoicedQpdDebitTotal);
  const reconciled = DataSanitizer.formatNumber(breakdown.reconciled);
  const other = DataSanitizer.formatNumber(breakdown.other);
  const residual = DataSanitizer.formatNumber(breakdown.residual);
  return (
    `KIRMIZI BAYRAK (${currency}) — Uygulanan indirim genel toplamı ${grandTotal} ancak ` +
    `faturalanmış QPD işlemleri ${invoiced} — bu kayıtlar manuel oluşturulabildiğinden ` +
    `lütfen manuel kontrol edin. / ` +
    `RED FLAG (${currency}) — Grand Total of discount applied ${grandTotal} however ` +
    `invoiced QPD transactions ${invoiced} — please review manually since such records ` +
    `can be created manually. ` +
    `(QPD mutabakat detayı: mutabık ${reconciled}, açık/diğer ${other}, zincirsiz ${residual} / ` +
    `QPD reconciliation detail: reconciled ${reconciled}, open/other ${other}, unchained ${residual})`
  );
}

/**
 * The Gate rule (Requirements 3.10, 3.11, 8.5): evaluated on the
 * UNROUNDED difference. A difference of exactly zero always yields
 * GREEN; at the tolerance boundary GREEN takes precedence (≤); every
 * check produces exactly one outcome.
 */
/**
 * IEEE-754 representation guard for the boundary comparison ONLY.
 * A true boundary difference (e.g. 100.01 − 100.00) materializes as
 * 0.010000000000005116 in float64 — ~5e-12 past the tolerance — and
 * would wrongly gate RED without this guard, violating the GREEN
 * precedence of Requirement 3.11. The guard is FAR below the smallest
 * representable money step (0.01), so no genuine over-tolerance
 * difference (0.011, 0.02, …) can ever slip through as GREEN — the
 * difference itself stays unrounded (Requirement 3.10).
 */
const GATE_FLOAT_EPSILON = 1e-9;

export function gateFor(difference: number): GateOutcome {
  if (difference === 0) return 'GREEN'; // exactly zero — always GREEN (Req 3.10)
  return Math.abs(difference) <= CASHIER_TOLERANCE + GATE_FLOAT_EPSILON ? 'GREEN' : 'RED';
}

/**
 * The overall Gate — the conjunction over all per-currency gates
 * (Requirement 8.5): GREEN only when EVERY per-currency gate is GREEN.
 */
export function combineGates(checks: readonly BalanceCheck[]): GateOutcome {
  return checks.every(check => check.gate === 'GREEN') ? 'GREEN' : 'RED';
}

/**
 * Collects the component-level annotations (UNRESOLVED conservative
 * inclusions AND QPD-mismatch red flags) from a set of balance checks
 * into the flat analyst-facing `annotations` list of
 * `CashierModelResult` (consumed by the `runCashierModel` wiring).
 */
export function collectUnresolvedAnnotations(checks: readonly BalanceCheck[]): string[] {
  return checks.flatMap(check =>
    check.components.flatMap(component => (component.annotation ? [component.annotation] : [])),
  );
}

/**
 * Builds the Layer 2 balance check for ONE currency population.
 *
 * Components in the FIXED order (Requirement 4.9):
 *   1     Sales (Toptan Satış + DROPSHIP)
 *   2–8   The seven INCLUDE deduction components, one row each
 *   9     Open provisions
 *   10    Open SC/SCR
 *   11    Open PC/PCR
 *   12    One row per KEEP type
 *   13    UNRESOLVED components (only when present), always last
 *
 * Fixed components are emitted even when their populations are empty
 * (cash-net 0, Requirement 3.13). Open-chain components use only the
 * owned pair/family rows that belong to THIS currency bucket (design
 * decision 3 — currency-scoped everything), so a multi-currency chain
 * row can never leak across balance checks.
 *
 * @param currency   The currency bucket label (as produced by
 *                   `partitionByCurrency`).
 * @param records    This currency's record partition, in Payment Data
 *                   relative order.
 * @param openChains The once-per-file open-chain collection from
 *                   `collectOpenChains`.
 */
export function buildBalanceCheck(
  currency: string,
  records: PaymentRecord[],
  openChains: OpenChainCollection,
): BalanceCheck {
  // Group this currency's rows by invoice type in a single pass.
  const rowsByType = new Map<InvoiceCategory, PaymentRecord[]>();
  for (const record of records) {
    const rows = rowsByType.get(record.invoiceType);
    if (rows) {
      rows.push(record);
    } else {
      rowsByType.set(record.invoiceType, [record]);
    }
  }
  const rowsOf = (invoiceType: InvoiceCategory): PaymentRecord[] =>
    rowsByType.get(invoiceType) ?? [];

  // Open-chain rows are collected once per FILE; each component takes
  // only the owned rows belonging to THIS currency bucket.
  const openRowsFor = (groups: readonly OpenChainRows[]): PaymentRecord[] =>
    groups.flatMap(group => group.ownedRows.filter(row => currencyBucketOf(row) === currency));

  const components: IdentityComponent[] = [];

  // Discount adjustments (analyst ruling) — tracked alongside the
  // components so the expected ledger-closure offset (the exact amount
  // by which the identity deviates from the pure row cash-nets) is
  // derived here, once, next to the deviations themselves.
  const salesRows = [...rowsOf('Toptan Satis Faturasi'), ...rowsOf('DROPSHIP')];
  const salesDiscount = discountSumOf(salesRows);
  const ipvRows = rowsOf('Fiyat Farki Kesinti Faturasi');
  const ipvDiscount = discountSumOf(ipvRows);
  // Open-claim rows and their clawed discounts (analyst ruling 2026-08,
  // GROSS open items): an open SC/PC withholds cash NET of the clawed
  // discount, while the KEEP_QPD component (−discount grand total)
  // already carries that claw — so open items must participate GROSS
  // (cash + indirim) or the identity misses exactly the open claw
  // (observed: 1,166.64 permanent RED on a real file).
  const openScScrRows = openRowsFor(openChains.scScr);
  const openExcessScScrRows = openRowsFor(openChains.excessScScr);
  const openPcPcrRows = openRowsFor(openChains.pcPcr);
  const openScScrDiscount = discountSumOf(openScScrRows);
  const openExcessScScrDiscount = discountSumOf(openExcessScScrRows);
  const openPcPcrDiscount = discountSumOf(openPcPcrRows);

  // 1 — Sales side: GROSS of its own discount (analyst ruling) —
  //     Σ(credit − debit + discount) over 'Toptan Satis Faturasi' +
  //     'DROPSHIP' rows (Requirements 3.2, 6.2, discount added).
  components.push({
    key: 'SALES',
    turkishName: 'Satış Faturaları',
    englishName: 'Sales Invoices-Vendor Debit Entries (incl. Dropship)',
    cashNet: grossNetOf(salesRows),
  });

  // 2–8 — The seven full-row deduction components (Requirements 3.3,
  //       6.3). Analyst ruling: DEDUCTION_IPV ('Fiyat Farki Kesinti
  //       Faturasi') participates GROSS of its own discount; the other
  //       six stay pure Cash_Net.
  for (const { key, invoiceType } of DEDUCTION_COMPONENTS) {
    const rows = rowsOf(invoiceType);
    components.push({
      key,
      turkishName: invoiceType,
      englishName: englishNameFor(invoiceType),
      cashNet: key === 'DEDUCTION_IPV' ? grossNetOf(rows) : cashNetOf(rows),
    });
  }

  // 9 — Open provisions: owned rows of 'Açık' batches whose family
  //     residual Σ Borç − Σ Alacak > 0, at Cash_Net (Requirement 3.4).
  components.push({
    key: 'OPEN_PROVISION',
    turkishName: 'Açık Provizyonlar',
    englishName: 'Open Provision Residuals',
    cashNet: cashNetOf(openRowsFor(openChains.provision)),
  });

  // 10 — Open SC/SCR: pair rows of PQV open chains only (Requirement
  //      3.5). GROSS of the clawed discount (analyst ruling 2026-08,
  //      supersedes the Cash_Net rule of Requirement 3.8): the open
  //      exposure is the Kalıntı (Brüt) the Filtered Invoices sheet
  //      shows — Σ(cash + indirim) — matching the vendor-facing amount
  //      and closing the identity against the KEEP_QPD derived claw.
  components.push({
    key: 'OPEN_SC_SCR',
    turkishName: 'Açık Eksik Miktar Kalemleri',
    englishName: 'Open Shortage Claim Items',
    cashNet: grossNetOf(openScScrRows),
  });

  // 10b — Open excess shortage claims: SC/SCR rows of PQV
  //       'Excess Credit - Review' chains — orphan closures PAYING OUT
  //       with no deduction withheld in this file. Their own family
  //       line (analyst instruction): a positive credit released is a
  //       clawback candidate, not an ordinary open withholding, so it
  //       must not blend into OPEN_SC_SCR. GROSS, mirroring
  //       component 10.
  components.push({
    key: 'OPEN_EXCESS_SC_SCR',
    turkishName: 'Açık Fazla Alacak Kalemleri',
    englishName: 'Open Excess Shortage Claims',
    cashNet: grossNetOf(openExcessScScrRows),
  });

  // 11 — Open PC/PCR: pair rows of PPV open chains only (Requirement
  //      3.6). GROSS, mirroring component 10 (analyst ruling 2026-08).
  components.push({
    key: 'OPEN_PC_PCR',
    turkishName: 'Açık Fiyat Farkı Kalemleri',
    englishName: 'Open Price Claim Items',
    cashNet: grossNetOf(openPcPcrRows),
  });

  // QPD derivation (analyst ruling): the invoiced QPD amount is
  // untrustworthy — such records can be created manually. The KEEP_QPD
  // component is therefore −(Uygulanan indirim grand total over ALL
  // rows of this currency): the currency's total discount is always
  // what gets invoiced back to the vendor in the identity, NOT the
  // actual QPD rows' cash-net. The MISMATCH measure is the DEBIT side
  // of the QPD rows (Σ Borç — the rule of the debit entry: the QPD's
  // debit side IS the invoice; the rows' cash-net is ALWAYS ≈ 0 by
  // design, every invoice debit being immediately offset by a credit,
  // so it can never measure the invoiced amount). A deviation between
  // the QPD debit total and the grand total forces the gate RED with a
  // bilingual red-flag annotation (`|| 0` normalizes −0). The rows'
  // cash-net is still computed — the expectedLedgerOffset algebra needs
  // the amount the ledger rows PHYSICALLY carry.
  const discountGrandTotal = discountSumOf(records);
  const qpdRows = rowsOf('QPD');
  const invoicedQpdCashNet = cashNetOf(qpdRows);
  const invoicedQpdDebitTotal = qpdRows.reduce((acc, row) => round2(acc + row.debit), 0);
  const qpdDerivedNet = round2(-discountGrandTotal) || 0;
  const qpdMismatch =
    Math.abs(invoicedQpdDebitTotal - discountGrandTotal) > CASHIER_TOLERANCE;

  // 12 — KEEP: one row per type at its aggregate Cash_Net
  //      (Requirements 3.7, 6.4) — EXCEPT KEEP_QPD, which carries the
  //      derived discount grand total (analyst ruling above), labeled
  //      bilingually so the derivation is visible on the table.
  for (const { key, invoiceType } of KEEP_COMPONENTS) {
    if (key === 'KEEP_QPD') {
      components.push({
        key,
        turkishName: 'QPD (Uygulanan indirim genel toplamından türetilmiştir)',
        englishName: 'QPD (Quick Pay Discount — derived from Uygulanan indirim grand total)',
        cashNet: qpdDerivedNet,
        ...(qpdMismatch
          ? {
              annotation: buildQpdMismatchAnnotation(
                currency,
                discountGrandTotal,
                invoicedQpdDebitTotal,
                computeQpdStatusBreakdown(
                  currency,
                  invoicedQpdDebitTotal,
                  openChains.qpdChains,
                ),
              ),
            }
          : {}),
      });
      continue;
    }
    components.push({
      key,
      turkishName: invoiceType,
      englishName: englishNameFor(invoiceType),
      cashNet: cashNetOf(rowsOf(invoiceType)),
    });
  }

  // 13 — UNRESOLVED, always LAST: one distinct labeled component per
  //      type PRESENT, carrying the conservative-inclusion audit
  //      annotation (Requirements 6.8, 8.2).
  for (const { key, invoiceType } of UNRESOLVED_COMPONENTS) {
    const rows = rowsOf(invoiceType);
    if (rows.length === 0) continue;
    const cashNet = cashNetOf(rows);
    components.push({
      key,
      turkishName: invoiceType,
      englishName: englishNameFor(invoiceType),
      cashNet,
      annotation: buildUnresolvedAnnotation(invoiceType, cashNet, currency),
    });
  }

  // Computed_Havale = Σ component cash-nets (Requirement 3.1 — no other
  // term participates; TARGET rows feed Actual_Havale only, Req 6.10).
  const computedHavale = components.reduce(
    (acc, component) => round2(acc + component.cashNet),
    0,
  );

  // Actual_Havale = Σ Borç − Σ Alacak over this currency's
  // 'Giden Havale' rows — the transfer magnitude; zero when absent
  // (Requirements 3.9, 3.14, 6.1).
  const actualHavale = rowsOf('Giden Havale').reduce(
    (acc, row) => round2(acc + row.debit - row.credit),
    0,
  );

  // Difference is NOT rounded again — the Gate evaluates the unrounded
  // value (Requirement 3.10), so a display that rounds to zero can
  // still gate RED (Requirement 4.6).
  const difference = computedHavale - actualHavale;

  // A QPD mismatch FORCES the gate RED regardless of the Difference
  // (analyst ruling): the identity may balance via the derived discount
  // grand total (Difference 0) while the invoiced QPD rows carry a
  // different amount — precisely the case demanding manual review.
  const gate: GateOutcome = qpdMismatch ? 'RED' : gateFor(difference);

  // Expected ledger-closure offset: the identity deviates from the pure
  // row cash-nets by exactly the discount adjustments — the sales
  // discount, the IPV discount, the open-claim clawed discounts
  // (analyst ruling 2026-08: open SC/SCR and PC/PCR participate GROSS),
  // and the QPD replacement (derived −discountGrandTotal instead of the
  // invoiced rows' cash-net). The ledger rows carry NO discount, so on
  // a GREEN gate the raw cumulative Σ Borç − Alacak equals this offset,
  // not zero.
  const expectedLedgerOffset = round2(
    salesDiscount +
      ipvDiscount +
      openScScrDiscount +
      openExcessScScrDiscount +
      openPcPcrDiscount +
      qpdDerivedNet -
      invoicedQpdCashNet,
  );

  return {
    currency,
    components,
    computedHavale,
    actualHavale,
    difference,
    gate,
    qpdMismatch,
    expectedLedgerOffset,
  };
}

/* ====================================================================
 * Layer 3 — Vendor Ledger assembly + closure verification
 * (Requirements 5.2, 5.4, 5.6, 5.7).
 *
 * The Balance_Impact_Population, assembled per disposition:
 *   TARGET          — all 'Giden Havale' rows
 *   INCLUDE         — all rows of the nine INCLUDE types
 *   KEEP            — all rows of the five KEEP types
 *   OPEN_ITEMS_ONLY — only the owned pair/family rows of OPEN chains
 *                     (netted chains and netted provision families
 *                     contribute nothing, Requirement 5.6)
 *   UNRESOLVED      — all rows (provisional: they participate in the
 *                     identity, so they must be in the ledger for
 *                     closure)
 *
 * ORDER + UNIQUENESS (Requirements 5.2, 5.3): the assembly iterates
 * the ORIGINAL Payment Data record array and admits each qualifying
 * record where it stands, so the Payment Data relative order is
 * preserved naturally and — being identity-set based — each record
 * object appears at most once.
 *
 * CLOSURE (Requirements 5.4, 5.7 / Property 4): per currency,
 * Σ Borç − Alacak over the ledger records must sit within tolerance of
 * the EXPECTED OFFSET — an algebraic consequence of a GREEN gate (the
 * ledger population equals the identity population plus the TARGET
 * rows). The ledger rows carry NO discount, but the identity includes
 * discount terms (analyst ruling: sales discount + IPV discount, and a
 * QPD component derived from the discount grand total instead of the
 * invoiced QPD rows' cash-net), so a GREEN gate no longer implies the
 * raw cumulative closes to ZERO — it closes to exactly the identity's
 * discount adjustments over the pure row cash-nets:
 *
 *   cumulative = Σ Borç − Alacak over the ledger
 *              = actualHavale − pureCashNet(identity population)
 *   GREEN ⇒ actualHavale ≈ computedHavale
 *              = pureCashNet(identity population) + adjustments
 *   ⇒ cumulative ≈ adjustments
 *              = salesDiscount + ipvDiscount
 *                + (−discountGrandTotal − invoicedQpdRowsCashNet)
 *              = the per-currency `expectedLedgerOffset` stamped on
 *                each BalanceCheck at build time.
 *
 * The assertion is scoped to GREEN-gated currencies: on a RED gate the
 * cumulative genuinely differs by the Difference amount, and the
 * export must still proceed (Requirement 8.1) with the ledger
 * withheld by the renderer. Within a GREEN currency the check applies
 * whether or not 'Giden Havale' rows are present (Requirement 5.7);
 * a violation throws — the model is inconsistent, the exporter halts,
 * no bytes are produced.
 * ==================================================================== */

/**
 * Assembles the Layer 3 ledger population (Balance_Impact_Population)
 * in Payment Data relative order, each record at most once.
 *
 * Membership by disposition: TARGET, INCLUDE, KEEP and UNRESOLVED
 * types admit ALL their rows; OPEN_ITEMS_ONLY types admit only the
 * owned pair/family rows of open chains (by object identity against
 * the once-per-file open-chain collection).
 */
export function assembleLedger(
  records: PaymentRecord[],
  openChains: OpenChainCollection,
): PaymentRecord[] {
  // Identity set of every open-chain owned row (SC/SCR, PC/PCR and
  // open provision rows) — the ONLY rows OPEN_ITEMS_ONLY types may
  // contribute (Requirements 5.2, 5.6).
  const openOwnedRows = new Set<PaymentRecord>();
  for (const group of [
    openChains.scScr,
    openChains.excessScScr,
    openChains.pcPcr,
    openChains.provision,
  ]) {
    for (const { ownedRows } of group) {
      for (const row of ownedRows) {
        openOwnedRows.add(row);
      }
    }
  }

  // Single pass over the ORIGINAL array: order preserved naturally,
  // the admitted-set guarantees at-most-once membership.
  const admitted = new Set<PaymentRecord>();
  const ledger: PaymentRecord[] = [];
  for (const record of records) {
    if (admitted.has(record)) continue;
    const qualifies =
      DISPOSITIONS[record.invoiceType] === 'OPEN_ITEMS_ONLY'
        ? openOwnedRows.has(record) // open-chain owned rows only
        : true; // TARGET / INCLUDE / KEEP / UNRESOLVED — all rows
    if (qualifies) {
      admitted.add(record);
      ledger.push(record);
    }
  }
  return ledger;
}

/**
 * Computes the per-currency ledger closure: the cumulative
 * Σ Borç − Alacak over the ledger records of each currency, rounded at
 * each step per the codebase money convention. Currencies appear in
 * first-seen ledger order.
 */
export function computeLedgerClosures(
  ledgerRecords: readonly PaymentRecord[],
): Array<{ currency: string; cumulative: number }> {
  const cumulativeByCurrency = new Map<string, number>();
  for (const record of ledgerRecords) {
    const currency = currencyBucketOf(record);
    const previous = cumulativeByCurrency.get(currency) ?? 0;
    cumulativeByCurrency.set(currency, round2(previous + record.debit - record.credit));
  }
  return Array.from(cumulativeByCurrency.entries(), ([currency, cumulative]) => ({
    currency,
    cumulative,
  }));
}

/**
 * Verifies the ledger closure invariant (Requirements 5.4, 5.7 /
 * Property 4, re-derived for the discount-adjusted identity): for
 * every GREEN-gated currency, |cumulative − expectedLedgerOffset| must
 * be ≤ tolerance — whether or not 'Giden Havale' rows are present.
 * The offset (see the section comment above) is the exact amount by
 * which the identity's discount adjustments displace the raw
 * Σ Borç − Alacak cumulative; on a no-discount file it is zero and the
 * check degenerates to the original closes-to-zero assertion.
 * RED-gated currencies are exempt: their cumulative genuinely differs
 * by the Difference amount and the export proceeds with the withheld
 * notice (Requirement 8.1), so a spurious throw here would wrongly
 * block the RED-path export.
 *
 * @throws Error (bilingual) identifying the discrepancy amount and
 *         currency when a GREEN currency fails to close.
 */
function verifyLedgerClosures(
  closures: ReadonlyArray<{ currency: string; cumulative: number }>,
  balanceChecks: readonly BalanceCheck[],
): void {
  const checkByCurrency = new Map(balanceChecks.map(check => [check.currency, check]));
  for (const { currency, cumulative } of closures) {
    // Every ledger currency comes from the same partition that produced
    // the balance checks; a missing entry is defensively treated as
    // GREEN with a zero offset so the invariant is verified rather than
    // silently skipped.
    const check = checkByCurrency.get(currency);
    if ((check?.gate ?? 'GREEN') !== 'GREEN') continue;
    const expectedOffset = check?.expectedLedgerOffset ?? 0;
    // round2 kills float residue: cumulative and the offset are both
    // 2-decimal money values accumulated with per-step rounding.
    const discrepancy = round2(cumulative - expectedOffset);
    if (Math.abs(discrepancy) > CASHIER_TOLERANCE) {
      throw new Error(
        `Kasiyer modeli iç tutarlılık hatası — DEFTER KAPANIŞI (${currency}): ` +
          `Tedarikçi cari hareketleri toplamı (Borç − Alacak, ${DataSanitizer.formatNumber(cumulative)}) ` +
          `beklenen indirim dengeleme tutarına (${DataSanitizer.formatNumber(expectedOffset)}) kapanmıyor; ` +
          `sapma ${DataSanitizer.formatNumber(discrepancy)}. Dışa aktarma durduruldu. / ` +
          `Cashier model internal-consistency failure — LEDGER CLOSURE (${currency}): ` +
          `the vendor ledger cumulative (Borç − Alacak, ${DataSanitizer.formatNumber(cumulative)}) ` +
          `does not close to the expected discount offset (${DataSanitizer.formatNumber(expectedOffset)}); ` +
          `the discrepancy is ${DataSanitizer.formatNumber(discrepancy)}. The export was halted.`,
      );
    }
  }
}

/* ====================================================================
 * The model entry point — runCashierModel (Requirement 1.4).
 * ==================================================================== */

/**
 * Runs the full three-layer, gated pipeline over the Payment Data
 * record population and returns the discriminated outcome the
 * renderers consume.
 *
 * Build order (design internal build order):
 *   1. `validate`             — failure short-circuits: `ok: false`,
 *                               NO layer computation (Requirement 1.5)
 *   2. `partitionByCurrency`  — everything downstream currency-scoped
 *   3. `buildAggregationBlock` per currency (Layer 1, conservation
 *                               asserted)
 *   4. `collectOpenChains`    — the four operations modules, once per
 *                               file (QPD annotation-only)
 *   5. `buildBalanceCheck`    per currency (Layer 2 + per-currency
 *                               gate)
 *   6. `assembleLedger` + closures — Layer 3, closure verified inside
 *                               the model so a discrepancy fails BEFORE
 *                               any rendering preparation
 *                               (Requirements 5.7, 7.1)
 *   7. `combineGates`         — the overall Gate (Requirement 8.5)
 *
 * Validation failures return `ok: false` (expected business outcomes
 * the exporter messages precisely); internal invariant violations
 * (Fark conservation, ledger closure) THROW because they indicate the
 * model itself is inconsistent.
 */
export function runCashierModel(records: PaymentRecord[]): CashierModelOutcome {
  // 1 — Validation gate: failure produces NO layer results.
  const failure = validate(records);
  if (failure) {
    return { ok: false, failure };
  }

  // 2 — Currency partition (first-seen order, Payment Data order within).
  const partitions = partitionByCurrency(records);

  // 3 — Layer 1: one aggregation block per currency (throws on a
  //     Fark-conservation violation).
  const aggregationBlocks: AggregationBlock[] = [];
  for (const [currency, currencyRecords] of partitions) {
    aggregationBlocks.push(buildAggregationBlock(currency, currencyRecords));
  }

  // 4 — Open-item resolution: the four operations modules, once per
  //     file (QPD chains feed the mismatch annotation only).
  const openChains = collectOpenChains(records);

  // 5 — Layer 2: one balance check per currency, fixed component order.
  const balanceChecks: BalanceCheck[] = [];
  for (const [currency, currencyRecords] of partitions) {
    balanceChecks.push(buildBalanceCheck(currency, currencyRecords, openChains));
  }

  // 6 — Layer 3: ledger assembly + per-currency closure, verified here
  //     so a discrepancy halts before any rendering preparation.
  const ledgerRecords = assembleLedger(records, openChains);
  const ledgerClosures = computeLedgerClosures(ledgerRecords);
  verifyLedgerClosures(ledgerClosures, balanceChecks);

  // 7 — The overall Gate + the analyst-facing annotations.
  return {
    ok: true,
    result: {
      aggregationBlocks,
      balanceChecks,
      overallGate: combineGates(balanceChecks),
      ledgerRecords,
      ledgerClosures,
      annotations: collectUnresolvedAnnotations(balanceChecks),
      tolerance: CASHIER_TOLERANCE,
    },
  };
}
