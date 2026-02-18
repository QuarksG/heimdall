import React, { useCallback } from 'react';
import * as XLSX from 'xlsx';

interface OfaRemittanceUploaderProps {
  onFileProcessed: (worksheet: any[][]) => void;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}

export const OfaRemittanceUploader: React.FC<OfaRemittanceUploaderProps> = ({
  onFileProcessed,
  onError,
  onSuccess
}) => {
  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    
    if (!file) {
      return;
    }
    
    const reader = new FileReader();
    
    reader.onload = (loadEvent) => {
      try {
        const binaryData = loadEvent.target?.result;
        const workbook = XLSX.read(binaryData, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const worksheetMatrix = XLSX.utils.sheet_to_json(worksheet, { 
          header: 1, 
          raw: false 
        });
        
        onFileProcessed(worksheetMatrix as any[][]);
        onSuccess(`File "${file.name}" loaded successfully. Processing data...`);
      } catch (error) {
        onError('Error reading Excel file. Please try again.');
      }
    };
    
    reader.onerror = () => {
      onError('Error reading file. Please try again.');
    };
    
    reader.readAsArrayBuffer(file);
  }, [onFileProcessed, onError, onSuccess]);
  
  return (
    <div className="uploader-container">
      <label className="uploader-label">
        Upload Remittance File (.xlsx, .xlsm, .xls)
      </label>
      <input
        type="file"
        accept=".xlsx,.xlsm,.xls"
        onChange={handleFileUpload}
        className="uploader-input"
      />
    </div>
  );
};