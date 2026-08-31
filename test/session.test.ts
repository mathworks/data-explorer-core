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

  it('hasDataSource / getDataSource reflect membership', () => {
    const s = createSession();
    expect(s.hasDataSource('numeric_json.sldd')).toBe(false);
    expect(s.getDataSource('numeric_json.sldd')).toBeNull();
    const src = s.addDataSource('numeric_json.sldd', loadFixture('numeric_json.sldd'));
    expect(s.hasDataSource('numeric_json.sldd')).toBe(true);
    expect(s.getDataSource('numeric_json.sldd')).toBe(src);
  });

  it('removeDataSource for an unknown id is a no-op', () => {
    const s = createSession();
    s.addDataSource('numeric_json.sldd', loadFixture('numeric_json.sldd'));
    let removals = 0;
    s.bus.subscribe('datamodel/source-removed', () => { removals++; });
    s.removeDataSource('not-loaded.sldd');
    expect(removals).toBe(0);
    expect(s.getDataSourceCount()).toBe(1);
  });

  it('records the supplied source metadata', () => {
    const s = createSession();
    const src = s.addDataSource('numeric_json.sldd', loadFixture('numeric_json.sldd'), {
      path: '/work/numeric_json.sldd',
      size: 4096,
    }) as any;
    expect(src.meta.path).toBe('/work/numeric_json.sldd');
    expect(src.meta.size).toBe(4096);
    // Unsupplied fields get defaults rather than undefined.
    expect(src.meta.lastModified).toBeNull();
  });

  it('de-indexes a removed source so findNodeById no longer resolves it', () => {
    const s = createSession();
    const src = s.addDataSource('numeric_json.sldd', loadFixture('numeric_json.sldd')) as any;
    const child = (src.flatten() as Array<{ id: string }>)[0];
    expect(s.findNodeById(child.id)).toBe(child);
    s.removeDataSource('numeric_json.sldd');
    expect(s.findNodeById(child.id)).toBeNull();
  });

  it('removeAll drops every source and its index entries', () => {
    const s = createSession();
    const src = s.addDataSource('numeric_json.sldd', loadFixture('numeric_json.sldd')) as any;
    const child = (src.flatten() as Array<{ id: string }>)[0];
    s.removeAll();
    expect(s.getDataSourceCount()).toBe(0);
    expect(s.findNodeById(child.id)).toBeNull();
  });

  it('findNodeById returns null for an unknown id', () => {
    const s = createSession();
    expect(s.findNodeById('no-such-node')).toBeNull();
  });
});

describe('createSession() — active selection', () => {
  it('setActiveContext sets the context and clears any entry selection', () => {
    const s = createSession();
    const src = s.addDataSource('numeric_json.sldd', loadFixture('numeric_json.sldd')) as any;
    const child = (src.flatten() as Array<any>)[0];
    s.setActiveEntry(child);
    expect(s.getEntryNode()).toBe(child);
    s.setActiveContext(src);
    expect(s.getContextNode()).toBe(src);
    expect(s.getEntryNode()).toBeNull();
    expect(s.getEntryNodes()).toEqual([]);
  });

  it('setActiveEntry accepts a single node, an array, or null', () => {
    const s = createSession();
    const src = s.addDataSource('numeric_json.sldd', loadFixture('numeric_json.sldd')) as any;
    const flat = src.flatten() as Array<any>;
    s.setActiveEntry(flat[0]);
    expect(s.getEntryNodes()).toEqual([flat[0]]);
    s.setActiveEntry(flat.slice(0, 2));
    expect(s.getEntryNodes()).toEqual(flat.slice(0, 2));
    s.setActiveEntry(null);
    expect(s.getEntryNodes()).toEqual([]);
  });

  it('getActiveNode prefers the entry node, falling back to the context', () => {
    const s = createSession();
    const src = s.addDataSource('numeric_json.sldd', loadFixture('numeric_json.sldd')) as any;
    const child = (src.flatten() as Array<any>)[0];
    s.setActive(src, null);
    expect(s.getActiveNode()).toBe(src);
    s.setActive(src, child);
    expect(s.getActiveNode()).toBe(child);
  });

  it('getActiveSlddNode walks up to the owning source', () => {
    const s = createSession();
    const src = s.addDataSource('numeric_json.sldd', loadFixture('numeric_json.sldd')) as any;
    const child = (src.flatten() as Array<any>)[0];
    s.setActiveContext(child);
    expect(s.getActiveSlddNode()).toBe(src);
  });

  it('getActiveSlddNode is null with no context and for the synthetic root', () => {
    const s = createSession();
    expect(s.getActiveSlddNode()).toBeNull();
    s.setActiveContext(s.allNode);
    expect(s.getActiveSlddNode()).toBeNull();
    expect(s.getActiveSourceNode()).toBeNull();
  });

  it('publishes active/changed when the selection moves', () => {
    const s = createSession();
    const src = s.addDataSource('numeric_json.sldd', loadFixture('numeric_json.sldd')) as any;
    let hits = 0;
    s.bus.subscribe('active/changed', () => { hits++; });
    s.setActiveContext(src);
    expect(hits).toBe(1);
    s.setActiveEntry(null);
    expect(hits).toBe(2);
  });
});

