/**
 * Supplier (AccountingSupplierParty) mandatory-details validator.
 *
 * Amazon's receiving system requires the supplier party to carry a complete
 * identity block. A field counts as VALID when the element exists and has a
 * non-empty text value; missing elements, self-closing tags and
 * whitespace-only values all count as MISSING. Missing fields lead to
 * invoice rejection, so the vendor is asked to compare the invoice against
 * the company details incorporated in Vendor Central.
 *
 * Mandatory fields (under AccountingSupplierParty/Party):
 *   - PartyIdentification/ID          (at least one with a value, e.g. VKN)
 *   - PartyName/Name
 *   - PostalAddress/StreetName
 *   - PostalAddress/CitySubdivisionName
 *   - PostalAddress/CityName
 *   - PostalAddress/PostalZone
 *   - PostalAddress/Country/Name
 *
 * NOTE: PostalAddress/Country/IdentificationCode is deliberately NOT
 * checked — production invoices without it pass Amazon's validation.
 *   - PartyTaxScheme/TaxScheme/Name   (tax office)
 *
 * Split like the tax validator: checkSupplierDetails (pure, testable logic)
 * → validateSupplierDetails (HTML card for InvoiceControl; [] = valid).
 */
import type { XMLToExcelConverter } from '../../../invoice-parsing/utils/xmlParser';
import { evalSingleText } from './tax/extraction';

const PARTY_BASE = '//*[local-name(.)="AccountingSupplierParty"]/*[local-name(.)="Party"]';

type MandatoryField = {
  key: string;
  /** Turkish label shown to the vendor. */
  label: string;
  /** XML tag path shown to the vendor for traceability. */
  xmlTag: string;
  /** XPath relative to the document (single-value fields). */
  xpath: string;
};

const MANDATORY_FIELDS: MandatoryField[] = [
  {
    key: 'partyName',
    label: 'Şirket Adı',
    xmlTag: 'PartyName/Name',
    xpath: `string(${PARTY_BASE}/*[local-name(.)="PartyName"]/*[local-name(.)="Name"][1])`,
  },
  {
    key: 'streetName',
    label: 'Adres (Cadde/Sokak)',
    xmlTag: 'PostalAddress/StreetName',
    xpath: `string(${PARTY_BASE}/*[local-name(.)="PostalAddress"]/*[local-name(.)="StreetName"][1])`,
  },
  {
    key: 'citySubdivisionName',
    label: 'İlçe',
    xmlTag: 'PostalAddress/CitySubdivisionName',
    xpath: `string(${PARTY_BASE}/*[local-name(.)="PostalAddress"]/*[local-name(.)="CitySubdivisionName"][1])`,
  },
  {
    key: 'cityName',
    label: 'Şehir',
    xmlTag: 'PostalAddress/CityName',
    xpath: `string(${PARTY_BASE}/*[local-name(.)="PostalAddress"]/*[local-name(.)="CityName"][1])`,
  },
  {
    key: 'postalZone',
    label: 'Posta Kodu',
    xmlTag: 'PostalAddress/PostalZone',
    xpath: `string(${PARTY_BASE}/*[local-name(.)="PostalAddress"]/*[local-name(.)="PostalZone"][1])`,
  },
  {
    key: 'countryName',
    label: 'Ülke Adı',
    xmlTag: 'PostalAddress/Country/Name',
    xpath: `string(${PARTY_BASE}/*[local-name(.)="PostalAddress"]/*[local-name(.)="Country"]/*[local-name(.)="Name"][1])`,
  },
  {
    key: 'taxSchemeName',
    label: 'Vergi Dairesi',
    xmlTag: 'PartyTaxScheme/TaxScheme/Name',
    xpath: `string(${PARTY_BASE}/*[local-name(.)="PartyTaxScheme"]/*[local-name(.)="TaxScheme"]/*[local-name(.)="Name"][1])`,
  },
];

export type SupplierFieldResult = {
  key: string;
  label: string;
  xmlTag: string;
  /** Trimmed value read from the XML; null when absent/empty/self-closing. */
  value: string | null;
  valid: boolean;
};

export type SupplierDetailsResult = {
  /** False when the AccountingSupplierParty/Party block is absent entirely. */
  partyFound: boolean;
  fields: SupplierFieldResult[];
  missing: SupplierFieldResult[];
};

