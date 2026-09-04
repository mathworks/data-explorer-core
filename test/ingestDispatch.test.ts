// Copyright 2026 The MathWorks, Inc.
// Unit tests for ingest() — filename/extension sniffing, the textual-vs-binary
// .sldd byte discrimination, and content-kind validation. These cover the
// dispatch layer only; per-format parsing is exercised by the parser tests.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { createSession, ingest } from '../src/index.js';

function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
}

const DESIGN_JSON = '{"Simulink_Design":{}}';

describe('ingest — .sldd content kinds', () => {
  it('accepts an already-parsed object', () => {
    const s = createSession();
    const src = ingest(s, JSON.parse(DESIGN_JSON), { filename: 'parsed.sldd' });
    expect(src).toBeTruthy();
    expect(s.hasDataSource('parsed.sldd')).toBe(true);
  });

  it('accepts a JSON string', () => {
    const s = createSession();
    ingest(s, DESIGN_JSON, { filename: 'text.sldd' });
    expect(s.hasDataSource('text.sldd')).toBe(true);
  });

  it('accepts JSON bytes', () => {
    const s = createSession();
    ingest(s, strToU8(DESIGN_JSON), { filename: 'bytes.sldd' });
    expect(s.hasDataSource('bytes.sldd')).toBe(true);
  });

  it('accepts JSON bytes led by whitespace', () => {
    // Pretty-printed or editor-touched files can lead with a newline; the byte
    // sniffer must look past it rather than assume a zip.
    const s = createSession();
    ingest(s, strToU8(`\n\t  ${DESIGN_JSON}`), { filename: 'ws.sldd' });
    expect(s.hasDataSource('ws.sldd')).toBe(true);
  });

  it('accepts JSON bytes led by a UTF-8 BOM', () => {
    const s = createSession();
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...strToU8(DESIGN_JSON)]);
    ingest(s, bom, { filename: 'bom.sldd' });
    expect(s.hasDataSource('bom.sldd')).toBe(true);
  });

  it('accepts a BOM followed by whitespace', () => {
    const s = createSession();
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...strToU8(`\n  ${DESIGN_JSON}`)]);
    ingest(s, bom, { filename: 'bomws.sldd' });
    expect(s.hasDataSource('bomws.sldd')).toBe(true);
  });

  it('routes a real compressed-binary .sldd through the binary parser', () => {
    const s = createSession();
    ingest(s, fixtureBytes('compressed.sldd'), { filename: 'compressed.sldd' });
    expect(s.hasDataSource('compressed.sldd')).toBe(true);
  });

  it('accepts an ArrayBuffer as well as a Uint8Array', () => {
    const s = createSession();
    const u8 = strToU8(DESIGN_JSON);
    const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    ingest(s, ab as ArrayBuffer, { filename: 'ab.sldd' });
    expect(s.hasDataSource('ab.sldd')).toBe(true);
  });
});

describe('ingest — source id and metadata', () => {
  it('derives the source id from the basename, dropping any directory', () => {
    const s = createSession();
    ingest(s, JSON.parse(DESIGN_JSON), { filename: '/some/deep/path/model.sldd' });
    expect(s.getDataSourceIds()).toEqual(['model.sldd']);
  });

  it('handles a Windows-style path separator', () => {
    const s = createSession();
    ingest(s, JSON.parse(DESIGN_JSON), { filename: 'C:\\work\\model.sldd' });
    expect(s.getDataSourceIds()).toEqual(['model.sldd']);
  });

  it('forwards metadata to the created source', () => {
    const s = createSession();
    const src = ingest(s, JSON.parse(DESIGN_JSON), {
      filename: 'meta.sldd',
      meta: { path: '/work/meta.sldd', size: 128 },
    }) as any;
    expect(src.meta.path).toBe('/work/meta.sldd');
    expect(src.meta.size).toBe(128);
  });

  it('matches the extension case-insensitively', () => {
    const s = createSession();
    ingest(s, JSON.parse(DESIGN_JSON), { filename: 'SHOUTY.SLDD' });
    expect(s.hasDataSource('SHOUTY.SLDD')).toBe(true);
  });
});

describe('ingest — other formats', () => {
  it('routes .mat bytes to the MAT source adder', () => {
    const s = createSession();
    ingest(s, fixtureBytes('mcos/Param.mat'), { filename: 'Param.mat' });
    expect(s.hasDataSource('Param.mat')).toBe(true);
  });

  it('routes .slx bytes to the model source adder', () => {
    const s = createSession();
    ingest(s, fixtureBytes('model_with_refs.slx'), { filename: 'model_with_refs.slx' });
    expect(s.hasDataSource('model_with_refs.slx')).toBe(true);
  });

  it('routes .mdl bytes to the same model source adder', () => {
    // A `.mdl` is a Simulink model like a `.slx` is; only the container differs, and
    // WHICH container is decided on the bytes further in (see MdlParser). The classic
    // nested-brace flavour is used here because it is the one that shares no framing
    // at all with a `.slx`, so it proves the dispatch is not zip-shaped.
    const s = createSession();
    ingest(s, strToU8('Model {\n  Name                    "legacy"\n}\n'), { filename: 'legacy.mdl' });
    expect(s.hasDataSource('legacy.mdl')).toBe(true);
  });
});

