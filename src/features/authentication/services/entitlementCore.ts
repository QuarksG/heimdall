// Pure core for the granular-feature-entitlements spec.
//
// All functions in this module are pure and synchronous — no I/O, no Amplify
// client, no Date.now(). Effectful services (entitlementSync.ts, adminActions.ts)
// and UI components delegate every decision here so the logic is fully
// property-testable.
//
// This module generalizes the entitlement-union invariant from the
// rbac-entitlement-sync spec: a user's Entitlement record is always the union
// of granted features and countries across all of that user's APPROVED
// requests — now computed over the persisted `grantedFeatures` subset (with a
// legacy-compatibility rule) instead of `requestedFeatures`.

/* ─── Types ─── */

export type RequestSnapshot = {
  id: string;
  userId: string;
  email: string;
  fullName: string;
  /** Comma-separated ISO country codes, e.g. "TR,DE". */
  country: string;
  requestedFeatures: string[];
  /** Subset of requestedFeatures actually granted. `null` = legacy record
   *  created before this feature — interpreted by effectiveGrantedFeatures(). */
  grantedFeatures: string[] | null;
  justification?: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  createdAt?: string | null;
};

export type EntitlementUnion = {
  /** Deduplicated, sorted feature identifiers. */
  allowedFeatures: string[];
  /** Deduplicated, sorted ISO country codes. */
  countries: string[];
};

/** One user's grouped requests and derived access state (populated by
 *  groupRequestsByUser — implemented in task 3.1). */
export type UserGroup = {
  userId: string;
  email: string;
  fullName: string;
  /** Newest first. */
  requests: RequestSnapshot[];
  /** Deduplicated union of requestedFeatures across all requests (Req 8.2). */
  requestedUnion: string[];
  /** Union over APPROVED requests (Req 8.2, 8.3). */
  entitlementUnion: EntitlementUnion;
  /** Req 8.8. */
  hasPending: boolean;
};

/** One update the Admin Panel must persist for a toggle action (produced by
 *  the toggle planners — implemented in task 3.3). */
export type RequestPatch = {
  requestId: string;
  grantedFeatures: string[];
  status: "APPROVED" | "REJECTED";
  setReviewMetadata: boolean;
};

/** Entitlement value shape as seen by the session layer. Structurally
 *  compatible with the `Entitlements` type in AuthContext.tsx — declared
 *  locally so this core module stays dependency-free. */
export type Entitlements = {
  /** Comma-separated ISO country codes, e.g. "TR,DE". */
  country: string;
  allowedFeatures: string[];
};

/* ─── Granted-feature interpretation ─── */

/**
 * Req 2.6 — the SINGLE interpretation point for legacy records:
 *
 *   grantedFeatures present        -> the stored value
 *   absent (null) + APPROVED       -> requestedFeatures (full grant)
 *   absent (null) + other status   -> empty set
 */
export function effectiveGrantedFeatures(req: RequestSnapshot): string[] {
  if (req.grantedFeatures != null) return req.grantedFeatures;
  if (req.status === "APPROVED") return req.requestedFeatures;
  return [];
}

/* ─── Entitlement union ─── */

/** Splits a comma-separated country string into trimmed, non-empty codes. */
function splitCountries(country: string): string[] {
  return country
    .split(",")
    .map((code) => code.trim())
    .filter((code) => code.length > 0);
}

/**
 * Req 2.3–2.6 — the union of effective granted features and country codes
 * across APPROVED requests only. Features and countries are deduplicated
 * (Req 2.5) and sorted so the output is deterministic regardless of request
 * order. Non-APPROVED requests contribute nothing (Req 2.3).
 *
 * The sync layer owns existence semantics: the Entitlement record for a user
 * exists iff `allowedFeatures` is non-empty (Req 2.4).
 */
export function computeEntitlementUnion(
  requests: RequestSnapshot[],
): EntitlementUnion {
  const features = new Set<string>();
  const countries = new Set<string>();

  for (const req of requests) {
    if (req.status !== "APPROVED") continue;
    for (const feature of effectiveGrantedFeatures(req)) features.add(feature);
    for (const code of splitCountries(req.country)) countries.add(code);
  }

  return {
    allowedFeatures: [...features].sort(),
    countries: [...countries].sort(),
  };
}

/* ─── User grouping ─── */

