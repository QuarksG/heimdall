import { describe, it, expect } from 'vitest';
import { XMLToExcelConverter } from '../../../invoice-parsing/utils/xmlParser';
import { checkSupplierDetails, validateSupplierDetails } from './supplierValidator';

const converter = new XMLToExcelConverter();

const wrap = (supplierParty: string): Document => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>TST2026000000001</cbc:ID>
  ${supplierParty}
</Invoice>`;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('fixture XML parse error');
  return doc;
};

/** The user's Unilever sample, completed with Country/IdentificationCode. */
const COMPLETE_SUPPLIER = `
<cac:AccountingSupplierParty>
  <cac:Party>
    <cbc:WebsiteURI>WWW.UNILEVER.COM</cbc:WebsiteURI>
    <cac:PartyIdentification><cbc:ID schemeID="VKN">9130026051</cbc:ID></cac:PartyIdentification>
    <cac:PartyIdentification><cbc:ID schemeID="MUSTERINO">UN4V0</cbc:ID></cac:PartyIdentification>
    <cac:PartyName><cbc:Name>UNILEVER SANAYI VE TICARET TÜRK A.Ş</cbc:Name></cac:PartyName>
    <cac:PostalAddress>
      <cbc:StreetName>SARAY MAH.DR. ADNAN BÜYÜKDENIZ CAD.</cbc:StreetName>
      <cbc:BuildingNumber>13</cbc:BuildingNumber>
      <cbc:CitySubdivisionName>ÜMRANİYE</cbc:CitySubdivisionName>
      <cbc:CityName>İSTANBUL</cbc:CityName>
      <cbc:PostalZone>34768</cbc:PostalZone>
      <cac:Country>
        <cbc:IdentificationCode>TR</cbc:IdentificationCode>
        <cbc:Name>Türkiye</cbc:Name>
      </cac:Country>
    </cac:PostalAddress>
    <cac:PartyTaxScheme><cac:TaxScheme><cbc:Name>BÜYÜK MÜKELLEFLER</cbc:Name></cac:TaxScheme></cac:PartyTaxScheme>
  </cac:Party>
</cac:AccountingSupplierParty>`;

describe('checkSupplierDetails', () => {
  it('reports a complete supplier block as fully valid', () => {
    const result = checkSupplierDetails(wrap(COMPLETE_SUPPLIER), converter);
    expect(result.partyFound).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.fields).toHaveLength(8);
  });

  it('does NOT require Country/IdentificationCode (production invoices pass without it)', () => {
    const withoutCode = COMPLETE_SUPPLIER.replace('<cbc:IdentificationCode>TR</cbc:IdentificationCode>', '');
    const result = checkSupplierDetails(wrap(withoutCode), converter);
    expect(result.missing).toEqual([]);
    expect(validateSupplierDetails(wrap(withoutCode), converter)).toEqual([]);
  });

  it('captures identifications with their schemeID for the audit trail', () => {
    const result = checkSupplierDetails(wrap(COMPLETE_SUPPLIER), converter);
    const id = result.fields.find((f) => f.key === 'partyIdentification')!;
    expect(id.value).toBe('9130026051 (VKN), UN4V0 (MUSTERINO)');
  });

  it('flags a missing tax office name', () => {
    const withoutTaxOffice = COMPLETE_SUPPLIER.replace('<cbc:Name>BÜYÜK MÜKELLEFLER</cbc:Name>', '<cbc:Name/>');
    const result = checkSupplierDetails(wrap(withoutTaxOffice), converter);
    expect(result.missing.map((f) => f.key)).toEqual(['taxSchemeName']);
  });

  it('treats self-closing and whitespace-only tags as missing', () => {
    const degraded = COMPLETE_SUPPLIER
      .replace('<cbc:Name>UNILEVER SANAYI VE TICARET TÜRK A.Ş</cbc:Name>', '<cbc:Name/>')
      .replace('<cbc:PostalZone>34768</cbc:PostalZone>', '<cbc:PostalZone>   </cbc:PostalZone>')
      .replace('<cbc:ID schemeID="VKN">9130026051</cbc:ID>', '<cbc:ID schemeID="VKN"></cbc:ID>')
      .replace('<cbc:ID schemeID="MUSTERINO">UN4V0</cbc:ID>', '<cbc:ID schemeID="MUSTERINO"/>');
    const result = checkSupplierDetails(wrap(degraded), converter);
    expect(result.missing.map((f) => f.key).sort()).toEqual(['partyIdentification', 'partyName', 'postalZone'].sort());
  });

  it('reports everything missing when AccountingSupplierParty is absent', () => {
    const result = checkSupplierDetails(wrap(''), converter);
    expect(result.partyFound).toBe(false);
    expect(result.missing).toHaveLength(8);
  });
});

describe('validateSupplierDetails', () => {
  it('returns [] for a complete supplier block', () => {
    expect(validateSupplierDetails(wrap(COMPLETE_SUPPLIER), converter)).toEqual([]);
  });

  it('renders a warning card listing missing and present fields', () => {
    const withoutTaxOffice = COMPLETE_SUPPLIER.replace('<cbc:Name>BÜYÜK MÜKELLEFLER</cbc:Name>', '<cbc:Name/>');
    const out = validateSupplierDetails(wrap(withoutTaxOffice), converter);
    expect(out).toHaveLength(1);

    const html = out[0];
    expect(html).toContain('Tedarikçi Bilgileri Eksik (AccountingSupplierParty)');
    expect(html).toContain('hd-chip-warning');
    expect(html).toContain('1 eksik alan');
    expect(html).toContain('reddedilmesine');
    expect(html).toContain('Vendor Central');
    // Missing field highlighted, present fields shown with their values.
    expect(html).toContain('Vergi Dairesi');
    expect(html).toContain('<span class="hd-diff-cell">EKSİK</span>');
    expect(html).toContain('9130026051 (VKN), UN4V0 (MUSTERINO)');
    expect(html).toContain('İSTANBUL');
  });

  it('renders the party-missing variant when the block is absent', () => {
    const out = validateSupplierDetails(wrap(''), converter);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('bulunamadı');
    expect(out[0]).toContain('8 eksik alan');
  });
});
