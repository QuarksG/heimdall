import * as XLSX from 'xlsx';
import { PaymentDataSheet } from '../components/Excel/PaymentDataSheet';
import { HavaleSheet } from '../components/Excel/HavaleSheet';
import { FilteredInvoicesSheet } from '../components/Excel/FilteredInvoicesSheet';
import { PqvReconciliationSheet } from '../components/Excel/PqvReconciliationSheet';
import { ThreeWayMatchingEngine } from '../logic/matchers/threeWayMatchingEngine';
import type { PaymentRecord } from '../types/regional.types';

export class ExcelExporter {
  private paymentSheetBuilder: PaymentDataSheet;
  private havaleSheetBuilder: HavaleSheet;
  private invoiceSheetBuilder: FilteredInvoicesSheet;
  private pqvSheetBuilder: PqvReconciliationSheet;
  private matcher: ThreeWayMatchingEngine;

  constructor() {
    this.paymentSheetBuilder = new PaymentDataSheet();
    this.havaleSheetBuilder = new HavaleSheet();
    this.invoiceSheetBuilder = new FilteredInvoicesSheet();
    this.pqvSheetBuilder = new PqvReconciliationSheet();
    this.matcher = new ThreeWayMatchingEngine();
  }

  public generateAndDownload(records: PaymentRecord[], fileNamePrefix: string = 'Vendor'): void {
    const workbook = XLSX.utils.book_new();

    // 1. Payment Data Sheet (Main Ledger)
    const wsPayment = this.paymentSheetBuilder.create(records);
    XLSX.utils.book_append_sheet(workbook, wsPayment, 'Payment Data');

    // 2. Havale Sheet (Wire Transfer Summary)
    const wsHavale = this.havaleSheetBuilder.create(records);
    XLSX.utils.book_append_sheet(workbook, wsHavale, 'HAVALE');

    // 3. Filtered Invoices (Accounting View)
    const wsInvoices = this.invoiceSheetBuilder.create(records);
    XLSX.utils.book_append_sheet(workbook, wsInvoices, 'Filtered Invoices');

    // 4. Pivot Summary (Internal logic for feature parity)
    const wsPivot = this.createPivotSheet(records);
    XLSX.utils.book_append_sheet(workbook, wsPivot, 'Pivot Fatura Türü');

    // 5. PQV Reconciliation (Complex Matching)
    const pqvMatches = this.matcher.matchPqvToSales(records);
    const wsPqv = this.pqvSheetBuilder.create(pqvMatches);
    XLSX.utils.book_append_sheet(workbook, wsPqv, 'PQV-RI');

    // 6. Generate Filename and Download
    const safeName = this.sanitizeFileName(fileNamePrefix);
    const date = new Date().toISOString().split('T')[0];
    const fileName = `${safeName}_Amazon_Payments_${date}.xlsx`;

    XLSX.writeFile(workbook, fileName);
  }

  private createPivotSheet(records: PaymentRecord[]): XLSX.WorkSheet {
    const pivotMap = new Map<string, { type: string; credit: number; debit: number }>();

    records.forEach(row => {
      const type = row.invoiceType || 'Boş';
      const credit = this.parseNumber(row.credit);
      const debit = this.parseNumber(row.debit);

      if (!pivotMap.has(type)) {
        pivotMap.set(type, { type, credit: 0, debit: 0 });
      }

      const entry = pivotMap.get(type)!;
      entry.credit += credit;
      entry.debit += debit;
    });

    const data = Array.from(pivotMap.values()).map(p => ({
      'Fatura Türü': p.type,
      'Alacak Toplam': p.credit,
      'Borç Toplam': p.debit
    }));

    const sheet = XLSX.utils.json_to_sheet(data);

    // Apply basic formatting
    const w = [{ wch: 42 }, { wch: 18 }, { wch: 18 }];
    sheet['!cols'] = w;
    
    // Add AutoFilter
    if (data.length > 0) {
      sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: 2, r: data.length } }) };
    }

    return sheet;
  }

  private sanitizeFileName(name: string): string {
    return name.replace(/[\s\\/:"*?<>|]+/g, '_').replace(/__+/g, '_');
  }

  private parseNumber(val: string): number {
    return parseFloat(String(val).replace(/,/g, '')) || 0;
  }
}