import { DataSanitizer } from '../cleaners/dataSanitizer';
import type { PaymentRecord } from '../../types/regional.types';

/**
 * FILE INTEGRITY VALIDATOR — the single owner of remittance-file
 * validation (restores the ownership contract of `logic/validators/`).
 *
 * THE VALIDATION TOOLBOX. Each check is independent and analyst-facing;
 * only the worksheet gate blocks — everything else is a WARNING, because
 * the analyst decides, never the tool.
 *
 *  1. Worksheet integrity (pre-parse, BLOCKING): is this file a remittance
 *     advice at all? Detected by the Oracle EFT disclaimer marker, in ANY
 *     column of the first `DISCLAIMER_SCAN_ROWS` rows (BC-16 policy).
 *
 *  2. Payment header fields: vendor site name must be 8 characters with a
 *     `_XX` country suffix (org + country resolution); the payment number
 *     must be an 8–9 digit number (9 in the current era, 8 in legacy
 *     2018–2019 files); the payment date must be a parseable date.
 *
 *  3. Row completeness: an invoice row that carries NO amount at all
 *     (no paid amount, no discount) is a truncated source row.
 *
 *  4. Payment-group totals: the declared header total ("Ödeme tutarı:")
 *     must equal the invoice net derived from the group's rows — with the
 *     difference ATTRIBUTED to the group's no-amount rows when they exist.
 *
 *  5. Shortage-claim pattern: the `…SC` invoice suffix and the
 *     "Shortage Claim for Invoice" description are two independent signals
 *     for the same fact; a row carrying one WITHOUT the other is a
 *     data-quality anomaly.
 *
 *  5b. Reversal references (Ters kayit): every SCR/SCRI/PCR/PCRI reversal
 *     must strip back to a notification present in the file — the linkage
 *     is the invoice-number chain, not the description.
 *
 *  5c. Discount symmetry: notifications post NET of the quick-pay
 *     discount, reversals return GROSS — closed claim chains must net to
 *     exactly their discount adjustment; any residual is a real mismatch.
 *
 *  6. Aging profile: payment date − invoice date. Amazon pays sales
 *     invoices on their due date, so the sales population clusters at the
 *     vendor's payment term; negative ages are data errors, and sales
 *     invoices paid far beyond the dominant term are flagged for review.
 */

export interface IntegrityCheckResult {
  ok: boolean;
  message: string;
}

export class FileIntegrityValidator {
  /** How many leading rows are scanned for the disclaimer marker. */
  public static readonly DISCLAIMER_SCAN_ROWS = 40;

  /** Currency tolerance for the declared-vs-derived group total check. */
  public static readonly GROUP_TOTAL_TOLERANCE = 0.01;

  /** Vendor site format: 5-char org code + `_` + 2-letter country. */
  public static readonly VENDOR_SITE_PATTERN = /^[A-Z0-9]{5}_[A-Z]{2}$/i;

  /**
   * Payment number format: 8–9 digits. The Oracle payment sequence crossed
   * 100,000,000 around 2019 — recent payments are 9 digits, but legacy-era
   * payments (2018–2019) legitimately carry 8-digit numbers.
   */
  public static readonly PAYMENT_NUMBER_PATTERN = /^\d{8,9}$/;

  /** Description marker that independently identifies a shortage claim. */
  public static readonly SHORTAGE_CLAIM_DESCRIPTION = 'SHORTAGE CLAIM FOR INVOICE';

  /**
   * A sales invoice aged this many days beyond the dominant payment term
   * is flagged. Wide margin so a legitimate secondary term (e.g. 60d next
   * to 15d) does not spam the analyst — only genuinely held/late invoices.
   */
  public static readonly AGING_OUTLIER_MARGIN_DAYS = 90;

  /** Minimum sales-invoice sample before the aging profile is trusted. */
  public static readonly AGING_MIN_SAMPLE = 5;

