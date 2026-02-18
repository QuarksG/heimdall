// src/features/authentication/components/AdminPanel.tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { generateClient } from "aws-amplify/data";
import { useAuth } from "../context/AuthContext";
import type { Schema } from "../../../../amplify/data/resource";
import "../styles/admin-panel.css";

const client = generateClient<Schema>();

/* ─── Types ─── */
type AccessRequestItem = {
  id: string;
  userId: string;
  email: string;
  fullName: string;
  country: string;
  requestedFeatures: string[];
  justification?: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  createdAt?: string | null;
};

type TabFilter = "ALL" | "PENDING" | "APPROVED" | "REJECTED";

export default function AdminPanel() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<AccessRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<TabFilter>("PENDING");

  /* ── Fetch all access requests ── */
  const fetchRequests = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const { data: items } = await client.models.AccessRequest.list();
      // Sort newest first
      const sorted = (items ?? [])
        .map((item) => ({
          id: item.id,
          userId: item.userId,
          email: item.email,
          fullName: item.fullName,
          country: item.country,
          requestedFeatures: item.requestedFeatures as string[],
          justification: item.justification,
          status: (item.status ?? "PENDING") as AccessRequestItem["status"],
          reviewedBy: item.reviewedBy,
          reviewedAt: item.reviewedAt,
          createdAt: item.createdAt,
        }))
        .sort(
          (a, b) =>
            new Date(b.createdAt ?? 0).getTime() -
            new Date(a.createdAt ?? 0).getTime(),
        );
      setRequests(sorted);
    } catch (e) {
      console.error("[AdminPanel] fetch error:", e);
      setErr("Failed to load access requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRequests();
  }, [fetchRequests]);

  /* ── Approve: update AccessRequest + create Entitlement ── */
  const handleApprove = async (req: AccessRequestItem) => {
    if (!user) return;
    setActionBusy(req.id);
    setErr(null);

    const now = new Date().toISOString();

    try {
      // 1. Update AccessRequest status
      await client.models.AccessRequest.update({
        id: req.id,
        status: "APPROVED",
        reviewedBy: user.email,
        reviewedAt: now,
      });

      // 2. Create Entitlement record
      // userId must be the Cognito sub for the pre-token-generation Lambda.
      // Since we store email as userId in AccessRequest, and the Entitlement
      // table PK is userId, we use the same value here. If you switch to
      // Cognito sub later, update both AccessRequest.userId and this field.
      await client.models.Entitlement.create({
        userId: req.userId,
        country: req.country,
        allowedFeatures: req.requestedFeatures,
        grantedBy: user.email,
        grantedAt: now,
      });

      // Refresh the list
      setRequests((prev) =>
        prev.map((r) =>
          r.id === req.id
            ? { ...r, status: "APPROVED", reviewedBy: user.email, reviewedAt: now }
            : r,
        ),
      );
    } catch (e) {
      console.error("[AdminPanel] approve error:", e);
      setErr(`Failed to approve request for ${req.email}.`);
    } finally {
      setActionBusy(null);
    }
  };

  /* ── Reject: update AccessRequest status only ── */
  const handleReject = async (req: AccessRequestItem) => {
    if (!user) return;
    setActionBusy(req.id);
    setErr(null);

    const now = new Date().toISOString();

    try {
      await client.models.AccessRequest.update({
        id: req.id,
        status: "REJECTED",
        reviewedBy: user.email,
        reviewedAt: now,
      });

      setRequests((prev) =>
        prev.map((r) =>
          r.id === req.id
            ? { ...r, status: "REJECTED", reviewedBy: user.email, reviewedAt: now }
            : r,
        ),
      );
    } catch (e) {
      console.error("[AdminPanel] reject error:", e);
      setErr(`Failed to reject request for ${req.email}.`);
    } finally {
      setActionBusy(null);
    }
  };

  /* ── Revoke: delete Entitlement + set request back to REJECTED ── */
  const handleRevoke = async (req: AccessRequestItem) => {
    if (!user) return;
    setActionBusy(req.id);
    setErr(null);

    const now = new Date().toISOString();

    try {
      // Delete entitlement
      await client.models.Entitlement.delete({ userId: req.userId });

      // Update request status
      await client.models.AccessRequest.update({
        id: req.id,
        status: "REJECTED",
        reviewedBy: user.email,
        reviewedAt: now,
      });

      setRequests((prev) =>
        prev.map((r) =>
          r.id === req.id
            ? { ...r, status: "REJECTED", reviewedBy: user.email, reviewedAt: now }
            : r,
        ),
      );
    } catch (e) {
      console.error("[AdminPanel] revoke error:", e);
      setErr(`Failed to revoke access for ${req.email}.`);
    } finally {
      setActionBusy(null);
    }
  };

  /* ── Filtered list ── */
  const filtered = useMemo(() => {
    if (tab === "ALL") return requests;
    return requests.filter((r) => r.status === tab);
  }, [requests, tab]);

  const counts = useMemo(() => {
    const c = { ALL: requests.length, PENDING: 0, APPROVED: 0, REJECTED: 0 };
    for (const r of requests) {
      c[r.status] = (c[r.status] ?? 0) + 1;
    }
    return c;
  }, [requests]);

  return (
    <div className="ap-container">
      <div className="ap-header">
        <h2>Access Request Management</h2>
        <p className="ap-subtitle">
          Review, approve, or reject user access requests.
        </p>
      </div>

      {/* ── Tab filters ── */}
      <div className="ap-tabs">
        {(["PENDING", "APPROVED", "REJECTED", "ALL"] as TabFilter[]).map(
          (t) => (
            <button
              key={t}
              type="button"
              className={`ap-tab ${tab === t ? "ap-tab--active" : ""}`}
              onClick={() => setTab(t)}
            >
              {t}
              <span className="ap-tab-count">{counts[t]}</span>
            </button>
          ),
        )}

        <button
          type="button"
          className="ap-refresh-btn"
          onClick={fetchRequests}
          title="Refresh"
        >
          <i className="ph-bold ph-arrows-clockwise" />
        </button>
      </div>

      {/* ── Error ── */}
      {err && (
        <div className="ap-alert ap-alert--error" role="alert">
          {err}
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className="ap-loading">
          <span className="ap-spinner" /> Loading requests&hellip;
        </div>
      )}

      {/* ── Empty state ── */}
      {!loading && filtered.length === 0 && (
        <div className="ap-empty">
          No {tab === "ALL" ? "" : tab.toLowerCase()} requests found.
        </div>
      )}

      {/* ── Request cards ── */}
      <div className="ap-list">
        {filtered.map((req) => (
          <div key={req.id} className={`ap-card ap-card--${req.status.toLowerCase()}`}>
            <div className="ap-card-header">
              <div>
                <span className="ap-card-name">{req.fullName}</span>
                <span className="ap-card-email">{req.email}</span>
              </div>
              <span className={`ap-badge ap-badge--${req.status.toLowerCase()}`}>
                {req.status}
              </span>
            </div>

            <div className="ap-card-body">
              <div className="ap-card-field">
                <span className="ap-card-label">Countries:</span>
                <span className="ap-card-value">
                  {req.country.split(",").map((c) => (
                    <span key={c} className="ap-country-tag">
                      {c.trim()}
                    </span>
                  ))}
                </span>
              </div>

              <div className="ap-card-field">
                <span className="ap-card-label">Features:</span>
                <span className="ap-card-value">
                  {req.requestedFeatures.map((f) => (
                    <span key={f} className="ap-feature-tag">
                      {f}
                    </span>
                  ))}
                </span>
              </div>

              {req.justification && (
                <div className="ap-card-field">
                  <span className="ap-card-label">Justification:</span>
                  <span className="ap-card-value ap-card-justification">
                    {req.justification}
                  </span>
                </div>
              )}

              {req.reviewedBy && (
                <div className="ap-card-field">
                  <span className="ap-card-label">Reviewed by:</span>
                  <span className="ap-card-value">
                    {req.reviewedBy} &mdash;{" "}
                    {req.reviewedAt
                      ? new Date(req.reviewedAt).toLocaleDateString()
                      : ""}
                  </span>
                </div>
              )}

              <div className="ap-card-field">
                <span className="ap-card-label">Submitted:</span>
                <span className="ap-card-value">
                  {req.createdAt
                    ? new Date(req.createdAt).toLocaleString()
                    : "—"}
                </span>
              </div>
            </div>

            {/* ── Actions ── */}
            <div className="ap-card-actions">
              {req.status === "PENDING" && (
                <>
                  <button
                    type="button"
                    className="ap-btn ap-btn--approve"
                    disabled={actionBusy === req.id}
                    onClick={() => handleApprove(req)}
                  >
                    {actionBusy === req.id ? "Processing…" : "Approve"}
                  </button>
                  <button
                    type="button"
                    className="ap-btn ap-btn--reject"
                    disabled={actionBusy === req.id}
                    onClick={() => handleReject(req)}
                  >
                    Reject
                  </button>
                </>
              )}

              {req.status === "APPROVED" && (
                <button
                  type="button"
                  className="ap-btn ap-btn--revoke"
                  disabled={actionBusy === req.id}
                  onClick={() => handleRevoke(req)}
                >
                  {actionBusy === req.id ? "Revoking…" : "Revoke Access"}
                </button>
              )}

              {req.status === "REJECTED" && (
                <button
                  type="button"
                  className="ap-btn ap-btn--approve"
                  disabled={actionBusy === req.id}
                  onClick={() => handleApprove(req)}
                >
                  {actionBusy === req.id ? "Processing…" : "Re-approve"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}