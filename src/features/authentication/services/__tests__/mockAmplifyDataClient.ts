// Mocked in-memory Amplify Data client for entitlement-sync tests.
//
// Implements the subset of the generated client used by the admin actions
// and the live entitlement session:
//   AccessRequest.list / AccessRequest.get / AccessRequest.update
//   Entitlement.get / Entitlement.create / Entitlement.update /
//   Entitlement.delete / Entitlement.observeQuery
//
// Semantics mirror the real backend where it matters:
//   - Entitlement is keyed by userId (`.identifier(["userId"])` in
//     amplify/data/resource.ts), so `create` REJECTS when a record already
//     exists for that userId.
//   - Every operation is recorded in an operation log so tests can assert
//     which tables were touched (e.g. reject-of-PENDING must never touch
//     the Entitlement table).
//   - AccessRequest.list supports an optional eq-filter on userId/status and
//     limit/nextToken pagination, matching what the sync helper relies on.
//   - AccessRequest records carry the nullable `grantedFeatures` field added
//     by the granular-feature-entitlements spec (absent/undefined = legacy
//     record); `update` persists it like any other field (Req 2.3, 2.6).
//   - Entitlement.observeQuery loosely follows the Amplify surface:
//     `observeQuery(args?)` returns `{ subscribe({ next, error }) }`;
//     `subscribe` delivers an initial `{ items, isSynced }` snapshot
//     synchronously and re-emits a fresh snapshot to matching subscribers
//     after every create/update/delete, so observer and convergence tests
//     (tasks 12.x) can drive live entitlement flows deterministically.

export type AccessRequestStatus = "PENDING" | "APPROVED" | "REJECTED";

export type AccessRequestRecord = {
  id: string;
  userId: string;
  email: string;
  fullName: string;
  country: string; // comma-separated ISO codes, e.g. "TR,DE"
  requestedFeatures: string[];
  /** Subset of requestedFeatures actually granted by an Admin. Absent or
   *  null = legacy record, interpreted by effectiveGrantedFeatures() in the
   *  pure core (Req 2.6). Nullable elements match the generated Amplify
   *  types for `a.string().array()`. */
  grantedFeatures?: (string | null)[] | null;
  justification?: string | null;
  status: AccessRequestStatus;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  createdAt?: string | null;
};

export type EntitlementRecord = {
  userId: string;
  country: string;
  allowedFeatures: string[];
  grantedBy?: string | null;
  grantedAt?: string | null;
};

export type OperationLogEntry = {
  model: "AccessRequest" | "Entitlement";
  op: "list" | "get" | "create" | "update" | "delete" | "observeQuery";
  input: unknown;
};

type EqFilter = { eq?: string };
type AccessRequestListFilter = {
  userId?: EqFilter;
  status?: EqFilter;
};

export type AccessRequestListArgs = {
  filter?: AccessRequestListFilter;
  limit?: number;
  nextToken?: string | null;
};

/* ─── Entitlement.observeQuery surface (loose Amplify shape) ─── */

export type EntitlementObserveQueryArgs = {
  filter?: { userId?: EqFilter };
};

export type EntitlementQuerySnapshot = {
  items: EntitlementRecord[];
  isSynced: boolean;
};

export type EntitlementObserveQueryHandlers = {
  next: (snapshot: EntitlementQuerySnapshot) => void;
  error?: (error: unknown) => void;
};

export type MockSubscription = { unsubscribe(): void };

export type EntitlementObservable = {
  subscribe(handlers: EntitlementObserveQueryHandlers): MockSubscription;
};

export type MockDataClient = {
  models: {
    AccessRequest: {
      list(args?: AccessRequestListArgs): Promise<{
        data: AccessRequestRecord[];
        nextToken: string | null;
      }>;
      get(input: { id: string }): Promise<{ data: AccessRequestRecord | null }>;
      update(
        input: Partial<AccessRequestRecord> & { id: string },
      ): Promise<{ data: AccessRequestRecord }>;
    };
    Entitlement: {
      get(input: { userId: string }): Promise<{ data: EntitlementRecord | null }>;
      create(input: EntitlementRecord): Promise<{ data: EntitlementRecord }>;
      update(
        input: Partial<EntitlementRecord> & { userId: string },
      ): Promise<{ data: EntitlementRecord }>;
      delete(input: { userId: string }): Promise<{ data: EntitlementRecord | null }>;
      observeQuery(args?: EntitlementObserveQueryArgs): EntitlementObservable;
    };
  };
};

export type MockStore = {
  client: MockDataClient;
  /** Every data operation performed, in order. */
  operationLog: OperationLogEntry[];
  /** Direct read access for assertions. */
  getAccessRequest(id: string): AccessRequestRecord | undefined;
  getEntitlement(userId: string): EntitlementRecord | undefined;
  listAccessRequests(): AccessRequestRecord[];
  /** Direct seeding that bypasses the operation log. */
  seedAccessRequest(record: AccessRequestRecord): void;
  seedEntitlement(record: EntitlementRecord): void;
  /** Number of active Entitlement.observeQuery subscribers — lets observer
   *  lifecycle tests assert that cleanup actually unsubscribed. */
  entitlementObserverCount(): number;
};

