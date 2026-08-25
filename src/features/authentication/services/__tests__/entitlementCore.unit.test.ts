// Minimal smoke tests for the pure core module created in task 2.1.
// Property tests for these functions are separate tasks (2.2, 5.3, 5.4);
// this file only pins down the concrete contract examples.
//
// **Validates: Requirements 1.3, 2.3, 2.5, 2.6, 2.8**

import { describe, it, expect } from "vitest";
import {
  classifyDuplicates,
  computeEntitlementUnion,
  effectiveGrantedFeatures,
  entitlementSignature,
  groupRequestsByUser,
  isValidGrantedSubset,
  partitionSubmission,
  planRequestToggle,
  planUserToggleOff,
  planUserToggleOn,
  shouldForceRefresh,
  type RequestSnapshot,
} from "../entitlementCore";

function makeRequest(overrides: Partial<RequestSnapshot> = {}): RequestSnapshot {
  return {
    id: "req-1",
    userId: "cognito-sub-user-1",
    email: "user@heimdall.test",
    fullName: "Test User",
    country: "TR",
    requestedFeatures: ["reports"],
    grantedFeatures: null,
    status: "PENDING",
    ...overrides,
  };
}

describe("effectiveGrantedFeatures (Req 2.6)", () => {
  it("returns the stored value when grantedFeatures is present", () => {
    const req = makeRequest({
      status: "APPROVED",
      requestedFeatures: ["reports", "exports"],
      grantedFeatures: ["reports"],
    });
    expect(effectiveGrantedFeatures(req)).toEqual(["reports"]);
  });

  it("returns requestedFeatures for legacy (null) APPROVED requests", () => {
    const req = makeRequest({
      status: "APPROVED",
      requestedFeatures: ["reports", "exports"],
      grantedFeatures: null,
    });
    expect(effectiveGrantedFeatures(req)).toEqual(["reports", "exports"]);
  });

  it("returns an empty set for legacy (null) non-APPROVED requests", () => {
    expect(
      effectiveGrantedFeatures(makeRequest({ status: "PENDING" })),
    ).toEqual([]);
    expect(
      effectiveGrantedFeatures(makeRequest({ status: "REJECTED" })),
    ).toEqual([]);
  });
});

describe("computeEntitlementUnion (Req 2.3, 2.5)", () => {
  it("unions effective granted features and countries across APPROVED requests only", () => {
    const requests: RequestSnapshot[] = [
      makeRequest({
        id: "a",
        status: "APPROVED",
        country: "TR, DE",
        requestedFeatures: ["reports", "exports"],
        grantedFeatures: ["exports"],
      }),
      makeRequest({
        id: "b",
        status: "APPROVED",
        country: "DE,FR",
        requestedFeatures: ["audit"],
        grantedFeatures: null, // legacy full grant
      }),
      makeRequest({
        id: "c",
        status: "PENDING",
        country: "US",
        requestedFeatures: ["admin"],
      }),
      makeRequest({
        id: "d",
        status: "REJECTED",
        country: "JP",
        requestedFeatures: ["admin"],
        grantedFeatures: ["admin"], // stored value present, but not APPROVED
      }),
    ];

    const union = computeEntitlementUnion(requests);
    expect(union.allowedFeatures).toEqual(["audit", "exports"]);
    expect(union.countries).toEqual(["DE", "FR", "TR"]);
  });

  it("returns empty arrays when no requests are APPROVED", () => {
    const union = computeEntitlementUnion([
      makeRequest({ status: "PENDING" }),
      makeRequest({ id: "req-2", status: "REJECTED" }),
    ]);
    expect(union).toEqual({ allowedFeatures: [], countries: [] });
  });

  it("deduplicates features and countries contributed by multiple requests", () => {
    const union = computeEntitlementUnion([
      makeRequest({
        id: "a",
        status: "APPROVED",
        country: "TR",
        grantedFeatures: ["reports"],
      }),
      makeRequest({
        id: "b",
        status: "APPROVED",
        country: "TR",
        grantedFeatures: ["reports"],
      }),
    ]);
    expect(union.allowedFeatures).toEqual(["reports"]);
    expect(union.countries).toEqual(["TR"]);
  });
});

describe("isValidGrantedSubset (Req 1.3, 2.8)", () => {
  it("accepts a proper subset, the full set, and the empty set", () => {
    expect(isValidGrantedSubset(["a"], ["a", "b"])).toBe(true);
    expect(isValidGrantedSubset(["a", "b"], ["a", "b"])).toBe(true);
    expect(isValidGrantedSubset([], ["a", "b"])).toBe(true);
  });

  it("rejects a set containing a feature not in requestedFeatures", () => {
    expect(isValidGrantedSubset(["a", "c"], ["a", "b"])).toBe(false);
    expect(isValidGrantedSubset(["c"], [])).toBe(false);
  });
});

