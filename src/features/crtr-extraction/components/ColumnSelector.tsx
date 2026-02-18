import React from 'react';
import type { ColumnSelectorProps } from '../types/crtr.types';

export const ColumnSelector = React.memo(({ allHeaders, selectedHeaders, onToggle }: ColumnSelectorProps) => (
  <div className="side-pnl">
    <h2 className="pnl-h2">Columns</h2>
    <div className="col-list">
      {allHeaders.map((header) => (
        <div key={header.key} className="col-item">
          <input
            type="checkbox"
            id={`chk-${header.key}`}
            className="col-chk"
            checked={selectedHeaders.some((h) => h.key === header.key)}
            onChange={() => onToggle(header.key)}
          />
          <label htmlFor={`chk-${header.key}`} className="col-lbl">
            {header.label}
          </label>
        </div>
      ))}
    </div>
  </div>
));