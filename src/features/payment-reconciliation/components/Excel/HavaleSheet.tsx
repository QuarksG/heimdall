import * as XLSX from 'xlsx';
import type { PaymentRecord } from '../../types/regional.types';

export class HavaleSheet {
  public create(records: PaymentRecord[]): XLSX.WorkSheet {
    const summaryData = this.aggregatePayments(records);
    const sheet = XLSX.utils.json_to_sheet(summaryData);
    
    this.formatAmountColumn(sheet);
    
    return sheet;
  }

  private aggregatePayments(records: PaymentRecord[]) {
    const paymentMap = new Map<string, any>();

    records.forEach(row => {
      // Create unique key based on Date + Payment ID
      const key = `${row.paymentDate}_${row.paymentNumber}`;
      
      if (!paymentMap.has(key)) {
        paymentMap.set(key, {
          'Ödeme tarihi': row.paymentDate,
          'Ödeme Numarası': row.paymentNumber,
          'Ödeme para birimi': row.currency,
          'Ödeme Tutarı': this.parseAmount(row.paymentAmount)
        });
      }
    });

    return Array.from(paymentMap.values());
  }

  private formatAmountColumn(sheet: XLSX.WorkSheet) {
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
    const amountColIndex = 3; // 'Ödeme Tutarı' is the 4th column (index 3)
    const amountColLetter = XLSX.utils.encode_col(amountColIndex);

    for (let r = 1; r <= range.e.r; r++) {
      const addr = amountColLetter + (r + 1);
      const cell = sheet[addr];
      
      if (cell) {
        sheet[addr] = {
          t: 'n',
          v: Number(cell.v),
          z: '#,##0.00'
        };
      }
    }
  }

  private parseAmount(val: string): number {
    const clean = String(val).replace(/,/g, '');
    return parseFloat(clean) || 0;
  }
}