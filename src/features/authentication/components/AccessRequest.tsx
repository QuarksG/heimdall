// src/features/authentication/components/AccessRequest.tsx
//
// Access request form with Duplicate_Prevention (Req 9).
//
// Mount time (Req 9.1, 9.2): the user's own AccessRequest records are
// listed and classified via the pure `classifyDuplicates`; features already
// requested anywhere (regardless of status) render disabled in the picker
// with an "Already requested — STATUS" badge and cannot be selected.
//
// Submit time (Req 9.3–9.8, defense in depth against a stale picker): the
// records are RE-fetched, duplicates are recomputed against the fresh data,
// and `partitionSubmission` splits the selection:
//   - retrieval failure  -> nothing created; "could not be validated" message;
//     selection and justification preserved (Req 9.8)
//   - all duplicates     -> nothing created; per-feature status message with
//     contact-admins guidance (Req 9.5)
//   - mixed              -> exactly ONE request with only the non-duplicates;
//     excluded features listed with statuses and the not-sent-for-review
//     statement (Req 9.3, 9.4)
//   - all new            -> created as before
//
// Only the Request_Form's creates are constrained; admin actions and the
// Entitlement_Sync are untouched (Req 9.9).

import { useEffect, useMemo, useState } from "react";
import { generateClient } from "aws-amplify/data";
import { useAuth } from "../context/AuthContext";
import type { Schema } from "../../../../amplify/data/resource";
import {
  classifyDuplicates,
  partitionSubmission,
  type RequestSnapshot,
} from "../services/entitlementCore";
import { FEATURES } from "../constants/features";
import "../styles/access-request.css";

const client = generateClient<Schema>();

/* ─── Country options ─── */
const COUNTRIES = [
  "GB", "DE", "FR", "IT", "ES", "IN", "NL",
  "AE", "SA", "TR", "EG", "SE", "PL", "BE", "ZA", "IE",
] as const;

type RequestStatus = "PENDING" | "APPROVED" | "REJECTED";

type SubmitNotice =
  | { type: "success" }
  | { type: "partial"; excluded: { feature: string; status: string }[] }
  | { type: "all-duplicates"; excluded: { feature: string; status: string }[] }
  | { type: "validation-failure" }
  | { type: "error"; message: string };

const ALL_FEATURE_IDS = FEATURES.map((f) => f.id as string);

function featureLabelOf(id: string): string {
  return FEATURES.find((f) => f.id === id)?.label ?? id;
}

/** Lists ALL of the signed-in user's own AccessRequest records (owner auth
 *  already restricts results; the filter keeps pages small). Throws on any
 *  data-client error so callers can apply Req 9.8. */
async function fetchOwnRequests(userId: string): Promise<RequestSnapshot[]> {
  const all: RequestSnapshot[] = [];
  let nextToken: string | null | undefined = undefined;
  do {
    const page: {
      data: Array<{
        id: string;
        userId: string;
        email: string;
        fullName: string;
        country: string;
        requestedFeatures: (string | null)[];
        grantedFeatures?: (string | null)[] | null;
        status?: RequestStatus | null;
        createdAt?: string | null;
      }>;
      nextToken?: string | null;
    } = await client.models.AccessRequest.list({
      filter: { userId: { eq: userId } },
      nextToken: nextToken ?? undefined,
    });
    for (const item of page.data) {
      all.push({
        id: item.id,
        userId: item.userId,
        email: item.email,
        fullName: item.fullName,
        country: item.country,
        requestedFeatures: (item.requestedFeatures ?? []).filter(
          (f): f is string => f != null,
        ),
        grantedFeatures:
          item.grantedFeatures == null
            ? null
            : item.grantedFeatures.filter((f): f is string => f != null),
        status: item.status ?? "PENDING",
        createdAt: item.createdAt ?? null,
      });
    }
    nextToken = page.nextToken ?? null;
  } while (nextToken);
  return all;
}

