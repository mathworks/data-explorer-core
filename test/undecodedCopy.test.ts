// Copyright 2026 The MathWorks, Inc.
//
// A value the reader recorded without decoding, out of a .mat file or a model workspace, holds
// nothing this package can write: it opens as what was read of it, `<2x3 double, not decoded>`,
// its class and size, and no value. Its copy was the text of that placeholder. Pasted into a
// text or a binary dictionary and saved, it opened again as a CHAR, '<2x3 double, not decoded>',
// and a struct whose field names lie past its end as a valid 1x3 struct of no elements: wrong
// data in both formats, with nothing to say so. A text dictionary's own value that did not
// decode, pasted into a binary one, was written as `Class="double"` around the same text, and
// opened again as the double 0.
//
// The maintainer's group F ruling of 2026-10-18 (F1-10; theme 1: a save the writer cannot spell
// is refused rather than written wrong) makes each of those a refusal: final, as a budget refusal
// is (MatBudgetError, reason 'not-decoded'), naming the entry, the path and why the value was not
// decoded, with nothing written in its place. A dictionary's own value that did not decode is
// written as the cdata or the hex it was read from, as before, and a decoded value is copied as
// it was.
//
// Each value is built byte by byte (test/tools/matBytes.ts), so a failure here is about the
// damage and not about a fixture.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { decodeMatStream } from '../src/datamodel/parser/MatParser.js';
import { uuencode } from '../src/datamodel/parser/CdataCodec.js';
import { encodeMatStream } from '../src/datamodel/parser/MatWriter.js';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import { MatBudgetError, createSession, ingest } from '../src/index.js';
import { CLASS, MI, arrayFlags, cellVar, dims, element, matFile, matrix, mxArrayFile, numericVar, structVar, varName } from './tools/matBytes.js';
import * as matBytes from './tools/matBytes.js';
import { BINARY, TEXT, copyOf, pasteSaveReopen, sparseFixture, thrownBy } from './tools/pasteVenues.js';
import { holder, members, ndUndecodedCopyReadback } from './parity/matlab/nd_undecoded_copy_readback.mjs';

/** A file under test/, as bytes. */
const testFile = (path: string): Uint8Array => new Uint8Array(readFileSync(fileURLToPath(new URL(`./${path}`, import.meta.url))));
const arrayBufferOf = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const one = (n: number) => numericVar({ name: '', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [n] });
const ok = () => numericVar({ name: 'ok', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [7] });
const tail = () => numericVar({ name: 'tail', cls: CLASS.DOUBLE, dimensions: [1, 2], real: [1, 2] });

/**
 * Each value the reader records without decoding: what it is built from, what it is (its size
 * and the class its row shows), and why it was not decoded — the reader's own reason, or the
 * one its warning gives for a value that holds no data. `named` is whether the value carries
 * a name of its own, as a .mat variable does and a field, an element or a workspace
 * variable does not; a struct's reason counts its bytes, the name's among them.
 */
interface Kind {
  label: string;
  build: (name: string) => Uint8Array;
  what: string;
  why: (named: boolean) => string | null;
}

const KINDS: Kind[] = [
  {
    label: 'a 2x3 double with no payload',
    build: (name) => matrix([arrayFlags(CLASS.DOUBLE), dims([2, 3]), varName(name)]),
    what: 'a 2x3 double',
    why: () => 'it declares 6 element(s) and holds no data',
  },
  {
    label: 'a 1x3 double whose payload has no width',
    build: (name) => numericVar({ name, cls: CLASS.DOUBLE, dimensions: [1, 3], dataType: MI.UTF8, real: [], rawReal: new Uint8Array(8) }),
    what: 'a 1x3 double',
    why: () => 'its real part is of MAT data type 16, which has no element width, so none of its 3 elements can be read',
  },
  {
    label: 'a 1000000x1000 double declaring more than its bytes hold',
    build: (name) => matrix([arrayFlags(CLASS.DOUBLE), dims([1000000, 1000]), varName(name), element(MI.DOUBLE, new Uint8Array(8))]),
    what: 'a 1000000x1000 double',
    why: () => 'declares 1000000000 elements, more than the 16 bytes left in it can hold',
  },
  {
    label: 'a class-3 object',
    build: (name) => matrix([arrayFlags(CLASS.OBJECT), dims([1, 1]), varName(name)]),
    what: 'a 1x1 object',
    why: () => 'MAT array class 3, the pre-MCOS object: recorded but not decoded, because no MATLAB-authored fixture in this corpus pins its layout',
  },
  {
    label: 'a 1x3 struct whose field names lie past its end',
    build: (name) => {
      const stride = new Uint8Array(4);
      new DataView(stride.buffer).setInt32(0, 32, true);
      return matrix([arrayFlags(CLASS.STRUCT), dims([1, 3]), varName(name), element(MI.INT32, stride)]);
    },
    what: 'a 1x3 struct',
    why: (named) => `its field names lie past the end of its ${named ? 64 : 56} bytes`,
  },
  {
    label: 'a 1x3 struct whose element 2\'s field is not a matrix',
    build: (name) => structVar(name, ['a', 'b'], [{ a: one(1), b: one(2) }, { a: element(MI.DOUBLE, new Uint8Array(8)), b: one(4) }, { a: one(5), b: one(6) }], [1, 3]),
    what: 'a 1x3 struct',
    why: () => "element 2's field a is not a matrix (a data element of type 9)",
  },
];

