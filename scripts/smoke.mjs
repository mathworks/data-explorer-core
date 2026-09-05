// Copyright 2026 The MathWorks, Inc.
// Runtime smoke test: load the BUILT dist/ under native Node ESM and assert the
// public surface is present. This is the one check neither `tsc` nor vitest
// covers — vitest runs against src/, and tsc passes module specifiers through
// unchanged, so a missing `.js` extension or bad JSON import only surfaces when
// the compiled output is actually loaded by Node (the ERR_MODULE_NOT_FOUND class
// of bug that bit the foundation milestone).

const m = await import('../dist/index.js');

const requiredFns = [
  'createSession',
  'createEventBus',
  'createUndoManager',
  'parseBinarySldd',
  'parseSlx',
  'parseMat',
  'parseProject',
  'serializeEntryToXml',
  'ingest',
  'toDTO',
];

const missingFns = requiredFns.filter((name) => typeof m[name] !== 'function');
if (missingFns.length > 0) {
  console.error('SMOKE FAIL — missing/!function exports:', missingFns.join(', '));
  process.exit(1);
}

// DataModel is the default-session object (not a function).
if (!m.DataModel || typeof m.DataModel.addDataSource !== 'function') {
  console.error('SMOKE FAIL — DataModel default session missing or malformed');
  process.exit(1);
}

// Exercise the factory end-to-end: create a session, confirm its shape.
const s = m.createSession();
if (typeof s.addDataSource !== 'function' || typeof s.bus.publish !== 'function') {
  console.error('SMOKE FAIL — createSession() returned an unexpected shape');
  process.exit(1);
}

// The session methods a host reaches for BY NAME off the object, which is the class of
// mistake this file exists to catch: a function that never made it into the returned
// literal type-checks everywhere and is `undefined` at the one place it is called. Link
// resolution is called from a click handler, so it is exactly the surface that would
// otherwise be found broken by a user rather than by a build.
const requiredSessionFns = [
  'findNodes',
  'findNode',
  'resolveLink',
  'findUsages',
  'resolveDictionaryReferences',
  'rowsOf',
];
const missingSessionFns = requiredSessionFns.filter((name) => typeof s[name] !== 'function');
if (missingSessionFns.length > 0) {
  console.error('SMOKE FAIL — createSession() missing/!function methods:', missingSessionFns.join(', '));
  process.exit(1);
}

// And that resolveLink answers rather than throwing on an empty session: it is the one
// method a host may call before anything is open (a row rendered from a cached view).
const noSource = s.resolveLink('Kp@mdlparams.sldd');
if (!noSource || noSource.status !== 'source-not-open' || noSource.sourceId !== 'mdlparams.sldd') {
  console.error('SMOKE FAIL — resolveLink() on an empty session returned', JSON.stringify(noSource));
  process.exit(1);
}
if (!Array.isArray(s.findUsages('nothing/here')) || s.findUsages('nothing/here').length !== 0) {
  console.error('SMOKE FAIL — findUsages() on an empty session did not return an empty array');
  process.exit(1);
}

// And that the batched row projection answers on an empty session too, for the same
// reason: a host renders a table on activation, before any file has been opened, and
// this is the call it makes to do it. The count is not asserted — what a bare session
// root flattens to is not this file's business — only that it is an array of rows, so
// that a `rows.map(...)` in the host cannot be handed a non-array. `UsedBy` cannot be
// filled here (nothing is open to reference anything), which is exactly why the shape
// of a filled cell is asserted in test/usedByColumn.test.ts against src/ instead.
const emptyRows = s.rowsOf(s.allNode);
if (!Array.isArray(emptyRows) || emptyRows.some((row) => typeof row.ID !== 'string')) {
  console.error('SMOKE FAIL — rowsOf() on an empty session returned', JSON.stringify(emptyRows));
  process.exit(1);
}

// Every reader hands back a `warnings` array, always — a required field on the parse
// result, not an optional extra. That is a promise about the BUILT output too: a host
// that renders `parsed.warnings.length` has to be able to do it after a clean read as
// well as a short one, and `undefined.length` is a crash in the host rather than a
// failure here. tsc cannot check it (the field is required by type, so nothing forces
// the runtime to agree) and vitest checks src/, so this is the only place the compiled
// readers are asked.
//
// A `.mdl` that declares itself an OPC text package and then stops inside the header
// line naming its first part: nothing but the compatibility stub is readable, so this is
// the short-read side of the pair. The clean side is a bare 128-byte MAT header, which is
// a complete MAT-file holding no variables and must therefore report nothing at all.
const truncatedPackage = new TextEncoder().encode(
  '__MWOPC_PACKAGE_BEGIN__\nModel {\n  Version 9.0\n}\n__MWOPC_PART_BEGIN__ /simulink/blockDiagr',
);
const shortRead = m.parseMdl(
  truncatedPackage.buffer.slice(0, truncatedPackage.byteLength),
  'cut.mdl',
);

const emptyMat = new Uint8Array(128);
new TextEncoder().encodeInto('MATLAB 5.0 MAT-file, smoke test', emptyMat);
emptyMat[124] = 0x00;
emptyMat[125] = 0x01;
emptyMat[126] = 0x49; // 'I'
emptyMat[127] = 0x4d; // 'M'
const cleanRead = m.parseMat(emptyMat.buffer.slice(0, emptyMat.byteLength));

const warningChecks = [
  ['parseMdl (short read)', shortRead.warnings, 1],
  ['parseMat (clean read)', cleanRead.warnings, 0],
  ['parseProject (empty store)', m.parseProject({}, 'p').warnings, 1],
];
for (const [label, warnings, expected] of warningChecks) {
  if (!Array.isArray(warnings) || warnings.length !== expected) {
    console.error(`SMOKE FAIL — ${label} warnings:`, JSON.stringify(warnings));
    process.exit(1);
  }
}
// And that a warning is plain data: it crosses to a webview as JSON or a structured
// clone, so a `code` and a `message` that survive the trip are the whole contract.
const roundTripped = JSON.parse(JSON.stringify(shortRead.warnings))[0];
if (roundTripped.code !== 'source-unreadable' || !roundTripped.message.includes('cut.mdl')) {
  console.error('SMOKE FAIL — parse warning did not survive JSON:', JSON.stringify(roundTripped));
  process.exit(1);
}

// The Node-only subpath (dist/node/index.js) must load under native ESM and expose
// the fs loaders. It is fenced out of the browser bundle by the `exports` map, but
// under Node it must resolve and carry the NodeClassMap side-effect import.
const nodeMod = await import('../dist/node/index.js');
const requiredNodeFns = ['loadFromPath', 'loadDirectory', 'createSession'];
const missingNodeFns = requiredNodeFns.filter((name) => typeof nodeMod[name] !== 'function');
if (missingNodeFns.length > 0) {
  console.error('SMOKE FAIL — node subpath missing/!function exports:', missingNodeFns.join(', '));
  process.exit(1);
}

console.log(
  `OK: dist/index.js loads under native ESM; ${requiredFns.length + 1} exports present, ` +
    `createSession() shape valid with ${requiredSessionFns.length} query/link/row methods; ` +
    `${warningChecks.length} readers report warnings as an array; ` +
    `/node subpath resolves with ${requiredNodeFns.length} loaders`,
);
