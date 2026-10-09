// Copyright 2026 The MathWorks, Inc.
//
// An MCOS object NESTED in a struct field or a cell element — the same object a
// top-level variable holds, one level down, and until this was decoded a bare
// `<1x1 Simulink.Parameter>` with no Value and no rows.
//
// Every class-17 element carries its own object handle into the file's one shared MCOS
// heap, at any depth. Three layers had to keep that fact for a nested object to resolve,
// and each is pinned on its own here:
//
//   * MatParser reads the handle out of the element (`mcosHandle`). A cell element
//     keeps no raw bytes, so this is the ONLY handle it has.
//   * McosParser decodes per VARIABLE rather than per name: a nested object has no name
//     (the MAT format names top-level variables only), so a by-name map cannot hold it.
//   * MatNode / ModelNode attach each decode to its variable, and
//     MatlabVariableNode.parseMatVariable — the one dispatch every struct field and
//     cell element goes through — builds it as the node a top-level one gets.
//
// strings_nested.mat is MATLAB-authored by test/parity/matlab/probe_string.m (written
// there as mix_nested.mat), and every expected value below is that script's own:
//
//   mixStruct = struct('p', {Simulink.Parameter(7)}, 's', {"inStruct"});
//   mixCell   = {Simulink.Parameter(8), "inCell", 9};
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMat, parseMatrix, type MatVariable } from '../src/datamodel/parser/MatParser.js';
import { parseModel } from '../src/index.js';
import { decodeMcosVariables, decodeMcosBlob } from '../src/datamodel/parser/McosParser.js';
import { MCOS_HANDLE_MAGIC, objectHandleFromRaw, objectHandleFromValue } from '../src/datamodel/parser/McosHandle.js';
import { attachMcosDecoded } from '../src/datamodel/node/data/mcosTypedNode.js';
import { mcosDecodedFor, setMcosDecoded } from '../src/datamodel/node/data/mcosDecodedTable.js';
import { modelOpaqueMcosVariable } from '../src/datamodel/node/data/mcosTypedNode.js';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import type { McosObjectData } from '../src/datamodel/parser/McosParser.js';
import { presentation } from './tools/nodePresentation.js';
import MatNode from '../src/datamodel/node/container/MatNode.js';
import { loadFile, findEntry } from './parity/loadFile.js';
import { readModuleGraph } from './tools/moduleGraph.js';

const TEST_DIR = fileURLToPath(new URL('.', import.meta.url));

