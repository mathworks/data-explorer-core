// Copyright 2026 The MathWorks, Inc.
//
// Reading a `.sldd` without a session: the format sniff, the content unwrap, and what a
// reference means.
//
// All three were spelled more than once — in ingest, in SlddNode, and in the consuming
// extension's own workspace scanner — and each copy is a chance to gate on the FILENAME
// instead of the bytes and read a compressed dictionary as JSON. So the tests here are
// about the two SPELLINGS of one dictionary agreeing, not about either one in isolation:
// the same file saved both ways must read the same, or a host reports a perfectly good
// dictionary as empty depending on how it was saved.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { isJsonTextBytes, readSlddContent, slddChunkContent, normalizeRefNames } from '../src/index.js';

function fixtureBytes(name: string): ArrayBuffer {
  const u8 = new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

function artifactText(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`./parity/artifacts/${rel}`, import.meta.url)), 'utf8');
}

function bytesOf(text: string): ArrayBuffer {
  const u8 = strToU8(text);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

describe('isJsonTextBytes — the sniff that decides which reader runs', () => {
  it('accepts a bare JSON object', () => {
    expect(isJsonTextBytes(strToU8('{"a":1}'))).toBe(true);
  });

  it('looks past a UTF-8 BOM and any leading whitespace', () => {
    // Both are things an editor or a pretty-printer legitimately adds. A sniff that
    // stopped at byte 0 would send such a file to the zip reader, which fails with a
    // misleading "invalid zip data" about a file that is perfectly readable.
    expect(isJsonTextBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...strToU8('{"a":1}')]))).toBe(true);
    expect(isJsonTextBytes(strToU8('\n\t  {"a":1}'))).toBe(true);
    expect(isJsonTextBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...strToU8('\r\n {"a":1}')]))).toBe(true);
  });

  it('rejects a zip, which is what the other flavour of the SAME extension is', () => {
    const zipped = zipSync({ 'a.txt': strToU8('x') });
    expect(isJsonTextBytes(zipped)).toBe(false);
    expect(zipped[0]).toBe(0x50); // 'P' of 'PK' — the byte the two flavours differ on
  });

  it('rejects bytes that are nothing but whitespace, and empty bytes', () => {
    expect(isJsonTextBytes(strToU8('   \n'))).toBe(false);
    expect(isJsonTextBytes(new Uint8Array(0))).toBe(false);
    expect(isJsonTextBytes(new Uint8Array([0xef, 0xbb, 0xbf]))).toBe(false);
  });

  it('rejects JSON that is not an object — a dictionary always is', () => {
    expect(isJsonTextBytes(strToU8('[1,2]'))).toBe(false);
    expect(isJsonTextBytes(strToU8('"just a string"'))).toBe(false);
  });
});

describe('readSlddContent — one reader for both on-disk formats', () => {
  it('reads a textual dictionary', () => {
    const json = readSlddContent(bytesOf(artifactText('text/params.sldd')));
    expect(slddChunkContent(json)).not.toBe(null);
  });

  it('reads a compressed-binary dictionary', () => {
    const json = readSlddContent(fixtureBytes('compressed.sldd'));
    expect(slddChunkContent(json)).not.toBe(null);
  });

  it('gives the same entry names for the same dictionary saved both ways', () => {
    // The invariant the whole module exists for. rt_text.sldd and rt_bin.sldd are the
    // same dictionary written in the two formats, so a reader that dispatches correctly
    // cannot tell them apart from here.
    const names = (bytes: ArrayBuffer): string[] => {
      const content = slddChunkContent(readSlddContent(bytes));
      return ((content?.entries as Record<string, unknown>[]) ?? []).map((e) => e.name as string).sort();
    };
    const fromText = names(fixtureBytes('rt_text.sldd'));
    const fromBinary = names(fixtureBytes('rt_bin.sldd'));
    expect(fromText).not.toEqual([]);
    expect(fromBinary).toEqual(fromText);
  });

  it('collects a binary reader’s warnings into the array it was handed', () => {
    // The out-parameter convention: the caller keeps the array and can pass the SAME one
    // on to addDataSource, so one file reports one list however many layers read it.
    const warnings: { code: string }[] = [];
    readSlddContent(fixtureBytes('compressed.sldd'), warnings);
    expect(Array.isArray(warnings)).toBe(true);
  });

  it('throws on a broken textual dictionary rather than answering with nothing', () => {
    // Refusal policy is the CALLER's: a host opening one file wants a banner, and a scan
    // over a folder wants to skip the file and keep going. Neither is decided here, so
    // what a corrupt file does is throw — which both callers can act on.
    expect(() => readSlddContent(bytesOf('{ not json'))).toThrow();
  });
});

