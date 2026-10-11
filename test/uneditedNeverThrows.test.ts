// Copyright 2026 The MathWorks, Inc.
//
// What an entry nobody has edited does when it is written. A host takes entry.serialize() as
// the undo record of a delete, unguarded, so a throw there would make the entry undeletable.
//
// serialize() never throws for one, in either dictionary type, and whatever it was read
// from — a file, damaged or past the unbacked-bytes budget as the file holds it, a host's
// dictionary content, a paste — because it re-encodes nothing: MatlabVariableNode and
// StructNode serializeValue hand back `_rawInput`, the value as read, which every edit but a
// rename drops (DataNode._markModified; setProperty keeps it across a rename), and a value
// read from hex hands back its EncodedValue (DataNode._adoptEncoded). The only raw form not
// replayed is a binary reader's dense empty (`_emptyDims`), which is never sparse and
// charges nothing.
//
// serializeXml() never throws for an entry read from a binary dictionary: hex is written as
// read (_adoptEncoded), and a sparse array there is never anything but hex or a member of a
// hex cell. For an entry read from a text dictionary, pasted, or handed over by a host, it is
// that value's paste into a binary dictionary: a sparse array with bytes of its own is their
// hex, but one with none — this package's `sparse` literal — is encoded, out of one budget
// for the value (every node writer of a container is one write, MatWriter.oneWrite), and
// past it that write is refused, by the fail-closed ruling. Those are named below. The cell
// declaring 1e8 elements is refused as an entry (serializeEntryToXml writes a cell holding a
// sparse array as one stream, and its holes are past the budget); its serializeXml() alone
// is the XML of the element it holds, as a cell of full arrays' is.
//
// serialize() of a variable in a .mat or a host's own source is its copy, not a dictionary
// entry: past the budget, and with no bytes to copy it as, it is refused too, named last.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { serializeEntryToXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import { uudecode, uuencode } from '../src/datamodel/parser/CdataCodec.js';
import { CLASS, MI, arrayFlags, cellVar, dims, element, matFile, matrix, sparseVar, varName } from './tools/matBytes.js';
import { BINARY, TEXT, copyOf, sparseFixture, thrownBy } from './tools/pasteVenues.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
function slddUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return slddUnder(path);
    return name.endsWith('.sldd') ? [path] : [];
  });
}
const buffer = (u8: Uint8Array) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b;

/**
 * Every writer of `entry`: serialize() as a host's delete records it, serializeXml() as an
 * entry's Value, and, in a binary dictionary, serializeEntryToXml — what each threw, if any.
 */
function writersOf(entry: any, binary: boolean): string[] {
  const out: string[] = [];
  const run = (what: string, f: () => unknown) => {
    const [thrown] = thrownBy(f);
    if (thrown) out.push(`${entry.name} ${what}: ${thrown.name}`);
  };
  run('serialize', () => JSON.stringify(entry.serialize()));
  run('serializeXml', () => entry.serializeXml('P', { Name: 'Value' }, 2));
  if (binary) run('serializeEntryToXml', () => serializeEntryToXml(entry));
  return out;
}

/** writersOf every entry of `bytes` opened as `file`, as read and again renamed. */
function throwersIn(file: string, bytes: Uint8Array): string[] {
  const root: any = ingest(createSession(), buffer(bytes), { filename: file });
  const out: string[] = [];
  for (const section of root.children) {
    for (const entry of [...section.children]) {
      out.push(...writersOf(entry, isZip(bytes)));
      if (entry.setProperty('Name', entry.name + '_r') === true) {
        out.push(...writersOf(entry, isZip(bytes)).map((t) => t + ' (renamed)'));
      }
    }
  }
  return out;
}

const entriesOf = (json: any) => json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
const literals = (n: number, d = [1, n]) => ({
  _array_type: 'Cell',
  _dimensions: d,
  _elements: Array.from({ length: n }, () => ({ _type: 'sparse', _value: 'Matrix(0,256)\n[]' })),
  _mw_element_type: 'MATLABArray',
});
// The hand-made inputs past the budget: 80,000 0x256 literals, a 1x1x16385 cell of them, and
// a cell declaring 1e8 elements around one.
const PAST_BUDGET: [string, unknown][] = [
  ['flat', literals(80000)],
  ['rank3', literals(16385, [1, 1, 16385])],
  ['holes', { ...literals(1), _dimensions: [1, 1e8] }],
];
// The crash review's .mat cell of 80,000 0x256 arrays, 48 bytes each, as a host copies it:
// each member its own bytes.
const ownBytesCell = () => {
  const member = matrix([arrayFlags(CLASS.SPARSE, { sparse: true, nzmax: 1 }), dims([0, 256]), varName('')]);
  const c: any = createSession().addMatSource('c.mat', matFile([element(MI.COMPRESSED, deflateSync(cellVar('c', Array.from({ length: 80000 }, () => member))))])).children[0];
  return copyOf(c);
};

