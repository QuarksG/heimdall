import { XMLToExcelConverter } from '../../invoice-parsing/utils/xmlParser';
import type {
  DescriptionFieldChoice,
  CustomFieldConfig,
  DocumentTaxSubtotal,
  DocumentTaxes,
  LineTaxGroup,
  LineItemDetail,
  ValidationReport,
  ExcelRow,
  TaxMismatchDetail,
} from '../types/crtr.types';


function formatTaxRate(rate: number): string {
  const fixed = rate.toFixed(2);
  return fixed.endsWith('.00') ? String(Math.round(rate)) : fixed;
}


export class CrtrXmlProcessor {
  private converter: XMLToExcelConverter;
  private processedSuppliers: Set<string>;

  constructor() {
    this.converter = new XMLToExcelConverter();
    this.processedSuppliers = new Set();
  }



  transformXML(xmlContent: string): Document | null {
    return this.converter.transformXML(xmlContent);
  }

  
  extractInfo(xmlNode: Node, xpath: string, attribute: string | null = null): string | null {
    const result = this.converter.xpathEvaluator.evaluate(
      xpath,
      xmlNode,
      XMLToExcelConverter.namespaceResolver,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    ).singleNodeValue;

    return result
      ? attribute
        ? (result as Element).getAttribute(attribute)
        : result.textContent
      : null;
  }

 
  extractAll(xmlNode: Node, xpath: string): string {
    const result = this.converter.xpathEvaluator.evaluate(
      xpath,
      xmlNode,
      XMLToExcelConverter.namespaceResolver,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null
    );
    return Array.from({ length: result.snapshotLength }, (_, i) => result.snapshotItem(i)?.textContent || '')
      .filter(Boolean)
      .join(', ');
  }


  private snapshotNodes(xmlNode: Node, xpath: string): XPathResult {
    return this.converter.xpathEvaluator.evaluate(
      xpath,
      xmlNode,
      XMLToExcelConverter.namespaceResolver,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null
    );
  }

  resetSupplierTracking(): void {
    this.processedSuppliers.clear();
  }



  extractTaxScheme(contextNode: Node, rootNode: Node): string {
    let scheme = this.extractInfo(contextNode, './/cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cac:TaxScheme/cbc:Name');
    if (scheme) return scheme;

    scheme = this.extractInfo(contextNode, './/cac:Item/cac:ClassifiedTaxCategory/cac:TaxScheme/cbc:Name');
    if (scheme) return scheme;

    scheme = this.extractInfo(rootNode, '//cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cac:TaxScheme/cbc:Name');
    if (scheme) return scheme;

    scheme = this.extractInfo(
      rootNode,
      '//cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cac:TaxScheme/cbc:Name'
    );
    if (scheme) return scheme;

    return 'KDV';
  }


  detectTaxMismatch(
    lineGroups: Record<string, LineTaxGroup>,
    documentTaxes: DocumentTaxes,
    invoiceId: string,
    fileName: string
  ): TaxMismatchDetail | null {
    const lineGroupCodes = Object.keys(lineGroups);
    const documentCodes = Object.keys(documentTaxes.subtotals);

    
    const missingInLines = documentCodes.filter((code) => !lineGroups[code]);

    if (missingInLines.length === 0) return null;

    const message =
      `Invoice ${invoiceId}: Document declares ${documentCodes.length} tax regime(s) ` +
      `[${documentCodes.join(', ')}] but line-level grouping only produced ` +
      `[${lineGroupCodes.join(', ')}]. Missing: [${missingInLines.join(', ')}]. ` +
      `Line-level tax rates may be incorrectly stamped by supplier.`;

    return {
      invoiceId,
      fileName,
      lineGroupCodes,
      documentCodes,
      missingInLines,
      message,
    };
  }



