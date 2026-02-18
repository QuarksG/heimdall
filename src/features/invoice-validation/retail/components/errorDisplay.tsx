import React from 'react';
import DOMPurify from 'dompurify';

type ErrorSeverity = 'critical' | 'warning' | 'info' | 'success';

interface ValidationError {
  severity: ErrorSeverity;
  title: string;
  description: string;
  code?: string;
  field?: string;
  suggestion?: string;
  documentationLink?: string;
}

interface ErrorDisplayProps {
  errors: ValidationError[];
  invoiceNo?: string;
  onDismiss?: () => void;
}

const ErrorDisplay: React.FC<ErrorDisplayProps> = ({ errors, invoiceNo, onDismiss }) => {
  if (errors.length === 0) return null;

  const criticalCount = errors.filter(e => e.severity === 'critical').length;
  const warningCount = errors.filter(e => e.severity === 'warning').length;

  const getSeverityConfig = (severity: ErrorSeverity) => {
    const configs = {
      critical: {
        icon: '🚨',
        bgColor: '#fef2f2',
        borderColor: '#dc2626',
        textColor: '#991b1b',
        iconBg: '#fee2e2',
        label: 'Kritik Hata'
      },
      warning: {
        icon: '⚠️',
        bgColor: '#fffbeb',
        borderColor: '#f59e0b',
        textColor: '#92400e',
        iconBg: '#fef3c7',
        label: 'Uyarı'
      },
      info: {
        icon: 'ℹ️',
        bgColor: '#eff6ff',
        borderColor: '#3b82f6',
        textColor: '#1e40af',
        iconBg: '#dbeafe',
        label: 'Bilgi'
      },
      success: {
        icon: '✅',
        bgColor: '#f0fdf4',
        borderColor: '#10b981',
        textColor: '#065f46',
        iconBg: '#d1fae5',
        label: 'Başarılı'
      }
    };
    return configs[severity];
  };

  return (
    <div style={{ marginTop: '24px', marginBottom: '24px' }}>
      {/* Header Summary */}
      <div style={{
        backgroundColor: '#ffffff',
        border: '2px solid #e5e7eb',
        borderRadius: '12px',
        padding: '20px',
        marginBottom: '16px',
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: '#111827' }}>
              Doğrulama Sonuçları
            </h3>
            {invoiceNo && (
              <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: '#6b7280' }}>
                Fatura No: <strong>{DOMPurify.sanitize(invoiceNo)}</strong>
              </p>
            )}
          </div>
          
          <div style={{ display: 'flex', gap: '16px' }}>
            {criticalCount > 0 && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ 
                  fontSize: '24px', 
                  fontWeight: '700', 
                  color: '#dc2626',
                  lineHeight: '1'
                }}>
                  {criticalCount}
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                  Kritik Hata
                </div>
              </div>
            )}
            
            {warningCount > 0 && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ 
                  fontSize: '24px', 
                  fontWeight: '700', 
                  color: '#f59e0b',
                  lineHeight: '1'
                }}>
                  {warningCount}
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                  Uyarı
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Error List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {errors.map((error, index) => {
          const config = getSeverityConfig(error.severity);
          
          return (
            <div
              key={index}
              style={{
                backgroundColor: config.bgColor,
                border: `2px solid ${config.borderColor}`,
                borderRadius: '8px',
                padding: '16px',
                position: 'relative',
                transition: 'transform 0.2s, box-shadow 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{ display: 'flex', gap: '12px' }}>
                {/* Icon */}
                <div style={{
                  backgroundColor: config.iconBg,
                  borderRadius: '8px',
                  width: '40px',
                  height: '40px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '20px',
                  flexShrink: 0
                }}>
                  {config.icon}
                </div>

                {/* Content */}
                <div style={{ flex: 1 }}>
                  {/* Title and Badge */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span style={{
                      fontSize: '10px',
                      fontWeight: '600',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      color: config.textColor,
                      backgroundColor: config.iconBg,
                      padding: '2px 8px',
                      borderRadius: '4px'
                    }}>
                      {config.label}
                    </span>
                    {error.code && (
                      <span style={{
                        fontSize: '11px',
                        fontFamily: 'monospace',
                        color: '#6b7280',
                        backgroundColor: '#f3f4f6',
                        padding: '2px 6px',
                        borderRadius: '4px'
                      }}>
                        {error.code}
                      </span>
                    )}
                  </div>

                  {/* Title */}
                  <h4 style={{
                    margin: '0 0 8px 0',
                    fontSize: '16px',
                    fontWeight: '600',
                    color: config.textColor
                  }}>
                    {error.title}
                  </h4>

                  {/* Description */}
                  <p style={{
                    margin: '0 0 12px 0',
                    fontSize: '14px',
                    color: '#374151',
                    lineHeight: '1.5'
                  }}>
                    {error.description}
                  </p>

                  {/* Field */}
                  {error.field && (
                    <div style={{
                      fontSize: '13px',
                      color: '#6b7280',
                      marginBottom: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}>
                      <span style={{ fontWeight: '600' }}>Alan:</span>
                      <code style={{
                        backgroundColor: '#f3f4f6',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontFamily: 'monospace'
                      }}>
                        {error.field}
                      </code>
                    </div>
                  )}

                  {/* Suggestion */}
                  {error.suggestion && (
                    <div style={{
                      backgroundColor: 'rgba(255, 255, 255, 0.6)',
                      borderLeft: `3px solid ${config.borderColor}`,
                      padding: '10px 12px',
                      borderRadius: '4px',
                      marginTop: '12px'
                    }}>
                      <div style={{
                        fontSize: '12px',
                        fontWeight: '600',
                        color: config.textColor,
                        marginBottom: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}>
                        💡 Çözüm Önerisi
                      </div>
                      <div style={{
                        fontSize: '13px',
                        color: '#374151',
                        lineHeight: '1.5'
                      }}>
                        {error.suggestion}
                      </div>
                    </div>
                  )}

                  {/* Documentation Link */}
                  {error.documentationLink && (
                    <div style={{ marginTop: '12px' }}>
                      <a
                        href={error.documentationLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontSize: '13px',
                          color: config.borderColor,
                          textDecoration: 'none',
                          fontWeight: '500',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        📚 Daha Fazla Bilgi
                        <span style={{ fontSize: '10px' }}>↗</span>
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Dismiss Button */}
      {onDismiss && (
        <div style={{ marginTop: '16px', textAlign: 'center' }}>
          <button
            onClick={onDismiss}
            style={{
              backgroundColor: '#ffffff',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              padding: '8px 16px',
              fontSize: '14px',
              fontWeight: '500',
              color: '#374151',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#f9fafb';
              e.currentTarget.style.borderColor = '#9ca3af';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#ffffff';
              e.currentTarget.style.borderColor = '#d1d5db';
            }}
          >
            Kapat
          </button>
        </div>
      )}
    </div>
  );
};

export default ErrorDisplay;