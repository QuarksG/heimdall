import DOMPurify from 'dompurify';
import type { XMLToExcelConverter } from '../../../invoice-parsing/utils/xmlParser';

const evalSingleText = (converter: XMLToExcelConverter, context: Node, xpath: string): string | null => {
  const convEval = (converter as any)?.evaluateSingle;
  if (typeof convEval === 'function') {
    try {
      const v = convEval.call(converter, context, xpath);
      const s = typeof v === 'string' ? v.trim() : '';
      return s ? s : null;
    } catch {}
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

type Severity = 'error' | 'warning';
type Scope = 'line' | 'document';

export type TaxIssue = {
  severity: Severity;
  scope: Scope;
  code: string;
  lineId?: string;
  taxCode?: string;
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
    diffs: {
      payableVsCalculated?: number | null;
      taxExclusiveVsLineNet?: number | null;
      docTaxTotalVsLineTax?: number | null;
    };
  };
};

export type TaxValidationConfig = {
  toleranceTL?: number;
  reconciliationToleranceTL?: number;
  preferDocumentTotals?: boolean;
};

const DEFAULT_CFG: Required<TaxValidationConfig> = {
  toleranceTL: 0.02,
  reconciliationToleranceTL: 2.0,
  preferDocumentTotals: true,
};

const mergeCfg = (config: TaxValidationConfig): Required<TaxValidationConfig> => ({ ...DEFAULT_CFG, ...config });

const parseNumberLoose = (raw: string | null): number | null => {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;
  s = s.replace(/\s+/g, '');
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) s = s.replace(/,/g, '');
  else if (hasComma && !hasDot) s = s.replace(/,/g, '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/* ─── Tax scheme normalization ───
 *
 * Turkish e-invoices use two conventions interchangeably:
 *   - Short code on InvoiceLine level:   "KDV", "ÖTV", "ÖİV", …
 *   - Full name on document TaxTotal:     "KATMA DEĞER VERGİSİ", "ÖZEL TÜKETİM VERGİSİ", …
 *
 * Both refer to the same tax. We normalize to the short canonical form
 * before building taxCode keys so that grouping/matching works correctly.
 */
const TAX_SCHEME_ALIASES: Record<string, string> = {
  'KATMA DEĞER VERGİSİ': 'KDV',
  'KATMA DEGER VERGISI': 'KDV',
  'ÖZEL TÜKETİM VERGİSİ': 'ÖTV',
  'OZEL TUKETIM VERGISI': 'ÖTV',
  'ÖZEL İLETİŞİM VERGİSİ': 'ÖİV',
  'OZEL ILETISIM VERGISI': 'ÖİV',
  'DAMGA VERGİSİ': 'DV',
  'DAMGA VERGISI': 'DV',
  'BANKA VE SİGORTA MUAMELELERİ VERGİSİ': 'BSMV',
  'BANKA VE SIGORTA MUAMELELERI VERGISI': 'BSMV',
  'KONAKLAMA VERGİSİ': 'KV',
  'KONAKLAMA VERGISI': 'KV',
};

const normalizeTaxScheme = (raw: string): string => {
  const trimmed = (raw || '').trim();
  if (!trimmed) return 'KDV';

  const upper = trimmed.toLocaleUpperCase('tr-TR');

  const directMatch = TAX_SCHEME_ALIASES[trimmed];
  if (directMatch) return directMatch;

  const upperMatch = TAX_SCHEME_ALIASES[upper];
  if (upperMatch) return upperMatch;

  return trimmed;
};

const buildTaxCode = (scheme: string, rate: number): string => {
  const normalizedScheme = normalizeTaxScheme(scheme);
  const safeRate = Number.isFinite(rate) ? rate : 0;
  return `${normalizedScheme}-TR-${safeRate.toFixed(2)}%`;
};

const extractLineTaxScheme = (converter: XMLToExcelConverter, lineNode: Node, xmlDoc: Document): string => {
  const s1 = evalSingleText(
    converter,
    lineNode,
    'string(.//*[local-name()="TaxTotal"]/*[local-name()="TaxSubtotal"]//*[local-name()="TaxScheme"]/*[local-name()="Name"][1])'
  );
  if (s1) return s1;

  const s2 = evalSingleText(
    converter,
    lineNode,
    'string(.//*[local-name()="Item"]//*[local-name()="TaxScheme"]/*[local-name()="Name"][1])'
  );
  if (s2) return s2;

  const s3 = evalSingleText(
    converter,
    xmlDoc,
    'string(//*[local-name()="TaxTotal"][not(ancestor::*[local-name()="InvoiceLine"])]//*[local-name()="TaxScheme"]/*[local-name()="Name"][1])'
  );
  if (s3) return s3;

  const s4 = evalSingleText(
    converter,
    xmlDoc,
    'string(//*[local-name()="AccountingSupplierParty"]//*[local-name()="PartyTaxScheme"]//*[local-name()="TaxScheme"]/*[local-name()="Name"][1])'
  );
  if (s4) return s4;

  return 'KDV';
};

type DocSubtotalEntry = {
  taxCode: string;
  amount: number;
  rate: number;
  taxableAmount: number | null;
  scheme: string;
  rawScheme: string;
  exemptionReasonCode: string | null;
};

type DocumentTaxResult = {
  totalTax: number | null;
  subtotals: Record<string, DocSubtotalEntry>;
  splitExemptionIssues: SplitExemptionIssue[];
};

const extractDocumentTaxTotals = (
  xmlDoc: Document,
  converter: XMLToExcelConverter
): DocumentTaxResult => {
  const totalTaxRaw = evalSingleText(
    converter,
    xmlDoc,
    'string(/*/*[local-name()="TaxTotal"][not(ancestor::*[local-name()="InvoiceLine"])]/*[local-name()="TaxAmount"][1])'
  );
  const totalTax = parseNumberLoose(totalTaxRaw);

  const rawEntries: DocSubtotalEntry[] = [];

  const nodes = xmlDoc.evaluate(
    '/*/*[local-name()="TaxTotal"][not(ancestor::*[local-name()="InvoiceLine"])]/*[local-name()="TaxSubtotal"]',
    xmlDoc,
    null,
    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
    null
  );

  for (let i = 0; i < nodes.snapshotLength; i++) {
    const n = nodes.snapshotItem(i) as Node;

    const amount = parseNumberLoose(evalSingleText(converter, n, 'string(.//*[local-name()="TaxAmount"][1])'));
    const rate = parseNumberLoose(evalSingleText(converter, n, 'string(.//*[local-name()="Percent"][1])'));
    const taxableAmount = parseNumberLoose(evalSingleText(converter, n, 'string(.//*[local-name()="TaxableAmount"][1])'));
    const rawScheme = evalSingleText(converter, n, 'string(.//*[local-name()="TaxScheme"]/*[local-name()="Name"][1])') || 'KDV';
    const exemptionReasonCode = evalSingleText(converter, n, 'string(.//*[local-name()="TaxExemptionReasonCode"][1])') || null;

    if (amount == null || rate == null) continue;

    const taxCode = buildTaxCode(rawScheme, rate);
    rawEntries.push({ taxCode, amount, rate, taxableAmount: taxableAmount ?? null, scheme: normalizeTaxScheme(rawScheme), rawScheme, exemptionReasonCode });
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
      };
      subtotals[taxCode] = aggregated;
    } else {
      subtotals[taxCode] = entries[0];
    }
  }

  return { totalTax, subtotals, splitExemptionIssues };
};

