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

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync, strToU8, zlibSync } from 'fflate';
import { parseSlx } from '../src/datamodel/parser/SlxParser.js';
import { parseMdl } from '../src/datamodel/parser/MdlParser.js';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import { parseBinarySldd, parseBinarySlddParts } from '../src/datamodel/parser/BinarySlddParser.js';
// Through the public entry point, which is what registers the node classes
// SlddNode.parse builds a tree out of. A deep import of SlddNode alone leaves
// NodeRegistry empty and parseEntry with nothing to route an entry to.
import { SlddNode } from '../src/index.js';
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

describe('the whole fixture corpus parses with no warnings at all', () => {
  it('reports nothing for any real .slx, .mdl or .mat in the repo', () => {
    // THE guard for this item. Every file swept here was written by MATLAB (or, for
    // the synthesized few, written to be a complete file), spanning R2011b to R2027a
    // and every part layout in between — so a warning from any of them is a reader
    // complaining about a limit of the file, which is the one failure mode that makes
    // the whole channel worthless. It is asserted over the enumerated corpus rather
    // than a hand-listed sample so that a new fixture is covered by default.
    const files = [...filesUnder(ARTIFACTS), ...filesUnder(FIXTURES)]
      .filter((f) => /\.(slx|mdl|mat)$/i.test(f))
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
    const parsed = parseMat(
      matFile([sparseVar({ name: 'big', dimensions: [2000, 2000], ir: [0], jc: [0, 1], real: [1] })]),
    );
    expect(codesAndParts(parsed.warnings)).toEqual([['part-unreadable', 'big']]);
    expect(parsed.warnings[0].message).toContain('larger than this reader materializes');
    expect(parsed.variables[0].undecoded).toContain('larger than this reader materializes');
    expect(parsed.variables[0].value).toBe('<2000x2000 sparse, not decoded>');
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

  it('names the System Composer catalog part when it holds nothing readable', () => {
    // An architectural dictionary's interface catalog is what tells a StructType from a
    // DataInterface (both are `Simulink.Bus`), so losing it silently downgrades every
    // architectural entry's Kind to its raw Simulink class — a wrong answer that looks
    // like a right one. The part is PRESENT here, which is the file claiming the catalog
    // is there.
    const arch = readJson(SLDD_ARCH);
    const parts = arch.__MW_TEXT_PARTS__ as Record<string, unknown>;
    parts[`__MW_TEXT_PART__/${INTERFACE_PART}`] = { nothing: 'readable' };
    const { node, warnings } = readContent(arch, 'arch.sldd');
    expect(codesAndParts(warnings)).toEqual([['part-unreadable', INTERFACE_PART]]);
    expect(node.systemComposer).toBeNull();
    // Every entry is still read: one part's loss is not the dictionary's.
    expect(entryNamesOf(node).length).toBeGreaterThan(0);
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
    // whose class no node models falls to CustomObjectNode: the entry is THERE, with its
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