  extractAndGroupLineItems(
    xmlNode: Node,
    descriptionFieldChoice: DescriptionFieldChoice,
    documentTaxGroups: DocumentTaxSubtotal[] | null,
    taxSchemeOverride: string = '',
    customDescription: string = '',
    useDocumentOverride: boolean = false
  ): LineTaxGroup[] {
    const lineItemsDetail: LineItemDetail[] = [];
    const invoiceLines = this.snapshotNodes(xmlNode, '//cac:InvoiceLine');

    for (let i = 0; i < invoiceLines.snapshotLength; i++) {
      const line = invoiceLines.snapshotItem(i);
      if (!line) continue;

      const lineTotal = this.extractInfo(line, './/cbc:LineExtensionAmount');
      if (!lineTotal) continue;

      const lineAmount = parseFloat(lineTotal);

      let lineTaxRate: string | null = null;
      let lineTaxScheme: string = this.extractTaxScheme(line, xmlNode);
      let lineTaxAmount: string | null = null;
      let overrideApplied = false;

      if (useDocumentOverride && documentTaxGroups && documentTaxGroups.length > 0) {
  
        const matched = this.matchLineToDocumentSubtotal(lineAmount, documentTaxGroups);

        if (matched) {
          lineTaxRate = String(matched.rate);
          lineTaxScheme = matched.scheme;
          // Compute tax from document rate, not from line-level TaxAmount
          lineTaxAmount = String(lineAmount * (matched.rate / 100));
          overrideApplied = true;
        }
      }

      if (!overrideApplied) {
        // ─── Normal mode: trust line-level Percent ───
        lineTaxRate =
          this.extractInfo(line, './/cac:TaxTotal/cac:TaxSubtotal/cbc:Percent') ||
          this.extractInfo(line, './/cac:Item/cac:ClassifiedTaxCategory/cbc:Percent');

        lineTaxAmount = this.extractInfo(line, './/cac:TaxTotal/cbc:TaxAmount');

        if (!lineTaxRate && lineTotal && documentTaxGroups) {
          const tolerance = 0.02;
          for (const group of documentTaxGroups) {
            if (group.rate) {
              const testTax = lineAmount * (group.rate / 100);
              if (Math.abs(testTax - group.amount) < tolerance) {
                lineTaxRate = String(group.rate);
                lineTaxScheme = group.scheme;
                break;
              }
            }
          }
        }
      }

      const selectedDescription = this.buildDescription(line, descriptionFieldChoice, customDescription);

      const taxRate = parseFloat(lineTaxRate ?? '0') || 0;
      const lineTax = lineTaxAmount ? parseFloat(lineTaxAmount) : (lineAmount * taxRate) / 100;

      const finalTaxScheme = taxSchemeOverride && taxSchemeOverride !== '' ? taxSchemeOverride : lineTaxScheme;

      lineItemsDetail.push({
        lineAmount,
        lineTax,
        taxRate,
        taxScheme: finalTaxScheme,
        description: selectedDescription,
      });
    }

    const taxRegimeGroups: Record<string, LineTaxGroup> = {};

    lineItemsDetail.forEach((item) => {
      const taxCode = `${item.taxScheme}-TR-${formatTaxRate(item.taxRate)}%`;

      if (!taxRegimeGroups[taxCode]) {
        taxRegimeGroups[taxCode] = {
          totalLineAmount: 0,
          totalTaxAmount: 0,
          taxRate: item.taxRate,
          taxScheme: item.taxScheme,
          taxCode,
          LineDescription: item.description,
        };
      }

      taxRegimeGroups[taxCode]!.totalLineAmount += item.lineAmount;
      taxRegimeGroups[taxCode]!.totalTaxAmount += item.lineTax;
    });

    return Object.values(taxRegimeGroups);
  }

 
  private documentSubtotalCapacity: Map<string, number> = new Map();

  resetDocumentSubtotalCapacity(subtotals: DocumentTaxSubtotal[]): void {
    this.documentSubtotalCapacity.clear();
    for (const sub of subtotals) {
      if (sub.taxableAmount !== null) {
        this.documentSubtotalCapacity.set(sub.taxCode, sub.taxableAmount);
      }
    }
  }

  private matchLineToDocumentSubtotal(
    lineAmount: number,
    documentTaxGroups: DocumentTaxSubtotal[]
  ): DocumentTaxSubtotal | null {
    const tolerance = 0.02;

  
    for (const group of documentTaxGroups) {
      if (group.taxableAmount !== null) {
        if (Math.abs(lineAmount - group.taxableAmount) < tolerance) {
          return group;
        }
      }
    }

    
    for (const group of documentTaxGroups) {
      const remaining = this.documentSubtotalCapacity.get(group.taxCode);
      if (remaining !== undefined && remaining >= lineAmount - tolerance) {
        // Deduct this line from the remaining capacity
        this.documentSubtotalCapacity.set(group.taxCode, remaining - lineAmount);
        return group;
      }
    }

    return null;
  }



