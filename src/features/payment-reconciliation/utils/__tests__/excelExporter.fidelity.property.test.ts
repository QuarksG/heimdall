// Feature: reconciliation-excel-export-enhancements, Property 2: Preserved-sheet fidelity
//
// For any input record set (>= 1 record), the 'Payment Data', 'HAVALE',
// 'Filtered Invoices', and 'PQV-RI' worksheets inside the blob produced by
// `ExcelExporter.generateBlob` have IDENTICAL headers, row count, and cell
// values to reference worksheets built by invoking the unchanged builders
// directly (PaymentDataSheet.create, HavaleSheet.create,
// FilteredInvoicesSheet.create, PqvReconciliationSheet.create over
// matcher.matchPqvToSales(records)).
//
// Comparison is like-for-like: the reference sheets are placed in a reference
// workbook that is serialized with XLSX.write and read back with XLSX.read
// (the same write/read round-trip the exported blob undergoes), then both
// sides are compared via XLSX.utils.sheet_to_json(ws, { header: 1, raw: true })
// — VALUES are compared, not styles, since cell types/styles may normalize
// through the round-trip.
//
// **Validates: Requirements 2.1, 2.2**

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import * as XLSX from 'xlsx';
import { ExcelExporter } from '../excelExporter';
import { PaymentDataSheet } from '../../components/Excel/PaymentDataSheet';
import { HavaleSheet } from '../../components/Excel/HavaleSheet';
import { FilteredInvoicesSheet } from '../../components/Excel/FilteredInvoicesSheet';
import { PqvReconciliationSheet } from '../../components/Excel/PqvReconciliationSheet';
import { ThreeWayMatchingEngine } from '../../logic/matchers/threeWayMatchingEngine';
import type {
  PaymentRecord,
  InvoiceCategory,
} from '../../types/regional.types';

// ---------------------------------------------------------------------------
// Generators (same conventions as the vendor-ledger property tests)
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

const REVERSAL_SUFFIXES = ['SC', 'SCR', 'PC', 'PCR', 'SCRI', 'PCRI'] as const;

/**
 * Amounts are numeric on PaymentRecord (parsed once at the boundary), so the
 * generator covers zero, small and large 2-decimal values — the old
 * empty/comma-string variants are unrepresentable by the type now.
 */
const amountArb = fc.oneof(
  fc.constant(0),
  fc.integer({ min: -9999999, max: 9999999 }).map(n => n / 100),
  fc.integer({ min: -999999999, max: 999999999 }).map(n => n / 100),
);

/** Invoice-number roots that do not themselves end in a reversal suffix. */
const invoiceRootArb = fc
  .tuple(fc.constantFrom('INV', 'TR', 'FT', 'A'), fc.integer({ min: 0, max: 99999 }))
  .map(([prefix, n]) => `${prefix}${n}`);

/** Invoice numbers: empty, bare roots, or roots with a reversal suffix. */
const invoiceNumberArb = fc.oneof(
  fc.constant(''),
  invoiceRootArb,
  fc
    .tuple(invoiceRootArb, fc.constantFrom(...REVERSAL_SUFFIXES))
    .map(([root, suffix]) => root + suffix),
);

/** Dates in the `DD-MMM-YYYY` shape the matcher understands (plus empty). */
const dateArb = fc.oneof(
  fc.constant(''),
  fc
    .tuple(
      fc.integer({ min: 1, max: 28 }),
      fc.constantFrom('JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'),
      fc.integer({ min: 2024, max: 2026 }),
    )
    .map(([d, m, y]) => `${String(d).padStart(2, '0')}-${m}-${y}`),
);

/** Printable text for the verbatim string fields (may be empty). */
const textArb = fc.string({ minLength: 0, maxLength: 20 });

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
    balance: 0,
    invoiceType: 'Toptan Satis Faturasi',
    ...overrides,
  };
}

/** Arbitrary PaymentRecord with varied fields across every projected column. */
const recordArb = fc
  .record({
    invoiceType: fc.constantFrom(...ALL_CATEGORIES),
    invoiceNumber: invoiceNumberArb,
    debit: amountArb,
    credit: amountArb,
    discount: amountArb,
    balance: amountArb,
    paymentAmount: amountArb,
    payee: textArb,
    currency: fc.constantFrom('TRY', 'USD', 'EUR'),
    vendorSite: textArb,
    paymentNumber: textArb,
    paymentDate: dateArb,
    invoiceDate: dateArb,
    poNumber: textArb,
    description: textArb,
  })
  .map(fields => makeRecord(fields));

/** Record sets of 1..12 records (>= 1 per the property statement). */
const recordsArb = fc
  .array(recordArb, { minLength: 1, maxLength: 12 })
  .map(records =>
    records.map((record, index) => ({ ...record, rowNumber: index + 1 })),
  );

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const PRESERVED_SHEETS = ['Payment Data', 'HAVALE', 'Filtered Invoices', 'PQV-RI'] as const;

type SheetRows = unknown[][];

/** Value-level projection of a worksheet (headers + data; styles ignored). */
function sheetRows(ws: XLSX.WorkSheet | undefined): SheetRows {
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as SheetRows;
}

/** Serializes a workbook and reads it back (the same round-trip the blob undergoes). */
function roundTrip(wb: XLSX.WorkBook): XLSX.WorkBook {
  const bytes = new Uint8Array(
    XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer,
  );
  return XLSX.read(bytes, { type: 'array' });
}

/**
 * Builds the reference workbook by invoking the unchanged builders directly,
 * round-trips it through write/read, and returns the per-sheet value rows.
 */
function buildReferenceRows(records: PaymentRecord[]): Record<string, SheetRows> {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, new PaymentDataSheet().create(records), 'Payment Data');
  XLSX.utils.book_append_sheet(wb, new HavaleSheet().create(records), 'HAVALE');
  XLSX.utils.book_append_sheet(wb, new FilteredInvoicesSheet().create(records), 'Filtered Invoices');
  const matches = new ThreeWayMatchingEngine().matchPqvToSales(records);
  XLSX.utils.book_append_sheet(wb, new PqvReconciliationSheet().create(matches), 'PQV-RI');

  const reopened = roundTrip(wb);
  const result: Record<string, SheetRows> = {};
  for (const name of PRESERVED_SHEETS) {
    result[name] = sheetRows(reopened.Sheets[name]);
  }
  return result;
}

/** Runs the full enhanced pipeline and reads the exported blob back. */
async function buildExportedRows(records: PaymentRecord[]): Promise<Record<string, SheetRows>> {
  const { blob } = await new ExcelExporter().generateBlob(records);
  const wb = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
  const result: Record<string, SheetRows> = {};
  for (const name of PRESERVED_SHEETS) {
    result[name] = sheetRows(wb.Sheets[name]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Property test
// ---------------------------------------------------------------------------

describe('ExcelExporter — Property 2: Preserved-sheet fidelity', () => {
  // **Validates: Requirements 2.1, 2.2**
  it('the four preserved worksheets in the exported blob have identical headers, row count, and cell values to the unchanged builders', async () => {
    await fc.assert(
      fc.asyncProperty(recordsArb, async records => {
        const exported = await buildExportedRows(records);
        const reference = buildReferenceRows(records);

        for (const name of PRESERVED_SHEETS) {
          const exp = exported[name];
          const ref = reference[name];

          // Identical row count (headers + data).
          expect(exp.length).toBe(ref.length);
          // Identical headers.
          expect(exp[0]).toEqual(ref[0]);
          // Identical cell values across every row.
          expect(exp).toEqual(ref);
        }
      }),
      { numRuns: 100 },
    );
  }, 300_000);
});
