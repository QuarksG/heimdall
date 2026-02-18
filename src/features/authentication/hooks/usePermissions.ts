// src/features/authentication/hooks/usePermissions.ts
import { useMemo } from "react";
import { useAuth } from "../context/AuthContext";

export type FeatureKey =
  | "Home"
  | "AccessRequest"
  | "InvoiceParsing"
  | "InvoiceControl"
  | "InvoiceVerify"
  | "InvoiceValidateDF"
  | "Recon"
  | "CRTRExtraction"
  | "Settings"
  | "Help"
  | "Logout";

export function usePermissions() {
  const { user, entitlements } = useAuth();

  const isAdmin = user?.role === "Admin";

  const allowed = useMemo(() => {
    if (isAdmin) return new Set<string>(["*"]);
    const arr = entitlements?.allowedFeatures ?? [];
    return new Set<string>(arr);
  }, [isAdmin, entitlements?.allowedFeatures]);

  // Map sidebar route IDs → entitlement keys in your backend
  const ID_TO_FEATURE: Record<FeatureKey, string | null> = {
    Home: null,           // always accessible
    AccessRequest: null,  // always accessible (this IS the gate)

    InvoiceParsing:    "invoice-parsing",
    InvoiceControl:    "invoice-validation",
    InvoiceVerify:     "invoice-conversion",
    InvoiceValidateDF: "invoice-validation",
    Recon:             "payment-reconciliation",
    CRTRExtraction:    "crtr-extraction",

    Settings: "settings", // admin-only
    Help:     null,
    Logout:   null,
  };

  const isUnlocked = (id: FeatureKey) => {
    if (id === "Settings") return isAdmin;
    const key = ID_TO_FEATURE[id];
    if (!key) return true;
    if (allowed.has("*")) return true;
    return allowed.has(key);
  };

  return {
    isAdmin,
    allowedFeatures: Array.from(allowed),
    isUnlocked,
  };
}