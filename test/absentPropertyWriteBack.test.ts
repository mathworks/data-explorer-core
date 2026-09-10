// Copyright 2026 The MathWorks, Inc.
//
// ONE WRITE-BACK RULE, TWO SAVE PATHS, ELEVEN CLASSES.
//
// The eleven, so the count above can be checked rather than trusted: NumericType,
// AliasType, ValueType, Signal, Breakpoint, LookupTable and the registered CustomObject
// are the `CASES` table below; Parameter, BusElement, ConfigSet and ConfigSetRef have
// their own blocks, because a bound and an ungated key are not the table's shape. A bus
// is not counted separately — it appears only as the thing a BusElement is saved inside.
//
// A dictionary entry's property bag is what the FILE held, and MATLAB writes only the
// properties it has something to say about: a `Simulink.ValueType` a user never gave a
// description to has no `Description` key at all.
//
// That premise is measured, in BOTH formats, which is what makes it safe to build on.
// R2027a, on dictionaries MATLAB wrote itself: a `Simulink.Parameter` given no bound has no
// `Min` TAG at all — see `test/fixtures/object_array_binary.sldd`, whose Parameter elements
// carry only `Value` and `Description`. So "absent" is a state the binary format really has,
// not a text-only convention with binary always emitting every key. A bound explicitly
// assigned `[]`, by contrast, IS written. Presence-in-the-file therefore distinguishes
// "never set" from "set to empty" in both flavours, and keying on presence rather than on
// truthiness is what preserves that distinction.
//
// Most nodes in this cluster therefore gate their write-back on the same question — "was
// this key on disk, or has the user since set it?" — spelled
// `if ('Description' in stored || this.Description)`. Both halves matter and they fail in
// opposite directions:
//
//   * drop the `in stored` half and a property MATLAB DID write, whose value happens to
//     be empty, disappears from the saved file;
//   * drop the `this.X` half and an edit the user just made in the Property Inspector is
//     silently discarded on save — it survives until the file is reopened, which is the
//     worst place to find out;
//   * lose the gate entirely and every save invents keys the file never had, so opening
//     a dictionary and saving it with no edits produces a diff in source control.
//
// Three keys here are deliberately NOT gated, and they are in this file because the
// invariant asserted is the same one: an alias's BaseType, a ConfigSet's Name and a
// ConfigSetRef's SourceName identify the entry rather than describe it, so MATLAB gets
// them even when the value is the empty string a half-built entry carries. The two paths
// still have to agree, and for these three what they must agree ON is that the key is
// unconditional — one path gating what the other writes always is the same divergence
// wearing different clothes.
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
// The other edge of that shape, recorded here because it is the one thing this file
// cannot claim for a Parameter or a bus element: ONE shared method cannot express a
// legitimate per-format difference. A cleared numeric bound is such a difference —
// MATLAB spells an empty Min in a binary dictionary as `<P Name="Min" Class="double"
// Dimension="0*0"/>` (an empty `[]`) and in a text one by OMITTING the key. `SignalNode`,
// whose two paths are separate, writes each format's own spelling. `ParameterNode` and
// `BusElementNode` write `[]` on BOTH paths, so their text flavour carries `"Min": []`
// where MATLAB would carry nothing. That is a correct value spelled differently, and
// MATLAB reads it back as the same absent bound — so what is asserted below is the
// ANSWER a reopened file gives, plus the exact binary spelling. The `[]` in the text
// bag is pinned as what we do write, NOT as byte parity with MATLAB. `undefined` is not
// the way out: the two paths share the bag, and `undefined` reaches the binary writer as
// `Class="char"` — an empty char where a double belongs — which is why the XML spelling
// is asserted too.
//
// "MATLAB reads it back as the same absent bound" is measured, not assumed: R2027a reads a
// text dictionary's `"Min": []` as `class double`, `size [0 0]`, `isempty 1`, and `isequal`
// to an entry whose key was omitted returns 1. Worth knowing alongside that: MATLAB does
// NOT normalize our spelling away. It re-serializes only the entries it actually modified,
// so editing a neighbouring entry leaves `"Min": []` byte-identical on disk and an entry the
// user never touches again keeps it indefinitely. The difference is durable, which is why it
// is recorded as a known divergence rather than treated as something that resolves itself.
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
import ParameterNode from '../src/datamodel/node/data/ParameterNode.js';
import BreakpointNode from '../src/datamodel/node/data/BreakpointNode.js';
import LookupTableNode from '../src/datamodel/node/data/LookupTableNode.js';
import CustomObjectNode from '../src/datamodel/node/data/CustomObjectNode.js';
import ConfigSetNode from '../src/datamodel/node/data/ConfigSetNode.js';
import ConfigSetRefNode from '../src/datamodel/node/data/ConfigSetRefNode.js';
import { BusNode } from '../src/datamodel/node/data/BusNode.js';
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