/** A complex double, 3+4i, whose flags word is overwritten with class 255 and every flag set. */
const flagsOverwritten = (name: string): Uint8Array => {
  const z = numericVar({ name, cls: CLASS.DOUBLE, dimensions: [1, 1], real: [3], imag: [4] }).slice();
  new DataView(z.buffer).setUint32(16, 0xffffffff, true);
  return z;
};
const UNMODELLED = 'its MAT array class is not one this reader models';

/** The refusal of a write of `path`, `what`, in entry `entry`, that was not decoded for `why`. */
const refusal = (entry: string, path: string, what: string, why: string | null) =>
  `Cannot write "${entry}": ${path} is ${what} that was not decoded${why === null ? '' : ` (${why})`}, so there is no value of it to write. Nothing was written.`;

/** What `f` threw, as a host meets it: its class, whether it is final, its reason, entry and path, and its message. */
function thrown(f: () => unknown): unknown[] {
  const [e] = thrownBy(f);
  const b = e as MatBudgetError | null;
  return [e?.name, e instanceof MatBudgetError, b?.reason, b?.entry, b?.at, e?.message];
}
const refused = (entry: string, path: string, what: string, why: string | null) => [
  'MatBudgetError', true, 'not-decoded', entry, path, refusal(entry, path, what, why),
];

const openedMat = (name: string, variables: Uint8Array[]): any => createSession().addMatSource(name, matFile(variables));

/** A model workspace holding `variables`, each a field of the workspace struct: cases.slx with its workspace part replaced. */
function openedWorkspace(variables: Record<string, Uint8Array>): any {
  const ws = structVar('', Object.keys(variables), [variables]);
  const entries = unzipSync(testFile('parity/artifacts/slx/cases.slx'));
  expect(Object.keys(entries)).toContain('simulink/modelWorkspace.mxarray');
  entries['simulink/modelWorkspace.mxarray'] = new Uint8Array(mxArrayFile(ws.subarray(8)));
  const model: any = createSession().addModelSource('cases.slx', arrayBufferOf(zipSync(entries)));
  return model.children.find((s: any) => s.name === 'workspace');
}

describe('a value the reader did not decode is refused when copied, and nothing is written in its place', () => {
  for (const kind of KINDS) {
    it(`${kind.label}, a .mat variable: its copy is refused, so it is never pasted, and the variables beside it copy as before`, () => {
      const mat = openedMat('t.mat', [ok(), kind.build('x'), tail()]);
      const [o, x, t] = mat.children;
      expect([x.name, x.displayValue, x.className, x.valueEditable]).toEqual(['x', `<${kind.what.slice(2)}, not decoded>`, kind.what.split(' ')[2], false]);
      // Before: the copy was the text of its placeholder.
      expect(thrown(() => x.serialize())).toEqual(refused('x', 'x', kind.what, kind.why(true)));
      // A host pastes what the copy gave it; there is nothing to paste. Before: the paste was
      // saved and opened again as the char '<2x3 double, not decoded>', or as a struct of no
      // elements, in a text and a binary dictionary alike.
      for (const file of [TEXT, BINARY]) {
        expect(thrown(() => pasteSaveReopen(file, copyOf(x))), file).toEqual(refused('x', 'x', kind.what, kind.why(true)));
      }
      const control = openedMat('control.mat', [ok(), tail()]);
      expect([copyOf(o), copyOf(t)]).toEqual(control.children.map(copyOf));
      expect(copyOf(o)).toBe(7);
    });

    it(`${kind.label}, a struct's field and a cell's element: the copy of each, and of what holds it, is refused, naming its path`, () => {
      const s = openedMat('s.mat', [structVar('s', ['f', 'g'], [{ f: kind.build(''), g: one(2) }])]).children[0];
      const c = openedMat('c.mat', [cellVar('c', [one(1), kind.build('')])]).children[0];
      const [f] = s.children;
      const [, e] = c.children;
      expect([f.displayValue, e.displayValue]).toEqual([`<${kind.what.slice(2)}, not decoded>`, `<${kind.what.slice(2)}, not decoded>`]);
      // Before: s copied with `f` the placeholder's text, and c with its second element so.
      expect(thrown(() => s.serialize())).toEqual(refused('s', 's.f', kind.what, kind.why(false)));
      expect(thrown(() => f.serialize())).toEqual(refused('s', 's.f', kind.what, kind.why(false)));
      expect(thrown(() => c.serialize())).toEqual(refused('c', 'c{2}', kind.what, kind.why(false)));
      expect(thrown(() => e.serialize())).toEqual(refused('c', 'c{2}', kind.what, kind.why(false)));
      for (const file of [TEXT, BINARY]) {
        expect(thrown(() => pasteSaveReopen(file, copyOf(s))), file).toEqual(refused('s', 's.f', kind.what, kind.why(false)));
      }
      // The decoded values beside it copy as they did (a member's serialize() is its value).
      expect([s.children[1].serialize(), c.children[0].serialize()]).toEqual([2, 1]);
    });

    it(`${kind.label}, a model workspace variable: its copy is refused, and the one beside it copies as before`, () => {
      const workspace = openedWorkspace({ ok: one(7), x: kind.build('') });
      const [o, x] = workspace.children;
      expect(x.displayValue).toBe(`<${kind.what.slice(2)}, not decoded>`);
      expect(thrown(() => x.serialize())).toEqual(refused('x', 'x', kind.what, kind.why(false)));
      for (const file of [TEXT, BINARY]) {
        expect(thrown(() => pasteSaveReopen(file, copyOf(x))), file).toEqual(refused('x', 'x', kind.what, kind.why(false)));
      }
      expect(o.serialize().value).toBe(7);
    });
  }

  it('a variable whose flags word is overwritten, and a cell and a struct shown as not decoded for holding one: each copy is refused', () => {
    // Its class is one the reader does not model, so no arm read it, and what holds it is
    // shown not decoded as a whole (MatNode.fromParsed, ModelSectionNode.addWorkspaceEntry).
    const mat = openedMat('t.mat', [ok(), flagsOverwritten('z'), cellVar('c', [flagsOverwritten(''), one(5)]), structVar('s', ['a'], [{ a: flagsOverwritten('') }]), tail()]);
    const [, z, c, s] = mat.children;
    expect([z, c, s].map((n: any) => n.displayValue)).toEqual(['<1x1 unknown, not decoded>', '<1x2 cell, not decoded>', '<1x1 struct, not decoded>']);
    expect(thrown(() => z.serialize())).toEqual(refused('z', 'z', 'a 1x1 unknown', UNMODELLED));
    expect(thrown(() => c.serialize())).toEqual(refused('c', 'c', 'a 1x2 cell', null));
    expect(thrown(() => s.serialize())).toEqual(refused('s', 's', 'a 1x1 struct', null));
    const workspace = openedWorkspace({ ok: one(7), z: flagsOverwritten('') });
    expect(thrown(() => workspace.children[1].serialize())).toEqual(refused('z', 'z', 'a 1x1 unknown', UNMODELLED));
  });

  it('a value nested more than 128 levels deep: the copy of the chain, and of the value at level 129, is refused at it', () => {
    const chain = (levels: number): Uint8Array => (levels === 1 ? one(7) : cellVar('', [chain(levels - 1)]));
    const x = openedMat('deep.mat', [ok(), cellVar('x', [chain(129)]), tail()]).children[1];
    let cut = x;
    while (cut.children.length > 0) {
      cut = cut.children[0];
    }
    const path = 'x' + '{1}'.repeat(128);
    expect([cut.matlabPath, cut.displayValue]).toEqual([path, '<1x1 cell, not decoded>']);
    const why = 'nested more than 128 levels deep, so it was not read';
    // Before: the chain copied with the placeholder's text 128 levels down.
    expect(thrown(() => x.serialize())).toEqual(refused('x', path, 'a 1x1 cell', why));
    expect(thrown(() => cut.serialize())).toEqual(refused('x', path, 'a 1x1 cell', why));
  });
});

