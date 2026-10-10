// Copyright 2026 The MathWorks, Inc.
//
// A dictionary entry nobody has edited never fails to serialize. A host takes
// entry.serialize() as the undo record of a delete, unguarded, so an entry whose serialize()
// threw could not be deleted. An unedited entry is written as what it was read as — a text
// dictionary's value replayed (MatlabVariableNode.serializeValue's _rawInput), a binary one's
// hex replayed (_adoptEncoded) — so nothing re-encodes it and nothing can refuse it: not a
// damaged value, not one past the unbacked-bytes budget as the file holds it, not one a host
// handed over as a dictionary's content, and not after a rename, which keeps the value as
// read.
//
// The one unedited value that does refuse is not a dictionary entry: a variable in a .mat
// whose element the file cuts short has no bytes to be written as, so its copy re-encodes it,
// and past the budget the copy fails (test/budgetFailsClosed.test.ts). It is pinned last.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { serializeEntryToXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import { uudecode, uuencode } from '../src/datamodel/parser/CdataCodec.js';
import { cellVar, element, matFile, matrix, sparseVar, CLASS, MI, arrayFlags, dims, varName } from './tools/matBytes.js';
import { BINARY, TEXT, copyOf, sparseFixture, thrownBy } from './tools/pasteVenues.js';
import { deflateSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
function slddUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return slddUnder(path);
    return name.endsWith('.sldd') ? [path] : [];
  });
}
const buffer = (u8: Uint8Array) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

/**
 * What a host's delete records of every entry in `bytes` opened as `file` — serialize(), as
 * JSON — and a binary dictionary's own writer of each, once as read and once renamed: the
 * entries any of them threw for.
 */
function throwersIn(file: string, bytes: Uint8Array): string[] {
  const root: any = ingest(createSession(), buffer(bytes), { filename: file });
  const binary = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const out: string[] = [];
  for (const section of root.children) {
    for (const entry of [...section.children]) {
      for (const pass of ['as read', 'renamed']) {
        if (pass === 'renamed' && entry.setProperty('Name', entry.name + '_r') !== true) continue;
        const [thrown] = thrownBy(() => {
          JSON.stringify(entry.serialize());
          if (binary) serializeEntryToXml(entry);
        });
        if (thrown) out.push(`${file} ${entry.name} ${pass}: ${thrown.name} ${thrown.message}`);
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

describe('an entry nobody has edited serializes, and is written, without a throw', () => {
  it('every entry of every dictionary in the fixtures', () => {
    const files = [...slddUnder(join(ROOT, 'fixtures')), ...slddUnder(join(ROOT, 'parity', 'artifacts'))];
    expect(files.length).toBeGreaterThanOrEqual(40);
    expect(files.flatMap((f) => throwersIn(f.slice(ROOT.length), new Uint8Array(readFileSync(f))))).toEqual([]);
  });

  it('damaged values: a binary dictionary\'s hex and a text one\'s cdata declaring 2^31-1 columns their index never held', () => {
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
    const j = hex([...bytes]).indexOf(hex(DIMS)) / 2;
    bytes.set(DAMAGED, j);
    spTall.value._value = uuencode(bytes);
    expect(throwersIn(TEXT, strToU8(JSON.stringify(json)))).toEqual([]);
  });

  it('values past the budget as a text dictionary holds them, and as a host hands one over', () => {
    // A text dictionary keeps each as it was written: 80,000 literals, a 1x1x16385 cell of
    // them (no text spelling but a stream, were it edited), and a cell declaring 1e8
    // elements around one.
    const json = JSON.parse(strFromU8(new Uint8Array(sparseFixture(TEXT))));
    const uuid = (n: number) => `00000000-0000-4000-ea00-${String(n).padStart(12, '0')}`;
    entriesOf(json).push(
      { name: 'flat', metadata: { uuid: uuid(1) }, value: literals(80000) },
      { name: 'rank3', metadata: { uuid: uuid(2) }, value: literals(16385, [1, 1, 16385]) },
      { name: 'holes', metadata: { uuid: uuid(3) }, value: { ...literals(1), _dimensions: [1, 1e8] } },
    );
    const text = strToU8(JSON.stringify(json));
    expect(throwersIn(TEXT, text)).toEqual([]);
    // Saved as it was opened, and the same handed over as a dictionary's content by a host.
    const session = createSession();
    const root: any = session.addDataSource('host.sldd', JSON.parse(strFromU8(text)));
    expect(thrownBy(() => session.serializeSource(root.name))[0]).toBeNull();
    for (const e of root.getSection('design').children) expect(thrownBy(() => JSON.stringify(e.serialize()))[0], e.name).toBeNull();
  });

  it('a binary dictionary\'s hex of a cell past the budget were it re-encoded: 80,000 0x256 arrays, written as their own bytes', () => {
    // The cell out of the crash review's 11 KB .mat, copied, pasted and saved (one hex
    // stream of its members' bytes), then opened again.
    const member = matrix([arrayFlags(CLASS.SPARSE, { sparse: true, nzmax: 1 }), dims([0, 256]), varName('')]);
    const c: any = createSession().addMatSource('c.mat', matFile([element(MI.COMPRESSED, deflateSync(cellVar('c', Array.from({ length: 80000 }, () => member))))])).children[0];
    const session = createSession();
    const root: any = ingest(session, sparseFixture(BINARY), { filename: BINARY });
    root.getSection('design').parseEntry({ name: 'c80000', metadata: { uuid: '00000000-0000-4000-ea00-000000000010' }, value: copyOf(c) });
    const saved = session.serializeSource(root.name)!.bytes!;
    expect(throwersIn(BINARY, saved)).toEqual([]);
  });
});

describe('the one unedited value that refuses is not a dictionary entry', () => {
  it('a .mat variable the file cuts short, declaring 2^31-1 columns: its copy fails; declaring 4, it is copied', () => {
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
