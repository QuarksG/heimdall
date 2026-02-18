// src/features/authentication/components/AccessRequest.tsx
import { useMemo, useState } from "react";
import { generateClient } from "aws-amplify/data";
import { useAuth } from "../context/AuthContext";
import type { Schema } from "../../../../amplify/data/resource";
import "../styles/access-request.css";

const client = generateClient<Schema>();

/* ─── Country & Feature options ─── */
const COUNTRIES = [
  "GB", "DE", "FR", "IT", "ES", "IN", "NL",
  "AE", "SA", "TR", "EG", "SE", "PL", "BE", "ZA", "IE",
] as const;

const FEATURES = [
  { id: "invoice-parsing",         label: "Invoice Parsing" },
  { id: "invoice-validation",      label: "Retail Invoice Validator" },
  { id: "invoice-conversion",      label: "Invoice Convert" },
  { id: "invoice-validation-df",   label: "DF Invoice Validator" },
  { id: "payment-reconciliation",  label: "E-Reconciliation" },
  { id: "crtr-extraction",         label: "CRTR Extraction" },
] as const;

export default function AccessRequest() {
  const { user } = useAuth();

  const [selectedCountries, setSelectedCountries] = useState<Set<string>>(new Set());
  const [selectedFeatures, setSelectedFeatures] = useState<Set<string>>(new Set());
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"success" | "error" | null>(null);
  const [errMsg, setErrMsg] = useState("");

  const toggleCountry = (c: string) => {
    setSelectedCountries((prev) => {
      const next = new Set(prev);
      next.has(c) ? next.delete(c) : next.add(c);
      return next;
    });
  };

  const toggleFeature = (f: string) => {
    setSelectedFeatures((prev) => {
      const next = new Set(prev);
      next.has(f) ? next.delete(f) : next.add(f);
      return next;
    });
  };

  const canSubmit = useMemo(() => {
    if (busy) return false;
    if (selectedCountries.size === 0) return false;
    if (selectedFeatures.size === 0) return false;
    if (justification.trim().length < 10) return false;
    return true;
  }, [busy, selectedCountries, selectedFeatures, justification]);

  const handleSubmit = async () => {
    if (!canSubmit || !user) return;
    setResult(null);
    setErrMsg("");
    setBusy(true);

    try {
      // userId = Cognito sub — matches Entitlement table PK
      // so when admin approves, the Entitlement record uses the same key
      // that pre-token-generation Lambda looks up.
      await client.models.AccessRequest.create({
        userId: user.userId,
        email: user.email,
        fullName: user.name,
        country: Array.from(selectedCountries).join(","),
        requestedFeatures: Array.from(selectedFeatures),
        justification: justification.trim(),
        status: "PENDING",
      });

      setResult("success");
      setSelectedCountries(new Set());
      setSelectedFeatures(new Set());
      setJustification("");
    } catch (e: unknown) {
      console.error("[AccessRequest] submit error:", e);
      setErrMsg(
        (e as { message?: string })?.message ?? "Failed to submit request. Try again.",
      );
      setResult("error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ar-container">
      <div className="ar-card">
        <div className="ar-header">
          <div className="ar-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="32" height="32">
              <path
                d="M12 3l7 4v6c0 5-3 9-7 11C8 22 5 18 5 13V7l7-4z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M9.5 12.5l1.7 1.7 3.8-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h2>Access Request</h2>
          <p className="ar-subtitle">
            Select the countries and features you need access to. Your request
            will be reviewed by an administrator.
          </p>
        </div>

        {result === "success" && (
          <div className="ar-alert ar-alert--success" role="status">
            <strong>Request submitted!</strong> You'll receive access once an
            admin approves your request.
          </div>
        )}

        {result === "error" && (
          <div className="ar-alert ar-alert--error" role="alert">
            {errMsg}
          </div>
        )}

        {/* ── Countries ── */}
        <fieldset className="ar-section">
          <legend className="ar-section-title">
            Marketplace Countries
            <span className="ar-hint">Select all that apply</span>
          </legend>

          <div className="ar-chip-grid">
            {COUNTRIES.map((c) => (
              <button
                key={c}
                type="button"
                className={`ar-chip ${selectedCountries.has(c) ? "ar-chip--active" : ""}`}
                onClick={() => toggleCountry(c)}
                aria-pressed={selectedCountries.has(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </fieldset>

        {/* ── Features ── */}
        <fieldset className="ar-section">
          <legend className="ar-section-title">
            Feature Access
            <span className="ar-hint">Select the tools you require</span>
          </legend>

          <div className="ar-feature-grid">
            {FEATURES.map((f) => (
              <label
                key={f.id}
                className={`ar-feature-card ${selectedFeatures.has(f.id) ? "ar-feature-card--active" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={selectedFeatures.has(f.id)}
                  onChange={() => toggleFeature(f.id)}
                  className="ar-feature-checkbox"
                />
                <span className="ar-feature-label">{f.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* ── Justification ── */}
        <fieldset className="ar-section">
          <legend className="ar-section-title">
            Business Justification
            <span className="ar-hint">Minimum 10 characters</span>
          </legend>

          <textarea
            className="ar-textarea"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={4}
            placeholder="Explain why you need access to the selected countries and features, and how you will use them..."
          />
        </fieldset>

        <button
          type="button"
          className="ar-btn ar-btn--primary"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {busy ? (
            <>
              <span className="ar-spinner" /> Submitting&hellip;
            </>
          ) : (
            "Submit Request"
          )}
        </button>

        <p className="ar-footer">
          Requests are typically reviewed within 1–2 business days.
        </p>
      </div>
    </div>
  );
}