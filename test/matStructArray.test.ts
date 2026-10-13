// Copyright 2026 The MathWorks, Inc.
//
// A struct ARRAY from a .mat file. MatParser hands us one MatVariable per element
// per field; the node layer used to keep element 1 and drop the rest, so a 1x3
// struct displayed one field value and the other two were invisible.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import StructNode from '../src/datamodel/node/data/StructNode.js';
import type { MatVariable } from '../src/datamodel/parser/MatParser.js';
import { loadFile, findEntry } from './parity/loadFile.js';
import { decodeMatStream, parseMat } from '../src/datamodel/parser/MatParser.js';
import { encodeMatVariable } from '../src/datamodel/parser/MatWriter.js';
import { decodeMcosBlob, decodeMcosVariables } from '../src/datamodel/parser/McosParser.js';
import { uudecode } from '../src/datamodel/parser/CdataCodec.js';
import { encodedBytes, matStreamPrefix } from '../src/datamodel/parser/EncodedValue.js';
import { MAX_EXPANDED_ELEMENTS } from '../src/datamodel/display/DisplayConvention.js';
import { CLASS, MI, arrayFlags, cellVar, dims, element, matFile, matrix, structVar, varName } from './tools/matBytes.js';
import { renameInMat } from './tools/matRename.js';
import { BINARY, TEXT, copyOf, sparseFixture } from './tools/pasteVenues.js';
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

  // `s` with field `name`, opened out of a .mat, its element 2's `a` edited to 99, copied
  // as a host copies a variable, pasted into `file`, saved, and opened again: each element
  // row's fields, by name and value.
  function copiedAfterEdit(name: string, dims: number[], file: string): unknown {
    const source = ingest(createSession(), matWithField(name, dims), { filename: 's.mat' });
    const s = source.children.find((c) => c.name === 's') as any;
    expect(s.children[1].children.find((f: any) => f.name === 'a').setProperty('Value', '99')).toBe(true);
    const copy = JSON.parse(JSON.stringify(s.serialize().value));

    const session = createSession();
    const dictionary: any = ingest(session, readFileSync(new URL(`./fixtures/${file}`, import.meta.url)), { filename: file });
    dictionary.getSection('design').parseEntry({ name: 's', metadata: { uuid: '00000000-0000-4000-e800-00000000005a' }, value: copy });
    const saved = session.serializeSource(dictionary.name)!;
    const reopened: any = ingest(createSession(), saved.kind === 'text' ? saved.text : saved.bytes, { filename: file });
    const entry = reopened.getSection('design').children.find((e: any) => e.name === 's');
    return entry.children.map((c: any) => [c.displayName, c.children.map((f: any) => [f.name, f.displayValue])]);
  }

  // Edited, the struct is written from the tree: as a struct value for a 1x2, and as a
  // MAT stream (cdata) for a 1x1x2, which no struct value can spell. Both rebuilt their
  // field bag in a plain `{}` and lost `__proto__` there; the 1x2's field list still named
  // it, so the reopened struct read the name off Object.prototype as `[object Object]`.
  it.each([
    ['1x2', [1, 2]],
    ['1x1x2', [1, 1, 2]],
  ])('keeps every field of a %s struct copied after an edit into a text dictionary', (_, dims) => {
    for (const name of [...INHERITED, 'b']) {
      expect([name, copiedAfterEdit(name, dims as number[], 'rt_text.sldd')]).toEqual([name, [
        ['s(1)', [['a', '1'], [name, '10']]],
        ['s(2)', [['a', '99'], [name, '20']]],
      ]]);
    }
  });

  // A binary dictionary writes the struct as <P Name="…"> elements, and its reader
  // gathered those into a plain `{}` on the way back in (BinarySlddParser).
  it.each([
    ['1x2', [1, 2]],
    ['1x1x2', [1, 1, 2]],
  ])('keeps every field of a %s struct copied after an edit into a binary dictionary', (_, dims) => {
    for (const name of [...INHERITED, 'b']) {
      expect([name, copiedAfterEdit(name, dims as number[], 'rt_bin.sldd')]).toEqual([name, [
        ['s(1)', [['a', '1'], [name, '10']]],
        ['s(2)', [['a', '99'], [name, '20']]],
      ]]);
    }
  });
});

