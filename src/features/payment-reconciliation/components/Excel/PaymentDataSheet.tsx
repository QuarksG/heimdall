import * as XLSX from 'xlsx';
import type { PaymentRecord } from '../../types/regional.types';
import { trRegionConfig } from '../../config/regions/implementations/tr.config';

export class PaymentDataSheet {
  public create(records: PaymentRecord[]): XLSX.WorkSheet {
    const displayData = this.mapRecordsToRows(records);
    const sheet = XLSX.utils.json_to_sheet(displayData);
    
    this.applyStyling(sheet, records);
    
    return sheet;
  }

  private mapRecordsToRows(records: PaymentRecord[]) {
    return records.map(record => ({
      'Satır Numarası': record.rowNumber,
      'Ödeme yapılacak taraf': record.payee,
      'Ödeme para birimi': record.currency,
      'Tedarikçi site adı': record.vendorSite,
      'Ödeme Numarası': record.paymentNumber,
      'Ödeme tarihi': record.paymentDate,
      'Fatura Türü': record.invoiceType,
      'Fatura Numarası': record.invoiceNumber,
      'Fatura Tarihi': record.invoiceDate,
      'PO: Sipariş Numarası': record.poNumber,
      'Fatura Açıklaması': record.description,
      'Uygulanan indirim': record.discount,
      'Alacak': record.credit,
      'Borç': record.debit,
      'Bakiye': record.balance
    }));
  }

  private applyStyling(sheet: XLSX.WorkSheet, records: PaymentRecord[]) {
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
    const yellowFill = { fill: { fgColor: { rgb: 'FFEB3B' } } };
    
    // Define columns that contain numbers
    const numberColumns = ['Uygulanan indirim', 'Alacak', 'Borç', 'Bakiye'];
    const headers = trRegionConfig.headers.display;
    const colMap: Record<string, string> = {};

    headers.forEach((h, i) => {
      if (numberColumns.includes(h)) colMap[h] = XLSX.utils.encode_col(i);
    });

    for (let r = 1; r <= range.e.r; r++) {
      const recordIndex = r - 1;
      const isHavaleRow = records[recordIndex]?.invoiceType === 'Giden Havale';

      // Apply Row Styling (Yellow Background)
      if (isHavaleRow) {
        for (let c = 0; c <= range.e.c; c++) {
          const addr = XLSX.utils.encode_cell({ c, r });
          if (!sheet[addr]) continue;
          sheet[addr].s = yellowFill;
        }
      }

      // Apply Number Formatting
      numberColumns.forEach(colName => {
        const colLetter = colMap[colName];
        if (!colLetter) return;
        
        const addr = colLetter + (r + 1); // +1 for header
        const cell = sheet[addr];
        
        if (cell) {
          const rawVal = cell.v;
          const numVal = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal).replace(/,/g, ''));
          
          if (!isNaN(numVal)) {
            sheet[addr] = {
              t: 'n',
              v: numVal,
              z: '#,##0.00',
              s: isHavaleRow ? yellowFill : undefined
            };
          }
        }
      });
    }
  }
}