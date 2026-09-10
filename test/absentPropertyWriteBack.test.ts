// Copyright 2026 The MathWorks, Inc.
//
// ONE WRITE-BACK RULE, TWO SAVE PATHS, FOUR CLASSES.
//
// A dictionary entry's property bag is what the FILE held, and MATLAB writes only the
// properties it has something to say about: a `Simulink.ValueType` a user never gave a
// description to has no `Description` key at all. Every node in this cluster therefore
// gates its write-back on the same question — "was this key on disk, or has the user
// since set it?" — spelled `if ('Description' in stored || this.Description)`. Both
// halves matter and they fail in opposite directions:
//
//   * drop the `in stored` half and a property MATLAB DID write, whose value happens to
//     be empty, disappears from the saved file;
//   * drop the `this.X` half and an edit the user just made in the Property Inspector is
//     silently discarded on save — it survives until the file is reopened, which is the
//     worst place to find out;
//   * lose the gate entirely and every save invents keys the file never had, so opening
//     a dictionary and saving it with no edits produces a diff in source control.
//
// The reason this deserves its own file rather than a line in each class's tests is that
// each of these classes spells the rule TWICE. `_getSerializedProperties` is read by
// `_serializeSimulinkObjectXml` on the way into a compressed-binary `.sldd`;
// `serializeValue` builds the override bag for the JSON of an uncompressed-text one. The
// two are independent copies of one decision, so they can drift — and a per-class test
// that asserts a literal about one of them cannot see the drift. `ParameterNode` shows
// the shape that cannot drift: its `serializeValue` calls `_getSerializedProperties`.
// Until the others do the same, the agreement between the pair is the invariant worth
// asserting, and it is asserted here for all of them at once.
//
// One honest caveat about how the rule is reached. The `this.X` half of the gate is only
// reachable by an EDIT for the properties a user can actually edit — Description, Min, Max
// and an alias's BaseType all have editors. `Unit` and a ValueType's `DataType` are declared
// `editor: 'label'`, so `getPropInfo` reports them non-editable in the table and in the
// Property Inspector alike and no user action changes them; their gates are therefore
// exercised here through what the FILE carried, which is the only thing that moves them.
//
// Related: signalNode.test.ts covers the Unit/DocUnits spelling from the JSON side,
// archPresentation.test.ts the ValueType default, minMaxConstraint.test.ts what Min/Max
// accept. This file is about which keys reach the file, and about the two paths agreeing.

import { describe, it, expect } from 'vitest';
import NumericTypeNode from '../src/datamodel/node/data/NumericTypeNode.js';
import AliasTypeNode from '../src/datamodel/node/data/AliasTypeNode.js';
import ValueTypeNode from '../src/datamodel/node/data/ValueTypeNode.js';
import SignalNode from '../src/datamodel/node/data/SignalNode.js';
import type DataNode from '../src/datamodel/node/DataNode.js';
// Registers the class map the nodes' shared machinery dispatches through.
import '../src/datamodel/node/NodeClassMap.js';

function rawVal(className: string, properties: Record<string, unknown>): Record<string, unknown> {
  return {
    _array_class: className,
    _array_type: 'MATLABArray',
    _dimensions: [1, 1],
    _mw_element_type: 'MATLABArray',
    _elements: [{ _properties: properties }],
  };
}

// The two save paths, each reduced to the property bag it puts in the file.
const binaryPath = (node: DataNode) => node._getSerializedProperties();
const textPath = (node: DataNode) => {
  const sv = node.serializeValue() as { _elements: { _properties: Record<string, unknown> }[] };
  return sv._elements[0]._properties;
};
// The text path's bag is written out with JSON.stringify, which drops keys whose value is
// `undefined` — so this is the bag as the FILE would carry it, not as the object holds it.
const textFileBag = (node: DataNode) =>
  JSON.parse(JSON.stringify({ p: textPath(node) })).p as Record<string, unknown>;

