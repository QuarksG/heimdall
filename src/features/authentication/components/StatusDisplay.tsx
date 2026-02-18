// src/features/authentication/components/StatusDisplay.tsx
import { useEffect, useState } from "react";
import { fetchAuthSession } from "aws-amplify/auth";
import { useAuth } from "../context/AuthContext";
import "../styles/auth.css";

export default function StatusDisplay() {
  const { loading, isAuthenticated, user, entitlements } = useAuth();
  const [claims, setClaims] = useState<Record<string, unknown> | null>(
    null,
  );

  useEffect(() => {
    (async () => {
      try {
        const s = await fetchAuthSession();
        const payload = s.tokens?.idToken?.payload ?? null;
        setClaims(payload as Record<string, unknown> | null);
      } catch {
        setClaims(null);
      }
    })();
  }, []);

  return (
    <div className="auth-status-panel">
      <h3>Auth Status (Audit)</h3>

      <div className="auth-status-card">
        <div className="auth-status-row">
          <strong>loading:</strong>
          <span>{String(loading)}</span>
        </div>
        <div className="auth-status-row">
          <strong>isAuthenticated:</strong>
          <span>{String(isAuthenticated)}</span>
        </div>
        <div className="auth-status-row">
          <strong>user:</strong>
          <span>
            {user
              ? `${user.name} (${user.email}) \u2014 ${user.role}`
              : "null"}
          </span>
        </div>
        <div className="auth-status-row">
          <strong>entitlements:</strong>
          <span>
            {entitlements
              ? `${entitlements.country} \u2014 [${entitlements.allowedFeatures.join(", ")}]`
              : "null"}
          </span>
        </div>
      </div>

      <div className="auth-status-card">
        <div className="auth-status-card-header">
          ID Token Claims
        </div>
        <pre className="auth-status-pre">
          {JSON.stringify(claims, null, 2)}
        </pre>
      </div>
    </div>
  );
}