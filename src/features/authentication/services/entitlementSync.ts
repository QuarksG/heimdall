// Centralized entitlement sync (Entitlement_Sync service).
//
// The Entitlement table holds exactly one record per user (keyed by userId),
// but a user may accumulate many AccessRequest records. This module enforces
// the invariant (generalized by the granular-feature-entitlements spec):
//
//   Entitlement(userId) = union of EFFECTIVE GRANTED features and countries
//   across ALL of the user's AccessRequest records with status APPROVED,
//   or absent when that feature union is empty.
//
// All decision logic lives in the pure core (entitlementCore.ts):
//   - effectiveGrantedFeatures: grantedFeatures when present; requestedFeatures
//     for legacy (null) records with status APPROVED; empty set otherwise (Req 2.6)
//   - computeEntitlementUnion: dedup/sorted union over APPROVED requests only
//     (Req 2.3, 2.5); non-APPROVED requests contribute nothing
//
// This module only performs the I/O: it paginates ALL of the user's
// AccessRequest records (the core filters by status itself), maps them onto
// RequestSnapshot, and persists the resulting union with upsert/delete
// semantics. All admin approve/reject/revoke/toggle paths must flow through
// syncEntitlement / syncEntitlementForUser instead of writing the
// Entitlement directly.
//
// NOTE on the signature: the design sketches `syncEntitlement(userId,
// grantedBy)`; this implementation takes the client as the first parameter
// (`syncEntitlement(client, userId, grantedBy, now?)`) because the data
// client is injectable throughout this codebase (AdminPanel passes the
// generated client; tests pass the in-memory mock), which keeps the sync
// property-testable without module mocking.

import {
  computeEntitlementUnion as computeCoreUnion,
  type EntitlementUnion as CoreEntitlementUnion,
  type RequestSnapshot,
} from "./entitlementCore";

/* ─── Minimal structural client interface ───
   Works with both the real generated Amplify Data client and the in-memory
   MockDataClient used in tests. Only the operations the sync needs are
   declared, with the loosest return shapes required. */

export type SyncAccessRequest = {
  userId: string;
  /** Comma-separated ISO country codes, e.g. "TR,DE". */
  country: string;
  requestedFeatures: string[];
  /** Subset of requestedFeatures actually granted by an Admin. Absent or
   *  null on the wire for legacy records — mapped to `null` and interpreted
   *  by effectiveGrantedFeatures() in the pure core (Req 2.6). */
  grantedFeatures?: (string | null)[] | null;
  status?: "PENDING" | "APPROVED" | "REJECTED" | null;
  id?: string | null;
  email?: string | null;
  fullName?: string | null;
  createdAt?: string | null;
};

export type EntitlementWrite = {
  userId: string;
  country: string;
  allowedFeatures: string[];
  grantedBy: string;
  grantedAt: string;
};

export type EntitlementSyncClient = {
  models: {
    AccessRequest: {
      list(args: {
        filter?: {
          userId?: { eq?: string };
          status?: { eq?: string };
        };
        nextToken?: string | null;
      }): Promise<{ data: SyncAccessRequest[]; nextToken?: string | null }>;
    };
    Entitlement: {
      get(input: { userId: string }): Promise<{ data: unknown }>;
      create(input: EntitlementWrite): Promise<unknown>;
      update(input: EntitlementWrite): Promise<unknown>;
      delete(input: { userId: string }): Promise<unknown>;
    };
  };
};

/* ─── Wire record -> pure-core snapshot mapping ─── */

function normalizeStatus(
  status: SyncAccessRequest["status"],
): "PENDING" | "APPROVED" | "REJECTED" {
  if (status === "APPROVED" || status === "REJECTED") return status;
  // Missing/unknown status fails closed: a PENDING request contributes
  // nothing to the union.
  return "PENDING";
}

/**
 * Maps a wire-level AccessRequest record onto the pure core's
 * RequestSnapshot. `grantedFeatures` absent/undefined on the wire becomes
 * `null` (the legacy marker for effectiveGrantedFeatures); when present,
 * null elements from the generated Amplify types are dropped.
 */
