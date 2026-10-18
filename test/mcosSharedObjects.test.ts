// Copyright 2026 The MathWorks, Inc.
//
// MATLAB objects that a variable reaches more than once. MATLAB saves a handle once and refers to
// it by id from every place that holds it, so a chain of DagNode handles whose every Kids is
// [cur cur], one handle held twice, is 854 bytes at depth 16 and 1,012 bytes at depth 24
// (fixtures/mcos/shared/make_dag_fixtures.m, MATLAB R2027a). A depth-d file holds d + 1 objects
// and reaches them 2^(d+1) - 1 times.
//
// The decoder laid an object out once per path that reaches it: McosParser.buildProperties
// guarded only the depth and the current path. So the depth-16 file opened as 393,214 rows, in
// about a second and a gigabyte of heap, and the depth-20 one ran a 4 GB heap out, which ends
// the process, and in an editor that process is the extension host. Nothing warned at any depth.
//
// The maintainer's group F ruling of 2026-10-18 (F1-7; theme 1: warn and show what was read,
// never crash) gives each variable a budget. Laying out an object that the variable has already
// laid out counts as a repeat. Past 10,000 repeats an object is shown without its properties, as
// one past the depth cap already is, and one warning names the variable. A graph under the
// budget opens as it did.
//
// The fixtures sit in mcos/shared/ and not in mcos/, because mcos/ is swept for "opens with no
// MCOS warning" (mcosDecodeWarnings.test.ts), and dag16 and dag24 warn by design.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import type { ParseWarning } from '../src/datamodel/parser/ParseWarning.js';
import { MAX_EXPANDED_ELEMENTS } from '../src/datamodel/display/DisplayConvention.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const MCOS = fileURLToPath(new URL('./fixtures/mcos/', import.meta.url));

/** A file under fixtures/mcos/, opened the way a host opens it. */
function open(rel: string): any {
  const buf = readFileSync(MCOS + rel);
  const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return ingest(createSession(), bytes, { filename: rel.split('/').pop()! });
}

