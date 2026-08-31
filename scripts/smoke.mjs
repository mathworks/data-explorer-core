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
    `createSession() shape valid; /node subpath resolves with ${requiredNodeFns.length} loaders`,
);
