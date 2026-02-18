import React from 'react';
import type { DataTableProps } from '../types/crtr.types';

export const DataTable = React.memo(({ data, headers }: DataTableProps) => (
  <div className="tbl-wrap">
    <table className="data-tbl">
      <thead>
        <tr>{headers.map((header) => <th key={header.key}>{header.label}</th>)}</tr>
      </thead>
      <tbody>
        {data.map((row, index) => (
          <tr key={index}>
            {headers.map((header) => (
              <td key={header.key}>{String(row[header.key] ?? '')}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
));