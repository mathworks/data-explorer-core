// Copyright 2026 The MathWorks, Inc.
//
// What a save of a `.mat` splices: the file's own header, every top-level record in it,
// and which node each record became (MatParser's ParsedMat.records, MatNode.recordOf and
// nodeOf). A save that writes an unedited variable as the bytes it was read from is only as
// good as those bytes, so the first sweep holds every Level-5 fixture to the strictest form
// of it: the header and the records, end to end, ARE the file, byte for byte.
//
// Then the files whose records do not tile the file as MATLAB frames them (`framed` false):
// each is built here out of a framed one, and each still opens as it did, since nothing in
// this channel changes what is shown. And then the binding: every node of the tree, of
// whatever kind (a plain variable, a typed MCOS node, a function handle, a value shown as
// not decoded), is bound to the record it was read from and to no other.

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zlibSync } from 'fflate';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import type { MatRecord, ParsedMat } from '../src/datamodel/parser/MatParser.js';
import { setMatRecordInflateCeiling } from '../src/datamodel/parser/Inflate.js';
import { createSession } from '../src/index.js';
import { CLASS, MI, charVar, element, matFile, numericVar, u32le } from './tools/matBytes.js';

const TEST_ROOT = fileURLToPath(new URL('.', import.meta.url));

// Every `.mat` under test/, recursively, so a fixture added later is swept by default. But not
// test/fixtures/mat-check: copies of MATLAB-written files edited to break MATLAB's load rules on
// purpose, each with MATLAB's verdict (test/matFileCheck.test.ts), many of them not framed.
function matFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'mat-check') {
        out.push(...matFilesUnder(abs));
      }
    } else if (entry.isFile() && entry.name.endsWith('.mat')) {
      out.push(abs);
    }
  }
  return out.sort();
}

// The one file of the corpus the reader refuses: a `-v7.3` file is HDF5, not Level 5.
const REFUSED = new Map([['strings_v73.mat', 'MAT-file version 7.3 (HDF5) is not supported']]);

const shown = (abs: string) => abs.slice(TEST_ROOT.length);
const basename = (abs: string) => abs.slice(abs.lastIndexOf('/') + 1);

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);

const align8 = (n: number) => n + ((8 - (n % 8)) % 8);

const scalar = (name: string, value: number) => numericVar({ name, cls: CLASS.DOUBLE, dimensions: [1, 1], real: [value] });

/** A top-level miCOMPRESSED record of `payload`: tag and zlib stream, unpadded, as MATLAB writes it. */
const compressedRecord = (payload: Uint8Array) => {
  const stream = zlibSync(payload);
  return concat([u32le(MI.COMPRESSED), u32le(stream.length), stream]);
};

/** A MatNode opened from `bytes` through the session, as a host opens one. */
function opened(bytes: ArrayBuffer, name = 'f.mat') {
  const session = createSession();
  const root: any = session.addMatSource(name, bytes);
  return { session, root, by: (n: string) => root.children.find((c: any) => c.name === n) };
}

const fixture = (rel: string) => arrayBufferOf(new Uint8Array(readFileSync(join(TEST_ROOT, rel))));

