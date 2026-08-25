// Feature: granular-feature-entitlements, Property 3: Legacy granted-features interpretation
//
// For any Access_Request whose `grantedFeatures` field is absent,
// `effectiveGrantedFeatures` returns the Requested_Features if the status is
// APPROVED and the empty set for any other status; for any request where the
// field is present, it returns the stored value.
//
// **Validates: Requirements 2.6**

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  effectiveGrantedFeatures,
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

/** Requests with grantedFeatures present (arbitrary stored array) or absent
 *  (null legacy record), across all three statuses. */
const requestArb: fc.Arbitrary<RequestSnapshot> = fc.record({
  id: fc.uuid(),
  userId: fc.string({ minLength: 1, maxLength: 12 }),
  email: fc.emailAddress(),
  fullName: fc.string({ maxLength: 30 }),
  country: fc.constantFrom("TR", "TR,DE", "US, GB", ""),
  requestedFeatures: fc.array(featureIdArb, { maxLength: 6 }),
  grantedFeatures: fc.option(fc.array(featureIdArb, { maxLength: 6 }), {
    nil: null,
  }),
  status: statusArb,
});

describe("Property 3: Legacy granted-features interpretation", () => {
  it("returns the stored value when present; requestedFeatures when absent + APPROVED; empty set otherwise", () => {
    fc.assert(
      fc.property(requestArb, (req) => {
        const effective = effectiveGrantedFeatures(req);

        if (req.grantedFeatures !== null) {
          // Field present -> the stored value, regardless of status.
          expect(effective).toEqual(req.grantedFeatures);
        } else if (req.status === "APPROVED") {
          // Legacy record + APPROVED -> full grant.
          expect(effective).toEqual(req.requestedFeatures);
        } else {
          // Legacy record + PENDING/REJECTED -> empty set.
          expect(effective).toEqual([]);
        }
      }),
      { numRuns: 100 },
    );
  });
});
