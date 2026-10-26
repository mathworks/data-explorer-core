// Copyright 2026 The MathWorks, Inc.
//
// A value a text dictionary holds as a MAT stream (its `{_type: 'cdata'}`), which MATLAB writes for
// every value its JSON cannot spell: a complex one, a rank >= 3 one, a sparse one. The maintainer's
// ruling on C-012 (2026-10-15) made every such value display-only; revised on 2026-10-24 ("the mat
// file complex number is always enabled"), a plain value, a number, a logical or a char, real or
// complex, of any size, takes edits, judged by the rule a MAT-file's save writes a variable fresh by
// (MatFileWriter.streamWriteRefusal: the stream written read back as the value). Typed over a double,
// 1+i was taken, and once the dictionary was read again the value was locked; MATLAB's own complex
// values (complex_inf_text.sldd) were locked from the start, where a MAT-file's and a binary
// dictionary's took edits.
//
// Over every stream of every text dictionary fixture: one the rule passes takes an edit at the
// value or at its elements, of the same kind and to a complex value, which a save writes and a
// reopen reads back, and which an undo puts back as the bytes it was read from; one it does not pass
// (a value not decoded, one holding a string) refuses every edit and writes nothing. A sparse array,
// and a cell or a struct of plain values, which MATLAB keeps as a stream at rank >= 3, take edits at
// their rows and members too (test/textStreamContainers.test.ts).
// And an unedited stream is saved as its own bytes. An Add or a Remove of an element is offered
// only where the value it leaves passes the rule too. Then the same of streams built here: values
// no display text holds exactly (-0, a signed NaN, intmin and intmax of the 64-bit classes,
// non-ASCII chars), graded by value, and the shapes the rule is asked of.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { streamWriteRefusal, variableDifference } from '../src/datamodel/parser/MatFileWriter.js';
import { MatWriteError, encodeCdata } from '../src/datamodel/parser/MatWriter.js';
import { decodeMatStream, type MatVariable } from '../src/datamodel/parser/MatParser.js';
import { uudecode } from '../src/datamodel/parser/CdataCodec.js';
import * as NodeRegistry from '../src/datamodel/node/NodeRegistry.js';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Any = any;

const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

function slddUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...slddUnder(p));
    else if (e.name.endsWith('.sldd')) out.push(p);
  }
  return out.sort();
}

function opened(bytes: Uint8Array, filename = 'd.sldd') {
  const session = createSession();
  const root: Any = ingest(session, ab(bytes), { filename });
  const save = (): Uint8Array => new TextEncoder().encode((session.serializeSource(root.name) as Any).text);
  const edit = (node: Any, text: string) => {
    session.setActive(root, node);
    return session.editProperty(node.id, 'Value', text);
  };
  return { session, root, save, edit };
}

const pathOf = (n: Any): number[] => {
  const p: number[] = [];
  for (let x = n; x && x.parent; x = x.parent) p.unshift(x.parent.children.indexOf(x));
  return p;
};
const nodeAt = (root: Any, path: number[]): Any => path.reduce((n, i) => n?.children?.[i], root);
// The row a reopened file shows at `matlabPath`: a Parameter's scalar Value is its own row's, as it
// has no row of its own (ParameterNode).
function shownAt(root: Any, matlabPath: string): Any {
  const all = root.flatten() as Any[];
  return all.find((n) => n.matlabPath === matlabPath) ?? (matlabPath.endsWith('.Value') ? all.find((n) => n.matlabPath === matlabPath.slice(0, -'.Value'.length)) : undefined);
}
const subtree = (n: Any): Any[] => [n, ...(n.children ?? []).flatMap(subtree)];

// A plain value, the rule's own kinds: a number, a logical or a char, real or complex; a sparse array
// MatWriter writes once edited; or a cell or a struct of them, at any depth, whose value is in its rows.
const plainKind = (n: Any): boolean =>
  (n._kind !== 'cell' && !n._sparse && !n._isOpaque && !n._undecoded && !['struct', 'string', 'function_handle', 'object'].includes(n._scalarType))
  || (!!n._sparse && !n._isOpaque && !n._undecoded && n._sparseRefusal() === null)
  || ((n._kind === 'cell' || n._scalarType === 'struct') && !n._isOpaque && !n._undecoded && !n._cutByCeiling && !n._unexpandedStruct()
    && n.children.every((c: Any) => c instanceof MatlabVariableNode && plainKind(c)));

