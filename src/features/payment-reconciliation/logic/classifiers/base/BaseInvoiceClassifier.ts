/**
 * Region classifier contract. Implementations are thin interpreters —
 * recognition rules live as data in
 * `logic/classifiers/invoiceClassificationRules.ts`.
 *
 * (The old `ProcessedInvoice` interface and text helpers that lived here
 * were dead code duplicating `PaymentRecord` — removed, BC-21.)
 */
export abstract class BaseInvoiceClassifier {
  /**
   * Classifies a row. `context` (optional) carries the money direction —
   * Alacak/Borç — for the few rules that depend on it; text-only callers
   * may omit it.
   */
  public abstract classify(
    invoiceNumber: string,
    description: string,
    context?: { credit: number; debit: number },
  ): string;

  public abstract extractPurchaseOrder(description: string): string;
}