  /**
   * Pre-parse gate: the normalized disclaimer marker must appear somewhere
   * in the first `DISCLAIMER_SCAN_ROWS` rows (any column).
   *
   * @param normalize The region processor's text normalization (Turkish-
   *                  aware accent stripping) — injected so the validator
   *                  stays region-agnostic.
   */
  public static validateRemittanceWorksheet(
    worksheet: unknown[][],
    disclaimerMarker: string,
    normalize: (text: string) => string,
  ): IntegrityCheckResult {
    const rowLimit = Math.min(FileIntegrityValidator.DISCLAIMER_SCAN_ROWS, worksheet.length);

    for (let r = 0; r < rowLimit; r++) {
      const row = (worksheet[r] as unknown[]) ?? [];
      for (let c = 0; c < row.length; c++) {
        const value = row[c];
        if (value == null) continue;
        const text = String(value).trim();
        if (text !== '' && normalize(text).includes(disclaimerMarker)) {
          return { ok: true, message: '' };
        }
      }
    }

    return {
      ok: false,
      message:
        'The uploaded worksheet does not appear to be a remittance advice. ' +
        `The expected disclaimer text was not found in the first ${FileIntegrityValidator.DISCLAIMER_SCAN_ROWS} rows: ` +
        `"${disclaimerMarker}". ` +
        'Please ensure you have pasted the remittance email directly into Excel and try again.',
    };
  }

  /**
   * Post-parse checksum: for every payment group, compare the DECLARED
   * total from the header block against the DERIVED net of the group's
   * real invoice rows. The two are independent sources for the same fact;
   * a difference beyond tolerance means data was lost or misparsed
   * upstream and must not pass silently.
   *
   * Synthetic "GIDEN HAVALE" rows are excluded — they are derived FROM the
   * invoice net, so including them would make every group trivially zero
   * and the check vacuous.
   */
  public static validatePaymentGroupTotals(records: PaymentRecord[]): string[] {
    interface GroupTotals {
      paymentNumber: string;
      paymentDate: string;
      declared: number;
      derivedNet: number;
      /** Invoice numbers of rows that carry no amount at all (check 3). */
      noAmountRows: string[];
    }

    const groups = new Map<string, GroupTotals>();

    records.forEach(record => {
      if (record.invoiceNumber.startsWith('GIDEN HAVALE:')) return; // synthetic

      const key = `${record.paymentNumber}__${record.paymentDate}`;
      if (!groups.has(key)) {
        groups.set(key, {
          paymentNumber: record.paymentNumber,
          paymentDate: record.paymentDate,
          declared: record.paymentAmount,
          derivedNet: 0,
          noAmountRows: [],
        });
      }
      const group = groups.get(key)!;
      group.derivedNet = DataSanitizer.roundAmount(
        group.derivedNet + record.credit - record.debit,
      );
      if (record.credit === 0 && record.debit === 0 && record.discount === 0) {
        group.noAmountRows.push(record.invoiceNumber);
      }
    });

    const warnings: string[] = [];

    groups.forEach(({ paymentNumber, paymentDate, declared, derivedNet, noAmountRows }) => {
      const derivedTransfer = DataSanitizer.roundAmount(Math.abs(derivedNet));
      const difference = DataSanitizer.roundAmount(Math.abs(declared - derivedTransfer));

      if (difference > FileIntegrityValidator.GROUP_TOTAL_TOLERANCE) {
        // Attribution (check 3 × check 4): when the same group also has
        // rows without any amount, the gap is almost certainly theirs —
        // say so explicitly instead of leaving the analyst to hunt.
        const attribution =
          noAmountRows.length > 0
            ? ` The group contains ${noAmountRows.length} row(s) without any amount ` +
              `(${FileIntegrityValidator.listSample(noAmountRows)}) — the difference is likely their missing value.`
            : ' Possible causes: missing invoice rows, a skipped section, or an unparseable amount.';

        warnings.push(
          `Payment ${paymentNumber} (${paymentDate}): declared total ` +
            `${DataSanitizer.formatNumber(declared)} does not match the net of its invoice rows ` +
            `${DataSanitizer.formatNumber(derivedTransfer)} (difference ${DataSanitizer.formatNumber(difference)}).` +
            attribution,
        );
      }
    });

    return warnings;
  }