// Another value of the kind a row shows, typed as its text: a number for a number, the other
// logical, another complex number, another char.
function another(row: Any): string {
  const shown = String(row.displayValue);
  if (shown === 'true' || shown === 'false') return shown === 'true' ? 'false' : 'true';
  if (/i$/.test(shown) && /\d/.test(shown)) return shown === '5-6i' ? '7-8i' : '5-6i';
  if (/^'.*'$/.test(shown)) return shown === "'z'" ? "'y'" : "'z'";
  return shown === '7' ? '8' : '7';
}

const STREAMS: { file: string; path: number[]; label: string; locked: boolean }[] = [];
for (const file of slddUnder('test')) {
  let root: Any;
  try {
    root = opened(new Uint8Array(readFileSync(file)), file.split('/').pop()).root;
  } catch {
    continue;
  }
  if (root.sourceFormat !== 'json') continue;
  for (const n of root.flatten() as Any[]) {
    if (n._readFromStream) {
      STREAMS.push({ file, path: pathOf(n), label: file + ' ' + n.matlabPath, locked: !plainKind(n) || streamWriteRefusal(n) !== null });
    }
  }
}

describe("a text dictionary's MAT stream", () => {
  it('is found in the fixtures, of every kind', () => {
    // Measured when this was written: 119, every one plain, 27 of them a sparse array and 10 a cell
    // or a struct of plain values. A stream that is not (one that does not decode, a sparse array
    // MatWriter would not write) is built by test/cdataDecodeFailure.test.ts and
    // test/sparseDamaged.test.ts.
    expect(STREAMS.length).toBeGreaterThanOrEqual(110);
    expect(STREAMS.filter((s) => s.locked)).toEqual([]);
  });

  it('takes an edit exactly where the rule of a fresh write passes it, which a save writes and an undo takes back', () => {
    const wrong: string[] = [];
    const unoffered: string[] = [];
    let edited = 0;
    for (const { file, path, label, locked } of STREAMS) {
      const bytes = new Uint8Array(readFileSync(file));
      const fresh = () => opened(bytes, file.split('/').pop());
      const o = fresh();
      const holder = nodeAt(o.root, path);
      const rows = subtree(holder);
      if (holder._streamLocked() !== locked) {
        wrong.push(label + ': locked ' + holder._streamLocked() + ', the rule says ' + locked);
        continue;
      }
      if (locked) {
        // Every row refuses, and nothing is written.
        for (const row of rows) {
          const r: Any = o.edit(row, another(row));
          if (row.valueEditable || r === true || !/is stored as a MAT-file stream/.test(r?.reason ?? '') || o.root.dirty) {
            wrong.push(label + ' ' + row.matlabPath + ': locked, yet ' + JSON.stringify({ editable: row.valueEditable, r }));
          }
        }
        continue;
      }
      // Edits at the value, and at an element: of the same kind, and to a complex value at the value.
      const asks: [number[], (n: Any) => string][] = [];
      const element = rows.slice(1).find((r) => r.valueEditable);
      if (element) asks.push([pathOf(element), another]);
      if (holder.valueEditable) {
        asks.push([path, another]);
        asks.push([path, () => '2+3i']);
      }
      if (asks.length === 0) {
        // Shown as a summary with no element rows, as the same value read from a binary
        // dictionary is (an N-D char): the stream is not what holds it back.
        if (rows.some((r) => r._streamHolder())) wrong.push(label + ': takes edits, yet a row of it is locked');
        unoffered.push(label);
        continue;
      }
      for (const [at, typed] of asks) {
        const e = fresh();
        // What an undo is held to: the stream value written as it was read, the bytes it was read from.
        const before = JSON.stringify(nodeAt(e.root, path).serializeValue());
        const node = nodeAt(e.root, at);
        const text = typed(node);
        const r = e.edit(node, text);
        if (r !== true) {
          wrong.push(label + ' ' + node.matlabPath + ' = ' + text + ': refused ' + JSON.stringify(r));
          continue;
        }
        const shown = node.matlabPath.endsWith('.Value') && !node.parent?.children.includes(node) ? node.parent?.displayValue : node.displayValue;
        const back = shownAt(opened(e.save(), file.split('/').pop()).root, node.matlabPath);
        // A sparse array's row set to zero (a logical one's to false) is no non-zero of it: a save
        // writes the non-zeros, as MATLAB's own `sp(1,1) = 0` drops it, and read again it has no such row.
        if (node.parent?._sparse && (text === 'false' || Number(text) === 0)) {
          if (back) wrong.push(label + ' ' + node.matlabPath + ' = ' + text + ': reopened, the zero is still a row');
        } else {
          // A real number typed into a complex array's element is that number with an imaginary part
          // of 0, which a reopen spells so, as a binary dictionary's does.
          const complexElement = node !== holder && node.parent?._isComplexValue?.() && back?.displayValue === shown + '+0i';
          if (back?.displayValue !== shown && !complexElement) {
            wrong.push(label + ' ' + node.matlabPath + ' = ' + text + ': shows ' + JSON.stringify(shown) + ', reopened ' + JSON.stringify(back?.displayValue));
          }
          if (!back?.valueEditable) {
            wrong.push(label + ' ' + node.matlabPath + ' = ' + text + ': reopened, it takes no edit');
          }
        }
        e.session.undo();
        if (JSON.stringify(nodeAt(e.root, path).serializeValue()) !== before) {
          wrong.push(label + ' ' + node.matlabPath + ' = ' + text + ': undone, the entry is not as it was read');
        }
        edited++;
      }
    }
    expect(wrong).toEqual([]);
    // The two N-D chars, char_text.sldd's and nd_rich.sldd's ndChar, shown as `<2x3x2 char>`, and a sparse
    // array of no non-zero, sparse_text.sldd's spAllZero, which has no row.
    expect(unoffered.map((l) => l.split('/').pop())).toEqual(['char_text.sldd ndChar', 'nd_rich.sldd ndChar', 'sparse_text.sldd spAllZero']);
    expect(edited).toBeGreaterThanOrEqual(100);
  });

  it('unedited, is saved as its own bytes', () => {
    for (const file of [...new Set(STREAMS.map((s) => s.file))]) {
      const o = opened(new Uint8Array(readFileSync(file)), file.split('/').pop());
      const saved = new TextDecoder().decode(o.save());
      for (const { path, label } of STREAMS.filter((s) => s.file === file)) {
        const raw = nodeAt(o.root, path)._rawInput;
        expect(saved.includes(JSON.stringify(raw._value)), label).toBe(true);
      }
    }
  });
});

