// Copyright 2026 The MathWorks, Inc.
//
// A value a compressed-binary dictionary stores as an encoded byte stream, written back.
//
// MATLAB writes a dictionary value as
//   <P Name="Value" Class="double" Encoding="hex" EncodedLength="248">0001494D…</P>
// when XML cannot spell it: a sparse array or a function handle anywhere inside it. Nothing
// read the Encoding attribute, so the text went to parseFloat — `0001494D…` is 1494 — and
// every save wrote `Class="double">1494.0` (or `Class="Simulink.Parameter">1494`) back in
// place of the stream. That was silent loss for a sparse array, and for an object-classed
// one a file MATLAB's reader crashed on (a segmentation violation in
// SLDDOperations::convertStructFromStructArray), measured on R2027a.
//
// test/fixtures/sparse/sparse_binary.sldd is MATLAB's own file (make_sparse_fixtures.m),
// with seventeen hex entries: sparse arrays of every class, a struct and a cell holding
// one, three Simulink.Parameters whose Value is one, and an AliasType subclass with a
// function-handle property. Every way this package writes an entry is checked against the
// bytes MATLAB wrote for it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { serializeEntryToXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import { uudecode } from '../src/datamodel/parser/CdataCodec.js';
import { readMxArrayRecords } from '../src/datamodel/parser/MxArrayParser.js';
import { cellVar, matFile, sparseVar } from './tools/matBytes.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/sparse/${name}`, import.meta.url))));
const buffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const chunkOf = (zip: Uint8Array): string => new TextDecoder().decode(unzipSync(zip)['data/chunk0.xml']);

const MATLAB_CHUNK = chunkOf(fixture('sparse_binary.sldd'));
// MATLAB's text twin of it, as JSON.
const TEXT_ENTRIES: any[] = JSON.parse(new TextDecoder().decode(fixture('sparse_text.sldd'))).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;

/** One entry's `<Object>` block, found by its Name. */
function entryBlock(xml: string, name: string): string {
  const at = xml.indexOf('<P Name="Name" Class="char">' + name + '</P>');
  expect(at, name).toBeGreaterThan(-1);
  const open = xml.lastIndexOf('<Object ', at);
  return xml.slice(open, xml.indexOf('</Object>', at));
}

/** An entry's Value element, exactly as written — attributes, line breaks and all. */
function valueTag(xml: string, name: string): string {
  const block = entryBlock(xml, name);
  const at = block.indexOf('<P Name="Value"');
  expect(at, `${name} has a Value`).toBeGreaterThan(-1);
  const end = block.indexOf('</P>', at);
  return block.slice(at, end + '</P>'.length);
}

const ENTRIES = [...MATLAB_CHUNK.matchAll(/<P Name="Name" Class="char">([^<]+)<\/P>/g)].map((m) => m[1]);
const HEX = ENTRIES.filter((n) => valueTag(MATLAB_CHUNK, n).includes('Encoding="hex"'));

/** The bytes a hex element holds, read independently of the code under test. */
function hexBytes(tag: string): Uint8Array {
  const digits = tag.replace(/^<P[^>]*>/, '').replace(/<\/P>$/, '').replace(/\s+/g, '');
  return Uint8Array.from(digits.match(/../g)!.map((h) => parseInt(h, 16)));
}

function open(session = createSession(), file = 'sparse_binary.sldd'): any {
  return ingest(session, buffer(fixture(file)), { filename: file });
}

/** Every node at or under `node`. */
const subtree = (node: any): any[] => [node, ...node.children.flatMap(subtree)];

/**
 * The matrix a sparse variable read back stands for, row-major, a complex element as
 * `{ re, im }`: the reader holds only its non-zeros (MatVariable.sparse), so the test lays
 * them out to state the value as MATLAB's full() would.
 */
function denseOf(v: any): unknown[] {
  const s = v.sparse;
  const [rows, cols] = v.dimensions;
  const out: unknown[] = Array.from({ length: rows * cols }, () => (s.im ? { re: 0, im: 0 } : 0));
  for (let k = 0; k < s.row.length; k++) out[s.row[k] * cols + s.col[k]] = s.im ? { re: s.re[k], im: s.im[k] } : s.re[k];
  return out;
}

