import React, { useState } from 'react';
import { initialFieldDefinitions } from '../constants/fieldDefinitions';
import type { FieldDefinition } from '../constants/fieldDefinitions';
import { useFileProcessor } from '../hooks/useFileProcessor';
import { FileUploader } from './FileUploader';
import { DataTable } from './DataTable';
import { HeaderSelector } from './HeaderSelector';
import '../../../styles/components/parse.css';

const InvoiceParsing: React.FC = () => {
  const [allFields] = useState<FieldDefinition[]>(initialFieldDefinitions);
  
  const [selectedFields, setSelectedFields] = useState<FieldDefinition[]>(
    initialFieldDefinitions.slice(0, 8)
  );
  
  const [searchQuery, setSearchQuery] = useState('');
  
  const { data, handleFiles, isProcessing } = useFileProcessor(allFields);

  const handleToggleField = (key: string) => {
    const isSelected = selectedFields.find(f => f.key === key);
    if (isSelected) {
      setSelectedFields(selectedFields.filter(f => f.key !== key));
    } else {
      const fieldToAdd = allFields.find(f => f.key === key);
      if (fieldToAdd) {
        setSelectedFields([...selectedFields, fieldToAdd]);
      }
    }
  };

  return (
    <div className="invoice-parse">
      <header id="mainHeader">
        <input 
          type="text" 
          id="searchBox" 
          placeholder="Search records..." 
          onChange={(e) => setSearchQuery(e.target.value.toLowerCase())}
        />
      </header>
      
      <FileUploader onUpload={handleFiles} />
      
      {isProcessing && <p style={{marginTop: 10, fontWeight: 'bold'}}>Processing files...</p>}

      <DataTable 
        data={data} 
        headers={selectedFields} 
        searchQuery={searchQuery}
      />

      <HeaderSelector 
        allHeaders={allFields} 
        selectedHeaders={selectedFields} 
        onToggle={handleToggleField} 
      />
    </div>
  );
};

export default InvoiceParsing;