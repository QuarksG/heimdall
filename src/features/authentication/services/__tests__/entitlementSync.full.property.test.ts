// Bugfix: rbac-entitlement-sync, task 4.1 - Full (unscoped) property-based
// tests for the Entitlement Union Invariant and sync idempotence.
//
// Unlike the scoped exploration tests (entitlementSync.bugcondition.property
// .test.ts), these properties are NOT restricted to the four concrete failing
// scenarios. They generate:
//
//   1. Union invariant: random sets of AccessRequests for a user (random
//      statuses PENDING/APPROVED/REJECTED, random feature arrays with
//      possible duplicates, comma-separated country strings with possible
//      duplicates and whitespace) and random sequences of approve / revoke /
//      re-approve actions applied through the FIXED shared handlers
//      (approveRequest / revokeRequest - the same functions AdminPanel.tsx
//      uses). After EACH action the Entitlement must equal the deduplicated
//      union of features and countries across all APPROVED requests, or be
//      absent when none are approved. The initial Entitlement is seeded
//      consistently with the initially-APPROVED subset.
//
//   2. Idempotence: for any generated request set, running
//      syncEntitlementForUser twice in a row produces the same Entitlement
//      state as running it once.
//
// Comparisons are set-based (sorted, deduplicated) so any deterministic
// ordering chosen by the implementation is acceptable, matching the
// comparison discipline of the existing property tests.
//
// **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  createMockDataClient,
  type AccessRequestRecord,
  type AccessRequestStatus,
  type EntitlementRecord,
  type MockStore,
} from "./mockAmplifyDataClient";
import { approveRequest, revokeRequest } from "../adminActions";
import { syncEntitlementForUser } from "../entitlementSync";

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

/** Asserts the store's Entitlement for userId matches the union invariant. */
function assertUnionInvariant(
  store: MockStore,
  userId: string,
  context: string,
): void {
  const union = expectedUnion(
    store.listAccessRequests().filter((r) => r.userId === userId),
  );
  const entitlement = store.getEntitlement(userId);

  if (union === null) {
    expect(
      entitlement,
      `${context}: no APPROVED requests remain, so no Entitlement should exist`,
    ).toBeUndefined();
    return;
  }

  expect(
    entitlement,
    `${context}: APPROVED requests exist, so an Entitlement must exist`,
  ).toBeDefined();
  expect(
    [...entitlement!.allowedFeatures].sort(),
    `${context}: allowedFeatures must equal the union over APPROVED requests`,
  ).toEqual(union.allowedFeatures);
  expect(
    splitCountries(entitlement!.country).sort(),
    `${context}: country must equal the deduplicated union over APPROVED requests`,
  ).toEqual(union.countries);
}

/* ─── Generators ─── */

const FEATURE_POOL = [
  "reports",
  "dashboards",
  "audit-log",
  "exports",
  "billing",
  "user-admin",
] as const;
const COUNTRY_POOL = ["TR", "AZ", "GB", "DE", "US", "FR"] as const;

const statusArb: fc.Arbitrary<AccessRequestStatus> = fc.constantFrom(
  "PENDING",
  "APPROVED",
  "REJECTED",
);

// Feature arrays may contain duplicates within and across requests, so the
// deduplication in the union computation is genuinely exercised.
const featuresArb = fc.array(fc.constantFrom(...FEATURE_POOL), {
  minLength: 1,
  maxLength: 4,
});

// Comma-separated country strings: duplicates allowed, and some entries get
// whitespace padding to exercise the country-code trim in the union
// computation (entitlementCore's computeEntitlementUnion).
const countriesArb = fc
  .array(
    fc
      .tuple(fc.constantFrom(...COUNTRY_POOL), fc.boolean())
      .map(([code, pad]) => (pad ? ` ${code} ` : code)),
    { minLength: 1, maxLength: 3 },
  )
  .map((codes) => codes.join(","));

/** One request spec: status + contribution. */
const requestSpecArb = fc.record({
  status: statusArb,
  requestedFeatures: featuresArb,
  country: countriesArb,
});

/** A user's request set: 1..5 requests with independent random contents. */
const requestSetArb = fc.array(requestSpecArb, { minLength: 1, maxLength: 5 });

/** An action targets a request by index. "approve" covers both first
 *  approval (of a PENDING request) and re-approval (of a REJECTED request),
 *  since the Re-approve button reuses the approve handler. */
type ActionKind = "approve" | "revoke";
const actionArb = fc.record({
  kind: fc.constantFrom<ActionKind>("approve", "revoke"),
  // Index into the request set, taken modulo its length when applied.
  targetIndex: fc.nat({ max: 4 }),
});

/** A sequence of 1..8 actions. */
const actionSequenceArb = fc.array(actionArb, { minLength: 1, maxLength: 8 });

