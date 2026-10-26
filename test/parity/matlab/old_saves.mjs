// Copyright 2026 The MathWorks, Inc.
//
// The core half of probe_old_saves_readback.m: what MATLAB R2027a is asked to reopen about
// saves core made before two fixes of the 2026-10-13 save-fidelity plan (its M4 and M7), and
// about copies core makes now from a binary dictionary into a text one.
//
// OLD SAVES. Before #93 (50549bd) a binary dictionary's reader dropped the Source="dynamic"
// and PropertyType="..." MATLAB writes on the options a custom or AUTOSAR target adds to its
// Simulink.STFCustomTargetCC, so a save wrote each as an ordinary property (M4); it also named
// a mixed-class object array's elements all after the first. Before 90caf06 the writer of a
// struct entry wrote a struct of no element around an `<Element>` it never had, and without the
// `<Field Name="…"/>` of the fields it declares (M7). Every save then wrote every entry from the
// model, edited or not. A file saved by such a core is still on a user's disk; the question is
// what MATLAB, and core now, read of it.
//
// The saves were made once, each an untouched save (session.serializeSource with nothing
// edited) of every original oldSaveOriginals names, by core built at each commit BUILDS names,
// and are committed beside the originals in test/parity/oldsaves/ (the builds are not in the
// tree, so a test cannot make them again):
//   node test/parity/matlab/old_saves.mjs save <core checkout> <build> <out dir>
// once per build, from a checkout of that commit with dist built. 'pre69664b0' is #93 less its
// last commit: it keeps the element classes and drops the dynamic attributes, so that M4 is
// asked about alone.
//
// PASTES. pastesOf copies entries as a host copies one (the entry's serialize(), handed to the
// target section's parseEntry under a new name and uuid) into old_saves_r2027a_text.sldd,
// MATLAB's own text twin of the binary original, and saves the text:
//   - from the binary original, each entry holding a mixed-class object array (since D15,
//     83cc70a, read under the base class MATLAB's text format names): a user's subclass of
//     Simulink.Signal beside a Simulink.Signal, and two config sets' Components, one of them
//     holding the AUTOSAR target's dynamic properties; one save per entry and one with all four;
//   - the struct entries of no element, and the struct entry holding two, from the binary
//     original and from its pre90caf06 save, as core reads each now: one save of each.
// The probe's inputs are written by
//   node test/parity/matlab/old_saves.mjs cases <out dir>
// with this checkout's dist built: the pastes, the old saves and their originals' copies, and
// cases.json. test/parity/oldSaves.truth.test.ts makes the pastes again from source and asks
// that each is still the one MATLAB was asked about.
//
// `cases` (cases.json, for the probe): one row per old save ({kind: 'old save', build, fixture,
// file, original, sha, dynamic, emptyStructs}) and one per paste ({kind: 'paste', file,
// original, source, pasted: [{section, from, to}], dynamic, sha}). `dynamic` lists every dynamic
// property the original (or the pasted entry's source) holds, as it holds it ({entry, to, name,
// value}), and `emptyStructs` every struct of no element at an entry ({entry, dims, fields}),
// so that the probe can ask MATLAB about each.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';

const CHUNK = 'data/chunk0.xml';
const ab = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
const sha = (data) => createHash('sha256').update(data).digest('hex');

/** The builds, each named for the commit it is the parent of. */
export const BUILDS = { pre93: '50549bd^', pre69664b0: '69664b0^', pre90caf06: '90caf06^' };
/** The originals' home, and the saves', under test/. */
export const OLD_SAVES_DIR = 'parity/oldsaves';
export const GENERATED = `${OLD_SAVES_DIR}/old_saves_r2027a_binary.sldd`;
export const TEXT_TWIN = `${OLD_SAVES_DIR}/old_saves_r2027a_text.sldd`;

/** Each `<Object Class="DD.ENTRY">…</Object>` of a chunk, as [name, object], in order. */
export function objectsOf(xml) {
  const out = [];
  let at = 0;
  for (;;) {
    const s = xml.indexOf('<Object Class="DD.ENTRY">', at);
    if (s < 0) return out;
    const e = xml.indexOf('</Object>', s) + '</Object>'.length;
    const object = xml.slice(s, e);
    const m = /<P Name="Name"(?: Class="char")?>([^<]*)<\/P>/.exec(object);
    out.push([m ? m[1] : '', object]);
    at = e;
  }
}

/**
 * What a binary dictionary's chunk spells of the two shapes: every dynamic property (a `<P>`
 * with Source="dynamic"), and every struct at an entry's Value whose Dimension holds no
 * element, with the fields it declares and whether it is written around an `<Element>`.
 */
