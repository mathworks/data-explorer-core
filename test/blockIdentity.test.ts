// Copyright 2026 The MathWorks, Inc.
//
// The three rules every layer that shows or links a block goes through: which block
// this is (blockKey), what it reads as (blockLabel) and where it is (joinBlockPath).
// They are separate because Simulink keeps them separate — a SID identifies a block
// within its model and survives a rename, a name is unique within one system and may be
// blank, and only the enclosing systems say which system that was — and they live in one
// module so the node layer, the session's usage engine and the file-summary index
// cannot spell them differently. Where each is applied is pinned by the tests that own
// that layer (modelNode, usedByColumn, usageIndex, resolveLink); this file pins the
// rules themselves, including the fallbacks nothing else exercises directly.
import { describe, it, expect } from 'vitest';
import { blockKey, blockLabel, joinBlockPath } from '../src/datamodel/blockIdentity.js';

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

describe('joinBlockPath — where a block is', () => {
  it('is the label alone for a block in the root system', () => {
    // '' is the root, so a root block's path is what its cell already shows. Nothing is
    // prefixed — not the model name, which MATLAB's getfullname would add and which
    // every row of one model would repeat.
    expect(joinBlockPath('', 'Gain')).toBe('Gain');
  });

  it('names the enclosing system, which is what tells two `Gain` rows apart', () => {
    expect(joinBlockPath('Controller', 'Gain')).toBe('Controller/Gain');
  });

  it('appends one system at a time, so a path grows as the walk descends', () => {
    // The way both parsers build it: each level joins the level above's answer.
    expect(joinBlockPath(joinBlockPath('', 'Controller'), 'Inner')).toBe('Controller/Inner');
    expect(joinBlockPath(joinBlockPath(joinBlockPath('', 'Controller'), 'Inner'), 'Gain')).toBe(
      'Controller/Inner/Gain',
    );
  });

  it("doubles a `/` inside a block's own name, which is Simulink's escape", () => {
    // A block really may be named `a/b`; `getfullname` writes it `a//b`. Escaped, the
    // path can be split back into segments and pasted into MATLAB as it stands.
    expect(joinBlockPath('', 'a/b')).toBe('a//b');
    expect(joinBlockPath('Sub', 'a/b')).toBe('Sub/a//b');
    // Every `/` in the segment, not just the first.
    expect(joinBlockPath('', 'a/b/c')).toBe('a//b//c');
  });

  it('leaves an already-joined parent alone — the escape is applied once, to the segment', () => {
    // `parentPath` arrives escaped because it is an earlier join's result. Escaping it
    // again would double the separator that IS a separator, and `Sub//a////b` names
    // nothing.
    expect(joinBlockPath(joinBlockPath('', 'a/b'), 'Gain')).toBe('a//b/Gain');
  });

  it('takes the LABEL, so a nameless subsystem is still a segment', () => {
    // Composed with blockLabel, never with the raw name: a subsystem whose label the
    // user cleared would otherwise contribute an empty segment, and `/Gain` reads as a
    // block at the root of nothing.
    expect(joinBlockPath('', blockLabel('', '65'))).toBe('<SID: 65>');
    expect(joinBlockPath(joinBlockPath('', blockLabel('', '65')), 'Gain')).toBe('<SID: 65>/Gain');
  });
});

describe('the three together', () => {
  it('answer differently for the same block, which is the point', () => {
    // The pairing every caller relies on: link by the key, show the label, and show the
    // path when the label alone is ambiguous.
    expect(blockKey('', '65')).toBe('65');
    expect(blockLabel('', '65')).toBe('<SID: 65>');
    expect(joinBlockPath('Sub', blockLabel('', '65'))).toBe('Sub/<SID: 65>');
  });

  it('agree only when a named block has no SID', () => {
    expect(blockKey('G1', '')).toBe(blockLabel('G1', ''));
  });

  it('tell two same-named blocks apart in two different ways, for two different readers', () => {
    // A machine needs the key; a person needs the path. The two `Gain` blocks below are
    // one per subsystem, so their names match, their keys do not, and their paths do not.
    expect(blockKey('Gain', '15')).not.toBe(blockKey('Gain', '24'));
    expect(joinBlockPath('Aircraft', blockLabel('Gain', '15'))).not.toBe(
      joinBlockPath('Controller', blockLabel('Gain', '24')),
    );
  });
});
