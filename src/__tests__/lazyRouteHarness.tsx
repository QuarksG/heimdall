// src/__tests__/lazyRouteHarness.tsx
//
// Shared test harness for the feature-code-splitting gate-integration tests
// (spec tasks 5.2–5.8; Requirements 2.1, 2.6).
//
// What is REAL here: `FeatureGate`, `usePermissions`, `ProtectedRoute`,
// `MainLayout`/`Sidebar`, and `createLazyRoute` — the exact gate stack and
// lazy boundary that production routes render. The route table below mirrors
// `src/App.tsx` exactly (paths, nesting, featureIds, legacy redirects,
// wildcard fallback).
//
// What is MOCKED here: only the `AuthContext` module's `useAuth` hook. It is
// replaced with a `useSyncExternalStore` read of a harness-controlled store,
// so tests can set and CHANGE the auth value (role + entitlements) mid-test
// (mid-session grant/revocation cases) and every real gate component
// re-renders exactly as it would on a live entitlement update. The seven
// feature modules themselves are replaced by per-feature `vi.fn()` loader
// spies injected through `createLazyRoute` — a loader invocation is the
// observable proxy for a Feature_Chunk network request.
//
// IMPORTANT for consumers: import this harness BEFORE any module that
// (transitively) imports `features/authentication/context/AuthContext`, so
// the module mock registers first. Importing only from this harness (plus
// vitest / fast-check / @testing-library) is always safe.

import { vi } from "vitest";
import type { Mock } from "vitest";
import { act, render } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import fc from "fast-check";
import type { ComponentType } from "react";
import {
  MemoryRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import type { Location, NavigateFunction } from "react-router-dom";

/* ────────────────────────────────────────────────────────────────────────
 * Controlled AuthContext value store (hoisted so the vi.mock factory,
 * which runs when AuthContext is first imported, can reference it).
 * ──────────────────────────────────────────────────────────────────────── */

const authStore = vi.hoisted(() => {
  let state: unknown = null;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next: unknown) {
      state = next;
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});

// Replace ONLY the AuthContext module. `useAuth` is the single runtime
// export consumed by ProtectedRoute, usePermissions (→ FeatureGate), and
// Sidebar; everything downstream of it stays real (Req 2.6 — the lazy
// boundary and the gates share one entitlement decision source).
// The real module is NOT imported (importOriginal is avoided) so no
// aws-amplify side effects run in jsdom.
vi.mock("../features/authentication/context/AuthContext", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    AuthProvider: ({ children }: { children?: unknown }) => children ?? null,
    useAuth: () => {
      const value = useSyncExternalStore(authStore.subscribe, authStore.get);
      if (value == null) {
        throw new Error(
          "lazyRouteHarness: renderApp() must run before anything calls useAuth()",
        );
      }
      return value;
    },
  };
});

/* Real gate stack + shell (the hoisted vi.mock above registers before
 * these imports execute, so they all see the mocked useAuth). */
import FeatureGate from "../features/authentication/guards/FeatureGate";
import ProtectedRoute from "../features/authentication/guards/ProtectedRoute";
import type {
  AuthState,
  Role,
} from "../features/authentication/context/AuthContext";
import MainLayout from "../shared/components/layout/MainLayout";
import { ThemeProvider } from "../shared/theme/ThemeContext";
import { createLazyRoute } from "../shared/components/lazy/createLazyRoute";

/* ────────────────────────────────────────────────────────────────────────
 * Feature table (mirrors src/App.tsx and usePermissions.ID_TO_FEATURE)
 * ──────────────────────────────────────────────────────────────────────── */

export type GatedFeatureKey =
  | "InvoiceParsing"
  | "InvoiceControl"
  | "InvoiceValidateDF"
  | "InvoiceVerify"
  | "Recon"
  | "CRTRExtraction"
  | "Settings";

