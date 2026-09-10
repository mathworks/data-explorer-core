// Copyright 2026 The MathWorks, Inc.
//
// The names of the one part a `.sldd` keeps its entries in, and the agreements between the
// code that writes them and the code that reads them back.
//
// Both spellings — the zip member `data/chunk0.xml` and the JSON key path
// `__MW_TEXT_PARTS__` -> `__MW_TEXT_PART__/data/chunk0` -> `__MW_TEXT_content` — were
// literals at seven sites in this package and six more in its vscode host. Nothing checked
// that the sites agreed, and none of the disagreements would have thrown:
//
//   * the reader EXCLUDES the data part from its pass-through bag and the writer PUTS IT
//     BACK. Two spellings there means a save that carries a stale copy of the entries
//     alongside the new one, in a zip that opens perfectly.
//   * two writers build the JSON path (the binary reader and `SlddNode.serializeJson`) and
//     one function reads it (`slddChunkContent`). A drifted writer yields `null`, which
//     SlddNode reports as `source-empty` — indistinguishable from a dictionary a user had
//     just created.
//
// So these tests do two things the constants cannot do for themselves. They spell the
// strings out as LITERALS, because a test that asked `DATA_PART_XML` what `DATA_PART_XML`
// is would pass for any value; and they check writer against reader over real MATLAB-written
// fixtures, which is the only place the agreement is observable.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import {
  DATA_PART,
  DATA_PART_KEY,
  DATA_PART_XML,
  TEXT_CONTENT,
  TEXT_PARTS,
  createSession,
  ingest,
  parseBinarySldd,
  readSlddContent,
  serializeBinarySldd,
  slddChunkContent,
} from '../src/index.js';
import type SlddNode from '../src/datamodel/node/container/SlddNode.js';

const BINARY = 'compressed.sldd';
const TEXTUAL = 'object_array_text.sldd';

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
}

