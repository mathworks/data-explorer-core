// Copyright 2026 The MathWorks, Inc.
//
// A struct ARRAY from a .mat file. MatParser hands us one MatVariable per element
// per field; the node layer used to keep element 1 and drop the rest, so a 1x3
// struct displayed one field value and the other two were invisible.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import type { MatVariable } from '../src/datamodel/parser/MatParser.js';
import { loadFile, findEntry } from './parity/loadFile.js';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import { encodeMatVariable } from '../src/datamodel/parser/MatWriter.js';
import { matFile } from './tools/matBytes.js';
import { createSession, ingest } from '../src/index.js';

function num(name: string, v: number): MatVariable {
  return {
    name, className: 'double', dimensions: [1, 1], isComplex: false,
    isLogical: false, value: v, fields: null,
  };
}

// A struct array as MatParser reports it: fields[f] is an array, one entry per
// element, in MATLAB's own column-major order. Confirmed against the real
// artifact: cases.mat's struct2x3 arrives as fields.a = [1..6], which is
// truth.json's linearValues in truth.json's linearSubs order.
function structArray(dims: number[], perElement: Record<string, number>[]): MatVariable {
  const fields: Record<string, MatVariable[]> = {};
  for (const fname of Object.keys(perElement[0])) {
    fields[fname] = perElement.map((e) => num(fname, e[fname]));
  }
  return {
    name: 's', className: 'struct', dimensions: dims, isComplex: false,
    isLogical: false, value: null, fields: fields as never,
  };
}

describe('MAT struct array expansion', () => {
  it('builds one child per element, each carrying its own field values', () => {
    // gen_truth.m struct1x3: sa(k).a = k, sa(k).b = k*10.
    const v = structArray([1, 3], [{ a: 1, b: 10 }, { a: 2, b: 20 }, { a: 3, b: 30 }]);
    const node = MatlabVariableNode.parseMatVariable(v, 's', null);

    expect(node.children.length).toBe(3);
    expect(node.children.map((c: any) => c.displayName)).toEqual(['s(1)', 's(2)', 's(3)']);
    const firstFields = node.children.map((c: any) => c.children.map((f: any) => f.name));
    expect(firstFields).toEqual([['a', 'b'], ['a', 'b'], ['a', 'b']]);
    const aVals = node.children.map((c: any) => c.children[0].displayValue);
    expect(aVals).toEqual(['1', '2', '3']);
    const bVals = node.children.map((c: any) => c.children[1].displayValue);
    expect(bVals).toEqual(['10', '20', '30']);
  });

  it('labels a 2x3 struct array in MATLAB column-major order', () => {
    // gen_truth.m struct2x3: sm(k).a = k for k = 1..6, reshaped to 2x3, so the
    // linear order MATLAB reports IS 1..6 and the labels that go with it are
    // truth.json's linearSubs: (1,1) (2,1) (1,2) (2,2) (1,3) (2,3).
    const v = structArray([2, 3], [1, 2, 3, 4, 5, 6].map((n) => ({ a: n })));
    const node = MatlabVariableNode.parseMatVariable(v, 's', null);
    const pairs = node.children.map((c: any) => [c.displayName, c.children[0].displayValue]);
    expect(pairs).toEqual([
      ['s(1,1)', '1'], ['s(2,1)', '2'], ['s(1,2)', '3'],
      ['s(2,2)', '4'], ['s(1,3)', '5'], ['s(2,3)', '6'],
    ]);
  });

  it('leaves a 1x1 struct exactly as it was — fields directly beneath the node', () => {
    const v: MatVariable = {
      name: 's', className: 'struct', dimensions: [1, 1], isComplex: false,
      isLogical: false, value: null,
      fields: { a: num('a', 7), b: num('b', 8) },
    };
    const node = MatlabVariableNode.parseMatVariable(v, 's', null);
    expect(node.children.map((c: any) => c.name)).toEqual(['a', 'b']);
    expect(node.children[0].displayValue).toBe('7');
  });
});

// The same claim, against MATLAB's own file and MATLAB's own answers: no
// hand-built MatVariable, no expectation written from reasoning. truth.json's
// linearSubs/linearValues for a struct array are the subscript label and the
// FIRST field's display text, one per element, in column-major order.
describe('MAT struct array — the real artifact against truth.json', () => {
  const truth = JSON.parse(readFileSync(new URL('./parity/artifacts/truth.json', import.meta.url), 'utf8'));
  const root = loadFile('./artifacts/mat/cases.mat', 'cases.mat');

  for (const name of ['struct1x3', 'struct2x3', 'structNd']) {
    it('expands ' + name + ' to one row per element, labelled and valued as MATLAB says', () => {
      const t = truth.vars[name];
      const node = findEntry(root, name);
      expect(node.children.length).toBe(t.numel);
      expect(node.children.map((c: any) => c.displayName)).toEqual(t.linearSubs);
      expect(node.children.map((c: any) => c.children[0].displayValue)).toEqual(t.linearValues);
    });
  }

  it('leaves the scalar and empty structs alone', () => {
    // structScalar is 1x1: fields are its children, no element row. structEmpty is
    // 0x0 with no fields at all, so it has no children either.
    expect(findEntry(root, 'structScalar').children.map((c: any) => c.name)).toEqual(['a', 'b']);
    expect(findEntry(root, 'structEmpty').children.length).toBe(0);
  });
});

