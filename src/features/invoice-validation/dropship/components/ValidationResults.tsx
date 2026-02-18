import React from 'react';
import DOMPurify from 'dompurify';

type Message = {
  sender: 'bot' | 'user';
  text: string;
};

type Props = {
  messages: Message[];
  isProcessing: boolean;
};

const SANITIZE_CONFIG = {
  ADD_TAGS: [
    'style', 'h2', 'h3', 'h4', 'p', 'strong', 'em', 'ul', 'ol', 'li',
    'span', 'div', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'br',
  ],
  ADD_ATTR: ['style', 'class', 'target', 'href', 'rel', 'border'],
};

export const sanitizeHtml = (raw: string): string =>
  DOMPurify.sanitize(raw, SANITIZE_CONFIG);

const ValidationResults: React.FC<Props> = ({ messages, isProcessing }) => (
  <div className="chat-messages">
    {messages.map((msg, index) => (
      <div key={index} className={`message ${msg.sender}`}>
        <div className="message-content">
          <div dangerouslySetInnerHTML={{ __html: msg.text }} />
        </div>
      </div>
    ))}
    {isProcessing && (
      <div className="message bot">
        <div className="message-content">
          <p>Dosya işleniyor...</p>
        </div>
      </div>
    )}
  </div>
);

export default ValidationResults;