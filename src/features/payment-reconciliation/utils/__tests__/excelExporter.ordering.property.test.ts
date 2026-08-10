// Feature: reconciliation-excel-export-enhancements, Property 1: Deterministic, fixed sheet ordering
//
// Property 1: For any input record set (with at least 1 record so the pivot
// source resolves — the empty-input case is a known limitation addressed by
// task 7.5), calling ExcelExporter.generateBlob twice yields the IDENTICAL
// sheet-name sequence, and that sequence always equals the fixed order
// ['Payment Data', 'HAVALE', 'Filtered Invoices', 'Pivot Fatura Türü',
// 'PQV-RI', 'Tedarikçi Cari Hareketleri', 'Disclaimer'] — with the three
// preserved sheets preceding the native pivot host, 'PQV-RI' immediately
// after it, and the always-present Disclaimer (data-quality) sheet LAST.
//
// **Validates: Requirements 1.5, 2.3**

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import * as XLSX from 'xlsx';
import { ExcelExporter } from '../excelExporter';
import type {
  PaymentRecord,
  InvoiceCategory,
} from '../../types/regional.types';

// ---------------------------------------------------------------------------
// Expected fixed sheet order (Requirements 1.5, 2.3; Design "Sheet order").
// ---------------------------------------------------------------------------

const EXPECTED_SHEET_ORDER = [
  'Payment Data',
  'HAVALE',
  'Filtered Invoices',
  'Pivot Fatura Türü',
  'PQV-RI',
  'Tedarikçi Cari Hareketleri',
  'Disclaimer',
] as const;

// ---------------------------------------------------------------------------
// Generators (same patterns as the sibling __tests__ files).
// ---------------------------------------------------------------------------

const ALL_CATEGORIES: InvoiceCategory[] = [
  'Giden Havale',
  'Ticari Isbirligi Faturasi',
  'Eksik Miktar Kesinti Bildirimi',
  'Eksik Miktar Kesinti Bildirimi Ters kayit',
  'Fiyat Farki Kesinti Bildirimi',
  'Fiyat Farki Kesinti Bildirimi Ters Kayit',
  'Eksik Miktar Kesinti Faturasi',
  'Arsiv Eksik Miktar Kesinti Faturasi',
  'Fiyat Farki Kesinti Faturasi',
  'Arsiv Fiyat Farki Kesinti Faturasi',
  'Toptan Satis Faturasi',
  'Iade Edilen Ürünler Için Kesilen Iade Faturasi',
  'Vadesi Geçmis Alacak Provizyonu',
  'Alacak Provizyonu',
  'Bank Ücreti',
  'CRTR Geri Ödemesi',
  'AR Faturasi',
  'Amazon Itrazlari',
  'QPD',
  'Itraz Sonucu Geri Odeme',
  'Siniflandirilmamis',
  'MISSING_ACTUAL_OR_BAN',
];

/**
 * Amounts are numeric on PaymentRecord (parsed once at the boundary), so the
 * generator covers zero, small and large 2-decimal values.
 */
const amountArb = fc.oneof(
  fc.constant(0),
  fc.integer({ min: -9999999, max: 9999999 }).map(n => n / 100),
  fc.integer({ min: -999999999, max: 999999999 }).map(n => n / 100),
);

/** Invoice numbers: empty, bare roots, or roots with a reversal suffix. */
const invoiceNumberArb = fc.oneof(
  fc.constant(''),
  fc
    .tuple(fc.constantFrom('INV', 'TR', 'FT', 'A'), fc.integer({ min: 0, max: 99999 }))
    .map(([prefix, n]) => `${prefix}${n}`),
  fc
    .tuple(
      fc.constantFrom('INV', 'TR', 'FT', 'A'),
      fc.integer({ min: 0, max: 99999 }),
      fc.constantFrom('SC', 'SCR', 'PC', 'PCR', 'SCRI', 'PCRI'),
    )
    .map(([prefix, n, suffix]) => `${prefix}${n}${suffix}`),
);

function makeRecord(overrides: Partial<PaymentRecord>): PaymentRecord {
  return {
    payee: 'Test Vendor A.S.',
    supplierNumber: 'S-1',
    vendorSite: 'SITE-1',
    paymentNumber: 'PAY-1',
    paymentDate: '2026-07-15',
    currency: 'TRY',
    paymentAmount: 0,
    invoiceNumber: '',
    invoiceDate: '2026-07-01',
    poNumber: 'PO-1',
    description: 'test',
    discount: 0,
    credit: 0,
    debit: 0,
    invoiceType: 'Toptan Satis Faturasi',
    ...overrides,
  };
}

/** Arbitrary PaymentRecord with varied categories and comma-formatted amounts. */
const recordArb = fc
  .record({
    invoiceType: fc.constantFrom(...ALL_CATEGORIES),
    invoiceNumber: invoiceNumberArb,
    debit: amountArb,
    credit: amountArb,
    discount: amountArb,
    paymentAmount: amountArb,
  })
  .map(fields => makeRecord(fields));

/**
 * Small record sets (1..15) — at least 1 record so the pivot source range
 * resolves (empty-input limitation is tracked by task 7.5), small so 100
 * iterations of the double full-pipeline round-trip stay fast.
 */
const recordsArb = fc
  .array(recordArb, { minLength: 1, maxLength: 15 })
  .map(records =>
    records.map((record, index) => ({ ...record, rowNumber: index + 1 })),
  );

// ---------------------------------------------------------------------------
// Harness — run the full in-memory pipeline and read back the sheet names
// ---------------------------------------------------------------------------

async function generateSheetNames(records: PaymentRecord[]): Promise<string[]> {
  const exporter = new ExcelExporter();
  const { blob } = await exporter.generateBlob(records, 'PropTest');
  const workbook = XLSX.read(await blob.arrayBuffer());
  return workbook.SheetNames;
}

// ---------------------------------------------------------------------------
// Property test
// ---------------------------------------------------------------------------

describe('ExcelExporter — Property 1: Deterministic, fixed sheet ordering', () => {
  // **Validates: Requirements 1.5, 2.3**
  it('generating twice yields the identical sheet-name sequence, always in the fixed order', async () => {
    await fc.assert(
      fc.asyncProperty(recordsArb, async records => {
        const firstRun = await generateSheetNames(records);
        const secondRun = await generateSheetNames(records);

        // Determinism: two executions on identical input yield the identical
        // sheet-name sequence (Requirement 1.5).
        expect(secondRun).toEqual(firstRun);

        // Fixed order: the sequence always equals the six-sheet fixed order
        // (Requirement 2.3 — Payment Data, HAVALE, Filtered Invoices precede
        // the native pivot host; PQV-RI is immediately after it).
        expect(firstRun).toEqual([...EXPECTED_SHEET_ORDER]);
      }),
      { numRuns: 100 },
    );
  }, 300_000);
});