export const GATED_FEATURE_KEYS = [
  "InvoiceParsing",
  "InvoiceControl",
  "InvoiceValidateDF",
  "InvoiceVerify",
  "Recon",
  "CRTRExtraction",
  "Settings",
] as const satisfies readonly GatedFeatureKey[];

/** Route path per feature — must match src/App.tsx exactly. */
export const FEATURE_ROUTES: Record<GatedFeatureKey, string> = {
  InvoiceParsing: "/invoice-parsing",
  InvoiceControl: "/invoice-validation/retail",
  InvoiceValidateDF: "/invoice-validation/dropship",
  InvoiceVerify: "/invoice-conversion",
  Recon: "/payment-reconciliation",
  CRTRExtraction: "/crtr-extraction",
  Settings: "/settings",
};

/** Backend entitlement key per feature (usePermissions.ID_TO_FEATURE).
 *  Settings is role-gated (Admin only), not entitlement-gated. */
export const FEATURE_TO_ENTITLEMENT: Record<GatedFeatureKey, string | null> = {
  InvoiceParsing: "invoice-parsing",
  InvoiceControl: "invoice-validation",
  InvoiceValidateDF: "invoice-validation",
  InvoiceVerify: "invoice-conversion",
  Recon: "payment-reconciliation",
  CRTRExtraction: "crtr-extraction",
  Settings: null,
};

/** The distinct entitlement keys that can appear in allowedFeatures. */
export const ENTITLEMENT_KEYS = [
  "invoice-parsing",
  "invoice-validation",
  "invoice-conversion",
  "payment-reconciliation",
  "crtr-extraction",
] as const;

/** Ungated in-app routes (inside ProtectedRoute + MainLayout). */
export const UNGATED_PATHS = ["/", "/access-request", "/auth-status"] as const;

/** Full-screen auth routes (outside ProtectedRoute). */
export const AUTH_PATHS = [
  "/auth/terms",
  "/auth/login",
  "/auth/register",
  "/auth/confirm",
  "/auth/forgot",
] as const;

/* ────────────────────────────────────────────────────────────────────────
 * Auth value control
 * ──────────────────────────────────────────────────────────────────────── */

export type HarnessAuth = {
  /** default true */
  authenticated?: boolean;
  /** default false — while true, ProtectedRoute renders null (no gated child) */
  loading?: boolean;
  /** default "Staff" */
  role?: Role;
  /** default [] — entitlements.allowedFeatures on the mocked context value */
  allowedFeatures?: readonly string[];
};

