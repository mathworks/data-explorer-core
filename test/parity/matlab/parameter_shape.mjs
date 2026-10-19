// Copyright 2026 The MathWorks, Inc.
//
// The core half of probe_parameter_shape.m (B-25, group H, measured 2026-10-19). Each row core
// makes (parameter_shape.steps.json) is made through core's session API on the same entry of the
// same file MATLAB edited (test/fixtures/mcos/complex_binary.sldd, or that file with pRow's
// Dimensions spelled as MATLAB spells a symbolic one, which fileBytes makes), and the dictionary
// saved, as core_<id>.sldd. The probe's READ opens each one and records what MATLAB reads of the
// entry.
//
// parameterShapeSaves(core, read) returns { files, cases }: the saved bytes by file name, and one
// row per save, `saved` the entry's [Dimensions, Complexity] as core wrote them.
// test/parameterShape.test.ts calls it with the package's source, and applyStep for its own edits.
//
// Run: node test/parity/matlab/parameter_shape.mjs /tmp/paramshape   (with dist built)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const here = (rel) => new URL(rel, import.meta.url);
export const PLAN = JSON.parse(readFileSync(here('./parameter_shape.steps.json'), 'utf8'));

const ab = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
const entryOf = (root, name) => root.getSection('design').children.find((e) => e.name === name);

/**
 * The bytes of the file `name` of PLAN.files: a fixture as it is, or one made from a fixture by
 * replacing, in one entry's object of its chunk, one tag `replace` by `with`.
 */
export function fileBytes(name, read) {
  const spec = PLAN.files[name];
  if (typeof spec === 'string') {
    return read(spec);
  }
  const parts = unzipSync(read(spec.from));
  const xml = strFromU8(parts['data/chunk0.xml']);
  const at = xml.indexOf(`<P Name="Name" Class="char">${spec.entry}</P>`);
  const end = xml.indexOf('</Object>', at);
  const tag = xml.indexOf(spec.replace, at);
  if (at < 0 || tag < 0 || tag > end) {
    throw new Error(`${name}: no ${spec.replace} in ${spec.entry}`);
  }
  parts['data/chunk0.xml'] = strToU8(xml.slice(0, tag) + spec.with + xml.slice(tag + spec.replace.length));
  return zipSync(parts);
}

/**
 * Make one step of a row on the entry `name` as a host makes it, through the session, which
 * records its undo: ['cut', k] removes the element row k, ['add'] is Add on the Value row,
 * ['element', k, text] sets the element row k's Value, ['typed', text] the Parameter's. Throws
 * where core refuses it.
 */
export function applyStep(session, root, name, step) {
  const entry = entryOf(root, name);
  const value = entry._valueNode;
  let done;
  if (step[0] === 'cut') {
    done = session.deleteNodeById(value.children[step[1]].id) === true;
  } else if (step[0] === 'add') {
    done = session.addChildTo(value.id) !== null;
  } else if (step[0] === 'element') {
    const el = value.children[step[1]];
    session.setActive(root, el);
    done = session.editProperty(el.id, 'Value', step[2]) === true;
  } else if (step[0] === 'typed') {
    session.setActive(root, entry);
    done = session.editProperty(entry.id, 'Value', step[1]) === true;
  }
  if (!done) {
    throw new Error(`${name}: ${JSON.stringify(step)} was refused`);
  }
}

/** `core` is { createSession, ingest }; `read(rel)` the bytes of a file under the package root. */
export function parameterShapeSaves(core, read, ids = Object.keys(PLAN.rows)) {
  const truth = JSON.parse(readFileSync(here('./parameter_shape.truth.json'), 'utf8'));
  const files = {};
  const cases = [];
  for (const id of ids) {
    const made = PLAN.rows[id];
    const entry = truth.rows.find((r) => r.id === id).entry;
    const session = core.createSession();
    const root = core.ingest(session, ab(fileBytes(made.file, read)), { filename: made.file });
    for (const step of made.steps) {
      applyStep(session, root, entry, step);
    }
    const bytes = session.serializeSource(root.name).bytes;
    const props = entryOf(root, entry).serializeValue()._elements[0]._properties;
    files[`core_${id}.sldd`] = bytes;
    cases.push({ id, entry, file: `core_${id}.sldd`, saved: [props.Dimensions, props.Complexity] });
  }
  return { files, cases };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const outdir = process.argv[2] || '/tmp/paramshape';
  const core = await import(here('../../../dist/index.js').href);
  const read = (rel) => new Uint8Array(readFileSync(here('../../../' + rel)));
  const { files, cases } = parameterShapeSaves(core, read);
  mkdirSync(outdir, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(`${outdir}/${name}`, bytes);
  }
  for (const c of cases) {
    console.log(c.file, c.entry, JSON.stringify(c.saved));
  }
}
