// Copyright 2026 The MathWorks, Inc.
//
// Entries pasted into a MAT-file through the session, as a host pastes what it copied
// (session.pasteEntries): every entry of a text dictionary, a binary one, another MAT-file and the
// MAT-file itself, copied as a host copies one (serialize(), cloned as JSON). Each one pasted is a
// new variable of the file, New, of the class it was copied as, named as it was or made unique;
// the file saves, adds no break of a rule MATLAB loads a file by (MatFileCheck), and opened again
// holds the variable as what was copied: a plain value as the variable a MAT reader hands over for
// the copy (matVariableOfNode, MatFileWriter.variableDifference), a string as its elements and size,
// an object as every row it shows, the rows the copy stated each as it stated it. Which entries
// are refused, and why, is pinned per source (and in matPasteRefusals.test.ts).
import { describe, it, expect } from 'vitest';
import { checkMatFile, violationsAdded } from '../src/datamodel/parser/MatFileCheck.js';
import { variableDifference } from '../src/datamodel/parser/MatFileWriter.js';
import { matVariableOfNode } from '../src/datamodel/node/container/matPaste.js';
import * as NodeRegistry from '../src/datamodel/node/NodeRegistry.js';
import {
  BINARY_CASES,
  MAT_CASES,
  MIXED,
  NONE,
  TEXT_CASES,
  copiesOf,
  copyOf,
  fixture,
  parsedCopy,
  plainDifference,
  reopened,
  rowsOf,
  stringValue,
  target,
} from './tools/matPaste.js';

type Any = any;

const OBJECTS = new Set(['Simulink.Parameter', 'Simulink.Signal', 'Simulink.Bus', 'Simulink.NumericType', 'Simulink.AliasType', 'Simulink.ValueType']);

