import { BaseInvoiceClassifier } from '../base/BaseInvoiceClassifier';
import { classifyByRules, WAREHOUSE_CODES, PO_TOKEN } from '../invoiceClassificationRules';
import type { ClassificationContext } from '../invoiceClassificationRules';
import type { InvoiceCategory } from '../../../types/regional.types';

/**
 * TR invoice classifier — a thin INTERPRETER.
 *
 * All recognition knowledge (which conditions produce which invoice type,
 * and in what precedence) lives as data in
 * `logic/classifiers/invoiceClassificationRules.ts` (`CLASSIFICATION_RULES`).
 * Adding or changing a type does not touch this class.
 *
 * The only logic owned here is TR-specific PO extraction, built from the
 * shared `WAREHOUSE_CODES` list (single source — BC-37 fixed).
 */
export class TrInvoiceClassifier extends BaseInvoiceClassifier {
  /**
   * PO path pattern: the token immediately before a /{warehouse-code}/
   * segment. The PO token is the shared `PO_TOKEN` structural fact
   * (8 alphanumerics, digit-first, letter-last — e.g. `48RWLA6F/XSA8/`),
   * single-sourced with `SALES_PO_PATH_PATTERN` in the classification
   * rules. The tight shape prevents a stray prefix glued to the PO from
   * being extracted verbatim.
   * `WAREHOUSE_CODES` is ordered longest-prefix-first so the alternation
   * resolves IST2/IST1 before IST.
   * ⚠ BC-36 (preserved as-built): case-sensitive by design of the source
   * data — a lowercased description yields no PO.
   */
  private static readonly PO_PATTERN = new RegExp(
    `(?:^|[^A-Z0-9])(${PO_TOKEN})\\/(${WAREHOUSE_CODES.join('|')})\\/`,
  );

  public extractPurchaseOrder(description: string): string {
    if (!description) return '';
    const poMatch = description.match(TrInvoiceClassifier.PO_PATTERN);
    return poMatch ? poMatch[1] : '';
  }

  public classify(
    invoiceNumber: string,
    description: string,
    context?: ClassificationContext,
  ): InvoiceCategory {
    return classifyByRules(invoiceNumber, description, context);
  }
}
