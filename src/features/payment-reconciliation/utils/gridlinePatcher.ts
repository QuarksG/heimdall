import JSZip from 'jszip';

/**
 * gridlinePatcher — post-processes a serialized `.xlsx` zip to turn OFF the
 * worksheet gridlines of ONE named sheet by setting
 * `<sheetView showGridLines="0">` on that sheet's worksheet part
 * (OOXML surgery via JSZip, following the pivotInjector zip-surgery pattern).
 *
 * Why zip surgery: SheetJS CE cannot reliably serialize `showGridLines`,
 * so the exporter patches the package AFTER serialization (and after pivot
 * injection), exactly like the native PivotTable stage does.
 *
 * Framework-free: no React, no SheetJS. Runs 100% in the browser (and in
 * Node 20+ where `Blob` is available globally).
 *
 * Requirement 5.5 of balance-check-cashier-model: the Vendor_Ledger sheet
 * ('Tedarikçi Cari Hareketleri') renders without gridlines; the patch
 * applies to that one sheet only — every other sheet is left untouched.
 */

/** Error thrown on any gridline-patch failure. Bilingual per codebase convention. */
export class GridlinePatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GridlinePatchError';
  }
}

/**
 * Sets `showGridLines="0"` on the `<sheetView>` of the named sheet's
 * worksheet part. All other package parts are preserved byte-for-byte by
 * the re-zip (only the one worksheet XML is rewritten).
 *
 * Never returns partial output: on any failure it throws GridlinePatchError.
 */
