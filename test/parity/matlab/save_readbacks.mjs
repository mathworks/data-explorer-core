// Copyright 2026 The MathWorks, Inc.
//
// The core half of probe_save_readbacks.m (D8-READBACKS M1, M2 and M3 of the 2026-10-13 save
// decisions, run for group F on 2026-10-18): the saves MATLAB is asked to reopen, made through
// core's own API, and the part of each that the question is about.
//
//   M1  a config set's Components, regenerated in a binary dictionary (the entry renamed) and
//       pasted from it into its text twin: does MATLAB read 10 components, each of its own class
//       (decision D15)? Needs dNJSON_SLDDApi_opc.sldd and its text twin dNJSON_SLDDApi.sldd, which
//       are corpus files, not in this repository: `corpus` names the directory holding them, and
//       without it M1 is not made.
//   M2  enumeration values regenerated in a binary dictionary and pasted into a text one: a
//       scalar, a 1x3, an object's enumeration property, and a 0x2 and a 0x0 enumeration.
//   M3  a bus emptied of its elements and a new bus, in each dictionary; and the two spellings of
//       an empty bus older core saves wrote, `Class="char"/>` and `Class="double" Dimension="0*0"/>`.
//
// saveReadbacks(core, fixtures, corpus) returns { files, cases }: `files` the saved dictionaries
// by name, `cases` one row per question, its `fragment` the part of the save the question is
// about, exactly as written (a config set's, too long to hold, as its length and SHA-256).
// test/parity/readbacks.truth.test.ts calls it with the package's source and compares each
// fragment with the one MATLAB was asked about, so that a change to what core writes there asks
// for MATLAB to be asked again.
//
// Run (writes the saves and cases.json for the probe):
//   node test/parity/matlab/save_readbacks.mjs /tmp/savereadbacks [corpus dir]
// with dist built; then probe_save_readbacks.m with SAVE_READBACKS_OUT set to the same directory.
import { createHash } from 'node:crypto';
import { strFromU8, unzipSync, zipSync, strToU8 } from 'fflate';

