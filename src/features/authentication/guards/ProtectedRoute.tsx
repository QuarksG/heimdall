// src/features/authentication/guards/ProtectedRoute.tsx
import { Navigate, useLocation } from "react-router-dom";
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

  if (
    requiredFeature &&
    !entitlements?.allowedFeatures?.includes(requiredFeature)
  ) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}