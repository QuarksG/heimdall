import JSZip from 'jszip';

/**
 * pivotInjector — post-processes a serialized `.xlsx` zip to inject a native,
 * refresh-on-load Excel PivotTable (OOXML surgery via JSZip).
 *
 * Framework-free: no React, no SheetJS. Runs 100% in the browser (and in
 * Node 20+ for tests, where `Blob` is available globally).
 *
 * Requirements: 1.7, 5.2–5.9, 6.1–6.4 of reconciliation-excel-export-enhancements.
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PivotValueField {
  /** Header label of the source column to Sum (matched against Payment Data header cells). */
  sourceField: string;
}

export interface PivotInjectorConfig {
  /** Sheet that hosts the PivotTable, e.g. 'Pivot Fatura Türü'. */
  hostSheetName: string;
  /** Sheet the pivot cache reads from, e.g. 'Payment Data'. */
  sourceSheetName: string;
  /**
   * Header labels of the row-axis fields, OUTERMOST first. One or two
   * fields are supported: ['Fatura Türü'] for a single-currency file,
   * ['Ödeme para birimi', 'Fatura Türü'] for a multi-currency file
   * (currency as the outer grouping so amounts are never mixed across
   * currencies).
   */
  rowFields: string[];
  /** Value fields, each aggregated with Sum. */
  valueFields: PivotValueField[];
}

/** Error thrown on any pivot-injection failure (Requirement 1.7, 5.9). */
export class PivotInjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PivotInjectionError';
  }
}

/**
 * Injects a native, refresh-on-load PivotTable into serialized .xlsx bytes.
 * Never returns partial output: on any failure it throws PivotInjectionError.
 */
export async function injectPivotTable(
  bytes: Uint8Array,
  config: PivotInjectorConfig,
): Promise<Blob> {
  try {
    return await doInject(bytes, config);
  } catch (err) {
    if (err instanceof PivotInjectionError) throw err;
    const cause = err instanceof Error ? err.message : String(err);
    throw new PivotInjectionError(`Native PivotTable injection failed: ${cause}`);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers — XML primitives
// ---------------------------------------------------------------------------

function fail(cause: string): never {
  throw new PivotInjectionError(`Native PivotTable injection failed: ${cause}`);
}

/** Escapes a string for safe interpolation into XML text/attribute content. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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

/** Converts a 0-based column index to an Excel column letter (0 -> 'A'). */
function colLetter(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Converts an Excel column letter to a 0-based index ('A' -> 0). */
function colIndex(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n - 1;
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL_DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_REL_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

// ---------------------------------------------------------------------------
// Internal helpers — workbook / sheet parsing
// ---------------------------------------------------------------------------

/** Resolves sheet name -> part path (e.g. 'xl/worksheets/sheet1.xml'). */
function resolveSheetPaths(workbookXml: string, workbookRelsXml: string): Map<string, string> {
  // r:id -> target part path (normalized relative to the package root)
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

/** Parses xl/sharedStrings.xml into an ordered array of strings. */
function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\/>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml)) !== null) {
    const inner = m[1] ?? '';
    let text = '';
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\/>/g;
    let tm: RegExpExecArray | null;
    while ((tm = tRe.exec(inner)) !== null) {
      text += unescapeXml(tm[1] ?? '');
    }
    strings.push(text);
  }
  return strings;
}

/** A resolved worksheet cell value. */
type CellValue =
  | { kind: 'n'; raw: string; num: number }
  | { kind: 's'; str: string };

/** Parses a worksheet part into a sparse cell grid keyed by [row][col] (0-based). */
function parseSheetCells(sheetXml: string, sharedStrings: string[]): Map<number, Map<number, CellValue>> {
  const grid = new Map<number, Map<number, CellValue>>();
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(sheetXml)) !== null) {
    const attrs = m[1];
    const inner = m[2] ?? '';
    const ref = getAttr(`<c ${attrs}>`, 'r');
    if (!ref) continue;
    const refMatch = ref.match(/^([A-Z]+)(\d+)$/);
    if (!refMatch) continue;
    const col = colIndex(refMatch[1]);
    const row = parseInt(refMatch[2], 10) - 1;
    const type = getAttr(`<c ${attrs}>`, 't') ?? 'n';

    let value: CellValue | undefined;
    if (type === 'inlineStr') {
      const tm = inner.match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
      const str = tm ? unescapeXml(tm[1]) : '';
      if (str !== '') value = { kind: 's', str };
    } else {
      const vm = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
      if (!vm) continue; // no value -> treat as blank
      const raw = unescapeXml(vm[1]);
      if (raw === '') continue;
      if (type === 's') {
        const idx = parseInt(raw, 10);
        const str = sharedStrings[idx];
        if (str === undefined) fail(`shared string index ${idx} not found while reading the source sheet`);
        if (str !== '') value = { kind: 's', str };
      } else if (type === 'str' || type === 'd' || type === 'e') {
        value = { kind: 's', str: raw };
      } else {
        // 'n', 'b' or untyped numeric
        const num = parseFloat(raw);
        if (Number.isNaN(num)) {
          value = { kind: 's', str: raw };
        } else {
          value = { kind: 'n', raw, num };
        }
      }
    }

    if (value) {
      let rowMap = grid.get(row);
      if (!rowMap) {
        rowMap = new Map<number, CellValue>();
        grid.set(row, rowMap);
      }
      rowMap.set(col, value);
    }
  }
  return grid;
}