/** The warnings attachMcosDecoded files, and no others. */
const mcosWarnings = (root: any): string[] =>
  ((root.warnings ?? []) as ParseWarning[]).filter((w) => /^the MATLAB object "/.test(w.message)).map((w) => w.message);

/** How many rows the tree holds, the file's own row included. */
function rowCount(node: any): number {
  let n = 0;
  const stack = [node];
  while (stack.length > 0) {
    const at = stack.pop();
    n++;
    for (const child of at.children ?? []) stack.push(child);
  }
  return n;
}

const childNamed = (node: any, name: string): any => (node.children ?? []).find((c: any) => c.name === name);

/**
 * Every DagNode the tree shows, the variable itself and each element of a Kids: `laidOut` those
 * shown with their properties (a Tag and a Kids row), `cut` those shown without any. Each level
 * of the chain is one object, so `cutObjects`, the levels a cut row is met at, counts the
 * objects shown without their properties somewhere.
 */
function dagRows(root: any): { laidOut: number; cut: number; other: number; cutObjects: number } {
  const out = { laidOut: 0, cut: 0, other: 0 };
  const cutLevels = new Set<number>();
  const stack: [any, number][] = [[childNamed(root, 'root'), 0]];
  while (stack.length > 0) {
    const [at, level] = stack.pop()!;
    expect(at.displayValue).toBe('<1x1 DagNode>');
    const tag = childNamed(at, 'Tag');
    const kids = childNamed(at, 'Kids');
    if (tag && kids && at.children.length === 2) {
      out.laidOut++;
      if (kids.displayValue === '<1x2 DagNode>') stack.push(...kids.children.map((k: any): [any, number] => [k, level + 1]));
      else expect(kids.displayValue).toBe('[ ]');
    } else if ((at.children ?? []).length === 0) {
      out.cut++;
      cutLevels.add(level);
    } else {
      out.other++;
    }
  }
  return { ...out, cutObjects: cutLevels.size };
}

/** The Tags met going down Kids(1) from the variable: what the first path to each object shows. */
function firstPathTags(root: any): string[] {
  const tags: string[] = [];
  for (let at = childNamed(root, 'root'); at; ) {
    tags.push(childNamed(at, 'Tag')?.displayValue);
    const kids = childNamed(at, 'Kids');
    at = kids && kids.displayValue === '<1x2 DagNode>' ? childNamed(kids, '1') : undefined;
  }
  return tags;
}

// Each DagNode shown with its properties is three rows (its own, Tag and Kids), and each one cut
// is one: so a file is 1 + 3 * laidOut + cut rows. A depth-d chain laid out in full is
// 2^(d+1) - 1 objects, of which d + 1 are distinct and the rest are repeats.
// The budget is the node layer's row cap, which McosParser restates.
const BUDGET = MAX_EXPANDED_ELEMENTS;
const message = (objects: number) =>
  `the MATLAB object "root" was decoded in part: ${objects} of its objects are reached more than once, and past ${BUDGET} repeats they are shown without their properties.`;

describe('a handle graph past the budget: what was read, and a warning', () => {
  it('dag16.mat: 10,000 repeats laid out, the rest cut, and one warning naming the variable', () => {
    const root = open('shared/dag16.mat');
    const rows = rowCount(root);
    const dag = dagRows(root);
    // 17 distinct objects, each laid out the first time it is met, and 10,000 repeats after them.
    expect(dag.laidOut, `${rows} rows`).toBe(17 + BUDGET);
    expect(dag.other).toBe(0);
    expect(dag.cut).toBeGreaterThan(0);
    expect(rows).toBe(1 + 3 * dag.laidOut + dag.cut);
    // 393,214 rows before the budget.
    expect(rows).toBeLessThanOrEqual(31000);
    // The warning counts the objects shown without their properties.
    expect(mcosWarnings(root)).toEqual([message(dag.cutObjects)]);
    expect(root.warnings.filter((w: ParseWarning) => w.message === message(dag.cutObjects)).map((w: ParseWarning) => w.code)).toEqual([
      'part-unreadable',
    ]);
  });

  it('dag24.mat opens in under 2 s and 512 MB, with the same budget and the same warning', () => {
    const before = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    const root = open('shared/dag24.mat');
    const ms = performance.now() - t0;
    const grown = process.memoryUsage().heapUsed - before;
    // Before the budget this ran the heap out: 2^25 - 1 objects laid out.
    expect(ms).toBeLessThan(2000);
    expect(grown).toBeLessThan(512 * 2 ** 20);
    const dag = dagRows(root);
    expect(dag.laidOut).toBe(25 + BUDGET);
    expect(dag.other).toBe(0);
    expect(rowCount(root)).toBe(1 + 3 * dag.laidOut + dag.cut);
    expect(rowCount(root)).toBeLessThanOrEqual(31000);
    expect(mcosWarnings(root)).toEqual([message(dag.cutObjects)]);
    expect(firstPathTags(root)).toEqual([...Array.from({ length: 24 }, (_, i) => String(24 - i)), '-1']);
  });
});

describe('controls: what the budget does not change', () => {
  // True before the budget too: the budget cuts a repeat, never an object's first meeting.
  it('dag16.mat: every object is shown in full the first time it is met', () => {
    const root = open('shared/dag16.mat');
    expect(firstPathTags(root)).toEqual([...Array.from({ length: 16 }, (_, i) => String(16 - i)), '-1']);
  });

  it('dag4.mat: every path laid out, 94 rows, a Kids row at each level, no warning', () => {
    const root = open('shared/dag4.mat');
    expect(rowCount(root)).toBe(94);
    expect(dagRows(root)).toEqual({ laidOut: 31, cut: 0, other: 0, cutObjects: 0 });
    // Level k holds 2^k DagNodes, every one with Tag 4 - k (the leaves -1) and a Kids row.
    let level = [childNamed(root, 'root')];
    for (let k = 0; k <= 4; k++) {
      expect(level).toHaveLength(2 ** k);
      for (const at of level) {
        expect(childNamed(at, 'Tag').displayValue).toBe(k === 4 ? '-1' : String(4 - k));
        expect(childNamed(at, 'Kids').displayValue).toBe(k === 4 ? '[ ]' : '<1x2 DagNode>');
      }
      level = level.flatMap((at) => (k === 4 ? [] : childNamed(at, 'Kids').children));
    }
    expect(mcosWarnings(root)).toEqual([]);
  });

  it('dag12.mat, the deepest chain under the budget (8,178 repeats): laid out in full, no warning', () => {
    const root = open('shared/dag12.mat');
    expect(dagRows(root)).toEqual({ laidOut: 2 ** 13 - 1, cut: 0, other: 0, cutObjects: 0 });
    expect(rowCount(root)).toBe(24574);
    expect(mcosWarnings(root)).toEqual([]);
  });

  // Row counts measured on the tree before the budget.
  it.each([
    ['nested_objects.mat', 93],
    ['nested_ws.slx', 12],
  ])('%s: the same %i rows, and no warning', (file, rows) => {
    const root = open(file);
    expect(rowCount(root)).toBe(rows);
    expect(mcosWarnings(root)).toEqual([]);
  });
});