  /**
   * CHECK 2 — payment header field formats, once per payment group:
   * vendor site `XXXXX_CC` (org + country), 8–9 digit payment number,
   * parseable payment date.
   */
  public static validatePaymentHeaderFields(records: PaymentRecord[]): string[] {
    const warnings: string[] = [];
    const seen = new Set<string>();

    records.forEach(record => {
      if (record.invoiceNumber.startsWith('GIDEN HAVALE:')) return; // synthetic

      const key = `${record.paymentNumber}__${record.paymentDate}`;
      if (seen.has(key)) return;
      seen.add(key);

      const site = record.vendorSite;
      if (!FileIntegrityValidator.VENDOR_SITE_PATTERN.test(site)) {
        warnings.push(
          `Payment ${record.paymentNumber} (${record.paymentDate}): vendor site "${site}" does not match the ` +
            'expected format (8 characters: 5-character org code + "_" + 2-letter country, e.g. "ZL7LD_TR") — ' +
            'the org/country cannot be resolved reliably.',
        );
      }

      if (!FileIntegrityValidator.PAYMENT_NUMBER_PATTERN.test(record.paymentNumber)) {
        warnings.push(
          `Payment "${record.paymentNumber}" (${record.paymentDate}): payment number is not an 8–9 digit number — ` +
            'the header block may have been misread.',
        );
      }

      if (DataSanitizer.parseDateOrNull(record.paymentDate) === null) {
        warnings.push(
          `Payment ${record.paymentNumber}: payment date "${record.paymentDate}" is not a recognizable date — ` +
            'aging and grouping for this payment are unreliable.',
        );
      }
    });

    return warnings;
  }

  /**
   * CHECK 3 — row completeness: an invoice row carrying no amount at all
   * (no paid amount, no discount) is a truncated source row. It parsed as
   * zero, which silently understates the group — never let that pass.
   */
  public static validateRowCompleteness(records: PaymentRecord[]): string[] {
    const incomplete = records.filter(
      r =>
        !r.invoiceNumber.startsWith('GIDEN HAVALE:') &&
        r.credit === 0 &&
        r.debit === 0 &&
        r.discount === 0,
    );
    if (incomplete.length === 0) return [];

    return [
      `${incomplete.length} invoice row(s) carry no amount at all ` +
        `(${FileIntegrityValidator.listSample(incomplete.map(r => r.invoiceNumber))}). ` +
        'These are likely truncated source rows; their value is missing from every total.',
    ];
  }

  /**
   * CHECK 5 — shortage-claim pattern cross-check: the `…SC` suffix and the
   * "Shortage Claim for Invoice" description are independent signals for
   * the same fact. One without the other is a data-quality anomaly the
   * analyst must see (classification accepts either signal; this check is
   * what surfaces the disagreement).
   */
  public static validateShortagePattern(records: PaymentRecord[]): string[] {
    const suffixOnly: string[] = [];
    const descriptionOnly: string[] = [];

    records.forEach(record => {
      if (record.invoiceNumber.startsWith('GIDEN HAVALE:')) return; // synthetic
      const inv = record.invoiceNumber.toUpperCase();
      const hasSuffix = inv.endsWith('SC');
      const hasDescription = record.description
        .toUpperCase()
        .includes(FileIntegrityValidator.SHORTAGE_CLAIM_DESCRIPTION);

      if (hasSuffix && !hasDescription) suffixOnly.push(record.invoiceNumber);
      if (!hasSuffix && hasDescription) descriptionOnly.push(record.invoiceNumber);
    });

    const warnings: string[] = [];
    if (suffixOnly.length > 0) {
      warnings.push(
        `${suffixOnly.length} row(s) have the "…SC" shortage-claim suffix but NOT the ` +
          `"Shortage Claim for Invoice" description (${FileIntegrityValidator.listSample(suffixOnly)}) — verify these rows.`,
      );
    }
    if (descriptionOnly.length > 0) {
      warnings.push(
        `${descriptionOnly.length} row(s) have the "Shortage Claim for Invoice" description but NOT the ` +
          `"…SC" invoice suffix (${FileIntegrityValidator.listSample(descriptionOnly)}) — verify these rows.`,
      );
    }
    return warnings;
  }