// The rows a copied object states, each as the variable made of it shows it: every row the copy
// shows with any text but its top Name (a row it shows empty states nothing, the property at its
// default, which a text dictionary does not write), and the rows under it, by position.
function statedRowsDiffer(copied: Any, made: Any, top = true): string | null {
  const one = (t: string) => {
    const m = /^\[\s*([^\s,;[\]]+)\s*\]$/.exec(t.trim());
    return m ? m[1] : t.trim();
  };
  const shown = (n: Any) => new Map(rowsOf(n).filter((r) => !/^\d+ \[/.test(r)).map((r) => [r.slice(0, r.indexOf(' = ')), r.slice(r.indexOf(' = ') + 3)]));
  const a = shown(copied);
  const b = shown(made);
  for (const [key, text] of a) {
    if ((top && key === 'Name') || text === '') continue;
    if (one(text) !== one(b.get(key) ?? '')) return `${made.name}.${key}: ${JSON.stringify(b.get(key))} for ${JSON.stringify(text)}`;
  }
  if (copied.children.length !== made.children.length) return `${made.name}: ${made.children.length} rows for ${copied.children.length}`;
  for (let i = 0; i < copied.children.length; i++) {
    const below = statedRowsDiffer(copied.children[i], made.children[i], false);
    if (below) return below;
  }
  return null;
}

/** `payload` pasted into `into`, saved and opened again; what the variable made reads back as, held to the copy. */
function pasteSaveReopen(payload: Any, into: Uint8Array, expectedName: string, className: string) {
  const t = target(into);
  const res: Any = t.session.pasteEntries('t.mat', [payload]);
  expect(res.error, res.reason).toBeUndefined();
  const [node] = res.nodes;
  expect([node.name, node.status, node.parent, node.className], payload.name).toEqual([expectedName, 'New', t.root, className]);
  const saved = t.save();
  expect(violationsAdded(checkMatFile(into), checkMatFile(saved)), payload.name).toEqual([]);
  const again = reopened(saved).children.find((c: Any) => c.name === expectedName);
  expect(again?.className, payload.name).toBe(className);
  if (OBJECTS.has(className)) {
    // As the file shows it before the save, every row; and every row the copy stated, as stated.
    expect(rowsOf(again), payload.name).toEqual(rowsOf(node));
    expect(statedRowsDiffer(parsedCopy(payload, expectedName), again), payload.name).toBeNull();
  } else if (className === 'string') {
    expect(stringValue(again), payload.name).toBe(stringValue(parsedCopy(payload, expectedName)));
  } else {
    expect(plainDifference(payload, again), payload.name).toBeNull();
  }
  return { t, node, saved, again };
}

// A MAT-file's own spelling of a plain value is the one its copy has: copied out of one, pasted
// into one and read back, the value serializes as it was copied.
function expectSameCopy(payload: Any, again: Any): void {
  expect(again.serialize().value, payload.name).toEqual(payload.value);
}

// What each source's entries do pasted into MIXED: refused (by name) or pasted, every other one.
const REFUSED: Record<string, string[]> = {
  [TEXT_CASES]: ['aLookup', 'aVariant'],
  [BINARY_CASES]: ['aLookup', 'aVariant'],
  [MAT_CASES]: ['aLookup', 'aVariant', 'objRow', 'objCol', 'obj2x3', 'obj2x3x2'],
  // A Bus element held alone, which no Add makes (matPasteRefusals.test.ts). Its p1, whose Value is
  // an int16, was refused too, until the Value was carried as the text that makes it.
  [MIXED]: ['be'],
};

describe('every entry of a source, pasted into a MAT-file, saved and opened again', () => {
  for (const source of [TEXT_CASES, BINARY_CASES, MAT_CASES, MIXED]) {
    it(`${source}${source === MIXED ? ' (into itself)' : ''}`, () => {
      const into = fixture(MIXED);
      const refused: string[] = [];
      const held = new Set(target(into).root.children.map((c: Any) => c.name));
      let pasted = 0;
      for (const { entry, payload } of copiesOf(source)) {
        expect(payload, entry.name).not.toBeNull();
        const t = target(into);
        const deep = t.session.pasteRefusal('t.mat', payload, { deep: true });
        if (deep !== null) {
          // Named, and in the words a paste answers (matPasteInvariant.test.ts holds the two together).
          expect(deep, entry.name).toMatch(new RegExp(`^Cannot paste "${entry.name}" into "t\\.mat": .+\\. Nothing was pasted\\.$`));
          refused.push(entry.name);
          continue;
        }
        const name = held.has(entry.name) ? entry.name + '1' : entry.name;
        const className = OBJECTS.has(entry.className) || entry.className === 'string' ? entry.className : parsedCopy(payload, name).className;
        const { again } = pasteSaveReopen(payload, into, name, className);
        if (source.endsWith('.mat') && !OBJECTS.has(className) && className !== 'string') {
          expectSameCopy(payload, again);
        }
        pasted++;
      }
      expect(refused).toEqual(REFUSED[source]);
      expect(pasted).toBeGreaterThanOrEqual(source === MIXED ? 3 : 60);
    });
  }
});

describe('what a paste makes of what it is handed', () => {
  const textEntry = (name: string) => copiesOf(TEXT_CASES).find((c) => c.entry.name === name)!.payload;

  it("a dictionary's objects: each property the copy holds, set on MATLAB's default object", () => {
    const { node, again } = pasteSaveReopen(textEntry('aParam'), fixture(NONE), 'aParam', 'Simulink.Parameter');
    for (const n of [node, again]) {
      const shown = Object.fromEntries(rowsOf(n).map((r) => r.split(' = ')));
      expect([shown.Value, shown.DataType, shown.Min, shown.Max, shown.Unit, shown.Description], n.name).toEqual(['5', 'int16', '-10', '10', 'm/s', 'a param']);
    }
    // A Bus: its elements, each with its name and the properties a row of one offers.
    const bus = pasteSaveReopen(textEntry('aBus'), fixture(NONE), 'aBus', 'Simulink.Bus').again;
    expect(bus.children.map((e: Any) => [e.name, e.className])).toEqual(
      parsedCopy(textEntry('aBus'), 'aBus').children.map((e: Any) => [e.name, 'Simulink.BusElement']),
    );
    expect(statedRowsDiffer(parsedCopy(textEntry('aBus'), 'aBus'), bus)).toBeNull();
  });

  it("a Bus whose elements are named as the rows an Add makes are, in another order", () => {
    const bus = textEntry('aBus');
    const elements = bus.value._elements[0]._properties.Elements_internal._elements;
    const names = ['a1', 'a', 'a2'];
    bus.value._elements[0]._properties.Elements_internal = {
      ...bus.value._elements[0]._properties.Elements_internal,
      _dimensions: [3, 1],
      _elements: names.map((n, i) => ({ ...elements[i % elements.length], _properties: { ...elements[i % elements.length]._properties, Name: n } })),
    };
    const { again } = pasteSaveReopen(bus, fixture(NONE), 'aBus', 'Simulink.Bus');
    expect(again.children.map((e: Any) => e.name)).toEqual(names);
  });

  it('a NumericType MATLAB saved, its signedness, fraction length and slope as MATLAB shows them of what it saves', () => {
    const shown = (n: Any) => Object.fromEntries(rowsOf(n).map((r) => r.split(' = ')));
    const numeric = (file: string, name: string) => copiesOf(file).find((c) => c.entry.name === name)!.payload;
    // fixdt(1,16,8), which MATLAB saves as FixedExponent -8 and a dictionary's rows show as it does.
    for (const file of ['test/parity/artifacts/text/params.sldd', 'test/parity/artifacts/binary/params.sldd']) {
      const { again } = pasteSaveReopen(numeric(file, 'MyNumType'), fixture(NONE), 'MyNumType', 'Simulink.NumericType');
      const s = shown(again);
      expect([s.dataTypeMode, s.signedness, s.wordLength, s.fractionLength, s.slope], file).toEqual(['Fixed-point: binary point scaling', 'Signed', '16', '8', String(2 ** -8)]);
      expect(again.serial._properties.FixedExponent, file).toBe(-8);
    }
    // Unsigned, and a slope of 1.5 * 2^-2 in slope and bias scaling.
    const unsigned = numeric('test/fixtures/bus_types_binary.sldd', 'btNumeric');
    unsigned.value._elements[0]._properties.SignednessBool = false;
    expect(shown(pasteSaveReopen(unsigned, fixture(NONE), 'btNumeric', 'Simulink.NumericType').again).signedness).toBe('Unsigned');
    const sloped = numeric('test/fixtures/bus_types_binary.sldd', 'btNumeric');
    Object.assign(sloped.value._elements[0]._properties, { DataTypeMode: 'Fixed-point: slope and bias scaling', SlopeAdjustmentFactor: 1.5, FixedExponent: -2, Bias: 3 });
    const s = shown(pasteSaveReopen(sloped, fixture(NONE), 'btNumeric', 'Simulink.NumericType').again);
    expect([s.slope, s.bias]).toEqual(['0.375', '3']);
    // A Signedness written by hand (typeLink.sldd), its own.
    const hand = numeric('test/fixtures/typeLink.sldd', 'ntFix16');
    hand.value._elements[0]._properties.Signedness = 'Unsigned';
    const h = shown(pasteSaveReopen(hand, fixture(NONE), 'ntFix16', 'Simulink.NumericType').again);
    expect([h.signedness, h.fractionLength]).toEqual(['Unsigned', '3']);
  });

  it("a CoderInfo's identifier, which MATLAB saves as its Alias", () => {
    for (const [file, inner] of [[BINARY_CASES, (ci: Any) => ci._elements[0]._properties], [TEXT_CASES, (ci: Any) => ci._properties]] as const) {
      const p = copiesOf(file).find((c) => c.entry.name === 'aParam')!.payload;
      Object.assign(inner(p.value._elements[0]._properties.CoderInfo), { Alias: 'myId', StorageClass: 'ExportedGlobal' });
      const { again } = pasteSaveReopen(p, fixture(NONE), 'aParam', 'Simulink.Parameter');
      const shown = Object.fromEntries(rowsOf(again).map((r) => r.split(' = ')));
      expect([shown.storageClass, shown.identifier], file).toEqual(['ExportedGlobal', 'myId']);
    }
  });

  it('non-finite values as MATLAB spells them in a text dictionary: Inf, -Inf and NaN, their class and shape intact', () => {
    const file = 'test/fixtures/nonfinite_text.sldd';
    const valueOf = (n: Any) => matVariableOfNode(n._valueNode ?? NodeRegistry.parseValue(n.Value, 'Value', null), 'Value');
    for (const { entry, payload } of copiesOf(file)) {
      const className = OBJECTS.has(entry.className) ? entry.className : parsedCopy(payload, entry.name).className;
      const { again } = pasteSaveReopen(payload, fixture(NONE), entry.name, className);
      if (className === 'Simulink.Parameter') {
        // Its Value, as the variable a MAT reader hands over, the copy's to the last NaN.
        expect(variableDifference(valueOf(parsedCopy(payload, entry.name)) as Any, valueOf(again) as Any, entry.name + '.Value'), entry.name).toBeNull();
      }
    }
    // And out of a MAT-file: a Parameter whose Value was set to Inf there.
    const m = target(fixture(NONE));
    const made: Any = m.session.addEntry('', 'Simulink.Parameter', 'pinf');
    m.session.setActive(m.root, made);
    expect(m.session.editProperty(made.id, 'Value', '-Inf')).toBe(true);
    const { again } = pasteSaveReopen(copyOf(made), fixture(MIXED), 'pinf', 'Simulink.Parameter');
    expect(valueOf(again)).toMatchObject({ className: 'double', dimensions: [1, 1], value: -Infinity });
  });

  it('a string, scalar or array, as the string object an Add makes, holding its text', () => {
    for (const name of ['strScalar', 'strArray', 'strMat']) {
      const { again } = pasteSaveReopen(textEntry(name), fixture(NONE), name, 'string');
      expect(again._isOpaque, name).toBe(true);
    }
  });

  it('a struct, a struct array and a cell holding structs, written fresh', () => {
    const cellOfStructs = {
      name: 'cs',
      metadata: null,
      value: {
        _array_type: 'Cell',
        _dimensions: [1, 2],
        _elements: [textEntry('structScalar').value, { _array_type: 'Cell', _dimensions: [1, 1], _elements: [textEntry('struct1x3').value], _mw_element_type: 'MATLABArray' }],
        _mw_element_type: 'MATLABArray',
      },
    };
    for (const payload of [textEntry('structScalar'), textEntry('struct1x3'), textEntry('struct2x3'), textEntry('structNest'), textEntry('structNd'), textEntry('structEmpty'), cellOfStructs]) {
      pasteSaveReopen(payload, fixture(MIXED), payload.name, payload.name === 'cs' ? 'cell' : 'struct');
    }
  });

  it('a Constant of Architectural Data, a scalar numeric value, as a plain variable', () => {
    const constant = copiesOf('test/fixtures/arch.sldd').find((c) => c.entry.name === 'Constant')!;
    expect([constant.entry.kind, constant.payload.value._array_class]).toEqual(['Constant', undefined]);
    pasteSaveReopen(constant.payload, fixture(MIXED), 'Constant', 'double');
  });

  it('a MAT-file variable pasted into the file it was copied from, as its copy, named apart', () => {
    const t = target(fixture(MIXED));
    const res: Any = t.session.pasteEntries('t.mat', [copyOf(t.by('b0')), copyOf(t.by('x')), copyOf(t.by('sig0'))]);
    expect(res.nodes.map((n: Any) => n.name)).toEqual(['b01', 'x1', 'sig01']);
    const again = reopened(t.save());
    for (const [was, is] of [['b0', 'b01'], ['x', 'x1'], ['sig0', 'sig01']]) {
      const [a, b] = [again.children.find((c: Any) => c.name === was), again.children.find((c: Any) => c.name === is)];
      // Its element rows are subscripted by its own name.
      expect(rowsOf(b).slice(1).map((r: string) => r.split(is + '(').join(was + '(')), is).toEqual(rowsOf(a).slice(1));
    }
  });

  it('entries of one name in one paste are each named apart, against the file and one another', () => {
    const t = target(fixture(MIXED));
    const x = { name: 'x', metadata: null, value: 1 };
    const fresh = { name: 'q', metadata: null, value: 2 };
    const res: Any = t.session.pasteEntries('t.mat', [x, fresh, x, fresh, { ...copyOf(t.by('sig0')), name: 'q' }]);
    expect(res.nodes.map((n: Any) => n.name)).toEqual(['x1', 'q', 'x2', 'q1', 'q2']);
    expect(new Set(t.root.children.map((c: Any) => c.name)).size).toBe(t.root.children.length);
    const again = reopened(t.save());
    expect(again.children.map((c: Any) => c.name)).toEqual(t.root.children.map((c: Any) => c.name));
  });

  it('marks the file dirty and leaves the selection where it was', () => {
    const t = target(fixture(MIXED));
    t.session.setActive(t.root, t.by('x'));
    expect(t.root.dirty).toBe(false);
    const res: Any = t.session.pasteEntries('t.mat', [{ name: 'n', metadata: null, value: [1, 2, 3] }]);
    expect(res.nodes).toHaveLength(1);
    expect([t.root.dirty, t.session.getEntryNode(), t.session.getContextNode()]).toEqual([true, t.by('x'), t.root]);
    // And every node of what was pasted is found by its id.
    for (const n of res.nodes[0].flatten()) expect(t.session.findNodeById(n.id)).toBe(n);
  });

  it('an empty paste makes nothing, records nothing and publishes nothing', () => {
    const t = target(fixture(MIXED));
    expect(t.session.pasteEntries('t.mat', [])).toEqual({ nodes: [] });
    expect([t.events, t.root.dirty, t.session.canUndo()]).toEqual([[], false, false]);
  });
});
