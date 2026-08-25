// Integration tests for multi-request entitlement flows (task 4.2).
//
// Drives the FIXED shared admin action handlers (approveRequest /
// revokeRequest - the same functions AdminPanel executes) end-to-end
// against the mocked in-memory Amplify Data client, and asserts:
//
//   1. Full flow: two PENDING requests -> approve both -> revoke one ->
//      revoke the other. The Entitlement transitions
//      union -> partial union -> deleted, and request statuses plus
//      reviewer metadata (reviewedBy/reviewedAt) track each action.
//   2. Re-approve flow: approve -> revoke -> re-approve the same request
//      (re-approve reuses approveRequest) restores the correct union.
//   3. Claim shape: the Entitlement record produced by the sync retains
//      the exact field shapes (`country`: string, `allowedFeatures`:
//      string array) that the pre-token-generation Lambda
//      (amplify/auth/pre-token-generation/handler.ts) reads to build the
//      `custom:entitlements` claim.
//
// **Validates: Requirements 2.5, 3.4, 3.5**

import { describe, it, expect } from "vitest";
import { approveRequest, rejectRequest, revokeRequest } from "../adminActions";
import {
  createMockDataClient,
  type AccessRequestRecord,
  type MockStore,
} from "./mockAmplifyDataClient";

// userId is the Cognito sub, matching the Entitlement primary key (Req 3.4).
const COGNITO_SUB = "cognito-sub-integration-user";
const ADMIN = { email: "admin@heimdall.test" };

const T1 = "2025-03-01T10:00:00.000Z";
const T2 = "2025-03-01T11:00:00.000Z";
const T3 = "2025-03-01T12:00:00.000Z";
const T4 = "2025-03-01T13:00:00.000Z";

/** Seeds a PENDING AccessRequest, simulating a user-submitted request
 *  whose userId is the Cognito sub (Req 3.4). */
function submitRequest(
  store: MockStore,
  overrides: Partial<AccessRequestRecord> & { id: string },
): AccessRequestRecord {
  const record: AccessRequestRecord = {
    userId: COGNITO_SUB,
    email: "user@heimdall.test",
    fullName: "Integration User",
    country: "TR",
    requestedFeatures: ["reports"],
    justification: null,
    status: "PENDING",
    reviewedBy: null,
    reviewedAt: null,
    createdAt: "2025-02-28T00:00:00.000Z",
    ...overrides,
  };
  store.seedAccessRequest(record);
  return record;
}

