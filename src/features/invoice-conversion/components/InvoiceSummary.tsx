import React from 'react';
import { Card, Row, Col } from 'react-bootstrap';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { toast } from 'react-toastify';
import { formatPrice } from '../utils/formatters';
import type { ParsedInvoice } from '../utils/xmlToHtml';
import type { GroupedTotals } from './InvoiceVerify';

interface InvoiceSummaryProps {
  invoices: ParsedInvoice[];
  totals: GroupedTotals;
}

export const InvoiceSummary: React.FC<InvoiceSummaryProps> = ({ invoices, totals }) => {
  const downloadExcel = (e: React.MouseEvent) => {
    e.preventDefault();

    try {
      const excelData = invoices.map(inv => ({
        "Invoice No": inv.id,
        "Profile": inv.profileId,
        "Type": inv.invoiceTypeCode,
        "Currency": inv.documentCurrency,
        "Supplier": inv.supplierName,
        "Supplier ID": inv.supplierId || 'N/A',
        "Customer": inv.customerName,
        "Customer ID": inv.customerId || 'N/A',
        "Issue Date": inv.issueDate || 'N/A',
        "Tax Exclusive (Item Total)": inv.taxExclusiveAmount,
        "Tax Amount": inv.taxInclusiveAmount - inv.taxExclusiveAmount,
        "Payable Amount": inv.payableAmount,
      }));

      const ws = XLSX.utils.json_to_sheet(excelData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Invoices");

      const fileName = `invoices_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(wb, fileName);
      toast.success("Excel export started");
    } catch (error) {
      console.error("Excel export failed:", error);
      toast.error("Excel export failed. Please try again.");
    }
  };

  const downloadAll = async (e: React.MouseEvent) => {
    e.preventDefault();
    
    try {
      const zip = new JSZip();
      let successCount = 0;
      
      for (const invoice of invoices) {
        try {
          const htmlContent = await fetch(invoice.blobUrl).then(res => res.text());
          const sanitizedInvoiceNumber = invoice.id.replace(/[^a-zA-Z0-9]/g, "_");
          zip.file(`${sanitizedInvoiceNumber}.html`, htmlContent);
          successCount++;
        } catch (error) {
          console.error(`Failed to add invoice ${invoice.id} to ZIP:`, error);
        }
      }
      
      if (successCount === 0) {
        toast.error("No invoices could be added to the ZIP file");
        return;
      }
      
      const content = await zip.generateAsync({ type: 'blob' });
      saveAs(content, `Invoices_${new Date().toISOString().split('T')[0]}.zip`);
      toast.success(`Downloaded ${successCount} invoices`);
    } catch (error) {
      console.error("ZIP download failed:", error);
      toast.error("Failed to create ZIP file. Please try again.");
    }
  };

  const currencyKeys = Object.keys(totals);

  return (
    <div className='table-summary p-3 bg-light rounded shadow-sm'>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <Card.Title className="mb-0">Summary Report</Card.Title>
        <div>
           <Card.Link href="#" onClick={downloadExcel} className="btn btn-primary btn-sm me-2">
            Export to Excel
          </Card.Link>
          <Card.Link href="#" onClick={downloadAll} className="btn btn-success btn-sm">
            Download All HTML
          </Card.Link>
        </div>
      </div>

      <Row>
        {currencyKeys.length === 0 && <p className="text-muted">No totals available.</p>}
        
        {currencyKeys.map(currency => {
          const data = totals[currency];
          return (
            <Col md={6} lg={4} key={currency} className="mb-3">
              <Card className="h-100 border-0 shadow-sm" style={{ backgroundColor: '#fff' }}>
                <Card.Header className="bg-transparent border-bottom fw-bold text-primary">
                  {currency} Totals
                  <span className="float-end badge bg-secondary">{data.count} Invoices</span>
                </Card.Header>
                <Card.Body>
                  <div className="d-flex justify-content-between mb-2">
                    <span className="text-muted">Item Total:</span>
                    <span className="fw-medium">{formatPrice(data.taxExclusive, currency)}</span>
                  </div>
                  <div className="d-flex justify-content-between mb-2">
                    <span className="text-muted">Tax:</span>
                    <span className="fw-medium">{formatPrice(data.taxAmount, currency)}</span>
                  </div>
                  <hr className="my-2" />
                  <div className="d-flex justify-content-between">
                    <span className="fw-bold">Total Payable:</span>
                    <span className="fw-bold text-success">{formatPrice(data.taxInclusive, currency)}</span>
                  </div>
                </Card.Body>
              </Card>
            </Col>
          );
        })}
      </Row>
    </div>
  );
};