// Copyright 2026 The MathWorks, Inc.
//
// Shared fidelity round-trip harness for the MATLAB-parity test suite. Provides
// the edit -> serialize -> re-parse loop for BOTH sldd formats, plus an optional
// live MATLAB value-equality gate (skipped automatically when MATLAB isn't
// reachable, so the suite stays green in CI).
//
// Core-internal: this drives the data model directly (DataModel + parsers), with
// no presentation/host layer. Node lookup walks the parsed tree by name via
// flatten(), rather than going through a row builder.
//
// The MATLAB gate is the definitive proof that an edit produces data MATLAB
// agrees with: it writes the serialized dictionary to a temp file, opens it in
// MATLAB, reads the edited property back via the MATLAB API, and asserts the
// value AND type equal what we set. See verify_roundtrip.m.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import DataModel from '../../../src/core/DataModel.js';
import { parseBinarySldd } from '../../../src/datamodel/parser/BinarySlddParser.js';
import { serializeBinarySldd } from '../../../src/datamodel/parser/BinarySlddSerializer.js';
import '../../../src/datamodel/node/NodeClassMap.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
// MATLAB launcher, configured out-of-band so no environment-specific path is
// committed. Presence gates the live re-open assertions; when unset (CI /
// external contributors) the value-equality gate is skipped and only the
// in-process re-parse invariants run — so the suite stays green everywhere.
//   DEX_MATLAB_CMD : the matlab-launching executable + fixed args (e.g. "mw matlab")
//   DEX_MATLAB_CWD : optional working directory the launcher must run from
const MATLAB_LAUNCH = process.env.DEX_MATLAB_CMD || '';
const MATLAB_CWD = process.env.DEX_MATLAB_CWD || undefined;

export type SlddFormat = 'json' | 'binary';

/** True if `bytes` begins with the ZIP local-file-header magic (PK\x03\x04). */
function isZipBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

/** Add an .sldd source (text JSON or binary zip) to the DataModel, return its root node. */
function addSlddSource(uri: string, name: string, bytes: Uint8Array): any {
  if (isZipBytes(bytes)) {
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const content = parseBinarySldd(ab as ArrayBuffer);
    return DataModel.addDataSource(uri, content as Record<string, unknown>, { path: name });
  }
  const content = JSON.parse(new TextDecoder().decode(bytes));
  return DataModel.addDataSource(uri, content, { path: name });
}

/** Load a fresh model for a fixture in the given format. */
export function loadModel(format: SlddFormat, fixture: string, uri: string): any {
  DataModel.removeDataSource(uri);
  const dir = format === 'json' ? 'text' : 'binary';
  const p = fileURLToPath(new URL(`../artifacts/${dir}/${fixture}`, import.meta.url));
  const raw = readFileSync(p);
  return addSlddSource(uri, fixture, new Uint8Array(raw));
}

/** Find a top-level entry node by name (tree walk, no presentation layer). */
export function entryByName(model: any, _uri: string, name: string): any {
  const all: any[] =
    typeof model.flatten === 'function' ? model.flatten() : collect(model);
  const hit = all.find((n) => n?.name === name && !String(n?.id ?? '').startsWith('section:'));
  if (!hit) throw new Error(`no entry "${name}"`);
  return hit;
}

function collect(root: any): any[] {
  const out: any[] = [];
  const stack = [root];
  while (stack.length) {
    const n = stack.shift();
    if (!n) continue;
    out.push(n);
    if (n.children) stack.push(...n.children);
  }
  return out;
}

/** Serialize the whole model back to bytes/text for the given format. */
export function serializeModel(model: any, format: SlddFormat): Uint8Array {
  if (format === 'binary') {
    return new Uint8Array(serializeBinarySldd(model));
  }
  const json = JSON.stringify(model.serialize(), null, '\t');
  return new TextEncoder().encode(json);
}

/**
 * Re-parse serialized bytes and return the ROOT node, so a test can compare the
 * whole tree rather than one entry (see reparseEntry for the single-entry form).
 */
export function reparseModel(
  bytes: Uint8Array,
  format: SlddFormat,
  fixture: string,
  uri: string,
): any {
  DataModel.removeDataSource(uri);
  return addSlddSource(uri, fixture, bytes);
}

/**
 * Full in-process round trip: reparse the serialized bytes and return the fresh
 * entry node, so a test can assert the edited value survived. Goes through
 * reparseModel so there is exactly one re-parse path — two harnesses that
 * disagree is worse than one.
 */
export function reparseEntry(bytes: Uint8Array, format: SlddFormat, fixture: string, name: string): any {
  const uri = `test://rt-${Math.abs(hash(name + format))}.sldd`;
  return entryByName(reparseModel(bytes, format, fixture, uri), uri, name);
}

export function matlabAvailable(): boolean {
  return MATLAB_LAUNCH.length > 0;
}

/**
 * Live MATLAB value-equality gate. Writes `bytes` to a temp .sldd, runs
 * verify_roundtrip.m, and returns the per-assertion result lines. Throws if any
 * assertion FAILs. No-op (returns null) when MATLAB isn't configured.
 *
 * `expected` maps a property path to the value we set (see verify_roundtrip.m):
 *   { Min: 5, "CoderInfo.StorageClass": "ExportedGlobal", __class__: "Simulink.Parameter" }
 */
export function matlabAssertRoundTrip(
  bytes: Uint8Array,
  entryName: string,
  expected: Record<string, unknown>,
): string | null {
  if (!matlabAvailable()) return null;
  const dir = mkdtempSync(join(tmpdir(), 'dexfid-'));
  const slddPath = join(dir, 'rt.sldd');
  writeFileSync(slddPath, bytes);
  // MATLAB's jsondecode maps any non-identifier char in a JSON key to a plain
  // '_', destroying dotted/indexed paths. To survive the trip we pre-encode each
  // key's non-identifier chars as _0xHH_ (all valid identifier chars, so
  // jsondecode passes them through) and verify_roundtrip.m decodes them back.
  // Keys already in this form (e.g. "CoderInfo_0x2E_StorageClass") are untouched.
  const spec = JSON.stringify(encodeSpecKeys(expected));
  const cmd = `cd('${HERE}'); verify_roundtrip('${slddPath}','${entryName}','${spec.replace(/'/g, "''")}')`;
  const [bin, ...args] = MATLAB_LAUNCH.split(' ');
  const out = execFileSync(bin, [...args, '-nodesktop', '-batch', cmd], {
    encoding: 'utf8',
    cwd: MATLAB_CWD,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (!/RESULT PASS/.test(out)) {
    throw new Error('MATLAB round-trip gate failed:\n' + out);
  }
  return out;
}

/**
 * Encode each spec key's non-identifier characters as _0xHH_ so it survives
 * MATLAB's jsondecode intact. Identifier chars (A-Z a-z 0-9 _) pass through, so
 * a key already hand-encoded on the JS side (e.g. "CoderInfo_0x2E_StorageClass")
 * is a fixed point of this transform. A leading underscore is left as-is:
 * jsondecode prefixes such keys with 'x' and verify_roundtrip.m strips it.
 */
function encodeSpecKeys(spec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(spec)) {
    const enc = k.replace(/[^A-Za-z0-9_]/g, (c) => `_0x${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}_`);
    out[enc] = v;
  }
  return out;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