const ab = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
const bytesOf = (saved) => (saved.kind === 'text' ? saved.text : saved.bytes);
const chunkOf = (bytes) => strFromU8(unzipSync(bytes)['data/chunk0.xml']);
const textEntries = (text) => JSON.parse(text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
const digest = (s) => ({ length: s.length, sha256: createHash('sha256').update(s).digest('hex') });

/** The DD.ENTRY named `name` in a binary dictionary's chunk. */
function entryXml(xml, name) {
  const at = xml.indexOf('<P Name="Name" Class="char">' + name + '</P>');
  if (at < 0) {
    throw new Error('no entry ' + name);
  }
  const from = xml.lastIndexOf('<Object Class="DD.ENTRY">', at);
  return xml.slice(from, xml.indexOf('\n    </Object>', at) + '\n    </Object>'.length);
}

/** The `<P Name="…"` span starting with `open` in `xml`, through its close at the same indent. */
function spanOf(xml, open) {
  const from = xml.indexOf(open);
  if (from < 0) {
    throw new Error('no ' + open.trim());
  }
  const end = xml.indexOf('\n', from);
  const line = xml.slice(from, end < 0 ? undefined : end);
  if (line.endsWith('/>') || line.endsWith('</P>')) {
    return line.trim();
  }
  const indent = open.length - open.trimStart().length;
  const close = '\n' + ' '.repeat(indent) + '</P>';
  return xml.slice(from, xml.indexOf(close, from) + close.length).trim();
}

/**
 * The saves and their questions. `core` is { createSession, ingest }; `read(rel)` the bytes of a
 * test fixture; `corpus(name)`, the bytes of a corpus file, or null without one.
 */
export function saveReadbacks(core, read, corpus = () => null) {
  const { createSession, ingest } = core;
  const files = {};
  const cases = [];
  const open = (session, bytes, filename) => ingest(session, ab(bytes), { filename });
  const entriesOf = (root) => root.children.flatMap((s) => s.children);
  const named = (root, name) => entriesOf(root).find((e) => e.name === name);
  const record = (e) => JSON.parse(JSON.stringify(e.serialize()));
  let uuid = 0;
  const paste = (section, rec, name) => {
    rec.name = name;
    rec.metadata = { ...section.children[0].metadata, uuid: '00000000-0000-4000-e900-' + String(++uuid).padStart(12, '0') };
    section.parseEntry(rec);
  };

  // M1
  const opc = corpus('dNJSON_SLDDApi_opc.sldd');
  const twin = corpus('dNJSON_SLDDApi.sldd');
  if (opc && twin) {
    const s = createSession();
    const bin = open(s, opc, 'dNJSON_SLDDApi_opc.sldd');
    const cs = named(bin, 'slConfigSetHDLCoder');
    const rec = record(cs);
    cs.setProperty('Name', 'slConfigSetHDLCoderR');
    const binBytes = bytesOf(s.serializeSource(bin.name));
    const txt = open(s, twin, 'dNJSON_SLDDApi.sldd');
    paste(txt.getSection('config'), rec, 'slConfigSetHDLCoderPasted');
    const text = bytesOf(s.serializeSource(txt.name));
    files['m1_binary.sldd'] = binBytes;
    files['m1_text.sldd'] = text;
    cases.push({ check: 'M1', file: 'm1_binary.sldd', section: 'config', entry: 'slConfigSetHDLCoderR', kind: 'configset', fragment: digest(spanOf(entryXml(chunkOf(binBytes), 'slConfigSetHDLCoderR'), '        <P Name="Value"')) });
    cases.push({ check: 'M1', file: 'm1_text.sldd', section: 'config', entry: 'slConfigSetHDLCoderPasted', kind: 'configset', fragment: digest(JSON.stringify(textEntries(text).find((e) => e.name === 'slConfigSetHDLCoderPasted').value)) });
    cases.push({ check: 'M1', file: 'dNJSON_SLDDApi_opc.sldd', section: 'config', entry: 'slConfigSetHDLCoder', kind: 'configset', fragment: '', control: 'MATLAB\'s own file' });
  }

  // M2
  for (const [source, host, names, section, tag] of [
    ['custom_object_binary.sldd', 'custom_object_text.sldd', ['gearValue', 'gearRow', 'widget'], { gearValue: 'design', gearRow: 'design', widget: 'other' }, 'custom'],
    ['text_empty_readback_binary.sldd', 'custom_object_text.sldd', ['e_En2', 'e_En0'], { e_En2: 'design', e_En0: 'design' }, 'empty'],
  ]) {
    const s = createSession();
    const bin = open(s, read(source), source);
    const recs = names.map((n) => [n, record(named(bin, n))]);
    for (const n of names) {
      named(bin, n).setProperty('Name', n + 'R');
    }
    const binBytes = bytesOf(s.serializeSource(bin.name));
    const txt = open(s, read(host), host);
    for (const [n, rec] of recs) {
      paste(txt.getSection(section[n]), rec, n + 'P');
    }
    const text = bytesOf(s.serializeSource(txt.name));
    files[`m2_binary_${tag}.sldd`] = binBytes;
    files[`m2_text_${tag}.sldd`] = text;
    const chunk = chunkOf(binBytes);
    const saved = textEntries(text);
    for (const n of names) {
      const widget = n === 'widget';
      const xml = entryXml(chunk, n + 'R');
      const value = saved.find((e) => e.name === n + 'P').value;
      cases.push({ check: 'M2', file: `m2_binary_${tag}.sldd`, section: section[n], entry: n + 'R', kind: widget ? 'enumProperty' : 'enum', fragment: widget ? spanOf(xml, '                <P Name="Mode"') : spanOf(xml, '        <P Name="Value"') });
      cases.push({ check: 'M2', file: `m2_text_${tag}.sldd`, section: section[n], entry: n + 'P', kind: widget ? 'enumProperty' : 'enum', fragment: JSON.stringify(widget ? value._elements[0]._properties.Mode : value) });
    }
  }

  // M3
  for (const [fixture, tag] of [['bus_types_binary.sldd', 'binary'], ['bus_types_text.sldd', 'text']]) {
    const s = createSession();
    const root = open(s, read(fixture), fixture);
    const bus = named(root, 'btBus');
    for (const c of [...bus.children]) {
      s.deleteNodeById(c.id);
    }
    root.addEntry('Simulink.Bus', 'busNew', 'design');
    const bytes = bytesOf(s.serializeSource(root.name));
    files[`m3_bus_${tag}.sldd`] = bytes;
    for (const name of ['btBus', 'busNew']) {
      const fragment = tag === 'binary'
        ? spanOf(entryXml(chunkOf(bytes), name), '                <P Name="Elements_internal"')
        : JSON.stringify(textEntries(bytes).find((e) => e.name === name).value._elements[0]._properties.Elements_internal);
      cases.push({ check: 'M3', file: `m3_bus_${tag}.sldd`, section: 'design', entry: name, kind: 'bus', fragment });
    }
    if (tag === 'binary') {
      // What core wrote for an empty bus before it kept the class: the same save, each bus's
      // Elements_internal respelled as it was.
      for (const [old, line] of [['char', '<P Name="Elements_internal" Class="char"/>'], ['double', '<P Name="Elements_internal" Class="double" Dimension="0*0"/>']]) {
        const files0 = unzipSync(bytes);
        const xml = strFromU8(files0['data/chunk0.xml']).split('<P Name="Elements_internal" Class="Simulink.BusElement" Dimension="0*0"/>').join(line);
        files0['data/chunk0.xml'] = strToU8(xml);
        files[`m3_old_${old}.sldd`] = zipSync(files0);
        for (const name of ['btBus', 'busNew']) {
          cases.push({ check: 'M3', file: `m3_old_${old}.sldd`, section: 'design', entry: name, kind: 'bus', fragment: spanOf(entryXml(xml, name), '                <P Name="Elements_internal"') });
        }
      }
    }
  }
  return { files, cases };
}

// As a script: the saves and cases.json into a directory, from the built package.
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  const { mkdirSync, readFileSync, writeFileSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const [outDir, corpusDir] = process.argv.slice(2);
  if (!outDir) {
    throw new Error('usage: node save_readbacks.mjs <out dir> [corpus dir]');
  }
  const here = fileURLToPath(new URL('.', import.meta.url));
  const dist = join(here, '..', '..', '..', 'dist', 'index.js');
  const core = await import(dist);
  const read = (rel) => new Uint8Array(readFileSync(join(here, '..', '..', 'fixtures', rel)));
  const corpus = (name) => (corpusDir && existsSync(join(corpusDir, name)) ? new Uint8Array(readFileSync(join(corpusDir, name))) : null);
  const { files, cases } = saveReadbacks(core, read, corpus);
  mkdirSync(outDir, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(join(outDir, name), bytes);
  }
  if (corpusDir && existsSync(join(corpusDir, 'dNJSON_SLDDApi_opc.sldd'))) {
    writeFileSync(join(outDir, 'dNJSON_SLDDApi_opc.sldd'), readFileSync(join(corpusDir, 'dNJSON_SLDDApi_opc.sldd')));
  }
  writeFileSync(join(outDir, 'cases.json'), JSON.stringify(cases, null, 2) + '\n');
  console.log('wrote', Object.keys(files).length, 'saves and', cases.length, 'cases to', outDir);
}
