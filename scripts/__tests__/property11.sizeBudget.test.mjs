// Feature: feature-code-splitting, Property 11: The size-budget verdict is exactly the budget comparison
//
// For any synthetic fixture whose Initial_Bundle files have arbitrary
// generated sizes summing to s bytes (uncompressed, on disk) and any
// injected budget B (via config.maxInitialBundleBytes — the comparison
// logic is under test, not the 1,600,950 constant), the size-budget check
// passes if and only if s ≤ B. The generator biases toward the budget
// boundary: sums exactly equal to the budget, one byte under, and one
// byte over are all produced.
//
// **Validates: Requirements 6.3**

import { test, expect, afterEach } from "vitest";
import fc from "fast-check";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyBundleSplit } from "../verify-bundle-split.mjs";

// Small injected budgets keep fixture files tiny and the boundary reachable.
const budgetArb = fc.integer({ min: 1, max: 5_000 });

// Total Initial_Bundle size: biased toward the boundary (budget - 1, budget,
// budget + 1) with arbitrary sums mixed in, clamped to ≥ 0.
const fixtureArb = budgetArb.chain((budget) =>
  fc.record({
    budget: fc.constant(budget),
    totalSize: fc.oneof(
      { weight: 3, arbitrary: fc.constantFrom(budget - 1, budget, budget + 1) },
      { weight: 2, arbitrary: fc.integer({ min: 0, max: 2 * budget + 10 }) },
    ).map((s) => Math.max(0, s)),
    // Cut fractions splitting the total across 1–3 initial files.
    cuts: fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { maxLength: 2 }),
  }),
);

/** Splits `total` bytes into cuts.length + 1 non-negative integer parts. */
function splitSizes(total, cuts) {
  const points = [0, ...cuts.map((f) => Math.round(f * total)), total].sort(
    (a, b) => a - b,
  );
  const sizes = [];
  for (let i = 1; i < points.length; i++) sizes.push(points[i] - points[i - 1]);
  return sizes;
}

// Backstop cleanup for temp dirs (primary cleanup is the finally block below).
const tmpDirs = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "Property 11: the size-budget verdict is exactly the budget comparison",
  () => {
    fc.assert(
      fc.property(fixtureArb, ({ budget, totalSize, cuts }) => {
        const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "heimdall-p11-"));
        tmpDirs.push(distDir);
        try {
          fs.mkdirSync(path.join(distDir, "assets"));

          // 1–3 initial JS files whose on-disk byte sizes sum to totalSize.
          // Content is ASCII 'x' filler, so byte size === character count
          // and no configured marker can ever match.
          const sizes = splitSizes(totalSize, cuts);
          const initialNames = sizes.map((_, k) => `assets/init${k}.js`);
          sizes.forEach((size, k) => {
            fs.writeFileSync(
              path.join(distDir, initialNames[k]),
              "x".repeat(size),
            );
          });

          // index.html: first initial file as the module script, the rest as
          // modulepreload links (the established fixture convention).
          const links = initialNames
            .slice(1)
            .map((n) => `<link rel="modulepreload" href="/${n}">`)
            .join("\n    ");
          fs.writeFileSync(
            path.join(distDir, "index.html"),
            `<!doctype html>\n<html>\n  <head>\n    <script type="module" src="/${initialNames[0]}"></script>\n    ${links}\n  </head>\n  <body><div id="root"></div></body>\n</html>\n`,
          );

          // Small custom config: the injected budget is what's under test.
          // Other checks' verdicts (marker/manifest) are irrelevant here.
          const config = {
            markers: [
              {
                featureId: "F0",
                routePath: "/f0",
                marker: "MARKER_NEVER_PRESENT",
                manifestKey: "src/f0.ts",
              },
            ],
            maxInitialBundleBytes: budget,
          };

          const report = verifyBundleSplit(distDir, config);
          const sizeCheck = report.checks.find((c) => c.id === "size-budget");

          expect(sizeCheck, "size-budget check missing").toBeDefined();
          expect(sizeCheck.kind).toBe("size-budget");

          // The report measures exactly the sum of on-disk initial bytes.
          expect(report.initialBundleBytes).toBe(totalSize);

          // The verdict is exactly the budget comparison: pass iff s ≤ B.
          expect(
            sizeCheck.passed,
            `size-budget: sum=${totalSize}, budget=${budget}`,
          ).toBe(totalSize <= budget);
        } finally {
          fs.rmSync(distDir, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 },
    );
  },
  60_000,
);
