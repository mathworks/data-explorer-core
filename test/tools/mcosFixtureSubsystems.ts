// Copyright 2026 The MathWorks, Inc.
//
// Every MCOS subsystem the test tree holds, in each place one is kept: a .mat's unnamed uint8
// record (and a .mat inside an .slx), a model workspace's trailing element (.slx parts, .mdl), a
// binary dictionary's hex values and a text one's cdata (the stream's element after the value).
//
// A .mat's subsystem is found by walking its records, not by the header's offset, so that the
// test/fixtures/mat-check copies, whose offsets are broken on purpose, give theirs too: their
// subsystems are the ones MATLAB wrote, only moved.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, unzlibSync } from 'fflate';
import { decodeMatStream } from '../../src/datamodel/parser/MatParser.js';
import { parseMdl } from '../../src/datamodel/parser/MdlParser.js';
import { uudecode } from '../../src/datamodel/parser/CdataCodec.js';

export const TEST_ROOT = fileURLToPath(new URL('../', import.meta.url));

export interface FixtureSubsystem {
  // The file under test/, and where in it: ' [mat]', '::part [mxarray]', ' [workspace]', '::part hex 3'.
  where: string;
  kind: 'mat' | 'workspace' | 'hex' | 'cdata';
  // The uint8 [1 N] element, inflated, tag included.
  bytes: Uint8Array;
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? (name === 'node_modules' ? [] : filesUnder(path)) : [path];
  });
}

const arrayBufferOf = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

/** A .mat's last unnamed uint8 element, found by walking its records; null for none. */
export function matSubsystemOf(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 128 || bytes[126] !== 0x49 || bytes[127] !== 0x4d) return null;
  if (Buffer.from(bytes.subarray(0, 19)).toString('latin1') === 'MATLAB 7.3 MAT-file') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let last: Uint8Array | null = null;
  for (let at = 128; at + 8 <= bytes.length; ) {
    const type = view.getUint32(at, true);
    const size = view.getUint32(at + 4, true);
    if (type === 0 && size === 0) break;
    let element: Uint8Array | null = null;
    if (type === 15) {
      try {
        element = unzlibSync(bytes.subarray(at + 8, at + 8 + size));
      } catch {
        element = null;
      }
      at += 8 + size;
    } else {
      element = bytes.subarray(at, Math.min(bytes.length, at + 8 + size));
      at += 8 + size + ((8 - (size % 8)) % 8);
    }
    if (element && isUnnamedUint8(element)) last = element;
  }
  return last;
}

/** Whether `e` is an miMATRIX of class uint8 whose name sub-element is empty. */
function isUnnamedUint8(e: Uint8Array): boolean {
  if (e.length < 40) return false;
  const v = new DataView(e.buffer, e.byteOffset, e.byteLength);
  if (v.getUint32(0, true) !== 14 || v.getUint32(8, true) !== 6 || v.getUint32(12, true) !== 8 || e[16] !== 9) return false;
  // flags (16 bytes), then dims: a long tag and its bytes, then the name's tag.
  const dimsBytes = v.getUint32(28, true);
  const nameAt = 32 + dimsBytes + ((8 - (dimsBytes % 8)) % 8);
  if (nameAt + 8 > e.length) return false;
  const word = v.getUint32(nameAt, true);
  return word >>> 16 === 0 && v.getUint32(nameAt + 4, true) === 0;
}

function streamSubsystem(stream: Uint8Array): Uint8Array | null {
  const decoded = decodeMatStream(stream);
  return decoded.ok && decoded.trailingElements.length > 0 ? decoded.trailingElements[0] : null;
}

function dictionaryTexts(bytes: Uint8Array): [string, string][] {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    return Object.entries(unzipSync(bytes)).map(([part, data]) => [part, Buffer.from(data).toString('latin1')]);
  }
  return [['', Buffer.from(bytes).toString('latin1')]];
}

function subsystemsIn(file: string, bytes: Uint8Array, where: string, out: FixtureSubsystem[]): void {
  const lower = file.toLowerCase();
  if (lower.endsWith('.mat')) {
    const sub = matSubsystemOf(bytes);
    if (sub) out.push({ where: `${where} [mat]`, kind: 'mat', bytes: sub });
    return;
  }
  if (lower.endsWith('.slx')) {
    let parts: Record<string, Uint8Array>;
    try {
      parts = unzipSync(bytes);
    } catch {
      return;
    }
    for (const [part, data] of Object.entries(parts)) {
      if (part.endsWith('.mxarray')) {
        const sub = streamSubsystem(data);
        if (sub) out.push({ where: `${where}::${part} [mxarray]`, kind: 'workspace', bytes: sub });
      } else if (part.endsWith('.mat')) {
        const sub = matSubsystemOf(data);
        if (sub) out.push({ where: `${where}::${part} [mat]`, kind: 'mat', bytes: sub });
      }
    }
    return;
  }
  if (lower.endsWith('.mdl')) {
    let sub: Uint8Array | undefined;
    try {
      sub = parseMdl(arrayBufferOf(bytes), file).workspace._trailingElements?.[0];
    } catch {
      return;
    }
    if (sub) out.push({ where: `${where} [workspace]`, kind: 'workspace', bytes: sub });
    return;
  }
  if (lower.endsWith('.sldd')) {
    let texts: [string, string][];
    try {
      texts = dictionaryTexts(bytes);
    } catch {
      return;
    }
    for (const [part, text] of texts) {
      let n = 0;
      for (const m of text.matchAll(/Encoding="hex"[^>]*>([^<]*)</g)) {
        const sub = streamSubsystem(Uint8Array.from(Buffer.from(m[1].replace(/\s+/g, ''), 'hex')));
        if (sub) out.push({ where: `${where}::${part} hex ${n}`, kind: 'hex', bytes: sub });
        n++;
      }
      for (const m of text.matchAll(/"_value"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
        let value: string;
        try {
          value = JSON.parse(`"${m[1]}"`);
        } catch {
          continue;
        }
        if (!value.startsWith('  %)')) continue;
        const sub = streamSubsystem(uudecode(value));
        if (sub) out.push({ where: `${where}::${part} cdata ${n}`, kind: 'cdata', bytes: sub });
        n++;
      }
    }
  }
}

let cached: FixtureSubsystem[] | null = null;

/** Every subsystem under test/, in file order. Read once per test file. */
export function fixtureSubsystems(): FixtureSubsystem[] {
  if (!cached) {
    cached = [];
    for (const file of filesUnder(TEST_ROOT).sort()) {
      if (!/\.(mat|sldd|slx|mdl)$/i.test(file)) continue;
      subsystemsIn(file, new Uint8Array(readFileSync(file)), relative(TEST_ROOT, file), cached);
    }
  }
  return cached;
}
