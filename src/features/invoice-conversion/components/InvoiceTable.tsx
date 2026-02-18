import React, { useMemo, useState } from 'react';
import { Table, Button, InputGroup, Form } from 'react-bootstrap';
import { InvoiceRow } from './InvoiceRow';
import { InvoiceSummary } from './InvoiceSummary';
import type { ParsedInvoice } from '../utils/xmlToHtml';
import type { GroupedTotals } from './InvoiceVerify';

interface InvoiceTableProps {
  invoices: ParsedInvoice[];
  totals: GroupedTotals;
  onRemove: (id: string) => void;
  onCopyText: (e: React.MouseEvent, data: string | null, message: string) => void;
}

const normalize = (s: string) =>
  s
    .toLocaleLowerCase('tr-TR')
    .replace(/\s+/g, ' ')
    .trim();

const stripTags = (s: string) => s.replace(/<[^>]*>/g, ' ');


const collectText = (
  value: unknown,
  out: string[],
  seen: WeakSet<object>,
  depth = 0
) => {
  if (value == null || depth > 8) return;

  if (typeof value === 'string') {
    out.push(stripTags(value));
    return;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    out.push(String(value));
    return;
  }

  if (value instanceof Date) {
    out.push(value.toISOString());
    return;
  }

  if (typeof Node !== 'undefined' && value instanceof Node) {
    out.push(value.textContent || '');
    return;
  }

  if (value instanceof Map) {
    for (const [k, v] of value.entries()) {
      collectText(k, out, seen, depth + 1);
      collectText(v, out, seen, depth + 1);
    }
    return;
  }

  if (value instanceof Set) {
    for (const v of value.values()) collectText(v, out, seen, depth + 1);
    return;
  }

  if (Array.isArray(value)) {
    for (const v of value) collectText(v, out, seen, depth + 1);
    return;
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return;
    seen.add(value);

    for (const v of Object.values(value as Record<string, unknown>)) {
      collectText(v, out, seen, depth + 1);
    }
  }
};

const buildHaystack = (inv: any) => {
  const bag: string[] = [];
  const seen = new WeakSet<object>();

  collectText(inv, bag, seen, 0);

  const rawXml =
    inv?.rawXml ?? inv?.xml ?? inv?.originalXml ?? inv?.xmlString ?? '';
  if (typeof rawXml === 'string' && rawXml) bag.push(stripTags(rawXml));

  const xmlDoc = inv?.xmlDoc ?? inv?.doc ?? inv?.document;
  if (xmlDoc && typeof Node !== 'undefined' && xmlDoc instanceof Node) {
    bag.push(xmlDoc.textContent || '');
  }

  return normalize(bag.join(' '));
};

export const InvoiceTable: React.FC<InvoiceTableProps> = ({
  invoices,
  totals,
  onRemove,
  onCopyText,
}) => {
  const [query, setQuery] = useState('');

  const searchIndex = useMemo(() => {
    const m = new Map<string, string>();
    for (const inv of invoices as any[]) {
      const key = inv.uuid ?? inv.id ?? crypto.randomUUID();
      m.set(key, buildHaystack(inv));
    }
    return m;
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    const q = normalize(query);
    if (!q) return invoices;

    return (invoices as any[]).filter((inv) => {
      const key = inv.uuid ?? inv.id;
      const hay = key ? searchIndex.get(key) : buildHaystack(inv);
      return (hay ?? '').includes(q);
    });
  }, [invoices, query, searchIndex]);

  return (
    <div className="invoice-table-wrapper">
      <div className="d-flex align-items-center gap-2 mb-2">
        <InputGroup>
          <Form.Control
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search (Invoice No, Type, Seller, Buyer, Issue Date, totals...)"
          />
          <Button
            variant="outline-secondary"
            onClick={() => setQuery('')}
            disabled={!query.trim()}
          >
            Clear
          </Button>
        </InputGroup>

        <div className="text-muted small" style={{ whiteSpace: 'nowrap' }}>
          {filteredInvoices.length}/{invoices.length}
        </div>
      </div>

      <div className="table-container">
        <Table hover striped bordered className="mb-0">
          <thead className="sticky-header">
            <tr>
              <th style={{ minWidth: '140px' }}>Invoice No</th>
              <th style={{ minWidth: '100px' }}>Type</th>
              <th style={{ width: '20%' }}>Seller</th>
              <th style={{ width: '20%' }}>Buyer</th>
              <th style={{ minWidth: '100px' }}>Issue Date</th>
              <th style={{ minWidth: '110px' }}>Item Total</th>
              <th style={{ minWidth: '90px' }}>Tax</th>
              <th style={{ minWidth: '120px' }}>Payable Amount</th>
              <th style={{ minWidth: '180px', textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredInvoices.map((invoice: any) => (
              <InvoiceRow
                key={invoice.uuid}
                invoice={invoice}
                onRemove={onRemove}
                onCopyText={onCopyText}
              />
            ))}
          </tbody>
        </Table>
      </div>

      <InvoiceSummary invoices={invoices} totals={totals} />
    </div>
  );
};
