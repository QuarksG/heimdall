// Feature: reconciliation-excel-export-enhancements, Property 8: Pivot cache row-field enumerates distinct categories
//
// For any input record set with at least one data row, the row-axis cache field
// ('Fatura Türü') in xl/pivotCache/pivotCacheDefinition1.xml enumerates
// <sharedItems> exactly equal to the set of distinct invoiceType values present
// in the source Payment Data rows.
//
// **Validates: Requirements 5.3**

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { injectPivotTable } from '../pivotInjector';
import type { InvoiceCategory } from '../../types/regional.types';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Categories drawn from the InvoiceCategory union (varied axis values). */
const CATEGORIES: InvoiceCategory[] = [
  'Giden Havale',
  'Ticari Isbirligi Faturasi',
  'Eksik Miktar Kesinti Bildirimi',
  'Eksik Miktar Kesinti Bildirimi Ters kayit',
  'Fiyat Farki Kesinti Bildirimi',
  'Fiyat Farki Kesinti Bildirimi Ters Kayit',
  'Eksik Miktar Kesinti Faturasi',
  'Fiyat Farki Kesinti Faturasi',
  'Toptan Satis Faturasi',
  'Iade Edilen Ürünler Için Kesilen Iade Faturasi',
  'Vadesi Geçmis Alacak Provizyonu',
  'Alacak Provizyonu',
  'AR Faturasi',
  'QPD',
];

interface SourceRow {
  category: InvoiceCategory;
  credit: number;
  debit: number;
  discount: number;
}

const amountArb = fc
  .integer({ min: 0, max: 10_000_000 })
  .map(cents => cents / 100);

const rowArb: fc.Arbitrary<SourceRow> = fc.record({
  category: fc.constantFrom(...CATEGORIES),
  credit: amountArb,
  debit: amountArb,
  discount: amountArb,
});

// Small datasets (1..30 rows) keep 100 zip round-trips fast.
const rowsArb = fc.array(rowArb, { minLength: 1, maxLength: 30 });

// ---------------------------------------------------------------------------
// Harness — build a workbook in memory, inject, read back the cache definition
// ---------------------------------------------------------------------------

const ROW_FIELD = 'Fatura Türü';

function buildWorkbookBytes(rows: SourceRow[]): Uint8Array {
  const wb = XLSX.utils.book_new();
  const data = rows.map(r => ({
    [ROW_FIELD]: r.category,
    ' Alacak ': r.credit,
    ' Borç ': r.debit,
    ' Uygulanan indirim ': r.discount,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Payment Data');
  // Empty host sheet for the injected pivot.
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Pivot');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

/** Extracts the <s v> shared items of the row-axis cacheField from the cache definition XML. */
function readRowFieldSharedItems(cacheDefXml: string): string[] {
  const doc = new DOMParser().parseFromString(cacheDefXml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('pivotCacheDefinition1.xml is not well-formed XML');
  }
  const cacheFields = Array.from(doc.getElementsByTagName('cacheField'));
  const rowField = cacheFields.find(f => f.getAttribute('name') === ROW_FIELD);
  if (!rowField) {
    throw new Error(`cacheField '${ROW_FIELD}' not found in pivotCacheDefinition1.xml`);
  }
  const sharedItems = rowField.getElementsByTagName('sharedItems')[0];
  if (!sharedItems) {
    throw new Error(`cacheField '${ROW_FIELD}' has no <sharedItems>`);
  }
  return Array.from(sharedItems.getElementsByTagName('s')).map(s => s.getAttribute('v') ?? '');
}

async function injectAndReadSharedItems(rows: SourceRow[]): Promise<string[]> {
  const bytes = buildWorkbookBytes(rows);
  const blob = await injectPivotTable(bytes, {
    hostSheetName: 'Pivot',
    sourceSheetName: 'Payment Data',
    rowFields: [ROW_FIELD],
    valueFields: [
      { sourceField: ' Alacak ' },
      { sourceField: ' Borç ' },
      { sourceField: ' Uygulanan indirim ' },
    ],
  });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const cacheDefFile = zip.file('xl/pivotCache/pivotCacheDefinition1.xml');
  if (!cacheDefFile) {
    throw new Error('xl/pivotCache/pivotCacheDefinition1.xml missing from injected package');
  }
  return readRowFieldSharedItems(await cacheDefFile.async('string'));
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('pivotInjector — Property 8: pivot cache row-field enumerates distinct categories', () => {
  it("sharedItems of the 'Fatura Türü' cacheField set-equals the distinct invoiceType values in the source rows", async () => {
    await fc.assert(
      fc.asyncProperty(rowsArb, async rows => {
        const sharedItems = await injectAndReadSharedItems(rows);

        const expected = new Set(rows.map(r => r.category as string));
        const actual = new Set(sharedItems);

        // Set equality: same size, same members.
        expect(actual).toEqual(expected);
        // No duplicate shared items in the enumeration.
        expect(sharedItems.length).toBe(actual.size);
      }),
      { numRuns: 100 },
    );
  }, 120_000);
});
