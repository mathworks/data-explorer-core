// Copyright 2026 The MathWorks, Inc.
//
// No fixture carries a path of the machine that made it: not an account's home folder,
// not a sandbox, not the build archive a MATLAB was installed from. MATLAB writes its
// own matlabroot into every function handle it serializes, so three fixtures holding
// one carried an internal build-archive path — inside hex text inside a deflated zip
// part, and in a .mat — where neither a text grep nor the leak check could see it. They
// are scrubbed now (test/fixtures/sparse/scrub_matlabroot.m, which the generators run).
//
// This decodes what every fixture encodes, the way this package reads it: every MAT
// stream (a text dictionary's cdata, a binary dictionary's hex value, a .slx workspace
// part, a classic .mdl's MatData record) through MatParser.decodeMatStream, and every
// .mat's records inflated. The bytes are searched as Latin-1 and as UTF-16LE.
// scripts/leak-check.mjs does the same over every tracked file before a publish.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { unzipSync } from 'fflate';
import { decodeMatStream } from '../src/datamodel/parser/MatParser.js';
import { uudecode } from '../src/datamodel/parser/CdataCodec.js';

// Spelled so that this file does not match the leak check's own needles.
const PATHS = [/\/System\/Volumes/, /mathworks\/devel/, /jobarchiv[e]/, /\/Users\/[A-Za-z0-9._-]+/, /\/home\/[A-Za-z0-9._-]+/, /sandbox/i];

const ROOTS = ['fixtures', join('parity', 'artifacts')].map((d) => fileURLToPath(new URL(`./${d}/`, import.meta.url)));

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

interface Found {
  files: number;
  streams: number;
  records: number;
  refused: string[];
  hits: string[];
}

function search(bytes: Uint8Array, where: string, found: Found): void {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const views = [b.toString('latin1'), b.subarray(0, b.length & ~1).toString('utf16le'), b.subarray(1, 1 + ((b.length - 1) & ~1)).toString('utf16le')];
  for (const view of views) {
    for (const re of PATHS) {
      const m = re.exec(view);
      if (m) found.hits.push(`${where}: ${m[0]}`);
    }
  }
}

function stream(bytes: Uint8Array, where: string, found: Found): void {
  const decoded = decodeMatStream(bytes);
  if (!decoded.ok) {
    found.refused.push(`${where}: ${decoded.reason}`);
    return;
  }
  found.streams++;
  search(bytes, where, found);
}

function matFile(bytes: Uint8Array, where: string, found: Found): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 128; at + 8 <= bytes.length; ) {
    const type = view.getUint32(at, true);
    const size = view.getUint32(at + 4, true);
    if (type === 0 && size === 0) break;
    const body = bytes.subarray(at + 8, Math.min(bytes.length, at + 8 + size));
    found.records++;
    search(type === 15 ? new Uint8Array(inflateSync(body)) : body, `${where} record at ${at}`, found);
    at += 8 + size;
  }
}

function unpack(bytes: Uint8Array, name: string, where: string, found: Found): void {
  search(bytes, where, found);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    let parts: Record<string, Uint8Array>;
    try {
      parts = unzipSync(bytes);
    } catch {
      return;
    }
    for (const [part, data] of Object.entries(parts)) unpack(data, part, `${where}::${part}`, found);
    return;
  }
  if (name.endsWith('.mat') && bytes.length >= 128) {
    matFile(bytes, where, found);
    return;
  }
  if (name.endsWith('.mxarray')) {
    stream(bytes, where, found);
    return;
  }
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
  for (const m of text.matchAll(/Encoding="hex"[^>]*>([^<]*)</g)) {
    stream(Uint8Array.from(Buffer.from(m[1].replace(/\s+/g, ''), 'hex')), `${where} hex`, found);
  }
  if (name.endsWith('.sldd') && text.startsWith('{')) {
    for (const m of text.matchAll(/"_value"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
      const value: string = JSON.parse(`"${m[1]}"`);
      if (value.startsWith('  %)')) stream(uudecode(value), `${where} cdata`, found);
    }
  }
  if (name.endsWith('.mdl')) {
    for (const m of text.matchAll(/DataRecord\s*\{([\s\S]*?)\n\s*\}/g)) {
      const data = /Data\s+((?:"(?:[^"\\]|\\.)*"\s*)+)/.exec(m[1]);
      if (!data) continue;
      const record = [...data[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((c) => c[1]).join('');
      const unescaped = record.replace(/\\(.)/g, (_, c: string) => (c === 'n' || c === 'r' ? '' : c === 't' ? '\t' : c));
      stream(uudecode(unescaped), `${where} MatData`, found);
    }
  }
}

describe('no fixture carries a path of the machine that made it', () => {
  const found: Found = { files: 0, streams: 0, records: 0, refused: [], hits: [] };
  for (const root of ROOTS) {
    for (const file of filesUnder(root)) {
      if (!/\.(mat|sldd|slx|mdl|mxarray)$/i.test(file)) continue;
      found.files++;
      unpack(new Uint8Array(readFileSync(file)), file, file.slice(root.length), found);
    }
  }

  it('reaches every kind of stream there is', () => {
    // Floors, measured when this was written: a sweep that found nothing would pass.
    expect(found.files).toBeGreaterThanOrEqual(90);
    expect(found.streams).toBeGreaterThanOrEqual(120);
    expect(found.records).toBeGreaterThanOrEqual(150);
  });

  it('every MAT stream a fixture carries decodes', () => {
    expect(found.refused).toEqual([]);
  });

  it('and none of them, nor any .mat record, holds a path', () => {
    expect([...new Set(found.hits)]).toEqual([]);
  });
});