export function shapesOf(bytes) {
  const xml = strFromU8(unzipSync(bytes)[CHUNK]);
  const dynamic = [];
  const emptyStructs = [];
  for (const [entry, object] of objectsOf(xml)) {
    for (const m of object.matchAll(/<P Name="([^"]*)" Source="dynamic" PropertyType="[^"]*" Class="[^"]*">([^<]*)<\/P>/g)) {
      dynamic.push({ entry, name: m[1], value: m[2] });
    }
    const value = /\n( *)<P Name="Value" Class="struct" Dimension="([^"]*)"(\/?)>/.exec(object);
    if (value && value[2].split('*').some((n) => n === '0')) {
      const body = value[3] ? '' : object.slice(value.index + value[0].length, object.indexOf(`\n${value[1]}</P>`, value.index));
      emptyStructs.push({
        entry,
        dims: value[2].split('*').map(Number),
        fields: [...body.matchAll(/^ *<Field Name="([^"]*)"\/>$/gm)].map((f) => f[1]),
        aroundElement: /<Element>/.test(body),
      });
    }
  }
  return { dynamic, emptyStructs };
}

/** The `<P>` line of each named property of an entry, as a chunk spells it, or null: how a save wrote it. */
export function linesOf(bytes, props) {
  const objects = new Map(objectsOf(strFromU8(unzipSync(bytes)[CHUNK])));
  return props.map(({ entry, name }) => {
    const line = new RegExp(`<P Name="${name}"[^>]*>[^<]*</P>`).exec(objects.get(entry) ?? '');
    return line ? line[0] : null;
  });
}

/**
 * The originals of the old saves: every compressed-binary .sldd under test/fixtures and
 * test/parity/artifacts that holds a dynamic property or a struct of no element at an entry,
 * and old_saves_r2027a_binary.sldd, which make_old_saves_r2027a.m wrote for the shapes none of
 * them holds; as [{ rel, bytes }], in path order.
 */
export function oldSaveOriginals(testDir) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (name.endsWith('.sldd')) {
        const bytes = new Uint8Array(readFileSync(path));
        if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
          const { dynamic, emptyStructs } = shapesOf(bytes);
          if (dynamic.length + emptyStructs.length > 0) {
            out.push({ rel: relative(testDir, path).split('\\').join('/'), bytes });
          }
        }
      }
    }
  };
  for (const sub of ['fixtures', join('parity', 'artifacts')]) {
    walk(join(testDir, sub));
  }
  out.push({ rel: GENERATED, bytes: new Uint8Array(readFileSync(join(testDir, GENERATED))) });
  return out;
}

const fileTag = (rel) => rel.split('/').pop().replace(/\.sldd$/, '').replace(/[^A-Za-z0-9]+/g, '_');
/** The name of a build's save of an original, and of the original's copy beside it. */
export const saveName = (build, rel) => `${build}_${fileTag(rel)}.sldd`;
export const originalName = (rel) => `orig_${fileTag(rel)}.sldd`;

/** An untouched save of `bytes`, by `core` ({ createSession, ingest }): what a save by that core wrote of every entry. */
export function untouchedSave(core, bytes, filename) {
  const session = core.createSession();
  const root = core.ingest(session, ab(bytes), { filename });
  return session.serializeSource(root.name).bytes;
}

/** The old-save rows of cases.json, for the saves in `dir` (as saveName names them) of `originals`. */
export function oldSaveCases(originals, dir) {
  const cases = [];
  for (const build of Object.keys(BUILDS)) {
    for (const { rel, bytes } of originals) {
      const saved = new Uint8Array(readFileSync(join(dir, saveName(build, rel))));
      const { dynamic, emptyStructs } = shapesOf(bytes);
      cases.push({
        kind: 'old save',
        build,
        fixture: rel,
        file: saveName(build, rel),
        original: originalName(rel),
        sha: { save: sha(saved), original: sha(bytes) },
        dynamic: dynamic.map(({ entry, name, value }) => ({ entry, to: entry, name, value })),
        emptyStructs: emptyStructs.map(({ entry, dims, fields }) => ({ entry, dims, fields })),
      });
    }
  }
  return cases;
}

/** The entries of the binary original that hold a mixed-class object array, by section. */
export const MIXED = [
  { section: 'other', from: 'holdsMixed' },
  { section: 'other', from: 'holdsBase' },
  { section: 'config', from: 'csAutosar' },
  { section: 'config', from: 'csSimscape' },
];
/** The struct entries of no element in the binary original, and the one holding two such fields. */
export const EMPTIES = ['sE00', 'sE02', 'sE20', 'sE002', 'sE10ab', 'sHolds'].map((from) => ({ section: 'design', from }));
/** The old save the empties are also pasted from: one that wrote them around an `<Element>`, and nothing else otherwise. */
export const EMPTIES_OLD_SAVE = saveName('pre90caf06', GENERATED);

/**
 * The pastes, as { files, cases }. `sources` names each source's bytes: the binary original
 * (`orig_old_saves_r2027a_binary.sldd`) and EMPTIES_OLD_SAVE; `text` is the text twin's.
 */