type Case = {
  // How a user names the entry's class, since that is what the Class column shows.
  label: string;
  className: string;
  parse: (raw: Record<string, unknown>, name: string) => DataNode;
  // The Property Inspector row, and the key it is stored under on disk.
  prop: string;
  key: string;
  // Something a user would plausibly type into that row.
  typed: string;
};

const CASES: Case[] = [
  {
    label: 'Simulink.NumericType',
    className: 'Simulink.NumericType',
    parse: (raw, name) => NumericTypeNode.parse(raw, name, null),
    prop: 'Description',
    key: 'Description',
    typed: 'fixed-point type for the throttle path',
  },
  {
    label: 'Simulink.AliasType',
    className: 'Simulink.AliasType',
    parse: (raw, name) => AliasTypeNode.parse(raw, name, null),
    prop: 'Description',
    key: 'Description',
    typed: 'engineering units alias',
  },
  {
    label: 'Simulink.ValueType',
    className: 'Simulink.ValueType',
    parse: (raw, name) => ValueTypeNode.parse(raw, name, null),
    prop: 'Description',
    key: 'Description',
    typed: 'speed of the vehicle',
  },
  {
    label: 'Simulink.Signal',
    className: 'Simulink.Signal',
    parse: (raw, name) => SignalNode.parse(raw, name, null),
    prop: 'Description',
    key: 'Description',
    typed: 'commanded torque',
  },
];

describe('a property the file never had', () => {
  it('is not written by either save path while the user leaves it alone', () => {
    // This is the "no edits, no diff" guarantee. A host opens a dictionary and saves it
    // (a backup, a format conversion, an unrelated edit to another entry); an entry the
    // user did not touch must come back out with the keys it went in with. Inventing
    // `Description: ''` here is not merely noise — MATLAB stores an unset Description as
    // an empty 0x0 char, and a written `''` is a different value that shows up as a
    // source-control diff on a file nobody edited.
    for (const c of CASES) {
      const node = c.parse(rawVal(c.className, {}), 'e');
      expect(binaryPath(node), `${c.label} binary`).not.toHaveProperty(c.key);
      expect(textFileBag(node), `${c.label} text`).not.toHaveProperty(c.key);
    }
  });

  it('is written by both save paths once the user types one in', () => {
    // The other direction, and the one a user notices: an edit made in the Property
    // Inspector on an entry whose file had no such key. If the gate only admitted keys
    // that were already on disk, the edit would be accepted by the UI, survive in the
    // open document, and then be gone on reopen.
    for (const c of CASES) {
      const node = c.parse(rawVal(c.className, {}), 'e');
      expect(node.setProperty(c.prop, c.typed), `${c.label} setProperty`).toBe(true);
      expect(binaryPath(node)[c.key], `${c.label} binary`).toBe(c.typed);
      expect(textFileBag(node)[c.key], `${c.label} text`).toBe(c.typed);
    }
  });

  it('is written by both save paths when the file HAD it and the user cleared it', () => {
    // The `in stored` half on its own. An emptied Description must be written as the
    // empty string it now is, because the key is still the file's — silently restoring
    // the old text would make the deletion look like it never happened.
    for (const c of CASES) {
      const node = c.parse(rawVal(c.className, { [c.key]: c.typed }), 'e');
      expect(node.setProperty(c.prop, ''), `${c.label} setProperty`).toBe(true);
      expect(binaryPath(node)[c.key], `${c.label} binary`).toBe('');
      expect(textFileBag(node)[c.key], `${c.label} text`).toBe('');
    }
  });

  it('keeps what the file held when the user changes nothing', () => {
    for (const c of CASES) {
      const node = c.parse(rawVal(c.className, { [c.key]: c.typed }), 'e');
      expect(binaryPath(node)[c.key], `${c.label} binary`).toBe(c.typed);
      expect(textFileBag(node)[c.key], `${c.label} text`).toBe(c.typed);
    }
  });
});