function bytes(path: string): ArrayBuffer {
  const buf = readFileSync(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

// strings_nested.mat's variables, the four nested objects pulled out by where MATLAB
// put them. `mixCell{3}` is the plain double beside them.
function nestedParts() {
  const { variables } = parseMat(bytes(join(TEST_DIR, 'fixtures/strings_nested.mat')));
  const anon = variables.find((v) => v._anonymous)!;
  const mixStruct = variables.find((v) => v.name === 'mixStruct')!;
  const mixCell = variables.find((v) => v.name === 'mixCell')!;
  const [c1, c2, c3] = mixCell.value as MatVariable[];
  return {
    variables,
    blob: anon._rawBytes!,
    p: mixStruct.fields!.p as MatVariable,
    s: mixStruct.fields!.s as MatVariable,
    c1,
    c2,
    c3,
  };
}

// ---- Hand-built class-17 elements, for the shapes no MATLAB file has ------------
const MI_INT8 = 1;
const MI_INT32 = 5;
const MI_UINT32 = 6;
const MI_DOUBLE = 9;
const MI_MATRIX = 14;
const MX_CELL = 1;
const MX_STRUCT = 2;
const MX_UINT32 = 13;
const MX_DOUBLE = 6;
const MX_OPAQUE = 17;

function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function words(signed: boolean, ...w: number[]): Uint8Array {
  const out = new Uint8Array(w.length * 4);
  const view = new DataView(out.buffer);
  w.forEach((x, i) => (signed ? view.setInt32(i * 4, x, true) : view.setUint32(i * 4, x, true)));
  return out;
}

// One data element: an 8-byte tag (type, byte count), the data, padded to 8.
function element(type: number, data: Uint8Array): Uint8Array {
  const tag = words(false, type, data.length);
  return cat(tag, data, new Uint8Array((8 - (data.length % 8)) % 8));
}

const flags = (mxClass: number) => element(MI_UINT32, words(false, mxClass, 0));
const text = (s: string) => element(MI_INT8, new TextEncoder().encode(s));

function doubles(...v: number[]): Uint8Array {
  const out = new Uint8Array(v.length * 8);
  const view = new DataView(out.buffer);
  v.forEach((x, i) => view.setFloat64(i * 8, x, true));
  return out;
}

// The fourth part of an opaque: a whole miMATRIX of `mxClass` holding `w`, as uint32s
// unless `data` is given — the data subelement itself, which is what the type tests need.
function handlePart(w: number[], mxClass = MX_UINT32, data = element(MI_UINT32, words(false, ...w))): Uint8Array {
  return element(MI_MATRIX, cat(flags(mxClass), element(MI_INT32, words(true, w.length, 1)), text(''), data));
}

// A uint32 handle part whose matrix DECLARES `dims` — the words are stored the same
// way whatever shape it claims, column after column, which is the order MATLAB reads.
function shapedHandle(w: number[], dims: number[]): Uint8Array {
  return element(MI_MATRIX, cat(flags(MX_UINT32), element(MI_INT32, words(true, ...dims)), text(''), element(MI_UINT32, words(false, ...w))));
}

// A uint32 handle whose data subelement is miDOUBLE, holding `w` as doubles.
const doubleHandle = (w: number[]) => handlePart(w, MX_UINT32, element(MI_DOUBLE, doubles(...w)));

// A class-17 element's CONTENT — what parseMatrix reads, after the miMATRIX tag — with
// `rest` after the class name, and `cut` bytes taken off the element's declared end.
const opaqueHeader = () => cat(flags(MX_OPAQUE), text(''), text('MCOS'), text('Simulink.Parameter'));
const opaqueBody = (rest: Uint8Array[]) => cat(opaqueHeader(), ...rest);
function opaque(rest: Uint8Array[], cut = 0): MatVariable {
  const body = opaqueBody(rest);
  return parseMatrix(new DataView(body.buffer), 0, body.length - cut);
}

// A handle part whose DATA subelement declares six words while holding four — the two
// it is short of are whatever follows the part.
function shortHandle(): Uint8Array {
  const fourWords = words(false, MCOS_HANDLE_MAGIC, 2, 1, 1);
  return element(
    MI_MATRIX,
    cat(flags(MX_UINT32), element(MI_INT32, words(true, 6, 1)), text(''), cat(words(false, MI_UINT32, 24), fourWords)),
  );
}

// A MAT-built container of `value`, as the parser itself would build one.
const cellOf = (name: string, value: MatVariable[]): MatVariable => ({
  name,
  className: 'cell',
  dimensions: [1, value.length],
  isComplex: false,
  isLogical: false,
  value,
  fields: null,
});
const structOf = (name: string, fields: Record<string, MatVariable>): MatVariable => ({
  name,
  className: 'struct',
  dimensions: [1, 1],
  isComplex: false,
  isLogical: false,
  value: null,
  fields,
});

describe('MatParser keeps every opaque\'s object handle', () => {
  it('on a nested opaque, in a struct field and in a cell element', () => {
    const { p, s, c1, c2, c3 } = nestedParts();
    for (const [label, v] of [['mixStruct.p', p], ['mixStruct.s', s], ['mixCell{1}', c1], ['mixCell{2}', c2]] as const) {
      expect(v.isOpaque, label).toBe(true);
      expect(v.mcosHandle, label).toBeDefined();
      // One object each: a `string` is one object however many elements it holds, and
      // these four are scalars anyway.
      expect(v.mcosHandle!.dims, label).toEqual([1, 1]);
      expect(v.mcosHandle!.ids, label).toHaveLength(1);
    }
    // Four objects, four different ones.
    expect(new Set([p, s, c1, c2].map((v) => v.mcosHandle!.ids[0])).size).toBe(4);
    // The cell elements are the case that needed this: no raw bytes, so no other handle.
    expect(c1._rawBytes).toBeUndefined();
    expect(c2._rawBytes).toBeUndefined();
    // And it is the opaques that get one.
    expect(c3.className).toBe('double');
    expect(c3.mcosHandle).toBeUndefined();
  });

  // Every MATLAB-written .mat in the repo, walked rather than listed, so a fixture
  // added later is held to the same rule. The parsed handle and the raw-byte scan are
  // two readings of the same words; a disagreement on any top-level variable would mean
  // one of them is reading the wrong ones.
  const matFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? matFiles(join(dir, d.name)) : d.name.endsWith('.mat') ? [join(dir, d.name)] : [],
    );
  const files = [...matFiles(join(TEST_DIR, 'fixtures')), ...matFiles(join(TEST_DIR, 'parity/artifacts'))];

  it('on every MCOS fixture, equal to the handle the raw-byte scan finds', () => {
    const withObjects: string[] = [];
    let checked = 0;
    for (const file of files) {
      let parsed;
      try {
        parsed = parseMat(bytes(file));
      } catch (err) {
        // The one refusal the reader makes by design; anything else is a real failure.
        expect(String(err), file).toMatch(/version 7\.3/);
        continue;
      }
      const opaques = parsed.variables.filter((v) => v.isOpaque);
      if (opaques.length === 0) continue;
      withObjects.push(relative(TEST_DIR, file));
      for (const v of opaques) {
        const label = relative(TEST_DIR, file) + ' ' + v.name;
        expect(v.mcosHandle, label).toBeDefined();
        expect(v.mcosHandle, label).toEqual(objectHandleFromRaw(v._rawBytes));
        checked++;
      }
    }
    // Floors, not counts: the walk has to have reached the files this rule is about.
    expect(withObjects).toEqual(
      expect.arrayContaining([
        'fixtures/strings.mat',
        'fixtures/strings_mixed.mat',
        'fixtures/mcos/Param.mat',
        'fixtures/mcos/busArray.mat',
        'fixtures/mcos/ndNested.mat',
        'fixtures/mcos/paramArray.mat',
        'fixtures/mcos/variableUsageArray.mat',
        'parity/artifacts/mat/cases.mat',
      ]),
    );
    expect(checked).toBeGreaterThan(40);
  });

  // Every model in the repo, `.slx` and `.mdl` (both flavours), whose WORKSPACE holds an
  // MCOS object: the workspace parses through the same element reader, out of a different
  // container — an mxarray stream, or a classic `.mdl`'s uuencoded record.
  const modelFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? modelFiles(join(dir, d.name)) : /\.(slx|mdl)$/.test(d.name) ? [join(dir, d.name)] : [],
    );
  const models = [...modelFiles(join(TEST_DIR, 'fixtures')), ...modelFiles(join(TEST_DIR, 'parity/artifacts'))];

  it('on every model workspace too, equal to the handle the raw-byte scan finds', () => {
    const withObjects: string[] = [];
    let checked = 0;
    for (const file of models) {
      const { workspace } = parseModel(bytes(file), file.split('/').pop()!);
      const opaques = workspace.filter((v) => v.isOpaque);
      if (opaques.length === 0) continue;
      withObjects.push(relative(TEST_DIR, file));
      for (const v of opaques) {
        const label = relative(TEST_DIR, file) + ' ' + v.name;
        expect(v.mcosHandle, label).toBeTruthy();
        expect(v.mcosHandle, label).toEqual(objectHandleFromRaw(v._rawBytes));
        checked++;
      }
    }
    // A floor, not a count: the five models this repo has with workspace objects.
    expect(withObjects).toEqual(
      expect.arrayContaining([
        'fixtures/mcos/mcosfix.slx',
        'fixtures/mcos/nested_ws.slx',
        'parity/artifacts/mdl/mdlmcos.mdl',
        'parity/artifacts/mdl/mdlmcos.slx',
        'parity/artifacts/slx/cases.slx',
      ]),
    );
    expect(checked).toBeGreaterThanOrEqual(19);
  });

  it('reads a scalar and an array handle out of a hand-built element', () => {
    expect(opaque([handlePart([MCOS_HANDLE_MAGIC, 2, 1, 1, 5, 1])]).mcosHandle).toEqual({ dims: [1, 1], ids: [5] });
    expect(opaque([handlePart([MCOS_HANDLE_MAGIC, 2, 1, 3, 4, 5, 6, 1])]).mcosHandle).toEqual({
      dims: [1, 3],
      ids: [4, 5, 6],
    });
  });

  it('records a missing or malformed handle as refused (null), and the variable otherwise as it was', () => {
    const cases: [string, MatVariable][] = [
      ['no fourth part', opaque([])],
      ['not a matrix', opaque([element(MI_UINT32, words(false, MCOS_HANDLE_MAGIC, 2, 1, 1, 5, 1))])],
      ['not uint32', opaque([handlePart([MCOS_HANDLE_MAGIC, 2, 1, 1, 5, 1], MX_DOUBLE)])],
      ['the heap cell array a FileWrapper holds there', opaque([element(MI_MATRIX, cat(flags(MX_CELL), element(MI_INT32, words(true, 0, 0)), text('')))])],
      ['no magic', opaque([handlePart([0xdc000000, 2, 1, 1, 5, 1])])],
      ['dims that claim more ids than there are', opaque([handlePart([MCOS_HANDLE_MAGIC, 2, 2, 2, 5, 1])])],
      ['an absurd rank', opaque([handlePart([MCOS_HANDLE_MAGIC, 99, 1, 1, 5, 1])])],
      // A uint32 handle whose DATA is floating point. MATLAB never writes one, and an
      // id of 2.5 used to pass the range check and throw out of the decoder, taking the
      // whole file open with it. Integer-valued doubles are refused as well: the handle
      // is integer data, and a double where it belongs is a damaged element.
      ['ids stored as doubles', opaque([doubleHandle([MCOS_HANDLE_MAGIC, 2, 1, 1, 2.5, 1])])],
      ['whole ids stored as doubles', opaque([doubleHandle([MCOS_HANDLE_MAGIC, 2, 1, 1, 5, 1])])],
      // The handle declares bytes the opaque element does not hold: reading on would
      // take the next element's bytes for ids.
      ['running past its element', opaque([handlePart([MCOS_HANDLE_MAGIC, 2, 1, 1, 5, 1])], 8)],
      // An opaque where the handle belongs. Parsing it would recurse back into the
      // opaque reader, once per level a crafted file nests.
      ['an opaque in its place', opaque([element(MI_MATRIX, cat(flags(MX_OPAQUE), text(''), text('MCOS'), text('X')))])],
    ];
    for (const [label, v] of cases) {
      // Read and refused: null, which the decoder takes as final.
      expect(v.mcosHandle, label).toBeNull();
      expect(v.isOpaque, label).toBe(true);
      expect(v.className, label).toBe('Simulink.Parameter');
      expect(v.dimensions, label).toEqual([1, 1]);
    }
  });

  it('takes no id from past the handle\'s own element', () => {
    // The handle's DATA subelement declares six words and its element holds four; the
    // two it is short of sit right after the handle element, inside the same opaque,
    // and spell a believable id. Bounded by its own element, the handle is four words
    // describing an id that is not there, so there is no handle. The control is the same
    // bytes with the data's declared length told truthfully.
    const next = words(false, 5, 1);
    expect(opaque([shortHandle(), next]).mcosHandle).toBeNull();
    const truthful = element(
      MI_MATRIX,
      cat(flags(MX_UINT32), element(MI_INT32, words(true, 6, 1)), text(''), element(MI_UINT32, words(false, MCOS_HANDLE_MAGIC, 2, 1, 1, 5, 1))),
    );
    expect(opaque([truthful]).mcosHandle).toEqual({ dims: [1, 1], ids: [5] });
  });

  it('reads no handle from past the container that holds the opaque', () => {
    // A container's element can declare itself longer than the container: here an opaque
    // claims the bytes after its cell — another element's — as its handle part. Bounded by
    // its container, the opaque ends after its class name, so it has no handle part. The
    // control is the same bytes with the container's own length taking the handle in.
    const handle = handlePart([MCOS_HANDLE_MAGIC, 2, 1, 1, 5, 1]);
    const overrunning = cat(words(false, MI_MATRIX, opaqueHeader().length + handle.length), opaqueHeader());
    const cellHead = cat(flags(MX_CELL), element(MI_INT32, words(true, 1, 1)), text(''));
    const fieldNames = cat(element(MI_INT32, words(true, 8)), element(MI_INT8, new TextEncoder().encode('f\0\0\0\0\0\0\0')));
    const structHead = cat(flags(MX_STRUCT), element(MI_INT32, words(true, 1, 1)), text(''), fieldNames);
    for (const [label, head, pick] of [
      ['a cell element', cellHead, (v: MatVariable) => (v.value as MatVariable[])[0]],
      ['a struct field', structHead, (v: MatVariable) => v.fields!.f as MatVariable],
    ] as [string, Uint8Array, (v: MatVariable) => MatVariable][]) {
      const all = cat(head, overrunning, handle);
      const view = new DataView(all.buffer);
      const bounded = pick(parseMatrix(view, 0, head.length + overrunning.length));
      expect(bounded.isOpaque, label).toBe(true);
      expect(bounded.mcosHandle, label).toBeNull();
      expect(pick(parseMatrix(view, 0, all.length)).mcosHandle, label).toEqual({ dims: [1, 1], ids: [5] });
    }
  });

  it('does not recurse into an opaque where the handle belongs, however deep that nests', () => {
    // A part that is itself a class-17 element must not be read as one, its own fourth
    // part likewise, and so on — a call per level, which a crafted file can make deeper
    // than any stack. The handle reader no longer goes through parseMatrix at all, and the
    // array-class check would refuse such a part first anyway; this pins the behaviour,
    // whichever of the two a later change leaves. 50,000 levels of opaque-in-opaque, built
    // in place: each level is its 56-byte header (flags, name, marker, class) and the tag
    // of the level inside it.
    const levels = 50000;
    const header = cat(flags(MX_OPAQUE), text(''), text('MCOS'), text('X'));
    const step = header.length + 8;
    const buf = new Uint8Array(levels * step - 8);
    const view = new DataView(buf.buffer);
    for (let k = 0; k < levels; k++) {
      buf.set(header, k * step);
      if (k < levels - 1) {
        view.setUint32(k * step + header.length, MI_MATRIX, true);
        view.setUint32(k * step + header.length + 4, buf.length - (k + 1) * step, true);
      }
    }
    let v: MatVariable | undefined;
    expect(() => {
      v = parseMatrix(view, 0, buf.length);
    }).not.toThrow();
    expect(v!.className).toBe('X');
    expect(v!.mcosHandle).toBeNull();
  });
});

