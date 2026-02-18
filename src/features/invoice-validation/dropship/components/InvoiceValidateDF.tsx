import { XMLToExcelConverter } from '../../../invoice-parsing/utils/xmlParser';
import { validateDFInvoiceHeader } from '../validators/InvoiceHeader';
import { validateSupplierParty } from '../validators/supplierValidator';
import { validateAmazonAddress } from '../../retail/validators/addressValidator';
import { validateAmazonTaxDetails } from '../../retail/validators/taxValidator';
import { validateDFPurchaseOrders } from '../validators/poValidator';
import { validateDFAsins } from '../validators/asinValidator';
import { buildSuccessMessage, buildFailureSummary } from '../utils/messageBuilder';

export const validateDFInvoice = (xmlDoc: Document): string => {
  const converter = new XMLToExcelConverter();
  const messageParts: string[] = [];
  let hasErrors = false;

 
  const headerResult = validateDFInvoiceHeader(xmlDoc, converter);
  messageParts.push(...headerResult.headerMessages);

  const resolvedMusterino = headerResult.musterino
    .split(',')
    .map((p) => p.trim().replace(/\s+/g, ''))
    .find((p) => p === '310');

  if (!resolvedMusterino) {
    hasErrors = true;
  }

  
  if (headerResult.invoiceTypeCode !== 'Unknown') {
    const upper = headerResult.invoiceTypeCode.toLocaleUpperCase('tr-TR').trim();
    if (upper === 'IADE' || upper === 'IRSALIYE') {
      hasErrors = true;
    }
  }


  const supplierResult = validateSupplierParty(xmlDoc, converter);
  messageParts.push(...supplierResult.supplierMessages);
  if (!supplierResult.isValid) {
    hasErrors = true;
  }

  const addressErrors = validateAmazonAddress(xmlDoc, converter);
  if (addressErrors.length > 0) {
    hasErrors = true;
    messageParts.push(...addressErrors);
  } else {
    messageParts.push(
      '<div style="background:#e8f5e9;padding:12px;border-radius:8px;border-left:5px solid #4caf50;margin:12px 0;">',
      '<p style="color:#1b5e20;margin:0;"><strong>✅ Adres Bilgileri Doğru:</strong> Faturanızdaki Amazon müşteri bilgileri (Esentepe/Şişli) doğru görünüyor.</p>',
      '</div>'
    );
  }

  
  const taxErrors = validateAmazonTaxDetails(xmlDoc, converter);
  if (taxErrors.length > 0) {
    hasErrors = true;
    messageParts.push(...taxErrors);
  } else {
    messageParts.push(
      '<div style="background:#e8f5e9;padding:12px;border-radius:8px;border-left:5px solid #4caf50;margin:12px 0;">',
      '<p style="color:#1b5e20;margin:0;"><strong>✅ Vergi Detayları Doğru:</strong> Faturanızdaki temel vergi alanları mevcut ve dip toplam uyumu sağlanıyor.</p>',
      '</div>'
    );
  }

  
  const poResult = validateDFPurchaseOrders(xmlDoc, converter);
  messageParts.push(...poResult.poMessages);

  if (poResult.errors.length > 0) {
    hasErrors = true;
  } else if (poResult.results.length > 0) {
    messageParts.push(
      '<div style="background:#e8f5e9;padding:12px;border-radius:8px;border-left:5px solid #4caf50;margin:12px 0;">',
      '<p style="color:#1b5e20;margin:0;"><strong>✅ PO Numaraları Doğru:</strong> Tüm satırlardaki PO numaraları geçerli formatta.</p>',
      '</div>'
    );
  }

  
  const asinResult = validateDFAsins(xmlDoc, converter);
  messageParts.push(...asinResult.asinMessages);

  if (asinResult.errors.length > 0) {
    hasErrors = true;
  } else {
    messageParts.push(
      '<div style="background:#e8f5e9;padding:12px;border-radius:8px;border-left:5px solid #4caf50;margin:12px 0;">',
      '<p style="color:#1b5e20;margin:0;"><strong>✅ ASIN Kodları Doğru:</strong> Tüm satırlarda geçerli ASIN veya ISBN-10 kodu mevcut.</p>',
      '</div>'
    );
  }

  
  if (!hasErrors) {
    messageParts.push(
      buildSuccessMessage(
        headerResult.invoiceNo,
        headerResult.vkn,
        headerResult.tckn,
        headerResult.supplierName
      )
    );
  } else {
    messageParts.push(buildFailureSummary());
  }

  return messageParts.join('');
};