// A struct array with no fields takes no bytes per element, so its declared size is all there
// is of it: MATLAB writes repmat(struct(), 1e4, 1e4) in 208 bytes. The node layer built a row
// per declared element, 1e8 of them, and the open ended in a fatal out-of-memory, which no
// try/catch stops and which takes a host's extension host down with it. Past
// MAX_EXPANDED_ELEMENTS it builds none, and shows the summary alone, as a dense array past it
// does. An element of it holds nothing, so no row was the only copy of anything: a copy or a
// save writes the value from the bytes it was read from.
describe('a MAT struct array with no fields, past the row cap', () => {
  const MAX = MAX_EXPANDED_ELEMENTS;
  const BIG = [1e4, 1e4];

  // MATLAB's own spelling of one: a field-name stride of 1 and an empty name block, as the
  // subsystem of fixtures/mcos/paramArray.mat spells its 1x0 structs.
  function fieldless(name: string, d: number[]): Uint8Array {
    const stride = new Uint8Array(4);
    new DataView(stride.buffer).setInt32(0, 1, true);
    return matrix([arrayFlags(CLASS.STRUCT), dims(d), varName(name), element(MI.INT32, stride), element(MI.INT8, new Uint8Array(0))]);
  }
  const opened = (...variables: Uint8Array[]): any[] => (createSession().addMatSource('s.mat', matFile(variables)) as any).children;
  const shown = (n: any) => [n.name, n.displayValue, n.children.length];
  const PREAMBLE = [0x00, 0x01, 0x49, 0x4d, 0x00, 0x00, 0x00, 0x00];
  // The stream a cdata value holds: uudecode keeps a byte of its padding (matStreamPrefix).
  const streamOf = (cdata: any) => Array.from(matStreamPrefix(uudecode(cdata._value)) ?? []);

  // `value` pasted into a fresh copy of `file`, saved, and the saved file opened again; the
  // reopened copy saved once more, untouched. The two saves' entries are compared as written:
  // the text, or the chunk a binary dictionary keeps its entries in.
  function pastedTwice(file: string, value: unknown): { entry: any; first: string; second: string; copied: unknown } {
    const written = (out: any) => (out.kind === 'text' ? out.text : strFromU8(unzipSync(out.bytes)['data/chunk0.xml']));
    const session = createSession();
    const root: any = ingest(session, sparseFixture(file), { filename: file });
    root.getSection('design').parseEntry({ name: 'pasted', metadata: { uuid: '00000000-0000-4000-e800-0000000000f1' }, value });
    const out: any = session.serializeSource(root.name);
    const again = createSession();
    const reopened: any = ingest(again, out.kind === 'text' ? out.text : out.bytes, { filename: file });
    const entry = reopened.getSection('design').children.find((e: any) => e.name === 'pasted');
    const copied = copyOf(entry);
    return { entry, first: written(out), second: written(again.serializeSource(reopened.name)), copied };
  }

  it('has a row per element up to the cap, and past it the summary alone', () => {
    expect(opened(fieldless('s', [3, 4])).map(shown)).toEqual([['s', '<3x4 struct>', 12]]);
    expect(opened(fieldless('s', [1, MAX])).map(shown)).toEqual([['s', `<1x${MAX} struct>`, MAX]]);
    expect(opened(fieldless('s', [1, MAX + 1])).map(shown)).toEqual([['s', `<1x${MAX + 1} struct>`, 0]]);
    // The size that ran the heap out, at top level, in a struct field and in a cell. Asked
    // last, so that a reader without the cap fails on the case above instead of here.
    const [s, t, c] = opened(fieldless('s', BIG), structVar('t', ['f'], [{ f: fieldless('', BIG) }]), cellVar('c', [fieldless('', BIG)]));
    expect([shown(s), shown(t.children[0]), shown(c.children[0])]).toEqual([
      ['s', '<10000x10000 struct>', 0],
      ['f', '<10000x10000 struct>', 0],
      ['1', '<10000x10000 struct>', 0],
    ]);
  });

  it('is copied as the stream of the bytes it was read from, and pastes, saves and reopens as itself', () => {
    // MATLAB's element with its name emptied, as every stream's is (MatWriter.matStreamOfElement):
    // its stride of 1 included, where MatWriter, writing the value afresh, writes 5. One past
    // the cap first, so that a reader without the cap fails here and not on the size below.
    const past = copyOf(opened(fieldless('s', [1, MAX + 1]))[0]) as any;
    expect([past._type, past._type === 'cdata' && streamOf(past)]).toEqual(['cdata', [...PREAMBLE, ...fieldless('', [1, MAX + 1])]]);
    const [s, t, c] = opened(fieldless('s', BIG), structVar('t', ['f'], [{ f: fieldless('', BIG) }]), cellVar('c', [fieldless('', BIG)]));
    const own = [...PREAMBLE, ...fieldless('', BIG)];
    const copied = copyOf(s) as any;
    expect([copied._type, streamOf(copied)]).toEqual(['cdata', own]);
    const nested = [copyOf(t) as any, copyOf(c) as any];
    expect([nested[0]._elements[0].f._type, nested[1]._elements[0]._type]).toEqual(['cdata', 'cdata']);
    expect([streamOf(nested[0]._elements[0].f), streamOf(nested[1]._elements[0])]).toEqual([own, own]);
    // Written as XML where it was read, it is the hex of the same bytes: as a value, and as a
    // cell's element, which the cell's XML writes one element at a time.
    const hexTag = (tag: string) => `<${tag} Class="struct" Encoding="hex" EncodedLength="${own.length}">`;
    expect([s.serializeXml('P', { Name: 'Value' }, 0).startsWith(hexTag('P Name="Value"')), c.serializeXml('P', { Name: 'Value' }, 0).includes(hexTag('Element'))]).toEqual([true, true]);
    for (const file of [TEXT, BINARY]) {
      const r = pastedTwice(file, copied);
      expect([shown(r.entry), r.second === r.first], file).toEqual([['pasted', '<10000x10000 struct>', 0], true]);
      const inT = pastedTwice(file, nested[0]).entry.children[0];
      const inC = pastedTwice(file, nested[1]).entry.children[0];
      expect([shown(inT), shown(inC)], file).toEqual([
        ['f', '<10000x10000 struct>', 0],
        ['1', '<10000x10000 struct>', 0],
      ]);
      if (file === BINARY) {
        // A binary dictionary holds it as the hex of the same bytes, and reads it back from them.
        const tag = r.first.slice(r.first.indexOf('<P Name="Value"', r.first.indexOf('>pasted<')));
        expect(tag.slice(0, tag.indexOf('>') + 1)).toBe(`<P Name="Value" Class="struct" Encoding="hex" EncodedLength="${own.length}">`);
        // And a copy of the entry is that hex, as read.
        expect([(r.copied as any)._type, Array.from(encodedBytes(r.copied as any).bytes ?? [])]).toEqual(['encoded', own]);
      } else {
        // A text dictionary holds the stream as read, and a copy of the entry is that stream.
        expect(r.copied).toEqual(copied);
      }
    }
  });

  // arr(3).Value of fixtures/mcos/paramArray.mat, MATLAB's struct('a', 1), respelled in
  // place as a struct array of `d` with an empty name block (the bytes after it, its field
  // `a`'s, are left where they are and are not read): its dims, its name, its stride of 5,
  // its name block of 5 bytes.
  const paramStruct = (d: number[], names: number) =>
    Uint8Array.from([5, 0, 0, 0, 8, 0, 0, 0, ...new Uint8Array(Int32Array.from(d).buffer), 1, 0, 0, 0, 0, 0, 0, 0, 5, 0, 4, 0, 5, 0, 0, 0, 1, 0, 0, 0, names, 0, 0, 0, 0x61]);
  const paramArray = new Uint8Array(readFileSync(new URL('./fixtures/mcos/paramArray.mat', import.meta.url)));
  const paramRespelled = (d: number[], names = 0) => {
    const out = renameInMat(paramArray, paramStruct([1, 1], 5), paramStruct(d, names));
    expect(out.hits).toBe(1);
    return out.bytes;
  };
  // arr(3)'s Value as the decoder hands it over, and the Parameter array opened as a host opens it.
  function paramValue(d: number[]): any {
    const { variables } = parseMat(paramRespelled(d));
    const anon = variables.find((v: any) => v._anonymous)!;
    const decoded = decodeMcosBlob(anon._rawBytes!, [{ name: 'arr', className: variables[0].className, rawBytes: variables[0]._rawBytes }]);
    return decoded.get('arr')!.elements[2].Value;
  }
  const paramOpened = (d: number[], names = 0): any =>
    (createSession().addMatSource('paramArray.mat', paramRespelled(d, names)) as any).children.find((c: any) => c.name === 'arr');
  const decodedOf = (cdata: any) => {
    const stream = decodeMatStream(uudecode(cdata._value));
    return stream.ok && [stream.variable.className, stream.variable.dimensions, stream.variable.fields];
  };

  // fixtures/sparse/hexobj_binary.sldd's `holder`, a hex value of class
  // dexsparse.HolderAlias whose S is struct('a', …, 'b', …): respelled, in its stream, as a
  // struct array of `d` with an empty name block, the way paramStruct respells one.
  const holderParts = unzipSync(new Uint8Array(sparseFixture('hexobj_binary.sldd')));
  const holderChunk = strFromU8(holderParts['data/chunk0.xml']);
  const holderAt = holderChunk.indexOf('<P Name="Value"', holderChunk.indexOf('<P Name="Name" Class="char">holder</P>'));
  const holderTag = holderChunk.slice(holderAt, holderChunk.indexOf('</P>', holderAt) + 4);
  const holderRead = Uint8Array.from(holderTag.replace(/^<P[^>]*>/, '').replace(/<\/P>$/, '').replace(/\s+/g, '').match(/../g)!.map((h) => parseInt(h, 16)));
  function holderRespelled(d: number[]): Uint8Array {
    const from = [5, 0, 0, 0, 8, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 5, 0, 4, 0, 3, 0, 0, 0, 1, 0, 0, 0, 6, 0, 0, 0];
    const bytes = holderRead.slice();
    const to = [...from.slice(0, 8), ...new Uint8Array(Int32Array.from(d).buffer), ...from.slice(16, 36), 0, 0, 0, 0];
    let hits = 0;
    for (let i = 0; i + from.length <= bytes.length; i++) {
      if (from.every((b, j) => bytes[i + j] === b)) {
        bytes.set(to, i);
        hits++;
      }
    }
    expect(hits).toBeGreaterThan(0);
    return bytes;
  }
  // The dictionary with `holder` holding `bytes` as its hex, opened as a host opens it.
  function holderOpened(bytes: Uint8Array): { session: any; root: any; holder: any; digits: string } {
    const digits = Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
    const chunk = holderChunk.replace(holderTag, holderTag.slice(0, holderTag.indexOf('>') + 1) + digits + '</P>');
    const zip = zipSync({ ...holderParts, 'data/chunk0.xml': new TextEncoder().encode(chunk) });
    const session = createSession();
    const root: any = ingest(session, zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer, { filename: 'hexobj_binary.sldd' });
    return { session, root, holder: root.getSection('design').children.find((e: any) => e.name === 'holder'), digits };
  }

  it('as a property of an object, is handed over as the stream of its bytes, not laid out an element at a time', () => {
    // One element past the parser's own bound on elements no byte holds: the decoder laid a
    // bag out for each of them.
    const value = paramValue([1, 1_000_001]);
    expect(value._type).toBe('cdata');
    expect(decodedOf(value)).toEqual(['struct', [1, 1_000_001], {}]);

    // The size that ran the heap out, opened as a host opens it, and copied: the Parameter
    // shows its Value's summary and has no Value row, its Value having no row to show, and a
    // copy of it carries the Value as its stream.
    const arr = paramOpened(BIG);
    expect(shown(arr.children[2])).toEqual(['2', '<10000x10000 struct>', 0]);
    const copiedValue = (copyOf(arr) as any)._elements[2]._properties.Value;
    expect([copiedValue._type, decodedOf(copiedValue)]).toEqual(['cdata', ['struct', BIG, {}]]);

    // And with its field kept: 2,000,000 elements and no bytes for them, the struct the
    // declared-size guard records as not decoded. Laid out a bag at a time it ran the heap out
    // the same way, past the guard.
    const guarded = paramOpened([1, 2_000_000], 5);
    expect(shown(guarded.children[2])).toEqual(['2', '<1x2000000 struct, not decoded>', 0]);
  });

  it('in a binary dictionary\'s hex object, opens as its summary and is written back as read', () => {
    // The decoder first, one element past the parser's own bound on elements no byte holds.
    const stream: any = decodeMatStream(holderRespelled([1, 1_000_001]));
    const decoded = decodeMcosVariables(stream.trailingElements[0], [stream.variable]).get(stream.variable)!;
    expect((decoded.properties.S as any)?._type).toBe('cdata');

    // The size that ran the heap out, opened as a host opens the dictionary.
    const bytes = holderRespelled(BIG);
    const { session, root, holder, digits } = holderOpened(bytes);
    expect(shown(holder.children.find((c: any) => c.name === 'S'))).toEqual(['S', '<10000x10000 struct>', 0]);
    // Untouched, the entry is saved and copied as the hex it was read as.
    expect(strFromU8(unzipSync((session.serializeSource(root.name) as any).bytes)['data/chunk0.xml'])).toContain(digits);
    expect(Array.from(encodedBytes(copyOf(holder) as any).bytes ?? [])).toEqual(Array.from(bytes));
  });
  // The handover above began past MAX_UNBACKED_ELEMENTS, the parser's bound on elements no byte
  // holds, and the row cap is MAX_EXPANDED_ELEMENTS. Between the two the decoder still laid a
  // bag out per element and StructNode built a row per bag: a Parameter whose Value was
  // 1x1,000,000 ran a 512 MB heap out, and a binary dictionary of eight such hex objects a 4 GB
  // one. So the handover begins where the rows end, on this route as on the .mat route.
  it('as a property of an object, is handed over as its stream wherever the .mat route has no rows for it', () => {
    // At the cap it is laid out by the decoder, as before: a Value row, a StructNode, with a
    // row per element.
    const atCap = paramOpened([1, MAX]);
    expect([shown(atCap.children[2]), shown(atCap.children[2].children[0])]).toEqual([
      ['2', `<1x${MAX} struct>`, 1],
      ['Value', `<1x${MAX} struct>`, MAX],
    ]);
    expect(atCap.children[2].children[0]).toBeInstanceOf(StructNode);
    // One past it, handed over as its stream: the Parameter shows its Value's summary, as at
    // 1e4x1e4, and a copy of it carries the Value as the stream.
    const value = paramValue([1, MAX + 1]);
    expect([value._type, value._type === 'cdata' && decodedOf(value)]).toEqual(['cdata', ['struct', [1, MAX + 1], {}]]);
    const past = paramOpened([1, MAX + 1]);
    expect(shown(past.children[2])).toEqual(['2', `<1x${MAX + 1} struct>`, 0]);
    const copiedValue = (copyOf(past) as any)._elements[2]._properties.Value;
    expect([copiedValue._type, decodedOf(copiedValue)]).toEqual(['cdata', ['struct', [1, MAX + 1], {}]]);
    // The size that ran the heap out, asked last.
    expect(shown(paramOpened([1, 1_000_000]).children[2])).toEqual(['2', '<1x1000000 struct>', 0]);
  });

  it('in a binary dictionary\'s hex object, is handed over as its stream wherever the .mat route has no rows for it', () => {
    const S = (holder: any) => holder.children.find((c: any) => c.name === 'S');
    // At the cap it is laid out by the decoder, as before: a StructNode with a row per element.
    const atCap = S(holderOpened(holderRespelled([1, MAX])).holder);
    expect([shown(atCap), atCap instanceof StructNode]).toEqual([['S', `<1x${MAX} struct>`, MAX], true]);
    const bytes = holderRespelled([1, MAX + 1]);
    const { session, root, holder, digits } = holderOpened(bytes);
    expect(shown(S(holder))).toEqual(['S', `<1x${MAX + 1} struct>`, 0]);
    expect(strFromU8(unzipSync((session.serializeSource(root.name) as any).bytes)['data/chunk0.xml'])).toContain(digits);
    expect(Array.from(encodedBytes(copyOf(holder) as any).bytes ?? [])).toEqual(Array.from(bytes));
    // The size that ran the heap out, asked last.
    expect(shown(S(holderOpened(holderRespelled([1, 1_000_000])).holder))).toEqual(['S', '<1x1000000 struct>', 0]);
  });

  it('as a cell\'s element, is copied as the bytes it was read from at every size past the cap', () => {
    // A cell element keeps the bytes it was read from where something is written from them, and
    // for this array it kept them only past MAX_UNBACKED_ELEMENTS: below that its copy was
    // MatWriter's, a stride of 5, where the top-level array's and a struct field's are the
    // bytes as read, a stride of 1.
    const [t, c] = opened(structVar('t', ['f'], [{ f: fieldless('', [1, MAX + 1]) }]), cellVar('c', [fieldless('', [1, MAX + 1])]));
    const own = [...PREAMBLE, ...fieldless('', [1, MAX + 1])];
    const [inT, inC] = [(copyOf(t) as any)._elements[0].f, (copyOf(c) as any)._elements[0]];
    expect([inT._type, inC._type]).toEqual(['cdata', 'cdata']);
    expect([streamOf(inT), streamOf(inC)]).toEqual([own, own]);
  });
  // Add Child adds a field to every element row, and past the cap there is none: the row it
  // made held the only copy of the edit, and the save, which writes such an array from the
  // bytes it was read from, dropped it. So it is refused, as a sparse array's is. Up to the cap
  // it is offered as before.
  it('takes no Add Child past the cap, where there is no element row to add a field to', () => {
    expect(opened(fieldless('s', [1, MAX]))[0].canAddChild()).toBe(true);
    for (const d of [[1, MAX + 1], BIG]) {
      const [s] = opened(fieldless('s', d));
      expect([s.canAddChild(), s.execAddChild(), s.children.length], String(d)).toEqual([false, null, 0]);
    }
    // Nor read back out of a dictionary it was pasted into, where the entry stays as it was.
    const copied = copyOf(opened(fieldless('s', [1, MAX + 1]))[0]);
    for (const file of [TEXT, BINARY]) {
      const { entry } = pastedTwice(file, copied);
      const status = entry.status;
      expect([entry.canAddChild(), entry.execAddChild(), entry.children.length, entry.status], file).toEqual([false, null, 0, status]);
    }
  });
});
