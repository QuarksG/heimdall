// Unit tests — pivot injector failure halt.
//
// Every failure path SHALL reject with a PivotInjectionError whose message
// identifies the native PivotTable injection, and SHALL NOT return a blob
// (no partial output is ever emitted).
//
// **Validates: Requirements 1.7, 5.9**

import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  injectPivotTable,
  PivotInjectionError,
  type PivotInjectorConfig,
} from '../pivotInjector';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const HEADERS = ['Fatura Türü', ' Alacak ', ' Borç ', ' Uygulanan indirim '] as const;

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

/** Serializes a SheetJS workbook built from named AOAs to .xlsx bytes. */
function writeWorkbook(sheets: Array<{ name: string; aoa: unknown[][] }>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const { name, aoa } of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

/** A well-formed workbook with a populated source sheet and an empty host sheet. */
function validWorkbookBytes(): Uint8Array {
  return writeWorkbook([
    {
      name: 'Payment Data',
      aoa: [[...HEADERS], ['Toptan Satış Faturası', 100.5, 0, 1.25]],
    },
    { name: 'Pivot Fatura Türü', aoa: [[]] },
  ]);
}

/**
 * Asserts the injection attempt rejects with a PivotInjectionError that
 * identifies the native PivotTable injection, and that no blob is returned.
 */
async function expectInjectionFailure(
  bytes: Uint8Array,
  config: PivotInjectorConfig,
): Promise<void> {
  const attempt = injectPivotTable(bytes, config);

  // Rejects with the typed error identifying the native PivotTable injection.
  await expect(attempt).rejects.toBeInstanceOf(PivotInjectionError);
  await expect(attempt).rejects.toThrow(/native pivottable injection/i);

  // No blob is ever produced on the failure path (halt semantics of Req 1.7).
  const resolved = await attempt.then(
    blob => blob,
    () => undefined,
  );
  expect(resolved, 'no blob must be returned on injection failure').toBeUndefined();
}

// ---------------------------------------------------------------------------
// Failure paths (Requirements 1.7, 5.9)
// ---------------------------------------------------------------------------

describe('pivotInjector — failure halt (unit)', () => {
  it('(a) rejects when the source sheet is missing from the workbook', async () => {
    const bytes = writeWorkbook([{ name: 'Pivot Fatura Türü', aoa: [[]] }]);
    await expectInjectionFailure(bytes, CONFIG);
  });

  it('(b) rejects when the host sheet is missing from the workbook', async () => {
    const bytes = writeWorkbook([
      { name: 'Payment Data', aoa: [[...HEADERS], ['Toptan Satış Faturası', 1, 2, 3]] },
    ]);
    await expectInjectionFailure(bytes, CONFIG);
  });

  it('(c) rejects when the source sheet has no populated cells (unresolvable range)', async () => {
    const bytes = writeWorkbook([
      { name: 'Payment Data', aoa: [[]] }, // present but empty — no header, no data
      { name: 'Pivot Fatura Türü', aoa: [[]] },
    ]);
    await expectInjectionFailure(bytes, CONFIG);
  });

  it('(d) rejects when the bytes are not a valid zip package', async () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd, 0xfc]);
    await expectInjectionFailure(bytes, CONFIG);
  });

  it('(e) rejects when the valueFields config is empty', async () => {
    const config: PivotInjectorConfig = { ...CONFIG, valueFields: [] };
    await expectInjectionFailure(validWorkbookBytes(), config);
  });
});