// The elements wrapper a bus carries its elements in, built the way
// archPresentation.test.ts builds it. A bus element has no save path of its own — it
// reaches a file only inside its parent's `Elements_internal` — so the element bag is
// pulled back out of whichever of the BUS's two bags is under test.
function elementsInternal(elementClass: string, elems: Record<string, unknown>[]): Record<string, unknown> {
  return {
    _array_class: elementClass,
    _dimensions: [elems.length, 1],
    _mw_element_type: 'MATLABArray',
    _elements: elems.map((p) => ({ _properties: p })),
  };
}
const firstElementBag = (busBag: Record<string, unknown>) =>
  (busBag.Elements_internal as { _elements: { _properties: Record<string, unknown> }[] })._elements[0]._properties;

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
  // The three classes below hold nothing but a Description, so today their two save
  // paths are character-for-character the same gate. That identity is not a property of
  // the code, though — it is still two hand-written copies — so the next person who
  // teaches one of these classes a second property, or hoists one of its paths onto a
  // shared helper, can change one method and leave the other behind with nothing
  // objecting. Being trivially correct today is the reason to pin them here, not a
  // reason to leave them out.
  {
    label: 'Simulink.Breakpoint',
    className: 'Simulink.Breakpoint',
    parse: (raw, name) => BreakpointNode.parse(raw, name, null),
    prop: 'Description',
    key: 'Description',
    typed: 'engine speed breakpoints, 0:500:6000 rpm',
  },
  {
    label: 'Simulink.LookupTable',
    className: 'Simulink.LookupTable',
    parse: (raw, name) => LookupTableNode.parse(raw, name, null),
    prop: 'Description',
    key: 'Description',
    typed: 'engine torque vs. speed and throttle',
  },
  {
    // Not a Simulink class name: `CustomObject` is the literal `_array_class` this
    // package registers a node for, and the Class column shows it verbatim.
    label: 'CustomObject',
    className: 'CustomObject',
    parse: (raw, name) => CustomObjectNode.parse(raw, name, null),
    prop: 'Description',
    key: 'Description',
    typed: 'legacy calibration object, kept for the report generator',
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

  it('carries a ConfigSet Name and a ConfigSetRef SourceName unconditionally, on both paths', () => {
    // The other two ungated keys in this cluster, asserted the same way as BaseType and
    // for the same reason: an unconditional write is still written twice, so the two
    // copies can still lose each other. A config set MATLAB can load has to be able to
    // say what it is called and a reference has to say what it points at, so neither key
    // waits for the file to have carried it — and what a bare bag proves is exactly that,
    // since a gated key would be missing here.
    const cfg = ConfigSetNode.parse(rawVal('Simulink.ConfigSet', {}), 'Cfg', null);
    expect(binaryPath(cfg)).toHaveProperty('Name', 'Cfg');
    expect(textFileBag(cfg)).toHaveProperty('Name', 'Cfg');

    // A ConfigSet's Name is the entry name rather than a field of its own, which is the
    // whole point of writing it unconditionally: rename the entry and BOTH saved bags
    // have to name the new one. When ConfigName was stored separately the binary and
    // text bags agreed with each other and disagreed with the tree, and the config set
    // came back under its old name on reopen.
    expect(cfg.setProperty('Name', 'FasterCfg')).toBe(true);
    expect(binaryPath(cfg)).toHaveProperty('Name', 'FasterCfg');
    expect(textFileBag(cfg)).toHaveProperty('Name', 'FasterCfg');

    const ref = ConfigSetRefNode.parse(rawVal('Simulink.ConfigSetRef', {}), 'R', null);
    expect(binaryPath(ref)).toHaveProperty('SourceName', '');
    expect(textFileBag(ref)).toHaveProperty('SourceName', '');

    const pointed = ConfigSetRefNode.parse(rawVal('Simulink.ConfigSetRef', { SourceName: 'shared' }), 'R', null);
    expect(binaryPath(pointed)).toHaveProperty('SourceName', 'shared');
    expect(textFileBag(pointed)).toHaveProperty('SourceName', 'shared');
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

describe('a Parameter bound the user cleared', () => {
  // The same rule as the Signal above, in a different hand-written copy. A Parameter's
  // two paths are the SHARED shape (`serializeValue` calls `_getSerializedProperties`),
  // so both write MATLAB's binary spelling `[]`; see the note in this file's header for
  // why the text flavour's `"Min": []` is the right answer spelled our way rather than
  // MATLAB's omitted key.
  const param = (props: Record<string, unknown>) =>
    ParameterNode.parse(rawVal('Simulink.Parameter', props), 'p', null);
  const minCell = (node: DataNode) => (node.toRow()!.Min as { text: string }).text;
  const maxCell = (node: DataNode) => (node.toRow()!.Max as { text: string }).text;

  it('reads back as no minimum from either flavour of the saved file', () => {
    // What a user does: a Parameter whose dictionary gives it Min 5, and they empty the
    // Minimum box. Before this was fixed, the node's own row went blank and the SAVED
    // file still said 5 — so the bound came back on reopen and the edit was gone with no
    // error anywhere. The reopen is asserted, not just the bag, because "what the file
    // holds" only matters through what it shows when read again.
    const node = param({ Min: 5, Max: 9 });
    expect(minCell(node)).toBe('5');
    expect(node.setProperty('Min', '')).toBe(true);
    expect(minCell(node)).toBe('');

    // Binary: MATLAB's own empty, written out.
    expect(binaryPath(node).Min).toEqual([]);
    expect(minCell(param(binaryPath(node)))).toBe('');

    // Text: `[]` survives JSON.stringify where MATLAB would have omitted the key. Both
    // are read back as "no bound" (_normalizeMinMax maps an empty array to undefined),
    // which is the statement that matters to the user.
    expect(textFileBag(node).Min).toEqual([]);
    expect(minCell(param(textFileBag(node)))).toBe('');

    // The bound the user did NOT clear is untouched by either path.
    expect(binaryPath(node).Max).toBe(9);
    expect(textFileBag(node).Max).toBe(9);

    // And the upper bound behaves as the lower one does — asserted rather than assumed,
    // for the reason the Signal case gives: Min and Max are separate copies of the rule.
    expect(node.setProperty('Max', '')).toBe(true);
    expect(maxCell(node)).toBe('');
    expect(binaryPath(node).Max).toEqual([]);
    expect(textFileBag(node).Max).toEqual([]);
    expect(maxCell(param(binaryPath(node)))).toBe('');
    expect(maxCell(param(textFileBag(node)))).toBe('');
  });

  it('spells a cleared bound in the binary XML as the empty double, not an empty char', () => {
    // The assertion that rules out the tempting "simplification" to `undefined`. This is
    // the one place the bytes are visible: `undefined` reaches the XML writer as
    // `<P Name="Min" Class="char"/>` — an empty CHAR where MATLAB writes an empty
    // DOUBLE — and a stale fallback reaches it as the old number, still 5.0.
    const node = param({ Min: 5, Max: 9 });
    expect(node.setProperty('Min', '')).toBe(true);
    expect(node.setProperty('Max', '')).toBe(true);
    const xml = node.serializeXml('P', { Name: 'Value' }, 0);
    expect(xml).toContain('<P Name="Min" Class="double" Dimension="0*0"/>');
    expect(xml).toContain('<P Name="Max" Class="double" Dimension="0*0"/>');
    expect(xml).not.toContain('Name="Min" Class="char"');
    expect(xml).not.toContain('Name="Max" Class="char"');
  });

  it('does not gain a Min key at all when the file had none and the user set none', () => {
    const node = param({});
    expect(binaryPath(node)).not.toHaveProperty('Min');
    expect(binaryPath(node)).not.toHaveProperty('Max');
    expect(textFileBag(node)).not.toHaveProperty('Min');
    expect(textFileBag(node)).not.toHaveProperty('Max');
  });

  it('writes a bound the user typed into a Parameter the file gave none', () => {
    const node = param({});
    expect(node.setProperty('Min', '-10')).toBe(true);
    expect(node.setProperty('Max', '10')).toBe(true);
    expect(binaryPath(node)).toMatchObject({ Min: -10, Max: 10 });
    expect(textFileBag(node)).toMatchObject({ Min: -10, Max: 10 });
  });
});

describe('a BusElement bound the user cleared', () => {
  // The third copy of the rule, reached the way a file reaches it: an element serializes
  // only as part of its bus, under the `Min_internal`/`Max_internal` spelling a bus
  // element's bag uses, so every assertion here goes through the BUS's two save paths
  // rather than through `_applyElementOverrides` directly.
  const busWith = (elemProps: Record<string, unknown>) =>
    BusNode.parse(
      rawVal('Simulink.Bus', { Elements_internal: elementsInternal('Simulink.BusElement', [elemProps]) }),
      'B',
      null,
    );
  const element = (bus: DataNode) => bus.children[0] as DataNode;
  const minCell = (node: DataNode) => (node.toRow()!.Min as { text: string }).text;
  const maxCell = (node: DataNode) => (node.toRow()!.Max as { text: string }).text;
  // The element bag as each of the bus's paths puts it in the file.
  const binaryElement = (bus: DataNode) => firstElementBag(binaryPath(bus));
  const textFileElement = (bus: DataNode) => firstElementBag(textFileBag(bus));

  it('reads back as no minimum from either flavour of the saved file', () => {
    const bus = busWith({ Name: 'a', Min_internal: 5, Max_internal: 9 });
    const el = element(bus);
    expect(minCell(el)).toBe('5');
    expect(el.setProperty('Min', '')).toBe(true);
    expect(minCell(el)).toBe('');

    // Written under the key the file used, as MATLAB's empty double — and NOT under the
    // un-aliased `Min`, which would leave the element with two minima to choose from.
    expect(binaryElement(bus).Min_internal).toEqual([]);
    expect(binaryElement(bus)).not.toHaveProperty('Min');
    expect(textFileElement(bus).Min_internal).toEqual([]);
    expect(textFileElement(bus)).not.toHaveProperty('Min');

    // Reopened from either saved bag, the element shows no minimum.
    expect(minCell(element(busWith(binaryElement(bus))))).toBe('');
    expect(minCell(element(busWith(textFileElement(bus))))).toBe('');

    // The bound the user did NOT clear is untouched by either path.
    expect(binaryElement(bus).Max_internal).toBe(9);
    expect(textFileElement(bus).Max_internal).toBe(9);

    // Max separately — a separate copy of the rule again.
    expect(el.setProperty('Max', '')).toBe(true);
    expect(maxCell(el)).toBe('');
    expect(binaryElement(bus).Max_internal).toEqual([]);
    expect(textFileElement(bus).Max_internal).toEqual([]);
    expect(maxCell(element(busWith(binaryElement(bus))))).toBe('');
    expect(maxCell(element(busWith(textFileElement(bus))))).toBe('');
  });

  it('spells a cleared bound in the binary XML as the empty double, not an empty char', () => {
    const bus = busWith({ Name: 'a', Min_internal: 5, Max_internal: 9 });
    expect(element(bus).setProperty('Min', '')).toBe(true);
    expect(element(bus).setProperty('Max', '')).toBe(true);
    const xml = bus.serializeXml('P', { Name: 'Value' }, 0);
    expect(xml).toContain('<P Name="Min_internal" Class="double" Dimension="0*0"/>');
    expect(xml).toContain('<P Name="Max_internal" Class="double" Dimension="0*0"/>');
    expect(xml).not.toContain('Name="Min_internal" Class="char"');
    expect(xml).not.toContain('Name="Max_internal" Class="char"');
  });

  it('keeps a bound the file spelled without the alias under that same plain key', () => {
    // A bag carrying plain `Min`/`Max` is read the same way, and a clear must go back
    // under the spelling the file used — inventing the `_internal` alias here would
    // leave the old plain key beside it, unchanged, and MATLAB reading the old bound.
    const bus = busWith({ Name: 'a', Min: 5, Max: 9 });
    expect(element(bus).setProperty('Min', '')).toBe(true);
    expect(binaryElement(bus).Min).toEqual([]);
    expect(binaryElement(bus)).not.toHaveProperty('Min_internal');
    expect(textFileElement(bus).Min).toEqual([]);
    expect(minCell(element(busWith(binaryElement(bus))))).toBe('');
  });

  it('does not gain a Min key at all when the file had none and the user set none', () => {
    const bus = busWith({ Name: 'a' });
    expect(binaryElement(bus)).not.toHaveProperty('Min');
    expect(binaryElement(bus)).not.toHaveProperty('Min_internal');
    expect(binaryElement(bus)).not.toHaveProperty('Max');
    expect(binaryElement(bus)).not.toHaveProperty('Max_internal');
    expect(textFileElement(bus)).not.toHaveProperty('Min');
    expect(textFileElement(bus)).not.toHaveProperty('Min_internal');
    expect(textFileElement(bus)).not.toHaveProperty('Max');
    expect(textFileElement(bus)).not.toHaveProperty('Max_internal');
  });

  it('writes a bound the user typed into an element the file gave none', () => {
    const bus = busWith({ Name: 'a' });
    expect(element(bus).setProperty('Min', '-10')).toBe(true);
    expect(element(bus).setProperty('Max', '10')).toBe(true);
    // No alias to inherit from the file, so the plain keys are the ones written.
    expect(binaryElement(bus)).toMatchObject({ Min: -10, Max: 10 });
    expect(textFileElement(bus)).toMatchObject({ Min: -10, Max: 10 });
    expect(minCell(element(busWith(binaryElement(bus))))).toBe('-10');
    expect(maxCell(element(busWith(textFileElement(bus))))).toBe('10');
  });
});
