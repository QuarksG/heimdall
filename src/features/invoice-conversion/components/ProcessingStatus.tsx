import React from 'react';
import { Card, ProgressBar, Badge, Alert } from 'react-bootstrap';
import { FaExclamationTriangle } from "react-icons/fa";
import type { ProcessingStatusType } from '../hooks/useInvoiceProcessor';

interface ProcessingStatusProps {
  status: ProcessingStatusType;
}


export const ProcessingStatus: React.FC<ProcessingStatusProps> = ({ status }) => {
 
  if (!status.isProcessing && status.failedFiles.length === 0) return null;

  const progress = status.totalFiles > 0 
    ? (status.processedFiles / status.totalFiles) * 100 
    : 0;

  return (
    <Card className="mt-3 mb-3">
      <Card.Body>
        {status.isProcessing && (
          <>
            <h5>Processing Files...</h5>
            <ProgressBar 
              animated 
              now={progress} 
              label={`${status.processedFiles} / ${status.totalFiles}`}
              className="mb-2"
            />
            <p>Successfully processed: <Badge bg="success">{status.successCount}</Badge></p>
          </>
        )}
        
        {status.failedFiles.length > 0 && (
          <Alert variant="warning" className="mt-2">
            <Alert.Heading>
              <FaExclamationTriangle /> Failed to process {status.failedFiles.length} file(s)
            </Alert.Heading>
            <ul className="mb-0">
              {status.failedFiles.slice(0, 5).map((file, idx) => (
                <li key={idx}>
                  <strong>{file.name}:</strong> {file.error}
                </li>
              ))}
              {status.failedFiles.length > 5 && (
                <li>...and {status.failedFiles.length - 5} more</li>
              )}
            </ul>
          </Alert>
        )}
      </Card.Body>
    </Card>
  );
};