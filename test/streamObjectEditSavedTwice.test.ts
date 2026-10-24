// Copyright 2026 The MathWorks, Inc.
//
// An object's property inside a binary dictionary's hex value (a MAT stream whose objects ride in
// its own subsystem), edited, saved, edited again to a value of another size, and saved again.
// A save keeps the stream it wrote and passed its self-check, and hands it back to the next ask
// when the edits make the same subsystem (mcosStreamEdit: one save reads the stream more than
// once). So the next edit has to be told from the last one even when only its length differs:
// the second save writes the second edit, its EncodedLength the byte count of what it wrote, and
// a save after no further edit is the same stream again. Edited back, the stream is the first
// save's, byte for byte.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { mcosStreamParts } from '../src/datamodel/parser/McosStreamEdit.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const BINARY = new Uint8Array(readFileSync(fileURLToPath(new URL('./fixtures/sldd-stream-objects/stream_objects_binary.sldd', import.meta.url))));
const buffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const chunkOf = (zip: Uint8Array): string => new TextDecoder().decode(unzipSync(zip)['data/chunk0.xml']);
const subtree = (n: any): any[] => [n, ...n.children.flatMap(subtree)];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-23T12:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

function open(bytes: Uint8Array): { session: any; root: any } {
  const session = createSession();
  const root: any = ingest(session, buffer(bytes), { filename: 'stream_objects_binary.sldd' });
  session.setActiveContext(root);
  return { session, root };
}

function nodeAt(root: any, path: string): any {
  for (const entry of root.getSection('design').children) {
    const found = subtree(entry).find((n) => n.matlabPath === path);
    if (found) {
      return found;
    }
  }
  throw new Error('no node ' + path);
}

function edit(session: any, root: any, path: string, prop: string, text: string): unknown {
  const node = nodeAt(root, path);
  session.setActive(root, node);
  return session.editProperty(node.id, prop, text);
}

/** The stream an entry's hex Value holds, and the EncodedLength its tag says. */
function hexStream(xml: string, name: string): { bytes: Uint8Array; encodedLength: number } {
  const at = xml.indexOf('<P Name="Name" Class="char">' + name + '</P>');
  expect(at, name).toBeGreaterThan(-1);
  const m = /<P Name="Value" Class="[^"]*" Encoding="hex" EncodedLength="(\d+)">([^<]*)<\/P>/.exec(xml.slice(at));
  expect(m, name).not.toBeNull();
  const digits = m![2].replace(/\s+/g, '');
  const bytes = new Uint8Array(digits.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(digits.substr(2 * i, 2), 16);
  }
  return { bytes, encodedLength: Number(m![1]) };
}

const LONG = 'a description of the gain, long enough to grow its cell by many bytes';

describe('an object property in a dictionary stream, edited and saved twice', () => {
  it('writes each edit in its own save, the second of another size than the first', () => {
    const { session, root } = open(BINARY);
    const before = hexStream(chunkOf(BINARY), 'sPh');

    expect(edit(session, root, 'sPh.p', 'Description', 'a')).toBe(true);
    const first = session.serializeSource(root.name).bytes;
    const one = hexStream(chunkOf(first), 'sPh');
    expect(one.encodedLength).toBe(one.bytes.length);
    expect(mcosStreamParts(one.bytes).ok).toBe(true);
    expect(nodeAt(open(first).root, 'sPh.p').Description).toBe('a');

    expect(edit(session, root, 'sPh.p', 'Description', LONG)).toBe(true);
    const second = session.serializeSource(root.name).bytes;
    const two = hexStream(chunkOf(second), 'sPh');
    expect(two.bytes.length).toBeGreaterThan(one.bytes.length);
    expect(two.encodedLength).toBe(two.bytes.length);
    expect(mcosStreamParts(two.bytes).ok).toBe(true);
    expect(nodeAt(open(second).root, 'sPh.p').Description).toBe(LONG);
    // The value's own element, before the subsystem, is the one MATLAB wrote in all three.
    const valueEnd = (s: Uint8Array) => (mcosStreamParts(s) as { valueEnd: number }).valueEnd;
    expect(valueEnd(one.bytes)).toBe(valueEnd(before.bytes));
    expect(two.bytes.subarray(0, valueEnd(two.bytes))).toEqual(before.bytes.subarray(0, valueEnd(before.bytes)));

    // No edit since: the same stream.
    expect(hexStream(chunkOf(session.serializeSource(root.name).bytes), 'sPh').bytes).toEqual(two.bytes);

    // Edited back to the first save's text: the first save's stream, byte for byte.
    expect(edit(session, root, 'sPh.p', 'Description', 'a')).toBe(true);
    expect(hexStream(chunkOf(session.serializeSource(root.name).bytes), 'sPh').bytes).toEqual(one.bytes);
  });
});
