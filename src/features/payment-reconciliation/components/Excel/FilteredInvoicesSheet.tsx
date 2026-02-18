import * as XLSX from 'xlsx';
import type { PaymentRecord } from '../../types/regional.types';

export class FilteredInvoicesSheet {
  public create(records: PaymentRecord[]): XLSX.WorkSheet {
    const activeInvoices = this.filterActiveInvoices(records);
    const displayData = this.mapToDisplay(activeInvoices);
    const sheet = XLSX.utils.json_to_sheet(displayData);
    
    this.formatNumberColumns(sheet);
    
    return sheet;
  }

  private filterActiveInvoices(records: PaymentRecord[]): PaymentRecord[] {
    const correctionMap = this.buildCorrectionMap(records);
    const invoiceGroups = this.groupRelatedInvoices(records);
    const processedInvoices: PaymentRecord[] = [];

    invoiceGroups.forEach((group, rootNumber) => {
      const sortedGroup = this.sortByLength(group);
      const originalInvoice = this.findExactMatch(sortedGroup, rootNumber);
      
      if (originalInvoice) {
        processedInvoices.push(originalInvoice);
      }

      const chainMap = this.createChainMap(group);
      const validAdjustments = this.findValidAdjustments(group, rootNumber, chainMap, correctionMap);
      
      processedInvoices.push(...validAdjustments);
      
      const correctionInvoices = this.findLinkedCorrections(group, correctionMap);
      processedInvoices.push(...correctionInvoices);
    });

    const orphanCorrections = this.findOrphanCorrections(records, processedInvoices);
    processedInvoices.push(...orphanCorrections);

    return this.sortByDate(processedInvoices);
  }

  private buildCorrectionMap(records: PaymentRecord[]): Map<string, PaymentRecord> {
    const map = new Map<string, PaymentRecord>();
    
    records.forEach(row => {
      if (!row.invoiceNumber) return;
      
      const invoiceNumber = row.invoiceNumber.toUpperCase();
      const description = (row.description || '').toUpperCase();
      
      const isCorrectionType = invoiceNumber.startsWith('IQV') || invoiceNumber.startsWith('IPV');
      
      if (isCorrectionType && description) {
        const sourceMatch = description.match(/FOR\s+([A-Z0-9]+(?:SC|SCR|PC|PCR|SCRI|PCRI|SCRSC|SCRSCR|SCRSCRSC)*)/);
        if (sourceMatch) {
          map.set(sourceMatch[1], row);
        }
      }
    });
    
    return map;
  }

  private groupRelatedInvoices(records: PaymentRecord[]): Map<string, PaymentRecord[]> {
    const groups = new Map<string, PaymentRecord[]>();
    
    records.forEach(row => {
      if (!row.invoiceNumber || row.invoiceType === 'Giden Havale') return;
      
      const invoiceNumber = row.invoiceNumber.toUpperCase();
      if (invoiceNumber.startsWith('IQV') || invoiceNumber.startsWith('IPV')) return;

      const root = this.extractRootInvoiceNumber(invoiceNumber);
      
      if (!groups.has(root)) {
        groups.set(root, []);
      }
      groups.get(root)!.push(row);
    });

    return groups;
  }

  private extractRootInvoiceNumber(invoiceNumber: string): string {
    let root = invoiceNumber;
    let previous;
    
    do {
      previous = root;
      root = root.replace(/(SC|SCR|PC|PCR|SCRI|PCRI)$/, '');
    } while (root !== previous);

    return root;
  }

  private sortByLength(group: PaymentRecord[]): PaymentRecord[] {
    return [...group].sort((a, b) => a.invoiceNumber.length - b.invoiceNumber.length);
  }

  private findExactMatch(group: PaymentRecord[], rootNumber: string): PaymentRecord | undefined {
    return group.find(inv => inv.invoiceNumber.toUpperCase() === rootNumber);
  }

  private createChainMap(group: PaymentRecord[]): Map<string, PaymentRecord> {
    const map = new Map<string, PaymentRecord>();
    group.forEach(inv => map.set(inv.invoiceNumber.toUpperCase(), inv));
    return map;
  }

  private findValidAdjustments(
    group: PaymentRecord[], 
    rootNumber: string, 
    chainMap: Map<string, PaymentRecord>, 
    correctionMap: Map<string, PaymentRecord>
  ): PaymentRecord[] {
    return group.filter(inv => {
      const currentNumber = inv.invoiceNumber.toUpperCase();
      if (currentNumber === rootNumber) return false;

      const isReversed = this.checkIfReversed(currentNumber, chainMap, correctionMap);
      const isTerminalState = this.checkIfTerminalState(currentNumber);

      return !isReversed && !isTerminalState;
    });
  }

