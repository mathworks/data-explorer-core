// Copyright 2026 The MathWorks, Inc.
//
// A Simulink.Parameter pasted into a MAT-file keeps its Value. A new object of a MAT-file is MATLAB's
// default object of its class, each property set as a user sets it (matPaste.carryObject), and the
// Value was set to the text its row shows: a struct shows `<1x1 struct>`, which no text reads back
// as ("Invalid MATLAB expression"), a long vector a summary, `<1x11 double>`, and an integer or a
// single Value numbers a Parameter's setter makes a double of. Each was refused. The Value is now
// carried as the text that makes exactly it (`int16(500)`, the vector written out whole), and as
// data where no text does (a struct, a struct array), held to the rules a Value edit is held to.
// What a MAT-file writes no Value of is refused in the words of its rule: a struct holding a cell or
// an object, an enumeration value. Each Parameter pasted is saved and opened again, and its Value is
// the copy's, class, size and elements, and so is every row the copy states.
import { describe, it, expect } from 'vitest';
import { variableDifference } from '../src/datamodel/parser/MatFileWriter.js';
import { matVariableOfNode } from '../src/datamodel/node/container/matPaste.js';
import * as NodeRegistry from '../src/datamodel/node/NodeRegistry.js';
import { MIXED, copiesOf, fixture, parsedCopy, plainDifference, reopened, rowsOf, target } from './tools/matPaste.js';

type Any = any;

const copied = (file: string, name: string): Any => {
  const found = copiesOf(file).find((c) => c.entry.name === name);
  expect(found?.payload, `${file} ${name}`).toBeTruthy();
  return found!.payload;
};

// A Parameter's Value as a node: its value node, or the node of a Value with no rows to show.
const valueNodeOf = (p: Any): Any => p._valueNode ?? NodeRegistry.parseValue(p.Value === undefined ? [] : p.Value, 'Value', null);

/** Where the Value of `made` is not the Value of `copy`, as the variables a MAT reader hands over for each, or null. */
function valueDiffers(copy: Any, made: Any): string | null {
  const a = matVariableOfNode(valueNodeOf(copy), 'Value');
  const b = matVariableOfNode(valueNodeOf(made), 'Value');
  if ('why' in a || 'why' in b) {
    return 'why' in a ? 'copy: ' + a.why : 'made: ' + (b as { why: string }).why;
  }
  const what = (v: Any) => [v.className, v.isLogical, v.isComplex, (v.dimensions ?? []).join('x')].join(' ');
  return what(a) !== what(b) ? what(b) + ' for ' + what(a) : variableDifference(a, b, 'Value');
}

// Every row the copy states with any text but its top Name, as the Parameter made shows it, and the
// rows under it by position (matPaste.test.ts's statedRowsDiffer).
function statedRowsDiffer(copy: Any, made: Any, top = true): string | null {
  const one = (t: string) => {
    const m = /^\[\s*([^\s,;[\]]+)\s*\]$/.exec(t.trim());
    return m ? m[1] : t.trim();
  };
  const shown = (n: Any) => new Map(rowsOf(n).filter((r) => !/^\d+ \[/.test(r)).map((r) => [r.slice(0, r.indexOf(' = ')), r.slice(r.indexOf(' = ') + 3)]));
  const a = shown(copy);
  const b = shown(made);
  for (const [key, text] of a) {
    if ((top && key === 'Name') || text === '') continue;
    if (one(text) !== one(b.get(key) ?? '')) return `${made.name}.${key}: ${JSON.stringify(b.get(key))} for ${JSON.stringify(text)}`;
  }
  if (copy.children.length !== made.children.length) return `${made.name}: ${made.children.length} rows for ${copy.children.length}`;
  for (let i = 0; i < copy.children.length; i++) {
    const below = statedRowsDiffer(copy.children[i], made.children[i], false);
    if (below) return below;
  }
  return null;
}

/** `payload` pasted into a MAT-file opened from `into`, saved and opened again: the Parameter it is, held to the copy. */
function expectPasted(payload: Any, into: Uint8Array = fixture(MIXED)) {
  const t = target(into);
  const res: Any = t.session.pasteEntries('t.mat', [payload]);
  expect(res.error, res.reason).toBeUndefined();
  const [node] = res.nodes;
  expect([node.className, node.status], payload.name).toEqual(['Simulink.Parameter', 'New']);
  const again = reopened(t.save()).children.find((c: Any) => c.name === node.name);
  expect(again?.className, payload.name).toBe('Simulink.Parameter');
  const copy = parsedCopy(payload, node.name);
  expect(valueDiffers(copy, node), `${payload.name}, pasted`).toBeNull();
  expect(valueDiffers(copy, again), `${payload.name}, saved and opened again`).toBeNull();
  expect(rowsOf(again), payload.name).toEqual(rowsOf(node));
  expect(statedRowsDiffer(copy, again), payload.name).toBeNull();
  return again;
}

/** `payload` refused, naming the entry, with `reason`. */
function expectRefused(payload: Any, reason: RegExp, into: Uint8Array = fixture(MIXED)) {
  const t = target(into);
  const res: Any = t.session.pasteEntries('t.mat', [payload]);
  expect(res.error, JSON.stringify(res).slice(0, 200)).toBe(true);
  expect(res.reason).toMatch(new RegExp(`^Cannot paste "${payload.name}" into "t\\.mat": .+\\. Nothing was pasted\\.$`));
  expect(res.reason).toMatch(reason);
  expect(res.reason).not.toMatch(/Invalid MATLAB expression|could not be set to "</);
  expect(t.session.pasteRefusal('t.mat', payload, { deep: true })).toBe(res.reason);
}

// A copy of `payload` whose Value is `value`, named `name`.
function withValue(payload: Any, name: string, value: unknown): Any {
  const p = structuredClone(payload);
  p.name = name;
  p.value._elements[0]._properties.Value = value;
  return p;
}

const struct = (elements: Record<string, unknown>[], dims = [1, elements.length]) => ({
  _array_type: 'Struct',
  _dimensions: dims,
  _elements: elements,
  _fields: Object.keys(elements[0] ?? {}),
  _mw_element_type: 'MATLABArray',
});
const cell = (elements: unknown[]) => ({ _array_type: 'Cell', _dimensions: [1, elements.length], _elements: elements, _mw_element_type: 'MATLABArray' });

// MATLAB-written (test/fixtures/param-paste/make_param_paste.m): the same names in a MAT-file, a text
// and a binary dictionary, one Parameter a Value a paste carried as its shown text.
const PASTE = {
  mat: 'test/fixtures/param-paste/r2027a/param_paste.mat',
  text: 'test/fixtures/param-paste/r2027a/param_paste_text.sldd',
  binary: 'test/fixtures/param-paste/r2027a/param_paste_binary.sldd',
};
const PASTE_PARAMETERS = ['pNested', 'pStructNest', 'pStructArr', 'pStructTyped', 'pInt16', 'pInt16MinMax', 'pSingle', 'pVec', 'pInt32Vec', 'pPlain'];

const COMPLEX = { text: 'test/fixtures/mcos/complex.sldd', binary: 'test/fixtures/mcos/complex_binary.sldd', mat: 'test/fixtures/mcos/complex_objects.mat' };
const TYPED = { text: 'test/fixtures/mcos/typed_mcos.sldd', binary: 'test/fixtures/mcos/typed_mcos_binary.sldd', mat: 'test/fixtures/mcos/typed_objects.mat' };

describe('every Parameter of param-paste, pasted into its MAT-file out of each file, keeps its Value', () => {
  // A nested struct, a struct array, a struct of other classes than double; int16 (one with a
  // DataType, a Min, a Max and a Unit judged against it), single, a 1x11 vector, an int32 vector,
  // and a double, which pasted before. Out of the MAT-file itself, a paste within it.
  for (const [venue, file] of Object.entries(PASTE)) {
    for (const name of PASTE_PARAMETERS) {
      it(`${name}, out of the ${venue} file`, () => {
        expectPasted(copied(file, name), fixture(PASTE.mat));
      });
    }
  }

  it('and a plain struct holding a cell pastes as the plain value it is, as it did', () => {
    for (const file of Object.values(PASTE)) {
      const payload = copied(file, 'sCell');
      const t = target(fixture(PASTE.mat));
      const res: Any = t.session.pasteEntries('t.mat', [payload]);
      expect(res.error, res.reason).toBeUndefined();
      const again = reopened(t.save()).children.find((c: Any) => c.name === res.nodes[0].name);
      expect(again?.className).toBe('struct');
      expect(plainDifference(payload, again), file).toBeNull();
    }
  });
});

describe('a Parameter whose Value is a struct, pasted into a MAT-file, keeps it', () => {
  for (const [venue, file] of Object.entries(COMPLEX)) {
    it(`pStruct, struct('a', 1+2i, 'b', [3+4i 5-6i]), out of the ${venue} file`, () => {
      expectPasted(copied(file, 'pStruct'));
    });
  }
});

describe('a Parameter whose Value no bare text makes, pasted into a MAT-file, keeps it', () => {
  // Each was "…Value is a 1x1 int8 in what was copied, and a new Simulink.Parameter of a MAT-file is
  // given its Value as the text it shows, which makes a 1x1 double of it."
  for (const [venue, file] of Object.entries(TYPED)) {
    it(`an integer, a single and a logical, of every shape, out of the ${venue} file`, () => {
      for (const name of ['pInt8', 'pInt32Row', 'pInt32Col', 'pUint8Mat', 'pUint16Row', 'pSingle', 'pSingleRow', 'pSingleCol', 'pLogicalRow']) {
        expectPasted(copied(file, name));
      }
    });
  }

  it('an int16 of the MAT-file itself (MIXED p1)', () => {
    expectPasted(copied(MIXED, 'p1'));
  });
});

describe('what a MAT-file writes no Value of is refused in the words of its rule', () => {
  const base = () => copied(COMPLEX.binary, 'pStruct');

  it('a struct holding a cell, or an object', () => {
    expectRefused(withValue(base(), 'pCell', struct([{ a: 1, c: cell([1, 'x']) }])), /: pCell\.Value would be a struct holding a cell, which this editor does not write into a Simulink\.Parameter\./);
    const object = { _array_class: 'Simulink.Parameter', _array_type: 'MATLABArray', _dimensions: [1, 1], _mw_element_type: 'MATLABArray', _elements: [{ _properties: { Value: 1 } }] };
    expectRefused(withValue(base(), 'pObj', struct([{ a: 1, o: object }])), /: pObj\.Value holds a Simulink\.Parameter, which this editor does not write into an object\./);
  });

  it('a cell, which MATLAB takes as no Parameter Value either', () => {
    expectRefused(withValue(base(), 'pTopCell', cell([1, 2])), /: pTopCell\.Value would be a cell, which this editor does not write into a Simulink\.Parameter\./);
  });

  it('an enumeration value', () => {
    for (const file of ['test/fixtures/display/dispcat_bin.sldd', 'test/fixtures/display/dispcat_text.sldd', 'test/fixtures/display/dispcat_opaque.mat']) {
      expectRefused(copied(file, 'p_enum'), /: p_enum\.Value holds a DispColor, which this editor does not write into an object\./);
    }
  });
});
