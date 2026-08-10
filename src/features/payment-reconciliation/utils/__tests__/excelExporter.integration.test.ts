// End-to-end in-memory integration test — full generateBlob pipeline.
//
// Drives the complete export pipeline entirely in memory on a realistic
// record set (sales invoice, deduction invoice, notice + reversal pair,
// provision, Giden Havale transfer): build sheets → XLSX.write →
// injectPivotTable → re-open via XLSX.read. No file I/O beyond in-memory
// bytes; no network.
//
// Asserts: all six sheets present in the fixed order; the injected package
// re-opens without error; the Vendor Ledger sheet carries the reconciliation
// message region and only balance-impact data rows; the pivot OOXML parts
// exist in the zip; and the empty-input case (records = []) also completes
// end-to-end.
//
// **Validates: Requirements 1.1, 2.3, 8.1, 8.3**

import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { ExcelExporter } from '../excelExporter';
import type { PaymentRecord, InvoiceCategory } from '../../types/regional.types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The fixed seven-sheet order the exporter emits (Requirements 1.5, 2.3). */
const FIXED_SHEET_ORDER = [
  'Payment Data',
  'HAVALE',
  'Filtered Invoices',
  'Pivot Fatura Türü',
  'PQV-RI',
  'Tedarikçi Cari Hareketleri',
  'Disclaimer',
] as const;

/** The 14 Vendor Ledger header labels (spaced amount labels — Req 3.2). */
const VENDOR_LEDGER_HEADERS = [
  'Satır Numarası',
  'Ödeme yapılacak taraf',
  'Ödeme para birimi',
  'Tedarikçi site adı',
  'Ödeme Numarası',
  'Ödeme tarihi',
  'Fatura Türü',
  'Fatura Numarası',
  'Fatura Tarihi',
  'Yaş (Gün)',
  'PO: Sipariş Numarası',
  'Fatura Açıklaması',
  ' Uygulanan indirim ',
  ' Alacak ',
  ' Borç ',
] as const;

/** Pivot OOXML parts the injector must add (Requirement 6.1). */
const PIVOT_PARTS = [
  'xl/pivotCache/pivotCacheDefinition1.xml',
  'xl/pivotCache/pivotCacheRecords1.xml',
  'xl/pivotTables/pivotTable1.xml',
  'xl/pivotTables/_rels/pivotTable1.xml.rels',
  'xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels',
] as const;

/** Builds a PaymentRecord with sensible defaults, overridable per test. */
function makeRecord(
  overrides: Partial<PaymentRecord> & { invoiceType: InvoiceCategory },
): PaymentRecord {
  return {
    rowNumber: 1,
    payee: 'ACME TEDARIK A.S.',
    supplierNumber: 'SUP-001',
    vendorSite: 'ACME-IST',
    paymentNumber: 'PAY-001',
    paymentDate: '15-TEM-2026',
    currency: 'TRY',
    paymentAmount: 0,
    invoiceNumber: 'INV-000',
    invoiceDate: '01-TEM-2026',
    poNumber: 'PO-000',
    description: '',
    discount: 0,
    credit: 0,
    debit: 0,
    balance: 0,
    ...overrides,
  };
}

/**
 * Realistic record set exercising every classification path:
 * - a Sales_Invoice (balance-impact, credit to vendor),
 * - a Deduction_Invoice (balance-impact, debit against vendor),
 * - a notice + reversal pair netting to zero (excluded as a group),
 * - a provision with offsetting debit/credit (excluded, own net zero),
 * - a Giden Havale transfer row (excluded from the ledger, feeds havaleNet).
 *
 * Reconciliation: computedNet = 3,000.00 − 650.50 = 2,349.50 = havaleNet.
 */
function realisticRecords(): PaymentRecord[] {
  return [
    makeRecord({
      rowNumber: 1,
      invoiceType: 'Toptan Satis Faturasi',
      invoiceNumber: 'TSF-500',
      credit: 3000,
    }),
    makeRecord({
      rowNumber: 2,
      invoiceType: 'Eksik Miktar Kesinti Faturasi',
      invoiceNumber: 'EMK-501',
      debit: 650.5,
    }),
    // Notice + reversal pair by invoice-number root (EMKB-700 / EMKB-700SCR):
    // combined net Debit−Credit is zero, so both are Non_Impact_Records.
    makeRecord({
      rowNumber: 3,
      invoiceType: 'Eksik Miktar Kesinti Bildirimi',
      invoiceNumber: 'EMKB-700',
      debit: 120,
    }),
    makeRecord({
      rowNumber: 4,
      invoiceType: 'Eksik Miktar Kesinti Bildirimi Ters kayit',
      invoiceNumber: 'EMKB-700SCR',
      credit: 120,
    }),
    // Provision with offsetting amounts: own net Debit−Credit is zero.
    makeRecord({
      rowNumber: 5,
      invoiceType: 'Alacak Provizyonu',
      invoiceNumber: 'PROV-800',
      credit: 450,
      debit: 450,
    }),
    makeRecord({
      rowNumber: 6,
      invoiceType: 'Giden Havale',
      invoiceNumber: 'HAV-400',
      paymentAmount: 2349.5,
      debit: 2349.5,
    }),
  ];
}

/** Re-opens the generated blob purely in memory (Requirement 6.5 path). */
async function readWorkbook(blob: Blob): Promise<XLSX.WorkBook> {
  const buffer = await blob.arrayBuffer();
  return XLSX.read(buffer, { type: 'array' });
}

// ---------------------------------------------------------------------------
// End-to-end pipeline on the realistic record set
// ---------------------------------------------------------------------------