// ---------------------------------------------------------------------------
// Internal helpers — source-sheet analysis
// ---------------------------------------------------------------------------

interface SourceExtent {
  minCol: number;
  maxCol: number;
  /** 0-based index of the last populated row (0 when header-only). */
  maxRow: number;
  /** Header labels in column order (minCol..maxCol). */
  headers: string[];
  /** A1-style source range, header row through last populated row/column. */
  ref: string;
}

/** Resolves the populated extent of the source sheet (header-only when zero data rows). */
function resolveExtent(grid: Map<number, Map<number, CellValue>>, sourceSheetName: string): SourceExtent {
  let minCol = Infinity;
  let maxCol = -1;
  let maxRow = -1;
  for (const [row, cols] of grid) {
    for (const col of cols.keys()) {
      if (col < minCol) minCol = col;
      if (col > maxCol) maxCol = col;
      if (row > maxRow) maxRow = row;
    }
  }
  if (maxCol < 0 || maxRow < 0) {
    fail(`the '${sourceSheetName}' sheet has no populated cells, so the pivot source range cannot be resolved`);
  }

  const headerRow = grid.get(0);
  if (!headerRow || headerRow.size === 0) {
    fail(`the '${sourceSheetName}' sheet has no header row, so the pivot cache fields cannot be built`);
  }

  const headers: string[] = [];
  for (let c = minCol; c <= maxCol; c++) {
    const cell = headerRow.get(c);
    if (!cell) {
      fail(`the '${sourceSheetName}' header row has an empty cell at column ${colLetter(c)}, so a cache field name cannot be resolved`);
    }
    headers.push(cell.kind === 's' ? cell.str : cell.raw);
  }

  const ref = `${colLetter(minCol)}1:${colLetter(maxCol)}${maxRow + 1}`;
  return { minCol, maxCol, maxRow, headers, ref };
}

/**
 * Matches a configured field label against the serialized headers, tolerating
 * the spaced/unspaced label discrepancy (' Alacak ' vs 'Alacak').
 * Returns the 0-based field index (relative to minCol).
 */
function resolveFieldIndex(headers: string[], label: string): number {
  const exact = headers.indexOf(label);
  if (exact >= 0) return exact;
  const trimmed = label.trim();
  const matches: number[] = [];
  headers.forEach((h, i) => {
    if (h.trim() === trimmed) matches.push(i);
  });
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    fail(`field '${label}' was not found among the source sheet headers [${headers.join(', ')}]`);
  }
  fail(`field '${label}' matches multiple source sheet headers ambiguously`);
}

interface FieldStats {
  hasString: boolean;
  hasNumber: boolean;
  hasBlank: boolean;
  allInt: boolean;
  min: number;
  max: number;
}

function newFieldStats(): FieldStats {
  return { hasString: false, hasNumber: false, hasBlank: false, allInt: true, min: Infinity, max: -Infinity };
}

