
import DOMPurify from 'dompurify';
import { XMLToExcelConverter } from '../../../invoice-parsing/utils/xmlParser';


type FieldCheck = {
  label: string;
  xpath: string;
  value: string;
  present: boolean;
};

export type SupplierValidationResult = {
  isValid: boolean;
  fields: FieldCheck[];
  supplierMessages: string[];
};


const sanitize = (v: string) => DOMPurify.sanitize(v ?? '');
const SUPPLIER_BASE = '//*[local-name()="AccountingSupplierParty"]/*[local-name()="Party"]';

const REQUIRED_FIELDS: Array<{ label: string; xpath: string }> = [
  {
    label: 'Tedarikçi VKN/TCKN',
    xpath: `${SUPPLIER_BASE}/*[local-name()="PartyIdentification"]/*[local-name()="ID"]`,
  },
  {
    label: 'Tedarikçi Şirket Adı (PartyName)',
    xpath: `${SUPPLIER_BASE}/*[local-name()="PartyName"]/*[local-name()="Name"]`,
  },
  {
    label: 'Adres (StreetName)',
    xpath: `${SUPPLIER_BASE}/*[local-name()="PostalAddress"]/*[local-name()="StreetName"]`,
  },
  {
    label: 'İlçe (CitySubdivisionName)',
    xpath: `${SUPPLIER_BASE}/*[local-name()="PostalAddress"]/*[local-name()="CitySubdivisionName"]`,
  },
  {
    label: 'Şehir (CityName)',
    xpath: `${SUPPLIER_BASE}/*[local-name()="PostalAddress"]/*[local-name()="CityName"]`,
  },
  {
    label: 'Ülke (Country/Name)',
    xpath: `${SUPPLIER_BASE}/*[local-name()="PostalAddress"]/*[local-name()="Country"]/*[local-name()="Name"]`,
  },
  {
    label: 'Vergi Dairesi (TaxScheme/Name)',
    xpath: `${SUPPLIER_BASE}/*[local-name()="PartyTaxScheme"]/*[local-name()="TaxScheme"]/*[local-name()="Name"]`,
  },
];

const extractText = (xmlDoc: Document, xpath: string): string => {
  try {
    const result = xmlDoc.evaluate(xpath, xmlDoc, null, XPathResult.STRING_TYPE, null);
    return (result.stringValue ?? '').trim();
  } catch {
    return '';
  }
};


export const validateSupplierParty = (
  xmlDoc: Document,
  _converter: XMLToExcelConverter
): SupplierValidationResult => {
  const messages: string[] = [];
  const fields: FieldCheck[] = [];
  const missingFields: FieldCheck[] = [];

  for (const def of REQUIRED_FIELDS) {
    const value = extractText(xmlDoc, def.xpath);
    const present = value.length > 0;
    const check: FieldCheck = { label: def.label, xpath: def.xpath, value, present };
    fields.push(check);
    if (!present) missingFields.push(check);
  }

  const isValid = missingFields.length === 0;

  if (isValid) {
    
    const idField = fields.find((f) => f.label.includes('VKN'));
    const nameField = fields.find((f) => f.label.includes('PartyName'));
    const taxOffice = fields.find((f) => f.label.includes('Vergi Dairesi'));

    messages.push(
      `<div style="background:#e8f5e9;padding:12px;border-radius:8px;border-left:5px solid #4caf50;margin:12px 0;">`,
      `<p style="color:#1b5e20;margin:0;">✅ <strong>Tedarikçi Bilgileri Tam:</strong> ` +
        `${sanitize(nameField?.value ?? '')} — ${sanitize(idField?.value ?? '')} — ${sanitize(taxOffice?.value ?? '')}</p>`,
      `</div>`
    );
  } else {
    messages.push(
      `<div style="background:#ffebee;padding:14px;border-radius:8px;border-left:5px solid #d32f2f;margin:12px 0;">`,
      `<p style="color:#d32f2f;margin:0 0 8px 0;"><strong>⚠️ Tedarikçi (AccountingSupplierParty) Bilgileri Eksik</strong></p>`,
      `<p style="color:#34495e;margin:0 0 8px 0;">Amazon sistemi faturayı işlemek için aşağıdaki alanların dolu olmasını beklemektedir. Eksik alanlar eşleşme hatasına neden olabilir.</p>`
    );

    messages.push(
      `<table style="width:100%;border-collapse:collapse;margin:8px 0;">`,
      `<thead><tr style="background:#f5f5f5;">`,
      `<th style="text-align:left;padding:8px;border:1px solid #e0e0e0;">Alan</th>`,
      `<th style="text-align:left;padding:8px;border:1px solid #e0e0e0;">Durum</th>`,
      `</tr></thead><tbody>`
    );

    for (const f of fields) {
      const icon = f.present ? '✅' : '❌';
      const color = f.present ? '#1b5e20' : '#d32f2f';
      const display = f.present ? sanitize(f.value) : '<em style="color:#d32f2f;">Eksik / Boş</em>';
      messages.push(
        `<tr>`,
        `<td style="padding:6px 8px;border:1px solid #e0e0e0;">${icon} ${sanitize(f.label)}</td>`,
        `<td style="padding:6px 8px;border:1px solid #e0e0e0;color:${color};">${display}</td>`,
        `</tr>`
      );
    }

    messages.push(`</tbody></table>`);

    messages.push(
      `<div style="margin-top:10px;padding:10px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;">`,
      `<p style="margin:0 0 8px 0;"><strong>📋 Doğru XML örneği:</strong></p>`,
      `<pre style="margin:0;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:10px;overflow:auto;font-size:12px;"><code>&lt;cac:AccountingSupplierParty&gt;
  &lt;cac:Party&gt;
    &lt;cac:PartyIdentification&gt;
      &lt;cbc:ID schemeID="VKN"&gt;<strong>1234567890</strong>&lt;/cbc:ID&gt;
    &lt;/cac:PartyIdentification&gt;
    &lt;cac:PartyName&gt;
      &lt;cbc:Name&gt;<strong>Şirket Adınız</strong>&lt;/cbc:Name&gt;
    &lt;/cac:PartyName&gt;
    &lt;cac:PostalAddress&gt;
      &lt;cbc:StreetName&gt;<strong>Adresiniz</strong>&lt;/cbc:StreetName&gt;
      &lt;cbc:CitySubdivisionName&gt;<strong>İlçe</strong>&lt;/cbc:CitySubdivisionName&gt;
      &lt;cbc:CityName&gt;<strong>Şehir</strong>&lt;/cbc:CityName&gt;
      &lt;cac:Country&gt;
        &lt;cbc:Name&gt;<strong>Türkiye</strong>&lt;/cbc:Name&gt;
      &lt;/cac:Country&gt;
    &lt;/cac:PostalAddress&gt;
    &lt;cac:PartyTaxScheme&gt;
      &lt;cac:TaxScheme&gt;
        &lt;cbc:Name&gt;<strong>Vergi Dairesi Adı</strong>&lt;/cbc:Name&gt;
      &lt;/cac:TaxScheme&gt;
    &lt;/cac:PartyTaxScheme&gt;
  &lt;/cac:Party&gt;
&lt;/cac:AccountingSupplierParty&gt;</code></pre>`,
      `</div>`
    );

    messages.push(`</div>`);
  }

  return { isValid, fields, supplierMessages: messages };
};