// These write every entry of every fixture, or cells of 4,198 to 80,000 sparse arrays: up to
// 3.5 s here, 11.5 s on CI's runners, past vitest's 5 s default; give them headroom.
const HEAVY_TIMEOUT = 60_000;

describe('an entry nobody has edited: what each writer does', () => {
  it('every entry of every dictionary in the fixtures: no writer throws, as read or renamed', { timeout: HEAVY_TIMEOUT }, () => {
    const files = [...slddUnder(join(ROOT, 'fixtures')), ...slddUnder(join(ROOT, 'parity', 'artifacts'))];
    expect(files.length).toBeGreaterThanOrEqual(40);
    expect(files.flatMap((f) => throwersIn(f.slice(ROOT.length), new Uint8Array(readFileSync(f))))).toEqual([]);
  });

  it('damaged values read from a file, a binary dictionary\'s hex and a text one\'s cdata declaring 2^31-1 columns: no writer throws', () => {
    // spTall's dims word, rows 10000000 and cols 2, and the cols word damaged.
    const DIMS = [0x80, 0x96, 0x98, 0x00, 0x02, 0x00, 0x00, 0x00];
    const DAMAGED = [0x80, 0x96, 0x98, 0x00, 0xff, 0xff, 0xff, 0x7f];
    const hex = (b: number[]) => b.map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join('');
    // The binary dictionary: pTall's Value, wherever its line breaks fall.
    const files = unzipSync(new Uint8Array(sparseFixture('hexobj_binary.sldd')));
    const xml = strFromU8(files['data/chunk0.xml']);
    const at = xml.indexOf('<P Name="Name" Class="char">pTall</P>');
    const open = xml.indexOf('>', xml.indexOf('<P Name="Value"', at)) + 1;
    const close = xml.indexOf('</P>', open);
    const positions: number[] = [];
    for (let i = open; i < close; i++) if (/[0-9A-F]/.test(xml[i])) positions.push(i);
    const k = positions.map((i) => xml[i]).join('').indexOf(hex(DIMS));
    const chars = xml.split('');
    hex(DAMAGED).split('').forEach((c, j) => (chars[positions[k + j]] = c));
    files['data/chunk0.xml'] = strToU8(chars.join(''));
    expect(throwersIn('hexobj_binary.sldd', zipSync(files))).toEqual([]);
    // The text dictionary: spTall's cdata.
    const json = JSON.parse(strFromU8(new Uint8Array(sparseFixture(TEXT))));
    const spTall = entriesOf(json).find((e: any) => e.name === 'spTall');
    const bytes = uudecode(spTall.value._value);
    bytes.set(DAMAGED, hex([...bytes]).indexOf(hex(DIMS)) / 2);
    spTall.value._value = uuencode(bytes);
    expect(throwersIn(TEXT, strToU8(JSON.stringify(json)))).toEqual([]);
  });

  it('values past the budget as a text dictionary holds them, or a host hands them over: serialize() never throws; serializeXml(), their paste into a binary dictionary, is refused', { timeout: HEAVY_TIMEOUT }, () => {
    const json = JSON.parse(strFromU8(new Uint8Array(sparseFixture(TEXT))));
    PAST_BUDGET.forEach(([name, value], i) =>
      entriesOf(json).push({ name, metadata: { uuid: `00000000-0000-4000-ea00-${String(i + 1).padStart(12, '0')}` }, value }),
    );
    const text = strToU8(JSON.stringify(json));
    const refusedAsXml = ['flat serializeXml: MatBudgetError', 'rank3 serializeXml: MatBudgetError'];
    expect(throwersIn(TEXT, text)).toEqual(refusedAsXml.flatMap((t) => [t, t.replace(' ', '_r ') + ' (renamed)']));
    // A host's dictionary content is the same; and it saves as it was opened.
    const session = createSession();
    const root: any = session.addDataSource('host.sldd', JSON.parse(strFromU8(text)));
    expect(root.getSection('design').children.flatMap((e: any) => writersOf(e, false))).toEqual(refusedAsXml);
    expect(thrownBy(() => session.serializeSource(root.name))[0]).toBeNull();
  });

  it('a binary dictionary\'s hex of a cell that re-encoded would be past the budget, read from the file: no writer throws', { timeout: HEAVY_TIMEOUT }, () => {
    const session = createSession();
    const root: any = ingest(session, sparseFixture(BINARY), { filename: BINARY });
    root.getSection('design').parseEntry({ name: 'c80000', metadata: { uuid: '00000000-0000-4000-ea00-000000000010' }, value: ownBytesCell() });
    expect(throwersIn(BINARY, session.serializeSource(root.name)!.bytes!)).toEqual([]);
  });

  it('pasted and not edited, in either dictionary type: serialize() never throws; serializeXml() is refused only for a value with no bytes of its own past the budget', { timeout: HEAVY_TIMEOUT }, () => {
    const own = ownBytesCell();
    for (const file of [TEXT, BINARY]) {
      const design: any = (ingest(createSession(), sparseFixture(file), { filename: file }) as any).getSection('design');
      const pastes = [...PAST_BUDGET, ['own', own] as [string, unknown]].map(([name, value], i) =>
        design.parseEntry({ name, metadata: { uuid: `00000000-0000-4000-eb00-${String(i + 1).padStart(12, '0')}` }, value }),
      );
      const thrown = pastes.flatMap((e: any) => writersOf(e, file === BINARY));
      const refused = ['flat', 'rank3', 'holes'].flatMap((n) => [
        ...(n === 'holes' ? [] : [`${n} serializeXml: MatBudgetError`]),
        ...(file === BINARY ? [`${n} serializeEntryToXml: MatBudgetError`] : []),
      ]);
      expect(thrown, file).toEqual(refused);
    }
  });
});

