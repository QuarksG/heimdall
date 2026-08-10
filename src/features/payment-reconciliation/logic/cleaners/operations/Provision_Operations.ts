import { DataSanitizer } from '../dataSanitizer';
import { AMOUNT_MATCH_TOLERANCE } from '../../matchers/openItemFinder';
import type { PaymentRecord, InvoiceCategory } from '../../../types/regional.types';
import type { OperationResult, OperationChain } from './operations.types';

/**
 * PROVISION OPERATIONS — provision-family cleaning.
 *
 * BUSINESS PROCESS: provisions are balance-sheet timing entries, not
 * payments — the single biggest source of vendor confusion ("what was
 * paid where"). Bookings and their releases always come in pairs, so a
 * family whose sides net to zero carries NO information for the analyst
 * and is ELIMINATED from the trace entirely. Only an unreleased booking
 * (the open provision) matters.
 *
 * PROVISION KEY (proven on source data): provision rows are labelled
 * `{key}_PROVISION_FOR_RECEIVABLE` where `{key}` is the numeric booking
 * date (YYMMDD, e.g. `260703_PROVISION_FOR_RECEIVABLE` → booked
 * 2026-07-03). Provisions are booked in DATE BATCHES: one batch = all
 * rows sharing the key. Releases clear whole batches, so the open
 * residual always sits in the LATEST batch(es) — the most recent
 * bookings whose releases have not arrived yet.
 *
 * ── NOTATION (declared once, used everywhere) ─────────────────────────
 *   P        one provision family = all rows of ONE owned category;
 *            each family is checked SEPARATELY, never pooled
 *   x        Σ Borç − Σ Alacak over P (signed family residual)
 *   key(r)   numeric prefix of the invoice label before `_` (booking
 *            date batch); rows without a numeric prefix form their own
 *            single-row batch, ordered after all dated batches
 *   B_k      batch k = rows sharing one key; batches ordered LATEST
 *            key first (numeric descending)
 *   open(B)  Σ over B of the open side: Borç−Alacak when x>0 (unreleased
 *            deductions), Alacak−Borç when x<0 (unreleased credits)
 *   ε        currency tolerance = 0.01 (one kuruş); floating-point
 *            guard, NOT a business value
 * ───────────────────────────────────────────────────────────────────────
 *
 * FORMULA (approved — batch aggregation over the latest provisions):
 *   |x| ≤ ε                    → the family fully netted: eliminate from
 *                                the list, nothing emitted
 *   |x| > ε                    → walk the batches LATEST-FIRST,
 *                                accumulating open(B_1)+…+open(B_k);
 *                                the first k where the cumulative sum
 *                                equals |x| identifies the open
 *                                provisions → one "Açık" chain PER
 *                                batch, each stating its balance impact
 *   no latest-first match      → scan ALL batches for a single batch
 *                                carrying |x| (an older batch stuck open)
 *   still no match             → the residual is not attributable to
 *                                provision batches — Anomaly - Check
 */
export const PROVISION_TOLERANCE = AMOUNT_MATCH_TOLERANCE;

/** Booking-date key: numeric prefix of the invoice label (YYMMDD). */
export const PROVISION_KEY_PATTERN = /^(\d+)_/;

/** The provision families — each one is its own population P. */
export const PROVISION_FAMILIES: readonly InvoiceCategory[] = [
  'MISSING_ACTUAL_OR_BAN',
  'Vadesi Geçmis Alacak Provizyonu',
  'Alacak Provizyonu',
];

export const PROVISION_OWNED_TYPES: readonly InvoiceCategory[] = PROVISION_FAMILIES;

const round2 = DataSanitizer.roundAmount;
const fmt = DataSanitizer.formatNumber;

/** Extracts the booking-date batch key, or null when the label has none. */
export function provisionKey(invoiceNumber: string): string | null {
  const match = invoiceNumber.trim().match(PROVISION_KEY_PATTERN);
  return match ? match[1] : null;
}

/** One booking-date batch of a provision family. */
interface ProvisionBatch {
  /** Batch key: the numeric booking date, or the row's own label. */
  key: string;
  /** Whether the key is a real dated batch (numeric prefix present). */
  dated: boolean;
  rows: PaymentRecord[];
  /** Σ open-side value over the batch (assigned per family residual sign). */
  open: number;
}

