/**
 * XPath extraction layer for the tax validation engine.
 *
 * Everything that reads the UBL XML lives here; the engine (engine.ts)
 * only consumes the extracted values. All XPaths are namespace-agnostic
 * because vendor invoices use varying prefixes.
 *
 * NOTE: we write `local-name(.)` (explicit context argument) instead of
 * `local-name()`. Both are identical per XPath 1.0 (the argument defaults
 * to the context node) and both work in browsers, but jsdom's XPath engine
 * only supports the explicit form — required for the vitest suite.
 *
 * Moved from taxValidator.ts; behavior preserved.
 */
import type { XMLToExcelConverter } from '../../../../invoice-parsing/utils/xmlParser';
import { parseNumberLoose, round2 } from './numberUtils';
import { normalizeTaxScheme, buildTaxCode } from './schemes';
import type { ItemRef, SplitExemptionIssue } from './types';

/**
 * Evaluate an XPath returning a trimmed string, or null when empty/failed.
 * Tries the converter's evaluateSingle first, then falls back to the
 * document's own evaluate with STRING_TYPE (the path actually taken for
 * string(...) expressions, which evaluateSingle cannot handle).
 */
export const evalSingleText = (converter: XMLToExcelConverter, context: Node, xpath: string): string | null => {
  const convEval = (converter as { evaluateSingle?: (node: Node, xpath: string) => string | null }).evaluateSingle;
  if (typeof convEval === 'function') {
    try {
      const v = convEval.call(converter, context, xpath);
      const s = typeof v === 'string' ? v.trim() : '';
      return s ? s : null;
    } catch {
      /* string(...) expressions throw here; fall through to STRING_TYPE below */
    }
  }

  try {
    const doc = (context.nodeType === Node.DOCUMENT_NODE ? (context as Document) : context.ownerDocument) as Document | null;
    if (!doc) return null;
    const v = doc.evaluate(xpath, context, null, XPathResult.STRING_TYPE, null).stringValue;
    const s = (v ?? '').trim();
    return s ? s : null;
  } catch {
    return null;
  }
};

/** All InvoiceLine nodes in document order. */
export const extractInvoiceLineNodes = (xmlDoc: Document): Node[] => {
  const snapshot = xmlDoc.evaluate(
    '//*[local-name(.)="InvoiceLine"]',
    xmlDoc,
    null,
    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
    null
  );
  const nodes: Node[] = [];
  for (let i = 0; i < snapshot.snapshotLength; i++) {
    const n = snapshot.snapshotItem(i);
    if (n) nodes.push(n);
  }
  return nodes;
};

/** Raw + parsed tax fields of one invoice line. */
export type LineTaxFields = {
  lineId: string;
  lineExtensionAmountRaw: string | null;
  taxableAmountRaw: string | null;
  rateRaw: string | null;
  taxAmountRaw: string | null;
  lineNet: number | null;
  taxableAmount: number | null;
  rate: number | null;
  taxAmount: number | null;
};

/**
 * Read the tax-relevant fields of a single InvoiceLine.
 * Only the FIRST TaxSubtotal of the line is considered (pinned behavior).
 * Fallbacks: rate ← Item/ClassifiedTaxCategory/Percent; taxAmount ← TaxTotal/TaxAmount.
 */
export const extractLineTaxFields = (converter: XMLToExcelConverter, lineNode: Node, index: number): LineTaxFields => {
  const lineId = evalSingleText(converter, lineNode, 'string(.//*[local-name(.)="ID"][1])') ?? String(index + 1);

  const lineExtensionAmountRaw = evalSingleText(converter, lineNode, 'string(.//*[local-name(.)="LineExtensionAmount"][1])');
  const taxableAmountRaw = evalSingleText(
    converter,
    lineNode,
    'string(.//*[local-name(.)="TaxTotal"]/*[local-name(.)="TaxSubtotal"]/*[local-name(.)="TaxableAmount"][1])'
  );
  const rateRaw =
    evalSingleText(
      converter,
      lineNode,
      'string(.//*[local-name(.)="TaxTotal"]/*[local-name(.)="TaxSubtotal"]//*[local-name(.)="Percent"][1])'
    ) ??
    evalSingleText(
      converter,
      lineNode,
      'string(.//*[local-name(.)="Item"]/*[local-name(.)="ClassifiedTaxCategory"]//*[local-name(.)="Percent"][1])'
    );

  const taxAmountRaw =
    evalSingleText(
      converter,
      lineNode,
      'string(.//*[local-name(.)="TaxTotal"]/*[local-name(.)="TaxSubtotal"]/*[local-name(.)="TaxAmount"][1])'
    ) ??
    evalSingleText(converter, lineNode, 'string(.//*[local-name(.)="TaxTotal"]/*[local-name(.)="TaxAmount"][1])');

  return {
    lineId,
    lineExtensionAmountRaw,
    taxableAmountRaw,
    rateRaw,
    taxAmountRaw,
    lineNet: parseNumberLoose(lineExtensionAmountRaw),
    taxableAmount: parseNumberLoose(taxableAmountRaw),
    rate: parseNumberLoose(rateRaw),
    taxAmount: parseNumberLoose(taxAmountRaw),
  };
};

