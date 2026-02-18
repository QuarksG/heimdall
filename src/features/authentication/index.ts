// src/features/authentication/index.ts
export { default as AuthLayout } from "./components/AuthLayout";
export { default as DisclosurePage } from "./components/DisclosurePage";
export { default as Login } from "./components/Login";
export { default as Register } from "./components/Register";
export { default as ConfirmSignUp } from "./components/ConfirmSignUp";
export { default as ForgotPassword } from "./components/ForgotPassword";
export { default as LogoutButton } from "./components/LogoutButton";
export { default as StatusDisplay } from "./components/StatusDisplay";

export { AuthProvider, useAuth } from "./context/AuthContext";
export type { AuthState, Entitlements, Role } from "./context/AuthContext";

export { usePermissions } from "./hooks/usePermissions";

export { default as ProtectedRoute } from "./guards/ProtectedRoute";