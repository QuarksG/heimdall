import { useState, useCallback, useRef } from 'react';
import JSZip from 'jszip';
import { XMLToExcelConverter } from '../utils/xmlParser';
import type { FieldDefinition } from '../constants/fieldDefinitions';

export const useFileProcessor = (allDefinitions: FieldDefinition[]) => {
  const [data, setData] = useState<any[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const processedFilesRef = useRef<Set<string>>(new Set());

  const handleFiles = useCallback(async (fileList: FileList) => {
    setIsProcessing(true);
    const newData: any[] = [];
    const files = Array.from(fileList);
    const converter = new XMLToExcelConverter();

    const processXML = (xmlContent: string, fileName: string) => {
      if (processedFilesRef.current.has(fileName)) {
        return; 
      }
      
      const doc = converter.transformXML(xmlContent);
      if (doc) {
        const extracted = converter.extractDataForExcel(doc, allDefinitions);
        newData.push(...extracted);
        processedFilesRef.current.add(fileName);
      }
    };

    try {
      for (const file of files) {
        if (file.name.endsWith('.zip')) {
          const zip = await JSZip.loadAsync(file);
          const xmlFiles = Object.keys(zip.files).filter(name => name.endsWith('.xml'));
          
          for (const xmlFileName of xmlFiles) {
            const xmlContent = await zip.file(xmlFileName)?.async('string');
            if (xmlContent) {
              processXML(xmlContent, xmlFileName);
            }
          }
        } else if (file.name.endsWith('.xml')) {
          const xmlContent = await file.text();
          processXML(xmlContent, file.name);
        }
      }
      
      setData(prevData => [...prevData, ...newData]);

    } catch (error) {
      console.error("Error processing files:", error);
    } finally {
      setIsProcessing(false);
    }
  }, [allDefinitions]);

  return { data, handleFiles, isProcessing };
};