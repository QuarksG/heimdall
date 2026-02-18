export type HeaderDef = { key: string; label: string };

export type FieldDefType = 'text' | 'select';

export type CustomFieldDef = {
  label: string;
  type: FieldDefType;
  placeholder?: string;
  options?: string[];
};

export type CustomFieldDefs = Record<string, CustomFieldDef>;

export type TaxSchemeOption = { value: string; label: string };

export type DescriptionFieldChoice =
  | 'combined'
  | 'itemName'
  | 'itemDescription'
  | 'buyersID'
  | 'sellersID'
  | 'manufacturersID'
  | 'brandName'
  | 'modelName'
  | 'allowanceReason';

export interface ParsedInputFile {
  name: string;
  content: string;
}

export interface CustomFieldConfig {
  Item: {
    vendorNum: string;
    vendorSiteCode: string;
    invoiceType: string;
    termsName: string;
    paymentMethod: string;
    glAccount: string;
    Paygroup: string;
    generate_return_invoice: string;
  };
  Tax: {
    glAccount: Record<string, string>;
    taxSchemeOverride: string;
  };
}

export interface DocumentTaxSubtotal {
  taxCode: string;
  amount: number;
  rate: number;
  taxableAmount: number | null;
  scheme: string;
}

export interface DocumentTaxes {
  totalTax: number;
  subtotals: Record<string, DocumentTaxSubtotal>;
  subtotalGroups: DocumentTaxSubtotal[];
}

export interface LineTaxGroup {
  taxCode: string;
  totalLineAmount: number;
  totalTaxAmount: number;
  taxRate: number;
  taxScheme: string;
  LineDescription: string;
}

export interface ValidationReport {
  isValid: boolean;
  warnings: string[];
  corrections: Record<string, unknown>;
  reconciledTaxAmounts: Record<string, number>;
}

export interface ExcelRow {
  [key: string]: unknown;
  doc_invoice_id?: string | null;
  invoice_date?: string | null;
  invoice_amount?: string | null;
  invoice_currency?: string | null;
  supplier_name?: string | null;
  customer_name?: string | null;
  uuid?: string | null;
  LineType?: string;
  LineAmount?: string;
  TaxCode?: string;
  LineDescription?: string;
  Notes?: string | null;
}

export interface ProcessingError {
  name: string;
  message: string;
}

export interface SummaryData {
  count: number;
  totalInvoiceAmount: number;
  totalCalculatedAmount: number;
}

export type LineItemDetail = {
  lineAmount: number;
  lineTax: number;
  taxRate: number;
  taxScheme: string;
  description: string;
};

/* ─── Component prop interfaces ─── */

export interface HeaderProps {
  onSearch: (query: string) => void;
}

export interface UploadSectionProps {
  onFilesSelected: (files: FileList | null) => void;
  onShowConfig: () => void;
  onExport: () => void;
}

export interface CustomFieldsPanelProps {
  show: boolean;
  config: CustomFieldConfig;
  descriptionField: DescriptionFieldChoice;
  onConfigChange: React.Dispatch<React.SetStateAction<CustomFieldConfig>>;
  onDescriptionFieldChange: React.Dispatch<React.SetStateAction<DescriptionFieldChoice>>;
  onApply: () => void;
  onCancel: () => void;
  uniqueTaxCodes: string[];
}

export interface ColumnSelectorProps {
  allHeaders: HeaderDef[];
  selectedHeaders: HeaderDef[];
  onToggle: (key: string) => void;
}

export interface DataTableProps {
  data: ExcelRow[];
  headers: HeaderDef[];
}

export interface SummaryPanelProps {
  summary: SummaryData;
}