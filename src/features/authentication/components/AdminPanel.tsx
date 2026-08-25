// src/features/authentication/components/AdminPanel.tsx
//
// User-grouped Access Request Management (granular-feature-entitlements).
//
// Requests are grouped into one UserCard per user (Req 8.1) via the pure
// groupRequestsByUser. The UserCard's per-feature toggles are the primary
// surface for adjusting access; the expandable RequestHistory is the
// secondary, per-request surface (Req 3.11). Status filter tabs show the
// UserCards of users with >=1 matching request, and counts count USERS,
// not requests (Req 8.9, 8.10).
//
// Every toggle change flows: pure planner (planRequestToggle /
// planUserToggleOff / planUserToggleOn) -> executeRequestPatches (sequential
// persistence raced against a 10s timeout, always followed by
// syncEntitlement) -> re-fetch to reconcile UI state from persisted data
// (Req 3.2–3.6, 8.4–8.6). While persisting, only the affected toggle is
// disabled with a pending spinner; a second change to the same feature is
// ignored until the first settles (Req 3.5, 3.12).

import { useCallback, useEffect, useMemo, useState } from "react";
import { generateClient } from "aws-amplify/data";
import { useAuth } from "../context/AuthContext";
import type { Schema } from "../../../../amplify/data/resource";
import {
  groupRequestsByUser,
  planRequestToggle,
  planUserToggleOff,
  planUserToggleOn,
  type RequestSnapshot,
  type UserGroup,
} from "../services/entitlementCore";
import {
  approveRequestWithFeatures,
  executeRequestPatches,
  rejectPendingRequest,
  revokeApprovedRequest,
  type AdminActionsClient,
} from "../services/adminActions";
import ApprovalDialog from "./ApprovalDialog";
import UserCard from "./UserCard";
import "../styles/admin-panel.css";

const client = generateClient<Schema>() as unknown as AdminActionsClient & {
  models: {
    AccessRequest: {
      list(args?: { nextToken?: string | null }): Promise<{
        data: Array<{
          id: string;
          userId: string;
          email: string;
          fullName: string;
          country: string;
          requestedFeatures: (string | null)[];
          grantedFeatures?: (string | null)[] | null;
          justification?: string | null;
          status?: "PENDING" | "APPROVED" | "REJECTED" | null;
          reviewedBy?: string | null;
          reviewedAt?: string | null;
          createdAt?: string | null;
        }>;
        nextToken?: string | null;
      }>;
    };
  };
};

type TabFilter = "ALL" | "PENDING" | "APPROVED" | "REJECTED";

const TABS: TabFilter[] = ["PENDING", "APPROVED", "REJECTED", "ALL"];

