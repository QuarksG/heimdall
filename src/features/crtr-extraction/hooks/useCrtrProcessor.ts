import { useState, useEffect, useMemo, useCallback } from 'react';
import JSZip from 'jszip';
import { CrtrXmlProcessor } from '../utils/crtrXmlParser';
import { CUSTOM_FIELD_DEFS } from '../constants/crtrDefaults';

import type {
  ExcelRow,
  ParsedInputFile,
  CustomFieldConfig,
  DescriptionFieldChoice,
  HeaderDef,
  ProcessingError,
  SummaryData,
  TaxMismatchInfo,
  TaxMismatchDetail,
} from '../types/crtr.types';

const EMPTY_SUMMARY: SummaryData = { count: 0, totalInvoiceAmount: 0, totalCalculatedAmount: 0 };
const EMPTY_MISMATCH: TaxMismatchInfo = { detected: false, invoices: [] };

export const useCrtrProcessor = () => {
  const [data, setData] = useState<ExcelRow[]>([]);
  const [rawFiles, setRawFiles] = useState<ParsedInputFile[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [validationError, setValidationError] = useState<string>('');
  const [processingErrors, setProcessingErrors] = useState<ProcessingError[]>([]);
  const [showConfigPanel, setShowConfigPanel] = useState<boolean>(false);
  const [descriptionField, setDescriptionField] = useState<DescriptionFieldChoice>('combined');
  const [customDescription, setCustomDescription] = useState<string>('');
  const [summaryData, setSummaryData] = useState<SummaryData>(EMPTY_SUMMARY);

  // Tax mismatch state
  const [taxMismatch, setTaxMismatch] = useState<TaxMismatchInfo>(EMPTY_MISMATCH);
  const [useDocumentOverride, setUseDocumentOverride] = useState<boolean>(false);

  const [customFieldConfig, setCustomFieldConfig] = useState<CustomFieldConfig>({
    Item: {
      vendorNum: '',
      vendorSiteCode: '',
      invoiceType: 'Standard',
      termsName: CUSTOM_FIELD_DEFS.termsName.placeholder || '',
      paymentMethod: 'Check',
      glAccount: '',
      Paygroup: CUSTOM_FIELD_DEFS.Paygroup.placeholder || '',
      generate_return_invoice: 'MISC',
    },
    Tax: {
      glAccount: { default: '' },
      taxSchemeOverride: '',
    },
  });

  const uniqueTaxCodes = useMemo((): string[] => {
    const codes = new Set<string>();
    data.forEach((row) => {
      if (row.LineType === 'TAX' && typeof row.TaxCode === 'string' && row.TaxCode.length > 0) {
        codes.add(row.TaxCode);
      }
    });
    return Array.from(codes).sort();
  }, [data]);

  const processAndSetData = useCallback(
    (
      filesToProcess: ParsedInputFile[],
      config: CustomFieldConfig,
      descField: DescriptionFieldChoice,
      customDesc: string,
      applyDocumentOverride: boolean
    ) => {
      if (filesToProcess.length === 0) {
        setData([]);
        setSummaryData(EMPTY_SUMMARY);
        setProcessingErrors([]);
        setTaxMismatch(EMPTY_MISMATCH);
        return;
      }

      const processor = new CrtrXmlProcessor();
      let allData: ExcelRow[] = [];
      const localErrors: ProcessingError[] = [];
      const mismatchDetails: TaxMismatchDetail[] = [];

      setValidationError('');
      setProcessingErrors([]);

      // Only clear mismatch state on fresh processing (not on override reprocess)
      if (!applyDocumentOverride) {
        setTaxMismatch(EMPTY_MISMATCH);
      }

      processor.resetSupplierTracking();

      for (const file of filesToProcess) {
        try {
          const xmlDoc = processor.transformXML(file.content);
          if (xmlDoc) {
            const result = processor.extractDataForExcel(xmlDoc, {
              customData: config,
              descriptionField: descField,
              customDescription: customDesc,
              useDocumentOverride: applyDocumentOverride,
            }, file.name);

            allData.push(...result.rows);

            if (result.mismatch) {
              mismatchDetails.push(result.mismatch);
            }
          }
        } catch (error: unknown) {
          const err = error as Error;
          localErrors.push({ name: file.name, message: err.message });

          if (err.message.includes('Multiple suppliers')) {
            setValidationError(err.message);
            setData([]);
            setSummaryData(EMPTY_SUMMARY);
            allData = [];
            break;
          }
        }
      }

      setData(allData);
      setProcessingErrors(localErrors);

      // Surface mismatch info (only on first pass)
      if (!applyDocumentOverride && mismatchDetails.length > 0) {
        setTaxMismatch({
          detected: true,
          invoices: mismatchDetails,
        });
      }

      if (allData.length > 0) {
        const totalCalculated = allData.reduce((sum, row) => sum + parseFloat(String(row.LineAmount || 0)), 0);

        const uniqueInvoices = new Map<string | null | undefined, number>();
        allData.forEach((row) => {
          if (!uniqueInvoices.has(row.uuid)) {
            uniqueInvoices.set(row.uuid, parseFloat(String(row.invoice_amount || 0)));
          }
        });

        const totalDeclared = Array.from(uniqueInvoices.values()).reduce((sum, amount) => sum + amount, 0);

        setSummaryData({
          count: uniqueInvoices.size,
          totalInvoiceAmount: totalDeclared,
          totalCalculatedAmount: totalCalculated,
        });
      } else if (localErrors.length === 0) {
        setSummaryData(EMPTY_SUMMARY);
      }
    },
    []
  );

  const handleFileSelection = useCallback(async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return;

    setValidationError('');
    setProcessingErrors([]);
    setUseDocumentOverride(false);
    setTaxMismatch(EMPTY_MISMATCH);

    try {
      const fileReadPromises: Array<Promise<ParsedInputFile[]>> = Array.from(files).map((file: File) => {
        return new Promise<ParsedInputFile[]>((resolve) => {
          if (file.name.endsWith('.xml')) {
            const reader = new FileReader();
            reader.onload = (e: ProgressEvent<FileReader>) =>
              resolve([{ name: file.name, content: String(e.target?.result ?? '') }]);
            reader.readAsText(file);
          } else if (file.name.endsWith('.zip')) {
            JSZip.loadAsync(file).then((zip) => {
              const xmlPromises = Object.values(zip.files)
                .filter((f) => !f.dir && String(f.name).endsWith('.xml'))
                .map((f) => f.async('string').then((content) => ({ name: String(f.name), content })));

              resolve(Promise.all(xmlPromises));
            });
          } else {
            resolve([]);
          }
        });
      });

      const fileContentsByGroup = await Promise.all(fileReadPromises);
      const allFileContents = fileContentsByGroup.flat();
      setRawFiles(allFileContents);
    } catch (error: unknown) {
      const err = error as Error;
      setValidationError(err.message);
      setRawFiles([]);
    }
  }, []);

  /** User confirmed: reprocess with document-level override */
  const confirmDocumentOverride = useCallback(() => {
    setUseDocumentOverride(true);
    setTaxMismatch(EMPTY_MISMATCH);
  }, []);

  /** User dismissed: keep original line-level data */
  const dismissMismatch = useCallback(() => {
    setTaxMismatch(EMPTY_MISMATCH);
  }, []);

  useEffect(() => {
    processAndSetData(rawFiles, customFieldConfig, descriptionField, customDescription, useDocumentOverride);
  }, [customFieldConfig, rawFiles, descriptionField, customDescription, useDocumentOverride, processAndSetData]);

  const getFilteredData = useCallback(
    (selectedHeaders: HeaderDef[]) => {
      if (!searchQuery) return data;
      const lowercasedQuery = searchQuery.toLowerCase();
      return data.filter((item) =>
        selectedHeaders.some((header) => String(item[header.key] ?? '').toLowerCase().includes(lowercasedQuery))
      );
    },
    [data, searchQuery]
  );

  return {
    data,
    summaryData,
    validationError,
    processingErrors,
    showConfigPanel,
    customFieldConfig,
    descriptionField,
    customDescription,
    uniqueTaxCodes,
    searchQuery,
    taxMismatch,

    setSearchQuery,
    setShowConfigPanel,
    setCustomFieldConfig,
    setDescriptionField,
    setCustomDescription,
    handleFileSelection,
    getFilteredData,
    confirmDocumentOverride,
    dismissMismatch,
  };
};