import DOMPurify from 'dompurify';
import type { XMLToExcelConverter } from '../../../invoice-parsing/utils/xmlParser';

export type DFAsinError = {
  type: 'missing' | 'invalid';
  itemName: string;
  invalidValue?: string;
  sellersItemId: string;
  manufacturersItemId: string;
};

export type DFAsinValidationOutput = {
  errors: DFAsinError[];
  asinMessages: string[];
};

const NOT_FOUND = 'Bulunamadı';
const sanitize = (v: string) => DOMPurify.sanitize(v ?? '');

const normalizeId = (v: string) => (v ?? '').trim();

const isValidStandardAsinOrIsbn10 = (v: string): boolean => {
  const s = normalizeId(v);
  if (s.length !== 10) return false;

  const isIsbn10 = /^\d{9}[\dX]$/.test(s);
  const isB10 = /^B[a-zA-Z0-9]{9}$/.test(s);

  return isB10 || isIsbn10;
};

const evalString = (xmlDoc: Document, node: Node, xpath: string): string => {
  const out = xmlDoc.evaluate(xpath, node, null, XPathResult.STRING_TYPE, null).stringValue;
  const trimmed = (out ?? '').trim();
  return trimmed || NOT_FOUND;
};

export const validateDFAsins = (
  xmlDoc: Document,
  _converter: XMLToExcelConverter // kept to avoid changing callers; underscore prevents unused-param build errors
): DFAsinValidationOutput => {
  const messages: string[] = [];
  const errors: DFAsinError[] = [];

  const invoiceLines = xmlDoc.evaluate(
    '//*[local-name()="InvoiceLine"]',
    xmlDoc,
    null,
    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
    null
  );

  for (let i = 0; i < invoiceLines.snapshotLength; i++) {
    const lineNode = invoiceLines.snapshotItem(i);
    if (!lineNode) continue;

    const itemName = evalString(xmlDoc, lineNode, './/*[local-name()="Item"]/*[local-name()="Name"]');
    const sellersItemId = evalString(
      xmlDoc,
      lineNode,
      './/*[local-name()="SellersItemIdentification"]/*[local-name()="ID"]'
    );
    const manufacturersItemId = evalString(
      xmlDoc,
      lineNode,
      './/*[local-name()="ManufacturersItemIdentification"]/*[local-name()="ID"]'
    );

    const buyerItemNode = xmlDoc.evaluate(
      './/*[local-name()="BuyersItemIdentification"]/*[local-name()="ID"]',
      lineNode,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    ).singleNodeValue;

    if (!buyerItemNode) {
      errors.push({ type: 'missing', itemName, sellersItemId, manufacturersItemId });
      continue;
    }

    const buyersId = normalizeId(buyerItemNode.textContent ?? '');
    if (!buyersId || !isValidStandardAsinOrIsbn10(buyersId)) {
      errors.push({
        type: 'invalid',
        itemName,
        invalidValue: buyersId || NOT_FOUND,
        sellersItemId,
        manufacturersItemId
      });
    }
  }

  // Build messages
  const missingASINs = errors.filter((e) => e.type === 'missing');
  const invalidASINs = errors.filter((e) => e.type === 'invalid');

  if (missingASINs.length > 0) {
    messages.push(
      `<h3 style="color:#d32f2f;margin-top:20px;">ASIN Eksik:</h3>`,
      `<p>Aşağıdaki satırlarda <code>BuyersItemIdentification</code> &lt;cbc:ID&gt; alanı bulunamadı:</p>`,
      `<table style="border-collapse:collapse;width:100%;text-align:left;margin:8px 0;">`,
      `<thead><tr style="background:#f5f5f5;">`,
      `<th style="padding:8px;border:1px solid #e0e0e0;">Ürün Adı (cbc:Name)</th>`,
      `<th style="padding:8px;border:1px solid #e0e0e0;">Seller's Item ID</th>`,
      `<th style="padding:8px;border:1px solid #e0e0e0;">Manufacturer's Item ID</th>`,
      `</tr></thead><tbody>`,
      ...missingASINs.map(
        (e) =>
          `<tr><td style="padding:6px 8px;border:1px solid #e0e0e0;">${sanitize(e.itemName)}</td><td style="padding:6px 8px;border:1px solid #e0e0e0;">${sanitize(
            e.sellersItemId
          )}</td><td style="padding:6px 8px;border:1px solid #e0e0e0;">${sanitize(e.manufacturersItemId)}</td></tr>`
      ),
      `</tbody></table>`,
      `<p>Lütfen bu satırlara geçerli bir ASIN kodunu <code>BuyersItemIdentification</code> içinde ekleyiniz.</p>`,
      `<pre style="background:#f5f5f5;padding:10px;border-radius:5px;overflow-x:auto;"><code>&lt;cac:Item&gt;
  &lt;cbc:Name&gt;ÜRÜN ADI&lt;/cbc:Name&gt;
  &lt;cac:BuyersItemIdentification&gt;
    &lt;cbc:ID&gt;<strong>B0XXXXXXXXX</strong>&lt;/cbc:ID&gt;
  &lt;/cac:BuyersItemIdentification&gt;
&lt;/cac:Item&gt;</code></pre>`
    );
  }

  if (invalidASINs.length > 0) {
    messages.push(
      `<h3 style="color:#d32f2f;margin-top:20px;">Geçersiz ASIN Kodu:</h3>`,
      `<p>Aşağıdaki ürünler için ASIN kodları geçerli değildir:</p>`,
      `<table style="border-collapse:collapse;width:100%;text-align:left;margin:8px 0;">`,
      `<thead><tr style="background:#f5f5f5;">`,
      `<th style="padding:8px;border:1px solid #e0e0e0;">Ürün Adı</th>`,
      `<th style="padding:8px;border:1px solid #e0e0e0;">Girilen Değer</th>`,
      `<th style="padding:8px;border:1px solid #e0e0e0;">Seller's Item ID</th>`,
      `<th style="padding:8px;border:1px solid #e0e0e0;">Manufacturer's Item ID</th>`,
      `</tr></thead><tbody>`,
      ...invalidASINs.map(
        (e) =>
          `<tr><td style="padding:6px 8px;border:1px solid #e0e0e0;">${sanitize(e.itemName)}</td><td style="padding:6px 8px;border:1px solid #e0e0e0;color:#d32f2f;font-weight:bold;">${sanitize(
            e.invalidValue ?? ''
          )}</td><td style="padding:6px 8px;border:1px solid #e0e0e0;">${sanitize(e.sellersItemId)}</td><td style="padding:6px 8px;border:1px solid #e0e0e0;">${sanitize(
            e.manufacturersItemId
          )}</td></tr>`
      ),
      `</tbody></table>`,
      `<p>ASIN 10 karakter uzunluğunda olmalı ve "B" harfiyle başlamalı veya 10 haneli bir ISBN kodu olmalıdır.</p>`,
      `<div style="background:#fff7ed;padding:10px;border:1px solid #fed7aa;border-radius:6px;margin-top:8px;">`,
      `<p style="margin:0;"><strong>⚠️ Not:</strong> Drop Ship faturalarında <strong>IPV/IQV IADE</strong> formatı geçerli değildir. Yalnızca standart ASIN veya ISBN-10 kabul edilir.</p>`,
      `</div>`
    );
  }

  return { errors, asinMessages: messages };
};
