// End-to-end in-memory integration test — full generateBlob pipeline.
//
// Drives the complete export pipeline entirely in memory on a realistic
// record set (sales invoice, deduction invoice, claim + reversal pair,
// provision, Giden Havale transfer): cashier model → build sheets →
// XLSX.write → injectPivotTable → re-open via XLSX.read. No file I/O
// beyond in-memory bytes; no network.
//
// Asserts: all eight sheets present in the fixed order; the injected
// package re-opens without error; the Vendor Ledger (GREEN gate) carries
// the header row and only balance-impact data rows; the pivot host sheet
// carries the cashier audit (Layer 1 + Layer 2 balance check) from column
// F; the pivot OOXML parts exist in the zip; and the empty-input case is
// REJECTED by the model's input validation (EMPTY_INPUT).
//
// **Validates: Requirements 1.1, 2.3, 8.1, 8.3**

import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { ExcelExporter } from '../excelExporter';
import { VENDOR_LEDGER_HEADERS } from '../../components/Excel/VendorLedgerSheet';
import type { PaymentRecord, InvoiceCategory } from '../../types/regional.types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The fixed eight-sheet order the exporter emits (Requirements 1.5, 2.3). */
const FIXED_SHEET_ORDER = [
  'Payment Data',
  'HAVALE',
  'Filtered Invoices',
  'Pivot Fatura Türü',
  'PQV-RI',
  'Tedarikçi Cari Hareketleri',
  'Audit Trails',
  'Disclaimer',
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
 * - a claim + reversal pair per the claim grammar (EMKB700SC /
 *   EMKB700SCR) netting to zero — a released round, closed, no open item,
 * - a provision with offsetting debit/credit (excluded, own net zero),
 * - a Giden Havale transfer row (feeds Actual_Havale).
 *
 * Balance check: Computed = 3,000.00 − 650.50 = 2,349.50 = Actual → GREEN.
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
    // Claim + reversal pair by the claim grammar (…SC deduction, …SCR
    // release): combined net Debit−Alacak is zero — a released round,
    // closed ('Reconciled with Matching'), never an open item.
    makeRecord({
      rowNumber: 3,
      invoiceType: 'Eksik Miktar Kesinti Bildirimi',
      invoiceNumber: 'EMKB700SC',
      debit: 120,
    }),
    makeRecord({
      rowNumber: 4,
      invoiceType: 'Eksik Miktar Kesinti Bildirimi Ters kayit',
      invoiceNumber: 'EMKB700SCR',
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
  it('runs build → write → inject → re-open and produces the eight sheets in fixed order', async () => {
    const exporter = new ExcelExporter();

    const { blob, fileName } = await exporter.generateBlob(realisticRecords(), 'ACME');

    // Single .xlsx artifact with the existing filename convention (Req 8.1, 8.2).
    expect(fileName).toMatch(/^ACME_Amazon_Payments_\d{4}-\d{2}-\d{2}\.xlsx$/);

    // Re-open succeeds without error (injected package stays readable).
    const workbook = await readWorkbook(blob);

    // All eight sheets present in the fixed order (Req 1.1, 2.3).
    expect(workbook.SheetNames).toEqual([...FIXED_SHEET_ORDER]);
  });

  it('Vendor Ledger (GREEN gate) is a clean ledger with only balance-impact data rows', async () => {
    const exporter = new ExcelExporter();

    const { blob } = await exporter.generateBlob(realisticRecords(), 'ACME');
    const workbook = await readWorkbook(blob);

    const ledger = workbook.Sheets['Tedarikçi Cari Hareketleri'];
    expect(ledger).toBeDefined();

    const rows = XLSX.utils.sheet_to_json<unknown[]>(ledger, {
      header: 1,
      blankrows: true,
    });

    // Row 1 — the Payment Data header labels (minus Bakiye).
    expect(rows[0]).toEqual([...VENDOR_LEDGER_HEADERS]);

    // Data region: the two balance-impact rows (sales + deduction invoices)
    // plus the always-included Giden Havale row. The released claim round
    // (EMKB700SC/SCR) and the net-zero provision are excluded.
    const dataRows = rows.slice(1).filter(row => row.length > 0);
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

  it('pivot host sheet carries the cashier audit and balance check from column F', async () => {
    const exporter = new ExcelExporter();

    const { blob } = await exporter.generateBlob(realisticRecords(), 'ACME');
    const workbook = await readWorkbook(blob);

    const pivotHost = workbook.Sheets['Pivot Fatura Türü'];
    expect(pivotHost).toBeDefined();

    // Layer 1 title and header at F2/F3 — pivot area A–D untouched.
    expect(String(pivotHost['F2']?.v)).toContain('KASİYER MODELİ — Layer 1');
    expect(pivotHost['F3']?.v).toBe('Fatura Türü');
    expect(pivotHost['A3']?.v ?? undefined).toBeUndefined();

    // Layer 2 balance check: Computed = Actual = 2,349.50, GREEN gate.
    // writeRow anchors at column F (index 5): labels at 5/6, amount at 7,
    // gate indication at 8.
    const rows = XLSX.utils.sheet_to_json<unknown[]>(pivotHost, {
      header: 1,
      blankrows: true,
    });
    const titleRow = rows.findIndex(row =>
      String(row?.[5]).includes('Layer 2: Balance Check'),
    );
    expect(titleRow).toBeGreaterThan(2);

    const subtotalRow = rows.findIndex(row =>
      String(row?.[5]).includes('Kesintileri Cikardikdan sonra'),
    );
    expect(subtotalRow).toBeGreaterThan(titleRow);
    expect(rows[subtotalRow]?.[7]).toBeCloseTo(2349.5, 2); // Computed_Havale

    expect(String(rows[subtotalRow + 1]?.[5])).toBe('Actual Giden HAVALE');
    expect(rows[subtotalRow + 1]?.[7]).toBeCloseTo(2349.5, 2); // Actual_Havale

    expect(String(rows[subtotalRow + 2]?.[5])).toBe('Fark');
    expect(rows[subtotalRow + 2]?.[7]).toBeCloseTo(0, 2); // Difference
    expect(String(rows[subtotalRow + 2]?.[8])).toContain('YEŞİL'); // GREEN gate
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
// Empty-input case (Requirement 8.3 — superseded by cashier-model validation)
// ---------------------------------------------------------------------------

describe('ExcelExporter — end-to-end empty input', () => {
  it('rejects zero-record input with the bilingual EMPTY_INPUT validation failure', async () => {
    // The cashier model's input validation halts the export before any
    // sheet is built: an empty file is a data problem, not a valid export.
    const exporter = new ExcelExporter();

    await expect(exporter.generateBlob([], 'Vendor')).rejects.toThrow(/EMPTY_INPUT/);
  });
});
