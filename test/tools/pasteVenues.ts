// Copyright 2026 The MathWorks, Inc.
//
// Where a user meets a value: copied as a host copies an entry, pasted into a text or a
// binary dictionary, saved and opened again. Used by the unbacked-budget tests, which also
// hold each case to the peak RSS of its process — vitest gives every test file a process of
// its own, so a file holding one heavy case measures that case.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync } from 'fflate';
import { createSession } from '../../src/index.js';
import { ingest } from '../../src/core/ingest.js';
import { encodeMatStream, MatWriteError } from '../../src/datamodel/parser/MatWriter.js';
import '../../src/datamodel/node/data/NodeClassMap.js';

export const TEXT = 'sparse_text.sldd';
export const BINARY = 'sparse_binary.sldd';

export function sparseFixture(name: string): ArrayBuffer {
  const u8 = new Uint8Array(readFileSync(fileURLToPath(new URL(`../fixtures/sparse/${name}`, import.meta.url))));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

/** The highest RSS this process has had, in MB. */
export const peakMB = (): number => process.resourceUsage().maxRSS / 1024;

export function timed<T>(f: () => T): [T, number] {
  const t0 = performance.now();
  const out = f();
  return [out, performance.now() - t0];
}

/** Whether encodeMatStream refuses `v` with a MatWriteError, and how long it took to say. */
export function refusal(v: unknown): [boolean, number] {
  return timed(() => {
    try {
      encodeMatStream(v as never);
      return false;
    } catch (e) {
      if (e instanceof MatWriteError) return true;
      throw e;
    }
  });
}

/** What `f` threw, or null; and how long it took either way. */
export function thrownBy(f: () => unknown): [Error | null, number] {
  return timed(() => {
    try {
      f();
      return null;
    } catch (e) {
      return e as Error;
    }
  });
}

/** What a host copies of an entry or a variable: its serialize() record's value, as JSON. */
export function copyOf(node: any): unknown {
  return JSON.parse(JSON.stringify(node.serialize().value));
}

let seq = 0;

/** `value` pasted into a fresh `file` as an entry, unsaved. */
export function pasted(file: string, value: unknown): any {
  const root: any = ingest(createSession(), sparseFixture(file), { filename: file });
  return root.getSection('design').parseEntry({ name: 'pasted', metadata: { uuid: `00000000-0000-4000-e800-${String(++seq).padStart(12, '0')}` }, value });
}

/**
 * `value` pasted into a fresh `file` and saved, and the saved file opened again: how long
 * paste and save took, the size of what was written, the pasted entry's Value tag as
 * written (binary), and the pasted entry as reopened.
 */
export function pasteSaveReopen(file: string, value: unknown): { ms: number; size: number; written: string; entry: any } {
  const session = createSession();
  const root: any = ingest(session, sparseFixture(file), { filename: file });
  const [out, ms] = timed(() => {
    root.getSection('design').parseEntry({ name: 'pasted', metadata: { uuid: `00000000-0000-4000-e800-${String(++seq).padStart(12, '0')}` }, value });
    return session.serializeSource(root.name)!;
  });
  const bytes = out.kind === 'text' ? strToU8(out.text!) : out.bytes!;
  let written = '';
  let size = bytes.length;
  if (out.kind !== 'text') {
    const xml = strFromU8(unzipSync(bytes)['data/chunk0.xml']);
    const from = xml.indexOf('<P Name="Value"', xml.indexOf('<P Name="Name" Class="char">pasted</P>'));
    written = xml.slice(from, xml.indexOf('>', from) + 1);
    size = xml.length;
  }
  const reopened: any = ingest(createSession(), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { filename: file });
  return { ms, size, written, entry: reopened.getSection('design').children.find((e: any) => e.name === 'pasted') };
}
