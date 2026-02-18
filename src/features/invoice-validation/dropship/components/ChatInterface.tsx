
import React, { useState } from 'react';
import "../../../../styles/components/chat.css";

import DOMPurify from 'dompurify';
import { processUploadedFile, type ProcessedFile } from '../utils/xmlProcessor';
import { validateDFInvoice } from './InvoiceValidateDF';
import ValidationResults, { sanitizeHtml } from './ValidationResults';
import { buildWelcomeMessage } from '../utils/messageBuilder';

type Message = {
  sender: 'bot' | 'user';
  text: string;
};

const ChatInterface: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    { sender: 'bot', text: sanitizeHtml(buildWelcomeMessage()) },
  ]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addMessage = (sender: 'bot' | 'user', text: string) => {
    const sanitized = sanitizeHtml(text);
    setMessages((prev) => [...prev, { sender, text: sanitized }]);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      addMessage('user', 'Dosya seçilmedi.');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const { files, error: fileError } = await processUploadedFile(file);

      if (fileError) {
        addMessage('bot', fileError);
        return;
      }

      if (files.length === 0) {
        addMessage('bot', 'İşlenebilir XML dosyası bulunamadı.');
        return;
      }

      
      if (files.length === 1) {
        addMessage('user', `Yüklenen XML dosyası: ${DOMPurify.sanitize(files[0].fileName)}`);
      } else {
        addMessage(
          'user',
          `Yüklenen ZIP dosyası: ${DOMPurify.sanitize(file.name)} (${files.length} XML dosyası içeriyor)`
        );
      }

   
      for (let i = 0; i < files.length; i++) {
        const pf: ProcessedFile = files[i];

        if (files.length > 1) {
          addMessage('user', `ZIP'ten çıkarılan XML dosyası: ${DOMPurify.sanitize(pf.fileName)}`);
        }

        const resultHtml = validateDFInvoice(pf.xmlDoc);
        addMessage('bot', resultHtml);

        
        if (i < files.length - 1) {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
    } catch (err) {
      console.error('Dosya işlenirken hata:', err);
      setError('Dosya işlenirken bir hata oluştu. Lütfen tekrar deneyin.');
      addMessage('bot', 'Dosya işlenirken bir hata oluştu. Lütfen dosyanızı kontrol edip tekrar deneyin.');
    } finally {
      setIsProcessing(false);
      if (event.target) event.target.value = '';
    }
  };

  return (
    <div className="chat-container">
      <ValidationResults messages={messages} isProcessing={isProcessing} />
      <div className="chat-input">
        <label htmlFor="dfFileInput" className="upload-button">
          XML/Yeni dosya yükle
        </label>
        <input
          type="file"
          id="dfFileInput"
          accept=".xml,.zip"
          onChange={handleFileChange}
          disabled={isProcessing}
          style={{ display: 'none' }}
        />
        {error && (
          <div
            style={{
              marginTop: '10px',
              padding: '10px',
              backgroundColor: '#ffebee',
              color: '#c62828',
              borderRadius: '4px',
              fontSize: '14px',
            }}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatInterface;