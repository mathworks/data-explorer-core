// Copyright 2026 The MathWorks, Inc.
//
// The diagnostics channel for the model, MAT and dictionary readers — docs/TODO.md
// item 3, the `.slx`/`.mdl`/`.mat`/`.sldd` half. `.prj` closed this first;
// test/projectParser.test.ts is the pattern these follow.
//
// The rule every case here is measured against: a reader that meets the LIMIT OF THE
// FILE has read that file correctly and must stay quiet. It warns when the bytes
// CLAIM something is there and it could not be read. The distinction is the whole
// value of the channel — an `.slx` written before R2020a carries no model UUID, a
// dictionary from R2013b has no linked dictionary, a classic `.mdl` has no release
// string, and none of those is a warning. Warning on them would put a count on every
// legacy file a user opens, which teaches a host and its user to ignore the count.
//
// So the suite has two halves, and the FIRST one is the one that matters most:
//
//   1. The whole corpus, swept. Every `.slx`, `.mdl`, `.mat` and `.sldd` fixture in
//      this repo is a valid, complete file, and every one of them must parse with ZERO
//      warnings. That single test is what stops the channel from filling up with
//      "this release did not write that part".
//
//   2. One case per warning site, built by CORRUPTING a real fixture's bytes in the
//      test — truncate a part, replace one with garbage, rezip — rather than by
//      checking in a new broken binary. The corruption is then visible in the test
//      that depends on it, and the fixture corpus stays a corpus of real files.

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync, strToU8, zlibSync } from 'fflate';
import { parseSlx } from '../src/datamodel/parser/SlxParser.js';
import { parseMdl } from '../src/datamodel/parser/MdlParser.js';
import { parseModel } from '../src/datamodel/parser/ModelParser.js';
import { scanModelStructure } from '../src/datamodel/parser/ModelStructureScan.js';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import { parseMxArray } from '../src/datamodel/parser/MxArrayParser.js';
import { parseBinarySldd, parseBinarySlddParts } from '../src/datamodel/parser/BinarySlddParser.js';
// Through the public entry point, which is what registers the node classes
// SlddNode.parse builds a tree out of. A deep import of SlddNode alone leaves
// NodeRegistry empty and parseEntry with nothing to route an entry to.
import { SlddNode, createSession, ingest, scanSldd } from '../src/index.js';
import { setNativeInflate } from '../src/datamodel/parser/Inflate.js';
import { reasonOf } from '../src/datamodel/parser/ParseWarning.js';
import type { ParseWarning } from '../src/datamodel/parser/ParseWarning.js';
import {
  CLASS,
  MI,
  cellVar,
  charVar,
  dims,
  element,
  matFile,
  matrix,
  matrixBody,
  mxArrayFile,
  numericVar,
  objectVar,
  sparseVar,
  structVar,
  u32le,
  varName,
  arrayFlags,
} from './tools/matBytes.js';

const TEST_ROOT = fileURLToPath(new URL('./', import.meta.url));
const ARTIFACTS = join(TEST_ROOT, 'parity', 'artifacts');
const FIXTURES = join(TEST_ROOT, 'fixtures');
// Copies of MATLAB-written files edited to break MATLAB's load rules on purpose, each with
// MATLAB's verdict (test/matFileCheck.test.ts): no corpus of complete files, so not swept here.
const MAT_CHECK = join(FIXTURES, 'mat-check');

function bytesAt(abs: string): ArrayBuffer {
  const u8 = new Uint8Array(readFileSync(abs));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

// Every file under `dir`, recursively. Recursive rather than one flat readdir so that
// a fixture directory added later is swept without anyone remembering to list it.
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...filesUnder(abs));
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }
  return out;
}

const basename = (abs: string) => abs.slice(abs.lastIndexOf('/') + 1);
const shown = (abs: string) => abs.slice(TEST_ROOT.length);

/** One line per warning, so a failure names the file, the code and the part. */
function lines(file: string, warnings: ParseWarning[]): string[] {
  return warnings.map((w) => `${shown(file)}: ${w.code} [${w.part ?? '-'}] ${w.message}`);
}

const codesAndParts = (warnings: ParseWarning[]) => warnings.map((w) => [w.code, w.part]);

/**
 * The files in the corpus that this reader REFUSES rather than reads, and the message
 * each refusal carries. There is one: a `-v7.3` .mat is HDF5, a container MatParser
 * does not read at all, so sweeping it for warnings is meaningless — it never returns
 * a result to have any.
 *
 * Listed by name rather than by pattern, and the refusal is ASSERTED below rather than
 * skipped, for the same reason: an exemption that only skipped would turn any fixture
 * that stops parsing into a fixture nobody checks.
 */
const REFUSED = new Map<string, string>([
  ['strings_v73.mat', 'MAT-file version 7.3 (HDF5) is not supported'],
]);

// No file in the corpus is meant to carry a warning. Two did until 1.36.3: sparse_values.mat
// holds spTall, MATLAB's sparse(…, 10000000, 2) with two non-zeros, put there by
// make_sparse_fixtures.m precisely because its declared size was past what MatParser
// materialized, and hexobj_values.mat the same array as cTall's first element
// (make_hex_object_fixtures.m) — each recorded, not decoded, and reported. A sparse array
// is held as its non-zeros now, at any size, so both are in the sweep below like every
// other file, and a warning from either fails it.

// The first sweep below parses every model and .mat fixture in the repo: 0.6 s here, and 2 s
// with the machine loaded; give it headroom past vitest's 5 s default on CI's runners.
const CORPUS_TIMEOUT = 60_000;

describe('the whole fixture corpus parses with no warnings at all', () => {
  it('reports nothing for any real .slx, .mdl or .mat in the repo', { timeout: CORPUS_TIMEOUT }, () => {
    // THE guard for this item. Every file swept here was written by MATLAB (or, for
    // the synthesized few, written to be a complete file), spanning R2011b to R2027a
    // and every part layout in between — so a warning from any of them is a reader
    // complaining about a limit of the file, which is the one failure mode that makes
    // the whole channel worthless. It is asserted over the enumerated corpus rather
    // than a hand-listed sample so that a new fixture is covered by default.
    const files = [...filesUnder(ARTIFACTS), ...filesUnder(FIXTURES)]
      .filter((f) => /\.(slx|mdl|mat)$/i.test(f) && !f.startsWith(MAT_CHECK))
      .sort();

    // An empty or mis-filtered list would pass the assertion below vacuously. These
    // are what make the sweep mean something; they are lower bounds, not counts, so
    // adding a fixture never fails them.
    expect(files.filter((f) => f.endsWith('.slx')).length).toBeGreaterThanOrEqual(8);
    expect(files.filter((f) => f.endsWith('.mdl')).length).toBeGreaterThanOrEqual(4);
    expect(files.filter((f) => f.endsWith('.mat')).length).toBeGreaterThanOrEqual(20);

    const reported: string[] = [];
    for (const file of files) {
      const refusal = REFUSED.get(basename(file));
      if (refusal) {
        expect(() => parseMat(bytesAt(file)), shown(file)).toThrow(refusal);
        continue;
      }
      const parsed = file.endsWith('.mat')
        ? parseMat(bytesAt(file))
        : file.endsWith('.mdl')
          ? parseMdl(bytesAt(file), basename(file))
          : parseSlx(bytesAt(file), basename(file));
      // Always an array, never undefined — see the comment on the field itself.
      expect(Array.isArray(parsed.warnings)).toBe(true);
      reported.push(...lines(file, parsed.warnings));
    }
    expect(reported).toEqual([]);
  });

  it('reports nothing for any real .sldd in the repo, in either flavour', () => {
    // The same guard for the dictionary reader, which is a separate sweep only because
    // a `.sldd` has no parse-result object to read `warnings` off: the parser and the
    // node layer both push into a sink the caller owns, so BOTH are swept here, in one
    // pass per file, exactly as `session.addDataSource` runs them.
    //
    // Every dictionary below is a file MATLAB wrote (or, for the hand-built few, one
    // written to be complete), and between them they cover both flavours, a dictionary
    // with no `matlabRelease` in its metadata, a System Composer dictionary carrying
    // parts this reader does not model, and dictionaries that reference no
    // sub-dictionary at all. A warning from any of them would be this reader
    // complaining about a limit of the file.
    const files = filesUnder(TEST_ROOT)
      .filter((f) => /\.sldd$/i.test(f))
      .sort();

    // Lower bounds, not counts, and one per flavour: a sweep that quietly stopped
    // reading one of the two would otherwise still pass.
    const zipped = files.filter((f) => isZipSldd(f));
    expect(zipped.length).toBeGreaterThanOrEqual(12);
    expect(files.length - zipped.length).toBeGreaterThanOrEqual(12);

    const reported: string[] = [];
    for (const file of files) {
      reported.push(...lines(file, slddWarnings(file)));
    }
    expect(reported).toEqual([]);
  });
});

/** True for the compressed-binary flavour: a zip, so its first bytes are 'PK'. */
function isZipSldd(abs: string): boolean {
  const u8 = new Uint8Array(readFileSync(abs));
  return u8[0] === 0x50 && u8[1] === 0x4b;
}

/**
 * Everything both layers of the dictionary reader report for one file on disk.
 *
 * The routing is `ingest`'s: 'PK' means the OPC package, anything else the JSON text.
 * One sink is threaded through both calls because that is how the session runs them —
 * a loss the parser reports and a loss the node layer reports are both losses from the
 * same open, and a host is handed one list.
 */
function slddWarnings(abs: string): ParseWarning[] {
  const warnings: ParseWarning[] = [];
  const content = isZipSldd(abs)
    ? parseBinarySldd(bytesAt(abs), warnings)
    : (JSON.parse(readFileSync(abs, 'utf8')) as Record<string, unknown>);
  SlddNode.parse(content, basename(abs), warnings);
  return warnings;
}

// ---------------------------------------------------------------------------
// .slx — the OPC package
// ---------------------------------------------------------------------------

const SLX_CASES = join(ARTIFACTS, 'slx_layouts', 'slxcases.slx');
const SLX_MODERN = join(ARTIFACTS, 'slx', 'cases.slx');
const SLX_R2013B = join(ARTIFACTS, 'slx_layouts', 'slxcases_R2013b.slx');
const SLX_REFS = join(FIXTURES, 'model_with_refs.slx');

/**
 * A real `.slx`, unzipped, edited and rezipped. `null` deletes a part; a string
 * replaces one. Everything else in the package is the fixture's own bytes, so a test
 * built this way asserts against a file that differs from a working one in exactly
 * the one way the test is about.
 */
function slxWith(file: string, edits: Record<string, string | Uint8Array | null>): ArrayBuffer {
  const entries = unzipSync(new Uint8Array(bytesAt(file)));
  for (const [path, body] of Object.entries(edits)) {
    expect(Object.keys(entries)).toContain(path); // the fixture really holds it
    if (body === null) {
      delete entries[path];
    } else {
      // A part's replacement may be BYTES (a MAT-file, an mxarray stream), so text is
      // encoded here and binary is passed through untouched.
      entries[path] = typeof body === 'string' ? strToU8(body) : body;
    }
  }
  const zipped = zipSync(entries);
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

// XML that fast-xml-parser THROWS on, as opposed to text it merely reads as nothing:
// `<a><b></a>` is tolerated, and plain text comes back as an empty document. Both
// losses are reported, and the two strings below are what tell them apart.
const XML_THAT_THROWS = '<Model type=BROKEN <<<';
const NOT_XML_AT_ALL = 'this part was overwritten by something that is not markup';

describe('parseSlx — the warnings channel', () => {
  it('reports nothing for a package it read completely', () => {
    expect(parseSlx(bytesAt(SLX_CASES), 'slxcases.slx').warnings).toEqual([]);
  });

  it('names the config set part it could not parse, and still reads the other one', () => {
    // The set's own part is unreadable while the index that names it is fine, so the
    // file itself says a second configuration set is here.
    const parsed = parseSlx(slxWith(SLX_CASES, { 'simulink/configSet1.json': '{ "unclosed": ' }), 'slxcases.slx');
    expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', 'simulink/configSet1.json']]);
    expect(parsed.warnings[0].message).toContain('simulink/configSet1.json');
    expect(parsed.configSets.map((c) => c.name)).toEqual(['Configuration']);
  });

  it('names a config set part the index promises and the package does not hold', () => {
    // Not a release limit: the index part in THIS file lists the part by name, so the
    // package is internally inconsistent and one configuration set is gone.
    const parsed = parseSlx(slxWith(SLX_CASES, { 'simulink/configSet0.json': null }), 'slxcases.slx');
    expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', 'simulink/configSet0.json']]);
    expect(parsed.warnings[0].message).toContain('Configuration');
    expect(parsed.configSets.map((c) => c.name)).toEqual(['Fast']);
  });

  it.each(['toString', 'constructor', 'hasOwnProperty', '__proto__'])(
    'names a config set part called %s that the package does not hold, as any other',
    (name) => {
      // The part name is the index's word, and the lookup asked the package's member
      // bag for it by plain indexing: an inherited member answered, the part "was there",
      // and the read failed on a function instead, under a reason that blamed the bytes.
      const index = JSON.stringify({
        ConfigSetInfo: [
          { Active: true, ConfigSetName: 'Configuration', PartName: `/${name}` },
          { ConfigSetName: 'Fast', PartName: '/simulink/configSet1.json' },
        ],
      });
      const parsed = parseSlx(slxWith(SLX_CASES, { 'simulink/configSetInfo.json': index }), 'slxcases.slx');
      expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', name]]);
      expect(parsed.warnings[0].message).toContain('which this package does not contain');
      expect(parsed.configSets.map((c) => c.name)).toEqual(['Fast']);
    },
  );

  it('reports an unreadable config set index once, not once per set it never saw', () => {
    const parsed = parseSlx(slxWith(SLX_CASES, { 'simulink/configSetInfo.json': '{{{' }), 'slxcases.slx');
    expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', 'simulink/configSetInfo.json']]);
    expect(parsed.configSets).toEqual([]);
  });

  it('reports the core properties part, and keeps reading the rest of the model', () => {
    const clean = parseSlx(bytesAt(SLX_MODERN), 'cases.slx');
    const parsed = parseSlx(slxWith(SLX_MODERN, { 'metadata/coreProperties.xml': XML_THAT_THROWS }), 'cases.slx');
    expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', 'metadata/coreProperties.xml']]);
    expect(parsed.release).toBe('');
    expect(parsed.creator).toBe('');
    // The rest of the package is untouched, so the parse is short, not failed: one
    // corrupt part used to throw out of parseSlx and take the other fifteen with it.
    // Compared against the clean parse rather than against a count, so this holds as
    // the fixture grows and still fails the moment a loss spreads past its own part.
    expect(parsed.uuid).not.toBe('');
    expect(parsed.uuid).toBe(clean.uuid);
    expect(parsed.blockParamUsages).toEqual(clean.blockParamUsages);
    expect(parsed.configSets.map((c) => c.name)).toEqual(clean.configSets.map((c) => c.name));
    expect(parsed.workspace.length).toBe(clean.workspace.length);
  });

  it('treats a part that contains no markup as unreadable, exactly as a throw', () => {
    // fast-xml-parser answers with an empty document for plain text, an empty part or
    // binary — the shape a truncated or mis-encoded write actually takes. Same loss as
    // a throw, so the same report; parseInfo in ProjectParser already draws this line.
    const parsed = parseSlx(slxWith(SLX_MODERN, { 'metadata/coreProperties.xml': NOT_XML_AT_ALL }), 'cases.slx');
    expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', 'metadata/coreProperties.xml']]);
  });

  it('names the block diagram part when the file cannot say what the model links to', () => {
    const parsed = parseSlx(slxWith(SLX_MODERN, { 'simulink/blockDiagram.json': '' }), 'cases.slx');
    expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', 'simulink/blockDiagram.json']]);
    expect(parsed.dataDictionary).toBeNull();
    expect(parsed.uuid).toBe('');
  });

  it('names the graphical interface part, whose loss hides every model reference', () => {
    const parsed = parseSlx(slxWith(SLX_REFS, { 'simulink/graphicalInterface.json': 'nope' }), 'model_with_refs.slx');
    expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', 'simulink/graphicalInterface.json']]);
    expect(parsed.modelReferences).toEqual([]);
  });

  it('names the external data source part', () => {
    const parsed = parseSlx(
      slxWith(SLX_REFS, { 'simulink/ExternalDataSourceSettings.xml': XML_THAT_THROWS }),
      'model_with_refs.slx',
    );
    expect(codesAndParts(parsed.warnings)).toEqual([
      ['part-unreadable', 'simulink/ExternalDataSourceSettings.xml'],
    ]);
  });

  it('names one unreadable system part and still reads the blocks of the others', () => {
    // From R2020a each system is its own part. One bad part is one subsystem's blocks,
    // not the model — so the reader carries on through the rest of the loop.
    const clean = parseSlx(bytesAt(SLX_CASES), 'slxcases.slx');
    const parsed = parseSlx(slxWith(SLX_CASES, { 'simulink/systems/system_7.xml': XML_THAT_THROWS }), 'slxcases.slx');
    expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', 'simulink/systems/system_7.xml']]);
    expect(parsed.blockParamUsages.length).toBeGreaterThan(0);
    expect(parsed.blockParamUsages.length).toBeLessThan(clean.blockParamUsages.length);
  });

  it('names the model workspace part when its mxarray stream cannot be read', () => {
    const parsed = parseSlx(slxWith(SLX_MODERN, { 'simulink/modelWorkspace.mxarray': 'not an mxarray' }), 'cases.slx');
    expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', 'simulink/modelWorkspace.mxarray']]);
    expect(parsed.workspace.length).toBe(0);
  });

  it('stays silent for a model workspace that is well-formed and simply empty', () => {
    // The near-miss the test above sits next to: an mxarray whose outer struct has no
    // fields is a model workspace with no variables in it, which is a legal thing for
    // a model to hold. Only a stream that is not mxarray framing at all is a loss.
    // A 1x1 struct whose field-name length is zero: no fields, nothing lost.
    const emptyStream = new Uint8Array(
      mxArrayFile(matrixBody([arrayFlags(CLASS.STRUCT), dims([1, 1]), varName(''), element(MI.INT32, u32le(0))])),
    );
    const parsed = parseSlx(slxWith(SLX_MODERN, { 'simulink/modelWorkspace.mxarray': emptyStream }), 'cases.slx');
    expect(parsed.warnings).toEqual([]);
    expect(parsed.workspace.length).toBe(0);
  });

  it('forwards a warning from the MAT-file the workspace part is, under that part path', () => {
    // Before R2019b the workspace part is a whole MAT-file, read by parseMat. Its
    // warnings are about variables INSIDE that part, so they are re-pointed at the
    // part they came from: a warning has to locate itself in the file the caller
    // opened, and a bare variable name does not.
    const inner = new Uint8Array(matFile([objectVar('legacyObj', [1, 1])]));
    const parsed = parseSlx(slxWith(SLX_R2013B, { 'simulink/modelworkspace.mat': inner }), 'slxcases_R2013b.slx');
    expect(codesAndParts(parsed.warnings)).toEqual([
      ['part-unreadable', 'simulink/modelworkspace.mat#legacyObj'],
    ]);
  });

  it('names the workspace MAT part when parseMat rejects it outright', () => {
    const parsed = parseSlx(
      slxWith(SLX_R2013B, { 'simulink/modelworkspace.mat': 'far too short to be a MAT-file' }),
      'slxcases_R2013b.slx',
    );
    expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', 'simulink/modelworkspace.mat']]);
    expect(parsed.workspace.length).toBe(0);
    // Everything the legacy block diagram carries is still there.
    expect(parsed.blockParamUsages.length).toBeGreaterThan(0);
  });

  it('names the legacy block diagram part, whose loss is most of a pre-R2020a model', () => {
    const parsed = parseSlx(slxWith(SLX_R2013B, { 'simulink/blockdiagram.xml': XML_THAT_THROWS }), 'slxcases.slx');
    expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', 'simulink/blockdiagram.xml']]);
    expect(parsed.blockParamUsages).toEqual([]);
    expect(parsed.configSets).toEqual([]);
  });

  it('stays silent about every part a release simply never wrote', () => {
    // The near-miss this whole item turns on, asserted rather than assumed. An R2013b
    // package has no configSetInfo part, no graphicalInterface part, no
    // ExternalDataSourceSettings part, no systems/ parts and no blockDiagram.json —
    // and it is a complete file that MATLAB wrote. A reader that reported "part
    // missing" for each absence would put five warnings on it.
    const parsed = parseSlx(bytesAt(SLX_R2013B), 'slxcases_R2013b.slx');
    expect(parsed.warnings).toEqual([]);
    expect(parsed.uuid).toBe(''); // no ModelUUID before R2020a: a limit, not a loss
    expect(parsed.dataDictionary).toBeNull();
  });

  it('stays silent for a package holding only the four parts it needs', () => {
    // The other shape of the same near-miss: a hand-built .slx with four parts and no
    // config sets, workspace or systems parts at all.
    expect(parseSlx(bytesAt(SLX_REFS), 'model_with_refs.slx').warnings).toEqual([]);
  });

  it('keeps a warning JSON-safe, because it crosses a worker boundary', () => {
    const parsed = parseSlx(slxWith(SLX_CASES, { 'simulink/configSet1.json': '{{{' }), 'slxcases.slx');
    const round = JSON.parse(JSON.stringify(parsed.warnings)) as ParseWarning[];
    expect(round).toEqual(parsed.warnings);
    expect(typeof round[0].message).toBe('string');
    expect(() => structuredClone(parsed.warnings)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// .mdl — both framings
// ---------------------------------------------------------------------------

const MDL_MODERN = join(ARTIFACTS, 'mdl', 'mdlcases.mdl');
const MDL_CLASSIC = join(ARTIFACTS, 'mdl', 'mdlcases_R2017b.mdl');

// A `.mdl` is text, and these fixtures are ASCII, so latin1 round-trips byte for byte
// — which is what lets a test edit one as a string without rewriting the parts it is
// not about. (MdlParser sniffs `SavedCharacterEncoding` and would honour a real one.)
const latin1Text = (file: string) => new TextDecoder('latin1').decode(new Uint8Array(bytesAt(file)));

function latin1Bytes(text: string): ArrayBuffer {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    out[i] = text.charCodeAt(i) & 0xff;
  }
  return out.buffer;
}

/** One part of a modern (OPC text) `.mdl`, replaced in place. */
function mdlWithPart(part: string, body: string): ArrayBuffer {
  const text = latin1Text(MDL_MODERN);
  const header = `\n__MWOPC_PART_BEGIN__ /${part}\n`;
  const at = text.indexOf(header);
  expect(at).toBeGreaterThan(0); // the fixture really holds this part
  const start = at + header.length;
  const nextPart = text.indexOf('\n__MWOPC_PART_BEGIN__', start);
  const packageEnd = text.indexOf('\n__MWOPC_PACKAGE_END__', start);
  const stop = nextPart < 0 ? packageEnd : packageEnd < 0 ? nextPart : Math.min(nextPart, packageEnd);
  expect(stop).toBeGreaterThan(start);
  return latin1Bytes(text.slice(0, start) + body + text.slice(stop));
}

const classicMdl = (mutate: (text: string) => string) => latin1Bytes(mutate(latin1Text(MDL_CLASSIC)));

/** The MatData record's `Data` value, replaced (quotes included in `value`). */
function withDataValue(text: string, value: string): string {
  const at = /\n\s*Data\s+"/.exec(text);
  expect(at).not.toBeNull();
  const end = text.indexOf('\n  }', at!.index);
  expect(end).toBeGreaterThan(at!.index);
  return text.slice(0, at!.index) + '\n    Data\t\t    ' + value + text.slice(end);
}

describe('parseMdl — the warnings channel', () => {
  it('reports nothing for either framing, read completely', () => {
    expect(parseMdl(bytesAt(MDL_MODERN), 'mdlcases.mdl').warnings).toEqual([]);
    expect(parseMdl(bytesAt(MDL_CLASSIC), 'mdlcases_R2017b.mdl').warnings).toEqual([]);
  });

  it('carries a part warning out of the shared reader, for a modern text package', () => {
    // The modern `.mdl` is the `.slx` part set in text framing and hands straight to
    // parseModelParts, so every part warning above applies here too. This is the test
    // that the channel is not dropped on the way back through the framing decoder.
    const parsed = parseMdl(mdlWithPart('simulink/configSet1.json', '{ "unclosed": '), 'mdlcases.mdl');
    expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', 'simulink/configSet1.json']]);
    expect(parsed.configSets.length).toBe(1);
  });

  it('reports a text package that holds no readable part, rather than opening as its stub', () => {
    // The sharpest silent partial in this file. A modern `.mdl` opens with a legacy
    // `Model { Version ... }` stub for tools that cannot read the package, so a file
    // truncated inside its first part header still parses — as a model with no blocks,
    // no references and no workspace. Nothing about that result said so.
    const text = latin1Text(MDL_MODERN);
    const at = text.indexOf('__MWOPC_PART_BEGIN__');
    const truncated = latin1Bytes(text.slice(0, at + '__MWOPC_PART_BEGIN__ /[Content'.length));
    const parsed = parseMdl(truncated, 'mdlcases.mdl');
    expect(codesAndParts(parsed.warnings)).toEqual([['source-unreadable', undefined]]);
    expect(parsed.warnings[0].message).toContain('mdlcases.mdl');
    // The behaviour the existing suite pins is unchanged: the stub still opens.
    expect(parsed.zipEntries).toBeNull();
    expect(parsed.blockParamUsages).toEqual([]);
  });

  it('names the workspace record a classic model claims and the file does not hold', () => {
    // `Model { WSMdlFileData "DataTag0" }` is the model NAMING the record that holds
    // its workspace. A file with no MatData section at all has lost it.
    const parsed = parseMdl(
      classicMdl((t) => t.slice(0, t.indexOf('\nMatData {'))),
      'mdlcases_R2017b.mdl',
    );
    expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', 'DataTag0']]);
    expect(parsed.workspace.length).toBe(0);
    // Everything else the brace tree carries is still read.
    expect(parsed.blockParamUsages.length).toBeGreaterThan(0);
  });

  it('names the workspace record when no DataRecord carries that tag', () => {
    const parsed = parseMdl(
      classicMdl((t) => t.replace(/Tag(\s+)DataTag0/, 'Tag$1DataTagZ')),
      'mdlcases_R2017b.mdl',
    );
    expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', 'DataTag0']]);
    expect(parsed.workspace.length).toBe(0);
  });

  it('names the workspace record when it holds no data', () => {
    const parsed = parseMdl(
      classicMdl((t) => withDataValue(t, '""')),
      'mdlcases_R2017b.mdl',
    );
    expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', 'DataTag0']]);
  });

  it('names the workspace record when its uuencoded stream will not decode', () => {
    const parsed = parseMdl(
      classicMdl((t) => withDataValue(t, '"AAAA"')),
      'mdlcases_R2017b.mdl',
    );
    expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', 'DataTag0']]);
    expect(parsed.warnings[0].message).toContain('DataTag0');
    expect(parsed.workspace.length).toBe(0);
  });

  it('stays silent for a classic model that names no workspace record at all', () => {
    // The near-miss: a model whose workspace is empty writes no WSMdlFileData, so
    // there is nothing to have failed to read. test/mdlParser.test.ts already pins the
    // empty workspace this yields; what is asserted here is that it is not a warning.
    const parsed = parseMdl(
      classicMdl((t) => t.replace(/\n\s*WSMdlFileData\s+"DataTag0"/, '')),
      'mdlcases_R2017b.mdl',
    );
    expect(parsed.warnings).toEqual([]);
    expect(parsed.workspace.length).toBe(0);
  });

  it('stays silent about everything a classic .mdl cannot express', () => {
    // R2011b has no release string, no ModelUUID, and drops the dictionary link on
    // export. Three absences, all of them the file's own limit, none of them a warning.
    const parsed = parseMdl(bytesAt(join(ARTIFACTS, 'mdl', 'mdlcases_R2011b.mdl')), 'mdlcases_R2011b.mdl');
    expect(parsed.warnings).toEqual([]);
    expect(parsed.release).toBe('');
    expect(parsed.uuid).toBe('');
    expect(parsed.dataDictionary).toBeNull();
  });
});

// The Simulink text package `.mdl` (`__MWSL_PART_BEGIN__`), whose workspace part is JSON.
// Before it was read at all, every one of these opened as an empty model with NO warning:
// the framing went unrecognised and the grammar reader read the legacy stub.
const MDL_TEXT = join(ARTIFACTS, 'mdltext', 'mdltext.mdl');
const WS_PART = 'simulink/modelWorkspace.mxarray';

/** The body of one part of the text package fixture: where it starts, and where it stops. */
function mdlTextPartSpan(text: string, part: string): { start: number; stop: number } {
  const header = `\n__MWSL_PART_BEGIN__ /${part}\n`;
  const at = text.indexOf(header);
  expect(at).toBeGreaterThan(0); // the fixture really holds this part
  const start = at + header.length;
  const nextPart = text.indexOf('\n__MWSL_PART_BEGIN__', start);
  const packageEnd = text.indexOf('\n__MWSL_PACKAGE_END__', start);
  const stop = nextPart < 0 ? packageEnd : packageEnd < 0 ? nextPart : Math.min(nextPart, packageEnd);
  expect(stop).toBeGreaterThan(start);
  return { start, stop };
}

/** One part of the text package fixture, replaced in place. */
function mdlTextWithPart(part: string, body: string): ArrayBuffer {
  const text = latin1Text(MDL_TEXT);
  const { start, stop } = mdlTextPartSpan(text, part);
  return latin1Bytes(text.slice(0, start) + body + text.slice(stop));
}

/** The text package fixture, cut `into` bytes into one part's body: a file that just stops. */
function mdlTextCutInside(part: string, into: number): ArrayBuffer {
  const text = latin1Text(MDL_TEXT);
  const { start, stop } = mdlTextPartSpan(text, part);
  expect(start + into).toBeLessThan(stop);
  return latin1Bytes(text.slice(0, start + into));
}

describe('parseMdl — the warnings channel, for a Simulink text package', () => {
  it('reports nothing for the package read completely', () => {
    for (const name of ['mdltext.mdl', 'mdltext_empty.mdl', 'mdltext_mat.mdl']) {
      expect(parseMdl(bytesAt(join(ARTIFACTS, 'mdltext', name)), name).warnings, name).toEqual([]);
    }
  });

  it('names a workspace part whose JSON does not parse, and reads the rest of the model', () => {
    const parsed = parseMdl(mdlTextWithPart(WS_PART, '{"_array_type":"Struct","_elements":[{"a":'), 'mdltext.mdl');
    expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', WS_PART]]);
    expect(parsed.warnings[0].message).toContain('workspace variables were not read');
    expect(parsed.workspace.length).toBe(0);
    expect(parsed.blockParamUsages.length).toBeGreaterThan(0);
    expect(parsed.configSets.length).toBe(2);
  });

  it('names a workspace part that parses to something other than one struct of variables', () => {
    for (const body of ['[1, 2]', '{"_array_type":"Cell","_dimensions":[1, 1],"_elements":[1]}', '{"_array_type":"Struct","_elements":[]}']) {
      const parsed = parseMdl(mdlTextWithPart(WS_PART, body), 'mdltext.mdl');
      expect(codesAndParts(parsed.warnings), body).toEqual([['part-unreadable', WS_PART]]);
      expect(parsed.warnings[0].message).toContain('does not hold a decodable workspace');
      expect(parsed.workspace.length).toBe(0);
    }
  });

  it('stays silent for a workspace struct with no fields, which is an empty workspace', () => {
    const parsed = parseMdl(mdlTextWithPart(WS_PART, '{"_array_type":"Struct","_dimensions":[1, 1],"_elements":[{}]}'), 'mdltext.mdl');
    expect(parsed.warnings).toEqual([]);
    expect(parsed.workspace.length).toBe(0);
  });

  it('names the release part when it does not parse, and reads the rest', () => {
    const parsed = parseMdl(mdlTextWithPart('slcoreProperties.json', '{"MATLABRelease":'), 'mdltext.mdl');
    expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', 'slcoreProperties.json']]);
    expect(parsed.release).toBe('');
    expect(parsed.workspace.length).toBe(8);
  });

  it('carries a part warning out of the shared reader', () => {
    const parsed = parseMdl(mdlTextWithPart('simulink/configSet1.json', '{ "unclosed": '), 'mdltext.mdl');
    expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', 'simulink/configSet1.json']]);
    expect(parsed.configSets.map((c) => c.name)).toEqual(['Configuration']);
  });

  it('names the part a file stops inside, which its XML reader would read short in silence', () => {
    // The last part is the root system, and a cut XML document still parses — as a system
    // with fewer blocks. Only the missing end marker says the file is short.
    const text = latin1Text(MDL_TEXT);
    const { start, stop } = mdlTextPartSpan(text, 'simulink/systems/system_root.xml');
    const parsed = parseMdl(mdlTextCutInside('simulink/systems/system_root.xml', Math.floor((stop - start) / 2)), 'mdltext.mdl');
    expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', 'simulink/systems/system_root.xml']]);
    expect(parsed.warnings[0].message).toContain("before the package's end marker");
  });

  it('reports a part a file stops inside once, not again as a part that does not parse', () => {
    // A cut JSON part fails its reader too. Same loss, so one warning: the framing's, which
    // says what happened. Every part after the cut is gone with no warning of its own, as
    // the message says.
    const parsed = parseMdl(mdlTextCutInside(WS_PART, 40), 'mdltext.mdl');
    expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', WS_PART]]);
    expect(parsed.warnings[0].message).toContain('any part after it is missing');
    expect(parsed.workspace.length).toBe(0);
    expect(parsed.configSets.length).toBe(2);
  });

  it('reports a package that holds no readable part, rather than opening as its stub', () => {
    const text = latin1Text(MDL_TEXT);
    const at = text.indexOf('__MWSL_PART_BEGIN__');
    for (const cut of [at, at + '__MWSL_PART_BEGIN__ /slcore'.length]) {
      const parsed = parseMdl(latin1Bytes(text.slice(0, cut)), 'mdltext.mdl');
      expect(codesAndParts(parsed.warnings)).toEqual([['source-unreadable', undefined]]);
      expect(parsed.warnings[0].message).toContain('a Simulink text package');
      expect(parsed.zipEntries).toBeNull();
    }
  });

  it('reports a file whose banner says it is a package and whose package marker is gone', () => {
    // Cut after the legacy stub: all the grammar reader finds is `Model { Version 27.1 }`.
    const text = latin1Text(MDL_TEXT);
    const parsed = parseMdl(latin1Bytes(text.slice(0, text.indexOf('__MWSL_PACKAGE_BEGIN__'))), 'mdltext.mdl');
    expect(codesAndParts(parsed.warnings)).toEqual([['source-unreadable', undefined]]);
    expect(parsed.blockParamUsages).toEqual([]);
  });

  it('reports a package none of whose parts is one a model is read from', () => {
    // Every part arrives, under a name this reader does not read: what a later release
    // renaming its parts would look like. The framing is whole, so nothing else says so.
    const text = latin1Text(MDL_TEXT).replace(/\n__MWSL_PART_BEGIN__ \//g, '\n__MWSL_PART_BEGIN__ /renamed/');
    const parsed = parseMdl(latin1Bytes(text), 'mdltext.mdl');
    expect(codesAndParts(parsed.warnings)).toEqual([['source-empty', undefined]]);
    expect(parsed.warnings[0].message).toContain('mdltext.mdl');
    expect(Object.keys(parsed.zipEntries!).length).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------------------
// A model whose part is missing: that part's section, present and empty
// ---------------------------------------------------------------------------

// The maintainer's ruling of 2026-10-16 on C-223 and C-232: "show empty section if the
// part is missing". A model opens with the same five sections whatever its package
// holds. A section whose part is absent is there and empty, the file is not refused, and
// the absence adds no warning: these cases sit with the silent ones above.
const MODEL_SECTIONS = ['blocks', 'workspace', 'config', 'references', 'dataSources'];

interface OpenedModel {
  format: string;
  sections: [string, number][];
  warnings: ParseWarning[];
}

/** A model opened the way a host opens one: its format, each section with its entry count, its warnings. */
function openedModel(buffer: ArrayBuffer, name: string): OpenedModel {
  const source = createSession().addModelSource(name, buffer) as unknown as {
    sourceFormat: string;
    children: { name: string; children: unknown[] }[];
    warnings?: ParseWarning[];
  };
  return {
    format: source.sourceFormat,
    sections: source.children.map((s): [string, number] => [s.name, s.children.length]),
    warnings: source.warnings ?? [],
  };
}

function zipOf(entries: Record<string, Uint8Array>): ArrayBuffer {
  const zipped = zipSync(entries);
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

describe('a .slx zip holding no Simulink parts opens with every section present and empty', () => {
  const allEmpty = MODEL_SECTIONS.map((s): [string, number] => [s, 0]);
  const packages: [string, Record<string, Uint8Array>][] = [
    // Only its end-of-central-directory record, since there is no entry to begin with.
    ['a zip with no entries at all', {}],
    ['a zip holding one file that is not a model part', { 'notes.txt': strToU8('hello') }],
    ['a zip holding only an empty folder', { 'simulink/': new Uint8Array(0) }],
    [
      'an OPC package holding only its own index',
      { '[Content_Types].xml': strToU8('<Types/>'), '_rels/.rels': strToU8('<Relationships/>') },
    ],
    [
      'a binary dictionary renamed to .slx',
      { 'metadata/coreProperties.xml': strToU8('<x/>'), 'data/chunk0.xml': strToU8('<DataSource/>') },
    ],
  ];

  for (const [what, entries] of packages) {
    it(`${what}: no refusal and no warning`, () => {
      const zip = zipOf(entries);
      expect(openedModel(zip, 'x.slx')).toEqual({ format: 'slx', sections: allEmpty, warnings: [] });
      expect(parseModel(zip, 'x.slx').warnings).toEqual([]);
      // The structure scan dispatches on the same sniff, so it opens whatever parseModel opens.
      expect(scanModelStructure(zip, 'x.slx')).toEqual({
        dataDictionary: null,
        modelReferences: [],
        externalDataSources: [],
      });
    });
  }

  it('reads a zip with no entries as a package whichever extension it carries', () => {
    // The bytes decide, as for every other model: an empty zip named `.mdl` is the
    // package form of `.mdl`, not classic text, and opens the same way.
    expect(openedModel(zipOf({}), 'x.mdl')).toEqual({ format: 'mdl-package', sections: allEmpty, warnings: [] });
  });
});

describe('only a whole end record counting no entries is read as an empty .slx zip', () => {
  // A zip with no entries is its 22-byte end-of-central-directory record, then the
  // archive comment if it has one. The record's signature alone is not one: both zip
  // readers find a signature at offset 0 and read whatever follows as its counts and
  // offsets, so bytes that merely began PK\x05\x06 opened as an empty model. They were
  // refused before, as not a model, and are again.
  const allEmpty = MODEL_SECTIONS.map((s): [string, number] => [s, 0]);
  const notAModel = /Not a Simulink model/;

  /** An empty zip with an archive comment, which fflate's writer has no option for. */
  function emptyZipWithComment(comment: string): ArrayBuffer {
    const record = new Uint8Array(zipOf({}));
    const text = strToU8(comment);
    const out = new Uint8Array(record.length + text.length);
    out.set(record);
    out.set(text, record.length);
    new DataView(out.buffer).setUint16(20, text.length, true); // the comment's length
    return out.buffer;
  }

  /** Seeded, so a failure names the same bytes every run. */
  function garbageAfterSignature(length: number, seed: number): Uint8Array {
    const out = new Uint8Array(length);
    let state = seed;
    for (let i = 0; i < length; i++) {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      out[i] = state >>> 24;
    }
    out.set([0x50, 0x4b, 0x05, 0x06]);
    return out;
  }

  const genuine: [string, () => ArrayBuffer][] = [
    ['the 22-byte record alone', () => zipOf({})],
    ['the record and an archive comment', () => emptyZipWithComment('an archive comment')],
  ];
  for (const [what, build] of genuine) {
    it(`an empty zip, ${what}: opens with every section empty and no warning`, () => {
      const zip = build();
      expect(zip.byteLength).toBe(what.includes('comment') ? 22 + 'an archive comment'.length : 22);
      expect(openedModel(zip, 'x.slx')).toEqual({ format: 'slx', sections: allEmpty, warnings: [] });
      expect(parseModel(zip, 'x.slx').warnings).toEqual([]);
      expect(scanModelStructure(zip, 'x.slx')).toEqual({
        dataDictionary: null,
        modelReferences: [],
        externalDataSources: [],
      });
    });
  }

  const record = (counts: [number, number]): Uint8Array => {
    const out = new Uint8Array(zipOf({}));
    new DataView(out.buffer).setUint16(8, counts[0], true);
    new DataView(out.buffer).setUint16(10, counts[1], true);
    return out;
  };
  const notEmpty: [string, Uint8Array][] = [
    ...[22, 23, 100, 4096, 30 * 1024].map((n, i): [string, Uint8Array] => [
      `${n} bytes of garbage after the signature`,
      garbageAfterSignature(n, 7 + i),
    ]),
    ['an end record counting one entry, without the entry', record([1, 1])],
    ['an end record counting one entry in all and none on this disk', record([0, 1])],
    ['an end record counting none in all and one on this disk', record([1, 0])],
    ['an empty zip cut to 21 bytes', new Uint8Array(zipOf({})).slice(0, 21)],
  ];
  for (const [what, bytes] of notEmpty) {
    it(`${what}: refused as not a model`, () => {
      const counts = bytes.length >= 12 ? [bytes[8] | (bytes[9] << 8), bytes[10] | (bytes[11] << 8)] : [];
      expect(bytes.length < 22 || counts.some((c) => c !== 0)).toBe(true); // the case is what it says
      const buffer = bytes.slice().buffer;
      expect(() => parseModel(buffer, 'x.slx')).toThrow(notAModel);
      expect(() => openedModel(buffer, 'x.slx')).toThrow(notAModel);
      expect(() => scanModelStructure(buffer, 'x.slx')).toThrow(notAModel);
    });
  }
});

/** The modern `.mdl` with one part taken out, its header and its body. */
function mdlWithoutPart(part: string): ArrayBuffer {
  const text = latin1Text(MDL_MODERN);
  // A binary part's header line goes on to name its encoding (` BASE64`), so the
  // header is the part name followed by either separator.
  const at = [' ', '\n']
    .map((separator) => text.indexOf(`\n__MWOPC_PART_BEGIN__ /${part}${separator}`))
    .reduce((found, i) => (found < 0 ? i : found));
  expect(at).toBeGreaterThan(0); // the fixture really holds this part
  const nextPart = text.indexOf('\n__MWOPC_PART_BEGIN__', at + 1);
  const packageEnd = text.indexOf('\n__MWOPC_PACKAGE_END__', at + 1);
  const stop = nextPart < 0 ? packageEnd : packageEnd < 0 ? nextPart : Math.min(nextPart, packageEnd);
  expect(stop).toBeGreaterThan(at);
  return latin1Bytes(text.slice(0, at) + text.slice(stop));
}

/** The first line of the classic fixture's workspace record, quotes included: what a cut after it leaves. */
function firstRecordLine(text: string): string {
  const line = /\n\s*Data\s+("[^\n]*")\n/.exec(text.slice(text.indexOf('\nMatData {')));
  expect(line).not.toBeNull();
  return line![1];
}

describe('a model whose model-workspace part is missing or unreadable opens with that section empty', () => {
  // Measured against the same file intact, so the one difference asserted is the
  // workspace: every other section keeps its entries, and the format is unchanged.
  function expectWorkspaceEmptied(
    opened: OpenedModel,
    intact: OpenedModel,
    warnings: ReturnType<typeof codesAndParts>,
  ): void {
    const held = intact.sections.find(([s]) => s === 'workspace');
    expect(held && held[1]).toBeGreaterThan(0); // the intact file has a workspace to lose
    expect({ ...opened, warnings: codesAndParts(opened.warnings) }).toEqual({
      format: intact.format,
      sections: intact.sections.map(([s, n]): [string, number] => [s, s === 'workspace' ? 0 : n]),
      warnings,
    });
  }

  const slxModern = () => openedModel(bytesAt(SLX_MODERN), 'cases.slx');
  const slxLegacy = () => openedModel(bytesAt(SLX_R2013B), 'slxcases_R2013b.slx');
  const mdlModern = () => openedModel(bytesAt(MDL_MODERN), 'mdlcases.mdl');
  const mdlClassic = () => openedModel(bytesAt(MDL_CLASSIC), 'mdlcases_R2017b.mdl');

  describe('missing: the section is empty and nothing warns', () => {
    it('a .slx with no simulink/modelWorkspace.mxarray part', () => {
      const opened = openedModel(slxWith(SLX_MODERN, { 'simulink/modelWorkspace.mxarray': null }), 'cases.slx');
      expectWorkspaceEmptied(opened, slxModern(), []);
    });

    it('a .slx from before R2019b with no simulink/modelworkspace.mat part', () => {
      const opened = openedModel(
        slxWith(SLX_R2013B, { 'simulink/modelworkspace.mat': null }),
        'slxcases_R2013b.slx',
      );
      expectWorkspaceEmptied(opened, slxLegacy(), []);
    });

    it('a modern .mdl with no simulink/modelWorkspace.mxarray part', () => {
      const opened = openedModel(mdlWithoutPart('simulink/modelWorkspace.mxarray'), 'mdlcases.mdl');
      expectWorkspaceEmptied(opened, mdlModern(), []);
    });

    it('a classic .mdl whose model names no workspace record', () => {
      const opened = openedModel(
        classicMdl((t) => t.replace(/\n[ \t]*WSMdlFileData[^\n]*/, '')),
        'mdlcases_R2017b.mdl',
      );
      expectWorkspaceEmptied(opened, mdlClassic(), []);
    });
  });

  describe('unreadable: the section is empty, and the model is not refused', () => {
    // The warnings these name are the ones the cases above, in "the warnings channel",
    // already pin for the same parts. The ruling adds none, so none is added here.
    it('a .slx whose mxarray part is not an mxarray', () => {
      const opened = openedModel(
        slxWith(SLX_MODERN, { 'simulink/modelWorkspace.mxarray': 'not an mxarray' }),
        'cases.slx',
      );
      expectWorkspaceEmptied(opened, slxModern(), [['part-unreadable', 'simulink/modelWorkspace.mxarray']]);
    });

    it('a .slx whose mxarray part is a struct array declaring two elements and holding neither', () => {
      // A field of a struct ARRAY is the list of its elements read, and here that list
      // is empty. It used to refuse the whole model, from parseMxArray naming a
      // variable that was not there.
      const fieldName = new Uint8Array(32);
      fieldName.set(strToU8('k'));
      const stream = new Uint8Array(
        mxArrayFile(
          matrixBody([
            arrayFlags(CLASS.STRUCT),
            dims([1, 2]),
            varName(''),
            element(MI.INT32, u32le(32)),
            element(MI.INT8, fieldName),
          ]),
        ),
      );
      const opened = openedModel(slxWith(SLX_MODERN, { 'simulink/modelWorkspace.mxarray': stream }), 'cases.slx');
      expectWorkspaceEmptied(opened, slxModern(), []);
    });

    it('a .slx from before R2019b whose workspace MAT part is not a MAT-file', () => {
      const opened = openedModel(
        slxWith(SLX_R2013B, { 'simulink/modelworkspace.mat': 'far too short to be a MAT-file' }),
        'slxcases_R2013b.slx',
      );
      expectWorkspaceEmptied(opened, slxLegacy(), [['part-unreadable', 'simulink/modelworkspace.mat']]);
    });

    it('a classic .mdl whose workspace record does not decode', () => {
      const opened = openedModel(
        classicMdl((t) => withDataValue(t, '"not really encoded"')),
        'mdlcases_R2017b.mdl',
      );
      expectWorkspaceEmptied(opened, mdlClassic(), [['part-unreadable', 'DataTag0']]);
    });

    it('a classic .mdl whose workspace record is cut short after its first line', () => {
      // The fixture's own record, ending inside its struct's field-name table: the
      // `Name` of the Name/Value pairs survives and `Value` does not. That used to
      // refuse the whole model, from the same parseMxArray as the struct array above.
      const opened = openedModel(
        classicMdl((t) => withDataValue(t, firstRecordLine(t))),
        'mdlcases_R2017b.mdl',
      );
      expectWorkspaceEmptied(opened, mdlClassic(), []);
    });
  });
});

describe('a .slx whose workspace part is cut short inside a complex variable opens as one cut inside a real variable does', () => {
  // A cut that lands after a complex variable's array flags and before its real part
  // leaves the variable complex with no value, and that used to refuse the whole model
  // with "Cannot read properties of null (reading 're')". The ruling of 2026-10-16 on
  // C-232: an unreadable workspace part shows what could be read, with no refusal and
  // no warning. What a variable cut at that point shows is already decided, by the real
  // variable cut at the same point: the same bytes with the complex flag cleared. So
  // each cut is measured against that sibling, not against a value chosen here.
  const PART = 'simulink/modelWorkspace.mxarray';
  const COMPLEX_WS = join(FIXTURES, 'mcos', 'complex_ws.slx');
  const SPARSE_WS = join(FIXTURES, 'sparse', 'sparse_ws.slx');

  interface Row {
    name: string;
    className: string;
    displayValue: string;
    valueEditable: boolean;
    children: Row[];
  }
  function rowOf(node: Row): Row {
    const { name, className, displayValue, valueEditable } = node;
    return { name, className, displayValue, valueEditable, children: node.children.map(rowOf) };
  }
  function opened(file: string, part: Uint8Array) {
    const source = createSession().addModelSource(basename(file), slxWith(file, { [PART]: part })) as unknown as {
      children: { name: string; children: Row[] }[];
      warnings?: ParseWarning[];
    };
    return {
      sections: source.children.map((s): [string, number] => [s.name, s.children.length]),
      workspace: source.children.find((s) => s.name === 'workspace')!.children.map(rowOf),
      warnings: source.warnings ?? [],
    };
  }

  // [fixture, variable, what it is]
  const variables: [string, string, string][] = [
    [COMPLEX_WS, 'z', 'a complex scalar, 3+4i'],
    [SLX_MODERN, 'cplxScalar', 'a complex scalar'],
    [SLX_MODERN, 'cplxVec', 'a complex 1x2 row'],
    [SPARSE_WS, 'dComplex', 'a complex 3x4 matrix'],
  ];

  for (const [file, name, what] of variables) {
    it(`${basename(file)}: ${what} (${name}), cut at every length between its flags and its real part`, () => {
      const part = unzipSync(new Uint8Array(bytesAt(file)))[PART];
      // The lengths at which the stream ends with this variable read as complex and
      // holding no value: past the byte of its array flags that says complex, short of
      // its real part's tag.
      const window: number[] = [];
      for (let length = 0; length < part.length; length++) {
        const variable = parseMxArray(part.slice(0, length).buffer).find((v) => v.name === name);
        if (variable && variable.isComplex && variable.value === null) {
          window.push(length);
        } else if (window.length > 0) {
          break;
        }
      }
      // The rest of the flags (6 bytes), the dimensions (8 + 8), the empty name (8), and
      // the cut at the real part's tag itself.
      expect(window.length).toBe(31);
      expect(window[window.length - 1] - window[0]).toBe(30);
      const flagsAt = window[0] - 1;
      expect(part[flagsAt] & 0x08).toBe(0x08); // mxCOMPLEX, in the byte the window begins after
      const real = part.slice();
      real[flagsAt] &= ~0x08;

      const intact = opened(file, part);
      for (const length of window) {
        const cut = opened(file, part.slice(0, length));
        expect(cut).toEqual(opened(file, real.slice(0, length)));
        expect(cut.warnings).toEqual([]);
        // What was read before the cut is listed, this variable included; what the cut
        // took is not; and nothing outside the workspace changes.
        const names = cut.workspace.map((v) => v.name);
        expect(names).toContain(name);
        expect(intact.workspace.map((v) => v.name)).toEqual(expect.arrayContaining(names));
        expect(cut.sections.filter(([s]) => s !== 'workspace')).toEqual(
          intact.sections.filter(([s]) => s !== 'workspace'),
        );
      }
    });
  }
});

// ---------------------------------------------------------------------------
// An index part in a shape MATLAB never writes: read what it states, never refuse
// ---------------------------------------------------------------------------

// The maintainer's ruling of 2026-10-16 on C-255 (recommendation (c)). MATLAB writes
// `ConfigSetInfo` and `ModelReferences` as arrays: every one of the 68 `.slx` holding a
// configSetInfo.json in this repo and the corpus does, and a `ModelReferences` that is
// there at all (46 files) is one too. A hand-edited or third-party package is the only
// source of another shape. Most of them threw out of parseSlx: a lone object is not
// iterable and has no `.map`, and a non-string `PartName` has no `.replace`. Nothing
// caught it, so the whole model failed to open. The rest (null, false, 0, an empty
// string, the key left out) were read silently as an index listing nothing. Now a lone
// object is read as a one-entry list, any other non-array loses the index with a
// warning, and an entry that cannot name what it lists is skipped with a warning while
// its neighbours are still read.
describe('an index part that is not a list is read for what it states, and the model still opens', () => {
  const CS_INFO = 'simulink/configSetInfo.json';
  const GI = 'simulink/graphicalInterface.json';
  const FAST = { ConfigSetName: 'Fast', PartName: '/simulink/configSet1.json' };
  const PLANT = { BlockPath: 'ctrl/plant', ModelName: 'plant.slx' };
  const casesWithIndex = (index: unknown) =>
    parseSlx(slxWith(SLX_CASES, { [CS_INFO]: JSON.stringify(index) }), 'slxcases.slx');
  const refsWithIndex = (index: unknown) =>
    parseSlx(slxWith(SLX_REFS, { [GI]: JSON.stringify(index) }), 'model_with_refs.slx');

  describe('configSetInfo.json', () => {
    it('reads a ConfigSetInfo that is one object, not a list, as one configuration set', () => {
      const clean = parseSlx(bytesAt(SLX_CASES), 'slxcases.slx');
      const parsed = casesWithIndex({
        ConfigSetInfo: { Active: true, ConfigSetName: 'Configuration', PartName: '/simulink/configSet0.json' },
      });
      expect(parsed.warnings).toEqual([]);
      // The same set, read from the same part, as the intact index's first entry gives.
      expect(parsed.configSets).toEqual([clean.configSets[0]]);
      expect(parsed.configSets[0]).toMatchObject({ name: 'Configuration', active: true });
    });

    it.each(['"x"', '""', '5', '0', 'true', 'false', 'null'])(
      'reports a ConfigSetInfo of %s once, reads no sets, and reads the rest of the model',
      (value) => {
        const clean = parseSlx(bytesAt(SLX_CASES), 'slxcases.slx');
        const parsed = parseSlx(slxWith(SLX_CASES, { [CS_INFO]: `{ "ConfigSetInfo": ${value} }` }), 'slxcases.slx');
        expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', CS_INFO]]);
        expect(parsed.warnings[0].message).toContain('no configuration sets were read');
        expect(parsed.configSets).toEqual([]);
        expect(parsed.uuid).not.toBe('');
        expect(parsed.uuid).toBe(clean.uuid);
        expect(parsed.blockParamUsages).toEqual(clean.blockParamUsages);
        expect(parsed.modelReferences).toEqual(clean.modelReferences);
      },
    );

    it('reports an index that lists no ConfigSetInfo at all, once', () => {
      // The part parsed and holds something, so it is not the empty-part case readPart
      // reports; it simply does not say which sets there are, and every model has one.
      const parsed = casesWithIndex({ Version: '1.0' });
      expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', CS_INFO]]);
      expect(parsed.warnings[0].message).toContain('no configuration sets were read');
      expect(parsed.configSets).toEqual([]);
    });

    it.each<[string, unknown]>([
      ['a PartName that is a number', { Active: true, ConfigSetName: 'Configuration', PartName: 7 }],
      ['no PartName', { Active: true, ConfigSetName: 'Configuration' }],
      ['a ConfigSetName that is a number', { Active: true, ConfigSetName: 7, PartName: '/simulink/configSet0.json' }],
      ['no ConfigSetName', { Active: true, PartName: '/simulink/configSet0.json' }],
      ['null', null],
      ['a string', '/simulink/configSet0.json'],
      ['a list', [{ ConfigSetName: 'Configuration', PartName: '/simulink/configSet0.json' }]],
    ])('skips an entry that is %s with a warning, and still reads the set after it', (_what, entry) => {
      const parsed = casesWithIndex({ ConfigSetInfo: [entry, FAST] });
      expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', CS_INFO]]);
      expect(parsed.warnings[0].message).toContain('was not read');
      expect(parsed.configSets.map((c) => c.name)).toEqual(['Fast']);
    });

    it('applies the same rule to a .mdl package, which reads the same parts', () => {
      // MdlParser decodes the text framing and hands the parts to the same reader.
      const index = JSON.stringify({
        ConfigSetInfo: { Active: true, ConfigSetName: 'Configuration', PartName: '/simulink/configSet0.json' },
      });
      const parsed = parseMdl(mdlWithPart(CS_INFO, index), 'mdlcases.mdl');
      expect(parsed.warnings).toEqual([]);
      expect(parsed.configSets.map((c) => c.name)).toEqual(['Configuration']);
    });

    it('opens a .slx whose ConfigSetInfo is one object, with that one set in its config section', () => {
      // The user-visible half: the open used to fail outright, every section with it.
      const intact = openedModel(bytesAt(SLX_CASES), 'slxcases.slx');
      const lone = JSON.stringify({
        ConfigSetInfo: { Active: true, ConfigSetName: 'Configuration', PartName: '/simulink/configSet0.json' },
      });
      const opened = openedModel(slxWith(SLX_CASES, { [CS_INFO]: lone }), 'slxcases.slx');
      expect(intact.sections).toContainEqual(['config', 2]);
      expect(opened).toEqual({
        format: intact.format,
        sections: intact.sections.map(([s, n]): [string, number] => [s, s === 'config' ? 1 : n]),
        warnings: [],
      });
    });
  });

  describe('graphicalInterface.json', () => {
    it('reads a ModelReferences that is one object, not a list, as one model reference', () => {
      const parsed = refsWithIndex({ ModelReferences: PLANT });
      expect(parsed.warnings).toEqual([]);
      expect(parsed.modelReferences).toEqual([{ blockPath: 'ctrl/plant', modelName: 'plant.slx' }]);
    });

    it('reads a lone object inside the wrapped GraphicalInterface of R2024b-R2026a the same way', () => {
      const parsed = refsWithIndex({ GraphicalInterface: { ModelReferences: PLANT } });
      expect(parsed.warnings).toEqual([]);
      expect(parsed.modelReferences).toEqual([{ blockPath: 'ctrl/plant', modelName: 'plant.slx' }]);
    });

    it.each(['"x"', '""', '5', '0', 'true', 'false'])(
      'reports a ModelReferences of %s once, and reads no references',
      (value) => {
        const clean = parseSlx(bytesAt(SLX_REFS), 'model_with_refs.slx');
        const parsed = parseSlx(slxWith(SLX_REFS, { [GI]: `{ "ModelReferences": ${value} }` }), 'model_with_refs.slx');
        expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', GI]]);
        expect(parsed.warnings[0].message).toContain("this model's references to other models are missing");
        expect(parsed.modelReferences).toEqual([]);
        expect(parsed.dataDictionary).toBe(clean.dataDictionary);
        expect(parsed.externalDataSources).toEqual(clean.externalDataSources);
      },
    );

    it.each<[string, Record<string, unknown>]>([
      ['absent', { SolverName: 'VariableStepAuto' }],
      ['null', { ModelReferences: null }],
      ['an empty list', { ModelReferences: [] }],
    ])('stays silent for a ModelReferences that is %s: a model that references none', (_what, index) => {
      // The normal case, not a loss: 78 of the 124 graphicalInterface.json parts in the
      // repo and the corpus hold no ModelReferences at all, and 4 hold an empty list.
      const parsed = refsWithIndex(index);
      expect(parsed.warnings).toEqual([]);
      expect(parsed.modelReferences).toEqual([]);
    });

    it.each<[string, unknown]>([
      ['a BlockPath that is a number', { BlockPath: 3, ModelName: 'other.slx' }],
      ['no BlockPath', { ModelName: 'other.slx' }],
      ['a ModelName that is a number', { BlockPath: 'ctrl/other', ModelName: 3 }],
      ['no ModelName', { BlockPath: 'ctrl/other' }],
      ['null', null],
      ['a string', 'ctrl/other|other.slx'],
    ])('skips a reference that is %s with a warning, and still reads the one after it', (_what, entry) => {
      const parsed = refsWithIndex({ ModelReferences: [entry, PLANT] });
      expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', GI]]);
      expect(parsed.warnings[0].message).toContain('was not read');
      expect(parsed.modelReferences).toEqual([{ blockPath: 'ctrl/plant', modelName: 'plant.slx' }]);
    });

    it('opens a .slx whose ModelReferences is one object, with that reference in its references section', () => {
      const intact = openedModel(bytesAt(SLX_REFS), 'model_with_refs.slx');
      const opened = openedModel(
        slxWith(SLX_REFS, { [GI]: JSON.stringify({ ModelReferences: PLANT }) }),
        'model_with_refs.slx',
      );
      expect(intact.sections).toContainEqual(['references', 1]);
      expect(opened).toEqual({ ...intact, warnings: [] });
    });

    it('opens a .slx one of whose references names no model, listing the reference that does', () => {
      // The reference with no ModelName used to reach the references section, whose
      // file-kind check threw on it, so the whole open failed.
      const intact = openedModel(bytesAt(SLX_REFS), 'model_with_refs.slx');
      const index = JSON.stringify({ ModelReferences: [{ BlockPath: 'ctrl/other' }, PLANT] });
      const opened = openedModel(slxWith(SLX_REFS, { [GI]: index }), 'model_with_refs.slx');
      expect({ ...opened, warnings: codesAndParts(opened.warnings) }).toEqual({
        ...intact,
        warnings: [['part-unreadable', GI]],
      });
    });
  });
});

// ---------------------------------------------------------------------------
// .mat — the Level-5 MAT-file
// ---------------------------------------------------------------------------

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * One miCOMPRESSED record. Deliberately NOT padded to an 8-byte boundary: this is the
 * one element MATLAB writes unpadded, which is why parseMat's record walk advances by
 * the declared length alone. `element()` pads, so it cannot be used here.
 */
function compressedRecord(payload: Uint8Array): Uint8Array {
  const data = zlibSync(payload);
  return concat([u32le(MI.COMPRESSED), u32le(data.length), data]);
}

/** A miCOMPRESSED record whose payload is not zlib at all. */
function corruptCompressedRecord(): Uint8Array {
  const junk = new Uint8Array([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]);
  return concat([u32le(MI.COMPRESSED), u32le(junk.length), junk]);
}

const scalar = (name: string, value: number) =>
  numericVar({ name, cls: CLASS.DOUBLE, dimensions: [1, 1], real: [value] });

const names = (warnings: ParseWarning[]) => warnings.map((w) => w.part);

// A zip member whose bytes inflate to more than its directory entry declares is unreadable,
// and the inflate seam leaves it out (test/inflateSeam.test.ts). It used to come back cut
// to the declared size, so it read as a shorter, wrong part, with nothing to say so: a model
// opened with wrong workspace values, and a dictionary with whatever the cut left of its
// chunk. Now each reader that unzips a package says which member it could not read, and
// reads the rest as it would have.
describe('a zip member that inflates past its declared size is named unreadable, never read cut short', () => {
  const reasonFor = (declared: number) => `more than the ${declared} bytes its directory entry declares`;

  /**
   * A real package, rezipped with `part` deflated and every other member stored, and `part`'s
   * declared uncompressed size rewritten to `declared` in its directory entry and local
   * header. Deflated because a stored member's size IS its bytes: only an inflate can run
   * past what the directory declares.
   */
  function overDeclared(entries: Record<string, Uint8Array>, part: string, declared: number): ArrayBuffer {
    expect(Object.keys(entries)).toContain(part); // the package really holds it
    expect(entries[part].byteLength).toBeGreaterThan(declared); // and the size is a lie
    const zipped = zipSync(
      Object.fromEntries(Object.entries(entries).map(([k, b]) => [k, [b, { level: k === part ? 6 : 0 }]])),
    );
    const v = new DataView(zipped.buffer, zipped.byteOffset, zipped.byteLength);
    const named = (at: number, length: number) => new TextDecoder().decode(zipped.subarray(at, at + length));
    let patched = 0;
    for (let i = 0; i + 4 <= zipped.byteLength; i++) {
      const sig = v.getUint32(i, true);
      if (sig === 0x02014b50 && named(i + 46, v.getUint16(i + 28, true)) === part) {
        v.setUint32(i + 24, declared, true);
        patched++;
      } else if (sig === 0x04034b50 && named(i + 30, v.getUint16(i + 26, true)) === part) {
        v.setUint32(i + 22, declared, true);
        patched++;
      }
    }
    expect(patched).toBe(2);
    return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
  }

  const unzipped = (file: string) => unzipSync(new Uint8Array(bytesAt(file)));

  // Each engine reaches the member by its own route (see test/inflateSeam.test.ts); a host
  // has one or the other, and both are held to the rule.
  const ENGINES = [
    ['node:zlib', undefined],
    ['fflate', null],
  ] as Array<[string, null | undefined]>;
  afterEach(() => setNativeInflate(undefined));

  const COMPLEX_WS = join(FIXTURES, 'mcos', 'complex_ws.slx');
  const WORKSPACE_PART = 'simulink/modelWorkspace.mxarray';

  it.each(ENGINES)('a .slx whose workspace part runs past its size opens with that section empty and the part named (%s)', (_l, engine) => {
    setNativeInflate(engine);
    // complex_ws.slx's workspace part inflates to 7,936 bytes; cut to the 3,000 declared, it
    // used to open with seven variables, five of them showing `[ ]` where the file holds
    // `11-12i`, `[1+2i 3-4i 5+6i]` and the like, and no warning.
    const opened = openedModel(overDeclared(unzipped(COMPLEX_WS), WORKSPACE_PART, 3_000), 'complex_ws.slx');
    const intact = openedModel(bytesAt(COMPLEX_WS), 'complex_ws.slx');
    const held = intact.sections.find(([s]) => s === 'workspace');
    expect(held && held[1]).toBeGreaterThan(0); // the intact file has a workspace to lose
    expect({ ...opened, warnings: codesAndParts(opened.warnings) }).toEqual({
      format: intact.format,
      sections: intact.sections.map(([s, n]): [string, number] => [s, s === 'workspace' ? 0 : n]),
      warnings: [['part-unreadable', WORKSPACE_PART]],
    });
    expect(opened.warnings[0].message).toContain(reasonFor(3_000));
  });

  it.each(ENGINES)('a binary .sldd whose data chunk runs past its size opens empty, saying so, rather than throwing (%s)', (_l, engine) => {
    setNativeInflate(engine);
    const entries = unzipped(SLDD_BIN);
    const declared = Math.floor(entries[CHUNK_PART].byteLength / 2);
    const bytes = overDeclared(entries, CHUNK_PART, declared);
    const warnings: ParseWarning[] = [];
    const content = parseBinarySldd(bytes, warnings);
    // An unreadable chunk is not a MISSING one: "Missing data/chunk0.xml" is for a package
    // that does not hold it at all, and a package that does is a dictionary that read short.
    expect(codesAndParts(warnings)).toEqual([['source-unreadable', undefined]]);
    expect(warnings[0].message).toContain(CHUNK_PART);
    expect(warnings[0].message).toContain(reasonFor(declared));
    expect(entriesOf(content)).toEqual([]);
    // Short, not failed: the metadata members are read as before.
    expect(content.__MW_TEXT_COREPROPERTIES__).toEqual({ release: 'R2027a' });
    // And the same through a session, as a host opens one.
    const source = ingest(createSession(), bytes, { filename: 'params.sldd' }) as unknown as {
      warnings?: ParseWarning[];
      flatten(): unknown[];
    };
    expect(codesAndParts(source.warnings ?? [])).toEqual([['source-unreadable', undefined]]);
  });

  it.each(ENGINES)('a binary .sldd whose metadata member runs past its size reads every entry and names the member (%s)', (_l, engine) => {
    setNativeInflate(engine);
    const META = 'metadata/mwcoreProperties.xml';
    const entries = unzipped(SLDD_BIN);
    const declared = Math.floor(entries[META].byteLength / 2);
    const warnings: ParseWarning[] = [];
    const content = parseBinarySldd(overDeclared(entries, META, declared), warnings);
    expect(codesAndParts(warnings)).toEqual([['part-unreadable', META]]);
    expect(warnings[0].message).toContain(reasonFor(declared));
    expect(entriesOf(content)).toEqual(entriesOf(parseBinarySldd(bytesAt(SLDD_BIN))));
    expect(Object.keys(content.__zipMetadata as object)).not.toContain(META);
  });

  it.each(ENGINES)('scanSldd reads a dictionary whose data chunk runs past its size as the empty one it opens as (%s)', (_l, engine) => {
    setNativeInflate(engine);
    const entries = unzipped(SLDD_BIN);
    const declared = Math.floor(entries[CHUNK_PART].byteLength / 2);
    const warnings: ParseWarning[] = [];
    const scanned = scanSldd(overDeclared(entries, CHUNK_PART, declared), warnings);
    expect(scanned.names).toEqual([]);
    expect(codesAndParts(warnings)).toEqual([['source-unreadable', undefined]]);
  });

  it.each(ENGINES)('a .prj whose store document runs past its size opens and names the document (%s)', (_l, engine) => {
    setNativeInflate(engine);
    const info = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
    const DOC = 'resources/project/FILESHASH/AAAp.xml';
    const store: Record<string, Uint8Array> = {
      'resources/project/root/FILESHASHp.xml': strToU8(info('<Info location="Root" type="Files"/>')),
      [DOC]: strToU8(info(`<Info location="helper.m" type="File"/>${' '.repeat(400)}`)),
      'resources/project/FILESHASH/AAAd.xml': strToU8(info('<Info/>')),
    };
    const source = ingest(createSession(), overDeclared(store, DOC, 60), { filename: 'Proj.prj' }) as unknown as {
      warnings?: ParseWarning[];
    };
    expect(codesAndParts(source.warnings ?? [])).toEqual([['part-unreadable', DOC]]);
    expect(source.warnings?.[0].message).toContain(reasonFor(60));
  });
});

describe('parseMat — the warnings channel', () => {
  it('reports nothing for a file it read completely', () => {
    const parsed = parseMat(matFile([scalar('a', 1), charVar('s', 'hello', MI.UINT8), cellVar('c', [scalar('', 2)])]));
    expect(parsed.warnings).toEqual([]);
    expect(parsed.variables.map((v) => v.name)).toEqual(['a', 's', 'c']);
  });

  it('turns a variable it deliberately did not decode into one warning, naming it', () => {
    // MatParser.ts already records the intent this closes: "when parseMat gains
    // warnings (docs/TODO.md item 3), each of these becomes one part-unreadable with
    // part set to the variable name and this text as the message". The `undecoded`
    // string stays where it is — a caller holding one variable can still tell what it
    // is holding without consulting a file-level list.
    //
    // A double declaring 2000x2000 with one element's bytes: past the size the reader
    // builds on a declared count its bytes cannot back. A sparse array of the same size is
    // no such variable — what it holds is its non-zeros, which it reads — and says nothing.
    // (With every column start in its jc, as MATLAB writes one: a shorter jc is a damaged
    // dims word, which is reported — test/sparseDamaged.test.ts.)
    const parsed = parseMat(
      matFile([
        numericVar({ name: 'big', cls: CLASS.DOUBLE, dimensions: [2000, 2000], real: [1] }),
        sparseVar({ name: 'sp', dimensions: [2000, 2000], ir: [0], jc: [0, ...new Array(2000).fill(1)], real: [1] }),
      ]),
    );
    expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', 'big']]);
    expect(parsed.warnings[0].message).toContain('declares 4000000 elements');
    expect(parsed.variables[0].undecoded).toContain('declares 4000000 elements');
    expect(parsed.variables[0].value).toBe('<2000x2000 double, not decoded>');
    expect([parsed.variables[1].undecoded, parsed.variables[1].value]).toEqual([undefined, '<2000x2000 sparse double>']);
  });

  it('names the pre-MCOS object it records without decoding', () => {
    const parsed = parseMat(matFile([objectVar('legacy', [1, 1])]));
    expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', 'legacy']]);
    expect(parsed.warnings[0].message).toContain('pre-MCOS');
  });

  it('names an undecoded value inside a struct the way MATLAB names it', () => {
    // The loss is a field, not a variable, so `part` has to say which field — a
    // file-level warning reading "big" for a variable called "s" would send a host
    // looking for a variable that is not there.
    const parsed = parseMat(
      matFile([structVar('s', ['inner'], [{ inner: objectVar('inner', [1, 1]) }])]),
    );
    expect(names(parsed.warnings)).toEqual(['s.inner']);
  });

  it('names an undecoded value inside a struct array by element', () => {
    const parsed = parseMat(
      matFile([
        structVar(
          's',
          ['inner'],
          [{ inner: scalar('inner', 1) }, { inner: objectVar('inner', [1, 1]) }],
          [1, 2],
        ),
      ]),
    );
    expect(names(parsed.warnings)).toEqual(['s(2).inner']);
  });

  it('names an undecoded value inside a cell by index, 1-based as MATLAB counts', () => {
    const parsed = parseMat(matFile([cellVar('c', [scalar('', 1), objectVar('', [1, 1])])]));
    expect(names(parsed.warnings)).toEqual(['c{2}']);
  });

  it('reports a struct array whose bytes hold fewer elements than it declares, once, as it reports a short cell', () => {
    // MATLAB writes every field of every element, so a struct array holding fewer elements
    // than it declares is the file contradicting itself, as a cell holding fewer cells is.
    // It said nothing, and a host showed a row for each declared element, the ones past the
    // bytes empty; it shows the elements held now, and this says why there are no more.
    const short = (name: string, d: number[], held: number, fields = ['a']) =>
      structVar(name, fields, Array.from({ length: held }, () => Object.fromEntries(fields.map((f) => [f, scalar('', 1)]))), d);
    const said = (path: string, declared: number, read: number) => ({
      code: 'part-unreadable',
      message: `"${path}" declares ${declared} element(s) and only ${read} could be read.`,
      part: path,
    });
    expect(parseMat(matFile([short('s', [1, 3], 2)])).warnings).toEqual([said('s', 3, 2)]);
    // Counted in whole elements: a 1x3 whose third element lost its second field, beside the
    // warning of the record that lost it.
    const m = short('m', [1, 3], 3, ['a', 'b']);
    expect(parseMat(matFile([m.slice(0, m.length - 64)])).warnings.slice(1)).toEqual([said('m', 3, 2)]);
    // One that names its fields and holds none of its elements.
    expect(parseMat(matFile([short('s', [2, 5], 0, ['a', 'b'])])).warnings).toEqual([said('s', 10, 0)]);
    // Named the way MATLAB names it: in a struct, an element of a struct array, and a cell.
    const parsed = parseMat(
      matFile([
        structVar('t', ['f'], [{ f: short('', [1, 4], 1) }]),
        structVar('u', ['f'], [{ f: short('', [1, 2], 2) }, { f: short('', [1, 9], 3) }], [1, 2]),
        cellVar('c', [scalar('', 1), short('', [3, 1], 1)]),
      ]),
    );
    expect(parsed.warnings).toEqual([said('t.f', 4, 1), said('u(2).f', 9, 3), said('c{2}', 3, 1)]);
    // Silent for one holding every element it declares, a 1x1, an empty one and one with no
    // fields, which MATLAB writes with a stride of 1 and no names.
    const stride = new Uint8Array([1, 0, 0, 0]);
    const fieldless = matrix([arrayFlags(CLASS.STRUCT), dims([1, 5]), varName('n'), element(MI.INT32, stride), element(MI.INT8, new Uint8Array(0))]);
    expect(parseMat(matFile([short('w', [2, 3], 6), short('o', [1, 1], 1), short('e', [0, 0], 0), fieldless])).warnings).toEqual([]);
  });

  it('names a variable whose array class this reader does not model', () => {
    // Class 16 is a function handle. The variable IS in the file and comes back with a
    // null value, which is indistinguishable from an empty one — the exact confusion
    // this channel exists to remove. Not a limit of the file: a limit of this reader,
    // which is the caller's business either way.
    const parsed = parseMat(
      matFile([matrix([arrayFlags(16), dims([1, 1]), varName('fh'), element(MI.UINT8, new Uint8Array(8))])]),
    );
    expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', 'fh']]);
    expect(parsed.warnings[0].message).toContain('array class');
    expect(parsed.variables[0].className).toBe('unknown');
  });

  it('reports a compressed record it cannot inflate, and reads the variables around it', () => {
    // No `part`: the variable's name lives INSIDE the compressed payload, so the file
    // cannot say what was lost. Claiming a name here would be inventing one.
    const parsed = parseMat(
      matFile([compressedRecord(scalar('before', 1)), corruptCompressedRecord(), compressedRecord(scalar('after', 2))]),
    );
    expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', undefined]]);
    expect(parsed.warnings[0].message).toContain('compressed');
    expect(parsed.variables.map((v) => v.name)).toEqual(['before', 'after']);
  });

  it('reports a compressed record that inflates to fewer bytes than a tag, and reads the variables after it', () => {
    // parseMat read the inflated payload's first 8 bytes as its matrix's tag without asking
    // whether there were 8, so a payload of 0 to 7 bytes threw a bare RangeError ("Offset is
    // outside the bounds of the DataView") out of parseMat, and the whole open failed with
    // the variables after it. No `part`, as for a record that will not inflate: the name is
    // inside the payload, and there is none.
    for (const length of [0, 4, 7]) {
      const parsed = parseMat(matFile([compressedRecord(new Uint8Array(length)), compressedRecord(scalar('after', 2)), scalar('last', 3)]));
      expect([length, parsed.variables.map((v) => [v.name, v.value])]).toEqual([length, [['after', 2], ['last', 3]]]);
      expect(parsed.warnings, `${length}`).toEqual([
        {
          code: 'part-unreadable',
          message: `A compressed record at byte 128 inflates to ${length} bytes, fewer than the 8 of a data element's tag, `
            + 'so the variable it holds was not read.',
        },
      ]);
    }
    // Through a session, as a host opens the file.
    const mat = createSession().addMatSource('z.mat', matFile([compressedRecord(new Uint8Array(4)), scalar('after', 2)])) as any;
    expect(mat.children.map((c: any) => [c.name, c.displayValue])).toEqual([['after', '2']]);
  });

  it('reports a record that declares more bytes than the file holds', () => {
    // Every byte count in a MAT-file is self-declared and this reader clamps them, so
    // the variable still opens — short. Clamping is what keeps one bad length from
    // failing the whole open; saying so is what keeps the short read from looking whole.
    const variable = numericVar({ name: 'x', cls: CLASS.DOUBLE, dimensions: [1, 4], real: [1, 2, 3, 4] });
    new DataView(variable.buffer, variable.byteOffset, variable.byteLength).setUint32(4, 0xffff, true);
    const parsed = parseMat(matFile([variable]));
    expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', 'x']]);
    expect(parsed.warnings[0].message).toContain('65535');
    expect(parsed.variables.map((v) => v.name)).toEqual(['x']);
  });

  it('reports a compressed record whose variable declares more bytes than its payload holds', () => {
    // The same short read one level in: the matrix's own tag inside the payload claims the
    // bytes, and the record around it is whole, so the record's warning above cannot fire.
    // The variable opened short and nothing said so.
    const variable = numericVar({ name: 'x', cls: CLASS.DOUBLE, dimensions: [1, 4], real: [1, 2, 3, 4] });
    new DataView(variable.buffer, variable.byteOffset, variable.byteLength).setUint32(4, 0xffff, true);
    const parsed = parseMat(matFile([compressedRecord(variable), compressedRecord(scalar('after', 2))]));
    expect(parsed.warnings).toEqual([
      {
        code: 'part-unreadable',
        message: `A compressed record at byte 128 holds a variable that declares 65535 bytes, and its payload holds only ${variable.length - 8}, so it was read short.`,
        part: 'x',
      },
    ]);
    expect(parsed.variables.map((v) => [v.name, v.value])).toEqual([['x', [1, 2, 3, 4]], ['after', 2]]);
    // A struct array cut short that way, its elements past the payload's end: the record's
    // warning, and the array's own, that it holds fewer elements than it declares, the two a
    // cell cut short that way has.
    const s = structVar('s', ['a'], [{ a: scalar('', 1) }, { a: scalar('', 2) }, { a: scalar('', 3) }], [1, 3]);
    const short = s.slice(0, s.length - 64);
    const struct = parseMat(matFile([compressedRecord(short)]));
    expect(codesAndParts(struct.warnings)).toEqual([['part-unreadable', 's'], ['part-unreadable', 's']]);
    expect(struct.warnings[1].message).toBe('"s" declares 3 element(s) and only 2 could be read.');
    expect((struct.variables[0].fields!.a as unknown[]).length).toBe(2);
    // A payload whose variable claims what it holds says nothing.
    expect(parseMat(matFile([compressedRecord(s)])).warnings).toEqual([]);
  });

  it('reports a top-level element that is not a variable at all', () => {
    // Only miCOMPRESSED and miMATRIX carry variables; anything else at this level was
    // dropped on the floor, one variable's worth of file at a time.
    const parsed = parseMat(matFile([scalar('a', 1), element(MI.DOUBLE, new Uint8Array(8))]));
    expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', undefined]]);
    expect(parsed.warnings[0].message).toContain('9');
    expect(parsed.variables.map((v) => v.name)).toEqual(['a']);
  });

  it('reports bytes after the last variable that are too few to be a record', () => {
    const parsed = parseMat(matFile([scalar('a', 1)], { trailing: new Uint8Array([1, 2, 3]) }));
    expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', undefined]]);
    expect(parsed.variables.map((v) => v.name)).toEqual(['a']);
  });

  it('stays silent for the end-of-variables terminator, and for an empty file', () => {
    // A zero tag is the format's own end marker, not a truncation — and a `.mat` saved
    // with no variables in it is a file MATLAB writes and this reader reads correctly.
    const terminated = parseMat(matFile([scalar('a', 1)], { trailing: new Uint8Array(8) }));
    expect(terminated.warnings).toEqual([]);
    expect(terminated.variables.map((v) => v.name)).toEqual(['a']);
    expect(parseMat(matFile([])).warnings).toEqual([]);
  });

  it('stays silent for the unnamed element every MCOS file carries', () => {
    // Every real `.mat` in this corpus holds one: the MCOS FileWrapper, a top-level
    // matrix with no name. It is read and kept (`_anonymous`), not lost, so a reader
    // that warned "a variable has no name" would put a warning on every object file
    // in existence.
    const parsed = parseMat(matFile([scalar('', 1)]));
    expect(parsed.warnings).toEqual([]);
    expect(parsed.variables[0]._anonymous).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// .sldd — the dictionary, in both of its flavours
// ---------------------------------------------------------------------------
//
// The dictionary reader is the one with no parse-result object to hang a `warnings`
// field on: `parseBinarySldd` returns the dictionary CONTENT itself, and the textual
// flavour has no parser at all — its JSON goes straight into `SlddNode.parse`. So both
// layers take an optional sink the caller owns, and every test below owns the array it
// passes. `parseBinarySldd(buf)` with no sink still answers exactly what it always did,
// which is the property that made the sink the right shape (see the header of
// BinarySlddParser.ts for the decision).

const SLDD_BIN = join(ARTIFACTS, 'binary', 'params.sldd');
const SLDD_TEXT = join(ARTIFACTS, 'text', 'params.sldd');
const SLDD_ARCH = join(FIXTURES, 'arch.sldd');
const CHUNK_PART = 'data/chunk0.xml';

const DECL = '<?xml version="1.0" encoding="UTF-8"?>';

/** A `data/chunk0.xml` document holding `body` inside its `<DataSource>`. */
const chunk = (body: string) =>
  `${DECL}\n<DataSource FormatVersion="1" MinRelease="R2014a" Arch="maca64">\n${body}\n</DataSource>`;

const ENTRY =
  '    <Object Class="DD.ENTRY">\n'
  + '        <P Name="Name" Class="char">aParam</P>\n'
  + '        <P Name="Value" Class="double">42</P>\n'
  + '    </Object>';

const DICTIONARY_OBJECT =
  '    <Object Class="DD.Dictionary">\n'
  + '        <P Name="AccessBaseWorkspace" Class="logical">0</P>\n'
  + '    </Object>';

/** The `<DataSource>` of one parsed chunk, as the entry list the content carries. */
function entriesOf(content: Record<string, unknown>): Record<string, unknown>[] {
  const parts = content.__MW_TEXT_PARTS__ as Record<string, Record<string, unknown>>;
  const inner = parts['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content as Record<string, unknown>;
  return inner.entries as Record<string, unknown>[];
}

function referencesOf(content: Record<string, unknown>): unknown[] {
  const parts = content.__MW_TEXT_PARTS__ as Record<string, Record<string, unknown>>;
  const inner = parts['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content as Record<string, unknown>;
  return inner['Dictionary References'] as unknown[];
}

/** One chunk document, read with a sink of its own. */
function readChunk(xml: string, meta: Record<string, Uint8Array> = {}) {
  const warnings: ParseWarning[] = [];
  const content = parseBinarySlddParts(xml, meta, warnings);
  return { content, warnings };
}

/**
 * A real binary `.sldd`, unzipped, edited and rezipped — `slxWith` for a dictionary,
 * and for the same reason: the package under test then differs from a file MATLAB
 * really wrote in exactly the one way the test is about, and no broken binary has to be
 * checked in beside the good one.
 */
function slddWith(file: string, edits: Record<string, string | null>): ArrayBuffer {
  const entries = unzipSync(new Uint8Array(bytesAt(file)));
  for (const [path, body] of Object.entries(edits)) {
    if (body === null) {
      expect(Object.keys(entries)).toContain(path); // the fixture really holds it
      delete entries[path];
    } else {
      entries[path] = strToU8(body);
    }
  }
  const zipped = zipSync(entries);
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

describe('parseBinarySldd — the warnings channel', () => {
  it('reports nothing for a package it read completely', () => {
    const warnings: ParseWarning[] = [];
    parseBinarySldd(bytesAt(SLDD_BIN), warnings);
    expect(warnings).toEqual([]);
  });

  it('answers a caller that passes no sink exactly as it always did', () => {
    // The property that decided the API: the sink is additive, so the exported reader a
    // consumer already calls with one argument is unchanged — same return value, no
    // wrapper to unwrap, nothing to migrate. A `{ content, warnings }` result would have
    // been a breaking change to published surface for every one of those callers.
    expect(parseBinarySldd(bytesAt(SLDD_BIN))).toEqual(parseBinarySldd(bytesAt(SLDD_BIN), []));
  });

  it('reports a data chunk that holds no DataSource element at all', () => {
    // The sharpest silent partial in this reader. The part IS present, so the package
    // says it is a dictionary; its root is something else, so not one entry is read —
    // and the result was a well-formed dictionary with zero entries that reported
    // success, indistinguishable from a dictionary a user had just created.
    const { content, warnings } = readChunk(`${DECL}\n<NotADataSource><Object/></NotADataSource>`);
    expect(codesAndParts(warnings)).toEqual([['source-unreadable', undefined]]);
    expect(warnings[0].message).toContain(CHUNK_PART);
    expect(entriesOf(content)).toEqual([]);
  });

  it('treats a data chunk that is not markup at all the same way', () => {
    // fast-xml-parser answers with an empty document for plain text, an empty part or
    // binary — the shape a truncated or mis-encoded write takes. Same loss, same report;
    // this one used to reach `dataSource['@_FormatVersion']` on undefined and take the
    // open down with a TypeError naming nothing.
    expect(codesAndParts(readChunk('this part was overwritten by something that is not markup').warnings)).toEqual([
      ['source-unreadable', undefined],
    ]);
    expect(codesAndParts(readChunk('').warnings)).toEqual([['source-unreadable', undefined]]);
  });

  it('reports a data chunk the XML reader refuses outright, instead of throwing out of the open', () => {
    // The other half of the same loss. fast-xml-parser is lenient about most damage but
    // refuses a few malformations, and that throw used to escape `parseBinarySldd` and
    // take the whole open down naming no file at all — a host with four dictionaries open
    // could not tell which one it was. Now it is a short read like any other, and it is
    // reported ONCE: an empty document also has no <DataSource>, and the two checks would
    // otherwise report the same lost dictionary twice.
    const { content, warnings } = readChunk(`${DECL}\n<DataSource><![CDATA[truncated mid-section`);
    expect(codesAndParts(warnings)).toEqual([['source-unreadable', undefined]]);
    expect(warnings[0].message).toContain(CHUNK_PART);
    expect(warnings[0].message).toContain('CDATA');
    expect(entriesOf(content)).toEqual([]);
  });

  it('reports it through the whole package, and still reads the parts that are fine', () => {
    // Short, not failed: the release still comes off the metadata part, and the
    // pass-through bytes the save path needs are all still there. A reader that threw
    // here would leave a host with nothing to show for a file it can still describe.
    const warnings: ParseWarning[] = [];
    const content = parseBinarySldd(slddWith(SLDD_BIN, { [CHUNK_PART]: 'not markup' }), warnings);
    expect(codesAndParts(warnings)).toEqual([['source-unreadable', undefined]]);
    expect(content.__MW_TEXT_COREPROPERTIES__).toEqual({ release: 'R2027a' });
    expect(Object.keys(content.__zipMetadata as object)).toContain('metadata/mwcoreProperties.xml');
  });

  it('stays silent for a dictionary that is simply empty', () => {
    // The near-miss the two tests above sit next to, and the reason the line is drawn at
    // the ROOT ELEMENT rather than at the entry count: a dictionary a user just created
    // holds `<DataSource/>` and no entries, and it is a complete file. A reader that
    // warned "no entries" would put a warning on every empty dictionary in existence.
    expect(readChunk(`${DECL}\n<DataSource/>`).warnings).toEqual([]);
    expect(readChunk(chunk(DICTIONARY_OBJECT)).warnings).toEqual([]);
  });

  it('names a sub-dictionary reference the file records without a readable name', () => {
    // `<Object Class="DD.DICTIONARYREFERENCE">` IS the file saying another dictionary is
    // inherited from. With no readable Subdictionary the inheritance is unresolvable and
    // was dropped on the floor — every entry the referenced file contributes is missing
    // from what the user sees, with nothing to say so.
    const { content, warnings } = readChunk(
      chunk(
        '    <Object Class="DD.DICTIONARYREFERENCE">\n'
          + '        <P Name="Subdictionary" Class="char">base.sldd</P>\n'
          + '    </Object>\n'
          + '    <Object Class="DD.DICTIONARYREFERENCE">\n'
          + '        <P Name="Subdictionary" Class="char"></P>\n'
          + '    </Object>\n'
          + '    <Object Class="DD.DICTIONARYREFERENCE"/>\n'
          + ENTRY,
      ),
    );
    // One per unreadable reference, and no `part`: nothing in the bytes names the
    // reference that is missing, so claiming one would be inventing it.
    expect(codesAndParts(warnings)).toEqual([
      ['part-unreadable', undefined],
      ['part-unreadable', undefined],
    ]);
    // The readable reference and the entries around it are all still read.
    expect(referencesOf(content)).toEqual(['base.sldd']);
    expect(entriesOf(content).map((e) => e.name)).toEqual(['aParam']);
  });

  it('stays silent for a dictionary that references nothing', () => {
    // A dictionary with no DD.DICTIONARYREFERENCE object inherits from nothing. That is
    // most dictionaries, and every one written before R2015a — the limit of the file.
    const { content, warnings } = readChunk(chunk(`${ENTRY}\n${DICTIONARY_OBJECT}`));
    expect(warnings).toEqual([]);
    expect(referencesOf(content)).toEqual([]);
  });

  it('stays silent about the parts of the package it does not model', () => {
    // Deliberate, and the counterpart of the `.slx` reader's "a part a release never
    // wrote". A dictionary package carries `[Content_Types].xml`, `_rels/.rels` and four
    // metadata parts that this reader reads nothing out of but `matlabRelease`, and a
    // newer release may add more of them — including a second data chunk. None of that
    // is reported: every byte of every part other than `data/chunk0.xml` is kept in
    // `__zipMetadata` and written back verbatim on save, so nothing is LOST, and warning
    // per unmodelled part would put a count on every dictionary a newer release writes.
    const extra = {
      'data/chunk1.xml': strToU8(chunk(ENTRY)),
      'simulink/somethingR2030a.xml': strToU8('<New/>'),
      'metadata/mwcoreProperties.xml': strToU8('<mwcoreProperties/>'),
    };
    const { content, warnings } = readChunk(chunk(ENTRY), extra);
    expect(warnings).toEqual([]);
    // Read correctly means kept for the write path, which is what makes it no loss.
    expect(Object.keys(content.__zipMetadata as object).sort()).toEqual(Object.keys(extra).sort());
  });

  it('stays silent for an entry whose name or value the bytes never carried', () => {
    // The near-miss on the other side of the same line. An entry with no `<P Name="Name">`
    // and one with no `<P Name="Value">` are files short of what the format expects — but
    // the BYTES claim neither, so there is nothing that could not be read, and both
    // entries are in the result. (Nothing MATLAB writes looks like this; the reader's
    // defaults for it are pinned by test/binarySlddValues.test.ts.)
    const { content, warnings } = readChunk(
      chunk(
        '    <Object Class="DD.ENTRY">\n        <P Name="Value" Class="double">1</P>\n    </Object>\n'
          + '    <Object Class="DD.ENTRY">\n        <P Name="Name" Class="char">noValue</P>\n    </Object>',
      ),
    );
    expect(warnings).toEqual([]);
    expect(entriesOf(content).map((e) => e.name)).toEqual(['', 'noValue']);
  });

  it('stays silent for an entry whose raw XML fragment could not be paired with it', () => {
    // A truncated last `<Object>` leaves that entry with no fragment (the scan stops at
    // the unterminated tag), which test/binarySlddValues.test.ts already pins. It is not
    // a loss: the fragment is a splice optimization, and an entry without one is REBUILT
    // from the model on save. Nothing the user can see is missing.
    const { content, warnings } = readChunk(
      `${DECL}\n<DataSource>\n${ENTRY}\n    <Object Class="DD.ENTRY"><P Name="Name" Class="char">b</P>\n</DataSource>`,
    );
    expect(warnings).toEqual([]);
    expect(entriesOf(content).map((e) => e.rawXml)).toEqual([expect.stringContaining('aParam'), '']);
  });

  it('keeps a dictionary warning JSON-safe, because it crosses a worker boundary', () => {
    const warnings: ParseWarning[] = [];
    parseBinarySlddParts('not markup', {}, warnings);
    expect(JSON.parse(JSON.stringify(warnings))).toEqual(warnings);
    expect(() => structuredClone(warnings)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// SlddNode.parse — the node layer, which is the whole reader for a textual .sldd
// ---------------------------------------------------------------------------

const INTERFACE_PART = 'simulink/systemcomposer/interfaceDictionary';

const readJson = (abs: string) => JSON.parse(readFileSync(abs, 'utf8')) as Record<string, unknown>;

/** One content object, read into a tree with a sink of its own. */
function readContent(content: Record<string, unknown>, filename = 'd.sldd') {
  const warnings: ParseWarning[] = [];
  const node = SlddNode.parse(content, filename, warnings);
  return { node, warnings };
}

const entryNamesOf = (node: SlddNode) => node.children.flatMap((s) => s.children.map((c) => c.name));

/** The user-facing Kind of one entry, by name — what a missing catalog is felt as. */
function kindOf(node: SlddNode, name: string): string | undefined {
  const entry = node.children.flatMap((s) => s.children).find((c) => c.name === name);
  return (entry as unknown as { kind?: string } | undefined)?.kind;
}

describe('SlddNode.parse — the warnings channel', () => {
  it('reports nothing for either flavour of a dictionary it read completely', () => {
    expect(readContent(readJson(SLDD_TEXT), 'params.sldd').warnings).toEqual([]);
    expect(readContent(parseBinarySldd(bytesAt(SLDD_BIN)), 'params.sldd').warnings).toEqual([]);
  });

  it('reports content that holds no data chunk at all, naming the file', () => {
    // The textual `.sldd` has no parser between the bytes and here: `ingest` calls
    // JSON.parse, which succeeds for ANY JSON object, and hands the result straight over.
    // So a file that is valid JSON and not a dictionary opened as a dictionary with four
    // empty sections and reported success — the exact shape this item is about. The name
    // is in the message because this is the one warning about the SOURCE, and a host
    // showing it beside three other open files has to be able to say which one.
    const { node, warnings } = readContent({ hello: 'not a dictionary' }, 'notes.sldd');
    expect(codesAndParts(warnings)).toEqual([['source-empty', undefined]]);
    expect(warnings[0].message).toContain('notes.sldd');
    expect(entryNamesOf(node)).toEqual([]);
  });

  it('reports a parts bag with no data chunk in it, and a data chunk with no content', () => {
    // Three spellings of the same loss, because a partial write produces all three: no
    // parts bag, a bag naming other parts and not this one, and the part present with
    // nothing inside it.
    const orphan = { __MW_TEXT_PARTS__: { '__MW_TEXT_PART__/simulink/ArchitecturePart': { __MW_TEXT_content: {} } } };
    expect(codesAndParts(readContent(orphan).warnings)).toEqual([['source-empty', undefined]]);
    const hollow = { __MW_TEXT_PARTS__: { '__MW_TEXT_PART__/data/chunk0': {} } };
    expect(codesAndParts(readContent(hollow).warnings)).toEqual([['source-empty', undefined]]);
  });

  it('stays silent for a real dictionary that holds no entries', () => {
    // The near-miss beside it, and the reason the line is at the PART and not the entry
    // count: MATLAB writes this for a dictionary a user created and has not filled in,
    // and it is a complete file. The two are told apart by whether the content part is
    // there at all, which is exactly the distinction a partial write destroys.
    const empty = readJson(SLDD_TEXT);
    const parts = empty.__MW_TEXT_PARTS__ as Record<string, Record<string, Record<string, unknown>>>;
    parts['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries = [];
    const { node, warnings } = readContent(empty, 'brandnew.sldd');
    expect(warnings).toEqual([]);
    expect(entryNamesOf(node)).toEqual([]);
  });

  it('says nothing when the System Composer catalog part holds no definitions, and falls back the way MATLAB does', () => {
    // The part is PRESENT and empty here, which MATLAB writes into any dictionary System
    // Composer has merely touched: built-in value types, no definitions. This used to
    // raise `part-unreadable`, on the reasoning that the catalog is what tells a
    // StructType from a DataInterface (both are `Simulink.Bus`). Measured against MATLAB
    // R2027a, that is not a loss worth reporting — strip the part from a dictionary
    // holding both and MATLAB reports BOTH as a DataInterface, which is exactly this
    // fallback. A banner would claim a loss MATLAB itself does not see.
    const arch = readJson(SLDD_ARCH);
    const parts = arch.__MW_TEXT_PARTS__ as Record<string, unknown>;
    parts[`__MW_TEXT_PART__/${INTERFACE_PART}`] = { nothing: 'readable' };
    const { node, warnings } = readContent(arch, 'arch.sldd');
    expect(warnings).toEqual([]);
    expect(node.systemComposer).toBeNull();
    // Every entry is still read, and the ONE ambiguous class takes MATLAB's answer.
    expect(entryNamesOf(node).length).toBeGreaterThan(0);
    expect(kindOf(node, 'StructType')).toBe('Data Interface');
    expect(kindOf(node, 'DataInterface')).toBe('Data Interface');
    // Everything else is 1:1 with its Simulink class, so the catalog's absence costs it
    // nothing — the measurement that made the warning pointless rather than merely noisy.
    expect(kindOf(node, 'PhysicalInterface')).toBe('Physical Interface');
    expect(kindOf(node, 'ServiceInterface')).toBe('Service Interface');
    expect(kindOf(node, 'ValueType')).toBe('Value Type');
    expect(kindOf(node, 'NumericType')).toBe('Numeric Type');
    expect(kindOf(node, 'EnumType')).toBe('Enumerated Type');
    expect(kindOf(node, 'AliasType')).toBe('Alias Type');
  });

  it('classifies the same dictionary properly when the catalog IS there', () => {
    // The other side of the fallback above: with the part present the file is the
    // authority, and it is the only thing that can tell these two apart.
    const { node, warnings } = readContent(readJson(SLDD_ARCH), 'arch.sldd');
    expect(warnings).toEqual([]);
    expect(kindOf(node, 'StructType')).toBe('Struct Type');
    expect(kindOf(node, 'DataInterface')).toBe('Data Interface');
  });

  it('stays silent for a System Composer dictionary read whole, and for one with no catalog', () => {
    // Both near-misses at once. The real architectural fixture reports nothing and its
    // catalog is there; an ordinary design dictionary has no catalog part at all, which
    // is every `.sldd` that is not a System Composer interface dictionary.
    const arch = readContent(readJson(SLDD_ARCH), 'arch.sldd');
    expect(arch.warnings).toEqual([]);
    expect(arch.node.systemComposer).not.toBeNull();
    const plain = readContent(readJson(SLDD_TEXT), 'params.sldd');
    expect(plain.warnings).toEqual([]);
    expect(plain.node.systemComposer).toBeNull();
  });

  it('stays silent for an entry of a class it has no typed node for', () => {
    // The near-miss this item exists to adjudicate, decided against a warning. An entry
    // whose class no node models falls to ObjectNode — the structural catch-all, not the
    // CustomObjectNode this comment used to name, which is the registered `CustomObject`
    // class and is reached only by that literal name. The entry is THERE, with its
    // name, its metadata and its properties, typed generically. Nothing was lost, so
    // there is nothing to report — SectionNode.parseEntry is written to always return a
    // node for exactly this reason. A warning here would fire for every class a newer
    // release adds, which is the "count on every legacy file" failure in the other
    // direction: a count on every file from the FUTURE.
    const json = readJson(SLDD_TEXT);
    const first = entriesOf(json)[0];
    const value = first.value as Record<string, unknown>;
    expect(typeof value._array_class).toBe('string'); // the fixture really is a typed object
    value._array_class = 'Acme.SomeClassThisReaderHasNeverHeardOf';
    const { node, warnings } = readContent(json, 'params.sldd');
    expect(warnings).toEqual([]);
    expect(entryNamesOf(node)).toContain(first.name as string);
  });
});

// ---------------------------------------------------------------------------
// reasonOf — the cause every message above is built from
// ---------------------------------------------------------------------------
//
// Eight warning sites in this package quote `reasonOf(err)` inside their message, and
// every one of them is inside a `catch`, whose binding is `unknown` because a throw can
// carry anything. What comes back has to be a STRING, always: a warning is stored and
// handed across a worker boundary by structured clone or JSON, so an `Error` kept there
// arrives as `{}` (JSON) and an arbitrary object may not clone at all — which is why
// nothing here holds the Error itself. The tests above all throw real Errors; these two
// are the other arm, and the failure they guard against is a message that reads
// "the model part could not be read (undefined)".

describe('reasonOf — a cause that is not an Error', () => {
  it('reads the cause off an Error thrown in another realm, which instanceof cannot see', () => {
    // The case this arm actually exists for, and the reason it is not dead code. `instanceof`
    // compares against ONE realm's Error, so an error raised in a worker, a sandbox or a vm
    // context fails the test while carrying a perfectly good message — and hosts of this
    // package parse off-thread by design (see the header of ParseWarning.ts). Falling
    // through to String() is what keeps the cause readable there.
    const thrown = runInNewContext('new TypeError("the model part is not an mxarray")') as unknown;
    expect(thrown instanceof Error, 'a cross-realm Error is what this arm is for').toBe(false);
    // Error.prototype.toString, so the class name comes along with the message. More than
    // the message alone, and all that is available without the type.
    expect(reasonOf(thrown)).toContain('the model part is not an mxarray');
    expect(reasonOf(thrown)).toContain('TypeError');
  });

  it('reduces a thrown non-Error to text, so a warning stays a value', () => {
    // A host's `throw` need not be an Error at all, and reaching for `.message` on one of
    // these is what puts the word "undefined" into the sentence a user reads.
    expect(reasonOf('the sandbox refused to read the file')).toBe('the sandbox refused to read the file');
    expect(reasonOf(undefined)).toBe('undefined');
    expect(reasonOf(null)).toBe('null');
    // A thrown object keeps nothing but its shape. Asserted as "a string" rather than as
    // that exact text: the floor this guarantees is the type, and a reader that learned to
    // say more about an object would still be honouring it.
    expect(typeof reasonOf({ code: 'ENOENT' })).toBe('string');
    // What the type is for. A warning built from any of them is a plain value that
    // survives both crossings intact.
    const warning: ParseWarning = {
      code: 'source-unreadable',
      message: `cases.slx could not be opened and was skipped (${reasonOf('EBUSY')})`,
    };
    expect(warning.message).toContain('EBUSY');
    expect(() => structuredClone(warning)).not.toThrow();
    expect(JSON.parse(JSON.stringify(warning))).toEqual(warning);
  });
});
