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
// (a MATLAB-written .mat holds two Simulink.ModelWorkspace handles that way), and it stays quiet.
//
// A refused variable of a class the data model knows is the plain opaque it is with no
// decode, not an empty typed node of the declared class (C-229).
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
import { mcosDecodedFor, mcosRefused } from '../src/datamodel/node/data/mcosDecodedTable.js';
import { attachMcosDecoded, modelOpaqueMcosVariable } from '../src/datamodel/node/data/mcosTypedNode.js';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import ParameterNode from '../src/datamodel/node/data/ParameterNode.js';
import SignalNode from '../src/datamodel/node/data/SignalNode.js';
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

// ---- C-228: what is counted, and wherever the reader stopped --------------------------
//
// The count is of OBJECTS that address a block the reader did not read, and not of times
// the reader stopped. So it covers each way a segment can come up short (a count over the
// cap, a count that overruns its segment, a count with fewer than four bytes left to read
// it, and a header that ends the segment early, where there is no count to stop on at all),
// and it is silent when no object needed the lost bytes. A nested object counts toward the
// variable that reaches it, and an object reached twice counts once.

describe('C-228: an object whose property block was not read, counted for its variable', () => {
  // busArray.mat: buses = [Bus 1, Bus 3, Bus 6]. Each object has its own type-2 block, at
  // the index of its id, and Bus 6's Elements are BusElements 7, 8 and 9 (p, q and r): the
  // last three blocks of the segment. No object in the file uses a type-1 block.
  const BUSES = 'mcos/busArray.mat';
  const partial = (n: number): McosDecodeIssue => ({
    refused: false,
    reason: `${n} of its objects' property blocks could not be read, so those objects show only their class defaults`,
  });

  /** The type-2 blocks' table-relative starts, asserted to be the ten this file has. */
  function busBlocks(raw: Uint8Array, meta: number): number[] {
    const w = header(raw, meta);
    const starts = blockStarts(raw, meta, w[5], w[6]);
    expect(starts, 'busArray.mat has ten type-2 blocks').toHaveLength(10);
    return starts;
  }

  /**
   * busArray.mat's subsystem with the table-relative words `patch` names set, decoded by
   * the decoder itself with an issues map, optionally with a different handle for buses.
   */
  function decodeBuses(
    patch: (w: number[], len: number, starts: number[]) => [number, number][],
    ids?: number[],
  ) {
    const parsed = parseMat(bytes(BUSES));
    const raw = anonymousOf(parsed.variables)._rawBytes!;
    const meta = metaAt(raw);
    const len = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(meta - 4, true);
    let patched = raw;
    for (const [at, word] of patch(header(raw, meta), len, busBlocks(raw, meta))) {
      patched = withWord(patched, meta + at, word);
    }
    const buses = parsed.variables.find((v) => v.name === 'buses')!;
    expect(buses.mcosHandle?.ids).toEqual([1, 3, 6]);
    if (ids) buses.mcosHandle = { dims: [1, ids.length], ids };
    const issues = new Map<MatVariable, McosDecodeIssue>();
    const decoded = decodeMcosVariables(patched, [buses], issues);
    return { issue: issues.get(buses), decoded: decoded.get(buses) as any };
  }

  /** The Name of each BusElement under each of buses' three Bus objects. */
  const elementNames = (decoded: any): unknown[][] =>
    decoded.elements.map((bus: any) => {
      const els = bus.Elements_internal?._elements ?? (bus.Elements_internal ? [bus.Elements_internal] : []);
      return els.map((e: any) => e._properties.Name);
    });

  it('control: the pristine file records nothing, and names every element', () => {
    const { issue, decoded } = decodeBuses(() => []);
    expect(issue).toBeUndefined();
    expect(elementNames(decoded)).toEqual([['a'], ['x', 'y'], ['p', 'q', 'r']]);
  });

  it('a type-2 segment that ends 1-3 bytes into a count, and the control 4 bytes short', () => {
    // mcosBlockSegmentEnd.test.ts's patches. Ending 1-3 bytes into a count stops the reader
    // before it reads one; ending 4 bytes short lets it read one count (0, block 0) and end.
    // Either way the Bus objects' blocks 1, 3 and 6 are past the segment, which is all
    // that is counted: 3, the decode that test pins unchanged.
    for (const short of [4, 1, 2, 3]) {
      const { issue, decoded } = decodeBuses((_w, len) => [[4 * 5, len - short], [4 * 6, len]]);
      expect(issue, `w[5] = len - ${short}`).toEqual(partial(3));
      expect(Object.keys(decoded.properties), `w[5] = len - ${short}`).toEqual(['Alignment']);
      expect(decoded.elements).toHaveLength(3);
    }
  });

  it('the type-1 variant of those patches is no partial decode: it empties the object table', () => {
    // For the type-1 segment [w[3], w[4]) to end at the table's end, w[4] and w[5] must
    // sit there too, and the object table is [w[4], w[5]). With no rows, the gate refuses
    // buses (C-260's record); there is no object left to count.
    for (const short of [1, 2, 3]) {
      const { issue, decoded } = decodeBuses((_w, len) => [
        [4 * 3, len - short], [4 * 4, len], [4 * 5, len], [4 * 6, len],
      ]);
      expect(issue, `w[3] = len - ${short}`).toEqual({
        refused: true,
        reason: 'its handle names object 1, and the object table has 0 rows',
      });
      expect(decoded).toBeUndefined();
    }
  });

  it('a header that ends the type-2 segment before its last block: no count to stop on, and still said', () => {
    // w[6] = the start of block 9: the reader reads blocks 0-8 and ends, without breaking.
    // BusElement 9, buses(3)'s third element, is reached through Bus 6's Elements and
    // shows only its class defaults, so it has no Name. Every other element keeps its
    // Name, so the Bus objects' own blocks were read.
    const { parsed, warnings } = openMat(BUSES, (p) => {
      const anon = anonymousOf(p.variables);
      const raw = anon._rawBytes!;
      const meta = metaAt(raw);
      anon._rawBytes = withWord(raw, meta + 4 * 6, busBlocks(raw, meta)[9]);
    });
    expect(warnings.map((w) => [w.code, w.part])).toEqual([['part-unreadable', 'buses']]);
    expect(warnings[0].message).toBe(
      'the MATLAB object "buses" was decoded in part: 1 of its objects\' property blocks could not be read, '
        + 'so those objects show only their class defaults.',
    );
    const decoded = mcosDecodedFor(parsed.variables.find((v) => v.name === 'buses')!)!;
    expect(elementNames(decoded)).toEqual([['a'], ['x', 'y'], ['p', 'q', undefined]]);
  });

  it('a count that overruns its segment in a nested object\'s block counts the nested objects', () => {
    // Block 7's count = 999: blocks 7, 8 and 9 are lost, which are buses(3)'s three
    // BusElements. The three Bus objects' own blocks were read; what is counted is the
    // three objects reached through them.
    const { issue, decoded } = decodeBuses((_w, _len, starts) => [[starts[7], 999]]);
    expect(issue).toEqual(partial(3));
    expect(elementNames(decoded)).toEqual([['a'], ['x', 'y'], [undefined, undefined, undefined]]);
  });

  it('an object reached twice is counted once', () => {
    // A handle that names one object twice reaches it, and everything under it, twice.
    const top = decodeBuses((w) => [[w[5], 99999]], [1, 1]);
    expect(top.issue).toEqual(partial(1));
    expect(top.decoded.elements).toHaveLength(2);
    const nested = decodeBuses((_w, _len, starts) => [[4 * 6, starts[9]]], [6, 6]);
    expect(nested.issue).toEqual(partial(1));
  });

  it('each segment counts the objects that use it: a string\'s text, a Parameter\'s block', () => {
    // strings_nested.mat: mixCell{1} and mixStruct.p are Simulink.Parameter objects (type-2
    // blocks 1-3 and 4-6, with the CoderInfo objects under them); mixCell{2} and mixStruct.s
    // are strings (type-1 blocks 1 and 2, type-2 block 0). Losing one segment is said only
    // for the objects that address it: the type-1 blocks, for the strings alone; blocks 4-6,
    // for mixStruct.p alone, whose own block is the one counted (its CoderInfo is reached
    // through that block, so it is never reached at all).
    const type1Lost = openMat(
      'strings_nested.mat',
      patchTable((w, raw, meta) => blockStarts(raw, meta, w[3], w[4])[1], 99999),
    );
    expect(type1Lost.warnings.map((w) => w.part).sort()).toEqual(['mixCell{2}', 'mixStruct.s']);
    for (const w of type1Lost.warnings) expect(w.message).toContain(': 1 of its strings\' text could not be read');

    const type2Lost = openMat(
      'strings_nested.mat',
      patchTable((w, raw, meta) => blockStarts(raw, meta, w[5], w[6])[4], 999),
    );
    expect(type2Lost.warnings.map((w) => [w.part, w.message])).toEqual([[
      'mixStruct.p',
      `the MATLAB object "mixStruct.p" was decoded in part: ${partial(1).reason}.`,
    ]]);
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

// ---- C-229: what a refused object of a known class is shown as -------------------------

describe('C-229: a refused object of a class the data model knows is the plain opaque, not an empty typed node', () => {
  // Param.mat: Param = Simulink.Parameter(int32(42)). Refused, it was a ParameterNode built
  // from no properties at all — Value `[ ]`, DataType `auto`: a 1x1 Parameter that is not the
  // one in the file, and that a copy wrote out as an empty Parameter. It is now the row it is
  // with no decode, `<1x1 Simulink.Parameter>`: its class and its icon, no Value to edit, and
  // the bytes it was read from. The refusal itself, and its warning, are as they were.
  const setHandle = (name: string, ids: number[]) => (parsed: ReturnType<typeof parseMat>): void => {
    parsed.variables.find((v) => v.name === name)!.mcosHandle = { dims: [1, ids.length], ids };
  };
  const rowOf = (parent: { children: unknown[] }, name: string): any =>
    parent.children.find((c) => (c as { name: string }).name === name);

  /**
   * `row` is the plain opaque of `variable`: the node a variable of its class gets when there
   * is no decode, built here for a fresh copy of it (which neither table has heard of) by the
   * dispatch every undecoded opaque goes through.
   */
  function expectPlainOpaque(row: any, variable: MatVariable, className: string): void {
    expect(row.constructor, 'the node class').toBe(MatlabVariableNode);
    expect(row._isOpaque).toBe(true);
    expect(row._opaqueClassName).toBe(className);
    expect(row._matVar).toBe(variable);
    expect(variable._rawBytes, 'a top-level variable keeps its bytes').toBeInstanceOf(Uint8Array);
    expect(row._rawBytes).toBe(variable._rawBytes);
    const twin: any = MatlabVariableNode.parseMatVariable({ ...variable }, variable.name, null);
    expect(twin._isOpaque, 'the twin is the undecoded opaque').toBe(true);
    const shown = (n: any) => [n.className, n.icon, n.displayValue, n.dataType, n.children.length];
    expect(shown(row)).toEqual(shown(twin));
    expect(shown(row)).toEqual([className, expect.any(String), `<1x1 ${className}>`, '', 0]);
  }

  for (const ids of [[99999], [1.5], [-1]]) {
    it(`a handle naming object ${ids[0]}: the opaque, with its class and icon, and one warning`, () => {
      const { parsed, node, warnings } = openMat('mcos/Param.mat', setHandle('Param', ids));
      const variable = parsed.variables.find((v) => v.name === 'Param')!;
      const row = rowOf(node, 'Param');
      expect(row).not.toBeInstanceOf(ParameterNode);
      expectPlainOpaque(row, variable, 'Simulink.Parameter');
      expect(row.icon).toBe('wsParameters');
      expect(warnings.map((w) => [w.code, w.part])).toEqual([['part-unreadable', 'Param']]);
      expect(warnings[0].message).toContain(`could not be decoded, so its properties are not shown: its handle names object ${ids[0]},`);
    });
  }

  it('objects of another class than the variable declares: the opaque of the declared class, not a SignalNode', () => {
    const { parsed, node, warnings } = openMat('mcos/Param.mat', (p) => {
      p.variables.find((v) => v.name === 'Param')!.className = 'Simulink.Signal';
    });
    const row = rowOf(node, 'Param');
    expect(row).not.toBeInstanceOf(SignalNode);
    expectPlainOpaque(row, parsed.variables.find((v) => v.name === 'Param')!, 'Simulink.Signal');
    expect(warnings.map((w) => w.part)).toEqual(['Param']);
    expect(warnings[0].message).toContain('its objects are of class Simulink.Parameter, not Simulink.Signal');
  });

  it('a model workspace: the refused row is the opaque, and every other row is what it was', () => {
    const shape = (model: any): string[] =>
      model.getSection('workspace').children.map((c: any) => `${c.name}:${c.constructor.name}`);
    const pristine = shape(ModelNode.fromParsed(parseSlx(bytes('mcos/mcosfix.slx'), 'mcosfix.slx'), 'mcosfix.slx'));
    expect(pristine).toContain('Param:ParameterNode');

    const parsed = parseSlx(bytes('mcos/mcosfix.slx'), 'mcosfix.slx');
    const variable = parsed.workspace.find((v) => v.name === 'Param')!;
    variable.mcosHandle = { dims: [1, 1], ids: [99999] };
    const model: any = ModelNode.fromParsed(parsed, 'mcosfix.slx');
    expectPlainOpaque(rowOf(model.getSection('workspace'), 'Param'), variable, 'Simulink.Parameter');
    expect(shape(model)).toEqual(pristine.map((row) => (row === 'Param:ParameterNode' ? 'Param:MatlabVariableNode' : row)));
    expect(mcosWarnings(parsed.warnings).map((w) => [w.code, w.part])).toEqual([['part-unreadable', 'Param']]);
  });

  it('a nested object was the opaque already, and says so now', () => {
    const { node, warnings } = openMat('strings_nested.mat', (parsed) => {
      const mixStruct = parsed.variables.find((v) => v.name === 'mixStruct')!;
      (mixStruct.fields!.p as MatVariable).mcosHandle = { dims: [1, 1], ids: [99999] };
    });
    const p = rowOf(rowOf(node, 'mixStruct'), 'p');
    expect([p.constructor, p._isOpaque, p._opaqueClassName]).toEqual([MatlabVariableNode, true, 'Simulink.Parameter']);
    expect(warnings.map((w) => [w.code, w.part])).toEqual([['part-unreadable', 'mixStruct.p']]);
  });

  it('a copy of the refused row is a copy of the opaque, not of an empty Parameter', () => {
    const { parsed, node } = openMat('mcos/Param.mat', setHandle('Param', [99999]));
    const variable = parsed.variables.find((v) => v.name === 'Param')!;
    const copied = JSON.parse(JSON.stringify(rowOf(node, 'Param').serializeValue()));
    const twin: any = MatlabVariableNode.parseMatVariable({ ...variable }, 'Param', null);
    expect(copied).toEqual(JSON.parse(JSON.stringify(twin.serializeValue())));
    expect(JSON.stringify(copied)).not.toContain('Simulink.Parameter');
  });

  // ---- Controls: none of these is a refusal, and each is the node it was -------------

  it('control: the pristine file is the ParameterNode of the file', () => {
    const { node, warnings } = openMat('mcos/Param.mat');
    const row = rowOf(node, 'Param');
    expect(row).toBeInstanceOf(ParameterNode);
    expect([row.Value, row.displayValue]).toEqual([42, '42']);
    expect(warnings).toEqual([]);
  });

  it('control: the null object, id 0, keeps its empty typed node and says nothing', () => {
    const { node, warnings } = openMat('mcos/Param.mat', setHandle('Param', [0]));
    expect(rowOf(node, 'Param')).toBeInstanceOf(ParameterNode);
    expect(warnings).toEqual([]);
  });

  it('control: a known class with no decode, and nothing recorded for it, is its typed node', () => {
    const variable = (): MatVariable =>
      ({ name: 'K', className: 'Simulink.Parameter', dimensions: [1, 1], isComplex: false, isLogical: false, value: null, fields: null, isOpaque: true }) as unknown as MatVariable;
    // Never attached...
    expect(modelOpaqueMcosVariable(variable(), undefined, null)).toBeInstanceOf(ParameterNode);
    // ...and attached with no blob to decode against.
    const v = variable();
    attachMcosDecoded(null, [v]);
    expect(modelOpaqueMcosVariable(v, mcosDecodedFor(v), null)).toBeInstanceOf(ParameterNode);
  });

  it('control: a decode in part is not a refusal, and keeps its typed node', () => {
    const pristine = rowOf(openMat('mcos/busArray.mat').node, 'buses');
    const { parsed, node, warnings } = openMat('mcos/busArray.mat', patchTable((w) => w[5], 99999));
    // Recorded as what it is: decoded, and not refused.
    const buses = parsed.variables.find((v) => v.name === 'buses')!;
    expect([mcosDecodedFor(buses) !== undefined, mcosRefused(buses)]).toEqual([true, false]);
    const row = rowOf(node, 'buses');
    expect(row._isOpaque).not.toBe(true);
    expect(row.constructor).toBe(pristine.constructor);
    expect(row.constructor).not.toBe(MatlabVariableNode);
    expect(warnings[0].message).toContain('was decoded in part');
  });

  it('a refusal lasts only as long as the attach that found it', () => {
    const parsed = parseMat(bytes('mcos/Param.mat'));
    const variable = parsed.variables.find((v) => v.name === 'Param')!;
    const handle = variable.mcosHandle;
    const blob = anonymousOf(parsed.variables)._rawBytes;
    variable.mcosHandle = { dims: [1, 1], ids: [99999] };
    attachMcosDecoded(blob, [variable]);
    expect(modelOpaqueMcosVariable(variable, mcosDecodedFor(variable), null), 'refused').toBeNull();
    // Detached, as MatlabVariableNode._parseCdataObjects detaches one whose build threw: no
    // decode, and no refusal either, so it is the typed node a variable with no decode is.
    attachMcosDecoded(null, [variable]);
    expect(modelOpaqueMcosVariable(variable, mcosDecodedFor(variable), null), 'detached').toBeInstanceOf(ParameterNode);
    // Attached again with its own handle: the file's Parameter.
    variable.mcosHandle = handle;
    const node = MatNode.fromParsed(parsed, 'Param.mat');
    expect((rowOf(node, 'Param') as ParameterNode).Value).toBe(42);
  });

  it('a variable a tree holds twice is refused both times, and said once', () => {
    // A host's tree can hold one variable object in two places; the warning is taken once.
    const parsed = parseMat(bytes('mcos/Param.mat'));
    const variable = parsed.variables.find((v) => v.name === 'Param')!;
    variable.mcosHandle = { dims: [1, 1], ids: [99999] };
    const warnings: ParseWarning[] = [];
    attachMcosDecoded(anonymousOf(parsed.variables)._rawBytes, [variable, variable], warnings);
    expect(modelOpaqueMcosVariable(variable, mcosDecodedFor(variable), null)).toBeNull();
    expect(warnings.map((w) => w.part)).toEqual(['Param']);
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
