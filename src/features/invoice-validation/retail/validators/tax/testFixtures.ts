/**
 * UBL invoice XML fixture builder for tax engine tests (test-only module).
 *
 * Generates minimal but structurally faithful e-Fatura documents:
 * document-level TaxTotal/TaxSubtotal, LegalMonetaryTotal, and InvoiceLine
 * entries with per-line TaxTotal and Item identification fields.
 */

export type FixtureLine = {
  id?: string;
  lineExtensionAmount?: string;
  taxableAmount?: string;
  percent?: string;
  taxAmount?: string;
  schemeName?: string;
  itemName?: string;
  description?: string;
  buyersItemId?: string;
  sellersItemId?: string;
  manufacturersItemId?: string;
};

export type FixtureDocSubtotal = {
  taxableAmount?: string;
  taxAmount?: string;
  percent?: string;
  schemeName?: string;
  exemptionReasonCode?: string;
};

export type FixtureSpec = {
  lines: FixtureLine[];
  /** Document-level TaxTotal/TaxAmount. Omit to leave out the doc TaxTotal entirely. */
  docTaxAmount?: string;
  docSubtotals?: FixtureDocSubtotal[];
  taxExclusiveAmount?: string;
  payableAmount?: string;
};

const tag = (name: string, value: string | undefined, attrs = ''): string =>
  value == null ? '' : `<${name}${attrs ? ' ' + attrs : ''}>${value}</${name}>`;

const renderDocSubtotal = (st: FixtureDocSubtotal): string => `
    <cac:TaxSubtotal>
      ${tag('cbc:TaxableAmount', st.taxableAmount, 'currencyID="TRY"')}
      ${tag('cbc:TaxAmount', st.taxAmount, 'currencyID="TRY"')}
      ${tag('cbc:Percent', st.percent)}
      <cac:TaxCategory>
        ${tag('cbc:TaxExemptionReasonCode', st.exemptionReasonCode)}
        <cac:TaxScheme>
          ${tag('cbc:Name', st.schemeName ?? 'KDV')}
          <cbc:TaxTypeCode>0015</cbc:TaxTypeCode>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`;

const renderLine = (line: FixtureLine, index: number): string => {
  const hasLineTax = line.taxableAmount != null || line.percent != null || line.taxAmount != null;
  return `
  <cac:InvoiceLine>
    ${tag('cbc:ID', line.id ?? String(index + 1))}
    <cbc:InvoicedQuantity unitCode="C62">1.000</cbc:InvoicedQuantity>
    ${tag('cbc:LineExtensionAmount', line.lineExtensionAmount, 'currencyID="TRY"')}
    ${
      hasLineTax
        ? `<cac:TaxTotal>
      ${tag('cbc:TaxAmount', line.taxAmount, 'currencyID="TRY"')}
      <cac:TaxSubtotal>
        ${tag('cbc:TaxableAmount', line.taxableAmount, 'currencyID="TRY"')}
        ${tag('cbc:TaxAmount', line.taxAmount, 'currencyID="TRY"')}
        ${tag('cbc:Percent', line.percent)}
        <cac:TaxCategory>
          <cac:TaxScheme>
            ${tag('cbc:Name', line.schemeName ?? 'KDV')}
            <cbc:TaxTypeCode>0015</cbc:TaxTypeCode>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>`
        : ''
    }
    <cac:Item>
      ${tag('cbc:Description', line.description)}
      ${tag('cbc:Name', line.itemName)}
      ${line.buyersItemId != null ? `<cac:BuyersItemIdentification><cbc:ID schemeID="">${line.buyersItemId}</cbc:ID></cac:BuyersItemIdentification>` : ''}
      ${line.sellersItemId != null ? `<cac:SellersItemIdentification><cbc:ID schemeID="">${line.sellersItemId}</cbc:ID></cac:SellersItemIdentification>` : ''}
      ${line.manufacturersItemId != null ? `<cac:ManufacturersItemIdentification><cbc:ID schemeID="">${line.manufacturersItemId}</cbc:ID></cac:ManufacturersItemIdentification>` : ''}
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="TRY">${line.lineExtensionAmount ?? '0.00'}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`;
};

