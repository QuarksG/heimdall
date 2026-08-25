// Testable extraction of the CURRENT (unfixed) admin action logic from
// src/features/authentication/components/AdminPanel.tsx.
//
// This module replicates the data operations of `handleApprove` and
// `handleRevoke` exactly as they exist inline in the component today,
// driven by an injected (mockable) data client instead of the module-level
// generated client. React state updates (setRequests/setActionBusy/setErr)
// are omitted; the try/catch error-swallowing behavior is preserved because
// it is observable (a failed Entitlement.create does not roll back the
// AccessRequest.update that preceded it).
//
// DO NOT add union/upsert logic here - this file intentionally encodes the
// buggy behavior so the bug condition exploration tests exercise it.
//
// SUPERSEDED (task 3.2): AdminPanel and the property tests now use the
// FIXED shared handlers in ../adminActions.ts. This file is kept only as a
// reference record of the pre-fix behavior the exploration tests failed
// against; nothing imports it anymore.

import type {
  AccessRequestRecord,
  MockDataClient,
} from "./mockAmplifyDataClient";

export type AdminUser = { email: string };

export type ActionResult =
  | { ok: true }
  | { ok: false; error: unknown };

/**
 * Mirrors AdminPanel.handleApprove:
 *   1. AccessRequest.update -> APPROVED with reviewer metadata
 *   2. Entitlement.create with ONLY this request's features/countries
 * Errors are caught (the component sets an error banner and moves on).
 * The Re-approve button reuses this same handler.
 */
export async function handleApproveCurrent(
  client: MockDataClient,
  req: AccessRequestRecord,
  user: AdminUser,
  now: string = new Date().toISOString(),
): Promise<ActionResult> {
  try {
    // 1. Update AccessRequest status
    await client.models.AccessRequest.update({
      id: req.id,
      status: "APPROVED",
      reviewedBy: user.email,
      reviewedAt: now,
    });

    // 2. Create Entitlement record (create-only, single-request payload)
    await client.models.Entitlement.create({
      userId: req.userId,
      country: req.country,
      allowedFeatures: req.requestedFeatures,
      grantedBy: user.email,
      grantedAt: now,
    });

    return { ok: true };
  } catch (e) {
    // AdminPanel catches and surfaces this as an error banner; the
    // AccessRequest.update above is NOT rolled back.
    return { ok: false, error: e };
  }
}

/**
 * Mirrors AdminPanel.handleRevoke:
 *   1. Entitlement.delete({ userId }) - unconditional
 *   2. AccessRequest.update -> REJECTED with reviewer metadata
 */
export async function handleRevokeCurrent(
  client: MockDataClient,
  req: AccessRequestRecord,
  user: AdminUser,
  now: string = new Date().toISOString(),
): Promise<ActionResult> {
  try {
    // Delete entitlement (regardless of other APPROVED requests)
    await client.models.Entitlement.delete({ userId: req.userId });

    // Update request status
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
 * Mirrors AdminPanel.handleReject:
 *   1. AccessRequest.update -> REJECTED with reviewer metadata
 * No Entitlement operations occur on this path (rejecting a PENDING
 * request never touches the Entitlement table).
 */
export async function handleRejectCurrent(
  client: MockDataClient,
  req: AccessRequestRecord,
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
