// Unit tests for the ChunkErrorView recovery controls (task 2.5).
//
// - The reload control performs a full browser page reload of the current
//   route's URL via window.location.reload(), activated exactly once per
//   click (Req 3.9).
// - The Chunk_Error_View is purely presentational: it renders no feature
//   content and leaves the surrounding application shell markup and any
//   context values (e.g., the authenticated session) untouched
//   (Req 3.6, 3.11).
//
// _Requirements: 3.6, 3.9, 3.11_

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import ChunkErrorBoundary from "../ChunkErrorBoundary";

// React logs boundary-caught errors via console.error; suppress that
// expected noise so the test output stays readable.
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => {
  consoleErrorSpy.mockRestore();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Simulates a Feature_Module that fails during its initial render. */
function ThrowingFeature(): never {
  throw new Error("feature module failed during initial render");
}

const noop = () => {};

describe("ChunkErrorView recovery controls", () => {
  it("calls the stubbed window.location.reload exactly once when the reload control is activated", async () => {
    // jsdom's Location properties are non-configurable, so replace the
    // whole `location` global with a writable stub carrying a spy.
    const reloadStub = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload: reloadStub });

    const user = userEvent.setup({ delay: null });

    // attempt >= 1 means the failed attempt was itself a retry, so the
    // boundary derives showReload = true and offers the reload control.
    render(
      <ChunkErrorBoundary attempt={1} onRetry={noop}>
        <ThrowingFeature />
      </ChunkErrorBoundary>,
    );

    const reloadButton = await screen.findByRole("button", {
      name: "Reload page",
    });
    expect(reloadStub).not.toHaveBeenCalled();

    await user.click(reloadButton);

    expect(reloadStub).toHaveBeenCalledTimes(1);
  });

  it("renders no feature content and leaves surrounding shell markup and context values untouched", () => {
    // Stand-in for AuthContext: a session object provided by the shell.
    type Session = { user: string; token: string };
    const SessionContext = createContext<Session | null>(null);

    function SessionProbe() {
      const session = useContext(SessionContext);
      return (
        <div data-testid="session-probe">
          {session ? `${session.user}:${session.token}` : "no-session"}
        </div>
      );
    }

    // Shell wrapper: sidebar markup and a context consumer live OUTSIDE
    // the boundary, exactly like MainLayout surrounds the route content.
    function Shell({ children }: { children: ReactNode }) {
      return (
        <div>
          <nav data-testid="shell-sidebar">
            <a href="/home">Home</a>
            <a href="/access-request">Access Request</a>
          </nav>
          <SessionProbe />
          <main data-testid="route-content">
            <ChunkErrorBoundary attempt={0} onRetry={noop}>
              {children}
            </ChunkErrorBoundary>
          </main>
        </div>
      );
    }

    const session: Session = { user: "alice", token: "tok-123" };
    const sessionSnapshot = { ...session };

    // First render a healthy child to capture the shell's baseline markup.
    const { rerender } = render(
      <SessionContext.Provider value={session}>
        <Shell>
          <div>healthy placeholder</div>
        </Shell>
      </SessionContext.Provider>,
    );

    const sidebarBefore = screen.getByTestId("shell-sidebar").outerHTML;
    const probeBefore = screen.getByTestId("session-probe").textContent;
    expect(probeBefore).toBe("alice:tok-123");

    // Now swap in a feature that fails during render; the boundary catches
    // it and shows the Chunk_Error_View in the route content area only.
    rerender(
      <SessionContext.Provider value={session}>
        <Shell>
          <ThrowingFeature />
        </Shell>
      </SessionContext.Provider>,
    );

    // The error view is shown in place of the feature...
    expect(screen.getByText("Feature failed to load")).toBeTruthy();
    // ...and no feature content rendered (the throwing render committed
    // nothing, and the healthy placeholder is gone).
    expect(screen.queryByText("healthy placeholder")).toBeNull();
    const routeContent = screen.getByTestId("route-content");
    expect(routeContent.textContent).not.toContain("healthy placeholder");

    // Surrounding shell markup is byte-for-byte unchanged.
    expect(screen.getByTestId("shell-sidebar").outerHTML).toBe(sidebarBefore);

    // Context values seen by consumers outside the boundary are unchanged,
    // and the session object itself was not mutated.
    expect(screen.getByTestId("session-probe").textContent).toBe(probeBefore);
    expect(session).toEqual(sessionSnapshot);
  });
});
