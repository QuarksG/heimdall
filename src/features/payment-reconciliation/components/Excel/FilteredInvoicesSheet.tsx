import * as XLSX from 'xlsx';
import { runPqvOperations } from '../../logic/cleaners/operations/PQV_Operations';
import { runPpvOperations, collectPpvClaimedRoots } from '../../logic/cleaners/operations/PPV_Operations';
import { runProvisionOperations } from '../../logic/cleaners/operations/Provision_Operations';
import { runQpdOperations } from '../../logic/cleaners/operations/QPD_Operations';
import type { OperationResult, OperationChain } from '../../logic/cleaners/operations/operations.types';
import type { PaymentRecord } from '../../types/regional.types';

/**
 * FILTERED INVOICES — THE OPERATIONS TRACE SHEET.
 *
 * Rewritten (previous suffix-walking heuristic deleted): this sheet is now
 * the merged output of the cleaning-operations family — PQV, PPV,
 * Provision and QPD — one row per document CHAIN, with its resolved
 * lifecycle state, gross residual and narrative. It is the single
 * reference point where anomalies and balance impact are traced back to
 * their chains; the raw rows remain on Payment Data.
 *
 * Ordering: attention chains first (the analyst's worklist), then closed
 * chains as the audit trail. All four domains are live — PQV, PPV,
 * Provision and QPD.
 */
export class FilteredInvoicesSheet {
  private static readonly HEADERS = [
    'Operasyon',
    'Referans',
    'Fatura Tarihi',
    'Durum',
    'Aksiyon Faturası',
    'Dikkat',
    'Tur Sayısı',
    'Net (Alacak−Borç)',
    'Uygulanan indirim',
    'Kalıntı (Brüt)',
    'Kesinti Fatura (IQV/IPV)',
    'Yaş (Gün)',
    'Zincir Belgeleri',
    'Açıklama',
  ] as const;

  /** 0-based indices of the amount columns (number format #,##0.00). */
  private static readonly AMOUNT_COLUMNS = [7, 8, 9, 10];

  public create(records: PaymentRecord[]): XLSX.WorkSheet {
    // Cross-family sales adjudication: 'Reconciled on due date' requires
    // NO claim from PQV ∪ PPV, so PQV receives PPV's claimed roots.
    const ppvClaimedRoots = collectPpvClaimedRoots(records);
    const results: OperationResult[] = [
      runPqvOperations(records, ppvClaimedRoots),
      runPpvOperations(records),
      runProvisionOperations(records),
      runQpdOperations(records),
    ];

    const rows: unknown[][] = [
      ['OPERASYON ANALİZİ — PQV / PPV / Provizyon / QPD'],
      [this.summaryLine(results)],
      [],
      [...FilteredInvoicesSheet.HEADERS],
    ];

    this.mergeChains(results).forEach(({ domain, chain }) => {
      rows.push([
        domain,
        chain.reference,
        chain.invoiceDate ?? '',
        chain.state,
        chain.actionInvoice,
        chain.attention ? 'EVET' : '',
        chain.rounds ?? '',
        chain.net,
        chain.discount,
        chain.residual,
        chain.finalDocNet ?? '',
        chain.elapsedDays ?? '',
        // Zincir Belgeleri: audit-trail override when the module provides
        // one (provision batches carry payment numbers), else the plain
        // invoice-number list.
        (chain.documentTrail ?? chain.rows.map(r => r.invoiceNumber)).join(' | '),
        chain.narrative,
      ]);
    });

    const sheet = XLSX.utils.aoa_to_sheet(rows);
    this.applyLayout(sheet, rows.length);
    return sheet;
  }

  /** Per-domain roll-up so absent domains are stated, never inferred. */
  private summaryLine(results: OperationResult[]): string {
    return results
      .map(result => {
        const attention = result.chains.filter(chain => chain.attention).length;
        return `${result.domain}: ${result.chains.length} zincir, ${attention} dikkat, net ${result.netEffect.toFixed(2)}`;
      })
      .join('   |   ');
  }

  /** Merge all domains; attention first, then domain, then reference. */
  private mergeChains(results: OperationResult[]): Array<{ domain: string; chain: OperationChain }> {
    const merged: Array<{ domain: string; chain: OperationChain }> = [];
    results.forEach(result =>
      result.chains.forEach(chain => merged.push({ domain: result.domain, chain })),
    );
    merged.sort((a, b) => {
      if (a.chain.attention !== b.chain.attention) return a.chain.attention ? -1 : 1;
      if (a.domain !== b.domain) return a.domain.localeCompare(b.domain);
      return a.chain.reference.localeCompare(b.chain.reference);
    });
    return merged;
  }

  private applyLayout(sheet: XLSX.WorkSheet, rowCount: number): void {
    sheet['!cols'] = [
      { wch: 10 }, // Operasyon
      { wch: 22 }, // Referans
      { wch: 12 }, // Fatura Tarihi
      { wch: 40 }, // Durum
      { wch: 28 }, // Aksiyon Faturası
      { wch: 7 },  // Dikkat
      { wch: 10 }, // Tur Sayısı
      { wch: 16 }, // Net
      { wch: 16 }, // indirim
      { wch: 14 }, // Kalıntı
      { wch: 18 }, // Kesin Fatura
      { wch: 10 }, // Yaş
      { wch: 60 }, // Zincir Belgeleri
      { wch: 110 }, // Açıklama
    ];

    // Amount columns: numeric with currency format (data starts row 5).
    for (let r = 4; r < rowCount; r++) {
      FilteredInvoicesSheet.AMOUNT_COLUMNS.forEach(c => {
        const addr = XLSX.utils.encode_cell({ c, r });
        const cell = sheet[addr];
        if (cell && cell.v !== '' && cell.v != null) {
          sheet[addr] = { t: 'n', v: Number(cell.v), z: '#,##0.00' };
        }
      });
    }
  }
}
