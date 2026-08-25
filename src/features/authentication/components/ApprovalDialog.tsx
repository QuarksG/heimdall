// src/features/authentication/components/ApprovalDialog.tsx
//
// Per-feature approval dialog (Req 1.1–1.5, 1.7, 1.8, 7.3). Used for both
// PENDING approvals and re-approval of REJECTED requests — the caller wires
// `onConfirm` to the approveRequestWithFeatures action (task 6.1).
//
// Behavior:
//   - one checkbox per requested feature, ALL preselected (Req 1.1, 1.2)
//   - confirm disabled at zero selections, with an inline "at least one
//     feature must be selected" message (Req 1.5)
//   - on persistence failure: dialog stays open, selection preserved,
//     error shown (Req 1.7)
//   - on stale status: the already-reviewed message is shown and confirm
//     is disabled (Req 1.8, 7.7)

import { useState } from "react";
import type { RequestSnapshot } from "../services/entitlementCore";
import type { AdminActionOutcome } from "../services/adminActions";
import { featureLabel } from "../constants/features";
import "../styles/admin-panel.css";

export type ApprovalDialogProps = {
  request: RequestSnapshot;
  /** Wired to approveRequestWithFeatures; the dialog interprets the outcome. */
  onConfirm: (selection: string[]) => Promise<AdminActionOutcome>;
  /** Called on cancel/close, and after a successful confirm. */
  onClose: () => void;
};

export default function ApprovalDialog({
  request,
  onConfirm,
  onClose,
}: ApprovalDialogProps) {
  // Req 1.2 — every requested feature preselected.
  const [selection, setSelection] = useState<Set<string>>(
    () => new Set(request.requestedFeatures),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  const zeroSelected = selection.size === 0;

  const toggleFeature = (feature: string) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(feature)) next.delete(feature);
      else next.add(feature);
      return next;
    });
  };

  const handleConfirm = async () => {
    if (zeroSelected || busy || stale) return;
    setBusy(true);
    setError(null);

    const outcome = await onConfirm([...selection]);

    if (outcome.ok) {
      onClose();
      return;
    }

    // Failure: dialog stays open with the selection preserved (Req 1.7).
    if (outcome.kind === "stale-status") {
      setStale(true);
      setError(
        "This request has already been reviewed or its state has changed.",
      );
    } else if (outcome.kind === "sync") {
      setError(
        `The approval was saved, but the entitlement sync failed: ${outcome.error}`,
      );
    } else {
      setError(`The approval was not saved: ${outcome.error}`);
    }
    setBusy(false);
  };

  const isReapproval = request.status === "REJECTED";

  return (
    <div className="ap-dialog-overlay" onClick={onClose}>
      <div
        className="ap-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ap-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="ap-dialog-title" className="ap-dialog-title">
          {isReapproval ? "Re-approve request" : "Approve request"}
        </h3>
        <p className="ap-dialog-subtitle">
          {request.fullName} ({request.email}) — select the features to grant.
        </p>

        <div className="ap-dialog-features">
          {request.requestedFeatures.map((feature) => (
            <label key={feature} className="ap-dialog-feature">
              <input
                type="checkbox"
                checked={selection.has(feature)}
                disabled={busy || stale}
                onChange={() => toggleFeature(feature)}
              />
              <span>{featureLabel(feature)}</span>
            </label>
          ))}
        </div>

        {zeroSelected && (
          <p className="ap-dialog-warning" role="alert">
            At least one feature must be selected.
          </p>
        )}

        {error && (
          <p className="ap-dialog-error" role="alert">
            {error}
          </p>
        )}

        <div className="ap-dialog-actions">
          <button
            type="button"
            className="ap-btn ap-btn--secondary"
            onClick={onClose}
            disabled={busy}
          >
            {stale ? "Close" : "Cancel"}
          </button>
          <button
            type="button"
            className="ap-btn ap-btn--approve"
            disabled={zeroSelected || busy || stale}
            onClick={handleConfirm}
          >
            {busy
              ? "Saving…"
              : selection.size === request.requestedFeatures.length
                ? "Approve all"
                : `Approve ${selection.size} feature${selection.size === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
