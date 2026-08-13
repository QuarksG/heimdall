import { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { createRemittanceProcessor } from '../logic/processors/processorFactory';
import { ExcelExporter } from '../utils/excelExporter';
import type { PaymentRecord } from '../types/regional.types';


interface UseReconciliationProcessResult {
  parsedData: PaymentRecord[];
  isProcessing: boolean;
  error: string | null;
  successMessage: string | null;
  /** Non-blocking data-quality findings from the parse (shown to the analyst). */
  warnings: string[];
  processFile: (file: File) => Promise<void>;
  exportExcel: () => Promise<void>;
  clearState: () => void;
}

export const useReconciliationProcess = (regionCode: string = 'TR'): UseReconciliationProcessResult => {
  const [parsedData, setParsedData] = useState<PaymentRecord[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const processFile = useCallback(async (file: File) => {
    setIsProcessing(true);
    setError(null);
    setSuccessMessage(null);
    setWarnings([]);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false }) as unknown[][];

      // BC-15: multi-sheet workbooks were silently truncated to sheet 1.
      // Still only the first sheet is parsed — but no longer silently.
      const fileWarnings: string[] = [];
      if (workbook.SheetNames.length > 1) {
        fileWarnings.push(
          `Workbook contains ${workbook.SheetNames.length} sheets; only the first ("${firstSheetName}") was processed. If your remittance data is on another sheet, move it to the first sheet and re-upload.`,
        );
      }

      // Region dispatch is real: an unsupported region fails loudly here
      // instead of silently running the TR processor (BC-06).
      const processor = createRemittanceProcessor(regionCode);
      const result = processor.parse(rawData);
      setWarnings([...fileWarnings, ...result.warnings]);

      if (!result.isValid) {
        setError(`Analysis failed: ${result.message}`);
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
      setError(`Analysis failed: ${msg}`);
      setParsedData([]);
    } finally {
      setIsProcessing(false);
    }
  }, [regionCode]);

  const exportExcel = useCallback(async () => {
    if (parsedData.length === 0) return;

    // BC-60: clear any stale error from a previous attempt so a successful
    // retry does not keep showing an outdated failure.
    setError(null);

    try {
      const exporter = new ExcelExporter();
      const vendorName = parsedData[0]?.vendorSite || 'Vendor';
      // The full warning detail ships INSIDE the workbook (Audit Trails
      // sheet) — the on-screen banner only announces the count.
      await exporter.generateAndDownload(parsedData, vendorName, warnings);
    } catch (err) {
      // BC-59/BC-60: export failures are labeled as such (not "Analysis
      // failed") and the stale green success banner is cleared so the two
      // never coexist.
      const msg = err instanceof Error ? err.message : 'Failed to generate Excel file.';
      setError(`Export failed: ${msg}`);
      setSuccessMessage(null);
    }
  }, [parsedData, warnings]);

  const clearState = useCallback(() => {
    setParsedData([]);
    setError(null);
    setSuccessMessage(null);
    setWarnings([]);
  }, []);

  return {
    parsedData,
    isProcessing,
    error,
    successMessage,
    warnings,
    processFile,
    exportExcel,
    clearState
  };
};