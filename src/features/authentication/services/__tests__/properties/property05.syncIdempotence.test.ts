// Feature: granular-feature-entitlements, Property 5: Sync idempotence
//
// For any set of Access_Request records for a user, running `syncEntitlement`
// twice in succession yields the same Entitlement state as running it once.
//
// **Validates: Requirements 2.3**

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { syncEntitlement } from "../../entitlementSync";
import {
  createMockDataClient,
  type AccessRequestRecord,
  type EntitlementRecord,
} from "../mockAmplifyDataClient";

const USER_ID = "user-under-test";
const NOW = "2026-08-25T12:00:00.000Z";

const featurePool = [
  "reports",
  "exports",
  "audit",
  "admin",
  "dashboards",
  "billing",
] as const;

const featureIdArb = fc.constantFrom(...featurePool);

const statusArb = fc.constantFrom<AccessRequestRecord["status"]>(
  "PENDING",
  "APPROVED",
  "REJECTED",
);

const countryArb = fc.constantFrom(
  "TR",
  "TR,DE",
  "DE,TR",
  "US, GB",
  "TR,TR",
  " FR ,DE",
  "",
);

const requestBodyArb = fc
  .record({
    requestedFeatures: fc.uniqueArray(featureIdArb, { maxLength: 4 }),
    grantedSubsetSeed: fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
    useLegacyNull: fc.boolean(),
    status: statusArb,
    country: countryArb,
  })
  .map(({ requestedFeatures, grantedSubsetSeed, useLegacyNull, status, country }) => ({
    requestedFeatures,
    grantedFeatures: useLegacyNull
      ? null
      : requestedFeatures.filter((_, i) => grantedSubsetSeed[i] ?? false),
    status,
    country,
  }));

const requestSetArb: fc.Arbitrary<AccessRequestRecord[]> = fc
  .array(requestBodyArb, { maxLength: 8 })
  .map((bodies) =>
    bodies.map((body, index) => ({
      id: `req-${index}`,
      userId: USER_ID,
      email: "user@heimdall.test",
      fullName: "Idempotence User",
      createdAt: `2026-01-0${(index % 9) + 1}T00:00:00.000Z`,
      ...body,
    })),
  );

function entitlementState(record: EntitlementRecord | undefined) {
  if (!record) return null;
  return {
    userId: record.userId,
    country: record.country,
    allowedFeatures: [...record.allowedFeatures],
    grantedBy: record.grantedBy ?? null,
    grantedAt: record.grantedAt ?? null,
  };
}

describe("Property 5: Sync idempotence", () => {
  it("running syncEntitlement twice yields the same Entitlement state as running it once", async () => {
    await fc.assert(
      fc.asyncProperty(requestSetArb, fc.boolean(), async (requests, preExisting) => {
        const store = createMockDataClient();
        for (const record of requests) store.seedAccessRequest(record);
        if (preExisting) {
          store.seedEntitlement({
            userId: USER_ID,
            country: "XX",
            allowedFeatures: ["stale-feature"],
            grantedBy: "old-admin@heimdall.test",
            grantedAt: "2025-01-01T00:00:00.000Z",
          });
        }

        const first = await syncEntitlement(
          store.client,
          USER_ID,
          "admin@heimdall.test",
          NOW,
        );
        expect(first.ok).toBe(true);
        const stateAfterFirst = entitlementState(store.getEntitlement(USER_ID));

        const second = await syncEntitlement(
          store.client,
          USER_ID,
          "admin@heimdall.test",
          NOW,
        );
        expect(second.ok).toBe(true);
        const stateAfterSecond = entitlementState(store.getEntitlement(USER_ID));

        // Same persisted state (record contents or absence) both times.
        expect(stateAfterSecond).toEqual(stateAfterFirst);

        // And the computed unions agree.
        if (first.ok && second.ok) {
          expect(second.union).toEqual(first.union);
        }
      }),
      { numRuns: 100 },
    );
  });
});