  private checkIfReversed(
    invoiceNumber: string, 
    chainMap: Map<string, PaymentRecord>, 
    correctionMap: Map<string, PaymentRecord>
  ): boolean {
    const hasStandardReversal = chainMap.has(invoiceNumber + 'R') || chainMap.has(invoiceNumber + 'RI');
    const hasCorrectionMapEntry = correctionMap.has(invoiceNumber);

    if (hasStandardReversal || hasCorrectionMapEntry) return true;

    if (invoiceNumber.endsWith('SC') && !invoiceNumber.endsWith('SCRSC')) {
      return chainMap.has(invoiceNumber + 'R') || chainMap.has(invoiceNumber + 'RI') || correctionMap.has(invoiceNumber);
    }
    
    if (invoiceNumber.endsWith('SCRSC')) {
      return chainMap.has(invoiceNumber + 'R') || chainMap.has(invoiceNumber + 'RI') || correctionMap.has(invoiceNumber);
    }

    if (invoiceNumber.endsWith('SCRSCRSC')) {
      return chainMap.has(invoiceNumber + 'R') || chainMap.has(invoiceNumber + 'RI') || correctionMap.has(invoiceNumber);
    }

    if (invoiceNumber.endsWith('PC') && !invoiceNumber.endsWith('PCRPC')) {
      return chainMap.has(invoiceNumber + 'R') || chainMap.has(invoiceNumber + 'RI') || correctionMap.has(invoiceNumber);
    }

    return false;
  }

  private checkIfTerminalState(invoiceNumber: string): boolean {
    return invoiceNumber.endsWith('SCR') || 
           invoiceNumber.endsWith('PCR') || 
           invoiceNumber.endsWith('SCRI') || 
           invoiceNumber.endsWith('PCRI') || 
           invoiceNumber.endsWith('SCRSCR') || 
           invoiceNumber.endsWith('SCRSCRSCR');
  }

  private findLinkedCorrections(group: PaymentRecord[], correctionMap: Map<string, PaymentRecord>): PaymentRecord[] {
    const corrections: PaymentRecord[] = [];
    group.forEach(inv => {
      const key = inv.invoiceNumber.toUpperCase();
      if (correctionMap.has(key)) {
        corrections.push(correctionMap.get(key)!);
      }
    });
    return corrections;
  }

  private findOrphanCorrections(allRecords: PaymentRecord[], processed: PaymentRecord[]): PaymentRecord[] {
    const processedSet = new Set(processed.map(p => p.invoiceNumber));
    
    return allRecords.filter(row => {
      if (!row.invoiceNumber) return false;
      const number = row.invoiceNumber.toUpperCase();
      const isCorrection = number.startsWith('IQV') || number.startsWith('IPV');
      return isCorrection && !processedSet.has(row.invoiceNumber);
    });
  }

  private sortByDate(records: PaymentRecord[]): PaymentRecord[] {
    return records.sort((a, b) => this.parseDate(a.invoiceDate) - this.parseDate(b.invoiceDate));
  }

  private parseDate(dateStr: string): number {
    if (!dateStr) return 0;
    return new Date(dateStr).getTime();
  }

  private mapToDisplay(records: PaymentRecord[]) {
    return records.map(row => ({
      'Fatura Numarası': row.invoiceNumber,
      'Ödeme para birimi': row.currency,
      'Fatura Tarihi': row.invoiceDate,
      'Fatura Açıklaması': row.description,
      'Alacak': this.parseNumber(row.credit),
      'Borç': this.parseNumber(row.debit)
    }));
  }

  private formatNumberColumns(sheet: XLSX.WorkSheet) {
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
    const cols = ['Alacak', 'Borç'];
    
    const colIndices: number[] = [];
    const headers = ['Fatura Numarası', 'Ödeme para birimi', 'Fatura Tarihi', 'Fatura Açıklaması', 'Alacak', 'Borç'];
    
    headers.forEach((h, i) => {
      if (cols.includes(h)) colIndices.push(i);
    });

    for (let r = 1; r <= range.e.r; r++) {
      colIndices.forEach(c => {
        const addr = XLSX.utils.encode_cell({ c, r });
        const cell = sheet[addr];
        if (cell) {
          sheet[addr] = { t: 'n', v: Number(cell.v), z: '#,##0.00' };
        }
      });
    }
  }

  private parseNumber(val: string): number {
    return parseFloat(String(val).replace(/,/g, '')) || 0;
  }
}