/**
 * Resolve a human-readable item reference for a line.
 *
 * Vendors frequently leave Item/Name empty and put the identifying value
 * elsewhere, so we walk a fallback chain and label the source:
 *   Item/Name → Item/Description → BuyersItemIdentification (ASIN)
 *   → SellersItemIdentification → ManufacturersItemIdentification → "Satır N".
 */
export const resolveItemRef = (converter: XMLToExcelConverter, lineNode: Node, lineId: string): ItemRef => {
  const read = (xpath: string): string | null => evalSingleText(converter, lineNode, xpath);

  const name = read('string(.//*[local-name(.)="Item"]/*[local-name(.)="Name"][1])');
  if (name) return { label: name, source: 'name' };

  const description = read('string(.//*[local-name(.)="Item"]/*[local-name(.)="Description"][1])');
  if (description) return { label: description, source: 'description' };

  const asin = read('string(.//*[local-name(.)="Item"]/*[local-name(.)="BuyersItemIdentification"]/*[local-name(.)="ID"][1])');
  if (asin) return { label: asin, source: 'asin' };

  const sellerId = read('string(.//*[local-name(.)="Item"]/*[local-name(.)="SellersItemIdentification"]/*[local-name(.)="ID"][1])');
  if (sellerId) return { label: sellerId, source: 'sellerId' };

  const manufacturerId = read('string(.//*[local-name(.)="Item"]/*[local-name(.)="ManufacturersItemIdentification"]/*[local-name(.)="ID"][1])');
  if (manufacturerId) return { label: manufacturerId, source: 'manufacturerId' };

  return { label: `Satır ${lineId}`, source: 'lineNo' };
};

/**
 * Resolve a line's tax scheme name via a 4-step fallback chain:
 * line TaxSubtotal → line Item → document TaxTotal → supplier PartyTaxScheme → "KDV".
 */
export const extractLineTaxScheme = (converter: XMLToExcelConverter, lineNode: Node, xmlDoc: Document): string => {
  const s1 = evalSingleText(
    converter,
    lineNode,
    'string(.//*[local-name(.)="TaxTotal"]/*[local-name(.)="TaxSubtotal"]//*[local-name(.)="TaxScheme"]/*[local-name(.)="Name"][1])'
  );
  if (s1) return s1;

  const s2 = evalSingleText(
    converter,
    lineNode,
    'string(.//*[local-name(.)="Item"]//*[local-name(.)="TaxScheme"]/*[local-name(.)="Name"][1])'
  );
  if (s2) return s2;

  const s3 = evalSingleText(
    converter,
    xmlDoc,
    'string(//*[local-name(.)="TaxTotal"][not(ancestor::*[local-name(.)="InvoiceLine"])]//*[local-name(.)="TaxScheme"]/*[local-name(.)="Name"][1])'
  );
  if (s3) return s3;

  const s4 = evalSingleText(
    converter,
    xmlDoc,
    'string(//*[local-name(.)="AccountingSupplierParty"]//*[local-name(.)="PartyTaxScheme"]//*[local-name(.)="TaxScheme"]/*[local-name(.)="Name"][1])'
  );
  if (s4) return s4;

  return 'KDV';
};

export type DocSubtotalEntry = {
  taxCode: string;
  amount: number;
  rate: number;
  taxableAmount: number | null;
  scheme: string;
  rawScheme: string;
  exemptionReasonCode: string | null;
  /** Raw XML strings for the audit trail (null when aggregated from multiple subtotals). */
  amountRaw: string | null;
  rateRaw: string | null;
  taxableAmountRaw: string | null;
};

/** A document TaxSubtotal that could not be validated (missing amount or rate). */
export type MalformedDocSubtotal = {
  /** 1-based position among document TaxSubtotal nodes. */
  position: number;
  rawScheme: string;
  amountRaw: string | null;
  rateRaw: string | null;
  taxableAmountRaw: string | null;
};

export type DocumentTaxResult = {
  totalTax: number | null;
  totalTaxRaw: string | null;
  subtotals: Record<string, DocSubtotalEntry>;
  splitExemptionIssues: SplitExemptionIssue[];
  malformedSubtotals: MalformedDocSubtotal[];
};

/**
 * Read the document-level TaxTotal/TaxAmount and every document TaxSubtotal
 * (excluding those inside InvoiceLine). Subtotals are grouped by taxCode;
 * groups with multiple distinct exemption reason codes become
 * SplitExemptionIssues, and grouped entries are aggregated (summed).
 *
 * Subtotals missing amount or rate cannot be validated; they are returned
 * in malformedSubtotals and surfaced by the engine as DOC_SUBTOTAL_MALFORMED
 * (previously they were skipped silently).
 */