export default function AccessRequest() {
  const { user } = useAuth();

  const [selectedCountries, setSelectedCountries] = useState<Set<string>>(new Set());
  const [selectedFeatures, setSelectedFeatures] = useState<Set<string>>(new Set());
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<SubmitNotice | null>(null);

  /** feature id -> status of an existing request containing it (Req 9.1). */
  const [duplicates, setDuplicates] = useState<Map<string, RequestStatus>>(
    () => new Map(),
  );

  /* ── Mount-time duplicate marking (task 10.1) ── */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const records = await fetchOwnRequests(user.userId);
        if (!cancelled) {
          setDuplicates(classifyDuplicates(records, ALL_FEATURE_IDS));
        }
      } catch (e) {
        // Mount-time marking is best-effort; the submit-time re-check
        // (task 10.2) is the enforcement point.
        console.error("[AccessRequest] duplicate pre-check failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const toggleCountry = (c: string) => {
    setSelectedCountries((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  const toggleFeature = (f: string) => {
    // Req 9.2 — duplicate features cannot be added to the selection.
    if (duplicates.has(f)) return;
    setSelectedFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
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

  /* ── Submit-time duplicate prevention (task 10.2) ── */
  const handleSubmit = async () => {
    if (!canSubmit || !user) return;
    setNotice(null);
    setBusy(true);

    // 1. Re-fetch at the moment of submission (Req 9.7). On failure:
    //    create nothing, preserve selection and justification (Req 9.8).
    let fresh: RequestSnapshot[];
    try {
      fresh = await fetchOwnRequests(user.userId);
    } catch (e) {
      console.error("[AccessRequest] submit-time validation failed:", e);
      setNotice({ type: "validation-failure" });
      setBusy(false);
      return;
    }

    // 2. Recompute duplicates against fresh records and partition.
    const selection = Array.from(selectedFeatures);
    const freshDuplicates = classifyDuplicates(fresh, selection);
    const { toSubmit, excluded } = partitionSubmission(
      selection,
      freshDuplicates,
    );

    // Update picker marks with what the store says right now.
    const allMarks = classifyDuplicates(fresh, ALL_FEATURE_IDS);

    // 3. All duplicates -> create nothing (Req 9.5).
    if (toSubmit.length === 0) {
      setDuplicates(allMarks);
      setSelectedFeatures((prev) => {
        const next = new Set(prev);
        for (const { feature } of excluded) next.delete(feature);
        return next;
      });
      setNotice({ type: "all-duplicates", excluded });
      setBusy(false);
      return;
    }

    // 4. Create exactly one request with only the non-duplicates
    //    (Req 9.3); all-new submissions flow through the same create.
    try {
      // userId = Cognito sub — matches the Entitlement table PK the
      // pre-token-generation Lambda looks up.
      await client.models.AccessRequest.create({
        userId: user.userId,
        email: user.email,
        fullName: user.name,
        country: Array.from(selectedCountries).join(","),
        requestedFeatures: toSubmit,
        justification: justification.trim(),
        status: "PENDING",
      });

      // The just-submitted features are now duplicates too (Req 9.7).
      for (const feature of toSubmit) allMarks.set(feature, "PENDING");
      setDuplicates(allMarks);

      setNotice(
        excluded.length > 0
          ? { type: "partial", excluded }
          : { type: "success" },
      );
      setSelectedCountries(new Set());
      setSelectedFeatures(new Set());
      setJustification("");
    } catch (e: unknown) {
      console.error("[AccessRequest] submit error:", e);
      setNotice({
        type: "error",
        message:
          (e as { message?: string })?.message ??
          "Failed to submit request. Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  const renderExcludedList = (
    excluded: { feature: string; status: string }[],
  ) => (
    <ul className="ar-excluded-list">
      {excluded.map(({ feature, status }) => (
        <li key={feature}>
          <strong>{featureLabelOf(feature)}</strong> — already requested
          (status: {status}); not sent for admin review.
        </li>
      ))}
    </ul>
  );

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

        {notice?.type === "success" && (
          <div className="ar-alert ar-alert--success" role="status">
            <strong>Request submitted!</strong> You'll receive access once an
            admin approves your request.
          </div>
        )}

        {notice?.type === "partial" && (
          <div className="ar-alert ar-alert--success" role="status">
            <strong>Request submitted.</strong> The following features were
            excluded because you have already requested them:
            {renderExcludedList(notice.excluded)}
          </div>
        )}

        {notice?.type === "all-duplicates" && (
          <div className="ar-alert ar-alert--warning" role="alert">
            <strong>Nothing was sent to the admins.</strong> You have already
            requested access to every selected feature:
            {renderExcludedList(notice.excluded)}
            To request a change — for example re-granting a rejected or
            revoked feature — please contact the administrators.
          </div>
        )}

        {notice?.type === "validation-failure" && (
          <div className="ar-alert ar-alert--error" role="alert">
            Your submission could not be validated against your existing
            requests. Nothing was submitted — please retry. Your selection and
            justification have been kept.
          </div>
        )}

        {notice?.type === "error" && (
          <div className="ar-alert ar-alert--error" role="alert">
            {notice.message}
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

        {/* ── Features (duplicates disabled with status badge, Req 9.1/9.2) ── */}
        <fieldset className="ar-section">
          <legend className="ar-section-title">
            Feature Access
            <span className="ar-hint">Select the tools you require</span>
          </legend>

          <div className="ar-feature-grid">
            {FEATURES.map((f) => {
              const duplicateStatus = duplicates.get(f.id);
              const isDuplicate = duplicateStatus !== undefined;
              return (
                <label
                  key={f.id}
                  className={[
                    "ar-feature-card",
                    selectedFeatures.has(f.id) ? "ar-feature-card--active" : "",
                    isDuplicate ? "ar-feature-card--disabled" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <input
                    type="checkbox"
                    checked={selectedFeatures.has(f.id)}
                    disabled={isDuplicate}
                    onChange={() => toggleFeature(f.id)}
                    className="ar-feature-checkbox"
                  />
                  <span className="ar-feature-label">{f.label}</span>
                  {isDuplicate && (
                    <span
                      className={`ar-feature-badge ar-feature-badge--${duplicateStatus.toLowerCase()}`}
                    >
                      Already requested — {duplicateStatus}
                    </span>
                  )}
                </label>
              );
            })}
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
