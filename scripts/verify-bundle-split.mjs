// scripts/verify-bundle-split.mjs
//
// Build_Verification for the feature-code-splitting spec (Requirement 6).
//
// Pure, testable core: `verifyBundleSplit(distDir, config)` inspects a Vite
// production build output directory and returns a VerificationReport proving
// (or disproving) the code-splitting guarantees:
//
//   1. Input presence — distDir and index.html exist (Req 6.6).
//   2. Initial_Bundle identification — module scripts, modulepreload, and
//      preload/prefetch .js links referenced by dist/index.html (Req 6.6).
//   3. Chunk enumeration — every *.js under distDir not in the Initial_Bundle.
//   4. Marker-in-chunk — each Marker_String appears (byte-for-byte) in at
//      least one chunk file outside the Initial_Bundle (Req 1.1, 6.1).
//   5. Marker-absent-from-initial — zero occurrences of each Marker_String
//      across all Initial_Bundle files (Req 1.2, 6.2).
//   6. Manifest mapping — each feature's dynamic-entry source key exists in
//      .vite/manifest.json and its output file is NOT in the Initial_Bundle
//      (Req 1.1, 1.2).
//   7. Size budget — sum of uncompressed on-disk Initial_Bundle bytes is at
//      most config.maxInitialBundleBytes (Req 6.3).
//
// ALL checks are evaluated unconditionally (no short-circuiting); the report
// collects every CheckResult and `report.passed` is true only when every
// check passed (Req 6.4, 6.5).
//
// The fail-closed CLI wrapper (exit-code semantics, Req 6.4–6.7) is a thin
// layer over this core and lives at the bottom of this file.
//
// Node ESM. Dependencies: Node builtins only (node:fs, node:path, plus
// node:url for the run-as-CLI guard).

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * @typedef {Object} FeatureMarker
 * @property {string} featureId   e.g. "Recon"
 * @property {string} routePath   e.g. "/payment-reconciliation" (reporting only)
 * @property {string} marker      exact bytes to match, case-sensitive
 * @property {string} manifestKey dynamic-entry source path in .vite/manifest.json
 *
 * @typedef {Object} VerificationConfig
 * @property {FeatureMarker[]} markers
 * @property {number} maxInitialBundleBytes
 *
 * @typedef {Object} CheckResult
 * @property {string} id      e.g. "marker-absent-initial:Recon"
 * @property {"missing-input"|"marker-in-chunk"|"marker-absent-initial"|"manifest-mapping"|"size-budget"} kind
 * @property {boolean} passed
 * @property {string} detail  feature id + file path / marker / measured bytes vs budget / missing path
 *
 * @typedef {Object} VerificationReport
 * @property {string[]} initialBundleFiles distDir-relative paths resolved from dist/index.html
 * @property {number} initialBundleBytes   uncompressed on-disk sum
 * @property {string[]} chunkFiles          distDir-relative paths
 * @property {CheckResult[]} checks         ALL checks, evaluated unconditionally
 * @property {boolean} passed               checks.every(c => c.passed)
 */

/**
 * Marker_String configuration — single source of truth (design section 5).
 * Each marker is an ASCII string/regex literal verified present in its
 * feature's source tree and expected to survive minification verbatim.
 *
 * @type {VerificationConfig}
 */
export const defaultConfig = {
  markers: [
    {
      featureId: "Recon",
      routePath: "/payment-reconciliation",
      // Synthetic transfer rows in paymentTransformer.ts / fileIntegrityValidator.ts
      marker: "GIDEN HAVALE",
      manifestKey: "src/features/payment-reconciliation/index.ts",
    },
    {
      featureId: "InvoiceParsing",
      routePath: "/invoice-parsing",
      // Search box placeholder in InvoiceParsing.tsx
      marker: "Search records...",
      manifestKey: "src/features/invoice-parsing/components/InvoiceParsing.tsx",
    },
    {
      featureId: "InvoiceVerify",
      routePath: "/invoice-conversion",
      // Dropzone rejection message in InvoiceVerify.tsx
      marker: "File exceeds 100MB limit",
      manifestKey: "src/features/invoice-conversion/components/InvoiceVerify.tsx",
    },
    {
      featureId: "InvoiceControl",
      routePath: "/invoice-validation/retail",
      // Regex literal IQV_IPV_DETECT_REGEX in InvoiceControl.tsx (regex source survives minification)
      marker: "IQV|IPV",
      manifestKey: "src/features/invoice-validation/retail/components/InvoiceControl.tsx",
    },
    {
      featureId: "InvoiceValidateDF",
      routePath: "/invoice-validation/dropship",
      // File-input element id/htmlFor in ChatInterface.tsx (ASCII-safe)
      marker: "dfFileInput",
      manifestKey: "src/features/invoice-validation/dropship/index.ts",
    },
    {
      featureId: "CRTRExtraction",
      routePath: "/crtr-extraction",
      // Export filename in CRTRExtraction.tsx
      marker: "consolidated_report.xlsx",
      manifestKey: "src/features/crtr-extraction/CRTRExtraction.tsx",
    },
    {
      featureId: "Settings",
      routePath: "/settings",
      // Fetch-error banner text in AdminPanel.tsx
      marker: "Failed to load access requests.",
      manifestKey: "src/features/authentication/components/AdminPanel.tsx",
    },
  ],
  // Req 6.3: 20% below the recorded pre-split baseline of 2,001,188 bytes.
  maxInitialBundleBytes: 1_600_950,
};