// ---------------------------------------------------------------------------
// Internal helpers — pivot part builders
// ---------------------------------------------------------------------------

/** Shared-item catalogue of one row-axis field. */
interface AxisModel {
  /** Distinct string values, first-appearance order. */
  items: string[];
  /** True when at least one cell is blank (mapped to a trailing <m/> shared item). */
  hasBlank: boolean;
}

interface CacheModel {
  /** Row-axis catalogues keyed by 0-based field index (config order preserved separately). */
  axes: Map<number, AxisModel>;
  /** Serialized <r>…</r> entries for pivotCacheRecords. */
  recordsXml: string[];
  /** Per-field stats for sharedItems attributes. */
  stats: FieldStats[];
  /**
   * Distinct row-axis combinations observed in the data — one tuple of
   * axis item indices per combination, in the order of `rowFieldIdxs`.
   * Drives the hierarchical <rowItems> layout.
   */
  rowCombos: number[][];
}

/** Walks the data rows and builds shared items, per-field stats and cache records. */
function buildCacheModel(
  grid: Map<number, Map<number, CellValue>>,
  extent: SourceExtent,
  rowFieldIdxs: number[],
): CacheModel {
  const fieldCount = extent.maxCol - extent.minCol + 1;
  const axes = new Map<number, AxisModel>();
  const axisIndexes = new Map<number, Map<string, number>>();
  rowFieldIdxs.forEach(f => {
    axes.set(f, { items: [], hasBlank: false });
    axisIndexes.set(f, new Map<string, number>());
  });
  const stats: FieldStats[] = Array.from({ length: fieldCount }, newFieldStats);
  const recordsXml: string[] = [];
  const comboSeen = new Set<string>();
  const rowCombos: number[][] = [];
  /** Per-record axis indices (−1 = blank placeholder, patched below). */
  const recordAxisIdxs: number[][] = [];

  for (let r = 1; r <= extent.maxRow; r++) {
    const rowMap = grid.get(r);
    const parts: string[] = [];
    const axisIdxByField = new Map<number, number>();
    for (let f = 0; f < fieldCount; f++) {
      const cell = rowMap?.get(extent.minCol + f);
      const st = stats[f];

      const axis = axes.get(f);
      if (axis) {
        if (!cell) {
          axis.hasBlank = true;
          st.hasBlank = true;
          axisIdxByField.set(f, -1); // patched below once the blank index is known
          parts.push(`__BLANK_AXIS_${f}__`);
        } else {
          const str = cell.kind === 's' ? cell.str : cell.raw;
          const index = axisIndexes.get(f)!;
          let idx = index.get(str);
          if (idx === undefined) {
            idx = axis.items.length;
            axis.items.push(str);
            index.set(str, idx);
          }
          st.hasString = true;
          axisIdxByField.set(f, idx);
          parts.push(`<x v="${idx}"/>`);
        }
        continue;
      }

      if (!cell) {
        st.hasBlank = true;
        parts.push('<m/>');
      } else if (cell.kind === 'n') {
        st.hasNumber = true;
        if (!Number.isInteger(cell.num)) st.allInt = false;
        if (cell.num < st.min) st.min = cell.num;
        if (cell.num > st.max) st.max = cell.num;
        parts.push(`<n v="${escapeXml(cell.raw)}"/>`);
      } else {
        st.hasString = true;
        parts.push(`<s v="${escapeXml(cell.str)}"/>`);
      }
    }
    // Record the axis indices in CONFIG order (outermost first).
    recordAxisIdxs.push(rowFieldIdxs.map(f => axisIdxByField.get(f)!));
    recordsXml.push(`<r>${parts.join('')}</r>`);
  }

  // Blank axis cells reference the trailing <m/> shared item of their field.
  rowFieldIdxs.forEach(f => {
    const axis = axes.get(f)!;
    if (!axis.hasBlank) return;
    const blankIdx = axis.items.length;
    for (let i = 0; i < recordsXml.length; i++) {
      recordsXml[i] = recordsXml[i].replaceAll(`__BLANK_AXIS_${f}__`, `<x v="${blankIdx}"/>`);
    }
  });

  // Distinct axis combinations (blanks resolved to their trailing index),
  // sorted by item index at each level for a deterministic layout.
  recordAxisIdxs.forEach(idxs => {
    const resolved = idxs.map((idx, level) => {
      const axis = axes.get(rowFieldIdxs[level])!;
      return idx === -1 ? axis.items.length : idx;
    });
    const key = resolved.join('|');
    if (!comboSeen.has(key)) {
      comboSeen.add(key);
      rowCombos.push(resolved);
    }
  });
  rowCombos.sort((a, b) => {
    for (let level = 0; level < a.length; level++) {
      if (a[level] !== b[level]) return a[level] - b[level];
    }
    return 0;
  });

  return { axes, recordsXml, stats, rowCombos };
}

