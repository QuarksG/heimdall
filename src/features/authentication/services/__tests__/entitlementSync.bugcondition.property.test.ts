// Bugfix: rbac-entitlement-sync, Property 1: Bug Condition - Entitlement Union Invariant
//
// For any admin action where isBugCondition(X) holds - the user has more than
// one AccessRequest record and the action is APPROVE, REVOKE, or REAPPROVE -
// the user's Entitlement record SHALL equal the deduplicated union of
// requestedFeatures and countries across all of that user's APPROVED
// requests; if no APPROVED requests remain, no Entitlement record SHALL
// exist for that user.
//
// EXPLORATION TEST (task 1): these tests originally ran against the
// CURRENT (unfixed) handler logic extracted in adminActions.current.ts and
// FAILED, confirming the bug and the root cause analysis
// (single-request-scoped writes, create-only semantics, unconditional
// delete on revoke).
//
// FIXED (task 3.2): the tests now run against the shared FIXED handlers in
// ../adminActions - the same functions AdminPanel.tsx uses - and the same
// assertions encode the expected behavior, so they must PASS.
//
// Scoped PBT approach: the bug is deterministic for multi-request users, so
// each property is scoped to one of the four concrete failing scenarios from
// the design's exploratory test plan, with generated feature sets and
// country sets. Generators draw the two requests' features/countries from
// disjoint pools so the second request always contributes something new
// (otherwise the union coincidentally equals the seeded entitlement and the
// scenario would not discriminate the bug).
//
// **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  createMockDataClient,
  type AccessRequestRecord,
  type AccessRequestStatus,
  type MockStore,
} from "./mockAmplifyDataClient";
import {
  approveRequest as handleApprove,
  revokeRequest as handleRevoke,
} from "../adminActions";

/* ─── Spec-side oracle: expected entitlement = union over APPROVED requests ─── */

