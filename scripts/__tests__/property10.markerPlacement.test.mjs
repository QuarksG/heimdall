// Feature: feature-code-splitting, Property 10: Marker placement determines the marker-check verdicts
//
// For any synthetic dist/ fixture tree and any configured Marker_String:
//   - the marker-in-chunk check passes iff the marker's exact bytes appear in
//     at least one JS file outside the Initial_Bundle, and
//   - the marker-absent-from-initial check passes iff the marker's exact bytes
//     appear zero times across all Initial_Bundle files,
// matching case-sensitive and byte-for-byte (a case-mutated variant planted
// in an initial file does not fail the check).
//
// **Validates: Requirements 6.1, 6.2**

import { test, expect, afterEach } from "vitest";
import fc from "fast-check";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyBundleSplit } from "../verify-bundle-split.mjs";

// ── Fixture-tree construction ────────────────────────────────────────────────
//
// Marker strings have the shape `M<i>_<lowercase suffix>` (e.g. "M0_qxevt").
// File contents are built from "segments": filler text (drawn from an alphabet
// containing NO letters and NO underscore, so filler can never form a marker
// or extend one across a boundary) optionally followed by a "plant" — either
// the exact marker bytes or a case-mutated variant (exactly one letter's case
// flipped, so it can never byte-match the exact marker). The filler lengths
// are the generated offsets at which plants land inside each file.

const LOWER = "abcdefghijklmnopqrstuvwxyz";
// No letters, no underscore: cannot contribute to (or bridge) a marker match.
const FILLER_ALPHABET = ";(){}[]=+*#-.,:!0123456789 \n";

const suffixArb = fc
  .array(fc.constantFrom(...LOWER), { minLength: 3, maxLength: 8 })
  .map((cs) => cs.join(""));

const fillerArb = fc
  .array(fc.constantFrom(...FILLER_ALPHABET), { maxLength: 20 })
  .map((cs) => cs.join(""));

const plantArb = fc.record({
  featureSeed: fc.nat(2), // resolved modulo the number of markers
  kind: fc.constantFrom("exact", "mutated"),
  mutSeed: fc.nat(999), // picks which letter's case gets flipped
});

const segmentArb = fc.record({
  filler: fillerArb,
  plant: fc.option(plantArb, { nil: null }),
});

const fileArb = fc.record({
  segments: fc.array(segmentArb, { maxLength: 4 }),
  trailing: fillerArb,
});

const fixtureArb = fc.record({
  numMarkers: fc.integer({ min: 1, max: 3 }),
  suffixes: fc.array(suffixArb, { minLength: 3, maxLength: 3 }),
  initialFiles: fc.array(fileArb, { minLength: 1, maxLength: 3 }),
  chunkFiles: fc.array(fileArb, { maxLength: 3 }),
});

/** Flips the case of exactly one letter of the marker (chosen by seed). */
function caseMutate(marker, seed) {
  const letterPositions = [...marker]
    .map((c, i) => (/[a-zA-Z]/.test(c) ? i : -1))
    .filter((i) => i >= 0);
  const pos = letterPositions[seed % letterPositions.length];
  const c = marker[pos];
  const flipped = c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase();
  return marker.slice(0, pos) + flipped + marker.slice(pos + 1);
}

/** Renders a generated file spec to bytes; records which markers were planted exactly. */
function renderFile(file, markers, exactPlantedInto) {
  let content = "";
  for (const seg of file.segments) {
    content += seg.filler;
    if (seg.plant) {
      const idx = seg.plant.featureSeed % markers.length;
      if (seg.plant.kind === "exact") {
        content += markers[idx];
        exactPlantedInto.add(idx);
      } else {
        content += caseMutate(markers[idx], seg.plant.mutSeed);
      }
    }
  }
  return content + file.trailing;
}

// Backstop cleanup for temp dirs (primary cleanup is the finally block below).
const tmpDirs = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "Property 10: marker placement determines the marker-check verdicts",
  () => {
    fc.assert(
      fc.property(fixtureArb, (fx) => {
        const markers = Array.from(
          { length: fx.numMarkers },
          (_, i) => `M${i}_${fx.suffixes[i]}`,
        );

        const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "heimdall-p10-"));
        tmpDirs.push(distDir);
        try {
          fs.mkdirSync(path.join(distDir, "assets"));

          // Render initial and chunk JS files, tracking exact plants per set.
          const exactInInitial = new Set();
          const exactInChunks = new Set();

          const initialNames = fx.initialFiles.map((_, k) => `assets/init${k}.js`);
          fx.initialFiles.forEach((file, k) => {
            fs.writeFileSync(
              path.join(distDir, initialNames[k]),
              renderFile(file, markers, exactInInitial),
            );
          });
          fx.chunkFiles.forEach((file, k) => {
            fs.writeFileSync(
              path.join(distDir, `assets/chunk-${k}.js`),
              renderFile(file, markers, exactInChunks),
            );
          });

          // index.html: first initial file as the module script, the rest as
          // modulepreload links — everything else on disk is a chunk.
          const links = initialNames
            .slice(1)
            .map((n) => `<link rel="modulepreload" href="/${n}">`)
            .join("\n    ");
          fs.writeFileSync(
            path.join(distDir, "index.html"),
            `<!doctype html>\n<html>\n  <head>\n    <script type="module" src="/${initialNames[0]}"></script>\n    ${links}\n  </head>\n  <body><div id="root"></div></body>\n</html>\n`,
          );

          const config = {
            markers: markers.map((marker, i) => ({
              featureId: `F${i}`,
              routePath: `/f${i}`,
              marker,
              manifestKey: `src/f${i}.ts`,
            })),
            maxInitialBundleBytes: 10_000_000,
          };

          const report = verifyBundleSplit(distDir, config);
          const byId = new Map(report.checks.map((c) => [c.id, c]));

          for (let i = 0; i < markers.length; i++) {
            const inChunk = byId.get(`marker-in-chunk:F${i}`);
            const absentInitial = byId.get(`marker-absent-initial:F${i}`);
            expect(inChunk, `marker-in-chunk:F${i} check missing`).toBeDefined();
            expect(
              absentInitial,
              `marker-absent-initial:F${i} check missing`,
            ).toBeDefined();

            // Passes iff the exact bytes were planted in at least one chunk file.
            expect(
              inChunk.passed,
              `marker-in-chunk:F${i} (${JSON.stringify(markers[i])}) — exact planted in chunks: ${exactInChunks.has(i)}`,
            ).toBe(exactInChunks.has(i));

            // Passes iff the exact bytes appear zero times in initial files;
            // case-mutated plants in initial files must NOT fail the check.
            expect(
              absentInitial.passed,
              `marker-absent-initial:F${i} (${JSON.stringify(markers[i])}) — exact planted in initial: ${exactInInitial.has(i)}`,
            ).toBe(!exactInInitial.has(i));
          }
        } finally {
          fs.rmSync(distDir, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 },
    );
  },
  60_000,
);
