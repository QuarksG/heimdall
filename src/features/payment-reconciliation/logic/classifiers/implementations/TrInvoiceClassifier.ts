import { BaseInvoiceClassifier } from '../base/BaseInvoiceClassifier';
import type { InvoiceCategory } from '../../../types/regional.types';

export class TrInvoiceClassifier extends BaseInvoiceClassifier {
  
  public extractPurchaseOrder(description: string): string {
    if (!description) return '';
    const poMatch = description.match(/([A-Z0-9]+)\/(IST2|XSA8|XTRA|XTRD|XTRC|IST1|IST|XTRB|PTRA|PSR2|VECR|VEGX|XSA9)\//);
    return poMatch ? poMatch[1] : '';
  }

  public classify(invoiceNumber: string, description: string): InvoiceCategory {
    const standardizedInvoice = (invoiceNumber || '').toUpperCase();
    const standardizedDescription = (description || '').toUpperCase();

    if (standardizedInvoice.startsWith('GIDEN HAVALE:')) {
      return 'Giden Havale';
    }

    if (standardizedDescription.includes('FLEXIBLEAGREEMENTS')) {
      return 'Ticari Isbirligi Faturasi';
    }
    
   if (standardizedDescription.includes('MISSING_ACTUAL_OR_BAN') || standardizedInvoice.includes('MISSING_ACTUAL_OR_BAN')) {
      return 'MISSING_ACTUAL_OR_BAN';
    }

    if (this.isShortageClaim(standardizedInvoice)) {
      return 'Eksik Miktar Kesinti Bildirimi';
    }

    if (this.isShortageClaimReversal(standardizedInvoice)) {
      return 'Eksik Miktar Kesinti Bildirimi Ters kayit';
    }

    if (this.isPriceClaim(standardizedInvoice, standardizedDescription)) {
      return 'Fiyat Farki Kesinti Bildirimi';
    }

    if (this.isPriceClaimReversal(standardizedInvoice, standardizedDescription)) {
      return 'Fiyat Farki Kesinti Bildirimi Ters Kayit';
    }

    if (standardizedInvoice.includes('IQV')) {
      return 'Eksik Miktar Kesinti Faturasi';
    }

    if (standardizedInvoice.includes('AQV')) {
      return 'Arsiv Eksik Miktar Kesinti Faturasi';
    }

    if (standardizedInvoice.startsWith('IPV')) {
      return 'Fiyat Farki Kesinti Faturasi';
    }

    if (standardizedInvoice.startsWith('APV')) {
      return 'Arsiv Fiyat Farki Kesinti Faturasi';
    }

   if (this.isWholesaleInvoice(standardizedDescription) && standardizedInvoice.length === 16) {
      return 'Toptan Satis Faturasi';
    }

    if (this.isCoopInvoice(standardizedInvoice, standardizedDescription)) {
      return 'Ticari Isbirligi Faturasi';
    }

    if (this.isReturnInvoice(standardizedInvoice, standardizedDescription)) {
      return 'Iade Edilen Ürünler Için Kesilen Iade Faturasi';
    }

    if (standardizedInvoice.includes('PROVISION_FOR_AGED_')) {
      return 'Vadesi Geçmis Alacak Provizyonu';
    }

    if (standardizedInvoice.includes('PROVISION_FOR_RECEIVABLE') || standardizedInvoice.includes('PROVISION_FOR_ACCRUAL')) {
      return 'Alacak Provizyonu';
    }

    if (standardizedDescription.includes('BANK FEE')) {
      return 'Bank Ücreti';
    }

    if (standardizedDescription.includes('CRTR') || standardizedInvoice.includes('CREATING PARENT INVOICE VIA TR') || standardizedDescription.includes('CREATING PARENT INVOICE VIA TR')) {
      return 'CRTR Geri Ödemesi';
    }

    if (standardizedDescription.includes('DFP FOR AR INVOICE')) {
      return 'AR Faturasi';
    }

    if (standardizedDescription.includes('DSPT') && !standardizedInvoice.includes('DSPT')) {
      return 'Amazon Itrazlari';
    }

    if (standardizedDescription.includes('QPD RETURN INVOICE')) {
      return 'QPD';
    }

    if (standardizedDescription.includes('CLEARING INVOICE AGANIST QPD')) {
      return 'QPD Ters Kayit';
    }

    if (standardizedDescription.includes('PAYBACK')) {
      return 'Itraz Sonucu Geri Odeme';
    }

    return 'Siniflandirilmamis';
  }

  private isShortageClaim(invoice: string): boolean {
    return invoice.endsWith('SC');
  }

  private isShortageClaimReversal(invoice: string): boolean {
    return invoice.endsWith('SCR') || invoice.endsWith('SCRI');
  }

  private isPriceClaim(invoice: string, description: string): boolean {
    return invoice.endsWith('PC') || description.includes('FOR PPV');
  }

  private isPriceClaimReversal(invoice: string, description: string): boolean {
    return invoice.endsWith('PCR') || invoice.endsWith('PCRI') || description.includes('PRICE CLAIM REVERSAL');
  }

  private isWholesaleInvoice(description: string): boolean {
    const salesKeywords = ['IST', 'XSA8','IST1', 'IST2', 'XTRB', 'XTRA', 'XTRD', 'PTRA', 'XTRC', 'PSR2', 'VECR', 'VEGX','XSA9'];
    return salesKeywords.some(keyword => description.includes(keyword));
  }

  private isCoopInvoice(invoice: string, description: string): boolean {
    const prefix = invoice.slice(0, 2);

    const hasKeywords = description.includes('FOR TRANSACTION') || description.includes('DSPT');
    const hasC1Reference = /\bC1[A-Z0-9]{14}\b/.test(description);

    if (hasKeywords && hasC1Reference) {
        return true;
    }
    
    if (prefix === 'C1' && invoice.slice(-2) === 'R1') return true;
    if (prefix === 'C1' || prefix === 'C0') return true;
    
    const coopKeywords = ['VOLUME INCENTIVE', 'CO-OP', 'AVS', 'SPA'];
    if (coopKeywords.some(key => description.includes(key))) return true;

    if (invoice.includes('DSPT') && description.includes('C1')) return true;

    const rPattern = invoice.match(/R(\d{1,2})$/);
    if (rPattern) {
      const rNumber = parseInt(rPattern[1]);
      if (rNumber >= 1 && rNumber <= 12) {
        if (description.includes('C0') || description.includes('C1')) return true;
      }
    }

    return false;
  }

  private isReturnInvoice(invoice: string, description: string): boolean {
    const prefix = invoice.slice(0, 2);
    
    if (prefix === 'V1' || prefix === 'V0') return true;

    const hasKeywords = description.includes('FOR TRANSACTION') || description.includes('DSPT');
    const hasC1Reference = /\bV[A-Z0-9]{15}\b/.test(description);

    if (hasKeywords && hasC1Reference) {
        return true;
    }
    
    const rPattern = invoice.match(/R(\d{1,2})$/);
    if (rPattern && (description.includes('V1') || description.includes('V0'))) return true;
    
    if (description.includes('VRET') || description.includes('RETURNS')) return true;
    
    if (invoice.includes('DSPT') && (description.includes('V1') || description.includes('V0'))) return true;

    return false;
  }
}