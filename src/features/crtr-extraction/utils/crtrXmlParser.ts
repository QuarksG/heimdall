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
} from '../types/crtr.types';

/**
 * CRTR-specific XML processor.
 *
 * Composes the shared XMLToExcelConverter for parsing/namespace resolution
 * and adds CRTR-domain methods (tax extraction, line grouping, validation).
 */
export class CrtrXmlProcessor {
  private converter: XMLToExcelConverter;
  private processedSuppliers: Set<string>;

  constructor() {
    this.converter = new XMLToExcelConverter();
    this.processedSuppliers = new Set();
  }

  /* ─── Delegated base methods ─── */

  transformXML(xmlContent: string): Document | null {
    return this.converter.transformXML(xmlContent);
  }

  /**
   * Single-node XPath extraction with optional attribute support.
   * Extends base evaluateSingle (textContent-only) with getAttribute.
   */
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

  /** Snapshot-concat extraction (all matching nodes joined). */
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

  /** Snapshot node list for iteration. */
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

  /* ─── Tax scheme extraction ─── */

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

  /* ─── Line item grouping ─── */

  extractAndGroupLineItems(
    xmlNode: Node,
    descriptionFieldChoice: DescriptionFieldChoice,
    documentTaxGroups: DocumentTaxSubtotal[] | null,
    taxSchemeOverride: string = ''
  ): LineTaxGroup[] {
    const lineItemsDetail: LineItemDetail[] = [];
    const invoiceLines = this.snapshotNodes(xmlNode, '//cac:InvoiceLine');

    for (let i = 0; i < invoiceLines.snapshotLength; i++) {
      const line = invoiceLines.snapshotItem(i);
      if (!line) continue;

      const lineTotal = this.extractInfo(line, './/cbc:LineExtensionAmount');

      let lineTaxRate: string | null =
        this.extractInfo(line, './/cac:TaxTotal/cac:TaxSubtotal/cbc:Percent') ||
        this.extractInfo(line, './/cac:Item/cac:ClassifiedTaxCategory/cbc:Percent');

      const lineTaxAmount = this.extractInfo(line, './/cac:TaxTotal/cbc:TaxAmount');
      let lineTaxScheme = this.extractTaxScheme(line, xmlNode);

      if (!lineTaxRate && lineTotal && documentTaxGroups) {
        const lineAmountNum = parseFloat(lineTotal);
        let matchedGroup: DocumentTaxSubtotal | null = null;
        const tolerance = 0.02;

        for (const group of documentTaxGroups) {
          if (group.rate) {
            const testTax = lineAmountNum * (group.rate / 100);
            if (Math.abs(testTax - group.amount) < tolerance) {
              matchedGroup = group;
              break;
            }
          }
        }

        if (matchedGroup) {
          lineTaxRate = String(matchedGroup.rate);
          lineTaxScheme = matchedGroup.scheme;
        }
      }

      const selectedDescription = this.buildDescription(line, descriptionFieldChoice);

      if (lineTotal) {
        const taxRate = parseFloat(lineTaxRate ?? '0') || 0;
        const lineAmount = parseFloat(lineTotal);
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
    }

    const taxRegimeGroups: Record<string, LineTaxGroup> = {};

    lineItemsDetail.forEach((item) => {
      const taxCode = `${item.taxScheme}-TR-${item.taxRate.toFixed(2)}%`;

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

  /* ─── Document-level tax totals ─── */

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
        const taxCode = `${finalTaxScheme}-TR-${rate.toFixed(2)}%`;

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

  /* ─── Tax validation & reconciliation ─── */

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

  /* ─── Full extraction → ExcelRow[] ─── */

  extractDataForExcel(
    xmlDoc: Document,
    customFieldsConfig: { customData: CustomFieldConfig; descriptionField: DescriptionFieldChoice }
  ): ExcelRow[] {
    const { customData, descriptionField } = customFieldsConfig;
    const taxSchemeOverride = customData.Tax.taxSchemeOverride || '';

    const headerData: ExcelRow = {
      doc_invoice_id: this.extractInfo(xmlDoc, '//cbc:ID'),
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

    // Supplier guard
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
    const taxRegimeGroups = this.extractAndGroupLineItems(xmlDoc, descriptionField, documentTaxes.subtotalGroups, taxSchemeOverride);

    const grouped: Record<string, LineTaxGroup> = taxRegimeGroups.reduce((acc, group) => {
      acc[group.taxCode] = group;
      return acc;
    }, {} as Record<string, LineTaxGroup>);

    const validation = this.validateAndReconcileTaxes(grouped, documentTaxes, headerData.invoice_amount);

    const rows: ExcelRow[] = [];

    if (taxRegimeGroups.length > 0) {
      taxRegimeGroups.forEach((group) => {
        rows.push({
          ...headerData,
          ...itemCustomFields,
          LineType: 'ITEM',
          LineAmount: group.totalLineAmount.toFixed(2),
          TaxCode: '',
          LineDescription: group.LineDescription,
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
        });
      });

      if (validation.warnings.length > 0) {
        const existingNotes = String(rows[0]?.Notes ?? '');
        const validationNote = `VALIDATION WARNINGS: ${validation.warnings.join('; ')}`;
        rows.forEach((row) => {
          row.Notes = existingNotes ? `${existingNotes} | ${validationNote}` : validationNote;
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
      });
    }

    return rows;
  }

  /* ─── Private helpers ─── */

  private buildDescription(lineNode: Node, choice: DescriptionFieldChoice): string {
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