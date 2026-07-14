import DOMPurify from 'dompurify';
import { XMLToExcelConverter } from '../../../invoice-parsing/utils/xmlParser';

export type DFHeaderResult = {
  invoiceNo: string;
  invoiceTypeCode: string;
  musterino: string;
  vkn: string;
  tckn: string;
  supplierName: string;
  headerMessages: string[];
};

const NOT_FOUND = 'Unknown';
const sanitize = (v: string) => DOMPurify.sanitize(v ?? '');
const normalizeNo = (v: string) => (v ?? '').trim().replace(/\s+/g, ''); // trims + removes inner whitespace

const DF_REQUIRED_MUSTERINO = '310';

/**
 * Namespace URIs (fallbacks for UBL).
 * In many UBL/TR e-Fatura XMLs, these prefixes are declared at the root element.
 */
const UBL_CAC_NS = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';
const UBL_CBC_NS = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';

const createNsResolver = (doc: Document) => {
  return (prefix: string | null): string | null => {
    if (!prefix) return null;
    // Prefer namespaces declared in the document
    const fromDoc = doc.documentElement?.lookupNamespaceURI(prefix);
    if (fromDoc) return fromDoc;

    // Fallback to known UBL namespaces
    if (prefix === 'cac') return UBL_CAC_NS;
    if (prefix === 'cbc') return UBL_CBC_NS;
    return null;
  };
};

/**
 * Extract MUSTERINO ONLY from the exact precedent location:
 * /cac:AccountingCustomerParty/cac:Party/cac:PartyIdentification/cbc:ID[@schemeID="MUSTERINO"]
 *
 * - Does NOT look under cac:AgentParty or anywhere else.
 * - Returns null if not found in this exact path.
 */
const extractMusterinoFromAccountingCustomerParty = (
  xmlDoc: Document
): { value: string | null; count: number } => {
  const nsResolver = createNsResolver(xmlDoc);

  const xpath =
    "//cac:AccountingCustomerParty" +
    "/cac:Party" +
    "/cac:PartyIdentification" +
    "/cbc:ID[@schemeID='MUSTERINO']";

  const result = xmlDoc.evaluate(
    xpath,
    xmlDoc,
    nsResolver,
    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
    null
  );

  const count = result.snapshotLength;
  if (count === 0) return { value: null, count: 0 };

  const firstNode = result.snapshotItem(0);
  const raw = firstNode?.textContent ?? '';
  const cleaned = normalizeNo(raw);

  return { value: cleaned || null, count };
};

const musterinoPlacementHtml = `
<div style="margin-top:10px;padding:10px;background-color:var(--hd-warning-bg);border:1px solid var(--hd-warning-border);border-radius:6px;">
  <p style="margin:0 0 8px 0;"><strong>✅ MUSTERINO alanı XML'de aşağıdaki şekilde yer almalıdır:</strong></p>
  <pre style="margin:0;background:var(--hd-surface);border:1px solid var(--hd-border);border-radius:8px;padding:10px;overflow:auto;"><code>&lt;cac:PartyIdentification&gt;
  &lt;cbc:ID schemeID="MUSTERINO"&gt;310&lt;/cbc:ID&gt;
&lt;/cac:PartyIdentification&gt;</code></pre>
  <p style="margin:8px 0 0 0;color:var(--hd-text-muted);">
    Not: Drop Ship (DF) faturaları için MUSTERINO değeri mutlaka <strong>310</strong> olmalıdır.
  </p>
</div>`;

const musterinoGuideHtml = `
<div style="margin-top:10px;padding:10px;background-color:var(--hd-surface-2);border:1px solid var(--hd-border);border-radius:6px;">
  <p style="margin:0 0 8px 0;">
    <strong>📌 MUSTERINO nedir?</strong>
    MUSTERINO, Amazon'un farklı birimleri için kullandığı özel bir müşteri kodudur. Bu kod, faturanızın doğru ekibe yönlendirilmesini sağlar.
  </p>
  <ul style="margin:0;padding-left:18px;">
    <li style="margin:6px 0;">
      <strong>310 (Amazon DF / Drop Ship)</strong><br/>
      <span style="color:var(--hd-text);">
        Drop Ship faturaları için kullanılır. Bu tür faturalar <strong>Drop Ship ID</strong> üzerinden ilerler.
        DF faturalarında iade (IPV/IQV) senaryosu bulunmamaktadır.
      </span>
    </li>
  </ul>
  <p style="margin:10px 0 0 0;color:var(--hd-text-muted);">
    Not: PO bazlı faturalar (210) veya AR süreçleri (220) için bu Drop Ship aracı geçerli değildir.
  </p>
</div>
${musterinoPlacementHtml}`;

