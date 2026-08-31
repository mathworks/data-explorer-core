// Copyright 2026 The MathWorks, Inc.
//
// Dictionary-entry metadata columns (Last Modified / Last Modified By). The
// underlying timestamp/author is parsed onto DataNode.metadata under two
// different key schemes depending on the source format (text `.sldd` vs binary
// `.sldd`); the node getters normalize both to a single display string, and
// _stampLastModified refreshes them in place on edit. These are the pure
// data-model rules; the row-builder stamping from real fixtures is covered by
// the extension's integration tests.
import { describe, it, expect } from 'vitest';
import DataNode from '../src/datamodel/node/DataNode.js';
import '../src/datamodel/node/NodeClassMap.js';

describe('DataNode metadata normalization', () => {
  it('normalizes the text-format keys (lastmod / modifiedby)', () => {
    const node = new DataNode('p', null);
    node.metadata = { lastmod: '20260704T015202.247897', modifiedby: 'weiwang', isderived: '0' };
    expect(node.lastModified).toBe('2026-07-04T01:52:02Z');
    expect(node.lastModifiedBy).toBe('weiwang');
  });

  it('normalizes the binary-format keys (lastModifiedDate / lastModifiedBy)', () => {
    const node = new DataNode('p', null);
    node.metadata = {
      lastModifiedDate: '2026-07-04T01:52:02Z',
      lastModifiedBy: 'weiwang',
      _rawLastMod: '20260704T015202.247897',
      isderived: '0',
    };
    expect(node.lastModified).toBe('2026-07-04T01:52:02Z');
    expect(node.lastModifiedBy).toBe('weiwang');
  });

  it('falls back to formatting _rawLastMod when no ISO date is present', () => {
    const node = new DataNode('p', null);
    node.metadata = { _rawLastMod: '20260704T015202.247897' };
    expect(node.lastModified).toBe('2026-07-04T01:52:02Z');
  });

  it('is empty when the node has no metadata', () => {
    const node = new DataNode('p', null);
    expect(node.lastModified).toBe('');
    expect(node.lastModifiedBy).toBe('');
  });

  it('is empty for a metadata blob that carries no timestamp/author', () => {
    const node = new DataNode('p', null);
    node.metadata = { uuid: 'x', namespace: 'y', isderived: '0' };
    expect(node.lastModified).toBe('');
    expect(node.lastModifiedBy).toBe('');
  });

  it('passes through a raw timestamp too short to parse', () => {
    const node = new DataNode('p', null);
    node.metadata = { lastmod: 'bogus' };
    expect(node.lastModified).toBe('bogus');
  });
});

describe('Last Modified is refreshed on edit (_stampLastModified)', () => {
  const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

  it('updates the text-format key (lastmod) in place, leaving author untouched', () => {
    const node = new DataNode('p', null);
    node.metadata = { uuid: 'x', namespace: 'y', lastmod: '20200101T000000.000000', modifiedby: 'weiwang', isderived: '0' };
    node._stampLastModified();
    // The raw timestamp changed and the getter now reports a fresh ISO value.
    expect(node.metadata.lastmod).not.toBe('20200101T000000.000000');
    expect(node.lastModified).toMatch(ISO_RE);
    // Author and the other metadata keys are left as-is; no keys are injected.
    expect(node.lastModifiedBy).toBe('weiwang');
    expect(Object.keys(node.metadata).sort()).toEqual(['isderived', 'lastmod', 'modifiedby', 'namespace', 'uuid']);
  });

  it('updates the binary-format keys (lastModifiedDate + _rawLastMod)', () => {
    const node = new DataNode('p', null);
    node.metadata = {
      lastModifiedDate: '2020-01-01T00:00:00Z',
      lastModifiedBy: 'weiwang',
      _rawLastMod: '20200101T000000.000000',
      isderived: '0',
    };
    node._stampLastModified();
    expect(node.metadata._rawLastMod).not.toBe('20200101T000000.000000');
    expect(node.metadata.lastModifiedDate).toMatch(ISO_RE);
    expect(node.lastModified).toMatch(ISO_RE);
    expect(node.lastModifiedBy).toBe('weiwang');
  });

  it('is a no-op when the node carries no metadata', () => {
    const node = new DataNode('p', null);
    expect(() => node._stampLastModified()).not.toThrow();
    expect(node.metadata).toBeNull();
  });

  it('does not inject a key scheme the entry did not already have', () => {
    // A text-format entry (only `lastmod`) must not gain the binary keys.
    const node = new DataNode('p', null);
    node.metadata = { lastmod: '20200101T000000.000000', modifiedby: '' };
    node._stampLastModified();
    expect('lastModifiedDate' in node.metadata).toBe(false);
    expect('_rawLastMod' in node.metadata).toBe(false);
  });
});