describe('a double typed over as a complex number', () => {
  it('is taken, saved as a stream, read back as one that takes the next edit, and that is saved too', () => {
    let o = opened(new Uint8Array(readFileSync('test/parity/artifacts/text/cases.sldd')));
    const at = (root: Any) => root.children.flatMap((s: Any) => s.children).find((e: Any) => e.name === 'scalarD');
    expect(o.edit(at(o.root), '1+1i')).toBe(true);
    o = opened(o.save());
    expect(at(o.root).serialize().value._type).toBe('cdata');
    expect([at(o.root).displayValue, at(o.root).valueEditable, at(o.root).toRow()._valueEditable]).toEqual(['1+1i', true, true]);
    expect(o.edit(at(o.root), '2+3i')).toBe(true);
    o = opened(o.save());
    expect([at(o.root).displayValue, at(o.root).valueEditable]).toEqual(['2+3i', true]);
  });
});

describe('a complex value MATLAB wrote into a text dictionary (complex_inf_text.sldd)', () => {
  it('takes an edit and is saved as typed, its sparse one at its rows', () => {
    const file = 'test/fixtures/complex_inf/complex_inf_text.sldd';
    const entries = (root: Any) => root.children.flatMap((s: Any) => s.children);
    const o = opened(new Uint8Array(readFileSync(file)));
    const editable = entries(o.root).filter((e: Any) => e.valueEditable).map((e: Any) => e.name);
    expect(editable).toEqual(['zInf', 'zInfCell', 'zInfRow']);
    // The scalar, typed whole; an element of the row, with infinite and NaN parts.
    const z = opened(new Uint8Array(readFileSync(file)));
    expect(z.edit(entries(z.root).find((x: Any) => x.name === 'zInf'), '-Inf+2i')).toBe(true);
    const row = entries(z.root).find((x: Any) => x.name === 'zInfRow');
    expect(z.edit(row.children[1], 'Inf-1i')).toBe(true);
    const back = entries(opened(z.save()).root);
    expect(back.find((x: Any) => x.name === 'zInf').displayValue).toBe('-Inf+2i');
    expect(back.find((x: Any) => x.name === 'zInfRow').displayValue).toBe('[Inf-Infi Inf-1i 1NaNi -Inf+2i]');
    const sparse = entries(o.root).find((x: Any) => x.name === 'zInfSparse');
    expect([sparse.valueEditable, sparse.children.map((r: Any) => r.valueEditable)]).toEqual([false, sparse.children.map(() => true)]);
    expect(o.edit(sparse.children[0], '1+2i')).toBe(true);
    const sparseBack = entries(opened(o.save()).root).find((x: Any) => x.name === 'zInfSparse');
    expect(sparseBack.children[0].displayValue).toBe('1+2i');
  });
});