export function createMockDataClient(): MockStore {
  const accessRequests = new Map<string, AccessRequestRecord>();
  const entitlements = new Map<string, EntitlementRecord>();
  const operationLog: OperationLogEntry[] = [];

  /* ─── Entitlement.observeQuery subscriber registry ─── */

  type Subscriber = {
    filter?: EntitlementObserveQueryArgs["filter"];
    handlers: EntitlementObserveQueryHandlers;
  };
  const entitlementSubscribers = new Set<Subscriber>();

  function matchesFilter(
    userId: string,
    filter?: EntitlementObserveQueryArgs["filter"],
  ): boolean {
    const eq = filter?.userId?.eq;
    return eq === undefined || userId === eq;
  }

  function snapshotFor(subscriber: Subscriber): EntitlementQuerySnapshot {
    const items = [...entitlements.values()]
      .filter((record) => matchesFilter(record.userId, subscriber.filter))
      .map((record) => ({ ...record }));
    return { items, isSynced: true };
  }

  /** Re-emits a fresh snapshot to every subscriber whose filter matches the
   *  mutated record (create/update/delete on userId). */
  function notifyEntitlementChange(userId: string): void {
    for (const subscriber of entitlementSubscribers) {
      if (matchesFilter(userId, subscriber.filter)) {
        subscriber.handlers.next(snapshotFor(subscriber));
      }
    }
  }

  const client: MockDataClient = {
    models: {
      AccessRequest: {
        async list(args?: AccessRequestListArgs) {
          operationLog.push({ model: "AccessRequest", op: "list", input: args ?? {} });
          let items = [...accessRequests.values()];
          const filter = args?.filter;
          if (filter?.userId?.eq !== undefined) {
            items = items.filter((r) => r.userId === filter.userId!.eq);
          }
          if (filter?.status?.eq !== undefined) {
            items = items.filter((r) => r.status === filter.status!.eq);
          }
          // limit/nextToken pagination: token is the numeric offset.
          const offset = args?.nextToken ? Number.parseInt(args.nextToken, 10) : 0;
          const limit = args?.limit ?? items.length;
          const page = items.slice(offset, offset + limit);
          const nextOffset = offset + page.length;
          const nextToken = nextOffset < items.length ? String(nextOffset) : null;
          return { data: page.map((r) => ({ ...r })), nextToken };
        },

        async get(input: { id: string }) {
          operationLog.push({ model: "AccessRequest", op: "get", input });
          const record = accessRequests.get(input.id);
          return { data: record ? { ...record } : null };
        },

        async update(input) {
          operationLog.push({ model: "AccessRequest", op: "update", input });
          const existing = accessRequests.get(input.id);
          if (!existing) {
            throw new Error(`AccessRequest.update: no record with id ${input.id}`);
          }
          const updated = { ...existing, ...input };
          accessRequests.set(input.id, updated);
          return { data: { ...updated } };
        },
      },

      Entitlement: {
        async get(input) {
          operationLog.push({ model: "Entitlement", op: "get", input });
          const record = entitlements.get(input.userId);
          return { data: record ? { ...record } : null };
        },

        async create(input) {
          operationLog.push({ model: "Entitlement", op: "create", input });
          if (entitlements.has(input.userId)) {
            // Matches the real `.identifier(["userId"])` behavior: creating
            // against an existing primary key fails.
            throw new Error(
              `Entitlement.create: record already exists for userId ${input.userId} ` +
                `(conditional create failed)`,
            );
          }
          entitlements.set(input.userId, { ...input });
          notifyEntitlementChange(input.userId);
          return { data: { ...input } };
        },

        async update(input) {
          operationLog.push({ model: "Entitlement", op: "update", input });
          const existing = entitlements.get(input.userId);
          if (!existing) {
            throw new Error(
              `Entitlement.update: no record for userId ${input.userId}`,
            );
          }
          const updated = { ...existing, ...input };
          entitlements.set(input.userId, updated);
          notifyEntitlementChange(input.userId);
          return { data: { ...updated } };
        },

        async delete(input) {
          operationLog.push({ model: "Entitlement", op: "delete", input });
          const existing = entitlements.get(input.userId) ?? null;
          entitlements.delete(input.userId);
          if (existing) notifyEntitlementChange(input.userId);
          return { data: existing ? { ...existing } : null };
        },

        observeQuery(args) {
          operationLog.push({
            model: "Entitlement",
            op: "observeQuery",
            input: args ?? {},
          });
          return {
            subscribe(handlers) {
              const subscriber: Subscriber = { filter: args?.filter, handlers };
              entitlementSubscribers.add(subscriber);
              // Initial snapshot, delivered synchronously for determinism.
              handlers.next(snapshotFor(subscriber));
              return {
                unsubscribe() {
                  entitlementSubscribers.delete(subscriber);
                },
              };
            },
          };
        },
      },
    },
  };

  return {
    client,
    operationLog,
    getAccessRequest: (id) => accessRequests.get(id),
    getEntitlement: (userId) => entitlements.get(userId),
    listAccessRequests: () => [...accessRequests.values()],
    seedAccessRequest: (record) => {
      accessRequests.set(record.id, { ...record });
    },
    seedEntitlement: (record) => {
      entitlements.set(record.userId, { ...record });
    },
    entitlementObserverCount: () => entitlementSubscribers.size,
  };
}
