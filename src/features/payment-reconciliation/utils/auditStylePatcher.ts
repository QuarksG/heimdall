import JSZip from 'jszip';

/**
 * auditStylePatcher — post-processes a serialized `.xlsx` zip to apply the
 * cashier-audit visual styling to the PIVOT HOST sheet ('Pivot Fatura Türü')
 * via OOXML surgery (JSZip), following the pivotInjector / gridlinePatcher
 * zip-surgery pattern.
 *
 * Why zip surgery: SheetJS CE cannot serialize cell styles (fills, fonts,
 * borders, alignment), so the exporter patches the package AFTER
 * serialization — it registers the needed fonts/fills/borders/cellXfs in
 * `xl/styles.xml` and stamps the style indices (`s=` attributes) onto the
 * target cells of the host worksheet part.
 *
 * The RENDERER stays render-only: `CashierAuditSheet.build` records the
 * styling target coordinates (title/header/total/highlight rows, table
 * extents) as it writes rows and hands them to this patcher through the
 * exporter — the patcher never re-derives layout from cell text, so it
 * survives multi-currency files where the table blocks repeat.
 *
 * Number formats are NOT touched here: the renderer sets them via `cell.z`
 * (which SheetJS CE serializes) and this patcher PRESERVES each cell's
 * existing numFmtId when it swaps the cell's xf.
 *
 * Framework-free: no React, no SheetJS. Runs 100% in the browser (and in
 * Node 20+ where `Blob` is available globally).
 */

// ---------------------------------------------------------------------------
// Public contracts
// ---------------------------------------------------------------------------

/**
 * Styling targets of ONE Layer 1 (type-level aggregation) table.
 * All rows/columns are 0-based sheet coordinates recorded by the renderer.
 */
export interface Layer1StyleTarget {
  /** 'KASİYER MODELİ — Layer 1: …' title row → bold italic. */
  titleRow: number;
  /** Header row → black fill, white bold, centered. */
  headerRow: number;
  /** All data rows (between header and grand total), in order. */
  dataRows: number[];
  /** The 'Toptan Satis Faturasi' sales row → light gray fill + bold. */
  salesRow?: number;
  /** Provision rows → light gray fill. */
  provisionRows: number[];
  /** 'Kumile Tutar / Grand Total' row → light gray fill, bold, thick top. */
  totalRow: number;
  /** First column of the table region (inclusive). */
  startCol: number;
  /** Last column of the table region (inclusive). */
  endCol: number;
  /** Absolute column indices of the amount cells → right-aligned. */
  amountCols: number[];
}

/**
 * Styling targets of ONE Layer 2 (balance check) table.
 * All rows/columns are 0-based sheet coordinates recorded by the renderer.
 */
export interface Layer2StyleTarget {
  /** 'Layer 2: Balance Check (Bakiye Kontrolü)' title row → bold. */
  titleRow: number;
  /** Header row (Türkçe | English | Net Impact) → black fill, white bold. */
  headerRow: number;
  /** Rendered component rows (zero-cashNet rows already filtered out). */
  componentRows: number[];
  /** Computed_Havale subtotal row → light gray fill, bold. */
  subtotalRow: number;
  /** 'Actual Giden HAVALE' row → BLACK fill, WHITE bold. */
  actualRow: number;
  /** 'Fark / Difference' row — bottom of the table region. */
  differenceRow: number;
  /** First column of the table region (inclusive). */
  startCol: number;
  /** Last column of the table region (inclusive). */
  endCol: number;
  /** Absolute column index of the Net Impact cells → right-aligned. */
  amountCol: number;
}

/** All styling targets of the pivot host sheet, recorded by the renderer. */
export interface AuditStyleTargets {
  layer1: Layer1StyleTarget[];
  layer2: Layer2StyleTarget[];
}

/** Error thrown on any audit-style patch failure. Bilingual per codebase convention. */
export class AuditStylePatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditStylePatchError';
  }
}

/**
 * Applies the cashier-audit styling to the named sheet of a serialized
 * workbook: registers fills/fonts/borders in xl/styles.xml and sets the
 * style indices on the target cells of that sheet's worksheet part.
 *
 * Never returns partial output: on any failure it throws AuditStylePatchError.
 */