describe('a handle\'s words are read in the order they are stored', () => {
  // MATLAB reads a handle's words in their stored, linear order, whatever shape the
  // uint32 matrix holding them declares. MATLAB itself always writes an Nx1 (where
  // linear order and row-major order agree), so only a crafted file can tell the two
  // apart — and both of these are MATLAB R2027a's own answers on such a file. The
  // matrix is declared 2x3; read row-major, its words would come out reordered.
  //
  // Each case is built the way the crafted files were: Param.mat's own MCOS heap, whose
  // object 1 is a Simulink.Parameter with Value 42, and a variable whose handle names it.
  //
  // A handle stored as int64 or uint64 is a file MATLAB refuses to open, so no answer is
  // wrong there and none is pinned: this reader takes the words, as integer data.
  function open(words: number[], dims: number[]) {
    const parsed = parseMat(bytes(join(TEST_DIR, 'fixtures/mcos/Param.mat')));
    const anon = parsed.variables.find((v) => v._anonymous)!;
    const body = opaqueBody([shapedHandle(words, dims)]);
    const variable = parseMatrix(new DataView(body.buffer), 0, body.length);
    variable.name = 'tt';
    const node: any = MatNode.fromParsed({ header: parsed.header, variables: [variable, anon] }, 'x.mat').children[0];
    return { variable, node };
  }

  it('[magic 2 1 1 1 3] declared 2x3 is a scalar Simulink.Parameter, Value 42', () => {
    const { variable, node } = open([MCOS_HANDLE_MAGIC, 2, 1, 1, 1, 3], [2, 3]);
    expect(variable.mcosHandle).toEqual({ dims: [1, 1], ids: [1] });
    expect(node.constructor.name).toBe('ParameterNode');
    expect(node.displayValue).toBe('42');
  });

  it('[magic 1 2 1 1 3] declared 2x3 is a two-element Simulink.Parameter array', () => {
    const { variable, node } = open([MCOS_HANDLE_MAGIC, 1, 2, 1, 1, 3], [2, 3]);
    // Rank 1, extent 2, both elements object 1.
    expect(variable.mcosHandle).toEqual({ dims: [2], ids: [1, 1] });
    expect(node.constructor.name).toBe('ObjectNode');
    expect(node.children.map((c: any) => c.displayValue)).toEqual(['42', '42']);
    // MATLAB sizes this [2 1]; this reader gives a rank-1 handle as a row, [1 2], exactly
    // as the parent commit did. Recorded rather than changed here: MATLAB never writes a
    // rank-1 handle, and the orientation is the decoder's rule, not the read order's.
    expect(node.dims).toEqual([1, 2]);
  });

  it('a handle declared 1x6 or 6x1 reads the same words as it always did', () => {
    for (const dims of [[1, 6], [6, 1]]) {
      const { variable, node } = open([MCOS_HANDLE_MAGIC, 2, 1, 1, 1, 3], dims);
      expect(variable.mcosHandle, JSON.stringify(dims)).toEqual({ dims: [1, 1], ids: [1] });
      expect(node.displayValue, JSON.stringify(dims)).toBe('42');
    }
  });
});

