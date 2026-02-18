import React from 'react';
import DOMPurify from 'dompurify';

type AsinError = {
  type: 'missing' | 'invalid';
  itemName: string;
  invalidValue?: string;
};

type AddressTaxError = {
  message: string;
};

type ValidationResultsProps =
  | { type: 'asin'; data: AsinError[]; orderReference?: string }
  | { type: 'address'; data: AddressTaxError[] }
  | { type: 'tax'; data: AddressTaxError[] };

const safe = (v: string) => DOMPurify.sanitize(v ?? '');

const ValidationResults: React.FC<ValidationResultsProps> = (props) => {
  if (props.type === 'asin') {
    const { data, orderReference } = props;

    return (
      <div className="validation-table-wrapper mt-3">
        <h3 className="text-danger h5">ASIN/Ürün Kodu Hataları:</h3>

        <table className="table table-sm table-bordered">
          <thead className="table-light">
            <tr>
              <th>Ürün Adı</th>
              <th>Girilen Değer</th>
              <th>Durum</th>
            </tr>
          </thead>
          <tbody>
            {data.map((err, idx) => (
              <tr key={idx}>
                <td>{safe(err.itemName)}</td>
                <td>{safe(err.invalidValue || 'Eksik')}</td>
                <td className="text-danger">{err.type === 'missing' ? 'Eksik' : 'Geçersiz'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {orderReference && (
          <div className="alert alert-warning py-2 small">
            <strong>İpucu:</strong> PO detaylarını kontrol edin:{' '}
            <a
              href={`https://procurementportal-eu.corp.amazon.com/bp/po?poId=${encodeURIComponent(
                orderReference
              )}&tabId=items`}
              target="_blank"
              rel="noreferrer"
              className="ms-2 fw-bold"
            >
              Vendor Central PO: {orderReference}
            </a>
          </div>
        )}
      </div>
    );
  }

  if (props.type === 'address') {
    return (
      <div className="mt-3">
        {props.data.map((e, idx) => (
          /* STEP 6: Sanitized address message rendering */
          <div key={idx} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(e.message) }} />
        ))}
      </div>
    );
  }

  if (props.type === 'tax') {
    return (
      <div className="mt-3">
        {props.data.map((e, idx) => (
          /* STEP 6: Sanitized tax message rendering */
          <div key={idx} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(e.message) }} />
        ))}
      </div>
    );
  }

  return null;
};

export default ValidationResults;