describe('every Level-5 fixture is its header and its records, byte for byte', () => {
  const files = matFilesUnder(TEST_ROOT);

  it('sweeps the whole corpus', () => {
    // Lower bounds, so that a mis-filtered list cannot pass the sweep below vacuously.
    expect(files.length).toBeGreaterThanOrEqual(30);
    expect(files.map(basename)).toEqual(expect.arrayContaining(['cases.mat', 'Param.mat', 'strings.mat', 'nested_handles.mat']));
  });

  for (const file of files) {
    const refusal = REFUSED.get(basename(file));
    if (refusal) {
      it(`${shown(file)} is refused, and has no records to sweep`, () => {
        expect(() => parseMat(fixture(shown(file)))).toThrow(refusal);
      });
      continue;
    }

    it(shown(file), () => {
      const input = fixture(shown(file));
      const bytes = new Uint8Array(input);
      const parsed = parseMat(input);

      expect([parsed.framed, parsed.unframed]).toEqual([true, null]);
      expect(sameBytes(concat([parsed.headerBytes, ...parsed.records.map((r) => r.bytes)]), bytes)).toBe(true);
      // Views of the input, not copies: a file's records cost nothing more to keep.
      expect(parsed.headerBytes.buffer).toBe(input);
      expect(parsed.records.every((r) => r.bytes.buffer === input)).toBe(true);

      // Each record framed as MATLAB frames it, one after another from byte 128.
      const view = new DataView(input);
      let at = 128;
      for (const record of parsed.records) {
        const type = view.getUint32(record.offset, true);
        const nbytes = view.getUint32(record.offset + 4, true);
        expect(record.offset).toBe(at);
        expect(record.compressed).toBe(type === MI.COMPRESSED);
        expect(record.length).toBe(record.compressed ? 8 + nbytes : 8 + align8(nbytes));
        expect(record.bytes.byteLength).toBe(record.length);
        at += record.length;
      }
      expect(at).toBe(bytes.byteLength);

      // Every record read, each the record of one variable, in the file's order, and named
      // as that variable is.
      expect(parsed.records.map((r) => r.status)).toEqual(parsed.variables.map(() => 'read'));
      expect(parsed.records.map((r) => r.variable)).toEqual(parsed.variables);
      parsed.records.forEach((r, i) => expect(r.variable).toBe(parsed.variables[i]));
      expect(parsed.records.map((r) => r.name)).toEqual(parsed.variables.map((v) => (v._anonymous ? '' : v.name)));

      // The subsystem is the one unnamed record, the last, and where the header says it is.
      const unnamed = parsed.records.filter((r) => r.anonymous);
      if (parsed.subsystemOffset === 0) {
        expect(unnamed).toEqual([]);
      } else {
        expect(unnamed.map((r) => r.offset)).toEqual([parsed.subsystemOffset]);
        expect(parsed.records[parsed.records.length - 1]).toBe(unnamed[0]);
      }
    });
  }

  it('holds files with a subsystem and without one, compressed and plain', () => {
    const parsed = files.filter((f) => !REFUSED.has(basename(f))).map((f) => parseMat(fixture(shown(f))));
    expect(parsed.some((p) => p.subsystemOffset !== 0)).toBe(true);
    expect(parsed.some((p) => p.subsystemOffset === 0 && p.records.length > 0)).toBe(true);
    // nested_handles.mat and hexobj_values.mat are -v6: plain records, 8-byte aligned.
    expect(parsed.some((p) => p.records.some((r) => !r.compressed))).toBe(true);
    expect(parsed.some((p) => p.records.some((r) => r.compressed))).toBe(true);
  });

  for (const file of files.filter((f) => !REFUSED.has(basename(f)))) {
    it(`${shown(file)}: every node opened is bound to its record, and to no other`, () => {
      const { root } = opened(fixture(shown(file)), basename(file));
      const parsed = parseMat(fixture(shown(file)));
      expect(root.framed).toBe(true);
      expect(root.subsystemOffset).toBe(parsed.subsystemOffset);
      expect(sameBytes(root.headerBytes, parsed.headerBytes)).toBe(true);
      const records: MatRecord[] = root.records;
      expect(records.map((r) => [r.offset, r.length, r.name])).toEqual(parsed.records.map((r) => [r.offset, r.length, r.name]));

      // A node per named record, in the file's order; none for the subsystem.
      const named = records.filter((r) => !r.anonymous);
      expect(root.children.length).toBe(named.length);
      named.forEach((record, i) => {
        const node = root.children[i];
        expect(root.recordOf(node)).toBe(record);
        expect(root.nodeOf(record)).toBe(node);
        expect(record.name).toBe(node.name);
      });
      for (const record of records.filter((r) => r.anonymous)) {
        expect(root.nodeOf(record)).toBeNull();
      }
    });
  }
});