describe('the shared handle reader takes integers only', () => {
  it('accepts a handle whose every word is a whole number in range', () => {
    expect(objectHandleFromValue([MCOS_HANDLE_MAGIC, 2, 1, 2, 3, 4])).toEqual({ dims: [1, 2], ids: [3, 4] });
  });

  it('refuses one whose rank, extents or ids are not non-negative integers', () => {
    for (const [label, v] of [
      ['a fractional id', [MCOS_HANDLE_MAGIC, 2, 1, 1, 2.5]],
      ['a negative id', [MCOS_HANDLE_MAGIC, 2, 1, 1, -3]],
      ['a NaN id', [MCOS_HANDLE_MAGIC, 2, 1, 1, NaN]],
      ['a fractional rank', [MCOS_HANDLE_MAGIC, 2.5, 1, 1, 5]],
      ['a fractional extent', [MCOS_HANDLE_MAGIC, 2, 0.5, 2, 5]],
      ['a negative extent', [MCOS_HANDLE_MAGIC, 2, -1, -1, 5]],
    ] as [string, number[]][]) {
      expect(objectHandleFromValue(v), label).toBeNull();
    }
  });
});

describe('McosParser decodes per variable', () => {
  it('resolves the nested objects, each under its own variable though none has a name', () => {
    const { blob, p, s, c1, c2 } = nestedParts();
    // The reason the result is keyed by the variable: all four would collide on ''.
    expect([p, s, c1, c2].map((v) => v.name)).toEqual(['', '', '', '']);
    const decoded = decodeMcosVariables(blob, [p, s, c1, c2]);
    expect(decoded.size).toBe(4);
    expect(decoded.get(p)!.className).toBe('Simulink.Parameter');
    expect(decoded.get(p)!.properties.Value).toBe(7);
    expect(decoded.get(c1)!.properties.Value).toBe(8);
    expect(decoded.get(s)!.stringElements).toEqual(['inStruct']);
    expect(decoded.get(c2)!.stringElements).toEqual(['inCell']);
  });

  it('does not let the raw-byte scan take back a handle the parser refused', () => {
    // The scan reads WORDS, not elements: handed an opaque whose handle data runs past
    // its part, it finds the magic and reads the words after it as the id — here the id of
    // mixStruct.p, the real Parameter(7). The parser read the same element by its
    // structure and refused the handle (null), and that answer is final, so the variable
    // stays undecoded even though its raw bytes, as a struct field's are, sit beside it.
    const { blob, p } = nestedParts();
    const body = opaqueBody([shortHandle(), words(false, p.mcosHandle!.ids[0], 0)]);
    const v = parseMatrix(new DataView(body.buffer), 0, body.length);
    expect(v.mcosHandle).toBeNull();
    v._rawBytes = body;
    expect(decodeMcosVariables(blob, [v]).has(v)).toBe(false);
    // A variable this parser never read — mcosHandle absent, as from a host's older parse —
    // still gets the scan, which takes those words; that is the fallback's whole remit.
    const unread = { ...v, mcosHandle: undefined };
    expect(decodeMcosVariables(blob, [unread]).get(unread)!.properties.Value).toBe(7);
  });

  it('falls back to the raw-byte scan for a variable without a parsed handle', () => {
    const { blob, p, c1 } = nestedParts();
    // A struct field keeps its raw bytes, so the scan still finds its handle...
    const field = { ...p, mcosHandle: undefined };
    expect(decodeMcosVariables(blob, [field]).get(field)!.properties.Value).toBe(7);
    // ...and a cell element has none to scan, which is why the parsed handle exists.
    const cell = { ...c1, mcosHandle: undefined };
    expect(decodeMcosVariables(blob, [cell]).has(cell)).toBe(false);
  });

  it('still skips a nested variable whose declared class the objects do not have', () => {
    const { blob, p, s, c1, c2 } = nestedParts();
    const lies = [
      { ...p, className: 'Simulink.Signal' },
      { ...s, className: 'Simulink.Parameter' },
      { ...c1, className: 'string' },
      { ...c2, className: 'Simulink.Parameter' },
    ];
    const decoded = decodeMcosVariables(blob, [...lies, c1]);
    for (const v of lies) expect(decoded.has(v), v.className).toBe(false);
    // Skipping is per variable: the honest one beside them still resolves.
    expect(decoded.get(c1)!.properties.Value).toBe(8);
  });

  it('still skips a nested variable whose ids are out of range, or the null object', () => {
    const { blob, c1 } = nestedParts();
    const outOfRange = { ...c1, mcosHandle: { dims: [1, 1], ids: [99999] } };
    const nullObject = { ...c1, mcosHandle: { dims: [1, 1], ids: [0] } };
    const decoded = decodeMcosVariables(blob, [outOfRange, nullObject]);
    expect(decoded.size).toBe(0);
  });

  it('skips, and does not throw on, an id that is not an integer', () => {
    // MatParser no longer produces one, but a handle can also arrive from a host's own
    // parse; an id of 1.5 is inside the object table's range and names no row of it.
    const { blob, c1 } = nestedParts();
    const fractional = { ...c1, mcosHandle: { dims: [1, 1], ids: [1.5] } };
    let decoded: Map<unknown, unknown> | undefined;
    expect(() => {
      decoded = decodeMcosVariables(blob, [fractional, c1]);
    }).not.toThrow();
    expect(decoded!.has(fractional)).toBe(false);
    expect(decoded!.has(c1)).toBe(true);
  });

  it('opens the file, with the bad object as the opaque it used to be, when one handle is bad', () => {
    const parsed = parseMat(bytes(join(TEST_DIR, 'fixtures/strings_nested.mat')));
    const mixCell = parsed.variables.find((v) => v.name === 'mixCell')!;
    (mixCell.value as MatVariable[])[0].mcosHandle = { dims: [1, 1], ids: [1.5] };
    let node: MatNode | undefined;
    expect(() => {
      node = MatNode.fromParsed(parsed, 'strings_nested.mat');
    }).not.toThrow();
    const cell = node!.children.find((c) => c.name === 'mixCell')!;
    expect(cell.children[0].constructor.name).toBe('MatlabVariableNode');
    expect(cell.children[0].displayValue).toBe('<1x1 Simulink.Parameter>');
    // Its neighbours are unaffected.
    expect(cell.children[1].displayValue).toBe('"inCell"');
  });

  it('keeps decodeMcosBlob\'s by-name answer for the named variables', () => {
    const { variables, blob } = nestedParts();
    const named = parseMat(bytes(join(TEST_DIR, 'fixtures/strings_mixed.mat'))).variables;
    const anon = named.find((v) => v._anonymous)!;
    const opaques = named.filter((v) => v.isOpaque && v.name);
    const byName = decodeMcosBlob(
      anon._rawBytes!,
      opaques.map((v) => ({ name: v.name, className: v.className, rawBytes: v._rawBytes })),
    );
    const byVariable = decodeMcosVariables(anon._rawBytes!, opaques);
    expect([...byName.keys()]).toEqual(['mixParam', 'mixStr']);
    for (const v of opaques) expect(byName.get(v.name), v.name).toEqual(byVariable.get(v));
    // strings_nested.mat has no named opaque at all.
    expect(variables.filter((v) => v.isOpaque && v.name)).toEqual([]);
  });

  it('gives two top-level objects of one name each its own object', () => {
    // MATLAB never writes a file whose variables share a name, but a damaged one can, and
    // the result is keyed per variable, not per name: each gets the object its own handle
    // names. The parent commit keyed by name, and gave both the LAST one's — here both
    // would have shown qTop's 2.5. nested_objects.mat's two Parameters, one renamed.
    const parsed = parseMat(bytes(join(TEST_DIR, 'fixtures/mcos/nested_objects.mat')));
    parsed.variables.find((v) => v.name === 'qTop')!.name = 'pTop';
    const twins = MatNode.fromParsed(parsed, 'nested_objects.mat').children.filter((c) => c.name === 'pTop') as any[];
    expect(twins.map((n) => [n.constructor.name, n.displayValue, n.dataType])).toEqual([
      ['ParameterNode', '7', 'auto'],
      ['ParameterNode', '2.5', 'single'],
    ]);
  });

  it('shows why the by-name form cannot carry nested objects', () => {
    // Handed the four nested objects, the by-name form keys all of them under the one
    // name they share, '', so they collapse into a single entry — the last struct field
    // the raw-byte scan could place, mixStruct.s. The two cell elements, with no raw
    // bytes to scan, are not there at all. decodeMcosVariables answers all four.
    const { blob, p, s, c1, c2 } = nestedParts();
    const refs = [p, s, c1, c2].map((v) => ({ name: v.name, className: v.className, rawBytes: v._rawBytes }));
    const byName = decodeMcosBlob(blob, refs);
    expect([...byName.keys()]).toEqual(['']);
    expect(byName.get('')!.stringElements).toEqual(['inStruct']);
    expect(decodeMcosVariables(blob, [p, s, c1, c2]).size).toBe(4);
  });
});

