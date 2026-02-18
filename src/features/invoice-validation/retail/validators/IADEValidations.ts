import DOMPurify from 'dompurify';
import type { XMLToExcelConverter } from '../../../invoice-parsing/utils/xmlParser';

export type IADEValidationResult = {
  hasErrors: boolean;
  messages: string[];
};

const IQV_IPV_CODE_REGEX = /(IQV\d{10,13}|IPV\d{10,13})/; // detect even if vendor used 10-12 digits
const NOTE_LINE_REGEX = /^(IQV|IPV)([0-9A-Za-z]+)\s+(\d{6})$/;

const sanitize = (value: string): string => DOMPurify.sanitize(value ?? '');
const normalizeSpaces = (str: string): string => String(str ?? '').replace(/\s+/g, ' ').trim();

const extractAllValues = (
  xmlDoc: Document,
  converter: XMLToExcelConverter,
  xpath: string
): string[] => {
  const converterMethod = (converter as any)?.extractAllValues;
  if (typeof converterMethod === 'function') {
    try {
      const values = converterMethod.call(converter, xmlDoc, xpath);
      if (Array.isArray(values)) {
        return values.map((x: any) => String(x ?? '').trim()).filter(Boolean);
      }
    } catch (error) {
      console.error('Error using converter.extractAllValues:', error);
    }
  }

  const result = xmlDoc.evaluate(xpath, xmlDoc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  const values: string[] = [];
  for (let i = 0; i < result.snapshotLength; i++) {
    const text = result.snapshotItem(i)?.textContent?.trim();
    if (text) values.push(text);
  }
  return values;
};

const validateBuyersItemIdentification = (
  xmlDoc: Document,
  converter: XMLToExcelConverter,
  messages: string[]
): { hasErrors: boolean; buyersItemValid: boolean } => {
  let hasErrors = false;
  let buyersItemValid = true;

  const buyersItemIds = extractAllValues(
    xmlDoc,
    converter,
    '//*[local-name()="BuyersItemIdentification"]/*[local-name()="ID"]'
  );

  if (buyersItemIds.length === 0) {
    hasErrors = true;
    buyersItemValid = false;
    messages.push(
      '<h3>Faturanızda Alıcı Ürün Kimliği (BuyersItemIdentification) Satırı Bulunmuyor:</h3>',
      '<p>IQV veya IPV serili bir faturaya istinaden düzenlenen <strong>KARŞI İADE</strong> faturalarında, <strong>Alıcı Ürün Kimliği (BuyersItemIdentification)</strong> alanı zorunludur.</p>',
      '<p><strong>BuyersItemIdentification</strong> satırına, ilgili Amazon IQV veya IPV serili fatura numarası yazıldıktan sonra bir boşluk bırakılarak <strong>IADE</strong> ifadesi eklenmelidir:</p>',
      '<ul>' +
        '<li><strong>IQV</strong> serili fatura için örnek: <code>IQV2024000008901 IADE</code></li>' +
        '<li><strong>IPV</strong> serili fatura için örnek: <code>IPV2024000008901 IADE</code></li>' +
      '</ul>',
      '<p><strong>Not:</strong> Yalnızca ilgili kodu yazınız; ekstra harf, boşluk veya başka bir bilgi eklemeyiniz.</p>',
      '<p>Aşağıda, bu bilginin faturada nasıl gösterilmesi gerektiğine dair XML örnekleri yer almaktadır. Lütfen faturanıza aşağıdaki örneklerden uygun olanını ekleyiniz:</p>',
      `<pre><code>&lt;cac:BuyersItemIdentification&gt;
  &lt;cbc:ID&gt;IQV2024000008901 IADE&lt;/cbc:ID&gt;
&lt;/cac:BuyersItemIdentification&gt;</code></pre>`,
      `<pre><code>&lt;cac:BuyersItemIdentification&gt;
  &lt;cbc:ID&gt;IPV2024000008901 IADE&lt;/cbc:ID&gt;
&lt;/cac:BuyersItemIdentification&gt;</code></pre>`,
      '<p>Alternatif olarak, iade faturalarında <strong>ASIN</strong> ve BuyersItemIdentification satırını, aynı satış faturalarınızda olduğu gibi (ürün adı, ASIN, EAN vb.) girebilirsiniz. Aşağıda örnek bir XML gösterilmektedir:</p>',
      `<pre><code>&lt;cac:Item&gt;
  &lt;cbc:Name&gt;ÜRÜNÜNüZÜN ADI&lt;/cbc:Name&gt; &lt;!-- Ürün adı --&gt;
  &lt;cac:BuyersItemIdentification&gt;
    &lt;cbc:ID&gt;ASIN&lt;/cbc:ID&gt; &lt;!-- Ürününüzün ASIN kodu --&gt;
  &lt;/cac:BuyersItemIdentification&gt; 
  &lt;cac:SellersItemIdentification&gt;
    &lt;cbc:ID&gt;EAN Kodu&lt;/cbc:ID&gt; &lt;!-- EAN Kodu--&gt;
  &lt;/cac:SellersItemIdentification&gt;
  &lt;cac:ManufacturersItemIdentification&gt;
    &lt;cbc:ID&gt;Stok KODU&lt;/cbc:ID&gt; &lt;!-- Stok Kodu --&gt;
  &lt;/cac:ManufacturersItemIdentification&gt;
&lt;/cac:Item&gt;</code></pre>`
    );
  } else {
    for (const id of buyersItemIds) {
      const trimmedId = normalizeSpaces(id);

      // If vendor used IQV/IPV here, it must end with " IADE"
      if ((trimmedId.startsWith('IQV') || trimmedId.startsWith('IPV')) && !trimmedId.endsWith(' IADE')) {
        hasErrors = true;
        buyersItemValid = false;
        messages.push(
          '<h3>Faturanızda Hatalı IADE Faturası Formatı Tespit Edildi:</h3>',
          '<p>Girdiğiniz Alıcı Ürün Kimliği kodu (<code>BuyersItemIdentification</code>) alanında IQV/IPV serili fatura tespit edildi ancak formatı doğru değil. Bu kodun sonuna " IADE" eklemelisiniz.</p>',
          '<p>Lütfen Alıcı Ürün Kimliği alanına geçerli bir ASIN veya uygun kodu giriniz.</p>',
          '<p>Girdiğiniz değer:</p>',
          `<pre><code>&lt;cac:BuyersItemIdentification&gt;
  &lt;cbc:ID&gt;${sanitize(trimmedId)}&lt;/cbc:ID&gt;
&lt;/cac:BuyersItemIdentification&gt;</code></pre>`
        );
      }
    }
  }

  return { hasErrors, buyersItemValid };
};

const validateItemFieldMisplacement = (
  xmlDoc: Document,
  converter: XMLToExcelConverter,
  buyersItemValid: boolean,
  messages: string[]
): boolean => {
  let hasErrors = false;

  if (!buyersItemValid) {
    const itemNames = extractAllValues(
      xmlDoc,
      converter,
      '//*[local-name()="InvoiceLine"]/*[local-name()="Item"]/*[local-name()="Name"]'
    );

    const itemDescriptions = extractAllValues(
      xmlDoc,
      converter,
      '//*[local-name()="InvoiceLine"]/*[local-name()="Item"]/*[local-name()="Description"]'
    );

    const allItemFields = [...itemNames, ...itemDescriptions];

    for (const field of allItemFields) {
      const iqvCodeMatch = field.match(IQV_IPV_CODE_REGEX);
      if (iqvCodeMatch) {
        hasErrors = true;
        const detectedCode = iqvCodeMatch[0];
        const fieldName = itemNames.includes(field)
          ? 'Ürün Adı (<code>Item Name</code>)'
          : 'Ürün Açıklaması (<code>Item Description</code>)';

        messages.push(
          '<h3>Faturanızda Hatalı IADE Faturası Formatı Tespit Edildi:</h3>',
          `<p>Göndermiş olduğunuz IADE türündeki faturanızda, <strong>${sanitize(
            detectedCode
          )}</strong> kodu yanlışlıkla ${fieldName} alanına yazılmıştır. Bu kodun <code>BuyersItemIdentification</code> satırında yer alması gerekmektedir.</p>`,
          `<p>Lütfen ${fieldName} alanına ürününüzün adını veya açıklamasını giriniz ve <strong>${sanitize(
            detectedCode
          )}</strong> kodunu aşağıdaki gibi <code>BuyersItemIdentification</code> satırına ekleyiniz:</p>`,
          `<pre><code>&lt;cac:BuyersItemIdentification&gt;
  &lt;cbc:ID&gt;${sanitize(detectedCode)} IADE&lt;/cbc:ID&gt;
&lt;/cac:BuyersItemIdentification&gt;</code></pre>`,
          `<p>Girdiğiniz ${fieldName} değeri:</p>`,
          `<pre><code>${sanitize(field)}</code></pre>`
        );
      }
    }
  }

  return hasErrors;
};

const validateNoteFields = (
  xmlDoc: Document,
  converter: XMLToExcelConverter,
  messages: string[]
): boolean => {
  let hasErrors = false;


  let noteErrorFound = false;

  
  let foundValidNote = false;

  const notes = extractAllValues(xmlDoc, converter, '//*[local-name()="Note"]');

  for (const note of notes) {
    const normalized = normalizeSpaces(note);

 
    if (!IQV_IPV_CODE_REGEX.test(normalized)) continue;

    
    const parsed = normalized.match(NOTE_LINE_REGEX);

    if (!parsed) {
      hasErrors = true;
      noteErrorFound = true;

      messages.push(
        '<h3>Düzenlediğiniz İADE Faturasının Not Satırı Hatalıdır:</h3>',
        '<p>IQV veya IPV serili faturalara istinaden düzenlenen <strong>KARŞI İADE</strong> faturalarında, <strong>Not</strong> alanı zorunludur ve aşağıdaki kurala göre doldurulmalıdır.</p>',

        '<p><strong>Doğru format:</strong> <code>[IQV/IPV ile başlayan fatura numarası]</code> + <strong>1 boşluk</strong> + <code>[kod]</code></p>',
        '<p><strong>Kod seçimi (fatura numarasının başlangıcına göre):</strong></p>',
        '<ul>' +
          '<li>Fatura numarası <strong>IQV</strong> ile başlıyorsa kod: <code>202002</code></li>' +
          '<li>Fatura numarası <strong>IPV</strong> ile başlıyorsa kod: <code>202001</code></li>' +
        '</ul>',

        '<p><strong>Örnekler:</strong></p>',
        '<ul>' +
          '<li>IQV için: <code>IQV2024000006247 202002</code></li>' +
          '<li>IPV için: <code>IPV2024000006247 202001</code></li>' +
        '</ul>',

        '<p><strong>XML örnekleri:</strong></p>',
        `<pre><code>&lt;cbc:Note&gt;IQV2024000006247 202002&lt;/cbc:Note&gt;</code></pre>`,
        `<pre><code>&lt;cbc:Note&gt;IPV2024000006247 202001&lt;/cbc:Note&gt;</code></pre>`,

        '<p><strong>Kontrol listesi (göndermeden önce):</strong></p>',
        '<ul>' +
          '<li>Not alanı <strong>tek satır</strong> olmalıdır. Fatura numarası ve kod aynı not satırında birlikte yazılmalıdır.</li>' +
          '<li>Fatura numarası <strong>IQV</strong> veya <strong>IPV</strong> ile başlamalı ve ardından <strong>13 hane</strong> içermelidir.</li>' +
          '<li>Fatura numarasından sonra <strong>yalnızca 1 boşluk</strong> olmalıdır.</li>' +
          '<li>Boşluktan sonra kod <strong>tam olarak</strong> <code>202002</code> (IQV) veya <code>202001</code> (IPV) olmalıdır.</li>' +
          '<li>Ekstra harf, karakter, noktalama veya açıklama eklenmemelidir.</li>' +
        '</ul>',

        '<p><strong>Girdiğiniz not satırı:</strong></p>',
        `<pre><code>&lt;cbc:Note&gt;${sanitize(normalized)}&lt;/cbc:Note&gt;</code></pre>`
      );

      continue;
    }

    const [, prefix, rawNumberToken, code] = parsed;

    const numberToken = normalizeSpaces(rawNumberToken);
    const requiredCode = prefix === 'IQV' ? '202002' : '202001';
    const otherPrefix = prefix === 'IQV' ? 'IPV' : 'IQV';
    const otherCode = prefix === 'IQV' ? '202001' : '202002';


    const issues: string[] = [];

 
    const digitsOnly = /^[0-9]+$/.test(numberToken);
    const digitCount = digitsOnly ? numberToken.length : 0;

    if (!digitsOnly) {
      issues.push(
        `<li><strong>IQV/IPV fatura numarası yalnızca rakamlardan oluşmalıdır.</strong> Mevcut değer: <code>${sanitize(
          numberToken
        )}</code></li>`
      );
    } else if (digitCount !== 13) {
      issues.push(
        `<li><strong>IQV/IPV  ile başlayen fatura numarası, IQV veya IPV serisinden sonra 13 haneli olmalıdır.</strong> Mevcut hane sayısı: <strong>${digitCount}</strong></li>`
      );
    }

    if (code !== requiredCode) {
      issues.push(
        `<li><strong>Not kodu yanlıştır.</strong> Not satırında <strong>${sanitize(
          prefix
        )}</strong> tespit edildi ancak kullanılan kod <strong>${sanitize(
          code
        )}</strong>. <strong>${sanitize(prefix)}</strong> için doğru kod <strong>${requiredCode}</strong> olmalıdır. <strong>${otherCode}</strong> kodu <strong>${otherPrefix}</strong> için kullanılır.</li>`
      );
    }

    if (issues.length === 0) {
      foundValidNote = true;
      continue;
    }

    hasErrors = true;
    noteErrorFound = true;

    const detected = `${prefix}${numberToken}`;

    messages.push(
      '<h3>İade Faturanızda Not Satırı Hatalıdır:</h3>',
      `<p><strong>${sanitize(detected)}</strong> tespit edildi; ancak Not satırı aşağıdaki kurallara uymalıdır:</p>`,
      `<ul>${issues.join('')}</ul>`,
      '<p>Doğru format örnekleri:</p>',
      `<pre><code>&lt;cbc:Note&gt;IQV2024000006247 202002&lt;/cbc:Note&gt;</code></pre>`,
      `<pre><code>&lt;cbc:Note&gt;IPV2024000006247 202001&lt;/cbc:Note&gt;</code></pre>`,
      '<p>Girdiğiniz not satırı:</p>',
      `<pre><code>&lt;cbc:Note&gt;${sanitize(normalized)}&lt;/cbc:Note&gt;</code></pre>`
    );
  }


  if (!noteErrorFound && !foundValidNote) {
    hasErrors = true;
    messages.push(
      '<h3>Düzenlediğiniz İADE Faturasının Not Satırı Hatalıdır:</h3>',
      '<p>IQV veya IPV serili faturalara istinaden düzenlenen <strong>KARŞI İADE</strong> faturalarında, <strong>Not</strong> alanı zorunludur ve aşağıdaki kurala göre doldurulmalıdır.</p>',
      '<p><strong>Doğru format:</strong> <code>[IQV/IPV ile başlayan 16 karakterli fatura no]</code> + <strong>1 boşluk</strong> + <code>[kod]</code></p>',
      '<p><strong>Kod seçimi (fatura numarasının başlangıcına göre):</strong></p>',
      '<ul>' +
        '<li>Fatura numarası <strong>IQV</strong> ile başlıyorsa kod: <code>202002</code></li>' +
        '<li>Fatura numarası <strong>IPV</strong> ile başlıyorsa kod: <code>202001</code></li>' +
      '</ul>',
      '<p><strong>Örnekler:</strong></p>',
      '<ul>' +
        '<li>IQV için: <code>IQV2024000006247 202002</code></li>' +
        '<li>IPV için: <code>IPV2024000006247 202001</code></li>' +
      '</ul>',
      '<p><strong>XML örnekleri:</strong></p>',
      `<pre><code>&lt;cbc:Note&gt;IQV2024000006247 202002&lt;/cbc:Note&gt;</code></pre>`,
      `<pre><code>&lt;cbc:Note&gt;IPV2024000006247 202001&lt;/cbc:Note&gt;</code></pre>`,
      '<p><strong>Kontrol listesi (göndermeden önce):</strong></p>',
      '<ul>' +
        '<li>Not alanı <strong>tek satır</strong> olmalıdır; fatura numarası ve kod <strong>aynı not satırında</strong> birlikte yazılmalıdır.</li>' +
        '<li>Fatura numarası <strong>IQV</strong> veya <strong>IPV</strong> ile başlamalı ve sonrasında <strong>13 hane</strong> olmalıdır.</li>' +
        '<li>Fatura numarasından sonra <strong>yalnızca 1 boşluk</strong> olmalıdır.</li>' +
        '<li>Boşluktan sonra kod <strong>tam olarak</strong> <code>202002</code> veya <code>202001</code> olmalıdır.</li>' +
        '<li>Ekstra harf, karakter veya açıklama eklenmemelidir.</li>' +
      '</ul>'
    );
  }

  return hasErrors;
};

export const performIADEValidations = (
  xmlDoc: Document,
  converter: XMLToExcelConverter
): IADEValidationResult => {
  const messages: string[] = [];
  let hasErrors = false;

  const { hasErrors: buyersItemErrors, buyersItemValid } = validateBuyersItemIdentification(
    xmlDoc,
    converter,
    messages
  );
  hasErrors = hasErrors || buyersItemErrors;

  const misplacementErrors = validateItemFieldMisplacement(
    xmlDoc,
    converter,
    buyersItemValid,
    messages
  );
  hasErrors = hasErrors || misplacementErrors;

  const noteErrors = validateNoteFields(xmlDoc, converter, messages);
  hasErrors = hasErrors || noteErrors;

  return { hasErrors, messages };
};
