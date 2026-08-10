// Feature: reconciliation-excel-export-enhancements, Property 9: Pivot source range extent
//
// For any input record set, the pivot cache `worksheetSource` `ref` SHALL
// reference the `Payment Data` sheet and span from the header row (row 1)
// through the last populated data row and from the first through the last
// populated data column (header-only for zero data rows).
//
// **Validates: Requirements 5.5, 5.6, 5.8**

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { injectPivotTable, type PivotInjectorConfig } from '../pivotInjector';

// ---------------------------------------------------------------------------
// In-memory harness: SheetJS workbook ('Payment Data' + empty host sheet)
// → XLSX.write → injectPivotTable → read blob → JSZip → parse XML.
// ---------------------------------------------------------------------------

const BASE_HEADERS = ['Fatura Türü', ' Alacak ', ' Borç ', ' Uygulanan indirim '] as const;

const CONFIG: PivotInjectorConfig = {
  hostSheetName: 'Pivot Fatura Türü',
  sourceSheetName: 'Payment Data',
  rowFields: ['Fatura Türü'],
  valueFields: [
    { sourceField: ' Alacak ' },
    { sourceField: ' Borç ' },
    { sourceField: ' Uygulanan indirim ' },
  ],
};

/** 0-based column index -> Excel column letter (sufficient for < 26 columns). */
function colLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** Builds the workbook, injects the pivot, and returns pivotCacheDefinition1.xml. */
async function injectAndReadCacheDefinition(aoa: unknown[][]): Promise<string> {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Payment Data');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Pivot Fatura Türü');
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

  const blob = await injectPivotTable(new Uint8Array(bytes), CONFIG);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const part = zip.file('xl/pivotCache/pivotCacheDefinition1.xml');
  expect(part, 'pivotCacheDefinition1.xml must exist after injection').not.toBeNull();
  return part!.async('string');
}

/** Parses the cache definition and returns the worksheetSource attributes. */
function readWorksheetSource(xml: string): { sheet: string | null; ref: string | null } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  expect(doc.getElementsByTagName('parsererror').length, 'cache definition must be well-formed XML').toBe(0);
  const nodes = doc.getElementsByTagName('worksheetSource');
  expect(nodes.length, 'exactly one worksheetSource element expected').toBe(1);
  const el = nodes[0];
  return { sheet: el.getAttribute('sheet'), ref: el.getAttribute('ref') };
}

// ---------------------------------------------------------------------------
// Generators — small datasets, 0..30 rows (zero-row case included), with a
// variable number of extra populated columns so the last-column bound varies.
// ---------------------------------------------------------------------------

const invoiceTypeArb = fc.constantFrom(
  'Toptan Satış Faturası',
  'Ticari İşbirliği Faturası',
  'Eksik Miktar Kesinti Faturası',
  'Fiyat Farkı Kesinti Faturası',
  'Giden Havale',
  'Alacak Provizyonu',
);

const amountArb = fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e9, max: 1e9 });

/** Optional extra-column cell: a string, a number, or blank (null → cell omitted). */
const extraCellArb = fc.oneof(
  fc.constant<string | number | null>(null),
  fc.string({ minLength: 1, maxLength: 8 }).map(s => s.trim() === '' ? 'x' : s),
  fc.integer({ min: -1000, max: 1000 }),
);

const datasetArb = fc
  .record({
    extraColCount: fc.integer({ min: 0, max: 3 }),
    rowCount: fc.integer({ min: 0, max: 30 }),
  })
  .chain(({ extraColCount, rowCount }) =>
    fc
      .array(
        fc.tuple(
          invoiceTypeArb,
          amountArb,
          amountArb,
          amountArb,
          fc.array(extraCellArb, { minLength: extraColCount, maxLength: extraColCount }),
        ),
        { minLength: rowCount, maxLength: rowCount },
      )
      .map(rows => {
        const headers = [
          ...BASE_HEADERS,
          ...Array.from({ length: extraColCount }, (_, i) => `Extra ${i + 1}`),
        ];
        const aoa: unknown[][] = [
          headers,
          ...rows.map(([type, alacak, borc, indirim, extras]) => [type, alacak, borc, indirim, ...extras]),
        ];
        return { aoa, rowCount, colCount: headers.length };
      }),
  );

// ---------------------------------------------------------------------------
// Property 9
// ---------------------------------------------------------------------------

describe('pivotInjector — Property 9: Pivot source range extent', () => {
  it(
    'worksheetSource references "Payment Data" and ref spans A1 through the last populated row/column (header-only for zero data rows)',
    async () => {
      await fc.assert(
        fc.asyncProperty(datasetArb, async ({ aoa, rowCount, colCount }) => {
          const xml = await injectAndReadCacheDefinition(aoa);
          const { sheet, ref } = readWorksheetSource(xml);

          // Requirement 5.5: the source range references 'Payment Data' by name.
          expect(sheet).toBe('Payment Data');

          // Requirements 5.6, 5.8: header row (row 1) through last populated
          // data row and first-through-last populated column. For zero data
          // rows the range covers the header row only.
          const expectedRef = `A1:${colLetter(colCount - 1)}${rowCount + 1}`;
          expect(ref).toBe(expectedRef);
        }),
        { numRuns: 100 },
      );
    },
    120_000,
  );

  it('covers the header row only (A1:D1) when there are zero data rows', async () => {
    const xml = await injectAndReadCacheDefinition([[...BASE_HEADERS]]);
    const { sheet, ref } = readWorksheetSource(xml);
    expect(sheet).toBe('Payment Data');
    expect(ref).toBe('A1:D1');
  });

  it('spans A1:D{n+1} for n data rows over the 4 base columns', async () => {
    const aoa: unknown[][] = [
      [...BASE_HEADERS],
      ['Toptan Satış Faturası', 100.5, 0, 1.25],
      ['Giden Havale', 0, 99.25, 0],
      ['Toptan Satış Faturası', 42, 7, 0],
    ];
    const xml = await injectAndReadCacheDefinition(aoa);
    const { sheet, ref } = readWorksheetSource(xml);
    expect(sheet).toBe('Payment Data');
    expect(ref).toBe('A1:D4');
  });
});
