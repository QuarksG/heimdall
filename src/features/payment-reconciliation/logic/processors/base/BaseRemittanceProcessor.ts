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
  
  // NOTE: worksheet integrity validation (the disclaimer gate) is owned by
  // `logic/validators/fileIntegrityValidator.ts` and invoked by the region
  // processor's `parse()`. The old `validateWorksheet` duplicate that lived
  // here was dead code and has been removed.
}