// src/features/authentication/guards/ProtectedRoute.tsx
//
// Route-level Feature_Gate. Because AuthContext now merges live entitlement
// state (Req 5), this component re-evaluates on every context change: a
// feature revoked mid-session navigates the user away within one render
// (Req 5.3, 5.10), and an unlock applies without a refresh (Req 5.4).

import { useEffect, useRef } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { toast } from "react-toastify";
import { useAuth } from "../context/AuthContext";

type Props = {
  children: React.ReactNode;
  requiredFeature?: string;
  adminOnly?: boolean;
  redirectTo?: string;
};

export default function ProtectedRoute({
  children,
  requiredFeature,
  adminOnly,
  redirectTo = "/auth/login",
}: Props) {
  const loc = useLocation();
  const { loading, isAuthenticated, user, entitlements } = useAuth();

  const featureAllowed =
    !requiredFeature ||
    (entitlements?.allowedFeatures ?? []).includes(requiredFeature);

  // Req 5.10 — if the user was viewing this feature when it became locked,
  // announce it before the redirect below takes effect.
  const hadAccess = useRef(false);
  useEffect(() => {
    if (loading || !isAuthenticated || !requiredFeature) return;
    if (featureAllowed) {
      hadAccess.current = true;
    } else if (hadAccess.current) {
      hadAccess.current = false;
      toast.warn("This feature is no longer available.");
    }
  }, [featureAllowed, loading, isAuthenticated, requiredFeature]);

  if (loading) return null;

  if (!isAuthenticated) {
    return (
      <Navigate
        to={redirectTo}
        replace
        state={{ from: loc.pathname }}
      />
    );
  }

  if (adminOnly && user?.role !== "Admin") {
    return <Navigate to="/" replace />;
  }

  if (!featureAllowed) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
