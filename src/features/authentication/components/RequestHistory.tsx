// src/features/authentication/components/RequestHistory.tsx
//
// Expandable per-request audit history inside a UserCard (Req 8.7).
// For each request: status, requested vs granted indication (Req 1.6),
// justification, reviewer identity + timestamp (Req 7.4).
//
// Secondary toggle surface (Req 3.1, 3.9, 3.11): APPROVED and REJECTED
// requests render one FeatureToggle per requested feature, on iff the
// feature is in the request's effective granted set (all off for REJECTED).
// PENDING requests expose Approve… / Reject affordances (Req 8.8); REJECTED
// requests expose Re-approve… routing to the per-feature dialog (Req 7.3).

import {
  effectiveGrantedFeatures,
  type RequestSnapshot,
} from "../services/entitlementCore";
import { featureLabel } from "../constants/features";
import FeatureToggle from "./FeatureToggle";

export type RequestHistoryProps = {
  requests: RequestSnapshot[];
  /** `req:${requestId}:${feature}` keys currently persisting (Req 3.5). */
  pendingKeys: ReadonlySet<string>;
  /** Request ids with a busy reject/revoke button. */
  busyRequestIds: ReadonlySet<string>;
  onToggle: (req: RequestSnapshot, feature: string, next: boolean) => void;
  /** Opens the ApprovalDialog (PENDING approve and REJECTED re-approve). */
  onOpenApproval: (req: RequestSnapshot) => void;
  onReject: (req: RequestSnapshot) => void;
  onRevoke: (req: RequestSnapshot) => void;
};

function formatDateTime(value?: string | null): string {
  return value ? new Date(value).toLocaleString() : "—";
}

export default function RequestHistory({
  requests,
  pendingKeys,
  busyRequestIds,
  onToggle,
  onOpenApproval,
  onReject,
  onRevoke,
}: RequestHistoryProps) {
  return (
    <div className="ap-history">
      {requests.map((req) => {
        const granted = new Set(effectiveGrantedFeatures(req));
        const reviewed = req.status !== "PENDING";
        const busy = busyRequestIds.has(req.id);

        return (
          <div
            key={req.id}
            className={`ap-history-item ap-history-item--${req.status.toLowerCase()}`}
          >
            <div className="ap-history-head">
              <span className={`ap-badge ap-badge--${req.status.toLowerCase()}`}>
                {req.status}
              </span>
              <span className="ap-history-date">
                Submitted {formatDateTime(req.createdAt)}
              </span>
            </div>

            <div className="ap-history-body">
              {/* Requested vs granted indication (Req 1.6):
                  reviewed requests use toggles; PENDING shows plain tags. */}
              <div className="ap-card-field">
                <span className="ap-card-label">Features:</span>
                <span className="ap-card-value">
                  {reviewed
                    ? req.requestedFeatures.map((feature) => (
                        <span key={feature} className="ap-history-feature">
                          <FeatureToggle
                            featureId={feature}
                            label={`${featureLabel(feature)} for this request`}
                            checked={granted.has(feature)}
                            pending={pendingKeys.has(`req:${req.id}:${feature}`)}
                            onChange={(next) => onToggle(req, feature, next)}
                          />
                          <span
                            className={
                              granted.has(feature)
                                ? "ap-history-feature-label"
                                : "ap-history-feature-label ap-history-feature-label--off"
                            }
                          >
                            {featureLabel(feature)}
                            {req.status === "APPROVED" && !granted.has(feature)
                              ? " (not granted)"
                              : ""}
                          </span>
                        </span>
                      ))
                    : req.requestedFeatures.map((feature) => (
                        <span key={feature} className="ap-feature-tag">
                          {featureLabel(feature)}
                        </span>
                      ))}
                </span>
              </div>

              <div className="ap-card-field">
                <span className="ap-card-label">Countries:</span>
                <span className="ap-card-value">
                  {req.country
                    .split(",")
                    .map((c) => c.trim())
                    .filter(Boolean)
                    .map((c) => (
                      <span key={c} className="ap-country-tag">
                        {c}
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
                    {req.reviewedBy} — {formatDateTime(req.reviewedAt)}
                  </span>
                </div>
              )}
            </div>

            <div className="ap-history-actions">
              {req.status === "PENDING" && (
                <>
                  <button
                    type="button"
                    className="ap-btn ap-btn--approve"
                    disabled={busy}
                    onClick={() => onOpenApproval(req)}
                  >
                    Approve…
                  </button>
                  <button
                    type="button"
                    className="ap-btn ap-btn--reject"
                    disabled={busy}
                    onClick={() => onReject(req)}
                  >
                    {busy ? "Rejecting…" : "Reject"}
                  </button>
                </>
              )}

              {req.status === "APPROVED" && (
                <button
                  type="button"
                  className="ap-btn ap-btn--revoke"
                  disabled={busy}
                  onClick={() => onRevoke(req)}
                >
                  {busy ? "Revoking…" : "Revoke all"}
                </button>
              )}

              {req.status === "REJECTED" && (
                <button
                  type="button"
                  className="ap-btn ap-btn--approve"
                  disabled={busy}
                  onClick={() => onOpenApproval(req)}
                >
                  Re-approve…
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