describe('the fixture is what these tests need', () => {
  it('MATLAB wrote seventeen entries as hex, of every kind the generator meant to', () => {
    expect(HEX).toHaveLength(17);
    const classes = new Set(HEX.map((n) => /Class="([^"]+)"/.exec(valueTag(MATLAB_CHUNK, n))![1]));
    expect([...classes].sort()).toEqual(['Simulink.Parameter', 'cell', 'dexsparse.FhAlias', 'double', 'logical', 'single', 'struct']);
    // And entries MATLAB wrote as XML beside them, which these tests edit.
    expect(ENTRIES.length - HEX.length).toBeGreaterThanOrEqual(10);
  });
});

describe('a save that edits nothing writes every hex value back byte for byte', () => {
  const session = createSession();
  const root = open(session);
  const ours = chunkOf(session.serializeSource(root.name)!.bytes);

  for (const name of HEX) {
    it(name, () => {
      expect(valueTag(ours, name)).toBe(valueTag(MATLAB_CHUNK, name));
    });
  }
});

describe('a save after editing a different entry writes every hex value back byte for byte', () => {
  const session = createSession();
  const root = open(session);
  const design = root.getSection('design');
  const dRow = design.children.find((e: any) => e.name === 'dRow');
  // dRow is MATLAB's [0 2 0 4 0]: its second element becomes 7.
  expect(dRow.children[1].setProperty('Value', '7')).toBe(true);
  const ours = chunkOf(session.serializeSource(root.name)!.bytes);

  it('the edit itself is written', () => {
    expect(valueTag(ours, 'dRow')).toContain('>0.0 7.0 0.0 4.0 0.0</P>');
  });
  for (const name of HEX) {
    it(name, () => {
      expect(valueTag(ours, name)).toBe(valueTag(MATLAB_CHUNK, name));
    });
  }
});

describe('renaming a hex entry keeps its value', () => {
  const root = open();
  const design = root.getSection('design');
  for (const name of HEX) {
    it(name, () => {
      const entry = design.children.find((e: any) => e.name === name);
      expect(entry.toRow().Name.editable, 'the name is outside the stream').toBe(true);
      expect(entry.setProperty('Name', name + 'Renamed')).toBe(true);
      const xml = serializeEntryToXml(entry);
      expect(xml).toContain('<P Name="Name" Class="char">' + name + 'Renamed</P>');
      expect(valueTag(xml, name + 'Renamed')).toBe(valueTag(MATLAB_CHUNK, name));
    });
  }
});