export async function disableSheetGridlines(
  workbookBlob: Blob,
  sheetName: string,
): Promise<Blob> {
  try {
    return await doPatch(workbookBlob, sheetName);
  } catch (err) {
    if (err instanceof GridlinePatchError) throw err;
    const cause = err instanceof Error ? err.message : String(err);
    fail(cause);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function fail(cause: string): never {
  throw new GridlinePatchError(
    `Kılavuz çizgisi yaması başarısız / Gridline patch failed: ${cause}`,
  );
}

/** Unescapes standard XML entities and numeric character references. */
function unescapeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Extracts an attribute value from a single XML tag string. */
function getAttr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return m ? unescapeXml(m[1]) : undefined;
}

/**
 * Resolves sheet name -> part path (e.g. 'xl/worksheets/sheet6.xml') from
 * xl/workbook.xml and xl/_rels/workbook.xml.rels — same resolution the
 * pivot injector performs.
 */
function resolveSheetPaths(workbookXml: string, workbookRelsXml: string): Map<string, string> {
  const relTargets = new Map<string, string>();
  const relRe = /<Relationship\b[^>]*\/?>/g;
  let rm: RegExpExecArray | null;
  while ((rm = relRe.exec(workbookRelsXml)) !== null) {
    const id = getAttr(rm[0], 'Id');
    const target = getAttr(rm[0], 'Target');
    if (!id || !target) continue;
    const normalized = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    relTargets.set(id, normalized);
  }

  const sheetPaths = new Map<string, string>();
  const sheetRe = /<sheet\b[^>]*\/?>/g;
  let sm: RegExpExecArray | null;
  while ((sm = sheetRe.exec(workbookXml)) !== null) {
    const name = getAttr(sm[0], 'name');
    const rid = getAttr(sm[0], 'r:id');
    if (!name || !rid) continue;
    const path = relTargets.get(rid);
    if (path) sheetPaths.set(name, path);
  }
  return sheetPaths;
}

/**
 * Rewrites one worksheet part's XML so its (first) `<sheetView>` carries
 * `showGridLines="0"`.
 *
 * Two cases:
 * 1. `<sheetViews>` already present — patch the existing `<sheetView>` tag
 *    attributes in place (replace an existing showGridLines value, or add
 *    the attribute when absent).
 * 2. `<sheetViews>` absent — insert a minimal
 *    `<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>`
 *    at the schema-valid position: per the CT_Worksheet sequence,
 *    `sheetViews` comes AFTER `sheetPr`/`dimension` and BEFORE
 *    `sheetFormatPr`/`cols`/`sheetData`.
 */
export function patchWorksheetXml(sheetXml: string, sheetName: string): string {
  // Case 1: an existing <sheetView> tag — patch its attributes in place.
  const viewTagRe = /<sheetView\b([^>]*?)(\/?)>/;
  const viewMatch = sheetXml.match(viewTagRe);
  if (viewMatch) {
    const attrs = viewMatch[1];
    const patchedAttrs = /(?:^|\s)showGridLines="[^"]*"/.test(attrs)
      ? attrs.replace(/((?:^|\s)showGridLines=")[^"]*(")/, '$10$2')
      : ` showGridLines="0"${attrs}`;
    return sheetXml.replace(viewTagRe, `<sheetView${patchedAttrs}${viewMatch[2]}>`);
  }

  // Case 2: no <sheetViews> — insert one at the schema-valid position.
  const insertion = '<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>';

  // Preferred anchor: immediately after <dimension .../> (dimension precedes
  // sheetViews in the schema sequence and SheetJS always emits it).
  const dimMatch = sheetXml.match(/<dimension\b[^>]*\/>/);
  if (dimMatch && dimMatch.index !== undefined) {
    const at = dimMatch.index + dimMatch[0].length;
    return sheetXml.slice(0, at) + insertion + sheetXml.slice(at);
  }

  // Next anchor: after </sheetPr> or a self-closing <sheetPr .../>.
  const sheetPrMatch = sheetXml.match(/<sheetPr\b[^>]*\/>|<sheetPr\b[^>]*>[\s\S]*?<\/sheetPr>/);
  if (sheetPrMatch && sheetPrMatch.index !== undefined) {
    const at = sheetPrMatch.index + sheetPrMatch[0].length;
    return sheetXml.slice(0, at) + insertion + sheetXml.slice(at);
  }

  // Fallback: right after the opening <worksheet ...> tag (sheetViews is the
  // first present element of the sequence when sheetPr/dimension are absent).
  const openMatch = sheetXml.match(/<worksheet\b[^>]*>/);
  if (openMatch && openMatch.index !== undefined) {
    const at = openMatch.index + openMatch[0].length;
    return sheetXml.slice(0, at) + insertion + sheetXml.slice(at);
  }

  fail(`the worksheet part of sheet '${sheetName}' is malformed (no <worksheet> element)`);
}

// ---------------------------------------------------------------------------
// Main patch flow
// ---------------------------------------------------------------------------

async function readZipText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) fail(`required package part '${path}' is missing`);
  return file.async('string');
}

async function doPatch(workbookBlob: Blob, sheetName: string): Promise<Blob> {
  let zip: JSZip;
  try {
    // ArrayBuffer, not Blob: JSZip's Blob support detection is
    // browser-window-based, so passing the Blob directly breaks in Node
    // even though `Blob` exists globally there. ArrayBuffer loads in both.
    zip = await JSZip.loadAsync(await workbookBlob.arrayBuffer());
  } catch (err) {
    fail(`the workbook bytes are not a readable zip package (${err instanceof Error ? err.message : String(err)})`);
  }

  // 1. Resolve the target sheet's worksheet part path by sheet name.
  const workbookXml = await readZipText(zip, 'xl/workbook.xml');
  const workbookRelsXml = await readZipText(zip, 'xl/_rels/workbook.xml.rels');
  const sheetPath = resolveSheetPaths(workbookXml, workbookRelsXml).get(sheetName);
  if (!sheetPath) fail(`sheet '${sheetName}' was not found in the workbook`);

  // 2. Patch ONLY that worksheet part — every other part stays untouched.
  const sheetXml = await readZipText(zip, sheetPath);
  zip.file(sheetPath, patchWorksheetXml(sheetXml, sheetName));

  // 3. Regenerate the package. Never returns partial output — any earlier
  //    failure has already thrown before this point.
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
