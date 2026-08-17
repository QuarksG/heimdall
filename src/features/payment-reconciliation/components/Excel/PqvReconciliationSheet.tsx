import * as XLSX from 'xlsx';
import type { PqvMatchResult } from '../../logic/matchers/threeWayMatchingEngine';
import type { PqvCycleInfo } from '../../logic/matchers/pqvLineage';

/**
 * PQV-RI sheet — SIDE-BY-SIDE TRIAL LAYOUT (analyst decision).
 *
 * The legacy RIGHT16 / PO#Amount heuristic columns are UNTOUCHED; the
 * referential lineage columns (RI|PQV dispute-cycle model, see
 * `logic/matchers/pqvLineage.ts`) render to their right. Analysts compare
 * both on real files before the legacy matcher is retired. IQV rows
 * without an RI|PQV reference show empty lineage columns — exactly the
 * population where only the heuristic can help.
 */
export class PqvReconciliationSheet {
  public create(
    matches: PqvMatchResult[],
    lineage?: Map<string, PqvCycleInfo>,
  ): XLSX.WorkSheet {
    const displayData = this.mapToDisplay(matches, lineage ?? new Map());
    const sheet = XLSX.utils.json_to_sheet(displayData);
    
    this.applyStyling(sheet, displayData);
    
    return sheet;
  }

  private mapToDisplay(matches: PqvMatchResult[], lineage: Map<string, PqvCycleInfo>) {

    return matches.map(match => {
      const cycle = lineage.get(match.invoiceNumber.toUpperCase());
      return {
      'Satır Numarası': match.rowNumber,
      'Ödeme yapılacak taraf': match.payee,
      'Ödeme para birimi': match.currency,
      'Tedarikçi site adı': match.vendorSite,
      'Ödeme Numarası': match.paymentNumber,
      'Ödeme tarihi': match.paymentDate,
      'Fatura Türü': match.invoiceType,
      'Fatura Numarası': match.invoiceNumber,
      'Fatura Tarihi': match.invoiceDate,
      'Yaş (Gün)': match.agingDays ?? '',
      'PO: Sipariş Numarası': match.poNumber, 
      'Fatura Açıklaması': match.description,
      'Alacak': match.credit,
      'Borç': match.debit,
      'Parent Invoice (RIGHT16)': match.parentInvoiceCandidate,
      'Key2 (PO#Amount)': match.matchKey,
      'Matched Parents From Sales': match.matchedParents,
      'Worst case Match': match.worstCaseMatches,
      // ---- Lineage trial columns (RI|PQV dispute-cycle model) ----
      'Origin Root (RI|PQV)': cycle?.originRoot ?? '',
      'Cycle Doc (RI|PQV)': cycle?.cycleDoc ?? '',
      'Cycle #': cycle ? `${cycle.cycleIndex}/${cycle.cycleCount}` : '',
      'Invoice Amount Gross (X)': cycle?.invoiceGross ?? '',
      'Not Paid via IQV (Y)': cycle?.iqvGross ?? '',
      'Cycle State': cycle?.state ?? '',
      'Candidates matched for payment of re-issued RIs': cycle?.counterInvoicesAfterIqv ?? '',
      'Lineage Alert-Only Recommendation': cycle?.lineageAlert ?? ''
      };
    });
  }

  private applyStyling(sheet: XLSX.WorkSheet, data: any[]) {
    if (data.length === 0) return;

    const headers = Object.keys(data[0]);
    sheet['!cols'] = headers.map((_, i) => ({ wch: i < 4 ? 32 : 18 }));


    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
    const numberHeaders = [
      'Alacak',
      'Borç',
      'Invoice Amount Gross (X)',
      'Not Paid via IQV (Y)',
    ]; 
    const colIndices: number[] = [];

    headers.forEach((h, i) => {
      if (numberHeaders.includes(h)) colIndices.push(i);
    });

    for (let r = 1; r <= range.e.r; r++) {
      colIndices.forEach(c => {
        const addr = XLSX.utils.encode_cell({ c, r });
        const cell = sheet[addr];
        // Amounts are numeric on the record — format number cells only.
        if (cell && typeof cell.v === 'number') {
          sheet[addr] = { t: 'n', v: cell.v, z: '#,##0.00' };
        }
      });
    }
  }
}