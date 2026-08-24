import { describe, it, expect } from 'vitest';
import {
  renderFindingsTables,
  DEFAULT_MAX_TOTAL_ROWS,
  type Finding,
  type FindingsCatalogEntry,
} from './findingsTable';

const CATALOG: Record<string, FindingsCatalogEntry> = {
  TAX_CALC_DEVIATION: {
    code: 'TAX_CALC_DEVIATION',
    title: 'Satır Vergi Tutarı Hesaplamayla Uyuşmuyor',
    explanation: 'Matrah × oran hesabı beyan edilen tutarla uyuşmuyor.',
    fix: 'TaxAmount değerini düzeltin.',
    columns: [
      { kind: 'field', key: 'taxableAmount', header: 'TaxableAmount' },
      { kind: 'field', key: 'percent', header: 'Oran (%)' },
      { kind: 'computed', key: 'expected', header: 'Beklenen (TL)' },
      { kind: 'computed', key: 'actual', header: 'Beyan Edilen (TL)' },
      { kind: 'computed', key: 'diff', header: 'Fark (TL)' },
    ],
  },
  PAYABLE_TOTAL_MISMATCH: {
    code: 'PAYABLE_TOTAL_MISMATCH',
    title: 'PayableAmount Uyuşmuyor',
    explanation: 'PayableAmount hesaplanan toplama eşit değil.',
    fix: 'PayableAmount değerini düzeltin.',
    columns: [
      { kind: 'field', key: 'payableAmount', header: 'PayableAmount' },
      { kind: 'computed', key: 'diff', header: 'Fark (TL)' },
    ],
  },
};

const lineFinding = (lineId: string, diff = 0.5, severity: 'error' | 'warning' = 'error'): Finding => ({
  code: 'TAX_CALC_DEVIATION',
  severity,
  scope: 'line',
  lineId,
  itemRef: { label: `ÜRÜN ${lineId}`, source: 'name' },
  evidence: {
    fields: {
      taxableAmount: { raw: '100.00', parsed: 100 },
      percent: { raw: '20', parsed: 20 },
    },
    formula: 'TaxableAmount × Percent ÷ 100',
    expected: 20,
    actual: 20 + diff,
    diff,
  },
});

const docFinding = (): Finding => ({
  code: 'PAYABLE_TOTAL_MISMATCH',
  severity: 'warning',
  scope: 'document',
  taxCode: 'KDV-TR-20.00%',
  evidence: {
    fields: { payableAmount: { raw: '600.15', parsed: 600.15 } },
    expected: 600,
    actual: 600.15,
    diff: 0.15,
  },
});

const parse = (html: string): HTMLElement => {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
};

describe('renderFindingsTables: structure', () => {
  it('renders one section per code with headers, evidence cells and fix text', () => {
    const html = renderFindingsTables([lineFinding('1'), lineFinding('2'), docFinding()], CATALOG);
    const dom = parse(html);

    const sections = dom.querySelectorAll('.hd-findings-section');
    expect(sections).toHaveLength(2);

    // Errors come before warnings.
    expect(sections[0].className).toContain('hd-findings-error');
    expect(sections[1].className).toContain('hd-findings-warning');

    const lineTable = sections[0].querySelector('table.hd-findings-table')!;
    const headers = [...lineTable.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(headers).toEqual(['Satır', 'Ürün', 'TaxableAmount', 'Oran (%)', 'Beklenen (TL)', 'Beyan Edilen (TL)', 'Fark (TL)']);

    const firstRowCells = [...lineTable.querySelectorAll('tbody tr')[0].querySelectorAll('td')].map((td) => td.textContent);
    expect(firstRowCells).toEqual(['1', 'ÜRÜN 1 (Ürün Adı)', '100.00', '20', '20.00', '20.50', '0.50']);

    // Document-scope table uses the tax group column instead of Satır/Ürün.
    const docHeaders = [...sections[1].querySelectorAll('thead th')].map((th) => th.textContent);
    expect(docHeaders).toEqual(['Vergi Grubu', 'PayableAmount', 'Fark (TL)']);

    expect(sections[0].querySelector('.hd-findings-formula')!.textContent).toContain('TaxableAmount × Percent ÷ 100');
    expect(sections[0].querySelector('.hd-findings-fix')!.textContent).toContain('TaxAmount değerini düzeltin.');
    expect(sections[0].querySelector('.hd-chip-error')!.textContent).toBe('HATA');
  });

  it('escapes HTML in dynamic values', () => {
    const nasty = lineFinding('1');
    nasty.itemRef = { label: '<script>alert(1)</script>', source: 'name' };
    nasty.evidence.fields.taxableAmount = { raw: '<b>100</b>', parsed: 100 };

    const html = renderFindingsTables([nasty], CATALOG);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;100&lt;/b&gt;');
  });

  it('returns empty string for no findings and skips unknown codes', () => {
    expect(renderFindingsTables([], CATALOG)).toBe('');
    const unknown: Finding = { ...docFinding(), code: 'NOT_IN_CATALOG' };
    expect(renderFindingsTables([unknown], CATALOG)).toBe('');
  });
});

describe('renderFindingsTables: summarization budget', () => {
  const findingsOf = (n: number): Finding[] => Array.from({ length: n }, (_, i) => lineFinding(String(i + 1), 0.5));

  it('renders all rows when within the 40-row budget', () => {
    const html = renderFindingsTables(findingsOf(40), CATALOG);
    const dom = parse(html);
    expect(dom.querySelectorAll('tbody tr')).toHaveLength(40);
    expect(dom.querySelector('.hd-rollup-row')).toBeNull();
  });

  it('caps each group at 5 examples plus a rollup when over budget', () => {
    const html = renderFindingsTables(findingsOf(200), CATALOG);
    const dom = parse(html);

    const rows = dom.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(6); // 5 examples + 1 rollup

    const rollup = dom.querySelector('.hd-rollup-row td')!;
    expect(rollup.getAttribute('colspan')).toBe('7');
    expect(rollup.textContent).toContain('ve 195 kayıt daha');
    // 195 hidden rows × 0.50 TL each.
    expect(rollup.textContent).toContain('toplam fark: 97.50 TL');
  });

  it('applies the budget across groups, not per group', () => {
    // 30 line findings + 30 doc findings = 60 total > 40 budget → both capped.
    const docs: Finding[] = Array.from({ length: 30 }, () => docFinding());
    const html = renderFindingsTables([...findingsOf(30), ...docs], CATALOG);
    const dom = parse(html);

    const sections = dom.querySelectorAll('.hd-findings-section');
    expect(sections).toHaveLength(2);
    for (const section of sections) {
      expect(section.querySelectorAll('tbody tr')).toHaveLength(6); // 5 + rollup
      expect(section.querySelector('.hd-rollup-row td')!.textContent).toContain('ve 25 kayıt daha');
    }
  });

  it('respects custom budget options', () => {
    const html = renderFindingsTables(findingsOf(10), CATALOG, { maxTotalRows: 8, exampleRowsWhenOverBudget: 3 });
    const dom = parse(html);
    expect(dom.querySelectorAll('tbody tr')).toHaveLength(4); // 3 + rollup
    expect(dom.querySelector('.hd-rollup-row td')!.textContent).toContain('ve 7 kayıt daha');
  });

  it('exports the documented default budget', () => {
    expect(DEFAULT_MAX_TOTAL_ROWS).toBe(40);
  });
});
