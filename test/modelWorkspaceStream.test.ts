// Copyright 2026 The MathWorks, Inc.
// A model workspace part (`simulink/modelWorkspace.mxarray`, MATLAB's getByteStreamFromArray of a
// 1x1 struct of the variables, then their objects) converts into the MAT-file this package edits it
// as, and back, exactly: every MATLAB-written part in the corpus comes back byte for byte with
// nothing edited, its MAT-file is one a MAT-file's editor takes every edit of, and what that
// editor's save writes converts back into a part holding the edit and every other variable as it
// was read.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matOfWorkspaceStream, workspaceFieldStride, workspaceStreamOfMat } from '../src/datamodel/parser/ModelWorkspaceStream.js';
import { decodeMatStream, parseMat } from '../src/datamodel/parser/MatParser.js';
import { parseMxArray } from '../src/datamodel/parser/MxArrayParser.js';
import { unzipEntries } from '../src/datamodel/parser/Inflate.js';
import { checkMatFile } from '../src/datamodel/parser/MatFileCheck.js';
import { serializeMatFile } from '../src/datamodel/parser/MatFileWriter.js';
import MatNode from '../src/datamodel/node/container/MatNode.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const PART = 'simulink/modelWorkspace.mxarray';
const TEST = fileURLToPath(new URL('.', import.meta.url));

// Every .slx under test/ that holds a model workspace part, with that part's bytes.
function corpus(): { file: string; part: Uint8Array }[] {
  const out: { file: string; part: Uint8Array }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name !== 'node_modules') walk(path);
      } else if (name.endsWith('.slx')) {
        const entries = unzipEntries(new Uint8Array(readFileSync(path)));
        const part = entries[PART];
        if (part && part[0] === 0x00) out.push({ file: path.slice(TEST.length), part });
      }
    }
  };
  walk(TEST);
  return out;
}

const CORPUS = corpus();
const bufferOf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

function converted(part: Uint8Array) {
  const made = matOfWorkspaceStream(part);
  if (!made.ok) throw new Error(made.why);
  return made;
}

describe('the corpus', () => {
  it('holds model workspace parts to convert, objects and empty fields among them', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(10);
    expect(CORPUS.some(({ part }) => decodeMatStream(part).ok && (decodeMatStream(part) as any).trailingElements.length === 1)).toBe(true);
  });
});

describe.each(CORPUS.map((c) => [c.file, c.part] as const))('%s', (_file, part) => {
  it('converts back byte for byte with nothing edited', () => {
    const { mat, read } = converted(part);
    expect(same(workspaceStreamOfMat(mat, read), part)).toBe(true);
  });

  it("is a MAT-file whose records are the part's variables, every one a save can splice", () => {
    const { mat } = converted(part);
    const parsed = parseMat(bufferOf(mat));
    expect(parsed.framed).toBe(true);
    expect(parsed.unframed).toBeNull();
    expect(checkMatFile(mat)).toEqual([]);
    const named = parsed.variables.filter((v) => !v._anonymous);
    expect(named.map((v) => v.name)).toEqual(parseMxArray(bufferOf(part)).map((v) => v.name));
    const node = MatNode.fromParsed(parsed, 'workspace');
    expect(node.records).not.toBeNull();
    expect(node.readOnly).toBe(false);
  });

  it("saves, unedited, as the MAT-file it was made into, and so as the part", () => {
    const { mat, read } = converted(part);
    const node = MatNode.fromParsed(parseMat(bufferOf(mat)), 'workspace');
    const saved = serializeMatFile(node);
    expect(same(saved, mat)).toBe(true);
    expect(same(workspaceStreamOfMat(saved, read), part)).toBe(true);
  });
});

