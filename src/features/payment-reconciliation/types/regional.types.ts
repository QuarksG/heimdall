export type InvoiceCategory = 
  | 'Giden Havale'
  | 'Ticari Isbirligi Faturasi'
  | 'Eksik Miktar Kesinti Bildirimi'
  | 'Eksik Miktar Kesinti Bildirimi Ters kayit'
  | 'Fiyat Farki Kesinti Bildirimi'
  | 'Fiyat Farki Kesinti Bildirimi Ters Kayit'
  | 'Eksik Miktar Kesinti Faturasi'
  | 'Arsiv Eksik Miktar Kesinti Faturasi'
  | 'Fiyat Farki Kesinti Faturasi'
  | 'Arsiv Fiyat Farki Kesinti Faturasi'
  | 'Toptan Satis Faturasi'
  | 'Iade Edilen Ürünler Için Kesilen Iade Faturasi'
  | 'Vadesi Geçmis Alacak Provizyonu'
  | 'Alacak Provizyonu'
  | 'Bank Ücreti'
  | 'CRTR Geri Ödemesi'
  | 'AR Faturasi'
  | 'Amazon Itrazlari'
  | 'QPD'
  | 'QPD Ters Kayit'
  | 'Itraz Sonucu Geri Odeme'
  | 'Siniflandirilmamis'
  | 'MISSING_ACTUAL_OR_BAN';

export interface PaymentRecord {
  rowNumber?: number;
  payee: string;
  supplierNumber: string;
  vendorSite: string;
  paymentNumber: string;
  paymentDate: string;
  currency: string;
  paymentAmount: string;
  invoiceNumber: string;
  invoiceDate: string;
  poNumber: string;
  description: string;
  discount: string;
  credit: string;
  debit: string;
  balance?: string;
  invoiceType: InvoiceCategory;
}

export interface ParsingResult {
  isValid: boolean;
  records: PaymentRecord[];
  message: string;
}