type AuthContextValue = AuthState & {
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

function buildAuthValue(auth: HarnessAuth = {}): AuthContextValue {
  const authenticated = auth.authenticated ?? true;
  return {
    isAuthenticated: authenticated,
    loading: auth.loading ?? false,
    user: authenticated
      ? {
          userId: "test-user-1",
          email: "user@example.test",
          name: "Test User",
          role: auth.role ?? "Staff",
        }
      : null,
    entitlements: authenticated
      ? { country: "TR", allowedFeatures: [...(auth.allowedFeatures ?? [])] }
      : null,
    entitlementSource: "live",
    refresh: async () => {},
    // Mirrors real sign-out: the context flips to unauthenticated, and the
    // real gate stack reacts (Sidebar's Logout item exercises this).
    signOut: async () => {
      authStore.set(buildAuthValue({ authenticated: false }));
    },
  };
}

/** Would the real gate stack unlock `feature` for this auth state?
 *  (Mirrors usePermissions: Admin unlocks everything; Settings is
 *  Admin-only; otherwise the mapped entitlement key must be allowed.) */
export function unlocks(
  feature: GatedFeatureKey,
  auth: { role?: Role; allowedFeatures?: readonly string[] },
): boolean {
  if ((auth.role ?? "Staff") === "Admin") return true;
  const key = FEATURE_TO_ENTITLEMENT[feature];
  if (key === null) return false; // Settings, non-admin
  return (auth.allowedFeatures ?? []).includes(key);
}

/* ────────────────────────────────────────────────────────────────────────
 * Per-feature loader spies + module-scope lazy routes
 * ──────────────────────────────────────────────────────────────────────── */

export type FeatureModule = { default: ComponentType };
export type FeatureLoader = () => Promise<FeatureModule>;
export type LoaderSpies = Record<GatedFeatureKey, Mock<FeatureLoader>>;

export const featureUiTestId = (key: GatedFeatureKey) => `feature-ui-${key}`;

/** Distinguishable stand-in for each feature's default export. */
const FeatureStub: Record<GatedFeatureKey, ComponentType> = Object.fromEntries(
  GATED_FEATURE_KEYS.map((key) => {
    const Stub: ComponentType = () => (
      <div data-testid={featureUiTestId(key)}>{key} feature UI</div>
    );
    (Stub as { displayName?: string }).displayName = `FeatureStub(${key})`;
    return [key, Stub];
  }),
) as Record<GatedFeatureKey, ComponentType>;

/** The module a feature's default loader resolves to. */
export function stubModule(key: GatedFeatureKey): FeatureModule {
  return { default: FeatureStub[key] };
}

function freshLoaders(): LoaderSpies {
  return Object.fromEntries(
    GATED_FEATURE_KEYS.map((key) => [
      key,
      vi.fn<FeatureLoader>(() => Promise.resolve(stubModule(key))),
    ]),
  ) as LoaderSpies;
}

// Swapped out by every renderApp() call so spies are fresh per test run.
let currentLoaders: LoaderSpies = freshLoaders();

// Module-scope lazy route components, exactly like the seven module-scope
// createLazyRoute declarations in src/App.tsx (stable component identity).
// Each delegates to the CURRENT spy so the spies can be replaced per test
// without recreating the components.
const LazyFeature: Record<GatedFeatureKey, ComponentType> = Object.fromEntries(
  GATED_FEATURE_KEYS.map((key) => [
    key,
    createLazyRoute(() => currentLoaders[key]()),
  ]),
) as Record<GatedFeatureKey, ComponentType>;

/** A controllable loader promise for pending/late-resolve/late-reject cases. */
export function createDeferredModule(): {
  promise: Promise<FeatureModule>;
  resolve: (module: FeatureModule) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (module: FeatureModule) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<FeatureModule>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Pre-attach a handler so a rejection never surfaces as an unhandled
  // promise rejection (React.lazy attaches handlers only once rendered).
  promise.catch(() => {});
  return { promise, resolve, reject };
}

/* ────────────────────────────────────────────────────────────────────────
 * Page stubs for non-feature routes (the gate stack and loaders are under
 * test, not the auth/Home page internals; real pages would drag Amplify
 * calls into jsdom).
 * ──────────────────────────────────────────────────────────────────────── */

export const pageTestId = (name: string) => `page-${name}`;

function makePage(name: string): ComponentType {
  const Page: ComponentType = () => (
    <div data-testid={pageTestId(name)}>{name} page</div>
  );
  (Page as { displayName?: string }).displayName = `PageStub(${name})`;
  return Page;
}

const HomePage = makePage("home");
const AccessRequestPage = makePage("access-request");
const AuthStatusPage = makePage("auth-status");
const TermsPage = makePage("auth-terms");
const LoginPage = makePage("auth-login");
const RegisterPage = makePage("auth-register");
const ConfirmPage = makePage("auth-confirm");
const ForgotPage = makePage("auth-forgot");

/* ────────────────────────────────────────────────────────────────────────
 * Route table — mirrors src/App.tsx exactly
 * ──────────────────────────────────────────────────────────────────────── */

function AppRoutes() {
  return (
    <Routes>
      {/* ── Auth routes (full-screen, no sidebar) ── */}
      <Route path="/auth/terms" element={<TermsPage />} />
      <Route path="/auth/login" element={<LoginPage />} />
      <Route path="/auth/register" element={<RegisterPage />} />
      <Route path="/auth/confirm" element={<ConfirmPage />} />
      <Route path="/auth/forgot" element={<ForgotPage />} />

      {/* ── App routes (protected, with MainLayout + Sidebar) ── */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <MainLayout />
          </ProtectedRoute>
        }
      >
        {/* Always accessible */}
        <Route index element={<HomePage />} />
        <Route path="access-request" element={<AccessRequestPage />} />

        {/* Feature-gated routes */}
        <Route
          path="invoice-parsing"
          element={
            <FeatureGate featureId="InvoiceParsing">
              <LazyFeature.InvoiceParsing />
            </FeatureGate>
          }
        />
        <Route
          path="invoice-validation/retail"
          element={
            <FeatureGate featureId="InvoiceControl">
              <LazyFeature.InvoiceControl />
            </FeatureGate>
          }
        />
        <Route
          path="invoice-validation/dropship"
          element={
            <FeatureGate featureId="InvoiceValidateDF">
              <LazyFeature.InvoiceValidateDF />
            </FeatureGate>
          }
        />
        <Route
          path="invoice-conversion"
          element={
            <FeatureGate featureId="InvoiceVerify">
              <LazyFeature.InvoiceVerify />
            </FeatureGate>
          }
        />
        <Route
          path="payment-reconciliation"
          element={
            <FeatureGate featureId="Recon">
              <LazyFeature.Recon />
            </FeatureGate>
          }
        />
        <Route
          path="crtr-extraction"
          element={
            <FeatureGate featureId="CRTRExtraction">
              <LazyFeature.CRTRExtraction />
            </FeatureGate>
          }
        />

        {/* Settings — Admin Panel (gated to admin only) */}
        <Route
          path="settings"
          element={
            <FeatureGate featureId="Settings">
              <LazyFeature.Settings />
            </FeatureGate>
          }
        />

        {/* Audit route */}
        <Route path="auth-status" element={<AuthStatusPage />} />

        {/* Help discarded */}
        <Route path="help" element={<Navigate to="/" replace />} />

        {/* Legacy routes redirect */}
        <Route path="login" element={<Navigate to="/auth/login" replace />} />
        <Route
          path="register"
          element={<Navigate to="/access-request" replace />}
        />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/auth/login" replace />} />
    </Routes>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Render/setup entry point
 * ──────────────────────────────────────────────────────────────────────── */

type Probe = { location: Location; navigate: NavigateFunction };

function LocationProbe({ probeRef }: { probeRef: { current: Probe | null } }) {
  const location = useLocation();
  const navigate = useNavigate();
  probeRef.current = { location, navigate };
  return null;
}

export type RenderAppOptions = {
  /** Router history; defaults to ["/"]. Deep links (with ?query#hash) welcome. */
  initialEntries?: string[];
  /** Initial mocked AuthContext value; defaults to authenticated Staff, no features. */
  auth?: HarnessAuth;
  /** Loader implementations to install on the fresh spies BEFORE the first
   *  render (e.g. a deferred/rejecting loader for the entry route). */
  loaderImpls?: Partial<Record<GatedFeatureKey, FeatureLoader>>;
};

export type LazyRouteHarness = RenderResult & {
  /** Fresh per-render loader spies — one per Feature_Module. */
  loaders: LoaderSpies;
  /** Replace the mocked AuthContext value (live update: all real gate
   *  components re-render, exactly like a mid-session grant/revocation). */
  setAuth: (next: HarnessAuth) => void;
  /** Sign the session out (context flips to unauthenticated). */
  signOut: () => void;
  /** Client-side navigation (no full page reload), act-wrapped. */
  navigate: (to: string) => void;
  /** Current router location (pathname/search/hash inspection). */
  location: () => Location;
  /** Loader invocation counts, per feature. */
  loaderCallCounts: () => Record<GatedFeatureKey, number>;
  /** Sum of all loader invocations across the seven features. */
  totalLoaderCalls: () => number;
};

export function renderApp(options: RenderAppOptions = {}): LazyRouteHarness {
  currentLoaders = freshLoaders();
  for (const [key, impl] of Object.entries(options.loaderImpls ?? {})) {
    if (impl) currentLoaders[key as GatedFeatureKey].mockImplementation(impl);
  }
  authStore.set(buildAuthValue(options.auth));

  const probeRef: { current: Probe | null } = { current: null };
  const result = render(
    <ThemeProvider>
      <MemoryRouter initialEntries={options.initialEntries ?? ["/"]}>
        <LocationProbe probeRef={probeRef} />
        <AppRoutes />
      </MemoryRouter>
    </ThemeProvider>,
  );

  const loaders = currentLoaders;
  const probe = () => {
    if (!probeRef.current) {
      throw new Error("lazyRouteHarness: router probe not mounted");
    }
    return probeRef.current;
  };

  return {
    ...result,
    loaders,
    setAuth: (next) => {
      act(() => {
        authStore.set(buildAuthValue(next));
      });
    },
    signOut: () => {
      act(() => {
        authStore.set(buildAuthValue({ authenticated: false }));
      });
    },
    navigate: (to) => {
      act(() => {
        void probe().navigate(to);
      });
    },
    location: () => probe().location,
    loaderCallCounts: () =>
      Object.fromEntries(
        GATED_FEATURE_KEYS.map((key) => [key, loaders[key].mock.calls.length]),
      ) as Record<GatedFeatureKey, number>,
    totalLoaderCalls: () =>
      GATED_FEATURE_KEYS.reduce(
        (sum, key) => sum + loaders[key].mock.calls.length,
        0,
      ),
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * fast-check generators
 * ──────────────────────────────────────────────────────────────────────── */

/** One of the seven gated feature keys. */
export const arbFeatureKey = fc.constantFrom<GatedFeatureKey>(
  ...GATED_FEATURE_KEYS,
);

/** A user role. */
export const arbRole = fc.constantFrom<Role>("Staff", "Admin");

/** An arbitrary subset of the backend entitlement keys (allowedFeatures). */
export const arbEntitlementSubset: fc.Arbitrary<string[]> = fc.subarray([
  ...ENTITLEMENT_KEYS,
]);

/** All navigable in-app paths (ungated + the seven feature routes). */
export const ALL_NAV_PATHS: readonly string[] = [
  ...UNGATED_PATHS,
  ...GATED_FEATURE_KEYS.map((key) => FEATURE_ROUTES[key]),
];

/** A navigation sequence over in-app routes (1–6 steps). */
export const arbNavigationSequence: fc.Arbitrary<string[]> = fc.array(
  fc.constantFrom(...ALL_NAV_PATHS),
  { minLength: 1, maxLength: 6 },
);

// URL-safe characters: RFC 3986 unreserved set. These pass through
// react-router's location handling unmodified, so byte-for-byte URL
// preservation (Property 9) is assertable without encoding ambiguity.
const UNRESERVED =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
const arbUnreservedChar = fc.constantFrom(...UNRESERVED.split(""));
const arbQueryChar = fc.constantFrom(...`${UNRESERVED}=&`.split(""));

/** Empty string or a URL-safe "?..." query string. */
export const arbQueryString: fc.Arbitrary<string> = fc.oneof(
  fc.constant(""),
  fc
    .stringOf(arbQueryChar, { minLength: 1, maxLength: 24 })
    .map((s) => `?${s}`),
);

/** Empty string or a URL-safe "#..." hash fragment. */
export const arbHashString: fc.Arbitrary<string> = fc.oneof(
  fc.constant(""),
  fc
    .stringOf(arbUnreservedChar, { minLength: 1, maxLength: 16 })
    .map((s) => `#${s}`),
);
