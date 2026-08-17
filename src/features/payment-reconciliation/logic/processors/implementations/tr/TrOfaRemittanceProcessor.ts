import { BaseRemittanceProcessor } from '../../base/BaseRemittanceProcessor';
import { TrInvoiceClassifier } from '../../../classifiers/implementations/TrInvoiceClassifier';
import { PaymentTransformer } from '../../../cleaners/paymentTransformer';
import { FileIntegrityValidator } from '../../../validators/fileIntegrityValidator';
import { buildVendorSeriesNotes } from '../../../classifiers/invoiceClassificationRules';
import { trRegionConfig } from '../../../../config/regions/implementations/tr.config';
import type { ParsingResult } from '../../../../types/regional.types';

/**
 * TR remittance processor — PURE EXTRACTION.
 *
 * Owns: section discovery and raw field extraction from the worksheet
 * matrix, keyed by the canonical field keys from `tr.config.ts`.
 *
 * Does NOT own: integrity validation (`FileIntegrityValidator`), cleaning/
 * classification/grouping (`PaymentTransformer`), or classification rules
 * (`invoiceClassificationRules.ts`). `parse()` orchestrates those owners
 * in order.
 */
export class TrOfaRemittanceProcessor extends BaseRemittanceProcessor {
  private transformer: PaymentTransformer;

  constructor() {
    super();
    this.transformer = new PaymentTransformer(new TrInvoiceClassifier());
  }


  protected getDisclaimerText(): string {
    return trRegionConfig.markers.emailDisclaimer;
  }

  protected getPaymentHeaderText(): string {
    return trRegionConfig.markers.paymentStart;
  }

  protected getInvoiceHeaderText(): string {
    return 'fatura nu'; 
  }

  protected getPaymentHeaderMapping(): Record<string, string> {
    return trRegionConfig.mappings;
  }

  protected getPaymentHeaders(): string[] {
    return trRegionConfig.headers.payment;
  }

  protected getInvoiceHeaders(): string[] {
    return trRegionConfig.headers.invoice;
  }


  protected mapPaymentLabel(rawLabel: string): string | null {
    let label = this.normalizeText(rawLabel);
    label = label.replace(/:/g, '').replace(/-/g, ' ');
    
    const mapping = this.getPaymentHeaderMapping();
    for (const [key, canonical] of Object.entries(mapping)) {
      if (label.startsWith(key)) return canonical;
    }

    // Legacy-encoding tolerance: older OFA remittance emails replace
    // Turkish characters the mail encoding cannot represent with a literal
    // '?' ("Odeme numaras?:" for "Ödeme numarası:"). A '?' is therefore
    // "some Turkish character we lost" — treat it as a single-character
    // wildcard and retry the prefix match, so these labels bind by NAME
    // instead of falling through to the positional fallback.
    if (label.includes('?')) {
      for (const [key, canonical] of Object.entries(mapping)) {
        if (TrOfaRemittanceProcessor.prefixMatchesWithWildcard(label, key)) {
          return canonical;
        }
      }
    }
    return null;
  }

  /**
   * Prefix match where '?' in the label matches ANY single character of
   * the key (mojibake substitution from legacy encodings).
   */
  private static prefixMatchesWithWildcard(label: string, key: string): boolean {
    if (label.length < key.length) return false;
    for (let i = 0; i < key.length; i++) {
      if (label[i] !== key[i] && label[i] !== '?') return false;
    }
    return true;
  }