describe('a node of every kind is bound to its record', () => {
  it('cases.mat: plain values, strings, and the typed nodes of Simulink objects', () => {
    const { root, by } = opened(fixture('parity/artifacts/mat/cases.mat'), 'cases.mat');
    const kinds: [string, string, string][] = [
      ['kp', 'MatlabVariableNode', 'double'],
      ['structNest', 'MatlabVariableNode', 'struct'],
      ['cellNest', 'MatlabVariableNode', 'cell'],
      ['strScalar', 'MatlabVariableNode', 'string'],
      ['aParam', 'ParameterNode', 'Simulink.Parameter'],
      ['aSignal', 'SignalNode', 'Simulink.Signal'],
      ['aBus', 'BusNode', 'Simulink.Bus'],
      ['objRow', 'ObjectNode', 'Simulink.Parameter'],
    ];
    for (const [name, nodeClass, className] of kinds) {
      const node = by(name);
      expect([node.constructor.name, node.className], name).toEqual([nodeClass, className]);
      const record = root.recordOf(node);
      expect([record.name, record.status, record.compressed], name).toEqual([name, 'read', true]);
      expect(root.nodeOf(record), name).toBe(node);
    }
    // A typed node holds no variable (MatNode.getVariables skips it), and is bound all the same.
    expect(by('aParam')._var).toBeUndefined();
    expect(root.recordOf(by('aParam')).variable.isOpaque).toBe(true);
  });

  it('Param.mat: a Simulink.Parameter, and the subsystem bound to no node', () => {
    const { root } = opened(fixture('fixtures/mcos/Param.mat'), 'Param.mat');
    const [param, subsystem] = root.records as MatRecord[];
    expect(root.children.map((c: any) => c.constructor.name)).toEqual(['ParameterNode']);
    expect(root.recordOf(root.children[0])).toBe(param);
    expect([subsystem.anonymous, subsystem.name, subsystem.offset, root.nodeOf(subsystem)]).toEqual([true, '', root.subsystemOffset, null]);
    expect(root._anonymousElements.length).toBe(1);
    expect(root._anonymousElements[0]).toBe(subsystem.variable);
  });

  it('dispcat_opaque.mat: function handles, built from a literal, are bound as well', () => {
    const { root, by } = opened(fixture('fixtures/display/dispcat_opaque.mat'), 'dispcat_opaque.mat');
    for (const name of ['fh_sin', 'fh_anon', 'e_func_handle_none']) {
      const node = by(name);
      expect(node.className, name).toBe('function_handle');
      expect(root.recordOf(node).name).toBe(name);
      expect(root.nodeOf(root.recordOf(node))).toBe(node);
    }
  });

  it('strings.mat: every string array', () => {
    const { root } = opened(fixture('fixtures/strings.mat'), 'strings.mat');
    expect(root.children.length).toBe(11);
    for (const node of root.children) {
      expect([node.className, root.recordOf(node).name]).toEqual(['string', node.name]);
    }
  });

  it('a value shown as not decoded, its flags word overwritten with a class the reader does not model', () => {
    const z = numericVar({ name: 'z', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [3], imag: [4] });
    // Byte 16 of the matrix is its array-flags data: class 255, and the complex flag kept.
    z[16] = 0xff;
    const { root, by } = opened(matFile([scalar('a', 1), z]));
    expect(by('z').displayValue).toContain('not decoded');
    expect(root.children.map((c: any) => root.recordOf(c).name)).toEqual(['a', 'z']);
    expect(root.framed).toBe(true);
  });
});

