export interface InvoiceLineItem {
  id: string;
  asin?: string;
  upc?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  poNumber?: string;
}

export interface Invoice {
  id: string; // Internal ID
  invoiceNumber: string;
  invoiceDate: string;
  vendorName: string;
  totalAmount: number;
  currency: string;
  items: InvoiceLineItem[];
  rawContent?: any; // To store original XML/JSON if needed
  fileName: string;
}