  /**
   * CHECK 7 — QPD presence (informational): quick-pay-discount activity
   * overlays the claim chains' amounts (deductions post net of discount,
   * reversals return gross). The cashier model handles this via
   * `QPD_Operations` on the ONE merged 'QPD' type (settlements are debit
   * entries; clearing rows are credit noise): documents verify against
   * their parent family's Σ indirim, and open items surface as 'Açık' in
   * the Tedarikçi Cari Hareketleri ledger. Warn at parse time so the
   * analyst reviews the QPD section of the export.
   */
  public static validateQpdPresence(records: PaymentRecord[]): string[] {
    const qpdCount = records.filter(r => r.invoiceType === 'QPD').length;
    if (qpdCount === 0) return [];

    return [
      `QPD: ${qpdCount} row(s) present — quick-pay-discount activity in this file. ` +
        "Settlements are netted at type level; any open QPD settlement appears as an 'Açık' open item " +
        'in the cashier model (Tedarikçi Cari Hareketleri). Claim-chain discount arithmetic is certified ' +
        'by the discount-symmetry check (CHECK 5c).',
    ];
  }

  /**
   * CHECK 5b — reversal references (Ters kayit validation). A reversal's
   * number is its notification's number plus `R`/`RI` (shortage: SCR/SCRI
   * over SC; price: PCR/PCRI over PC), so the linkage is referential.
   * Every reversal must strip back to a notification present in the file;
   * one that doesn't is either a chain from an earlier remittance period
   * or a malformed number — the analyst must see it either way.
   *
   * (Description text is deliberately NOT used here: source data shows
   * only a minority of shortage reversals carry a 'REVERSAL' description,
   * so the invoice-number chain is the only reliable signal.)
   */
  public static validateReversalReferences(records: PaymentRecord[]): string[] {
    const notifications = new Set<string>();
    const reversals: Array<{ invoiceNumber: string; base: string }> = [];

    records.forEach(record => {
      if (record.invoiceNumber.startsWith('GIDEN HAVALE:')) return; // synthetic
      const inv = record.invoiceNumber.toUpperCase();

      if (inv.endsWith('SCR') || inv.endsWith('PCR')) {
        reversals.push({ invoiceNumber: record.invoiceNumber, base: inv.slice(0, -1) });
      } else if (inv.endsWith('SCRI') || inv.endsWith('PCRI')) {
        reversals.push({ invoiceNumber: record.invoiceNumber, base: inv.slice(0, -2) });
      } else if (inv.endsWith('SC') || inv.endsWith('PC')) {
        notifications.add(inv);
      }
    });

    const orphans = reversals.filter(r => !notifications.has(r.base));
    if (orphans.length === 0) return [];

    return [
      `${orphans.length} reversal row(s) (Ters kayit) have no matching notification in this file ` +
        `(${FileIntegrityValidator.listSample(orphans.map(o => o.invoiceNumber))}). ` +
        'The notification may belong to an earlier remittance period, or the number is malformed — review these.',
    ];
  }

