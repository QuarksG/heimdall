
import DOMPurify from 'dompurify';
import { XMLToExcelConverter } from '../../../invoice-parsing/utils/xmlParser';

export type DFPOError = {
  lineId: string;
  po: string;
  errorType: 'missing' | 'length' | 'format' | 'start';
};

export type DFPOValidationResult = {
  lineId: string;
  orderReference: string;
  isValid: boolean;
};

export type DFPOValidationOutput = {
  results: DFPOValidationResult[];
  errors: DFPOError[];
  poMessages: string[];
};

const NOT_FOUND = 'Bulunamadı';
const sanitize = (v: string) => DOMPurify.sanitize(v ?? '');
const nsResolver = XMLToExcelConverter.namespaceResolver;

const DF_CHECK_BASE =
  'https://eu.central.df.amazon.dev/orders?lucky=1&dir=DESCENDING&sort=shipmentsWithIssue&search=';

// Example valid PO (9 chars, starts with letter, alphanumeric; any case allowed)
const PO_EXAMPLE = 'Tc9FmDQcB';

const isAlphanumeric = (v: string) => /^[A-Za-z0-9]+$/.test(v);
const startsWithLetter = (v: string) => /^[A-Za-z]/.test(v);

export const validateDFPurchaseOrders = (
  xmlDoc: Document,
  _converter: XMLToExcelConverter
): DFPOValidationOutput => {
  const messages: string[] = [];
  const results: DFPOValidationResult[] = [];
  const errors: DFPOError[] = [];

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

    const lineId =
      xmlDoc
        .evaluate('.//*[local-name()="ID"]', lineNode, nsResolver, XPathResult.STRING_TYPE, null)
        .stringValue.trim() || `${i + 1}`;

    const orderReference =
      xmlDoc
        .evaluate(
          './/*[local-name()="OrderLineReference"]/*[local-name()="OrderReference"]/*[local-name()="ID"]',
          lineNode,
          nsResolver,
          XPathResult.STRING_TYPE,
          null
        )
        .stringValue.trim() || NOT_FOUND;

    // ---- VALIDATION (NEW RULES) ----
    if (orderReference === NOT_FOUND || !orderReference) {
      errors.push({ lineId, po: orderReference, errorType: 'missing' });
      results.push({ lineId, orderReference, isValid: false });
      continue;
    }

    if (orderReference.length !== 9) {
      errors.push({ lineId, po: orderReference, errorType: 'length' });
      results.push({ lineId, orderReference, isValid: false });
      continue;
    }

    if (!isAlphanumeric(orderReference)) {
      errors.push({ lineId, po: orderReference, errorType: 'format' });
      results.push({ lineId, orderReference, isValid: false });
      continue;
    }

    if (!startsWithLetter(orderReference)) {
      errors.push({ lineId, po: orderReference, errorType: 'start' });
      results.push({ lineId, orderReference, isValid: false });
      continue;
    }

    results.push({ lineId, orderReference, isValid: true });
  }

  // ---- Messages ----
  // If there are validation errors, show detailed guidance
  if (errors.length > 0) {
    messages.push(
      `<h3 style="color:var(--hd-danger-text);padding:10px;background-color:var(--hd-danger-bg);border-radius:8px;border-left:5px solid var(--hd-danger-border);margin-top:20px;">`,
      `⚠️ Amazon DF PO (Purchase Order) Numarası Hataları`,
      `</h3>`,
      `<div style="margin:10px 0;padding:10px;background:var(--hd-warning-bg);border:1px solid var(--hd-warning-border);border-radius:8px;">`,
      `<p style="margin:0;"><strong>PO Kuralı:</strong> PO tam <strong>9</strong> karakter olmalı, sadece <strong>harf/rakam</strong> içermeli ve <strong>harfle başlamalıdır</strong>. Büyük/küçük harf fark etmez.</p>`,
      `<p style="margin:6px 0 0 0;">✅ Örnek doğru PO: <code style="background:var(--hd-success-bg);padding:2px 6px;border-radius:3px;">${PO_EXAMPLE}</code></p>`,
      `</div>`
    );

    for (const err of errors) {
      if (err.errorType === 'missing') {
        messages.push(
          `<div style="background-color:var(--hd-danger-bg);padding:15px;border-radius:5px;border-left:4px solid var(--hd-danger-border);margin:10px 0;">`,
          `<h4 style="color:var(--hd-danger-text);margin-top:0;">❌ Satır ${sanitize(err.lineId)}: PO Numarası Bulunamadı</h4>`,
          `<p><strong>Amazon sipariş numarası (PO) eksik!</strong> Her fatura satırında mutlaka bir PO numarası bulunmalıdır.</p>`,
          `<p>PO numarası aşağıdaki XML yolunda olmalıdır:</p>`,
          `<pre style="background:var(--hd-surface);padding:10px;border-radius:5px;overflow-x:auto;"><code>&lt;cac:InvoiceLine&gt;
  ...
    &lt;cac:OrderLineReference&gt;
      &lt;cac:OrderReference&gt;
        &lt;cbc:ID&gt;<span style="background-color:var(--hd-success-border);color:white;padding:2px 6px;border-radius:3px;">${PO_EXAMPLE}</span>&lt;/cbc:ID&gt;
      &lt;/cac:OrderReference&gt;
    &lt;/cac:OrderLineReference&gt;
  ...
&lt;/cac:InvoiceLine&gt;</code></pre>`,
          `</div>`
        );
      } else if (err.errorType === 'length') {
        messages.push(
          `<div style="background-color:var(--hd-warning-bg);padding:15px;border-radius:5px;border-left:4px solid var(--hd-warning-border);margin:10px 0;">`,
          `<h4 style="color:var(--hd-warning-text);margin-top:0;">⚠️ Satır ${sanitize(err.lineId)}: PO Uzunluk Hatası</h4>`,
          `<p>Girilen PO: <code style="background:var(--hd-danger-bg);padding:3px 8px;border-radius:3px;color:var(--hd-danger-text);font-weight:bold;">${sanitize(err.po)}</code> (${err.po.length} karakter)</p>`,
          `<p><strong>Dropship PO numarası tam 9 karakter olmalıdır.</strong></p>`,
          `<p>✅ Örnek: <code style="background:var(--hd-success-bg);padding:3px 8px;border-radius:3px;color:var(--hd-success-text);font-weight:bold;">${PO_EXAMPLE}</code></p>`,
          `</div>`
        );
      } else if (err.errorType === 'format') {
        messages.push(
          `<div style="background-color:var(--hd-danger-bg);padding:15px;border-radius:5px;border-left:4px solid var(--hd-danger-border);margin:10px 0;">`,
          `<h4 style="color:var(--hd-danger-text);margin-top:0;">❌ Satır ${sanitize(err.lineId)}: PO Format Hatası</h4>`,
          `<p>Girilen PO: <code style="background:var(--hd-danger-bg);padding:3px 8px;border-radius:3px;color:var(--hd-danger-text);font-weight:bold;">${sanitize(err.po)}</code></p>`,
          `<p><strong>PO sadece harf ve rakamlardan oluşmalıdır.</strong> Boşluk/özel karakter içermemelidir.</p>`,
          `</div>`
        );
      } else if (err.errorType === 'start') {
        messages.push(
          `<div style="background-color:var(--hd-danger-bg);padding:15px;border-radius:5px;border-left:4px solid var(--hd-danger-border);margin:10px 0;">`,
          `<h4 style="color:var(--hd-danger-text);margin-top:0;">❌ Satır ${sanitize(err.lineId)}: PO Harfle Başlamalı</h4>`,
          `<p>Girilen PO: <code style="background:var(--hd-danger-bg);padding:3px 8px;border-radius:3px;color:var(--hd-danger-text);font-weight:bold;">${sanitize(err.po)}</code></p>`,
          `<p><strong>PO numarası mutlaka bir harf ile başlamalıdır.</strong></p>`,
          `<p>✅ Örnek: <code style="background:var(--hd-success-bg);padding:3px 8px;border-radius:3px;color:var(--hd-success-text);font-weight:bold;">${PO_EXAMPLE}</code></p>`,
          `</div>`
        );
      }
    }
  } else {
    // No structural errors — optional positive message (kept minimal)
    const validPOs = results.filter((r) => r.isValid);
    if (validPOs.length > 0) {
      messages.push(
        `<div style="background:var(--hd-success-bg);padding:12px;border-radius:8px;border-left:5px solid var(--hd-success-border);margin:12px 0;">`,
        `<p style="color:var(--hd-success-text);margin:0;"><strong>✅ PO Numaraları Format Olarak Doğru:</strong> PO'lar 9 karakter, harfle başlıyor ve alfanümerik.</p>`,
        `</div>`
      );
    }
  }

  // ✅ ALWAYS include “Kontrol Et” links (even if everything is valid)
  const linksBlock = buildDFPOCheckLinks(results);
  if (linksBlock) {
    messages.push(linksBlock);
  }

  return { results, errors, poMessages: messages };
};

