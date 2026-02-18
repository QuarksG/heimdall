import React, { useRef, useState } from 'react';

interface FileUploaderProps {
  onUpload: (files: FileList) => void;
}

export const FileUploader: React.FC<FileUploaderProps> = ({ onUpload }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileStatus, setFileStatus] = useState("No file chosen");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const count = e.target.files.length;
      setFileStatus(`${count} file${count > 1 ? 's' : ''} selected`);
    } else {
      setFileStatus("No file chosen");
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (fileInputRef.current?.files && fileInputRef.current.files.length > 0) {
      onUpload(fileInputRef.current.files);
    }
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  const UploadIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );

  const ConvertIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );

  return (
    <section id="upload-section">
      <h1>Upload Files</h1>
      <form id="uploadForm" onSubmit={handleSubmit}>
        
        <input
          ref={fileInputRef}
          type="file"
          id="xmlFiles"
          name="xmlFiles"
          accept=".xml,.zip"
          multiple
          onChange={handleFileChange}
          style={{ display: 'none' }} 
        />

        <div className="upload-controls-wrapper">
          <button 
            type="button" 
            className="choose-btn" 
            onClick={triggerFileSelect}
          >
            <UploadIcon />
            Choose Files
          </button>

          <span className="file-status">{fileStatus}</span>

          <button type="submit" className="upload-btn">
            <ConvertIcon />
            Submit to convert
          </button>
        </div>

      </form>
    </section>
  );
};