describe('slddChunkContent — where the entries actually live', () => {
  it('unwraps the three-level part path', () => {
    const content = slddChunkContent({
      __MW_TEXT_PARTS__: {
        '__MW_TEXT_PART__/data/chunk0': { __MW_TEXT_content: { entries: [{ name: 'Kp' }] } },
      },
    });
    expect(content?.entries).toEqual([{ name: 'Kp' }]);
  });

  it('answers null — not an empty object — when there is no content part', () => {
    // Null is a real answer and not a failure: MATLAB writes a content-less dictionary
    // for a file that was never completed, and SlddNode reports that as `source-empty`
    // rather than as a parse loss. An empty object here would make the two
    // indistinguishable.
    expect(slddChunkContent({})).toBe(null);
    expect(slddChunkContent({ __MW_TEXT_PARTS__: {} })).toBe(null);
    expect(slddChunkContent({ __MW_TEXT_PARTS__: { '__MW_TEXT_PART__/data/chunk0': {} } })).toBe(null);
  });

  it('is distinct from a dictionary whose content part holds no entries', () => {
    // The near-miss on the other side of that line: MATLAB writes exactly this for a
    // dictionary a user created and has not filled in. It is a COMPLETE file, read
    // correctly, so the content part is present and the entry list is empty.
    const content = slddChunkContent({
      __MW_TEXT_PARTS__: { '__MW_TEXT_PART__/data/chunk0': { __MW_TEXT_content: { entries: [] } } },
    });
    expect(content).not.toBe(null);
    expect(content?.entries).toEqual([]);
  });
});

describe('normalizeRefNames — a reference is a string OR a { file } object', () => {
  it('accepts the bare-string form, which the binary reader emits', () => {
    expect(normalizeRefNames(['common.sldd', 'shared.sldd'])).toEqual(['common.sldd', 'shared.sldd']);
  });

  it('accepts the object form, which a textual dictionary can hold', () => {
    // THE BUG. Which form a file uses is a property of its WRITER, not of the reference,
    // so a reader that took only strings resolved the sub-dictionaries of one flavour and
    // reported that the other had none — the inherited entries invisible, for the same
    // dictionary saved twice.
    expect(normalizeRefNames([{ file: 'common.sldd' }])).toEqual(['common.sldd']);
    expect(normalizeRefNames([{ file: 'common.sldd', extra: 1 }])).toEqual(['common.sldd']);
  });

  it('accepts a list that mixes the two forms', () => {
    expect(normalizeRefNames(['a.sldd', { file: 'b.sldd' }])).toEqual(['a.sldd', 'b.sldd']);
  });

  it('preserves order and case — a reference is matched, not displayed', () => {
    expect(normalizeRefNames([{ file: 'B.SLDD' }, 'a.sldd'])).toEqual(['B.SLDD', 'a.sldd']);
  });

  it('drops what carries no usable name rather than coercing it', () => {
    // 'undefined' is not a file name, and reporting one would send a host looking for it.
    expect(normalizeRefNames([null, undefined, 42, {}, { file: '' }, { file: 7 }, ''])).toEqual([]);
    expect(normalizeRefNames(['a.sldd', null, { file: 'b.sldd' }])).toEqual(['a.sldd', 'b.sldd']);
  });

  it('answers with nothing for anything that is not a list', () => {
    // The field is absent for every format but `.sldd`, and that is "no references" —
    // the honest answer to the question, not an error.
    expect(normalizeRefNames(undefined)).toEqual([]);
    expect(normalizeRefNames(null)).toEqual([]);
    expect(normalizeRefNames('common.sldd')).toEqual([]);
    expect(normalizeRefNames({ file: 'common.sldd' })).toEqual([]);
  });
});
