import { BaseRemittanceProcessor } from '../../base/BaseRemittanceProcessor';
import { TrInvoiceClassifier } from '../../../classifiers/implementations/TrInvoiceClassifier';
import { trRegionConfig } from '../../../../config/regions/implementations/tr.config';
import type { PaymentRecord, ParsingResult } from '../../../../types/regional.types';

export class TrOfaRemittanceProcessor extends BaseRemittanceProcessor {
  private classifier: TrInvoiceClassifier;

  constructor() {
    super();
    this.classifier = new TrInvoiceClassifier();
  }


  protected getDisclaimerText(): string {
    return trRegionConfig.markers.emailDisclaimer;
  }

  protected getPaymentHeaderText(): string {
    return trRegionConfig.markers.paymentStart;
  }

  protected getInvoiceHeaderText(): string {
    return 'fatura nu'; 
  }

  protected getPaymentHeaderMapping(): Record<string, string> {
    return trRegionConfig.mappings;
  }

  protected getPaymentHeaders(): string[] {
    return trRegionConfig.headers.payment;
  }

  protected getInvoiceHeaders(): string[] {
    return trRegionConfig.headers.invoice;
  }


  protected mapPaymentLabel(rawLabel: string): string | null {
    let label = this.stripAccents(rawLabel);
    label = label.replace(/:/g, '').replace(/-/g, ' ');
    
    const mapping = this.getPaymentHeaderMapping();
    for (const [key, canonical] of Object.entries(mapping)) {
      if (label.startsWith(key)) return canonical;
    }
    return null;
  }

  public parse(fileContent: unknown[][]): ParsingResult {
    const matrix = this.createMatrix(fileContent);
    const extractionResult = this.extractRawSections(matrix);

    if (!extractionResult.ok) {
      return {
        isValid: false,
        records: [],
        message: extractionResult.msg
      };
    }

    const cleanedRecords = this.cleanAndMapRecords(extractionResult.results);
    
    return {
      isValid: true,
      records: cleanedRecords,
      message: `Successfully parsed ${cleanedRecords.length} records.`
    };
  }



  private createMatrix(aoa: unknown[][]): unknown[][] {
    return aoa; 
  }

  private extractRawSections(matrix: unknown[][]): { ok: boolean; results: any[]; msg: string } {
    const rows = matrix.length;
    const cols = matrix.reduce((max, row) => Math.max(max, (row as any[]).length), 0);
    const getCell = (r: number, c: number) => {
      if (r < 0 || r >= rows || c < 0 || c >= cols) return null;
      const row = matrix[r] as any[];
      return row && row[c] !== undefined ? row[c] : null;
    };

    const disclaimer = this.getDisclaimerText();
    
 
    let foundStart = false;
    for (let i = 0; i < Math.min(40, rows); i++) {
      const val = getCell(i, 0);
      if (this.isNonEmpty(val) && this.stripAccents(String(val)).includes(disclaimer)) {
        foundStart = true;
        break;
      }
    }

    if (!foundStart) {
      return { 
        ok: false, 
        results: [], 
        msg: 'Invalid format: Oracle EFT disclaimer not found in column A.' 
      };
    }

    const results: any[] = [];
    let currentRow = 0;

    while (currentRow < rows) {
      // Find Header Section
      let headerRowIndex = null;
      let headerColIndex = null;
      let sectionFound = false;

      for (let r = currentRow; r < rows && !sectionFound; r++) {
        for (let c = 0; c < cols; c++) {
          const v = getCell(r, c);
          if (this.isNonEmpty(v) && this.stripAccents(String(v)).includes(disclaimer)) {
            headerRowIndex = r;
            headerColIndex = c;
            sectionFound = true;
            break;
          }
        }
      }

      if (!sectionFound) break;

     
      let paymentStartRow = null;
      const paymentMarker = this.getPaymentHeaderText();
      
      for (let r = headerRowIndex!; r < rows; r++) {
        const v = getCell(r, headerColIndex!);
        if (this.isNonEmpty(v) && this.stripAccents(String(v)).includes(paymentMarker)) {
          paymentStartRow = r;
          break;
        }
      }

      
      if (paymentStartRow === null) {
        outerLoop: for (let r = headerRowIndex!; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const v = getCell(r, c);
            if (this.isNonEmpty(v) && this.stripAccents(String(v)).includes(paymentMarker)) {
              paymentStartRow = r;
              break outerLoop;
            }
          }
        }
      }

      if (paymentStartRow === null) {
        currentRow = headerRowIndex! + 1;
        continue;
      }

    
      const paymentValues: Record<string, string> = {};
      const targetHeaders = this.getPaymentHeaders();
      targetHeaders.forEach(h => paymentValues[h] = '');

      for (let i = 0; i < 7; i++) {
        const r = paymentStartRow + i;
        if (r >= rows) continue;
        
        const rowData = (matrix[r] as any[]) || [];
        const startCol = Math.max(0, headerColIndex! - 2);
        
        let [labelCol, labelVal] = this.findFirstNonEmpty(rowData, startCol);
        if (labelCol === null) [labelCol, labelVal] = this.findFirstNonEmpty(rowData, 0);
        
        if (labelCol === null || !this.isNonEmpty(labelVal)) continue;

        let canonicalKey = this.mapPaymentLabel(String(labelVal));
        const [, valueVal] = this.findNextNonEmpty(rowData, labelCol);

        if (!canonicalKey && i < targetHeaders.length) {
          canonicalKey = targetHeaders[i];
        }

        if (canonicalKey && valueVal != null) {
          paymentValues[canonicalKey] = String(valueVal).trim();
        }
      }

      
      let invoiceHeaderRow = null;
      let invoiceHeaderCol = null;
      const invoiceMarker = this.getInvoiceHeaderText();

      outerInvoice: for (let r = paymentStartRow; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const v = getCell(r, c);
          if (this.isNonEmpty(v) && this.stripAccents(String(v)).startsWith(invoiceMarker)) {
            invoiceHeaderRow = r;
            invoiceHeaderCol = c;
            break outerInvoice;
          }
        }
      }

