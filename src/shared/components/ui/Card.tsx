import React from 'react';
import { Card as BSCard } from 'react-bootstrap';

interface CardProps {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  footer?: React.ReactNode;
}

const Card: React.FC<CardProps> = ({ title, subtitle, children, className, footer }) => {
  return (
    <BSCard className={`shadow-sm ${className}`}>
      <BSCard.Body>
        {title && <BSCard.Title>{title}</BSCard.Title>}
        {subtitle && <BSCard.Subtitle className="mb-2 text-muted">{subtitle}</BSCard.Subtitle>}
        <div className="mt-3">
            {children}
        </div>
      </BSCard.Body>
      {footer && <BSCard.Footer>{footer}</BSCard.Footer>}
    </BSCard>
  );
};

export default Card;