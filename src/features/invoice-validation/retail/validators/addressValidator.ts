import DOMPurify from 'dompurify';
import { XMLToExcelConverter } from '../../../invoice-parsing/utils/xmlParser';

type AddressError = {
  message: string;
};

const NOT_FOUND = 'Bulunamadı';

const toFoundValue = (v: string | null | undefined): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s !== 'Unknown' ? s : NOT_FOUND;
};

const extractPreferXPathThenDef = (
  doc: Document,
  converter: XMLToExcelConverter,
  fieldKey: string,
  xpath: string
): string => {
  const fromXPath = toFoundValue(converter.evaluateSingle(doc, xpath));
  if (fromXPath !== NOT_FOUND) return fromXPath;

  const fromDef = converter.extractFieldByKey(doc, fieldKey);
  return fromDef === 'Unknown' ? NOT_FOUND : fromDef;
};


const extractTextByXPath = (
  doc: Document,
  converter: XMLToExcelConverter,
  xpath: string
): string => {
  return toFoundValue(converter.evaluateSingle(doc, xpath));
};

export const validateAmazonAddress = (xmlDoc: Document, converter: XMLToExcelConverter): string[] => {
  const errors: string[] = [];

  const customerPartyPath = '//*[local-name()="AccountingCustomerParty"]/*[local-name()="Party"]';

 
  const addressFields = {
    vkn: extractPreferXPathThenDef(
      xmlDoc,
      converter,
      'customer_id',
      `${customerPartyPath}/*[local-name()="PartyIdentification"]/*[local-name()="ID"][@schemeID="VKN"]`
    ),
    partyName: extractPreferXPathThenDef(
      xmlDoc,
      converter,
      'customer_name',
      `${customerPartyPath}/*[local-name()="PartyName"]/*[local-name()="Name"]`
    ),
    streetName: extractPreferXPathThenDef(
      xmlDoc,
      converter,
      'customer_address',
      `${customerPartyPath}/*[local-name()="PostalAddress"]/*[local-name()="StreetName"]`
    ),
    citySubdivisionName: extractTextByXPath(
      xmlDoc,
      converter,
      `${customerPartyPath}/*[local-name()="PostalAddress"]/*[local-name()="CitySubdivisionName"]`
    ),
    cityName: extractTextByXPath(
      xmlDoc,
      converter,
      `${customerPartyPath}/*[local-name()="PostalAddress"]/*[local-name()="CityName"]`
    ),
    postalZone: extractTextByXPath(
      xmlDoc,
      converter,
      `${customerPartyPath}/*[local-name()="PostalAddress"]/*[local-name()="PostalZone"]`
    ),
    countryCode: extractTextByXPath(
      xmlDoc,
      converter,
      `${customerPartyPath}/*[local-name()="PostalAddress"]/*[local-name()="Country"]/*[local-name()="IdentificationCode"]`
    ),
    countryName: extractTextByXPath(
      xmlDoc,
      converter,
      `${customerPartyPath}/*[local-name()="PostalAddress"]/*[local-name()="Country"]/*[local-name()="Name"]`
    ),
    taxSchemeName: extractPreferXPathThenDef(
      xmlDoc,
      converter,
      'tax_address',
      `${customerPartyPath}/*[local-name()="PartyTaxScheme"]/*[local-name()="TaxScheme"]/*[local-name()="Name"]`
    ),
  };

  const addressErrors: AddressError[] = [];
  const fieldValidations: Record<string, boolean> = {};

  const styleField = (value: string, isValid: boolean, fieldName: string, isCritical = false): string => {
    if (value === NOT_FOUND) {
      return `<span style="background-color: #ffcdd2; color: #b71c1c; padding: 1px 3px; border-radius: 2px; font-weight: bold;">[EKSIK - ${DOMPurify.sanitize(
        fieldName
      )}]</span>`;
    }
    if (!isValid) {
      return `<span style="background-color: #ffcdd2; color: #b71c1c; padding: 1px 3px; border-radius: 2px; ${
        isCritical ? 'font-weight: bold;' : ''
      }">${DOMPurify.sanitize(value)}</span>`;
    }
    return `<span style="background-color: #c8e6c9; color: #1b5e20; padding: 1px 3px; border-radius: 2px;">${DOMPurify.sanitize(
      value
    )}</span>`;
  };

  // 1) VKN (exact)
  fieldValidations.vkn = addressFields.vkn === '0680972288';
  if (!fieldValidations.vkn && addressFields.vkn !== NOT_FOUND) {
    addressErrors.push({
      message: `<li><strong>VKN:</strong> <span style="color: red; background-color: #ffe0e0; padding: 2px 4px; border-radius: 3px;">"${DOMPurify.sanitize(
        addressFields.vkn
      )}"</span> yerine <span style="color: green; background-color: #e0ffe0; padding: 2px 4px; border-radius: 3px; font-weight: bold;">"0680972288"</span> olmalıdır.</li>`,
    });
  }


  const normalizedPartyName = (addressFields.partyName || '')
    .toLocaleUpperCase('tr')
    .replace(/[^A-ZİĞÜŞÇÖ0-9]/g, '');

  const requiredKeywords = ['AMAZON', 'TURKEY', 'PERAKENDE', 'HİZMET'] as const;
  const variations: Record<(typeof requiredKeywords)[number], string[]> = {
    AMAZON: ['AMAZON'],
    TURKEY: ['TURKEY', 'TURKIYE', 'TÜRKİYE'],
    PERAKENDE: ['PERAKENDE'],
    HİZMET: ['HİZMET', 'HIZMET'],
  };

  const hasAllKeywords = requiredKeywords.every((k) => variations[k].some((v) => normalizedPartyName.includes(v)));
  fieldValidations.partyName = hasAllKeywords;

  if (!hasAllKeywords && addressFields.partyName !== NOT_FOUND) {
    const missingKeywords = requiredKeywords.filter((k) => !variations[k].some((v) => normalizedPartyName.includes(v)));
    addressErrors.push({
      message: `<li><strong>Şirket Adı:</strong> <span style="color: red; background-color: #ffe0e0; padding: 2px 4px; border-radius: 3px;">"${DOMPurify.sanitize(
        addressFields.partyName
      )}"</span> içinde eksik kelimeler: <strong>${missingKeywords.join(', ')}</strong></li>`,
    });
  }

  
  const normalizedStreet = (addressFields.streetName || '').toLocaleUpperCase('tr').replace(/[^A-ZİĞÜŞÇÖ0-9]/g, '');
  const streetRequirements = {
    esentepe: normalizedStreet.includes('ESENTEPE'),
    bahar: normalizedStreet.includes('BAHAR'),
    number13: normalizedStreet.includes('13'),
    number52: normalizedStreet.includes('52'),
  };

  const missingStreetParts: string[] = [];
  if (!streetRequirements.esentepe) missingStreetParts.push('Esentepe');
  if (!streetRequirements.bahar) missingStreetParts.push('Bahar');
  if (!streetRequirements.number13 || !streetRequirements.number52) missingStreetParts.push('No: 13/52');

  fieldValidations.streetName = missingStreetParts.length === 0;

  if (missingStreetParts.length > 0 && addressFields.streetName !== NOT_FOUND) {
    addressErrors.push({
      message: `<li><strong>Adres:</strong> <span style="color: red; background-color: #ffe0e0; padding: 2px 4px; border-radius: 3px;">"${DOMPurify.sanitize(
        addressFields.streetName
      )}"</span> içinde şu bilgiler eksik: <strong style="color: darkred;">${missingStreetParts.join(', ')}</strong></li>`,
    });
  }

  
  const normalizedCitySubdivision = (addressFields.citySubdivisionName || '')
    .toLocaleUpperCase('tr')
    .replace(/[^A-ZİĞÜŞÇÖ]/g, '');

  const validCitySubdivisions = ['ŞİŞLİ', 'ŞIŞLI', 'SISLI', 'SİSLİ'];
  fieldValidations.citySubdivisionName =
    addressFields.citySubdivisionName === NOT_FOUND ? false : validCitySubdivisions.includes(normalizedCitySubdivision);

  if (!fieldValidations.citySubdivisionName) {
    const citySubdivisionDisplay =
      addressFields.citySubdivisionName === NOT_FOUND
        ? `<span style="color: red; background-color: #ffe0e0; padding: 2px 4px; border-radius: 3px;">[boş/eksik]</span>`
        : `<span style="color: red; background-color: #ffe0e0; padding: 2px 4px; border-radius: 3px;">"${DOMPurify.sanitize(addressFields.citySubdivisionName)}"</span>`;
    addressErrors.push({
      message: `<li><strong>İlçe:</strong> ${citySubdivisionDisplay} yerine <span style="color: green; background-color: #e0ffe0; padding: 2px 4px; border-radius: 3px;">"Şişli"</span> olmalıdır.</li>`,
    });
  }

 
  const normalizedCityName = (addressFields.cityName || '').toLocaleUpperCase('tr').replace(/[^A-ZİĞÜŞÇÖ]/g, '');
  const validCityNames = ['İSTANBUL', 'ISTANBUL'];
  fieldValidations.cityName = addressFields.cityName === NOT_FOUND ? false : validCityNames.includes(normalizedCityName);

  if (!fieldValidations.cityName && addressFields.cityName !== NOT_FOUND) {
    addressErrors.push({
      message: `<li><strong>Şehir:</strong> <span style="color: red; background-color: #ffe0e0; padding: 2px 4px; border-radius: 3px;">"${DOMPurify.sanitize(
        addressFields.cityName
      )}"</span> yerine <span style="color: green; background-color: #e0ffe0; padding: 2px 4px; border-radius: 3px;">"İstanbul"</span> olmalıdır.</li>`,
    });
  }

  
  const postalZoneRegex = /^34\d{3}$/;
  fieldValidations.postalZone =
    !addressFields.postalZone || addressFields.postalZone === '' || postalZoneRegex.test(addressFields.postalZone);

  if (
    addressFields.postalZone &&
    !postalZoneRegex.test(addressFields.postalZone) &&
    addressFields.postalZone !== '' &&
    addressFields.postalZone !== NOT_FOUND
  ) {
    addressErrors.push({
      message: `<li><strong>Posta Kodu:</strong> <span style="color: red; background-color: #ffe0e0; padding: 2px 4px; border-radius: 3px;">"${DOMPurify.sanitize(
        addressFields.postalZone
      )}"</span> geçerli bir İstanbul posta kodu değil (<span style="color: green; background-color: #e0ffe0; padding: 2px 4px; border-radius: 3px;">34XXX</span> formatında olmalı, örnek: <strong>34394</strong>).</li>`,
    });
  }

  // 7) CountryCode (TR)
  fieldValidations.countryCode = !addressFields.countryCode || addressFields.countryCode.toLocaleUpperCase('tr') === 'TR';
  if (
    addressFields.countryCode &&
    addressFields.countryCode.toLocaleUpperCase('tr') !== 'TR' &&
    addressFields.countryCode !== NOT_FOUND
  ) {
    addressErrors.push({
      message: `<li><strong>Ülke Kodu:</strong> <span style="color: red; background-color: #ffe0e0; padding: 2px 4px; border-radius: 3px;">"${DOMPurify.sanitize(
        addressFields.countryCode
      )}"</span> yerine <span style="color: green; background-color: #e0ffe0; padding: 2px 4px; border-radius: 3px; font-weight: bold;">"TR"</span> olmalıdır.</li>`,
    });
  }

  // 8) CountryName (Türkiye variants)
  const normalizedCountryName = (addressFields.countryName || '').toLocaleUpperCase('tr').replace(/[^A-ZİĞÜŞÇÖ]/g, '');
  const validCountryNames = ['TÜRKİYE', 'TURKIYE', 'TÜRKIYE', 'TURKEY'];

  fieldValidations.countryName =
    addressFields.countryName === NOT_FOUND ? false : validCountryNames.includes(normalizedCountryName);

  if (!fieldValidations.countryName && normalizedCountryName !== 'BULUNAMADI' && addressFields.countryName !== NOT_FOUND) {
    addressErrors.push({
      message: `<li><strong>Ülke Adı:</strong> <span style="color: red; background-color: #ffe0e0; padding: 2px 4px; border-radius: 3px;">"${DOMPurify.sanitize(
        addressFields.countryName
      )}"</span> yerine <span style="color: green; background-color: #e0ffe0; padding: 2px 4px; border-radius: 3px;">"Türkiye"</span> olmalıdır.</li>`,
    });
  }

  // 9) TaxSchemeName (contains Zincirlikuyu)
  const normalizedTaxScheme = (addressFields.taxSchemeName || '').toLocaleUpperCase('tr').replace(/[^A-ZİĞÜŞÇÖ]/g, '');
  const validTaxSchemes = ['ZİNCİRLİKUYU', 'ZINCIRLIKUYU'];

  fieldValidations.taxSchemeName =
    addressFields.taxSchemeName === NOT_FOUND ? false : validTaxSchemes.some((s) => normalizedTaxScheme.includes(s));

  if (!fieldValidations.taxSchemeName && addressFields.taxSchemeName !== NOT_FOUND) {
    addressErrors.push({
      message: `<li><strong>Vergi Dairesi:</strong> <span style="color: red; background-color: #ffe0e0; padding: 2px 4px; border-radius: 3px;">"${DOMPurify.sanitize(
        addressFields.taxSchemeName
      )}"</span> içinde <span style="color: green; background-color: #e0ffe0; padding: 2px 4px; border-radius: 3px;">"Zincirlikuyu"</span> bulunmalıdır.</li>`,
    });
  }

  if (addressErrors.length > 0) {
    const actualXML = `&lt;cac:AccountingCustomerParty&gt;
  &lt;cac:Party&gt;
    &lt;cac:PartyIdentification&gt;
      &lt;cbc:ID schemeID="VKN"&gt;${styleField(addressFields.vkn, fieldValidations.vkn, 'VKN girin', true)}&lt;/cbc:ID&gt;
    &lt;/cac:PartyIdentification&gt;
    &lt;cac:PartyName&gt;
      &lt;cbc:Name&gt;${styleField(addressFields.partyName, fieldValidations.partyName, 'Şirket adı girin')}&lt;/cbc:Name&gt;
    &lt;/cac:PartyName&gt;
    &lt;cac:PostalAddress&gt;
      &lt;cbc:StreetName&gt;${styleField(addressFields.streetName, fieldValidations.streetName, 'Adres girin')}&lt;/cbc:StreetName&gt;
      &lt;cbc:CitySubdivisionName&gt;${styleField(addressFields.citySubdivisionName, fieldValidations.citySubdivisionName, 'İlçe girin')}&lt;/cbc:CitySubdivisionName&gt;
      &lt;cbc:CityName&gt;${styleField(addressFields.cityName, fieldValidations.cityName, 'Şehir girin')}&lt;/cbc:CityName&gt;
      &lt;cbc:PostalZone&gt;${styleField(addressFields.postalZone, fieldValidations.postalZone, 'Posta kodu girin')}&lt;/cbc:PostalZone&gt;
      &lt;cac:Country&gt;
        &lt;cbc:IdentificationCode&gt;${styleField(addressFields.countryCode, fieldValidations.countryCode, 'Ülke kodu girin', true)}&lt;/cbc:IdentificationCode&gt;
        &lt;cbc:Name&gt;${styleField(addressFields.countryName, fieldValidations.countryName, 'Ülke adı girin')}&lt;/cbc:Name&gt;
      &lt;/cac:Country&gt;
    &lt;/cac:PostalAddress&gt;
    &lt;cac:PartyTaxScheme&gt;
      &lt;cac:TaxScheme&gt;
        &lt;cbc:Name&gt;${styleField(addressFields.taxSchemeName, fieldValidations.taxSchemeName, 'Vergi dairesi girin')}&lt;/cbc:Name&gt;
      &lt;/cac:TaxScheme&gt;
    &lt;/cac:PartyTaxScheme&gt;
  &lt;/cac:Party&gt;
&lt;/cac:AccountingCustomerParty&gt;`;

    errors.push(
      '<h3 style="color: #d32f2f;">❌ Amazon Müşteri (AccountingCustomerParty) Bilgileri Hatalı:</h3>',
      "<p>Faturanızda Amazon Turkey'in müşteri bilgileri yanlış girilmiştir. Aşağıdaki düzeltmeleri yapmanız gerekmektedir:</p>",
      '<div style="background-color: #ffebee; padding: 15px; border-radius: 5px; border-left: 4px solid #d32f2f;">',
      '<ul style="margin: 0;">',
      ...addressErrors.map((e) => e.message),
      '</ul>',
      '</div>',
      '<h4 style="color: #d32f2f; margin-top: 20px;">📋 Sizin XML\'inizdeki mevcut bilgiler:</h4>',
      '<div style="background-color: #f5f5f5; padding: 10px; border-radius: 5px; border: 1px solid #e0e0e0;">',
      `<pre style="margin: 0; font-size: 12px;"><code>${actualXML}</code></pre>`,
      '</div>',
      '<h4 style="color: #388e3c; margin-top: 20px;">✅ Doğru Amazon müşteri bilgileri aşağıdaki gibi olmalıdır:</h4>',
      '<div style="background-color: #e8f5e9; padding: 10px; border-radius: 5px; border: 1px solid #81c784;">',
      `<pre style="margin: 0; font-size: 12px;"><code>&lt;cac:AccountingCustomerParty&gt;
  &lt;cac:Party&gt;
    &lt;cac:PartyIdentification&gt;
      &lt;cbc:ID schemeID="VKN"&gt;<span style="background-color: #66bb6a; color: white; padding: 1px 3px; border-radius: 2px; font-weight: bold;">0680972288</span>&lt;/cbc:ID&gt;
    &lt;/cac:PartyIdentification&gt;
    &lt;cac:PartyName&gt;
      &lt;cbc:Name&gt;<span style="background-color: #a5d6a7;">AMAZON TURKEY PERAKENDE HİZMETLERİ LİMİTED ŞİRKETİ</span>&lt;/cbc:Name&gt;
    &lt;/cac:PartyName&gt;
    &lt;cac:PostalAddress&gt;
      &lt;cbc:StreetName&gt;<span style="background-color: #a5d6a7;">Esentepe Mahallesi Bahar Sk. No: 13/52</span>&lt;/cbc:StreetName&gt;
      &lt;cbc:CitySubdivisionName&gt;<span style="background-color: #a5d6a7;">Şişli</span>&lt;/cbc:CitySubdivisionName&gt;
      &lt;cbc:CityName&gt;<span style="background-color: #a5d6a7;">İstanbul</span>&lt;/cbc:CityName&gt;
      &lt;cbc:PostalZone&gt;<span style="background-color: #66bb6a; color: white; padding: 1px 3px; border-radius: 2px; font-weight: bold;">34394</span>&lt;/cbc:PostalZone&gt;
      &lt;cac:Country&gt;
        &lt;cbc:IdentificationCode&gt;<span style="background-color: #66bb6a; color: white; padding: 1px 3px; border-radius: 2px; font-weight: bold;">TR</span>&lt;/cbc:IdentificationCode&gt;
        &lt;cbc:Name&gt;<span style="background-color: #a5d6a7;">Türkiye</span>&lt;/cbc:Name&gt;
      &lt;/cac:Country&gt;
    &lt;/cac:PostalAddress&gt;
    &lt;cac:PartyTaxScheme&gt;
      &lt;cac:TaxScheme&gt;
        &lt;cbc:Name&gt;<span style="background-color: #a5d6a7;">Zincirlikuyu</span>&lt;/cbc:Name&gt;
      &lt;/cac:TaxScheme&gt;
    &lt;/cac:PartyTaxScheme&gt;
  &lt;/cac:Party&gt;
&lt;/cac:AccountingCustomerParty&gt;</code></pre>`,
      '</div>',
      '<div style="margin-top: 15px; padding: 10px; background-color: #fff3cd; border-radius: 5px; border-left: 4px solid #ffc107;">',
      '<p style="margin: 0;"><strong>⚠️ Önemli:</strong> Sarı işaretli alanlar (<span style="background-color: #66bb6a; color: white; padding: 1px 3px; border-radius: 2px;">VKN</span>, <span style="background-color: #66bb6a; color: white; padding: 1px 3px; border-radius: 2px;">Posta Kodu</span>, <span style="background-color: #66bb6a; color: white; padding: 1px 3px; border-radius: 2px;">Ülke Kodu</span>) mutlaka birebir aynı olmalıdır.</p>',
      '</div>'
    );
  }

  return errors;
};
