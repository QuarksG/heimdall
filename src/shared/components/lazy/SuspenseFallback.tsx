// src/shared/components/lazy/SuspenseFallback.tsx
//
// Suspense_Fallback rendered in the route content area while a
// Feature_Chunk download is in flight (Req 2.9, 3.1). Presentation-only:
// no data fetching, no global state. Sized to match the Access_Denied_View
// footprint in FeatureGate.tsx (minHeight: 60vh) to avoid layout jumps
// when the gate outcome or load state changes.

import { Spinner } from "react-bootstrap";

export default function SuspenseFallback() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        padding: 32,
      }}
    >
      <Spinner animation="border" role="status" variant="primary">
        <span className="visually-hidden">Loading feature…</span>
      </Spinner>
    </div>
  );
}
