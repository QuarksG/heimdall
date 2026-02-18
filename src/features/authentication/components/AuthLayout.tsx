// src/features/authentication/components/AuthLayout.tsx
import type { ReactNode } from "react";
import "../styles/auth.css";

type Props = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

export default function AuthLayout({ title, subtitle, children }: Props) {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-brand-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M12 3l7 4v6c0 5-3 9-7 11C8 22 5 18 5 13V7l7-4z" />
              <path d="M9.5 12.5l1.7 1.7 3.8-4" />
            </svg>
          </div>
          <h1>HEIMDALL</h1>
          <p>Controlled internal tool</p>
        </div>

        <h2 className="auth-title">{title}</h2>
        {subtitle ? <p className="auth-subtitle">{subtitle}</p> : null}

        {children}
      </div>
    </div>
  );
}