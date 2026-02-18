import React, { useCallback, useMemo, useState } from 'react';
import JSZip from 'jszip';
import DOMPurify from 'dompurify';
import '../../../../styles/components/chat.css';
import { XMLToExcelConverter } from '../../../invoice-parsing/utils/xmlParser';
import { getInitialGreeting } from '../utils/messageBuilder';

import { validateInvoiceHeader } from '../validators/headerValidator';
import { validateAmazonAddress } from '../validators/addressValidator';
import { validateAmazonTaxDetails } from '../validators/taxValidator';
import { validatePurchaseOrder } from '../validators/poValidator';
import { validateAsinDetails } from '../validators/asinValidator';
import { performIADEValidations } from '../validators/IADEValidations';

interface Message {
  sender: 'user' | 'bot';
  text: string;
}

type IqvIpvHit = {
  raw: string;
  prefix: 'IQV' | 'IPV';
  digits: string;
  digitCount: number;
  strict: boolean; // true when digitCount === 13
};

interface IADEDetectionResult {
  isIADEDetected: boolean;
  foundInvoiceTypeCode: boolean;
  foundInOrderReference: boolean;
  foundInBuyersItem: boolean;
  foundInNotes: boolean;
  foundInItemName: boolean;
  foundInItemDescription: boolean;
  detectedCodes: string[];
  detectedHits: IqvIpvHit[];
}

const MAX_SIZE_BYTES = 100 * 1024 * 1024;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const baseNameOf = (path: string) => {
  const p = String(path || '').replace(/\\/g, '/');
  const parts = p.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
};

