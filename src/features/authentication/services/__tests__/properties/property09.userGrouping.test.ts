// Feature: granular-feature-entitlements, Property 9: User grouping is a lossless partition
//
// For any set of Access_Request records, `groupRequestsByUser` produces
// exactly one group per distinct `userId`, every request appears in exactly
// the group matching its `userId`, no request is lost or duplicated, and a
// group's `hasPending` flag is true if and only if the group contains at
// least one PENDING request.
//
// **Validates: Requirements 8.1, 7.4**

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  groupRequestsByUser,
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

/** Small userId pool so generated request sets collide on users, exercising
 *  multi-request groups. */
const userIdArb = fc.constantFrom("user-a", "user-b", "user-c", "user-d");

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
  userId: userIdArb,
  email: fc.emailAddress(),
  fullName: fc.string({ maxLength: 30 }),
  country: fc.constantFrom("TR", "TR,DE", "US, GB", ""),
  requestedFeatures: fc.array(featureIdArb, { maxLength: 6 }),
  grantedFeatures: fc.option(fc.array(featureIdArb, { maxLength: 6 }), {
    nil: null,
  }),
  status: statusArb,
  createdAt: createdAtArb,
});

/** Arrays of requests with guaranteed-unique ids. */
const requestsArb: fc.Arbitrary<RequestSnapshot[]> = fc
  .array(requestBodyArb, { maxLength: 25 })
  .map((bodies) =>
    bodies.map((body, index) => ({ id: `req-${index}`, ...body })),
  );

describe("Property 9: User grouping is a lossless partition", () => {
  it("partitions requests losslessly by userId with hasPending iff a PENDING request exists", () => {
    fc.assert(
      fc.property(requestsArb, (requests) => {
        const groups = groupRequestsByUser(requests);

        // Exactly one group per distinct input userId — no extras, no dupes.
        const inputUserIds = new Set(requests.map((req) => req.userId));
        const groupUserIds = groups.map((group) => group.userId);
        expect(new Set(groupUserIds)).toEqual(inputUserIds);
        expect(groupUserIds.length).toBe(inputUserIds.size);

        // Every request in a group carries that group's userId.
        for (const group of groups) {
          for (const req of group.requests) {
            expect(req.userId).toBe(group.userId);
          }
        }

        // Lossless: total count preserved and every input id appears exactly
        // once across all groups.
        const allGroupedIds = groups.flatMap((group) =>
          group.requests.map((req) => req.id),
        );
        expect(allGroupedIds.length).toBe(requests.length);
        expect(new Set(allGroupedIds)).toEqual(
          new Set(requests.map((req) => req.id)),
        );

        // hasPending iff the group contains at least one PENDING request.
        for (const group of groups) {
          const containsPending = group.requests.some(
            (req) => req.status === "PENDING",
          );
          expect(group.hasPending).toBe(containsPending);
        }
      }),
      { numRuns: 100 },
    );
  });
});