/** Extracts the value of an attribute from a single HTML tag string. */
function attrValue(tag, name) {
  const m = tag.match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"),
  );
  return m ? (m[1] ?? m[2]) : null;
}

/** Strips query string / hash from a URL. */
function urlPathname(url) {
  return url.split(/[?#]/, 1)[0];
}

/** True when the URL is external (has a scheme or is protocol-relative). */
function isExternalUrl(url) {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//");
}

/**
 * Collects the URLs of every JavaScript asset that dist/index.html causes
 * the browser to fetch up-front: <script type="module" src>,
 * <link rel="modulepreload" href>, and <link rel="preload"|"prefetch"> that
 * point at .js files. Anything index.html fetches up-front is "initial" by
 * definition (design, algorithm step 2).
 *
 * @returns {{ jsUrls: string[], moduleScriptCount: number }}
 */
function collectInitialJsUrls(html) {
  const jsUrls = [];
  let moduleScriptCount = 0;

  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    const type = attrValue(tag, "type");
    if (type !== "module") continue;
    const src = attrValue(tag, "src");
    if (!src) continue;
    moduleScriptCount += 1;
    jsUrls.push(src);
  }

  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attrValue(tag, "rel") ?? "").toLowerCase().split(/\s+/);
    const href = attrValue(tag, "href");
    if (!href) continue;
    if (rel.includes("modulepreload")) {
      jsUrls.push(href);
    } else if (
      (rel.includes("preload") || rel.includes("prefetch")) &&
      urlPathname(href).toLowerCase().endsWith(".js")
    ) {
      jsUrls.push(href);
    }
  }

  // Keep only .js targets, drop externals, dedupe preserving order.
  const seen = new Set();
  const filtered = [];
  for (const url of jsUrls) {
    const pathname = urlPathname(url);
    if (isExternalUrl(url)) continue;
    if (!pathname.toLowerCase().endsWith(".js")) continue;
    if (seen.has(pathname)) continue;
    seen.add(pathname);
    filtered.push(pathname);
  }
  return { jsUrls: filtered, moduleScriptCount };
}

/** Recursively lists every *.js file under dir (absolute paths). */
function listJsFilesRecursive(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listJsFilesRecursive(p));
    } else if (entry.isFile() && p.toLowerCase().endsWith(".js")) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Pure verification core. Inspects `distDir` and returns a full
 * VerificationReport. Never calls process.exit and prints nothing — the CLI
 * wrapper owns exit-code and reporting concerns.
 *
 * Unreadable files and malformed manifest JSON throw; the fail-closed CLI
 * boundary converts any throw into a non-zero exit (Req 6.7).
 *
 * @param {string} distDir
 * @param {VerificationConfig} [config]
 * @returns {VerificationReport}
 */
