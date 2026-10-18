// Copyright 2026 The MathWorks, Inc.
//
// The core half of probe_m9_merged_reopen.m (M9 of the 2026-10-13 save-fidelity plan, the last of
// its MATLAB read-backs): the saves MATLAB is asked to reopen, made through core's own API.
//
// Since S2 (core #143) an edited entry of a binary dictionary is not written whole: the save keeps
// the bytes of every part the edit did not touch, writes only what it changed, and uses that merge
// only when it reads back in core as the model's own text would (EntryMerge). M9 asks whether
// MATLAB R2027a opens those saves and reads every entry as it should: every entry nobody edited as
// it reads in the original file, and the edited one as the original entry with the same edit made
// in MATLAB.
//
// The cases: every compressed-binary .sldd under test/fixtures and test/parity/artifacts, and in
// each, one entry of each kind it holds (its class, and for a plain value whether it is complex,
// sparse, empty or N-D): the first whose rename the merge writes otherwise than writing the entry
// whole would, or else the first; with
//   rename       the entry renamed to its name and `M9`;
//   description  where the entry's class has one, its Description set;
// and, where the class has a nested part that is cheap to edit,
//   element      the first bus element's Description;
//   field        a struct's first real double scalar field set to another number.
// Every edit is made as a host makes it: the node made active, then session.editProperty; every
// save is session.serializeSource, one save per edit, each in its own file.
//
// m9MergedSaves(core, fixtures) returns { files, cases }: `fixtures` is [{ rel, bytes }] (the
// path under test/, and the file's bytes; binaryFixtures(testDir) finds them), `files` the saves
// and a copy of each original by name, `cases` one row per edit. A row names the original's copy
// and the save, the entry, its section and kind, the edit, and what the save is: `save`, the
// SHA-256 of its chunk with the edited entry's LastMod masked (the clock's), and of the list of
// its other parts with theirs; `merged`, whether the edited entry's object is not what writing it
// whole gives, which is the merge at work; `untouched`, how many other entries are their bytes as
// read, of how many; `otherPartsKept`, whether every other part is the original's. An earlier
// save's copy of a fixture (olderSaveOf) is asked about too, as `variant: 'older save'`.
// test/parity/m9MergedSaves.truth.test.ts makes the saves again from the package's source and asks
// that each is still the save MATLAB was asked about.
//
// Run (writes the saves, the originals' copies and cases.json for the probe):
//   node test/parity/matlab/m9_merged_saves.mjs /tmp/m9saves
// with dist built; then probe_m9_merged_reopen.m with M9_OUT set to the same directory.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const CHUNK = 'data/chunk0.xml';
const ab = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
const sha = (data) => createHash('sha256').update(data).digest('hex');

/** Every compressed-binary .sldd under test/fixtures and test/parity/artifacts, as [{ rel, bytes }], in path order. */
export function binaryFixtures(testDir) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (name.endsWith('.sldd')) {
        const bytes = new Uint8Array(readFileSync(path));
        if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
          out.push({ rel: relative(testDir, path).split('\\').join('/'), bytes });
        }
      }
    }
  };
  for (const sub of ['fixtures', join('parity', 'artifacts')]) {
    walk(join(testDir, sub));
  }
  return out;
}

/**
 * A binary dictionary as an earlier core save left it (binaryEditKeepsUntouched.test.ts's
 * openOlderSave): every cell MATLAB wrote with no Dimension, a 1x1, given `Dimension="1*1"`, the
 * spelling the writers gave one until they wrote it as MATLAB does, and which MATLAB reads as the
 * same value (cell1x1.truth.json). The writers spell those tags otherwise than the file now does,
 * so an edit of an entry holding one is a merge that differs from writing the entry whole: the
 * kept bytes are the file's, the edited part the model's. Null where the file has no such cell.
 */
