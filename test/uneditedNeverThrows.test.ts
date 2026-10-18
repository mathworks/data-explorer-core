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
// read from hex hands back its EncodedValue (DataNode._adoptEncoded). A binary reader's
// empty is its class under the header of its extents (BinarySlddParser.emptyOf), handed back
// as read like any value, or for an extent that is no count `_emptyDims`, written from its dims;
// a text dictionary is given an N-D one as its stream, and has no spelling for one whose dims no
// stream can say — an extent past an int32, or one that is no count — so its paste there is
// refused, as a complex value's is, and as dims holding NaN, an infinity or a bigint are, in
// any value but the text dictionary's own.
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
import { isMatCdata, uudecode, uuencode } from '../src/datamodel/parser/CdataCodec.js';
import { textDictionaryForm } from '../src/datamodel/parser/MatWriter.js';
import { CLASS, MI, arrayFlags, cellVar, dims, element, matFile, matrix, sparseVar, varName } from './tools/matBytes.js';
import { BINARY, TEXT, copyOf, pasteSaveReopen, sparseFixture, thrownBy } from './tools/pasteVenues.js';

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

/** sparse_binary.sldd with one more entry per `[name, Value]`, each Value as the file holds it. */
function binaryWith(values: [string, string][]): Uint8Array {
  const files = unzipSync(new Uint8Array(sparseFixture(BINARY)));
  const entry = ([name, value]: [string, string], i: number) =>
    `    <Object Class="DD.ENTRY">\n        <P Name="Name" Class="char">${name}</P>\n`
    + `        <P Name="UUID" Class="char">00000000-0000-4000-ec00-${String(i + 1).padStart(12, '0')}</P>\n`
    + '        <P Name="Namespace" Class="char">dacaf35e-55a5-454d-a7c1-93db038a210e</P>\n        <P Name="LastMod" Class="char">20261011T000000.000000</P>\n'
    + `        <P Name="LastModBy" Class="char"></P>\n        <P Name="IsDerived" Class="char">0</P>\n        ${value}\n    </Object>\n`;
  const xml = strFromU8(files['data/chunk0.xml']);
  files['data/chunk0.xml'] = strToU8(xml.replace('    <Object Class="DD.Dictionary">', values.map(entry).join('') + '    <Object Class="DD.Dictionary">'));
  return zipSync(files);
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

  it('a text dictionary\'s complex text no MAT stream can say, as v1.36.0 wrote it: a save writes it back as read, as read, renamed, and beside an edit', () => {
    // v1.36.0 wrote a complex value into a text dictionary as its plain text, and the empty of
    // one past an int32 (or of a size that is no count) has no stream to be instead. Read from
    // the file and not edited, it is the file's own: a refusal of it failed the whole save.
    for (const d of [[0, 2147483648], [0, 2.5]]) {
      const cx = { _type: 'cdata', _value: '', _dimensions: d };
      const json = JSON.parse(strFromU8(new Uint8Array(sparseFixture(TEXT))));
      const parameter = JSON.parse(JSON.stringify(entriesOf(json).find((e: any) => e.name === 'pDense')));
      parameter.value._elements[0]._properties.Value = cx;
      const added: [string, unknown][] = [
        ['cxPast', cx],
        ['pCxPast', parameter.value],
        ['cellCxPast', { _array_type: 'Cell', _dimensions: [1, 2], _elements: [1, cx], _mw_element_type: 'MATLABArray' }],
        ['stCxPast', { _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ f: cx, g: 2 }], _fields: ['f', 'g'] }],
      ];
      added.forEach(([name, value], i) => entriesOf(json).push({ ...parameter, name, metadata: { ...parameter.metadata, uuid: `00000000-0000-4000-ed00-${String(i + 1).padStart(12, '0')}` }, value }));
      // As this package writes a text dictionary, so that a save of it as read is these bytes.
      const file = JSON.stringify(json, null, '\t');
      const save = (change: (design: any) => void) => {
        const session = createSession();
        const root: any = ingest(session, buffer(strToU8(file)), { filename: TEXT });
        change(root.getSection('design'));
        const [thrown] = thrownBy(() => session.serializeSource(root.name));
        return thrown ? `${thrown.name}: ${thrown.message}` : session.serializeSource(root.name)!.text!;
      };
      expect(save(() => {}), JSON.stringify(d)).toBe(file);
      const values = (text: string) => entriesOf(JSON.parse(text)).filter((e: any) => /cxPast/i.test(e.name)).map((e: any) => [e.name, JSON.stringify(e.value, null, '\t')]);
      const asRead = added.map(([name, value]) => [name, JSON.stringify(value, null, '\t')]);
      const renamed = save((design) => design.children.filter((e: any) => /cxPast/i.test(e.name)).forEach((e: any) => e.setProperty('Name', e.name + '_r')));
      expect(values(renamed), JSON.stringify(d)).toEqual(asRead.map(([name, value]) => [name + '_r', value]));
      const beside = save((design) => design.children.find((e: any) => e.name === 'dRow').children[1].setProperty('Value', '9'));
      expect([values(beside), entriesOf(JSON.parse(beside)).find((e: any) => e.name === 'dRow').value], JSON.stringify(d)).toEqual([asRead, [0, 9, 0, 4, 0]]);
      // The Parameter edited, its Value not: the Value is still the file's.
      const described = save((design) => design.children.find((e: any) => e.name === 'pCxPast').setProperty('Description', 'edited'));
      const p = entriesOf(JSON.parse(described)).find((e: any) => e.name === 'pCxPast').value._elements[0]._properties;
      expect([p.Description, p.Value], JSON.stringify(d)).toEqual(['edited', cx]);
    }
    // Within an int32 it has a stream, and a save writes that, as it does any complex text.
    const json = JSON.parse(strFromU8(new Uint8Array(sparseFixture(TEXT))));
    entriesOf(json).push({ name: 'cxSayable', metadata: { uuid: '00000000-0000-4000-ed00-000000000009' }, value: { _type: 'cdata', _value: '', _dimensions: [0, 5] } });
    const session = createSession();
    const root: any = ingest(session, buffer(strToU8(JSON.stringify(json, null, '\t'))), { filename: TEXT });
    const saved = entriesOf(JSON.parse(session.serializeSource(root.name)!.text!)).find((e: any) => e.name === 'cxSayable').value;
    expect([saved._type, isMatCdata(saved)]).toEqual(['cdata', true]);
  });

  it('a text dictionary\'s own 1e400, which JSON reads as an infinity, in a cell, a struct or an object array: serialize() never throws, as read or renamed, and the file saves', () => {
    // serializeXml() is the value's paste into a binary dictionary, which is not asked here.
    const own: [string, string][] = [
      ['cInf', '{"_array_type":"Cell","_dimensions":[0,1e400],"_elements":[],"_mw_element_type":"MATLABArray"}'],
      ['sInf', '{"_array_type":"Struct","_dimensions":[0,1e400],"_elements":[],"_fields":["f"]}'],
      ['pInf0', '{"_array_class":"Simulink.Parameter","_dimensions":[0,1e400],"_elements":[]}'],
      ['pInf1', '{"_array_class":"Simulink.Parameter","_dimensions":[1,1e400],"_elements":[{"_properties":{"Value":1}}]}'],
      ['sigInf', '{"_array_class":"Simulink.Signal","_dimensions":[1,1e400],"_elements":[{"_properties":{"Description":"d"}}]}'],
      ['wInf', '{"_array_class":"Widget","_dimensions":[1,1e400],"_elements":[{"_id":"1","_properties":{"A":1}}]}'],
    ];
    const json = JSON.parse(strFromU8(new Uint8Array(sparseFixture(TEXT))));
    own.forEach(([name], i) => entriesOf(json).push({ name, metadata: { uuid: `00000000-0000-4000-ee00-${String(i + 1).padStart(12, '0')}` }, value: `@@${name}@@` }));
    const file = strToU8(own.reduce((text, [name, value]) => text.replace(`"@@${name}@@"`, value), JSON.stringify(json)));
    expect(throwersIn(TEXT, file).filter((t) => / serialize: /.test(t))).toEqual([]);
    const session = createSession();
    const root: any = ingest(session, buffer(file), { filename: TEXT });
    expect(thrownBy(() => session.serializeSource(root.name))[0]).toBeNull();
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

  it('a binary dictionary\'s N-D empty whose dims no MAT stream can say: no writer throws, as read or renamed, and its copy is the value as read', () => {
    // An empty needs no stream: its Class and Dimension are all of it. Its copy is the binary
    // reader's form, which a binary dictionary writes back as read; a text dictionary, where
    // an N-D value has no spelling but a stream, refuses it, naming it.
    const PAST_INT32 = ', an extent past 2147483647, the most a MAT stream\'s dimensions can say, and it has no other spelling here. Nothing was written.';
    const values: [string, string, string][] = [
      ['nd', '<P Name="Value" Class="double" Dimension="0*2147483648*2"/>', 'a 0x2147483648x2 double' + PAST_INT32],
      ['ndInt8', '<P Name="Value" Class="int8" Dimension="0*2147483648*2"/>', 'a 0x2147483648x2 int8' + PAST_INT32],
      ['ndLogical', '<P Name="Value" Class="logical" Dimension="0*2147483648*2"/>', 'a 0x2147483648x2 logical' + PAST_INT32],
      ['ndHalf', '<P Name="Value" Class="double" Dimension="0*2.5*2"/>', 'a double declaring dimensions [0,2.5,2], a size that is not a count, so what it would add beyond its data cannot be held to the 16 MiB one value may add. Nothing was written.'],
    ];
    // Within what a stream can say, an N-D empty is copied as read, as every empty is, and a
    // text dictionary is given its stream, as it was.
    const SAYABLE = '<P Name="Value" Class="int8" Dimension="0*3*2"/>';
    const bytes = binaryWith([...values.map(([name, value]) => [name, value] as [string, string]), ['ndSayable', SAYABLE], ['flatPast', '<P Name="Value" Class="double" Dimension="0*2147483648"/>']]);
    expect(throwersIn(BINARY, bytes)).toEqual([]);
    const design: any = (ingest(createSession(), buffer(bytes), { filename: BINARY }) as any).getSection('design');
    const copy = (name: string) => copyOf(design.children.find((e: any) => e.name === name));
    for (const [name, value, said] of values) {
      const copied = copy(name);
      const [thrown] = thrownBy(() => pasteSaveReopen(TEXT, copied));
      expect([pasteSaveReopen(BINARY, copied).written, thrown?.name, thrown?.message], name).toEqual([value, 'MatBudgetError', `Cannot write "pasted": pasted is ${said}`]);
    }
    const sayable = copy('ndSayable') as any;
    const text = pasteSaveReopen(TEXT, sayable);
    expect([sayable, pasteSaveReopen(BINARY, sayable).written, text.entry.dims, text.entry._scalarType]).toEqual([{ _type: 'int8', _value: 'Matrix(0,3,2)', _binary_empty: true }, SAYABLE, [0, 3, 2], 'int8']);
    expect(isMatCdata(textDictionaryForm(sayable) as any)).toBe(true);
    // A 0x2147483648 is copied as read too, its class and size with it; a text dictionary, where
    // MATLAB reads the header of its extents back with the extent wrapped, refuses it, naming it,
    // as it does an N-D one (MatWriter.textEmptySpelling).
    const flatPast = copy('flatPast');
    const [refused] = thrownBy(() => pasteSaveReopen(TEXT, flatPast));
    expect([flatPast, pasteSaveReopen(BINARY, flatPast).written, refused?.name, refused?.message]).toEqual([
      { _type: 'double', _value: 'Matrix(0,2147483648)', _binary_empty: true },
      '<P Name="Value" Class="double" Dimension="0*2147483648"/>',
      'MatBudgetError',
      'Cannot write "pasted": pasted is a 0x2147483648 double' + PAST_INT32,
    ]);
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
