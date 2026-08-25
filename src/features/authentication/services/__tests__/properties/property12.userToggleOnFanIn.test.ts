// Feature: granular-feature-entitlements, Property 12: User_Card toggle-on fan-in
//
// For any user group and any feature that appears in some request's
// Requested_Features but not in the user's Entitlement_Union,
// `planUserToggleOn` produces exactly one patch; the target request's
// Requested_Features contains the feature; the patch status is APPROVED; the
// patch preserves the granted-subset invariant; and the recomputed
// Entitlement_Union contains the feature. Furthermore, toggling on and then
// off returns the Entitlement_Union to a state not containing the feature
// (round trip).
//
// **Validates: Requirements 8.5**

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  groupRequestsByUser,
  planUserToggleOn,
  planUserToggleOff,
  computeEntitlementUnion,
  isValidGrantedSubset,
  type RequestSnapshot,
  type RequestPatch,
} from "../../entitlementCore";

/** Distinguished target feature — stripped from every generated feature list
 *  and re-inserted only into host requests' Requested_Features, so it is
 *  requested-but-not-entitled by construction. */
const TARGET = "__target-feature__";

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

/** Arbitrary request for the user: mixed statuses, granted subsets of the
 *  requested features, and legacy nulls. */
const requestBodyArb: fc.Arbitrary<RequestBody> = fc
  .array(featureIdArb, { maxLength: 6 })
  .chain((requestedFeatures) =>
    fc.record({
      email: fc.emailAddress(),
      fullName: fc.string({ maxLength: 30 }),
      country: fc.constantFrom("TR", "TR,DE", "US, GB", ""),
      createdAt: createdAtArb,
      requestedFeatures: fc.constant(requestedFeatures),
      grantedFeatures: fc.option(fc.subarray(requestedFeatures), {
        nil: null,
      }),
      status: statusArb,
    }),
  );

/** One user's request set (unique ids, single userId) where the TARGET
 *  feature appears in the Requested_Features of at least one request (the
 *  hosts) but in no request's effective Granted_Features — so it is absent
 *  from the Entitlement_Union by construction. Legacy full grants
 *  (grantedFeatures null + APPROVED) on host requests are materialized so
 *  the null is not reinterpreted as granting the TARGET. */
const scenarioArb: fc.Arbitrary<RequestSnapshot[]> = fc
  .array(requestBodyArb, { minLength: 1, maxLength: 10 })
  .chain((bodies) =>
    fc.record({
      bodies: fc.constant(bodies),
      hostIndices: fc.subarray(
        bodies.map((_, index) => index),
        { minLength: 1 },
      ),
    }),
  )
  .map(({ bodies, hostIndices }) => {
    const hosts = new Set(hostIndices);

    return bodies.map((body, index): RequestSnapshot => {
      // The distinguished target must not leak in via random generation.
      const requestedFeatures = body.requestedFeatures.filter(
        (f) => f !== TARGET,
      );
      const grantedFeatures =
        body.grantedFeatures === null
          ? null
          : body.grantedFeatures.filter((f) => f !== TARGET);

      const base: RequestSnapshot = {
        id: `req-${index}`,
        userId: "user-a",
        ...body,
        requestedFeatures,
        grantedFeatures,
      };
      if (!hosts.has(index)) return base;

      return {
        ...base,
        requestedFeatures: [...requestedFeatures, TARGET],
        // A legacy null on an APPROVED host would be interpreted as granting
        // ALL requested features (including TARGET) — materialize it.
        grantedFeatures:
          grantedFeatures === null && body.status === "APPROVED"
            ? [...requestedFeatures]
            : grantedFeatures,
      };
    });
  });

/** Applies a patch to an in-memory copy of the request set. */
function applyPatches(
  requests: RequestSnapshot[],
  patches: RequestPatch[],
): RequestSnapshot[] {
  const byId = new Map(patches.map((p) => [p.requestId, p]));
  return requests.map((req) => {
    const patch = byId.get(req.id);
    return patch
      ? { ...req, grantedFeatures: patch.grantedFeatures, status: patch.status }
      : req;
  });
}

describe("Property 12: User_Card toggle-on fan-in", () => {
  it("grants a requested-but-not-entitled feature via exactly one APPROVED subset-preserving patch, and the on-then-off round trip removes it from the union", () => {
    fc.assert(
      fc.property(scenarioArb, (requests) => {
        const [group] = groupRequestsByUser(requests);

        // Precondition holds by construction: requested but not entitled.
        expect(group.requestedUnion).toContain(TARGET);
        expect(group.entitlementUnion.allowedFeatures).not.toContain(TARGET);

        // Exactly one patch.
        const patch = planUserToggleOn(group, TARGET);
        expect(patch).not.toBeNull();
        if (patch === null) return;

        // The target request's Requested_Features contains the feature.
        const target = group.requests.find((r) => r.id === patch.requestId);
        expect(target).toBeDefined();
        expect(target!.requestedFeatures).toContain(TARGET);

        // The patch status is APPROVED.
        expect(patch.status).toBe("APPROVED");

        // The patch preserves the granted-subset invariant.
        expect(
          isValidGrantedSubset(patch.grantedFeatures, target!.requestedFeatures),
        ).toBe(true);

        // Recomputed Entitlement_Union contains the feature.
        const afterOn = applyPatches(requests, [patch]);
        expect(computeEntitlementUnion(afterOn).allowedFeatures).toContain(
          TARGET,
        );

        // Round trip: toggling off on the re-grouped state returns the union
        // to a state not containing the feature.
        const [regrouped] = groupRequestsByUser(afterOn);
        const offPatches = planUserToggleOff(regrouped, TARGET);
        const afterOff = applyPatches(afterOn, offPatches);
        expect(computeEntitlementUnion(afterOff).allowedFeatures).not.toContain(
          TARGET,
        );
      }),
      { numRuns: 100 },
    );
  });
});