/** All PartyIdentification/ID values with their schemeID, e.g. "9130026051 (VKN)". */
const readPartyIdentifications = (xmlDoc: Document): string[] => {
  const out: string[] = [];
  try {
    const snapshot = xmlDoc.evaluate(
      `${PARTY_BASE}/*[local-name(.)="PartyIdentification"]/*[local-name(.)="ID"]`,
      xmlDoc,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null
    );
    for (let i = 0; i < snapshot.snapshotLength; i++) {
      const node = snapshot.snapshotItem(i) as Element | null;
      const text = node?.textContent?.trim();
      if (!text) continue;
      const scheme = node?.getAttribute('schemeID')?.trim();
      out.push(scheme ? `${text} (${scheme})` : text);
    }
  } catch {
    /* treated as missing */
  }
  return out;
};

/** Pure check: reads every mandatory field and reports which are missing. */
export const checkSupplierDetails = (xmlDoc: Document, converter: XMLToExcelConverter): SupplierDetailsResult => {
  const partyFound =
    xmlDoc.evaluate(`count(${PARTY_BASE})`, xmlDoc, null, XPathResult.NUMBER_TYPE, null).numberValue > 0;

  const identifications = readPartyIdentifications(xmlDoc);
  const idField: SupplierFieldResult = {
    key: 'partyIdentification',
    label: 'Vergi/Kimlik Numarası',
    xmlTag: 'PartyIdentification/ID',
    value: identifications.length > 0 ? identifications.join(', ') : null,
    valid: identifications.length > 0,
  };

  const fields: SupplierFieldResult[] = [
    idField,
    ...MANDATORY_FIELDS.map((f) => {
      const value = evalSingleText(converter, xmlDoc, f.xpath);
      return { key: f.key, label: f.label, xmlTag: f.xmlTag, value, valid: value != null };
    }),
  ];

  return { partyFound, fields, missing: fields.filter((f) => !f.valid) };
};

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Renders the vendor-facing card when mandatory supplier fields are missing.
 * Returns [] when everything is present (invoice unaffected).
 */
export const validateSupplierDetails = (xmlDoc: Document, converter: XMLToExcelConverter): string[] => {
  const result = checkSupplierDetails(xmlDoc, converter);
  if (result.partyFound && result.missing.length === 0) return [];

  const rows = result.fields
    .map((f) => {
      const status = f.valid
        ? escapeHtml(f.value ?? '')
        : '<span class="hd-diff-cell">EKSİK</span>';
      return `<tr><td>${escapeHtml(f.label)}</td><td><code>${escapeHtml(f.xmlTag)}</code></td><td>${status}</td></tr>`;
    })
    .join('');

  const intro = result.partyFound
    ? `Faturanızın tedarikçi bölümünde (<code>AccountingSupplierParty</code>) zorunlu alanlardan bazıları eksik veya boş. Bu alanların eksikliği faturanızın <strong>reddedilmesine</strong> yol açar.`
    : `Faturanızda tedarikçi bölümü (<code>AccountingSupplierParty</code>) bulunamadı. Bu bölümün eksikliği faturanızın <strong>reddedilmesine</strong> yol açar.`;

  return [
    [
      `<div class="hd-card hd-findings-warning">`,
      `<div class="hd-card-header">`,
      `<span class="hd-findings-title">⚠️ <strong>Tedarikçi Bilgileri Eksik (AccountingSupplierParty)</strong></span>`,
      `<span class="hd-card-header-meta"><span class="hd-chip hd-chip-warning">UYARI</span> <span class="hd-findings-count">${result.missing.length} eksik alan</span></span>`,
      `</div>`,
      `<div class="hd-card-body">`,
      `<p class="hd-findings-explanation">${intro}</p>`,
      `<table class="hd-findings-table">`,
      `<thead><tr><th>Alan</th><th>XML Etiketi</th><th>Değer</th></tr></thead>`,
      `<tbody>${rows}</tbody>`,
      `</table>`,
      `<p class="hd-findings-fix"><strong>Çözüm:</strong> Şirket bilgilerinizi Vendor Central'da kayıtlı (incorporated) şirket detaylarınızla karşılaştırın ve eksik alanları e-fatura şablonunuzda tamamlayın. Alanlar boş veya kendinden kapanan (self-closing) etiket olarak gönderilmemelidir.</p>`,
      `</div>`,
      `</div>`,
    ].join(''),
  ];
};
