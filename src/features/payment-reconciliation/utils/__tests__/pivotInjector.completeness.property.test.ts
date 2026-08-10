// Feature: reconciliation-excel-export-enhancements, Property 10: Injected package completeness
//
// For any input record set, after injection the package SHALL contain the
// pivotCacheDefinition part, the pivotCacheRecords part, the pivotTable part,
// and their relationship parts; the three pivot content-type Override entries
// in [Content_Types].xml; a <pivotCaches> entry in workbook.xml referencing
// the cache; and the workbook-level and host-sheet-level relationships to
// those parts.
//
// **Validates: Requirements 6.1, 6.2, 6.3, 6.4**

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

const REL_NS_DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL_PIVOT_TABLE = `${REL_NS_DOC}/pivotTable`;
const REL_CACHE_DEF = `${REL_NS_DOC}/pivotCacheDefinition`;

const CT_PIVOT_TABLE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml';
const CT_CACHE_DEF = 'application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml';
const CT_CACHE_REC = 'application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml';

const REQUIRED_PARTS = [
  'xl/pivotCache/pivotCacheDefinition1.xml',
  'xl/pivotCache/pivotCacheRecords1.xml',
  'xl/pivotTables/pivotTable1.xml',
  'xl/pivotTables/_rels/pivotTable1.xml.rels',
  'xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels',
] as const;

/** Builds the workbook in memory, injects the pivot, and returns the loaded zip. */
async function injectAndLoadZip(aoa: unknown[][]): Promise<JSZip> {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Payment Data');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Pivot Fatura Türü');
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

  const blob = await injectPivotTable(new Uint8Array(bytes), CONFIG);
  return JSZip.loadAsync(await blob.arrayBuffer());
}

async function readPart(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  expect(file, `package part '${path}' must exist after injection`).not.toBeNull();
  return file!.async('string');
}

function parseXml(xml: string, label: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  expect(doc.getElementsByTagName('parsererror').length, `${label} must be well-formed XML`).toBe(0);
  return doc;
}

/** Collects Relationship elements from a .rels document as {id, type, target}. */
function readRelationships(doc: Document): Array<{ id: string; type: string; target: string }> {
  return Array.from(doc.getElementsByTagName('Relationship')).map(el => ({
    id: el.getAttribute('Id') ?? '',
    type: el.getAttribute('Type') ?? '',
    target: el.getAttribute('Target') ?? '',
  }));
}

/** Resolves the host sheet's part path via workbook.xml + workbook.xml.rels. */
function resolveHostSheetPath(workbookDoc: Document, workbookRels: Array<{ id: string; target: string }>): string {
  const sheetEl = Array.from(workbookDoc.getElementsByTagName('sheet')).find(
    el => el.getAttribute('name') === CONFIG.hostSheetName,
  );
  expect(sheetEl, `workbook.xml must declare the host sheet '${CONFIG.hostSheetName}'`).toBeDefined();
  const rid = sheetEl!.getAttribute('r:id');
  expect(rid, 'host sheet entry must carry an r:id').toBeTruthy();
  const rel = workbookRels.find(r => r.id === rid);
  expect(rel, `workbook rels must resolve host sheet r:id '${rid}'`).toBeDefined();
  const target = rel!.target;
  return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
}

/** All Property 10 completeness assertions over one injected package. */
async function assertPackageCompleteness(aoa: unknown[][]): Promise<void> {
  const zip = await injectAndLoadZip(aoa);

  // (1) Requirement 6.1 — all pivot parts and their relationship parts exist.
  for (const part of REQUIRED_PARTS) {
    expect(zip.file(part), `package part '${part}' must exist after injection`).not.toBeNull();
  }

  // (2) Requirement 6.2 — [Content_Types].xml registers the three pivot Overrides.
  const ctDoc = parseXml(await readPart(zip, '[Content_Types].xml'), '[Content_Types].xml');
  const overrides = new Map(
    Array.from(ctDoc.getElementsByTagName('Override')).map(el => [
      el.getAttribute('PartName') ?? '',
      el.getAttribute('ContentType') ?? '',
    ]),
  );
  expect(overrides.get('/xl/pivotTables/pivotTable1.xml')).toBe(CT_PIVOT_TABLE);
  expect(overrides.get('/xl/pivotCache/pivotCacheDefinition1.xml')).toBe(CT_CACHE_DEF);
  expect(overrides.get('/xl/pivotCache/pivotCacheRecords1.xml')).toBe(CT_CACHE_REC);

  // (3) Requirement 6.3 — workbook.xml has a <pivotCaches> entry whose r:id resolves.
  const workbookDoc = parseXml(await readPart(zip, 'xl/workbook.xml'), 'xl/workbook.xml');
  const workbookRelsDoc = parseXml(await readPart(zip, 'xl/_rels/workbook.xml.rels'), 'xl/_rels/workbook.xml.rels');
  const workbookRels = readRelationships(workbookRelsDoc);

  const pivotCachesEls = workbookDoc.getElementsByTagName('pivotCaches');
  expect(pivotCachesEls.length, 'workbook.xml must contain exactly one <pivotCaches> element').toBe(1);
  const pivotCacheEls = pivotCachesEls[0].getElementsByTagName('pivotCache');
  expect(pivotCacheEls.length, '<pivotCaches> must contain exactly one <pivotCache> entry').toBe(1);
  const cacheRid = pivotCacheEls[0].getAttribute('r:id');
  expect(cacheRid, '<pivotCache> must carry an r:id').toBeTruthy();
  const cacheRel = workbookRels.find(r => r.id === cacheRid);
  expect(cacheRel, `workbook rels must resolve the <pivotCache> r:id '${cacheRid}'`).toBeDefined();
  expect(cacheRel!.type).toBe(REL_CACHE_DEF);
  expect(cacheRel!.target).toBe('pivotCache/pivotCacheDefinition1.xml');

  // (4) Requirement 6.4 — workbook-level pivotCacheDefinition relationship exists.
  const cacheDefRels = workbookRels.filter(r => r.type === REL_CACHE_DEF);
  expect(cacheDefRels.length, 'workbook rels must contain exactly one pivotCacheDefinition relationship').toBe(1);

  // (5) Requirement 6.4 — the host sheet's _rels has a pivotTable relationship.
  const hostPath = resolveHostSheetPath(workbookDoc, workbookRels);
  const slash = hostPath.lastIndexOf('/');
  const hostRelsPath = `${hostPath.slice(0, slash)}/_rels/${hostPath.slice(slash + 1)}.rels`;
  const hostRelsDoc = parseXml(await readPart(zip, hostRelsPath), hostRelsPath);
  const pivotTableRels = readRelationships(hostRelsDoc).filter(r => r.type === REL_PIVOT_TABLE);
  expect(pivotTableRels.length, "host sheet rels must contain exactly one pivotTable relationship").toBe(1);
  expect(pivotTableRels[0].target).toBe('../pivotTables/pivotTable1.xml');
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
// Property 10
// ---------------------------------------------------------------------------

describe('pivotInjector — Property 10: Injected package completeness', () => {
  it(
    'after injection the package contains all pivot parts, content-type Overrides, the <pivotCaches> entry, and workbook + host-sheet relationships',
    async () => {
      await fc.assert(
        fc.asyncProperty(datasetArb, async aoa => {
          await assertPackageCompleteness(aoa);
        }),
        { numRuns: 100 },
      );
    },
    120_000,
  );

  it('holds for the header-only (zero data rows) workbook', async () => {
    await assertPackageCompleteness([[...BASE_HEADERS]]);
  });
});
