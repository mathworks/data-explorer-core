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
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { createSession, ingest } from '../src/index.js';
import type { ParseWarning } from '../src/index.js';
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

  it('carries the parse warnings onto the source node it registers', () => {
    // The empty project above is the failure this asserts against: without the
    // warnings reaching the node, a host holding only the tree cannot tell a store
    // it failed to read from a project with nothing in it.
    const s = createSession();
    const prj = s.addProjectSource('/w/Junk.prj', { 'nothing/relevant.txt': 'not xml' });
    expect(prj.warnings?.map((w) => w.code)).toEqual(['source-empty']);
  });

  it('leaves warnings off a source it read completely', () => {
    // An always-present empty array would read as "this format reports warnings"
    // for formats that do not yet, so absence is the signal for a clean read.
    const s = createSession();
    const prj = s.addProjectSource('/w/MyProj.prj', PRJ_STORE);
    expect(prj.warnings).toBeUndefined();
  });
});

describe('createSession() — a model or MAT parse that came up short reaches the node', () => {
  // The same contract addProjectSource above already meets, for the other two readers.
  // A parser that reports a loss nobody forwards is a parser reporting into a void: the
  // session is the only thing a host holds after an open, so a warning that stops at
  // `parsed.warnings` cannot be shown to anyone. Each pair below is a warning case and
  // its clean control, because "carries warnings" and "stays quiet when there is
  // nothing to say" are two different promises and only the pair pins both.

  // A modern `.mdl` is an OPC package in text framing. This one announces itself as a
  // package and then stops inside the header line that would name its first part, so
  // not one part is recoverable and everything after the compatibility stub is gone —
  // the case that must not open as a model with nothing in it.
  const TRUNCATED_PACKAGE =
    '__MWOPC_PACKAGE_BEGIN__\nModel {\n  Version 9.0\n}\n__MWOPC_PART_BEGIN__ /simulink/blockDiagr';

  function ascii(text: string): ArrayBuffer {
    const u8 = new TextEncoder().encode(text);
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
  }

  it('carries a model parse warning onto the source node', () => {
    const s = createSession();
    const model = s.addModelSource('cut.mdl', ascii(TRUNCATED_PACKAGE));
    expect(model.warnings?.map((w) => w.code)).toEqual(['source-unreadable']);
    // Registered anyway: a host still gets a node for the file it opened, which is
    // what makes the warning something it can display rather than an exception.
    expect(s.getDataSource('cut.mdl')).toBe(model);
  });

  it('leaves warnings off a model it read completely', () => {
    const s = createSession();
    expect(s.addModelSource('m.slx', bytes('model_with_refs.slx')).warnings).toBeUndefined();
  });

  it('carries a MAT parse warning onto the source node', () => {
    // Three bytes past the last record: too few for the 8-byte header a record needs,
    // so the file was truncated mid-write. The variables before it read fine, which is
    // exactly why the loss has to be reported — the tree looks complete.
    const whole = new Uint8Array(bytes('mcos/Param.mat'));
    const truncated = new Uint8Array(whole.length + 3);
    truncated.set(whole);
    const s = createSession();
    const mat = s.addMatSource(
      'Param.mat',
      truncated.buffer.slice(0, truncated.length) as ArrayBuffer,
    );
    expect(mat.warnings?.map((w) => w.code)).toEqual(['part-unreadable']);
  });

  it('leaves warnings off a MAT-file it read completely', () => {
    const s = createSession();
    expect(s.addMatSource('Param.mat', bytes('mcos/Param.mat')).warnings).toBeUndefined();
  });

  it('forwards the warnings of a model the host parsed itself', () => {
    // The *Parsed entry points are the ones a worker-based host actually uses, and a
    // ParseWarning is plain data precisely so it survives that trip. A warning added to
    // the parse here stands in for one the worker's own parse produced.
    const parsed = parseSlx(bytes('model_with_refs.slx'), 'm.slx');
    expect(parsed.warnings).toEqual([]);
    parsed.warnings.push({
      code: 'part-unreadable',
      message: 'The model part "simulink/blockDiagram.json" could not be read.',
      part: 'simulink/blockDiagram.json',
    });
    const s = createSession();
    const model = s.addModelSourceParsed('m.slx', parsed);
    expect(model.warnings?.map((w) => w.part)).toEqual(['simulink/blockDiagram.json']);
  });

  it('forwards the warnings of a MAT-file the host parsed itself', () => {
    const parsed = parseMat(bytes('mcos/Param.mat'));
    expect(parsed.warnings).toEqual([]);
    parsed.warnings.push({ code: 'part-unreadable', message: '"x" was not decoded.', part: 'x' });
    const s = createSession();
    const mat = s.addMatSourceParsed('Param.mat', parsed);
    expect(mat.warnings?.map((w) => w.part)).toEqual(['x']);
  });

  it('leaves warnings off a pre-parsed source that was read completely', () => {
    const s = createSession();
    expect(s.addModelSourceParsed('m.slx', parseSlx(bytes('model_with_refs.slx'), 'm.slx')).warnings)
      .toBeUndefined();
    expect(s.addMatSourceParsed('Param.mat', parseMat(bytes('mcos/Param.mat'))).warnings).toBeUndefined();
  });
});

