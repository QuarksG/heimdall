/**
 * Tax validation engine — pure logic, zero HTML.
 *
 * Consumes values extracted in extraction.ts and produces a structured
 * TaxValidationResult. Every issue carries an Evidence block (raw XML
 * values read, and for calculation checks the recomputation: formula,
 * expected, actual, diff) plus an ItemRef for line-scope issues, so
 * findings are auditable and traceable end to end.
 *
 * Rendering lives elsewhere (rendering/findingsTable.ts and the
 * taxValidator.ts façade). Behavior is pinned by engine.test.ts.
 */
import type { XMLToExcelConverter } from '../../../../invoice-parsing/utils/xmlParser';
import { round2 } from './numberUtils';
import { normalizeTaxScheme, buildTaxCode } from './schemes';
import {
  extractInvoiceLineNodes,
  extractLineTaxFields,
  extractLineTaxScheme,
  extractDocumentTaxTotals,
  extractMonetaryTotals,
  resolveItemRef,
} from './extraction';
import { downgradePolicyOf } from './errorCatalog';
import { mergeCfg } from './types';
import type { EvidenceField, ItemRef, TaxIssue, TaxValidationConfig, TaxValidationResult } from './types';

/** Per-taxCode accumulation of line amounts. */
type LineGroup = {
  taxCode: string;
  scheme: string;
  rate: number;
  totalLineAmount: number;
  totalTaxableAmount: number;
  totalTaxAmount: number;
};

/** Evidence field shorthand: raw XML string + parsed number. */
const ef = (raw: string | null, parsed: number | null): EvidenceField => ({ raw, parsed });

/** Evidence field for values we computed ourselves (no raw XML source). */
const efc = (parsed: number | null): EvidenceField => ({ raw: null, parsed });

