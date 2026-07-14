import DOMPurify from 'dompurify';
import { XMLToExcelConverter } from '../../../invoice-parsing/utils/xmlParser';

type HeaderValidationResult = {
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
const normalizeNo = (m: string) => m.replace(/\s+/g, '');

const VALID_MUSTERINOS = new Set(['210', '220', '310']);

const resolveMusterino = (raw: string): string | null => {
  const parts = raw.split(',').map((p) => normalizeNo(p.trim()));
  return parts.find((p) => VALID_MUSTERINOS.has(p)) ?? null;
};

const is210 = (m: string) => m === '210';
const is220 = (m: string) => m === '220';
const is310 = (m: string) => m === '310';

const musterinoPlacementHtml = `
  <div style="margin-top: 10px; padding: 10px; background-color: var(--hd-warning-bg); border: 1px solid var(--hd-warning-border); border-radius: 6px;">
    <p style="margin: 0 0 8px 0;"><strong>✅ MUSTERINO alanı XML'de aşağıdaki şekilde yer almalıdır:</strong></p>
    <pre style="margin: 0; background:var(--hd-surface); border:1px solid var(--hd-border); border-radius:8px; padding:10px; overflow:auto;"><code>&lt;cac:PartyIdentification&gt;
  &lt;cbc:ID schemeID="MUSTERINO"&gt;210&lt;/cbc:ID&gt;
&lt;/cac:PartyIdentification&gt;</code></pre>
    <p style="margin: 8px 0 0 0; color:var(--hd-text-muted);">
      Not: Amazon'dan aldığınız yönergeye göre fatura MUSTERINO değeri <strong>210 / 220 / 310</strong> olmalıdır.
    </p>
  </div>
`;

const musterinoGuideHtml = `
  <div style="margin-top: 10px; padding: 10px; background-color: var(--hd-surface-2); border: 1px solid var(--hd-border); border-radius: 6px;">
    <p style="margin: 0 0 8px 0;">
      <strong>📌 MUSTERINO nedir?</strong>
      MUSTERINO, Amazon'un farklı birimleri için kullandığı özel bir müşteri kodudur. Bu kod, faturanızın doğru ekibe yönlendirilmesini sağlar.
      MUSTERINO değeri, XML'de yer alan müşteri numarası alanından alınır ve fatura türüne veya Amazon'dan gelen onaya göre doğru seçilmelidir.
    </p>

    <ul style="margin: 0; padding-left: 18px;">
      <li style="margin: 6px 0;">
        <strong>210 (PO / Purchase Order)</strong>
        <br />
        <span style="color:var(--hd-text);">
          <strong>PO (Toptan Satın Alma Siparişi)</strong> bazlı faturalarda kullanılır.
          Yani tedarikçi, Amazon Retail'den aldığı <strong>PO numarasını</strong> toptan <strong>satış</strong> faturasına giriyorsa MUSTERINO değeri <strong>210</strong> olmalıdır.
          <br /><br />
          Ayrıca <strong>PPV-RI</strong> (PO bazlı fiyat farkı faturaları) kapsamında Amazon'un düzenlediği ve <strong>IPV</strong> ile başlayan faturalara karşı düzenlenen <strong>iade</strong> faturalarında da <strong>210</strong> kullanılmalıdır.
          <br /><br />
          Son olarak <strong>PQV-RI</strong> (PO bazlı eksik miktar faturaları) kapsamında <strong>IQV</strong> ile başlayan faturalara karşı düzenlenen <strong>karşı iade</strong> faturalarında da <strong>210</strong> kullanılmalıdır.
        </span>
      </li>

      <li style="margin: 6px 0;">
        <strong>220 (AR Department / Accounts Receivable)</strong>
        <br />
        <span style="color:var(--hd-text);">
          <strong>AR (Accounts Receivable)</strong> süreçleri için kullanılır.
          Genellikle Amazon'un <strong>"C" ile başlayan ticari iş birliği faturaları</strong> bu kapsamdadır.
          <br /><br />
          Tedarikçi bu tip faturayı kabul etmezse <strong>DSPT</strong> ile başlayan bir itiraz oluşturabilir.
          İtiraz onaylanırsa, düzenlenecek <strong>karşı iade</strong> faturalarında MUSTERINO değerinin <strong>220</strong> olması gerekir.
        </span>
      </li>

      <li style="margin: 6px 0;">
        <strong>310 (Amazon DF / Drop Ship)</strong>
        <br />
        <span style="color:var(--hd-text);">
          <strong>Drop Ship (DF)</strong> faturaları için kullanılır.
          Bu tür faturalar genellikle <strong>Drop Ship ID</strong> üzerinden ilerler ve Amazon'un ilgili departman süreçlerine göre değerlendirilir.
        </span>
      </li>
    </ul>

    <p style="margin: 10px 0 0 0; color:var(--hd-text-muted);">
      Not: Amazon'da sürecin hangi tür faturayı gerektirdiğinden emin değilseniz, faturanın dayanağını kontrol edin:
      <strong>PO</strong> mu, <strong>AR süreci</strong> mi, yoksa <strong>DF (Drop Ship)</strong> mi?
      MUSTERINO'yu buna göre seçin.
    </p>
  </div>

  ${musterinoPlacementHtml}
`;

export const validateInvoiceHeader = (xmlDoc: Document, converter: XMLToExcelConverter): HeaderValidationResult => {
  const invoiceNo = converter.extractFieldByKey(xmlDoc, 'doc_invoice_id');
  const invoiceTypeCode = converter.extractFieldByKey(xmlDoc, 'invoice_type_code');
  const musterino = converter.extractFieldByKey(xmlDoc, 'musterino');
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
    `<p>Yüklemiş olduğunuz ${idLine} ${invoiceNoLabel} numaralı ve ${invoiceTypeLabel} türündeki faturanız incelenmiştir. Aşağıda kontrol sonuçlarını bulabilirsiniz.</p>`
  );

  if (musterino === NOT_FOUND) {
    messages.push(
      `<p style="margin-top: 12px; color:var(--hd-danger-text);"><strong>⚠️ MUSTERINO (Müşteri No) alanı bulunamadı veya boş.</strong></p>`
    );
    messages.push(
      `<p style="margin-top: 6px;">
        Lütfen XML içerisinde <strong>MUSTERINO</strong> alanını doldurarak faturayı tekrar yükleyip kontrol edin.
        Aşağıdaki rehberi kullanarak senaryonuza uygun MUSTERINO değerini seçebilirsiniz:
      </p>`
    );
    messages.push(musterinoGuideHtml);

    return { invoiceNo, invoiceTypeCode, musterino, vkn, tckn, supplierName, headerMessages: messages };
  }

  const resolved = resolveMusterino(musterino);
  const mLabel = resolved
    ? `<strong>${sanitize(resolved)}</strong>`
    : `<strong>${sanitize(musterino)}</strong>`;
  messages.push(`<p style="margin-top: 12px;"><strong>📌 MUSTERINO (Müşteri No):</strong> ${mLabel}</p>`);

  if (resolved && is210(resolved)) {
    messages.push(
      `<p style="margin-top: 6px;">✅ MUSTERINO değeri <strong>210</strong>. Kontrol edilmiştir ve doğrudur. Bu değer, <strong>PO/Purchase Order (toptan satış)</strong> bazlı faturalar ve bu faturaların <strong>PPV-RI</strong> / <strong>PQV-RI</strong> karşı iade senaryoları için uygundur. Ayrıca bu araç, bu tür faturaların kontrolü için gecerlidir.</p>`
    );
  } else if (resolved && is220(resolved)) {
    messages.push(
      `<p style="margin-top: 6px;">✅ MUSTERINO değeri <strong>220</strong>. Bu değer, <strong>AR (Accounts Receivable)</strong> departmanı kapsamındaki süreçler için uygundur (ör. Amazon'un <strong>ticari iş birliği</strong> senaryolarına bağlı karşı iadeler).</p>`
    );
    messages.push(
      `<p style="margin-top: 6px; color:var(--hd-text-muted);">Not: Faturanızı <strong>PO/satış</strong> veya <strong>PPV-RI</strong> / <strong>PQV-RI</strong> karşı iade kapsamında düzenliyorsanız MUSTERINO'yu <strong>210</strong> olarak güncellemeniz gerekir.</p>`
    );
  } else if (resolved && is310(resolved)) {
    messages.push(
      `<p style="margin-top: 6px;">✅ MUSTERINO değeri <strong>310</strong>. Bu değer, <strong>Amazon DF</strong> faturaları için uygundur.</p>`
    );
  } else {
    messages.push(`<p style="margin-top: 6px; color:var(--hd-danger-text);"><strong>⚠️ MUSTERINO değeri beklenen değerlerden farklı.</strong></p>`);
    messages.push(
      `<p style="margin-top: 6px;">Lütfen senaryonuza uygun olacak şekilde MUSTERINO alanını güncelleyerek faturayı tekrar yükleyin.</p>`
    );
    messages.push(musterinoGuideHtml);
  }

  return { invoiceNo, invoiceTypeCode, musterino, vkn, tckn, supplierName, headerMessages: messages };
};