describe('the containers attach a decode to every opaque in the tree', () => {
  it('reaches struct fields and cell elements, and nothing that is not an object', () => {
    const { variables, blob, p, s, c1, c2, c3 } = nestedParts();
    attachMcosDecoded(blob, variables);
    expect(mcosDecodedFor(p)!.properties.Value).toBe(7);
    expect(mcosDecodedFor(c1)!.properties.Value).toBe(8);
    expect(mcosDecodedFor(s)!.stringElements).toEqual(['inStruct']);
    expect(mcosDecodedFor(c2)!.stringElements).toEqual(['inCell']);
    expect(mcosDecodedFor(c3)).toBeUndefined();
    for (const v of variables) expect(mcosDecodedFor(v), v.name).toBeUndefined();
  });

  it('attaches nothing without a blob', () => {
    const { variables, p } = nestedParts();
    attachMcosDecoded(undefined, variables);
    expect(mcosDecodedFor(p)).toBeUndefined();
  });

  it('leaves the parsed variables exactly as it found them', () => {
    // A parse can be the host's own object — one it registered, and may keep after the
    // source is removed — so the decode is held beside the variables, not written into
    // them. Every variable in the tree keeps exactly its own keys and values.
    const { variables, blob } = nestedParts();
    const all: MatVariable[] = [];
    const stack = variables.slice();
    while (stack.length) {
      const v = stack.pop()!;
      all.push(v);
      for (const f of Object.values(v.fields ?? {})) stack.push(...(Array.isArray(f) ? f : [f]));
      if (v.className === 'cell' && Array.isArray(v.value)) stack.push(...(v.value as MatVariable[]).filter(Boolean));
    }
    const before = all.map((v) => ({ ...v }));
    attachMcosDecoded(blob, variables);
    expect(all.filter((v) => mcosDecodedFor(v)).length).toBe(4);
    all.forEach((v, i) => expect(v, v.name).toStrictEqual(before[i]));
  });

  it('forgets a decode the next attach does not repeat', () => {
    const { variables, blob, p } = nestedParts();
    attachMcosDecoded(blob, variables);
    expect(mcosDecodedFor(p)).toBeDefined();
    attachMcosDecoded(undefined, variables);
    expect(mcosDecodedFor(p)).toBeUndefined();
  });

  it('keeps the parsed variable type free of the decoder\'s', () => {
    // MatVariable is public, and McosParser's result type is not: a field typed with it
    // would hand a consumer a name it cannot import. MatParser therefore names nothing
    // from McosParser, not even as a type.
    const graph = readModuleGraph(fileURLToPath(new URL('../src', import.meta.url)));
    const edges = graph.edges.filter((e) => e.from === 'datamodel/parser/MatParser.ts' && e.to === 'datamodel/parser/McosParser.ts');
    expect(edges).toEqual([]);
  });
});

