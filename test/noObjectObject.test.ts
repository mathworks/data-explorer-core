// Copyright 2026 The MathWorks, Inc.
//
// `[object Object]` is what JavaScript's String() makes of an object. It is never a
// MATLAB value, and a cell that shows it is a value some reader handed to a formatter
// that could not read it — the way a complex number inside an MCOS object reached the
// screen as `[[object Object]]` in a .mat and a model workspace, while the same object
// in a dictionary showed `3+4i`. So it is a cheap guard with no false positives: open
// every file in the repo the way a host does, and look everywhere a host looks.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flatten, loadBytes } from './parity/loadFile.js';
import { isMatFile, isModelFile, isProjectFile, isSlddFile } from '../src/datamodel/fileKinds.js';

const TEST_ROOT = fileURLToPath(new URL('./', import.meta.url));
const ROOTS = [join(TEST_ROOT, 'fixtures'), join(TEST_ROOT, 'parity', 'artifacts')];
const NEEDLE = '[object Object]';

// Every file under `dir`, recursively, so a fixture directory added later is swept
// without anyone remembering to list it.
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(abs));
    else if (entry.isFile()) out.push(abs);
  }
  return out;
}

const basename = (abs: string) => abs.slice(abs.lastIndexOf('/') + 1);
const shown = (abs: string) => abs.slice(TEST_ROOT.length);
// The four kinds of file that hold MATLAB values. A project holds none — its rows are
// files, folders and labels — and most of the repo's projects are the multi-file layouts,
// which a host opens from their folder rather than through `ingest` on the marker
// (project.parity.test.ts reads them that way).
const opens = (abs: string) => {
  const name = basename(abs);
  return isSlddFile(name) || isModelFile(name) || isMatFile(name);
};

function bytesAt(abs: string): ArrayBuffer {
  const u8 = new Uint8Array(readFileSync(abs));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

// The files the reader refuses rather than reads, and the message each refusal carries
// (parseWarnings.test.ts keeps the same list for the same reason). Asserted, not skipped,
// so a fixture that stops opening is not silently a fixture nobody looks inside.
const REFUSED = new Map<string, string>([['strings_v73.mat', 'MAT-file version 7.3 (HDF5) is not supported']]);

/** Every text a host can show for one node, each with the channel it came from. */
function textsOf(node: any): [channel: string, text: string][] {
  const out: [string, string][] = [];
  out.push(['displayValue', String(node.displayValue)]);
  if (typeof node.toRow === 'function') {
    out.push(['row', JSON.stringify(node.toRow())]);
  }
  if (typeof node.getProperties === 'function') {
    for (const pc of node.getProperties()) {
      const info = node.getPropInfo(pc);
      out.push([`prop ${info.key}`, String(info.displayValue)]);
    }
  }
  if (typeof node.displayElements === 'function') {
    const grid = node.displayElements();
    if (grid) out.push(['grid', JSON.stringify(grid)]);
  }
  return out;
}

describe(`no node in any file in the repo shows ${NEEDLE}`, () => {
  const files = ROOTS.flatMap(filesUnder).filter(opens).sort();

  it('sweeps every kind of file a host opens', () => {
    // Lower bounds, not counts, so adding a fixture never fails them; an empty or
    // mis-filtered list would pass the sweep below vacuously.
    const count = (test: (n: string) => boolean) => files.filter((f) => test(basename(f))).length;
    expect(count(isSlddFile)).toBeGreaterThanOrEqual(30);
    expect(count(isModelFile)).toBeGreaterThanOrEqual(20);
    expect(count(isMatFile)).toBeGreaterThanOrEqual(20);
    expect(files.filter((f) => isProjectFile(basename(f)))).toEqual([]);
    // The files this guard was written for are in it.
    for (const name of ['complex_objects.mat', 'complex_ws.slx', 'complex.sldd', 'complex_binary.sldd']) {
      expect(files.map(basename), name).toContain(name);
    }
  });

  for (const file of files) {
    it(shown(file), () => {
      const refusal = REFUSED.get(basename(file));
      if (refusal) {
        expect(() => loadBytes(bytesAt(file), basename(file))).toThrow(refusal);
        return;
      }
      const nodes = flatten(loadBytes(bytesAt(file), basename(file)));
      expect(nodes.length).toBeGreaterThan(0);
      const hits: string[] = [];
      for (const node of nodes) {
        for (const [channel, text] of textsOf(node)) {
          if (text.includes(NEEDLE)) hits.push(`${node.id} ${channel}: ${text.slice(0, 160)}`);
        }
      }
      expect(hits).toEqual([]);
    });
  }
});
