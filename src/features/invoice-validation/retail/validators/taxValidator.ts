/**
 * Retail tax validation — public façade.
 *
 * Pipeline: engine (validators/tax/engine.ts, pure logic) → findings tables
 * (rendering/findingsTable.ts, auditable per-code evidence tables) → this
 * module assembles the final Turkish chat message.
 *
 * Message layout on failure:
 *   1. Aggregates summary (totals, diffs, tolerance, preferred tax groups)
 *   2. Per-code findings tables (line/item references, values read,
 *      expected vs declared, diff — capped at 40 rows with rollups)
 *   3. Split-exemption detail panel (per-entry breakdown, when present)
 *   4. General guidance + sample XML
 *
 * Public API (consumed by InvoiceControl.tsx and re-exported via ../index.ts):
 *   - validateAmazonTaxDetails(xmlDoc, converter): string[]   [] = pass
 *   - validateAmazonTaxDetailsV2 + result/config types (re-exported)
 *
 * Validation policy (severities, downgradability, texts, table columns)
 * lives in validators/tax/errorCatalog.ts — change it there.
 */
import DOMPurify from 'dompurify';
import type { XMLToExcelConverter } from '../../../invoice-parsing/utils/xmlParser';
import { validateAmazonTaxDetailsV2 } from './tax/engine';
import { ERROR_CATALOG } from './tax/errorCatalog';
import { mergeCfg } from './tax/types';
import type { TaxValidationResult } from './tax/types';
import { renderFindingsTables } from '../rendering/findingsTable';

export { validateAmazonTaxDetailsV2 } from './tax/engine';
export type { TaxIssue, SplitExemptionIssue, TaxValidationResult, TaxValidationConfig } from './tax/types';

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
    `<div class="hd-card">`,
    `<div class="hd-card-header"><span class="hd-findings-title">ℹ️ <strong>Vergi Detayları</strong></span></div>`,
    `<div class="hd-card-body">`,
    `<p style="color:var(--hd-text-muted);margin:0 0 8px 0;">Vergi detaylarında dikkat edilmesi gereken hususlar nelerdir?</p>`,
    `<ul style="color:var(--hd-text-muted);line-height:1.5;margin:0;padding-left:18px;">`,
    `<li>KDV matrahının aşağıdaki XML örneğindeki gibi <strong>LineExtensionAmount</strong> satırında yer alması gerekmektedir. (Önemli Not: Fatura üzerinde satır iskontosu yapıldığı takdirde dahi bu satırda iskonto sonrası Net KDV Matrahı bulunmalıdır.)</li>`,
    `<li>Hem ürün kalemleri hem de dip toplamda <strong>TaxableAmount = LineExtensionAmount</strong> eşitliği mutlaka sağlanmalıdır. Bu satırlardaki değerler de iskonto sonrası KDV matrahı olmalıdır; bu da otomatik olarak <strong>TaxExclusiveAmount</strong> değerine eşit olacaktır. Sonuçta bu 3 satırın eşitliği de sağlanacaktır.</li>`,
    `<li>KDV matrahı üzerinden hesaplanan KDV tutarı <strong>0.02 TL</strong>'den daha büyük bir sapma göstermemelidir. (Önemli Not: Amazon sistemi KDV'yi virgülden sonra 2 basamak olacak şekilde hesaplamaktadır. 2 basamak sonrasındaki değerler 2 basamağa yuvarlanır.)</li>`,
    `<li>Vergi bilgilerinin satır düzeyinde yer alması gerekmektedir. (KDV matrahı, KDV oranı ve KDV tutarı ürün kalemi bazında belirtilmelidir.)</li>`,
    `</ul>`,
    `</div>`,
    `</div>`,
    `<div class="hd-card hd-code-card">`,
    `<div class="hd-card-header"><span class="hd-code-lang">&lt;/&gt;</span> <strong>XML Örneği</strong></div>`,
    `<div class="hd-card-body"><pre class="hd-code-pre">${escapeHtml(TAX_XML_SAMPLE)}</pre></div>`,
    `</div>`,
  ].join('');
};

/**
 * Invoice-level totals, diffs and tolerance — the header card above the
 * findings tables. Every quantity the engine compares appears here,
 * including the doc subtotal KDV base vs line nets (docTaxableVsLineNet):
 * without it, a wrong doc TaxableAmount (e.g. tax-inclusive total) shows
 * "Hata: 2" while every listed Fark reads 0.00 — misleading.
 * Out-of-tolerance diffs are highlighted.
 */