describe('as XML, a value with nothing to write but its placeholder is refused, never written as the placeholder', () => {
  const PREAMBLE = [0x00, 0x01, 0x49, 0x4d, 0x00, 0x00, 0x00, 0x00];
  // A complex 1x2 double whose bytes end after its name, as a MAT stream.
  const stream = Uint8Array.from([...PREAMBLE, ...numericVar({ name: '', cls: CLASS.DOUBLE, dimensions: [1, 2], real: [], imag: [], omitData: true })]);

  /** fixtures/sparse/sparse_text.sldd with its entry c's value the cdata of `stream`, and that entry. */
  function textWithStream(): { json: any; root: any; c: any } {
    const json = JSON.parse(strFromU8(testFile('fixtures/sparse/sparse_text.sldd')));
    const entries = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    entries.find((e: any) => e.name === 'c').value = { _type: 'cdata', _value: uuencode(stream) };
    const session = createSession();
    const root: any = session.addDataSource('sparse_text.sldd', JSON.parse(JSON.stringify(json)));
    return { json, root, c: root.getSection('design').children.find((e: any) => e.name === 'c') };
  }

  it('a text dictionary\'s value that did not decode, pasted into a binary one: refused, naming the pasted entry; into a text one, as read', () => {
    const decoded = decodeMatStream(stream);
    expect(decoded.ok && [decoded.variable.isComplex, decoded.variable.value]).toEqual([true, null]);
    const { c } = textWithStream();
    expect([c.displayValue, c.valueEditable]).toEqual(['<1x2 double, not decoded>', false]);
    // The copy is the cdata it was read from, as before.
    const copied = copyOf(c);
    expect(copied).toEqual({ _type: 'cdata', _value: uuencode(stream) });
    // Before: written as `<P Name="Value" Class="double">` around the placeholder's text, and
    // opened again as the double 0.
    expect(thrown(() => pasteSaveReopen(BINARY, copied))).toEqual(
      refused('pasted', 'pasted', 'a 1x2 double', 'it declares 2 element(s) and holds no data'),
    );
    const text = pasteSaveReopen(TEXT, copied);
    expect([text.entry.displayValue, copyOf(text.entry)]).toEqual(['<1x2 double, not decoded>', copied]);
  });

  it('a node built with no stream of its own: refused, naming it', () => {
    const node = MatlabVariableNode._createUndecoded(
      {
        name: '', className: 'double', dimensions: [10000000, 2], isComplex: false, isLogical: false, isSparse: true,
        value: '<10000000x2 sparse double, not decoded>', undecoded: 'too large', fields: null,
      },
      'spTall',
      null,
    );
    // Before: `<P Name="Value" Class="double">&lt;10000000x2 sparse double, not decoded&gt;</P>`.
    expect(thrown(() => node.serializeXml('P', { Name: 'Value' }, 2))).toEqual(refused('spTall', 'spTall', 'a 10000000x2 sparse double', 'too large'));
    expect(thrown(() => node.serializeValue())).toEqual(refused('spTall', 'spTall', 'a 10000000x2 sparse double', 'too large'));
  });
});

describe('what is written as it was', () => {
  it('a dictionary\'s own value that did not decode copies and saves as read: a text dictionary\'s cdata, a binary one\'s hex', () => {
    const PREAMBLE = [0x00, 0x01, 0x49, 0x4d, 0x00, 0x00, 0x00, 0x00];
    const stream = Uint8Array.from([...PREAMBLE, ...numericVar({ name: '', cls: CLASS.DOUBLE, dimensions: [2, 3], real: [], omitData: true })]);
    const json = JSON.parse(strFromU8(testFile('fixtures/sparse/sparse_text.sldd')));
    const entries = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const entry = entries.find((e: any) => e.name === 'c');
    entry.value = { _type: 'cdata', _value: uuencode(stream) };
    const text = createSession();
    const textRoot: any = text.addDataSource('sparse_text.sldd', JSON.parse(JSON.stringify(json)));
    const c = textRoot.getSection('design').children.find((e: any) => e.name === 'c');
    expect(c.displayValue).toBe('<2x3 double, not decoded>');
    expect(copyOf(c)).toEqual(entry.value);
    const saved = JSON.parse(text.serializeSource(textRoot.name)!.text!);
    expect(saved.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: any) => e.name === 'c').value).toEqual(entry.value);
    expect(pasteSaveReopen(TEXT, copyOf(c)).entry.displayValue).toBe('<2x3 double, not decoded>');

    const parts = unzipSync(testFile('fixtures/sparse/sparse_binary.sldd'));
    const chunk = strFromU8(parts['data/chunk0.xml']);
    const at = chunk.indexOf('<P Name="Value" Class="cell" Encoding="hex"', chunk.indexOf('<P Name="Name" Class="char">c</P>'));
    expect(at).toBeGreaterThan(0);
    const digits = Array.from(stream, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
    const tag = `<P Name="Value" Class="double" Encoding="hex" EncodedLength="${stream.length}">`;
    const zip = zipSync({ ...parts, 'data/chunk0.xml': strToU8(chunk.slice(0, at) + tag + digits + chunk.slice(chunk.indexOf('</P>', at))) });
    const binary = createSession();
    const binaryRoot: any = ingest(binary, arrayBufferOf(zip), { filename: 'sparse_binary.sldd' });
    const h = binaryRoot.getSection('design').children.find((e: any) => e.name === 'c');
    expect(h.displayValue).toBe('<2x3 double, not decoded>');
    expect(strFromU8(unzipSync((binary.serializeSource(binaryRoot.name) as any).bytes)['data/chunk0.xml'])).toContain(tag + digits + '</P>');
    const pasted = pasteSaveReopen(BINARY, copyOf(h));
    expect([pasted.written, pasted.entry.displayValue]).toEqual([tag, '<2x3 double, not decoded>']);
  });

  it('a decoded value out of a .mat and a model workspace copies as before, and pastes as itself', () => {
    const mat = openedMat('t.mat', [ok(), tail(), cellVar('c', [one(1), one(2)])]);
    expect(mat.children.map(copyOf)).toEqual([
      7,
      [1, 2],
      { _array_type: 'Cell', _dimensions: [1, 2], _elements: [1, 2], _mw_element_type: 'MATLABArray' },
    ]);
    for (const file of [TEXT, BINARY]) {
      expect(pasteSaveReopen(file, copyOf(mat.children[0])).entry.displayValue, file).toBe('7');
      expect(pasteSaveReopen(file, copyOf(mat.children[1])).entry.displayValue, file).toBe('[1 2]');
    }
    const workspace = openedWorkspace({ ok: one(7) });
    expect(workspace.children[0].serialize().value).toBe(7);
  });
});