export function runProvisionOperations(records: PaymentRecord[]): OperationResult {
  const chains: OperationChain[] = [];

  PROVISION_FAMILIES.forEach(family => {
    const familyRows = records.filter(r => r.invoiceType === family);
    if (familyRows.length === 0) return;

    // x = Σ Borç − Σ Alacak over P
    const x = round2(familyRows.reduce((sum, r) => sum + r.debit - r.credit, 0));
    if (Math.abs(x) <= PROVISION_TOLERANCE) return; // fully netted — eliminated, no need to look

    // The open side carries the residual: Borç rows when x>0, Alacak when x<0.
    const openSide = (r: PaymentRecord): number => (x > 0 ? r.debit - r.credit : r.credit - r.debit);

    // ---- Batch assembly: group by booking-date key, LATEST first ----
    const byKey = new Map<string, ProvisionBatch>();
    familyRows.forEach(row => {
      const key = provisionKey(row.invoiceNumber);
      const bucket = key ?? row.invoiceNumber.toUpperCase();
      if (!byKey.has(bucket)) {
        byKey.set(bucket, { key: bucket, dated: key !== null, rows: [], open: 0 });
      }
      const batch = byKey.get(bucket)!;
      batch.rows.push(row);
      batch.open = round2(batch.open + openSide(row));
    });

    // Latest batch first: dated batches by key descending (YYMMDD sorts
    // numerically), undated buckets after all dated ones.
    const batches = [...byKey.values()].sort((a, b) => {
      if (a.dated !== b.dated) return a.dated ? -1 : 1;
      if (a.dated && b.dated) return Number(b.key) - Number(a.key);
      return a.key.localeCompare(b.key);
    });

    // ---- Latest-first cumulative walk: the last provisions carry x ----
    let matched: ProvisionBatch[] | null = null;
    let cumulative = 0;
    for (let k = 0; k < batches.length; k++) {
      cumulative = round2(cumulative + batches[k].open);
      if (Math.abs(cumulative - Math.abs(x)) <= PROVISION_TOLERANCE) {
        matched = batches.slice(0, k + 1);
        break;
      }
    }

    // Fallback: a single OLDER batch stuck open (not the latest ones).
    if (matched === null) {
      const single = batches.find(
        b => Math.abs(b.open - Math.abs(x)) <= PROVISION_TOLERANCE,
      );
      if (single) matched = [single];
    }

    if (matched !== null) {
      // One "Açık" chain PER batch — each states its own balance impact;
      // together they carry the family residual x.
      const partOfSet = matched.length > 1;
      matched.forEach(batch => {
        // Chain convention: net = credit − debit contribution.
        const net = round2(x > 0 ? -batch.open : batch.open);
        const discount = round2(batch.rows.reduce((sum, r) => sum + r.discount, 0));
        const label = batch.rows[0].invoiceNumber;
        // Audit trail: batch rows share one label, so each row's locator
        // is the PAYMENT it was booked under — auditable on Payment Data.
        const documentTrail = batch.rows.map(
          r => `${r.invoiceNumber} (Ödeme No: ${r.paymentNumber})`,
        );
        chains.push({
          reference: label,
          rows: batch.rows,
          state: 'Açık',
          net,
          discount,
          residual: round2(net + discount),
          narrative:
            `${family}: family residual Σ(Borç)−Σ(Alacak) = ${fmt(x)} — ` +
            (partOfSet
              ? `carried by the ${matched!.length} latest provision batches together; this batch `
              : 'carried by ') +
            `provision batch ${batch.key} (${batch.rows.length} row(s), Σ open side ${fmt(batch.open)}), ` +
            `booked and not yet released. Balance impact ${fmt(net)}. ` +
            'Timing item, NOT a missing payment; expect the release in a following remittance.',
          actionInvoice: label,
          invoiceDate: batch.rows[0].invoiceDate,
          attention: true,
          documentTrail,
        });
      });
    } else {
      // Residual exists but no batch aggregation carries it — outside the formula.
      const net = round2(-x);
      const discount = round2(familyRows.reduce((sum, r) => sum + r.discount, 0));
      chains.push({
        reference: family,
        rows: [],
        state: 'Anomaly - Check',
        net,
        discount,
        residual: round2(net + discount),
        narrative:
          `${family}: family residual Σ(Borç)−Σ(Alacak) = ${fmt(x)} but NO provision batch ` +
          `(grouped by booking-date key, latest first) carries this value — the open amount is split ` +
          'in a way the batch formula does not explain, or the pairing is broken; review the family on Payment Data.',
        actionInvoice: family,
        attention: true,
      });
    }
  });

  // Deterministic output (all provision chains carry attention by design).
  chains.sort((a, b) => a.reference.localeCompare(b.reference));

  // Conservation: net effect over ALL owned rows, eliminated families included.
  const netEffect = round2(
    records
      .filter(r => PROVISION_OWNED_TYPES.includes(r.invoiceType))
      .reduce((sum, r) => sum + r.credit - r.debit, 0),
  );

  return { domain: 'Provision', ownedTypes: PROVISION_OWNED_TYPES, chains, netEffect };
}