describe('ingest — rejections', () => {
  it('rejects an unsupported extension with the expected list', () => {
    const s = createSession();
    expect(() => ingest(s, DESIGN_JSON, { filename: 'notes.txt' }))
      .toThrow(/unsupported extension "\.txt"/);
    // The list in the message is what a host shows the user, so it has to name every
    // extension that is actually accepted.
    expect(() => ingest(s, DESIGN_JSON, { filename: 'notes.txt' }))
      .toThrow(/expected \.sldd\/\.slx\/\.mdl\/\.mat\/\.prj/);
  });

  it('rejects a filename with no extension', () => {
    const s = createSession();
    expect(() => ingest(s, DESIGN_JSON, { filename: 'README' }))
      .toThrow(/unsupported extension/);
  });

  it('rejects non-binary content for a binary-only format', () => {
    const s = createSession();
    expect(() => ingest(s, DESIGN_JSON, { filename: 'model.slx' }))
      .toThrow(/requires binary content/);
    // A classic `.mdl` is text, but it still arrives as BYTES: the parser sniffs the
    // container itself, and a caller handing over a decoded string has skipped that.
    expect(() => ingest(s, DESIGN_JSON, { filename: 'model.mdl' }))
      .toThrow(/requires binary content/);
    expect(() => ingest(s, DESIGN_JSON, { filename: 'data.mat' }))
      .toThrow(/requires binary content/);
    expect(() => ingest(s, DESIGN_JSON, { filename: 'proj.prj' }))
      .toThrow(/requires binary content/);
  });

  it('rejects malformed JSON in a textual .sldd', () => {
    const s = createSession();
    expect(() => ingest(s, '{not json', { filename: 'bad.sldd' })).toThrow();
  });
});

describe('ingest — .sldd bytes that are neither JSON nor a valid zip', () => {
  it('whitespace-only bytes fall through to the binary path and fail', () => {
    // isJsonText returns false for bytes with no '{' — the ingest layer then
    // tries the zip parser, which rejects the payload. Without this path a
    // corrupted file silently produces an empty source.
    const s = createSession();
    expect(() => ingest(s, new Uint8Array([0x20, 0x09, 0x0a]), { filename: 'empty.sldd' }))
      .toThrow(/invalid zip/i);
  });

  it('empty bytes also fall through to the binary path', () => {
    const s = createSession();
    expect(() => ingest(s, new Uint8Array(0), { filename: 'zero.sldd' })).toThrow();
  });
});

describe('ingest — .prj zip dispatch', () => {
  function makePrjZip(): ArrayBuffer {
    const info = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
    const store: Record<string, Uint8Array> = {
      'resources/project/root/FILESHASHp.xml': strToU8(info('<Info location="Root" type="Files"/>')),
      'resources/project/FILESHASH/AAAp.xml': strToU8(info('<Info location="helper.m" type="File"/>')),
      'resources/project/FILESHASH/AAAd.xml': strToU8(info('<Info/>')),
    };
    const zipped = zipSync(store);
    return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
  }

  it('unzips a .prj and builds a project source from its entries', () => {
    // The VS Code host reads .prj files as raw bytes; ingest must unzip, convert
    // every entry to a UTF-8 string map, and hand it to addProjectSource. If the
    // unzip-to-string step is skipped the project parser receives Uint8Arrays
    // instead of strings and silently produces an empty tree.
    const s = createSession();
    const src = ingest(s, makePrjZip(), { filename: '/path/to/MyProj.prj' });
    expect(src.name).toBe('MyProj.prj');
    expect(s.hasDataSource('MyProj.prj')).toBe(true);
    expect(src.flatten().length).toBeGreaterThan(1);
  });

  it('accepts a Uint8Array as well as an ArrayBuffer', () => {
    const s = createSession();
    const ab = makePrjZip();
    const src = ingest(s, new Uint8Array(ab), { filename: 'Proj.prj' });
    expect(s.hasDataSource('Proj.prj')).toBe(true);
    expect(src.flatten().length).toBeGreaterThan(1);
  });

  it('rejects non-binary content for .prj', () => {
    const s = createSession();
    expect(() => ingest(s, '{}', { filename: 'bad.prj' })).toThrow(/requires binary content/);
  });
});
