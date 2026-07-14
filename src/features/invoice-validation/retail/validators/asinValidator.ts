import DOMPurify from 'dompurify';
import { XMLToExcelConverter } from '../../../invoice-parsing/utils/xmlParser';

interface AsinError {
  type: 'missing' | 'invalid';
  itemName: string;
  invalidValue?: string;
  sellersItemId: string;
  manufacturersItemId: string;
}

const NOT_FOUND = 'Bulunamadı';

const normalizeId = (v: string) => v.trim();

const isValidStandardAsinOrIsbn10 = (v: string) => {
  const s = normalizeId(v);
  const isIsbn10 = /^\d{9}[\dX]$/.test(s);
  const isB10 = s.length === 10 && /^B[a-zA-Z0-9]{9}$/.test(s);
  return isB10 || isIsbn10;
};

const isValidIpvIqvIade = (v: string) => {
  const s = normalizeId(v);
  return /^(IPV|IQV)\d{13}\sIADE$/.test(s);
};

const safeText = (v: string) => DOMPurify.sanitize(v ?? '');

const isValidAmazonPO = (po: string) => /^[A-Za-z0-9]{8}$/.test((po ?? '').trim());

const renderMissingTable = (rows: AsinError[]) => `
<table>
  <thead>
    <tr>
      <th>Ürün Adı (cbc:Name)</th>
      <th>Seller's Item Identification</th>
      <th>Manufacturers Item Identification</th>
    </tr>
  </thead>
  <tbody>
    ${rows
      .map(
        (err) => `
      <tr>
        <td>${safeText(err.itemName)}</td>
        <td>${safeText(err.sellersItemId)}</td>
        <td>${safeText(err.manufacturersItemId)}</td>
      </tr>
    `
      )
      .join('')}
  </tbody>
</table>
`;

const renderInvalidTable = (rows: AsinError[]) => `
<table>
  <thead>
    <tr>
      <th>Ürün Adı (cbc:Name)</th>
      <th>ASIN yerine girilen değer</th>
      <th>Seller's Item Identification</th>
      <th>Manufacturers Item Identification</th>
    </tr>
  </thead>
  <tbody>
    ${rows
      .map(
        (err) => `
      <tr>
        <td>${safeText(err.itemName)}</td>
        <td>${safeText(err.invalidValue ?? '')}</td>
        <td>${safeText(err.sellersItemId)}</td>
        <td>${safeText(err.manufacturersItemId)}</td>
      </tr>
    `
      )
      .join('')}
  </tbody>
</table>
`;

const renderItemXmlExample = () => `
<pre><code>&lt;cac:Item&gt;
  &lt;cbc:Name&gt;ÜRÜNÜNÜZÜN ADI&lt;/cbc:Name&gt; &lt;!-- Ürün adı --&gt;
  &lt;cac:BuyersItemIdentification&gt;
    &lt;cbc:ID&gt;ASIN&lt;/cbc:ID&gt; &lt;!-- Ürününüzün ASIN kodu --&gt;
  &lt;/cac:BuyersItemIdentification&gt;
  &lt;cac:SellersItemIdentification&gt;
    &lt;cbc:ID&gt;EAN Kodu&lt;/cbc:ID&gt; &lt;!-- EAN Kodu --&gt;
  &lt;/cac:SellersItemIdentification&gt;
  &lt;cac:ManufacturersItemIdentification&gt;
    &lt;cbc:ID&gt;Stock Kodu&lt;/cbc:ID&gt; &lt;!-- Stock Kodu --&gt;
  &lt;/cac:ManufacturersItemIdentification&gt;
&lt;/cac:Item&gt;</code></pre>
`;

const renderIpvIqvIadeExamples = () => `
<p>Eğer Amazon'un fiyat farkı ve eksik miktar faturalarına ("IPV" veya "IQV" ile başlayan) karşı iade faturası düzenliyorsanız, belirtilen kodun yer aldığı XML satırına "IPV" veya "IQV" ile başlayan fatura numarası, boşluk ve "IADE" yazmanız gerekmektedir.</p>
<p>Örnekler:</p>
<pre><code>&lt;cac:BuyersItemIdentification&gt;
  &lt;cbc:ID&gt;IPV2023000001439 IADE&lt;/cbc:ID&gt;
&lt;/cac:BuyersItemIdentification&gt;</code></pre>
<pre><code>&lt;cac:BuyersItemIdentification&gt;
  &lt;cbc:ID&gt;IQV2023000001439 IADE&lt;/cbc:ID&gt;
&lt;/cac:BuyersItemIdentification&gt;</code></pre>
`;

