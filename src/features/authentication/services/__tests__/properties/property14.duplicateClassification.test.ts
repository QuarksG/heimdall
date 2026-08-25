// Feature: granular-feature-entitlements, Property 14: Duplicate classification
//
// For any set of a user's existing Access_Request records and any feature
// catalog, `classifyDuplicates` marks a feature as a Duplicate_Feature if and
// only if it is a member of the Requested_Features of at least one existing
// record, regardless of that record's status, and the status reported for
// each duplicate is the status of an existing record whose Requested_Features
// contains that feature.
//
// **Validates: Requirements 9.1, 9.6**

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  classifyDuplicates,
  type RequestSnapshot,
} from "../../entitlementCore";

/** Shared feature pool so catalogs and requestedFeatures overlap frequently,
 *  exercising both the duplicate and non-duplicate branches. */
const featurePool = [
  "reports",
  "exports",
  "audit",
  "admin",
  "dashboards",
  "billing",
] as const;

const featureIdArb = fc.constantFrom(...featurePool);

const statusArb = fc.constantFrom<RequestSnapshot["status"]>(
  "PENDING",
  "APPROVED",
  "REJECTED",
);

/** Optional ISO-8601 creation timestamp; null exercises the legacy-missing
 *  ordering path. */
const createdAtArb = fc.option(
  fc
    .date({ min: new Date("2020-01-01"), max: new Date("2030-01-01") })
    .map((d) => d.toISOString()),
  { nil: null },
);

/** Request without an id; unique ids are assigned by index afterwards. */
const requestBodyArb = fc.record({
  userId: fc.constant("user-a"),
  email: fc.emailAddress(),
  fullName: fc.string({ maxLength: 30 }),
  country: fc.constantFrom("TR", "TR,DE", "US, GB", ""),
  requestedFeatures: fc.array(featureIdArb, { maxLength: 4 }),
  grantedFeatures: fc.option(fc.array(featureIdArb, { maxLength: 4 }), {
    nil: null,
  }),
  status: statusArb,
  createdAt: createdAtArb,
});

/** Existing request sets with guaranteed-unique ids. */
const existingRequestsArb: fc.Arbitrary<RequestSnapshot[]> = fc
  .array(requestBodyArb, { maxLength: 10 })
  .map((bodies) =>
    bodies.map((body, index) => ({ id: `req-${index}`, ...body })),
  );

/** Feature catalogs drawn from the same pool, so overlap with existing
 *  requestedFeatures is common but not guaranteed. */
const catalogArb = fc.array(featureIdArb, { maxLength: 8 });

describe("Property 14: Duplicate classification", () => {
  it("marks a feature as duplicate iff some existing record requested it, reporting that record's status", () => {
    fc.assert(
      fc.property(existingRequestsArb, catalogArb, (existing, catalog) => {
        const duplicates = classifyDuplicates(existing, catalog);

        // A catalog feature is in the map iff at least one existing record's
        // requestedFeatures contains it — regardless of that record's status.
        for (const feature of catalog) {
          const isRequestedSomewhere = existing.some((req) =>
            req.requestedFeatures.includes(feature),
          );
          expect(duplicates.has(feature)).toBe(isRequestedSomewhere);
        }

        // The map contains only catalog features (no fabricated entries).
        for (const feature of duplicates.keys()) {
          expect(catalog).toContain(feature);
        }

        // Each duplicate's reported status is the status of at least one
        // existing record whose requestedFeatures contains that feature.
        for (const [feature, status] of duplicates) {
          const statusesOfContaining = existing
            .filter((req) => req.requestedFeatures.includes(feature))
            .map((req) => req.status);
          expect(statusesOfContaining).toContain(status);
        }
      }),
      { numRuns: 100 },
    );
  });
});
