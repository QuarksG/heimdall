import React from 'react';
import { Table as BSTable } from 'react-bootstrap';

interface TableProps {
  headers: string[];
  data: any[];
  renderRow: (item: any, index: number) => React.ReactNode;
  striped?: boolean;
  hover?: boolean;
  bordered?: boolean;
}

const Table: React.FC<TableProps> = ({ 
  headers, 
  data, 
  renderRow, 
  striped = true, 
  hover = true, 
  bordered = false 
}) => {
  return (
    <div className="table-responsive">
      <BSTable striped={striped} hover={hover} bordered={bordered}>
        <thead className="table-light">
          <tr>
            {headers.map((header, idx) => (
              <th key={idx}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length > 0 ? (
            data.map((item, index) => renderRow(item, index))
          ) : (
            <tr>
              <td colSpan={headers.length} className="text-center py-4">
                No data available
              </td>
            </tr>
          )}
        </tbody>
      </BSTable>
    </div>
  );
};

export default Table;