const snapshotTexts = (xmlDoc: Document, xpath: string): string[] => {
  const res = xmlDoc.evaluate(xpath, xmlDoc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  const out: string[] = [];
  for (let i = 0; i < res.snapshotLength; i++) {
    const t = res.snapshotItem(i)?.textContent?.trim();
    if (t) out.push(t);
  }
  return out;
};

/**
 * Behavioral routing:
 * - detect IQV/IPV followed by 10..20 digits anywhere (vendor behavior).
 * Strict correctness:
 * - strict only when 13 digits (IQV|IPV + 13 digits).
 */
const IQV_IPV_DETECT_REGEX = /\b(IQV|IPV)(\d{10,20})\b/g;
const IQV_IPV_STRICT_REGEX = /\b(IQV|IPV)(\d{13})\b/;

const findIqvIpvHits = (text: string): IqvIpvHit[] => {
  const out: IqvIpvHit[] = [];
  const s = String(text ?? '');

  for (const m of s.matchAll(IQV_IPV_DETECT_REGEX)) {
    const prefix = m[1] as 'IQV' | 'IPV';
    const digits = m[2] ?? '';
    const raw = `${prefix}${digits}`;
    out.push({
      raw,
      prefix,
      digits,
      digitCount: digits.length,
      strict: IQV_IPV_STRICT_REGEX.test(raw),
    });
  }

  const uniq = new Map<string, IqvIpvHit>();
  for (const h of out) uniq.set(h.raw, h);
  return [...uniq.values()];
};

const detectIADEIndicators = (xmlDoc: Document, invoiceTypeCode: string): IADEDetectionResult => {
  const result: IADEDetectionResult = {
    isIADEDetected: false,
    foundInvoiceTypeCode: false,
    foundInOrderReference: false,
    foundInBuyersItem: false,
    foundInNotes: false,
    foundInItemName: false,
    foundInItemDescription: false,
    detectedCodes: [],
    detectedHits: [],
  };

  // If InvoiceTypeCode is already IADE, treat as IADE
  if (String(invoiceTypeCode).trim() === 'IADE') {
    result.foundInvoiceTypeCode = true;
    result.isIADEDetected = true;
  }

  const scan = (values: string[], flag: keyof IADEDetectionResult) => {
    for (const v of values) {
      const hits = findIqvIpvHits(v);
      if (!hits.length) continue;

      // behavioral: any IQV/IPV candidate => IADE-intended
      (result as any)[flag] = true;
      result.isIADEDetected = true;

      result.detectedHits.push(...hits);
      result.detectedCodes.push(...hits.map((h) => h.raw));
    }
  };

  scan(snapshotTexts(xmlDoc, '//*[local-name()="OrderReference"]/*[local-name()="ID"]'), 'foundInOrderReference');
  scan(snapshotTexts(xmlDoc, '//*[local-name()="BuyersItemIdentification"]/*[local-name()="ID"]'), 'foundInBuyersItem');
  scan(snapshotTexts(xmlDoc, '//*[local-name()="Note"]'), 'foundInNotes');
  scan(snapshotTexts(xmlDoc, '//*[local-name()="Item"]/*[local-name()="Name"]'), 'foundInItemName');
  scan(snapshotTexts(xmlDoc, '//*[local-name()="Item"]/*[local-name()="Description"]'), 'foundInItemDescription');

  // de-dupe
  result.detectedCodes = [...new Set(result.detectedCodes)];
  const uniqHits = new Map<string, IqvIpvHit>();
  for (const h of result.detectedHits) uniqHits.set(h.raw, h);
  result.detectedHits = [...uniqHits.values()];

  return result;
};

const InvoiceControl: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const converter = useMemo(() => new XMLToExcelConverter(), []);

  const addMessage = useCallback((sender: 'user' | 'bot', text: string) => {
    setMessages((prev) => [...prev, { sender, text: DOMPurify.sanitize(text) }]);
  }, []);

  const validateXML = useCallback(
    (xmlDoc: Document, fileName: string = 'unknown.xml') => {
      try {
        let invoiceNo = 'Bilinmeyen';
        let invoiceTypeCode = 'SATIS';
        let headerMessages: string[] = [];
        let vkn = '';
        let tckn = '';
        let supplierName = '';

        try {
          const headerResult = validateInvoiceHeader(xmlDoc, converter);
          invoiceNo = headerResult.invoiceNo;
          invoiceTypeCode = headerResult.invoiceTypeCode;
          headerMessages = headerResult.headerMessages;
          vkn = headerResult.vkn;
          tckn = headerResult.tckn;
          supplierName = headerResult.supplierName;
        } catch (error) {
          addMessage(
            'bot',
            `<h3 style="color:#d32f2f;">❌ Fatura Başlığı Doğrulanamadı</h3>
             <p>Dosya: <strong>${DOMPurify.sanitize(fileName)}</strong></p>
             <p>Hata: ${error instanceof Error ? DOMPurify.sanitize(error.message) : 'Bilinmeyen hata'}</p>`
          );
          return;
        }

        const messageParts: string[] = [...headerMessages];
        let hasErrors = false;

        // Address
        try {
          const addressErrors = validateAmazonAddress(xmlDoc, converter);
          if (Array.isArray(addressErrors) && addressErrors.length > 0) {
            hasErrors = true;
            messageParts.push(...addressErrors);
          }
        } catch (error) {
          hasErrors = true;
          messageParts.push(
            `<h3 style="color:#d32f2f;">❌ Adres Doğrulama Hatası</h3>
             <p>Hata: ${error instanceof Error ? DOMPurify.sanitize(error.message) : 'Bilinmeyen hata'}</p>`
          );
        }

        
        const iadeDetection = detectIADEIndicators(xmlDoc, invoiceTypeCode);

       
        if (iadeDetection.isIADEDetected && !iadeDetection.foundInvoiceTypeCode) {
          hasErrors = true;

          const locations: string[] = [];
          if (iadeDetection.foundInOrderReference) locations.push('Sipariş Referansı (OrderReference)');
          if (iadeDetection.foundInBuyersItem) locations.push('Alıcı Ürün Kimliği (BuyersItemIdentification)');
          if (iadeDetection.foundInNotes) locations.push('Notlar (Note)');
          if (iadeDetection.foundInItemName) locations.push('Ürün Adı (Item Name)');
          if (iadeDetection.foundInItemDescription) locations.push('Ürün Açıklaması (Item Description)');

          const malformed = iadeDetection.detectedHits.filter((h) => !h.strict);

          messageParts.push(
            '<h3 style="color:#d32f2f;">❌ Hatalı Fatura Türü Tespit Edildi:</h3>',
            `<p>Faturanızda <strong>IQV/IPV</strong> göstergeleri tespit edildi ancak <code>InvoiceTypeCode</code> alanı <strong>IADE</strong> olarak ayarlanmamış.</p>`,
            `<p><strong>Tespit edilen değerler:</strong> ${iadeDetection.detectedCodes.map((x) => DOMPurify.sanitize(x)).join(', ')}</p>`,
            `<p><strong>Değerlerin bulunduğu alanlar:</strong></p>`,
            `<ul>${locations.map((loc) => `<li>${DOMPurify.sanitize(loc)}</li>`).join('')}</ul>`,
            '<p><strong>Çözüm:</strong> Lütfen faturanızın <code>&lt;cbc:InvoiceTypeCode&gt;</code> alanını <strong>IADE</strong> olarak güncelleyin.</p>',
            `<pre><code>&lt;cbc:InvoiceTypeCode&gt;IADE&lt;/cbc:InvoiceTypeCode&gt;</code></pre>`
          );

          if (malformed.length > 0) {
            messageParts.push(
              '<div style="margin: 14px 0; padding: 12px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 6px;">' +
                '<p style="margin:0 0 8px 0;"><strong>⚠️ Ek tespit:</strong> IQV/IPV formatı hatalı görünüyor (IQV/IPV sonrası <strong>13 hane</strong> olmalıdır).</p>' +
                `<ul style="margin:0; padding-left:18px;">${malformed
                  .map((h) => `<li>${DOMPurify.sanitize(h.raw)} (hane sayısı: ${h.digitCount})</li>`)
                  .join('')}</ul>` +
              '</div>'
            );
          }
        }

        // PO validation
        try {
          const poResult = validatePurchaseOrder(xmlDoc, converter);

          if (typeof poResult === 'object' && poResult !== null) {
            const poValid = (poResult as any).isValid ?? true;
            const poMessages = (poResult as any).poMessages || [];

            if (!poValid && Array.isArray(poMessages)) {
              hasErrors = true;
              messageParts.push(...poMessages);
            }
          }
        } catch (error) {
          hasErrors = true;
          messageParts.push(
            `<h3 style="color:#d32f2f;">❌ PO Doğrulama Hatası</h3>
             <p>Hata: ${error instanceof Error ? DOMPurify.sanitize(error.message) : 'Bilinmeyen hata'}</p>`
          );
        }

        if (iadeDetection.isIADEDetected || String(invoiceTypeCode).trim() === 'IADE') {
          try {
            const { hasErrors: iadeErrors, messages: iadeMessages } = performIADEValidations(xmlDoc, converter);
            if (iadeErrors) {
              hasErrors = true;
              messageParts.push(...iadeMessages);
            }
          } catch (error) {
            hasErrors = true;
            messageParts.push(
              `<h3 style="color:#d32f2f;">❌ IADE Doğrulama Hatası</h3>
               <p>Hata: ${error instanceof Error ? DOMPurify.sanitize(error.message) : 'Bilinmeyen hata'}</p>`
            );
          }
        } else {
          // SATIS validations (ASIN)
          try {
            const asinErrors = validateAsinDetails(xmlDoc, messageParts, converter);
            if (asinErrors) {
              hasErrors = true;
            }
          } catch (error) {
            hasErrors = true;
            messageParts.push(
              `<h3 style="color:#d32f2f;">❌ ASIN Doğrulama Hatası</h3>
               <p>Hata: ${error instanceof Error ? DOMPurify.sanitize(error.message) : 'Bilinmeyen hata'}</p>`
            );
          }
        }

        // Tax validation
        try {
          const taxErrors = validateAmazonTaxDetails(xmlDoc, converter);
          if (Array.isArray(taxErrors) && taxErrors.length > 0) {
            hasErrors = true;
            messageParts.push(...taxErrors);
          }
        } catch (error) {
          hasErrors = true;
          messageParts.push(
            `<h3 style="color:#d32f2f;">❌ Vergi Doğrulama Hatası</h3>
             <p>Hata: ${error instanceof Error ? DOMPurify.sanitize(error.message) : 'Bilinmeyen hata'}</p>`
          );
        }
        if (hasErrors) {
          messageParts.push(
            `<p>Lütfen yukarıdaki hataları düzelterek faturayı yeniden gönderiniz. Sorularınız olursa bizimle iletişime geçebilirsiniz.</p>`,
            `<p>Bizimle iletişime geçmek için destek kaydı oluşturmanız gerekmektedir. Faturalarla ilgili destek kaydı için aşağıdaki adımları takip ederek destek kaydı oluşturmanızı rica ederiz:</p>`,
            `<p><strong>Vendor Central &gt; Destek &gt; Bize Ulaşın &gt; Ödemeler &gt; Fatura iptali ve eski durumuna getirme</strong></p>`,
            `<p>Teşekkür ederiz.</p>`
          );
        } else {
          messageParts.length = 0;

          const safeInvoiceNo = DOMPurify.sanitize(String(invoiceNo));
          const safeVkn = vkn && vkn !== 'Unknown' ? DOMPurify.sanitize(vkn) : '';
          const safeTckn = tckn && tckn !== 'Unknown' ? DOMPurify.sanitize(tckn) : '';
          const safeSupplier = supplierName && supplierName !== 'Unknown' ? DOMPurify.sanitize(supplierName) : '';

          let idLabel = '';
          if (safeVkn) {
            idLabel = `<strong>${safeVkn}</strong> (VKN)`;
          } else if (safeTckn) {
            idLabel = `<strong>${safeTckn}</strong> (TCKN)`;
          }

          const companyLine = idLabel
            ? `Göndermiş olduğunuz ${idLabel} numaralı${safeSupplier ? ` <strong>${safeSupplier}</strong>` : ''} şirkete ait`
            : '';

          messageParts.push(
            '<p>Merhaba Değerli Tedarikçimiz,</p>',
            `<p>Yukarıdaki fatura numarası ile ilgili faturanızı kontrol ettiğiniz için teşekkür ederiz.</p>`,
            `<p>${companyLine} <strong>${safeInvoiceNo}</strong> numaralı fatura kontrol edilmiş ve <strong style="color:#2e7d32;">hatasız</strong> olduğu tespit edilmiştir.</p>`,
            `<p>Faturanızdaki Amazon müşteri bilgileri doğru girilmiştir, ancak bu applikasyon yalnız Amazon standartlarını kontrol etmektedir. Faturanıza PO/ASIN veya diğer teknik detayları girdiğinizden emin değilseniz, GİB üzerinden her zaman toplu fatura göndermezden önce test faturanızı iletiniz.</p>`,
            '<p>Teşekkür ederiz.</p>'
          );
        }

        addMessage('bot', messageParts.join(''));
      } catch (error) {
        addMessage(
          'bot',
          `<h3 style="color:#d32f2f;">💥 Kritik Hata</h3>
           <p>Dosya: <strong>${DOMPurify.sanitize(fileName)}</strong></p>
           <p>Fatura işlenirken beklenmeyen bir hata oluştu.</p>
           <p><strong>Hata Detayı:</strong> ${error instanceof Error ? DOMPurify.sanitize(error.message) : 'Bilinmeyen hata'}</p>`
        );
      }
    },
    [addMessage, converter]
  );

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const inputEl = event.currentTarget;
      const file = inputEl.files?.[0];

      if (!file) {
        addMessage('bot', 'Dosya seçilmedi.');
        return;
      }

      const name = file.name || '';
      const lower = name.toLowerCase();
      const isXml = lower.endsWith('.xml');
      const isZip = lower.endsWith('.zip');

      if (!isXml && !isZip) {
        addMessage('bot', 'Lütfen geçerli XML/ZIP dosyası yükleyiniz.');
        inputEl.value = '';
        return;
      }

      if (file.size > MAX_SIZE_BYTES) {
        addMessage('bot', 'Dosya boyutu çok büyük (Maks 100MB).');
        inputEl.value = '';
        return;
      }

      setIsProcessing(true);

      try {
        if (isXml) {
          addMessage('user', `Yüklenen XML dosyası: ${DOMPurify.sanitize(name)}`);
          const text = await file.text();
          const doc = await Promise.resolve((converter as any).transformXML?.(text));

          if (doc) {
            validateXML(doc, name);
          } else {
            addMessage('bot', `<p><strong>${DOMPurify.sanitize(name)}</strong> dosyası XML parse edilemedi.</p>`);
          }
          return;
        }

        const zip = await JSZip.loadAsync(file);
        const xmlFiles = Object.keys(zip.files).filter((fn) => {
          const f = zip.files[fn];
          return !!f && !f.dir && fn.toLowerCase().endsWith('.xml');
        });

        if (xmlFiles.length === 0) {
          addMessage('bot', 'ZIP arşivinde XML yok.');
          return;
        }

        xmlFiles.sort((a, b) => a.localeCompare(b));
        addMessage('user', `Yüklenen ZIP dosyası: ${DOMPurify.sanitize(name)} (${xmlFiles.length} XML dosyası içeriyor)`);

        for (let i = 0; i < xmlFiles.length; i++) {
          const fullName = xmlFiles[i];
          const entry = zip.files[fullName];

          if (!entry || entry.dir) continue;

          const shortName = baseNameOf(fullName);
          addMessage('user', `ZIP'ten çıkarılan XML dosyası: ${DOMPurify.sanitize(shortName)}`);

          try {
            const text = await entry.async('text');
            const doc = await Promise.resolve((converter as any).transformXML?.(text));

            if (doc) {
              validateXML(doc, shortName);
            } else {
              addMessage('bot', `<p><strong>${DOMPurify.sanitize(shortName)}</strong> dosyası XML parse edilemedi.</p>`);
            }
          } catch (fileError) {
            addMessage(
              'bot',
              `<p><strong>${DOMPurify.sanitize(shortName)}</strong> işlenirken hata: ${
                fileError instanceof Error ? DOMPurify.sanitize(fileError.message) : 'Bilinmeyen hata'
              }</p>`
            );
          }

          if (i < xmlFiles.length - 1) await sleep(25);
        }
      } catch (error) {
        addMessage(
          'bot',
          `<h3 style="color:#d32f2f;">💥 Dosya İşleme Hatası</h3>
           <p>Dosya: <strong>${DOMPurify.sanitize(name)}</strong></p>
           <p><strong>Hata:</strong> ${error instanceof Error ? DOMPurify.sanitize(error.message) : 'Bilinmeyen hata'}</p>`
        );
      } finally {
        setIsProcessing(false);
        inputEl.value = '';
      }
    },
    [addMessage, converter, validateXML]
  );

  return (
    <div className="chat-container">
      <div className="chat-messages">
        <div className="message bot initial-greeting">
          <div className="message-content">
            <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(getInitialGreeting()) }} />
          </div>
        </div>

        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.sender}`}>
            <div className="message-content" dangerouslySetInnerHTML={{ __html: msg.text }} />
          </div>
        ))}

        {isProcessing && (
          <div className="message bot">
            <div className="message-content">⏳ Dosya inceleniyor...</div>
          </div>
        )}
      </div>

      <div className={`chat-input ${isProcessing ? 'disabled' : ''}`}>
        <label className="upload-button" aria-label="Dosya yükle">
          XML/ZIP dosyası yükle
          <input
            type="file"
            accept=".xml,.zip"
            onChange={handleFileChange}
            disabled={isProcessing}
            style={{ display: 'none' }}
          />
        </label>
      </div>
    </div>
  );
};

export default InvoiceControl;