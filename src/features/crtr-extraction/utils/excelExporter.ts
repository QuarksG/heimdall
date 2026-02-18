import * as XLSX from 'xlsx';
import type { ExcelRow, HeaderDef } from '../types/crtr.types';

export const exportToExcel = (data: ExcelRow[], headers: HeaderDef[], fileName: string): void => {
  const headerKeys = headers.map((h) => h.key);

  const filteredData = data.map((row) => {
    const newRow: Record<string, unknown> = {};
    headerKeys.forEach((key) => {
      newRow[key] = row[key] ?? '';
    });
    return newRow;
  });

  const ws = XLSX.utils.json_to_sheet(filteredData, { header: headerKeys }) as XLSX.WorkSheet;
  const headerLabels = headers.map((h) => h.label);
  XLSX.utils.sheet_add_aoa(ws, [headerLabels], { origin: 'A1' });

  const textColumns = [
    'doc_invoice_id',
    'TaxCode',
    'gl_entry',
    'vendorNum',
    'vendorSiteCode',
    'termsName',
    'paymentMethod',
    'LineDescription',
  ];

  const ref = ws['!ref'];
  if (ref) {
    const range = XLSX.utils.decode_range(ref);
    for (let R = range.s.r + 1; R <= range.e.r; ++R) {
      textColumns.forEach((colKey) => {
        const colIndex = headerKeys.indexOf(colKey);
        if (colIndex > -1) {
          const cellAddress = XLSX.utils.encode_cell({ r: R, c: colIndex });
          const cell = ws[cellAddress] as XLSX.CellObject | undefined;
          if (cell) {
            cell.t = 's';
            cell.z = '@';
          }
        }
      });
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  XLSX.writeFile(wb, fileName);
};