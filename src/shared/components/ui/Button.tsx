import React from 'react';
import { Button as BSButton, Spinner } from 'react-bootstrap';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'info' | 'light' | 'dark' | 'link';
  isLoading?: boolean;
  size?: 'sm' | 'lg';
  children: React.ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

const Button: React.FC<ButtonProps> = ({ 
  variant = 'primary', 
  isLoading = false, 
  children, 
  disabled, 
  ...props 
}) => {
  return (
    <BSButton 
      variant={variant} 
      disabled={disabled || isLoading} 
      {...props}
    >
      {isLoading ? (
        <>
          <Spinner
            as="span"
            animation="border"
            size="sm"
            role="status"
            aria-hidden="true"
            className="me-2"
          />
          Loading...
        </>
      ) : (
        children
      )}
    </BSButton>
  );
};

export default Button;