// Copyright 2026 The MathWorks, Inc.
//
// The core half of probe_nd_undecoded_copy_readback.m (B-11 of group H). A .mat file's 1x1x2 cell
// or struct array whose second element is a sparse array the reader did not decode (its indices
// place 4 non-zeros and its bytes hold no values for them, or values of a type with no width, or
// only 2 of the 4) used to copy as its whole MAT stream, the member's own bytes in it. Its copy is
// refused now, as the copy of the same member in a rank-2 cell is (F1-10). Would that stream have
// been the value? MATLAB is asked twice for each: what `load` reads of the .mat variable, and what
// it reads of the stream pasted through core's API into a text and a binary dictionary as an entry.
// A 3x4 sparse array that decodes is the control: core copies it as a stream.
//
// ndUndecodedCopyReadback(core, mat, read) returns { files, cases }: the .mat files and the saved
// dictionaries by name, and one row per case and venue, its `fragment` what the save holds (a text
// dictionary's cdata `_value`, a binary one's `<P …>` span). `core` is { createSession, ingest,
// uuencode, encodeMatStream }, `mat` the byte builders of test/tools/matBytes.ts, and `read(rel)` a
// test fixture's bytes. test/undecodedCopy.test.ts calls it with the package's source and compares
// each fragment with the one MATLAB read, so that a change to the stream asks for MATLAB to be
// asked again.
//
// Run, with dist built:  node test/parity/matlab/nd_undecoded_copy_readback.mjs /tmp/ndundecoded
// then probe_nd_undecoded_copy_readback.m with ND_UNDECODED_OUT set to the same directory.
import { strFromU8, unzipSync } from 'fflate';

const ab = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
const IR = [0, 1, 2, 1];
const JC = [0, 2, 3, 3, 4];
const VALUES = [10, 11, 20, 30];
export const HOSTS = { text: 'sparse/sparse_text.sldd', binary: 'sparse/sparse_binary.sldd' };

/** The member each case holds as its element 2: a 3x4 sparse array, by how its values are held. */
export function members(mat) {
  const { CLASS, MI, arrayFlags, dims, element, matrix, numericData, sparseVar, varName } = mat;
  const withParts = (parts) =>
    matrix([arrayFlags(CLASS.SPARSE, { nzmax: 4 }), dims([3, 4]), varName(''), numericData(MI.INT32, IR), numericData(MI.INT32, JC), ...parts]);
  return {
    absent: () => sparseVar({ name: '', dimensions: [3, 4], ir: IR, jc: JC, real: VALUES, omitData: true }),
    widthless: () => withParts([element(MI.UTF8, new Uint8Array(32))]),
    short: () => withParts([numericData(MI.DOUBLE, [10, 11])]),
    intact: () => sparseVar({ name: '', dimensions: [3, 4], ir: IR, jc: JC, real: VALUES }),
  };
}

/** The 1x1x2 `shape` named `name` holding the double 1 and `member`, as a .mat element. */
export function holder(mat, shape, name, member) {
  const one = mat.numericVar({ name: '', cls: mat.CLASS.DOUBLE, dimensions: [1, 1], real: [1] });
  return shape === 'cell' ? mat.cellVar(name, [one, member], [1, 1, 2]) : mat.structVar(name, ['f'], [{ f: one }, { f: member }], [1, 1, 2]);
}

/** The value at entry `name` of a saved dictionary: a text one's cdata `_value`, a binary one's `<P Name="Value" …>…</P>`. */
function fragmentOf(saved, name) {
  if (saved.kind === 'text') {
    const entries = JSON.parse(saved.text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    return entries.find((e) => e.name === name).value._value;
  }
  const xml = strFromU8(unzipSync(saved.bytes)['data/chunk0.xml']);
  const at = xml.indexOf('<P Name="Value"', xml.indexOf('<P Name="Name" Class="char">' + name + '</P>'));
  return xml.slice(at, xml.indexOf('</P>', at) + 4);
}

export function ndUndecodedCopyReadback(core, mat, read) {
  const { createSession, ingest, uuencode, encodeMatStream } = core;
  const files = {};
  const cases = [];
  let seq = 0;
  for (const [kind, build] of Object.entries(members(mat))) {
    for (const shape of ['cell', 'struct']) {
      const id = kind + '_' + shape;
      const bytes = new Uint8Array(mat.matFile([holder(mat, shape, 'c', build())]));
      files[id + '.mat'] = bytes;
      // Its copy: the control's as core gives it, and each other's as it was before the copy was
      // refused, the stream MatWriter encodes for it (MatlabVariableNode._matStream) with the
      // member's own bytes in it.
      const c = createSession().addMatSource(id + '.mat', ab(bytes)).children[0];
      const value = kind === 'intact' ? JSON.parse(JSON.stringify(c.serialize().value)) : { _type: 'cdata', _value: uuencode(encodeMatStream(c._var)) };
      for (const [format, host] of Object.entries(HOSTS)) {
        const s = createSession();
        const root = ingest(s, ab(read(host)), { filename: host.split('/').pop() });
        const design = root.getSection('design');
        // The section's own metadata, as a host's paste gives it (fieldless_struct_readback.mjs).
        const metadata = { ...design.children[0].metadata, uuid: '00000000-0000-4000-eb11-' + String(++seq).padStart(12, '0') };
        design.parseEntry({ name: 'pasted', metadata, value });
        const saved = s.serializeSource(root.name);
        const file = id + '_' + format + '.sldd';
        files[file] = saved.kind === 'text' ? saved.text : saved.bytes;
        cases.push({ id, kind, shape, mat: id + '.mat', file, format, entry: 'pasted', fragment: fragmentOf(saved, 'pasted') });
      }
    }
  }
  return { files, cases };
}

// As a script: the .mat files, the saves and cases.json into a directory, from the built package.
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  const { mkdirSync, readFileSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const [outDir] = process.argv.slice(2);
  if (!outDir) {
    throw new Error('usage: node nd_undecoded_copy_readback.mjs <out dir>');
  }
  const here = fileURLToPath(new URL('.', import.meta.url));
  const dist = join(here, '..', '..', '..', 'dist');
  const { createSession, ingest } = await import(join(dist, 'index.js'));
  const { uuencode } = await import(join(dist, 'datamodel', 'parser', 'CdataCodec.js'));
  const { encodeMatStream } = await import(join(dist, 'datamodel', 'parser', 'MatWriter.js'));
  const mat = await import(join(here, '..', '..', 'tools', 'matBytes.ts'));
  const read = (rel) => new Uint8Array(readFileSync(join(here, '..', '..', 'fixtures', rel)));
  const { files, cases } = ndUndecodedCopyReadback({ createSession, ingest, uuencode, encodeMatStream }, mat, read);
  mkdirSync(outDir, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(join(outDir, name), bytes);
  }
  writeFileSync(join(outDir, 'cases.json'), JSON.stringify(cases, null, 2) + '\n');
  console.log('wrote', Object.keys(files).length, 'files and', cases.length, 'cases to', outDir);
}