  /**
   * CHECK 5c — discount symmetry (the QPD interplay on claim chains).
   * Amazon posts a shortage/price notification NET of the quick-pay
   * discount (the clawed-back discount is recorded in "Uygulanan
   * indirim"), but reverses it GROSS — the discount comes back with the
   * reversal. So for every reference that has BOTH its notification and
   * its reversal in this file, the pair must net to exactly the discount
   * adjustment:
   *
   *     Σ(credit − debit) + Σ(Uygulanan indirim)  ≈  0   (per reference)
   *
   * A residual beyond tolerance is a genuine amount mismatch on that
   * chain — not discount economics — and the analyst must see it.
   * References that are still OPEN (notification without reversal, or a
   * reversal chaining from an earlier period) are legitimately open and
   * are NOT flagged here (check 5b owns orphan reversals).
   */
  public static validateDiscountSymmetry(records: PaymentRecord[]): string[] {
    interface RefTotals {
      net: number;
      discount: number;
      hasNotification: boolean;
      hasReversal: boolean;
    }
    const refs = new Map<string, RefTotals>();

    records.forEach(record => {
      if (record.invoiceNumber.startsWith('GIDEN HAVALE:')) return; // synthetic
      const inv = record.invoiceNumber.toUpperCase();

      let base: string | null = null;
      let isReversal = false;
      if (inv.endsWith('SCR') || inv.endsWith('PCR')) {
        base = inv.slice(0, -1);
        isReversal = true;
      } else if (inv.endsWith('SCRI') || inv.endsWith('PCRI')) {
        base = inv.slice(0, -2);
        isReversal = true;
      } else if (inv.endsWith('SC') || inv.endsWith('PC')) {
        base = inv;
      }
      if (base === null) return;

      if (!refs.has(base)) {
        refs.set(base, { net: 0, discount: 0, hasNotification: false, hasReversal: false });
      }
      const totals = refs.get(base)!;
      totals.net = DataSanitizer.roundAmount(totals.net + record.credit - record.debit);
      totals.discount = DataSanitizer.roundAmount(totals.discount + record.discount);
      if (isReversal) totals.hasReversal = true;
      else totals.hasNotification = true;
    });

    const mismatches: string[] = [];
    refs.forEach((totals, base) => {
      // Only CLOSED pairs are testable — open items are not anomalies.
      if (!totals.hasNotification || !totals.hasReversal) return;
      const residual = DataSanitizer.roundAmount(totals.net + totals.discount);
      if (Math.abs(residual) > FileIntegrityValidator.GROUP_TOTAL_TOLERANCE) {
        mismatches.push(`${base}: ${DataSanitizer.formatNumber(residual)}`);
      }
    });

    if (mismatches.length === 0) return [];

    return [
      `${mismatches.length} reversed claim reference(s) do not net to their discount adjustment ` +
        `(reversal should equal notification + returned discount): ` +
        `${FileIntegrityValidator.listSample(mismatches)}. ` +
        'These chains carry a genuine amount mismatch — review them before relying on any netting.',
    ];
  }

  /**
   * CHECK 6 — aging profile. Uses the per-row age (payment date − invoice
   * date). Two findings:
   *  - NEGATIVE age on any row: the invoice is dated after its payment —
   *    a data error.
   *  - Sales invoices paid far beyond the dominant payment term: Amazon
   *    pays sales invoices on their due date, so the sales population
   *    clusters at the vendor's term; a row exceeding
   *    dominant + AGING_OUTLIER_MARGIN_DAYS was held or paid late.
   */
  public static validateAgingProfile(records: PaymentRecord[]): string[] {
    const warnings: string[] = [];

    const negative = records.filter(
      r => !r.invoiceNumber.startsWith('GIDEN HAVALE:') && r.agingDays !== undefined && r.agingDays < 0,
    );
    if (negative.length > 0) {
      warnings.push(
        `Aging: ${negative.length} row(s) need your attention (invoice date after payment date). ` +
          'Download the workbook and inspect the "Yaş (Gün)" column against Amazon invoice rules and policies.',
      );
    }

    const salesAges = records
      .filter(r => r.invoiceType === 'Toptan Satis Faturasi' && r.agingDays !== undefined && r.agingDays >= 0)
      .map(r => ({ invoiceNumber: r.invoiceNumber, age: r.agingDays as number }));

    if (salesAges.length < FileIntegrityValidator.AGING_MIN_SAMPLE) return warnings;

    // Dominant payment term = mode of the sales ages.
    const counts = new Map<number, number>();
    salesAges.forEach(({ age }) => counts.set(age, (counts.get(age) ?? 0) + 1));
    let dominantTerm = 0;
    let dominantCount = 0;
    counts.forEach((count, age) => {
      if (count > dominantCount) {
        dominantCount = count;
        dominantTerm = age;
      }
    });

    const threshold = dominantTerm + FileIntegrityValidator.AGING_OUTLIER_MARGIN_DAYS;
    const outliers = salesAges.filter(({ age }) => age > threshold);
    if (outliers.length > 0) {
      warnings.push(
        `Aging: ${outliers.length} sales invoice(s) need your attention (paid well beyond the dominant ` +
          `${dominantTerm}-day payment term). Download the workbook and review the aged report ` +
          '("Yaş (Gün)" column) against Amazon invoice rules and policies.',
      );
    }

    return warnings;
  }

  /** Renders up to 10 sample items for a warning message. */
  private static listSample(items: string[], limit = 10): string {
    const sample = items.slice(0, limit).join(', ');
    return items.length > limit ? `${sample}, … +${items.length - limit} more` : sample;
  }
}
