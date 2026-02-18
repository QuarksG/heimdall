import React, { useEffect, useMemo, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { toast } from 'react-toastify';
import { Row, Col, Spinner } from 'react-bootstrap';
import { FaCheckCircle, FaBolt, FaChartLine } from "react-icons/fa";

import { useInvoiceProcessor } from '../hooks/useInvoiceProcessor';
import { DropzoneArea } from './DropzoneArea';
import { ProcessingStatus } from './ProcessingStatus';
import { InvoiceTable } from './InvoiceTable';
import { FILE_ACCEPT, MAX_FILE_SIZE } from '../utils/fileReader';
import '../../../styles/components/conversion.css';

export type GroupedTotals = {
  [currency: string]: {
    taxExclusive: number;
    taxInclusive: number;
    taxAmount: number;
    count: number;
  }
};

const InvoiceVerify: React.FC = () => {
  const {
    invoices,
    processingStatus,
    processFiles,
    removeInvoice,
    clearAllInvoices
  } = useInvoiceProcessor();

  const {
    acceptedFiles,
    getRootProps,
    getInputProps,
    isDragActive,
    isDragAccept,
    isDragReject,
  } = useDropzone({
    accept: FILE_ACCEPT,
    maxFiles: 100,
    maxSize: MAX_FILE_SIZE,
    onDropRejected: (rejectedFiles) => {
      const errors = rejectedFiles.map(file => {
        const error = file.errors[0];
        if (error.code === 'file-too-large') {
          return `${file.file.name}: File exceeds 100MB limit`;
        }
        return `${file.file.name}: ${error.message}`;
      });
      toast.error(errors.join(', '));
    },
  });

  useEffect(() => {
    if (acceptedFiles.length > 0) {
      processFiles([...acceptedFiles]);
    }
  }, [acceptedFiles, processFiles]);

  const copyText = useCallback((e: React.MouseEvent, data: string | null, message: string) => {
    e.preventDefault();
    if (!data) {
      toast.warning("No data to copy");
      return;
    }
    navigator.clipboard.writeText(data)
      .then(() => toast.success(message))
      .catch(err => {
        console.error("Failed to copy:", err);
        toast.error("Failed to copy to clipboard");
      });
  }, []);

  const totals = useMemo<GroupedTotals>(() => {
    const groups: GroupedTotals = {};
    invoices.forEach(inv => {
      const currency = inv.documentCurrency || 'TRY';
      if (!groups[currency]) {
        groups[currency] = {
          taxExclusive: 0,
          taxInclusive: 0,
          taxAmount: 0,
          count: 0
        };
      }
      groups[currency].taxExclusive += (inv.taxExclusiveAmount || 0);
      groups[currency].taxInclusive += (inv.taxInclusiveAmount || 0);
      groups[currency].taxAmount += ((inv.taxInclusiveAmount || 0) - (inv.taxExclusiveAmount || 0));
      groups[currency].count += 1;
    });
    return groups;
  }, [invoices]);

  return (
    <section className='invoice-verify-page'>
      
      <div className="page-header">
        <h3>Upload a signed UBL XML file to generate PDF or HTML documents</h3>
      </div>

      <Row className="justify-content-center w-100 mb-4">
        <Col md={12} lg={10} xl={10}>
          <DropzoneArea
            isDragActive={isDragActive}
            isDragAccept={isDragAccept}
            isDragReject={isDragReject}
            getRootProps={getRootProps}
            getInputProps={getInputProps}
          />
        </Col>
      </Row>

      <div className="w-100" style={{ maxWidth: '98%' }}>
        <ProcessingStatus status={processingStatus} />

        {processingStatus.isProcessing ? (
          <div style={{ width: '300px', margin: '50px auto', textAlign: 'center' }}>
            <Spinner animation="border" role="status" variant="primary" style={{ width: '3rem', height: '3rem' }}>
              <span className="visually-hidden">Loading...</span>
            </Spinner>
            <h4 className="mt-4">Processing Files...</h4>
            <p className="text-muted">
              {processingStatus.processedFiles} of {processingStatus.totalFiles} complete
            </p>
          </div>
        ) : invoices.length > 0 ? (
          <div className="mt-4">
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h4 className="mb-0 text-dark">Processed Invoices <span className="text-muted fs-6">({invoices.length})</span></h4>
              
              <button 
                className="btn btn-warning text-white fw-bold btn-sm shadow-sm"
                onClick={clearAllInvoices}
              >
                Clear All
              </button>
            </div>
            
            <InvoiceTable 
              invoices={invoices} 
              totals={totals} 
              onRemove={removeInvoice} 
              onCopyText={copyText} 
            />
          </div>
        ) : (
          /* Info Cards */
          <Row className="justify-content-center g-4 mt-4">
            <Col md={4} lg={3}>
              <div className="info-card">
                <div className="mb-3 text-success fs-3"><FaCheckCircle /></div>
                <h6>Secure</h6>
                <p className="text-muted small mb-0">Local browser processing. No server uploads.</p>
              </div>
            </Col>
            <Col md={4} lg={3}>
              <div className="info-card">
                <div className="mb-3 text-warning fs-3"><FaBolt /></div>
                <h6>Fast</h6>
                <p className="text-muted small mb-0">Instant XML parsing with zero queue time.</p>
              </div>
            </Col>
            <Col md={4} lg={3}>
              <div className="info-card">
                <div className="mb-3 text-primary fs-3"><FaChartLine /></div>
                <h6>Scalable</h6>
                <p className="text-muted small mb-0">Handle bulk uploads and export to Excel easily.</p>
              </div>
            </Col>
          </Row>
        )}
      </div>
    </section>
  );
};

export default InvoiceVerify;