describe('createSession() — batching', () => {
  it('suppresses active/changed until the outermost batch ends', () => {
    const s = createSession();
    const src = s.addDataSource('numeric_json.sldd', loadFixture('numeric_json.sldd')) as any;
    let hits = 0;
    s.bus.subscribe('active/changed', () => { hits++; });

    s.beginBatch();
    expect(s.isBatching()).toBe(true);
    s.setActiveContext(src);
    s.setActiveEntry(null);
    expect(hits).toBe(0);
    s.endBatch();
    expect(s.isBatching()).toBe(false);
    expect(hits).toBe(1);
  });

  it('only the outermost endBatch flushes for nested batches', () => {
    const s = createSession();
    const src = s.addDataSource('numeric_json.sldd', loadFixture('numeric_json.sldd')) as any;
    let hits = 0;
    s.bus.subscribe('active/changed', () => { hits++; });

    s.beginBatch();
    s.beginBatch();
    s.setActiveContext(src);
    s.endBatch();
    expect(hits).toBe(0);
    expect(s.isBatching()).toBe(true);
    s.endBatch();
    expect(hits).toBe(1);
  });
});

describe('createSession() — preview node', () => {
  it('sets, reads, and clears the preview node', () => {
    const s = createSession();
    const src = s.addDataSource('numeric_json.sldd', loadFixture('numeric_json.sldd')) as any;
    const child = (src.flatten() as Array<any>)[0];
    let hits = 0;
    s.bus.subscribe('preview/changed', () => { hits++; });

    expect(s.getPreviewNode()).toBeNull();
    s.setPreviewNode(child);
    expect(s.getPreviewNode()).toBe(child);
    expect(hits).toBe(1);

    s.clearPreviewNode();
    expect(s.getPreviewNode()).toBeNull();
    expect(hits).toBe(2);
  });

  it('clearing an already-null preview node does not republish', () => {
    const s = createSession();
    let hits = 0;
    s.bus.subscribe('preview/changed', () => { hits++; });
    s.clearPreviewNode();
    expect(hits).toBe(0);
  });
});

describe('createSession() — selection released with its source', () => {
  it('clears a context node that pointed into the removed source', () => {
    const s = createSession();
    const src = s.addDataSource('numeric_json.sldd', loadFixture('numeric_json.sldd')) as any;
    const child = (src.flatten() as Array<any>)[0];
    s.setActiveContext(child);
    s.removeDataSource('numeric_json.sldd');
    expect(s.getContextNode()).toBeNull();
    // Otherwise the walk-up keeps resolving to the closed document, and edits
    // and undo would be routed at a source the session no longer owns.
    expect(s.getActiveSlddNode()).toBeNull();
    expect(s.getActiveSourceNode()).toBeNull();
  });

  it('clears entry nodes that pointed into the removed source', () => {
    const s = createSession();
    const src = s.addDataSource('numeric_json.sldd', loadFixture('numeric_json.sldd')) as any;
    const flat = src.flatten() as Array<any>;
    s.setActive(src, flat.slice(0, 2));
    s.removeDataSource('numeric_json.sldd');
    expect(s.getEntryNodes()).toEqual([]);
    expect(s.getEntryNode()).toBeNull();
    expect(s.getActiveNode()).toBeNull();
  });

  it('clears a preview node that pointed into the removed source', () => {
    const s = createSession();
    const src = s.addDataSource('numeric_json.sldd', loadFixture('numeric_json.sldd')) as any;
    s.setPreviewNode((src.flatten() as Array<any>)[0]);
    s.removeDataSource('numeric_json.sldd');
    expect(s.getPreviewNode()).toBeNull();
  });

  it('publishes active/changed once when the selection is released', () => {
    const s = createSession();
    const src = s.addDataSource('numeric_json.sldd', loadFixture('numeric_json.sldd')) as any;
    s.setActive(src, (src.flatten() as Array<any>)[0]);
    let hits = 0;
    s.bus.subscribe('active/changed', () => { hits++; });
    s.removeDataSource('numeric_json.sldd');
    expect(hits).toBe(1);
  });

  it('leaves a selection in another source untouched', () => {
    const s = createSession();
    const keep = s.addDataSource('keep.sldd', loadFixture('numeric_json.sldd')) as any;
    s.addDataSource('drop.sldd', loadFixture('numeric_json.sldd'));
    const keepChild = (keep.flatten() as Array<any>)[0];
    s.setActive(keep, keepChild);
    s.setPreviewNode(keepChild);

    let hits = 0;
    s.bus.subscribe('active/changed', () => { hits++; });
    s.removeDataSource('drop.sldd');
    expect(s.getContextNode()).toBe(keep);
    expect(s.getEntryNodes()).toEqual([keepChild]);
    expect(s.getPreviewNode()).toBe(keepChild);
    expect(hits).toBe(0);
  });

  it('removeAll releases the selection and preview', () => {
    const s = createSession();
    const src = s.addDataSource('numeric_json.sldd', loadFixture('numeric_json.sldd')) as any;
    const child = (src.flatten() as Array<any>)[0];
    s.setActive(src, child);
    s.setPreviewNode(child);
    s.removeAll();
    expect(s.getContextNode()).toBeNull();
    expect(s.getEntryNodes()).toEqual([]);
    expect(s.getPreviewNode()).toBeNull();
    expect(s.getActiveSlddNode()).toBeNull();
  });

  it('leaves the synthetic root selected across a removal', () => {
    // The all-node belongs to no source, so closing a file must not deselect it.
    const s = createSession();
    s.addDataSource('numeric_json.sldd', loadFixture('numeric_json.sldd'));
    s.setActiveContext(s.allNode);
    s.removeDataSource('numeric_json.sldd');
    expect(s.getContextNode()).toBe(s.allNode);
  });
});

describe('createSession() — undo wiring', () => {
  it('reports no undo/redo available without an active source', () => {
    const s = createSession();
    expect(s.canUndo()).toBe(false);
    expect(s.canRedo()).toBe(false);
    // Both are no-ops rather than throwing.
    expect(() => s.undo()).not.toThrow();
    expect(() => s.redo()).not.toThrow();
  });
});