// B-11 (group H). An N-D cell or struct out of a .mat or a model workspace that holds a value the
// reader did not decode has a member with nothing to copy, as a rank-2 one has. #138 left it copying
// as its whole MAT stream, with the member's own bytes in it where the member is a sparse array whose
// values the file does not hold (F1-5). The copy is refused now, but only by the check _matStream
// makes after the encode (_matWritable, from #132): serializeValue then goes on to the member, which
// throws _undecodedRefusal. Without that check a struct member the reader did not decode is encoded
// into the stream as well, and no test held the copy to the refusal. MATLAB was asked first (theme 2;
// parity/matlab/probe_nd_undecoded_copy_readback.m, R2027a): the stream does not always read back as
// MATLAB loads the variable. A 1x1x2 struct whose member's values are absent read back from a text
// dictionary as a 1x0 double, and from a binary one not at all, and nothing in the bytes tells such a
// stream from one that reads back. So the copy stays refused, naming the member, as the ruling F1-10
// refuses the member's own copy (theme 1: a save the writer cannot spell is refused rather than
// written wrong).
// Each refusal names it as its row does, a sparse array (B-13).
const SPARSE_UNREAD: { key: 'absent' | 'widthless' | 'short'; label: string; why: string; what: string }[] = [
  { key: 'absent', label: 'a 3x4 sparse double whose values are absent', why: 'its indices place 4 non-zero(s) and its bytes end before their real part', what: 'a 3x4 sparse double' },
  {
    key: 'widthless',
    label: 'a 3x4 sparse double whose values are of a type with no width',
    why: 'its real part is of MAT data type 16, which has no element width, so none of its 4 elements can be read',
    what: 'a 3x4 sparse double',
  },
  { key: 'short', label: 'a 3x4 sparse double holding 2 of its 4 values', why: 'its real part holds 2 of the 4 values its indices place', what: 'a 3x4 sparse double' },
];

/** What a copy of `node` threw, after checking it is the refusal of a write of `path` in `entry` for a value not decoded for `why`. */
function refusedAt(node: any, entry: string, path: string, why: string): unknown[] {
  const got = thrown(() => node.serialize());
  expect(got.slice(0, 5)).toEqual(['MatBudgetError', true, 'not-decoded', entry, path]);
  expect(got[5]).toContain(`Cannot write "${entry}": ${path} is a `);
  expect(got[5]).toContain(` that was not decoded (${why}), so there is no value of it to write. Nothing was written.`);
  return got;
}

