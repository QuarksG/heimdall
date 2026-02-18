import React, { useMemo } from 'react';
import { FaCloudUploadAlt, FaFileCode, FaFileArchive } from "react-icons/fa";

interface DropzoneAreaProps {
  getRootProps: any;
  getInputProps: any;
  isDragActive: boolean;
  isDragAccept: boolean;
  isDragReject: boolean;
}

export const DropzoneArea: React.FC<DropzoneAreaProps> = ({ 
  getRootProps, 
  getInputProps, 
  isDragActive, 
  isDragAccept, 
  isDragReject 
}) => {
  
  const className = useMemo(() => {
    let base = 'dropzone-area';
    if (isDragActive) base += ' active';
    if (isDragAccept) base += ' accept';
    if (isDragReject) base += ' reject';
    return base;
  }, [isDragActive, isDragAccept, isDragReject]);

  return (
    <div {...getRootProps({ className })}>
      <input {...getInputProps()} />
      
      <div className="dropzone-icons">
        <FaFileCode size={24} className="text-secondary opacity-25" />
        <FaCloudUploadAlt size={40} className="text-primary" />
        <FaFileArchive size={24} className="text-secondary opacity-25" />
      </div>

      <div className="text-start dropzone-text">
        <p>
          Drag & Drop or <span>Browse</span>
        </p>
        <div className="dropzone-hint">
          Supports <strong>.xml</strong> & <strong>.zip</strong>
        </div>
      </div>
    </div>
  );
};