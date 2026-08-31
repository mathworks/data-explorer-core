// Copyright 2026 The MathWorks, Inc.
// Service-level tests driving ONLY the public createSession() factory surface.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';

function loadFixture(name: string): Record<string, unknown> {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('createSession() — isolation', () => {
  it('two sessions do not share data sources', () => {
    const a = createSession();
    const b = createSession();
    a.addDataSource('numeric_json.sldd', loadFixture('numeric_json.sldd'));
    expect(a.getDataSourceCount()).toBe(1);
    expect(b.getDataSourceCount()).toBe(0);
  });

  it('two sessions have independent event buses', () => {
    const a = createSession();
    const b = createSession();
    let aHits = 0;
    let bHits = 0;
    a.bus.subscribe('datamodel/source-added', () => { aHits++; });
    b.bus.subscribe('datamodel/source-added', () => { bHits++; });
    a.addDataSource('numeric_json.sldd', loadFixture('numeric_json.sldd'));
    expect(aHits).toBe(1);
    expect(bHits).toBe(0);
  });
});

describe('createSession() — load + query', () => {
  it('indexes descendant nodes so findNodeById resolves', () => {
    const s = createSession();
    const src = s.addDataSource('numeric_json.sldd', loadFixture('numeric_json.sldd')) as any;
    expect(src).toBeTruthy();
    expect(s.getDataSourceIds()).toContain('numeric_json.sldd');

    // The index is built from flatten(), which yields descendants (not the
    // source root itself). Look up a real indexed child by identity.
    const flat = src.flatten() as Array<{ id: string }>;
    expect(flat.length).toBeGreaterThan(0);
    const child = flat[0];
    expect(s.findNodeById(child.id)).toBe(child);
  });

  it('removeDataSource drops the source from a session', () => {
    const s = createSession();
    s.addDataSource('numeric_json.sldd', loadFixture('numeric_json.sldd'));
    expect(s.getDataSourceCount()).toBe(1);
    s.removeDataSource('numeric_json.sldd');
    expect(s.getDataSourceCount()).toBe(0);
    expect(s.getDataSourceIds()).not.toContain('numeric_json.sldd');
  });
});