export const buildInvoiceXml = (spec: FixtureSpec): string => `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>TST2026000000001</cbc:ID>
  <cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
  ${
    spec.docTaxAmount != null
      ? `<cac:TaxTotal>
    ${tag('cbc:TaxAmount', spec.docTaxAmount, 'currencyID="TRY"')}
    ${(spec.docSubtotals ?? []).map(renderDocSubtotal).join('')}
  </cac:TaxTotal>`
      : ''
  }
  <cac:LegalMonetaryTotal>
    ${tag('cbc:TaxExclusiveAmount', spec.taxExclusiveAmount, 'currencyID="TRY"')}
    ${tag('cbc:PayableAmount', spec.payableAmount, 'currencyID="TRY"')}
  </cac:LegalMonetaryTotal>
  ${spec.lines.map(renderLine).join('')}
</Invoice>`;

export const parseInvoice = (xml: string): Document => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(`Fixture XML failed to parse: ${err.textContent}`);
  return doc;
};

/**
 * The "Flormar sample": real-world invoice whose document TaxSubtotal
 * TaxableAmount contains the tax-INCLUSIVE total (2970.00 = 2475 + 495)
 * instead of the KDV base (2475.00). Trailing spaces and the
 * hybrid-diacritics scheme name ("KATMA DEĞER VERGISI") are preserved
 * from the original document on purpose.
 */
export const FLORMAR_SPEC: FixtureSpec = {
  lines: [
    {
      id: '1',
      lineExtensionAmount: '2475.00',
      taxableAmount: '2475.00',
      percent: '20',
      taxAmount: '495.00',
      schemeName: 'KDV',
      itemName: 'STAY PERFECT LCN NEW-010 TOFFEE',
      buyersItemId: '8682536085625',
      sellersItemId: '31000263-010',
      manufacturersItemId: '8682536085625',
    },
  ],
  docTaxAmount: '495.00 ',
  docSubtotals: [
    { taxableAmount: '2970.00 ', taxAmount: '495.00 ', percent: '20.00', schemeName: 'KATMA DEĞER VERGISI' },
  ],
  taxExclusiveAmount: '2475.00 ',
  payableAmount: '2970.00 ',
};

/** Arithmetically consistent single-line invoice. */
export const CLEAN_SPEC: FixtureSpec = {
  lines: [
    {
      id: '1',
      lineExtensionAmount: '5025.00',
      taxableAmount: '5025.00',
      percent: '18',
      taxAmount: '904.50',
      schemeName: 'KDV',
      itemName: 'ÖRNEK ÜRÜN',
      buyersItemId: 'B000TEST01',
    },
  ],
  docTaxAmount: '904.50',
  docSubtotals: [{ taxableAmount: '5025.00', taxAmount: '904.50', percent: '18', schemeName: 'KDV' }],
  taxExclusiveAmount: '5025.00',
  payableAmount: '5929.50',
};

/**
 * Two document subtotals in the same tax group (KDV 20%) carrying different
 * exemption reason codes (335 vs 350) — the split-exemption hard failure.
 * Line data matches the aggregated subtotal so everything else reconciles.
 */
export const SPLIT_EXEMPTION_SPEC: FixtureSpec = {
  lines: [
    { id: '1', lineExtensionAmount: '600.00', taxableAmount: '600.00', percent: '20', taxAmount: '120.00', schemeName: 'KDV', itemName: 'ÜRÜN A' },
    { id: '2', lineExtensionAmount: '400.00', taxableAmount: '400.00', percent: '20', taxAmount: '80.00', schemeName: 'KDV', itemName: 'ÜRÜN B' },
  ],
  docTaxAmount: '200.00',
  docSubtotals: [
    { taxableAmount: '600.00', taxAmount: '120.00', percent: '20', schemeName: 'KDV', exemptionReasonCode: '335' },
    { taxableAmount: '400.00', taxAmount: '80.00', percent: '20', schemeName: 'KDV', exemptionReasonCode: '350' },
  ],
  taxExclusiveAmount: '1000.00',
  payableAmount: '1200.00',
};

/** Line 2 has no tax block at all → four MISSING_* candidates on rate/amounts. */
export const MISSING_FIELDS_SPEC: FixtureSpec = {
  lines: [
    { id: '1', lineExtensionAmount: '100.00', taxableAmount: '100.00', percent: '20', taxAmount: '20.00', schemeName: 'KDV', itemName: 'TAM ÜRÜN' },
    { id: '2', lineExtensionAmount: '50.00', itemName: 'EKSİK ÜRÜN' },
  ],
  docTaxAmount: '20.00',
  docSubtotals: [{ taxableAmount: '100.00', taxAmount: '20.00', percent: '20', schemeName: 'KDV' }],
  taxExclusiveAmount: '150.00',
  payableAmount: '170.00',
};
