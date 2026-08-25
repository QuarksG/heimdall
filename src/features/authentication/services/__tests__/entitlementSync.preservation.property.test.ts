// Bugfix: rbac-entitlement-sync, Property 2: Preservation - Single-Request
// and Non-Entitlement Behavior
//
// For any admin action where isBugCondition(X) does NOT hold - the user has
// at most one AccessRequest record - the fixed code SHALL produce the same
// result as the original code.
//
// PRESERVATION BASELINE (observation-first methodology): these tests were
// written by observing the CURRENT (unfixed) handler logic extracted in
// adminActions.current.ts, and they PASSED on the unfixed code.
//
// FIXED (task 3.2): the tests now run against the shared FIXED handlers in
// ../adminActions - the same functions AdminPanel.tsx uses - with the same
// assertions, verifying the fix preserves the observed baseline:
//
//   1. Approving a user's only request creates an Entitlement with exactly
//      that request's features and countries, and marks the request
//      APPROVED with reviewedBy/reviewedAt (Req 3.1)
//   2. Rejecting a PENDING request updates only the request status - ZERO
//      Entitlement table operations occur (asserted via the mock's
//      operation log) (Req 3.2)
//   3. Revoking a user's only approved request deletes the Entitlement and
//      marks the request REJECTED (Req 3.3)
//
// Assertions cover both the final store state AND the sequence of
// Entitlement WRITE operations (create/update/delete), so the fix cannot
// silently change what is persisted or which mutations hit the Entitlement
// table. Reads (get/list) are not part of the baseline sequence because
// they are not observable in the store state or in the token claim.
//
// Feature/country comparisons are set-based (order-insensitive,
// deduplicated) so any deterministic ordering chosen by the fixed
// implementation is acceptable, matching the comparison discipline of the
// Property 1 exploration tests.
//
// The Entitlement record shape is also asserted (country: string,
// allowedFeatures: string array) so the pre-token-generation Lambda's
// custom:entitlements claim format is preserved (Req 3.5). Requests are
// generated with userId = Cognito sub, matching the Entitlement table's
// primary key (Req 3.4).
//
// **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  createMockDataClient,
  type AccessRequestRecord,
  type MockStore,
  type OperationLogEntry,
} from "./mockAmplifyDataClient";
import {
  approveRequest as handleApprove,
  rejectRequest as handleReject,
  revokeRequest as handleRevoke,
} from "../adminActions";

/* ─── Helpers ─── */

