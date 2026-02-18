export interface FieldValidation {
  pattern: RegExp;
  message: string;
}

export interface FieldDefinition {
  key: string;
  label: string;
  isLineItem?: boolean;
  customHandler?: string;
  xpaths?: string[];
  attribute?: string;
  validation?: FieldValidation;
}

export const initialFieldDefinitions: FieldDefinition[] = [
  {
    key: 'doc_invoice_id',
    label: 'Invoice ID',
    xpaths: ['//cbc:ID'],
  },
  {
    key: 'supplier_name',
    label: 'Supplier Name',
    xpaths: [
      '//cac:AccountingSupplierParty/cac:Party/cac:PartyName/cbc:Name',
      '//cac:AccountingSupplierParty/cac:Party/cbc:PartyName/cbc:Name',
      '//cac:AccountingSupplierParty/cac:Party/cac:Person/cbc:FirstName',
    ],
  },
  {
    key: 'customer_name',
    label: 'Customer Name',
    xpaths: ['//cac:AccountingCustomerParty/cac:Party/cac:PartyName/cbc:Name'],
  },
  {
    key: 'invoice_date',
    label: 'Invoice Date',
    xpaths: ['//cbc:IssueDate'],
  },
  {
    key: 'invoice_time',
    label: 'Invoice Time',
    xpaths: ['//cbc:IssueTime'],
  },
  {
    key: 'invoice_amount',
    label: 'Invoice Amount',
    xpaths: ['//cac:LegalMonetaryTotal/cbc:PayableAmount'],
  },
  {
    key: 'invoice_currency',
    label: 'Invoice Currency',
    xpaths: ['//cac:LegalMonetaryTotal/cbc:PayableAmount'],
    attribute: 'currencyID',
  },
  {
    key: 'customer_id',
    label: 'Customer ID',
    xpaths: ['//cac:AccountingCustomerParty/cac:Party/cac:PartyIdentification/cbc:ID'],
  },
  {
    key: 'supplier_id',
    label: 'Supplier ID',
    xpaths: ['//cac:AccountingSupplierParty/cac:Party/cac:PartyIdentification/cbc:ID'],
  },
  {
    key: 'VKN',
    label: 'VKN',
    xpaths: [
      '//cac:AccountingSupplierParty/cac:Party/cac:PartyIdentification/cbc:ID[@schemeID="VKN"]',
      '//cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID[@schemeID="VKN"]',
      '//cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:CompanyID[@schemeID="VKN"]',
      '//cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID',
      '//cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:CompanyID',
    ],
    validation: {
      pattern: /^\d{10}$/,
      message: 'VKN 10 haneli rakamlardan oluşmalıdır',
    },
  },
  {
    key: 'TCKN',
    label: 'TCKN',
    xpaths: [
      '//cac:AccountingSupplierParty/cac:Party/cac:PartyIdentification/cbc:ID[@schemeID="TCKN"]',
      '//cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID[@schemeID="TCKN"]',
      '//cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:CompanyID[@schemeID="TCKN"]',
      '//cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID',
      '//cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:CompanyID',
    ],
    validation: {
      pattern: /^\d{11}$/,
      message: 'TCKN 11 haneli rakamlardan oluşmalıdır',
    },
  },
  {
    key: 'musterino',
    label: 'MUSTERINO',
    xpaths: ['//cbc:ID[@schemeID="MUSTERINO"]'],
  },
  {
    key: 'doc_scenario',
    label: 'Scenario',
    xpaths: ['//cbc:ProfileID'],
  },
  {
    key: 'invoice_type_code',
    label: 'Invoice Type',
    xpaths: ['//cbc:InvoiceTypeCode'],
  },
  {
    key: 'uuid',
    label: 'UUID',
    xpaths: ['//cbc:UUID'],
  },
  {
    key: 'signing_time',
    label: 'Signing Time',
    xpaths: ['//xades:SigningTime'],
  },
  {
    key: 'order_reference_id',
    label: 'Order Reference',
    xpaths: ['//cac:OrderReference/cbc:ID'],
  },
  {
    key: 'invoice_document_reference_id',
    label: 'Invoice Document Reference',
    customHandler: 'extractInvoiceRef',
  },
  {
    key: 'delivery_note',
    label: 'Delivery Note',
    customHandler: 'extractDeliveryNote',
  },
  {
    key: 'Notes',
    label: 'Note',
    xpaths: ['//cbc:Note'],
  },
  {
    key: 'customer_email',
    label: 'Customer Email',
    xpaths: ['//cac:AccountingCustomerParty/cac:Party/cac:Contact/cbc:ElectronicMail'],
  },
  {
    key: 'supplier_email',
    label: 'Supplier Email',
    xpaths: ['//cac:AccountingSupplierParty/cac:Party/cac:Contact/cbc:ElectronicMail'],
  },
  {
    key: 'tax_address',
    label: 'Tax Address',
    xpaths: ['//cac:PartyTaxScheme/cac:TaxScheme/cbc:Name'],
  },
  {
    key: 'customer_address',
    label: 'Customer Address',
    customHandler: 'extractCustomerAddress',
  },
  {
    key: 'doc_tax_amount',
    label: 'Document Tax Amount',
    xpaths: ['//cac:TaxTotal/cbc:TaxAmount'],
  },
  {
    key: 'doc_tax_currency',
    label: 'Document Tax Currency',
    xpaths: ['//cac:TaxTotal/cbc:TaxAmount'],
    attribute: 'currencyID',
  },
  {
    key: 'doc_tax_rate',
    label: 'Document Tax Rate (%)',
    xpaths: ['//cac:TaxTotal/cac:TaxSubtotal/cbc:Percent'],
  },
  {
    key: 'doc_tax_name',
    label: 'Tax Type',
    xpaths: ['//cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cac:TaxScheme/cbc:Name'],
  },
  {
    key: 'doc_tax_type_code',
    label: 'Tax Type Code',
    xpaths: ['//cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode'],
  },
  {
    key: 'item_name',
    label: 'Item Name',
    isLineItem: true,
    xpaths: ['.//cac:Item/cbc:Name'],
  },
  {
    key: 'description',
    label: 'Invoice Item Description',
    isLineItem: true,
    xpaths: ['.//cac:Item/cbc:Description'],
  },
  {
    key: 'BuyersItemIdentification',
    label: "Buyer's Item Identification",
    isLineItem: true,
    xpaths: ['.//cac:Item/cac:BuyersItemIdentification/cbc:ID'],
  },
  {
    key: 'sellers_item_identification',
    label: "Seller's Item Identification",
    isLineItem: true,
    xpaths: ['.//cac:Item/cac:SellersItemIdentification/cbc:ID'],
  },
  {
    key: 'manufacturers_item_identification',
    label: "Manufacturer's Item Identification",
    isLineItem: true,
    xpaths: ['.//cac:Item/cac:ManufacturersItemIdentification/cbc:ID'],
  },
  {
    key: 'brand_name',
    label: 'Brand Name',
    isLineItem: true,
    xpaths: ['.//cac:Item/cbc:BrandName'],
  },
  {
    key: 'model_name',
    label: 'Model Name',
    isLineItem: true,
    xpaths: ['.//cac:Item/cbc:ModelName'],
  },
  {
    key: 'invoice_line_quantity',
    label: 'Invoice Line Quantity',
    isLineItem: true,
    xpaths: ['.//cbc:InvoicedQuantity', './/cbc:DeliveredQuantity'],
  },
  {
    key: 'unit_of_measure',
    label: 'Unit of Measure',
    isLineItem: true,
    xpaths: ['.//cbc:InvoicedQuantity', './/cbc:DeliveredQuantity'],
    attribute: 'unitCode',
  },
  {
    key: 'unit_price',
    label: 'Unit Price',
    isLineItem: true,
    xpaths: ['.//cac:Price/cbc:PriceAmount'],
  },
  {
    key: 'line_total',
    label: 'Line Total',
    isLineItem: true,
    xpaths: ['.//cbc:LineExtensionAmount'],
  },
  {
    key: 'tax_amount',
    label: 'Tax Amount (Line)',
    isLineItem: true,
    xpaths: ['.//cac:TaxTotal/cbc:TaxAmount'],
  },
  {
    key: 'tax_currency',
    label: 'Tax Currency (Line)',
    isLineItem: true,
    xpaths: ['.//cac:TaxTotal/cbc:TaxAmount'],
    attribute: 'currencyID',
  },
  {
    key: 'tax_rate',
    label: 'Tax Rate % (Line)',
    isLineItem: true,
    xpaths: ['.//cac:TaxTotal/cac:TaxSubtotal/cbc:Percent'],
  },
];