export const buildDFPOCheckLinks = (results: DFPOValidationResult[]): string => {
  const candidates = results
    .map((r) => ({
      lineId: r.lineId,
      po: (r.orderReference ?? '').trim()
    }))
    .filter((x) => x.po && x.po !== NOT_FOUND);

  if (candidates.length === 0) return '';

  // Optional: de-dup by PO, keep first occurrence
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    if (seen.has(c.po)) return false;
    seen.add(c.po);
    return true;
  });

  const poLinks = unique
    .map((r) => {
      const poSafe = sanitize(r.po);
      const url = `${DF_CHECK_BASE}${encodeURIComponent(r.po)}`;
      return `<li style="margin:8px 0;">
        <strong>PO:</strong> <code style="background:var(--hd-surface);padding:2px 6px;border-radius:3px;">${poSafe}</code>
        — <a href="${url}" target="_blank" rel="noopener noreferrer" style="color:var(--hd-link);text-decoration:none;font-weight:bold;">🔍 Kontrol Et</a>
      </li>`;
    })
    .join('');

  return `
<div style="background-color:var(--hd-surface);padding:15px;border-radius:8px;border-left:5px solid var(--hd-link);margin:15px 0;">
  <h4 style="color:var(--hd-link);margin-top:0;">🔗 PO Kontrol Linkleri</h4>
  <p style="color:var(--hd-text-muted);font-size:14px;margin:5px 0;">
    Format kontrolü sadece yapıyı doğrular. Şüphe durumunda PO'nun sistemde varlığını aşağıdaki linkten kontrol edebilirsiniz.
  </p>
  <ul style="list-style:none;padding-left:0;margin:10px 0;">${poLinks}</ul>
</div>`;
};