export const validateDFInvoiceHeader = (
  xmlDoc: Document,
  converter: XMLToExcelConverter
): DFHeaderResult => {
  const invoiceNo = converter.extractFieldByKey(xmlDoc, 'doc_invoice_id');
  const invoiceTypeCode = converter.extractFieldByKey(xmlDoc, 'invoice_type_code');

  // ✅ MUSTERINO is extracted ONLY from the required precedent location
  const musterinoExtract = extractMusterinoFromAccountingCustomerParty(xmlDoc);
  const musterino = musterinoExtract.value ?? NOT_FOUND;

  const vkn = converter.extractFieldByKey(xmlDoc, 'VKN');
  const tckn = converter.extractFieldByKey(xmlDoc, 'TCKN');
  const supplierName = converter.extractFieldByKey(xmlDoc, 'supplier_name');

  const messages: string[] = [];

  const invoiceNoLabel =
    invoiceNo === NOT_FOUND ? '<em>(Fatura numarası bulunamadı)</em>' : `<strong>${sanitize(invoiceNo)}</strong>`;
  const invoiceTypeLabel =
    invoiceTypeCode === NOT_FOUND ? '<em>(Fatura tipi bulunamadı)</em>' : `<strong>${sanitize(invoiceTypeCode)}</strong>`;

  let idFragment = '';
  if (vkn && vkn !== NOT_FOUND) {
    idFragment = `<strong>${sanitize(vkn)}</strong> (VKN)`;
  } else if (tckn && tckn !== NOT_FOUND) {
    idFragment = `<strong>${sanitize(tckn)}</strong> (TCKN)`;
  }

  const supplierFragment =
    supplierName && supplierName !== NOT_FOUND ? ` <strong>${sanitize(supplierName)}</strong> şirkete ait` : '';

  const idLine = idFragment ? `${idFragment},${supplierFragment}` : '';

  messages.push('<p>Merhaba Değerli Tedarikçimiz,</p>');
  messages.push(
    `<p>Yüklemiş olduğunuz ${idLine} ${invoiceNoLabel} numaralı ve ${invoiceTypeLabel} türündeki Drop Ship faturanız incelenmiştir. Aşağıda kontrol sonuçlarını bulabilirsiniz.</p>`
  );

  if (invoiceTypeCode !== NOT_FOUND) {
    const upperType = invoiceTypeCode.toLocaleUpperCase('tr-TR').trim();
    if (upperType === 'IADE' || upperType === 'IRSALIYE') {
      messages.push(
        `<div style="background:var(--hd-danger-bg);padding:12px;border-radius:8px;border-left:5px solid var(--hd-danger-border);margin:12px 0;">`,
        `<p style="color:var(--hd-danger-text);margin:0;"><strong>⚠️ Drop Ship faturalarında IADE (IPV/IQV) senaryosu bulunmamaktadır.</strong></p>`,
        `<p style="margin:6px 0 0 0;">Fatura türü <strong>${sanitize(invoiceTypeCode)}</strong> olarak belirtilmiş. Drop Ship faturaları yalnızca <strong>SATIS</strong> türünde olmalıdır.</p>`,
        `</div>`
      );
    }
  }

  /* ── MUSTERINO check (STRICT location + STRICT value) ── */
  if (musterino === NOT_FOUND || !musterino) {
    messages.push(
      `<div style="background:var(--hd-danger-bg);padding:12px;border-radius:8px;border-left:5px solid var(--hd-danger-border);margin:12px 0;">`,
      `<p style="color:var(--hd-danger-text);margin:0;"><strong>⚠️ MUSTERINO (Müşteri No) alanı bulunamadı veya boş.</strong></p>`,
      `<p style="margin:6px 0 0 0;">MUSTERINO, yalnızca <strong>cac:AccountingCustomerParty/cac:Party/cac:PartyIdentification</strong> altında yer almalı ve <strong>310</strong> olmalıdır.</p>`,
      `</div>`
    );
    messages.push(musterinoGuideHtml);

    return { invoiceNo, invoiceTypeCode, musterino, vkn, tckn, supplierName, headerMessages: messages };
  }

  // Optional: warn if multiple nodes exist in the required path (still only checks this path)
  if (musterinoExtract.count > 1) {
    messages.push(
      `<div style="background:var(--hd-warning-bg);padding:12px;border-radius:8px;border-left:5px solid var(--hd-warning-border);margin:12px 0;">`,
      `<p style="margin:0;"><strong>⚠️ MUSTERINO alanı birden fazla kez bulunmuştur (${musterinoExtract.count}).</strong></p>`,
      `<p style="margin:6px 0 0 0;">Doğrulama için ilk değer dikkate alındı: <strong>${sanitize(musterino)}</strong></p>`,
      `</div>`
    );
  }

  messages.push(
    `<p style="margin-top:12px;"><strong>📌 MUSTERINO (Müşteri No):</strong> <strong>${sanitize(musterino)}</strong></p>`
  );

  if (musterino === DF_REQUIRED_MUSTERINO) {
    messages.push(
      `<div style="background:var(--hd-success-bg);padding:12px;border-radius:8px;border-left:5px solid var(--hd-success-border);margin:8px 0;">`,
      `<p style="color:var(--hd-success-text);margin:0;">✅ MUSTERINO değeri <strong>310</strong>. Drop Ship (DF) faturaları için doğru.</p>`,
      `</div>`
    );
  } else {
    messages.push(
      `<div style="background:var(--hd-danger-bg);padding:12px;border-radius:8px;border-left:5px solid var(--hd-danger-border);margin:8px 0;">`,
      `<p style="color:var(--hd-danger-text);margin:0;"><strong>⚠️ MUSTERINO değeri Drop Ship faturaları için geçersiz.</strong></p>`,
      `<p style="margin:6px 0 0 0;">Mevcut değer: <strong>${sanitize(musterino)}</strong>. Drop Ship faturalarında MUSTERINO mutlaka <strong>310</strong> olmalıdır.</p>`,
      `</div>`
    );
    messages.push(musterinoGuideHtml);
  }

  return { invoiceNo, invoiceTypeCode, musterino, vkn, tckn, supplierName, headerMessages: messages };
};