export const performSATISValidations = (
  xmlDoc: Document,
  messageParts: string[],
  converter: XMLToExcelConverter,
  opts?: { orderReference?: string; isValidPO?: boolean }
): boolean => {
  let hasErrors = false;

  // Extract order reference — prefer opts, fall back to XML
  const poFromOpts = (opts?.orderReference ?? '').trim();
  const poFromXml = poFromOpts
    ? ''
    : (converter.evaluateSingle(xmlDoc, '//*[local-name()="OrderReference"]/*[local-name()="ID"]') ?? '').trim();
  const orderReference = poFromOpts || poFromXml || undefined;

  const hasValidPO =
    typeof opts?.isValidPO === 'boolean'
      ? opts.isValidPO
      : orderReference
        ? isValidAmazonPO(orderReference)
        : false;

  const invoiceLineNodes = converter.getNodesByXPath(xmlDoc, '//*[local-name()="InvoiceLine"]');
  const asinErrors: AsinError[] = [];

  if (invoiceLineNodes.length === 0) {
    hasErrors = true;
    messageParts.push(
      '<h3>Faturanızda Hiç Ürün Satırı(BuyersItemIdentification) Bulunamadı:</h3>',
      '<p>Faturanızda <code>InvoiceLine</code> elemanları bulunamadı. Lütfen faturanıza ürün satırları ekleyiniz.</p>'
    );
    return hasErrors;
  }

  let buyersItemFoundCount = 0;

  for (const lineNode of invoiceLineNodes) {
    const itemNameRes = converter.extractFieldResult(lineNode, 'item_name');
    const itemName = itemNameRes.found && itemNameRes.value ? itemNameRes.value : 'Bilinmeyen Ürün';

    const buyersRes = converter.extractFieldResult(lineNode, 'BuyersItemIdentification');
    const sellersRes = converter.extractFieldResult(lineNode, 'sellers_item_identification');
    const manufRes = converter.extractFieldResult(lineNode, 'manufacturers_item_identification');

    const sellersItemId = sellersRes.found && sellersRes.value ? sellersRes.value : NOT_FOUND;
    const manufacturersItemId = manufRes.found && manufRes.value ? manufRes.value : NOT_FOUND;

    if (!buyersRes.found) {
      hasErrors = true;
      asinErrors.push({
        type: 'missing',
        itemName,
        sellersItemId,
        manufacturersItemId,
      });
      continue;
    }

    buyersItemFoundCount += 1;

    const buyersId = buyersRes.value || NOT_FOUND;
    const isValid =
      buyersId !== NOT_FOUND &&
      (isValidStandardAsinOrIsbn10(buyersId) || isValidIpvIqvIade(buyersId));

    if (!isValid) {
      hasErrors = true;
      asinErrors.push({
        type: 'invalid',
        itemName,
        invalidValue: buyersId,
        sellersItemId,
        manufacturersItemId,
      });
    }
  }

  if (asinErrors.length === 0) return hasErrors;

  const missingASINs = asinErrors.filter((e) => e.type === 'missing');
  const invalidASINs = asinErrors.filter((e) => e.type === 'invalid');

  const showIadeHint = buyersItemFoundCount === 0;

  if (missingASINs.length > 0) {
    messageParts.push(
      '<h3>ASIN Eksik:</h3>',
      '<p>Aşağıdaki ürünlerinizin yer aldığı satırlarda <code>BuyersItemIdentification</code> alanı bulunamadı:</p>',
      renderMissingTable(missingASINs),
      '<p><strong>Çözüm:</strong></p>',
      '<p>Ürün kodu olarak ASIN veya EAN kodunun tüm ürünleriniz için BuyersItemIdentification veya SellersItemIdentification satırına yazılması gerekmektedir.</p>',
      '<p>Faturalandırdığınız <strong>tüm ürün satırları</strong> için ürün kodu olarak <code>BuyersItemIdentification</code> alanına geçerli bir <strong>ASIN</strong> girilmelidir. Lütfen her <code>BuyersItemIdentification</code> satırında ASIN kodu bulunduğunu ve doğru doldurulduğunu kontrol ediniz.</p>',
      '<p><strong>Sipariş Emri (PO) ve ASIN kodlarını bulmak için:</strong> Vendor Central &gt; Siparişler &gt; Sipariş Emirleri</p>',
      '<p>Aşağıda <code>BuyersItemIdentification</code> satırının XML formatındaki örneği verilmiştir:</p>',
      renderItemXmlExample()
    );

    if (showIadeHint) {
      messageParts.push(renderIpvIqvIadeExamples());
    }
  }

  if (invalidASINs.length > 0) {
    messageParts.push(
      '<h3>Geçersiz ASIN Kodu:</h3>',
      '<p>Aşağıdaki ürünler için ASIN kodları geçerli değildir:</p>',
      renderInvalidTable(invalidASINs),
      '<p>ASIN genel olarak 10 karakter uzunluğunda olmalı ve alfanumerik ASIN\'ler "B" harfiyle başlamalıdır. ISBN-10 formatıyla eşleşen kitap ASIN\'leri ise yalnızca rakamlardan veya rakam-harf kombinasyonlarından oluşabilir.</p>',
      '<div style="margin: 16px 0 !important; padding: 16px !important; background-color: var(--hd-warning-bg) !important; border-left: 4px solid var(--hd-warning-border) !important; border-radius: 4px !important;">'
    );

    if (hasValidPO && orderReference) {
      const poLink = `https://procurementportal-eu.corp.amazon.com/bp/po?poId=${encodeURIComponent(
        orderReference
      )}&tabId=items`;

      messageParts.push(
        '<p style="margin: 0 0 12px 0 !important;"><strong>⚠️ Önemli:</strong> Lütfen faturanızın aşağıdaki PO\'ya göre düzenlendiğini kontrol edin:</p>',
        `<p style="margin: 0 0 12px 0 !important;">📋 <a href="${poLink}" target="_blank" rel="noopener noreferrer" style="color: var(--hd-link) !important; text-decoration: underline !important;">PO Detaylarını Görüntüle (PO: ${safeText(
          orderReference
        )})</a></p>`,
        '<p style="margin: 0 0 8px 0 !important; color: var(--hd-warning-text) !important;">Amazon, PO\'daki (Satın Alma Siparişi) ürünlerle faturadaki ürünlerin ASIN bazında %100 eşleşmesini beklemektedir. Tarafınızdan yüklenen faturada ASIN alanlarına girilen kodlar geçerli bir ASIN kodu olmadığından, lütfen PO\'da hangi ASIN kodlarının yer aldığını kontrol ve teyit ediniz ve tedarikçiden fatura "BuyersItemIdentification" satırlarına ASIN kodlarını girmesini talep ediniz.</p>',
        '<p style="margin: 0 !important; color: var(--hd-warning-text) !important;">Eşleşmeyen ürünler PQV (Purchase Quantity Variation) oluşturur ve bu durum fatura ödeme gecikmelerine neden olabilir.</p>'
      );
    } else {
      messageParts.push(
        '<p style="margin: 0 0 12px 0 !important;"><strong>⚠️ Önemli:</strong> Faturanızda PO (Sipariş Numarası) bulunamadığı veya geçerli formatta olmadığı için ASIN kodlarını PO ile doğrulayamıyoruz.</p>',
        '<p style="margin: 0 0 8px 0 !important; color: var(--hd-warning-text) !important;">Amazon, PO\'daki (Satın Alma Siparişi) ürünlerle faturadaki ürünlerin ASIN bazında %100 eşleşmesini beklemektedir. Öncelikle faturanıza geçerli bir PO numarası eklemeniz gerekmektedir. Ardından, PO\'da hangi ASIN kodlarının yer aldığını kontrol edip, tedarikçiden fatura "BuyersItemIdentification" satırlarına doğru ASIN kodlarını girmesini talep ediniz.</p>',
        '<p style="margin: 0 !important; color: var(--hd-warning-text) !important;">Eşleşmeyen ürünler PQV (Purchase Quantity Variation) oluşturur ve bu durum fatura ödeme gecikmelerine neden olabilir.</p>'
      );
    }

    messageParts.push('</div>', '<p><strong>Örnek:</strong></p>', renderItemXmlExample());
  }

  return hasErrors;
};

export const validateAsinDetails = performSATISValidations;