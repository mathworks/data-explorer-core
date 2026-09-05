// test/mcosDegradeWarning.test.ts
// Copyright 2026 The MathWorks, Inc.
//
// When the MCOS bridge cannot build the typed node, it says so. docs/TODO.md item 19,
// first bullet: a loss during NODE CONSTRUCTION, which is downstream of the parse that
// produced the warnings array, so it can only be reported through a sink threaded down to
// it — `ParseWarning` alone does not reach it.
//
// `buildTypedNodeFromMcos` degrades to the opaque variable node when a class's `parse()`
// rejects the decoded value, rather than failing the whole file. That is the right
// behaviour and stays; what was wrong is that the result was INDISTINGUISHABLE from a
// variable the reader simply models that way. The typed view — the property rows the
// class would have expanded into, which is the entire reason the bridge exists — was
// gone with nothing saying so.
//
// WHY parseValue IS MOCKED HERE. The catch fires when a typed class rejects a value the
// decoder successfully recovered, which the code itself calls "unexpectedly". There is by
// construction no fixture that triggers it — if a real file did, that would be a bug in
// that class's parse() rather than a safety net doing its job. So the boundary is what
// gets tested: parseValue throws, therefore a warning lands and the node degrades. The
// mock replaces ONLY parseValue and keeps the real getClass, so `isKnown` still answers
// from the real class map and the code under test takes its real path to the catch.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/datamodel/node/NodeRegistry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/datamodel/node/NodeRegistry.js')>();
  return {
    ...actual,
    parseValue: () => {
      throw new Error('Simulink.Parameter.parse rejected the decoded value');
    },
  };
});

// Side-effect import: registers the class map, so the REAL getClass (kept by the spread
// above) answers truthy for a known class and the code reaches the try/catch.
import '../src/datamodel/node/NodeClassMap.js';
import { buildTypedNodeFromMcos } from '../src/datamodel/node/data/mcosTypedNode.js';
import type { ParseWarning } from '../src/index.js';

const KNOWN = 'Simulink.Parameter';

describe('the MCOS bridge reports a typed view it could not build', () => {
  it('degrades to null AND records the loss when the class rejects the value', () => {
    const warnings: ParseWarning[] = [];
    const node = buildTypedNodeFromMcos(KNOWN, 'Kp', null, { Value: 5 }, null, null, warnings);

    // The degrade itself is unchanged — the caller falls back to an opaque node.
    expect(node).toBeNull();

    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('part-unreadable');
    // `part` is the VARIABLE, which is the piece a host can point a user at. The
    // message names what was lost rather than where it broke, per ParseWarning's header.
    expect(warnings[0].part).toBe('Kp');
    expect(warnings[0].message).toContain('Kp');
    expect(warnings[0].message).toContain(KNOWN);
    expect(warnings[0].message).toContain('opaque');
    // The reason travels as text: a warning crosses a worker boundary by structured
    // clone, and an Error does not survive that in a readable form (see reasonOf).
    expect(warnings[0].message).toContain('rejected the decoded value');
  });

  it('still degrades with no sink passed, because the sink is optional', () => {
    // Every existing caller keeps working. A missing sink must not become a throw —
    // that would turn a recovered degrade into the whole-file failure it exists to avoid.
    expect(() => buildTypedNodeFromMcos(KNOWN, 'Kp', null, { Value: 5 })).not.toThrow();
    expect(buildTypedNodeFromMcos(KNOWN, 'Kp', null, { Value: 5 })).toBeNull();
  });

  it('stays SILENT on the two null paths that are not losses', () => {
    // ParseWarning's header is explicit: a reader that meets the limit of the data has
    // read it correctly and must stay quiet. Warning here would put a count on ordinary
    // files, which teaches a host and its user to ignore the count. These two returns
    // are the reason the warning sits inside the catch and not at the function's exits.
    const warnings: ParseWarning[] = [];

    // No class name at all, and a generic key: not an MCOS object to bridge.
    expect(buildTypedNodeFromMcos('', 'x', null, { a: 1 }, null, null, warnings)).toBeNull();

    // An unknown class the decoder recovered NOTHING for: an empty shell has nothing to
    // show and stays opaque by design, not by failure.
    expect(
      buildTypedNodeFromMcos('Some.Customer.Class', 'y', null, {}, null, null, warnings),
    ).toBeNull();

    expect(warnings).toEqual([]);
  });
});