export async function applyAuditStyles(
  workbookBlob: Blob,
  sheetName: string,
  targets: AuditStyleTargets,
): Promise<Blob> {
  try {
    return await doPatch(workbookBlob, sheetName, buildSpecGrid(targets));
  } catch (err) {
    if (err instanceof AuditStylePatchError) throw err;
    const cause = err instanceof Error ? err.message : String(err);
    fail(cause);
  }
}

/**
 * Generic variant: applies EXPLICIT per-cell style specs to the named
 * sheet — same styles.xml registry and worksheet surgery as
 * `applyAuditStyles`, but the caller enumerates the cells directly
 * (used by the Disclaimer sheet's bilingual layout styling).
 *
 * Never returns partial output: on any failure it throws AuditStylePatchError.
 */
export async function applyCellStyles(
  workbookBlob: Blob,
  sheetName: string,
  cells: readonly StyledCell[],
): Promise<Blob> {
  const grid: SpecGrid = new Map();
  for (const cell of cells) setSpec(grid, cell.row, cell.col, cell.spec);
  try {
    return await doPatch(workbookBlob, sheetName, grid);
  } catch (err) {
    if (err instanceof AuditStylePatchError) throw err;
    const cause = err instanceof Error ? err.message : String(err);
    fail(cause);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers — XML primitives (gridlinePatcher pattern)
// ---------------------------------------------------------------------------

function fail(cause: string): never {
  throw new AuditStylePatchError(
    `Denetim stili yaması başarısız / Audit style patch failed: ${cause}`,
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

/** Converts a 0-based column index to an Excel column letter (0 -> 'A'). */
function colLetter(index: number): string {
  let remaining = index + 1;
  let letters = '';
  while (remaining > 0) {
    const remainder = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return letters;
}

/** Converts an Excel column letter to a 0-based index ('A' -> 0). */
function colIndex(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n - 1;
}

/**
 * Resolves sheet name -> part path (e.g. 'xl/worksheets/sheet4.xml') from
 * xl/workbook.xml and xl/_rels/workbook.xml.rels — same resolution the
 * pivot injector and gridline patcher perform.
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

// ---------------------------------------------------------------------------
// Internal model — the per-cell style specification
// ---------------------------------------------------------------------------

export type FontKey = 'default' | 'bold' | 'boldItalic' | 'whiteBold';
export type FillKey = 'none' | 'black' | 'gray' | 'purple' | 'darkBlue';
export type EdgeStyle = 'thin' | 'thick';

export interface BorderSpec {
  top?: EdgeStyle;
  bottom?: EdgeStyle;
  left?: EdgeStyle;
  right?: EdgeStyle;
}

export interface CellStyleSpec {
  font: FontKey;
  fill: FillKey;
  align?: 'center' | 'right';
  /** Wrapped, top-aligned text (long bilingual paragraphs). */
  wrap?: boolean;
  border?: BorderSpec;
}

/** One explicitly-styled cell (0-based coordinates) for `applyCellStyles`. */
export interface StyledCell {
  row: number;
  col: number;
  spec: CellStyleSpec;
}

/** Sparse cell-spec grid keyed by [0-based row] -> [0-based col] -> spec. */
type SpecGrid = Map<number, Map<number, CellStyleSpec>>;

function setSpec(grid: SpecGrid, row: number, col: number, spec: CellStyleSpec): void {
  let rowMap = grid.get(row);
  if (!rowMap) {
    rowMap = new Map<number, CellStyleSpec>();
    grid.set(row, rowMap);
  }
  rowMap.set(col, spec);
}

/**
 * Border edges of one cell inside a table region with a THICK outer border
 * and thin inner borders. `thickTop` forces a thick top edge (grand-total
 * emphasis) even when the row is interior.
 */
function regionBorder(
  row: number,
  col: number,
  top: number,
  bottom: number,
  left: number,
  right: number,
  thickTop = false,
): BorderSpec {
  return {
    top: row === top || thickTop ? 'thick' : 'thin',
    bottom: row === bottom ? 'thick' : 'thin',
    left: col === left ? 'thick' : 'thin',
    right: col === right ? 'thick' : 'thin',
  };
}

/** Expands one Layer 1 target into per-cell style specs. */
function expandLayer1(target: Layer1StyleTarget, grid: SpecGrid): void {
  const { headerRow, totalRow, startCol, endCol } = target;
  const amountCols = new Set(target.amountCols);
  const grayRows = new Set(target.provisionRows);
  const boldRows = new Set<number>();
  if (target.salesRow !== undefined) {
    grayRows.add(target.salesRow);
    boldRows.add(target.salesRow);
  }

  // Title row: bold italic on the title cell only.
  setSpec(grid, target.titleRow, startCol, { font: 'boldItalic', fill: 'none' });

  const regionRows = [headerRow, ...target.dataRows, totalRow];
  for (const row of regionRows) {
    for (let col = startCol; col <= endCol; col++) {
      const border = regionBorder(
        row, col, headerRow, totalRow, startCol, endCol,
        row === totalRow, // grand-total row: thick top border
      );

      if (row === headerRow) {
        setSpec(grid, row, col, { font: 'whiteBold', fill: 'black', align: 'center', border });
        continue;
      }

      const isTotal = row === totalRow;
      const spec: CellStyleSpec = {
        font: isTotal || boldRows.has(row) ? 'bold' : 'default',
        fill: isTotal || grayRows.has(row) ? 'gray' : 'none',
        border,
      };
      if (amountCols.has(col)) spec.align = 'right';
      setSpec(grid, row, col, spec);
    }
  }
}

/** Expands one Layer 2 target into per-cell style specs. */
function expandLayer2(target: Layer2StyleTarget, grid: SpecGrid): void {
  const { headerRow, differenceRow, startCol, endCol, amountCol } = target;

  // Title row: bold on the title cell only.
  setSpec(grid, target.titleRow, startCol, { font: 'bold', fill: 'none' });

  const regionRows = [
    headerRow,
    ...target.componentRows,
    target.subtotalRow,
    target.actualRow,
    differenceRow,
  ];
  for (const row of regionRows) {
    for (let col = startCol; col <= endCol; col++) {
      const border = regionBorder(row, col, headerRow, differenceRow, startCol, endCol);

      let spec: CellStyleSpec;
      if (row === headerRow || row === target.actualRow) {
        // Header and 'Actual Giden HAVALE': black fill, white bold text.
        spec = { font: 'whiteBold', fill: 'black', border };
      } else if (row === target.subtotalRow) {
        spec = { font: 'bold', fill: 'gray', border };
      } else {
        spec = { font: 'default', fill: 'none', border };
      }
      if (col === amountCol && row !== headerRow) spec.align = 'right';
      setSpec(grid, row, col, spec);
    }
  }
}

/** Expands all targets into the sparse per-cell spec grid. */
function buildSpecGrid(targets: AuditStyleTargets): SpecGrid {
  const grid: SpecGrid = new Map();
  for (const t of targets.layer1) expandLayer1(t, grid);
  for (const t of targets.layer2) expandLayer2(t, grid);
  return grid;
}

// ---------------------------------------------------------------------------
// Internal model — the styles.xml registry
// ---------------------------------------------------------------------------

/**
 * Incremental registry over an existing SheetJS-generated xl/styles.xml:
 * memoizes the fonts, fills, borders and cellXfs this patch needs, appends
 * them to the existing sections (existing entries untouched, so every
 * unpatched cell keeps its style), and exposes the numFmtId of each
 * PRE-EXISTING cellXf so patched cells keep their number formats.
 */
class StyleRegistry {
  /** numFmtId of each pre-existing cellXf, by xf index. */
  public readonly xfNumFmtIds: number[];

  private readonly baseFontCount: number;
  private readonly baseFillCount: number;
  private readonly baseBorderCount: number;
  private readonly baseXfCount: number;

  private readonly newFonts: string[] = [];
  private readonly newFills: string[] = [];
  private readonly newBorders: string[] = [];
  private readonly newXfs: string[] = [];

  private readonly fontMemo = new Map<string, number>();
  private readonly fillMemo = new Map<string, number>();
  private readonly borderMemo = new Map<string, number>();
  private readonly xfMemo = new Map<string, number>();

  /** First font's body (bold/italic markers stripped) — reused so the new fonts match the workbook's face/size. */
  private readonly baseFontBody: string;

  private readonly stylesXml: string;

  constructor(stylesXml: string) {
    this.stylesXml = stylesXml;
    this.baseFontCount = this.countIn('fonts', /<font[\s>/]/g);
    this.baseFillCount = this.countIn('fills', /<fill[\s>/]/g);
    this.baseBorderCount = this.countIn('borders', /<border[\s>/]/g);

    const xfsInner = this.sectionInner('cellXfs');
    const xfRe = /<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g;
    const numFmtIds: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = xfRe.exec(xfsInner)) !== null) {
      numFmtIds.push(parseInt(getAttr(m[0], 'numFmtId') ?? '0', 10) || 0);
    }
    this.xfNumFmtIds = numFmtIds;
    this.baseXfCount = numFmtIds.length;

    const fontsInner = this.sectionInner('fonts');
    const firstFont = fontsInner.match(/<font\b[^>]*>([\s\S]*?)<\/font>/);
    const body = firstFont ? firstFont[1] : '<sz val="11"/><color theme="1"/><name val="Calibri"/>';
    this.baseFontBody = body.replace(/<b\/>|<b\s[^>]*\/>|<i\/>|<i\s[^>]*\/>/g, '');
  }

  /** Resolves a font key to a font index, registering the font on first use. */
  public fontId(key: FontKey): number {
    if (key === 'default') return 0;
    const memoized = this.fontMemo.get(key);
    if (memoized !== undefined) return memoized;

    let xml: string;
    if (key === 'bold') {
      xml = `<font><b/>${this.baseFontBody}</font>`;
    } else if (key === 'boldItalic') {
      xml = `<font><b/><i/>${this.baseFontBody}</font>`;
    } else {
      // whiteBold: replace the base color with white.
      const noColor = this.baseFontBody.replace(/<color\b[^>]*\/>/g, '');
      xml = `<font><b/><color rgb="FFFFFFFF"/>${noColor}</font>`;
    }
    const id = this.baseFontCount + this.newFonts.length;
    this.newFonts.push(xml);
    this.fontMemo.set(key, id);
    return id;
  }

  /** Resolves a fill key to a fill index, registering the fill on first use. */
  public fillId(key: FillKey): number {
    if (key === 'none') return 0;
    const memoized = this.fillMemo.get(key);
    if (memoized !== undefined) return memoized;

    const FILL_RGB: Record<Exclude<FillKey, 'none'>, string> = {
      black: 'FF000000',
      gray: 'FFD9D9D9',
      purple: 'FF7030A0',
      darkBlue: 'FF17375D', // 'Dark Blue, Text 2, Darker 25%'
    };
    const rgb = FILL_RGB[key];
    const xml =
      `<fill><patternFill patternType="solid">` +
      `<fgColor rgb="${rgb}"/><bgColor indexed="64"/>` +
      `</patternFill></fill>`;
    const id = this.baseFillCount + this.newFills.length;
    this.newFills.push(xml);
    this.fillMemo.set(key, id);
    return id;
  }

  /** Resolves a border spec to a border index, registering it on first use. */
  public borderId(border: BorderSpec | undefined): number {
    if (!border) return 0;
    const key = `${border.left ?? ''}|${border.right ?? ''}|${border.top ?? ''}|${border.bottom ?? ''}`;
    const memoized = this.borderMemo.get(key);
    if (memoized !== undefined) return memoized;

    const side = (name: string, style?: EdgeStyle): string =>
      style ? `<${name} style="${style}"><color indexed="64"/></${name}>` : `<${name}/>`;
    const xml =
      `<border>${side('left', border.left)}${side('right', border.right)}` +
      `${side('top', border.top)}${side('bottom', border.bottom)}<diagonal/></border>`;
    const id = this.baseBorderCount + this.newBorders.length;
    this.newBorders.push(xml);
    this.borderMemo.set(key, id);
    return id;
  }

  /**
   * Resolves a cell spec (plus the cell's PRESERVED numFmtId) to a cellXf
   * index, registering the xf — and any fonts/fills/borders it needs — on
   * first use.
   */
  public xfId(spec: CellStyleSpec, numFmtId: number): number {
    const key =
      `${numFmtId}|${spec.font}|${spec.fill}|${spec.align ?? ''}|${spec.wrap ? 'w' : ''}|` +
      `${spec.border ? `${spec.border.left ?? ''},${spec.border.right ?? ''},${spec.border.top ?? ''},${spec.border.bottom ?? ''}` : ''}`;
    const memoized = this.xfMemo.get(key);
    if (memoized !== undefined) return memoized;

    const fontId = this.fontId(spec.font);
    const fillId = this.fillId(spec.fill);
    const borderId = this.borderId(spec.border);

    const attrs = [
      `numFmtId="${numFmtId}"`,
      `fontId="${fontId}"`,
      `fillId="${fillId}"`,
      `borderId="${borderId}"`,
      `xfId="0"`,
    ];
    if (numFmtId !== 0) attrs.push('applyNumberFormat="1"');
    if (fontId !== 0) attrs.push('applyFont="1"');
    if (fillId !== 0) attrs.push('applyFill="1"');
    if (borderId !== 0) attrs.push('applyBorder="1"');

    const alignParts = [
      spec.align ? `horizontal="${spec.align}"` : '',
      spec.wrap ? 'vertical="top" wrapText="1"' : '',
    ].filter(Boolean);
    const xml = alignParts.length > 0
      ? `<xf ${attrs.join(' ')} applyAlignment="1"><alignment ${alignParts.join(' ')}/></xf>`
      : `<xf ${attrs.join(' ')}/>`;
    const id = this.baseXfCount + this.newXfs.length;
    this.newXfs.push(xml);
    this.xfMemo.set(key, id);
    return id;
  }

  /** Renders the patched styles.xml with all registered entries appended. */
  public render(): string {
    let xml = this.stylesXml;
    xml = appendToSection(xml, 'fonts', this.newFonts, this.baseFontCount);
    xml = appendToSection(xml, 'fills', this.newFills, this.baseFillCount);
    xml = appendToSection(xml, 'borders', this.newBorders, this.baseBorderCount);
    xml = appendToSection(xml, 'cellXfs', this.newXfs, this.baseXfCount);
    return xml;
  }

  private sectionInner(tag: string): string {
    const m = this.stylesXml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`));
    if (!m) fail(`xl/styles.xml has no <${tag}> section to extend`);
    return m[1];
  }

  private countIn(tag: string, elementRe: RegExp): number {
    const matches = this.sectionInner(tag).match(elementRe);
    return matches ? matches.length : 0;
  }
}

/** Appends entries to a styles.xml section, updating its count attribute. */
function appendToSection(
  xml: string,
  tag: string,
  entries: string[],
  baseCount: number,
): string {
  if (entries.length === 0) return xml;
  const openRe = new RegExp(`<${tag}\\b([^>]*)>`);
  const openMatch = xml.match(openRe);
  if (!openMatch) fail(`xl/styles.xml has no <${tag}> section to extend`);

  const newCount = baseCount + entries.length;
  const attrs = /(?:^|\s)count="[^"]*"/.test(openMatch[1])
    ? openMatch[1].replace(/((?:^|\s)count=")[^"]*(")/, `$1${newCount}$2`)
    : `${openMatch[1]} count="${newCount}"`;
  const patched = xml.replace(openRe, `<${tag}${attrs}>`);

  const closeTag = `</${tag}>`;
  const closeAt = patched.indexOf(closeTag);
  if (closeAt < 0) fail(`xl/styles.xml is malformed (missing ${closeTag})`);
  return patched.slice(0, closeAt) + entries.join('') + patched.slice(closeAt);
}

// ---------------------------------------------------------------------------
// Internal — worksheet cell patching
// ---------------------------------------------------------------------------

/** Inserts a cell XML fragment into a row's inner XML, keeping column order. */
function insertCellInOrder(inner: string, col: number, cellXml: string): string {
  const cellRe = /<c\b[^>]*?\sr="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(inner)) !== null) {
    if (colIndex(m[1]) > col) {
      return inner.slice(0, m.index) + cellXml + inner.slice(m.index);
    }
  }
  return inner + cellXml;
}

/**
 * Stamps the resolved style indices onto the target cells of one worksheet
 * part. Existing cells get their `s=` attribute replaced (their current
 * numFmtId is PRESERVED into the new xf); target cells the renderer never
 * wrote (blank cells inside a bordered region) are created as value-less
 * styled cells so fills and borders still paint.
 */
function patchSheetCells(
  sheetXml: string,
  specs: SpecGrid,
  registry: StyleRegistry,
): string {
  // Copy so consumed entries can be tracked and validated.
  const pending: SpecGrid = new Map(
    [...specs].map(([row, cols]) => [row, new Map(cols)]),
  );

  const patched = sheetXml.replace(
    /<row\b([^>]*)>([\s\S]*?)<\/row>/g,
    (whole, rowAttrs: string, inner: string) => {
      const rStr = getAttr(`<row ${rowAttrs}>`, 'r');
      if (!rStr) return whole;
      const rowIdx = parseInt(rStr, 10) - 1;
      const rowSpecs = pending.get(rowIdx);
      if (!rowSpecs) return whole;

      // 1. Restyle the cells that exist.
      let newInner = inner.replace(
        /<c\b([^>]*?)(\/>|>)/g,
        (cellWhole, cellAttrs: string, cellEnd: string) => {
          const ref = getAttr(`<c ${cellAttrs}>`, 'r');
          const refMatch = ref?.match(/^([A-Z]+)(\d+)$/);
          if (!refMatch) return cellWhole;
          const col = colIndex(refMatch[1]);
          const spec = rowSpecs.get(col);
          if (!spec) return cellWhole;
          rowSpecs.delete(col);

          const oldS = parseInt(getAttr(`<c ${cellAttrs}>`, 's') ?? '0', 10) || 0;
          const numFmtId = registry.xfNumFmtIds[oldS] ?? 0;
          const styleIdx = registry.xfId(spec, numFmtId);

          const newAttrs = /(?:^|\s)s="[^"]*"/.test(cellAttrs)
            ? cellAttrs.replace(/((?:^|\s)s=")[^"]*(")/, `$1${styleIdx}$2`)
            : `${cellAttrs} s="${styleIdx}"`;
          return `<c${newAttrs}${cellEnd}`;
        },
      );

      // 2. Create the target cells the renderer never wrote.
      if (rowSpecs.size > 0) {
        const inserts = [...rowSpecs.entries()].sort((a, b) => a[0] - b[0]);
        for (const [col, spec] of inserts) {
          const styleIdx = registry.xfId(spec, 0);
          const cellXml = `<c r="${colLetter(col)}${rowIdx + 1}" s="${styleIdx}"/>`;
          newInner = insertCellInOrder(newInner, col, cellXml);
        }
        rowSpecs.clear();
      }

      pending.delete(rowIdx);
      return `<row${rowAttrs}>${newInner}</row>`;
    },
  );

  if (pending.size > 0) {
    const missing = [...pending.keys()].map(r => r + 1).join(', ');
    fail(`target rows ${missing} were not found on the sheet — the renderer metadata and the serialized sheet disagree`);
  }
  return patched;
}

// ---------------------------------------------------------------------------
// Main patch flow
// ---------------------------------------------------------------------------

async function readZipText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) fail(`required package part '${path}' is missing`);
  return file.async('string');
}

async function doPatch(
  workbookBlob: Blob,
  sheetName: string,
  specs: SpecGrid,
): Promise<Blob> {
  if (specs.size === 0) {
    // Nothing to style — return the package unchanged.
    return workbookBlob;
  }

  let zip: JSZip;
  try {
    // ArrayBuffer, not Blob: JSZip's Blob support detection is
    // browser-window-based (same workaround as gridlinePatcher).
    zip = await JSZip.loadAsync(await workbookBlob.arrayBuffer());
  } catch (err) {
    fail(`the workbook bytes are not a readable zip package (${err instanceof Error ? err.message : String(err)})`);
  }

  // 1. Resolve the target sheet's worksheet part path by sheet name.
  const workbookXml = await readZipText(zip, 'xl/workbook.xml');
  const workbookRelsXml = await readZipText(zip, 'xl/_rels/workbook.xml.rels');
  const sheetPath = resolveSheetPaths(workbookXml, workbookRelsXml).get(sheetName);
  if (!sheetPath) fail(`sheet '${sheetName}' was not found in the workbook`);

  // 2. Register the needed styles and stamp the cell style indices.
  //    The cell pass drives registration (each cell's numFmtId is read
  //    from its pre-patch xf and preserved), so it runs BEFORE render().
  const stylesXml = await readZipText(zip, 'xl/styles.xml');
  const registry = new StyleRegistry(stylesXml);
  const sheetXml = await readZipText(zip, sheetPath);
  const patchedSheetXml = patchSheetCells(sheetXml, specs, registry);

  zip.file(sheetPath, patchedSheetXml);
  zip.file('xl/styles.xml', registry.render());

  // 3. Regenerate the package. Never returns partial output — any earlier
  //    failure has already thrown before this point.
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