export function verifyBundleSplit(distDir, config = defaultConfig) {
  /** @type {CheckResult[]} */
  const checks = [];
  const absDist = path.resolve(distDir);
  const rel = (p) => path.relative(absDist, p) || p;

  const finish = (initialBundleFiles, initialBundleBytes, chunkFiles) => ({
    initialBundleFiles,
    initialBundleBytes,
    chunkFiles,
    checks,
    // Fail closed: an empty check list is never a pass (Req 6.6, 6.7).
    passed: checks.length > 0 && checks.every((c) => c.passed),
  });

  // ── Step 1: input presence (Req 6.6) ────────────────────────────────────
  if (!fs.existsSync(absDist) || !fs.statSync(absDist).isDirectory()) {
    checks.push({
      id: "missing-input:dist",
      kind: "missing-input",
      passed: false,
      detail: `build output directory not found: ${absDist}`,
    });
    return finish([], 0, []);
  }

  const indexHtmlPath = path.join(absDist, "index.html");
  if (!fs.existsSync(indexHtmlPath)) {
    checks.push({
      id: "missing-input:index.html",
      kind: "missing-input",
      passed: false,
      detail: `entry HTML not found: ${indexHtmlPath}`,
    });
    return finish([], 0, []);
  }

  // ── Step 2: identify the Initial_Bundle from index.html (Req 6.6) ───────
  const html = fs.readFileSync(indexHtmlPath, "utf8");
  const { jsUrls, moduleScriptCount } = collectInitialJsUrls(html);

  if (moduleScriptCount === 0) {
    checks.push({
      id: "missing-input:entry-scripts",
      kind: "missing-input",
      passed: false,
      detail: `Initial_Bundle cannot be identified: no <script type="module" src> found in ${rel(indexHtmlPath)}`,
    });
  }

  const initialAbs = [];
  for (const url of jsUrls) {
    const filePath = path.resolve(absDist, url.replace(/^\//, ""));
    if (!fs.existsSync(filePath)) {
      checks.push({
        id: `missing-input:${url}`,
        kind: "missing-input",
        passed: false,
        detail: `index.html references ${url} but ${filePath} does not exist`,
      });
      continue;
    }
    initialAbs.push(filePath);
  }
  const initialSet = new Set(initialAbs);

  // ── Step 3: enumerate chunk files ────────────────────────────────────────
  const allJs = listJsFilesRecursive(absDist);
  const chunkAbs = allJs.filter((f) => !initialSet.has(f));

  // Pre-scan file contents once per file for the marker checks.
  const markerBufs = config.markers.map((m) => ({
    ...m,
    buf: Buffer.from(m.marker, "utf8"),
  }));
  const scan = (files) => {
    /** @type {Map<string, string[]>} featureId -> files containing marker */
    const hits = new Map(markerBufs.map((m) => [m.featureId, []]));
    for (const file of files) {
      const content = fs.readFileSync(file); // raw bytes
      for (const m of markerBufs) {
        if (content.includes(m.buf)) hits.get(m.featureId).push(rel(file));
      }
    }
    return hits;
  };
  const chunkHits = scan(chunkAbs);
  const initialHits = scan(initialAbs);

  // ── Step 4: marker-in-chunk checks (Req 1.1, 6.1) ────────────────────────
  for (const m of markerBufs) {
    const found = chunkHits.get(m.featureId);
    checks.push({
      id: `marker-in-chunk:${m.featureId}`,
      kind: "marker-in-chunk",
      passed: found.length > 0,
      detail:
        found.length > 0
          ? `${m.featureId} (${m.routePath}): marker ${JSON.stringify(m.marker)} found in chunk file(s): ${found.join(", ")}`
          : `${m.featureId} (${m.routePath}): marker ${JSON.stringify(m.marker)} not found in any of ${chunkAbs.length} chunk file(s) outside the Initial_Bundle`,
    });
  }

  // ── Step 5: marker-absent-from-initial checks (Req 1.2, 6.2) ────────────
  for (const m of markerBufs) {
    const leaked = initialHits.get(m.featureId);
    checks.push({
      id: `marker-absent-initial:${m.featureId}`,
      kind: "marker-absent-initial",
      passed: leaked.length === 0,
      detail:
        leaked.length === 0
          ? `${m.featureId} (${m.routePath}): marker ${JSON.stringify(m.marker)} absent from all ${initialAbs.length} Initial_Bundle file(s)`
          : `${m.featureId} (${m.routePath}): marker ${JSON.stringify(m.marker)} LEAKED into Initial_Bundle file(s): ${leaked.join(", ")}`,
    });
  }

  // ── Step 6: manifest mapping check (Req 1.1, 1.2) ────────────────────────
  const manifestPath = path.join(absDist, ".vite", "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    checks.push({
      id: "missing-input:manifest",
      kind: "missing-input",
      passed: false,
      detail: `build manifest not found: ${manifestPath} (is build.manifest enabled in vite.config.ts?)`,
    });
  } else {
    // Malformed JSON throws — handled fail-closed at the CLI boundary (Req 6.7).
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    for (const m of config.markers) {
      const entry = manifest[m.manifestKey];
      if (!entry || typeof entry.file !== "string") {
        checks.push({
          id: `manifest-mapping:${m.featureId}`,
          kind: "manifest-mapping",
          passed: false,
          detail: `${m.featureId}: manifest key "${m.manifestKey}" not found in .vite/manifest.json (or has no output file)`,
        });
        continue;
      }
      const outAbs = path.resolve(absDist, entry.file);
      const inInitial = initialSet.has(outAbs);
      checks.push({
        id: `manifest-mapping:${m.featureId}`,
        kind: "manifest-mapping",
        passed: !inInitial,
        detail: inInitial
          ? `${m.featureId}: manifest entry "${m.manifestKey}" outputs ${entry.file}, which IS in the Initial_Bundle`
          : `${m.featureId}: manifest entry "${m.manifestKey}" outputs ${entry.file}, outside the Initial_Bundle`,
      });
    }
  }

  // ── Step 7: size budget check (Req 6.3) ──────────────────────────────────
  const initialBundleBytes = initialAbs.reduce(
    (sum, f) => sum + fs.statSync(f).size,
    0,
  );
  checks.push({
    id: "size-budget",
    kind: "size-budget",
    passed: initialBundleBytes <= config.maxInitialBundleBytes,
    detail: `Initial_Bundle is ${initialBundleBytes} bytes (uncompressed, on disk); budget is ${config.maxInitialBundleBytes} bytes`,
  });

  // ── Step 8: aggregate (Req 6.4, 6.5) ─────────────────────────────────────
  return finish(initialAbs.map(rel), initialBundleBytes, chunkAbs.map(rel));
}

