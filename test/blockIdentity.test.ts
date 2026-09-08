// Copyright 2026 The MathWorks, Inc.
//
// The two rules every layer that shows or links a block goes through: which block this
// is (blockKey) and what it reads as (blockLabel). They are separate because Simulink
// keeps them separate — a SID identifies a block within its model and survives a
// rename, a name is unique within one system and may be blank — and they live in one
// module so the node layer, the session's usage engine and the file-summary index
// cannot spell them differently. Where each is applied is pinned by the tests that own
// that layer (modelNode, usedByColumn, usageIndex, resolveLink); this file pins the
// rules themselves, including the fallbacks nothing else exercises directly.
import { describe, it, expect } from 'vitest';
import { blockKey, blockLabel } from '../src/datamodel/blockIdentity.js';

describe('blockKey — which block this is', () => {
  it('is the SID whenever the file records one', () => {
    expect(blockKey('Gain', '15')).toBe('15');
  });

  it('tells two same-named blocks apart, and is what a name could not do', () => {
    // f14.slx's four `Gain` blocks, which a name-keyed model merged into one row.
    expect(blockKey('Gain', '15')).not.toBe(blockKey('Gain', '24'));
  });

  it('ignores a rename, which is the other half of what a SID is for', () => {
    expect(blockKey('Gain', '15')).toBe(blockKey('Vertical gain', '15'));
  });

  it('falls back to the name for a file that records no SID', () => {
    // A classic `.mdl` before R2010b. Those files keep the identity they always had
    // here — merging included, since the bytes offer nothing better.
    expect(blockKey('G1', '')).toBe('G1');
  });

  it('is empty only when the file offers neither', () => {
    expect(blockKey('', '')).toBe('');
  });
});

describe('blockLabel — what a block reads as', () => {
  it('is the name whenever there is one', () => {
    expect(blockLabel('Gain', '15')).toBe('Gain');
  });

  it('stands in with `<SID: 65>` for a name the user cleared', () => {
    // `Name="&#xA;"` in f14.slx — one line break, which normalizes to ''. The block is
    // real and holds a real parameter, so the cell has to name something.
    expect(blockLabel('', '65')).toBe('<SID: 65>');
  });

  it('is empty when there is neither a name nor a SID', () => {
    // Nothing to say. `<SID: >` would be a reference to a SID that does not exist.
    expect(blockLabel('', '')).toBe('');
  });

  it('never shows the SID for a block that has a name', () => {
    // The label is not "name plus id": a table cell reads as the model does, and the
    // SID is carried in the row's key and its link target instead.
    expect(blockLabel('Gain', '15')).not.toContain('15');
  });
});

describe('the two together', () => {
  it('answer differently for the same block, which is the point', () => {
    // The pairing every caller relies on: link by the key, show the label.
    expect(blockKey('', '65')).toBe('65');
    expect(blockLabel('', '65')).toBe('<SID: 65>');
  });

  it('agree only when a named block has no SID', () => {
    expect(blockKey('G1', '')).toBe(blockLabel('G1', ''));
  });
});