describe('a nested object of a class with no typed node presents as its top-level form', () => {
  // A class the data model does not register takes the generic path: ObjectNode when the
  // decoder recovered properties (a user-written class, an unregistered Simulink one), and
  // the enriched opaque MatlabVariableNode when it recovered only a value. Each object is
  // a real top-level one out of a fixture, placed into a struct field and a cell element
  // of the same parse, so all three are decoded from the same heap.
  for (const [file, name, what] of [
    ['object_props.mat', 'v', 'a user-written class with string and object properties'],
    ['deep_objs.mat', 'a', 'a user-written class three objects deep'],
    ['variableUsageArray.mat', 'variables', 'a 20x1 array of an unregistered Simulink class'],
  ]) {
    it(`${file}'s ${name}: ${what}`, () => {
      const parsed = parseMat(bytes(join(TEST_DIR, 'fixtures/mcos', file)));
      const top = parsed.variables.find((v) => v.name === name)!;
      parsed.variables.unshift(structOf('holder', { field: top }), cellOf('box', [top]));
      const root = MatNode.fromParsed(parsed, file);
      const topNode: any = root.children.find((c) => c.name === name)!;
      const inStruct: any = root.children.find((c) => c.name === 'holder')!.children[0];
      const inCell: any = root.children.find((c) => c.name === 'box')!.children[0];
      expect(topNode.constructor.name).toBe('ObjectNode');
      expect(inStruct.name).toBe('field');
      expect(inCell.name).toBe('1');
      for (const node of [inStruct, inCell]) {
        expect(node.constructor).toBe(topNode.constructor);
        expect(presentation(node, node.displayName)).toEqual(presentation(topNode, topNode.displayName));
      }
      // The cell's own literal is the unchanged one.
      expect(root.children.find((c) => c.name === 'box')!.displayValue).toBe(`{<1x1 ${top.className}>}`);
    });
  }

  it('the enriched opaque, which no fixture reaches, on a decode built in memory', () => {
    // No committed file holds an object of an unregistered class whose decode recovered a
    // value and no properties, so this one is synthetic: the decode is set in the side
    // table directly. What it pins is that the NESTED route builds the same node the
    // container builds at top level, under the name it was given.
    const variable: MatVariable = {
      name: 'ds',
      className: 'Simulink.DataStore',
      dimensions: [1, 1],
      isComplex: false,
      isLogical: false,
      value: null,
      fields: null,
      isOpaque: true,
    };
    const decoded: McosObjectData = {
      name: 'ds',
      className: 'Simulink.DataStore',
      packageName: 'Simulink',
      shortClassName: 'DataStore',
      properties: {},
      elements: [{}],
      dimensions: [1, 1],
      value: 'abc',
    };
    const topNode: any = modelOpaqueMcosVariable(variable, decoded, null);
    setMcosDecoded(variable, decoded);
    const nested: any = MatlabVariableNode.parseMatVariable(variable, 'field', null);
    expect(topNode).toBeInstanceOf(MatlabVariableNode);
    expect(nested.constructor).toBe(topNode.constructor);
    expect(nested.name).toBe('field');
    expect(nested.displayValue).toBe("'abc'");
    expect(presentation(nested, nested.displayName)).toEqual(presentation(topNode, topNode.displayName));
  });
});

