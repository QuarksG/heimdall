import { DataSanitizer } from './dataSanitizer';
import { inferVendorOwnedSeries } from '../classifiers/invoiceClassificationRules';
import type { BaseInvoiceClassifier } from '../classifiers/base/BaseInvoiceClassifier';
import type { PaymentRecord, InvoiceCategory } from '../../types/regional.types';

/**
 * PAYMENT TRANSFORMER — the single owner of the raw-record → PaymentRecord
 * transformation (restores the ownership contract of `logic/cleaners/`).
 *
 * Input: flat raw records extracted by a region processor, keyed by the
 * CANONICAL field keys from the region config (payee, paymentAmount,
 * invoiceNumber, paidAmount, ...). Values are still raw source strings.
 *
 * Owns, in order:
 *  1. Field trimming and the credit/debit split (Oracle notation:
 *     parentheses = debit; discount fallback with leading '-').
 *  2. Classification + PO extraction (delegated to the region classifier).
 *  3. MONEY PARSING — the one place amounts become numbers (DataSanitizer).
 *  4. Sign normalization (negatives fold to the opposite side).
 *  5. Grouping by paymentNumber+paymentDate, per-row running balance.
 *  6. Synthetic "GIDEN HAVALE" transfer row per group, carrying the
 *     balancing amount on the opposite side so each group closes to zero:
 *         Σ credit − Σ debit − havale = 0
 */
export class PaymentTransformer {
  private readonly classifier: BaseInvoiceClassifier;

  constructor(classifier: BaseInvoiceClassifier) {
    this.classifier = classifier;
  }

  public transform(rawRows: Array<Record<string, string>>): PaymentRecord[] {
    const toStr = DataSanitizer.convertToString;

    // PASS 1 (analyst ruling — prefix demotion): learn the vendor's own
    // sales-invoice series from the verified structural sales rule over
    // the WHOLE file, so colliding bare-prefix rules (C1/C0, V1/V0)
    // demote to last resort during classification below.
    const vendorOwnedSeries = inferVendorOwnedSeries(
      rawRows.map(rec => ({
        invoiceNumber: toStr(rec.invoiceNumber),
        description: toStr(rec.description),
      })),
    );

    const mapped = rawRows.map(rec => {
      const payee = toStr(rec.payee);
      const supplierNumber = toStr(rec.supplierNumber);
      const vendorSite = toStr(rec.vendorSite);
      const paymentNumber = toStr(rec.paymentNumber);
      const paymentDate = toStr(rec.paymentDate);
      const currency = toStr(rec.currency);
      const paymentAmount = DataSanitizer.roundAmount(
        DataSanitizer.parseAmount(toStr(rec.paymentAmount)),
      );

      const invoiceNumber = toStr(rec.invoiceNumber);
      const invoiceDate = toStr(rec.invoiceDate);
      const description = toStr(rec.description);
      const discountRaw = toStr(rec.discount) || '0';
      const paid = toStr(rec.paidAmount);

      // Credit/debit split keeps the SOURCE notation, so it happens on the
      // raw strings — then amounts are parsed exactly once below.
      let credit = '';
      let debit = '';

      if (paid) {
        if (paid.startsWith('(') && paid.endsWith(')')) {
          debit = paid.slice(1, -1);
        } else {
          credit = paid;
        }
      }

      if (!credit && !debit && discountRaw && discountRaw !== '0' && discountRaw !== '0.00') {
        if (discountRaw.startsWith('-')) {
          debit = discountRaw.substring(1);
        } else {
          credit = discountRaw;
        }
      }

      let creditNum = DataSanitizer.parseAmount(credit);
      let debitNum = DataSanitizer.parseAmount(debit);

      // Sign normalization: a negative amount belongs on the opposite side.
      if (creditNum < 0) {
        debitNum += Math.abs(creditNum);
        creditNum = 0;
      }
      if (debitNum < 0) {
        creditNum += Math.abs(debitNum);
        debitNum = 0;
      }

      // Classification AFTER the money split: direction-dependent rules
      // (e.g. Itraz Sonucu Geri Odeme's Alacak signal) need credit/debit.
      const invoiceType = this.classifier.classify(invoiceNumber, description, {
        credit: creditNum,
        debit: debitNum,
        vendorOwnedSeries,
      }) as InvoiceCategory;
      const poNumber = this.classifier.extractPurchaseOrder(description) || '';

      return {
        payee,
        supplierNumber,
        vendorSite,
        paymentNumber,
        paymentDate,
        currency,
        paymentAmount,
        invoiceNumber,
        invoiceDate,
        poNumber,
        description,
        discount: DataSanitizer.roundAmount(DataSanitizer.parseAmount(discountRaw)),
        credit: DataSanitizer.roundAmount(creditNum),
        debit: DataSanitizer.roundAmount(debitNum),
        // AGE ("Yaş (Gün)"): payment date − invoice date. Amazon pays
        // sales invoices on their due date, so this column encodes the
        // payment term per row — the basis of the aged report and the
        // aging validations.
        agingDays: DataSanitizer.daysBetween(invoiceDate, paymentDate),
        invoiceType,
      };
    });

    return this.groupAndSynthesize(mapped);
  }

  /**
   * Groups rows by payment (paymentNumber + paymentDate), stamps the
   * running balance per row, then appends one synthetic "GIDEN HAVALE"
   * transfer row per group carrying the balancing amount.
   */
  private groupAndSynthesize(
    mapped: Array<Omit<PaymentRecord, 'balance'>>,
  ): PaymentRecord[] {
    const groups = new Map<string, typeof mapped>();
    const groupOrder: string[] = [];

    mapped.forEach(row => {
      const key = `${row.paymentNumber}__${row.paymentDate}`;
      if (!groups.has(key)) {
        groups.set(key, []);
        groupOrder.push(key);
      }
      groups.get(key)!.push(row);
    });

    const finalOutput: PaymentRecord[] = [];

    groupOrder.forEach(key => {
      const groupRows = groups.get(key)!;
      let runningBalance = 0;

      groupRows.forEach(row => {
        runningBalance += row.credit;
        runningBalance -= row.debit;

        finalOutput.push({
          ...row,
          balance: DataSanitizer.roundAmount(runningBalance),
        });
      });

      if (groupRows.length > 0) {
        const ref = groupRows[0];
        const transferAmount = DataSanitizer.roundAmount(Math.abs(runningBalance));

        finalOutput.push({
          payee: ref.payee,
          supplierNumber: ref.supplierNumber,
          vendorSite: ref.vendorSite,
          paymentNumber: ref.paymentNumber,
          paymentDate: ref.paymentDate,
          currency: ref.currency,
          paymentAmount: ref.paymentAmount,
          invoiceNumber: `GIDEN HAVALE: ${ref.paymentNumber}`,
          invoiceDate: ref.paymentDate,
          poNumber: '',
          description: `Payment transfer for ${ref.paymentNumber}`,
          discount: 0,
          credit: runningBalance > 0 ? 0 : transferAmount,
          debit: runningBalance > 0 ? transferAmount : 0,
          invoiceType: 'Giden Havale',
          balance: 0,
        });
      }
    });

    return finalOutput;
  }
}