const renderAggregatesSummary = (result: TaxValidationResult, toleranceTL: number): string => {
  const errorCount = result.issues.filter(i => i.severity === 'error').length;
  const warningCount = result.issues.filter(i => i.severity === 'warning').length;

  const correctionTaxCodes = Object.keys(result.corrections).sort();

  const diffBadge = (diff: number | null | undefined): string => {
    if (diff == null) return `(Fark: —)`;
    const out = Math.abs(diff) > toleranceTL;
    return out
      ? `(Fark: <span class="hd-diff-cell">${fmt(diff)}</span> ⟵ tolerans dışı)`
      : `(Fark: ${fmt(diff)})`;
  };

  const a = result.aggregates;

  return [
    `<div class="hd-card hd-summary-card">`,
    `<div class="hd-card-header">`,
    `<span class="hd-findings-title">📋 <strong>Özet</strong></span>`,
    `<span class="hd-card-header-meta">Hata: ${errorCount} | Uyarı: ${warningCount}</span>`,
    `</div>`,
    `<div class="hd-card-body">`,
    `<ul style="color:var(--hd-text-muted);margin:0;padding-left:18px;line-height:1.6;">`,
    `<li>Satır net toplamı (LineExtensionAmount toplamı): ${fmt(a.lineNetTotal)}</li>`,
    `<li>Satır vergi toplamı (satır TaxAmount toplamı): ${fmt(a.lineTaxTotal)}</li>`,
    `<li>Hesaplanan toplam (net + vergi): ${fmt(a.calculatedInvoiceTotal)}</li>`,
    `<li>TaxExclusiveAmount: ${fmt(a.taxExclusiveAmount ?? null)} ${diffBadge(a.diffs.taxExclusiveVsLineNet)}</li>`,
    `<li>Dip toplam vergi (TaxTotal): ${fmt(a.documentTaxTotal ?? null)} ${diffBadge(a.diffs.docTaxTotalVsLineTax)}</li>`,
    `<li>Dip toplam KDV matrahı (TaxableAmount): ${fmt(a.documentTaxableTotal ?? null)} ${diffBadge(a.diffs.docTaxableVsLineNet)}</li>`,
    `<li>PayableAmount: ${fmt(a.invoicePayableAmount ?? null)} ${diffBadge(a.diffs.payableVsCalculated)}</li>`,
    `<li>Tolerans: ${toleranceTL.toFixed(2)} TL</li>`,
    `</ul>`,
    correctionTaxCodes.length > 0
      ? [
          `<p style="color:var(--hd-text-muted);margin:10px 0 6px 0;"><strong>Dip toplam esas alınan vergi grupları</strong></p>`,
          `<ul style="color:var(--hd-text-muted);margin:0;padding-left:18px;line-height:1.6;">`,
          ...correctionTaxCodes.map(tc => `<li>${DOMPurify.sanitize(tc)}</li>`),
          `</ul>`,
        ].join('')
      : '',
    `</div>`,
    `</div>`,
  ].join('');
};

/** Per-entry breakdown for split exemption codes — complements the findings table. */
const renderSplitExemptionDetail = (result: TaxValidationResult): string => {
  if (result.splitExemptionIssues.length === 0) return '';

  return [
    `<div class="hd-card hd-findings-warning">`,
    `<div class="hd-card-header"><span class="hd-findings-title">⚠️ <strong>Birden Fazla Vergi İstisna Kodu Tespit Edildi</strong></span></div>`,
    `<div class="hd-card-body">`,
    ...result.splitExemptionIssues.map(split => {
      const rows = split.entries
        .map(e => `<li>İstisna Kodu: <strong>${DOMPurify.sanitize(e.exemptionCode ?? '—')}</strong> — KDV Matrahı: <strong>${fmt(e.taxableAmount)}</strong> TRY</li>`)
        .join('');
      const total = split.entries.reduce((s, e) => s + (e.taxableAmount ?? 0), 0);
      return [
        `<p style="color:var(--hd-text-muted);margin:0 0 4px 0;">Vergi grubu <strong>${DOMPurify.sanitize(split.taxCode)}</strong> için birden fazla <code>TaxSubtotal</code> bulundu:</p>`,
        `<ul style="color:var(--hd-text-muted);margin:0 0 8px 0;padding-left:18px;line-height:1.6;">${rows}</ul>`,
        `<p style="color:var(--hd-text-muted);margin:0 0 8px 0;">Toplam: <strong>${fmt(total)}</strong> TRY</p>`,
      ].join('');
    }),
    `<p style="color:var(--hd-text-muted);margin:8px 0 4px 0;"><strong>Neden sorun oluşturuyor?</strong></p>`,
    `<p style="color:var(--hd-text-muted);margin:0 0 8px 0;">Amazon'un alıcı sistemi her vergi grubu için yalnızca <strong>tek bir TaxSubtotal</strong> işler. Birden fazla istisna kodu (örn. 335 ve 350) aynı KDV oranına sahip olsa bile farklı vergi satırlarına eşlenir. Bu durumda KDV matrahı (<code>TaxableAmount</code>) ile satır net toplamı (<code>LineExtensionAmount</code>) eşleşmez ve fatura reddedilir.</p>`,
    `<p style="color:var(--hd-text-muted);margin:0 0 4px 0;"><strong>Çözüm:</strong></p>`,
    `<p style="color:var(--hd-text-muted);margin:0;">Tüm vergi matrahlarını tek bir <code>TaxSubtotal</code> altında, tek bir istisna koduyla birleştirin. <code>TaxableAmount</code> değeri <code>TaxExclusiveAmount</code> ve <code>LineExtensionAmount</code> toplamına eşit olmalıdır.</p>`,
    `</div>`,
    `</div>`,
  ].join('');
};

export const validateAmazonTaxDetails = (xmlDoc: Document, converter: XMLToExcelConverter): string[] => {
  const cfg = mergeCfg({});
  const result = validateAmazonTaxDetailsV2(xmlDoc, converter, cfg);

  const hasRealErrors = result.issues.some(i => i.severity === 'error');
  if (!hasRealErrors) return [];

  const findingsHtml = renderFindingsTables(result.issues, ERROR_CATALOG);

  return [
    renderAggregatesSummary(result, cfg.toleranceTL) +
      findingsHtml +
      renderSplitExemptionDetail(result) +
      renderGuidanceAndXml(),
  ];
};