export const extractDocumentTaxTotals = (
  xmlDoc: Document,
  converter: XMLToExcelConverter
): DocumentTaxResult => {
  const totalTaxRaw = evalSingleText(
    converter,
    xmlDoc,
    'string(/*/*[local-name(.)="TaxTotal"][not(ancestor::*[local-name(.)="InvoiceLine"])]/*[local-name(.)="TaxAmount"][1])'
  );
  const totalTax = parseNumberLoose(totalTaxRaw);

  const rawEntries: DocSubtotalEntry[] = [];
  const malformedSubtotals: MalformedDocSubtotal[] = [];

  const nodes = xmlDoc.evaluate(
    '/*/*[local-name(.)="TaxTotal"][not(ancestor::*[local-name(.)="InvoiceLine"])]/*[local-name(.)="TaxSubtotal"]',
    xmlDoc,
    null,
    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
    null
  );

  for (let i = 0; i < nodes.snapshotLength; i++) {
    const n = nodes.snapshotItem(i) as Node;

    const amountRaw = evalSingleText(converter, n, 'string(.//*[local-name(.)="TaxAmount"][1])');
    const rateRaw = evalSingleText(converter, n, 'string(.//*[local-name(.)="Percent"][1])');
    const taxableAmountRaw = evalSingleText(converter, n, 'string(.//*[local-name(.)="TaxableAmount"][1])');
    const amount = parseNumberLoose(amountRaw);
    const rate = parseNumberLoose(rateRaw);
    const taxableAmount = parseNumberLoose(taxableAmountRaw);
    const rawScheme = evalSingleText(converter, n, 'string(.//*[local-name(.)="TaxScheme"]/*[local-name(.)="Name"][1])') || 'KDV';
    const exemptionReasonCode = evalSingleText(converter, n, 'string(.//*[local-name(.)="TaxExemptionReasonCode"][1])') || null;

    if (amount == null || rate == null) {
      malformedSubtotals.push({ position: i + 1, rawScheme, amountRaw, rateRaw, taxableAmountRaw });
      continue;
    }

    const taxCode = buildTaxCode(rawScheme, rate);
    rawEntries.push({
      taxCode,
      amount,
      rate,
      taxableAmount: taxableAmount ?? null,
      scheme: normalizeTaxScheme(rawScheme),
      rawScheme,
      exemptionReasonCode,
      amountRaw,
      rateRaw,
      taxableAmountRaw,
    });
  }

  const grouped: Record<string, DocSubtotalEntry[]> = {};
  for (const entry of rawEntries) {
    if (!grouped[entry.taxCode]) grouped[entry.taxCode] = [];
    grouped[entry.taxCode].push(entry);
  }

  const subtotals: Record<string, DocSubtotalEntry> = {};
  const splitExemptionIssues: SplitExemptionIssue[] = [];

  for (const [taxCode, entries] of Object.entries(grouped)) {
    if (entries.length > 1) {
      const uniqueCodes = new Set(entries.map((e) => e.exemptionReasonCode).filter(Boolean));
      if (uniqueCodes.size > 1) {
        splitExemptionIssues.push({
          taxCode,
          entries: entries.map((e) => ({ exemptionCode: e.exemptionReasonCode, taxableAmount: e.taxableAmount })),
        });
      }

      const aggregated: DocSubtotalEntry = {
        taxCode,
        amount: round2(entries.reduce((s, e) => s + e.amount, 0)),
        rate: entries[0].rate,
        taxableAmount: entries.every((e) => e.taxableAmount != null)
          ? round2(entries.reduce((s, e) => s + (e.taxableAmount ?? 0), 0))
          : null,
        scheme: entries[0].scheme,
        rawScheme: entries[0].rawScheme,
        exemptionReasonCode: null,
        amountRaw: null,
        rateRaw: entries[0].rateRaw,
        taxableAmountRaw: null,
      };
      subtotals[taxCode] = aggregated;
    } else {
      subtotals[taxCode] = entries[0];
    }
  }

  return { totalTax, totalTaxRaw, subtotals, splitExemptionIssues, malformedSubtotals };
};

export type MonetaryTotals = {
  invoicePayableAmount: number | null;
  invoicePayableAmountRaw: string | null;
  taxExclusiveAmount: number | null;
  taxExclusiveAmountRaw: string | null;
};

/** Document-level monetary totals used by the engine and the reconciliation gate. */
export const extractMonetaryTotals = (xmlDoc: Document, converter: XMLToExcelConverter): MonetaryTotals => {
  const invoicePayableAmountRaw = evalSingleText(
    converter,
    xmlDoc,
    'string(//*[local-name(.)="LegalMonetaryTotal"]/*[local-name(.)="PayableAmount"][1])'
  );
  const taxExclusiveAmountRaw = evalSingleText(
    converter,
    xmlDoc,
    'string(//*[local-name(.)="LegalMonetaryTotal"]/*[local-name(.)="TaxExclusiveAmount"][1])'
  );
  return {
    invoicePayableAmount: parseNumberLoose(invoicePayableAmountRaw),
    invoicePayableAmountRaw,
    taxExclusiveAmount: parseNumberLoose(taxExclusiveAmountRaw),
    taxExclusiveAmountRaw,
  };
};