describe("multi-request integration flows", () => {
  it("full flow: approve both, revoke one, revoke the other (union -> partial union -> deleted)", async () => {
    const store = createMockDataClient();
    const reqA = submitRequest(store, {
      id: "req-a",
      requestedFeatures: ["reports"],
      country: "TR",
    });
    const reqB = submitRequest(store, {
      id: "req-b",
      requestedFeatures: ["exports", "reports"],
      country: "TR,DE",
    });

    // Both submitted requests carry the Cognito sub as userId (Req 3.4).
    expect(store.getAccessRequest("req-a")?.userId).toBe(COGNITO_SUB);
    expect(store.getAccessRequest("req-b")?.userId).toBe(COGNITO_SUB);

    // ── Approve A: entitlement = A's contribution ──
    const approveA = await approveRequest(store.client, reqA, ADMIN, T1);
    expect(approveA).toEqual({ ok: true });

    expect(store.getAccessRequest("req-a")).toMatchObject({
      status: "APPROVED",
      reviewedBy: ADMIN.email,
      reviewedAt: T1,
    });
    expect(store.getAccessRequest("req-b")).toMatchObject({
      status: "PENDING",
      reviewedBy: null,
      reviewedAt: null,
    });
    expect(store.getEntitlement(COGNITO_SUB)).toEqual({
      userId: COGNITO_SUB,
      country: "TR",
      allowedFeatures: ["reports"],
      grantedBy: ADMIN.email,
      grantedAt: T1,
    });

    // ── Approve B: entitlement = union of A and B ──
    const approveB = await approveRequest(store.client, reqB, ADMIN, T2);
    expect(approveB).toEqual({ ok: true });

    expect(store.getAccessRequest("req-b")).toMatchObject({
      status: "APPROVED",
      reviewedBy: ADMIN.email,
      reviewedAt: T2,
    });
    expect(store.getEntitlement(COGNITO_SUB)).toEqual({
      userId: COGNITO_SUB,
      country: "DE,TR",
      allowedFeatures: ["exports", "reports"],
      grantedBy: ADMIN.email,
      grantedAt: T2,
    });

    // ── Revoke A: entitlement = B's remaining contribution (partial union) ──
    const revokeA = await revokeRequest(store.client, reqA, ADMIN, T3);
    expect(revokeA).toEqual({ ok: true });

    expect(store.getAccessRequest("req-a")).toMatchObject({
      status: "REJECTED",
      reviewedBy: ADMIN.email,
      reviewedAt: T3,
    });
    expect(store.getAccessRequest("req-b")).toMatchObject({
      status: "APPROVED",
      reviewedBy: ADMIN.email,
      reviewedAt: T2,
    });
    expect(store.getEntitlement(COGNITO_SUB)).toEqual({
      userId: COGNITO_SUB,
      country: "DE,TR",
      allowedFeatures: ["exports", "reports"],
      grantedBy: ADMIN.email,
      grantedAt: T3,
    });

    // ── Revoke B: no approved requests remain, entitlement deleted ──
    const revokeB = await revokeRequest(store.client, reqB, ADMIN, T4);
    expect(revokeB).toEqual({ ok: true });

    expect(store.getAccessRequest("req-b")).toMatchObject({
      status: "REJECTED",
      reviewedBy: ADMIN.email,
      reviewedAt: T4,
    });
    expect(store.getEntitlement(COGNITO_SUB)).toBeUndefined();
  });

  it("re-approve flow: approve, revoke, re-approve the same request restores the union", async () => {
    const store = createMockDataClient();
    const reqA = submitRequest(store, {
      id: "req-a",
      requestedFeatures: ["reports"],
      country: "TR",
    });
    const reqB = submitRequest(store, {
      id: "req-b",
      requestedFeatures: ["exports"],
      country: "DE",
    });

    // Approve both so B's revoke leaves a partial union behind.
    await approveRequest(store.client, reqA, ADMIN, T1);
    await approveRequest(store.client, reqB, ADMIN, T1);
    expect(store.getEntitlement(COGNITO_SUB)).toMatchObject({
      country: "DE,TR",
      allowedFeatures: ["exports", "reports"],
    });

    // Revoke B: entitlement shrinks to A's contribution.
    await revokeRequest(store.client, reqB, ADMIN, T2);
    expect(store.getAccessRequest("req-b")?.status).toBe("REJECTED");
    expect(store.getEntitlement(COGNITO_SUB)).toMatchObject({
      country: "TR",
      allowedFeatures: ["reports"],
    });

    // Re-approve B (the Re-approve button reuses approveRequest):
    // entitlement is restored to the full union.
    const reapprove = await approveRequest(store.client, reqB, ADMIN, T3);
    expect(reapprove).toEqual({ ok: true });

    expect(store.getAccessRequest("req-b")).toMatchObject({
      status: "APPROVED",
      reviewedBy: ADMIN.email,
      reviewedAt: T3,
    });
    expect(store.getEntitlement(COGNITO_SUB)).toEqual({
      userId: COGNITO_SUB,
      country: "DE,TR",
      allowedFeatures: ["exports", "reports"],
      grantedBy: ADMIN.email,
      grantedAt: T3,
    });
  });

  it("keeps the Entitlement field shapes the pre-token-generation Lambda reads", async () => {
    const store = createMockDataClient();
    const reqA = submitRequest(store, {
      id: "req-a",
      requestedFeatures: ["reports", "exports"],
      country: "TR,DE",
    });
    const reqB = submitRequest(store, {
      id: "req-b",
      requestedFeatures: ["billing"],
      country: "FR",
    });

    await approveRequest(store.client, reqA, ADMIN, T1);
    await approveRequest(store.client, reqB, ADMIN, T2);

    const entitlement = store.getEntitlement(COGNITO_SUB);
    expect(entitlement).toBeDefined();

    // The Lambda reads the record by userId (the Cognito sub) and checks
    // `typeof item.country === "string"` and
    // `Array.isArray(item.allowedFeatures)` before building the claim.
    expect(entitlement!.userId).toBe(COGNITO_SUB);
    expect(typeof entitlement!.country).toBe("string");
    expect(Array.isArray(entitlement!.allowedFeatures)).toBe(true);
    for (const feature of entitlement!.allowedFeatures) {
      expect(typeof feature).toBe("string");
    }

    // Mirror the Lambda's claim construction to confirm the record
    // round-trips into the exact `custom:entitlements` JSON shape.
    const claim = JSON.stringify({
      country: entitlement!.country,
      allowedFeatures: entitlement!.allowedFeatures,
    });
    expect(JSON.parse(claim)).toEqual({
      country: "DE,FR,TR",
      allowedFeatures: ["billing", "exports", "reports"],
    });
  });

  it("rejecting a PENDING request mid-flow never touches the Entitlement table", async () => {
    const store = createMockDataClient();
    const reqA = submitRequest(store, {
      id: "req-a",
      requestedFeatures: ["reports"],
      country: "TR",
    });
    const reqB = submitRequest(store, {
      id: "req-b",
      requestedFeatures: ["exports"],
      country: "DE",
    });

    await approveRequest(store.client, reqA, ADMIN, T1);
    const opsBeforeReject = store.operationLog.length;

    const result = await rejectRequest(store.client, reqB, ADMIN, T2);
    expect(result).toEqual({ ok: true });

    // Only the AccessRequest.update may occur on the reject path.
    const rejectOps = store.operationLog.slice(opsBeforeReject);
    expect(rejectOps).toHaveLength(1);
    expect(rejectOps[0]).toMatchObject({ model: "AccessRequest", op: "update" });

    // Entitlement is untouched: still exactly A's grant.
    expect(store.getEntitlement(COGNITO_SUB)).toEqual({
      userId: COGNITO_SUB,
      country: "TR",
      allowedFeatures: ["reports"],
      grantedBy: ADMIN.email,
      grantedAt: T1,
    });
  });
});
