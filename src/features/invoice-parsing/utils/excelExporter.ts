import * as XLSX from 'xlsx';
import type { FieldDefinition } from '../constants/fieldDefinitions';

export const exportToExcel = (
  data: any[], 
  selectedHeaders: FieldDefinition[], 
  fileName = 'report.xlsx'
) => {
  if (!data || !Array.isArray(data) || data.length === 0) {
    console.error('Export failed: no data to export');
    return;
  }

  const worksheetData = data.map(row => {
    const rowData: any = {};
    selectedHeaders.forEach(header => {
      const value = row[header.key];
      rowData[header.label] = Array.isArray(value) ? value.join(', ') : value;
    });
    return rowData;
  });

  const ws = XLSX.utils.json_to_sheet(worksheetData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

  const numericColumns = [
    'invoice_date', 
    'invoice_amount', 
    'tax_amount', 
    'tax_rate', 
    'invoice_line_quantity', 
    'unit_price', 
    'line_total', 
    'doc_tax_amount', 
    'doc_tax_rate'
  ];

  selectedHeaders.forEach((header, colIndex) => {
    if (!numericColumns.includes(header.key)) {
      const colLetter = XLSX.utils.encode_col(colIndex);
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');

      for (let row = range.s.r + 1; row <= range.e.r; row++) {
        const cellAddress = colLetter + (row + 1);
        if (ws[cellAddress]) {
          ws[cellAddress].t = 's';
          ws[cellAddress].z = '@';
        }
      }
    }
  });

  const now = new Date();
  const minute = String(now.getMinutes()).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  const timestamp = `${minute}_${day}_${month}_${year}`;

  const nameParts = fileName.split('.');
  const ext = nameParts.pop();
  const baseName = nameParts.join('.');
  const finalFileName = `${baseName}_${timestamp}.${ext}`;

  XLSX.writeFile(wb, finalFileName);
};