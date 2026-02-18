import type { PaymentRecord } from '../../types/regional.types';

export interface PqvMatchResult extends PaymentRecord {
  parentInvoiceCandidate: string;
  matchKey: string;
  matchedParents: string;
  worstCaseMatches: string;
}

export class ThreeWayMatchingEngine {
  private readonly DATE_OFFSET_DAYS = 33;
  private readonly AMOUNT_TOLERANCE = 0.8;

  public matchPqvToSales(records: PaymentRecord[]): PqvMatchResult[] {
    const pqvRecords = records.filter(r => 
      r.invoiceType === 'Eksik Miktar Kesinti Faturasi'
    );
    
    const salesRecords = records.filter(r => 
      r.invoiceType === 'Toptan Satis Faturasi'
    );

    const salesIndex = this.buildSalesIndex(salesRecords);
    const parentToPoMap = this.buildParentPoMap(salesIndex);

    return pqvRecords.map(pqv => {
      const parentId = this.extractParentId(pqv.description);
      const poNumber = pqv.poNumber || parentToPoMap.get(parentId) || '';
      const amount = this.getAbsoluteAmount(pqv);
      const pqvDate = this.parseDate(pqv.invoiceDate);
      
      const minSalesDate = pqvDate ? this.addDays(pqvDate, this.DATE_OFFSET_DAYS) : null;
      const matchKey = this.generateMatchKey(poNumber, amount);

      const exactMatches = this.findMatches(salesIndex, {
        targetPo: poNumber,
        targetAmount: amount,
        minDate: minSalesDate,
        pqvDate: pqvDate,
        strictPoMatch: true
      });

      const looseMatches = this.findMatches(salesIndex, {
        targetPo: poNumber,
        targetAmount: amount,
        minDate: minSalesDate,
        pqvDate: pqvDate,
        strictPoMatch: false
      });

      return {
        ...pqv,
        poNumber, 
        parentInvoiceCandidate: parentId,
        matchKey,
        matchedParents: exactMatches.join(', '),
        worstCaseMatches: looseMatches.join(', ')
      };
    });
  }

  private buildSalesIndex(records: PaymentRecord[]) {
    return records.map(record => ({
      parentId: this.extractParentId(record.description),
      poNumber: record.poNumber || '',
      amount: this.getAbsoluteAmount(record),
      date: this.parseDate(record.invoiceDate)
    }));
  }

  private buildParentPoMap(index: ReturnType<typeof this.buildSalesIndex>) {
    const map = new Map<string, string>();
    index.forEach(item => {
      if (item.parentId && item.poNumber) {
        map.set(item.parentId, item.poNumber);
      }
    });
    return map;
  }

  private findMatches(
    index: ReturnType<typeof this.buildSalesIndex>,
    criteria: {
      targetPo: string;
      targetAmount: number;
      minDate: Date | null;
      pqvDate: Date | null;
      strictPoMatch: boolean;
    }
  ): string[] {
    if (!criteria.pqvDate || !criteria.minDate) return [];

    const validMinDate = criteria.minDate;

    return index
      .filter(sale => {
        if (!sale.date) return false;
        if (sale.date < validMinDate) return false;
        
        const isAmountMatch = Math.abs(sale.amount - criteria.targetAmount) <= this.AMOUNT_TOLERANCE;
        const isPoMatch = !criteria.strictPoMatch || (!criteria.targetPo || sale.poNumber === criteria.targetPo);

        return isAmountMatch && isPoMatch;
      })
      .map(s => s.parentId)
      .filter(Boolean);
  }

  private extractParentId(description: string): string {
    return (description || '').slice(-16).trim();
  }

  private generateMatchKey(po: string, amount: number): string {
    return `${po || ''}#${amount.toFixed(2)}`;
  }

  private getAbsoluteAmount(record: PaymentRecord): number {
    const debit = this.parseNumber(record.debit);
    const credit = this.parseNumber(record.credit);
    return debit || credit;
  }

  private parseNumber(val: string): number {
    const num = parseFloat(String(val ?? '0').replace(/,/g, ''));
    return isNaN(num) ? 0 : num;
  }

  private parseDate(dateStr: string): Date | null {
    if (!dateStr) return null;
    
    const months: Record<string, number> = { 
      JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, 
      JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 
    };

    const cleanStr = String(dateStr).toUpperCase().trim();
    const match = cleanStr.match(/(\d{2})-([A-Z]{3})-(\d{4})/);
    
    if (match) {
      const day = parseInt(match[1]);
      const month = months[match[2]];
      const year = parseInt(match[3]);
      return new Date(Date.UTC(year, month, day));
    }

    const d2 = new Date(dateStr);
    if (!isNaN(d2.getTime())) {
      return new Date(Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate()));
    }

    return null;
  }

  private addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
  }
}