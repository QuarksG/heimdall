import { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { TrOfaRemittanceProcessor } from '../logic/processors/implementations/tr/TrOfaRemittanceProcessor.ts';
import { ExcelExporter } from '../utils/excelExporter';
import type { PaymentRecord } from '../types/regional.types';


interface UseReconciliationProcessResult {
  parsedData: PaymentRecord[];
  isProcessing: boolean;
  error: string | null;
  successMessage: string | null;
  fileName: string; 
  processFile: (file: File) => Promise<void>;
  exportExcel: () => void;
  clearState: () => void;
}

export const useReconciliationProcess = (regionCode: string = 'TR'): UseReconciliationProcessResult => {
  const [parsedData, setParsedData] = useState<PaymentRecord[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');

  const processFile = useCallback(async (file: File) => {
    setIsProcessing(true);
    setError(null);
    setSuccessMessage(null);
    setFileName(file.name);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false }) as unknown[][];

      const processor = new TrOfaRemittanceProcessor();
      const result = processor.parse(rawData);

      if (!result.isValid) {
        setError(result.message);
        setParsedData([]);
      } else {
        const recordsWithIds = result.records.map((record: PaymentRecord, index: number) => ({
          ...record,
          rowNumber: index + 1
        }));
        setParsedData(recordsWithIds);
        setSuccessMessage(result.message);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error during file processing';
      setError(msg);
      setParsedData([]);
    } finally {
      setIsProcessing(false);
    }
  }, [regionCode]);

  const exportExcel = useCallback(() => {
    if (parsedData.length === 0) return;
    
    try {
      const exporter = new ExcelExporter();
      const vendorName = parsedData[0]?.vendorSite || 'Vendor';
      exporter.generateAndDownload(parsedData, vendorName);
    } catch (err) {
      setError('Failed to generate Excel file.');
    }
  }, [parsedData]);

  const clearState = useCallback(() => {
    setParsedData([]);
    setError(null);
    setSuccessMessage(null);
    setFileName('');
  }, []);

  return {
    parsedData,
    isProcessing,
    error,
    successMessage,
    fileName,
    processFile,
    exportExcel,
    clearState
  };
};