// src/features/authentication/context/AuthContext.tsx
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
  useState,
} from "react";

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
  entitlements: Entitlements | null;
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

export function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    user: null,
    entitlements: null,
    loading: true,
  });

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

      const groups = parseGroups(payload["cognito:groups"]);
      const role: Role = groups.includes("Admin") ? "Admin" : "Staff";

      const entitlements = parseEntitlements(
        payload["custom:entitlements"],
      );

      setState({
        isAuthenticated: true,
        user: { userId, email, name, role },
        entitlements,
        loading: false,
      });
    } catch {
      setState({
        isAuthenticated: false,
        user: null,
        entitlements: null,
        loading: false,
      });
    }
  };

  const signOut = async () => {
    await amplifySignOut();
    setState({
      isAuthenticated: false,
      user: null,
      entitlements: null,
      loading: false,
    });
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, refresh, signOut }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state],
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