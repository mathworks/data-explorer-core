// Copyright 2026 The MathWorks, Inc.
//
// The session's source-add surface.
//
// createSession() exposes SEVEN ways to add a source. Three of them
// (addDataSource / addModelSource / addMatSource) take raw content and are
// covered wherever the parsers are. The other four are the ones tested here:
//
//   addParsedSource        — a pre-built SlddNode, for a host that parsed already
//   addModelSourceParsed   — a pre-parsed .slx
//   addMatSourceParsed     — a pre-parsed .mat
//   addProjectSource       — a .prj content store (used by the VS Code host)
//
// They exist so a host that already holds a parse (from a worker, a cache, or its
// own reader) does not have to re-parse to register a source. That makes their
// contract narrow but easy to get wrong: whatever path is taken, the source must
// end up registered under its id, carry its meta, have its descendants indexed,
// and announce itself on the bus — because the tree, the Explorer view and the
// dirty tracking all key off those four things.
//
// Mutating a loaded source is covered in test/dataModelMutations.test.ts.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { parseSlx } from '../src/datamodel/parser/SlxParser.js';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import SlddNode from '../src/datamodel/node/container/SlddNode.js';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const loadJson = (name: string) => JSON.parse(readFileSync(fixture(name), 'utf8')) as Record<string, unknown>;