  extractDocumentLevelTaxTotals(xmlNode: Node, taxSchemeOverride: string = ''): DocumentTaxes {
    const documentTaxTotal = this.extractInfo(xmlNode, '/*/cac:TaxTotal[not(ancestor::cac:InvoiceLine)]/cbc:TaxAmount');
    const documentTotalTax = documentTaxTotal ? parseFloat(documentTaxTotal) : 0;

    const taxSubtotals: Record<string, DocumentTaxSubtotal> = {};
    const subtotalGroups: DocumentTaxSubtotal[] = [];

    const subtotals = this.snapshotNodes(xmlNode, '/*/cac:TaxTotal[not(ancestor::cac:InvoiceLine)]/cac:TaxSubtotal');

    for (let i = 0; i < subtotals.snapshotLength; i++) {
      const subtotal = subtotals.snapshotItem(i);
      if (!subtotal) continue;

      const taxAmount = this.extractInfo(subtotal, './/cbc:TaxAmount');
      const taxRate = this.extractInfo(subtotal, './/cbc:Percent');
      const taxableAmount = this.extractInfo(subtotal, './/cbc:TaxableAmount');

      const taxScheme = this.extractInfo(subtotal, './/cac:TaxCategory/cac:TaxScheme/cbc:Name') || 'KDV';
      const finalTaxScheme = taxSchemeOverride && taxSchemeOverride !== '' ? taxSchemeOverride : taxScheme;

      if (taxAmount && taxRate) {
        const rate = parseFloat(taxRate);
        const taxCode = `${finalTaxScheme}-TR-${formatTaxRate(rate)}%`;

        const subtotalData: DocumentTaxSubtotal = {
          taxCode,
          amount: parseFloat(taxAmount),
          rate,
          taxableAmount: taxableAmount ? parseFloat(taxableAmount) : null,
          scheme: finalTaxScheme,
        };

        taxSubtotals[taxCode] = subtotalData;
        subtotalGroups.push(subtotalData);
      }
    }

    return { totalTax: documentTotalTax, subtotals: taxSubtotals, subtotalGroups };
  }

 

  validateAndReconcileTaxes(
    lineGroups: Record<string, LineTaxGroup>,
    documentTaxes: DocumentTaxes,
    invoiceTotal: string | null | undefined
  ): ValidationReport {
    const validation: ValidationReport = {
      isValid: true,
      warnings: [],
      corrections: {},
      reconciledTaxAmounts: {},
    };

    const lineGroupValues = Object.values(lineGroups);
    const lineItemTotal = lineGroupValues.reduce((sum, group) => sum + group.totalLineAmount, 0);
    const lineTaxTotal = lineGroupValues.reduce((sum, group) => sum + group.totalTaxAmount, 0);
    const calculatedInvoiceTotal = lineItemTotal + lineTaxTotal;

    const invoiceTotalNum = parseFloat(String(invoiceTotal ?? 0));
    const invoiceTotalDiff = Math.abs(calculatedInvoiceTotal - invoiceTotalNum);

    if (invoiceTotalDiff > 0.02) {
      validation.warnings.push(
        `Invoice total mismatch: Expected ${String(invoiceTotal ?? 0)}, Calculated ${calculatedInvoiceTotal.toFixed(2)}`
      );
    }

    if (documentTaxes.totalTax) {
      const taxTotalDiff = Math.abs(documentTaxes.totalTax - lineTaxTotal);
      if (taxTotalDiff > 0.02) {
        validation.warnings.push(
          `Tax total mismatch: Document says ${documentTaxes.totalTax.toFixed(2)}, Lines sum to ${lineTaxTotal.toFixed(2)}`
        );
      }
    }

    Object.entries(lineGroups).forEach(([taxCode, group]) => {
      const documentSubtotal = documentTaxes.subtotals[taxCode];

      if (documentSubtotal) {
        const taxDiff = Math.abs(documentSubtotal.amount - group.totalTaxAmount);

        if (taxDiff > 0.02) {
          validation.corrections[taxCode] = {
            original: group.totalTaxAmount,
            corrected: documentSubtotal.amount,
            reason: 'Using document-level tax total',
          };
          validation.reconciledTaxAmounts[taxCode] = documentSubtotal.amount;
        } else {
          validation.reconciledTaxAmounts[taxCode] = group.totalTaxAmount;
        }

        if (documentSubtotal.taxableAmount) {
          const expectedTax = documentSubtotal.taxableAmount * (documentSubtotal.rate / 100);
          const calcDiff = Math.abs(expectedTax - documentSubtotal.amount);
          if (calcDiff > 0.02) {
            validation.warnings.push(
              `Tax calculation issue for ${taxCode}: ${documentSubtotal.rate}% of ${documentSubtotal.taxableAmount} should be ${expectedTax.toFixed(2)}, but is ${documentSubtotal.amount}`
            );
          }
        }
      } else {
        validation.reconciledTaxAmounts[taxCode] = group.totalTaxAmount;
      }
    });

    Object.entries(documentTaxes.subtotals).forEach(([taxCode, subtotal]) => {
      if (!lineGroups[taxCode]) {
        validation.warnings.push(
          `Document has tax ${taxCode} with amount ${subtotal.amount}, but no corresponding line items found`
        );
      }
    });

    if (validation.warnings.length > 0 || Object.keys(validation.corrections).length > 0) {
      console.log('Tax Validation Report:', validation);
    }

    return validation;
  }



