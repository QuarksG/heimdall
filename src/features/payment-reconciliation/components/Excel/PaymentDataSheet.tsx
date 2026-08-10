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
    // Amounts arrive numeric (parsed once at the boundary). Display
    // convention preserved from the original remittance ledger: a zero
    // credit/debit renders as an EMPTY cell, not 0.00.
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
      // AGE: payment date − invoice date (basis of the aged report).
      // Empty for the synthetic transfer row / unparseable dates.
      'Yaş (Gün)': record.agingDays ?? '',
      'PO: Sipariş Numarası': record.poNumber,
      'Fatura Açıklaması': record.description,
      'Uygulanan indirim': record.discount,
      'Alacak': record.credit === 0 ? '' : record.credit,
      'Borç': record.debit === 0 ? '' : record.debit,
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

        // Amounts are numeric on the record; empty cells (zero credit/debit
        // display convention) stay as they are — only number cells get the
        // currency format.
        if (cell && typeof cell.v === 'number') {
          sheet[addr] = {
            t: 'n',
            v: cell.v,
            z: '#,##0.00',
            s: isHavaleRow ? yellowFill : undefined
          };
        }
      });
    }
  }
}