// Feature: granular-feature-entitlements, Property 8: Per-request toggle semantics
//
// For any reviewed Access_Request (APPROVED or REJECTED) and any feature in
// its Requested_Features, `planRequestToggle` produces a patch such that:
// toggling off removes exactly that feature from the effective
// Granted_Features leaving all others intact; toggling on adds exactly that
// feature; the resulting granted set is empty if and only if the patch status
// is REJECTED, and non-empty if and only if the patch status is APPROVED
// (including APPROVED for a toggle-on against a REJECTED request); and every
// patch carries the reviewer-metadata flag.
//
// **Validates: Requirements 3.2, 3.3, 3.4, 3.10**

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  planRequestToggle,
  effectiveGrantedFeatures,
  type RequestSnapshot,
} from "../../entitlementCore";

/** Feature identifiers: a realistic catalog plus arbitrary non-empty strings. */
const featureIdArb = fc.oneof(
  fc.constantFrom("reports", "exports", "audit", "admin", "dashboards"),
  fc.string({ minLength: 1, maxLength: 20 }),
);

/** Reviewed requests only — the Request_History toggles never target PENDING. */
const reviewedStatusArb = fc.constantFrom<RequestSnapshot["status"]>(
  "APPROVED",
  "REJECTED",
);

/** A reviewed request with non-empty requestedFeatures and grantedFeatures as
 *  a stored subset or a legacy null, plus an index used to draw the target
 *  feature from requestedFeatures and the toggle direction. */
const scenarioArb = fc
  .uniqueArray(featureIdArb, { minLength: 1, maxLength: 6 })
  .chain((requestedFeatures) =>
    fc.record({
      request: fc.record<RequestSnapshot>({
        id: fc.constant("req-1"),
        userId: fc.constant("user-a"),
        email: fc.emailAddress(),
        fullName: fc.string({ maxLength: 30 }),
        country: fc.constantFrom("TR", "TR,DE", "US, GB", ""),
        requestedFeatures: fc.constant(requestedFeatures),
        grantedFeatures: fc.option(fc.subarray(requestedFeatures), {
          nil: null,
        }),
        status: reviewedStatusArb,
      }),
      featureIndex: fc.nat(),
      turnOn: fc.boolean(),
    }),
  );

describe("Property 8: Per-request toggle semantics", () => {
  it("off removes exactly the feature, on adds exactly the feature, status is REJECTED iff the granted set is empty, and every patch flags reviewer metadata", () => {
    fc.assert(
      fc.property(scenarioArb, ({ request, featureIndex, turnOn }) => {
        // Target feature drawn from the (non-empty by construction)
        // requested features.
        const feature =
          request.requestedFeatures[
            featureIndex % request.requestedFeatures.length
          ];

        const effectiveBefore = effectiveGrantedFeatures(request);
        const before = structuredClone(request);

        const patch = planRequestToggle(request, feature, turnOn);

        // The planner is pure: the input request is not mutated.
        expect(request).toEqual(before);

        // The patch targets the toggled request and always carries the
        // reviewer-metadata flag.
        expect(patch.requestId).toBe(request.id);
        expect(patch.setReviewMetadata).toBe(true);

        // Off removes exactly the feature; on adds exactly the feature —
        // all other effective granted features are left intact and nothing
        // else is introduced.
        const resulting = new Set(patch.grantedFeatures);
        const expected = new Set(effectiveBefore);
        if (turnOn) expected.add(feature);
        else expected.delete(feature);
        expect([...resulting].sort()).toEqual([...expected].sort());
        expect(resulting.has(feature)).toBe(turnOn);

        // Empty resulting granted set <-> REJECTED; non-empty <-> APPROVED.
        expect(patch.status).toBe(
          patch.grantedFeatures.length === 0 ? "REJECTED" : "APPROVED",
        );

        // Toggle ON always yields a non-empty set, so the status is APPROVED
        // — including a toggle-on against a REJECTED request.
        if (turnOn) expect(patch.status).toBe("APPROVED");
      }),
      { numRuns: 100 },
    );
  });
});