describe('MAT struct array write-back', () => {
  it('rebuilds every element from the tree, and an edit to element 2 survives', () => {
    const v = structArray([1, 3], [{ a: 1 }, { a: 2 }, { a: 3 }]);
    const node = MatlabVariableNode.parseMatVariable(v, 's', null);

    // Edit element 2's field. This is the case the old replay-from-snapshot
    // path could not express: it always took element 2 from the parse.
    const elem2 = node.children[1] as any;
    expect(elem2.children[0].setProperty('Value', '99')).toBe(true);

    const rebuilt = (node as any)._var;
    expect(rebuilt.className).toBe('struct');
    expect(rebuilt.dimensions).toEqual([1, 3]);
    const aField = rebuilt.fields.a;
    expect(Array.isArray(aField)).toBe(true);
    expect(aField.length).toBe(3);
    expect(aField.map((f: any) => f.value)).toEqual([1, 99, 3]);
  });

  it('survives an element that no longer has the field, keeping the other elements aligned', () => {
    // A whole-value edit ON an element node is accepted by setProperty and
    // _applyParsed clears that node's children, so element 1 stops having a field
    // `a` while element 2 still does. The rebuild must not throw on the way to the
    // writer — a save that crashes loses the whole file, not one field — and the
    // surviving element must stay in ITS slot rather than sliding forward.
    const v = structArray([1, 2], [{ a: 1 }, { a: 2 }]);
    const node = MatlabVariableNode.parseMatVariable(v, 's', null);
    (node.children[0] as any).setProperty('Value', '11');

    const rebuilt = (node as any)._var;
    const aField = rebuilt.fields.a;
    expect(aField.length).toBe(2);
    expect(aField[0]).toMatchObject({ className: 'double', dimensions: [0, 0] });
    expect(aField[1].value).toBe(2);
  });

  it('still rebuilds a 1x1 struct as a lone MatVariable per field', () => {
    const v: MatVariable = {
      name: 's', className: 'struct', dimensions: [1, 1], isComplex: false,
      isLogical: false, value: null, fields: { a: num('a', 7) },
    };
    const node = MatlabVariableNode.parseMatVariable(v, 's', null);
    (node.children[0] as any).setProperty('Value', '8');
    const rebuilt = (node as any)._var;
    expect(Array.isArray(rebuilt.fields.a)).toBe(false);
    expect(rebuilt.fields.a.value).toBe(8);
  });
});