      if (invoiceHeaderRow === null) {
        currentRow = paymentStartRow + 1;
        continue;
      }

     
      const tableCols: number[] = [];
      for (let c = invoiceHeaderCol!; c < cols && tableCols.length < 6; c++) {
        if (this.isNonEmpty(getCell(invoiceHeaderRow, c))) tableCols.push(c);
      }
      
     
      if (tableCols.length < 6) {
        for (let c = invoiceHeaderCol! + 1; c < cols && tableCols.length < 6; c++) {
          if (this.isNonEmpty(getCell(invoiceHeaderRow, c))) tableCols.push(c);
        }
      }

      if (tableCols.length < 6) {
        currentRow = invoiceHeaderRow + 1;
        continue;
      }

      // Extract Invoice Rows
      let currentRowPointer = invoiceHeaderRow + 1;
      let extractedAny = false;
      const invoiceHeaders = this.getInvoiceHeaders();

      while (currentRowPointer < rows) {
        const rowVals: string[] = [];
        let nonEmptyCount = 0;

        for (let k = 0; k < 6; k++) {
          const v = getCell(currentRowPointer, tableCols[k]);
          if (this.isNonEmpty(v)) nonEmptyCount++;
          rowVals.push(v == null ? '' : String(v));
        }

        if (nonEmptyCount === 0) break;

        const record = { ...paymentValues };
        invoiceHeaders.forEach((h, idx) => {
          record[h] = rowVals[idx];
        });
        
        results.push(record);
        extractedAny = true;
        currentRowPointer++;
      }