describe("groupRequestsByUser (Req 8.1, 8.2, 8.3, 8.8)", () => {
  it("produces one group per distinct userId with every request in its group", () => {
    const requests: RequestSnapshot[] = [
      makeRequest({ id: "a1", userId: "u1" }),
      makeRequest({ id: "b1", userId: "u2" }),
      makeRequest({ id: "a2", userId: "u1" }),
    ];

    const groups = groupRequestsByUser(requests);
    expect(groups.map((g) => g.userId)).toEqual(["u1", "u2"]);
    expect(groups[0].requests.map((r) => r.id).sort()).toEqual(["a1", "a2"]);
    expect(groups[1].requests.map((r) => r.id)).toEqual(["b1"]);
  });

  it("sorts requests newest first and takes identity fields from the most recent", () => {
    const requests: RequestSnapshot[] = [
      makeRequest({
        id: "old",
        email: "old@heimdall.test",
        fullName: "Old Name",
        createdAt: "2024-01-01T00:00:00Z",
      }),
      makeRequest({
        id: "legacy",
        email: "legacy@heimdall.test",
        fullName: "Legacy Name",
        createdAt: null, // missing timestamp sorts as oldest
      }),
      makeRequest({
        id: "new",
        email: "new@heimdall.test",
        fullName: "New Name",
        createdAt: "2024-06-01T00:00:00Z",
      }),
    ];

    const [group] = groupRequestsByUser(requests);
    expect(group.requests.map((r) => r.id)).toEqual(["new", "old", "legacy"]);
    expect(group.email).toBe("new@heimdall.test");
    expect(group.fullName).toBe("New Name");
  });

  it("derives requestedUnion across all statuses and entitlementUnion over APPROVED only", () => {
    const requests: RequestSnapshot[] = [
      makeRequest({
        id: "a",
        status: "APPROVED",
        country: "TR",
        requestedFeatures: ["reports", "exports"],
        grantedFeatures: ["reports"],
        createdAt: "2024-01-02T00:00:00Z",
      }),
      makeRequest({
        id: "b",
        status: "PENDING",
        country: "US",
        requestedFeatures: ["audit", "reports"],
        createdAt: "2024-01-01T00:00:00Z",
      }),
    ];

    const [group] = groupRequestsByUser(requests);
    expect(group.requestedUnion).toEqual(["audit", "exports", "reports"]);
    expect(group.entitlementUnion.allowedFeatures).toEqual(["reports"]);
    expect(group.entitlementUnion.countries).toEqual(["TR"]);
  });

  it("sets hasPending iff the group contains at least one PENDING request", () => {
    const pending = groupRequestsByUser([
      makeRequest({ id: "a", status: "APPROVED", grantedFeatures: ["reports"] }),
      makeRequest({ id: "b", status: "PENDING" }),
    ]);
    expect(pending[0].hasPending).toBe(true);

    const reviewed = groupRequestsByUser([
      makeRequest({ id: "a", status: "APPROVED", grantedFeatures: ["reports"] }),
      makeRequest({ id: "b", status: "REJECTED" }),
    ]);
    expect(reviewed[0].hasPending).toBe(false);
  });

  it("returns an empty array for no requests", () => {
    expect(groupRequestsByUser([])).toEqual([]);
  });
});

describe("planRequestToggle (Req 3.2, 3.3, 3.4, 3.10)", () => {
  it("toggle off removes exactly that feature, leaving others intact (APPROVED)", () => {
    const req = makeRequest({
      status: "APPROVED",
      requestedFeatures: ["reports", "exports", "audit"],
      grantedFeatures: ["reports", "exports"],
    });
    const patch = planRequestToggle(req, "exports", false);
    expect(patch).toEqual({
      requestId: "req-1",
      grantedFeatures: ["reports"],
      status: "APPROVED",
      setReviewMetadata: true,
    });
  });

  it("toggle off of the last granted feature sets status REJECTED", () => {
    const req = makeRequest({
      status: "APPROVED",
      requestedFeatures: ["reports"],
      grantedFeatures: ["reports"],
    });
    const patch = planRequestToggle(req, "reports", false);
    expect(patch.grantedFeatures).toEqual([]);
    expect(patch.status).toBe("REJECTED");
    expect(patch.setReviewMetadata).toBe(true);
  });

  it("toggle on against a REJECTED request adds the feature and approves (Req 3.10)", () => {
    const req = makeRequest({
      status: "REJECTED",
      requestedFeatures: ["reports", "exports"],
      grantedFeatures: [],
    });
    const patch = planRequestToggle(req, "reports", true);
    expect(patch.grantedFeatures).toEqual(["reports"]);
    expect(patch.status).toBe("APPROVED");
    expect(patch.setReviewMetadata).toBe(true);
  });

  it("toggle on operates on the effective grant of a legacy APPROVED request", () => {
    const req = makeRequest({
      status: "APPROVED",
      requestedFeatures: ["reports", "exports"],
      grantedFeatures: null, // legacy full grant: effective = requestedFeatures
    });
    const patch = planRequestToggle(req, "reports", true);
    // Already effectively granted — no duplicate is added.
    expect(patch.grantedFeatures).toEqual(["reports", "exports"]);
    expect(patch.status).toBe("APPROVED");
  });
});