function bytes(name: string): ArrayBuffer {
  const u8 = new Uint8Array(readFileSync(fixture(name)));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

// A .prj content store holding one file, so a project built from it is
// distinguishable from the empty one an unreadable store yields. The shape the
// parser walks is a Files-root pointer in root/, then one File pointer in the
// directory named by that root entity's hash. See test/projectParser.test.ts for
// the full store format.
const info = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
const PRJ_STORE = {
  'resources/project/root/FILESHASHp.xml': info('<Info location="Root" type="Files"/>'),
  'resources/project/FILESHASH/AAAp.xml': info('<Info location="helper.m" type="File"/>'),
  'resources/project/FILESHASH/AAAd.xml': info('<Info/>'),
};

describe('createSession() — adding an already-parsed source', () => {
  it('registers a pre-built SlddNode as-is, without re-parsing it', () => {
    // The host hands over the very node it built; wrapping or copying it would
    // break identity for anything already holding a reference.
    const sldd = SlddNode.parse(loadJson('numeric_json.sldd'), 'n.sldd');
    const s = createSession();
    const src = s.addParsedSource('n.sldd', sldd as never, { size: 42 });

    expect(src).toBe(sldd as never);
    expect(s.getDataSource('n.sldd')).toBe(src);
    expect(s.getDataSourceCount()).toBe(1);
    expect(src.meta).toMatchObject({ size: 42, path: '', lastModified: null, fileHandle: null });
  });

  it('indexes a pre-built source’s descendants, so findNodeById resolves them', () => {
    // Registration is what populates the node index. A host that used this path
    // and then could not resolve a node id would have no way to select anything.
    const sldd = SlddNode.parse(loadJson('numeric_json.sldd'), 'n.sldd');
    const s = createSession();
    s.addParsedSource('n.sldd', sldd as never);
    const child = (sldd.flatten() as { id: string }[])[0];
    expect(s.findNodeById(child.id)).toBe(child as never);
  });

  it('announces a pre-built source on the bus like any other', () => {
    const s = createSession();
    let payload: { srcId?: string; slddNode?: unknown } = {};
    s.bus.subscribe('datamodel/source-added', (pl: unknown) => { payload = pl as typeof payload; });
    const sldd = SlddNode.parse(loadJson('numeric_json.sldd'), 'n.sldd');
    const src = s.addParsedSource('n.sldd', sldd as never);
    expect(payload.srcId).toBe('n.sldd');
    expect(payload.slddNode).toBe(src);
  });

  it('builds the same .slx tree from a parse as from the bytes', () => {
    // The two entry points must not diverge: a host that pre-parses has to get the
    // identical tree, or its view differs from a host that did not.
    const direct = createSession().addModelSource('m.slx', bytes('model_with_refs.slx'));
    const s = createSession();
    const viaParsed = s.addModelSourceParsed('m.slx', parseSlx(bytes('model_with_refs.slx'), 'm.slx'), {
      path: '/w/m.slx',
    });

    expect(viaParsed.name).toBe(direct.name);
    expect(viaParsed.flatten().length).toBe(direct.flatten().length);
    expect(viaParsed.meta.path).toBe('/w/m.slx');
    expect(s.hasDataSource('m.slx')).toBe(true);
  });

  it('builds the same .mat tree from a parse as from the bytes', () => {
    const direct = createSession().addMatSource('Param.mat', bytes('mcos/Param.mat')) as unknown as {
      NumberOfEntries: number;
    };
    const s = createSession();
    const viaParsed = s.addMatSourceParsed('Param.mat', parseMat(bytes('mcos/Param.mat'))) as unknown as {
      name: string;
      NumberOfEntries: number;
    };

    expect(viaParsed.name).toBe('Param.mat');
    expect(viaParsed.NumberOfEntries).toBe(direct.NumberOfEntries);
    expect(s.getDataSourceIds()).toEqual(['Param.mat']);
  });
});

describe('createSession() — addProjectSource names the project from its file', () => {
  it('takes the basename of the source id, keeping the .prj extension', () => {
    // srcId is a full path (or a URI) but the tree shows a file, so the label has to
    // be the basename — otherwise the whole path appears as the project name.
    const s = createSession();
    const prj = s.addProjectSource('/w/sub/MyProj.prj', PRJ_STORE) as unknown as {
      name: string;
      NumberOfEntries: number;
    };
    expect(prj.name).toBe('MyProj.prj');
    expect(s.getDataSource('/w/sub/MyProj.prj')).toBe(prj as never);
    // The store's one file made it into the tree, so a later assertion of zero
    // entries means the parse found nothing rather than the store being empty.
    expect(prj.NumberOfEntries).toBe(1);
  });

  it('prefers meta.path when the id is opaque, as it is for a URI host', () => {
    // The VS Code host keys sources by URI string, which carries no usable
    // basename; meta.path is the real filename in that case.
    const s = createSession();
    expect(s.addProjectSource('scheme://87f2a1', PRJ_STORE, { path: '/deep/Other.prj' }).name).toBe('Other.prj');
  });

  it('splits a Windows path as readily as a POSIX one', () => {
    const s = createSession();
    expect(s.addProjectSource('C:\\work\\Win.prj', PRJ_STORE).name).toBe('Win.prj');
  });

  it('keeps the filename intact whatever the extension’s case', () => {
    // A case-insensitive filesystem hands back .PRJ as readily as .prj. Only the
    // name passed down to parseProject is stripped, and the node label is not, so
    // the extension must survive here in whatever case the file carries.
    const s = createSession();
    expect(s.addProjectSource('/w/Shouty.PRJ', PRJ_STORE).name).toBe('Shouty.PRJ');
  });

  it('uses the id unchanged when it has no path and no extension', () => {
    const s = createSession();
    expect(s.addProjectSource('bare', PRJ_STORE).name).toBe('bare');
  });

  it('registers the project like any other source, index and bus included', () => {
    const s = createSession();
    let announced = 0;
    s.bus.subscribe('datamodel/source-added', () => { announced++; });
    const prj = s.addProjectSource('/w/P.prj', PRJ_STORE) as unknown as { flatten(): { id: string }[] };
    expect(announced).toBe(1);
    expect(s.getDataSourceCount()).toBe(1);
    const section = prj.flatten()[0];
    expect(s.findNodeById(section.id)).toBeTruthy();
  });

  it('still produces a project node from a store it cannot make sense of', () => {
    // parseProject never throws — a failed open has no fallback view — so an
    // unreadable store must yield an empty project rather than a rejected add.
    const s = createSession();
    const prj = s.addProjectSource('/w/Junk.prj', { 'nothing/relevant.txt': 'not xml' }) as unknown as {
      name: string;
      NumberOfEntries: number;
    };
    expect(prj.name).toBe('Junk.prj');
    expect(prj.NumberOfEntries).toBe(0);
  });
});