export function olderSaveOf(bytes) {
  const parts = unzipSync(bytes);
  const xml = parts[CHUNK] ? strFromU8(parts[CHUNK]) : '';
  const older = xml.replace(/(<(?:P Name="[^"]*"|Element) Class="cell")>/g, '$1 Dimension="1*1">');
  if (older === xml) {
    return null;
  }
  parts[CHUNK] = strToU8(older);
  return zipSync(parts, { mtime: new Date('2026-10-13T00:00:00Z') });
}

/** The fixtures, each followed by its earlier save's copy where it has one (olderSaveOf), as `variant: 'older save'`. */
export function withOlderSaves(fixtures) {
  return fixtures.flatMap((f) => {
    const older = olderSaveOf(f.bytes);
    return older ? [f, { rel: f.rel, bytes: older, variant: 'older save' }] : [f];
  });
}

/** Each `<Object Class="DD.ENTRY">…</Object>` of a chunk, by the name on its Name line. */
function objectsOf(xml) {
  const out = new Map();
  let at = 0;
  for (;;) {
    const s = xml.indexOf('<Object Class="DD.ENTRY">', at);
    if (s < 0) {
      return out;
    }
    const e = xml.indexOf('</Object>', s) + '</Object>'.length;
    const object = xml.slice(s, e);
    const m = /<P Name="Name"(?: Class="char")?>([^<]*)<\/P>/.exec(object);
    const name = m ? m[1] : '';
    out.set(name, out.has(name) ? null : object);
    at = e;
  }
}

/** An entry's kind: its class, and for a plain value the attributes of its Value tag that make another kind of it. */
function kindOf(entry, object) {
  const cls = entry.className || entry.constructor.name;
  const tag = object ? (/<P Name="Value"[^>]*>/.exec(object) ?? [''])[0] : '';
  const flags = [];
  if (/IsComplex="1"/.test(tag)) flags.push('complex');
  if (/IsSparse="1"|Sparse="/.test(tag)) flags.push('sparse');
  const dims = (/Dimension="([^"]*)"/.exec(tag) ?? [])[1];
  if (dims !== undefined) {
    const d = dims.split('*');
    if (d.some((n) => n === '0')) flags.push('empty');
    else if (d.length > 2) flags.push('nd');
  }
  return [cls, ...flags].join('/');
}

/** A MATLAB name the entry can be renamed to that no other entry has. */
function renameOf(name, names) {
  let base = (name + 'M9').slice(0, 63);
  for (let k = 2; names.has(base); k++) {
    base = (name.slice(0, 60) + 'M9' + k).slice(0, 63);
  }
  return base;
}

/** The first field of a 1x1 struct entry that holds a real double scalar, as [name, number], or null. */
function doubleField(entry, object) {
  const top = object && /<P Name="Value" Class="struct">\r?\n *<Element>\r?\n( *)<P /.exec(object);
  if (entry.constructor.name !== 'StructNode' || !top) {
    return null;
  }
  for (const f of entry.children) {
    if (f.constructor.name !== 'MatlabVariableNode' || f.className !== 'double') continue;
    const m = new RegExp(`\n${top[1]}<P Name="${f.name}" Class="double">([^<]*)</P>`).exec(object);
    if (m && Number.isFinite(Number(m[1]))) {
      return [f.name, Number(m[1])];
    }
  }
  return null;
}

/** The edits an entry is given: a rename, and where its class has them a Description and a nested part. */
function editsOf(entry, object, names) {
  const edits = [{ edit: 'rename', prop: 'Name', value: renameOf(entry.name, names) }];
  if ('Description' in entry) {
    edits.push({ edit: 'description', prop: 'Description', value: 'M9: a Description set by core' });
  }
  const element = entry.children?.[0];
  if (/BusNode$/.test(entry.constructor.name) && element && 'Description' in element) {
    edits.push({ edit: 'element', prop: 'Description', value: 'M9: an element Description set by core', path: { index: 1, name: element.name } });
  }
  const field = doubleField(entry, object);
  if (field) {
    const number = field[1] === 5 ? 6 : 5;
    edits.push({ edit: 'field', prop: 'Value', value: String(number), path: { field: field[0] } });
  }
  return edits;
}

/** The node an edit is made on: the entry, or its nested part. */
function targetOf(entry, edit) {
  if (edit.edit === 'element') {
    return entry.children[edit.path.index - 1];
  }
  if (edit.edit === 'field') {
    return entry.children.find((f) => f.name === edit.path.field);
  }
  return entry;
}

const fileTag = (rel) => rel.replace(/^fixtures\//, '').replace(/^parity\/artifacts\//, 'parity_').replace(/\.sldd$/, '').replace(/[^A-Za-z0-9]+/g, '_');
const entriesOf = (root) => root.children.flatMap((s) => s.children.map((e) => [s, e]));

/** The saves and their cases. `core` is { createSession, ingest }. */
export function m9MergedSaves(core, fixtures) {
  const { createSession, ingest } = core;
  const files = {};
  const cases = [];
  const open = (bytes, filename) => {
    const session = createSession();
    const root = ingest(session, ab(bytes), { filename });
    session.setActiveContext(root);
    return { session, root };
  };
  for (const { rel, bytes, variant = '' } of fixtures) {
    const tag = fileTag(rel) + (variant ? '_older' : '');
    const filename = rel.split('/').pop();
    const original = 'orig_' + tag + '.sldd';
    const members = unzipSync(bytes);
    if (!members[CHUNK]) continue;
    const objects = objectsOf(strFromU8(members[CHUNK]));
    const { root: probe } = open(bytes, filename);
    const all = entriesOf(probe);
    const names = new Set(all.map(([, e]) => e.name));
    // One edit, in a session of its own, saved: the row, and the save's bytes, or the refusal.
    const save = (section, entry, kind, edit) => {
      const row = { fixture: rel, variant, original, file: '', section: section.name, entry: entry.name, kind, path: '', ...edit, refused: '' };
      const { session, root } = open(bytes, filename);
      const [, mine] = entriesOf(root).find(([s, e]) => s.name === section.name && e.name === entry.name);
      const target = targetOf(mine, edit);
      session.setActive(root, target);
      const result = session.editProperty(target.id, edit.prop, edit.value);
      if (result !== true) {
        return { row: { ...row, refused: typeof result === 'object' ? result.reason : String(result) }, saved: null };
      }
      const saved = session.serializeSource(root.name).bytes;
      const now = edit.edit === 'rename' ? edit.value : entry.name;
      return { row: { ...row, ...describeSave(saved, members, objects, now, entry.name, mine) }, saved };
    };
    // The entries of each kind, in the order they are read; of each kind, the first whose rename
    // the merge writes otherwise than writing it whole would, or else the first.
    const kinds = new Map();
    for (const [section, entry] of all) {
      const kind = kindOf(entry, objects.get(entry.name) ?? null);
      if (!kinds.has(kind)) kinds.set(kind, []);
      kinds.get(kind).push([section, entry]);
    }
    let n = 0;
    for (const [kind, ofKind] of kinds) {
      const merges = ofKind.find(([s, e]) => save(s, e, kind, editsOf(e, null, names)[0]).row.merged === true);
      // Of an earlier save's copy, only what it adds: a kind whose rename the merge writes otherwise.
      if (variant && !merges) continue;
      const [section, entry] = merges ?? ofKind[0];
      for (const edit of editsOf(entry, objects.get(entry.name) ?? null, names)) {
        const { row, saved } = save(section, entry, kind, edit);
        // A Description the class does not have is no edit to ask MATLAB about.
        if (row.refused && edit.edit === 'description' && /^Unrecognized property 'Description'/.test(row.refused)) {
          continue;
        }
        if (saved) {
          row.file = `m9_${tag}_${++n}.sldd`;
          files[row.file] = saved;
        }
        cases.push(row);
      }
    }
    if (n > 0) {
      files[original] = bytes;
    }
  }
  return { files, cases };
}

// What a save is: its parts' digests, the edited entry's LastMod masked; whether the edited
// entry's object is the merge (not what writing it whole gives); and how many other entries kept
// their bytes as read.
function describeSave(bytes, before, objectsBefore, name, oldName, entry) {
  const parts = unzipSync(bytes);
  const xml = strFromU8(parts[CHUNK]);
  const objects = objectsOf(xml);
  const edited = objects.get(name);
  const stamp = edited ? edited.replace(/(<P Name="LastMod" Class="char">)[^<]*(<\/P>)/, '$1(masked)$2') : null;
  const masked = edited ? xml.replace(edited, () => stamp) : xml;
  const others = Object.keys(parts).filter((p) => p !== CHUNK).sort();
  const save = { chunk: sha(masked), parts: sha(others.map((p) => p + ' ' + sha(parts[p])).join('\n')) };
  const rest = [...objectsBefore.keys()].filter((n) => n !== oldName);
  const untouched = rest.filter((n) => objectsBefore.get(n) !== null && objects.get(n) === objectsBefore.get(n)).length;
  const sameParts = Object.keys(before).filter((p) => p !== CHUNK).every((p) => parts[p] && sha(parts[p]) === sha(before[p]));
  return {
    save,
    merged: writers ? edited !== undefined && edited !== null && wholeOf(entry, xml) !== edited : null,
    untouched: [untouched, rest.length],
    otherPartsKept: sameParts,
  };
}

// The edited entry written whole from the model, laid out as the chunk is: what the save would
// have written without the merge. `writers` is { regenerateEntryXml, layoutOf, inLayout }, the
// writers' own entry point and the layout a save lays a regenerated entry out in; without it,
// `merged` is not said.
let writers = null;
export function setWriters(w) {
  writers = w;
}
function wholeOf(entry, xml) {
  if (!writers) {
    return null;
  }
  const line = writers.regenerateEntryXml(entry);
  const object = line.slice(4, line.length - 1);
  const layout = writers.layoutOf(xml, xml.indexOf('<Object Class="DD.ENTRY">'));
  return layout ? writers.inLayout(object, layout) : object;
}

// As a script: the saves, the originals' copies and cases.json into a directory, from the built package.
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const [outDir] = process.argv.slice(2);
  if (!outDir) {
    throw new Error('usage: node m9_merged_saves.mjs <out dir>');
  }
  const here = fileURLToPath(new URL('.', import.meta.url));
  const dist = join(here, '..', '..', '..', 'dist');
  const core = await import(join(dist, 'index.js'));
  const parser = join(dist, 'datamodel', 'parser');
  setWriters({ ...(await import(join(parser, 'BinarySlddSerializer.js'))), ...(await import(join(parser, 'ChunkLayout.js'))) });
  const { files, cases } = m9MergedSaves(core, withOlderSaves(binaryFixtures(join(here, '..', '..'))));
  mkdirSync(outDir, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(join(outDir, name), bytes);
  }
  writeFileSync(join(outDir, 'cases.json'), JSON.stringify(cases, null, 2) + '\n');
  console.log('wrote', Object.keys(files).length, 'files and', cases.length, 'cases to', outDir);
}
