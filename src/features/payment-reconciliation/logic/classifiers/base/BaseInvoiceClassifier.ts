export interface ProcessedInvoice {
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
  invoiceType: string;
  balance?: string;
}

export abstract class BaseInvoiceClassifier {
  protected containsText(text: string, searchTerm: string): boolean {
    return text.toUpperCase().includes(searchTerm.toUpperCase());
  }
  
  protected getPrefix(text: string, length: number): string {
    return text.slice(0, length);
  }
  
  protected getSuffix(text: string, length: number): string {
    return text.slice(-length);
  }
  
  public abstract classify(invoiceNumber: string, description: string): string;
  
  public abstract extractPurchaseOrder(description: string): string;
}