function toSnapshot(record: SyncAccessRequest): RequestSnapshot {
  return {
    id: record.id ?? "",
    userId: record.userId,
    email: record.email ?? "",
    fullName: record.fullName ?? "",
    country: record.country,
    requestedFeatures: [...record.requestedFeatures],
    grantedFeatures:
      record.grantedFeatures == null
        ? null
        : record.grantedFeatures.filter((f): f is string => f != null),
    status: normalizeStatus(record.status),
    createdAt: record.createdAt ?? null,
  };
}

/* ─── Centralized sync with upsert semantics ─── */

/** Lists ALL of the user's AccessRequest records regardless of status,
 *  following nextToken pagination. Status filtering happens in the pure
 *  core's union computation (Req 2.3). */
async function listAllRequests(
  client: EntitlementSyncClient,
  userId: string,
): Promise<SyncAccessRequest[]> {
  const all: SyncAccessRequest[] = [];
  let nextToken: string | null | undefined = undefined;
  do {
    const page = await client.models.AccessRequest.list({
      filter: { userId: { eq: userId } },
      nextToken: nextToken ?? undefined,
    });
    all.push(...page.data);
    nextToken = page.nextToken ?? null;
  } while (nextToken);
  return all;
}

/**
 * Recomputes the user's entitlement union from scratch and persists it.
 * Throws on any data-client error (callers decide how to surface it).
 *
 * Upsert semantics (Entitlement.create fails against an existing record
 * because the model is keyed by userId):
 *   - empty feature union + record exists  -> delete (Req 2.4)
 *   - empty feature union + no record      -> no-op success (Req 2.4)
 *   - non-empty union + record exists      -> update (fresh grantedBy/grantedAt)
 *   - non-empty union + no record          -> create
 *
 * Because the union is recomputed from all persisted requests on every run,
 * the sync is idempotent and self-healing: a failed prior sync is repaired
 * by the next successful one.
 */
async function recomputeAndPersist(
  client: EntitlementSyncClient,
  userId: string,
  grantedBy: string,
  now: string,
): Promise<CoreEntitlementUnion> {
  const requests = await listAllRequests(client, userId);
  const union = computeCoreUnion(requests.map((record) => toSnapshot(record)));

  const existing = await client.models.Entitlement.get({ userId });
  const recordExists = existing.data != null;

  if (union.allowedFeatures.length === 0) {
    if (recordExists) {
      await client.models.Entitlement.delete({ userId });
    }
    // No record and nothing to grant: missing record is success (Req 2.4).
    return union;
  }

  const payload: EntitlementWrite = {
    userId,
    country: union.countries.join(","),
    allowedFeatures: union.allowedFeatures,
    grantedBy,
    grantedAt: now,
  };

  if (recordExists) {
    await client.models.Entitlement.update(payload);
  } else {
    await client.models.Entitlement.create(payload);
  }

  return union;
}

/**
 * Recomputes and persists the user's Entitlement from all of their
 * AccessRequests. Throws on failure — kept as the entry point for
 * adminActions.ts, whose handlers wrap it in their own try/catch.
 */
export async function syncEntitlementForUser(
  client: EntitlementSyncClient,
  userId: string,
  grantedBy: string,
  now: string = new Date().toISOString(),
): Promise<void> {
  await recomputeAndPersist(client, userId, grantedBy, now);
}

/* ─── Result-typed entry point (design §3, Req 2.9) ─── */

export type SyncResult =
  | { ok: true; union: CoreEntitlementUnion }
  | { ok: false; error: string };

/**
 * Same recompute-from-scratch sync as syncEntitlementForUser, but never
 * throws: any error thrown by the underlying data operations is captured
 * as `{ ok: false, error }` (Req 2.9). Because a failed run writes no
 * partial union, the Entitlement record retains its prior state and the
 * next successful sync self-heals.
 */
export async function syncEntitlement(
  client: EntitlementSyncClient,
  userId: string,
  grantedBy: string,
  now: string = new Date().toISOString(),
): Promise<SyncResult> {
  try {
    const union = await recomputeAndPersist(client, userId, grantedBy, now);
    return { ok: true, union };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
