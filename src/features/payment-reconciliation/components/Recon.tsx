import React from 'react';
import { useReconciliationProcess } from '../hooks/useReconciliationProcess';
import ReconciliationDashboard from './Dashboard/ReconciliationDashboard';
import { UploadCloud, Download, FileText } from 'lucide-react';
import "../../../styles/components/recon.css";

const Recon: React.FC = () => {
  const { 
    parsedData, 
    isProcessing, 
    error, 
    successMessage, 
    processFile, 
    exportExcel 
  } = useReconciliationProcess('TR');

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) processFile(file);
  };

  const hasData = parsedData && parsedData.length > 0;

  return (
    <div className="sap-container">
      <div className="sap-card">
        {/* --- HEADER SECTION --- */}
        <div className="d-flex justify-content-between align-items-end mb-4 border-bottom pb-4">
          
          {/* LEFT SIDE: Title, Text, AND Upload Button */}
          <div>
            <h1 className="h3 font-weight-bold text-dark mb-2">Amazon Payments Reconciliation</h1>
            <p className="text-muted mb-3">
              Upload your remittance advice to visualize performance and reconcile payments.
            </p>

            {/* UPLOAD BUTTON (Blue) */}
            <div>
              {/* using 'btn btn-primary' guarantees the blue color from Bootstrap */}
              <label className={`btn btn-primary d-inline-flex align-items-center gap-2 ${isProcessing ? 'disabled' : ''}`} style={{ cursor: 'pointer' }}>
                <UploadCloud size={20} />
                <span className="font-weight-medium">{isProcessing ? 'Processing...' : 'Choose File'}</span>
                
                {/* STRICTLY HIDING the default input */}
                <input 
                  type="file" 
                  accept=".xlsx,.xlsm,.xls" 
                  onChange={handleFileUpload} 
                  style={{ display: 'none' }} 
                  disabled={isProcessing}
                />
              </label>
            </div>
          </div>
          
          {/* RIGHT SIDE: Download Button (Blue) */}
          <div>
            {hasData && (
              <button
                onClick={exportExcel}
                className="btn btn-primary d-flex align-items-center gap-2 shadow-sm"
              >
                <Download size={20} />
                <span className="font-weight-medium">Download Excel Report</span>
              </button>
            )}
          </div>
        </div>

        {/* --- STATE HANDLING --- */}

        {/* 1. Processing Spinner */}
        {isProcessing && (
          <div className="d-flex flex-column align-items-center justify-content-center py-5 animate-fade-in">
             <div className="spinner-border text-primary mb-3" role="status"></div>
             <span className="text-muted font-weight-medium">Analyzing payment data...</span>
          </div>
        )}
        
        {/* 2. Error Message */}
        {error && (
          <div className="alert alert-danger d-flex align-items-center mt-3" role="alert">
            <div className="flex-grow-1">
              <strong>Analysis Failed:</strong> {error}
            </div>
          </div>
        )}

        {/* 3. Empty State (No Data) */}
        {!hasData && !isProcessing && !error && (
          <div className="text-center py-5 bg-light rounded border border-secondary border-opacity-25" style={{borderStyle: 'dashed'}}>
            <FileText className="text-secondary mb-3" size={64} style={{ opacity: 0.5 }} />
            <h3 className="h5 text-dark">No Data Loaded</h3>
            <p className="text-muted">Upload an Amazon Payment Excel file to generate the dashboard.</p>
          </div>
        )}

        {/* 4. Dashboard (Data Loaded) */}
        {hasData && !isProcessing && (
          <>
            {successMessage && (
              <div className="alert alert-success mt-3 mb-4">
                {successMessage}
              </div>
            )}
            
            <ReconciliationDashboard data={parsedData} />
          </>
        )}
      </div>
    </div>
  );
};

export default Recon;