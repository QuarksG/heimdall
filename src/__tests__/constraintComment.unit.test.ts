// Feature: feature-code-splitting
// Task 5.8 — Constraint-comment content unit test.
// Reads src/App.tsx and src/shared/components/lazy/createLazyRoute.tsx as text
// and asserts the Req 7 SECURITY CONSTRAINT documentation is present, complete,
// and positioned immediately adjacent to the lazy declarations.
// _Requirements: 7.1, 7.2, 7.3, 7.4_

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// vitest runs with cwd at the repo root (where vite.config.ts lives)
const appTsxPath = resolve(process.cwd(), "src/App.tsx");
const createLazyRoutePath = resolve(
  process.cwd(),
  "src/shared/components/lazy/createLazyRoute.tsx",
);

const appSource = readFileSync(appTsxPath, "utf-8");
const factorySource = readFileSync(createLazyRoutePath, "utf-8");

/**
 * Locates the contiguous `//` comment block containing "SECURITY CONSTRAINT".
 * Returns the block's text plus its start/end line indices (0-based), so tests
 * can assert both content and adjacency to the lazy declarations.
 */
function findConstraintBlock(source: string): {
  blockText: string;
  startLine: number;
  endLine: number;
  lines: string[];
} {
  const lines = source.split("\n");
  const markerLine = lines.findIndex((l) => l.includes("SECURITY CONSTRAINT"));
  expect(markerLine, "SECURITY CONSTRAINT comment must exist").toBeGreaterThanOrEqual(0);

  const isCommentLine = (l: string) => l.trim().startsWith("//");

  // Expand upward and downward over consecutive `//` comment lines.
  let start = markerLine;
  while (start > 0 && isCommentLine(lines[start - 1])) start -= 1;
  let end = markerLine;
  while (end < lines.length - 1 && isCommentLine(lines[end + 1])) end += 1;

  return {
    blockText: lines.slice(start, end + 1).join("\n"),
    startLine: start,
    endLine: end,
    lines,
  };
}

/** Requirement 7.1–7.4 content assertions shared by both files. */
function assertConstraintContent(blockText: string) {
  // 7.1 — not an authorization control (delivery hygiene / performance measure)
  expect(blockText).toContain("NOT an authorization control");
  expect(blockText).toMatch(/delivery[- ]hygiene and performance measure/);

  // 7.2 — chunk URLs remain fetchable by any authenticated client
  expect(blockText).toMatch(/remains? fetchable by any authenticated client/);

  // 7.3 — backend authorization remains authoritative
  expect(blockText).toMatch(/[Bb]ackend authorization remains the authoritative/);

  // 7.4 — follow-up spec identified by name so a maintainer can locate it
  expect(blockText).toContain("reconciliation-backend-migration");
}

describe("SECURITY CONSTRAINT comment — src/App.tsx", () => {
  const block = findConstraintBlock(appSource);

  it("contains the four required constraint statements (Req 7.1–7.4)", () => {
    assertConstraintContent(block.blockText);
  });

  it("sits immediately adjacent to the createLazyRoute declarations (Req 7.1)", () => {
    // The first lazy declaration must be the next non-empty line after the
    // comment block ends — the comment is adjacent, not floating elsewhere.
    const after = block.lines.slice(block.endLine + 1);
    const nextNonEmpty = after.find((l) => l.trim() !== "");
    expect(nextNonEmpty, "comment block must be followed by code").toBeDefined();
    expect(nextNonEmpty!).toMatch(/const Lazy\w+ = createLazyRoute\(/);
  });

  it("precedes all seven lazy route declarations", () => {
    const declarationLines = block.lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => /const Lazy\w+ = createLazyRoute\(/.test(l));
    expect(declarationLines).toHaveLength(7);
    for (const { i } of declarationLines) {
      expect(i).toBeGreaterThan(block.endLine);
    }
  });
});

describe("SECURITY CONSTRAINT comment — src/shared/components/lazy/createLazyRoute.tsx", () => {
  const block = findConstraintBlock(factorySource);

  it("contains the four required constraint statements (Req 7.1–7.4)", () => {
    assertConstraintContent(block.blockText);
  });

  it("sits at the top of the file, adjacent to the lazy factory machinery (Req 7.1)", () => {
    // The block must start within the file header (before any code) …
    expect(block.startLine).toBeLessThan(10);
    const codeBefore = block.lines
      .slice(0, block.startLine)
      .filter((l) => l.trim() !== "" && !l.trim().startsWith("//"));
    expect(codeBefore, "no code may precede the constraint comment").toHaveLength(0);

    // … and the file must actually implement the lazy boundary it documents.
    expect(factorySource).toMatch(/export function createLazyRoute/);
    expect(factorySource).toMatch(/\blazy\(/);
  });
});