/** sharedItems attribute/body for one cache field. */
function buildSharedItemsXml(fieldIdx: number, model: CacheModel): string {
  const axis = model.axes.get(fieldIdx);
  if (axis) {
    const entries = axis.items.map(v => `<s v="${escapeXml(v)}"/>`);
    if (axis.hasBlank) entries.push('<m/>');
    if (entries.length === 0) return '<sharedItems/>';
    const blankAttr = axis.hasBlank ? ' containsBlank="1"' : '';
    return `<sharedItems${blankAttr} count="${entries.length}">${entries.join('')}</sharedItems>`;
  }

  const st = model.stats[fieldIdx];
  const attrs: string[] = [];
  if (st.hasBlank && (st.hasNumber || st.hasString)) attrs.push('containsBlank="1"');
  if (st.hasNumber && st.hasString) {
    attrs.push('containsMixedTypes="1"', 'containsNumber="1"');
    if (st.allInt) attrs.push('containsInteger="1"');
    attrs.push(`minValue="${st.min}"`, `maxValue="${st.max}"`);
  } else if (st.hasNumber) {
    if (!st.hasBlank) attrs.push('containsSemiMixedTypes="0"');
    attrs.push('containsString="0"', 'containsNumber="1"');
    if (st.allInt) attrs.push('containsInteger="1"');
    attrs.push(`minValue="${st.min}"`, `maxValue="${st.max}"`);
  } else if (!st.hasString && st.hasBlank) {
    // blanks only
    attrs.length = 0;
    attrs.push('containsNonDate="0"', 'containsString="0"', 'containsBlank="1"');
  }
  return attrs.length > 0 ? `<sharedItems ${attrs.join(' ')}/>` : '<sharedItems/>';
}

function buildPivotCacheDefinitionXml(
  config: PivotInjectorConfig,
  extent: SourceExtent,
  model: CacheModel,
): string {
  const fields = extent.headers
    .map((name, i) =>
      `<cacheField name="${escapeXml(name)}" numFmtId="0">${buildSharedItemsXml(i, model)}</cacheField>`)
    .join('');
  return (
    XML_DECL +
    `<pivotCacheDefinition xmlns="${NS_MAIN}" xmlns:r="${NS_REL_DOC}" r:id="rId1" ` +
    `refreshOnLoad="1" refreshedVersion="8" minRefreshableVersion="3" createdVersion="8" ` +
    `recordCount="${model.recordsXml.length}">` +
    `<cacheSource type="worksheet">` +
    `<worksheetSource ref="${extent.ref}" sheet="${escapeXml(config.sourceSheetName)}"/>` +
    `</cacheSource>` +
    `<cacheFields count="${extent.headers.length}">${fields}</cacheFields>` +
    `</pivotCacheDefinition>`
  );
}

function buildPivotCacheRecordsXml(model: CacheModel): string {
  return (
    XML_DECL +
    `<pivotCacheRecords xmlns="${NS_MAIN}" xmlns:r="${NS_REL_DOC}" count="${model.recordsXml.length}">` +
    model.recordsXml.join('') +
    `</pivotCacheRecords>`
  );
}

/**
 * Hierarchical <rowItems> from the observed axis combinations.
 * One level: one <i> per item. Two levels: one <i> per OUTER item
 * (subtotal-top outline row) followed by its inner items at depth r="1".
 * Always ends with the grand-total item.
 */