  public parse(fileContent: unknown[][]): ParsingResult {
    const matrix = this.createMatrix(fileContent);

    // Pre-parse integrity gate — owned by the validator (BLOCKING).
    const integrity = FileIntegrityValidator.validateRemittanceWorksheet(
      matrix,
      this.getDisclaimerText(),
      text => this.normalizeText(text),
    );
    if (!integrity.ok) {
      return { isValid: false, records: [], message: integrity.message, warnings: [] };
    }

    const extractionResult = this.extractRawSections(matrix);

    if (!extractionResult.ok) {
      // Extraction warnings are passed through even on failure — they are
      // the diagnosis for WHY no sections were extracted.
      return {
        isValid: false,
        records: [],
        message: extractionResult.message,
        warnings: extractionResult.warnings
      };
    }

    const cleanedRecords = this.transformer.transform(extractionResult.results);

    // Warnings from the extraction pass (skipped sections, positional
    // label fallbacks) plus the full post-parse validation toolbox.
    // The parse succeeded — but nothing lossy passes silently.
    const warnings = [
      ...extractionResult.warnings,
      ...FileIntegrityValidator.validatePaymentHeaderFields(cleanedRecords),
      ...FileIntegrityValidator.validateRowCompleteness(cleanedRecords),
      ...FileIntegrityValidator.validatePaymentGroupTotals(cleanedRecords),
      ...FileIntegrityValidator.validateShortagePattern(cleanedRecords),
      ...FileIntegrityValidator.validateReversalReferences(cleanedRecords),
      ...FileIntegrityValidator.validateDiscountSymmetry(cleanedRecords),
      ...FileIntegrityValidator.validateAgingProfile(cleanedRecords),
      ...FileIntegrityValidator.validateQpdPresence(cleanedRecords),
      // Vendor series inference visibility (analyst ruling — prefix
      // demotion): whether the C/V prefix demotion is active for this
      // file, and when it is not, exactly why — an unchanged
      // classification must be explainable, never silent.
      ...buildVendorSeriesNotes(cleanedRecords),
    ];

    return {
      isValid: true,
      records: cleanedRecords,
      message: `Successfully parsed ${cleanedRecords.length} records.`,
      warnings
    };
  }



  private createMatrix(aoa: unknown[][]): unknown[][] {
    return aoa; 
  }

  private extractRawSections(matrix: unknown[][]): {
    ok: boolean;
    results: any[];
    message: string;
    warnings: string[];
  } {
    const rows = matrix.length;
    const cols = matrix.reduce((max, row) => Math.max(max, (row as any[]).length), 0);
    const getCell = (r: number, c: number) => {
      if (r < 0 || r >= rows || c < 0 || c >= cols) return null;
      const row = matrix[r] as any[];
      return row && row[c] !== undefined ? row[c] : null;
    };

    const disclaimer = this.getDisclaimerText();

    // File integrity (disclaimer presence) is validated up-front in
    // `parse()` by FileIntegrityValidator — extraction assumes a valid file.
    const results: any[] = [];
    // Extraction anomalies: everything that used to be skipped SILENTLY now
    // emits a warning (row numbers are 1-based, matching what Excel shows).
    const warnings: string[] = [];
    let currentRow = 0;

    while (currentRow < rows) {
      // Find Header Section
      let headerRowIndex = null;
      let headerColIndex = null;
      let sectionFound = false;

      for (let r = currentRow; r < rows && !sectionFound; r++) {
        for (let c = 0; c < cols; c++) {
          const cellValue = getCell(r, c);
          if (this.isValuePresent(cellValue) && this.normalizeText(String(cellValue)).includes(disclaimer)) {
            headerRowIndex = r;
            headerColIndex = c;
            sectionFound = true;
            break;
          }
        }
      }

      if (!sectionFound) break;

     
      let paymentStartRow = null;
      const paymentMarker = this.getPaymentHeaderText();
      
      for (let r = headerRowIndex!; r < rows; r++) {
        const cellValue = getCell(r, headerColIndex!);
        if (this.isValuePresent(cellValue) && this.normalizeText(String(cellValue)).includes(paymentMarker)) {
          paymentStartRow = r;
          break;
        }
      }

      
      if (paymentStartRow === null) {
        outerLoop: for (let r = headerRowIndex!; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const cellValue = getCell(r, c);
            if (this.isValuePresent(cellValue) && this.normalizeText(String(cellValue)).includes(paymentMarker)) {
              paymentStartRow = r;
              break outerLoop;
            }
          }
        }
      }

      if (paymentStartRow === null) {
        warnings.push(
          `Section starting at row ${headerRowIndex! + 1}: payment block marker not found — section skipped. Its records are NOT included.`,
        );
        currentRow = headerRowIndex! + 1;
        continue;
      }

    
      const paymentValues: Record<string, string> = {};
      const targetHeaders = this.getPaymentHeaders();
      targetHeaders.forEach(h => paymentValues[h] = '');

      for (let i = 0; i < 7; i++) {
        const r = paymentStartRow + i;
        if (r >= rows) continue;
        
        const rowData = (matrix[r] as any[]) || [];
        const startCol = Math.max(0, headerColIndex! - 2);
        
        let [labelCol, labelVal] = this.findFirstValueInRow(rowData, startCol);
        if (labelCol === null) [labelCol, labelVal] = this.findFirstValueInRow(rowData, 0);
        
        if (labelCol === null || !this.isValuePresent(labelVal)) continue;

        let canonicalKey = this.mapPaymentLabel(String(labelVal));
        const [, valueVal] = this.findNextValueToRight(rowData, labelCol);

        if (!canonicalKey && i < targetHeaders.length) {
          // Positional fallback (BC-17): an unrecognized label is bound by
          // ROW POSITION, which silently misassigns values when the block
          // shape shifts. Kept for tolerance, but no longer silent.
          canonicalKey = targetHeaders[i];
          warnings.push(
            `Payment block at row ${r + 1}: unrecognized label "${String(labelVal).trim()}" bound by position to "${canonicalKey}" — verify this payment's field values.`,
          );
        }

        if (canonicalKey && valueVal != null) {
          paymentValues[canonicalKey] = String(valueVal).trim();
        }
      }

      
      let invoiceHeaderRow = null;
      let invoiceHeaderCol = null;
      const invoiceMarker = this.getInvoiceHeaderText();

      outerInvoice: for (let r = paymentStartRow; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cellValue = getCell(r, c);
          if (this.isValuePresent(cellValue) && this.normalizeText(String(cellValue)).startsWith(invoiceMarker)) {
            invoiceHeaderRow = r;
            invoiceHeaderCol = c;
            break outerInvoice;
          }
        }
      }

