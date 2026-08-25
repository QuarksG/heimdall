// src/features/authentication/hooks/useLiveEntitlements.ts
//
// Live_Entitlement_Observer (Req 5, 11, 13.3/13.4).
//
// Subscribes to the signed-in user's OWN Entitlement record via Amplify Data
// `observeQuery` (owner read access added in amplify/data/resource.ts), so
// admin actions reach the running session without a token refresh:
//
//   - `initial`: nothing delivered yet (also after subscribe/fetch failure)
//     -> AuthContext keeps gating on the Token_Claim (Req 5.7, 11.1)
//   - `live`:    a snapshot has been delivered; zero items map to an EXPLICIT
//     empty entitlement, distinct from `initial` (Req 5.5)
//   - `stale`:   the subscription connection is interrupted; the last
//     delivered values remain in effect (Req 5.8)
//
// Connection handling (Req 5.6, 5.9): a Hub "api" ConnectionStateChange
// listener degrades the state to `stale` on disconnect and re-fetches the
// record directly (`Entitlement.get`) on reconnect; if that re-fetch fails
// it retries every 30 seconds until it succeeds.
//
// `refreshNonce` (Req 11.3): AuthContext.refresh() bumps this counter, which
// triggers a direct refetch AND a re-subscribe — so an initial subscribe
// failure is retried on the next refresh (Req 11.1).
//
// `userId: null` issues no Data client queries and no subscription
// (Req 13.4). Effect cleanup unsubscribes, removes the Hub listener, and
// clears retry timers (Req 13.3).

import { useEffect, useRef, useState } from "react";
import { generateClient, CONNECTION_STATE_CHANGE } from "aws-amplify/data";
import { Hub } from "aws-amplify/utils";
import type { Schema } from "../../../../amplify/data/resource";
import type { Entitlements } from "../services/entitlementCore";

export type LiveEntitlementState =
  | { status: "initial" }
  | { status: "live"; entitlements: Entitlements }
  | { status: "stale"; entitlements: Entitlements };

/** Structural surface the hook needs — the generated client satisfies it,
 *  and tests can inject the in-memory mock. */
export type LiveEntitlementClient = {
  models: {
    Entitlement: {
      get(input: { userId: string }): Promise<{
        data: {
          userId?: string | null;
          country?: string | null;
          allowedFeatures?: (string | null)[] | null;
        } | null;
      }>;
      observeQuery(args?: {
        filter?: { userId?: { eq?: string } };
      }): {
        subscribe(handlers: {
          next: (snapshot: {
            items: Array<{
              userId?: string | null;
              country?: string | null;
              allowedFeatures?: (string | null)[] | null;
            }>;
          }) => void;
          error?: (error: unknown) => void;
        }): { unsubscribe(): void };
      };
    };
  };
};

const RECONNECT_RETRY_MS = 30_000;

/** The explicit EMPTY live entitlement — a delivered "no record" state,
 *  distinct from `initial` (Req 5.5). */
const EMPTY_ENTITLEMENTS: Entitlements = { country: "", allowedFeatures: [] };

function toEntitlements(record: {
  country?: string | null;
  allowedFeatures?: (string | null)[] | null;
} | null): Entitlements {
  if (!record) return EMPTY_ENTITLEMENTS;
  return {
    country: record.country ?? "",
    allowedFeatures: (record.allowedFeatures ?? []).filter(
      (f): f is string => f != null,
    ),
  };
}

let defaultClient: LiveEntitlementClient | null = null;
function getDefaultClient(): LiveEntitlementClient {
  defaultClient ??=
    generateClient<Schema>() as unknown as LiveEntitlementClient;
  return defaultClient;
}

export function useLiveEntitlements(
  userId: string | null,
  refreshNonce = 0,
  injectedClient?: LiveEntitlementClient,
): LiveEntitlementState {
  const [state, setState] = useState<LiveEntitlementState>({
    status: "initial",
  });
  /** Last delivered value, used when degrading to `stale` (Req 5.8). */
  const lastDelivered = useRef<Entitlements | null>(null);

  useEffect(() => {
    // No user -> no queries, no subscription (Req 13.4); state resets so a
    // future sign-in starts from `initial` with the fresh token claim.
    if (!userId) {
      lastDelivered.current = null;
      setState({ status: "initial" });
      return;
    }

    const client = injectedClient ?? getDefaultClient();
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const deliver = (entitlements: Entitlements) => {
      if (cancelled) return;
      lastDelivered.current = entitlements;
      setState({ status: "live", entitlements });
    };

    const degrade = () => {
      if (cancelled) return;
      setState(
        lastDelivered.current
          ? { status: "stale", entitlements: lastDelivered.current }
          : { status: "initial" },
      );
    };

    /** Direct re-fetch, used on reconnect (Req 5.6) and explicit refresh
     *  (Req 11.3). Returns whether it succeeded. */
    const refetch = async (): Promise<boolean> => {
      try {
        const { data } = await client.models.Entitlement.get({ userId });
        deliver(toEntitlements(data));
        return true;
      } catch (e) {
        console.error("[useLiveEntitlements] refetch failed:", e);
        return false;
      }
    };

    /** Retry a failed reconnect re-fetch every 30s until success (Req 5.9). */
    const scheduleRetry = () => {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        void refetch().then((ok) => {
          if (!ok && !cancelled) scheduleRetry();
        });
      }, RECONNECT_RETRY_MS);
    };

    // ── Subscription (Req 5.1, 5.2, 5.5) ──
    // Owner auth restricts results to the user's own record; the filter
    // keeps the snapshot precise.
    let subscription: { unsubscribe(): void } | undefined;
    try {
      subscription = client.models.Entitlement.observeQuery({
        filter: { userId: { eq: userId } },
      }).subscribe({
        next: ({ items }) => {
          deliver(toEntitlements(items[0] ?? null));
        },
        error: (e) => {
          // Failed initial subscribe leaves `initial` (token-claim fallback,
          // Req 11.1); a failure after delivery degrades to `stale`.
          console.error("[useLiveEntitlements] subscription error:", e);
          degrade();
        },
      });
    } catch (e) {
      console.error("[useLiveEntitlements] subscribe failed:", e);
      // State stays `initial`; retried on the next refresh() (Req 11.1).
    }

    // ── Connection tracking (Req 5.6, 5.8, 5.9) ──
    const removeHubListener = Hub.listen("api", ({ payload }) => {
      if (payload.event !== CONNECTION_STATE_CHANGE) return;
      const connectionState = String(
        (payload.data as { connectionState?: unknown })?.connectionState ?? "",
      );
      if (connectionState === "Connected") {
        // Reconnect: direct re-fetch (well within 5s), retrying every 30s
        // on failure until success.
        void refetch().then((ok) => {
          if (!ok && !cancelled) scheduleRetry();
        });
      } else if (
        connectionState === "Disconnected" ||
        connectionState.includes("Disrupted")
      ) {
        degrade();
      }
    });

    // ── Explicit refresh (Req 11.3) ──
    // A bumped nonce re-runs this whole effect (fresh subscription — which
    // also retries a previously failed subscribe) plus a direct refetch so
    // refresh always reconciles, independent of subscription health.
    if (refreshNonce > 0) {
      void refetch();
    }

    return () => {
      // Req 13.3 — terminate subscription, Hub listener, retry timers.
      cancelled = true;
      subscription?.unsubscribe();
      removeHubListener();
      clearTimeout(retryTimer);
    };
  }, [userId, refreshNonce, injectedClient]);

  return state;
}