function buildRowItemsXml(rowCombos: number[][]): { xml: string; rowCount: number } {
  const items: string[] = [];
  let previous: number[] | null = null;

  rowCombos.forEach(combo => {
    // Emit a parent row whenever an outer level changes (levels above the
    // deepest one); then the deepest-level row itself.
    for (let level = 0; level < combo.length - 1; level++) {
      const changed = previous === null || previous[level] !== combo[level];
      if (changed) {
        const depth = level === 0 ? '' : ` r="${level}"`;
        const v = combo[level] === 0 ? '' : ` v="${combo[level]}"`;
        items.push(`<i${depth}><x${v}/></i>`);
      }
    }
    const deepest = combo.length - 1;
    const depth = deepest === 0 ? '' : ` r="${deepest}"`;
    const v = combo[deepest] === 0 ? '' : ` v="${combo[deepest]}"`;
    items.push(`<i${depth}><x${v}/></i>`);
    previous = combo;
  });

  items.push('<i t="grand"><x/></i>');
  return { xml: items.join(''), rowCount: items.length };
}

function buildPivotTableXml(
  extent: SourceExtent,
  model: CacheModel,
  rowFieldIdxs: number[],
  valueFieldIdxs: number[],
  cacheId: number,
): string {
  const fieldCount = extent.headers.length;

  // pivotFields: one per cache field, in order.
  const pivotFields: string[] = [];
  for (let f = 0; f < fieldCount; f++) {
    const axis = model.axes.get(f);
    if (axis) {
      const itemCount = axis.items.length + (axis.hasBlank ? 1 : 0);
      const items =
        Array.from({ length: itemCount }, (_, i) => `<item x="${i}"/>`).join('') +
        '<item t="default"/>';
      pivotFields.push(
        `<pivotField axis="axisRow" showAll="0"><items count="${itemCount + 1}">${items}</items></pivotField>`,
      );
    } else if (valueFieldIdxs.includes(f)) {
      pivotFields.push('<pivotField dataField="1" showAll="0"/>');
    } else {
      pivotFields.push('<pivotField showAll="0"/>');
    }
  }

  const { xml: rowItems, rowCount } = buildRowItemsXml(model.rowCombos);

  // Location on the host sheet: header row at A3, then the row items
  // (parents + leaves + grand total).
  const cols = 1 + valueFieldIdxs.length;
  const endRow = 3 + rowCount; // A3 header + row items (grand total included)
  const ref = `A3:${colLetter(cols - 1)}${endRow}`;

  const colItems = valueFieldIdxs
    .map((_, i) => (i === 0 ? '<i><x/></i>' : `<i i="${i}"><x v="${i}"/></i>`))
    .join('');

  const dataFields = valueFieldIdxs
    .map(f => `<dataField name="${escapeXml(`Sum of ${extent.headers[f]}`)}" fld="${f}" baseField="0" baseItem="0"/>`)
    .join('');

  const rowFields = rowFieldIdxs.map(f => `<field x="${f}"/>`).join('');

  return (
    XML_DECL +
    `<pivotTableDefinition xmlns="${NS_MAIN}" name="PivotTable1" cacheId="${cacheId}" ` +
    `applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" ` +
    `applyAlignmentFormats="0" applyWidthHeightFormats="1" dataCaption="Values" ` +
    `updatedVersion="8" minRefreshableVersion="3" useAutoFormatting="1" itemPrintTitles="1" ` +
    `createdVersion="8" indent="0" outline="1" outlineData="1" multipleFieldFilters="0">` +
    `<location ref="${ref}" firstHeaderRow="1" firstDataRow="2" firstDataCol="1"/>` +
    `<pivotFields count="${fieldCount}">${pivotFields.join('')}</pivotFields>` +
    `<rowFields count="${rowFieldIdxs.length}">${rowFields}</rowFields>` +
    `<rowItems count="${rowCount}">${rowItems}</rowItems>` +
    `<colFields count="1"><field x="-2"/></colFields>` +
    `<colItems count="${valueFieldIdxs.length}">${colItems}</colItems>` +
    `<dataFields count="${valueFieldIdxs.length}">${dataFields}</dataFields>` +
    `<pivotTableStyleInfo name="PivotStyleLight16" showRowHeaders="1" showColHeaders="1" ` +
    `showRowStripes="0" showColStripes="0" showLastColumn="1"/>` +
    `</pivotTableDefinition>`
  );
}

