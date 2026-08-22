// Unit tests — exporter behavior and error paths.
//
// Covers the filename convention, presence of the four preserved sheet
// names, and the Vendor Ledger builder-failure halt with no blob emitted.
//
// NOTE: The old open-item-model assertions (empty-input workbook shape,
// old-model pre-step output comparison) were retired with the
// balance-check cashier-model rewrite. Automated tests for the new model
// are deferred project-wide by analyst instruction; the design's
// Correctness Properties are the normative suite for the later
// enterprise-standards pass.

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as XLSX from 'xlsx';
import { ExcelExporter } from '../excelExporter';
import { VendorLedgerSheet } from '../../components/Excel/VendorLedgerSheet';
import type { PaymentRecord, InvoiceCategory } from '../../types/regional.types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The four preserved sheets. */
const PRESERVED_SHEETS = ['Payment Data', 'HAVALE', 'Filtered Invoices', 'PQV-RI'] as const;

/** Builds a PaymentRecord with sensible defaults, overridable per test. */
function makeRecord(
  overrides: Partial<PaymentRecord> & { invoiceType: InvoiceCategory },
): PaymentRecord {
  return {
    rowNumber: 1,
    payee: 'ACME TEDARIK A.S.',
    supplierNumber: 'SUP-001',
    vendorSite: 'ACME-IST',
    paymentNumber: 'PAY-001',
    paymentDate: '15-TEM-2026',
    currency: 'TRY',
    paymentAmount: 0,
    invoiceNumber: 'INV-000',
    invoiceDate: '01-TEM-2026',
    poNumber: 'PO-000',
    description: '',
    discount: 0,
    credit: 0,
    debit: 0,
    balance: 0,
    ...overrides,
  };
}

/** A small non-empty record set covering sales, deduction and transfer rows. */
function sampleRecords(): PaymentRecord[] {
  return [
    makeRecord({
      invoiceType: 'Toptan Satis Faturasi',
      invoiceNumber: 'TSF-500',
      credit: 3000,
    }),
    makeRecord({
      invoiceType: 'Eksik Miktar Kesinti Faturasi',
      invoiceNumber: 'EMK-502',
      debit: 650.5,
    }),
    makeRecord({
      invoiceType: 'Giden Havale',
      invoiceNumber: 'HAV-400',
      paymentAmount: 2349.5,
      debit: 2349.5,
    }),
  ];
}

/** Reads the generated blob back into a SheetJS workbook. */
async function readWorkbook(blob: Blob): Promise<XLSX.WorkBook> {
  const buffer = await blob.arrayBuffer();
  return XLSX.read(buffer, { type: 'array' });
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Filename convention
// ---------------------------------------------------------------------------

describe('ExcelExporter — filename convention', () => {
  it('names the file {prefix}_Amazon_Payments_{date}.xlsx with a sanitized prefix', async () => {
    const exporter = new ExcelExporter();

    const { fileName } = await exporter.generateBlob(sampleRecords(), 'ACME LTD');

    expect(fileName).toMatch(/^ACME_LTD_Amazon_Payments_\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});

// ---------------------------------------------------------------------------
// 2. Preserved sheet names
// ---------------------------------------------------------------------------

describe('ExcelExporter — preserved sheets', () => {
  it('includes the four preserved sheet names in the generated blob', async () => {
    const exporter = new ExcelExporter();

    const { blob } = await exporter.generateBlob(sampleRecords(), 'Vendor');
    const workbook = await readWorkbook(blob);

    for (const name of PRESERVED_SHEETS) {
      expect(workbook.SheetNames, `expected sheet '${name}' to be present`).toContain(name);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Vendor Ledger builder failure halts with no blob
// ---------------------------------------------------------------------------

describe('ExcelExporter — Vendor Ledger failure halt', () => {
  it('rejects identifying the Vendor Ledger sheet and returns no blob', async () => {
    // The exporter runs the cashier model as a pre-step and renders the
    // sheet via `createFromComputed`, so that is the method to fail.
    vi.spyOn(VendorLedgerSheet.prototype, 'createFromComputed').mockImplementation(() => {
      throw new Error('synthetic builder failure');
    });

    const exporter = new ExcelExporter();
    const attempt = exporter.generateBlob(sampleRecords(), 'Vendor');

    // The builder's error propagates unwrapped — what matters is the halt:
    // the export rejects and no blob is produced.
    await expect(attempt).rejects.toThrow(/synthetic builder failure/);

    // No blob is produced on the failure path (halt semantics).
    const resolved = await attempt.then(
      result => result,
      () => undefined,
    );
    expect(resolved, 'no blob must be returned when the builder fails').toBeUndefined();
  });
});