// ─────────────────────────────────────────────────────────────────────────────
// Fail-closed CLI wrapper — Req 6.4, 6.5, 6.6, 6.7
//
// Usage: node scripts/verify-bundle-split.mjs [distDir=dist]
//
// Exit-code semantics: process.exitCode is set to 1 as the FIRST statement of
// the CLI path, before any work. It is changed to 0 ONLY after the report
// exists, every check has been evaluated, and report.passed === true. Crashes,
// interrupts, and thrown errors therefore can never yield a success status.
// ─────────────────────────────────────────────────────────────────────────────

/** Formats one CheckResult as a human-readable pass/fail line (Req 6.4). */
function formatCheck(check) {
  return `  [${check.passed ? "PASS" : "FAIL"}] ${check.id}\n         ${check.detail}`;
}

/** Prints the human-readable verification report (Req 6.4, 6.5). */
function printReport(distDir, report, config) {
  const failed = report.checks.filter((c) => !c.passed);

  console.log(`verify-bundle-split: inspecting ${path.resolve(distDir)}`);
  console.log(
    `Initial_Bundle files (${report.initialBundleFiles.length}): ` +
      (report.initialBundleFiles.join(", ") || "(none identified)"),
  );
  console.log(
    `Chunk files outside the Initial_Bundle: ${report.chunkFiles.length}`,
  );
  console.log("");
  console.log(`Checks (${report.checks.length} evaluated):`);
  for (const check of report.checks) {
    console.log(formatCheck(check));
  }

  // Failures listed prominently, each with its identifying detail (Req 6.4).
  if (failed.length > 0) {
    console.log("");
    console.log(`FAILED CHECKS (${failed.length}):`);
    for (const check of failed) {
      console.log(`  ✖ ${check.id} — ${check.detail}`);
    }
  }

  console.log("");
  console.log(
    `Summary: Initial_Bundle is ${report.initialBundleBytes} bytes ` +
      `(uncompressed, on disk); budget is ${config.maxInitialBundleBytes} bytes.`,
  );
  console.log(
    report.passed
      ? `VERIFICATION PASSED — all ${report.checks.length} checks passed.`
      : `VERIFICATION FAILED — ${failed.length} of ${report.checks.length} check(s) failed.`,
  );
}

/**
 * True only when this module is the process entry point, so importing the
 * module (e.g. from tests) never triggers the CLI. process.argv[1] is
 * compared against import.meta.url both as-resolved and realpath'd, so
 * symlinked invocations still match. When in doubt (no argv[1], unresolvable
 * path), the answer is false: an accidental CLI run in a test process is
 * worse than requiring direct invocation.
 */
function isRunDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  const candidates = [path.resolve(entry)];
  try {
    candidates.push(fs.realpathSync(entry));
  } catch {
    // entry not realpath-able; fall back to the resolved path alone
  }
  return candidates.some((p) => import.meta.url === pathToFileURL(p).href);
}

if (isRunDirectly()) {
  // Fail closed FIRST, before any other work (Req 6.6, 6.7): crashes,
  // interrupts, and thrown errors all leave this non-zero code in place.
  process.exitCode = 1;
  try {
    const distDir = process.argv[2] ?? "dist";
    const report = verifyBundleSplit(distDir, defaultConfig);
    printReport(distDir, report, defaultConfig);
    // Exit 0 ONLY here: the report exists, all checks were evaluated, and
    // every one of them passed. report.passed is false for an empty check
    // list, so "no checks ran" can never succeed (Req 6.5, 6.6).
    if (report.passed === true) {
      process.exitCode = 0;
    }
  } catch (err) {
    // Any thrown error (unreadable file, malformed manifest JSON, …) prints
    // and leaves the non-zero exit code in place (Req 6.7).
    console.error(
      "verify-bundle-split: crashed before completing all checks:",
    );
    console.error(err);
  }
}