describe('an N-D cell or struct holding a value the reader did not decode: its copy is refused at that value, never written as its MAT stream (B-11)', () => {
  const builds = [
    ...KINDS.map((k) => ({ label: k.label, build: () => k.build(''), why: k.why(false) as string, what: k.what })),
    ...SPARSE_UNREAD.map((k) => ({ label: k.label, build: members(matBytes)[k.key], why: k.why, what: k.what })),
  ];
  for (const k of builds) {
    it(`${k.label}, element 2 of a 1x1x2 cell and of a 1x1x2 struct out of a .mat and a model workspace: each copy is refused at it`, () => {
      const c = openedMat('c.mat', [holder(matBytes, 'cell', 'c', k.build())]).children[0];
      const s = openedMat('s.mat', [holder(matBytes, 'struct', 's', k.build())]).children[0];
      const e = c.children[1];
      const f = s.children[1].children[0];
      expect([c.dims, c.displayValue, s.dims, s.displayValue]).toEqual([[1, 1, 2], '<1x1x2 cell>', [1, 1, 2], '<1x1x2 struct>']);
      expect([e.displayValue, f.displayValue].every((v: string) => v.endsWith(', not decoded>'))).toBe(true);
      // Before: a cell or a struct holding one of the sparse arrays copied as its MAT stream, the
      // array's own bytes in it, which MATLAB does not always read back as it was (below).
      const atCell = refusedAt(c, 'c', 'c{2}', k.why);
      const atStruct = refusedAt(s, 's', 's(2).f', k.why);
      // The member's own refusal, restated for the copy of what holds it.
      expect([atCell, atStruct]).toEqual([thrown(() => e.serialize()), thrown(() => f.serialize())]);
      if (k.what) {
        expect([atCell, atStruct]).toEqual([refused('c', 'c{2}', k.what, k.why), refused('s', 's(2).f', k.what, k.why)]);
      }
      // A host pastes what the copy gave it; there is nothing to paste.
      for (const file of [TEXT, BINARY]) {
        expect(thrown(() => pasteSaveReopen(file, copyOf(c))), file).toEqual(atCell);
        expect(thrown(() => pasteSaveReopen(file, copyOf(s))), file).toEqual(atStruct);
      }
      const workspace = openedWorkspace({ ok: one(7), x: holder(matBytes, 'cell', '', k.build()), y: holder(matBytes, 'struct', '', k.build()) });
      const [o, x, y] = workspace.children;
      refusedAt(x, 'x', 'x{2}', k.why);
      refusedAt(y, 'y', 'y(2).f', k.why);
      expect(o.serialize().value).toBe(7);
    });
  }

  it('a 3x4 sparse double that decodes, in the same places: the copy is its MAT stream, as before, and pastes as the cell or struct it is', () => {
    for (const shape of ['cell', 'struct'] as const) {
      const v = openedMat('v.mat', [holder(matBytes, shape, 'v', members(matBytes).intact())]).children[0];
      const copied = copyOf(v) as { _type: string; _value: string };
      expect(copied._type, shape).toBe('cdata');
      for (const file of [TEXT, BINARY]) {
        const { entry } = pasteSaveReopen(file, copied);
        const member = shape === 'cell' ? entry.children[1] : entry.children[1].children[0];
        expect([entry.displayValue, member.displayValue, member.children.map((n: any) => n.displayValue)], `${shape} ${file}`).toEqual([
          `<1x1x2 ${shape}>`,
          '<3x4 sparse double>',
          ['10', '11', '20', '30'],
        ]);
      }
    }
  });
});

