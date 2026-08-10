// SALES INVOICE PERIOD (analyst instruction): the Layer 1 block carries
// the first/last invoice date over SALES rows only, and the cashier
// audit sheet renders it directly under the Layer 1 title.
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { buildAggregationBlock } from '../cashierModel';
import { CashierAuditSheet } from '../../components/Excel/CashierAuditSheet';
import type { CashierModelResult } from '../cashierModel';
import type { PaymentRecord, InvoiceCategory } from '../../types/regional.types';

let rowCounter = 0;

function makeRecord(
  overrides: Partial<PaymentRecord> & { invoiceType: InvoiceCategory },
): PaymentRecord {
  rowCounter += 1;
  return {
    rowNumber: rowCounter,
    payee: 'VENDOR AŞ',
    supplierNumber: 'S1',
    vendorSite: 'SITE1_TR',
    paymentNumber: `P${rowCounter}`,
    paymentDate: '29-NOV-2024',
    currency: 'TRY',
    paymentAmount: 0,
    invoiceNumber: `INV${rowCounter}`,
    invoiceDate: '01-NOV-2024',
    poNumber: '',
    description: '',
    discount: 0,
    credit: 0,
    debit: 0,
    ...overrides,
  };
}

describe('buildAggregationBlock — salesInvoicePeriod', () => {
  it('takes first/last invoice date over SALES rows only', () => {
    const block = buildAggregationBlock('TRY', [
      makeRecord({ invoiceType: 'Toptan Satis Faturasi', invoiceDate: '15-MAR-2023', credit: 100 }),
      makeRecord({ invoiceType: 'Toptan Satis Faturasi', invoiceDate: '02-JAN-2023', credit: 100 }),
      makeRecord({ invoiceType: 'Toptan Satis Faturasi', invoiceDate: '28-NOV-2023', credit: 100 }),
      // Non-sales rows must NOT vote, even with wider dates.
      makeRecord({ invoiceType: 'QPD', invoiceDate: '01-JAN-2020', debit: 5 }),
      makeRecord({ invoiceType: 'Giden Havale', invoiceDate: '31-DEC-2025', debit: 295 }),
    ]);

    expect(block.salesInvoicePeriod).toEqual({ first: '02-JAN-2023', last: '28-NOV-2023' });
  });

  it('is absent when the currency has no sales rows or no parseable sales date', () => {
    const noSales = buildAggregationBlock('TRY', [
      makeRecord({ invoiceType: 'QPD', invoiceDate: '01-JAN-2020', debit: 5 }),
    ]);
    expect(noSales.salesInvoicePeriod).toBeUndefined();

    const unparseable = buildAggregationBlock('TRY', [
      makeRecord({ invoiceType: 'Toptan Satis Faturasi', invoiceDate: 'N/A', credit: 100 }),
    ]);
    expect(unparseable.salesInvoicePeriod).toBeUndefined();
  });
});

describe('CashierAuditSheet — period line rendering', () => {
  function minimalResult(block: ReturnType<typeof buildAggregationBlock>): CashierModelResult {
    return {
      aggregationBlocks: [block],
      balanceChecks: [],
      overallGate: 'GREEN',
    } as unknown as CashierModelResult;
  }

  it('renders the period directly under the Layer 1 title, header shifts by one', () => {
    const block = buildAggregationBlock('TRY', [
      makeRecord({ invoiceType: 'Toptan Satis Faturasi', invoiceDate: '02-JAN-2023', credit: 100 }),
      makeRecord({ invoiceType: 'Toptan Satis Faturasi', invoiceDate: '28-NOV-2023', credit: 100 }),
    ]);
    const sheet = new CashierAuditSheet().create(minimalResult(block));

    expect(String(sheet['F2']?.v)).toContain('KASİYER MODELİ — Layer 1');
    expect(String(sheet['F3']?.v)).toContain('Dönem / Period');
    expect(String(sheet['F3']?.v)).toContain('02-JAN-2023 → 28-NOV-2023');
    expect(sheet['F4']?.v).toBe('Fatura Türü'); // header shifted to row 4
  });

  it('renders NO period line when the block has none (layout unchanged)', () => {
    const block = buildAggregationBlock('TRY', [
      makeRecord({ invoiceType: 'QPD', invoiceDate: '01-JAN-2020', debit: 5 }),
    ]);
    const sheet = new CashierAuditSheet().create(minimalResult(block));

    expect(String(sheet['F2']?.v)).toContain('KASİYER MODELİ — Layer 1');
    expect(sheet['F3']?.v).toBe('Fatura Türü'); // header stays at row 3
  });
});
