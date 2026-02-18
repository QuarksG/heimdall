// src/App.tsx
import { Routes, Route, Navigate } from "react-router-dom";
import "bootstrap/dist/css/bootstrap.min.css";
import "react-toastify/dist/ReactToastify.css";
import { ToastContainer } from "react-toastify";

import MainLayout from "./shared/components/layout/MainLayout";
import Home from "./shared/components/layout/Home";

import InvoiceParsing from "./features/invoice-parsing/components/InvoiceParsing";
import InvoiceVerify from "./features/invoice-conversion/components/InvoiceVerify";
import PaymentReconciliation from "./features/payment-reconciliation/components/Recon";

import InvoiceControl from "./features/invoice-validation/retail/components/InvoiceControl";
import { DFChatInterface } from "./features/invoice-validation/dropship";
import CRTRExtraction from "./features/crtr-extraction/CRTRExtraction";

// auth (full-screen, pre-login)
import DisclosurePage from "./features/authentication/components/DisclosurePage";
import Login from "./features/authentication/components/Login";
import SignUp from "./features/authentication/components/Register";
import ConfirmSignUp from "./features/authentication/components/ConfirmSignUp";
import ForgotPassword from "./features/authentication/components/ForgotPassword";
import StatusDisplay from "./features/authentication/components/StatusDisplay";

// post-login pages
import AccessRequest from "./features/authentication/components/AccessRequest";
import AdminPanel from "./features/authentication/components/AdminPanel";

// guards
import ProtectedRoute from "./features/authentication/guards/ProtectedRoute";
import FeatureGate from "./features/authentication/guards/FeatureGate";

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
                <InvoiceParsing />
              </FeatureGate>
            }
          />
          <Route
            path="invoice-validation/retail"
            element={
              <FeatureGate featureId="InvoiceControl">
                <InvoiceControl />
              </FeatureGate>
            }
          />
          <Route
            path="invoice-validation/dropship"
            element={
              <FeatureGate featureId="InvoiceValidateDF">
                <DFChatInterface />
              </FeatureGate>
            }
          />
          <Route
            path="invoice-conversion"
            element={
              <FeatureGate featureId="InvoiceVerify">
                <InvoiceVerify />
              </FeatureGate>
            }
          />
          <Route
            path="payment-reconciliation"
            element={
              <FeatureGate featureId="Recon">
                <PaymentReconciliation />
              </FeatureGate>
            }
          />
          <Route
            path="crtr-extraction"
            element={
              <FeatureGate featureId="CRTRExtraction">
                <CRTRExtraction />
              </FeatureGate>
            }
          />

          {/* Settings — Admin Panel (gated to admin only) */}
          <Route
            path="settings"
            element={
              <FeatureGate featureId="Settings">
                <AdminPanel />
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