describe('MATLAB reads the stream such a cell or struct copied as back as it loads the variable in some cases and not in others (B-11)', () => {
  type Read = { class?: string; size?: number[]; first?: number; member?: { class: string; size: number[]; sparse: boolean; nnz: number; values: number[] }; error?: string };
  type Row = { id: string; kind: string; shape: string; file: string; format: string; fragment: string; loaded: Read; matlab: Read };
  const TRUTH: { release: string; cases: Row[] } = JSON.parse(readFileSync(fileURLToPath(new URL('./parity/matlab/nd_undecoded_copy_readback.truth.json', import.meta.url)), 'utf8'));
  const read = (rel: string) => testFile('fixtures/' + rel);
  const { files, cases } = ndUndecodedCopyReadback({ createSession, ingest, uuencode, encodeMatStream }, matBytes, read);

  it('each stream is the one MATLAB was asked about: the control as it is copied, each other as MatWriter encodes it', () => {
    expect(TRUTH.release).toBe('2027a');
    expect(cases.length).toBe(16);
    expect(cases.map((c: any) => [c.file, c.fragment])).toEqual(TRUTH.cases.map((c) => [c.file, c.fragment]));
  });

  it('a 1x1x2 struct whose member\'s values are absent does not read back as it loads; the control and the rest do', () => {
    const differs = TRUTH.cases.filter((c) => JSON.stringify(c.loaded) !== JSON.stringify(c.matlab));
    expect(differs.map((c) => c.file)).toEqual(['absent_struct_text.sldd', 'absent_struct_binary.sldd']);
    expect(differs[0].matlab).toEqual({ class: 'double', size: [1, 0] });
    expect(differs[1].matlab.error).toBe('Unable to read data stream because the data contains a bad version or endian-key');
    const member = (id: string) => TRUTH.cases.find((c) => c.id === id)!.loaded.member;
    expect(member('intact_cell')).toEqual({ class: 'double', size: [3, 4], sparse: true, nnz: 4, values: [10, 11, 0, 0, 0, 20, 0, 0, 0, 0, 30, 0] });
    // And what `load` makes of the values the file does not hold: zeros, the values this reader
    // will not make up (F1-5), or for absent ones a 0x0 double.
    expect(member('widthless_cell')!.values).toEqual(new Array(12).fill(0));
    expect(member('short_cell')!.values).toEqual([10, 11, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(member('absent_cell')).toEqual({ class: 'double', size: [0, 0], sparse: false, nnz: 0, values: [] });
  });

  it('so the copy of each but the control is refused, and nothing is written in its place', () => {
    for (const c of cases.filter((r: any) => r.format === 'text')) {
      const v: any = createSession().addMatSource(c.mat, arrayBufferOf(files[c.mat])).children[0];
      if (c.kind === 'intact') {
        expect((copyOf(v) as { _value: string })._value, c.id).toBe(c.fragment);
      } else {
        expect(thrown(() => v.serialize()).slice(0, 5), c.id).toEqual(['MatBudgetError', true, 'not-decoded', 'c', c.shape === 'cell' ? 'c{2}' : 'c(2).f']);
      }
    }
  });
});

// B-12 (group H). A struct holding a value the reader did not decode has a member with nothing to
// write but its placeholder (F1-10). Where such a struct can take an edit at a sibling and then be
// saved, the save is refused at that member, naming it, and nothing is written in its place: the
// sibling's edit is never a way round the refusal. In the text or binary dictionary it was read
// from, the member is its own cdata or hex, so the same edit saves with the member as it was read.
// A text dictionary keeps a whole struct read from a MAT stream read-only (C-012), and a binary one
// its own hex. So the struct whose sibling a user can edit while its member cannot be written is one
// a text dictionary held, pasted into a binary dictionary, which has no spelling for that member: its
// save is refused before the edit and after it alike. The behaviour was right before this; nothing
// tested it (the maintainer's group F ruling, F1-10; theme 1: a save the writer cannot spell is
// refused rather than written wrong).
describe('a struct holding a value the reader did not decode, edited at a sibling and saved (B-12)', () => {
  const PREAMBLE = [0x00, 0x01, 0x49, 0x4d, 0x00, 0x00, 0x00, 0x00];
  const streamOf = (element: Uint8Array): Uint8Array => Uint8Array.from([...PREAMBLE, ...element]);
  const hexOf = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
  const struct = (f: Uint8Array) => structVar('', ['f', 'g'], [{ f, g: one(2) }]);
  /** A text dictionary's own struct {f, g: 2}, the member f held as the cdata `f` is the stream of, as MATLAB writes one its JSON cannot spell. */
  const textStruct = (f: Uint8Array) => ({
    _array_type: 'Struct',
    _dimensions: [1, 1],
    _elements: [{ f: { _type: 'cdata', _value: uuencode(streamOf(f)) }, g: 2 }],
    _fields: ['f', 'g'],
    _mw_element_type: 'MATLABArray',
  });

  /** fixtures/sparse/sparse_text.sldd with its entry c's value `value`: the session, the source and c. */
  function textWith(value: unknown): { session: any; root: any; c: any } {
    const json = JSON.parse(strFromU8(testFile('fixtures/sparse/sparse_text.sldd')));
    json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: any) => e.name === 'c').value = value;
    const session = createSession();
    const root: any = session.addDataSource('sparse_text.sldd', json);
    return { session, root, c: root.getSection('design').children.find((e: any) => e.name === 'c') };
  }
  /** fixtures/sparse/sparse_binary.sldd with its entry c's Value tag `tag`: the session, the source and c. */
  function binaryWith(tag: string): { session: any; root: any; c: any } {
    const parts = unzipSync(testFile('fixtures/sparse/sparse_binary.sldd'));
    const chunk = strFromU8(parts['data/chunk0.xml']);
    const at = chunk.indexOf('<P Name="Value" Class="cell" Encoding="hex"', chunk.indexOf('<P Name="Name" Class="char">c</P>'));
    expect(at).toBeGreaterThan(0);
    const zip = zipSync({ ...parts, 'data/chunk0.xml': strToU8(chunk.slice(0, at) + tag + chunk.slice(chunk.indexOf('</P>', at) + 4)) });
    const session = createSession();
    const root: any = ingest(session, arrayBufferOf(zip), { filename: 'sparse_binary.sldd' });
    return { session, root, c: root.getSection('design').children.find((e: any) => e.name === 'c') };
  }
  let seq = 0;
  /** `value` pasted into a fresh binary dictionary as the entry `pasted`, unsaved: the session, the source and the entry. */
  function pastedIntoBinary(value: unknown): { session: any; root: any; entry: any } {
    const session = createSession();
    const root: any = ingest(session, sparseFixture(BINARY), { filename: BINARY });
    const entry = root.getSection('design').parseEntry({ name: 'pasted', metadata: { uuid: `00000000-0000-4000-e812-${String(++seq).padStart(12, '0')}` }, value });
    return { session, root, entry };
  }
  /** The entry `name`'s Value tag and what is inside it, as `bytes`, a saved binary dictionary, has it. */
  const writtenValue = (bytes: Uint8Array, name: string): string => {
    const xml = strFromU8(unzipSync(bytes)['data/chunk0.xml']);
    const from = xml.indexOf('<P Name="Value"', xml.indexOf(`<P Name="Name" Class="char">${name}</P>`));
    return xml.slice(from, xml.indexOf('</Object>', from)).trimEnd();
  };

  const held = [
    ...KINDS.map((k) => ({ label: k.label, build: () => k.build(''), why: k.why(false) as string, what: k.what as string | null, sparse: false })),
    ...SPARSE_UNREAD.map((k) => ({ label: k.label, build: members(matBytes)[k.key], why: k.why, what: k.what as string | null, sparse: true })),
  ];
  for (const k of held) {
    it(`${k.label} at f of a text dictionary's struct, pasted into a binary one: g takes an edit, and the save is refused at f, naming it`, () => {
      // The struct as a text dictionary holds it, {f, g} in its JSON with f a cdata, and as one
      // it read whole from a MAT stream; a host copies each as read and pastes it as it came.
      const asJson = textWith(textStruct(k.build())).c;
      const asStream = textWith({ _type: 'cdata', _value: uuencode(streamOf(struct(k.build()))) }).c;
      for (const [venue, from] of [['its JSON', asJson], ['a MAT stream', asStream]] as const) {
        const { session, root, entry } = pastedIntoBinary(copyOf(from));
        const [f, g] = entry.children;
        expect([entry.displayValue, f.name, f.displayValue.endsWith(', not decoded>'), f.valueEditable, g.name, g.valueEditable], venue).toEqual([
          '<1x1 struct>', 'f', true, false, 'g', true,
        ]);
        const unedited = thrown(() => session.serializeSource(root.name));
        expect(g.setProperty('Value', '3'), venue).toBe(true);
        expect([entry.status, g.displayValue], venue).toEqual(['Modified', '3']);
        // Saved: refused, finally, at f, naming the entry and the path, with why f was not decoded.
        // Nothing is written: the save returns nothing, and f is never its placeholder's text.
        const got = thrown(() => session.serializeSource(root.name));
        expect(got.slice(0, 5), venue).toEqual(['MatBudgetError', true, 'not-decoded', 'pasted', 'pasted.f']);
        expect(got[5], venue).toContain('Cannot write "pasted": pasted.f is a ');
        expect(got[5], venue).toContain(` that was not decoded (${k.why}), so there is no value of it to write. Nothing was written.`);
        if (k.what) {
          expect(got, venue).toEqual(refused('pasted', 'pasted.f', k.what, k.why));
        }
        // The same refusal the save met before the edit: the edit is no way round it. Except
        // for a struct read whole from a stream with a sparse member: unedited, that is written
        // as the hex of the stream it was read from, as one holding a sparse array is at an
        // entry (_binaryEncoded), and that is not what this asks about; edited, it is refused.
        if (!(k.sparse && from === asStream)) {
          expect(unedited, venue).toEqual(got);
        }
        // A copy is as the text dictionary has it (a member's serialize() is its value): f read
        // from its JSON is its own cdata, which a text dictionary holds and a binary one has no
        // spelling for; f read out of the struct's stream has no form of its own, and neither
        // has the struct once g is edited.
        if (from === asJson) {
          expect([f.serialize(), (copyOf(entry) as any)._elements[0].f], venue).toEqual([textStruct(k.build())._elements[0].f, textStruct(k.build())._elements[0].f]);
        } else {
          expect([thrown(() => f.serialize()), thrown(() => entry.serialize())], venue).toEqual([got, got]);
        }
        // The next save meets the same refusal: the edit stands, and nothing went past f.
        expect(thrown(() => session.serializeSource(root.name)), venue).toEqual(got);
        expect([f.displayValue.endsWith(', not decoded>'), g.displayValue], venue).toEqual([true, '3']);
      }
    });
  }

  it('in the dictionary it was read from, the same edit saves, with the member as read: a text dictionary\'s cdata, a binary one\'s hex', () => {
    const f = KINDS[0].build('');
    const text = textWith(textStruct(f));
    const [tf, tg] = text.c.children;
    expect([tf.displayValue, tf.valueEditable, tg.valueEditable]).toEqual(['<2x3 double, not decoded>', false, true]);
    expect(tg.setProperty('Value', '3')).toBe(true);
    const saved = JSON.parse(text.session.serializeSource(text.root.name)!.text!);
    const value = saved.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: any) => e.name === 'c').value;
    expect(value).toEqual({ ...textStruct(f), _elements: [{ f: textStruct(f)._elements[0].f, g: 3 }] });

    // A field held as the hex of its own MAT stream, as this package writes a sparse field and
    // MATLAB reads it back (MatlabVariableNode.serializeXml).
    const hex = `<P Name="f" Class="double" Encoding="hex" EncodedLength="${streamOf(f).length}">${hexOf(streamOf(f))}</P>`;
    const tag = (g: string) => `<P Name="Value" Class="struct">\n<Element>\n${hex}\n<P Name="g" Class="double">${g}</P>\n</Element>\n</P>`;
    const binary = binaryWith(tag('2.0'));
    const [bf, bg] = binary.c.children;
    expect([bf.displayValue, bf.valueEditable, bg.valueEditable]).toEqual(['<2x3 double, not decoded>', false, true]);
    expect(bg.setProperty('Value', '3')).toBe(true);
    expect(writtenValue((binary.session.serializeSource(binary.root.name) as any).bytes, 'c')).toBe(tag('3.0'));
  });
});