/**
 * Newest-first comparator for requests. Primary key: `createdAt` descending
 * (ISO-8601 strings compare correctly lexicographically). A null/missing
 * `createdAt` is treated as older than any timestamp. Ties (including two
 * missing timestamps) break by `id` descending so the order is deterministic
 * regardless of input order.
 */
function compareNewestFirst(a: RequestSnapshot, b: RequestSnapshot): number {
  const aCreated = a.createdAt ?? "";
  const bCreated = b.createdAt ?? "";
  if (aCreated !== bCreated) return aCreated < bCreated ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}

/**
 * Req 8.1–8.3, 8.8 — partitions requests into one UserGroup per distinct
 * `userId`. Every request appears in exactly the group matching its `userId`
 * (lossless partition). Groups are returned in first-encounter order of the
 * input; within a group, requests are sorted newest first.
 *
 * Derived per group:
 * - identity fields (`email`, `fullName`) from the most recent request
 * - `requestedUnion`: deduplicated, sorted union of requestedFeatures across
 *   ALL of the user's requests regardless of status (Req 8.2)
 * - `entitlementUnion`: via computeEntitlementUnion (Req 8.2, 8.3)
 * - `hasPending`: true iff at least one request is PENDING (Req 8.8)
 */
export function groupRequestsByUser(
  requests: RequestSnapshot[],
): UserGroup[] {
  const byUser = new Map<string, RequestSnapshot[]>();
  for (const req of requests) {
    const bucket = byUser.get(req.userId);
    if (bucket) bucket.push(req);
    else byUser.set(req.userId, [req]);
  }

  const groups: UserGroup[] = [];
  for (const [userId, userRequests] of byUser) {
    const sorted = [...userRequests].sort(compareNewestFirst);
    const newest = sorted[0];

    const requestedUnion = new Set<string>();
    for (const req of sorted) {
      for (const feature of req.requestedFeatures) requestedUnion.add(feature);
    }

    groups.push({
      userId,
      email: newest.email,
      fullName: newest.fullName,
      requests: sorted,
      requestedUnion: [...requestedUnion].sort(),
      entitlementUnion: computeEntitlementUnion(sorted),
      hasPending: sorted.some((req) => req.status === "PENDING"),
    });
  }

  return groups;
}

/* ─── Granted-subset validation ─── */

/**
 * Req 1.3, 2.8 — a granted set is valid iff every granted feature is a
 * member of the requested features.
 */
export function isValidGrantedSubset(
  granted: string[],
  requested: string[],
): boolean {
  const requestedSet = new Set(requested);
  return granted.every((feature) => requestedSet.has(feature));
}

/* ─── Toggle planning ─── */

/**
 * Req 3.2–3.4, 3.10 — plans the single-request Feature_Toggle change shown in
 * the Request_History.
 *
 * Toggle OFF: removes exactly `feature` from the request's effective granted
 * set (leaving all other features intact); if the resulting set is empty the
 * patch status is REJECTED (Req 3.4), otherwise APPROVED.
 *
 * Toggle ON: adds exactly `feature` to the effective granted set; the patch
 * status is APPROVED — including when toggling on against a REJECTED request
 * (Req 3.10). The resulting set is always non-empty.
 *
 * Every patch sets `setReviewMetadata` so the executor records reviewer
 * identity and timestamp.
 */
export function planRequestToggle(
  req: RequestSnapshot,
  feature: string,
  turnOn: boolean,
): RequestPatch {
  const effective = effectiveGrantedFeatures(req);

  let granted: string[];
  if (turnOn) {
    granted = effective.includes(feature) ? [...effective] : [...effective, feature];
  } else {
    granted = effective.filter((f) => f !== feature);
  }

  return {
    requestId: req.id,
    grantedFeatures: granted,
    status: granted.length === 0 ? "REJECTED" : "APPROVED",
    setReviewMetadata: true,
  };
}

/**
 * Req 8.4 — fan-out for a User_Card toggle OFF: removes `feature` from the
 * effective granted set of every request whose effective grant contains it.
 * Requests whose granted set becomes empty are set to REJECTED; requests that
 * did not grant the feature are not patched at all.
 */
export function planUserToggleOff(
  group: UserGroup,
  feature: string,
): RequestPatch[] {
  return group.requests
    .filter((req) => effectiveGrantedFeatures(req).includes(feature))
    .map((req) => planRequestToggle(req, feature, false));
}

