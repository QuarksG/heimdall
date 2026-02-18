import type { ParsingResult } from '../../../types/regional.types';

export abstract class BaseRemittanceProcessor {
  protected abstract getDisclaimerText(): string;
  protected abstract getPaymentHeaderText(): string;
  protected abstract getInvoiceHeaderText(): string;
  protected abstract getPaymentHeaderMapping(): Record<string, string>;
  

  protected abstract mapPaymentLabel(label: string): string | null;
  

  public abstract parse(worksheet: unknown[][]): ParsingResult;



  protected normalizeText(text: string): string {
    if (typeof text !== 'string') {
      text = text == null ? '' : String(text);
    }
    
    let normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    normalized = normalized.replace(/İ/g, 'I').replace(/ı/g, 'i');
    normalized = normalized.toLowerCase().trim().replace(/\s+/g, ' ');
    
    return normalized;
  }
  
  protected isValuePresent(value: any): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'number' && Number.isNaN(value)) return false;
    return String(value).trim() !== '';
  }
  
  protected findFirstValueInRow(row: any[], startColumn: number = 0): [number | null, any] {
    for (let columnIndex = startColumn; columnIndex < row.length; columnIndex++) {
      const value = row[columnIndex];
      if (this.isValuePresent(value)) {
        return [columnIndex, value];
      }
    }
    return [null, null];
  }
  
  protected findNextValueToRight(row: any[], currentColumn: number): [number | null, any] {
    for (let columnIndex = currentColumn + 1; columnIndex < row.length; columnIndex++) {
      const value = row[columnIndex];
      if (this.isValuePresent(value)) {
        return [columnIndex, value];
      }
    }
    return [null, null];
  }
  
  protected validateWorksheet(worksheet: any[][]): { isValid: boolean; message: string } {
    const rowCount = worksheet.length;
    const disclaimerText = this.getDisclaimerText();
    
    const firstFortyRows = [];
    for (let rowIndex = 0; rowIndex < Math.min(40, rowCount); rowIndex++) {
      const firstColumn = worksheet[rowIndex] ? worksheet[rowIndex][0] : null;
      firstFortyRows.push(firstColumn);
    }
    
    const disclaimerFound = firstFortyRows.some((value) => 
      this.isValuePresent(value) && this.normalizeText(String(value)).includes(disclaimerText)
    );
    
    if (!disclaimerFound) {
      return {
        isValid: false,
        message: `The uploaded worksheet does not appear to be a remittance advice.\n\nThe expected disclaimer text was not found in the first 40 rows of column A:\n"${disclaimerText}"\n\nPlease ensure you have pasted the remittance email directly into Excel and try again.`
      };
    }
    
    return { isValid: true, message: '' };
  }
}