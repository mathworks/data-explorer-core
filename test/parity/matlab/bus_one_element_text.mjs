// Copyright 2026 The MathWorks, Inc.
//
// The core half of probe_bus_one_element_text.m (B-24, group H, measured 2026-10-19). MATLAB's own
// text dictionary of a Simulink.Bus, a Simulink.ConnectionBus and a Simulink.ServiceBus of one
// element each (test/fixtures/bus_one_element/bus_one_element_text.sldd), edited through core's
// session API as MATLAB edited its copies of it (self_*.sldd there), and saved: untouched
// (core_noop), an element added to each bus (core_added), that element removed again
// (core_added_removed), the first element removed instead (core_added_removed_first), and the add
// undone (core_added_undone).
//
// busOneElementSaves(core, read) returns { files, cases }: the saved text by file name, and one
// row per file and bus, its `fragment` the bus's Elements_internal as written (JSON).
// test/busOneElementText.test.ts calls it with the package's source and compares each fragment
// with the one MATLAB read back, so that a change to the spelling asks for MATLAB to be asked again.
//
// Run: node test/parity/matlab/bus_one_element_text.mjs /tmp/busone   (with dist built)
// It writes MATLAB's files, each save as <name>.sldd and the rows as cases.json, which the probe's
// READ copies into its truth beside what MATLAB read.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const FIXTURE = 'bus_one_element/bus_one_element_text.sldd';
// MATLAB's own files, made by the probe's MAKE: what it read, and its copies edited as EDITS edit core's.
export const MATLAB_FILES = ['bus_one_element_text.sldd', 'self_added.sldd', 'self_added_removed.sldd', 'self_added_removed_first.sldd'];
export const ENTRIES = ['OneBus', 'OneConnBus', 'OneServiceBus'];
export const EDITS = {
  core_noop: () => {},
  core_added: (s, bus) => {
    s.addChildTo(bus.id);
  },
  core_added_removed: (s, bus) => {
    const added = s.addChildTo(bus.id);
    s.deleteNodeById(added.id);
  },
  core_added_removed_first: (s, bus) => {
    s.addChildTo(bus.id);
    s.deleteNodeById(bus.children[0].id);
  },
  core_added_undone: (s, bus, src) => {
    s.setActiveContext(src);
    s.addChildTo(bus.id);
    s.undo();
  },
};

const ab = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

/** The Elements_internal of the entry named `name` in a saved text dictionary. */
export function elementsInternalOf(text, name) {
  const entries = JSON.parse(text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
  return entries.find((e) => e.name === name).value._elements[0]._properties.Elements_internal;
}

/** `core` is { createSession, ingest }; `read(rel)` the bytes of a test fixture. */
export function busOneElementSaves(core, read) {
  const { createSession, ingest } = core;
  const files = {};
  const cases = [];
  for (const [file, edit] of Object.entries(EDITS)) {
    const s = createSession();
    const src = ingest(s, ab(read(FIXTURE)), { filename: file + '.sldd' });
    for (const name of ENTRIES) {
      edit(s, src.flatten().find((n) => n.isEntry && n.name === name), src);
    }
    const saved = s.serializeSource(src.name);
    files[file + '.sldd'] = saved.text;
    for (const name of ENTRIES) {
      cases.push({ file: file + '.sldd', entry: name, fragment: JSON.stringify(elementsInternalOf(saved.text, name)) });
    }
  }
  return { files, cases };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const outdir = process.argv[2] || '/tmp/busone';
  const here = (rel) => new URL(rel, import.meta.url);
  const core = await import(here('../../../dist/index.js').href);
  const read = (rel) => new Uint8Array(readFileSync(here('../../fixtures/' + rel)));
  const { files, cases } = busOneElementSaves(core, read);
  mkdirSync(outdir, { recursive: true });
  for (const name of MATLAB_FILES) writeFileSync(outdir + '/' + name, read('bus_one_element/' + name));
  for (const [name, text] of Object.entries(files)) writeFileSync(outdir + '/' + name, text);
  writeFileSync(outdir + '/cases.json', JSON.stringify(cases, null, 1) + '\n');
  console.log('wrote', Object.keys(files).length, 'saves and', cases.length, 'cases to', outdir);
}
