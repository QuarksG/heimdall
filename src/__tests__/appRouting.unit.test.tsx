// src/__tests__/appRouting.unit.test.tsx
//
// Example-based routing unit tests for the feature-code-splitting spec
// (task 5.7). The shared lazyRouteHarness renders the REAL FeatureGate /
// usePermissions / ProtectedRoute / MainLayout stack over a mocked
// AuthContext, with per-feature vi.fn() loader spies standing in for
// Feature_Chunk network requests (a loader invocation is the observable
// proxy for a chunk request).
//
// Covered behaviors:
// - Ungated routes issue zero loader calls (Req 1.3, 1.4, 1.5)
// - Admin flows: fallback → panel for Admin_User; unauthenticated
//   /settings redirects with zero admin loader calls (Req 4.3, 4.5)
// - Route-structure regressions: legacy redirects, wildcard fallback,
//   unauthenticated deep links (Req 5.5, 5.6)
// - Revocation while viewing (Req 5.4) and shell navigation away from the
//   Chunk_Error_View with the session preserved (Req 3.6)
//
// NOTE: the harness import must stay FIRST — it registers the AuthContext
// module mock before the real gate stack is imported.
//
// _Requirements: 1.3, 1.4, 1.5, 3.6, 4.3, 4.5, 5.4, 5.5, 5.6_

import {
  renderApp,
  FEATURE_ROUTES,
  GATED_FEATURE_KEYS,
  featureUiTestId,
  pageTestId,
  createDeferredModule,
  stubModule,
  UNGATED_PATHS,
  AUTH_PATHS,
} from "./lazyRouteHarness";
import type { GatedFeatureKey } from "./lazyRouteHarness";

