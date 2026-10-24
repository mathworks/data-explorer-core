// Copyright 2026 The MathWorks, Inc.
//
// A MAT-file whose objects, the subsystem record, are not held in one whole element a save can
// rewrite: here a compressed record whose stream inflates to the element and 8 bytes more, which
// the reader reads the objects out of, and which has no element of its own a save could write
// an edit into (MatNode._mcosSubsystem). One answer, from every path that would write into it:
//
//   - no object is created in it: the Add menu offers only the plain classes (getAllowedTypes),
//     and an Add of an object is refused naming why (MatNode._creationRefusal, addEntryRefusal);
//   - no property of its objects is edited, by the session or by the node's own setter, refused
//     in the same words;
//
// and nothing else is held to it: a variable holding an object is renamed, a plain variable is
// edited, and the save writes both, with the subsystem its own bytes, where the header says.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzlibSync, zlibSync } from 'fflate';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import { createSession } from '../src/index.js';
import { CLASS, numericVar, u32le } from './tools/matBytes.js';

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);

/**
 * fixtures/mcos/Param.mat (a Simulink.Parameter, Param), with a plain double `k` before it and
 * its subsystem's stream inflating to 8 bytes past the element; the header's subsystem offset
 * moved to where the subsystem now starts. And that subsystem record, as written.
 */
function paramWithLooseSubsystem(): { bytes: ArrayBuffer; subsystem: Uint8Array } {
  const original = new Uint8Array(readFileSync(fileURLToPath(new URL('./fixtures/mcos/Param.mat', import.meta.url))));
  const parsed = parseMat(arrayBufferOf(original));
  const sub = parsed.records.find((r) => r.anonymous)!;
  const param = parsed.records.find((r) => r.name === 'Param')!;
  const stream = zlibSync(new Uint8Array([...unzlibSync(sub.bytes.subarray(8)), ...new Uint8Array(8)]));
  const subsystem = new Uint8Array([...u32le(15), ...u32le(stream.length), ...stream]);
  const k = numericVar({ name: 'k', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [3] });
  const header = original.slice(0, 128);
  new DataView(header.buffer).setBigUint64(116, BigInt(128 + k.length + param.bytes.length), true);
  return { bytes: arrayBufferOf(new Uint8Array([...header, ...k, ...param.bytes, ...subsystem])), subsystem };
}

const WHY = "the file's objects are not held in one whole element a save can rewrite";

function opened(bytes: ArrayBuffer) {
  const session = createSession();
  const root: any = session.addMatSource('f.mat', bytes);
  const by = (n: string) => root.children.find((c: any) => c.name === n);
  const edit = (node: any, key: string, value: string) => {
    session.setActive(root, node);
    return session.editProperty(node.id, key, value);
  };
  return { session, root, by, edit };
}

describe("a MAT-file whose objects are not one whole element a save can rewrite", () => {
  it('reads its objects, and offers no object to create, refusing an Add of one naming why', () => {
    const { bytes } = paramWithLooseSubsystem();
    const { session, root, by } = opened(bytes);
    expect(root.children.map((c: any) => [c.name, c.className])).toEqual([['k', 'double'], ['Param', 'Simulink.Parameter']]);
    expect(by('Param').displayValue).toBe('42');
    expect([root.readOnly, root.getAllowedTypes()]).toEqual([false, ['MatlabVariable', 'MatlabStruct']]);
    session.setActive(root, null);
    for (const cls of ['Simulink.Parameter', 'Simulink.Signal', 'Simulink.Bus']) {
      expect(session.addEntry('', cls, 'p'), cls).toBeNull();
      expect(session.addEntryRefusal(), cls).toBe('Cannot add a ' + cls + ' to "f.mat": ' + WHY + '.');
    }
    // A plain variable it takes, as any file does.
    expect(session.addEntry('', 'MatlabVariable', 'v')?.name).toBe('v');
    expect(session.addEntryRefusal()).toBeNull();
  });

  it("takes no edit of its objects' properties, by any path, in the same words", () => {
    const { bytes } = paramWithLooseSubsystem();
    const { root, by, edit } = opened(bytes);
    const param = by('Param');
    expect(param.valueEditable).toBe(false);
    expect(edit(param, 'Value', '7')).toEqual({ error: true, reason: 'Cannot edit "Param": ' + WHY + '.', invalidValue: '7', validValue: '42' });
    expect(edit(param, 'Description', 'zz')).toMatchObject({ error: true, reason: 'Cannot edit "Param": ' + WHY + '.' });
    expect(param.setProperty('Value', '7')).toMatchObject({ error: true, reason: 'Cannot edit "Param": ' + WHY + '.' });
    expect([param.displayValue, root.dirty]).toEqual(['42', false]);
  });

  it('renames a variable holding an object and edits a plain one, writing the subsystem as its own bytes', () => {
    const { bytes, subsystem } = paramWithLooseSubsystem();
    const { session, by, edit } = opened(bytes);
    expect([edit(by('Param'), 'Name', 'P2'), edit(by('k'), 'Value', '5')]).toEqual([true, true]);
    const saved = (session.serializeSource('f.mat') as { bytes: Uint8Array }).bytes;
    const back = parseMat(arrayBufferOf(saved));
    expect(back.records.map((r) => r.name)).toEqual(['k', 'P2', '']);
    const last = back.records[2];
    expect(sameBytes(last.bytes, subsystem)).toBe(true);
    expect(Number(new DataView(saved.buffer, saved.byteOffset).getBigUint64(116, true))).toBe(last.offset);
    const again = opened(arrayBufferOf(saved));
    expect(again.root.children.map((c: any) => [c.name, c.displayValue])).toEqual([['k', '5'], ['P2', '42']]);
  });
});
