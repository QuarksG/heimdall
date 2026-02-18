import React from 'react';
import type { UploadSectionProps } from '../types/crtr.types';

export const UploadSection = React.memo(({ onFilesSelected, onShowConfig, onExport }: UploadSectionProps) => (
  <section id="upload-section" className="sect-box">
    <h1 className="h1-tit">CRTR Parser</h1>
    <p className="txt-sm" style={{ color: 'red', fontWeight: 'bold' }}>
      Currently CRTR feature is in test period, please always double check the values before incorporating to actual CRTR.
    </p>
    <div className="file-grp">
      <input type="file" multiple accept=".xml,.zip" className="file-in" onChange={(e) => onFilesSelected(e.target.files)} />
      <button onClick={onShowConfig} className="btn btn-sec">
        Config CF
      </button>
      <button onClick={onExport} className="btn btn-prim">
        Export
      </button>
    </div>
  </section>
));