describe('records that do not tile the file are not framed, and the file opens as it did', () => {
  const a = scalar('a', 1);
  const b = scalar('b', 2);
  const base = new Uint8Array(matFile([a, b]));

  // How a file opens, as a host is shown it: each variable's name and value, and the warnings.
  const shownAs = (bytes: ArrayBuffer) => {
    const { root } = opened(bytes);
    return { rows: root.children.map((c: any) => [c.name, c.displayValue]), warnings: parseMat(bytes).warnings };
  };

  it('the synthesized base is framed: two plain records', () => {
    const parsed = parseMat(arrayBufferOf(base));
    expect([parsed.framed, parsed.records.map((r) => [r.offset, r.compressed])]).toEqual([true, [[128, false], [128 + a.length, false]]]);
    expect(shownAs(arrayBufferOf(base))).toEqual({ rows: [['a', '1'], ['b', '2']], warnings: [] });
  });

  for (const zeros of [8, 16]) {
    it(`${zeros} trailing zero bytes: a zero tag, which is no record`, () => {
      const bytes = arrayBufferOf(concat([base, new Uint8Array(zeros)]));
      const parsed = parseMat(bytes);
      expect(parsed.framed).toBe(false);
      expect(parsed.unframed!.at).toBe(base.length);
      expect(parsed.records.length).toBe(2);
      expect(shownAs(bytes)).toEqual(shownAs(arrayBufferOf(base)));
    });
  }

  it('3 trailing bytes: the file ends inside a tag', () => {
    const bytes = arrayBufferOf(concat([base, new Uint8Array([1, 2, 3])]));
    const parsed = parseMat(bytes);
    expect([parsed.framed, parsed.unframed!.at, parsed.records.length]).toEqual([false, base.length, 2]);
    expect(shownAs(bytes).rows).toEqual([['a', '1'], ['b', '2']]);
    expect(parsed.warnings.map((w) => w.message)).toEqual([
      'The file ends with 3 byte(s) where a record header needs 8, so anything stored after the last variable read was not read.',
    ]);
  });

  it('a truncated last record: its view holds what the file does', () => {
    const cut = base.subarray(0, base.length - 5);
    const parsed = parseMat(arrayBufferOf(cut));
    const last = parsed.records[1];
    expect([parsed.framed, parsed.unframed!.at]).toEqual([false, 128 + a.length]);
    expect([last.length, last.bytes.byteLength, last.status, last.name]).toEqual([b.length - 5, b.length - 5, 'read', 'b']);
    // The reader reads it short and says so, as it did.
    expect(parsed.warnings.map((w) => w.part)).toEqual(['b']);
    expect(shownAs(arrayBufferOf(cut)).rows.map((r: unknown[]) => r[0])).toEqual(['a', 'b']);
  });

  // A char 'abc' is an miUTF8 element of 3 bytes and 5 of padding, its last sub-element: a
  // record whose nbytes leaves that padding out declares 5 bytes fewer than its matrix holds.
  const c = charVar('c', 'abc', MI.UTF8);
  const unpadded = (withPad: boolean) =>
    concat([u32le(MI.MATRIX), u32le(c.length - 8 - 5), c.subarray(8, withPad ? c.length : c.length - 5)]);

  it('a plain record missing its final padding', () => {
    const bytes = arrayBufferOf(concat([new Uint8Array(matFile([a])), unpadded(false)]));
    const parsed = parseMat(bytes);
    expect([parsed.framed, parsed.unframed!.at]).toEqual([false, 128 + a.length]);
    expect(parsed.unframed!.reason).toContain(`needs ${c.length} bytes and the file holds ${c.length - 5}`);
    expect(shownAs(bytes)).toEqual({ rows: [['a', '1'], ['c', "'abc'"]], warnings: [] });
  });

  it('a plain record whose nbytes is not a multiple of 8, even with its padding there', () => {
    // The reader steps over it without the padding, and reads the next tag out of it.
    const parsed = parseMat(arrayBufferOf(concat([new Uint8Array(matFile([a])), unpadded(true)])));
    expect([parsed.framed, parsed.unframed!.at]).toEqual([false, 128 + a.length]);
    expect(parsed.unframed!.reason).toContain('not a whole number of 8-byte words');
    expect(parsed.records.map((r) => r.name)).toEqual(['a', 'c']);
  });

  it('zero padding after a compressed record', () => {
    // MATLAB writes a compressed record unpadded, and fails a file padded after one
    // (research R5); the reader steps 8 + nbytes, onto the padding.
    let record = compressedRecord(scalar('a', 1));
    let value = 1;
    while (record.length % 8 === 0) {
      record = compressedRecord(scalar('a', ++value));
    }
    const bytes = arrayBufferOf(concat([new Uint8Array(matFile([record])), new Uint8Array(8 - (record.length % 8))]));
    const parsed = parseMat(bytes);
    expect([parsed.framed, parsed.unframed!.at, parsed.records.length]).toEqual([false, 128 + record.length, 1]);
    expect(shownAs(bytes).rows).toEqual([['a', String(value)]]);
  });

  it('a zero tag with a variable after it: the reader stops there, as it did', () => {
    const bytes = arrayBufferOf(new Uint8Array(matFile([a, new Uint8Array(8), b])));
    const parsed = parseMat(bytes);
    expect([parsed.framed, parsed.unframed!.at, parsed.records.map((r) => r.name)]).toEqual([false, 128 + a.length, ['a']]);
    expect(shownAs(bytes)).toEqual({ rows: [['a', '1']], warnings: [] });
  });

  it("a small data element's tag at the top of the file", () => {
    // An int32 0 in the small form, whose payload word the reader takes for its nbytes.
    const small = concat([u32le((4 << 16) | MI.INT32), u32le(0)]);
    const bytes = arrayBufferOf(new Uint8Array(matFile([a, small, b])));
    const parsed = parseMat(bytes);
    expect([parsed.framed, parsed.unframed!.at]).toEqual([false, 128 + a.length]);
    expect(shownAs(bytes).rows).toEqual([['a', '1'], ['b', '2']]);
  });

  it('a header and nothing after it is framed, and holds no records', () => {
    const parsed = parseMat(matFile([]));
    expect([parsed.framed, parsed.records, parsed.subsystemOffset]).toEqual([true, [], 0]);
  });
});

