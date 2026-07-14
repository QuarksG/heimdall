

import DOMPurify from 'dompurify';

const sanitize = (v: string) => DOMPurify.sanitize(v ?? '');


export const buildWelcomeMessage = (): string => `
<h3>Drop Ship (DF) Fatura Kontrol Aracı</h3>
<p>Faturanızın XML formatını yükleyerek aşağıdaki kontrollerin Amazon Drop Ship standartlarına uygunluğunu doğrulayabilirsiniz:</p>
<ul style="padding-left:18px;line-height:1.8;">
  <li><strong>MUSTERINO:</strong> Müşteri No (310 olmalıdır)</li>
  <li><strong>Tedarikçi Bilgileri:</strong> AccountingSupplierParty alanlarının eksiksiz olması</li>
  <li><strong>Amazon Müşteri Adresi:</strong> AccountingCustomerParty doğrulaması (Esentepe/Şişli)</li>
  <li><strong>Vergi Detayları:</strong> TaxableAmount, LineExtensionAmount, dip toplam uyumu</li>
  <li><strong>PO Numarası:</strong> Amazon sipariş numarası (9 karakter, büyük/küçük harf karışık)</li>
  <li><strong>ASIN:</strong> BuyersItemIdentification (10 karakter, "B" ile başlayan veya ISBN-10)</li>
</ul>
<p>Doğrulamaya başlamak için bir XML dosyası veya birden fazla XML içeren bir ZIP dosyası yükleyiniz.</p>
<div style="background:var(--hd-warning-bg);padding:10px;border:1px solid var(--hd-warning-border);border-radius:6px;margin-top:8px;">
  <p style="margin:0;"><strong>⚠️ Not:</strong> Drop Ship faturalarında <strong>IADE (IPV/IQV)</strong> senaryosu bulunmamaktadır. Bu araç yalnızca <strong>SATIS</strong> türündeki faturaları destekler.</p>
</div>
`;


export const buildSuccessMessage = (
  invoiceNo: string,
  vkn: string,
  tckn: string,
  supplierName: string
): string => {
  const NOT_FOUND = 'Unknown';

  let idPart = '';
  if (vkn && vkn !== NOT_FOUND) {
    idPart = `${sanitize(vkn)} (VKN) numaralı`;
  } else if (tckn && tckn !== NOT_FOUND) {
    idPart = `${sanitize(tckn)} (TCKN) numaralı`;
  }

  const namePart = supplierName && supplierName !== NOT_FOUND ? ` ${sanitize(supplierName)} şirkete ait` : '';
  const invoicePart = invoiceNo && invoiceNo !== NOT_FOUND ? ` ${sanitize(invoiceNo)} numaralı` : '';

  return [
    `<div style="background:var(--hd-success-bg);padding:20px;border-radius:8px;border-left:5px solid var(--hd-success-border);margin:20px 0;text-align:center;">`,
    `<h2 style="color:var(--hd-success-text);margin:0 0 10px 0;">🎉 Tebrikler! Tüm Kontroller Başarılı.</h2>`,
    `<p style="color:var(--hd-success-text);font-size:16px;margin:0;">`,
    `Göndermiş olduğunuz ${idPart}${namePart}${invoicePart} Drop Ship fatura`,
    ` kontrol edilmiş ve hatasız olduğu tespit edilmiştir.`,
    `</p>`,
    `<p style="color:var(--hd-success-text);margin:8px 0 0 0;">`,
    `Faturanız <strong>Tedarikçi Bilgileri</strong>, <strong>Adres/Vergi</strong> ve <strong>Ticari (PO/ASIN)</strong> kurallarına uygun görünüyor.`,
    `</p>`,
    `</div>`,
    `<div style="background:var(--hd-surface-2);padding:10px;border:1px solid var(--hd-border);border-radius:6px;margin-top:8px;">`,
    `<p style="margin:0;color:var(--hd-text-muted);">`,
    `Faturanızdaki Amazon müşteri bilgileri doğru girilmiştir, ancak bu uygulama yalnız Amazon standartlarını kontrol etmektedir. `,
    `Faturanıza PO/ASIN veya diğer teknik detayları girdiğinizden emin değilseniz, GİB üzerinden her zaman toplu fatura göndermezden önce test faturanızı iletiniz.`,
    `</p>`,
    `</div>`,
  ].join('');
};


export const buildFailureSummary = (): string => `
<div style="background-color:var(--hd-danger-bg);padding:15px;border-radius:8px;border-left:5px solid var(--hd-danger-border);margin:20px 0;">
  <p style="color:var(--hd-chip-bad-text);margin:0;font-size:16px;text-align:center;">
    <strong>⚠️ Dikkat:</strong> Faturanızda yukarıda belirtilen bir veya daha fazla hata bulunmaktadır. Lütfen düzeltip tekrar yükleyiniz.
  </p>
</div>`;
