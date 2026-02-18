import React from 'react';
import type { SummaryPanelProps } from '../types/crtr.types';

export const SummaryPanel = React.memo(({ summary }: SummaryPanelProps) => {
  const { count, totalInvoiceAmount, totalCalculatedAmount } = summary;
  const discrepancy = totalInvoiceAmount - totalCalculatedAmount;
  const isMatch = Math.abs(discrepancy) < 0.02;

  let statusClass = 'nodata';
  let statusText = 'No Data';

  if (count > 0) {
    statusClass = isMatch ? 'ok' : 'mismatch';
    statusText = isMatch ? 'Amounts Match' : 'Discrepancy Found';
  }

  return (
    <section className="summary-panel">
      <div className="summary-item">
        <h3>Invoices Processed</h3>
        <p>{count}</p>
      </div>
      <div className="summary-item">
        <h3>Total Declared Amount</h3>
        <p>{totalInvoiceAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
      </div>
      <div className="summary-item">
        <h3>Total Calculated Amount</h3>
        <p>{totalCalculatedAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
      </div>
      <div className="summary-item">
        <h3>Status</h3>
        <div className={`summary-status ${statusClass}`}>
          {statusText}
          {!isMatch && count > 0 && <span> ({discrepancy.toFixed(2)})</span>}
        </div>
      </div>
    </section>
  );
});