const ADMIN = { email: "admin@heimdall.test" };
const USER_ID = "cognito-sub-full-property-user";
const NOW = "2025-01-15T10:00:00.000Z";

/** Builds records and a store seeded with an Entitlement consistent with
 *  the initially-APPROVED subset (the state a correct prior history would
 *  leave behind). */
function seedStore(
  specs: { status: AccessRequestStatus; requestedFeatures: string[]; country: string }[],
): { store: MockStore; requests: AccessRequestRecord[] } {
  const requests: AccessRequestRecord[] = specs.map((spec, i) => ({
    id: `req-${i + 1}`,
    userId: USER_ID,
    email: "user@heimdall.test",
    fullName: "Full Property User",
    country: spec.country,
    requestedFeatures: spec.requestedFeatures,
    justification: null,
    status: spec.status,
    reviewedBy: spec.status === "PENDING" ? null : ADMIN.email,
    reviewedAt: spec.status === "PENDING" ? null : "2025-01-02T00:00:00.000Z",
    createdAt: "2025-01-01T00:00:00.000Z",
  }));

  const store = createMockDataClient();
  for (const r of requests) store.seedAccessRequest(r);

  const union = expectedUnion(requests);
  if (union) {
    store.seedEntitlement({
      userId: USER_ID,
      country: union.countries.join(","),
      allowedFeatures: union.allowedFeatures,
      grantedBy: ADMIN.email,
      grantedAt: "2025-01-02T00:00:00.000Z",
    });
  }

  return { store, requests };
}

/* ─── Property: full union invariant across random action sequences ─── */

describe("Full union invariant (Property 1, unscoped)", () => {
  it("after every approve/revoke/re-approve action, the Entitlement equals the union over APPROVED requests", async () => {
    await fc.assert(
      fc.asyncProperty(
        requestSetArb,
        actionSequenceArb,
        async (specs, actions) => {
          const { store, requests } = seedStore(specs);

          // Seeded state must itself satisfy the invariant.
          assertUnionInvariant(store, USER_ID, "seeded state");

          for (const [step, action] of actions.entries()) {
            const target = requests[action.targetIndex % requests.length];

            const result =
              action.kind === "approve"
                ? await approveRequest(store.client, target, ADMIN, NOW)
                : await revokeRequest(store.client, target, ADMIN, NOW);

            expect(
              result.ok,
              `step ${step} (${action.kind} of ${target.id}) must not error`,
            ).toBe(true);

            assertUnionInvariant(
              store,
              USER_ID,
              `after step ${step} (${action.kind} of ${target.id})`,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/* ─── Property: syncEntitlementForUser is idempotent ─── */

describe("Idempotence of syncEntitlementForUser", () => {
  it("running the sync twice in a row produces the same Entitlement state as running it once", async () => {
    await fc.assert(
      fc.asyncProperty(requestSetArb, async (specs) => {
        const { store } = seedStore(specs);

        await syncEntitlementForUser(store.client, USER_ID, ADMIN.email, NOW);
        const afterOnce: EntitlementRecord | undefined =
          store.getEntitlement(USER_ID);

        await syncEntitlementForUser(store.client, USER_ID, ADMIN.email, NOW);
        const afterTwice: EntitlementRecord | undefined =
          store.getEntitlement(USER_ID);

        expect(afterTwice).toEqual(afterOnce);

        // The once-synced state must itself satisfy the union invariant.
        assertUnionInvariant(store, USER_ID, "after sync");
      }),
      { numRuns: 100 },
    );
  });

  it("sync is idempotent even when the seeded Entitlement is stale (drifted from the approved set)", async () => {
    await fc.assert(
      fc.asyncProperty(
        requestSetArb,
        featuresArb,
        countriesArb,
        async (specs, staleFeatures, staleCountry) => {
          const { store } = seedStore(specs);

          // Overwrite the consistent seed with a deliberately stale record,
          // simulating drift left behind by the pre-fix handlers.
          store.seedEntitlement({
            userId: USER_ID,
            country: staleCountry,
            allowedFeatures: staleFeatures,
            grantedBy: "stale@heimdall.test",
            grantedAt: "2024-12-31T00:00:00.000Z",
          });

          await syncEntitlementForUser(store.client, USER_ID, ADMIN.email, NOW);
          const afterOnce = store.getEntitlement(USER_ID);

          await syncEntitlementForUser(store.client, USER_ID, ADMIN.email, NOW);
          const afterTwice = store.getEntitlement(USER_ID);

          expect(afterTwice).toEqual(afterOnce);
          assertUnionInvariant(store, USER_ID, "after sync of stale record");
        },
      ),
      { numRuns: 100 },
    );
  });
});
