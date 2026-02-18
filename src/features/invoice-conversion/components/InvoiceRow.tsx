import React, { useState } from 'react';
import { Tooltip } from 'react-tooltip';
import { FaEye, FaDownload, FaPrint, FaTrash } from "react-icons/fa"; 
import { toast } from 'react-toastify';
import { saveAs } from 'file-saver';
import { formatPrice } from '../utils/formatters';
import type { ParsedInvoice } from '../utils/xmlToHtml';

interface InvoiceRowProps {
  invoice: ParsedInvoice;
  onRemove: (id: string) => void;
  onCopyText: (e: React.MouseEvent, data: string | null, message: string) => void;
}

export const InvoiceRow: React.FC<InvoiceRowProps> = ({ invoice, onRemove, onCopyText }) => {
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  const printBlob = (e: React.MouseEvent, blobUrl: string) => {
    e.preventDefault();
    try {
      const win = window.open(blobUrl, '_blank');
      if (win) {
        win.document.title = "Invoice Print";
        setTimeout(() => {
          win.print();
          setTimeout(() => win.close(), 500);
        }, 500);
      }
    } catch (error) {
      toast.error("Unable to open print window");
    }
  };



  const handlePdfDownload = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!invoice.rawXml) {
      toast.error("No XML content available");
      return;
    }
    
    setIsDownloadingPdf(true);
    toast.info("Preparing PDF...");

    try {
      const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:8000';
      const response = await fetch(`${apiUrl}/generate-pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ xml_content: invoice.rawXml }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `Network error: ${response.statusText}`);
      }

      const pdfBlob = await response.blob();
      const filename = `${invoice.id}.pdf`;
      saveAs(pdfBlob, filename);
      toast.success("PDF Downloaded");

    } catch (error: any) {
      console.error("PDF Error:", error);
      toast.error(`Download failed: ${error.message}`);
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  return (
    <tr>
      <td>
        <a href="#" onClick={e => onCopyText(e, invoice.id, "Invoice ID copied")}>
          <code>#{invoice.id}</code>
        </a>
      </td>
      <td>
        {invoice.invoiceTypeCode}
        <br/>
        <small className="text-muted" style={{ fontSize: '0.85em' }}>{invoice.profileId}</small>
      </td>
      
      {/* Seller - With Wrap Class */}
      <td className="wrap-cell">
        <a 
          data-tooltip-id={`supplier-${invoice.uuid}`} 
          onClick={(e) => onCopyText(e, invoice.supplierId, "Supplier ID copied")} 
          href="#"
          className="fw-bold text-decoration-none text-dark"
        >
          {invoice.supplierName}
        </a>
        <Tooltip id={`supplier-${invoice.uuid}`} place="top">
          {invoice.supplierId ? `ID: ${invoice.supplierId}` : 'No ID'}
        </Tooltip>
      </td>

      {/* Buyer - With Wrap Class */}
      <td className="wrap-cell">
        <a 
          data-tooltip-id={`customer-${invoice.uuid}`} 
          onClick={(e) => onCopyText(e, invoice.customerId, "Customer ID copied")} 
          href="#"
          className="text-decoration-none text-secondary"
        >
          {invoice.customerName}
        </a>
        <Tooltip id={`customer-${invoice.uuid}`} place="top">
          {invoice.customerId ? `ID: ${invoice.customerId}` : 'No ID'}
        </Tooltip>
      </td>

      <td>{invoice.issueDate}</td>
      <td>{formatPrice(invoice.taxExclusiveAmount, invoice.documentCurrency)}</td>
      <td>{formatPrice(invoice.taxInclusiveAmount - invoice.taxExclusiveAmount, invoice.documentCurrency)}</td>
      <td>
        <strong>{formatPrice(invoice.payableAmount, invoice.documentCurrency)}</strong>
      </td>
      
      <td className="actions-column">
        {/* REMOVED: Verification Button */}
        
        <a 
          data-tooltip-id={`view-${invoice.uuid}`} 
          className="btn btn-outline-primary btn-sm" 
          target={invoice.uuid} 
          href={invoice.blobUrl}
        >
          <FaEye />
        </a>
        <Tooltip id={`view-${invoice.uuid}`} place="top">Preview</Tooltip>
        
        <a 
          data-tooltip-id={`download-${invoice.uuid}`} 
          className="btn btn-outline-success btn-sm" 
          onClick={() => toast.info("Download started")} 
          download={`${invoice.id}.html`} 
          href={invoice.blobUrl}
        >
          <FaDownload />
        </a>
        <Tooltip id={`download-${invoice.uuid}`} place="top">Download HTML</Tooltip>
        
        <button 
          data-tooltip-id={`pdf-${invoice.uuid}`} 
          className="btn btn-danger btn-sm" 
          onClick={handlePdfDownload}
          disabled={isDownloadingPdf}
        >
          {isDownloadingPdf ? <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> : 'PDF'}
        </button>
        <Tooltip id={`pdf-${invoice.uuid}`} place="top">
          Download PDF
        </Tooltip>

        <a 
          data-tooltip-id={`print-${invoice.uuid}`} 
          className="btn btn-outline-dark btn-sm" 
          href={invoice.blobUrl} 
          onClick={e => printBlob(e, invoice.blobUrl)}
        >
          <FaPrint />
        </a>
        <Tooltip id={`print-${invoice.uuid}`} place="top">Print</Tooltip>
        
        <button 
          data-tooltip-id={`delete-${invoice.uuid}`} 
          className="btn btn-outline-danger btn-sm" 
          onClick={() => onRemove(invoice.id)}
        >
          <FaTrash />
        </button>
        <Tooltip id={`delete-${invoice.uuid}`} place="top">Remove</Tooltip>
      </td>
    </tr>
  );
};