// Copyright 2026 The MathWorks, Inc.
//
// A MAT value nested deeper than the reader's cap (MatParser.MAX_NESTING). parseMatrix recurses
// into each struct field and cell element, and it had no bound but the call stack: a 1x1 cell
// nested about 1,600 deep (a 77 KB file) threw "Maximum call stack size exceeded" out of
// parseMat, and the whole .mat was refused, the variables beside it included. Where the stack
// ran out moved with the engine, the thread and the JIT. The deepest variable in the 58 .mat
// files and 151 .slx workspaces of the corpus is 6 levels.
//
// The reader now stops at 128 levels. The value at level 129 is read as far as its flags, size
// and name, recorded as not decoded with the reason, and kept as the bytes it was read from; the
// rest of the file reads as it did. These cases build each chain byte by byte (`nested`), so a
// failure here is about the cap and not about a fixture.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import * as MatParser from '../src/datamodel/parser/MatParser.js';
import { decodeMatStream, parseMat, type MatVariable } from '../src/datamodel/parser/MatParser.js';
import { uuencode } from '../src/datamodel/parser/CdataCodec.js';
import { regenerateChunkXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import { createSession, ingest } from '../src/index.js';
import { CLASS, MI, cellVar, charVar, matFile, mxArrayFile, numericVar, structVar } from './tools/matBytes.js';

type Kind = 'cell' | 'struct';
const KINDS: Kind[] = ['cell', 'struct'];
const CAP = 128;
const REASON = 'nested more than 128 levels deep, so it was not read';

/** A file under test/, as bytes. */
const testFile = (path: string): Uint8Array => new Uint8Array(readFileSync(fileURLToPath(new URL(`./${path}`, import.meta.url))));

const leaf = () => numericVar({ name: '', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [7] });

/**
 * A chain of `levels` values, the outermost named `name` and every other unnamed, as MATLAB
 * names an element: each value but the last a 1x1 of `kind` holding the next (a cell as its one
 * element, a struct as its one field `f`), and the last the double 7. Laid out front to back,
 * each container's tag counting the bytes of every value inside it, so a chain of thousands
 * costs its bytes once rather than once a level.
 */
function nested(kind: Kind, name: string, levels: number): Uint8Array {
  if (levels === 1) {
    return numericVar({ name, cls: CLASS.DOUBLE, dimensions: [1, 1], real: [7] });
  }
  const shell = (nm: string) => (kind === 'cell' ? cellVar(nm, [], [1, 1]) : structVar(nm, ['f'], [], [1, 1]));
  const outer = shell(name);
  const inner = shell('');
  const end = leaf();
  const out = new Uint8Array(outer.length + (levels - 2) * inner.length + end.length);
  const view = new DataView(out.buffer);
  let at = out.length - end.length;
  out.set(end, at);
  for (let i = levels - 2; i >= 0; i--) {
    const s = i === 0 ? outer : inner;
    at -= s.length;
    out.set(s, at);
    view.setUint32(at + 4, out.length - at - 8, true);
  }
  return out;
}

/** The value `v` holds one level down: a cell's one element, or a struct's field `f`. */
const inside = (v: MatVariable, kind: Kind): MatVariable =>
  (kind === 'cell' ? (v.value as MatVariable[])[0] : v.fields!.f) as MatVariable;

/** The value at `level` of a chain whose level 1 is `v`, checking each above it is a container. */
function atLevel(v: MatVariable, kind: Kind, level: number): MatVariable {
  for (let l = 1; l < level; l++) {
    expect([l, v.className, v.undecoded]).toEqual([l, kind, undefined]);
    v = inside(v, kind);
  }
  return v;
}

/** How MATLAB names the value at `level` of the chain `name`: `deep{1}{1}` or `deep.f.f`. */
const pathAt = (name: string, kind: Kind, level: number) => name + (kind === 'cell' ? '{1}' : '.f').repeat(level - 1);

/** The one warning a .mat gives for the chain `name` held deeper than the cap. */
const capWarning = (name: string, kind: Kind) => {
  const part = pathAt(name, kind, CAP + 1);
  return { code: 'part-unreadable', message: `"${part}" was not decoded: ${REASON}.`, part };
};

const sameBytes = (a: Uint8Array | undefined, b: Uint8Array) => !!a && Buffer.from(a).equals(Buffer.from(b));

/**
 * What a chain of 1x1 values of `kind` shows, `levels` of them above the one at the cap: a 1x1
 * cell shows its element in braces, so a chain of them shows the value at the cap in as many
 * braces as there are cells above it, and a struct its summary.
 */
const summaryAbove = (kind: Kind, levels: number) =>
  kind === 'cell' ? '{'.repeat(levels) + '<1x1 cell, not decoded>' + '}'.repeat(levels) : '<1x1 struct>';

/** A variable as a host is shown it, and what it holds, levels down, as rows. */
const shown = (n: any): unknown => [n.name, n.displayValue, n.children.map(shown)];

/** Down the one child of each node from `n`: how many levels, and the node at the bottom. */
function bottom(n: any): [number, any] {
  let levels = 1;
  while (n.children.length > 0) {
    expect(n.children).toHaveLength(1);
    n = n.children[0];
    levels++;
  }
  return [levels, n];
}

const ok = () => numericVar({ name: 'ok', cls: CLASS.DOUBLE, dimensions: [1, 2], real: [1, 2] });
const after = () => cellVar('after', [charVar('', 'tail', MI.UTF8), structVar('', ['a'], [{ a: leaf() }])]);

describe('a MAT value nested deeper than the reader reads', () => {
  it('is read to 128 levels, the cap dex-core has as mat5::MAX_NESTING', () => {
    expect(MatParser.MAX_NESTING).toBe(CAP);
  });

  for (const kind of KINDS) {
    it(`a .mat holding a ${kind} nested 5,000 deep parses: the value read to level 128, and the variables beside it as they are`, () => {
      const deep = nested(kind, 'deep', 5000);
      const parsed = parseMat(matFile([ok(), deep, after()]));
      const control = parseMat(matFile([ok(), after()]));
      const [o, d, a] = parsed.variables;
      expect(parsed.variables.map((v) => v.name)).toEqual(['ok', 'deep', 'after']);
      expect([o, a].map((v) => [v.className, v.value])).toEqual(control.variables.map((v) => [v.className, v.value]));

      // Level 129 is read as far as its flags, size and name, and no further.
      const cut = atLevel(d, kind, CAP + 1);
      expect({ ...cut, _rawBytes: undefined }).toEqual({
        name: '', className: kind, dimensions: [1, 1], isComplex: false, isLogical: false,
        value: `<1x1 ${kind}, not decoded>`, fields: null, undecoded: REASON, _rawBytes: undefined,
      });
      // It keeps the bytes it was read from: the rest of the chain, every level of it.
      expect(sameBytes(cut._rawBytes, nested(kind, '', 5000 - CAP))).toBe(true);
      expect(parsed.warnings).toEqual([capWarning('deep', kind)]);
    });

    it(`a ${kind} chain of 128 levels is read in full, and of 129 only its last value is not`, () => {
      const full = parseMat(matFile([nested(kind, 'deep', CAP)]));
      const last = atLevel(full.variables[0], kind, CAP);
      expect([last.className, last.value, last.undecoded, full.warnings]).toEqual(['double', 7, undefined, []]);

      const over = parseMat(matFile([nested(kind, 'deep', CAP + 1)]));
      const cut = atLevel(over.variables[0], kind, CAP + 1);
      expect([cut.className, cut.value, cut.undecoded]).toEqual(['double', '<1x1 double, not decoded>', REASON]);
      expect(sameBytes(cut._rawBytes, leaf())).toBe(true);
      expect(over.warnings).toEqual([capWarning('deep', kind)]);
    });

    it(`a .mat holding a ${kind} nested 5,000 deep opens: a row a level to 128, the last its summary, not decoded, and the file says why`, () => {
      const mat: any = createSession().addMatSource('deep.mat', matFile([ok(), nested(kind, 'deep', 5000), after()]));
      const control: any = createSession().addMatSource('control.mat', matFile([ok(), after()]));
      const [o, d, a] = mat.children;
      expect(mat.children.map((n: any) => n.name)).toEqual(['ok', 'deep', 'after']);
      expect([o, a].map(shown)).toEqual(control.children.map(shown));

      expect(d.displayValue).toBe(summaryAbove(kind, CAP));
      const [levels, cut] = bottom(d);
      expect([levels, cut.displayValue, cut.valueEditable]).toEqual([CAP + 1, `<1x1 ${kind}, not decoded>`, false]);
      expect(mat.warnings).toEqual([capWarning('deep', kind)]);
      // What a host asks of a row, and a copy, of every level.
      expect(() => d.toRow()).not.toThrow();
      expect(() => JSON.stringify(d.serializeValue())).not.toThrow();
    });
  }

  it('in a dictionary value, a text dictionary\'s cdata or a binary one\'s hex, opens to the cap and an untouched save writes it back as read', () => {
    const PREAMBLE = [0x00, 0x01, 0x49, 0x4d, 0x00, 0x00, 0x00, 0x00];
    const stream = Uint8Array.from([...PREAMBLE, ...nested('cell', '', 5000)]);
    // The entry point every dictionary value is read through.
    const decoded = decodeMatStream(stream);
    expect(decoded.ok && atLevel(decoded.variable, 'cell', CAP + 1).undecoded).toBe(REASON);

    // Text: fixtures/sparse/sparse_text.sldd with its entry c's value the cdata of the stream.
    const json = JSON.parse(strFromU8(testFile('fixtures/sparse/sparse_text.sldd')));
    const entries = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const entry = entries.find((e: any) => e.name === 'c');
    entry.value = { _type: 'cdata', _value: uuencode(stream) };
    const text = createSession();
    const textRoot: any = text.addDataSource('sparse_text.sldd', JSON.parse(JSON.stringify(json)));
    const c = textRoot.getSection('design').children.find((e: any) => e.name === 'c');
    const [levels, cut] = bottom(c);
    expect([c.displayValue, levels, cut.displayValue]).toEqual([summaryAbove('cell', CAP), CAP + 1, '<1x1 cell, not decoded>']);
    const saved = JSON.parse(text.serializeSource(textRoot.name)!.text!);
    const out = saved.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: any) => e.name === 'c');
    expect(out.value).toEqual(entry.value);

    // Binary: fixtures/sparse/sparse_binary.sldd with its entry c's hex Value the stream.
    const parts = unzipSync(testFile('fixtures/sparse/sparse_binary.sldd'));
    const chunk = strFromU8(parts['data/chunk0.xml']);
    const named = chunk.indexOf('<P Name="Name" Class="char">c</P>');
    const at = chunk.indexOf('<P Name="Value" Class="cell" Encoding="hex"', named);
    expect([named > 0, at > named]).toEqual([true, true]);
    const digits = Array.from(stream, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
    const tag = `<P Name="Value" Class="cell" Encoding="hex" EncodedLength="${stream.length}">`;
    const zip = zipSync({ ...parts, 'data/chunk0.xml': strToU8(chunk.slice(0, at) + tag + digits + chunk.slice(chunk.indexOf('</P>', at))) });
    const binary = createSession();
    const binaryRoot: any = ingest(binary, zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer, { filename: 'sparse_binary.sldd' });
    const h = binaryRoot.getSection('design').children.find((e: any) => e.name === 'c');
    const [hexLevels, hexCut] = bottom(h);
    expect([h.displayValue, hexLevels, hexCut.displayValue]).toEqual([summaryAbove('cell', CAP), CAP + 1, '<1x1 cell, not decoded>']);
    expect(strFromU8(unzipSync((binary.serializeSource(binaryRoot.name) as any).bytes)['data/chunk0.xml'])).toContain(tag + digits + '</P>');
    expect(regenerateChunkXml(binaryRoot)).toContain(tag + digits + '</P>');
  });

  it('in a model workspace, the model opens with every variable, the deep one read to the cap, and says nothing', () => {
    // A workspace is a struct whose fields are its variables, so the workspace is level 1 and a
    // variable in it level 2: the deep one is read to its own level 127, and its level 128 is the
    // value recorded at the cap.
    const ws = structVar('', ['deep', 'ok'], [{ deep: nested('cell', '', 5000), ok: numericVar({ name: '', cls: CLASS.DOUBLE, dimensions: [1, 2], real: [1, 2] }) }]);
    const entries = unzipSync(testFile('parity/artifacts/slx/cases.slx'));
    expect(Object.keys(entries)).toContain('simulink/modelWorkspace.mxarray');
    entries['simulink/modelWorkspace.mxarray'] = new Uint8Array(mxArrayFile(ws.subarray(8)));
    const zipped = zipSync(entries);
    const model: any = createSession().addModelSource('cases.slx', zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer);
    const workspace = model.children.find((s: any) => s.name === 'workspace');
    expect(workspace.children.map((n: any) => [n.name, n.displayValue])).toEqual([['deep', summaryAbove('cell', CAP - 1)], ['ok', '[1 2]']]);
    const [levels, cut] = bottom(workspace.children[0]);
    expect([levels, cut.displayValue]).toEqual([CAP, '<1x1 cell, not decoded>']);
    // A model workspace does not report a value it did not decode (the C-232 ruling).
    expect(model.warnings ?? []).toEqual([]);
  });
});