  extractDataForExcel(
    xmlDoc: Document,
    customFieldsConfig: {
      customData: CustomFieldConfig;
      descriptionField: DescriptionFieldChoice;
      customDescription?: string;
      useDocumentOverride?: boolean;
    },
    fileName: string = ''
  ): { rows: ExcelRow[]; mismatch: TaxMismatchDetail | null } {
    const {
      customData,
      descriptionField,
      customDescription = '',
      useDocumentOverride = false,
    } = customFieldsConfig;
    const taxSchemeOverride = customData.Tax.taxSchemeOverride || '';

    const headerData: ExcelRow = {
      doc_invoice_id: this.extractInfo(xmlDoc, '//cbc:ID'),
      invoice_doc_reference:
        this.extractInfo(xmlDoc, '//cac:BillingReference/cac:InvoiceDocumentReference/cbc:ID') ||
        this.extractInfo(xmlDoc, '//cac:InvoiceDocumentReference/cbc:ID'),
      supplier_name: this.extractInfo(xmlDoc, '//cac:AccountingSupplierParty/cac:Party/cac:PartyName/cbc:Name'),
      customer_name: this.extractInfo(xmlDoc, '//cac:AccountingCustomerParty/cac:Party/cac:PartyName/cbc:Name'),
      invoice_date: this.extractInfo(xmlDoc, '//cbc:IssueDate'),
      invoice_time: this.extractInfo(xmlDoc, '//cbc:IssueTime'),
      invoice_amount: this.extractInfo(xmlDoc, '//cac:LegalMonetaryTotal/cbc:PayableAmount'),
      invoice_currency: this.extractInfo(xmlDoc, '//cac:LegalMonetaryTotal/cbc:PayableAmount', 'currencyID'),
      VKN: this.extractInfo(xmlDoc, '//cac:AccountingSupplierParty/cac:Party/cac:PartyIdentification/cbc:ID[@schemeID="VKN"]'),
      TCKN: this.extractInfo(xmlDoc, '//cac:AccountingSupplierParty/cac:Party/cac:PartyIdentification/cbc:ID[@schemeID="TCKN"]'),
      doc_scenario: this.extractInfo(xmlDoc, '//cbc:ProfileID'),
      order_reference_id: this.extractInfo(xmlDoc, '//cac:OrderReference/cbc:ID'),
      invoice_type_code: this.extractInfo(xmlDoc, '//cbc:InvoiceTypeCode'),
      Notes: this.extractAll(xmlDoc, '//cbc:Note'),
      uuid: this.extractInfo(xmlDoc, '//cbc:UUID'),
    };

  
    if (this.processedSuppliers.size > 0) {
      const supplier = headerData.supplier_name;
      if (typeof supplier === 'string' && supplier.length > 0 && !this.processedSuppliers.has(supplier)) {
        throw new Error('Multiple suppliers detected. Only one supplier can be processed at a time.');
      }
    }
    if (typeof headerData.supplier_name === 'string' && headerData.supplier_name.length > 0) {
      this.processedSuppliers.add(headerData.supplier_name);
    } else {
      console.warn('Supplier name is missing in XML:', headerData.doc_invoice_id);
    }

    const itemCustomFields = {
      vendorNum: customData.Item.vendorNum,
      vendorSiteCode: customData.Item.vendorSiteCode,
      invoiceType: customData.Item.invoiceType,
      termsName: customData.Item.termsName,
      paymentMethod: customData.Item.paymentMethod,
      gl_entry: customData.Item.glAccount,
      Paygroup: customData.Item.Paygroup,
      generate_return_invoice: customData.Item.generate_return_invoice,
    };

    const taxGlAccounts = customData.Tax.glAccount || { default: '' };

    const documentTaxes = this.extractDocumentLevelTaxTotals(xmlDoc, taxSchemeOverride);

    
    if (useDocumentOverride) {
      this.resetDocumentSubtotalCapacity(documentTaxes.subtotalGroups);
    }

    const taxRegimeGroups = this.extractAndGroupLineItems(
      xmlDoc,
      descriptionField,
      documentTaxes.subtotalGroups,
      taxSchemeOverride,
      customDescription,
      useDocumentOverride
    );

    const grouped: Record<string, LineTaxGroup> = taxRegimeGroups.reduce((acc, group) => {
      acc[group.taxCode] = group;
      return acc;
    }, {} as Record<string, LineTaxGroup>);

   
    let mismatch: TaxMismatchDetail | null = null;
    if (!useDocumentOverride) {
      mismatch = this.detectTaxMismatch(
        grouped,
        documentTaxes,
        String(headerData.doc_invoice_id ?? 'unknown'),
        fileName
      );
    }

    const validation = this.validateAndReconcileTaxes(grouped, documentTaxes, headerData.invoice_amount);

    const rows: ExcelRow[] = [];

    if (taxRegimeGroups.length > 0) {
      taxRegimeGroups.forEach((group, index) => {
        const lineGroup = index + 1;

        rows.push({
          ...headerData,
          ...itemCustomFields,
          LineType: 'ITEM',
          LineAmount: group.totalLineAmount.toFixed(2),
          TaxCode: '',
          LineDescription: group.LineDescription,
          LineGroup: lineGroup,
        });

        const taxAmount = validation.reconciledTaxAmounts[group.taxCode] ?? group.totalTaxAmount;
        const taxGlEntry = taxGlAccounts[group.taxCode] || taxGlAccounts.default;

        rows.push({
          ...headerData,
          ...itemCustomFields,
          gl_entry: taxGlEntry,
          LineType: 'TAX',
          LineAmount: taxAmount.toFixed(2),
          TaxCode: group.taxCode,
          LineDescription: group.LineDescription,
          LineGroup: lineGroup,
        });
      });

      
      const auditNotes: string[] = [];

      if (useDocumentOverride) {
        auditNotes.push('TAX_RATE_OVERRIDE: Line rates reassigned from document-level TaxSubtotals (user confirmed)');
      }

      if (validation.warnings.length > 0) {
        auditNotes.push(`VALIDATION WARNINGS: ${validation.warnings.join('; ')}`);
      }

      if (auditNotes.length > 0) {
        const existingNotes = String(rows[0]?.Notes ?? '');
        const combined = auditNotes.join(' | ');
        rows.forEach((row) => {
          row.Notes = existingNotes ? `${existingNotes} | ${combined}` : combined;
        });
      }
    } else {
      rows.push({
        ...headerData,
        ...itemCustomFields,
        LineType: 'Unknown',
        LineAmount: '0.00',
        TaxCode: '',
        LineDescription: '',
        LineGroup: 1,
      });
    }

    return { rows, mismatch };
  }



