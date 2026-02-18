import * as XLSX from 'xlsx';
import type { PqvMatchResult } from '../../logic/matchers/threeWayMatchingEngine';

export class PqvReconciliationSheet {
  public create(matches: PqvMatchResult[]): XLSX.WorkSheet {
    const displayData = this.mapToDisplay(matches);
    const sheet = XLSX.utils.json_to_sheet(displayData);
    
    this.applyStyling(sheet, displayData);
    
    return sheet;
  }

  private mapToDisplay(matches: PqvMatchResult[]) {

    return matches.map(m => ({
      'Satır Numarası': m.rowNumber,
      'Ödeme yapılacak taraf': m.payee,
      'Ödeme para birimi': m.currency,
      'Tedarikçi site adı': m.vendorSite,
      'Ödeme Numarası': m.paymentNumber,
      'Ödeme tarihi': m.paymentDate,
      'Fatura Türü': m.invoiceType,
      'Fatura Numarası': m.invoiceNumber,
      'Fatura Tarihi': m.invoiceDate,
      'PO: Sipariş Numarası': m.poNumber, 
      'Fatura Açıklaması': m.description,
      'Alacak': this.parseNumber(m.credit),
      'Borç': this.parseNumber(m.debit),
      'Parent Invoice (RIGHT16)': m.parentInvoiceCandidate,
      'Key2 (PO#Amount)': m.matchKey,
      'Matched Parents From Sales': m.matchedParents,
      'Worst case Match': m.worstCaseMatches
    }));
  }

  private applyStyling(sheet: XLSX.WorkSheet, data: any[]) {
    if (data.length === 0) return;

    const headers = Object.keys(data[0]);
    sheet['!cols'] = headers.map((_, i) => ({ wch: i < 4 ? 32 : 18 }));


    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
    const numberHeaders = ['Alacak', 'Borç']; 
    const colIndices: number[] = [];

    headers.forEach((h, i) => {
      if (numberHeaders.includes(h)) colIndices.push(i);
    });

    for (let r = 1; r <= range.e.r; r++) {
      colIndices.forEach(c => {
        const addr = XLSX.utils.encode_cell({ c, r });
        const cell = sheet[addr];
        if (cell) {
          const num = typeof cell.v === 'number' 
            ? cell.v 
            : parseFloat(String(cell.v).replace(/,/g, ''));
            
          if (!isNaN(num)) {
            sheet[addr] = { t: 'n', v: num, z: '#,##0.00' };
          }
        }
      });
    }
  }

  private parseNumber(val: string | undefined): number {
    if (!val) return 0;
    const num = parseFloat(String(val).replace(/,/g, ''));
    return isNaN(num) ? 0 : num;
  }
}