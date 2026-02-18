import React, { useState, useMemo } from 'react';
import type { FieldDefinition } from '../constants/fieldDefinitions';
import { exportToExcel } from '../utils/excelExporter';
import { wrapText } from '../utils/formatters'; 

interface DataTableProps {
  data: any[];
  headers: FieldDefinition[];
  searchQuery: string;
}

export const DataTable: React.FC<DataTableProps> = ({ data, headers, searchQuery }) => {
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const processedData = useMemo(() => {
    let filtered = data.filter((item) => {
      if (!searchQuery) return true;
      return headers.some((header) => {
        const value = item[header.key];
        if (Array.isArray(value)) {
          return value.join(' ').toLowerCase().includes(searchQuery);
        }
        return value && value.toString().toLowerCase().includes(searchQuery);
      });
    });

    const isShowingLineItems = headers.some(h => h.isLineItem);

    if (!isShowingLineItems) {
      const seen = new Set();
      filtered = filtered.filter(item => {
        const id = item.doc_invoice_id || item.uuid;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    }

    return filtered;
  }, [data, headers, searchQuery]);

  const handleDownload = () => {
    exportToExcel(processedData, headers, 'report.xlsx');
  };

  return (
    <>
      <div className="other-controls">
        <label htmlFor="itemsPerPage">Items per Page:</label>
        <select 
          id="itemsPerPage" 
          value={itemsPerPage} 
          onChange={(e) => setItemsPerPage(Number(e.target.value))}
        >
          <option value="10">10</option>
          <option value="20">20</option>
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="999999">All</option>
        </select>
      </div>

      {data.length > 0 && (
        <button id="downloadExcel" onClick={handleDownload}>
          Download as Excel
        </button>
      )}

      <div id="dataframe">
        <table id="downloadRecords">
          <thead>
            <tr id="tableHeaderRow">
              {headers.map((header) => (
                <th key={header.key}>
                  {header.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {processedData.length > 0 ? (
              processedData.slice(0, itemsPerPage).map((item, index) => (
                <tr key={index}>
                  {headers.map((header) => {
                    const rawValue = Array.isArray(item[header.key])
                      ? item[header.key].join(', ')
                      : item[header.key];

                    const displayValue = wrapText(rawValue, 60);

                    return (
                      <td 
                        key={header.key} 
                        style={{ whiteSpace: 'pre-wrap', minWidth: '150px' }} 
                      >
                        {displayValue}
                      </td>
                    );
                  })}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={headers.length} style={{ textAlign: 'center', padding: '20px' }}>
                  {data.length === 0 ? 'No files uploaded yet.' : 'No records match your search.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      
      <div style={{ marginTop: '10px', fontSize: '14px', color: '#666' }}>
        Showing {Math.min(itemsPerPage, processedData.length)} of {processedData.length} records
      </div>
    </>
  );
};