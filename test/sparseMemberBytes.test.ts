// Copyright 2026 The MathWorks, Inc.
//
// A cell or a struct written whole as one MAT stream writes each sparse member nothing has
// edited as the element it was read from (MatWriter.memberElement): out of a .mat, out of a
// cell's or a struct's own stream, out of a text dictionary's cdata or a binary one's hex.
// Those bytes are the value, MATLAB's own, and they cost what the file held, so a member
// with bytes takes nothing from the unbacked-bytes budget (test/unbackedBudget.test.ts).
// Only a member with none, or one an element row has edited, is encoded from its non-zeros.
// Before this every member was re-encoded: each 48-byte 0x256 member of a cell of 80,000
// came out at 1,104 bytes, 257 words of index no byte held.
import { describe, it, expect } from 'vitest';
import { strFromU8 } from 'fflate';
import { createSession } from '../src/index.js';
import { decodeMatStream } from '../src/datamodel/parser/MatParser.js';
import { ingest } from '../src/core/ingest.js';
import { encodedStream } from '../src/datamodel/parser/EncodedValue.js';
import { uudecode } from '../src/datamodel/parser/CdataCodec.js';
import { encodeMatStream } from '../src/datamodel/parser/MatWriter.js';
import { CLASS, arrayFlags, cellVar, dims, matFile, matrix, sparseVar, structVar, varName } from './tools/matBytes.js';
import { BINARY, TEXT, copyOf, pasted, sparseFixture, thrownBy } from './tools/pasteVenues.js';

const PREAMBLE = [0x00, 0x01, 0x49, 0x4d, 0x00, 0x00, 0x00, 0x00];
/** The stream MATLAB writes for a cell or a struct whose element, unnamed, is `el`. */
const streamOf = (el: Uint8Array) => [...PREAMBLE, ...el];

// MATLAB's shape for sparse([5 0; 0 0; 0 7]), and a damaged 0x256 cut short after its name.
const real = () => sparseVar({ name: '', dimensions: [3, 2], ir: [0, 2], jc: [0, 1, 2], real: [5, 7], sparseFlag: true });
const bare = () => matrix([arrayFlags(CLASS.SPARSE, { sparse: true, nzmax: 1 }), dims([0, 256]), varName('')]);
const hexDigits = (bytes: ArrayLike<number>) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');

// The struct of 20,000 elements: 0.25 s here, 0.7 s on CI's runners; give it headroom past
// vitest's 5 s default, which the budget tests' heavier cases have outrun on CI.
const HEAVY_TIMEOUT = 60_000;