describe('ExcelExporter — end-to-end in-memory integration (Requirements 1.1, 2.3, 8.1)', () => {
  it('runs build → write → inject → re-open and produces the six sheets in fixed order', async () => {
    const exporter = new ExcelExporter();

    const { blob, fileName } = await exporter.generateBlob(realisticRecords(), 'ACME');

    // Single .xlsx artifact with the existing filename convention (Req 8.1, 8.2).
    expect(fileName).toMatch(/^ACME_Amazon_Payments_\d{4}-\d{2}-\d{2}\.xlsx$/);

    // Re-open succeeds without error (injected package stays readable).
    const workbook = await readWorkbook(blob);

    // All six sheets present in the fixed order (Req 1.1, 2.3).
    expect(workbook.SheetNames).toEqual([...FIXED_SHEET_ORDER]);
  });

  it('Vendor Ledger is a clean ledger with only balance-impact data rows', async () => {
    const exporter = new ExcelExporter();

    const { blob } = await exporter.generateBlob(realisticRecords(), 'ACME');
    const workbook = await readWorkbook(blob);

    const ledger = workbook.Sheets['Tedarikçi Cari Hareketleri'];
    expect(ledger).toBeDefined();

    const rows = XLSX.utils.sheet_to_json<unknown[]>(ledger, {
      header: 1,
      blankrows: true,
    });

    // Row 1 — the permanent Giden Havale disclaimer; row 2 — the header.
    expect(String(rows[0]?.[0])).toContain('DISCLAIMER');
    expect(rows[1]).toEqual([...VENDOR_LEDGER_HEADERS]);

    // Data region: the two balance-impact rows (sales + deduction invoices)
    // plus the always-included Giden Havale row. Notice+reversal pair and
    // provision are excluded.
    const dataRows = rows.slice(2).filter(row => row.length > 0);
    expect(dataRows).toHaveLength(3);

    const invoiceNumbers = dataRows.map(row => row[7]);
    expect(invoiceNumbers).toEqual(['TSF-500', 'EMK-501', 'HAV-400']);

    const invoiceTypes = dataRows.map(row => row[6]);
    expect(invoiceTypes).toEqual([
      'Toptan Satis Faturasi',
      'Eksik Miktar Kesinti Faturasi',
      'Giden Havale',
    ]);
  });

  it('pivot host sheet carries the cashier audit and reconciliation from column F', async () => {
    const exporter = new ExcelExporter();

    const { blob } = await exporter.generateBlob(realisticRecords(), 'ACME');
    const workbook = await readWorkbook(blob);

    const pivotHost = workbook.Sheets['Pivot Fatura Türü'];
    expect(pivotHost).toBeDefined();

    // Audit table title and header at F2/F3 — pivot area A–D untouched.
    expect(String(pivotHost['F2']?.v)).toContain('CASHIER MODEL AUDIT');
    expect(pivotHost['F3']?.v).toBe('Fatura Türü');
    expect(pivotHost['A3']?.v ?? undefined).toBeUndefined();

    // Reconciliation block: balanced at 2,349.50 both sides.
    const rows = XLSX.utils.sheet_to_json<unknown[]>(pivotHost, {
      header: 1,
      blankrows: true,
    });
    const statusRow = rows.findIndex(row => String(row?.[5]).includes('MUTABAKAT'));
    expect(statusRow).toBeGreaterThan(2);
    expect(rows[statusRow + 1]?.[5]).toBe('Hesaplanan Net (Computed Net)');
    expect(rows[statusRow + 1]?.[6]).toBeCloseTo(2349.5, 2);
    expect(rows[statusRow + 2]?.[6]).toBeCloseTo(2349.5, 2);
    expect(rows[statusRow + 3]?.[6]).toBeCloseTo(0, 2);
  });

  it('injected pivot OOXML parts exist in the final package', async () => {
    const exporter = new ExcelExporter();

    const { blob } = await exporter.generateBlob(realisticRecords(), 'ACME');
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());

    for (const part of PIVOT_PARTS) {
      expect(zip.file(part), `pivot part '${part}' must exist in the package`).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Empty-input case (Requirement 8.3)
// ---------------------------------------------------------------------------

describe('ExcelExporter — end-to-end empty input (Requirement 8.3)', () => {
  it('completes the full pipeline with zero records and re-opens with all six sheets', async () => {
    const exporter = new ExcelExporter();

    const { blob, fileName } = await exporter.generateBlob([], 'Vendor');
    expect(fileName).toMatch(/^Vendor_Amazon_Payments_\d{4}-\d{2}-\d{2}\.xlsx$/);

    // Re-open succeeds and all six sheets are present in the fixed order.
    const workbook = await readWorkbook(blob);
    expect(workbook.SheetNames).toEqual([...FIXED_SHEET_ORDER]);

    // Pivot parts are still injected (header-only cache — Req 5.8).
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    for (const part of PIVOT_PARTS) {
      expect(zip.file(part), `pivot part '${part}' must exist for empty input`).not.toBeNull();
    }

    // Vendor Ledger exists with disclaimer + header only (zero data rows).
    const ledger = workbook.Sheets['Tedarikçi Cari Hareketleri'];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ledger, {
      header: 1,
      blankrows: true,
    });
    expect(String(rows[0]?.[0])).toContain('DISCLAIMER');
    expect(rows[1]).toEqual([...VENDOR_LEDGER_HEADERS]);
    expect(rows.slice(2).filter(row => row.length > 0)).toHaveLength(0);

    // The pivot host still carries the audit title and reconciliation block.
    const pivotHost = workbook.Sheets['Pivot Fatura Türü'];
    expect(String(pivotHost['F2']?.v)).toContain('CASHIER MODEL AUDIT');
  });
});
