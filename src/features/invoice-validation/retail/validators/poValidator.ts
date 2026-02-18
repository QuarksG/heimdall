import DOMPurify from 'dompurify';
import { XMLToExcelConverter } from '../../../invoice-parsing/utils/xmlParser';

type POValidationResult = {
  orderReference: string;
  isValid: boolean;
  poMessages: string[];
};

const NOT_FOUND = 'Unknown';

const sanitize = (v: unknown) => DOMPurify.sanitize(String(v ?? ''));

const toFoundValue = (v: string | null): string => {
  if (v === null || v === undefined) return NOT_FOUND;
  const s = v.trim();
  if (!s || s.toLowerCase() === 'unknown') return NOT_FOUND;
  return s;
};

const pushMissingPOMessage = (messages: string[]) => {
  messages.push(
    '<h3>Faturanızda Amazon Sipariş Numarasına Ait XML Satırı Bulunmuyor:</h3>',
    '<p>Sipariş emri, <span style="color: red; font-weight: bold;">OrderReference</span> satırında yer almalı ve 8 haneli olmalıdır. Not satırına yazılan PO (Sipariş No) kodları geçerli değildir. Her fatura için yalnızca tek bir PO kodu geçerlidir; bu nedenle ilgili PO kodu, ilgili PO satırına girilmelidir. PO kodunu lütfen yalnızca bir kez yazın; başka bir harf, karakter veya bilgi eklemeyin.</p>',
    '<p><em><strong>PO (Sipariş Emri) ve ASIN kodlarını bulmak için: Vendor Central &gt; Siparişler &gt; Sipariş Emirleri</strong></em></p>',
    '<p>Aşağıda PO satırının XML formatındaki örneği verilmiştir. Faturanızda bu XML satırının eklenmesi/güncellenmesi gerekmektedir:</p>',
    `<pre><code>&lt;cac:OrderReference&gt;
        &lt;cbc:ID&gt;4NXKJ3DR&lt;/cbc:ID&gt; &lt;!-- Sipariş numaranız (örnek kod) --&gt;
        &lt;cbc:IssueDate&gt;TARİH&lt;/cbc:IssueDate&gt; &lt;!-- Tarih --&gt;
      &lt;/cac:OrderReference&gt;</code></pre>`
  );
};

const pushInvalidPOMessage = (messages: string[], orderReference: string, orderReferenceDate: string) => {
  const lengthMessage = `Lütfen PO numaranızın tam 8 haneli olduğundan emin olun ve PO numarası satırına başka hiçbir ekstra karakter girmeyiniz. Yüklemiş olduğunuz faturanın XML'inde PO satırına girdiğiniz PO numarası ${orderReference.length} karakterden oluşuyor. Amazon PO numarası genellikle alfanümerik formatta olup, örnek olarak "4NXKJ3DR" şeklindedir.`;

  messages.push(
    '<h3>Geçersiz PO Numarası:</h3>',
    `<p>${sanitize(lengthMessage)}</p>`,
    '<p>Aşağıda PO satırına girdiğiniz değerin XML formatındaki görünümü verilmiştir:</p>',
    `<pre><code>&lt;cac:OrderReference&gt;
          &lt;cbc:ID&gt;<span style="color: red;">${sanitize(orderReference)}</span>&lt;/cbc:ID&gt;
          &lt;cbc:IssueDate&gt;${sanitize(orderReferenceDate) || 'Bulunamadı'}&lt;/cbc:IssueDate&gt;
        &lt;/cac:OrderReference&gt;</code></pre>`
  );
};

export const validatePurchaseOrder = (xmlDoc: Document, converter: XMLToExcelConverter): POValidationResult => {
  const poMessages: string[] = [];

  // Extract order reference using converter — try XPath first, fall back to field key
  const orderReference = (() => {
    const v = toFoundValue(
      converter.evaluateSingle(xmlDoc, '//*[local-name()="OrderReference"]/*[local-name()="ID"]')
    );
    if (v !== NOT_FOUND) return v;
    return converter.extractFieldByKey(xmlDoc, 'order_reference_id');
  })();

  const orderReferenceDate = toFoundValue(
    converter.evaluateSingle(xmlDoc, '//*[local-name()="OrderReference"]/*[local-name()="IssueDate"]')
  );

  if (orderReference === NOT_FOUND) {
    pushMissingPOMessage(poMessages);
    return { orderReference, isValid: false, poMessages };
  }

  if (orderReference.length !== 8 || !/^[a-zA-Z0-9]+$/.test(orderReference)) {
    pushInvalidPOMessage(poMessages, orderReference, orderReferenceDate);
    return { orderReference, isValid: false, poMessages };
  }

  return { orderReference, isValid: true, poMessages };
};