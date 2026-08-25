// Feature: granular-feature-entitlements, Property 11: User_Card toggle-off fan-out
//
// For any user group and any feature in that user's Entitlement_Union,
// applying the patches from `planUserToggleOff`: removes the feature from the
// effective Granted_Features of every request that granted it; modifies no
// request that did not grant it; sets every request whose granted set becomes
// empty to REJECTED; carries the reviewer-metadata flag on every patch; and
// the recomputed Entitlement_Union no longer contains the feature.
//
// **Validates: Requirements 8.4**

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  groupRequestsByUser,
  planUserToggleOff,
  effectiveGrantedFeatures,
  computeEntitlementUnion,
  type RequestSnapshot,
} from "../../entitlementCore";

/** Feature identifiers: a realistic catalog plus arbitrary non-empty strings. */
const featureIdArb = fc.oneof(
  fc.constantFrom("reports", "exports", "audit", "admin", "dashboards"),
  fc.string({ minLength: 1, maxLength: 20 }),
);

const statusArb = fc.constantFrom<RequestSnapshot["status"]>(
  "PENDING",
  "APPROVED",
  "REJECTED",
);

/** Optional ISO-8601 creation timestamp; null exercises the legacy-missing
 *  ordering path in grouping. */
const createdAtArb = fc.option(
  fc
    .date({ min: new Date("2020-01-01"), max: new Date("2030-01-01") })
    .map((d) => d.toISOString()),
  { nil: null },
);

type RequestBody = Omit<RequestSnapshot, "id" | "userId">;

const identityFieldsArb = {
  email: fc.emailAddress(),
  fullName: fc.string({ maxLength: 30 }),
  country: fc.constantFrom("TR", "TR,DE", "US, GB", ""),
  createdAt: createdAtArb,
};

/** Arbitrary request for the user: mixed statuses, granted subsets of the
 *  requested features, and legacy nulls. */
const otherRequestArb: fc.Arbitrary<RequestBody> = fc
  .array(featureIdArb, { maxLength: 6 })
  .chain((requestedFeatures) =>
    fc.record({
      ...identityFieldsArb,
      requestedFeatures: fc.constant(requestedFeatures),
      grantedFeatures: fc.option(fc.subarray(requestedFeatures), {
        nil: null,
      }),
      status: statusArb,
    }),
  );

/** Guarantees a non-empty Entitlement_Union: one APPROVED request whose
 *  effective granted set is non-empty (stored non-empty subset, or a legacy
 *  null interpreted as the full non-empty requested set). */
const seedRequestArb: fc.Arbitrary<RequestBody> = fc
  .array(featureIdArb, { minLength: 1, maxLength: 6 })
  .chain((requestedFeatures) =>
    fc.record({
      ...identityFieldsArb,
      requestedFeatures: fc.constant(requestedFeatures),
      grantedFeatures: fc.oneof(
        fc.constant(null),
        fc.subarray(requestedFeatures, { minLength: 1 }),
      ),
      status: fc.constant<RequestSnapshot["status"]>("APPROVED"),
    }),
  );

/** One user's request set (unique ids, single userId) plus an index used to
 *  draw the target feature from the resulting Entitlement_Union. */
const scenarioArb = fc
  .tuple(seedRequestArb, fc.array(otherRequestArb, { maxLength: 10 }), fc.nat())
  .map(([seed, others, featureIndex]) => {
    const requests: RequestSnapshot[] = [seed, ...others].map(
      (body, index) => ({ id: `req-${index}`, userId: "user-a", ...body }),
    );
    return { requests, featureIndex };
  });

describe("Property 11: User_Card toggle-off fan-out", () => {
  it("removes the feature everywhere it was granted, touches nothing else, and the recomputed union no longer contains it", () => {
    fc.assert(
      fc.property(scenarioArb, ({ requests, featureIndex }) => {
        const [group] = groupRequestsByUser(requests);

        // Target feature drawn from the (non-empty by construction) union.
        const union = group.entitlementUnion.allowedFeatures;
        expect(union.length).toBeGreaterThan(0);
        const feature = union[featureIndex % union.length];

        const before = structuredClone(group.requests);
        const patches = planUserToggleOff(group, feature);
        const patchById = new Map(patches.map((p) => [p.requestId, p]));

        // A request is patched iff its effective granted set contains the
        // feature — no request that did not grant it is modified.
        for (const req of group.requests) {
          const grantedIt = effectiveGrantedFeatures(req).includes(feature);
          expect(patchById.has(req.id)).toBe(grantedIt);
        }

        for (const req of group.requests) {
          const patch = patchById.get(req.id);
          if (!patch) continue;

          // Removes exactly the feature from the effective granted set.
          const expectedGranted = effectiveGrantedFeatures(req).filter(
            (f) => f !== feature,
          );
          expect(patch.grantedFeatures).toEqual(expectedGranted);

          // Empty resulting granted set -> REJECTED.
          if (patch.grantedFeatures.length === 0) {
            expect(patch.status).toBe("REJECTED");
          } else {
            expect(patch.status).toBe("APPROVED");
          }

          // Every patch carries the reviewer-metadata flag.
          expect(patch.setReviewMetadata).toBe(true);
        }

        // Apply the patches to an in-memory copy of the requests.
        const patched = group.requests.map((req) => {
          const patch = patchById.get(req.id);
          return patch
            ? {
                ...req,
                grantedFeatures: patch.grantedFeatures,
                status: patch.status,
              }
            : req;
        });

        // Untouched requests are unmodified (and the planner mutated nothing).
        group.requests.forEach((req, index) => {
          if (!patchById.has(req.id)) {
            expect(patched[index]).toEqual(before[index]);
          }
          expect(req).toEqual(before[index]);
        });

        // Recomputed Entitlement_Union no longer contains the feature.
        const recomputed = computeEntitlementUnion(patched);
        expect(recomputed.allowedFeatures).not.toContain(feature);
      }),
      { numRuns: 100 },
    );
  });
});
