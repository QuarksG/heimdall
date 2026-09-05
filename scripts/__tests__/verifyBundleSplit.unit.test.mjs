// Feature: feature-code-splitting — verification unit tests
//
// _Requirements: 6.3, 6.7_
//
// 1. Real-config assertions: the shipped defaultConfig carries the exact
//    size budget (Req 6.3) and exactly 7 FeatureMarkers with the designed
//    feature ids.
// 2. CLI fault injection: an injected fault inside the core (malformed
//    .vite/manifest.json → JSON.parse throws; nonexistent dist directory)
//    makes the actual CLI process exit non-zero (Req 6.7). The CLI is
//    spawned as a real child process so the fail-closed exit-code wiring
//    (process.exitCode = 1 first, 0 only on full success) is what's tested.

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultConfig, verifyBundleSplit } from "../verify-bundle-split.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(__dirname, "..", "verify-bundle-split.mjs");

/** Runs the real CLI as a child process against the given dist dir. */
function runCli(distDir) {
  return spawnSync(process.execPath, [CLI_PATH, distDir], {
    encoding: "utf8",
  });
}

/**
 * Builds a minimal dist fixture whose execution reaches the manifest-parse
 * step: index.html with one module script plus the referenced JS file on
 * disk, and a .vite/manifest.json containing malformed JSON.
 */
function buildMalformedManifestFixture(root) {
  const dist = path.join(root, "dist");
  const assets = path.join(dist, "assets");
  fs.mkdirSync(assets, { recursive: true });

  const initialRel = "assets/index-entry.js";
  fs.writeFileSync(
    path.join(dist, initialRel),
    'console.log("shell code only");\n',
  );
  fs.writeFileSync(
    path.join(dist, "index.html"),
    `<!doctype html><html><head><script type="module" src="/${initialRel}"></script></head><body></body></html>`,
  );

  fs.mkdirSync(path.join(dist, ".vite"), { recursive: true });
  // Malformed JSON: JSON.parse in the core throws (Req 6.7).
  fs.writeFileSync(
    path.join(dist, ".vite", "manifest.json"),
    '{ "not valid json": ',
  );

  return dist;
}

describe("verify-bundle-split real config (Req 6.3)", () => {
  it("ships the exact size budget: maxInitialBundleBytes === 1600950", () => {
    expect(defaultConfig.maxInitialBundleBytes).toBe(1600950);
  });

  it("ships exactly 7 markers with the designed feature ids", () => {
    const designedIds = [
      "Recon",
      "InvoiceParsing",
      "InvoiceVerify",
      "InvoiceControl",
      "InvoiceValidateDF",
      "CRTRExtraction",
      "Settings",
    ];

    expect(defaultConfig.markers).toHaveLength(7);
    expect(defaultConfig.markers.map((m) => m.featureId).sort()).toEqual(
      [...designedIds].sort(),
    );

    // Every marker is fully specified: non-empty marker bytes, route path,
    // and manifest key.
    for (const m of defaultConfig.markers) {
      expect(typeof m.marker).toBe("string");
      expect(m.marker.length).toBeGreaterThan(0);
      expect(typeof m.routePath).toBe("string");
      expect(m.routePath.startsWith("/")).toBe(true);
      expect(typeof m.manifestKey).toBe("string");
      expect(m.manifestKey.length).toBeGreaterThan(0);
    }
  });

  it("verifyBundleSplit runs with the real config by default", () => {
    // Sanity: the exported core is callable and fail-closed against a
    // nonexistent directory using the default (real) config.
    const report = verifyBundleSplit(
      path.join(os.tmpdir(), "vbs-unit-does-not-exist"),
    );
    expect(report.passed).toBe(false);
    expect(report.checks.some((c) => c.id === "missing-input:dist")).toBe(
      true,
    );
  });
});

describe("CLI fault injection exits non-zero (Req 6.7)", () => {
  it("malformed .vite/manifest.json crashes the core and the CLI exits non-zero", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vbs-unit-"));
    try {
      const dist = buildMalformedManifestFixture(root);
      const result = runCli(dist);

      expect(result.status).not.toBe(0);
      expect(result.status).not.toBeNull();
      // The fail-closed boundary reports the crash rather than succeeding.
      expect(result.stderr).toContain(
        "crashed before completing all checks",
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("nonexistent dist directory makes the CLI exit non-zero", () => {
    const missingDist = path.join(
      os.tmpdir(),
      `vbs-unit-missing-${process.pid}-${Date.now()}`,
    );
    const result = runCli(missingDist);

    expect(result.status).not.toBe(0);
    expect(result.status).not.toBeNull();
    expect(result.stdout).toContain("missing-input:dist");
    expect(result.stdout).toContain("VERIFICATION FAILED");
  });
});