describe('a copied hex entry is pasted as the value it holds', () => {
  const session = createSession();
  const binary = open(session);
  const text = open(session, 'sparse_text.sldd');
  const MATLAB_TEXT = JSON.parse(new TextDecoder().decode(fixture('sparse_text.sldd')));
  const textEntries: any[] = MATLAB_TEXT.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
  let seq = 0;

  // The payload a host's clipboard carries — the entry's own serialize(), deep-copied as
  // a host copies it — pasted under a fresh name and uuid.
  const pasteInto = (root: any, name: string): any => {
    const source = binary.getSection('design').children.find((e: any) => e.name === name);
    const payload: any = JSON.parse(JSON.stringify(source.serialize()));
    payload.name = name + 'Pasted';
    payload.metadata = { ...payload.metadata, uuid: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}` };
    return root.getSection('design').parseEntry(payload);
  };

  for (const name of HEX) {
    it(`${name}, into a binary dictionary: the element MATLAB wrote`, () => {
      const pasted = pasteInto(binary, name);
      expect(valueTag(serializeEntryToXml(pasted), name + 'Pasted')).toBe(valueTag(MATLAB_CHUNK, name));
    });

    it(`${name}, into a text dictionary: the same bytes, as the cdata a text dictionary carries`, () => {
      const pasted = pasteInto(text, name);
      const value = JSON.parse(JSON.stringify(pasted.serialize())).value;
      expect(value._type).toBe('cdata');
      const bytes = hexBytes(valueTag(MATLAB_CHUNK, name));
      // uudecode keeps the bits MATLAB's NUL padding contributes past the last whole byte.
      expect(Array.from(uudecode(value._value).slice(0, bytes.length))).toEqual(Array.from(bytes));
      // And where MATLAB's own text twin holds the value as one stream, it is that stream
      // character for character.
      const twin = textEntries.find((e) => e.name === name)?.value;
      if (twin?._type === 'cdata') {
        expect(value._value).toBe(twin._value);
      }
    });
  }

  it('the text twin holds at least the bare sparse arrays as streams, so the comparison above is made', () => {
    const streams = HEX.filter((n) => textEntries.find((e) => e.name === n)?.value?._type === 'cdata');
    expect(streams.length).toBeGreaterThanOrEqual(9);
  });
});

describe('a hex value is read-only, all the way down, and its name is not', () => {
  const root = open();
  const design = root.getSection('design');
  for (const name of HEX) {
    it(name, () => {
      const entry = design.children.find((e: any) => e.name === name);
      for (const node of subtree(entry)) {
        const label = `${name}: ${node.id}`;
        const row = node.toRow();
        expect(row._valueEditable, label).toBe(false);
        expect(row._descriptionEditable, label).toBe(false);
        expect(node.valueEditable, label).toBe(false);
        expect(node.descriptionEditable, label).toBe(false);
        if (node !== entry) {
          expect(row.Name.editable, label).toBe(false);
        }
        for (const [key, cell] of Object.entries(row)) {
          if (key !== 'Name' && cell && typeof cell === 'object') {
            expect((cell as { editable?: boolean }).editable, `${label} ${key}`).not.toBe(true);
          }
        }
        expect(typeof node.canAddChild === 'function' ? node.canAddChild() : false, label).toBe(false);
        expect(typeof node.canRemoveChild === 'function' ? node.canRemoveChild() : false, label).toBe(false);
        for (const prop of ['Value', 'Description', 'DataType']) {
          const result = node.setProperty(prop, '1');
          expect(result, `${label} ${prop}`).toMatchObject({ error: true });
        }
      }
      // And none of that changed what is written.
      expect(valueTag(serializeEntryToXml(entry), name)).toBe(valueTag(MATLAB_CHUNK, name));
    });
  }
});

describe('a text dictionary\'s MAT stream pasted into a binary dictionary goes in as the hex MATLAB writes', () => {
  // The other direction. A sparse array in a text dictionary is a cdata stream of the same
  // bytes MATLAB's binary twin holds as hex, so an untouched one is written as that hex —
  // attribute for attribute, line for line — rather than rebuilt as XML: the full array
  // XML can spell is a different variable, and `Class="sparse"`, what it was spelled as
  // before, makes MATLAB's reader segfault.
  const session = createSession();
  const binary = open(session);
  const text = open(session, 'sparse_text.sldd');
  const streams = text.getSection('design').children.filter((e: any) => HEX.includes(e.name) && e._rawInput?._type === 'cdata');
  let seq = 0;

  it('covers every bare sparse array the text twin holds as a stream', () => {
    expect(streams.map((e: any) => e.name).sort()).toEqual(
      ['spAllZero', 'spBig', 'spCol', 'spComplex', 'spDiag', 'spLogical', 'spNonFinite', 'spRow', 'spSingle', 'spTall'],
    );
  });

  for (const entry of streams) {
    it(entry.name, () => {
      const payload: any = JSON.parse(JSON.stringify(entry.serialize()));
      payload.name = entry.name + 'FromText';
      payload.metadata = { ...payload.metadata, uuid: `00000000-0000-4000-9000-${String(++seq).padStart(12, '0')}` };
      const pasted = binary.getSection('design').parseEntry(payload);
      expect(valueTag(serializeEntryToXml(pasted), entry.name + 'FromText')).toBe(valueTag(MATLAB_CHUNK, entry.name));
    });
  }

  const pasteFromText = (name: string, as: string): any => {
    const source = text.getSection('design').children.find((e: any) => e.name === name);
    const payload: any = JSON.parse(JSON.stringify(source.serialize()));
    payload.name = as;
    payload.metadata = { ...payload.metadata, uuid: `00000000-0000-4000-9000-${String(++seq).padStart(12, '0')}` };
    return binary.getSection('design').parseEntry(payload);
  };

  it('an edited one is still sparse: the hex of the stream for what it now holds', () => {
    // MatWriter writes MATLAB's own bytes for a sparse array, so an element set to the
    // value it has is MATLAB's element again, line for line, and an edit is in the stream.
    // It used to be the full array as XML, which MATLAB reads back as a full one.
    const same = pasteFromText('spRow', 'spRowSame');
    expect(same.children.map((c: any) => c.displayName)).toEqual(['spRowSame(1,2)', 'spRowSame(1,4)']);
    expect(same.children[0].setProperty('Value', '2')).toBe(true);
    expect(valueTag(serializeEntryToXml(same), 'spRowSame')).toBe(valueTag(MATLAB_CHUNK, 'spRow'));
    const edited = pasteFromText('spRow', 'spRowEdited');
    expect(edited.children[0].setProperty('Value', '7')).toBe(true);
    const tag = valueTag(serializeEntryToXml(edited), 'spRowEdited');
    expect(tag).toMatch(/^<P Name="Value" Class="double" Encoding="hex" EncodedLength="\d+">/);
    const v: any = readMxArrayRecords(hexBytes(tag).buffer).outer;
    expect([v.isSparse, v.className, v.dimensions, denseOf(v)]).toEqual([true, 'double', [1, 5], [0, 7, 0, 4, 0]]);
  });

  it('a renamed one is still the hex MATLAB writes for it, and the dictionary reopens with it', () => {
    // A rename kept the encoded stream of a value READ from hex, and dropped the stream a
    // pasted value still was: spDiag went out full, and spTall — then too large to decode —
    // as `Class="double"><10000000x2 double, not decoded></P>`, unescaped, which MATLAB
    // refused to open the whole dictionary over while this package reopened it as `0`.
    const session = createSession();
    const target = open(session);
    for (const entry of streams) {
      const payload: any = JSON.parse(JSON.stringify(entry.serialize()));
      payload.name = entry.name + 'Pasted';
      payload.metadata = { ...payload.metadata, uuid: `00000000-0000-4000-9100-${String(++seq).padStart(12, '0')}` };
      const pasted = target.getSection('design').parseEntry(payload);
      expect(pasted.setProperty('Name', entry.name + 'Renamed'), entry.name).toBe(true);
      expect(valueTag(serializeEntryToXml(pasted), entry.name + 'Renamed'), entry.name).toBe(valueTag(MATLAB_CHUNK, entry.name));
    }
    const reopened: any = ingest(createSession(), buffer(session.serializeSource(target.name)!.bytes), { filename: 'r.sldd' });
    const design = reopened.getSection('design');
    for (const entry of streams) {
      const own = design.children.find((e: any) => e.name === entry.name);
      const renamed = design.children.find((e: any) => e.name === entry.name + 'Renamed');
      expect([renamed.displayValue, renamed.dims], entry.name).toEqual([own.displayValue, own.dims]);
    }
  });

  it('a value with no sparse array in it is not hex: MATLAB writes hex only for what holds one or a handle', () => {
    // Every entry MATLAB wrote as XML in the binary twin, pasted from the text twin, is
    // XML — dComplex included, which the text twin holds as a MAT stream as it holds the
    // sparse arrays (MatlabVariableNode.needsHexInBinary is what tells them apart).
    const xmlEntries = ENTRIES.filter((n) => !HEX.includes(n));
    expect(xmlEntries).toContain('dComplex');
    expect(text.getSection('design').children.find((e: any) => e.name === 'dComplex')._rawInput._type).toBe('cdata');
    for (const name of xmlEntries) {
      const tag = valueTag(serializeEntryToXml(pasteFromText(name, name + 'Xml')), name + 'Xml');
      expect(tag, name).not.toContain('Encoding=');
    }
    expect(valueTag(serializeEntryToXml(pasteFromText('dComplex', 'dComplexAgain')), 'dComplexAgain')).toMatch(
      /^<P Name="Value" Class="double" IsComplex="1" Dimension="3\*4">1\.0\+2\.0i /,
    );
  });

  it('a Simulink.Parameter whose Value is sparse: the Value is that array\'s own hex element, edited or not', () => {
    // MATLAB writes such an entry as one hex stream with its MCOS subsystem, which nothing
    // here can write; it reads the Value back sparse from its own hex element inside the
    // Parameter's XML (R2027a, all three). Edited, the Value went out as
    // `Class="sparse" Dimension="3*3">42 0 6 5 0 0 0 0 0` — the attribute MATLAB's reader
    // segfaults on, and for the complex one without its imaginary parts.
    // Each edits a non-zero, the one row an element of a sparse array has: pSp's (1,2),
    // the others' (2,1).
    const twins: Record<string, any> = {
      pSp: { row: 'Value(1,2)', text: '42', re: [0, 0, 6, 42, 0, 0, 0, 0, 0], complex: false, cls: 'double' },
      pSpComplex: { row: 'Value(2,1)', text: '42', re: [0, 42, 1, 0], im: [0, 0, 1, 0], complex: true, cls: 'double' },
      pSpLogical: { row: 'Value(2,1)', text: 'false', re: [0, 0, 1, 0], complex: false, cls: 'logical' },
    };
    for (const [name, want] of Object.entries(twins)) {
      const source = TEXT_ENTRIES.find((e) => e.name === name).value._elements[0]._properties.Value;
      const untouched = serializeEntryToXml(pasteFromText(name, name + 'Untouched'));
      const valueOf = (xml: string): string => {
        const at = xml.lastIndexOf('<P Name="Value"');
        return xml.slice(at, xml.indexOf('</P>', at) + 4);
      };
      expect(untouched, name).not.toContain('sparse');
      expect(Array.from(hexBytes(valueOf(untouched))), name).toEqual(Array.from(uudecode(source._value).slice(0, hexBytes(valueOf(untouched)).length)));

      const pasted = pasteFromText(name, name + 'Edited');
      const value = pasted.children.find((c: any) => c.name === 'Value');
      expect(value.children.find((c: any) => c.displayName === want.row).setProperty('Value', want.text), name).toBe(true);
      const xml = serializeEntryToXml(pasted);
      expect(xml, name).not.toContain('sparse');
      const tag = valueOf(xml);
      expect(tag, name).toMatch(new RegExp(`^<P Name="Value" Class="${want.cls}" Encoding="hex" EncodedLength="\\d+">`));
      const v: any = readMxArrayRecords(hexBytes(tag).buffer).outer;
      expect([v.isSparse, v.isComplex], name).toEqual([true, want.complex]);
      const flat = denseOf(v).map((x: any) => (typeof x === 'object' ? x : { re: x, im: 0 }));
      // Column-major, as the twins above are spelled.
      const [rows, cols] = v.dimensions;
      const colMajor: any[] = [];
      for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) colMajor.push(flat[r * cols + c]);
      expect(colMajor.map((x) => Number(x.re) + 0), name).toEqual(want.re);
      if (want.im) {
        expect(colMajor.map((x) => Number(x.im) + 0), name).toEqual(want.im);
      }
    }
  });
});

describe('an entry pasted across the two dictionary formats carries its metadata in the target\'s keys', () => {
  // The two readers file one entry's facts under different keys: {lastmod, modifiedby} in
  // a text dictionary, {lastModifiedDate, lastModifiedBy, _rawLastMod} as BinarySlddParser
  // reads a binary one. A binary entry pasted into a text dictionary kept the binary keys,
  // and MATLAB then refused to open the text dictionary at all ("Failed to open file",
  // measured on R2027a with a plain double pasted that way) — whatever the value was.
  const session = createSession();
  const binary = open(session);
  const text = open(session, 'sparse_text.sldd');
  const copy = (from: any, name: string, into: any) => {
    const source = from.getSection('design').children.find((e: any) => e.name === name);
    const payload: any = JSON.parse(JSON.stringify(source.serialize()));
    payload.name = name + 'Across';
    payload.metadata = { ...payload.metadata, uuid: '00000000-0000-4000-a000-000000000001' };
    return { source, pasted: into.getSection('design').parseEntry(payload) };
  };

  it('binary into text: MATLAB\'s text keys, in its order, the raw timestamp as lastmod', () => {
    for (const name of ['dRow', 'spDiag', 'pSp']) {
      const { source, pasted } = copy(binary, name, text);
      const md = JSON.parse(JSON.stringify(pasted.serialize())).metadata;
      expect(Object.keys(md), name).toEqual(['uuid', 'namespace', 'lastmod', 'modifiedby', 'isderived']);
      expect([md.lastmod, md.modifiedby], name).toEqual([source.metadata._rawLastMod, source.metadata.lastModifiedBy]);
    }
    // A text dictionary's own entry is untouched.
    const own = text.getSection('design').children.find((e: any) => e.name === 'dRow');
    expect(own.serialize().metadata).toBe(own.metadata);
  });

  it('text into binary: the author is written, not left empty', () => {
    const { source, pasted } = copy(text, 'dRow', binary);
    expect(serializeEntryToXml(pasted)).toContain(`<P Name="LastModBy" Class="char">${source.metadata.modifiedby}</P>`);
    expect(serializeEntryToXml(pasted)).toContain(`<P Name="LastMod" Class="char">${source.metadata.lastmod}</P>`);
  });

  it('text into binary: a cell holding a sparse array goes in as the hex MATLAB writes, a struct with its member\'s own', () => {
    // MATLAB writes such an entry entirely as hex. A cell's stream is MatWriter's bytes,
    // which are MATLAB's (the element for c is the one MATLAB wrote, line for line); a
    // struct is written as XML with its sparse field as that field's own hex element, which
    // MATLAB reads back sparse (R2027a). They used to go in with the member full.
    expect(valueTag(serializeEntryToXml(copy(text, 'c', binary).pasted), 'cAcross')).toBe(valueTag(MATLAB_CHUNK, 'c'));
    const st = serializeEntryToXml(copy(text, 'st', binary).pasted);
    expect(st).not.toContain('sparse');
    const at = st.indexOf('<P Name="sp"');
    const sp = st.slice(at, st.indexOf('</P>', at) + 4);
    expect(sp).toMatch(/^<P Name="sp" Class="double" Encoding="hex" EncodedLength="120">/);
    const twin = TEXT_ENTRIES.find((e) => e.name === 'st').value._elements[0].sp;
    expect(Array.from(hexBytes(sp))).toEqual(Array.from(uudecode(twin._value).slice(0, 120)));
    expect(st).toContain('<P Name="d" Class="double" Dimension="1*2">7.0 8.0</P>');
  });
});

describe('a .mat\'s sparse array pasted into a dictionary is the stream MATLAB writes for it there', () => {
  // test/fixtures/sparse/sparse_values.mat holds the same values. A sparse array decoded
  // out of it is written by MatWriter from its non-zeros, whose bytes are MATLAB's — spTall
  // too, 10000000x2: until 1.36.3 it was too large to decode, and was written from the
  // element the .mat holds, re-framed as a stream (MatWriter.matStreamOfElement); before
  // that it went in as the text of its placeholder: a char in a text dictionary, and in a
  // binary one an unescaped `<10000000x2 double, not decoded>` that made the file one
  // MATLAB would not open.
  const session = createSession();
  const mat: any = ingest(session, buffer(fixture('sparse_values.mat')), { filename: 'sparse_values.mat' });
  const binary = open(session);
  const text = open(session, 'sparse_text.sldd');
  const BARE = ['spAllZero', 'spBig', 'spCol', 'spComplex', 'spDiag', 'spLogical', 'spNonFinite', 'spRow', 'spSingle', 'spTall'];
  let seq = 0;
  const pasteInto = (root: any, name: string): any => {
    const source = mat.children.find((v: any) => v.name === name);
    const payload = { name: name + 'FromMat', metadata: { uuid: `00000000-0000-4000-b000-${String(++seq).padStart(12, '0')}` }, value: JSON.parse(JSON.stringify(source.serializeValue())) };
    return root.getSection('design').parseEntry(payload);
  };

  for (const name of BARE) {
    it(name, () => {
      expect(valueTag(serializeEntryToXml(pasteInto(binary, name)), name + 'FromMat'), 'binary').toBe(valueTag(MATLAB_CHUNK, name));
      expect(JSON.parse(JSON.stringify(pasteInto(text, name).serialize())).value, 'text').toEqual(TEXT_ENTRIES.find((e) => e.name === name).value);
    });
  }

  it('a cell holding one a level further down is one stream too, as MATLAB writes any entry holding one', () => {
    // {{sparse([1 0 2; 0 3 0])}}: the inner cell holds the sparse array, the outer one only
    // the inner cell.
    const sp = sparseVar({ name: '', dimensions: [2, 3], ir: [0, 1, 0], jc: [0, 1, 2, 3], real: [1, 3, 2] });
    const nested: any = ingest(session, matFile([cellVar('cc', [cellVar('', [sp])])]), { filename: 'nested.mat' });
    const payload = { name: 'ccFromMat', metadata: { uuid: '00000000-0000-4000-b100-000000000001' }, value: JSON.parse(JSON.stringify(nested.children[0].serializeValue())) };
    const tag = valueTag(serializeEntryToXml(binary.getSection('design').parseEntry(payload)), 'ccFromMat');
    expect(tag).toMatch(/^<P Name="Value" Class="cell" Encoding="hex" EncodedLength="\d+">/);
    const outer: any = readMxArrayRecords(hexBytes(tag).buffer).outer;
    const inner = outer.value[0].value[0];
    expect([outer.className, outer.value[0].className, inner.isSparse, denseOf(inner)]).toEqual(['cell', 'cell', true, [1, 0, 2, 0, 3, 0]]);
  });
});

describe('one damaged hex value does not stop the dictionary opening', () => {
  it('MATLAB\'s file with entry c\'s stream damaged: every entry opens, c as not decoded, and the warning names it', () => {
    // The flags word of c's sparse element overwritten, the EncodedLength unchanged: the
    // stream is framed right and does not decode. ingest threw ("Cannot read properties of
    // null (reading 'im')") and nothing of the file opened; 1.36.1 opened it all.
    const parts = unzipSync(fixture('sparse_binary.sldd'));
    const tag = valueTag(MATLAB_CHUNK, 'c');
    const bytes = hexBytes(tag);
    new DataView(bytes.buffer).setUint32(72, 0xffffffff, true);
    const digits = Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
    const damaged = tag.slice(0, tag.indexOf('>') + 1) + digits + '</P>';
    const chunk = MATLAB_CHUNK.replace(tag, damaged);
    const zip = zipSync({ ...parts, 'data/chunk0.xml': new TextEncoder().encode(chunk) });
    const session = createSession();
    const root: any = ingest(session, buffer(zip), { filename: 'damaged.sldd' });
    const design = root.getSection('design');
    expect(design.children.map((e: any) => e.name).sort()).toEqual([...ENTRIES].sort());
    expect(design.children.find((e: any) => e.name === 'c').displayValue).toBe('<1x2 cell, not decoded>');
    expect(root.warnings).toEqual([expect.objectContaining({ code: 'part-unreadable', part: 'c' })]);
    // And a save writes the damaged bytes back as they were.
    expect(valueTag(chunkOf(session.serializeSource(root.name)!.bytes), 'c')).toBe(damaged);
  });
});
