// Feature: reconciliation-excel-export-enhancements, Property 11: Package well-formedness and re-openability
//
// For any input record set, after injection every XML part in the package
// SHALL parse as well-formed XML, and SheetJS SHALL re-open the resulting
// bytes without error.
//
// **Validates: Requirements 5.1, 5.2, 6.5**

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { injectPivotTable, type PivotInjectorConfig } from '../pivotInjector';

// ---------------------------------------------------------------------------
// In-memory harness: SheetJS workbook ('Payment Data' + empty host sheet)
// → XLSX.write → injectPivotTable → read blob → JSZip / XLSX.read.
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

/** Builds the workbook from an AoA, injects the pivot, and returns the patched bytes. */
async function injectAndGetBytes(aoa: unknown[][]): Promise<Uint8Array> {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Payment Data');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Pivot Fatura Türü');
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

  const blob = await injectPivotTable(new Uint8Array(bytes), CONFIG);
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Requirement 6.5: every .xml/.rels part in the package must parse as
 * well-formed XML (DOMParser reports failures via a <parsererror> element).
 */
async function assertAllXmlPartsWellFormed(bytes: Uint8Array): Promise<void> {
  const zip = await JSZip.loadAsync(bytes);
  const xmlPaths = Object.keys(zip.files).filter(
    p => !zip.files[p].dir && (p.endsWith('.xml') || p.endsWith('.rels')),
  );
  expect(xmlPaths.length, 'the package must contain XML parts').toBeGreaterThan(0);

  for (const path of xmlPaths) {
    const xml = await zip.files[path].async('string');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(
      doc.getElementsByTagName('parsererror').length,
      `part '${path}' must be well-formed XML`,
    ).toBe(0);
  }
}

/** Requirements 5.1, 5.2: SheetJS must re-open the injected package without throwing. */
function assertReopens(bytes: Uint8Array): void {
  const reopened = XLSX.read(bytes, { type: 'array' });
  expect(reopened.SheetNames).toContain('Payment Data');
  expect(reopened.SheetNames).toContain('Pivot Fatura Türü');
}

// ---------------------------------------------------------------------------
// Generators — small datasets (0..30 rows). Category strings deliberately mix
// XML-sensitive characters (&, <, >, ", ') and Turkish characters so the
// injector's escaping paths (sharedItems, cache records, dataField names)
// are exercised.
// ---------------------------------------------------------------------------

const categoryCharArb = fc.constantFrom(
  '&', '<', '>', '"', "'",
  'ş', 'Ş', 'ı', 'İ', 'ğ', 'Ğ', 'ü', 'Ü', 'ö', 'Ö', 'ç', 'Ç',
  'F', 'a', 't', 'u', 'r', ' ', '-', '1',
);

const categoryArb = fc.oneof(
  fc.stringOf(categoryCharArb, { minLength: 1, maxLength: 16 }),
  fc.constantFrom(
    'Toptan Satış Faturası',
    'Fiyat Farkı & İndirim <Kesinti> "Ters" Kayıt\'ı',
    '<Eksik Miktar> & Bildirimi',
    'Giden Havale',
  ),
);

const amountArb = fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e9, max: 1e9 });

/** Optional description cell: XML-sensitive/Turkish string, number, or blank. */
const descCellArb = fc.oneof(
  fc.constant<string | number | null>(null),
  fc.stringOf(categoryCharArb, { minLength: 1, maxLength: 12 }),
  fc.integer({ min: -1000, max: 1000 }),
);

const datasetArb = fc
  .integer({ min: 0, max: 30 })
  .chain(rowCount =>
    fc
      .array(fc.tuple(categoryArb, amountArb, amountArb, amountArb, descCellArb), {
        minLength: rowCount,
        maxLength: rowCount,
      })
      .map(rows => {
        const headers = [...BASE_HEADERS, 'Fatura Açıklaması'];
        const aoa: unknown[][] = [
          headers,
          ...rows.map(([type, alacak, borc, indirim, desc]) => [type, alacak, borc, indirim, desc]),
        ];
        return aoa;
      }),
  );

// ---------------------------------------------------------------------------
// Property 11
// ---------------------------------------------------------------------------

describe('pivotInjector — Property 11: Package well-formedness and re-openability', () => {
  it(
    'every .xml/.rels part is well-formed XML and XLSX.read re-opens the injected package',
    async () => {
      await fc.assert(
        fc.asyncProperty(datasetArb, async aoa => {
          const bytes = await injectAndGetBytes(aoa);
          await assertAllXmlPartsWellFormed(bytes);
          assertReopens(bytes);
        }),
        { numRuns: 100 },
      );
    },
    240_000,
  );

  it('stays well-formed and re-openable for a header-only source sheet (zero data rows)', async () => {
    const bytes = await injectAndGetBytes([[...BASE_HEADERS, 'Fatura Açıklaması']]);
    await assertAllXmlPartsWellFormed(bytes);
    assertReopens(bytes);
  });

  it('stays well-formed with categories containing &, <, >, ", \' and Turkish characters', async () => {
    const aoa: unknown[][] = [
      [...BASE_HEADERS, 'Fatura Açıklaması'],
      ['Fiyat Farkı & İndirim <Kesinti> "Ters" Kayıt\'ı', 100.5, 0, 1.25, 'Açıklama & <detay>'],
      ['<Eksik Miktar> & Bildirimi', 0, 99.25, 0, '"çift" & \'tek\' tırnak'],
      ['Giden Havale', 42, 7, 0, null],
    ];
    const bytes = await injectAndGetBytes(aoa);
    await assertAllXmlPartsWellFormed(bytes);
    assertReopens(bytes);
  });
});
