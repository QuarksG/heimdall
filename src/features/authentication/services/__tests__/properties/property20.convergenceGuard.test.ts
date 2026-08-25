// Feature: granular-feature-entitlements, Property 20: Convergence refresh fires exactly once per difference
//
// For any initial Token_Claim value and any sequence of live entitlement
// states (including repeated emissions, permutations and duplications of the
// same feature/country sets, null, and empty values), folding the sequence
// through the convergence guard (shouldForceRefresh + signature recording)
// initiates a Forced_Token_Refresh if and only if the emitted state's
// canonical signature differs from the Token_Claim's signature and differs
// from the signature that last triggered a refresh — so re-emissions of an
// already-handled difference and states set-equal to the claim never fire,
// and every genuinely new difference fires exactly once.
//
// **Validates: Requirements 10.1, 10.3**

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  entitlementSignature,
  shouldForceRefresh,
  type Entitlements,
} from "../../entitlementCore";

/** Small pools so set-equal values (differing only in ordering, duplication,
 *  or country-string formatting) occur often across a sequence. */
const featurePool = ["reports", "exports", "audit", "admin"] as const;
const countryPool = ["TR", "DE", "US"] as const;

/** Feature list drawn from the pool with random duplication, then shuffled,
 *  so the same feature SET frequently appears with different orderings and
 *  repeated entries. */
const featureListArb = fc
  .uniqueArray(fc.constantFrom(...featurePool), { maxLength: featurePool.length })
  .chain((base) =>
    fc
      .array(fc.constantFrom(...featurePool), { maxLength: 3 })
      .map((dupes) => [...base, ...dupes.filter((f) => base.includes(f))]),
  )
  .chain((list) => fc.shuffledSubarray(list, { minLength: list.length }));

/** Comma-separated country string built from a shuffled, possibly duplicated
 *  selection, with occasional whitespace padding around codes. */
const countryStringArb = fc
  .uniqueArray(fc.constantFrom(...countryPool), { maxLength: countryPool.length })
  .chain((base) =>
    fc
      .array(fc.constantFrom(...countryPool), { maxLength: 2 })
      .map((dupes) => [...base, ...dupes.filter((c) => base.includes(c))]),
  )
  .chain((list) => fc.shuffledSubarray(list, { minLength: list.length }))
  .chain((codes) =>
    fc
      .array(fc.constantFrom("", " "), {
        minLength: codes.length,
        maxLength: codes.length,
      })
      .map((pads) => codes.map((code, i) => `${pads[i]}${code}${pads[i]}`).join(",")),
  );

/** Entitlement state: null, empty, or a feature/country set from the pools. */
const entitlementArb: fc.Arbitrary<Entitlements | null> = fc.oneof(
  fc.constant(null),
  fc.constant({ country: "", allowedFeatures: [] } as Entitlements),
  fc.record({ country: countryStringArb, allowedFeatures: featureListArb }),
);

/** Sequences of 1–15 live emissions. */
const emissionsArb = fc.array(entitlementArb, { minLength: 1, maxLength: 15 });

describe("Property 20: Convergence refresh fires exactly once per difference", () => {
  it("fires iff the emission's signature differs from both the claim's and the last-refreshed signature", () => {
    fc.assert(
      fc.property(entitlementArb, emissionsArb, (claim, emissions) => {
        const claimSig = entitlementSignature(claim);

        // Pure fold mimicking the effectful side: the signature is recorded
        // BEFORE the refresh call, and the claim stays fixed — the guard is
        // tested in isolation.
        let lastSig: string | null = null;

        for (const live of emissions) {
          const sigAtEmission = lastSig;
          const fired = shouldForceRefresh(claim, live, sigAtEmission);
          const liveSig = entitlementSignature(live);

          // Core iff: fired exactly when the emission differs from the claim
          // AND from the signature that last triggered a refresh.
          expect(fired).toBe(liveSig !== claimSig && liveSig !== sigAtEmission);

          // States set-equal to the claim never fire.
          if (liveSig === claimSig) expect(fired).toBe(false);

          if (fired) {
            lastSig = liveSig;

            // Re-emitting the same set-equal state immediately after a fire
            // never fires again — even reordered/duplicated variants share
            // the canonical signature, so the guard sees them as handled.
            expect(shouldForceRefresh(claim, live, lastSig)).toBe(false);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
