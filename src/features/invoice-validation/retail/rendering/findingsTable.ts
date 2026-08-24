/**
 * Findings table renderer — turns structured validation findings into
 * auditable, Excel-like HTML tables for the chat UI.
 *
 * Validator-agnostic by design: it only needs findings shaped like
 * { code, severity, scope, lineId?, taxCode?, itemRef?, evidence } plus a
 * catalog describing per-code presentation (title, explanation, fix,
 * evidence columns). The retail tax validator is the first consumer;
 * address/PO/ASIN validators can adopt it without changes here.
 *
 * Summarization: with more findings than `maxTotalRows` (default 40),
 * each code group renders up to `exampleRowsWhenOverBudget` (default 5)
 * example rows plus a rollup row with the remaining count and total diff.
 *
 * Styling lives in src/styles/components/chat.css (.hd-findings-*).
 * Output is static HTML with all dynamic values escaped; the caller
 * additionally sanitizes via DOMPurify before rendering.
 */

export type FindingSeverity = 'error' | 'warning';
export type FindingScope = 'line' | 'document';

export type FindingEvidenceField = { raw: string | null; parsed: number | null };

export type Finding = {
  code: string;
  severity: FindingSeverity;
  scope: FindingScope;
  lineId?: string;
  taxCode?: string;
  itemRef?: { label: string; source: string };
  evidence: {
    fields: Record<string, FindingEvidenceField>;
    formula?: string;
    expected?: number;
    actual?: number;
    diff?: number;
  };
};

export type FindingsColumn = {
  kind: 'field' | 'computed';
  key: string;
  header: string;
};

export type FindingsCatalogEntry = {
  code: string;
  title: string;
  explanation: string;
  fix: string;
  columns: FindingsColumn[];
};

export type FindingsRenderOptions = {
  /** Global row budget across all tables before summarization kicks in. */
  maxTotalRows?: number;
  /** Example rows per code group once over budget. */
  exampleRowsWhenOverBudget?: number;
};

export const DEFAULT_MAX_TOTAL_ROWS = 40;
export const DEFAULT_EXAMPLE_ROWS = 5;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const fmtNum = (n: number | null | undefined): string => (n == null ? '—' : n.toFixed(2));

/** Turkish labels for ItemRef sources — tells the reader WHERE the reference came from. */
const ITEM_SOURCE_LABELS: Record<string, string> = {
  name: 'Ürün Adı',
  description: 'Açıklama',
  asin: 'ASIN',
  sellerId: 'Satıcı Kodu',
  manufacturerId: 'Üretici Kodu',
  lineNo: 'Satır No',
};

const severityChip = (severity: FindingSeverity): string =>
  severity === 'error'
    ? '<span class="hd-chip hd-chip-error">HATA</span>'
    : '<span class="hd-chip hd-chip-warning">UYARI</span>';

const itemRefCell = (finding: Finding): string => {
  if (!finding.itemRef) return '—';
  const source = ITEM_SOURCE_LABELS[finding.itemRef.source] ?? finding.itemRef.source;
  return `${escapeHtml(finding.itemRef.label)} <span class="hd-item-source">(${escapeHtml(source)})</span>`;
};

const fieldCell = (finding: Finding, key: string): string => {
  const field = finding.evidence.fields[key];
  if (!field) return '—';
  if (field.raw != null && field.raw !== '') return escapeHtml(field.raw);
  return fmtNum(field.parsed);
};

const computedCell = (finding: Finding, key: string): string => {
  const value =
    key === 'expected' ? finding.evidence.expected : key === 'actual' ? finding.evidence.actual : finding.evidence.diff;
  return fmtNum(value);
};

const renderRow = (finding: Finding, entry: FindingsCatalogEntry, isLineScope: boolean): string => {
  const cells: string[] = [];

  if (isLineScope) {
    cells.push(`<td>${escapeHtml(finding.lineId ?? '—')}</td>`);
    cells.push(`<td>${itemRefCell(finding)}</td>`);
  } else {
    cells.push(`<td>${escapeHtml(finding.taxCode ?? '—')}</td>`);
  }

  for (const col of entry.columns) {
    const value = col.kind === 'field' ? fieldCell(finding, col.key) : computedCell(finding, col.key);
    const cls = col.kind === 'computed' && col.key === 'diff' ? ' class="hd-diff-cell"' : '';
    cells.push(`<td${cls}>${value}</td>`);
  }

  return `<tr>${cells.join('')}</tr>`;
};