// A field name is the FILE's word, and MatParser gathered a struct's fields into a
// plain `{}` keyed by it. `constructor`, `toString`, `valueOf` and `hasOwnProperty`
// are legal MATLAB field names, and for a struct ARRAY the gather asked
// `if (!fields[fn]) fields[fn] = []` — which found the INHERITED member, skipped the
// `[]`, and called `.push` on a function: "fields[fn].push is not a function", and the
// whole .mat failed to open. `__proto__` is not a MATLAB name (an identifier starts
// with a letter) but a file can spell it, and on a plain `{}` the write is the prototype
// setter: in a struct array it threw the same way, and in a 1x1 struct the field
// silently vanished. Each is now a field like any other.
//
// The files are written by core's own encodeMatVariable, which takes the names as given.
describe('a MAT struct field named after an Object.prototype member', () => {
  const INHERITED = [
    'constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf',
    'propertyIsEnumerable', 'toLocaleString', '__proto__', '__defineGetter__',
  ];

  // `s`, a struct of `dims` with fields `a` and `name`, element k holding a = k and
  // name = 10k. Object.fromEntries makes `__proto__` an OWN key of the input, as a
  // parsed file would have it, rather than a prototype.
  function matWithField(name: string, dims: number[]): ArrayBuffer {
    const n = dims.reduce((x, y) => x * y, 1);
    const column = (scale: number) => Array.from({ length: n }, (_, k) => num('', scale * (k + 1)));
    const pick = (vars: MatVariable[]) => (n === 1 ? vars[0] : vars);
    const s: MatVariable = {
      name: 's', className: 'struct', dimensions: dims, isComplex: false, isLogical: false, value: null,
      fields: Object.fromEntries([['a', pick(column(1))], [name, pick(column(10))]]) as never,
    };
    return matFile([named(encodeMatVariable(s), 's', dims.length)]);
  }

  // encodeMatVariable writes a MEMBER's element, whose array name is empty: an 8-byte
  // miINT8 element after the miMATRIX tag, the array flags and the dims (offset 40 for
  // rank 2, 48 for rank 3). A top-level element with no name is the subsystem to
  // MatParser, so the variable is named here, in the small-element form, which fits the
  // same 8 bytes.
  function named(element: Uint8Array, name: string, rank: number): Uint8Array {
    const at = 8 + 16 + 8 + Math.ceil((4 * rank) / 8) * 8;
    const out = element.slice();
    const view = new DataView(out.buffer);
    expect([view.getUint32(at, true), view.getUint32(at + 4, true)]).toEqual([1, 0]);
    view.setUint16(at, 1, true);
    view.setUint16(at + 2, name.length, true);
    out.set(new TextEncoder().encode(name), at + 4);
    return out;
  }

  // What the tree shows, opened as a host opens it: each field by name and value,
  // per element row for a struct array (`s(1)`, `s(2)`), directly under `s` for a 1x1.
  function shownFields(buffer: ArrayBuffer): unknown {
    const source = ingest(createSession(), buffer, { filename: 's.mat' });
    const s = source.children.find((c) => c.name === 's') as any;
    const row = (node: any) => node.children.map((f: any) => [f.name, f.displayValue]);
    return s.displayValue === '<1x1 struct>' ? row(s) : s.children.map(row);
  }

  it.each(INHERITED)('reads a 1x2 struct array with a field called %s', (name) => {
    const parsed = parseMat(matWithField(name, [1, 2]));
    const fields = parsed.variables[0].fields!;
    expect(Object.keys(fields)).toEqual(['a', name]);
    expect(Object.prototype.hasOwnProperty.call(fields, name)).toBe(true);
    // parseMat is public: the bag it hands out is an ordinary object, as every other
    // parsed bag is, so a consumer's `fields.hasOwnProperty(…)` and `String(fields)` work.
    expect(Object.getPrototypeOf(fields)).toBe(Object.prototype);
    expect((fields[name] as MatVariable[]).map((v) => v.value)).toEqual([10, 20]);

    expect(shownFields(matWithField(name, [1, 2]))).toEqual([
      [['a', '1'], [name, '10']],
      [['a', '2'], [name, '20']],
    ]);
  });

  it.each(INHERITED)('reads a 1x1 struct with a field called %s', (name) => {
    const fields = parseMat(matWithField(name, [1, 1])).variables[0].fields!;
    expect(Object.keys(fields)).toEqual(['a', name]);
    expect(Object.getPrototypeOf(fields)).toBe(Object.prototype);
    expect((fields[name] as MatVariable).value).toBe(10);
    expect(shownFields(matWithField(name, [1, 1]))).toEqual([['a', '1'], [name, '10']]);
  });

  it('reads the same file shape with an ordinary field name as the control', () => {
    expect(shownFields(matWithField('b', [1, 2]))).toEqual([
      [['a', '1'], ['b', '10']],
      [['a', '2'], ['b', '20']],
    ]);
  });

  // Edited, the struct is written from the tree: as a struct value for a 1x2, and as a
  // MAT stream (cdata) for a 1x1x2, which no struct value can spell. Both rebuilt their
  // field bag in a plain `{}` and lost `__proto__` there; the 1x2's field list still named
  // it, so the reopened struct read the name off Object.prototype as `[object Object]`.
  it.each([
    ['1x2', [1, 2], 's(1)', 's(2)'],
    ['1x1x2', [1, 1, 2], 's(1)', 's(2)'],
  ])('keeps every field of a %s struct copied after an edit into a text dictionary', (_, dims, first, second) => {
    for (const name of [...INHERITED, 'b']) {
      const source = ingest(createSession(), matWithField(name, dims as number[]), { filename: 's.mat' });
      const s = source.children.find((c) => c.name === 's') as any;
      expect(s.children[1].children.find((f: any) => f.name === 'a').setProperty('Value', '99')).toBe(true);
      const copy = JSON.parse(JSON.stringify(s.serialize().value));

      const session = createSession();
      const dictionary: any = ingest(session, readFileSync(new URL('./fixtures/rt_text.sldd', import.meta.url), 'utf8'), { filename: 'rt_text.sldd' });
      dictionary.getSection('design').parseEntry({ name: 's', metadata: { uuid: '00000000-0000-4000-e800-00000000005a' }, value: copy });
      const saved = session.serializeSource(dictionary.name)!;
      const reopened: any = ingest(createSession(), saved.kind === 'text' ? saved.text : saved.bytes, { filename: 'rt_text.sldd' });
      const entry = reopened.getSection('design').children.find((e: any) => e.name === 's');
      expect([name, entry.children.map((c: any) => [c.displayName, c.children.map((f: any) => [f.name, f.displayValue])])]).toEqual([name, [
        [first, [['a', '1'], [name, '10']]],
        [second, [['a', '99'], [name, '20']]],
      ]]);
    }
  });
});