describe('an edit converts back holding the edit, and every other variable as it was read', () => {
  const sourced = CORPUS.find((c) => c.file.endsWith('parity/artifacts/slx/cases.slx'))!;

  function edited(edit: (node: MatNode) => void) {
    const { mat, read } = converted(sourced.part);
    const node = MatNode.fromParsed(parseMat(bufferOf(mat)), 'workspace');
    edit(node);
    const part = workspaceStreamOfMat(serializeMatFile(node), read);
    const decoded = decodeMatStream(part, { whole: true });
    expect(decoded.ok).toBe(true);
    // And the part made converts again, and back, unchanged.
    const again = converted(part);
    expect(same(workspaceStreamOfMat(again.mat, again.read), part)).toBe(true);
    return { part, read, fields: (decoded as any).variable.fields as Record<string, any> };
  }

  const variable = (node: MatNode, name: string): any => node.children.find((c) => c.name === name);

  it('a value typed in', () => {
    const { fields, read, part } = edited((node) => {
      expect(variable(node, 'scalarD').setProperty('Value', '42')).toBe(true);
    });
    expect(fields.scalarD.value).toBe(42);
    const { read: back } = converted(part);
    for (const name of read.names.filter((n) => n !== 'scalarD')) {
      expect(same(back.fields.get(name)!, read.fields.get(name)!), name).toBe(true);
    }
  });

  it("a rename, which moves the name in the struct's table and leaves the value's bytes as they were", () => {
    const { part, read } = edited((node) => {
      expect(variable(node, 'kp').setProperty('Name', 'kpRenamed')).toBe(true);
    });
    const { read: back } = converted(part);
    expect(back.names).toContain('kpRenamed');
    expect(back.names).not.toContain('kp');
    expect(same(back.fields.get('kpRenamed')!, read.fields.get('kp')!)).toBe(true);
  });

  it('a variable added, and one deleted', () => {
    const { part } = edited((node) => {
      expect(node.execAddEntry('', 'added')).not.toBeNull();
      expect(node.execRemoveEntry(variable(node, 'tinyD'))).not.toBeNull();
    });
    const { read: back } = converted(part);
    expect(back.names).toContain('added');
    expect(back.names).not.toContain('tinyD');
  });
});

describe("the struct written anew where names changed, as MATLAB writes one", () => {
  // MATLAB R2027a's own getByteStreamFromArray (probe_workspace_stream.m).
  const truth = JSON.parse(readFileSync(join(TEST, 'parity/matlab/workspace_stream.truth.json'), 'utf8')) as {
    strides: { longest: number; stride: number }[];
    emptyStruct: string;
  };
  const empty = Uint8Array.from(Buffer.from(truth.emptyStruct, 'hex'));

  it.each(truth.strides.map((t) => [t.longest, t.stride]))('a longest name of %i characters takes a field-name length of %i', (longest, stride) => {
    expect(workspaceFieldStride(['a'.repeat(longest), 'b'])).toBe(stride);
  });

  it('a struct of no fields: MATLAB says 1, and the empty workspace converts back as MATLAB wrote it', () => {
    expect(workspaceFieldStride([])).toBe(1);
    const { mat, read } = converted(empty);
    expect(read.names).toEqual([]);
    expect(same(workspaceStreamOfMat(mat, read), empty)).toBe(true);
  });

  it('an empty workspace with a variable added holds it, as a struct of one field', () => {
    const { mat, read } = converted(empty);
    const node = MatNode.fromParsed(parseMat(bufferOf(mat)), 'workspace');
    expect(node.execAddEntry('', 'k')).not.toBeNull();
    const part = workspaceStreamOfMat(serializeMatFile(node), read);
    const decoded = decodeMatStream(part, { whole: true }) as any;
    expect(decoded.ok).toBe(true);
    expect(Object.keys(decoded.variable.fields)).toEqual(['k']);
    expect(new DataView(part.buffer, part.byteOffset).getInt32(8 + 8 + 16 + 16 + 8 + 4, true)).toBe(3);
    // And deleted again, it is the empty workspace MATLAB writes.
    const again = converted(part);
    const emptied = MatNode.fromParsed(parseMat(bufferOf(again.mat)), 'workspace');
    expect(emptied.execRemoveEntry(emptied.children[0])).not.toBeNull();
    expect(same(workspaceStreamOfMat(serializeMatFile(emptied), again.read), empty)).toBe(true);
  });
});