describe("planUserToggleOff (Req 8.4)", () => {
  it("patches every request granting the feature and skips the rest", () => {
    const requests: RequestSnapshot[] = [
      makeRequest({
        id: "a",
        status: "APPROVED",
        requestedFeatures: ["reports", "exports"],
        grantedFeatures: ["reports", "exports"],
        createdAt: "2024-03-01T00:00:00Z",
      }),
      makeRequest({
        id: "b",
        status: "APPROVED",
        requestedFeatures: ["reports"],
        grantedFeatures: ["reports"], // becomes empty -> REJECTED
        createdAt: "2024-02-01T00:00:00Z",
      }),
      makeRequest({
        id: "c",
        status: "APPROVED",
        requestedFeatures: ["audit"],
        grantedFeatures: ["audit"], // does not grant "reports" -> untouched
        createdAt: "2024-01-01T00:00:00Z",
      }),
    ];
    const [group] = groupRequestsByUser(requests);

    const patches = planUserToggleOff(group, "reports");
    expect(patches).toHaveLength(2);

    const byId = new Map(patches.map((p) => [p.requestId, p]));
    expect(byId.get("a")).toEqual({
      requestId: "a",
      grantedFeatures: ["exports"],
      status: "APPROVED",
      setReviewMetadata: true,
    });
    expect(byId.get("b")).toEqual({
      requestId: "b",
      grantedFeatures: [],
      status: "REJECTED",
      setReviewMetadata: true,
    });
    expect(byId.has("c")).toBe(false);
  });
});

describe("planUserToggleOn (Req 8.5)", () => {
  it("targets the most recent APPROVED request containing the feature", () => {
    const requests: RequestSnapshot[] = [
      makeRequest({
        id: "newest-rejected",
        status: "REJECTED",
        requestedFeatures: ["reports"],
        grantedFeatures: [],
        createdAt: "2024-03-01T00:00:00Z",
      }),
      makeRequest({
        id: "approved",
        status: "APPROVED",
        requestedFeatures: ["reports", "exports"],
        grantedFeatures: ["exports"],
        createdAt: "2024-02-01T00:00:00Z",
      }),
    ];
    const [group] = groupRequestsByUser(requests);

    const patch = planUserToggleOn(group, "reports");
    expect(patch).toEqual({
      requestId: "approved",
      grantedFeatures: ["exports", "reports"],
      status: "APPROVED",
      setReviewMetadata: true,
    });
  });

  it("falls back to the most recent request of any status (status -> APPROVED)", () => {
    const requests: RequestSnapshot[] = [
      makeRequest({
        id: "newer-rejected",
        status: "REJECTED",
        requestedFeatures: ["reports"],
        grantedFeatures: [],
        createdAt: "2024-03-01T00:00:00Z",
      }),
      makeRequest({
        id: "older-pending",
        status: "PENDING",
        requestedFeatures: ["reports"],
        grantedFeatures: null,
        createdAt: "2024-01-01T00:00:00Z",
      }),
    ];
    const [group] = groupRequestsByUser(requests);

    const patch = planUserToggleOn(group, "reports");
    expect(patch).toEqual({
      requestId: "newer-rejected",
      grantedFeatures: ["reports"],
      status: "APPROVED",
      setReviewMetadata: true,
    });
  });

  it("returns null when no request contains the feature", () => {
    const [group] = groupRequestsByUser([
      makeRequest({ id: "a", requestedFeatures: ["reports"] }),
    ]);
    expect(planUserToggleOn(group, "admin")).toBeNull();
  });
});

