// Feature: reconciliation-excel-export-enhancements, Property 12: Relationship referential integrity
//
// For any input record set, after injection every relationship `Target`
// across all `.rels` parts SHALL resolve to an existing part within the
// package (no dangling references).
//
// **Validates: Requirements 6.6**

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { injectPivotTable, type PivotInjectorConfig } from '../pivotInjector';

// ---------------------------------------------------------------------------
// In-memory harness: SheetJS workbook ('Payment Data' + empty host sheet)
// → XLSX.write → injectPivotTable → read blob → JSZip → walk .rels parts.
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

/** Builds the workbook, injects the pivot, and returns the injected package zip. */
async function injectAndLoadZip(aoa: unknown[][]): Promise<JSZip> {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Payment Data');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Pivot Fatura Türü');
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

  const blob = await injectPivotTable(new Uint8Array(bytes), CONFIG);
  return JSZip.loadAsync(await blob.arrayBuffer());
}

/**
 * Derives the owner directory of a `.rels` part.
 * - `_rels/.rels`                          -> '' (package root)
 * - `xl/_rels/workbook.xml.rels`           -> 'xl'
 * - `xl/worksheets/_rels/sheet1.xml.rels`  -> 'xl/worksheets'
 */
function ownerDirOf(relsPath: string): string {
  const idx = relsPath.lastIndexOf('_rels/');
  return relsPath.slice(0, idx).replace(/\/$/, '');
}

/**
 * Resolves a relationship Target against the owner directory, normalizing
 * `.`/`..` segments. Absolute targets (`/xl/...`) resolve from the package
 * root. Returns the package-internal part path (no leading slash).
 */
function resolveTarget(target: string, ownerDir: string): string {
  const raw = target.startsWith('/')
    ? target.slice(1)
    : (ownerDir === '' ? target : `${ownerDir}/${target}`);
  const segments: string[] = [];
  for (const seg of raw.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      segments.pop();
    } else {
      segments.push(seg);
    }
  }
  return segments.join('/');
}

interface RelEntry {
  relsPath: string;
  id: string | null;
  target: string;
  resolved: string;
}

/** Walks every `.rels` part and returns each non-external relationship with its resolved target. */
async function collectInternalRelationships(zip: JSZip): Promise<RelEntry[]> {
  const relsPaths = Object.keys(zip.files).filter(p => p.endsWith('.rels') && !zip.files[p].dir);
  expect(relsPaths.length, 'the injected package must contain .rels parts').toBeGreaterThan(0);

  const entries: RelEntry[] = [];
  for (const relsPath of relsPaths) {
    const xml = await zip.files[relsPath].async('string');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.getElementsByTagName('parsererror').length, `${relsPath} must be well-formed XML`).toBe(0);

    const ownerDir = ownerDirOf(relsPath);
    const rels = doc.getElementsByTagName('Relationship');
    for (let i = 0; i < rels.length; i++) {
      const rel = rels[i];
      const mode = rel.getAttribute('TargetMode');
      if (mode && mode.toLowerCase() === 'external') continue; // external targets are out of scope
      const target = rel.getAttribute('Target');
      expect(target, `Relationship in ${relsPath} must declare a Target`).not.toBeNull();
      entries.push({
        relsPath,
        id: rel.getAttribute('Id'),
        target: target!,
        resolved: resolveTarget(target!, ownerDir),
      });
    }
  }
  return entries;
}

/** Asserts every internal relationship target resolves to an existing part. */
function assertNoDanglingReferences(zip: JSZip, entries: RelEntry[]): void {
  for (const { relsPath, id, target, resolved } of entries) {
    const exists = zip.file(resolved) !== null;
    expect(
      exists,
      `dangling relationship: ${relsPath} ${id ?? '(no Id)'} Target="${target}" resolved to missing part "${resolved}"`,
    ).toBe(true);
  }
}

// ---------------------------------------------------------------------------
// Generators — small datasets, 0..30 rows (zero-row case included).
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

const datasetArb = fc
  .array(fc.tuple(invoiceTypeArb, amountArb, amountArb, amountArb), { minLength: 0, maxLength: 30 })
  .map(rows => {
    const aoa: unknown[][] = [
      [...BASE_HEADERS],
      ...rows.map(([type, alacak, borc, indirim]) => [type, alacak, borc, indirim]),
    ];
    return aoa;
  });

// ---------------------------------------------------------------------------
// Property 12
// ---------------------------------------------------------------------------

describe('pivotInjector — Property 12: Relationship referential integrity', () => {
  it(
    'every non-external Target across all .rels parts resolves to an existing package part',
    async () => {
      await fc.assert(
        fc.asyncProperty(datasetArb, async aoa => {
          const zip = await injectAndLoadZip(aoa);
          const entries = await collectInternalRelationships(zip);
          assertNoDanglingReferences(zip, entries);
        }),
        { numRuns: 100 },
      );
    },
    120_000,
  );

  it('covers the injected pivot relationship chain (workbook → cacheDefinition → cacheRecords, host sheet → pivotTable)', async () => {
    const zip = await injectAndLoadZip([
      [...BASE_HEADERS],
      ['Toptan Satış Faturası', 100.5, 0, 1.25],
      ['Giden Havale', 0, 99.25, 0],
    ]);
    const entries = await collectInternalRelationships(zip);
    assertNoDanglingReferences(zip, entries);

    const resolved = entries.map(e => e.resolved);
    expect(resolved).toContain('xl/pivotCache/pivotCacheDefinition1.xml');
    expect(resolved).toContain('xl/pivotCache/pivotCacheRecords1.xml');
    expect(resolved).toContain('xl/pivotTables/pivotTable1.xml');
  });
});