describe('a nested object is the node it is at top level', () => {
  const nested = loadFile('../fixtures/strings_nested.mat');
  // strings_mixed.mat's top-level Simulink.Parameter, probe_string.m's `mixParam`.
  const topLevel = findEntry(loadFile('../fixtures/strings_mixed.mat'), 'mixParam');
  const mixStruct = findEntry(nested, 'mixStruct');
  const mixCell = findEntry(nested, 'mixCell');

  it('a Simulink.Parameter in a struct field and in a cell element', () => {
    for (const [label, node, value] of [
      ['mixStruct.p', mixStruct.children.find((c: any) => c.name === 'p'), '7'],
      ['mixCell{1}', mixCell.children[0], '8'],
    ] as [string, any, string][]) {
      expect(node.constructor, label).toBe(topLevel.constructor);
      expect(node.className, label).toBe('Simulink.Parameter');
      expect(node.displayValue, label).toBe(value);
      expect(node.dataType, label).toBe(topLevel.dataType);
      expect(node.icon, label).toBe(topLevel.icon);
    }
  });

  it('shown under the field name and the cell index it was given', () => {
    expect(mixStruct.children.map((c: any) => c.name)).toEqual(['p', 's']);
    expect(mixCell.children.map((c: any) => c.name)).toEqual(['1', '2', '3']);
    expect(mixCell.children.map((c: any) => c.displayName)).toEqual(['mixCell{1}', 'mixCell{2}', 'mixCell{3}']);
    expect(mixCell.children[0].parent).toBe(mixCell);
  });

  it('leaves the containers\' own summaries exactly as they were', () => {
    // Deliberately unchanged: the element rows show the objects now, and what MATLAB
    // prints for a container of objects is a separate decision.
    expect(mixCell.displayValue).toBe('{<1x1 Simulink.Parameter>, <1x1 string>, 9}');
    expect(mixStruct.displayValue).toBe('<1x1 struct>');
    expect(mixCell.children[2].displayValue).toBe('9');
  });

  it('spells an object of any shape as <1x1 Class> in a cell literal, as it did before', () => {
    // The literal kept the token an undecoded opaque always printed, and that token
    // never carried a shape: a 2x2 string, a 1x2 Parameter array and a scalar alike were
    // `<1x1 Class>`. Decoding them must not change that, here or in a cell inside the
    // cell. Their own rows DO show the shape. The cell is assembled in memory out of
    // nested_objects.mat's own objects, which share the file's one heap.
    const parsed = parseMat(bytes(join(TEST_DIR, 'fixtures/mcos/nested_objects.mat')));
    const f = parsed.variables.find((v) => v.name === 's')!.fields!;
    const cell = cellOf;
    const strs = f.strs as MatVariable;
    const objArr = f.objArr as MatVariable;
    const p = f.p as MatVariable;
    parsed.variables.unshift(cell('assembled', [strs, objArr, p, cell('', [strs, objArr])]));
    const node = MatNode.fromParsed(parsed, 'nested_objects.mat').children.find((c) => c.name === 'assembled')!;
    expect(node.displayValue).toBe(
      '{<1x1 string>, <1x1 Simulink.Parameter>, <1x1 Simulink.Parameter>, {<1x1 string>, <1x1 Simulink.Parameter>}}',
    );
    expect(node.children[3].displayValue).toBe('{<1x1 string>, <1x1 Simulink.Parameter>}');
    expect(node.children[0].displayValue).toBe('["a" "b"; "c" "d"]');
    expect(node.children[1].displayValue).toBe('<1x2 Simulink.Parameter>');
    expect(node.children[2].displayValue).toBe('7');
  });
});