/**
 * Req 8.5 — fan-in for a User_Card toggle ON: produces exactly one patch.
 * Target selection is deterministic (group.requests is sorted newest first):
 * prefer the most recent APPROVED request whose requestedFeatures contains
 * the feature, else the most recent request of any status containing it
 * (status -> APPROVED). Returns null when no request contains the feature.
 *
 * Because the target's requestedFeatures contains the feature, adding it to
 * the effective granted set preserves the granted-subset invariant (Req 2.8).
 */
export function planUserToggleOn(
  group: UserGroup,
  feature: string,
): RequestPatch | null {
  const candidates = group.requests.filter((req) =>
    req.requestedFeatures.includes(feature),
  );
  if (candidates.length === 0) return null;

  const target =
    candidates.find((req) => req.status === "APPROVED") ?? candidates[0];

  return planRequestToggle(target, feature, true);
}

/* ─── Duplicate classification (Request_Form) ─── */

/**
 * Req 9.1, 9.6 — classifies each feature in `featureIds` as a duplicate iff
 * it is a member of the requestedFeatures of at least one existing request,
 * REGARDLESS of that request's status. The returned map contains only the
 * duplicates; each maps to the status of the most recent existing request
 * containing it (deterministic via the newest-first ordering, independent of
 * input order).
 */
export function classifyDuplicates(
  existingRequests: RequestSnapshot[],
  featureIds: string[],
): Map<string, "PENDING" | "APPROVED" | "REJECTED"> {
  const newestFirst = [...existingRequests].sort(compareNewestFirst);

  const duplicates = new Map<string, "PENDING" | "APPROVED" | "REJECTED">();
  for (const feature of featureIds) {
    const containing = newestFirst.find((req) =>
      req.requestedFeatures.includes(feature),
    );
    if (containing) duplicates.set(feature, containing.status);
  }
  return duplicates;
}

/**
 * Req 9.3–9.5 — splits a submission into the features to persist and the
 * duplicates to report. `toSubmit` is exactly the selected features absent
 * from the duplicate map, in selection order; `excluded` is exactly the
 * selected duplicates, each paired with its existing request's status, also
 * in selection order.
 */
export function partitionSubmission(
  selected: string[],
  duplicates: Map<string, string>,
): { toSubmit: string[]; excluded: { feature: string; status: string }[] } {
  const toSubmit: string[] = [];
  const excluded: { feature: string; status: string }[] = [];

  for (const feature of selected) {
    const status = duplicates.get(feature);
    if (status !== undefined) excluded.push({ feature, status });
    else toSubmit.push(feature);
  }

  return { toSubmit, excluded };
}

/* ─── Token-convergence decision (Live_Entitlement_Observer) ─── */

/**
 * Req 10.1, 10.3 — canonical order-insensitive signature of an entitlement
 * value: sorted deduplicated feature identifiers plus sorted deduplicated
 * comma-split country codes. Two values with the same feature set and the
 * same country-code set produce the same signature regardless of ordering,
 * duplication, or country-string formatting. `null` (absent) has a signature
 * DISTINCT from an empty entitlement.
 *
 * JSON encoding keeps the signature collision-free even if a feature
 * identifier contains delimiter characters.
 */
export function entitlementSignature(ent: Entitlements | null): string {
  if (ent === null) return "null";

  const features = [...new Set(ent.allowedFeatures)].sort();
  const countries = [...new Set(splitCountries(ent.country))].sort();
  return JSON.stringify([features, countries]);
}

/**
 * Req 10.1, 10.3 — pure convergence decision: initiate a Forced_Token_Refresh
 * iff the live state differs from the Token_Claim AND this difference has not
 * already triggered a refresh (its signature is not the last-refreshed-for
 * signature). The effectful side records `entitlementSignature(live)` as
 * `lastRefreshedSignature` before calling out, so re-emissions of an
 * already-handled difference never double-fire.
 */
export function shouldForceRefresh(
  tokenClaim: Entitlements | null,
  live: Entitlements | null,
  lastRefreshedSignature: string | null,
): boolean {
  const liveSignature = entitlementSignature(live);
  return (
    liveSignature !== entitlementSignature(tokenClaim) &&
    liveSignature !== lastRefreshedSignature
  );
}
