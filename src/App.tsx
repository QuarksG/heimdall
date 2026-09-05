// src/App.tsx
import { Routes, Route, Navigate } from "react-router-dom";
import "bootstrap/dist/css/bootstrap.min.css";
import "react-toastify/dist/ReactToastify.css";
import { ToastContainer } from "react-toastify";

import MainLayout from "./shared/components/layout/MainLayout";
import Home from "./shared/components/layout/Home";

import { createLazyRoute } from "./shared/components/lazy/createLazyRoute";

// auth (full-screen, pre-login)
import DisclosurePage from "./features/authentication/components/DisclosurePage";
import Login from "./features/authentication/components/Login";
import SignUp from "./features/authentication/components/Register";
import ConfirmSignUp from "./features/authentication/components/ConfirmSignUp";
import ForgotPassword from "./features/authentication/components/ForgotPassword";
import StatusDisplay from "./features/authentication/components/StatusDisplay";

// post-login pages
import AccessRequest from "./features/authentication/components/AccessRequest";

// guards
import ProtectedRoute from "./features/authentication/guards/ProtectedRoute";
import FeatureGate from "./features/authentication/guards/FeatureGate";

// ── Lazily loaded Feature_Modules ──────────────────────────────────────
// SECURITY CONSTRAINT — lazy loading is NOT an authorization control.
// These dynamic imports are a delivery-hygiene and performance measure:
// they keep feature code out of the initial bundle, but every Feature_Chunk
// URL remains fetchable by any authenticated client that discovers it.
// Backend authorization remains the authoritative access control for
// sensitive operations and data. The follow-up spec
// "reconciliation-backend-migration" moves sensitive business logic
// server-side. (Req 7.1–7.4)
const LazyInvoiceParsing = createLazyRoute(
  () => import("./features/invoice-parsing/components/InvoiceParsing"),
);
const LazyInvoiceVerify = createLazyRoute(
  () => import("./features/invoice-conversion/components/InvoiceVerify"),
);
const LazyRecon = createLazyRoute(() =>
  import("./features/payment-reconciliation").then((m) => ({ default: m.Recon })),
);
const LazyInvoiceControl = createLazyRoute(
  () => import("./features/invoice-validation/retail/components/InvoiceControl"),
);
const LazyDFChatInterface = createLazyRoute(() =>
  import("./features/invoice-validation/dropship").then((m) => ({
    default: m.DFChatInterface,
  })),
);
const LazyCRTRExtraction = createLazyRoute(
  () => import("./features/crtr-extraction/CRTRExtraction"),
);
const LazyAdminPanel = createLazyRoute(
  () => import("./features/authentication/components/AdminPanel"),
);

function App() {
  return (
    <>
      <ToastContainer position="top-right" autoClose={3000} />

      <Routes>
        {/* ── Auth routes (full-screen, no sidebar) ── */}
        <Route path="/auth/terms" element={<DisclosurePage />} />
        <Route path="/auth/login" element={<Login />} />
        <Route path="/auth/register" element={<SignUp />} />
        <Route path="/auth/confirm" element={<ConfirmSignUp />} />
        <Route path="/auth/forgot" element={<ForgotPassword />} />

        {/* ── App routes (protected, with MainLayout + Sidebar) ── */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        >
          {/* Always accessible */}
          <Route index element={<Home />} />
          <Route path="access-request" element={<AccessRequest />} />

          {/* Feature-gated routes */}
          <Route
            path="invoice-parsing"
            element={
              <FeatureGate featureId="InvoiceParsing">
                <LazyInvoiceParsing />
              </FeatureGate>
            }
          />
          <Route
            path="invoice-validation/retail"
            element={
              <FeatureGate featureId="InvoiceControl">
                <LazyInvoiceControl />
              </FeatureGate>
            }
          />
          <Route
            path="invoice-validation/dropship"
            element={
              <FeatureGate featureId="InvoiceValidateDF">
                <LazyDFChatInterface />
              </FeatureGate>
            }
          />
          <Route
            path="invoice-conversion"
            element={
              <FeatureGate featureId="InvoiceVerify">
                <LazyInvoiceVerify />
              </FeatureGate>
            }
          />
          <Route
            path="payment-reconciliation"
            element={
              <FeatureGate featureId="Recon">
                <LazyRecon />
              </FeatureGate>
            }
          />
          <Route
            path="crtr-extraction"
            element={
              <FeatureGate featureId="CRTRExtraction">
                <LazyCRTRExtraction />
              </FeatureGate>
            }
          />

          {/* Settings — Admin Panel (gated to admin only) */}
          <Route
            path="settings"
            element={
              <FeatureGate featureId="Settings">
                <LazyAdminPanel />
              </FeatureGate>
            }
          />

          {/* Audit route */}
          <Route path="auth-status" element={<StatusDisplay />} />

          {/* Help discarded */}
          <Route path="help" element={<Navigate to="/" replace />} />

          {/* Legacy routes redirect */}
          <Route path="login" element={<Navigate to="/auth/login" replace />} />
          <Route path="register" element={<Navigate to="/access-request" replace />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/auth/login" replace />} />
      </Routes>
    </>
  );
}

export default App;