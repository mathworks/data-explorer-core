// test/node-loader.test.ts
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { loadFromPath, loadDirectory } from '../src/node/index.js';

const fixturesDir = fileURLToPath(new URL('./fixtures/', import.meta.url));

describe('node loader', () => {
  it('loadFromPath reads a textual .sldd and adds a source', () => {
    const s = createSession();
    const node = loadFromPath(s, fixturesDir + 'object_array_text.sldd');
    expect(node).toBeTruthy();
    expect(s.getDataSourceCount()).toBe(1);
    expect(node.meta?.path).toContain('object_array_text.sldd');
  });

  it('loadFromPath reads a binary .slx', () => {
    const s = createSession();
    const node = loadFromPath(s, fixturesDir + 'model_with_refs.slx');
    expect(node.flatten().length).toBeGreaterThan(0);
  });

  it('loadDirectory loads all supported files into one session', () => {
    const s = createSession();
    const loaded = loadDirectory(s, fixturesDir);
    expect(loaded.length).toBeGreaterThan(1);
    expect(loaded.length).toBeGreaterThanOrEqual(5); // fixtures dir has several supported files
    expect(s.getDataSourceCount()).toBe(loaded.length);
  });
});