describe('a record the reader drops is still a record', () => {
  afterEach(() => setMatRecordInflateCeiling(undefined));

  const a = scalar('a', 1);
  const b = scalar('b', 2);

  // The file `[a, middle, b]`, the dropped middle record, and the one warning it gave.
  function dropping(middle: Uint8Array) {
    const input = matFile([a, middle, b]);
    const parsed = parseMat(input);
    expect(parsed.framed).toBe(true);
    expect(sameBytes(concat([parsed.headerBytes, ...parsed.records.map((r) => r.bytes)]), new Uint8Array(input))).toBe(true);
    const [, dropped] = parsed.records;
    expect([dropped.offset, dropped.length, dropped.status, dropped.name, dropped.variable, dropped.anonymous])
      .toEqual([128 + a.length, middle.length, 'dropped', null, null, false]);
    expect(parsed.warnings.map((w) => w.message)).toEqual([dropped.reason]);
    // The variables around it open and are bound; it has no node.
    const { root } = opened(input);
    expect(root.children.map((n: any) => root.recordOf(n).name)).toEqual(['a', 'b']);
    expect(root.nodeOf(root.records[1])).toBeNull();
    return dropped;
  }

  it('one that does not inflate', () => {
    const junk = new Uint8Array([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]);
    const dropped = dropping(concat([u32le(MI.COMPRESSED), u32le(junk.length), junk]));
    expect([dropped.compressed, dropped.reason]).toEqual([true, expect.stringContaining('could not be decompressed')]);
  });

  it('one that inflates past the ceiling for one record', () => {
    setMatRecordInflateCeiling(1024);
    const big = numericVar({ name: 'big', cls: CLASS.UINT8, dimensions: [4096, 1], real: new Array(4096).fill(0) });
    expect(dropping(compressedRecord(big)).reason).toContain('inflates to more than the 1024-byte ceiling');
  });

  it('one that inflates to fewer bytes than a tag', () => {
    expect(dropping(compressedRecord(new Uint8Array(4))).reason).toContain('fewer than the 8');
  });

  it('one that inflates to an element that is not a matrix', () => {
    expect(dropping(compressedRecord(element(MI.INT32, new Uint8Array(8)))).reason).toContain('where a variable has to be a matrix');
  });

  it('a plain record of a type that is not a variable', () => {
    const dropped = dropping(element(MI.INT32, new Uint8Array(8)));
    expect([dropped.compressed, dropped.reason]).toEqual([false, expect.stringContaining('is not a variable')]);
  });
});

describe("the header's subsystem offset", () => {
  const withOffset = (bytes: number[]) => {
    const input = new Uint8Array(matFile([scalar('a', 1)]));
    input.set(bytes, 116);
    return parseMat(arrayBufferOf(input)).subsystemOffset;
  };

  it('is the little-endian uint64 in bytes 116-123', () => {
    expect(withOffset([0x34, 0x12, 0, 0, 0, 0, 0, 0])).toBe(0x1234);
    expect(withOffset([0, 0, 0, 0, 1, 0, 0, 0])).toBe(2 ** 32);
  });

  it('is 0 for 8 zero bytes, and for 8 spaces', () => {
    expect(withOffset([0, 0, 0, 0, 0, 0, 0, 0])).toBe(0);
    expect(withOffset(new Array(8).fill(0x20))).toBe(0);
  });
});