export const validateAmazonTaxDetailsV2 = (
  xmlDoc: Document,
  converter: XMLToExcelConverter,
  config: TaxValidationConfig = {}
): TaxValidationResult => {
  const cfg = mergeCfg(config);
  const issues: TaxIssue[] = [];
  const corrections: Record<string, { original: number; corrected: number; reason: string }> = {};
  const reconciledTaxAmounts: Record<string, number> = {};

  const invoicePayableAmount = parseNumberLoose(
    evalSingleText(converter, xmlDoc, 'string(//*[local-name()="LegalMonetaryTotal"]/*[local-name()="PayableAmount"][1])')
  );

  const taxExclusiveAmount = parseNumberLoose(
    evalSingleText(converter, xmlDoc, 'string(//*[local-name()="LegalMonetaryTotal"]/*[local-name()="TaxExclusiveAmount"][1])')
  );

  const documentTaxes = extractDocumentTaxTotals(xmlDoc, converter);

  for (const split of documentTaxes.splitExemptionIssues) {
    issues.push({
      severity: 'error',
      scope: 'document',
      code: 'SPLIT_EXEMPTION_CODES',
      taxCode: split.taxCode,
    });
  }

  const lineGroups: Record<
    string,
    { taxCode: string; scheme: string; rate: number; totalLineAmount: number; totalTaxableAmount: number; totalTaxAmount: number }
  > = {};

  const invoiceLines = xmlDoc.evaluate(
    '//*[local-name()="InvoiceLine"]',
    xmlDoc,
    null,
    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
    null
  );

  for (let i = 0; i < invoiceLines.snapshotLength; i++) {
    const lineNode = invoiceLines.snapshotItem(i) as Node;
    const rawLineId = evalSingleText(converter, lineNode, 'string(.//*[local-name()="ID"][1])') ?? String(i + 1);

    const lineExtensionAmountRaw = evalSingleText(converter, lineNode, 'string(.//*[local-name()="LineExtensionAmount"][1])');
    const taxableAmountRaw = evalSingleText(
      converter,
      lineNode,
      'string(.//*[local-name()="TaxTotal"]/*[local-name()="TaxSubtotal"]/*[local-name()="TaxableAmount"][1])'
    );
    const rateRaw =
      evalSingleText(
        converter,
        lineNode,
        'string(.//*[local-name()="TaxTotal"]/*[local-name()="TaxSubtotal"]//*[local-name()="Percent"][1])'
      ) ??
      evalSingleText(
        converter,
        lineNode,
        'string(.//*[local-name()="Item"]/*[local-name()="ClassifiedTaxCategory"]//*[local-name()="Percent"][1])'
      );

    const taxAmountRaw =
      evalSingleText(
        converter,
        lineNode,
        'string(.//*[local-name()="TaxTotal"]/*[local-name()="TaxSubtotal"]/*[local-name()="TaxAmount"][1])'
      ) ??
      evalSingleText(converter, lineNode, 'string(.//*[local-name()="TaxTotal"]/*[local-name()="TaxAmount"][1])');

    const lineNet = parseNumberLoose(lineExtensionAmountRaw);
    const taxableAmount = parseNumberLoose(taxableAmountRaw);
    const rate = parseNumberLoose(rateRaw);
    const taxAmount = parseNumberLoose(taxAmountRaw);

    if (!lineExtensionAmountRaw || lineNet == null) issues.push({ severity: 'error', scope: 'line', lineId: rawLineId, code: 'MISSING_LINE_EXTENSION_AMOUNT' });
    if (!taxableAmountRaw || taxableAmount == null) issues.push({ severity: 'error', scope: 'line', lineId: rawLineId, code: 'MISSING_TAXABLE_AMOUNT' });
    if (!rateRaw || rate == null) issues.push({ severity: 'error', scope: 'line', lineId: rawLineId, code: 'MISSING_TAX_RATE' });
    if (!taxAmountRaw || taxAmount == null) issues.push({ severity: 'error', scope: 'line', lineId: rawLineId, code: 'MISSING_TAX_AMOUNT' });

    if (lineNet != null && taxableAmount != null) {
      const diffBase = Math.abs(round2(taxableAmount) - round2(lineNet));
      if (diffBase > cfg.toleranceTL) issues.push({ severity: 'error', scope: 'line', lineId: rawLineId, code: 'TAXABLE_NOT_EQUAL_LINE_NET' });
    }

    if (taxableAmount != null && rate != null && taxAmount != null) {
      const expected = round2((taxableAmount * rate) / 100);
      const actual = round2(taxAmount);
      const diffTax = Math.abs(expected - actual);
      if (diffTax > cfg.toleranceTL) issues.push({ severity: 'error', scope: 'line', lineId: rawLineId, code: 'TAX_CALC_DEVIATION' });
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
    const diff = Math.abs(round2(taxExclusiveAmount) - lineNetTotal);
    if (diff > cfg.toleranceTL) issues.push({ severity: 'error', scope: 'document', code: 'TAX_EXCLUSIVE_NOT_EQUAL_LINES' });
  }

  if (documentTaxes.totalTax != null) {
    const diff = Math.abs(round2(documentTaxes.totalTax) - lineTaxTotal);
    if (diff > cfg.toleranceTL) issues.push({ severity: 'error', scope: 'document', code: 'DOC_TAX_TOTAL_MISMATCH' });
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
    if (docSubtotal.taxableAmount == null) {
      issues.push({ severity: 'error', scope: 'document', code: 'DOC_SUBTOTAL_MISSING_TAXABLE', taxCode });
    } else {
      const expected = round2((docSubtotal.taxableAmount * docSubtotal.rate) / 100);
      const actual = round2(docSubtotal.amount);
      const diff = Math.abs(expected - actual);
      if (diff > cfg.toleranceTL) issues.push({ severity: 'error', scope: 'document', code: 'DOC_SUBTOTAL_TAX_CALC_DEVIATION', taxCode });
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
      issues.push({ severity: 'warning', scope: 'document', code: 'DOC_SUBTOTAL_WITHOUT_LINES', taxCode });
      reconciledTaxAmounts[taxCode] = round2(docSubtotal.amount);
      continue;
    }

    if (docSubtotal.taxableAmount != null) {
      const diffBase = Math.abs(round2(docSubtotal.taxableAmount) - round2(lineGroup.totalLineAmount));
      if (diffBase > cfg.toleranceTL) issues.push({ severity: 'error', scope: 'document', code: 'DOC_TAXABLE_NOT_EQUAL_LINES', taxCode });
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
    const diff = Math.abs(round2(invoicePayableAmount) - calculatedInvoiceTotal);
    if (diff > cfg.toleranceTL) issues.push({ severity: 'warning', scope: 'document', code: 'PAYABLE_TOTAL_MISMATCH' });
  }

  const documentTaxTotal = documentTaxes.totalTax;

  const diffs = {
    payableVsCalculated: invoicePayableAmount == null ? null : round2(invoicePayableAmount) - calculatedInvoiceTotal,
    taxExclusiveVsLineNet: taxExclusiveAmount == null ? null : round2(taxExclusiveAmount) - lineNetTotal,
    docTaxTotalVsLineTax: documentTaxTotal == null ? null : round2(documentTaxTotal) - lineTaxTotal,
  };

  const allDiffsReconciled = [
    diffs.payableVsCalculated,
    diffs.taxExclusiveVsLineNet,
    diffs.docTaxTotalVsLineTax,
  ].every((d) => d == null || Math.abs(d) <= cfg.reconciliationToleranceTL);

  const NON_DOWNGRADABLE = new Set(['SPLIT_EXEMPTION_CODES']);

  if (allDiffsReconciled) {
    for (const issue of issues) {
      if (issue.severity === 'error' && !NON_DOWNGRADABLE.has(issue.code)) {
        issue.severity = 'warning';
      }
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
      diffs,
    },
  };
};

const TAX_XML_SAMPLE = `<cac:InvoiceLine>
  <cbc:ID>1</cbc:ID>
  <cbc:InvoicedQuantity unitCode="C62">25.00</cbc:InvoicedQuantity>
  <cbc:LineExtensionAmount currencyID="TRY">5025.00</cbc:LineExtensionAmount>
  <cac:AllowanceCharge>
    <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
    <cbc:MultiplierFactorNumeric>0.00</cbc:MultiplierFactorNumeric>
    <cbc:Amount currencyID="TRY">0.00</cbc:Amount>
    <cbc:BaseAmount currencyID="TRY">0.0</cbc:BaseAmount>
  </cac:AllowanceCharge>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="TRY">904.50</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="TRY">5025.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="TRY">904.50</cbc:TaxAmount>
      <cbc:CalculationSequenceNumeric>1</cbc:CalculationSequenceNumeric>
      <cbc:Percent>18</cbc:Percent>
      <cac:TaxCategory>
        <cac:TaxScheme>
          <cbc:Name>KDV</cbc:Name>
          <cbc:TaxTypeCode>0015</cbc:TaxTypeCode>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
</cac:InvoiceLine>`;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const fmt = (n: number | null | undefined): string => (n == null ? '—' : n.toFixed(2));

const renderGuidanceAndXml = (): string => {
  return [
    `<h3 style="color:#2c3e50;margin:14px 0 6px 0;">Vergi Detayları</h3>`,
    `<p style="color:#34495e;margin:0 0 8px 0;">Vergi detaylarında dikkat edilmesi gereken hususlar nelerdir?</p>`,
    `<ul style="color:#34495e;line-height:1.5;margin:0 0 10px 0;padding-left:18px;">`,
    `<li>KDV matrahının aşağıdaki XML örneğindeki gibi <strong>LineExtensionAmount</strong> satırında yer alması gerekmektedir. (Önemli Not: Fatura üzerinde satır iskontosu yapıldığı takdirde dahi bu satırda iskonto sonrası Net KDV Matrahı bulunmalıdır.)</li>`,
    `<li>Hem ürün kalemleri hem de dip toplamda <strong>TaxableAmount = LineExtensionAmount</strong> eşitliği mutlaka sağlanmalıdır. Bu satırlardaki değerler de iskonto sonrası KDV matrahı olmalıdır; bu da otomatik olarak <strong>TaxExclusiveAmount</strong> değerine eşit olacaktır. Sonuçta bu 3 satırın eşitliği de sağlanacaktır.</li>`,
    `<li>KDV matrahı üzerinden hesaplanan KDV tutarı <strong>0.02 TL</strong>'den daha büyük bir sapma göstermemelidir. (Önemli Not: Amazon sistemi KDV'yi virgülden sonra 2 basamak olacak şekilde hesaplamaktadır. 2 basamak sonrasındaki değerler 2 basamağa yuvarlanır.)</li>`,
    `<li>Vergi bilgilerinin satır düzeyinde yer alması gerekmektedir. (KDV matrahı, KDV oranı ve KDV tutarı ürün kalemi bazında belirtilmelidir.)</li>`,
    `</ul>`,
    `<p style="color:#2c3e50;margin:0 0 6px 0;"><strong>XML Örneği</strong></p>`,
    `<pre style="background:#f8f9fa;border:1px solid #e5e7eb;border-radius:8px;padding:12px;overflow:auto;white-space:pre;margin:0;">${escapeHtml(
      TAX_XML_SAMPLE
    )}</pre>`,
  ].join('');
};

const renderSummaryOnly = (result: TaxValidationResult, toleranceTL: number): string => {
  const errorCount = result.issues.filter(i => i.severity === 'error').length;
  const warningCount = result.issues.filter(i => i.severity === 'warning').length;

  const countsByCode: Record<string, number> = {};
  for (const i of result.issues) countsByCode[i.code] = (countsByCode[i.code] ?? 0) + 1;

  const topCodes = Object.entries(countsByCode)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const correctionTaxCodes = Object.keys(result.corrections).sort();

  return [
    `<div style="background:#ecf0f1;padding:12px 14px;border-radius:8px;margin-top:8px;">`,
    `<p style="color:#2c3e50;margin:0 0 6px 0;"><strong>Özet</strong></p>`,
    `<ul style="color:#34495e;margin:0;padding-left:18px;line-height:1.6;">`,
    `<li>Hata: ${errorCount} | Uyarı: ${warningCount}</li>`,
    `<li>Satır net toplamı (LineExtensionAmount toplamı): ${fmt(result.aggregates.lineNetTotal)}</li>`,
    `<li>Satır vergi toplamı (satır TaxAmount toplamı): ${fmt(result.aggregates.lineTaxTotal)}</li>`,
    `<li>Hesaplanan toplam (net + vergi): ${fmt(result.aggregates.calculatedInvoiceTotal)}</li>`,
    `<li>TaxExclusiveAmount: ${fmt(result.aggregates.taxExclusiveAmount ?? null)} (Fark: ${fmt(result.aggregates.diffs.taxExclusiveVsLineNet ?? null)})</li>`,
    `<li>Dip toplam vergi (TaxTotal): ${fmt(result.aggregates.documentTaxTotal ?? null)} (Fark: ${fmt(
      result.aggregates.diffs.docTaxTotalVsLineTax ?? null
    )})</li>`,
    `<li>PayableAmount: ${fmt(result.aggregates.invoicePayableAmount ?? null)} (Fark: ${fmt(
      result.aggregates.diffs.payableVsCalculated ?? null
    )})</li>`,
    `<li>Tolerans: ${toleranceTL.toFixed(2)} TL</li>`,
    `</ul>`,
    topCodes.length > 0
      ? [
          `<p style="color:#2c3e50;margin:10px 0 6px 0;"><strong>Bulgular (kategori bazında)</strong></p>`,
          `<ul style="color:#34495e;margin:0;padding-left:18px;line-height:1.6;">`,
          ...topCodes.map(([code, count]) => `<li>${DOMPurify.sanitize(code)}: ${count}</li>`),
          `</ul>`,
        ].join('')
      : '',
    correctionTaxCodes.length > 0
      ? [
          `<p style="color:#2c3e50;margin:10px 0 6px 0;"><strong>Dip toplam esas alınan vergi grupları</strong></p>`,
          `<ul style="color:#34495e;margin:0;padding-left:18px;line-height:1.6;">`,
          ...correctionTaxCodes.map(tc => `<li>${DOMPurify.sanitize(tc)}</li>`),
          `</ul>`,
        ].join('')
      : '',
    result.splitExemptionIssues.length > 0
      ? [
          `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px 14px;margin-top:10px;">`,
          `<p style="color:#c2410c;margin:0 0 8px 0;"><strong>⚠️ Birden Fazla Vergi İstisna Kodu Tespit Edildi</strong></p>`,
          ...result.splitExemptionIssues.map(split => {
            const rows = split.entries
              .map(e => `<li>İstisna Kodu: <strong>${DOMPurify.sanitize(e.exemptionCode ?? '—')}</strong> — KDV Matrahı: <strong>${fmt(e.taxableAmount)}</strong> TRY</li>`)
              .join('');
            const total = split.entries.reduce((s, e) => s + (e.taxableAmount ?? 0), 0);
            return [
              `<p style="color:#34495e;margin:0 0 4px 0;">Vergi grubu <strong>${DOMPurify.sanitize(split.taxCode)}</strong> için birden fazla <code>TaxSubtotal</code> bulundu:</p>`,
              `<ul style="color:#34495e;margin:0 0 8px 0;padding-left:18px;line-height:1.6;">${rows}</ul>`,
              `<p style="color:#34495e;margin:0 0 8px 0;">Toplam: <strong>${fmt(total)}</strong> TRY</p>`,
            ].join('');
          }),
          `<p style="color:#34495e;margin:8px 0 4px 0;"><strong>Neden sorun oluşturuyor?</strong></p>`,
          `<p style="color:#34495e;margin:0 0 8px 0;">Amazon'un alıcı sistemi her vergi grubu için yalnızca <strong>tek bir TaxSubtotal</strong> işler. Birden fazla istisna kodu (örn. 335 ve 350) aynı KDV oranına sahip olsa bile farklı vergi satırlarına eşlenir. Bu durumda KDV matrahı (<code>TaxableAmount</code>) ile satır net toplamı (<code>LineExtensionAmount</code>) eşleşmez ve fatura reddedilir.</p>`,
          `<p style="color:#34495e;margin:0 0 4px 0;"><strong>Çözüm:</strong></p>`,
          `<p style="color:#34495e;margin:0;">Tüm vergi matrahlarını tek bir <code>TaxSubtotal</code> altında, tek bir istisna koduyla birleştirin. <code>TaxableAmount</code> değeri <code>TaxExclusiveAmount</code> ve <code>LineExtensionAmount</code> toplamına eşit olmalıdır.</p>`,
          `</div>`,
        ].join('')
      : '',
    `</div>`,
  ].join('');
};

export const validateAmazonTaxDetails = (xmlDoc: Document, converter: XMLToExcelConverter): string[] => {
  const cfg = mergeCfg({});
  const result = validateAmazonTaxDetailsV2(xmlDoc, converter, cfg);

  const hasRealErrors = result.issues.some(i => i.severity === 'error');
  if (!hasRealErrors) return [];

  return [renderSummaryOnly(result, cfg.toleranceTL) + renderGuidanceAndXml()];
};