export function pastesOf(core, sources, text) {
  const { createSession, ingest } = core;
  const ORIGINAL = originalName(GENERATED);
  const sets = [
    ...MIXED.map((p) => [ORIGINAL, [p]]),
    [ORIGINAL, MIXED],
    [ORIGINAL, EMPTIES],
    [EMPTIES_OLD_SAVE, EMPTIES],
  ];
  const files = {};
  const cases = [];
  sets.forEach(([sourceName, set], k) => {
    const session = createSession();
    const source = ingest(session, ab(sources[sourceName]), { filename: sourceName });
    const host = ingest(session, strFromU8(text), { filename: originalName(TEXT_TWIN) });
    const pasted = [];
    for (const { section, from } of set) {
      const entry = source.getSection(section).children.find((e) => e.name === from);
      const payload = JSON.parse(JSON.stringify(entry.serialize()));
      const to = `${from}Pasted`;
      const uuid = `b27b27b2-0000-4000-8000-${String((k + 1) * 100 + pasted.length + 1).padStart(12, '0')}`;
      host.getSection(section).parseEntry({ ...payload, name: to, metadata: { ...payload.metadata, uuid } });
      pasted.push({ section, from, to });
    }
    const saved = session.serializeSource(host.name).text;
    const file = `paste_${k + 1}.sldd`;
    files[file] = saved;
    const dynamic = shapesOf(sources[sourceName]).dynamic.flatMap((d) => {
      const p = pasted.find((x) => x.section === 'config' && x.from === d.entry);
      return p ? [{ entry: d.entry, to: p.to, name: d.name, value: d.value }] : [];
    });
    cases.push({ kind: 'paste', file, original: originalName(TEXT_TWIN), source: sourceName, pasted, dynamic, sha: sha(saved) });
  });
  return { files, cases };
}

/** The two sources of the pastes, from the tree. */
export function pasteSources(testDir) {
  return {
    [originalName(GENERATED)]: new Uint8Array(readFileSync(join(testDir, GENERATED))),
    [EMPTIES_OLD_SAVE]: new Uint8Array(readFileSync(join(testDir, OLD_SAVES_DIR, EMPTIES_OLD_SAVE))),
  };
}

// As a script.
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  const { mkdirSync, writeFileSync, copyFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const here = fileURLToPath(new URL('.', import.meta.url));
  const testDir = join(here, '..', '..');
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === 'save') {
    const [checkout, build, outDir] = rest;
    if (!BUILDS[build] || !outDir) throw new Error(`usage: node old_saves.mjs save <core checkout> <${Object.keys(BUILDS).join('|')}> <out dir>`);
    const core = await import(join(checkout, 'dist', 'index.js'));
    mkdirSync(outDir, { recursive: true });
    for (const { rel, bytes } of oldSaveOriginals(testDir)) {
      writeFileSync(join(outDir, saveName(build, rel)), untouchedSave(core, bytes, rel.split('/').pop()));
    }
    console.log('saved', build);
  } else if (mode === 'cases') {
    const [outDir] = rest;
    if (!outDir) throw new Error('usage: node old_saves.mjs cases <out dir>');
    const dist = join(testDir, '..', 'dist');
    const core = await import(join(dist, 'index.js'));
    await import(join(dist, 'datamodel', 'node', 'data', 'NodeClassMap.js'));
    const { files, cases } = pastesOf(core, pasteSources(testDir), new Uint8Array(readFileSync(join(testDir, TEXT_TWIN))));
    mkdirSync(outDir, { recursive: true });
    for (const [name, data] of Object.entries(files)) writeFileSync(join(outDir, name), data);
    copyFileSync(join(testDir, TEXT_TWIN), join(outDir, originalName(TEXT_TWIN)));
    // The originals the old saves were made of: a fixture added since (one holding a struct of no
    // element) has none.
    const { existsSync } = await import('node:fs');
    const originals = oldSaveOriginals(testDir).filter(({ rel }) => Object.keys(BUILDS).every((b) => existsSync(join(testDir, OLD_SAVES_DIR, saveName(b, rel)))));
    for (const { rel, bytes } of originals) {
      writeFileSync(join(outDir, originalName(rel)), bytes);
      for (const build of Object.keys(BUILDS)) {
        copyFileSync(join(testDir, OLD_SAVES_DIR, saveName(build, rel)), join(outDir, saveName(build, rel)));
      }
    }
    const old = oldSaveCases(originals, join(testDir, OLD_SAVES_DIR));
    writeFileSync(join(outDir, 'cases.json'), JSON.stringify([...old, ...cases], null, 2) + '\n');
    console.log('wrote', Object.keys(files).length, 'pastes and', old.length + cases.length, 'cases to', outDir);
  } else {
    throw new Error('usage: node old_saves.mjs save|cases ...');
  }
}
