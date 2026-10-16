// Copyright 2026 The MathWorks, Inc.
//
// The MCOS decoder says what it could not read (C-260, with C-228's and C-229's warning).
//
// Two things the decoder does on purpose stay as they are, and the tests that pin them are
// unchanged (mcosParser.test.ts, mcosBlockSegmentEnd.test.ts, nestedMcos.test.ts):
//
//   * readBlocks STOPS at a property count that cannot be right, so every object whose
//     property block came after the damage keeps only its class defaults;
//   * the confidence gate REFUSES a whole variable whose handle names an object the table
//     does not hold, or objects of another class than the variable declares.
//
// What changes is that neither is silent any more. Each one is a `part-unreadable` warning
// naming the variable by its MATLAB path, the way MatParser names an undecoded piece: the
// file opened, this object in it did not, or did only in part. One warning per VARIABLE:
// lost bytes that no object addresses change nothing on screen and say nothing.
//
// The null object is not a refusal: MATLAB writes ids [0] for a handle that saved no state
// (a delite .mat holds two Simulink.ModelWorkspace handles that way), and it stays quiet.
//
// Every fixture here is MATLAB-written; the damage is a same-length word patch, located by
// the decoder's own header predicate and asserted, so a fixture that moves fails loudly.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8, strToU8 } from 'fflate';
import { parseMat, type MatVariable } from '../src/datamodel/parser/MatParser.js';
import { parseSlx } from '../src/datamodel/parser/SlxParser.js';
import { decodeMcosVariables, type McosDecodeIssue } from '../src/datamodel/parser/McosParser.js';
import { hexText } from '../src/datamodel/parser/EncodedValue.js';
import { uuencode } from '../src/datamodel/parser/CdataCodec.js';
import { parseBinarySlddParts } from '../src/datamodel/parser/BinarySlddParser.js';
import { regenerateEntryXml, serializeEntryToXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import type { ParseWarning } from '../src/datamodel/parser/ParseWarning.js';
import { mcosDecodedFor } from '../src/datamodel/node/data/mcosDecodedTable.js';
import MatNode from '../src/datamodel/node/container/MatNode.js';
import ModelNode from '../src/datamodel/node/container/ModelNode.js';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

function bytes(rel: string): ArrayBuffer {
  const buf = readFileSync(FIXTURES + rel);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

// Every warning this change files, and nothing else: the positive tests below match it, so
// the no-false-positive sweep cannot pass on a needle that matches nothing.
const MCOS_WARNING = /^the MATLAB object "/;
const mcosWarnings = (warnings: readonly ParseWarning[] | undefined): ParseWarning[] =>
  (warnings ?? []).filter((w) => MCOS_WARNING.test(w.message));

// ---- Locating the metadata table: the uint8 cell[0] of the subsystem ------------------

const MI_UINT8 = 2;

/**
 * The byte offset of the subsystem's metadata table in `raw`, found as the decoder finds a
 * table it trusts: a miUINT8 element whose first ten words have monotonic segment ends
 * inside it. Exactly one such element, or the fixture is not what these patches assume.
 */
function metaAt(raw: Uint8Array): number {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const found: number[] = [];
  for (let o = 8; o + 40 <= raw.length; o += 4) {
    if (view.getUint32(o - 8, true) !== MI_UINT8) continue;
    const len = view.getUint32(o - 4, true);
    if (len < 40 || o + len > raw.length) continue;
    const w = Array.from({ length: 10 }, (_, i) => view.getUint32(o + 4 * i, true));
    if (40 <= w[2] && w[2] <= w[3] && w[3] <= w[4] && w[4] <= w[5] && w[5] <= w[6] && w[6] <= len) found.push(o);
  }
  expect(found, 'one metadata table').toHaveLength(1);
  return found[0];
}

/** The ten header words of the table at `meta`. */
function header(raw: Uint8Array, meta: number): number[] {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  return Array.from({ length: 10 }, (_, i) => view.getUint32(meta + 4 * i, true));
}

/** The table-relative start of each block in the segment [from, to), walked as readBlocks walks it. */
function blockStarts(raw: Uint8Array, meta: number, from: number, to: number): number[] {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const starts: number[] = [];
  for (let p = from; p < to; ) {
    starts.push(p);
    const n = view.getUint32(meta + p, true);
    const end = p + 4 + n * 12;
    p = end + ((8 - ((end - p) % 8)) % 8);
  }
  return starts;
}

function withWord(raw: Uint8Array, at: number, word: number): Uint8Array {
  const out = raw.slice();
  new DataView(out.buffer, out.byteOffset, out.byteLength).setUint32(at, word >>> 0, true);
  return out;
}

const anonymousOf = (variables: MatVariable[]): MatVariable => variables.find((v) => v._anonymous)!;

/** A .mat parsed, its subsystem bytes run through `damage`, and the file built as MatNode builds it. */
function openMat(rel: string, damage?: (parsed: ReturnType<typeof parseMat>) => void) {
  const parsed = parseMat(bytes(rel));
  damage?.(parsed);
  const node = MatNode.fromParsed(parsed, rel.split('/').pop()!);
  return { parsed, node, warnings: mcosWarnings(parsed.warnings) };
}

/** Patch one word of a .mat's subsystem, at a table-relative offset `at(header)`. */
const patchTable = (at: (w: number[], raw: Uint8Array, meta: number) => number, word: number) =>
  (parsed: ReturnType<typeof parseMat>): void => {
    const anon = anonymousOf(parsed.variables);
    const raw = anon._rawBytes!;
    const meta = metaAt(raw);
    anon._rawBytes = withWord(raw, meta + at(header(raw, meta), raw, meta), word);
  };

describe('a property block the reader stopped before', () => {
  // busArray.mat: buses is a 1x3 Simulink.Bus. The two patches are the ones
  // mcosParser.test.ts's "stops reading blocks" pins the defaults-only result for.
  const cases: [string, (w: number[], raw: Uint8Array, meta: number) => number, number][] = [
    ['a count over the 1000-property cap', (w) => w[5], 99999],
    ['a count that overruns its segment', (w, raw, meta) => blockStarts(raw, meta, w[5], w[6])[1], 999],
  ];
  for (const [what, at, word] of cases) {
    it(`${what}: one warning, for the variable, and the stop is unchanged`, () => {
      const { parsed, warnings } = openMat('mcos/busArray.mat', patchTable(at, word));
      expect(warnings.map((w) => [w.code, w.part]), what).toEqual([['part-unreadable', 'buses']]);
      expect(warnings[0].message, what).toMatch(
        /^the MATLAB object "buses" was decoded in part: \d+ of its objects' property blocks could not be read, so those objects show only their class defaults\.$/,
      );
      // The decode the node layer reads is the one the pinned test asserts.
      const decoded = mcosDecodedFor(parsed.variables.find((v) => v.name === 'buses')!)!;
      expect(Object.keys(decoded.properties), what).toEqual(['Alignment']);
      expect(decoded.elements, what).toHaveLength(3);
    });
  }

  it('lost bytes that no object addresses say nothing', () => {
    // strings.mat's type-2 segment holds block 0 alone, the empty block, and every string
    // in it addresses that one (a string's state is its type-1 block). Losing it changes
    // nothing on screen, so nothing is said.
    const { parsed, warnings } = openMat('strings.mat', patchTable((w) => w[5], 99999));
    expect(warnings).toEqual([]);
    // The decode is the same one the whole file gives.
    const whole = openMat('strings.mat');
    for (const v of parsed.variables.filter((x) => x.className === 'string')) {
      const twin = whole.parsed.variables.find((x) => x.name === v.name)!;
      expect(mcosDecodedFor(v)?.stringElements, v.name).toEqual(mcosDecodedFor(twin)?.stringElements);
    }
  });
});

describe('a type-1 block the reader stopped before: a string\'s text', () => {
  it('strings.mat with the type-1 segment\'s first count over the cap warns once per string', () => {
    const { parsed, warnings } = openMat('strings.mat', patchTable((w) => w[3], 99999));
    const names = parsed.variables.filter((v) => v.className === 'string').map((v) => v.name);
    expect(names.length).toBeGreaterThan(0);
    expect(warnings.map((w) => w.part).sort()).toEqual(names.slice().sort());
    for (const w of warnings) {
      expect(w.message).toBe(
        `the MATLAB object "${w.part}" was decoded in part: 1 of its strings' text could not be read, so those strings are shown without it.`,
      );
    }
  });
});

describe('a variable the confidence gate refused', () => {
  const setHandle = (name: string, ids: number[]) => (parsed: ReturnType<typeof parseMat>): void => {
    parsed.variables.find((v) => v.name === name)!.mcosHandle = { dims: [1, ids.length], ids };
  };

  it('an id past the object table', () => {
    const { warnings } = openMat('mcos/Param.mat', setHandle('Param', [99999]));
    expect(warnings.map((w) => [w.code, w.part])).toEqual([['part-unreadable', 'Param']]);
    expect(warnings[0].message).toMatch(
      /^the MATLAB object "Param" could not be decoded, so its properties are not shown: its handle names object 99999, and the object table has \d+ rows\.$/,
    );
  });

  it('the null object, id 0, is not a refusal and says nothing', () => {
    expect(openMat('mcos/Param.mat', setHandle('Param', [0])).warnings).toEqual([]);
  });

  it('a handle that mixes the null object with an id past the table still warns, for the bad id', () => {
    const { warnings } = openMat('mcos/Param.mat', setHandle('Param', [0, 99999]));
    expect(warnings.map((w) => w.part)).toEqual(['Param']);
    expect(warnings[0].message).toContain('its handle names object 99999');
  });

  it('objects of another class than the variable declares', () => {
    const { warnings } = openMat('mcos/Param.mat', (parsed) => {
      parsed.variables.find((v) => v.name === 'Param')!.className = 'Simulink.Signal';
    });
    expect(warnings.map((w) => [w.code, w.part])).toEqual([['part-unreadable', 'Param']]);
    expect(warnings[0].message).toBe(
      'the MATLAB object "Param" could not be decoded, so its properties are not shown: '
        + 'its objects are of class Simulink.Parameter, not Simulink.Signal.',
    );
  });

  it('an object whose class id is past the class table', () => {
    const { warnings } = openMat('mcos/Param.mat', (parsed) => {
      const id = parsed.variables.find((v) => v.name === 'Param')!.mcosHandle!.ids[0];
      patchTable((w) => w[4] + 24 * id, 9999)(parsed);
    });
    expect(warnings.map((w) => w.part)).toEqual(['Param']);
    expect(warnings[0].message).toMatch(/: its object \d+ names class 9999, and the class table has \d+ rows\.$/);
  });

  it('the decoder\'s own record: refused, and absent from the result', () => {
    const parsed = parseMat(bytes('mcos/Param.mat'));
    const raw = anonymousOf(parsed.variables)._rawBytes!;
    const param = parsed.variables.find((v) => v.name === 'Param')!;
    const bad = { ...param, mcosHandle: { dims: [1, 1], ids: [99999] } };
    const nul = { ...param, mcosHandle: { dims: [1, 1], ids: [0] } };
    const issues = new Map<MatVariable, McosDecodeIssue>();
    const decoded = decodeMcosVariables(raw, [bad, nul, param], issues);
    expect([decoded.has(bad), decoded.has(nul), decoded.has(param)]).toEqual([false, false, true]);
    expect([...issues.keys()]).toEqual([bad]);
    expect(issues.get(bad)!.refused).toBe(true);
  });
});

describe('a nested object, named by its MATLAB path', () => {
  // strings_nested.mat: mixStruct = struct('p', {Simulink.Parameter(7)}, 's', {"inStruct"});
  // mixCell = {Simulink.Parameter(8), "inCell", 9}.
  it('a struct field and a cell element', () => {
    const { warnings } = openMat('strings_nested.mat', (parsed) => {
      const mixStruct = parsed.variables.find((v) => v.name === 'mixStruct')!;
      const mixCell = parsed.variables.find((v) => v.name === 'mixCell')!;
      (mixStruct.fields!.p as MatVariable).mcosHandle = { dims: [1, 1], ids: [99999] };
      (mixCell.value as MatVariable[])[0].mcosHandle = { dims: [1, 1], ids: [99999] };
    });
    expect(warnings.map((w) => w.part).sort()).toEqual(['mixCell{1}', 'mixStruct.p']);
    for (const w of warnings) expect(w.message).toContain(`the MATLAB object "${w.part}" could not be decoded`);
  });

  it('an element of a struct array, 1-based as MATLAB counts', () => {
    const { warnings } = openMat('strings_nested.mat', (parsed) => {
      const mixStruct = parsed.variables.find((v) => v.name === 'mixStruct')!;
      const p = mixStruct.fields!.p as MatVariable;
      p.mcosHandle = { dims: [1, 1], ids: [99999] };
      // The field list of a struct array, one entry per element, as MatParser holds one.
      mixStruct.fields!.p = [p] as unknown as MatVariable;
    });
    expect(warnings.map((w) => w.part)).toEqual(['mixStruct(1).p']);
  });
});

describe('a model workspace', () => {
  it('mcosfix.slx with a workspace object whose handle is past the table', () => {
    const parsed = parseSlx(bytes('mcos/mcosfix.slx'), 'mcosfix.slx');
    expect(mcosWarnings(parsed.warnings)).toEqual([]);
    parsed.workspace.find((v) => v.name === 'Param')!.mcosHandle = { dims: [1, 1], ids: [99999] };
    ModelNode.fromParsed(parsed, 'mcosfix.slx');
    expect(mcosWarnings(parsed.warnings).map((w) => [w.code, w.part])).toEqual([['part-unreadable', 'Param']]);
  });
});

// ---- A dictionary's encoded value ------------------------------------------------------

/** MATLAB's pSp, a Simulink.Parameter whose Value is sparse, as test/fixtures/sparse/sparse_binary.sldd holds it in hex. */
function pSpStream(): Uint8Array {
  const chunk = new TextDecoder().decode(unzipSync(new Uint8Array(readFileSync(FIXTURES + 'sparse/sparse_binary.sldd')))['data/chunk0.xml']);
  const at = chunk.indexOf('<P Name="Name" Class="char">pSp</P>');
  const from = chunk.indexOf('<P Name="Value"', at);
  const tag = chunk.slice(from, chunk.indexOf('</P>', from));
  const digits = tag.slice(tag.indexOf('>') + 1).replace(/\s+/g, '');
  return Uint8Array.from(digits.match(/../g)!.map((h) => parseInt(h, 16)));
}

/** pSp with its subsystem's first type-2 count over the cap: its Parameter keeps only its class defaults. */
function damagedPSp(): Uint8Array {
  const stream = pSpStream();
  const meta = metaAt(stream);
  return withWord(stream, meta + header(stream, meta)[5], 99999);
}

const DECL = '<?xml version="1.0" encoding="UTF-8"?>';

/** A one-entry binary dictionary named `v`, one warnings list for the reader and the node layer, as ingest hands them. */
function binaryEntry(valueXml: string, warnings: ParseWarning[]): any {
  const xml =
    `${DECL}\n<DataSource FormatVersion="1" MinRelease="R2014a">\n    <Object Class="DD.ENTRY">\n` +
    `        <P Name="Name" Class="char">v</P>\n        <P Name="UUID" Class="char">u</P>\n` +
    `${valueXml}\n    </Object>\n</DataSource>`;
  const root: any = createSession().addDataSource('mem://mcos-' + Math.random(), parseBinarySlddParts(xml, {}, warnings), { path: 'e.sldd' }, warnings);
  return root.getSection('design').children[0];
}

const hexElement = (stream: Uint8Array): string =>
  `        <P Name="Value" Class="Simulink.Parameter" Encoding="hex" EncodedLength="${stream.length}">${hexText(stream, 2)}</P>`;

const valueIn = (xml: string): string => {
  const at = xml.indexOf('<P Name="Value"');
  return xml.slice(at, xml.indexOf('</P>', at) + 4);
};

describe('a dictionary\'s encoded value whose subsystem is damaged', () => {
  it('a binary dictionary\'s hex: one warning naming the entry, and the stream written back as read', () => {
    const tag = hexElement(damagedPSp());
    const warnings: ParseWarning[] = [];
    const entry = binaryEntry(tag, warnings);
    // Still the Parameter, built from what was read.
    expect(entry.className).toBe('Simulink.Parameter');
    expect(warnings.map((w) => [w.code, w.part])).toEqual([['part-unreadable', 'v']]);
    expect(warnings[0].message).toMatch(
      /^the MATLAB object "v" was decoded in part: \d+ of its objects' property blocks could not be read, so those objects show only their class defaults\.$/,
    );
    const written = valueIn(serializeEntryToXml(entry));
    expect(written).toBe(tag.trim());
    expect(valueIn(regenerateEntryXml(entry))).toBe(written);
  });

  it('the whole stream says nothing', () => {
    const warnings: ParseWarning[] = [];
    binaryEntry(hexElement(pSpStream()), warnings);
    expect(warnings).toEqual([]);
  });

  it('a partial decode is not reported against an entry it did not happen in', () => {
    // A paste builds its node the same way, outside any dictionary's read.
    const host = binaryEntry(hexElement(pSpStream()), []);
    host.parent.parseEntry({ name: 'pasted', metadata: { uuid: 'p' }, value: { _type: 'cdata', _value: uuencode(damagedPSp()) } });
    const warnings: ParseWarning[] = [];
    binaryEntry(hexElement(pSpStream()), warnings);
    expect(warnings).toEqual([]);
  });

  it('a text dictionary\'s cdata of the same stream: one warning naming the entry', () => {
    // The form this package writes a hex object into a text dictionary in
    // (MatWriter.textDictionaryForm), which MatlabVariableNode._parseCdataObjects reads.
    const json = JSON.parse(strFromU8(new Uint8Array(readFileSync(FIXTURES + 'sparse/sparse_text.sldd'))));
    const content = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content;
    const template = content.entries[0];
    content.entries = [
      { ...template, name: 'damaged', metadata: { ...template.metadata, uuid: '00000000-0000-4000-8000-0000000c0260' }, value: { _type: 'cdata', _value: uuencode(damagedPSp()) } },
      { ...template, name: 'whole', metadata: { ...template.metadata, uuid: '00000000-0000-4000-8000-0000000c0261' }, value: { _type: 'cdata', _value: uuencode(pSpStream()) } },
    ];
    const root: any = ingest(createSession(), strToU8(JSON.stringify(json)).buffer as ArrayBuffer, { filename: 't.sldd' });
    const entries = root.getSection('design').children;
    expect(entries.map((e: any) => [e.name, e.className])).toEqual([
      ['damaged', 'Simulink.Parameter'],
      ['whole', 'Simulink.Parameter'],
    ]);
    expect(mcosWarnings(root.warnings).map((w) => [w.code, w.part])).toEqual([['part-unreadable', 'damaged']]);
  });
});

// ---- No false positives ----------------------------------------------------------------

describe('every MATLAB-written object fixture opens with no MCOS warning', () => {
  const files = [
    ...readdirSync(FIXTURES + 'mcos').map((f) => 'mcos/' + f),
    ...readdirSync(FIXTURES + 'sparse').map((f) => 'sparse/' + f),
    ...readdirSync(FIXTURES).filter((f) => /^strings.*\.mat$/.test(f)),
  ]
    // A v7.3 file is HDF5, which this package refuses to open at all (MatParser.parseMat).
    .filter((f) => /\.(mat|slx|sldd)$/.test(f) && !f.endsWith('_v73.mat'));

  it('the sweep has files to sweep', () => {
    expect(files.length).toBeGreaterThan(20);
    for (const ext of ['.mat', '.slx', '.sldd']) expect(files.some((f) => f.endsWith(ext)), ext).toBe(true);
  });

  for (const file of files) {
    it(file, () => {
      const root: any = ingest(createSession(), bytes(file), { filename: file.split('/').pop()! });
      expect(mcosWarnings(root.warnings)).toEqual([]);
    });
  }
});