describe('createSession() — a dictionary that came up short reaches the node, however it arrived', () => {
  // The same contract as the two describes above, for the reader with the most ways in.
  // A `.sldd` reaches a source node by FOUR different routes, and the diagnostics have to
  // survive all four, because which one a host takes is a property of the host and not of
  // the file: the VS Code extension ingests bytes, a worker-based host parses off-thread
  // and registers the result, and a test or a CLI hands over content it already holds.
  //
  //   1. bytes -> ingest -> parseBinarySldd -> addDataSource   (the compressed-binary file)
  //   2. text/bytes -> ingest -> JSON.parse -> addDataSource   (the uncompressed-text file)
  //   3. content -> session.addDataSource                      (a host that holds content)
  //   4. content -> SlddNode.parse -> addParsedSource          (a host that parsed itself)
  //
  // Routes 1 and 2 are the two flavours of the same extension and warn from DIFFERENT
  // layers — the parser sees a damaged data chunk, the node layer sees content with no
  // dictionary in it — which is why the sink is one array threaded through both rather
  // than a field on each. Each case below has its clean control beside it: "carries a
  // warning" and "stays quiet when the file is whole" are two promises, and the corpus
  // sweep in test/parseWarnings.test.ts holds the second one over every fixture there is.

  const NOT_A_DICTIONARY = '{"notes":"this file is valid JSON and is not a data dictionary"}';

  // A real binary dictionary with its one readable part overwritten — same trick as
  // slddWith in test/parseWarnings.test.ts, and for the same reason: no broken binary has
  // to be checked in next to the good one, and the package differs from what MATLAB wrote
  // in exactly the one way this test is about.
  function withBrokenChunk(name: string): ArrayBuffer {
    const entries = unzipSync(new Uint8Array(bytes(name)));
    expect(Object.keys(entries)).toContain('data/chunk0.xml'); // the fixture really is a package
    entries['data/chunk0.xml'] = strToU8('this part was overwritten by something that is not markup');
    const zipped = zipSync(entries);
    return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
  }

  it('carries a binary dictionary parse warning through ingest onto the source node', () => {
    // Route 1, and the only route where the warning is raised by a parser that `ingest`
    // itself calls: every other dispatch in that function hands raw content to an adder
    // that parses inside the session. So this is the one that proves the sink `ingest`
    // creates is the one the session attaches.
    const s = createSession();
    const src = ingest(s, withBrokenChunk('typed_binary.sldd'), { filename: '/w/typed_binary.sldd' });
    expect(src.warnings?.map((w) => w.code)).toEqual(['source-unreadable']);
    // Registered anyway, like a short model: the host gets a node for the file it opened,
    // which is what makes the warning something it can show rather than an exception.
    expect(s.getDataSource('typed_binary.sldd')).toBe(src);
  });

  it('leaves warnings off a binary dictionary it read completely', () => {
    const s = createSession();
    expect(ingest(s, bytes('typed_binary.sldd'), { filename: 'typed_binary.sldd' }).warnings)
      .toBeUndefined();
  });

  it('carries a textual dictionary warning through ingest, from a string and from bytes', () => {
    // Route 2, both of its spellings — `ingest` JSON.parses a string and sniffed-JSON
    // bytes on two separate lines, and a warning that reached the node from one and not
    // the other would be a difference no host could predict.
    const s = createSession();
    const fromString = ingest(s, NOT_A_DICTIONARY, { filename: 'notes.sldd' });
    expect(fromString.warnings?.map((w) => w.code)).toEqual(['source-empty']);
    // The source's own name, because this warning carries no `part` and a host showing it
    // beside three other open files has to be able to say which one it is about.
    expect(fromString.warnings?.[0].message).toContain('notes.sldd');
    const fromBytes = ingest(s, strToU8(NOT_A_DICTIONARY), { filename: 'sniffed.sldd' });
    expect(fromBytes.warnings?.map((w) => w.code)).toEqual(['source-empty']);
    expect(fromBytes.warnings?.[0].message).toContain('sniffed.sldd');
  });

  it('leaves warnings off a textual dictionary it read completely', () => {
    const s = createSession();
    const asText = readFileSync(fixture('typed_text.sldd'), 'utf8');
    expect(ingest(s, asText, { filename: 'typed_text.sldd' }).warnings).toBeUndefined();
    expect(ingest(s, loadJson('typed_text.sldd'), { filename: 'parsed.sldd' }).warnings).toBeUndefined();
  });

  it('carries a warning for content handed straight to addDataSource', () => {
    // Route 3, twice: through `ingest`'s already-parsed branch, which is what a host with
    // a JSON cache uses, and through the session adder that branch calls.
    const s = createSession();
    expect(ingest(s, JSON.parse(NOT_A_DICTIONARY), { filename: 'cached.sldd' }).warnings
      ?.map((w) => w.code)).toEqual(['source-empty']);
    expect(s.addDataSource('direct.sldd', JSON.parse(NOT_A_DICTIONARY)).warnings
      ?.map((w) => w.code)).toEqual(['source-empty']);
  });

  it('forwards the warnings of a dictionary the host parsed itself', () => {
    // Route 4 — the one a worker-based host uses, and the reason `SlddNode.parse` takes
    // the sink at all: the host owns the array, gets it filled in off-thread, and hands it
    // over with the node. A `ParseWarning` is plain data precisely so it survives that
    // trip. Without the forwarding this route would be the one way to open a dictionary
    // where a short read is still invisible.
    const warnings: ParseWarning[] = [];
    const node = SlddNode.parse(JSON.parse(NOT_A_DICTIONARY) as Record<string, unknown>, 'notes.sldd', warnings);
    expect(warnings.map((w) => w.code)).toEqual(['source-empty']);
    const s = createSession();
    const src = s.addParsedSource('notes.sldd', node as never, { size: 7 }, warnings);
    expect(src.warnings?.map((w) => w.code)).toEqual(['source-empty']);
    // The meta path still works with a fourth argument in play.
    expect(src.meta).toMatchObject({ size: 7 });
  });

  it('leaves warnings off a pre-built dictionary node that was read completely', () => {
    const s = createSession();
    const warnings: ParseWarning[] = [];
    const node = SlddNode.parse(loadJson('typed_text.sldd'), 'typed_text.sldd', warnings);
    expect(warnings).toEqual([]);
    // Both spellings a host might use: the empty sink it collected, and no sink at all.
    expect(s.addParsedSource('a.sldd', node as never, undefined, warnings).warnings).toBeUndefined();
    expect(s.addParsedSource('b.sldd', node as never).warnings).toBeUndefined();
  });

  it('puts both layers’ warnings on one source, in one list', () => {
    // What the shared sink buys, and the reason it is a sink rather than a field on each
    // layer's result: a half-written dictionary can lose its content part AND leave an
    // unreadable System Composer catalog behind, and those two losses are found by two
    // different layers. A host renders one list per file, so both have to be in it.
    const s = createSession();
    const halfWritten = {
      __MW_TEXT_PARTS__: {
        '__MW_TEXT_PART__/simulink/systemcomposer/interfaceDictionary': { nothing: 'readable' },
      },
    };
    const src = s.addDataSource('half.sldd', halfWritten);
    expect(src.warnings?.map((w) => w.code)).toEqual(['part-unreadable', 'source-empty']);
    expect(src.warnings?.map((w) => w.part))
      .toEqual(['simulink/systemcomposer/interfaceDictionary', undefined]);
  });
});
