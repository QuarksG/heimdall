// src/features/authentication/constants/features.ts
//
// Single feature catalog shared by the Request_Form (AccessRequest.tsx) and
// the Admin_Panel surfaces (UserCard, RequestHistory, ApprovalDialog), so
// feature identifiers and display labels never drift apart.

export const FEATURES = [
  { id: "invoice-parsing",        label: "Invoice Parsing" },
  { id: "invoice-validation",     label: "Retail Invoice Validator" },
  { id: "invoice-conversion",     label: "Invoice Convert" },
  { id: "invoice-validation-df",  label: "DF Invoice Validator" },
  { id: "payment-reconciliation", label: "E-Reconciliation" },
  { id: "crtr-extraction",        label: "CRTR Extraction" },
] as const;

export type FeatureId = (typeof FEATURES)[number]["id"];

const LABELS: Record<string, string> = Object.fromEntries(
  FEATURES.map((f) => [f.id, f.label]),
);

/** Display label for a feature id; falls back to the raw id so unknown or
 *  legacy identifiers still render meaningfully. */
export function featureLabel(id: string): string {
  return LABELS[id] ?? id;
}