describe('a sparse member nothing has edited is written as the bytes it was read from', () => {
  it('in a cell out of a .mat, and an edited member alone is encoded again', () => {
    const members = [real(), bare(), real()];
    const c: any = createSession().addMatSource('c.mat', matFile([cellVar('c', members)])).children[0];
    expect(encodeMatStream(c._var)).toEqual(new Uint8Array(streamOf(cellVar('', members))));
    // An element row of the first edited: that member is its non-zeros, the others their bytes.
    expect(c.children[0].children[1].setProperty('Value', '9')).toBe(true);
    const edited = encodeMatStream(c._var);
    const back = decodeMatStream(edited);
    expect(back.ok && [...(back.variable.value as any[])[0].sparse.re]).toEqual([5, 9]);
    const tail = cellVar('', members).slice(-(members[1].length + members[2].length));
    expect([...edited.slice(-tail.length)]).toEqual([...tail]);
    // However a change below a member got there, its bytes are no longer it.
    const d: any = createSession().addMatSource('d.mat', matFile([cellVar('d', members)])).children[0];
    d.children[2].children[0]._markModified();
    expect(d._var.value.map((m: any) => !!m._rawBytes)).toEqual([true, true, false]);
  });

  it('in a struct, so that one of 20,000 elements whose 0x256 field no index backs is written whole', { timeout: HEAVY_TIMEOUT }, () => {
    // The fields come last, in order, each its own bytes.
    const s: any = createSession().addMatSource('s.mat', matFile([structVar('s', ['f', 'g'], [{ f: real(), g: bare() }])])).children[0];
    const own = [...real(), ...bare()];
    expect([...encodeMatStream(s._var).slice(-own.length)]).toEqual(own);
    // Re-encoded, those fields would be 20 MB of index no byte held, past the budget.
    const one: any = createSession().addMatSource('o.mat', matFile([structVar('o', ['g'], [{ g: bare() }])])).children[0];
    const many: any = createSession().addMatSource('m.mat', matFile([structVar('m', ['g'], Array.from({ length: 20000 }, () => ({ g: bare() })), [1, 20000])])).children[0];
    expect(encodeMatStream(many._var).length).toBe(encodeMatStream(one._var).length + 19999 * bare().length);
  });

  it('copied out of a .mat and pasted into a binary dictionary: the cell is one hex stream of its members\' own bytes', () => {
    const members = [real(), bare(), real()];
    const c: any = createSession().addMatSource('c.mat', matFile([cellVar('c', members)])).children[0];
    const entry = pasted(BINARY, copyOf(c));
    expect(entry._binaryEncoded()._value.replace(/\s+/g, '')).toBe(hexDigits(streamOf(cellVar('', members))));
  });

  it('MATLAB\'s own cell of sparse arrays (sparse_text.sldd\'s c), pasted into a binary dictionary', () => {
    const json = JSON.parse(strFromU8(new Uint8Array(sparseFixture(TEXT))));
    const value = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: any) => e.name === 'c').value;
    // Each member's element, as MATLAB wrote it in its own stream.
    const own = value._elements.filter((e: any) => e._type === 'cdata').map((e: any) => {
      const bytes = uudecode(e._value);
      return [...bytes.slice(8, 16 + new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, true))];
    });
    const entry = pasted(BINARY, value);
    const digits = entry._binaryEncoded()._value.replace(/\s+/g, '');
    expect(own.length).toBe(1);
    for (const el of own) expect(digits).toContain(hexDigits(el));
  });

  it('out of a binary dictionary\'s hex, the element its stream holds', () => {
    const root: any = ingest(createSession(), sparseFixture(BINARY), { filename: BINARY });
    const spRow = root.getSection('design').children.find((e: any) => e.name === 'spRow');
    const stream = encodedStream(spRow._encoded).bytes!;
    const el = stream.slice(8, 16 + new DataView(stream.buffer, stream.byteOffset).getUint32(12, true));
    expect(spRow._var._rawBytes).toEqual(el);
    // Written whole as a member of a cell, it is that element.
    const cellOfIt = { name: '', className: 'cell', dimensions: [1, 1], isComplex: false, isLogical: false, value: [spRow._var], fields: null };
    expect(hexDigits(encodeMatStream(cellOfIt))).toContain(hexDigits(el));
  });

  it('whatever dims its bytes say: a damaged [-5,3] is written as read, in a cell and a struct, and refused once it is encoded again', () => {
    // Only a member encoded again needs dims that are a size (MatWriter.refuseDimsBelow); one
    // written as its own bytes says them as the file did. A 1x1x2 cell is written whole.
    const damaged = () => sparseVar({ name: '', dimensions: [-5, 3], ir: [0], jc: [0, 1, 1, 1], real: [5], sparseFlag: true });
    const open = (): any => createSession().addMatSource('c.mat', matFile([cellVar('c', [damaged(), real()], [1, 1, 2])])).children[0];
    const c = open();
    let copied: any;
    expect(thrownBy(() => (copied = copyOf(c)))[0]?.message ?? null).toBeNull();
    expect(copied._type).toBe('cdata');
    const digits = hexDigits(uudecode(copied._value));
    for (const el of [damaged(), real()]) expect(digits).toContain(hexDigits(el));
    // Without its bytes, it would be encoded from its non-zeros, and those dims are no size.
    const v = c._var;
    const bytesless = { ...v, value: v.value.map((m: any, i: number) => (i === 0 ? { ...m, _rawBytes: null } : m)) };
    const [refused] = thrownBy(() => encodeMatStream(bytesless));
    expect([(refused as any)?.reason, (refused as any)?.at, (refused as any)?.what]).toEqual(['not-a-count', '{1}', 'a sparse double declaring dimensions [-5,3]']);
    // A struct's field the same, written whole.
    const st: any = createSession().addMatSource('s.mat', matFile([structVar('s', ['f', 'g'], [{ f: damaged(), g: real() }])])).children[0];
    let whole: Uint8Array | undefined;
    expect(thrownBy(() => (whole = encodeMatStream(st._var)))[0]?.message ?? null).toBeNull();
    expect(hexDigits(whole!)).toContain(hexDigits(damaged()));
  });
});
