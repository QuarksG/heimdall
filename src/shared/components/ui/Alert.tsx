import React from 'react';
import { Alert as BSAlert } from 'react-bootstrap';

interface AlertProps {
  variant: 'success' | 'danger' | 'warning' | 'info';
  message: string | React.ReactNode;
  onClose?: () => void;
  dismissible?: boolean;
}

const Alert: React.FC<AlertProps> = ({ variant, message, onClose, dismissible = false }) => {
  return (
    <BSAlert 
      variant={variant} 
      onClose={onClose} 
      dismissible={dismissible}
    >
      {message}
    </BSAlert>
  );
};

export default Alert;