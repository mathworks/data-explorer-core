// Copyright 2026 The MathWorks, Inc.
//
// The edit-bash parity fixtures (fixtures/edit-bash/make_edit_bash.m): one set of values, leaves
// of every class and containers and objects nesting them, as MATLAB wrote them to R2027a and
// R2023b MAT-files and to a text and a binary dictionary. Each file opens with no warning, holds
// exactly the values manifest.json says it holds, each of the class MATLAB gave it, and every
// node of it renders a row.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession, ingest } from '../src/index.js';
import '../src/datamodel/node/data/NodeClassMap.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const DIR = fileURLToPath(new URL('./fixtures/edit-bash/', import.meta.url));
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
const variables: [string, any][] = Object.entries(manifest.variables);

function opened(path: string): any {
  const u8 = new Uint8Array(readFileSync(join(DIR, path)));
  return ingest(createSession(), u8, { filename: path.split('/').pop()! });
}

/** A MAT-file's variables, or the entries of every section of a dictionary. */
const valuesOf = (root: any, path: string): any[] =>
  path.endsWith('.mat') ? root.children : root.children.flatMap((section: any) => section.children);

/** Where a node is, by the names of the nodes above it. */
function pathOf(node: any, root: any): string {
  const names: string[] = [];
  for (let n = node; n && n !== root; n = n.parent) names.unshift(n.name);
  return names.join(' > ');
}

describe('the edit-bash parity fixtures', () => {
  it('are the files make_edit_bash.m writes, and no release has a value the other lacks', () => {
    const formats = ['mat', 'mat-handles', 'binary'];
    const releases = ['r2027a', 'r2023b'];
    const expected = [...releases.flatMap((r) => formats.map((f) => `${r}-${f}`)), 'r2027a-text'];
    expect(Object.keys(manifest.files).sort()).toEqual(expected.sort());
    expect(Object.keys(manifest.notWritten)).toEqual(['r2023b-text']);
    for (const [name, v] of variables) {
      expect(v.in.filter((k: string) => k.startsWith('r2027a-mat')), name).toHaveLength(1);
      for (const f of formats) expect(v.in.includes(`r2027a-${f}`), `${name} ${f}`).toBe(v.in.includes(`r2023b-${f}`));
    }
  });

  describe.each(Object.entries(manifest.files) as [string, any][])('%s', (key, file) => {
    it('holds exactly the values the manifest lists for it, each of the class MATLAB gave it', () => {
      const root = opened(file.path);
      expect(root.warnings ?? []).toEqual([]);
      const byName = new Map(valuesOf(root, file.path).map((n) => [n.name, n]));
      const held = variables.filter(([, v]) => v.in.includes(key));
      expect([...byName.keys()].sort()).toEqual(held.map(([name]) => name).sort());
      for (const [name, v] of held) expect(byName.get(name).className, name).toBe(v.class);
    });

    it('renders a row for every node', () => {
      const root = opened(file.path);
      const nodes = root.flatten();
      const threw: string[] = [];
      for (const n of nodes) {
        try {
          n.toRow();
        } catch (e) {
          threw.push(`${pathOf(n, root)}: ${(e as Error).message}`);
        }
      }
      expect(threw).toEqual([]);
      expect(nodes.length).toBeGreaterThan(valuesOf(root, file.path).length);
    });
  });
});
