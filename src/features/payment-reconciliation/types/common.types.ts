import { DataSource, CurrencyCode } from '../constants/paymentTypes';
import { InvoiceCategory } from '../constants/invoiceCategories';

export interface BaseTransactionRecord {
  id: string;
  source: DataSource;
  date: Date;
  amount: number;
  currency: CurrencyCode;
  referenceNumber: string;
  description: string;
}

export interface OfaRemittanceRecord extends BaseTransactionRecord {
  rowNumber: number;
  payeeName: string;
  vendorSiteId: string;
  paymentNumber: string;
  paymentDate: Date;
  invoiceNumber: string;
  invoiceDate: Date;
  purchaseOrderNumber: string;
  discountAmount: number;
  creditAmount: number;
  debitAmount: number;
  balanceAmount: number;
  category: InvoiceCategory;
  rawCategory: string;
}