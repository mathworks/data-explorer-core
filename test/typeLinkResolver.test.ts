// Copyright 2026 The MathWorks, Inc.
//
// The seam a Data Type cell reaches its link through.
//
// A node must not hold a session — this package is consumed by a VS Code extension, a
// CLI and an RPC server, and a node reaching for a session would be reaching for
// whichever of them built it. So registerSource stamps the resolver on the source ROOT,
// the same place and the same way it already stamps `meta`, `warnings` and
// `_usageResolver`, and a node walks up to find one. What that buys, and what is pinned
// here: a tree the session registered HAS a resolver, and a bare subtree no session
// registered simply has none — no undefined-callback crash, no half-wired middle state.
import { describe, it, expect } from 'vitest';
import { createSession } from '../src/index.js';
import SlddNode from '../src/datamodel/node/container/SlddNode.js';

type WithResolver = { _typeLinkResolver?: (typeName: string) => string | null };

describe('registerSource stamps the type-link resolver', () => {
  it('installs a resolver closed over the source it registered', () => {
    const s = createSession();
    const src = s.addDataSource('d.sldd', { __MW_TEXT_PARTS__: {} }) as unknown as WithResolver;
    expect(typeof src._typeLinkResolver).toBe('function');
  });

  it('answers null for a name the source does not define as a type', () => {
    const s = createSession();
    const src = s.addDataSource('d.sldd', { __MW_TEXT_PARTS__: {} }) as unknown as WithResolver;
    expect(src._typeLinkResolver!('double')).toBeNull();
  });

  it('leaves a tree no session registered without one', () => {
    // Not an omission to fill in: a projection with no session behind it has nothing to
    // resolve against, and _typeLinkCell reads the absence rather than calling into it.
    const bare = new SlddNode('bare.sldd', {}) as unknown as WithResolver;
    expect(bare._typeLinkResolver).toBeUndefined();
  });

  it('re-registering the same srcId replaces the resolver with one closed over the NEW tree', () => {
    // A reload (parse -> addDataSource on the same uri) is the ordinary way to hit this.
    // A resolver still closed over the outgoing tree would answer about a tree the
    // session no longer owns — the same failure deindexSource exists to prevent.
    const s = createSession();
    const first = s.addDataSource('d.sldd', { __MW_TEXT_PARTS__: {} }) as unknown as WithResolver;
    const second = s.addDataSource('d.sldd', { __MW_TEXT_PARTS__: {} }) as unknown as WithResolver;
    expect(second._typeLinkResolver).not.toBe(first._typeLinkResolver);
  });
});