export const getDefaultHeaders = (): FieldDefinition[] => {
  return initialFieldDefinitions.filter((field) =>
    [
      'doc_invoice_id',
      'supplier_name',
      'customer_name',
      'invoice_date',
      'invoice_amount',
      'invoice_currency',
      'customer_id',
      'supplier_id',
    ].includes(field.key)
  );
};

export const getLineItemFields = (): FieldDefinition[] => {
  return initialFieldDefinitions.filter((field) => field.isLineItem === true);
};

export const getDocumentLevelFields = (): FieldDefinition[] => {
  return initialFieldDefinitions.filter((field) => !field.isLineItem);
};

export const getFieldsByCategory = () => {
  return {
    identification: initialFieldDefinitions.filter((f) =>
      ['doc_invoice_id', 'supplier_id', 'customer_id', 'VKN', 'TCKN', 'musterino', 'uuid'].includes(f.key)
    ),
    parties: initialFieldDefinitions.filter((f) =>
      ['supplier_name', 'customer_name', 'supplier_email', 'customer_email', 'customer_address', 'tax_address'].includes(f.key)
    ),
    dates: initialFieldDefinitions.filter((f) =>
      ['invoice_date', 'invoice_time', 'signing_time'].includes(f.key)
    ),
    amounts: initialFieldDefinitions.filter((f) =>
      ['invoice_amount', 'invoice_currency', 'doc_tax_amount', 'doc_tax_currency'].includes(f.key)
    ),
    references: initialFieldDefinitions.filter((f) =>
      ['order_reference_id', 'invoice_document_reference_id', 'delivery_note'].includes(f.key)
    ),
    metadata: initialFieldDefinitions.filter((f) =>
      ['doc_scenario', 'invoice_type_code', 'Notes'].includes(f.key)
    ),
    tax: initialFieldDefinitions.filter((f) => f.key.includes('tax') && !f.isLineItem),
    lineItems: getLineItemFields(),
  };
};

export const validateFieldValue = (fieldKey: string, value: string): { valid: boolean; message: string } => {
  const def = initialFieldDefinitions.find((f) => f.key === fieldKey);
  if (!def?.validation) return { valid: true, message: '' };

  const trimmed = (value ?? '').trim();
  if (!trimmed) return { valid: true, message: '' };

  const valid = def.validation.pattern.test(trimmed);
  return { valid, message: valid ? '' : def.validation.message };
};