function splitCountries(country: string): string[] {
  return country
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

/** Entitlement WRITE operations (mutations) recorded in the operation log.
 *  Reads (get/list) are excluded: they do not change store state and are
 *  not observable in the token claim. */
function entitlementWriteOps(log: OperationLogEntry[]): OperationLogEntry[] {
  return log.filter(
    (e) =>
      e.model === "Entitlement" &&
      (e.op === "create" || e.op === "update" || e.op === "delete"),
  );
}

/** ALL Entitlement operations, including reads. Used for the
 *  reject-of-PENDING baseline, where the table must not be touched at all. */
function allEntitlementOps(log: OperationLogEntry[]): OperationLogEntry[] {
  return log.filter((e) => e.model === "Entitlement");
}

/** Asserts the Entitlement record keeps the exact field shapes the
 *  pre-token-generation Lambda reads for the custom:entitlements claim. */
function assertClaimShape(entitlement: {
  userId: string;
  country: unknown;
  allowedFeatures: unknown;
}): void {
  expect(typeof entitlement.country).toBe("string");
  expect(Array.isArray(entitlement.allowedFeatures)).toBe(true);
  for (const f of entitlement.allowedFeatures as unknown[]) {
    expect(typeof f).toBe("string");
  }
}

/* ─── Generators: single-request users (NOT the bug condition) ─── */

const FEATURE_POOL = [
  "reports",
  "dashboards",
  "audit-log",
  "exports",
  "billing",
  "user-admin",
] as const;
const COUNTRY_POOL = ["TR", "AZ", "GB", "DE", "US", "FR"] as const;

const featuresArb = fc.uniqueArray(fc.constantFrom(...FEATURE_POOL), {
  minLength: 1,
  maxLength: FEATURE_POOL.length,
});

const countriesArb = fc
  .uniqueArray(fc.constantFrom(...COUNTRY_POOL), {
    minLength: 1,
    maxLength: COUNTRY_POOL.length,
  })
  .map((codes) => codes.join(","));

const userIdArb = fc
  .uuid()
  .map((sub) => `cognito-sub-${sub}`);

const ADMIN = { email: "admin@heimdall.test" };
const NOW = "2025-01-15T10:00:00.000Z";

let nextId = 0;
function makeSingleRequest(
  userId: string,
  requestedFeatures: string[],
  country: string,
  status: AccessRequestRecord["status"],
): AccessRequestRecord {
  nextId += 1;
  return {
    id: `req-${nextId}`,
    userId, // Cognito sub - matches the Entitlement table primary key (Req 3.4)
    email: "user@heimdall.test",
    fullName: "Single Request User",
    country,
    requestedFeatures,
    justification: null,
    status,
    reviewedBy: status === "PENDING" ? null : ADMIN.email,
    reviewedAt: status === "PENDING" ? null : "2025-01-02T00:00:00.000Z",
    createdAt: "2025-01-01T00:00:00.000Z",
  };
}

type Action = "approve" | "reject" | "revoke";
const actionArb: fc.Arbitrary<Action> = fc.constantFrom(
  "approve",
  "reject",
  "revoke",
);

/* ─── Baseline scenario runner ───
   Sets up the correct pre-state for the action, applies the action through
   the current handlers, and asserts the observed baseline. */

async function runSingleRequestAction(
  store: MockStore,
  req: AccessRequestRecord,
  action: Action,
): Promise<void> {
  if (action === "approve") {
    await handleApprove(store.client, req, ADMIN, NOW);
  } else if (action === "reject") {
    await handleReject(store.client, req, ADMIN, NOW);
  } else {
    await handleRevoke(store.client, req, ADMIN, NOW);
  }
}

describe("Property 2: Preservation - single-request users (baseline on unfixed code)", () => {
  /* ─── Combined property: random single action on a single-request user ───
     Generates a user with exactly one AccessRequest (random features and
     comma-separated countries), applies one random action with the
     appropriate pre-state, and asserts final store state + Entitlement
     write-operation sequence match the observed baseline. */

  it("random single action on a single-request user matches the observed baseline", async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        featuresArb,
        countriesArb,
        actionArb,
        async (userId, features, country, action) => {
          const store = createMockDataClient();

          if (action === "approve") {
            // Pre-state: user's only request is PENDING, no Entitlement.
            const req = makeSingleRequest(userId, features, country, "PENDING");
            store.seedAccessRequest(req);

            await runSingleRequestAction(store, req, action);

            // Baseline: request APPROVED with reviewer metadata.
            const after = store.getAccessRequest(req.id)!;
            expect(after.status).toBe("APPROVED");
            expect(after.reviewedBy).toBe(ADMIN.email);
            expect(after.reviewedAt).toBe(NOW);

            // Baseline: Entitlement holds exactly this request's features
            // and countries (set comparison), granted by the admin.
            const entitlement = store.getEntitlement(userId);
            expect(entitlement).toBeDefined();
            expect([...entitlement!.allowedFeatures].sort()).toEqual(
              [...features].sort(),
            );
            expect(splitCountries(entitlement!.country).sort()).toEqual(
              splitCountries(country).sort(),
            );
            expect(entitlement!.grantedBy).toBe(ADMIN.email);
            expect(typeof entitlement!.grantedAt).toBe("string");
            assertClaimShape(entitlement!);

            // Baseline: exactly one Entitlement write - a create for this user.
            const writes = entitlementWriteOps(store.operationLog);
            expect(writes.map((w) => w.op)).toEqual(["create"]);
            expect((writes[0].input as { userId: string }).userId).toBe(userId);
          } else if (action === "reject") {
            // Pre-state: user's only request is PENDING, no Entitlement.
            const req = makeSingleRequest(userId, features, country, "PENDING");
            store.seedAccessRequest(req);

            await runSingleRequestAction(store, req, action);

            // Baseline: request REJECTED with reviewer metadata.
            const after = store.getAccessRequest(req.id)!;
            expect(after.status).toBe("REJECTED");
            expect(after.reviewedBy).toBe(ADMIN.email);
            expect(after.reviewedAt).toBe(NOW);

            // Baseline: the Entitlement table is NEVER touched - zero
            // operations of any kind, reads included (Req 3.2).
            expect(allEntitlementOps(store.operationLog)).toEqual([]);
            expect(store.getEntitlement(userId)).toBeUndefined();
          } else {
            // Pre-state: user's only request is APPROVED, with the
            // Entitlement a correct prior approval would have created.
            const req = makeSingleRequest(userId, features, country, "APPROVED");
            store.seedAccessRequest(req);
            store.seedEntitlement({
              userId,
              country,
              allowedFeatures: features,
              grantedBy: ADMIN.email,
              grantedAt: "2025-01-02T00:00:00.000Z",
            });

            await runSingleRequestAction(store, req, action);

            // Baseline: request REJECTED with reviewer metadata.
            const after = store.getAccessRequest(req.id)!;
            expect(after.status).toBe("REJECTED");
            expect(after.reviewedBy).toBe(ADMIN.email);
            expect(after.reviewedAt).toBe(NOW);

            // Baseline: Entitlement record deleted.
            expect(store.getEntitlement(userId)).toBeUndefined();

            // Baseline: exactly one Entitlement write - a delete for this user.
            const writes = entitlementWriteOps(store.operationLog);
            expect(writes.map((w) => w.op)).toEqual(["delete"]);
            expect((writes[0].input as { userId: string }).userId).toBe(userId);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /* ─── Concrete example: claim shape round-trip (Req 3.5) ───
     The pre-token-generation Lambda reads entitlement.country (string) and
     entitlement.allowedFeatures (string array) to build the
     custom:entitlements claim. Pin the exact record produced by approving
     a single request so any shape change is caught explicitly. */

  it("approve of an only request produces the exact Entitlement shape the Lambda reads", async () => {
    const store = createMockDataClient();
    const req = makeSingleRequest(
      "cognito-sub-shape-check",
      ["reports", "exports"],
      "TR,DE",
      "PENDING",
    );
    store.seedAccessRequest(req);

    await handleApprove(store.client, req, ADMIN, NOW);

    const entitlement = store.getEntitlement("cognito-sub-shape-check");
    expect(entitlement).toBeDefined();
    assertClaimShape(entitlement!);
    // Set-based content check (order/dedup-insensitive).
    expect([...entitlement!.allowedFeatures].sort()).toEqual([
      "exports",
      "reports",
    ]);
    expect(splitCountries(entitlement!.country).sort()).toEqual(["DE", "TR"]);
  });
});
