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
} from '../types/crtr.types';

const EMPTY_SUMMARY: SummaryData = { count: 0, totalInvoiceAmount: 0, totalCalculatedAmount: 0 };

export const useCrtrProcessor = () => {
  const [data, setData] = useState<ExcelRow[]>([]);
  const [rawFiles, setRawFiles] = useState<ParsedInputFile[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [validationError, setValidationError] = useState<string>('');
  const [processingErrors, setProcessingErrors] = useState<ProcessingError[]>([]);
  const [showConfigPanel, setShowConfigPanel] = useState<boolean>(false);
  const [descriptionField, setDescriptionField] = useState<DescriptionFieldChoice>('combined');
  const [summaryData, setSummaryData] = useState<SummaryData>(EMPTY_SUMMARY);

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
    (filesToProcess: ParsedInputFile[], config: CustomFieldConfig, descField: DescriptionFieldChoice) => {
      if (filesToProcess.length === 0) {
        setData([]);
        setSummaryData(EMPTY_SUMMARY);
        setProcessingErrors([]);
        return;
      }

      const processor = new CrtrXmlProcessor();
      let allData: ExcelRow[] = [];
      const localErrors: ProcessingError[] = [];

      setValidationError('');
      setProcessingErrors([]);

      processor.resetSupplierTracking();

      for (const file of filesToProcess) {
        try {
          const xmlDoc = processor.transformXML(file.content);
          if (xmlDoc) {
            const extracted = processor.extractDataForExcel(xmlDoc, {
              customData: config,
              descriptionField: descField,
            });
            allData.push(...extracted);
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

  useEffect(() => {
    processAndSetData(rawFiles, customFieldConfig, descriptionField);
  }, [customFieldConfig, rawFiles, descriptionField, processAndSetData]);

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
    uniqueTaxCodes,
    searchQuery,

    setSearchQuery,
    setShowConfigPanel,
    setCustomFieldConfig,
    setDescriptionField,
    handleFileSelection,
    getFilteredData,
  };
};