  private buildDescription(lineNode: Node, choice: DescriptionFieldChoice, customText: string = ''): string {
    if (choice === 'custom') {
      return customText;
    }

    const itemName = this.extractInfo(lineNode, './/cac:Item/cbc:Name') || '';
    const itemDescription = this.extractInfo(lineNode, './/cac:Item/cbc:Description') || '';
    const buyersID = this.extractInfo(lineNode, './/cac:Item/cac:BuyersItemIdentification/cbc:ID') || '';
    const sellersID = this.extractInfo(lineNode, './/cac:Item/cac:SellersItemIdentification/cbc:ID') || '';
    const manufacturersID = this.extractInfo(lineNode, './/cac:Item/cac:ManufacturersItemIdentification/cbc:ID') || '';
    const brandName = this.extractInfo(lineNode, './/cac:Item/cbc:BrandName') || '';
    const modelName = this.extractInfo(lineNode, './/cac:Item/cbc:ModelName') || '';
    const allowanceReason = this.extractInfo(lineNode, './/cac:AllowanceCharge/cbc:AllowanceChargeReason') || '';

    switch (choice) {
      case 'itemName':
        return itemName;
      case 'itemDescription':
        return itemDescription;
      case 'buyersID':
        return buyersID;
      case 'sellersID':
        return sellersID;
      case 'manufacturersID':
        return manufacturersID;
      case 'brandName':
        return brandName;
      case 'modelName':
        return modelName;
      case 'allowanceReason':
        return allowanceReason;
      case 'combined':
      default: {
        const parts = [
          itemName,
          itemDescription,
          buyersID ? `Buyer ID: ${buyersID}` : '',
          sellersID ? `Seller ID: ${sellersID}` : '',
          manufacturersID ? `Manuf. ID: ${manufacturersID}` : '',
          brandName ? `Brand: ${brandName}` : '',
          modelName ? `Model: ${modelName}` : '',
          allowanceReason ? `Reason: ${allowanceReason}` : '',
        ];
        return parts.filter(Boolean).join(' | ').substring(0, 500);
      }
    }
  }
}