import React from 'react';
import type { FieldDefinition } from '../constants/fieldDefinitions';

interface HeaderSelectorProps {
  allHeaders: FieldDefinition[];
  selectedHeaders: FieldDefinition[];
  onToggle: (key: string) => void;
}

export const HeaderSelector: React.FC<HeaderSelectorProps> = ({ 
  allHeaders, 
  selectedHeaders, 
  onToggle 
}) => {
  const itemDetailHeaders = allHeaders.filter(h => h.isLineItem);
  const nonItemHeaders = allHeaders.filter(h => !h.isLineItem);

  return (
    <div className="invoiceSidebar">
      <h3>Select Headers</h3>
      
      <div className="mb-6">
        <h4>Item Details</h4>
        {itemDetailHeaders.map((header) => (
          <div key={header.key} className="checkbox-group">
            <input
              type="checkbox"
              id={`header-${header.key}`}
              checked={selectedHeaders.some((selected) => selected.key === header.key)}
              onChange={() => onToggle(header.key)}
            />
            <label htmlFor={`header-${header.key}`}>{header.label}</label>
          </div>
        ))}
      </div>
      
      <div className="mb-6">
        <h4>Other Headers</h4>
        {nonItemHeaders.map((header) => (
          <div key={header.key} className="checkbox-group">
            <input
              type="checkbox"
              id={`header-${header.key}`}
              checked={selectedHeaders.some((selected) => selected.key === header.key)}
              onChange={() => onToggle(header.key)}
            />
            <label htmlFor={`header-${header.key}`}>{header.label}</label>
          </div>
        ))}
      </div>
    </div>
  );
};