// No plain value makes a stream the rule refuses (the sweep below), so the writer's refusal is
// stood in for: every value's size refused as no size (MatlabVariableNode._refuseNoSize), which
// the rule asks first (MatFileWriter.streamWriteRefusal).
function withNoSize<T>(f: () => T): T {
  const own = MatlabVariableNode.prototype._refuseNoSize;
  MatlabVariableNode.prototype._refuseNoSize = function () {
    throw new MatWriteError('Cannot write "' + this.name + '": its size is no size. Nothing was written.');
  };
  try {
    return f();
  } finally {
    MatlabVariableNode.prototype._refuseNoSize = own;
  }
}

describe('an edit of a stream value whose stream would not be written as typed', () => {
  it('is refused, naming it, and changes nothing: typed whole, or at an element', () => {
    const file = 'test/fixtures/complex_inf/complex_inf_text.sldd';
    const o = opened(new Uint8Array(readFileSync(file)));
    const entries = o.root.children.flatMap((s: Any) => s.children);
    const zInf = entries.find((x: Any) => x.name === 'zInf');
    const zInfRow = entries.find((x: Any) => x.name === 'zInfRow');
    // Each takes edits, judged of the value as read.
    expect([zInf.valueEditable, zInfRow.children[1].valueEditable]).toEqual([true, true]);
    const before = [zInf.serializeValue(), zInfRow.serializeValue(), zInfRow.children[1].displayValue];
    const whole: Any = withNoSize(() => o.edit(zInf, '5-6i'));
    expect(whole).toMatchObject({
      error: true,
      reason: 'Cannot edit "zInf": zInf is held as a MAT stream, and the one this edit makes would not be written as typed: its size is no size.',
      validValue: '1+Infi',
    });
    const element: Any = withNoSize(() => o.edit(zInfRow.children[1], '5-6i'));
    expect(element).toMatchObject({ error: true, reason: expect.stringMatching(/^Cannot edit "zInfRow": zInfRow is held as a MAT stream, and the one this edit makes would not be written as typed: /) });
    expect([zInf.serializeValue(), zInfRow.serializeValue(), zInfRow.children[1].displayValue]).toEqual(before);
    expect(o.root.dirty).toBe(false);
  });

  it("is refused at a Parameter's Value the same way, and taken where the stream would be", () => {
    const o = opened(new Uint8Array(readFileSync('test/fixtures/mcos/complex.sldd')));
    const p = o.root.children.flatMap((s: Any) => s.children).find((x: Any) => x.name === 'pScalar');
    expect([p.valueEditable, p._valueNode._readFromStream]).toEqual([true, true]);
    const before = JSON.stringify(p.serializeValue());
    expect(withNoSize(() => o.edit(p, '5-6i'))).toMatchObject({
      error: true,
      reason: 'Cannot edit "pScalar": pScalar.Value is held as a MAT stream, and the one this edit makes would not be written as typed: its size is no size.',
      validValue: '3+4i',
    });
    expect(JSON.stringify(p.serializeValue())).toBe(before);
    expect(o.root.dirty).toBe(false);
    expect(o.edit(p, '5-6i')).toBe(true);
    expect(shownAt(opened(o.save(), 'complex.sldd').root, 'pScalar').displayValue).toBe('5-6i');
  });
});


