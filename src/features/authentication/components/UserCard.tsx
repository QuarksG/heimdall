// src/features/authentication/components/UserCard.tsx
//
// One card per user (Req 8.1): fullName/email header, pending badge
// (Req 8.8), APPROVED-country union chips (Req 8.3), and one FeatureToggle
// per feature in the requested union — on iff the feature is in the user's
// Entitlement_Union (Req 8.2). This is the PRIMARY surface for adjusting a
// user's access (Req 3.11); the expandable RequestHistory is the secondary,
// per-request surface (Req 8.7).

import { useState } from "react";
import type { RequestSnapshot, UserGroup } from "../services/entitlementCore";
import { featureLabel } from "../constants/features";
import FeatureToggle from "./FeatureToggle";
import RequestHistory from "./RequestHistory";

export type UserCardProps = {
  group: UserGroup;
  /** `user:${userId}:${feature}` and `req:${requestId}:${feature}` keys
   *  currently persisting (Req 3.5, 3.12). */
  pendingKeys: ReadonlySet<string>;
  busyRequestIds: ReadonlySet<string>;
  onUserToggle: (group: UserGroup, feature: string, next: boolean) => void;
  onRequestToggle: (
    req: RequestSnapshot,
    feature: string,
    next: boolean,
  ) => void;
  onOpenApproval: (req: RequestSnapshot) => void;
  onReject: (req: RequestSnapshot) => void;
  onRevoke: (req: RequestSnapshot) => void;
};

export default function UserCard({
  group,
  pendingKeys,
  busyRequestIds,
  onUserToggle,
  onRequestToggle,
  onOpenApproval,
  onReject,
  onRevoke,
}: UserCardProps) {
  const [historyOpen, setHistoryOpen] = useState(false);

  const entitled = new Set(group.entitlementUnion.allowedFeatures);

  return (
    <div className="ap-card ap-user-card">
      <div className="ap-card-header">
        <div>
          <span className="ap-card-name">{group.fullName}</span>
          <span className="ap-card-email">{group.email}</span>
        </div>
        {group.hasPending && (
          <span className="ap-badge ap-badge--pending">Pending review</span>
        )}
      </div>

      <div className="ap-card-body">
        {group.entitlementUnion.countries.length > 0 && (
          <div className="ap-card-field">
            <span className="ap-card-label">Countries:</span>
            <span className="ap-card-value">
              {group.entitlementUnion.countries.map((c) => (
                <span key={c} className="ap-country-tag">
                  {c}
                </span>
              ))}
            </span>
          </div>
        )}

        {/* Primary toggle surface (Req 8.2): one toggle per feature in the
            requested union, ON iff it is in the Entitlement_Union. */}
        <div className="ap-user-toggles">
          {group.requestedUnion.map((feature) => (
            <div key={feature} className="ap-user-toggle-row">
              <span className="ap-user-toggle-label">
                {featureLabel(feature)}
              </span>
              <FeatureToggle
                featureId={feature}
                label={`${featureLabel(feature)} for ${group.email}`}
                checked={entitled.has(feature)}
                pending={pendingKeys.has(`user:${group.userId}:${feature}`)}
                onChange={(next) => onUserToggle(group, feature, next)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Expandable per-request audit history (Req 8.7). */}
      <button
        type="button"
        className="ap-history-toggle"
        aria-expanded={historyOpen}
        onClick={() => setHistoryOpen((open) => !open)}
      >
        {historyOpen ? "Hide" : "Show"} request history ({group.requests.length})
      </button>

      {historyOpen && (
        <RequestHistory
          requests={group.requests}
          pendingKeys={pendingKeys}
          busyRequestIds={busyRequestIds}
          onToggle={onRequestToggle}
          onOpenApproval={onOpenApproval}
          onReject={onReject}
          onRevoke={onRevoke}
        />
      )}
    </div>
  );
}