describe('a variable that is not a dictionary entry: its serialize() is its copy', () => {
  it('a host\'s own: within the budget it copies, past it the copy is refused', { timeout: HEAVY_TIMEOUT }, () => {
    const member = () => ({
      name: '', className: 'double', dimensions: [1000, 1000], isComplex: false, isLogical: false, isSparse: true, value: '', fields: null,
      sparse: { row: Int32Array.from([0]), col: Int32Array.from([0]), re: Float64Array.from([5]), im: null },
    });
    const hostCell = (n: number): any =>
      createSession().addMatSourceParsed('h.mat', {
        header: '',
        warnings: [],
        variables: [{ name: 'h', className: 'cell', dimensions: [1, n], isComplex: false, isLogical: false, value: Array.from({ length: n }, member), fields: null }],
      }).children[0];
    expect(writersOf(hostCell(4198), false)).toEqual([]);
    expect(writersOf(hostCell(4300), false)).toEqual(['h serialize: MatBudgetError', 'h serializeXml: MatBudgetError']);
  });

  it('a .mat variable the file cuts short, declaring 2^31-1 columns: no bytes to copy it as, so its copy is refused; declaring 4, it is copied', () => {
    // The element's pr tag is past the end of the file, so there are no whole bytes to copy
    // it as, and re-encoded it is backed for none of its columns.
    const cut = (cols: number) => {
      const el = sparseVar({ name: 't', dimensions: [0, cols], ir: [], jc: [0], real: [], nzmax: 1, sparseFlag: true });
      const file = new Uint8Array(matFile([el]));
      return file.slice(0, file.length - 8).buffer;
    };
    const big: any = createSession().addMatSource('t.mat', cut(0x7fffffff)).children[0];
    const [thrown] = thrownBy(() => big.serialize());
    expect([thrown?.name, thrown?.message]).toEqual([
      'MatBudgetError',
      'Cannot write "t": t is a 0x2147483647 sparse array whose data holds none of its 2147483647 columns, and with it the value would add more than 16 MiB that its data does not hold, the most one value may add. Nothing was written.',
    ]);
    const small: any = createSession().addMatSource('t.mat', cut(4)).children[0];
    expect((small.serialize() as any).value._type).toBe('cdata');
  });
});