describe("a host's parse", () => {
  const input = () => fixture('fixtures/mcos/object_props.mat');

  function openedParsed(parsed: unknown) {
    const session = createSession();
    return session.addMatSourceParsed('object_props.mat', parsed) as any;
  }

  it('with no records, as an older package hands one over: no records, nothing bound, and the tree as before', () => {
    const { header, variables, warnings } = parseMat(input());
    const root = openedParsed({ header, variables, warnings });
    expect([root.records, root.headerBytes, root.framed, root.subsystemOffset]).toEqual([null, null, false, 0]);
    expect(root.children.map((c: any) => root.recordOf(c))).toEqual([null, null, null]);
    expect(root.children.map((c: any) => c.name)).toEqual(opened(input()).root.children.map((c: any) => c.name));
  });

  it('structured-cloned off a worker: each record is still its variable, and the nodes are bound', () => {
    const root = openedParsed(structuredClone(parseMat(input())));
    expect([root.framed, root.records.length]).toEqual([true, 4]);
    expect(root.children.map((c: any) => root.recordOf(c)?.name)).toEqual(root.children.map((c: any) => c.name));
  });

  it('whose variables a host changed since: nothing bound', () => {
    const parsed: ParsedMat = parseMat(input());
    const root = openedParsed({ ...parsed, variables: parsed.variables.slice(1) });
    expect(root.records).toBeNull();
    expect(root.children.map((c: any) => root.recordOf(c))).toEqual(root.children.map(() => null));
  });

  it('whose records hold no bytes: nothing bound', () => {
    const parsed: ParsedMat = parseMat(input());
    const root = openedParsed({ ...parsed, records: parsed.records.map((r) => ({ ...r, bytes: Array.from(r.bytes) })) });
    expect(root.records).toBeNull();
  });
});

// What a save decides on, pinned here so that it is not changed from under the writer: the
// top-level node's status says whether anything under it was edited, and a node keeps its
// record through every edit, a delete and its undo.
describe('an edit and its record', () => {
  const casesMat = () => {
    const { session, root, by } = opened(fixture('parity/artifacts/mat/cases.mat'), 'cases.mat');
    const edit = (node: any, prop: string, value: string) => {
      session.setActive(root, node);
      return session.editProperty(node.id, prop, value);
    };
    return { session, root, by, edit };
  };

  const childEdits: [string, (by: (n: string) => any) => any][] = [
    ['a matrix element', (by) => by('mat2x3').children[0]],
    ['a struct field', (by) => by('structScalar').children[0]],
    ["a struct array element's field", (by) => by('struct1x3').children[0].children[0]],
    ['a cell member', (by) => by('cellFlat').children[0]],
  ];
  for (const [what, target] of childEdits) {
    it(`${what}'s edit makes the variable it is in Modified`, () => {
      const { by, edit } = casesMat();
      const node = target(by);
      let top = node;
      while (top.parent.parent) {
        top = top.parent;
      }
      expect(top.status).toBe('');
      expect(edit(node, 'Value', '9')).toBe(true);
      expect(top.status).toBe('Modified');
    });
  }

  it('an added field makes the struct Modified', () => {
    const { session, root, by } = casesMat();
    const struct = by('structScalar');
    session.setActive(root, struct);
    expect(session.addChildTo(struct.id)).not.toBeNull();
    expect(struct.status).toBe('Modified');
  });

  it("an object's property edit makes its typed node Modified, and its record is still the file's", () => {
    // A MAT-file's save writes it into the subsystem, and the variable's record as it was read
    // (MatNode._editRefusal, MatFileWriter).
    const { root, by, edit } = casesMat();
    const record = root.recordOf(by('aParam'));
    expect(edit(by('aParam'), 'Value', '[1 2 3]')).toBe(true);
    expect([by('aParam').status, root.recordOf(by('aParam'))]).toEqual(['Modified', record]);
    // One it refuses leaves the node as it was.
    expect(edit(by('aSignal'), 'Complexity', 'complex')).toMatchObject({ error: true });
    expect(by('aSignal').status).toBe('');
  });

  it('a rename shows on the node, and the record keeps the name the file holds', () => {
    const { root, by, edit } = casesMat();
    const node = by('kp');
    expect(edit(node, 'Name', 'kp2')).toBe(true);
    expect([node.name, node.status, root.recordOf(node).name]).toEqual(['kp2', 'Modified', 'kp']);
  });

  it('a deleted node is out of the tree and still its record\'s, and its undo puts that node back', () => {
    const { session, root, by } = casesMat();
    const node = by('kp');
    const record = root.recordOf(node);
    session.setActive(root, node);
    expect(session.deleteNodeById(node.id)).toBe(true);
    expect(node.parent).toBeNull();
    expect(root.nodeOf(record)).toBe(node);
    session.undo();
    expect(node.parent).toBe(root);
    expect(root.children[0]).toBe(node);
    expect(root.recordOf(node)).toBe(record);
  });

  it('a variable added since the file was read has no record, and no status to say it is new', () => {
    const { root } = casesMat();
    const { node } = root.execAddEntry();
    expect([root.recordOf(node), node.status]).toEqual([null, '']);
  });
});
