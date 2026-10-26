// Copyright 2026 The MathWorks, Inc.
//
// What a paste into a MAT-file refuses, and that a refused paste changes nothing. Each refusal is
// `Cannot paste "<entry>" into "<file>": <why>. Nothing was pasted.`, naming the entry, and the
// property or the member where one is to blame; and the file is as it was: the same variables, not
// dirty, no undo step, nothing published, its save the bytes it was read from, and nothing of an
// object the paste made left in what a save writes objects from (MatNode._creation). The deep
// pasteRefusal answers the paste's own words; the cheap one either those or nothing.
import { describe, it, expect, vi } from 'vitest';
import { createSession } from '../src/index.js';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import ParameterNode from '../src/datamodel/node/data/ParameterNode.js';
import { matVariableOfNode, objectDifference } from '../src/datamodel/node/container/matPaste.js';
import { BINARY_CASES, MAT_CASES, MIXED, NONE, TEXT_CASES, bufferOf, copiesOf, copyOf, fixture, parsedCopy, reopened, sameBytes, target } from './tools/matPaste.js';

type Any = any;

const copied = (file: string, name: string): Any => {
  const found = copiesOf(file).find((c) => c.entry.name === name);
  expect(found?.payload, `${file} ${name}`).toBeTruthy();
  return found!.payload;
};
const plain = (name: string, value: unknown) => ({ name, metadata: null, value });
const struct = (fields: Record<string, unknown>) => ({ _array_type: 'Struct', _dimensions: [1, 1], _elements: [fields], _fields: Object.keys(fields), _mw_element_type: 'MATLABArray' });
const cell = (elements: unknown[]) => ({ _array_type: 'Cell', _dimensions: [1, elements.length], _elements: elements, _mw_element_type: 'MATLABArray' });
const FH = { _type: 'function_handle', _value: 'sin' };
// A cell of 16,385 0x256 sparse arrays, none of whose columns its data holds: past MatWriter's
// budget written as one value (test/budgetFailsClosed.test.ts).
const pastBudget = () => cell(Array.from({ length: 16385 }, () => ({ _type: 'sparse', _value: 'Matrix(0,256)\n[]' })));

/** `payloads` pasted into a file opened from `bytes`: refused, with `reason`, and the file as it was. */
function expectRefused(payloads: unknown[], reason: RegExp, bytes: Uint8Array = fixture(MIXED), name?: string) {
  const t = target(bytes);
  const before = t.root.children.slice();
  const creation = t.root._creation;
  const res: Any = t.session.pasteEntries('t.mat', payloads as Any);
  expect(res.error, JSON.stringify(res).slice(0, 200)).toBe(true);
  expect(res.reason).toMatch(reason);
  expect(res.reason).toMatch(/^Cannot paste (".+" )?into "t\.mat": .+\. Nothing was pasted\.$/);
  if (name !== undefined) {
    expect(res.reason.startsWith(`Cannot paste "${name}" into "t.mat": `), res.reason).toBe(true);
    expect(res.name).toBe(name);
  }
  expect(t.root.children).toEqual(before);
  expect(t.root.children.every((c: Any, i: number) => c === before[i])).toBe(true);
  expect([t.root.dirty, t.session.canUndo(), t.events]).toEqual([false, false, []]);
  expect(t.root._creation).toBe(creation);
  expect(t.root._liveCreations()).toEqual([]);
  expect(sameBytes(t.save(), bytes)).toBe(true);
  return { t, res };
}

/** As expectRefused, one entry, and the deep refusal says the same; the cheap one the same or nothing. */
function expectOneRefused(payload: Any, reason: RegExp, bytes: Uint8Array = fixture(MIXED)) {
  const { t, res } = expectRefused([payload], reason, bytes, payload?.name);
  expect(t.session.pasteRefusal('t.mat', payload, { deep: true })).toBe(res.reason);
  const cheap = t.session.pasteRefusal('t.mat', payload);
  expect(cheap === null || cheap === res.reason, String(cheap)).toBe(true);
  expect([t.root.dirty, t.session.canUndo(), t.events, t.root._liveCreations()]).toEqual([false, false, [], []]);
  expect(sameBytes(t.save(), bytes)).toBe(true);
  return res.reason as string;
}

