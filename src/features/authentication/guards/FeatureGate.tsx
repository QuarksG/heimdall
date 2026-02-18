// src/features/authentication/guards/FeatureGate.tsx
import type { ReactNode } from "react";
import { usePermissions, type FeatureKey } from "../hooks/usePermissions";

type Props = {
  /** The feature key this route requires */
  featureId: FeatureKey;
  children: ReactNode;
};

/**
 * Wraps a route element. If the current user does not have access to the
 * given feature, an "Access Denied" message is shown instead of the child.
 */
export default function FeatureGate({ featureId, children }: Props) {
  const { isUnlocked } = usePermissions();

  if (isUnlocked(featureId)) {
    return <>{children}</>;
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        gap: 16,
        padding: 32,
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: "50%",
          background: "#fee2e2",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 28,
        }}
      >
        <i className="ph-bold ph-lock-key" style={{ color: "#b91c1c" }} />
      </div>

      <h2 style={{ margin: 0, fontSize: 22, color: "#1e293b" }}>
        Access Denied
      </h2>

      <p style={{ margin: 0, color: "#64748b", maxWidth: 420, lineHeight: 1.6 }}>
        {featureId === "Settings" ? (
          <>
            This page is restricted to <strong>administrators</strong>. If you
            believe you should have admin access, contact the admin team.
          </>
        ) : (
          <>
            You don't have permission to access <strong>{featureId}</strong>.
            Please submit an <strong>Access Request</strong> from the sidebar
            and wait for admin approval.
          </>
        )}
      </p>
    </div>
  );
}