// Unit tests for the entitlement sync service module. Covers the
// syncEntitlementForUser upsert branches against the mocked in-memory
// Amplify Data client, including the grantedFeatures-based union semantics
// introduced by the granular-feature-entitlements spec (stored granted
// subsets win; legacy records without grantedFeatures fall back to
// requestedFeatures when APPROVED — Req 2.3, 2.6).
//
// The pure union computation (effectiveGrantedFeatures,
// computeEntitlementUnion, country splitting/trimming) is covered by
// entitlementCore.unit.test.ts and the property tests under properties/.
//
// **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**

import { describe, it, expect } from "vitest";
import { syncEntitlementForUser } from "../entitlementSync";
import {
  createMockDataClient,
  type AccessRequestRecord,
  type AccessRequestStatus,
  type MockDataClient,
  type MockStore,
  type OperationLogEntry,
} from "./mockAmplifyDataClient";

const USER_ID = "cognito-sub-user-1";
const ADMIN_EMAIL = "admin@heimdall.test";
const NOW = "2025-02-01T12:00:00.000Z";

let nextId = 0;
function makeRequestRecord(
  overrides: Partial<AccessRequestRecord> & {
    status: AccessRequestStatus;
  },
): AccessRequestRecord {
  nextId += 1;
  return {
    id: `req-${nextId}`,
    userId: USER_ID,
    email: "user@heimdall.test",
    fullName: "Test User",
    country: "TR",
    requestedFeatures: ["reports"],
    justification: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function entitlementOps(store: MockStore): OperationLogEntry[] {
  return store.operationLog.filter((entry) => entry.model === "Entitlement");
}

/* ─── syncEntitlementForUser upsert branches ─── */

describe("syncEntitlementForUser", () => {
  it("creates the Entitlement when approved requests exist and no record does", async () => {
    const store = createMockDataClient();
    store.seedAccessRequest(
      makeRequestRecord({
        status: "APPROVED",
        requestedFeatures: ["reports"],
        country: "TR",
      }),
    );

    await syncEntitlementForUser(store.client, USER_ID, ADMIN_EMAIL, NOW);

    expect(store.getEntitlement(USER_ID)).toEqual({
      userId: USER_ID,
      country: "TR",
      allowedFeatures: ["reports"],
      grantedBy: ADMIN_EMAIL,
      grantedAt: NOW,
    });
    const writes = entitlementOps(store).map((entry) => entry.op);
    expect(writes).toContain("create");
    expect(writes).not.toContain("update");
    expect(writes).not.toContain("delete");
  });

  it("updates the existing Entitlement to the union with fresh grantedBy/grantedAt", async () => {
    const store = createMockDataClient();
    store.seedAccessRequest(
      makeRequestRecord({
        status: "APPROVED",
        requestedFeatures: ["reports"],
        country: "TR",
      }),
    );
    store.seedAccessRequest(
      makeRequestRecord({
        status: "APPROVED",
        requestedFeatures: ["exports"],
        country: "TR,DE",
      }),
    );
    store.seedEntitlement({
      userId: USER_ID,
      country: "TR",
      allowedFeatures: ["reports"],
      grantedBy: "previous-admin@heimdall.test",
      grantedAt: "2025-01-01T00:00:00.000Z",
    });

    await syncEntitlementForUser(store.client, USER_ID, ADMIN_EMAIL, NOW);

    expect(store.getEntitlement(USER_ID)).toEqual({
      userId: USER_ID,
      country: "DE,TR",
      allowedFeatures: ["exports", "reports"],
      grantedBy: ADMIN_EMAIL,
      grantedAt: NOW,
    });
    const writes = entitlementOps(store).map((entry) => entry.op);
    expect(writes).toContain("update");
    expect(writes).not.toContain("create");
    expect(writes).not.toContain("delete");
  });

  it("deletes the Entitlement when no approved requests remain", async () => {
    const store = createMockDataClient();
    store.seedAccessRequest(
      makeRequestRecord({ status: "REJECTED", requestedFeatures: ["reports"] }),
    );
    store.seedEntitlement({
      userId: USER_ID,
      country: "TR",
      allowedFeatures: ["reports"],
      grantedBy: ADMIN_EMAIL,
      grantedAt: "2025-01-01T00:00:00.000Z",
    });

    await syncEntitlementForUser(store.client, USER_ID, ADMIN_EMAIL, NOW);

    expect(store.getEntitlement(USER_ID)).toBeUndefined();
    const writes = entitlementOps(store).map((entry) => entry.op);
    expect(writes).toContain("delete");
    expect(writes).not.toContain("create");
    expect(writes).not.toContain("update");
  });

  it("is a no-op when no approved requests exist and no record exists", async () => {
    const store = createMockDataClient();
    store.seedAccessRequest(makeRequestRecord({ status: "PENDING" }));

    await syncEntitlementForUser(store.client, USER_ID, ADMIN_EMAIL, NOW);

    expect(store.getEntitlement(USER_ID)).toBeUndefined();
    // Reading (get) is allowed; no writes may occur on this path.
    const writes = entitlementOps(store).map((entry) => entry.op);
    expect(writes).not.toContain("create");
    expect(writes).not.toContain("update");
    expect(writes).not.toContain("delete");
  });

  it("only unions APPROVED requests, ignoring PENDING and REJECTED ones", async () => {
    const store = createMockDataClient();
    store.seedAccessRequest(
      makeRequestRecord({
        status: "APPROVED",
        requestedFeatures: ["reports"],
        country: "TR",
      }),
    );
    store.seedAccessRequest(
      makeRequestRecord({
        status: "PENDING",
        requestedFeatures: ["billing"],
        country: "US",
      }),
    );
    store.seedAccessRequest(
      makeRequestRecord({
        status: "REJECTED",
        requestedFeatures: ["user-admin"],
        country: "FR",
      }),
    );

    await syncEntitlementForUser(store.client, USER_ID, ADMIN_EMAIL, NOW);

    expect(store.getEntitlement(USER_ID)).toEqual({
      userId: USER_ID,
      country: "TR",
      allowedFeatures: ["reports"],
      grantedBy: ADMIN_EMAIL,
      grantedAt: NOW,
    });
  });

  it("follows nextToken pagination across multiple list pages", async () => {
    const store = createMockDataClient();
    const features = ["f1", "f2", "f3", "f4", "f5"];
    const countries = ["TR", "DE", "FR", "US", "GB"];
    for (let i = 0; i < 5; i += 1) {
      store.seedAccessRequest(
        makeRequestRecord({
          status: "APPROVED",
          requestedFeatures: [features[i]],
          country: countries[i],
        }),
      );
    }

    // Force the mock to page 2-at-a-time so the sync must follow nextToken.
    const pagedClient: MockDataClient = {
      models: {
        ...store.client.models,
        AccessRequest: {
          ...store.client.models.AccessRequest,
          list: (args) =>
            store.client.models.AccessRequest.list({ ...args, limit: 2 }),
        },
      },
    };

    await syncEntitlementForUser(pagedClient, USER_ID, ADMIN_EMAIL, NOW);

    expect(store.getEntitlement(USER_ID)).toEqual({
      userId: USER_ID,
      country: "DE,FR,GB,TR,US",
      allowedFeatures: ["f1", "f2", "f3", "f4", "f5"],
      grantedBy: ADMIN_EMAIL,
      grantedAt: NOW,
    });
    // 5 records at limit 2 requires 3 list calls.
    const listCalls = store.operationLog.filter(
      (entry) => entry.model === "AccessRequest" && entry.op === "list",
    );
    expect(listCalls).toHaveLength(3);
  });
});

/* ─── grantedFeatures-based union semantics (Req 2.3, 2.6) ─── */

describe("syncEntitlementForUser with grantedFeatures", () => {
  it("unions the stored granted subset, not the requested features", async () => {
    const store = createMockDataClient();
    store.seedAccessRequest(
      makeRequestRecord({
        status: "APPROVED",
        requestedFeatures: ["reports", "exports", "billing"],
        grantedFeatures: ["reports", "exports"], // partial approval
        country: "TR",
      }),
    );

    await syncEntitlementForUser(store.client, USER_ID, ADMIN_EMAIL, NOW);

    expect(store.getEntitlement(USER_ID)).toEqual({
      userId: USER_ID,
      country: "TR",
      allowedFeatures: ["exports", "reports"],
      grantedBy: ADMIN_EMAIL,
      grantedAt: NOW,
    });
  });

  it("mixes granular and legacy records: stored grants + full legacy grant", async () => {
    const store = createMockDataClient();
    store.seedAccessRequest(
      makeRequestRecord({
        status: "APPROVED",
        requestedFeatures: ["reports", "exports"],
        grantedFeatures: ["reports"], // granular partial grant
        country: "TR",
      }),
    );
    store.seedAccessRequest(
      makeRequestRecord({
        status: "APPROVED",
        requestedFeatures: ["billing"],
        // no grantedFeatures: legacy APPROVED record -> full grant (Req 2.6)
        country: "DE",
      }),
    );

    await syncEntitlementForUser(store.client, USER_ID, ADMIN_EMAIL, NOW);

    expect(store.getEntitlement(USER_ID)).toEqual({
      userId: USER_ID,
      country: "DE,TR",
      allowedFeatures: ["billing", "reports"],
      grantedBy: ADMIN_EMAIL,
      grantedAt: NOW,
    });
  });

  it("ignores stored grantedFeatures on non-APPROVED requests", async () => {
    const store = createMockDataClient();
    store.seedAccessRequest(
      makeRequestRecord({
        status: "APPROVED",
        requestedFeatures: ["reports"],
        grantedFeatures: ["reports"],
        country: "TR",
      }),
    );
    store.seedAccessRequest(
      makeRequestRecord({
        status: "REJECTED",
        requestedFeatures: ["billing"],
        grantedFeatures: ["billing"], // present but not APPROVED -> no contribution
        country: "US",
      }),
    );

    await syncEntitlementForUser(store.client, USER_ID, ADMIN_EMAIL, NOW);

    expect(store.getEntitlement(USER_ID)).toEqual({
      userId: USER_ID,
      country: "TR",
      allowedFeatures: ["reports"],
      grantedBy: ADMIN_EMAIL,
      grantedAt: NOW,
    });
  });

  it("deletes the Entitlement when every APPROVED request has an empty granted set", async () => {
    const store = createMockDataClient();
    store.seedAccessRequest(
      makeRequestRecord({
        status: "APPROVED",
        requestedFeatures: ["reports"],
        grantedFeatures: [], // everything toggled off, status not yet flipped
        country: "TR",
      }),
    );
    store.seedEntitlement({
      userId: USER_ID,
      country: "TR",
      allowedFeatures: ["reports"],
      grantedBy: ADMIN_EMAIL,
      grantedAt: "2025-01-01T00:00:00.000Z",
    });

    await syncEntitlementForUser(store.client, USER_ID, ADMIN_EMAIL, NOW);

    // Feature union is empty -> record deleted (Req 2.4), even though the
    // APPROVED request still contributes its country to the (unused) union.
    expect(store.getEntitlement(USER_ID)).toBeUndefined();
    const writes = entitlementOps(store).map((entry) => entry.op);
    expect(writes).toContain("delete");
  });
});