// ---------------------------------------------------------------------------
// Internal helpers — package patching
// ---------------------------------------------------------------------------

const CT_PIVOT_TABLE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml';
const CT_CACHE_DEF = 'application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml';
const CT_CACHE_REC = 'application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml';
const REL_PIVOT_TABLE = `${NS_REL_DOC}/pivotTable`;
const REL_CACHE_DEF = `${NS_REL_DOC}/pivotCacheDefinition`;
const REL_CACHE_REC = `${NS_REL_DOC}/pivotCacheRecords`;

/** Registers the three pivot part content types (Requirement 6.2). */
function patchContentTypes(xml: string): string {
  const overrides =
    `<Override PartName="/xl/pivotTables/pivotTable1.xml" ContentType="${CT_PIVOT_TABLE}"/>` +
    `<Override PartName="/xl/pivotCache/pivotCacheDefinition1.xml" ContentType="${CT_CACHE_DEF}"/>` +
    `<Override PartName="/xl/pivotCache/pivotCacheRecords1.xml" ContentType="${CT_CACHE_REC}"/>`;
  if (!xml.includes('</Types>')) fail('[Content_Types].xml is malformed (missing </Types>)');
  return xml.replace('</Types>', `${overrides}</Types>`);
}

/** Picks a cacheId that does not collide with any existing pivotCache entry. */
function chooseCacheId(workbookXml: string): number {
  let max = 0;
  const re = /cacheId="(\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(workbookXml)) !== null) {
    max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

/**
 * Appends <pivotCaches> to workbook.xml (Requirement 6.3). Per the CT_Workbook
 * schema sequence, pivotCaches comes AFTER calcPr, so inserting immediately
 * before </workbook> keeps the part schema-valid whether or not calcPr exists.
 */
function patchWorkbookXml(xml: string, cacheId: number, relId: string): string {
  if (xml.includes('<pivotCaches>')) fail('xl/workbook.xml already contains a <pivotCaches> element');
  if (!xml.includes('</workbook>')) fail('xl/workbook.xml is malformed (missing </workbook>)');
  const entry = `<pivotCaches><pivotCache cacheId="${cacheId}" r:id="${relId}"/></pivotCaches>`;
  return xml.replace('</workbook>', `${entry}</workbook>`);
}

/** Picks the next unused rId in a relationships part. */
function nextRelId(relsXml: string): string {
  let max = 0;
  const re = /Id="rId(\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(relsXml)) !== null) {
    max = Math.max(max, parseInt(m[1], 10));
  }
  return `rId${max + 1}`;
}

/** Appends a relationship to an existing .rels part. */
function appendRelationship(relsXml: string, id: string, type: string, target: string): string {
  if (!relsXml.includes('</Relationships>')) fail('a relationships part is malformed (missing </Relationships>)');
  const rel = `<Relationship Id="${id}" Type="${type}" Target="${escapeXml(target)}"/>`;
  return relsXml.replace('</Relationships>', `${rel}</Relationships>`);
}

/** Builds a standalone .rels part with a single relationship. */
function buildRelsPart(id: string, type: string, target: string): string {
  return (
    XML_DECL +
    `<Relationships xmlns="${NS_REL_PKG}">` +
    `<Relationship Id="${id}" Type="${type}" Target="${escapeXml(target)}"/>` +
    `</Relationships>`
  );
}

/** Derives the .rels path for a worksheet part ('xl/worksheets/sheet4.xml' -> 'xl/worksheets/_rels/sheet4.xml.rels'). */
function sheetRelsPath(sheetPath: string): string {
  const slash = sheetPath.lastIndexOf('/');
  return `${sheetPath.slice(0, slash)}/_rels/${sheetPath.slice(slash + 1)}.rels`;
}

// ---------------------------------------------------------------------------
// Main injection flow
// ---------------------------------------------------------------------------

async function readZipText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) fail(`required package part '${path}' is missing`);
  return file.async('string');
}

