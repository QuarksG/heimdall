// Shared admin action logic for access requests.
//
// This module is the single implementation of the admin data operations:
// per-feature approval, reject, full revoke, re-approve, and the toggle
// patch executor. Both the AdminPanel component and the entitlement tests
// drive these functions, so the logic under test is exactly the logic the
// UI executes.
//
// Invariant (rbac-entitlement-sync, generalized by
// granular-feature-entitlements): every action updates the AccessRequest
// record(s) FIRST, then delegates to the Entitlement_Sync, which recomputes
// the Entitlement as the union of effective granted features and countries
// across ALL of the user's APPROVED requests (upserting, or deleting when
// none remain). The sync derives only from persisted state, so a failure at
// any step leaves the system in a state the next sync call can repair.

import {
  isValidGrantedSubset,
  type RequestPatch,
} from "./entitlementCore";
import {
  syncEntitlement,
  syncEntitlementForUser,
  type EntitlementSyncClient,
  type SyncResult,
} from "./entitlementSync";

/** The admin performing the action (reviewer / grantor metadata). */
export type AdminUser = { email: string };

/** The request being acted on. Only the identifiers are needed - the
 *  entitlement payload is recomputed from the store, never from this arg. */
export type ActionTarget = { id: string; userId: string };

export type ActionResult = { ok: true } | { ok: false; error: unknown };

/** Client surface required by the admin actions: everything the
 *  entitlement sync needs, plus AccessRequest get/update. Structurally
 *  compatible with both the generated Amplify Data client and the
 *  in-memory MockDataClient used in tests. */
export type AdminActionsClient = EntitlementSyncClient & {
  models: {
    AccessRequest: {
      get(input: { id: string }): Promise<{
        data: {
          id?: string | null;
          userId?: string | null;
          status?: "PENDING" | "APPROVED" | "REJECTED" | null;
          requestedFeatures?: (string | null)[] | null;
          grantedFeatures?: (string | null)[] | null;
          reviewedBy?: string | null;
          reviewedAt?: string | null;
        } | null;
      }>;
      update(input: {
        id: string;
        status?: "PENDING" | "APPROVED" | "REJECTED";
        grantedFeatures?: string[];
        reviewedBy?: string;
        reviewedAt?: string;
      }): Promise<unknown>;
    };
  };
};

/* ─── Granular action results (tasks 6.1–6.3) ─── */

/** Why a granular admin action failed — lets the UI pick the right
 *  behavior (keep dialog open, show stale message, revert toggle, ...). */
export type AdminActionErrorKind =
  /** Zero features selected (Req 1.5). */
  | "invalid-selection"
  /** Selection contains a feature outside requestedFeatures (Req 2.8). */
  | "subset-violation"
  /** Request status changed since it was displayed (Req 1.8, 7.7). */
  | "stale-status"
  /** The AccessRequest write itself failed (Req 1.7). */
  | "persistence"
  /** The request write landed but the entitlement sync failed (Req 2.9, 7.5). */
  | "sync";

export type AdminActionOutcome =
  | { ok: true }
  | { ok: false; kind: AdminActionErrorKind; error: string };

function failure(
  kind: AdminActionErrorKind,
  error: unknown,
): AdminActionOutcome {
  return {
    ok: false,
    kind,
    error: error instanceof Error ? error.message : String(error),
  };
}

/** Target for the per-feature approval path: the identifiers plus what the
 *  panel displayed, so the pre-mutation guard can detect concurrent edits. */
export type ApprovalTarget = {
  id: string;
  userId: string;
  requestedFeatures: string[];
  /** Status shown to the admin when the dialog opened. */
  displayedStatus: "PENDING" | "APPROVED" | "REJECTED";
};

/**
 * Task 6.1 — per-feature approval (Req 1.3, 1.4, 1.7, 1.8, 2.8, 7.6, 7.7).
 * Also the re-approval path for REJECTED requests (Req 7.3): both flows are
 * identical once the selection is confirmed.
 *
 *   1. Validate: non-empty selection, and every selected feature is a member
 *      of requestedFeatures — reject with no write otherwise.
 *   2. Pre-mutation re-fetch guard: abort with "stale-status" if the
 *      persisted status differs from what was displayed.
 *   3. Persist grantedFeatures = selection, status APPROVED, reviewer
 *      identity and timestamp. A failure here leaves the request untouched
 *      (status stays PENDING/REJECTED) so the dialog can preserve the
 *      selection (Req 1.7).
 *   4. syncEntitlement — a failure here is surfaced as "sync" but the
 *      approval itself stands; the next successful sync self-heals (Req 2.9).
 */