describe('the compressed-binary and uncompressed-text save paths agree', () => {
  // `_getSerializedProperties` and `serializeValue` are two hand-written copies of one
  // rule per class. These assert they name the same keys in each of the three states the
  // gate distinguishes, which is the drift a per-path literal cannot catch.
  it('names exactly the same keys, in all three states, for every class', () => {
    for (const c of CASES) {
      const states: [string, () => DataNode][] = [
        ['file had no such key, untouched', () => c.parse(rawVal(c.className, {}), 'e')],
        [
          'file had no such key, user set it',
          () => {
            const n = c.parse(rawVal(c.className, {}), 'e');
            n.setProperty(c.prop, c.typed);
            return n;
          },
        ],
        [
          'file had the key, user cleared it',
          () => {
            const n = c.parse(rawVal(c.className, { [c.key]: c.typed }), 'e');
            n.setProperty(c.prop, '');
            return n;
          },
        ],
      ];
      for (const [state, make] of states) {
        const node = make();
        expect(Object.keys(binaryPath(node)).sort(), `${c.label} — ${state}`).toEqual(
          Object.keys(textPath(node)).sort(),
        );
      }
    }
  });

  it('carries an AliasType BaseType unconditionally, on both paths', () => {
    // BaseType is the one property in this cluster that is NOT gated: an alias with no
    // base type is not a type at all, so it is written even as the empty string a
    // half-built entry has. Both paths have to agree about that too — a BaseType present
    // in one flavour of the same dictionary and absent in the other is the divergence
    // this file exists to rule out.
    const bare = AliasTypeNode.parse(rawVal('Simulink.AliasType', {}), 'A', null);
    expect(binaryPath(bare)).toHaveProperty('BaseType', '');
    expect(textFileBag(bare)).toHaveProperty('BaseType', '');

    const edited = AliasTypeNode.parse(rawVal('Simulink.AliasType', {}), 'A', null);
    edited.setProperty('BaseType', 'int8');
    expect(binaryPath(edited)).toHaveProperty('BaseType', 'int8');
    expect(textFileBag(edited)).toHaveProperty('BaseType', 'int8');
  });

  it('spells a saved Signal unit key the way the file spelled it, on both paths', () => {
    // `Unit` and `DocUnits` are two spellings of one property and a dictionary may carry
    // either; both show in the Unit column. Both save paths choose the output key by
    // looking at the stored bag, and they must look the same way — a binary save that
    // renamed DocUnits → Unit while the text save kept DocUnits would make saving the
    // same dictionary twice, in its two flavours, produce two different files. Neither
    // path may write BOTH spellings either: MATLAB would then have two units to pick from.
    const modern = SignalNode.parse(rawVal('Simulink.Signal', { DocUnits: 'm/s' }), 'sig', null);
    expect(modern.toRow()!.Unit).toBe('m/s');
    expect(binaryPath(modern)).toEqual({ DocUnits: 'm/s' });
    expect(textFileBag(modern)).toEqual({ DocUnits: 'm/s' });

    const legacy = SignalNode.parse(rawVal('Simulink.Signal', { Unit: 'm/s' }), 'sig', null);
    expect(legacy.toRow()!.Unit).toBe('m/s');
    expect(binaryPath(legacy)).toEqual({ Unit: 'm/s' });
    expect(textFileBag(legacy)).toEqual({ Unit: 'm/s' });

    // A file with no unit at all does not acquire one, under either spelling, on either
    // path — the Unit column stays blank across a save.
    const neither = SignalNode.parse(rawVal('Simulink.Signal', {}), 'sig', null);
    expect(neither.toRow()!.Unit).toBe('');
    expect(binaryPath(neither)).toEqual({});
    expect(textFileBag(neither)).toEqual({});
  });

  it("keeps a ValueType's declared data type on both paths, and invents none when the file omits it", () => {
    // The same gate over a property whose "absent" is a DEFAULT rather than an empty
    // string: MATLAB treats a ValueType with no DataType key as a double, so the column
    // reads `double` for a file that never said so. That default must not be written
    // back — a dictionary saved with no edits would gain a `DataType: "double"` key the
    // file never had, on whichever path wrote it.
    const declared = ValueTypeNode.parse(rawVal('Simulink.ValueType', { DataType: 'uint16' }), 'V', null);
    expect(declared.toRow()!.DataType).toBe('uint16');
    expect(binaryPath(declared)).toEqual({ DataType: 'uint16' });
    expect(textFileBag(declared)).toEqual({ DataType: 'uint16' });

    const implied = ValueTypeNode.parse(rawVal('Simulink.ValueType', {}), 'V', null);
    expect(implied.toRow()!.DataType).toBe('double');
    expect(binaryPath(implied)).toEqual({});
    expect(textFileBag(implied)).toEqual({});
  });
});

