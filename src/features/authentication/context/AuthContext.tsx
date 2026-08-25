// src/features/authentication/context/AuthContext.tsx
//
// Authentication context with live entitlements and token-claim convergence
// (granular-feature-entitlements, Req 5.7/5.8, 6.3, 10, 11, 13).
//
// Entitlement precedence (Req 5.7, 5.8, 6.3, 11.1):
//   - Live_Entitlement_Observer `initial`  -> Token_Claim (custom:entitlements)
//   - otherwise (live OR stale)            -> live value wins, even when empty
// The result is exposed under the existing `entitlements` field, so
// usePermissions / ProtectedRoute / StatusDisplay gain real-time behavior
// without changes; `entitlementSource` is added for diagnostics.
//
// Token convergence (Req 10): whenever the live state differs from the
// Token_Claim and that difference has not already been refreshed for
// (pure decision: shouldForceRefresh), the provider forces exactly one
// token refresh, then re-reads the claim from the new ID token. The
// last-refreshed signature lives in a ref so guard updates are synchronous
// and cannot double-fire; it is cleared on sign-out.

import {
  fetchAuthSession,
  getCurrentUser,
  signOut as amplifySignOut,
} from "aws-amplify/auth";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  entitlementSignature,
  shouldForceRefresh,
} from "../services/entitlementCore";
import { useLiveEntitlements } from "../hooks/useLiveEntitlements";

export type Role = "Admin" | "Staff";

export type Entitlements = {
  country: string;
  allowedFeatures: string[];
};

export type AuthUser = {
  /** Cognito sub (unique user ID) — use as PK in Entitlement table */
  userId: string;
  email: string;
  name: string;
  role: Role;
};

export type AuthState = {
  isAuthenticated: boolean;
  user: AuthUser | null;
  /** Live state once delivered, else the token claim (Req 5.7, 6.3). */
  entitlements: Entitlements | null;
  /** Where `entitlements` currently comes from (diagnostics). */
  entitlementSource: "token" | "live";
  loading: boolean;
};

type AuthContextValue = AuthState & {
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function parseGroups(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string")
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

function parseEntitlements(raw: unknown): Entitlements | null {
  if (!raw || typeof raw !== "string") return null;
  try {
    const obj = JSON.parse(raw);
    const country =
      typeof obj?.country === "string" ? obj.country : "";
    const allowedFeatures = Array.isArray(obj?.allowedFeatures)
      ? obj.allowedFeatures.map(String)
      : [];
    if (!country && allowedFeatures.length === 0) return null;
    return { country, allowedFeatures };
  } catch {
    return null;
  }
}

type BaseAuthState = {
  isAuthenticated: boolean;
  user: AuthUser | null;
  loading: boolean;
};

export function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [base, setBase] = useState<BaseAuthState>({
    isAuthenticated: false,
    user: null,
    loading: true,
  });
  /** Parsed custom:entitlements claim from the current ID token; re-read
   *  after every Forced_Token_Refresh (Req 10.2). */
  const [tokenEntitlements, setTokenEntitlements] =
    useState<Entitlements | null>(null);
  /** Bumped by refresh() so the observer refetches/resubscribes (Req 11.3). */
  const [refreshNonce, setRefreshNonce] = useState(0);
  /** entitlementSignature of the live state that last triggered a
   *  convergence refresh (Req 10.3). Ref, not state: recorded synchronously
   *  BEFORE calling out so the same difference cannot double-fire. */
  const lastRefreshedSignature = useRef<string | null>(null);

  const refresh = async () => {
    try {
      const me = await getCurrentUser();
      const session = await fetchAuthSession();
      const payload = session.tokens?.idToken?.payload ?? {};

      const userId = String(payload.sub ?? me.userId ?? "");
      const email = String(payload.email ?? "");
      const name = String(
        payload.name ?? payload["custom:fullName"] ?? me.username,
      );

      // Role derivation preserved (Req 13.1): Admin iff groups include it,
      // Staff otherwise; any unexpected failure -> unauthenticated (13.2)
      // via the catch below.
      const groups = parseGroups(payload["cognito:groups"]);
      const role: Role = groups.includes("Admin") ? "Admin" : "Staff";

      setTokenEntitlements(
        parseEntitlements(payload["custom:entitlements"]),
      );
      setBase({
        isAuthenticated: true,
        user: { userId, email, name, role },
        loading: false,
      });
      // Observer refetch/resubscribe on explicit refresh (Req 11.1, 11.3).
      setRefreshNonce((n) => n + 1);
    } catch {
      setBase({ isAuthenticated: false, user: null, loading: false });
      setTokenEntitlements(null);
    }
  };

  const signOut = async () => {
    await amplifySignOut();
    // Req 13.3 — clear auth state, identity, entitlements, and the
    // convergence guard; the observer unsubscribes when userId becomes null.
    lastRefreshedSignature.current = null;
    setBase({ isAuthenticated: false, user: null, loading: false });
    setTokenEntitlements(null);
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Live_Entitlement_Observer (Req 5, 11) ──
     userId null while unauthenticated -> no queries, no subscription. */
  const live = useLiveEntitlements(
    base.isAuthenticated ? (base.user?.userId ?? null) : null,
    refreshNonce,
  );

  /* ── Precedence chain (Req 5.7, 5.8, 6.3, 11.1) ── */
  const entitlements =
    live.status === "initial" ? tokenEntitlements : live.entitlements;
  const entitlementSource: "token" | "live" =
    live.status === "initial" ? "token" : "live";

  /* ── Token convergence (Req 10) ── */
  useEffect(() => {
    if (!base.isAuthenticated) return;
    if (live.status === "initial") return; // nothing to converge to yet

    if (
      !shouldForceRefresh(
        tokenEntitlements,
        live.entitlements,
        lastRefreshedSignature.current,
      )
    ) {
      return;
    }

    // Record the signature BEFORE calling out so concurrent events for the
    // same difference cannot double-fire (Req 10.3).
    lastRefreshedSignature.current = entitlementSignature(live.entitlements);

    void (async () => {
      try {
        // Cognito re-runs the PreTokenGen_Lambda, which reads the
        // already-synced Entitlement record.
        const session = await fetchAuthSession({ forceRefresh: true });
        const payload = session.tokens?.idToken?.payload ?? {};
        // Re-read the Token_Claim from the new ID token (Req 10.2).
        setTokenEntitlements(
          parseEntitlements(payload["custom:entitlements"]),
        );
      } catch (e) {
        // Keep gating on live state (precedence chain unaffected); leave
        // the signature set so the same difference never loops (Req 10.4).
        console.error("[AuthContext] forced token refresh failed:", e);
      }
    })();
  }, [base.isAuthenticated, live, tokenEntitlements]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...base,
      entitlements,
      entitlementSource,
      refresh,
      signOut,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, entitlements, entitlementSource],
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
