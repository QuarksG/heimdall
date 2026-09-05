// src/shared/components/lazy/ChunkErrorBoundary.tsx
//
// Error boundary for the Lazy_Boundary, scoped to the route content area.
// Catches Chunk_Load_Errors (dynamic import rejections) as well as errors
// thrown during module evaluation or the feature's initial render
// (Req 1.8, 3.3, 3.8), replacing the failed subtree with the
// Chunk_Error_View. Error boundaries must be class components.
//
// Recovery contract:
// - Retry delegates to props.onRetry (createLazyRoute increments its
//   attempt counter, which remounts this boundary via `key` and creates a
//   fresh React.lazy instance) — Req 3.4.
// - When the failed attempt was itself a retry (attempt >= 1), the view
//   additionally offers a full page reload control (Req 3.5) which calls
//   window.location.reload() on the current route URL (Req 3.9).
//
// The Chunk_Error_View is purely presentational: it renders no feature
// content and touches no global state, so the sidebar, navigation,
// AuthContext session, and any in-flight data operations elsewhere in the
// app are unaffected (Req 3.6, 3.11).

import { Component } from "react";
import type { ReactNode } from "react";
import { Button } from "react-bootstrap";

type Props = {
  /** Current load attempt (0 on first load; +1 per retry activation). */
  attempt: number;
  /** Activated by the Retry control; owned by createLazyRoute. */
  onRetry: () => void;
  children: ReactNode;
};

// Track error PRESENCE explicitly rather than storing the error value and
// testing its truthiness: a dynamic import can reject with any value,
// including falsy ones ("", 0, null), and Req 1.8/3.3 demand the
// Chunk_Error_View for every Chunk_Load_Error regardless of the value.
type State = { hasError: boolean };

type ChunkErrorViewProps = {
  onRetry: () => void;
  /** Req 3.5: the reload control appears from the second failure onward. */
  showReload: boolean;
  onReload: () => void;
};

/**
 * Presentational error view rendered in the route content area only,
 * styled to match the Access_Denied_View in FeatureGate.tsx (centered,
 * icon, minHeight 60vh) to avoid layout jumps between gate outcomes.
 */
export function ChunkErrorView({
  onRetry,
  showReload,
  onReload,
}: ChunkErrorViewProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        gap: 16,
        padding: 32,
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: "50%",
          background: "var(--hd-danger-bg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 28,
        }}
      >
        <i className="ph-bold ph-warning-circle" style={{ color: "#b91c1c" }} />
      </div>

      <h2 style={{ margin: 0, fontSize: 22, color: "var(--hd-text)" }}>
        Feature failed to load
      </h2>

      <p
        style={{
          margin: 0,
          color: "var(--hd-text-muted)",
          maxWidth: 420,
          lineHeight: 1.6,
        }}
      >
        This part of the application could not be downloaded. Check your
        connection and try again. The rest of the application remains
        available from the sidebar.
      </p>

      <div style={{ display: "flex", gap: 12 }}>
        <Button variant="primary" onClick={onRetry}>
          Retry
        </Button>
        {showReload && (
          <Button variant="outline-secondary" onClick={onReload}>
            Reload page
          </Button>
        )}
      </div>
    </div>
  );
}

class ChunkErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    // Unconditionally flag the error: the thrown value itself is irrelevant
    // to whether the boundary engaged (it may be falsy).
    return { hasError: true };
  }

  handleReload = () => {
    // Req 3.9: full browser reload of the CURRENT route URL.
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <ChunkErrorView
          onRetry={this.props.onRetry}
          // Req 3.5: reload control appears when the failed attempt was
          // itself a retry (attempt >= 1).
          showReload={this.props.attempt >= 1}
          onReload={this.handleReload}
        />
      );
    }
    return this.props.children;
  }
}

export default ChunkErrorBoundary;