export async function approveRequestWithFeatures(
  client: AdminActionsClient,
  target: ApprovalTarget,
  selection: string[],
  admin: AdminUser,
  now: string = new Date().toISOString(),
): Promise<AdminActionOutcome> {
  if (selection.length === 0) {
    return failure(
      "invalid-selection",
      "At least one feature must be selected.",
    );
  }
  if (!isValidGrantedSubset(selection, target.requestedFeatures)) {
    return failure(
      "subset-violation",
      "Granted features must be a subset of the requested features.",
    );
  }

  // Pre-mutation re-fetch guard (Req 1.8, 7.7).
  try {
    const { data: current } = await client.models.AccessRequest.get({
      id: target.id,
    });
    if (!current || (current.status ?? "PENDING") !== target.displayedStatus) {
      return failure(
        "stale-status",
        "This request has already been reviewed or its state has changed.",
      );
    }
  } catch (e) {
    return failure("persistence", e);
  }

  try {
    await client.models.AccessRequest.update({
      id: target.id,
      grantedFeatures: [...selection],
      status: "APPROVED",
      reviewedBy: admin.email,
      reviewedAt: now,
    });
  } catch (e) {
    // Nothing was written: status remains as displayed (Req 1.7).
    return failure("persistence", e);
  }

  const sync = await syncEntitlement(client, target.userId, admin.email, now);
  if (!sync.ok) return failure("sync", sync.error);

  return { ok: true };
}

/**
 * Task 6.2 — reject of a PENDING request (Req 7.1): status REJECTED plus
 * reviewer metadata; grantedFeatures stays empty (never granted). The sync
 * is called for uniformity — a PENDING request contributes nothing to the
 * union, so it is a no-op on the Entitlement record.
 */
export async function rejectPendingRequest(
  client: AdminActionsClient,
  target: ActionTarget,
  admin: AdminUser,
  now: string = new Date().toISOString(),
): Promise<AdminActionOutcome> {
  try {
    const { data: current } = await client.models.AccessRequest.get({
      id: target.id,
    });
    if (!current || (current.status ?? "PENDING") !== "PENDING") {
      return failure(
        "stale-status",
        "This request has already been reviewed or its state has changed.",
      );
    }
  } catch (e) {
    return failure("persistence", e);
  }

  try {
    await client.models.AccessRequest.update({
      id: target.id,
      status: "REJECTED",
      reviewedBy: admin.email,
      reviewedAt: now,
    });
  } catch (e) {
    return failure("persistence", e);
  }

  const sync = await syncEntitlement(client, target.userId, admin.email, now);
  if (!sync.ok) return failure("sync", sync.error);

  return { ok: true };
}

/**
 * Task 6.2 — full revoke of an APPROVED request (Req 7.2, 7.5): clears
 * grantedFeatures, sets REJECTED with reviewer metadata, then syncs. If the
 * SYNC fails, the request is restored to APPROVED with its prior
 * grantedFeatures so the persisted request state keeps matching the (still
 * prior) Entitlement record, and the sync failure is surfaced (Req 7.5).
 */
export async function revokeApprovedRequest(
  client: AdminActionsClient,
  target: ActionTarget,
  admin: AdminUser,
  now: string = new Date().toISOString(),
): Promise<AdminActionOutcome> {
  let priorGranted: string[] | null = null;
  let priorReviewedBy: string | undefined;
  let priorReviewedAt: string | undefined;

  try {
    const { data: current } = await client.models.AccessRequest.get({
      id: target.id,
    });
    if (!current || (current.status ?? "PENDING") !== "APPROVED") {
      return failure(
        "stale-status",
        "This request has already been reviewed or its state has changed.",
      );
    }
    priorGranted =
      current.grantedFeatures == null
        ? null
        : current.grantedFeatures.filter((f): f is string => f != null);
    priorReviewedBy = current.reviewedBy ?? undefined;
    priorReviewedAt = current.reviewedAt ?? undefined;
  } catch (e) {
    return failure("persistence", e);
  }

  try {
    await client.models.AccessRequest.update({
      id: target.id,
      grantedFeatures: [],
      status: "REJECTED",
      reviewedBy: admin.email,
      reviewedAt: now,
    });
  } catch (e) {
    return failure("persistence", e);
  }

  const sync = await syncEntitlement(client, target.userId, admin.email, now);
  if (!sync.ok) {
    // Restore the request to APPROVED with its prior grants so the request
    // store keeps matching the unchanged Entitlement record (Req 7.5).
    // A legacy record (priorGranted === null) is restored by omitting the
    // grantedFeatures field, preserving its legacy interpretation.
    try {
      await client.models.AccessRequest.update({
        id: target.id,
        ...(priorGranted !== null ? { grantedFeatures: priorGranted } : {}),
        status: "APPROVED",
        reviewedBy: priorReviewedBy ?? admin.email,
        reviewedAt: priorReviewedAt ?? now,
      });
    } catch (restoreError) {
      // The next successful sync self-heals; report the original failure.
      console.error(
        "[adminActions] revoke restore failed:",
        restoreError,
      );
    }
    return failure("sync", sync.error);
  }

  return { ok: true };
}

/* ─── Toggle patch executor (task 6.3) ─── */