describe("classifyDuplicates (Req 9.1, 9.6)", () => {
  it("marks a feature as duplicate regardless of the existing request's status", () => {
    const existing: RequestSnapshot[] = [
      makeRequest({ id: "a", status: "PENDING", requestedFeatures: ["reports"] }),
      makeRequest({ id: "b", status: "REJECTED", requestedFeatures: ["audit"] }),
      makeRequest({ id: "c", status: "APPROVED", requestedFeatures: ["exports"] }),
    ];

    const duplicates = classifyDuplicates(existing, [
      "reports",
      "audit",
      "exports",
      "admin",
    ]);

    expect(duplicates.get("reports")).toBe("PENDING");
    expect(duplicates.get("audit")).toBe("REJECTED");
    expect(duplicates.get("exports")).toBe("APPROVED");
    expect(duplicates.has("admin")).toBe(false);
  });

  it("reports the status of the most recent request containing the feature", () => {
    const existing: RequestSnapshot[] = [
      makeRequest({
        id: "older",
        status: "APPROVED",
        requestedFeatures: ["reports"],
        createdAt: "2024-01-01T00:00:00Z",
      }),
      makeRequest({
        id: "newer",
        status: "REJECTED",
        requestedFeatures: ["reports"],
        createdAt: "2024-06-01T00:00:00Z",
      }),
    ];

    // Deterministic regardless of input order.
    expect(classifyDuplicates(existing, ["reports"]).get("reports")).toBe(
      "REJECTED",
    );
    expect(
      classifyDuplicates([...existing].reverse(), ["reports"]).get("reports"),
    ).toBe("REJECTED");
  });

  it("returns an empty map when there are no existing requests", () => {
    expect(classifyDuplicates([], ["reports"]).size).toBe(0);
  });
});

describe("partitionSubmission (Req 9.3, 9.4, 9.5)", () => {
  const duplicates = new Map<string, string>([
    ["reports", "PENDING"],
    ["audit", "REJECTED"],
  ]);

  it("splits a mixed selection preserving selection order", () => {
    const result = partitionSubmission(
      ["exports", "reports", "admin", "audit"],
      duplicates,
    );
    expect(result.toSubmit).toEqual(["exports", "admin"]);
    expect(result.excluded).toEqual([
      { feature: "reports", status: "PENDING" },
      { feature: "audit", status: "REJECTED" },
    ]);
  });

  it("returns an empty toSubmit when every selected feature is a duplicate", () => {
    const result = partitionSubmission(["reports", "audit"], duplicates);
    expect(result.toSubmit).toEqual([]);
    expect(result.excluded).toEqual([
      { feature: "reports", status: "PENDING" },
      { feature: "audit", status: "REJECTED" },
    ]);
  });

  it("passes everything through when there are no duplicates", () => {
    const result = partitionSubmission(["exports"], new Map());
    expect(result).toEqual({ toSubmit: ["exports"], excluded: [] });
  });
});

describe("entitlementSignature (Req 10.1, 10.3)", () => {
  it("is order-insensitive and deduplicating for features and countries", () => {
    const a = entitlementSignature({
      country: "TR,DE",
      allowedFeatures: ["reports", "exports"],
    });
    const b = entitlementSignature({
      country: " DE , TR,TR",
      allowedFeatures: ["exports", "reports", "exports"],
    });
    expect(a).toBe(b);
  });

  it("distinguishes different feature sets and country sets", () => {
    const base = entitlementSignature({
      country: "TR",
      allowedFeatures: ["reports"],
    });
    expect(
      entitlementSignature({ country: "TR", allowedFeatures: ["exports"] }),
    ).not.toBe(base);
    expect(
      entitlementSignature({ country: "DE", allowedFeatures: ["reports"] }),
    ).not.toBe(base);
  });

  it("gives null a signature distinct from the empty entitlement", () => {
    expect(entitlementSignature(null)).not.toBe(
      entitlementSignature({ country: "", allowedFeatures: [] }),
    );
  });
});

describe("shouldForceRefresh (Req 10.1, 10.3)", () => {
  const claim = { country: "TR", allowedFeatures: ["reports"] };
  const live = { country: "TR", allowedFeatures: ["reports", "exports"] };

  it("fires when live differs from the token claim and the difference is new", () => {
    expect(shouldForceRefresh(claim, live, null)).toBe(true);
  });

  it("does not fire when live equals the token claim (up to ordering)", () => {
    const reordered = {
      country: "TR",
      allowedFeatures: ["reports"],
    };
    expect(shouldForceRefresh(claim, reordered, null)).toBe(false);
  });

  it("does not re-fire for a difference that already triggered a refresh", () => {
    expect(
      shouldForceRefresh(claim, live, entitlementSignature(live)),
    ).toBe(false);
  });

  it("treats a live null (record deleted) as a difference from a populated claim", () => {
    expect(shouldForceRefresh(claim, null, null)).toBe(true);
  });
});