export default function AdminPanel() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<RequestSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<TabFilter>("PENDING");

  /** Toggle keys currently persisting: `user:${userId}:${feature}` and
   *  `req:${requestId}:${feature}` (Req 3.5). */
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(
    new Set(),
  );
  /** Request ids with a busy reject/revoke button. */
  const [busyRequestIds, setBusyRequestIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  /** Per-feature approval dialog target (PENDING approve / REJECTED
   *  re-approve, Req 1.1, 7.3). */
  const [dialogTarget, setDialogTarget] = useState<RequestSnapshot | null>(
    null,
  );

  /* ── Fetch all access requests (paginated) and map to snapshots ── */
  const fetchRequests = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const all: RequestSnapshot[] = [];
      let nextToken: string | null | undefined = undefined;
      do {
        const page = await client.models.AccessRequest.list({
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
            justification: item.justification,
            status: item.status ?? "PENDING",
            reviewedBy: item.reviewedBy,
            reviewedAt: item.reviewedAt,
            createdAt: item.createdAt,
          });
        }
        nextToken = page.nextToken ?? null;
      } while (nextToken);
      setRequests(all);
      setErr(null);
    } catch (e) {
      console.error("[AdminPanel] fetch error:", e);
      setErr("Failed to load access requests.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRequests();
  }, [fetchRequests]);

  /* ── Grouping and status filter (Req 8.1, 8.9, 8.10) ── */
  const groups = useMemo(() => groupRequestsByUser(requests), [requests]);

  const counts = useMemo(() => {
    const byStatus = (status: RequestSnapshot["status"]) =>
      groups.filter((g) => g.requests.some((r) => r.status === status)).length;
    return {
      ALL: groups.length,
      PENDING: byStatus("PENDING"),
      APPROVED: byStatus("APPROVED"),
      REJECTED: byStatus("REJECTED"),
    };
  }, [groups]);

  const filteredGroups = useMemo(() => {
    if (tab === "ALL") return groups;
    return groups.filter((g) => g.requests.some((r) => r.status === tab));
  }, [groups, tab]);

  /* ── Pending-key helpers ── */
  const addKey = (
    setter: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>,
    key: string,
  ) => setter((prev) => new Set(prev).add(key));
  const removeKey = (
    setter: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>,
    key: string,
  ) =>
    setter((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });

  /* ── Toggle handlers (task 9.7) ── */

  /** Shared tail: run the executor, surface errors naming user and feature
   *  (Req 3.6, 8.6), then re-fetch so the UI reconciles to the
   *  persisted-derived state whether the change succeeded or not. */
  const runPatches = async (
    group: { userId: string; email: string },
    feature: string,
    patches: ReturnType<typeof planRequestToggle>[],
  ) => {
    if (!user) return;
    const report = await executeRequestPatches(
      client,
      { userId: group.userId, userLabel: group.email, feature },
      patches,
      { email: user.email },
    );
    if (!report.ok) setErr(report.error ?? "Toggle change failed.");
    else setErr(null);
    // Reconcile from persisted data — this reverts the toggle on failure
    // and confirms it on success (Req 3.6, 8.6).
    await fetchRequests(true);
  };

  /** UserCard toggle (Req 8.4, 8.5): fan-out on OFF, fan-in on ON. */
  const handleUserToggle = async (
    group: UserGroup,
    feature: string,
    next: boolean,
  ) => {
    const key = `user:${group.userId}:${feature}`;
    if (pendingKeys.has(key)) return; // ignore until the first settles
    const patches = next
      ? (() => {
          const patch = planUserToggleOn(group, feature);
          return patch ? [patch] : [];
        })()
      : planUserToggleOff(group, feature);
    if (patches.length === 0) return;

    addKey(setPendingKeys, key);
    try {
      await runPatches(group, feature, patches);
    } finally {
      removeKey(setPendingKeys, key);
    }
  };

  /** RequestHistory toggle (Req 3.2–3.4, 3.10): single-request patch. */
  const handleRequestToggle = async (
    req: RequestSnapshot,
    feature: string,
    next: boolean,
  ) => {
    const key = `req:${req.id}:${feature}`;
    if (pendingKeys.has(key)) return;
    const patch = planRequestToggle(req, feature, next);

    addKey(setPendingKeys, key);
    try {
      await runPatches({ userId: req.userId, email: req.email }, feature, [
        patch,
      ]);
    } finally {
      removeKey(setPendingKeys, key);
    }
  };

  /* ── Review actions ── */

  const handleReject = async (req: RequestSnapshot) => {
    if (!user) return;
    addKey(setBusyRequestIds, req.id);
    const outcome = await rejectPendingRequest(
      client,
      { id: req.id, userId: req.userId },
      { email: user.email },
    );
    if (!outcome.ok) {
      setErr(
        outcome.kind === "stale-status"
          ? `The request from ${req.email} has already been reviewed or changed.`
          : `Failed to reject the request from ${req.email}: ${outcome.error}`,
      );
    } else {
      setErr(null);
    }
    await fetchRequests(true);
    removeKey(setBusyRequestIds, req.id);
  };

  const handleRevoke = async (req: RequestSnapshot) => {
    if (!user) return;
    addKey(setBusyRequestIds, req.id);
    const outcome = await revokeApprovedRequest(
      client,
      { id: req.id, userId: req.userId },
      { email: user.email },
    );
    if (!outcome.ok) {
      setErr(
        outcome.kind === "sync"
          ? `Entitlement sync failed while revoking access for ${req.email}; the request was restored.`
          : outcome.kind === "stale-status"
            ? `The request from ${req.email} has already been reviewed or changed.`
            : `Failed to revoke access for ${req.email}: ${outcome.error}`,
      );
    } else {
      setErr(null);
    }
    await fetchRequests(true);
    removeKey(setBusyRequestIds, req.id);
  };

  /** ApprovalDialog confirm — task 6.1 per-feature approval path, used for
   *  PENDING approvals and REJECTED re-approvals alike (Req 7.3). */
  const handleApprovalConfirm = async (selection: string[]) => {
    if (!user || !dialogTarget) {
      return {
        ok: false as const,
        kind: "persistence" as const,
        error: "No signed-in admin.",
      };
    }
    const outcome = await approveRequestWithFeatures(
      client,
      {
        id: dialogTarget.id,
        userId: dialogTarget.userId,
        requestedFeatures: dialogTarget.requestedFeatures,
        displayedStatus: dialogTarget.status,
      },
      selection,
      { email: user.email },
    );
    if (outcome.ok) await fetchRequests(true);
    return outcome;
  };

  return (
    <div className="ap-container">
      <div className="ap-header">
        <h2>Access Request Management</h2>
        <p className="ap-subtitle">
          Manage each user's feature access with per-feature toggles; expand a
          card for the full request history.
        </p>
      </div>

      {/* ── Status filter tabs — counts count users (Req 8.9, 8.10) ── */}
      <div className="ap-tabs">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            className={`ap-tab ${tab === t ? "ap-tab--active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t}
            <span className="ap-tab-count">{counts[t]}</span>
          </button>
        ))}

        <button
          type="button"
          className="ap-refresh-btn"
          onClick={() => fetchRequests()}
          title="Refresh"
        >
          <i className="ph-bold ph-arrows-clockwise" />
        </button>
      </div>

      {err && (
        <div className="ap-alert ap-alert--error" role="alert">
          {err}
        </div>
      )}

      {loading && (
        <div className="ap-loading">
          <span className="ap-spinner" /> Loading requests&hellip;
        </div>
      )}

      {!loading && filteredGroups.length === 0 && (
        <div className="ap-empty">
          No users with {tab === "ALL" ? "" : `${tab.toLowerCase()} `}requests
          found.
        </div>
      )}

      {/* ── One UserCard per user (Req 8.1) ── */}
      <div className="ap-list">
        {filteredGroups.map((group) => (
          <UserCard
            key={group.userId}
            group={group}
            pendingKeys={pendingKeys}
            busyRequestIds={busyRequestIds}
            onUserToggle={handleUserToggle}
            onRequestToggle={handleRequestToggle}
            onOpenApproval={setDialogTarget}
            onReject={handleReject}
            onRevoke={handleRevoke}
          />
        ))}
      </div>

      {dialogTarget && (
        <ApprovalDialog
          request={dialogTarget}
          onConfirm={handleApprovalConfirm}
          onClose={() => setDialogTarget(null)}
        />
      )}
    </div>
  );
}
