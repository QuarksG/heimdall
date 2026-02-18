import type { HeaderDef, CustomFieldDefs, TaxSchemeOption } from '../types/crtr.types';

export const ALL_HEADERS: HeaderDef[] = [
  { key: 'doc_invoice_id', label: 'Invoice Document ID' },
  { key: 'invoice_date', label: 'Invoice Date' },
  { key: 'invoice_amount', label: 'Invoice Amount' },
  { key: 'invoice_currency', label: 'Currency' },
  { key: 'LineType', label: 'Line Type' },
  { key: 'LineAmount', label: 'Line Amt' },
  { key: 'TaxCode', label: 'Tax Code' },
  { key: 'LineDescription', label: 'Description' },
  { key: 'supplier_name', label: 'Supplier' },
  { key: 'customer_name', label: 'Customer' },
  { key: 'doc_scenario', label: 'Document Scenario' },
  { key: 'order_reference_id', label: 'Order Reference ID' },
  { key: 'invoice_type_code', label: 'Invoice Type Code' },
  { key: 'Notes', label: 'Notes' },
  { key: 'uuid', label: 'UUID' },
  { key: 'VKN', label: 'VKN-GST ID' },
  { key: 'TCKN', label: 'TCKN-GST IS' },
  { key: 'vendorNum', label: 'Vendor Num' },
  { key: 'vendorSiteCode', label: 'Vendor Site Code' },
  { key: 'invoiceType', label: 'Invoice Type' },
  { key: 'termsName', label: 'Terms Name' },
  { key: 'paymentMethod', label: 'Payment Method' },
  { key: 'gl_entry', label: 'GL Account' },
  { key: 'generate_return_invoice', label: 'Generate Return Invoice' },
  { key: 'Paygroup', label: 'Paygroup' },
];

export const DEFAULT_HEADERS: HeaderDef[] = ALL_HEADERS.filter((h) =>
  [
    'doc_invoice_id',
    'invoice_date',
    'invoice_amount',
    'invoice_currency',
    'LineType',
    'LineAmount',
    'TaxCode',
    'LineDescription',
  ].includes(h.key)
);

export const CUSTOM_FIELD_DEFS: CustomFieldDefs = {
  vendorNum: { label: 'Vendor Num', type: 'text' },
  vendorSiteCode: { label: 'Vendor Site Code', type: 'text' },
  invoiceType: {
    label: 'Invoice Type',
    type: 'select',
    options: ['Standard', 'Credit_Memo', 'PrePayment'],
  },
  termsName: { label: 'Terms Name', type: 'text', placeholder: 'PAYABLE UPON RECEIPT' },
  Paygroup: {
    label: 'Paygroup',
    type: 'text',
    placeholder: 'ZERO',
  },
  paymentMethod: {
    label: 'Payment Method',
    type: 'select',
    options: [
      'Check',
      'Clearing',
      'Electronic',
      'Wire',
      'ELECTRONIC_FX4',
      'WIRE_FX4',
      'WIRE_H2H',
      'TED STR FOR BRAZIL',
      'BR EFT UTIL TAXES',
      'SUA_CARD',
      'BOLETO ELECTRONIC FOR BRAZIL',
      'NEFT',
    ],
  },
  generate_return_invoice: {
    label: 'Generate Return Invoice',
    type: 'select',
    options: ['MISC', 'FREIGHT', 'REJECTED_INVOICE'],
  },
};

export const TAX_SCHEME_OPTIONS: TaxSchemeOption[] = [
  { value: '', label: 'Automatic (Default)' },
  { value: 'KDV', label: 'KDV' },
  { value: 'W9', label: 'W9' },
  { value: 'HF', label: 'HF' },
  { value: 'TQ', label: 'TQ' },
  { value: 'B148', label: 'B148' },
  { value: 'JR', label: 'JR' },
  { value: 'B498', label: 'B498' },
  { value: 'B899', label: 'B899' },
  { value: 'B958', label: 'B958' },
];

export const DESCRIPTION_FIELD_OPTIONS: TaxSchemeOption[] = [
  { value: 'combined', label: 'Combined (All Fields)' },
  { value: 'itemName', label: 'Item Name' },
  { value: 'itemDescription', label: 'Item Description' },
  { value: 'buyersID', label: 'Buyer Item ID' },
  { value: 'sellersID', label: 'Seller Item ID' },
  { value: 'manufacturersID', label: 'Manufacturer Item ID' },
  { value: 'brandName', label: 'Brand Name' },
  { value: 'modelName', label: 'Model Name' },
  { value: 'allowanceReason', label: 'Allowance/Charge Reason' },
];