      currentRow = extractedAny ? currentRowPointer + 1 : invoiceHeaderRow + 1;
    }

    if (results.length === 0) {
      return { ok: false, results: [], msg: 'No complete sections (payment + invoices) found.' };
    }

    return { ok: true, results, msg: '' };
  }

  private cleanAndMapRecords(rawRows: any[]): PaymentRecord[] {
    const toStr = (v: any) => (v == null ? '' : String(v).trim());

    const mapped = rawRows.map(rec => {
      const payee = toStr(rec['Odeme yap?lacak taraf:']);
      const supplierNumber = toStr(rec['Tedarikci Numaran?z:']);
      const vendorSite = toStr(rec['Tedarikci site ad?:']);
      const paymentNumber = toStr(rec['Odeme numaras?:']);
      const paymentDate = toStr(rec['Odeme tarihi:']);
      const currency = toStr(rec['Odeme para birimi:']);
      const paymentAmount = toStr(rec['Odeme tutar?:']);
      
      const invoiceNumber = toStr(rec['Fatura Numaras?']);
      const invoiceDate = toStr(rec['Fatura Tarihi']);
      const description = toStr(rec['Fatura Ac?klamas?']);
      const discount = toStr(rec['Uygulanan ?ndirim']) || '0';
      const paid = toStr(rec['Odenen Tutar']);

      let credit = '';
      let debit = '';

      if (paid) {
        if (paid.startsWith('(') && paid.endsWith(')')) {
          debit = paid.slice(1, -1);
        } else {
          credit = paid;
        }
      }

      if (!credit && !debit && discount && discount !== '0' && discount !== '0.00') {
        if (discount.startsWith('-')) {
          debit = discount.substring(1);
        } else {
          credit = discount;
        }
      }

      const invoiceType = this.classifier.classify(invoiceNumber, description);
      const poNumber = this.classifier.extractPurchaseOrder(description) || '';

      let creditNum = this.parseAmount(credit);
      let debitNum = this.parseAmount(debit);

      if (creditNum < 0) {
        debitNum += Math.abs(creditNum);
        creditNum = 0;
      }
      if (debitNum < 0) {
        creditNum += Math.abs(debitNum);
        debitNum = 0;
      }

      return {
        payee,
        supplierNumber,
        vendorSite,
        paymentNumber,
        paymentDate,
        currency,
        paymentAmount,
        invoiceNumber,
        invoiceDate,
        poNumber,
        description,
        discount,
        credit: creditNum ? this.formatNumber(creditNum) : '',
        debit: debitNum ? this.formatNumber(debitNum) : '',
        invoiceType,
        __creditNum: creditNum, 
        __debitNum: debitNum    
      };
    });

    // Handle "Giden Havale" grouping
    const groups = new Map<string, any[]>();
    const groupOrder: string[] = [];

    mapped.forEach((row, idx) => {
      const key = `${row.paymentNumber}__${row.paymentDate}`;
      if (!groups.has(key)) {
        groups.set(key, []);
        groupOrder.push(key);
      }
      groups.get(key)!.push({ ...row, __originalIdx: idx });
    });

    const finalOutput: PaymentRecord[] = [];

    groupOrder.forEach(key => {
      const groupRows = groups.get(key)!;
      let runningBalance = 0;

      groupRows.forEach(row => {
        runningBalance += (row.__creditNum || 0);
        runningBalance -= (row.__debitNum || 0);
        
        const cleanRow = { ...row };
        delete cleanRow.__creditNum;
        delete cleanRow.__debitNum;
        delete cleanRow.__originalIdx;
        
        cleanRow.balance = this.formatNumber(runningBalance);
        finalOutput.push(cleanRow);
      });

      if (groupRows.length > 0) {
        const ref = groupRows[0];
        const transferAmount = Math.abs(runningBalance);
        
        finalOutput.push({
          payee: ref.payee,
          supplierNumber: ref.supplierNumber,
          vendorSite: ref.vendorSite,
          paymentNumber: ref.paymentNumber,
          paymentDate: ref.paymentDate,
          currency: ref.currency,
          paymentAmount: ref.paymentAmount,
          invoiceNumber: `GIDEN HAVALE: ${ref.paymentNumber}`,
          invoiceDate: ref.paymentDate,
          poNumber: '',
          description: `Payment transfer for ${ref.paymentNumber}`,
          discount: '0',
          credit: runningBalance > 0 ? '' : this.formatNumber(transferAmount),
          debit: runningBalance > 0 ? this.formatNumber(transferAmount) : '',
          invoiceType: 'Giden Havale',
          balance: this.formatNumber(0)
        });
      }
    });

    return finalOutput;
  }

  private stripAccents(s: string): string {
    if (typeof s !== 'string') s = s == null ? '' : String(s);
    let n = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    n = n.replace(/İ/g, 'I').replace(/ı/g, 'i');
    n = n.toLowerCase().trim().replace(/\s+/g, ' ');
    return n;
  }

  private isNonEmpty(val: any): boolean {
    if (val === null || val === undefined) return false;
    if (typeof val === 'number' && Number.isNaN(val)) return false;
    return String(val).trim() !== '';
  }

  private findFirstNonEmpty(row: any[], startIdx = 0): [number | null, any] {
    for (let c = startIdx; c < row.length; c++) {
      const v = row[c];
      if (this.isNonEmpty(v)) return [c, v];
    }
    return [null, null];
  }

  private findNextNonEmpty(row: any[], currentIdx: number): [number | null, any] {
    for (let c = currentIdx + 1; c < row.length; c++) {
      const v = row[c];
      if (this.isNonEmpty(v)) return [c, v];
    }
    return [null, null];
  }

  private parseAmount(raw = ''): number {
    if (!raw) return 0;
    let clean = String(raw).trim();
    let isNegative = false;
    
    const parenMatch = clean.match(/\(([^)]+)\)/);
    if (parenMatch) {
      isNegative = true;
      clean = parenMatch[1];
    }
    
    clean = clean.replace(/[^\d\-\.,]/g, '');
    let num = parseFloat(clean.replace(/,/g, ''));
    
    if (isNaN(num)) return 0;
    if (isNegative) num = -Math.abs(num);
    return num;
  }

  private formatNumber(num: number): string {
    return Number(num).toLocaleString('en-US', { 
      minimumFractionDigits: 2, 
      maximumFractionDigits: 2 
    });
  }
}