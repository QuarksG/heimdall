import { useState, useCallback } from 'react';
import JSZip from 'jszip';
import { toast } from 'react-toastify';
import { readFile, readFileBuffer } from '../utils/fileReader';
import { xmlToHtml } from '../utils/xmlToHtml';
import type { ParsedInvoice } from '../utils/xmlToHtml';

const BATCH_SIZE = 5;
const PROCESSING_DELAY = 100;

export interface ProcessingStatusType {
  isProcessing: boolean;
  totalFiles: number;
  processedFiles: number;
  failedFiles: { name: string; error: string }[];
  successCount: number;
}

export const useInvoiceProcessor = () => {
  const [invoices, setInvoices] = useState<ParsedInvoice[]>([]);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatusType>({
    isProcessing: false,
    totalFiles: 0,
    processedFiles: 0,
    failedFiles: [],
    successCount: 0
  });

  const processBatch = async (files: File[], startIndex: number, batchSize: number) => {
    const batch = files.slice(startIndex, startIndex + batchSize);
    const results: ParsedInvoice[] = [];
    const failed: { name: string; error: string }[] = [];

    for (const file of batch) {
      try {
        if (file.name.toLowerCase().endsWith('.xml')) {
          const content = await readFile(file);
          const invoice = xmlToHtml(file.name, content);
          results.push(invoice);
        } else if (file.name.toLowerCase().endsWith('.zip')) {
          const fileBuffer = await readFileBuffer(file);
          const zip = await JSZip.loadAsync(fileBuffer);
          
          const zipResults = await Promise.all(
            Object.keys(zip.files).map(async (k) => {
              const zipFile = zip.files[k];
              if (zipFile.name.toLowerCase().endsWith(".xml")) {
                try {
                  const content = await zipFile.async("text");
                  return xmlToHtml(zipFile.name, content);
                } catch (err: any) {
                  failed.push({ name: zipFile.name, error: err.message });
                  return null;
                }
              }
              return null;
            })
          );
          
          results.push(...(zipResults.filter(Boolean) as ParsedInvoice[]));
        }
      } catch (err: any) {
        failed.push({ name: file.name, error: err.message });
      }
    }

    return { results, failed };
  };

  const processFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    setProcessingStatus({
      isProcessing: true,
      totalFiles: files.length,
      processedFiles: 0,
      failedFiles: [],
      successCount: 0
    });

    const allResults: ParsedInvoice[] = [];
    const allFailed: { name: string; error: string }[] = [];
    
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const { results, failed } = await processBatch(files, i, BATCH_SIZE);
      
      allResults.push(...results);
      allFailed.push(...failed);
      
      setProcessingStatus(prev => ({
        ...prev,
        processedFiles: Math.min(i + BATCH_SIZE, files.length),
        successCount: prev.successCount + results.length,
        failedFiles: [...prev.failedFiles, ...failed]
      }));

      if (i + BATCH_SIZE < files.length) {
        await new Promise(resolve => setTimeout(resolve, PROCESSING_DELAY));
      }
    }

    setInvoices(prev => {
      const existingIds = new Set(prev.map(inv => inv.id));
      const newInvoices = allResults.filter(inv => !existingIds.has(inv.id));
      return [...prev, ...newInvoices];
    });

    if (allFailed.length > 0) {
      toast.warning(
        `Processed ${allResults.length} invoices successfully. ${allFailed.length} files failed.`,
        { autoClose: 5000 }
      );
    } else if (allResults.length > 0) {
      toast.success(`Successfully processed ${allResults.length} invoices!`);
    }

    setProcessingStatus(prev => ({ ...prev, isProcessing: false }));
  }, []);

  const removeInvoice = useCallback((id: string) => {
    setInvoices(prev => prev.filter(inv => inv.id !== id));
    toast.info("Invoice removed");
  }, []);

  const clearAllInvoices = useCallback(() => {
    setInvoices([]);
    toast.info("All invoices cleared");
  }, []);

  return {
    invoices,
    processingStatus,
    processFiles,
    removeInvoice,
    clearAllInvoices,
    setInvoices
  };
};