describe('a Signal bound the user cleared', () => {
  // Min/Max are the one place the two paths write DIFFERENT bytes for the same state, and
  // the difference is deliberate rather than drift: MATLAB's empty is `[]`, which the
  // binary path writes literally, while the text path drops the key and lets MATLAB
  // supply the same default on load. What must not differ is the ANSWER — a reopened
  // Signal shows no minimum either way — so that is what is asserted, on both.
  const minCell = (node: SignalNode) => (node.toRow()!.Min as { text: string }).text;
  const maxCell = (node: SignalNode) => (node.toRow()!.Max as { text: string }).text;

  it('reads back as no minimum from either flavour of the saved file', () => {
    const node = SignalNode.parse(rawVal('Simulink.Signal', { Min: 5, Max: 9 }), 'sig', null);
    expect(minCell(node)).toBe('5');
    expect(node.setProperty('Min', '')).toBe(true);
    expect(minCell(node)).toBe('');

    // Binary: MATLAB's empty, written out; reopening shows a blank Minimum.
    expect(binaryPath(node).Min).toEqual([]);
    const reopenedBinary = SignalNode.parse(rawVal('Simulink.Signal', binaryPath(node)), 'sig', null);
    expect(minCell(reopenedBinary)).toBe('');

    // Text: the key does not survive JSON.stringify, which is the same statement.
    expect(textFileBag(node)).not.toHaveProperty('Min');
    const reopenedText = SignalNode.parse(rawVal('Simulink.Signal', textFileBag(node)), 'sig', null);
    expect(minCell(reopenedText)).toBe('');

    // The bound the user did NOT clear is untouched by either path.
    expect(binaryPath(node).Max).toBe(9);
    expect(textFileBag(node).Max).toBe(9);

    // And the upper bound behaves as the lower one does. Asserted rather than assumed:
    // Min and Max are two hand-written copies of the rule in each of the two save paths,
    // so "clearing the minimum works" says nothing about the maximum.
    expect(node.setProperty('Max', '')).toBe(true);
    expect(maxCell(node)).toBe('');
    expect(binaryPath(node).Max).toEqual([]);
    expect(textFileBag(node)).not.toHaveProperty('Max');
    expect(maxCell(SignalNode.parse(rawVal('Simulink.Signal', binaryPath(node)), 'sig', null))).toBe('');
  });

  it('does not gain a Min key at all when the file had none and the user set none', () => {
    // The gate's false arm for a numeric property: `undefined` is "no bound", and a
    // Signal that never had one must not acquire `Min: []` on every save.
    const node = SignalNode.parse(rawVal('Simulink.Signal', {}), 'sig', null);
    expect(binaryPath(node)).not.toHaveProperty('Min');
    expect(binaryPath(node)).not.toHaveProperty('Max');
    expect(textFileBag(node)).not.toHaveProperty('Min');
    expect(textFileBag(node)).not.toHaveProperty('Max');
  });

  it('writes a bound the user typed into a Signal the file gave none', () => {
    const node = SignalNode.parse(rawVal('Simulink.Signal', {}), 'sig', null);
    expect(node.setProperty('Min', '-10')).toBe(true);
    expect(node.setProperty('Max', '10')).toBe(true);
    expect(binaryPath(node)).toMatchObject({ Min: -10, Max: 10 });
    expect(textFileBag(node)).toMatchObject({ Min: -10, Max: 10 });
  });
});
