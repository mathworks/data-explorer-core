// Copyright 2026 The MathWorks, Inc.
//
// The write path, from a consumer's side of the package boundary. Two things are
// under test, and they are the same gap seen from two distances:
//
//   serializeBinarySldd  — the function the live MATLAB gate exists to prove, which
//                          was reachable only from inside this repo.
//   session.serializeSource(srcId)
//                        — the uniform "give me this source's bytes" ask, which did
//                          not exist at all: the textual flavour was reachable only
//                          by knowing to call SlddNode.serializeJson() yourself, and
//                          the binary flavour needed a deep import that the exports
//                          map does not publish.
//
// The contract that matters most here is the DISCRIMINANT. A caller writing a file
// must not have to `typeof` the result to find out whether it holds bytes or text,
// and must not have to try/catch a format that has no write path — so a read-only
// source answers null, in the same register getDataSource already uses for absent.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession, ingest, parseBinarySldd, serializeBinarySldd, SlddNode } from '../src/index.js';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

function bytes(name: string): ArrayBuffer {
  const u8 = new Uint8Array(readFileSync(fixture(name)));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

const info = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
const PRJ_STORE = {
  'resources/project/root/FILESHASHp.xml': info('<Info location="Root" type="Files"/>'),
  'resources/project/FILESHASH/AAAp.xml': info('<Info location="helper.m" type="File"/>'),
  'resources/project/FILESHASH/AAAd.xml': info('<Info/>'),
};

// Every entry name in a dictionary tree, which is what "the same document came back"
// means for a round trip that does not claim to be byte-exact.
function entryNames(source: { flatten(): { name: string; isEntry?: boolean }[] }): string[] {
  return source
    .flatten()
    .filter((n) => n.isEntry)
    .map((n) => n.name)
    .sort();
}

function load(file: string) {
  const s = createSession();
  const src = ingest(s, bytes(file), { filename: file });
  return { s, src };
}

describe('serializeBinarySldd is reachable from the package root', () => {
  it('is exported, and its output re-parses as the dictionary it came from', () => {
    // The whole point of the item: the MATLAB-gated write path was callable only by
    // this repo's own tests. A consumer holding an SlddNode — which the root DOES
    // export — must be able to turn it back into bytes.
    expect(typeof serializeBinarySldd).toBe('function');

    const { src } = load('object_array_binary.sldd');
    const written = serializeBinarySldd(src as unknown as SlddNode);
    expect(written.byteLength).toBeGreaterThan(0);

    const reparsed = SlddNode.parse(parseBinarySldd(written), 'again.sldd');
    expect(entryNames(reparsed)).toEqual(entryNames(src));
  });
});

describe('session.serializeSource', () => {
  it('answers a binary .sldd with bytes, marked as bytes', () => {
    const { s, src } = load('object_array_binary.sldd');
    const out = s.serializeSource('object_array_binary.sldd');

    expect(out).not.toBeNull();
    expect(out!.kind).toBe('binary');
    // The vocabulary is the source node's own, so a caller can correlate this with
    // the `sourceFormat` it already sees on SourceDTO.
    expect(out!.sourceFormat).toBe('xml');
    expect(out!.kind === 'binary' && out!.bytes instanceof Uint8Array).toBe(true);

    const written = out!.kind === 'binary' ? out!.bytes : new Uint8Array();
    const buf = written.buffer.slice(written.byteOffset, written.byteOffset + written.byteLength) as ArrayBuffer;
    expect(entryNames(SlddNode.parse(parseBinarySldd(buf), 'again.sldd'))).toEqual(entryNames(src));
  });

  it('answers a textual .sldd with text, marked as text', () => {
    const { s, src } = load('object_array_text.sldd');
    const out = s.serializeSource('object_array_text.sldd');

    expect(out).not.toBeNull();
    expect(out!.kind).toBe('text');
    expect(out!.sourceFormat).toBe('json');

    const text = out!.kind === 'text' ? out!.text : '';
    // Round-trips through the reader that opens a textual .sldd, so what came back
    // is a file and not a debug dump.
    const reparsed = SlddNode.parse(JSON.parse(text), 'again.sldd');
    expect(entryNames(reparsed)).toEqual(entryNames(src));
  });

  it('returns the flavour the file arrived in, not one fixed default', () => {
    // The two fixtures are the SAME dictionary written both ways, which is what makes
    // this assertion possible: identical entries, different bytes-vs-text answer. The
    // point of serializing is writing back over the original, so answering a
    // compressed-binary .sldd with JSON text would corrupt every file it touched.
    const bin = load('object_array_binary.sldd');
    const txt = load('object_array_text.sldd');
    expect(entryNames(bin.src)).toEqual(entryNames(txt.src));

    expect(bin.s.serializeSource('object_array_binary.sldd')!.kind).toBe('binary');
    expect(txt.s.serializeSource('object_array_text.sldd')!.kind).toBe('text');
  });

  it('carries an edit into the bytes it hands back', () => {
    // A serializer that returned the ORIGINAL bytes would pass every assertion above
    // and still be useless — save exists to persist an edit.
    const { s, src } = load('object_array_text.sldd');
    const entry = (src.flatten() as { id: string; name: string; isEntry?: boolean }[]).find((n) => n.isEntry)!;
    s.setActive(src as never, entry as never);
    expect(s.editProperty(entry.id, 'Name', 'renamedByTest')).toBe(true);

    const out = s.serializeSource('object_array_text.sldd')!;
    const text = out.kind === 'text' ? out.text : '';
    expect(entryNames(SlddNode.parse(JSON.parse(text), 'again.sldd'))).toContain('renamedByTest');
  });

  it('returns null for a read-only format instead of throwing', () => {
    // .slx / .mdl / .mat / .prj have no write path at all (see docs/TODO.md, "Not
    // gaps"). A consumer enumerating every open source must not need a try/catch per
    // source to find that out, and must never be handed bytes that only look like a
    // file — ModelNode.serialize(), for one, returns a summary object, not a model.
    const s = createSession();
    s.addModelSource('model_with_refs.slx', bytes('model_with_refs.slx'));
    s.addMatSource('strings.mat', bytes('strings.mat'));
    s.addProjectSource('MyProj.prj', PRJ_STORE);

    expect(s.serializeSource('model_with_refs.slx')).toBeNull();
    expect(s.serializeSource('strings.mat')).toBeNull();
    expect(s.serializeSource('MyProj.prj')).toBeNull();
  });

  it('returns null for a srcId the session does not hold', () => {
    // Same answer as getDataSource for the same question, so a caller has one rule.
    const s = createSession();
    expect(s.serializeSource('never-opened.sldd')).toBeNull();
  });
});