// A text dictionary of no fixture: each entry the MAT stream MatWriter writes for `variables`'s
// value (a variable's value is in MATLAB's order within each page, the order of the rows).
function dictionaryOf(variables: Record<string, MatVariable>): Uint8Array {
  const entries = Object.entries(variables).map(([name, v], i) => ({
    name,
    metadata: {
      uuid: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      namespace: 'dacaf35e-55a5-454d-a7c1-93db038a210e',
      lastmod: '20261024T120000.000000',
      modifiedby: 'test',
      isderived: '0',
    },
    value: { _type: 'cdata', _value: encodeCdata(v) },
  }));
  const content = { entries, 'Dictionary References': [], AllowAccessBWS: false };
  return new TextEncoder().encode(JSON.stringify({ __MW_TEXT_COREPROPERTIES__: { release: 'R2027a' }, __MW_TEXT_PARTS__: { '__MW_TEXT_PART__/data/chunk0': { __MW_TEXT_content: content } } }));
}

const variable = (className: string, dimensions: number[], value: unknown, isComplex = false): MatVariable =>
  ({ name: '', className, dimensions, isComplex, isLogical: false, fields: null, value }) as MatVariable;

// A NaN with its sign bit set and a payload of 1: fff8000000000001.
const SIGNED_NAN = new DataView(new Uint8Array([0xff, 0xf8, 0, 0, 0, 0, 0, 1]).buffer).getFloat64(0);
const bitsOf = (x: number) => {
  const d = new DataView(new ArrayBuffer(8));
  d.setFloat64(0, x);
  return d.getBigUint64(0).toString(16);
};

/** Each entry's stream in a saved text dictionary, decoded, by name; and its cdata as written. */
function savedStreams(bytes: Uint8Array): Record<string, { variable: MatVariable; cdata: string }> {
  const json = JSON.parse(new TextDecoder().decode(bytes));
  const out: Record<string, { variable: MatVariable; cdata: string }> = {};
  for (const e of json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries) {
    const got = decodeMatStream(uudecode(e.value._value));
    expect(got.ok, e.name).toBe(true);
    out[e.name] = { variable: (got as Any).variable, cdata: e.value._value };
  }
  return out;
}

describe('an element of a stream array edited, with values no display text holds exactly elsewhere in it', () => {
  // Graded by value, as the MAT-file save's read-back is (MatFileWriter.differs: each part by
  // Object.is, so -0 is not 0; a 64-bit integer by its digits). A NaN is a NaN to it, whatever
  // its sign and payload, as it is to MATLAB's isequaln: the value written fresh holds the NaN
  // MatWriter writes, 7ff8000000000000, where the stream read held one with its sign set. Only
  // a stream nobody edited keeps those bits, being written as its own bytes.
  const VARIABLES = {
    zNd: variable('double', [2, 2, 2], [
      { re: -0, im: 1 }, { re: 2, im: -0 }, { re: SIGNED_NAN, im: 3 }, { re: 4, im: SIGNED_NAN },
      { re: Infinity, im: -Infinity }, { re: 6, im: 7 }, { re: 5e-324, im: -1e308 }, { re: 8, im: 9 },
    ], true),
    uNd: variable('uint64', [1, 2, 2], ['18446744073709551615', 0, 2, 3]),
    iNd: variable('int64', [2, 1, 2], ['-9223372036854775808', '9223372036854775807', 2, 3]),
    // Not edited, and no element of it takes an editor (an N-D char shows as a summary).
    cNd: variable('char', [2, 2, 2], 'é中😀ab€ç'),
  };
  const EDITS: [string, number, string, unknown][] = [
    ['zNd', 5, '5-6i', { re: 5, im: -6 }],
    ['uNd', 2, '7', 7],
    ['iNd', 3, '-3', -3],
  ];

  it('saves that element as typed and every other one as it was, and reopens taking edits', () => {
    const bytes = dictionaryOf(VARIABLES);
    const o = opened(bytes);
    const entry = (root: Any, name: string) => root.children.flatMap((s: Any) => s.children).find((e: Any) => e.name === name);
    for (const [name, k, typed] of EDITS) {
      const el = entry(o.root, name).children[k];
      expect(el.valueEditable, name).toBe(true);
      expect(o.edit(el, typed), name).toBe(true);
      expect(el.displayValue, name).toBe(typed);
    }
    expect(entry(o.root, 'cNd').valueEditable).toBe(false);
    const saved = o.save();
    const read = savedStreams(bytes);
    const back = savedStreams(saved);
    for (const [name, v] of Object.entries(VARIABLES)) {
      // The variable as written, with only the element typed changed.
      const want = { ...read[name].variable, value: Array.isArray(v.value) ? [...(read[name].variable.value as unknown[])] : read[name].variable.value };
      for (const [n, k, , value] of EDITS) {
        if (n === name) (want.value as unknown[])[k] = value;
      }
      expect(variableDifference(want, back[name].variable, name), name).toBeNull();
    }
    const z = back.zNd.variable.value as { re: number; im: number }[];
    expect([bitsOf(z[2].re), bitsOf(z[3].im)]).toEqual(['7ff8000000000000', '7ff8000000000000']);
    // The one not edited is written as its own bytes.
    expect(back.cNd.cdata).toBe(read.cNd.cdata);
    const reopened = opened(saved).root;
    for (const [name, k, typed] of EDITS) {
      expect([entry(reopened, name).children[k].displayValue, entry(reopened, name).children[k].valueEditable], name).toEqual([typed, true]);
    }
  });
});

