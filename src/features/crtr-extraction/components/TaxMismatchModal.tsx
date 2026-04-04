import React from 'react';
import type { TaxMismatchModalProps } from '../types/crtr.types';

export const TaxMismatchModal = ({
  mismatchInfo,
  onConfirmOverride,
  onDismiss,
}: TaxMismatchModalProps): React.ReactElement | null => {
  if (!mismatchInfo.detected) return null;

  const { invoices } = mismatchInfo;
  const count = invoices.length;

  return (
    <div className="cfg-ovl">
      <div className="cfg-pnl" style={{ maxWidth: '640px' }}>
        <h2 className="cfg-h2" style={{ color: '#e05252' }}>
          Supplier Tax Rate Compliance Issue
        </h2>

        <div className="cfg-sec">
          <p style={{ margin: '0 0 12px', lineHeight: 1.6 }}>
            <strong>{count} invoice{count > 1 ? 's' : ''}</strong> detected where document-level
            tax declarations do not match line-level tax rates. This typically means the supplier
            stamped incorrect <code>Percent</code> values on individual invoice lines.
          </p>

          <div
            style={{
              maxHeight: '200px',
              overflowY: 'auto',
              background: 'rgba(0,0,0,0.05)',
              borderRadius: '6px',
              padding: '12px',
              marginBottom: '16px',
              fontSize: '13px',
            }}
          >
            {invoices.map((inv, idx) => (
              <div key={idx} style={{ marginBottom: idx < invoices.length - 1 ? '12px' : 0 }}>
                <strong>{inv.invoiceId}</strong>
                {inv.fileName ? <span style={{ color: '#888' }}> ({inv.fileName})</span> : null}
                <br />
                <span>Document regimes: [{inv.documentCodes.join(', ')}]</span>
                <br />
                <span>Line-level regimes: [{inv.lineGroupCodes.join(', ')}]</span>
                <br />
                <span style={{ color: '#e05252' }}>
                  Missing in lines: [{inv.missingInLines.join(', ')}]
                </span>
              </div>
            ))}
          </div>

          <div
            style={{
              background: 'rgba(212, 168, 83, 0.1)',
              border: '1px solid rgba(212, 168, 83, 0.3)',
              borderRadius: '6px',
              padding: '12px',
              marginBottom: '16px',
              fontSize: '13px',
              lineHeight: 1.6,
            }}
          >
            <strong>Reassign using document-level data?</strong>
            <br />
            Each line will be matched against document <code>TaxSubtotal.TaxableAmount</code> values
            to determine the correct tax rate. Original line-level rates will be preserved in the
            Notes column for audit trail.
          </div>
        </div>

        <div className="cfg-foot">
          <button onClick={onDismiss} className="btn btn-sec">
            Keep Original (Line-Level)
          </button>
          <button onClick={onConfirmOverride} className="btn btn-prim">
            Reassign from Document
          </button>
        </div>
      </div>
    </div>
  );
};