const renderRollupRow = (hidden: Finding[], columnCount: number): string => {
  const diffs = hidden.map((f) => f.evidence.diff).filter((d): d is number => d != null);
  const diffNote = diffs.length > 0 ? ` (toplam fark: ${diffs.reduce((s, d) => s + d, 0).toFixed(2)} TL)` : '';
  return `<tr class="hd-rollup-row"><td colspan="${columnCount}">… ve ${hidden.length} kayıt daha${diffNote}</td></tr>`;
};

const renderGroup = (
  findings: Finding[],
  entry: FindingsCatalogEntry,
  rowLimit: number
): string => {
  const severity: FindingSeverity = findings.some((f) => f.severity === 'error') ? 'error' : 'warning';
  const isLineScope = findings[0].scope === 'line';

  const headers: string[] = isLineScope ? ['Satır', 'Ürün'] : ['Vergi Grubu'];
  for (const col of entry.columns) headers.push(col.header);

  const visible = findings.slice(0, rowLimit);
  const hidden = findings.slice(rowLimit);

  const formula = findings.find((f) => f.evidence.formula)?.evidence.formula;

  return [
    `<div class="hd-card hd-findings-section hd-findings-${severity}">`,
    `<div class="hd-card-header">`,
    `<span class="hd-findings-title">${severity === 'error' ? '❌' : '⚠️'} <strong>${escapeHtml(entry.title)}</strong></span>`,
    `<span class="hd-card-header-meta">${severityChip(severity)} <span class="hd-findings-count">${findings.length} kayıt</span></span>`,
    `</div>`,
    `<div class="hd-card-body">`,
    `<p class="hd-findings-explanation">${escapeHtml(entry.explanation)}</p>`,
    formula ? `<p class="hd-findings-formula">Hesap: <code>${escapeHtml(formula)}</code></p>` : '',
    `<table class="hd-findings-table">`,
    `<thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>`,
    `<tbody>`,
    ...visible.map((f) => renderRow(f, entry, isLineScope)),
    hidden.length > 0 ? renderRollupRow(hidden, headers.length) : '',
    `</tbody>`,
    `</table>`,
    `<p class="hd-findings-fix"><strong>Çözüm:</strong> ${escapeHtml(entry.fix)}</p>`,
    `</div>`,
    `</div>`,
  ]
    .filter(Boolean)
    .join('');
};

/**
 * Render all findings as per-code sections with evidence tables.
 * Groups are ordered errors-first, then by descending finding count.
 */
export const renderFindingsTables = (
  findings: Finding[],
  catalog: Record<string, FindingsCatalogEntry>,
  options: FindingsRenderOptions = {}
): string => {
  const maxTotalRows = options.maxTotalRows ?? DEFAULT_MAX_TOTAL_ROWS;
  const exampleRows = options.exampleRowsWhenOverBudget ?? DEFAULT_EXAMPLE_ROWS;

  if (findings.length === 0) return '';

  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const list = groups.get(finding.code);
    if (list) list.push(finding);
    else groups.set(finding.code, [finding]);
  }

  const ordered = [...groups.entries()].sort(([codeA, a], [codeB, b]) => {
    const errA = a.some((f) => f.severity === 'error') ? 0 : 1;
    const errB = b.some((f) => f.severity === 'error') ? 0 : 1;
    if (errA !== errB) return errA - errB;
    if (a.length !== b.length) return b.length - a.length;
    return codeA.localeCompare(codeB);
  });

  const overBudget = findings.length > maxTotalRows;
  const rowLimit = overBudget ? exampleRows : Number.POSITIVE_INFINITY;

  const sections: string[] = [];
  for (const [code, group] of ordered) {
    const entry = catalog[code];
    if (!entry) continue; // unknown code: skip rather than crash the chat UI
    sections.push(renderGroup(group, entry, rowLimit));
  }

  return sections.join('');
};
