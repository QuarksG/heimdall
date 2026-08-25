// Tests for the mock Amplify Data client extensions added in task 5.2 of
// the granular-feature-entitlements spec:
//
//   1. `grantedFeatures` on AccessRequest records: seedable, persisted by
//      update(), and returned by list() — so admin-action and sync tests can
//      exercise granular grants (Req 2.3, 2.6).
//   2. `Entitlement.observeQuery`: delivers an initial { items, isSynced }
//      snapshot on subscribe and re-emits fresh snapshots to matching
//      subscribers after every create/update/delete, so later observer and
//      convergence tests (tasks 12.x) can drive live entitlement flows.
//
// **Validates: Requirements 2.3, 2.6**

import { describe, it, expect } from "vitest";
import {
  createMockDataClient,
  type AccessRequestRecord,
  type EntitlementQuerySnapshot,
  type EntitlementRecord,
} from "./mockAmplifyDataClient";

const USER_ID = "cognito-sub-mock-user";

function makeRequest(
  overrides: Partial<AccessRequestRecord> = {},
): AccessRequestRecord {
  return {
    id: "req-1",
    userId: USER_ID,
    email: "user@heimdall.test",
    fullName: "Mock User",
    country: "TR",
    requestedFeatures: ["reports", "exports"],
    justification: null,
    status: "PENDING",
    reviewedBy: null,
    reviewedAt: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeEntitlement(
  overrides: Partial<EntitlementRecord> = {},
): EntitlementRecord {
  return {
    userId: USER_ID,
    country: "TR",
    allowedFeatures: ["reports"],
    grantedBy: "admin@heimdall.test",
    grantedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/* ─── grantedFeatures on AccessRequest records (Req 2.3, 2.6) ─── */

describe("AccessRequest.grantedFeatures", () => {
  it("defaults to absent (legacy record) when not seeded", () => {
    const store = createMockDataClient();
    store.seedAccessRequest(makeRequest());
    expect(store.getAccessRequest("req-1")!.grantedFeatures).toBeUndefined();
  });

  it("is persisted by update() and returned by list()", async () => {
    const store = createMockDataClient();
    store.seedAccessRequest(makeRequest());

    await store.client.models.AccessRequest.update({
      id: "req-1",
      grantedFeatures: ["reports"],
      status: "APPROVED",
    });

    expect(store.getAccessRequest("req-1")).toMatchObject({
      grantedFeatures: ["reports"],
      status: "APPROVED",
      // Fields not included in the update are untouched.
      requestedFeatures: ["reports", "exports"],
    });

    const listed = await store.client.models.AccessRequest.list({
      filter: { userId: { eq: USER_ID } },
    });
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0].grantedFeatures).toEqual(["reports"]);
  });

  it("persists an explicit empty granted set and an explicit null", async () => {
    const store = createMockDataClient();
    store.seedAccessRequest(makeRequest({ grantedFeatures: ["reports"] }));

    await store.client.models.AccessRequest.update({
      id: "req-1",
      grantedFeatures: [],
    });
    expect(store.getAccessRequest("req-1")!.grantedFeatures).toEqual([]);

    await store.client.models.AccessRequest.update({
      id: "req-1",
      grantedFeatures: null,
    });
    expect(store.getAccessRequest("req-1")!.grantedFeatures).toBeNull();
  });
});

/* ─── Entitlement.observeQuery ─── */

describe("Entitlement.observeQuery", () => {
  function subscribeCollecting(
    store: ReturnType<typeof createMockDataClient>,
    args?: { filter?: { userId?: { eq?: string } } },
  ): { snapshots: EntitlementQuerySnapshot[]; unsubscribe: () => void } {
    const snapshots: EntitlementQuerySnapshot[] = [];
    const subscription = store.client.models.Entitlement.observeQuery(args).subscribe({
      next: (snapshot) => snapshots.push(snapshot),
    });
    return { snapshots, unsubscribe: () => subscription.unsubscribe() };
  }

  it("delivers an initial snapshot of matching items with isSynced", () => {
    const store = createMockDataClient();
    store.seedEntitlement(makeEntitlement());
    store.seedEntitlement(makeEntitlement({ userId: "other-user" }));

    const { snapshots } = subscribeCollecting(store, {
      filter: { userId: { eq: USER_ID } },
    });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].isSynced).toBe(true);
    expect(snapshots[0].items).toHaveLength(1);
    expect(snapshots[0].items[0].userId).toBe(USER_ID);
  });

  it("delivers an initial empty snapshot when no record exists", () => {
    const store = createMockDataClient();
    const { snapshots } = subscribeCollecting(store, {
      filter: { userId: { eq: USER_ID } },
    });
    expect(snapshots).toEqual([{ items: [], isSynced: true }]);
  });

  it("emits on create, update, and delete of a matching record", async () => {
    const store = createMockDataClient();
    const { snapshots } = subscribeCollecting(store, {
      filter: { userId: { eq: USER_ID } },
    });
    expect(snapshots).toHaveLength(1); // initial empty snapshot

    await store.client.models.Entitlement.create(makeEntitlement());
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1].items.map((i) => i.allowedFeatures)).toEqual([
      ["reports"],
    ]);

    await store.client.models.Entitlement.update({
      userId: USER_ID,
      allowedFeatures: ["reports", "exports"],
    });
    expect(snapshots).toHaveLength(3);
    expect(snapshots[2].items[0].allowedFeatures).toEqual([
      "reports",
      "exports",
    ]);

    await store.client.models.Entitlement.delete({ userId: USER_ID });
    expect(snapshots).toHaveLength(4);
    expect(snapshots[3].items).toEqual([]);
  });

  it("does not emit for records that do not match the filter", async () => {
    const store = createMockDataClient();
    const { snapshots } = subscribeCollecting(store, {
      filter: { userId: { eq: USER_ID } },
    });

    await store.client.models.Entitlement.create(
      makeEntitlement({ userId: "other-user" }),
    );
    await store.client.models.Entitlement.delete({ userId: "other-user" });

    expect(snapshots).toHaveLength(1); // still only the initial snapshot
  });

  it("observes all records when no filter is given", async () => {
    const store = createMockDataClient();
    const { snapshots } = subscribeCollecting(store);

    await store.client.models.Entitlement.create(makeEntitlement());
    await store.client.models.Entitlement.create(
      makeEntitlement({ userId: "other-user" }),
    );

    expect(snapshots).toHaveLength(3);
    expect(snapshots[2].items.map((i) => i.userId).sort()).toEqual([
      USER_ID,
      "other-user",
    ]);
  });

  it("stops emitting after unsubscribe and updates the observer count", async () => {
    const store = createMockDataClient();
    const { snapshots, unsubscribe } = subscribeCollecting(store, {
      filter: { userId: { eq: USER_ID } },
    });
    expect(store.entitlementObserverCount()).toBe(1);

    unsubscribe();
    expect(store.entitlementObserverCount()).toBe(0);

    await store.client.models.Entitlement.create(makeEntitlement());
    expect(snapshots).toHaveLength(1); // only the initial snapshot
  });

  it("records observeQuery in the operation log", () => {
    const store = createMockDataClient();
    const args = { filter: { userId: { eq: USER_ID } } };
    store.client.models.Entitlement.observeQuery(args);

    expect(store.operationLog).toEqual([
      { model: "Entitlement", op: "observeQuery", input: args },
    ]);
  });

  it("delete of a non-existent record does not emit", async () => {
    const store = createMockDataClient();
    const { snapshots } = subscribeCollecting(store);

    await store.client.models.Entitlement.delete({ userId: USER_ID });
    expect(snapshots).toHaveLength(1); // nothing was removed, no event
  });
});