/** Identifies the toggle action for error reporting (Req 3.6, 8.6). */
export type PatchContext = {
  userId: string;
  /** Shown in error messages naming the affected user. */
  userLabel: string;
  /** Shown in error messages naming the affected feature. */
  feature: string;
};

export type PatchExecutionReport = {
  ok: boolean;
  /** requestIds whose patch was persisted before any failure/timeout. */
  appliedRequestIds: string[];
  /** Present when ok is false. */
  error?: string;
  /** Result of the syncEntitlement run that ALWAYS follows execution, so
   *  the Entitlement reflects whatever was persisted (Req 8.6). */
  sync: SyncResult;
};

class PatchTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Toggle change did not complete within ${timeoutMs / 1000} seconds.`);
    this.name = "PatchTimeoutError";
  }
}

/**
 * Task 6.3 — applies a RequestPatch[] sequentially (one request at a time),
 * setting reviewer metadata where flagged, with the whole sequence raced
 * against a timeout (10 seconds by default, Req 3.6).
 *
 * On failure or timeout mid-sequence: the report names the affected user and
 * feature, `syncEntitlement` still runs so the Entitlement reflects whatever
 * was actually persisted, and `appliedRequestIds` tells the UI which patches
 * landed so it can reconcile against persisted-derived state (Req 8.6).
 */
export async function executeRequestPatches(
  client: AdminActionsClient,
  context: PatchContext,
  patches: RequestPatch[],
  admin: AdminUser,
  now: string = new Date().toISOString(),
  timeoutMs = 10_000,
): Promise<PatchExecutionReport> {
  const appliedRequestIds: string[] = [];

  const applyAll = async (): Promise<void> => {
    for (const patch of patches) {
      await client.models.AccessRequest.update({
        id: patch.requestId,
        grantedFeatures: [...patch.grantedFeatures],
        status: patch.status,
        ...(patch.setReviewMetadata
          ? { reviewedBy: admin.email, reviewedAt: now }
          : {}),
      });
      appliedRequestIds.push(patch.requestId);
    }
  };

  let executionError: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      applyAll(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new PatchTimeoutError(timeoutMs)),
          timeoutMs,
        );
      }),
    ]);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    executionError =
      `Failed to update feature "${context.feature}" for ` +
      `${context.userLabel}: ${detail}`;
  } finally {
    clearTimeout(timer);
  }

  // ALWAYS sync so the Entitlement reflects whatever was persisted, even
  // after a partial fan-out failure (Req 8.6).
  const sync = await syncEntitlement(client, context.userId, admin.email, now);

  if (executionError) {
    return { ok: false, appliedRequestIds, error: executionError, sync };
  }
  if (!sync.ok) {
    return {
      ok: false,
      appliedRequestIds,
      error:
        `Entitlement sync failed after updating feature ` +
        `"${context.feature}" for ${context.userLabel}: ${sync.error}`,
      sync,
    };
  }
  return { ok: true, appliedRequestIds, sync };
}

/* ─── Legacy whole-request actions (rbac-entitlement-sync) ───
   Kept for the existing entitlement test suite and any callers not yet
   migrated to the granular paths above. */

/**
 * Approve (or re-approve) an access request in full:
 *   1. AccessRequest.update -> APPROVED with reviewer metadata
 *   2. syncEntitlementForUser -> Entitlement upserted to the union of all
 *      of the user's APPROVED requests
 */
export async function approveRequest(
  client: AdminActionsClient,
  req: ActionTarget,
  user: AdminUser,
  now: string = new Date().toISOString(),
): Promise<ActionResult> {
  try {
    await client.models.AccessRequest.update({
      id: req.id,
      status: "APPROVED",
      reviewedBy: user.email,
      reviewedAt: now,
    });

    await syncEntitlementForUser(client, req.userId, user.email, now);

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e };
  }
}

/**
 * Reject a PENDING access request: updates only the request status.
 * No Entitlement operations occur on this path (Req 3.2).
 */
export async function rejectRequest(
  client: AdminActionsClient,
  req: ActionTarget,
  user: AdminUser,
  now: string = new Date().toISOString(),
): Promise<ActionResult> {
  try {
    await client.models.AccessRequest.update({
      id: req.id,
      status: "REJECTED",
      reviewedBy: user.email,
      reviewedAt: now,
    });

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e };
  }
}

/**
 * Revoke an APPROVED access request:
 *   1. AccessRequest.update -> REJECTED with reviewer metadata (FIRST, so
 *      the sync sees the post-action approved set)
 *   2. syncEntitlementForUser -> Entitlement updated to the remaining
 *      union, or deleted only when no APPROVED requests remain
 */
export async function revokeRequest(
  client: AdminActionsClient,
  req: ActionTarget,
  user: AdminUser,
  now: string = new Date().toISOString(),
): Promise<ActionResult> {
  try {
    await client.models.AccessRequest.update({
      id: req.id,
      status: "REJECTED",
      reviewedBy: user.email,
      reviewedAt: now,
    });

    await syncEntitlementForUser(client, req.userId, user.email, now);

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e };
  }
}