export const validateAmazonTaxDetailsV2 = (
  xmlDoc: Document,
  converter: XMLToExcelConverter,
  config: TaxValidationConfig = {}
): TaxValidationResult => {
  const cfg = mergeCfg(config);
  const issues: TaxIssue[] = [];
  const corrections: Record<string, { original: number; corrected: number; reason: string }> = {};
  const reconciledTaxAmounts: Record<string, number> = {};

  const totals = extractMonetaryTotals(xmlDoc, converter);
  const { invoicePayableAmount, taxExclusiveAmount } = totals;

  const documentTaxes = extractDocumentTaxTotals(xmlDoc, converter);

  for (const split of documentTaxes.splitExemptionIssues) {
    const codes = split.entries.map((e) => e.exemptionCode ?? '—');
    const taxableSum = split.entries.reduce((s, e) => s + (e.taxableAmount ?? 0), 0);
    issues.push({
      severity: 'error',
      scope: 'document',
      code: 'SPLIT_EXEMPTION_CODES',
      taxCode: split.taxCode,
      evidence: {
        fields: {
          exemptionCodes: ef(codes.join(', '), null),
          subtotalCount: efc(split.entries.length),
          taxableAmount: efc(round2(taxableSum)),
        },
      },
    });
  }

  for (const malformed of documentTaxes.malformedSubtotals) {
    issues.push({
      severity: 'error',
      scope: 'document',
      code: 'DOC_SUBTOTAL_MALFORMED',
      taxCode: `${normalizeTaxScheme(malformed.rawScheme)} (TaxSubtotal #${malformed.position})`,
      evidence: {
        fields: {
          taxableAmount: ef(malformed.taxableAmountRaw, null),
          percent: ef(malformed.rateRaw, null),
          taxAmount: ef(malformed.amountRaw, null),
        },
      },
    });
  }

  const lineGroups: Record<string, LineGroup> = {};

  const invoiceLines = extractInvoiceLineNodes(xmlDoc);

  for (let i = 0; i < invoiceLines.length; i++) {
    const lineNode = invoiceLines[i];
    const f = extractLineTaxFields(converter, lineNode, i);
    const { lineId, lineNet, taxableAmount, rate, taxAmount } = f;

    /* ItemRef is resolved once per line, lazily — only lines that actually
     * produce findings pay the XPath cost of the fallback chain. */
    let cachedItemRef: ItemRef | undefined;
    const itemRef = (): ItemRef => (cachedItemRef ??= resolveItemRef(converter, lineNode, lineId));

    const pushLineIssue = (code: TaxIssue['code'], evidence: TaxIssue['evidence']) =>
      issues.push({ severity: 'error', scope: 'line', lineId, code, itemRef: itemRef(), evidence });

    if (!f.lineExtensionAmountRaw || lineNet == null)
      pushLineIssue('MISSING_LINE_EXTENSION_AMOUNT', { fields: { lineExtensionAmount: ef(f.lineExtensionAmountRaw, lineNet) } });
    if (!f.taxableAmountRaw || taxableAmount == null)
      pushLineIssue('MISSING_TAXABLE_AMOUNT', { fields: { taxableAmount: ef(f.taxableAmountRaw, taxableAmount) } });
    if (!f.rateRaw || rate == null)
      pushLineIssue('MISSING_TAX_RATE', { fields: { percent: ef(f.rateRaw, rate) } });
    if (!f.taxAmountRaw || taxAmount == null)
      pushLineIssue('MISSING_TAX_AMOUNT', { fields: { taxAmount: ef(f.taxAmountRaw, taxAmount) } });

    if (lineNet != null && taxableAmount != null) {
      const expected = round2(lineNet);
      const actual = round2(taxableAmount);
      const diffBase = Math.abs(actual - expected);
      if (diffBase > cfg.toleranceTL) {
        pushLineIssue('TAXABLE_NOT_EQUAL_LINE_NET', {
          fields: {
            lineExtensionAmount: ef(f.lineExtensionAmountRaw, lineNet),
            taxableAmount: ef(f.taxableAmountRaw, taxableAmount),
          },
          formula: 'TaxableAmount = LineExtensionAmount',
          expected,
          actual,
          diff: round2(diffBase),
        });
      }
    }

    if (taxableAmount != null && rate != null && taxAmount != null) {
      const expected = round2((taxableAmount * rate) / 100);
      const actual = round2(taxAmount);
      const diffTax = Math.abs(expected - actual);
      if (diffTax > cfg.toleranceTL) {
        pushLineIssue('TAX_CALC_DEVIATION', {
          fields: {
            taxableAmount: ef(f.taxableAmountRaw, taxableAmount),
            percent: ef(f.rateRaw, rate),
            taxAmount: ef(f.taxAmountRaw, taxAmount),
          },
          formula: 'TaxableAmount × Percent ÷ 100',
          expected,
          actual,
          diff: round2(diffTax),
        });
      }
    }

    if (lineNet != null) {
      const rawScheme = extractLineTaxScheme(converter, lineNode, xmlDoc);
      const useRate = rate ?? 0;
      const taxCode = buildTaxCode(rawScheme, useRate);

      if (!lineGroups[taxCode]) {
        lineGroups[taxCode] = { taxCode, scheme: normalizeTaxScheme(rawScheme), rate: useRate, totalLineAmount: 0, totalTaxableAmount: 0, totalTaxAmount: 0 };
      }

      lineGroups[taxCode].totalLineAmount += lineNet;
      if (taxableAmount != null) lineGroups[taxCode].totalTaxableAmount += taxableAmount;
      if (taxAmount != null) lineGroups[taxCode].totalTaxAmount += taxAmount;
    }
  }

  const lineNetTotal = round2(Object.values(lineGroups).reduce((s, g) => s + g.totalLineAmount, 0));
  const lineTaxTotal = round2(Object.values(lineGroups).reduce((s, g) => s + g.totalTaxAmount, 0));
  const calculatedInvoiceTotal = round2(lineNetTotal + lineTaxTotal);

  if (taxExclusiveAmount != null) {
    const actual = round2(taxExclusiveAmount);
    const diff = Math.abs(actual - lineNetTotal);
    if (diff > cfg.toleranceTL) {
      issues.push({
        severity: 'error',
        scope: 'document',
        code: 'TAX_EXCLUSIVE_NOT_EQUAL_LINES',
        evidence: {
          fields: {
            taxExclusiveAmount: ef(totals.taxExclusiveAmountRaw, taxExclusiveAmount),
            lineNetTotal: efc(lineNetTotal),
          },
          formula: 'TaxExclusiveAmount = Σ LineExtensionAmount',
          expected: lineNetTotal,
          actual,
          diff: round2(diff),
        },
      });
    }
  }

  if (documentTaxes.totalTax != null) {
    const actual = round2(documentTaxes.totalTax);
    const diff = Math.abs(actual - lineTaxTotal);
    if (diff > cfg.toleranceTL) {
      issues.push({
        severity: 'error',
        scope: 'document',
        code: 'DOC_TAX_TOTAL_MISMATCH',
        evidence: {
          fields: {
            docTaxAmount: ef(documentTaxes.totalTaxRaw, documentTaxes.totalTax),
            lineTaxTotal: efc(lineTaxTotal),
          },
          formula: 'TaxTotal/TaxAmount = Σ satır TaxAmount',
          expected: lineTaxTotal,
          actual,
          diff: round2(diff),
        },
      });
    }
  }

  /* ─── Rate-based fallback index ───
   *
   * When a document subtotal has no exact taxCode match in lineGroups
   * (after normalization), we attempt a secondary match by rate alone.
   * This handles edge cases where the alias map doesn't cover a variant.
   */
  const lineGroupsByRate: Record<string, string> = {};
  for (const [tc, grp] of Object.entries(lineGroups)) {
    const rateKey = grp.rate.toFixed(2);
    if (!lineGroupsByRate[rateKey]) lineGroupsByRate[rateKey] = tc;
  }

  for (const [taxCode, docSubtotal] of Object.entries(documentTaxes.subtotals)) {
    const subtotalFields = {
      taxableAmount: ef(docSubtotal.taxableAmountRaw, docSubtotal.taxableAmount),
      percent: ef(docSubtotal.rateRaw, docSubtotal.rate),
      taxAmount: ef(docSubtotal.amountRaw, docSubtotal.amount),
    };

    if (docSubtotal.taxableAmount == null) {
      issues.push({
        severity: 'error',
        scope: 'document',
        code: 'DOC_SUBTOTAL_MISSING_TAXABLE',
        taxCode,
        evidence: { fields: subtotalFields },
      });
    } else {
      const expected = round2((docSubtotal.taxableAmount * docSubtotal.rate) / 100);
      const actual = round2(docSubtotal.amount);
      const diff = Math.abs(expected - actual);
      if (diff > cfg.toleranceTL) {
        issues.push({
          severity: 'error',
          scope: 'document',
          code: 'DOC_SUBTOTAL_TAX_CALC_DEVIATION',
          taxCode,
          evidence: {
            fields: subtotalFields,
            formula: 'TaxableAmount × Percent ÷ 100',
            expected,
            actual,
            diff: round2(diff),
          },
        });
      }
    }

    let lineGroup = lineGroups[taxCode];

    if (!lineGroup) {
      const rateKey = docSubtotal.rate.toFixed(2);
      const fallbackTaxCode = lineGroupsByRate[rateKey];
      if (fallbackTaxCode) {
        lineGroup = lineGroups[fallbackTaxCode];
      }
    }

    if (!lineGroup) {
      issues.push({
        severity: 'warning',
        scope: 'document',
        code: 'DOC_SUBTOTAL_WITHOUT_LINES',
        taxCode,
        evidence: { fields: subtotalFields },
      });
      reconciledTaxAmounts[taxCode] = round2(docSubtotal.amount);
      continue;
    }

    if (docSubtotal.taxableAmount != null) {
      const expected = round2(lineGroup.totalLineAmount);
      const actual = round2(docSubtotal.taxableAmount);
      const diffBase = Math.abs(actual - expected);
      if (diffBase > cfg.toleranceTL) {
        issues.push({
          severity: 'error',
          scope: 'document',
          code: 'DOC_TAXABLE_NOT_EQUAL_LINES',
          taxCode,
          evidence: {
            fields: {
              taxableAmount: ef(docSubtotal.taxableAmountRaw, docSubtotal.taxableAmount),
              groupLineNetTotal: efc(expected),
            },
            formula: 'Dip TaxableAmount = Σ grup LineExtensionAmount',
            expected,
            actual,
            diff: round2(diffBase),
          },
        });
      }
    }

    if (cfg.preferDocumentTotals) {
      const diffTax = Math.abs(round2(docSubtotal.amount) - round2(lineGroup.totalTaxAmount));
      if (diffTax > cfg.toleranceTL) {
        corrections[taxCode] = { original: round2(lineGroup.totalTaxAmount), corrected: round2(docSubtotal.amount), reason: 'document subtotal preferred' };
        reconciledTaxAmounts[taxCode] = round2(docSubtotal.amount);
      } else {
        reconciledTaxAmounts[taxCode] = round2(lineGroup.totalTaxAmount);
      }
    } else {
      reconciledTaxAmounts[taxCode] = round2(lineGroup.totalTaxAmount);
    }
  }

  if (invoicePayableAmount != null) {
    const actual = round2(invoicePayableAmount);
    const diff = Math.abs(actual - calculatedInvoiceTotal);
    if (diff > cfg.toleranceTL) {
      issues.push({
        severity: 'warning',
        scope: 'document',
        code: 'PAYABLE_TOTAL_MISMATCH',
        evidence: {
          fields: {
            payableAmount: ef(totals.invoicePayableAmountRaw, invoicePayableAmount),
            calculatedTotal: efc(calculatedInvoiceTotal),
          },
          formula: 'PayableAmount = Σ net + Σ vergi',
          expected: calculatedInvoiceTotal,
          actual,
          diff: round2(diff),
        },
      });
    }
  }

  const documentTaxTotal = documentTaxes.totalTax;

  /* Doc subtotal taxable total — informational, surfaces base-amount errors
   * in the summary. Deliberately NOT added to the reconciliation gate. */
  const subtotalTaxables = Object.values(documentTaxes.subtotals)
    .map((s) => s.taxableAmount)
    .filter((t): t is number => t != null);
  const documentTaxableTotal = subtotalTaxables.length > 0 ? round2(subtotalTaxables.reduce((s, t) => s + t, 0)) : null;

  const diffs = {
    payableVsCalculated: invoicePayableAmount == null ? null : round2(invoicePayableAmount) - calculatedInvoiceTotal,
    taxExclusiveVsLineNet: taxExclusiveAmount == null ? null : round2(taxExclusiveAmount) - lineNetTotal,
    docTaxTotalVsLineTax: documentTaxTotal == null ? null : round2(documentTaxTotal) - lineTaxTotal,
    docTaxableVsLineNet: documentTaxableTotal == null ? null : documentTaxableTotal - lineNetTotal,
  };

  const allDiffsReconciled = [
    diffs.payableVsCalculated,
    diffs.taxExclusiveVsLineNet,
    diffs.docTaxTotalVsLineTax,
  ].every((d) => d == null || Math.abs(d) <= cfg.reconciliationToleranceTL);

  /* ─── Severity gate ───
   *
   * Applies each code's downgrade policy from the error catalog:
   *  - whenInvoiceReconciles: softened to warning when all invoice-level
   *    diffs are within reconciliationToleranceTL (rounding-noise leniency).
   *  - whenDiffWithinTolerance: decided by the finding's OWN diff —
   *    |diff| ≤ 2 TL is a warning, above it stays an error. A 0.04 TL
   *    doc-taxable gap is noise; a 495 TL gap is a rejection cause.
   *  - never: structural gaps and split exemption codes always fail.
   */
  for (const issue of issues) {
    if (issue.severity !== 'error') continue;

    switch (downgradePolicyOf(issue.code)) {
      case 'whenInvoiceReconciles':
        if (allDiffsReconciled) issue.severity = 'warning';
        break;
      case 'whenDiffWithinTolerance': {
        const diff = issue.evidence.diff;
        if (diff != null && Math.abs(diff) <= cfg.reconciliationToleranceTL) issue.severity = 'warning';
        break;
      }
      case 'never':
        break;
    }
  }

  return {
    issues,
    corrections,
    reconciledTaxAmounts,
    splitExemptionIssues: documentTaxes.splitExemptionIssues,
    aggregates: {
      invoicePayableAmount,
      taxExclusiveAmount,
      lineNetTotal,
      lineTaxTotal,
      calculatedInvoiceTotal,
      documentTaxTotal: documentTaxTotal == null ? null : round2(documentTaxTotal),
      documentTaxableTotal,
      diffs,
    },
  };
};
