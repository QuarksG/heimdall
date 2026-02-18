import React, { useState, useMemo, useCallback } from 'react';
import "../../styles/components/crtr.css";
import { useCrtrProcessor } from './hooks/useCrtrProcessor';
import { exportToExcel } from './utils/excelExporter';
import { ALL_HEADERS, DEFAULT_HEADERS } from './constants/crtrDefaults';
import type { HeaderDef } from './types/crtr.types';

import { Header } from './components/Header';
import { UploadSection } from './components/UploadSection';
import { CustomFieldsPanel } from './components/CustomFieldsPanel';
import { ColumnSelector } from './components/ColumnSelector';
import { DataTable } from './components/DataTable';
import { SummaryPanel } from './components/SummaryPanel';

const CRTRExtraction: React.FC = () => {
  const [selectedHeaders, setSelectedHeaders] = useState<HeaderDef[]>(DEFAULT_HEADERS);

  const {
    summaryData,
    validationError,
    processingErrors,
    showConfigPanel,
    customFieldConfig,
    descriptionField,
    uniqueTaxCodes,

    setSearchQuery,
    setShowConfigPanel,
    setCustomFieldConfig,
    setDescriptionField,
    handleFileSelection,
    getFilteredData,
  } = useCrtrProcessor();

  const filteredData = useMemo(() => getFilteredData(selectedHeaders), [getFilteredData, selectedHeaders]);

  const handleHeaderToggle = useCallback((key: string) => {
    setSelectedHeaders((prev) => {
      const isSelected = prev.some((h) => h.key === key);
      if (isSelected) return prev.filter((h) => h.key !== key);
      const newHeader = ALL_HEADERS.find((h) => h.key === key);
      return newHeader ? [...prev, newHeader] : prev;
    });
  }, []);

  const handleExport = useCallback((): void => {
    if (filteredData.length > 0) {
      exportToExcel(filteredData, selectedHeaders, 'consolidated_report.xlsx');
    } else {
      alert('No data available to export.');
    }
  }, [filteredData, selectedHeaders]);

  return (
    <div className="pg-wrap">
      <div className="main-cont">
        <div className="main-cont-header">
          <Header onSearch={setSearchQuery} />

          {validationError && (
            <div className="err-msg">
              <strong>Error:</strong> {validationError}
            </div>
          )}

          {processingErrors.length > 0 && (
            <div className="err-msg" style={{ maxHeight: '150px', overflowY: 'auto', marginTop: '10px' }}>
              <strong>Some files failed to process:</strong>
              <ul style={{ margin: 0, paddingLeft: '20px' }}>
                {processingErrors.map((err, index) => (
                  <li key={index}>
                    <strong>{err.name}:</strong> {err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <UploadSection
            onFilesSelected={handleFileSelection}
            onShowConfig={() => setShowConfigPanel(true)}
            onExport={handleExport}
          />
        </div>

        <SummaryPanel summary={summaryData} />

        <CustomFieldsPanel
          show={showConfigPanel}
          config={customFieldConfig}
          descriptionField={descriptionField}
          onConfigChange={setCustomFieldConfig}
          onDescriptionFieldChange={setDescriptionField}
          onApply={() => setShowConfigPanel(false)}
          onCancel={() => setShowConfigPanel(false)}
          uniqueTaxCodes={uniqueTaxCodes}
        />

        <DataTable data={filteredData} headers={selectedHeaders} />
      </div>

      <ColumnSelector allHeaders={ALL_HEADERS} selectedHeaders={selectedHeaders} onToggle={handleHeaderToggle} />
    </div>
  );
};

export default CRTRExtraction;