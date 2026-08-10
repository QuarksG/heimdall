/**
 * SINGLE MONEY MODULE — the one owner of amount parsing, rounding and
 * display formatting for the whole feature.
 *
 * Contract: amounts are parsed ONCE here (at the parsing boundary), carried
 * as `number` on `PaymentRecord`, and formatted only at render time.
 * No other module may re-parse a formatted amount string.
 */
export class DataSanitizer {
  public static convertToString(value: any): string {
    return value == null ? '' : String(value).trim();
  }

  /**
   * Rounds to 2 decimals (currency precision). Applied at the parsing
   * boundary so every downstream computation sees the same value the old
   * format-then-reparse cycle produced.
   */
  public static roundAmount(value: number): number {
    return Math.round(value * 100) / 100;
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
    const parsed = DataSanitizer.parseDateOrNull(dateString);
    return parsed ?? new Date(0);
  }

  /**
   * STRICT date parsing — returns `null` instead of a sentinel when the
   * value is not a recognizable date. Accepts the Oracle remittance format
   * `D-MMM-YY(YY)` (1–2 digit day, 2- or 4-digit year), Excel serial
   * numbers (a worksheet may deliver dates as serials depending on how the
   * email was pasted), and finally anything `Date` itself understands.
   */
  public static parseDateOrNull(raw: string): Date | null {
    if (!raw) return null;

    const monthMapping: Record<string, number> = {
      JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
      JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11
    };

    const normalized = String(raw).toUpperCase().trim();

    const dateMatch = normalized.match(/^(\d{1,2})-([A-Z]{3})-(\d{2,4})$/);
    if (dateMatch && monthMapping[dateMatch[2]] !== undefined) {
      const day = parseInt(dateMatch[1]);
      const month = monthMapping[dateMatch[2]];
      let year = parseInt(dateMatch[3]);
      if (year < 100) year += 2000;
      return new Date(Date.UTC(year, month, day));
    }

    // Excel serial number (days since 1900 epoch); plausible date window
    // only, so amounts are never mistaken for dates.
    if (/^\d{5}$/.test(normalized)) {
      const serial = parseInt(normalized);
      if (serial >= 20000 && serial <= 80000) {
        return new Date(Math.round((serial - 25569) * 86400 * 1000));
      }
    }

    const fallbackDate = new Date(raw);
    return isNaN(fallbackDate.getTime()) ? null : fallbackDate;
  }

  /**
   * AGE IN DAYS between two source date strings (later − earlier),
   * or `undefined` when either side is unparseable. Used for the
   * "Yaş (Gün)" column: payment date − invoice date.
   */
  public static daysBetween(earlier: string, later: string): number | undefined {
    const from = DataSanitizer.parseDateOrNull(earlier);
    const to = DataSanitizer.parseDateOrNull(later);
    if (!from || !to) return undefined;
    return Math.round((to.getTime() - from.getTime()) / 86400000);
  }
  
  public static sanitizeFileName(fileName: string): string {
    return fileName
      .replace(/[\s\\/:"*?<>|]+/g, '_')
      .replace(/__+/g, '_');
  }
}