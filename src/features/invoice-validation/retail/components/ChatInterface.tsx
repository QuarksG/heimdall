import React, { useRef, useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { getInitialGreeting } from '../utils/messageBuilder';
import '../../../styles/components/chat.css';

interface Message {
  sender: 'user' | 'bot';
  text: string;
  timestamp?: Date;
}

interface ChatInterfaceProps {
  messages: Message[];
  isProcessing: boolean;
  error: string | null;
  onFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onClearError?: () => void;
  onRetry?: () => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({
  messages,
  isProcessing,
  error,
  onFileUpload,
  onClearError,
  onRetry,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  // STEP 8: Removed uploadProgress state entirely

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isProcessing, error]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  // STEP 8: Simplified — no fake progress bar
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (error && onClearError) onClearError();
    onFileUpload(e);
  };

  // STEP 7: Fixed drag-and-drop — creates synthetic event instead of dispatching native event
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.name.toLowerCase().endsWith('.xml') || file.name.toLowerCase().endsWith('.zip')) {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        const syntheticEvent = {
          target: { files: dataTransfer.files },
        } as React.ChangeEvent<HTMLInputElement>;

        handleFileChange(syntheticEvent);
      }
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const formatTimestamp = (timestamp?: Date) => {
    if (!timestamp) return '';
    const now = new Date();
    const diff = now.getTime() - timestamp.getTime();

    if (diff < 60000) return 'Şimdi';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} dakika önce`;

    return timestamp.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div
      className={`chat-container ${isDragging ? 'drag-active' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="drag-overlay">
          <div className="drag-content">
            <div className="drag-icon">📁</div>
            <p>XML veya ZIP dosyasını buraya bırakın</p>
          </div>
        </div>
      )}

      <div className="chat-messages">
        {/* STEP 6: Sanitized initial greeting */}
        <div className="message bot initial-greeting">
          <div className="message-content">
            <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(getInitialGreeting()) }} />
          </div>
        </div>

        {messages.map((msg, index) => (
          <div key={index} className={`message ${msg.sender}`}>
            <div className="message-content">
              {/* STEP 6: Sanitized message text */}
              <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(msg.text) }} />
              {msg.timestamp && <span className="message-timestamp">{formatTimestamp(msg.timestamp)}</span>}
            </div>
          </div>
        ))}

        {/* STEP 8: Removed fake upload progress bar entirely */}

        {isProcessing && (
          <div className="message bot processing">
            <div className="message-content">
              <div className="typing-indicator">
                <span className="typing-dot"></span>
                <span className="typing-dot"></span>
                <span className="typing-dot"></span>
                <span className="typing-text">Faturanız inceleniyor, lütfen bekleyin...</span>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="message error">
            <div className="message-content">
              <div className="error-content">
                <div className="error-icon">⚠️</div>
                <div className="error-text">
                  <strong>Hata:</strong> {error}
                </div>
                <div className="error-actions">
                  {onRetry && (
                    <button onClick={onRetry} className="retry-button">
                      🔄 Tekrar Dene
                    </button>
                  )}
                  {onClearError && (
                    <button onClick={onClearError} className="dismiss-button">
                      ✕ Kapat
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className={`chat-input ${isProcessing ? 'disabled' : ''}`}>
        <button
          onClick={handleUploadClick}
          disabled={isProcessing}
          className="upload-button"
          aria-label="Dosya yükle"
          type="button"
        >
          <span className="upload-icon">📤</span>
          <span className="upload-text">{isProcessing ? 'İşleniyor...' : 'XML/ZIP Dosyası Yükle'}</span>
        </button>

        <input
          ref={fileInputRef}
          type="file"
          id="fileInput"
          accept=".xml,.zip"
          onChange={handleFileChange}
          disabled={isProcessing}
          style={{ display: 'none' }}
          aria-label="Dosya seçici"
        />

        <div className="file-info">
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;