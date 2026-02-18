import { XMLToExcelConverter } from './xmlParser';
import type { FieldDefinition } from '../constants/fieldDefinitions';

export interface InvoiceLine {
  id: string;
  name: string;
  quantity: number;
  unitCode: string;
  priceAmount: number;
  priceCurrency: string;
  lineExtensionAmount: number;
  lineExtensionCurrency: string;
}

export interface ExtractedInvoiceData {
  id: string;
  uuid: string;
  profileId: string;
  invoiceTypeCode: string;
  issueDate: string;
  issueTime: string;
  supplierName: string;
  supplierId: string;
  customerName: string;
  customerId: string;
  payableAmount: number;
  documentCurrency: string;
  taxExclusiveAmount: number;
  taxInclusiveAmount: number;
  lines: InvoiceLine[];
  [key: string]: any;
}

const conversionFieldDefinitions: FieldDefinition[] = [
  { key: 'id', label: 'ID', xpaths: ['//cbc:ID'] },
  { key: 'uuid', label: 'UUID', xpaths: ['//cbc:UUID'] },
  { key: 'profileId', label: 'Profile ID', xpaths: ['//cbc:ProfileID'] },
  { key: 'invoiceTypeCode', label: 'Invoice Type', xpaths: ['//cbc:InvoiceTypeCode'] },
  { key: 'issueDate', label: 'Issue Date', xpaths: ['//cbc:IssueDate'] },
  { key: 'issueTime', label: 'Issue Time', xpaths: ['//cbc:IssueTime'] },
  { key: 'supplierName', label: 'Supplier Name', xpaths: ['//cac:AccountingSupplierParty/cac:Party/cac:PartyName/cbc:Name', '//cac:AccountingSupplierParty/cac:Party/cac:Person/cbc:FirstName'] },
  { key: 'supplierId', label: 'Supplier ID', xpaths: ['//cac:AccountingSupplierParty/cac:Party/cac:PartyIdentification/cbc:ID'] },
  { key: 'customerName', label: 'Customer Name', xpaths: ['//cac:AccountingCustomerParty/cac:Party/cac:PartyName/cbc:Name'] },
  { key: 'customerId', label: 'Customer ID', xpaths: ['//cac:AccountingCustomerParty/cac:Party/cac:PartyIdentification/cbc:ID'] },
  { key: 'payableAmount', label: 'Payable Amount', xpaths: ['//cac:LegalMonetaryTotal/cbc:PayableAmount'] },
  { key: 'documentCurrency', label: 'Currency', xpaths: ['//cac:LegalMonetaryTotal/cbc:PayableAmount'], attribute: 'currencyID' },
  { key: 'taxExclusiveAmount', label: 'Tax Exclusive', xpaths: ['//cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount'] },
  { key: 'taxInclusiveAmount', label: 'Tax Inclusive', xpaths: ['//cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount'] },
];

const lineItemDefinitions: FieldDefinition[] = [
  { key: 'id', label: 'ID', isLineItem: true, xpaths: ['.//cbc:ID'] },
  { key: 'name', label: 'Name', isLineItem: true, xpaths: ['.//cac:Item/cbc:Name'] },
  { key: 'quantity', label: 'Quantity', isLineItem: true, xpaths: ['.//cbc:InvoicedQuantity'] },
  { key: 'unitCode', label: 'Unit', isLineItem: true, xpaths: ['.//cbc:InvoicedQuantity'], attribute: 'unitCode' },
  { key: 'priceAmount', label: 'Price', isLineItem: true, xpaths: ['.//cac:Price/cbc:PriceAmount'] },
  { key: 'priceCurrency', label: 'Currency', isLineItem: true, xpaths: ['.//cac:Price/cbc:PriceAmount'], attribute: 'currencyID' },
  { key: 'lineExtensionAmount', label: 'Total', isLineItem: true, xpaths: ['.//cbc:LineExtensionAmount'] },
  { key: 'lineExtensionCurrency', label: 'Currency', isLineItem: true, xpaths: ['.//cbc:LineExtensionAmount'], attribute: 'currencyID' }
];

export const extractInvoiceData = (xmlContent: string): ExtractedInvoiceData => {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlContent, "text/xml");
  
  const parserError = xmlDoc.querySelector("parsererror");
  if (parserError) throw new Error("Invalid XML structure");

  const converter = new XMLToExcelConverter();
  const documentData: any = {};
  
  conversionFieldDefinitions.forEach(field => {
    documentData[field.key] = converter.extractValue(xmlDoc, field);
  });

  const lines = converter.processLineItems(xmlDoc, lineItemDefinitions, documentData).map((line: any) => ({
    id: line.id || '',
    name: line.name || '',
    quantity: parseFloat(line.quantity) || 0,
    unitCode: line.unitCode || '',
    priceAmount: parseFloat(line.priceAmount) || 0,
    priceCurrency: line.priceCurrency || 'TRY',
    lineExtensionAmount: parseFloat(line.lineExtensionAmount) || 0,
    lineExtensionCurrency: line.lineExtensionCurrency || 'TRY'
  }));

  return {
    id: documentData.id || `INV_${Date.now()}`,
    uuid: documentData.uuid || `UUID_${Date.now()}`,
    profileId: documentData.profileId,
    invoiceTypeCode: documentData.invoiceTypeCode,
    issueDate: documentData.issueDate,
    issueTime: documentData.issueTime,
    supplierName: documentData.supplierName || "Unknown Supplier",
    supplierId: documentData.supplierId,
    customerName: documentData.customerName || "Unknown Customer",
    customerId: documentData.customerId,
    payableAmount: parseFloat(documentData.payableAmount) || 0,
    documentCurrency: documentData.documentCurrency || 'TRY',
    taxExclusiveAmount: parseFloat(documentData.taxExclusiveAmount) || 0,
    taxInclusiveAmount: parseFloat(documentData.taxInclusiveAmount) || 0,
    lines
  };
};