function splitCountries(country: string): string[] {
  return country
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

type ExpectedUnion = { allowedFeatures: string[]; countries: string[] } | null;

function expectedUnion(requests: AccessRequestRecord[]): ExpectedUnion {
  const approved = requests.filter((r) => r.status === "APPROVED");
  if (approved.length === 0) return null;
  const features = new Set<string>();
  const countries = new Set<string>();
  for (const r of approved) {
    for (const f of r.requestedFeatures) features.add(f);
    for (const c of splitCountries(r.country)) countries.add(c);
  }
  return {
    allowedFeatures: [...features].sort(),
    countries: [...countries].sort(),
  };
}

/**
 * Asserts the store's Entitlement for userId matches the union invariant.
 * Comparison is order-insensitive (sorted sets) so any deterministic
 * ordering chosen by the implementation is acceptable.
 */
function assertUnionInvariant(store: MockStore, userId: string): void {
  const union = expectedUnion(
    store.listAccessRequests().filter((r) => r.userId === userId),
  );
  const entitlement = store.getEntitlement(userId);

  if (union === null) {
    expect(
      entitlement,
      "no APPROVED requests remain, so no Entitlement record should exist",
    ).toBeUndefined();
    return;
  }

  expect(
    entitlement,
    "APPROVED requests exist, so an Entitlement record must exist",
  ).toBeDefined();
  expect([...entitlement!.allowedFeatures].sort()).toEqual(
    union.allowedFeatures,
  );
  expect(splitCountries(entitlement!.country).sort()).toEqual(union.countries);
}

/* ─── Generators (scoped to the deterministic failing scenarios) ─── */

// Disjoint pools so the second request always contributes new features
// and at least one new country.
const FEATURE_POOL_A = ["reports", "dashboards", "audit-log"] as const;
const FEATURE_POOL_B = ["exports", "billing", "user-admin"] as const;
const COUNTRY_POOL_A = ["TR", "AZ", "GB"] as const;
const COUNTRY_POOL_B = ["DE", "US", "FR"] as const;

const featuresArb = (pool: readonly string[]) =>
  fc.uniqueArray(fc.constantFrom(...pool), { minLength: 1, maxLength: pool.length });

const countriesArb = (pool: readonly string[]) =>
  fc
    .uniqueArray(fc.constantFrom(...pool), { minLength: 1, maxLength: pool.length })
    .map((codes) => codes.join(","));

const ADMIN = { email: "admin@heimdall.test" };
const USER_ID = "cognito-sub-multi-request-user";
const NOW = "2025-01-15T10:00:00.000Z";

let nextId = 0;
function makeRequest(
  overrides: Partial<AccessRequestRecord> & {
    country: string;
    requestedFeatures: string[];
    status: AccessRequestStatus;
  },
): AccessRequestRecord {
  nextId += 1;
  return {
    id: `req-${nextId}`,
    userId: USER_ID,
    email: "user@heimdall.test",
    fullName: "Multi Request User",
    justification: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Seeds a store with the given requests, plus an Entitlement derived from
 *  the APPROVED subset (the state a correct prior history would leave). */
function seedStore(requests: AccessRequestRecord[]): MockStore {
  const store = createMockDataClient();
  for (const r of requests) store.seedAccessRequest(r);
  const union = expectedUnion(requests);
  if (union) {
    store.seedEntitlement({
      userId: USER_ID,
      country: union.countries.join(","),
      allowedFeatures: union.allowedFeatures,
      grantedBy: ADMIN.email,
      grantedAt: "2025-01-01T00:00:00.000Z",
    });
  }
  return store;
}

/* ─── Exploratory case 1: Second Approval ───
   Seed one APPROVED request with an existing Entitlement; approve a second
   PENDING request; the Entitlement must equal the union of both.
   Unfixed code: Entitlement.create rejects against the existing record, so
   the entitlement never includes the second request's features. */

describe("Property 1: Bug Condition - Entitlement Union Invariant (exploration on unfixed code)", () => {
  it("second approval: entitlement equals the union of both approved requests", async () => {
    await fc.assert(
      fc.asyncProperty(
        featuresArb(FEATURE_POOL_A),
        countriesArb(COUNTRY_POOL_A),
        featuresArb(FEATURE_POOL_B),
        countriesArb(COUNTRY_POOL_B),
        async (featuresA, countriesA, featuresB, countriesB) => {
          const reqA = makeRequest({
            status: "APPROVED",
            requestedFeatures: featuresA,
            country: countriesA,
            reviewedBy: ADMIN.email,
            reviewedAt: "2025-01-02T00:00:00.000Z",
          });
          const reqB = makeRequest({
            status: "PENDING",
            requestedFeatures: featuresB,
            country: countriesB,
          });
          const store = seedStore([reqA, reqB]);

          await handleApprove(store.client, reqB, ADMIN, NOW);

          assertUnionInvariant(store, USER_ID);
        },
      ),
      { numRuns: 25 },
    );
  });

  /* ─── Exploratory case 2: Partial Revoke ───
     Seed two APPROVED requests with a union Entitlement; revoke one; the
     Entitlement must equal the remaining request's contribution.
     Unfixed code: Entitlement.delete removes the entire record while the
     other request remains APPROVED. */

  it("partial revoke: entitlement equals the remaining approved request's contribution", async () => {
    await fc.assert(
      fc.asyncProperty(
        featuresArb(FEATURE_POOL_A),
        countriesArb(COUNTRY_POOL_A),
        featuresArb(FEATURE_POOL_B),
        countriesArb(COUNTRY_POOL_B),
        fc.boolean(),
        async (featuresA, countriesA, featuresB, countriesB, revokeFirst) => {
          const reqA = makeRequest({
            status: "APPROVED",
            requestedFeatures: featuresA,
            country: countriesA,
            reviewedBy: ADMIN.email,
            reviewedAt: "2025-01-02T00:00:00.000Z",
          });
          const reqB = makeRequest({
            status: "APPROVED",
            requestedFeatures: featuresB,
            country: countriesB,
            reviewedBy: ADMIN.email,
            reviewedAt: "2025-01-03T00:00:00.000Z",
          });
          const store = seedStore([reqA, reqB]);

          const target = revokeFirst ? reqA : reqB;
          await handleRevoke(store.client, target, ADMIN, NOW);

          assertUnionInvariant(store, USER_ID);
        },
      ),
      { numRuns: 25 },
    );
  });

  /* ─── Exploratory case 3: Re-approve ───
     Seed one APPROVED and one REJECTED request; re-approve the rejected one
     (the Re-approve button reuses handleApprove); the Entitlement must be
     the union of both.
     Unfixed code: a create is attempted with only the re-approved request's
     payload and rejects against the existing record. */

  it("re-approve: entitlement equals the union after re-approving a rejected request", async () => {
    await fc.assert(
      fc.asyncProperty(
        featuresArb(FEATURE_POOL_A),
        countriesArb(COUNTRY_POOL_A),
        featuresArb(FEATURE_POOL_B),
        countriesArb(COUNTRY_POOL_B),
        async (featuresA, countriesA, featuresB, countriesB) => {
          const reqA = makeRequest({
            status: "APPROVED",
            requestedFeatures: featuresA,
            country: countriesA,
            reviewedBy: ADMIN.email,
            reviewedAt: "2025-01-02T00:00:00.000Z",
          });
          const reqB = makeRequest({
            status: "REJECTED",
            requestedFeatures: featuresB,
            country: countriesB,
            reviewedBy: ADMIN.email,
            reviewedAt: "2025-01-03T00:00:00.000Z",
          });
          const store = seedStore([reqA, reqB]);

          // Re-approve reuses handleApprove in AdminPanel
          await handleApprove(store.client, reqB, ADMIN, NOW);

          assertUnionInvariant(store, USER_ID);
        },
      ),
      { numRuns: 25 },
    );
  });

  /* ─── Exploratory case 4: Country Union (concrete example from design) ───
     Two requests with countries "TR" and "TR,DE"; after both are approved,
     the Entitlement country must be the deduplicated union {DE, TR}.
     Unfixed code: only the first request's countries are stored. */

  it('country union: countries "TR" and "TR,DE" yield the deduplicated union', async () => {
    const reqA = makeRequest({
      status: "APPROVED",
      requestedFeatures: ["reports"],
      country: "TR",
      reviewedBy: ADMIN.email,
      reviewedAt: "2025-01-02T00:00:00.000Z",
    });
    const reqB = makeRequest({
      status: "PENDING",
      requestedFeatures: ["exports"],
      country: "TR,DE",
    });
    const store = seedStore([reqA, reqB]);

    await handleApprove(store.client, reqB, ADMIN, NOW);

    const entitlement = store.getEntitlement(USER_ID);
    expect(entitlement).toBeDefined();
    expect(splitCountries(entitlement!.country).sort()).toEqual(["DE", "TR"]);
    expect([...entitlement!.allowedFeatures].sort()).toEqual([
      "exports",
      "reports",
    ]);
  });
});