describe('the rule refuses no plain stream this package writes', () => {
  // Asked of every class a plain stream holds, real and complex, of every shape (empties, rows,
  // columns, matrices, N-D), at each class's extremes: -0, NaN, Inf, the largest and the
  // smallest double and single, intmin and intmax of each integer class, non-ASCII chars and
  // one outside the BMP. None is refused, so a refusal is stood in for in the tests above and
  // below (withNoSize).
  it('none of 264 shapes', () => {
    const EXTREMES: Record<string, unknown[]> = {
      double: [-0, NaN, Infinity, -Infinity, Number.MAX_VALUE, 5e-324],
      single: [-0, NaN, Infinity, 3.4028234663852886e38, 1.401298464324817e-45],
      int8: [-128, 127], uint8: [0, 255], int16: [-32768, 32767], uint16: [0, 65535],
      int32: [-2147483648, 2147483647], uint32: [0, 4294967295],
      int64: ['-9223372036854775808', '9223372036854775807'], uint64: [0, '18446744073709551615'],
      logical: [1, 0],
    };
    const DIMS = [[1, 1], [1, 3], [3, 1], [2, 2], [2, 2, 2], [1, 1, 2], [0, 0], [1, 0], [0, 3], [0, 0, 2], [2, 0, 3], [1, 1, 1, 2]];
    const refused: string[] = [];
    let asked = 0;
    for (const cls of [...Object.keys(EXTREMES), 'char']) {
      for (const complex of cls === 'char' || cls === 'logical' ? [false] : [false, true]) {
        for (const dims of DIMS) {
          const count = dims.reduce((a, b) => a * b, 1);
          const pick = (k: number) => EXTREMES[cls][k % EXTREMES[cls].length];
          const value = cls === 'char'
            ? Array.from({ length: count }, (_, k) => 'é中a€'[k % 4]).join('')
            : Array.from({ length: count }, (_, k) => (complex ? { re: pick(k), im: pick(k + 1) } : pick(k)));
          const v = { ...variable(cls === 'logical' ? 'uint8' : cls, dims, value, complex), isLogical: cls === 'logical' };
          const node = NodeRegistry.parseValue({ _type: 'cdata', _value: encodeCdata(v) }, 'x', null);
          asked++;
          const r = streamWriteRefusal(node);
          if (r) refused.push(`${cls}${complex ? ' complex' : ''} ${dims.join('x')}: ${r.message}`);
        }
      }
    }
    // And a char with one outside the BMP, two UTF-16 units.
    const astral = NodeRegistry.parseValue({ _type: 'cdata', _value: encodeCdata(variable('char', [1, 3], 'a😀')) }, 'x', null);
    if (streamWriteRefusal(astral)) refused.push('char 1x3 a😀');
    expect([asked, refused]).toEqual([264, []]);
  });
});

