/**
 * Data model and configuration for the tax validation engine.
 * Moved from taxValidator.ts; shapes preserved.
 */

export type Severity = 'error' | 'warning';
export type Scope = 'line' | 'document';

/** Every issue code the engine can emit. The catalog (errorCatalog.ts) has one entry per code. */
export type TaxErrorCode =
  | 'MISSING_LINE_EXTENSION_AMOUNT'
  | 'MISSING_TAXABLE_AMOUNT'
  | 'MISSING_TAX_RATE'
  | 'MISSING_TAX_AMOUNT'
  | 'TAXABLE_NOT_EQUAL_LINE_NET'
  | 'TAX_CALC_DEVIATION'
  | 'TAX_EXCLUSIVE_NOT_EQUAL_LINES'
  | 'DOC_TAX_TOTAL_MISMATCH'
  | 'DOC_SUBTOTAL_MISSING_TAXABLE'
  | 'DOC_SUBTOTAL_TAX_CALC_DEVIATION'
  | 'DOC_TAXABLE_NOT_EQUAL_LINES'
  | 'DOC_SUBTOTAL_WITHOUT_LINES'
  | 'DOC_SUBTOTAL_MALFORMED'
  | 'PAYABLE_TOTAL_MISMATCH'
  | 'SPLIT_EXEMPTION_CODES';

/** How the item reference of a line was resolved (vendors often leave Item/Name empty). */
export type ItemRefSource = 'name' | 'description' | 'asin' | 'sellerId' | 'manufacturerId' | 'lineNo';

export type ItemRef = {
  label: string;
  source: ItemRefSource;
};

/** One value read from the XML: the raw string as written, and its parsed number (null if absent/unparseable). */
export type EvidenceField = {
  raw: string | null;
  parsed: number | null;
};

/**
 * Audit trail of a single finding: which values were read and, for
 * calculation checks, the recomputation (formula, expected, actual, diff).
 */
export type Evidence = {
  fields: Record<string, EvidenceField>;
  formula?: string;
  expected?: number;
  actual?: number;
  diff?: number;
};

export type TaxIssue = {
  severity: Severity;
  scope: Scope;
  code: TaxErrorCode;
  lineId?: string;
  taxCode?: string;
  /** Resolved item identification — line-scope issues only. */
  itemRef?: ItemRef;
  evidence: Evidence;
};

export type SplitExemptionIssue = {
  taxCode: string;
  entries: Array<{ exemptionCode: string | null; taxableAmount: number | null }>;
};

export type TaxValidationResult = {
  issues: TaxIssue[];
  corrections: Record<string, { original: number; corrected: number; reason: string }>;
  reconciledTaxAmounts: Record<string, number>;
  splitExemptionIssues: SplitExemptionIssue[];
  aggregates: {
    invoicePayableAmount?: number | null;
    taxExclusiveAmount?: number | null;
    lineNetTotal: number;
    lineTaxTotal: number;
    calculatedInvoiceTotal: number;
    documentTaxTotal?: number | null;
    /** Sum of document TaxSubtotal/TaxableAmount values (null when absent). */
    documentTaxableTotal?: number | null;
    diffs: {
      payableVsCalculated?: number | null;
      taxExclusiveVsLineNet?: number | null;
      docTaxTotalVsLineTax?: number | null;
      /**
       * Doc subtotal taxable vs line net total. Informational only — NOT
       * part of the reconciliation gate. This is the diff that exposes
       * "TaxableAmount contains the tax-inclusive total" mistakes, which
       * the three gate diffs are structurally blind to.
       */
      docTaxableVsLineNet?: number | null;
    };
  };
};

export type TaxValidationConfig = {
  /** Per-check tolerance in Turkish Lira (default 0.02). */
  toleranceTL?: number;
  /** Whole-invoice reconciliation tolerance in TL (default 2.00). */
  reconciliationToleranceTL?: number;
  /** Document TaxSubtotal wins over summed line taxes when they diverge (default true). */
  preferDocumentTotals?: boolean;
};

export const DEFAULT_CFG: Required<TaxValidationConfig> = {
  toleranceTL: 0.02,
  reconciliationToleranceTL: 2.0,
  preferDocumentTotals: true,
};

export const mergeCfg = (config: TaxValidationConfig): Required<TaxValidationConfig> => ({
  ...DEFAULT_CFG,
  ...config,
});