import { describe, it, expect, afterEach, vi } from "vitest";
import { act, cleanup, screen, waitFor } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** "/auth/login" -> "auth-login", "/access-request" -> "access-request", "/" -> "home" */
function pageNameForPath(path: string): string {
  if (path === "/") return "home";
  return path.slice(1).replace(/\//g, "-");
}

/* ────────────────────────────────────────────────────────────────────────
 * Ungated routes issue zero Feature_Chunk loader calls
 * ──────────────────────────────────────────────────────────────────────── */

describe("ungated routes issue zero Feature_Chunk loader calls", () => {
  // Req 1.3 — entry at the Home route triggers no feature import.
  it("renders Home on entry at / with zero loader calls", () => {
    const app = renderApp({ initialEntries: ["/"] });

    expect(screen.getByTestId(pageTestId("home"))).toBeTruthy();
    expect(app.location().pathname).toBe("/");
    expect(app.totalLoaderCalls()).toBe(0);
  });

  // Req 1.4 — an authenticated user moving among ungated routes triggers
  // no feature import at any step.
  it("keeps every loader at zero while navigating among Home / Access Request / auth-status", () => {
    const app = renderApp({ initialEntries: ["/"] });

    const tour = [
      "/access-request",
      "/auth-status",
      "/",
      "/auth-status",
      "/access-request",
    ];
    for (const path of tour) {
      app.navigate(path);
      expect(app.location().pathname).toBe(path);
      expect(
        screen.getByTestId(pageTestId(pageNameForPath(path))),
      ).toBeTruthy();
      expect(app.totalLoaderCalls()).toBe(0);
    }
    // Sanity: the tour covered exactly the ungated in-app routes.
    expect(new Set(tour)).toEqual(new Set(UNGATED_PATHS));
  });

  // Req 1.5 — unauthenticated visitors on auth routes render from the
  // Initial_Bundle only: zero feature loader invocations.
  it.each([...AUTH_PATHS])(
    "renders %s for an unauthenticated visitor with zero loader calls",
    (path) => {
      const app = renderApp({
        initialEntries: [path],
        auth: { authenticated: false },
      });

      expect(app.location().pathname).toBe(path);
      expect(
        screen.getByTestId(pageTestId(pageNameForPath(path))),
      ).toBeTruthy();
      expect(app.totalLoaderCalls()).toBe(0);
    },
  );
});

/* ────────────────────────────────────────────────────────────────────────
 * Admin flows
 * ──────────────────────────────────────────────────────────────────────── */

describe("admin flows", () => {
  // Req 4.3 — Admin_User: chunk requested only after the gate grants,
  // Suspense_Fallback while in flight, Admin Panel UI on completion.
  it("shows the Suspense fallback, then the Admin Panel, for an Admin_User at /settings", async () => {
    const deferred = createDeferredModule();
    const app = renderApp({
      initialEntries: ["/settings"],
      auth: { role: "Admin" },
      loaderImpls: { Settings: () => deferred.promise },
    });

    // The gate granted, so the import executed exactly once…
    expect(app.loaderCallCounts().Settings).toBe(1);
    // …and while the load is pending the fallback occupies the content area.
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText("Loading feature…")).toBeTruthy();
    expect(screen.queryByTestId(featureUiTestId("Settings"))).toBeNull();

    // Resolve the deferred module — the panel UI replaces the fallback.
    await act(async () => {
      deferred.resolve(stubModule("Settings"));
      await deferred.promise;
    });
    expect(
      await screen.findByTestId(featureUiTestId("Settings")),
    ).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();

    // Rendering the resolved module did not re-invoke the import.
    expect(app.loaderCallCounts().Settings).toBe(1);
    expect(app.location().pathname).toBe("/settings");
  });

  // Req 4.5 — an unauthenticated visitor at /settings is redirected to the
  // login route by ProtectedRoute, with no admin chunk request window.
  it("redirects an unauthenticated visitor at /settings to login with zero admin loader calls", () => {
    const app = renderApp({
      initialEntries: ["/settings"],
      auth: { authenticated: false },
    });

    expect(app.location().pathname).toBe("/auth/login");
    expect(screen.getByTestId(pageTestId("auth-login"))).toBeTruthy();
    expect(screen.queryByTestId(featureUiTestId("Settings"))).toBeNull();
    expect(app.loaderCallCounts().Settings).toBe(0);
    expect(app.totalLoaderCalls()).toBe(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * Route-structure regressions (legacy redirects, wildcard, deep links)
 * ──────────────────────────────────────────────────────────────────────── */

describe("route structure is preserved", () => {
  // Req 5.5 — legacy redirects still land where they always did.
  it.each([
    ["/login", "/auth/login", "auth-login"],
    ["/register", "/access-request", "access-request"],
    ["/help", "/", "home"],
  ])(
    "redirects legacy %s to %s",
    (legacyPath, expectedPath, expectedPage) => {
      const app = renderApp({ initialEntries: [legacyPath] });

      expect(app.location().pathname).toBe(expectedPath);
      expect(screen.getByTestId(pageTestId(expectedPage))).toBeTruthy();
      expect(app.totalLoaderCalls()).toBe(0);
    },
  );

  // Req 5.5 — the wildcard fallback still redirects unknown paths to login.
  it("redirects an unknown path to /auth/login via the wildcard fallback", () => {
    const app = renderApp({
      initialEntries: ["/definitely/not/a/route"],
    });

    expect(app.location().pathname).toBe("/auth/login");
    expect(screen.getByTestId(pageTestId("auth-login"))).toBeTruthy();
    expect(app.totalLoaderCalls()).toBe(0);
  });

  // Req 5.6 — an unauthenticated deep link to a feature route redirects to
  // login without rendering the Feature_Module OR the Access_Denied_View,
  // and without any chunk request.
  it.each([...GATED_FEATURE_KEYS])(
    "redirects an unauthenticated deep link to the %s route to login, rendering neither the feature nor Access Denied",
    (feature: GatedFeatureKey) => {
      const app = renderApp({
        initialEntries: [FEATURE_ROUTES[feature]],
        auth: { authenticated: false },
      });

      expect(app.location().pathname).toBe("/auth/login");
      expect(screen.getByTestId(pageTestId("auth-login"))).toBeTruthy();
      expect(screen.queryByTestId(featureUiTestId(feature))).toBeNull();
      expect(
        screen.queryByRole("heading", { name: "Access Denied" }),
      ).toBeNull();
      expect(app.totalLoaderCalls()).toBe(0);
    },
  );
});

/* ────────────────────────────────────────────────────────────────────────
 * Revocation while viewing + shell navigation from the Chunk_Error_View
 * ──────────────────────────────────────────────────────────────────────── */

describe("revocation and chunk-error resilience", () => {
  // Req 5.4 — revoking the entitlement while the user is ON the feature
  // route takes effect within one render cycle of the auth update:
  // FeatureGate re-evaluates and replaces the Feature_Module with the
  // Access_Denied_View in place (the feature UI unmounts immediately).
  it("replaces the feature with the Access_Denied_View within one render cycle of a revocation while viewing", async () => {
    const app = renderApp({
      initialEntries: ["/"],
      auth: { role: "Staff", allowedFeatures: ["payment-reconciliation"] },
    });

    app.navigate(FEATURE_ROUTES.Recon);
    expect(await screen.findByTestId(featureUiTestId("Recon"))).toBeTruthy();
    expect(app.loaderCallCounts().Recon).toBe(1);

    // Live mid-session revocation while ON the route. setAuth is
    // act-wrapped, so by the time it returns the render cycle triggered by
    // the entitlement update has completed — assert synchronously.
    app.setAuth({ role: "Staff", allowedFeatures: [] });

    expect(screen.queryByTestId(featureUiTestId("Recon"))).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Access Denied" }),
    ).toBeTruthy();
    expect(screen.getByText(/You don't have permission to access/)).toBeTruthy();
    // FeatureGate denies in place: the URL is unchanged and no further
    // chunk request was issued.
    expect(app.location().pathname).toBe(FEATURE_ROUTES.Recon);
    expect(app.loaderCallCounts().Recon).toBe(1);
  });

  // Req 3.6 — with the Chunk_Error_View on screen, shell navigation still
  // works and the authenticated session is preserved (protected routes
  // keep rendering; no bounce to the login route).
  it("navigates from the Chunk_Error_View to an ungated route with the session untouched", async () => {
    // React logs boundary-caught errors via console.error; keep the run quiet.
    vi.spyOn(console, "error").mockImplementation(() => {});

    const app = renderApp({
      initialEntries: ["/"],
      auth: { role: "Staff", allowedFeatures: ["payment-reconciliation"] },
      loaderImpls: {
        Recon: () => Promise.reject(new Error("chunk fetch failed")),
      },
    });

    app.navigate(FEATURE_ROUTES.Recon);
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Feature failed to load" }),
      ).toBeTruthy();
    });
    expect(app.loaderCallCounts().Recon).toBe(1);
    expect(screen.queryByTestId(featureUiTestId("Recon"))).toBeNull();

    // Shell navigation away from the error view renders the target route.
    app.navigate("/access-request");
    expect(app.location().pathname).toBe("/access-request");
    expect(screen.getByTestId(pageTestId("access-request"))).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Feature failed to load" }),
    ).toBeNull();

    // The session object was untouched by the chunk failure: protected
    // routes still render for the authenticated user (an invalidated
    // session would have redirected to /auth/login), and no auth page is
    // in the tree.
    app.navigate("/");
    expect(app.location().pathname).toBe("/");
    expect(screen.getByTestId(pageTestId("home"))).toBeTruthy();
    expect(screen.queryByTestId(pageTestId("auth-login"))).toBeNull();
    // No extra chunk requests were issued by the failure or the navigation.
    expect(app.loaderCallCounts().Recon).toBe(1);
    expect(app.totalLoaderCalls()).toBe(1);
  });
});