describe('an Add or a Remove of an element of a stream value', () => {
  const VARIABLES = {
    zRow: variable('double', [1, 3], [{ re: 1, im: 2 }, { re: 3, im: -0 }, { re: SIGNED_NAN, im: 4 }], true),
    eNd: variable('double', [0, 0, 2], []),
  };
  const entry = (root: Any, name: string) => root.children.flatMap((s: Any) => s.children).find((e: Any) => e.name === name);

  it('is offered and made where the stream the value leaves is written as it shows, and undone to its own bytes', () => {
    const bytes = dictionaryOf(VARIABLES);
    const o = opened(bytes);
    const z = entry(o.root, 'zRow');
    expect([z.canAddChild(), z.canRemoveChild(), z._streamChildRefusal('add'), z._streamChildRefusal('remove')]).toEqual([true, true, null, null]);
    expect(o.session.addChildTo(z.id)).toBeTruthy();
    expect(o.session.deleteNodeById(z.children[0].id)).toBe(true);
    const shown = z.displayValue;
    expect(z.children).toHaveLength(3);
    const back = savedStreams(o.save()).zRow.variable;
    expect(variableDifference(z._var, back, 'zRow')).toBeNull();
    // The NaN MatWriter writes, as for an element edited (above).
    expect(bitsOf((back.value as Any)[1].re)).toBe('7ff8000000000000');
    // The element Add makes is 0+0i, as x(end+1) = 0 of a complex array makes it and a reopen
    // spells it (MatlabVariableNode._settleComplexity).
    expect([shown, entry(opened(o.save()).root, 'zRow').displayValue]).toEqual(['[3+0i NaN+4i 0+0i]', '[3+0i NaN+4i 0+0i]']);
    o.session.setActive(o.root, z);
    o.session.undo();
    o.session.undo();
    expect(z.children).toHaveLength(3);
    expect(savedStreams(o.save()).zRow.cdata).toBe(savedStreams(bytes).zRow.cdata);
  });

  // MATLAB makes a 1x1 struct of any empty given a field, `x = zeros(0,0,2); x.field = 0` included
  // (R2027a), as Add makes one of `[]`; a struct of plain values is one a stream takes edits of.
  it('is made where MATLAB makes it: an empty given a field is a 1x1 struct, saved and read back', () => {
    const o = opened(dictionaryOf(VARIABLES));
    const e = entry(o.root, 'eNd');
    expect([e.canAddChild(), e._streamChildRefusal('add')]).toEqual([true, null]);
    expect(o.session.addChildTo(e.id)?.name).toBe('field');
    const back = entry(opened(o.save()).root, 'eNd');
    expect([back.className, back.displayValue, back.children.map((c: Any) => [c.name, c.displayValue])]).toEqual(['struct', '<1x1 struct>', [['field', '0']]]);
  });

  it('is not offered, and not made, where the stream it leaves would not be written', () => {
    const o = opened(dictionaryOf(VARIABLES));
    const z = entry(o.root, 'zRow');
    // Judged of the value as read first, as a host asks it before it asks the gates.
    expect(z.valueEditable).toBe(true);
    const before = z.serializeValue();
    withNoSize(() => {
      expect([z.canAddChild(), z.canRemoveChild()]).toEqual([false, false]);
      const why = 'zRow is held as a MAT stream, and the one an Add leaves would not be written as it shows: its size is no size.';
      expect(z._streamChildRefusal('add')).toBe('Cannot add an element to "zRow": ' + why);
      expect(z._streamChildRefusal('remove')).toBe('Cannot remove an element of "zRow": ' + why.replace('an Add', 'a Remove'));
      expect(o.session.addChildTo(z.id)).toBeNull();
      expect(o.session.deleteNodeById(z.children[0].id)).toBe(false);
      expect(z.execRemoveChild(z.children[1])).toBeNull();
    });
    expect([z.serializeValue(), z.children.length, o.root.dirty]).toEqual([before, 3, false]);
  });
});