describe('a field of no bytes', () => {
  // A struct of one field, `e`, held as an miMATRIX of no bytes, which MATLAB loads as [].
  function partWithEmptyField(): Uint8Array {
    const u32 = (...n: number[]) => new Uint8Array(new Uint32Array(n).buffer);
    const table = new Uint8Array(8);
    table[0] = 0x65; // 'e', in a stride of 5, padded to 8
    const body = [
      u32(6, 8, 2, 0), // flags: struct
      u32(5, 8, 1, 1), // dims 1x1
      u32(1, 0), // no name
      new Uint8Array([5, 0, 4, 0, 5, 0, 0, 0]), // field-name length 5, small form
      u32(1, 5), table, // the table
      u32(14, 0), // e: an miMATRIX of no bytes
    ];
    const length = body.reduce((n, b) => n + b.length, 0);
    const out = new Uint8Array(16 + length);
    out.set([0x00, 0x01, 0x49, 0x4d, 0, 0, 0, 0, 14, 0, 0, 0]);
    new DataView(out.buffer).setUint32(12, length, true);
    let at = 16;
    for (const b of body) {
      out.set(b, at);
      at += b.length;
    }
    return out;
  }

  it('is a named 0x0 double in the MAT-file, and goes back as it was read', () => {
    const part = partWithEmptyField();
    const { mat, read } = converted(part);
    const parsed = parseMat(bufferOf(mat));
    expect(parsed.variables.map((v) => [v.name, v.className, v.dimensions])).toEqual([['e', 'double', [0, 0]]]);
    expect(checkMatFile(mat)).toEqual([]);
    expect(same(workspaceStreamOfMat(mat, read), part)).toBe(true);
    expect(same(workspaceStreamOfMat(serializeMatFile(MatNode.fromParsed(parsed, 'workspace')), read), part)).toBe(true);
  });

  it('is written whole once edited', () => {
    const { mat, read } = converted(partWithEmptyField());
    const node = MatNode.fromParsed(parseMat(bufferOf(mat)), 'workspace');
    expect((node.children[0] as any).setProperty('Value', '3')).toBe(true);
    const decoded = decodeMatStream(workspaceStreamOfMat(serializeMatFile(node), read), { whole: true }) as any;
    expect(decoded.ok).toBe(true);
    expect(decoded.variable.fields.e.value).toBe(3);
  });
});

describe('a part this cannot convert exactly is refused, saying why', () => {
  const part = CORPUS.find((c) => c.file.endsWith('parity/artifacts/slx/cases.slx'))!.part;
  const refusal = (bytes: Uint8Array) => {
    const made = matOfWorkspaceStream(bytes);
    return made.ok ? null : made.why;
  };

  it('one that does not open as MATLAB writes a model workspace', () => {
    const bytes = part.slice();
    bytes[2] = 0x4d;
    expect(refusal(bytes)).toBe('it does not open as MATLAB writes a model workspace');
  });

  it('one that is cut short', () => {
    expect(refusal(part.subarray(0, part.length - 16))).toBeTruthy();
  });

  it('one that holds more after its objects', () => {
    const bytes = new Uint8Array(part.length + 16);
    bytes.set(part);
    bytes.set([14, 0, 0, 0, 8, 0, 0, 0], part.length);
    expect(refusal(bytes)).toBeTruthy();
  });

  it('one that holds no struct of variables', () => {
    const { mat } = converted(part);
    const scalar = parseMat(bufferOf(mat)).records.find((r) => r.name === 'scalarD')!;
    const stream = new Uint8Array(8 + scalar.bytes.length);
    stream.set(part.subarray(0, 8));
    stream.set(scalar.bytes, 8);
    expect(refusal(stream)).toBe('it holds no 1x1 struct of variables');
  });
});