function buffer(name: string): ArrayBuffer {
  const u8 = fixture(name);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

describe('the two spellings of one part', () => {
  it('are the strings MATLAB writes, written out', () => {
    // The literals, once, so every derivation below is anchored to the bytes on disk
    // rather than to itself.
    expect(DATA_PART).toBe('data/chunk0');
    expect(DATA_PART_XML).toBe('data/chunk0.xml');
    expect(TEXT_PARTS).toBe('__MW_TEXT_PARTS__');
    expect(DATA_PART_KEY).toBe('__MW_TEXT_PART__/data/chunk0');
    expect(TEXT_CONTENT).toBe('__MW_TEXT_content');
  });

  it('share a stem, which is why they are derived and not typed twice', () => {
    expect(DATA_PART_XML).toBe(`${DATA_PART}.xml`);
    expect(DATA_PART_KEY.endsWith(DATA_PART)).toBe(true);
  });

  it('do not confuse the member name with the JSON key', () => {
    // The one plausible "cleanup" that would break both formats at once: the prefix
    // already ends in a separator, so the key looks like a path join with the member name
    // — but the JSON key carries no `.xml`, and adding one makes every textual dictionary
    // read as empty.
    expect(DATA_PART_KEY).not.toContain('.xml');
    expect(new Set([DATA_PART, DATA_PART_XML, DATA_PART_KEY, TEXT_PARTS, TEXT_CONTENT]).size).toBe(5);
  });
});

describe('the zip member the reader excludes is the one the writer puts back', () => {
  it('keeps the data part out of the pass-through bag, and everything else in', () => {
    const zip = unzipSync(fixture(BINARY));
    const content = parseBinarySldd(buffer(BINARY)) as { __zipMetadata: Record<string, Uint8Array> };
    // The bag is the WRITER's input, so what is missing from it is what the writer must
    // supply — and what is in it is what the writer must not touch.
    expect(Object.keys(content.__zipMetadata)).not.toContain(DATA_PART_XML);
    expect(Object.keys(content.__zipMetadata).sort()).toEqual(
      Object.keys(zip)
        .filter((n) => n !== DATA_PART_XML)
        .sort(),
    );
    expect(Object.keys(content.__zipMetadata).length, 'the fixture has other members to carry').toBeGreaterThan(0);
  });

  it('re-serializes to the same member set, with the data part present exactly once', () => {
    // The failure this pins is not a throw. If the exclusion and the insertion named
    // different strings, this would still produce a valid zip — one carrying the OLD
    // entries under the name a reader looks up and the new ones under a name nothing
    // reads. Comparing member sets is what sees it.
    const s = createSession();
    const src = ingest(s, buffer(BINARY), { filename: BINARY });
    const out = unzipSync(new Uint8Array(serializeBinarySldd(src as unknown as SlddNode)));
    expect(Object.keys(out)).toContain(DATA_PART_XML);
    expect(Object.keys(out).sort()).toEqual(Object.keys(unzipSync(fixture(BINARY))).sort());
    // And it is the rebuilt part, not a carried-through copy of the original.
    expect(new TextDecoder().decode(out[DATA_PART_XML])).toContain('<DataSource');
  });
});

describe('the JSON path two writers build and one reader reads', () => {
  const walk = (json: Record<string, unknown>) => {
    const parts = json[TEXT_PARTS] as Record<string, unknown> | undefined;
    const chunk = parts?.[DATA_PART_KEY] as Record<string, unknown> | undefined;
    return chunk?.[TEXT_CONTENT] as Record<string, unknown> | undefined;
  };

  it('reaches the entries of a dictionary MATLAB wrote as text', () => {
    // The strongest anchor available: the path is walked by hand over the RAW JSON of a
    // real textual `.sldd`, so this fails if the constants describe a shape only this
    // package's own writers produce.
    const raw = JSON.parse(new TextDecoder().decode(fixture(TEXTUAL))) as Record<string, unknown>;
    const byHand = walk(raw);
    expect(byHand, 'the fixture must carry a content part').toBeTruthy();
    expect(Array.isArray(byHand?.entries)).toBe(true);
    expect(slddChunkContent(raw)).toBe(byHand);
  });

  it('reaches the entries of one MATLAB wrote as a zip, through the binary reader', () => {
    const content = readSlddContent(buffer(BINARY));
    expect(slddChunkContent(content)).toBe(walk(content));
    expect(Array.isArray(slddChunkContent(content)?.entries)).toBe(true);
  });

  it('is the same path SlddNode writes back, which is the agreement that had no test', () => {
    // Two writers, one reader: the binary parser builds this object out of XML and
    // `serializeJson` builds it out of the node tree, and `slddChunkContent` is the only
    // thing that unwraps either. Pinning the reader against ONE writer would leave the
    // other free to drift, so the round trip goes through both.
    const s = createSession();
    const src = ingest(s, buffer(BINARY), { filename: BINARY }) as unknown as SlddNode;
    const written = src.serializeJson();
    const readBack = slddChunkContent(written);
    expect(readBack).toBeTruthy();
    expect((readBack?.entries as unknown[]).length).toBe(
      (slddChunkContent(readSlddContent(buffer(BINARY)))?.entries as unknown[]).length,
    );
  });

  it('answers null when the part sits under any other key', () => {
    // What a drifted writer actually produces, and the reason the drift is quiet: not a
    // throw, but the same answer a dictionary with no content part gives — which SlddNode
    // reports as `source-empty`.
    const wrong = { [TEXT_PARTS]: { [`${DATA_PART_KEY}.xml`]: { [TEXT_CONTENT]: { entries: [] } } } };
    expect(slddChunkContent(wrong)).toBe(null);
    expect(slddChunkContent({ [TEXT_PARTS]: { [DATA_PART_KEY]: { __MW_content: { entries: [] } } } })).toBe(null);
    expect(slddChunkContent({})).toBe(null);
  });
});
