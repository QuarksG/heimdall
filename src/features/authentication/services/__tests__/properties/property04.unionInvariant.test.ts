// Feature: granular-feature-entitlements, Property 4: Entitlement union invariant
//
// For any set of Access_Request records for a user (any mix of statuses,
// granted subsets, legacy null grants, and overlapping features and
// comma-separated country lists), running `syncEntitlement` produces an
// Entitlement_Record whose `allowedFeatures` equals the deduplicated union of
// effective Granted_Features across APPROVED requests and whose `country`
// equals the deduplicated union of country codes across those same APPROVED
// requests, with each feature and country stored exactly once; and when that
// union of features is empty, no Entitlement_Record exists afterward and the
// sync completes without error whether or not a record existed before.
//
// **Validates: Requirements 2.3, 2.4, 2.5, 8.3**

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { syncEntitlement } from "../../entitlementSync";
import { effectiveGrantedFeatures } from "../../entitlementCore";
import {
  createMockDataClient,
  type AccessRequestRecord,
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

/** Comma-separated country strings with overlaps, whitespace, and blanks. */
const countryArb = fc.constantFrom(
  "TR",
  "TR,DE",
  "DE,TR",
  "US, GB",
  "TR,TR",
  " FR ,DE",
  "",
);

/** Request body: requestedFeatures plus a grantedFeatures value that is
 *  either a subset of requestedFeatures or null (legacy record). */
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
      fullName: "Union User",
      createdAt: `2026-01-0${(index % 9) + 1}T00:00:00.000Z`,
      ...body,
    })),
  );

/** Whether a pre-existing Entitlement record is seeded before the sync. */
const preExistingArb = fc.boolean();

function expectedUnion(requests: AccessRequestRecord[]): {
  features: string[];
  countries: string[];
} {
  const features = new Set<string>();
  const countries = new Set<string>();
  for (const req of requests) {
    if (req.status !== "APPROVED") continue;
    const effective = effectiveGrantedFeatures({
      id: req.id,
      userId: req.userId,
      email: req.email,
      fullName: req.fullName,
      country: req.country,
      requestedFeatures: req.requestedFeatures,
      grantedFeatures:
        req.grantedFeatures == null
          ? null
          : req.grantedFeatures.filter((f): f is string => f != null),
      status: req.status,
    });
    for (const f of effective) features.add(f);
    for (const code of req.country.split(",")) {
      const trimmed = code.trim();
      if (trimmed) countries.add(trimmed);
    }
  }
  return {
    features: [...features].sort(),
    countries: [...countries].sort(),
  };
}

describe("Property 4: Entitlement union invariant", () => {
  it("syncEntitlement persists exactly the deduplicated union over APPROVED requests, deleting when empty", async () => {
    await fc.assert(
      fc.asyncProperty(requestSetArb, preExistingArb, async (requests, preExisting) => {
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

        const result = await syncEntitlement(
          store.client,
          USER_ID,
          "admin@heimdall.test",
          NOW,
        );

        // The sync completes without error whether or not a record existed.
        expect(result.ok).toBe(true);

        const expected = expectedUnion(requests);
        const record = store.getEntitlement(USER_ID);

        if (expected.features.length === 0) {
          // Empty feature union -> no Entitlement record exists afterward.
          expect(record).toBeUndefined();
        } else {
          expect(record).toBeDefined();
          // Each feature stored exactly once, equal to the union as a set.
          expect([...record!.allowedFeatures].sort()).toEqual(expected.features);
          expect(new Set(record!.allowedFeatures).size).toBe(
            record!.allowedFeatures.length,
          );
          // Country string is the deduplicated union of codes.
          const storedCountries = record!.country
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean)
            .sort();
          expect(storedCountries).toEqual(expected.countries);
          expect(new Set(storedCountries).size).toBe(storedCountries.length);
        }

        // The result union mirrors what was persisted.
        if (result.ok) {
          expect(result.union.allowedFeatures).toEqual(expected.features);
          expect(result.union.countries).toEqual(expected.countries);
        }
      }),
      { numRuns: 100 },
    );
  });
});
