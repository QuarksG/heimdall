// Feature: feature-code-splitting, Property 12: The verification verdict is fail-closed and the failure report is complete
//
// **Validates: Requirements 6.4, 6.5, 6.6**
//
// For any induced subset of check failures — marker leaked into an initial
// file, marker missing from all chunks, size budget exceeded, or a missing
// input (absent dist directory, absent index.html, or unidentifiable
// Initial_Bundle) — running the verification evaluates all applicable
// checks, reports exactly the induced failures each with identifying
// detail, and yields a passing verdict if and only if the induced failure
// subset is empty.
//
// Structural failures (missing dist, missing index.html) short-circuit in
// the core per the design, so for those cases we assert the corresponding
// missing-input check fails and report.passed is false. Content-level
// failure subsets (marker leak / marker missing / budget exceeded) are
// asserted with exact failed-check-id set equality.

import { it, expect } from "vitest";
import fc from "fast-check";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyBundleSplit, defaultConfig } from "../verify-bundle-split.mjs";

const FEATURE_IDS = defaultConfig.markers.map((m) => m.featureId);
const MARKER_BY_ID = new Map(defaultConfig.markers.map((m) => [m.featureId, m]));

// Small injected budget (the comparison logic is under test, not the real
// constant). The healthy fixture's initial file plus all seven leaked
// markers stays well under this; the budget-exceeded filler goes well over.
const BUDGET = 2_000;

/**
 * Builds a baseline healthy dist fixture under `root`:
 * index.html with one module script (the initial JS file), one chunk file
 * per feature containing that feature's marker byte-for-byte, and a
 * .vite/manifest.json mapping each manifestKey to its chunk file.
 * All checks pass against this fixture with the injected budget.
 */
function buildHealthyFixture(root) {
  const dist = path.join(root, "dist");
  const assets = path.join(dist, "assets");
  fs.mkdirSync(assets, { recursive: true });

  const initialRel = "assets/index-entry.js";
  const initialAbs = path.join(dist, initialRel);
  fs.writeFileSync(initialAbs, 'console.log("shell code only");\n');

  const manifest = {};
  for (const m of defaultConfig.markers) {
    const chunkRel = `assets/chunk-${m.featureId}.js`;
    fs.writeFileSync(
      path.join(dist, chunkRel),
      `/* ${m.featureId} */ const s = ${JSON.stringify(m.marker)};\n`,
    );
    manifest[m.manifestKey] = { file: chunkRel };
  }
  fs.mkdirSync(path.join(dist, ".vite"), { recursive: true });
  fs.writeFileSync(
    path.join(dist, ".vite", "manifest.json"),
    JSON.stringify(manifest),
  );

  const indexHtmlAbs = path.join(dist, "index.html");
  fs.writeFileSync(
    indexHtmlAbs,
    `<!doctype html><html><head><script type="module" src="/${initialRel}"></script></head><body></body></html>`,
  );

  return { dist, initialAbs, indexHtmlAbs };
}

// Content-level failure subsets: each feature may leak its marker into the
// initial file and/or lose its marker from its chunk file; the budget may
// be exceeded. The empty subset (all pass) is generated too.
const contentCaseArb = fc.record({
  type: fc.constant("content"),
  leaked: fc.subarray(FEATURE_IDS),
  missing: fc.subarray(FEATURE_IDS),
  budgetExceeded: fc.boolean(),
});

// Structural missing-input failures (short-circuiting or gating cases).
const structuralCaseArb = fc.record({
  type: fc.constant("structural"),
  kind: fc.constantFrom("missing-dist", "missing-index", "no-entry-scripts"),
});

const testCaseArb = fc.oneof(
  { arbitrary: contentCaseArb, weight: 3 },
  { arbitrary: structuralCaseArb, weight: 1 },
);

const config = { ...defaultConfig, maxInitialBundleBytes: BUDGET };

it("Property 12: reported failed-check set equals the induced failure set; pass iff empty (fail-closed)", () => {
  fc.assert(
    fc.property(testCaseArb, (tc) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "p12-fixture-"));
      try {
        if (tc.type === "structural") {
          if (tc.kind === "missing-dist") {
            // dist directory absent entirely.
            const report = verifyBundleSplit(
              path.join(root, "dist-does-not-exist"),
              config,
            );
            const failed = report.checks.filter((c) => !c.passed);
            expect(report.passed).toBe(false);
            expect(failed.map((c) => c.id)).toContain("missing-input:dist");
            for (const c of failed) {
              expect(c.kind).toBe("missing-input");
              expect(c.detail.length).toBeGreaterThan(0);
            }
          } else if (tc.kind === "missing-index") {
            // dist exists but index.html is absent.
            const { dist, indexHtmlAbs } = buildHealthyFixture(root);
            fs.rmSync(indexHtmlAbs);
            const report = verifyBundleSplit(dist, config);
            const failed = report.checks.filter((c) => !c.passed);
            expect(report.passed).toBe(false);
            expect(failed.map((c) => c.id)).toContain(
              "missing-input:index.html",
            );
            for (const c of failed) {
              expect(c.kind).toBe("missing-input");
              expect(c.detail.length).toBeGreaterThan(0);
            }
          } else {
            // index.html present but the Initial_Bundle is unidentifiable:
            // no <script type="module" src> at all.
            const { dist, indexHtmlAbs } = buildHealthyFixture(root);
            fs.writeFileSync(
              indexHtmlAbs,
              "<!doctype html><html><head></head><body></body></html>",
            );
            const report = verifyBundleSplit(dist, config);
            expect(report.passed).toBe(false);
            const entryCheck = report.checks.find(
              (c) => c.id === "missing-input:entry-scripts",
            );
            expect(entryCheck).toBeDefined();
            expect(entryCheck.passed).toBe(false);
            expect(entryCheck.detail.length).toBeGreaterThan(0);
          }
          return;
        }

        // Content-level case: mutate the healthy fixture per the induced
        // failure subset, then require exact failed-check-set equality.
        const { dist, initialAbs } = buildHealthyFixture(root);

        for (const featureId of tc.leaked) {
          const { marker } = MARKER_BY_ID.get(featureId);
          fs.appendFileSync(initialAbs, `\n// leaked: ${marker}\n`);
        }
        for (const featureId of tc.missing) {
          fs.writeFileSync(
            path.join(dist, "assets", `chunk-${featureId}.js`),
            `/* ${featureId} */ const s = "marker redacted";\n`,
          );
        }
        if (tc.budgetExceeded) {
          // Marker-free filler pushing the initial file past the budget.
          fs.appendFileSync(initialAbs, "x".repeat(BUDGET + 1));
        }

        const report = verifyBundleSplit(dist, config);

        const expectedFailedIds = new Set([
          ...tc.leaked.map((f) => `marker-absent-initial:${f}`),
          ...tc.missing.map((f) => `marker-in-chunk:${f}`),
          ...(tc.budgetExceeded ? ["size-budget"] : []),
        ]);
        const actualFailedIds = new Set(
          report.checks.filter((c) => !c.passed).map((c) => c.id),
        );

        // The failure report is complete and exact: reported failed checks
        // equal the induced set (Req 6.4), with identifying detail per check.
        expect(actualFailedIds).toEqual(expectedFailedIds);
        for (const c of report.checks) {
          expect(typeof c.detail).toBe("string");
          expect(c.detail.length).toBeGreaterThan(0);
        }

        // Fail-closed verdict: pass iff the induced subset is empty
        // (Req 6.4, 6.5).
        expect(report.passed).toBe(expectedFailedIds.size === 0);
        expect(report.checks.length).toBeGreaterThan(0);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: 100 },
  );
});
