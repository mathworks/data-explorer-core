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
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import { MatBudgetError, createSession, ingest } from '../src/index.js';
import { CLASS, MI, arrayFlags, cellVar, dims, element, matFile, matrix, mxArrayFile, numericVar, structVar, varName } from './tools/matBytes.js';
import { BINARY, TEXT, copyOf, pasteSaveReopen, thrownBy } from './tools/pasteVenues.js';

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
    expect(thrown(() => node.serializeXml('P', { Name: 'Value' }, 2))).toEqual(refused('spTall', 'spTall', 'a 10000000x2 double', 'too large'));
    expect(thrown(() => node.serializeValue())).toEqual(refused('spTall', 'spTall', 'a 10000000x2 double', 'too large'));
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