      if (invoiceHeaderRow === null) {
        warnings.push(
          `Section starting at row ${headerRowIndex! + 1}: invoice table header not found — section skipped. Its records are NOT included.`,
        );
        currentRow = paymentStartRow + 1;
        continue;
      }

     
      const tableCols: number[] = [];
      for (let c = invoiceHeaderCol!; c < cols && tableCols.length < 6; c++) {
        if (this.isValuePresent(getCell(invoiceHeaderRow, c))) tableCols.push(c);
      }
      
     
      if (tableCols.length < 6) {
        for (let c = invoiceHeaderCol! + 1; c < cols && tableCols.length < 6; c++) {
          if (this.isValuePresent(getCell(invoiceHeaderRow, c))) tableCols.push(c);
        }
      }

      if (tableCols.length < 6) {
        warnings.push(
          `Section starting at row ${headerRowIndex! + 1}: invoice table has fewer than 6 header columns (found ${tableCols.length}) — section skipped. Its records are NOT included.`,
        );
        currentRow = invoiceHeaderRow + 1;
        continue;
      }

      // Extract Invoice Rows
      let currentRowPointer = invoiceHeaderRow + 1;
      let extractedAny = false;
      const invoiceHeaders = this.getInvoiceHeaders();

      while (currentRowPointer < rows) {
        const rowVals: string[] = [];
        let nonEmptyCount = 0;

        for (let k = 0; k < 6; k++) {
          const cellValue = getCell(currentRowPointer, tableCols[k]);
          if (this.isValuePresent(cellValue)) nonEmptyCount++;
          rowVals.push(cellValue == null ? '' : String(cellValue));
        }

        if (nonEmptyCount === 0) break;

        const record = { ...paymentValues };
        invoiceHeaders.forEach((h, idx) => {
          record[h] = rowVals[idx];
        });
        
        results.push(record);
        extractedAny = true;
        currentRowPointer++;
      }

      currentRow = extractedAny ? currentRowPointer + 1 : invoiceHeaderRow + 1;
    }

    if (results.length === 0) {
      return {
        ok: false,
        results: [],
        message: 'No complete sections (payment + invoices) found.',
        warnings,
      };
    }

    return { ok: true, results, message: '', warnings };
  }

}