async function doInject(bytes: Uint8Array, config: PivotInjectorConfig): Promise<Blob> {
  if (config.valueFields.length === 0) {
    fail('at least one value field must be configured');
  }
  if (config.rowFields.length < 1 || config.rowFields.length > 2) {
    fail('between one and two row fields must be configured');
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (err) {
    fail(`the workbook bytes are not a readable zip package (${err instanceof Error ? err.message : String(err)})`);
  }

  // 1. Resolve sheet name -> part path for host and source sheets.
  const workbookXml = await readZipText(zip, 'xl/workbook.xml');
  const workbookRelsXml = await readZipText(zip, 'xl/_rels/workbook.xml.rels');
  const sheetPaths = resolveSheetPaths(workbookXml, workbookRelsXml);

  const hostPath = sheetPaths.get(config.hostSheetName);
  if (!hostPath) fail(`host sheet '${config.hostSheetName}' was not found in the workbook`);
  const sourcePath = sheetPaths.get(config.sourceSheetName);
  if (!sourcePath) fail(`source sheet '${config.sourceSheetName}' was not found in the workbook`);

  // 2. Read the source sheet: headers, populated extent, per-row values.
  const sharedStringsFile = zip.file('xl/sharedStrings.xml');
  const sharedStrings = sharedStringsFile ? parseSharedStrings(await sharedStringsFile.async('string')) : [];
  const sourceXml = await readZipText(zip, sourcePath);
  const grid = parseSheetCells(sourceXml, sharedStrings);
  const extent = resolveExtent(grid, config.sourceSheetName);

  // 3. Resolve configured fields against the serialized headers (tolerating
  //    the spaced/unspaced label discrepancy — see design cache-field note).
  const rowFieldIdxs = config.rowFields.map(rf => resolveFieldIndex(extent.headers, rf));
  if (new Set(rowFieldIdxs).size !== rowFieldIdxs.length) {
    fail('row fields resolve to the same source column — they must be distinct');
  }
  const valueFieldIdxs = config.valueFields.map(vf => resolveFieldIndex(extent.headers, vf.sourceField));

  // 4. Build the cache model and the pivot XML parts.
  const model = buildCacheModel(grid, extent, rowFieldIdxs);
  const cacheId = chooseCacheId(workbookXml);

  zip.file('xl/pivotCache/pivotCacheDefinition1.xml', buildPivotCacheDefinitionXml(config, extent, model));
  zip.file('xl/pivotCache/pivotCacheRecords1.xml', buildPivotCacheRecordsXml(model));
  zip.file('xl/pivotTables/pivotTable1.xml', buildPivotTableXml(extent, model, rowFieldIdxs, valueFieldIdxs, cacheId));
  zip.file('xl/pivotTables/_rels/pivotTable1.xml.rels', buildRelsPart('rId1', REL_CACHE_DEF, '../pivotCache/pivotCacheDefinition1.xml'));
  zip.file('xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels', buildRelsPart('rId1', REL_CACHE_REC, 'pivotCacheRecords1.xml'));

  // 5. Patch [Content_Types].xml, workbook.xml, workbook rels, host-sheet rels.
  const contentTypesXml = await readZipText(zip, '[Content_Types].xml');
  zip.file('[Content_Types].xml', patchContentTypes(contentTypesXml));

  const workbookRelId = nextRelId(workbookRelsXml);
  zip.file('xl/_rels/workbook.xml.rels', appendRelationship(workbookRelsXml, workbookRelId, REL_CACHE_DEF, 'pivotCache/pivotCacheDefinition1.xml'));
  zip.file('xl/workbook.xml', patchWorkbookXml(workbookXml, cacheId, workbookRelId));

  const hostRelsPath = sheetRelsPath(hostPath);
  const hostRelsFile = zip.file(hostRelsPath);
  if (hostRelsFile) {
    const hostRelsXml = await hostRelsFile.async('string');
    zip.file(hostRelsPath, appendRelationship(hostRelsXml, nextRelId(hostRelsXml), REL_PIVOT_TABLE, '../pivotTables/pivotTable1.xml'));
  } else {
    zip.file(hostRelsPath, buildRelsPart('rId1', REL_PIVOT_TABLE, '../pivotTables/pivotTable1.xml'));
  }

  // 6. Regenerate the package. Never returns partial output — any earlier
  //    failure has already thrown before this point.
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