describe('a value the file takes no variable of', () => {
  it('a function handle, at the top or in a struct or a cell', () => {
    expectOneRefused(copied('test/fixtures/display/dispcat_opaque.mat', 'fh_sin'), /: it is a function handle, which this package cannot write into a MAT-file\./);
    expectOneRefused(plain('s', struct({ f: FH })), /: s\.f is a function handle/);
    expectOneRefused(plain('c', cell([1, FH])), /: c\{2\} is a function handle/);
  });

  it("an enumeration's definition and an enumeration's value", () => {
    expectOneRefused(copied('test/fixtures/arch.sldd', 'EnumType'), /: it is an enumeration's definition, which a MAT-file does not hold/);
    expectOneRefused(copied('test/fixtures/text_empty_readback_binary.sldd', 'e_En2'), /: it is a value of the enumeration dProbeColors/);
  });

  it('a class a MAT-file creates no object of: ConnectionBus, ServiceBus, the Variant classes, a ConfigSet, classes of its own', () => {
    for (const [file, name, cls] of [
      ['test/parity/artifacts/text/params.sldd', 'MyConnBus', 'Simulink.ConnectionBus'],
      ['test/fixtures/arch.sldd', 'ServiceInterface', 'Simulink.ServiceBus'],
      [TEXT_CASES, 'aVariant', 'Simulink.VariantVariable'],
      ['test/parity/artifacts/text/params.sldd', 'MyVarCtrl', 'Simulink.VariantControl'],
      ['test/parity/artifacts/text/params.sldd', 'MyVarExpr', 'Simulink.VariantExpression'],
      ['test/fixtures/variantbank_r2027a_text.sldd', 'vb1', 'Simulink.VariantBank'],
      ['test/fixtures/custom_object_text.sldd', 'widget', 'Widget'],
      ['test/fixtures/mcos-templates/targets/r2027a/other.mat', 'd', 'datetime'],
      [MIXED, 'be', 'Simulink.BusElement'],
    ]) {
      expectOneRefused(copied(file, name), new RegExp(`: it is an? ${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, and a MAT-file takes a new variable of a plain value, a struct, or one of Simulink\\.Parameter`));
    }
  });

  it('an mpt object, a subclass whose own properties are not written', () => {
    expectOneRefused(copied('test/fixtures/mcos/complex_binary.sldd', 'mptP'), /: it is a mpt\.Parameter, a subclass of Simulink\.Parameter whose own properties this package does not write/);
  });

  it("a LookupTable and a Breakpoint, which a MAT-file's Add does not offer", () => {
    for (const [file, name] of [[TEXT_CASES, 'aLookup'], [BINARY_CASES, 'aLookup'], ['test/parity/artifacts/text/params.sldd', 'MyBkpt']]) {
      expectOneRefused(copied(file, name), /its node shows nothing yet of the Table and Breakpoints its object holds/);
    }
  });

  it('an array of objects', () => {
    expectOneRefused(copied(MAT_CASES, 'objRow'), /: it is a 1x3 array of Simulink\.Parameter objects, and this package makes a new object of a MAT-file one at a time/);
    expectOneRefused(copied(MAT_CASES, 'obj2x3x2'), /: it is a 2x3x2 array of Simulink\.Parameter objects/);
  });

  it('a struct or a cell holding an object (one holding a string is pasted: matCellStrings.test.ts)', () => {
    expectOneRefused(copied('test/fixtures/cellarr_text.sldd', 'sObjArr'), /: sObjArr\.f is a Simulink\.Parameter object, and a value pasted into a MAT-file holds no object but at its top/);
    expectOneRefused(copied('test/fixtures/cellarr_binary.sldd', 'cObj'), /: cObj\{1\} is a Simulink\.Parameter object/);
    expectOneRefused(copied('test/fixtures/text_empty_readback_binary.sldd', 's_Params0'), /: s_Params0\.f is an empty array of Simulink\.Parameter objects/);
  });

  it('a value past the budget of MatWriter, as its save would refuse it', { timeout: 60_000 }, () => {
    expectOneRefused(plain('big', pastBudget()), /: big\{16385\} is a 0x256 sparse array whose data holds none of its 256 columns, and with it the value would add more than 16 MiB/);
  });

  it('what is no entry, and what holds no value', () => {
    expectRefused([{ value: 1 }], /^Cannot paste into "t\.mat": what was handed over is not an entry, a name and a value\./);
    expectRefused([null], /not an entry/);
    expectRefused(['x'], /not an entry/);
    expectOneRefused({ name: 'u', metadata: null, value: undefined }, /: it holds no value\./);
    const t = target(fixture(MIXED));
    expect(t.session.pasteEntries('t.mat', 'x' as Any)).toEqual({ error: true, reason: 'Cannot paste into "t.mat": what was handed over is not a list of entries. Nothing was pasted.' });
  });
});

describe('a name MATLAB cannot load', () => {
  it('as it was copied, or as it would be made unique', () => {
    expectOneRefused(plain('1x', 1), /: it is not a name MATLAB can load \(/);
    expectOneRefused(plain('end', 1), /: it is not a name MATLAB can load \(/);
    expectOneRefused(plain('a'.repeat(64), 1), /: it is not a name MATLAB can load \(/);
    // A 63-character name the file holds, which a counter makes 64.
    const long = 'b'.repeat(63);
    const t = target(fixture(MIXED));
    expect(t.session.pasteEntries('t.mat', [plain(long, 1)])).toMatchObject({ nodes: [{ name: long }] });
    const bytes = t.save();
    expectOneRefused(plain(long, 2), new RegExp(`: '${long}1', the name it would be given, is not a name MATLAB can load`), bytes);
  });
});

describe('an object whose copy the object made cannot be', () => {
  it("a Parameter's Value the text it is given as does not hold: an integer class, single, a struct", () => {
    expectOneRefused(copied('test/fixtures/mcos/typed_mcos.sldd', 'pInt8'), /: pInt8\.Value is a 1x1 int8 in what was copied, and a new Simulink\.Parameter of a MAT-file is given its Value as the text it shows, which makes a 1x1 double of it\./);
    expectOneRefused(copied('test/fixtures/mcos/typed_mcos.sldd', 'pSingle'), /: pSingle\.Value is a 1x1 single in what was copied/);
    expectOneRefused(copied(MIXED, 'p1'), /: p11\.Value is a 1x1 int16 in what was copied/);
    expectOneRefused(copied('test/fixtures/mcos/complex_binary.sldd', 'pStruct'), /: pStruct\.Value could not be set to "<1x1 struct>"/);
    // A complex double array is text the Value takes now (complexArrayInput.test.ts), and is carried.
    const t = target(fixture(MIXED));
    const res: Any = t.session.pasteEntries('t.mat', [copied('test/fixtures/mcos/complex_binary.sldd', 'pRow')]);
    expect(reopened(t.save()).children.find((c: Any) => c.name === res.nodes?.[0]?.name)?.displayValue).toBe('[1+2i 3+4i 5+6i]');
  });

  it('a property the editor of the file takes no such value of, named', () => {
    expectOneRefused(copied('test/fixtures/typeLink.sldd', 'TightSig'), /: TightSig\.DataType could not be set to "Bus:artFsAimCmd": TightSig\.DataType would be 'Bus:artFsAimCmd': written as MATLAB spells it, with one space after the colon\./);
  });

  it('a property no row shows and no editor writes, held at other than its default', () => {
    // MATLAB's defaults of them, which a dictionary writes and the object made holds, pass (every
    // Parameter and Signal of matPaste.test.ts); another value of one is refused, named.
    const signal = copied(BINARY_CASES, 'aSignal');
    signal.value._elements[0]._properties.LoggingInfo._elements[0]._properties.DataLogging = true;
    expectOneRefused(signal, /: aSignal\.LoggingInfo\.DataLogging is true in what was copied, a property no editor of a MAT-file's Simulink\.Signal writes, where the object made holds its default\./);
    const param = copied(TEXT_CASES, 'aParam');
    param.value._elements[0]._properties.CoderInfo._properties.CustomStorageClass = 'Const';
    expectOneRefused(param, /: aParam\.CoderInfo\.CustomStorageClass is "Const" in what was copied/);
    const bus = copied(BINARY_CASES, 'aBus');
    bus.value._elements[0]._properties.Elements_internal._elements[0]._properties.SampleTime = 0.1;
    expectOneRefused(bus, /: aBus\.x\.SampleTime is 0\.1 in what was copied, a property no editor of a MAT-file's Simulink\.BusElement writes, where the object made holds -1\./);
    // A number JSON has no spelling of is said, and compared, as itself.
    const endless = copied(BINARY_CASES, 'aSignal');
    endless.value._elements[0]._properties.LoggingInfo._elements[0]._properties.MaxPoints = Infinity;
    expectOneRefused(endless, /: aSignal\.LoggingInfo\.MaxPoints is Inf in what was copied, a property no editor of a MAT-file's Simulink\.Signal writes, where the object made holds its default\./);
    const unknown = copied(TEXT_CASES, 'aParam');
    unknown.value._elements[0]._properties.Extra = 3;
    expectOneRefused(unknown, /: aParam\.Extra is 3 in what was copied/);
  });

  it("a property a row shows as the copy's text, held as text where the object made holds a number", () => {
    // System Composer saves a Data Interface's element Dimensions as the char '1', which a row
    // shows as `1`, as it shows the double 1 the element made holds: MATLAB loads the two apart.
    expectOneRefused(copied('test/fixtures/arch.sldd', 'DataInterface'), /: DataInterface\.Element\.Dimensions is the text "1" in what was copied, where the object made holds the number 1: a MAT-file's editor of it takes numbers\./);
    // Whatever text it holds, every element and every class whose Dimensions a row shows: refused,
    // named, and never written as the number it reads as.
    const ofText = (v: string) => {
      const p = copied('test/fixtures/arch.sldd', 'DataInterface');
      for (const el of p.value._elements[0]._properties.Elements_internal._elements) el._properties.Dimensions = v;
      return p;
    };
    expectOneRefused(ofText('2'), /: DataInterface\.Element\.Dimensions is the text "2" in what was copied, where the object made holds the number 2: /);
    expectOneRefused(ofText('[2 3]'), /: DataInterface\.Element\.Dimensions is the text "\[2 3\]" in what was copied, where the object made holds the numbers \[2 3\]: /);
    expectOneRefused(ofText('N'), /: DataInterface\.Element\.dimensions could not be set to "N": DataInterface\.Element\.Dimensions must be a number or a row of numbers\./);
    const signal = copied(TEXT_CASES, 'aSignal');
    signal.value._elements[0]._properties.Dimensions = '3';
    expectOneRefused(signal, /: aSignal\.Dimensions is the text "3" in what was copied, where the object made holds the number 3: /);
    const valueType = copied('test/fixtures/arch.sldd', 'ValueType');
    valueType.value._elements[0]._properties.Dimensions = '2';
    expectOneRefused(valueType, /: ValueType\.Dimensions is the text "2" in what was copied, where the object made holds the number 2: /);
    // The binary dictionary's, a double, pastes.
    const t = target(fixture(NONE));
    expect((t.session.pasteEntries('t.mat', [copied('test/fixtures/arch_binary.sldd', 'DataInterface')]) as Any).nodes).toHaveLength(1);
  });

  it('text held to itself exactly: blanks a MATLAB load drops are refused, named; text in brackets carried as it is', () => {
    const withDescription = (v: string) => {
      const p = copied(TEXT_CASES, 'aParam');
      p.value._elements[0]._properties.Description = v;
      return p;
    };
    // Two blanks are not no Description: refused for what MATLAB loads of them, not pasted as ''.
    expectOneRefused(withDescription('  '), /: aParam\.Description could not be set to "  ": aParam\.Description would be '  ', which MATLAB would load as '': it loads text of white space alone as empty\./);
    const bus = copied(TEXT_CASES, 'aBus');
    bus.value._elements[0]._properties.HeaderFile = 'x  ';
    expectOneRefused(bus, /: aBus\.headerFile could not be set to "x  ": aBus\.HeaderFile would be 'x  ', which MATLAB would load as 'x': it trims the white space at either end\./);
    for (const text of [' a ', '[abc]', 'x  ']) {
      const t = target(fixture(NONE));
      const res: Any = t.session.pasteEntries('t.mat', [withDescription(text)]);
      expect(res.nodes?.[0]?.Description, text).toBe(text);
      const again = reopened(t.save()).children.find((c: Any) => c.name === 'aParam');
      expect(again.Description, text).toBe(text);
    }
  });

  it('a string the text an edit takes does not hold: an empty or an N-D string array', () => {
    expectOneRefused(copied('test/fixtures/lossy_empties_readback_binary.sldd', 'e_Str03'), /: e_Str03\.Value could not be set to "<0x3 string>": Invalid MATLAB expression\./);
  });
});

describe('the file', () => {
  it('a file no save of which can be written takes no paste, and offers none', () => {
    const parsed = parseMat(bufferOf(fixture(MIXED)));
    const session = createSession();
    const root: Any = session.addMatSourceParsed('t.mat', { header: parsed.header, variables: parsed.variables });
    const reason = session.pasteRefusal('t.mat', plain('n', 1));
    expect(reason).toMatch(/^Cannot paste "n" into "t\.mat": it was opened without the records a save writes back, so a save would lose every one this package did not read\. Nothing was pasted\.$/);
    expect(session.pasteEntries('t.mat', [plain('n', 1)])).toEqual({ error: true, reason, name: 'n' });
    expect([root.readOnly, root.getAdmittedTypes(), root.children.length]).toEqual([true, [], parsed.variables.filter((v: Any) => !v._anonymous).length]);
  });

  it('a source that is not a MAT-file, or that is not open', () => {
    const session = createSession();
    session.addDataSource('d.sldd', { MW_SLDD: {} } as Any);
    const payload = plain('n', 1);
    for (const ask of [() => (session.pasteEntries('d.sldd', [payload]) as Any).reason, () => session.pasteRefusal('d.sldd', payload, { deep: true })]) {
      expect(ask()).toBe('Cannot paste into "d.sldd": a paste through the session is supported only into a MAT-file; a dictionary\'s section takes one entry at a time (parseEntry). Nothing was pasted.');
    }
    expect((session.pasteEntries('nope.mat', [payload]) as Any).reason).toBe('Cannot paste into "nope.mat": no source of that id is open. Nothing was pasted.');
  });
});

describe('one entry refused refuses the paste whole', () => {
  it('those made before it, a plain value, a Parameter and a string among them, are taken out again', () => {
    for (const bytes of [fixture(MIXED), fixture(NONE)]) {
      const p = copied(TEXT_CASES, 'aParam');
      const s = copied(TEXT_CASES, 'strArray');
      expectRefused([plain('v', [1, 2]), p, s, copied(TEXT_CASES, 'aBus'), plain('fh', FH)], /^Cannot paste "fh" into "t\.mat": it is a function handle/, bytes, 'fh');
    }
  });

  it('and the next paste is made as if the refused one never was', () => {
    const t = target(fixture(NONE));
    const res: Any = t.session.pasteEntries('t.mat', [copied(TEXT_CASES, 'aParam'), plain('fh', FH)]);
    expect(res.error).toBe(true);
    const fresh = target(fixture(NONE));
    const made: Any = t.session.pasteEntries('t.mat', [copied(TEXT_CASES, 'aParam')]);
    const control: Any = fresh.session.pasteEntries('t.mat', [copied(TEXT_CASES, 'aParam')]);
    expect(made.nodes[0].name).toBe('aParam');
    expect(sameBytes(t.save(), fresh.save())).toBe(true);
    expect(control.nodes).toHaveLength(1);
  });
});

describe('whatever a host hands over is answered, and never thrown', () => {
  // Values no reader of this package writes, of the shapes a hand-edited text dictionary or a host's
  // own register could still hold: each is pasted or refused, the deep refusal agreeing, and what
  // is pasted saves. A JS list mixing numbers and text, which MatWriter writes with the text as 0,
  // is refused by the save's own read-back of a record written fresh.
  const weird: unknown[] = [
    { _array_class: 'Simulink.Parameter', _elements: ['garbage'] },
    { _array_class: 'Simulink.Parameter', _elements: [{ _properties: { Value: { foo: 1 }, Min: 'x', DataType: 3 } }] },
    { _array_class: 'Simulink.Bus', _elements: [{ _properties: { Elements_internal: { _array_class: 'Simulink.BusElement', _dimensions: [1, 1], _elements: [{ _properties: { Name: '1bad' } }] } } }] },
    { _array_class: 'Simulink.Bus', _elements: [{ _properties: { Elements_internal: 'x' } }] },
    { _array_class: 'Simulink.Signal', _dimensions: [1, 1], _elements: [null] },
    { _array_class: 'Simulink.NumericType', _elements: [{ _properties: { DataTypeMode: 'Bogus', WordLength: -3 } }] },
    { _array_class: 'Simulink.AliasType', _elements: [{ _properties: { BaseType: { a: 1 } } }] },
    { _array_class: 'Simulink.ValueType', _elements: [{ _properties: { Dimensions: 'abc' } }] },
    { foo: 1 },
    { _type: 'double', _value: 'garbage' },
    { _type: 'cdata', _value: '???' },
    { _array_type: 'Struct', _dimensions: [2], _elements: [1] },
    { _array_type: 'String', _dimensions: [1, 2], _elements: [null, 'a'] },
    { _array_type: 'String', _dimensions: [5], _elements: 'x' },
    [1, 'a'],
    [[1, 2], [3]],
    'text',
    true,
    null,
    [],
    {},
    { _type: 'logical', _value: 'Matrix(2,2)\n[1,0]' },
    { _type: 'int8', _value: '[300]' },
  ];

  for (const into of [MIXED, NONE]) {
    it(`into ${into}`, () => {
      const held = target(fixture(into)).root.children.length;
      for (const value of weird) {
        const what = JSON.stringify(value);
        const t = target(fixture(into));
        const payload = plain('w', value);
        let deep: string | null = null;
        let res: Any;
        expect(() => t.session.pasteRefusal('t.mat', payload), what).not.toThrow();
        expect(() => (deep = t.session.pasteRefusal('t.mat', payload, { deep: true })), what).not.toThrow();
        expect(() => (res = t.session.pasteEntries('t.mat', [payload])), what).not.toThrow();
        expect(res.error ? res.reason : null, what).toBe(deep);
        if (res.error) {
          expect(res.reason, what).toMatch(/^Cannot paste "w" into "t\.mat": .+\. Nothing was pasted\.$/);
          expect([t.root.dirty, t.root.children.length, t.root._liveCreations()], what).toEqual([false, held, []]);
        } else {
          expect(() => t.save(), what).not.toThrow();
        }
      }
      const mixed = target(fixture(into));
      expect((mixed.session.pasteEntries('t.mat', [plain('w', [1, 'a'])]) as Any).reason).toBe(
        'Cannot paste "w" into "t.mat": it would not read back as it was written (w: its element 2 reads back as 0 where a was written). Nothing was pasted.',
      );
    });
  }
});

describe('a making that throws refuses the paste whole, and leaves nothing behind', () => {
  const two = () => [plain('v', [1, 2]), copied(TEXT_CASES, 'aParam'), plain('w', 3)];
  const unchanged = (t: ReturnType<typeof target>, before: Any[], creation: unknown, bytes: Uint8Array) => {
    expect(t.root.children.every((c: Any, i: number) => c === before[i]) && t.root.children.length === before.length).toBe(true);
    expect([t.root.dirty, t.session.canUndo(), t.events, t.root._liveCreations()]).toEqual([false, false, [], []]);
    expect(t.root._creation).toBe(creation);
    expect(sameBytes(t.save(), bytes)).toBe(true);
  };

  for (const into of [MIXED, NONE]) {
    it(`${into}: a throw while making a plain value, after an object was made`, () => {
      const bytes = fixture(into);
      const t = target(bytes);
      const before = t.root.children.slice();
      const creation = t.root._creation;
      const parse = MatlabVariableNode.parseMatVariable;
      const spy = vi.spyOn(MatlabVariableNode, 'parseMatVariable').mockImplementation((v: Any, name: string, parent: Any) => {
        if (name === 'w') throw new TypeError('boom');
        return parse.call(MatlabVariableNode, v, name, parent);
      });
      try {
        const res: Any = t.session.pasteEntries('t.mat', two());
        expect(res).toEqual({ error: true, name: 'w', reason: 'Cannot paste "w" into "t.mat": its value could not be made a variable of the file (boom). Nothing was pasted.' });
        unchanged(t, before, creation, bytes);
        expect(t.session.pasteRefusal('t.mat', plain('w', 3), { deep: true })).toBe(res.reason);
        unchanged(t, before, creation, bytes);
      } finally {
        spy.mockRestore();
      }
    });

    it(`${into}: a throw while an object made is being set, and one that is not an Error`, () => {
      const bytes = fixture(into);
      const t = target(bytes);
      const before = t.root.children.slice();
      const creation = t.root._creation;
      const spy = vi.spyOn(ParameterNode.prototype, 'setProperty').mockImplementation(() => {
        throw new RangeError('set failed');
      });
      try {
        const res: Any = t.session.pasteEntries('t.mat', two());
        expect(res.reason).toBe('Cannot paste "aParam" into "t.mat": it could not be made a variable of the file (set failed). Nothing was pasted.');
        unchanged(t, before, creation, bytes);
        expect(t.session.pasteRefusal('t.mat', copied(TEXT_CASES, 'aParam'), { deep: true })).toBe(res.reason);
        unchanged(t, before, creation, bytes);
        // Not an Error: thrown on, and the file taken back all the same.
        spy.mockImplementation(() => {
          throw 'not an error';
        });
        expect(() => t.session.pasteEntries('t.mat', two())).toThrow('not an error');
        expect(() => t.session.pasteRefusal('t.mat', copied(TEXT_CASES, 'aParam'), { deep: true })).toThrow('not an error');
        unchanged(t, before, creation, bytes);
      } finally {
        spy.mockRestore();
      }
      // And the paste made after it is the one a file fresh from disk makes.
      const fresh = target(bytes);
      t.session.pasteEntries('t.mat', two());
      fresh.session.pasteEntries('t.mat', two());
      expect(sameBytes(t.save(), fresh.save())).toBe(true);
    });
  }

  it('a copy whose writing throws is refused, naming the entry', () => {
    const t = target(fixture(MIXED));
    const x = t.by('x');
    const spy = vi.spyOn(x, 'serialize').mockImplementation(() => {
      throw new TypeError('no copy');
    });
    try {
      expect(t.session.copyRefusal(x.id)).toBe('Cannot copy "x": it could not be written (no copy). Nothing was copied.');
    } finally {
      spy.mockRestore();
    }
    expect(t.session.copyRefusal(x.id)).toBeNull();
  });
});

describe('what a paste is held to, below it', () => {
  it('a row a copied object shows empty states nothing only where its bag holds nothing there either', () => {
    const t = target(fixture(NONE));
    const made: Any = (t.session.pasteEntries('t.mat', [copied(TEXT_CASES, 'aParam')]) as Any).nodes[0];
    // The copy, its Unit row showing nothing of the DocUnits its bag holds, as a row that shows less
    // than its bag would.
    const copy: Any = parsedCopy(copied(TEXT_CASES, 'aParam'), 'aParam');
    const shown = copy.getPropInfo.bind(copy);
    copy.getPropInfo = (p: Any) => (p.key === 'Unit' ? { ...shown(p), displayValue: '' } : shown(p));
    expect(objectDifference(copy, made)).toBe('aParam.Unit would be "m/s" where what was copied holds DocUnits = "m/s", which its row shows nothing of');
    expect(objectDifference(parsedCopy(copied(TEXT_CASES, 'aParam'), 'aParam'), made)).toBeNull();
  });

  it('a value the reader did not decode has no variable to be', () => {
    const node = MatlabVariableNode.createNotDecoded({ name: 'u', className: 'double', dimensions: [2, 3], isComplex: false, isLogical: false, value: null, fields: null }, 'u', null);
    expect(matVariableOfNode(node, 'u')).toEqual({ why: 'it is a value that was not decoded, which has no value a save could write' });
  });

  it('a copy of a variable of the file pasted back is not refused for its name', () => {
    const t = target(fixture(MIXED));
    expect((t.session.pasteEntries('t.mat', [copyOf(t.by('x'))]) as Any).nodes[0].name).toBe('x1');
  });
});
