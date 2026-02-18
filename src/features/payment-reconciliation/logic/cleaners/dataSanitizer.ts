export class DataSanitizer {
  public static convertToString(value: any): string {
    return value == null ? '' : String(value).trim();
  }
  
  public static parseAmount(rawValue: string = ''): number {
    if (rawValue === '' || rawValue === undefined || rawValue === null) {
      return 0;
    }
    
    let sanitizedValue = String(rawValue).trim();
    let isNegative = false;
    
    const parenthesesMatch = sanitizedValue.match(/\(([^)]+)\)/);
    if (parenthesesMatch) {
      isNegative = true;
      sanitizedValue = parenthesesMatch[1];
    }
    
    sanitizedValue = sanitizedValue.replace(/[^\d\-\.,]/g, '');
    
    let numericValue = parseFloat(sanitizedValue.replace(/,/g, ''));
    
    if (isNaN(numericValue)) {
      return 0;
    }
    
    if (isNegative) {
      numericValue = -Math.abs(numericValue);
    }
    
    return numericValue;
  }
  
  public static formatNumber(value: number): string {
    return Number(value).toLocaleString('en-US', { 
      minimumFractionDigits: 2, 
      maximumFractionDigits: 2 
    });
  }
  
  public static parseDate(dateString: string): Date {
    if (!dateString) {
      return new Date(0);
    }
    
    const monthMapping: Record<string, number> = {
      JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
      JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11
    };
    
    const normalizedString = String(dateString).toUpperCase().trim();
    const dateMatch = normalizedString.match(/(\d{2})-([A-Z]{3})-(\d{4})/);
    
    if (dateMatch) {
      const day = parseInt(dateMatch[1]);
      const month = monthMapping[dateMatch[2]];
      const year = parseInt(dateMatch[3]);
      return new Date(year, month, day);
    }
    
    const fallbackDate = new Date(dateString);
    return isNaN(fallbackDate.getTime()) ? new Date(0) : fallbackDate;
  }
  
  public static sanitizeFileName(fileName: string): string {
    return fileName
      .replace(/[\s\\/:"*?<>|]+/g, '_')
      .replace(/__+/g, '_');
  }
}