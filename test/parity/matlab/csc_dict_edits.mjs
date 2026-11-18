// Copyright 2026 The MathWorks, Inc.
//
// The core half of probe_csc_dict_edits.m: a dictionary object with a custom storage class
// (pExport, a Simulink.Parameter under ExportToFile), one CoderInfo edit at a time, each made as a
// host makes it (the node made active, then session.editProperty) and saved by
// session.serializeSource into a file of its own. The edits: StorageClass set to each built-in
// storage class but ImportedExternPointer (Auto, ExportedGlobal, ImportedExtern, SimulinkGlobal),
// and Alignment set to 8.
//
// A dictionary takes these (a MAT-file refuses every edit of such a CoderInfo: McosPropertyRules'
// coderInfo) and writes the property alone: a StorageClass changed leaves the CustomStorageClass
// and the CustomAttributes as the file held them, where MATLAB's own edit sets the
// CustomStorageClass to Default. The probe asks whether MATLAB reads each save as it makes the
// same edit itself.
//
// cscDictEdits(core, bytes, filename) returns one row per edit: { id, key, value, save } with
// `save` the file's bytes (or null, and `refused`, for an edit core refuses), and `sha256` of what
// it holds with the clock's part masked: a text dictionary's whole text, a binary one's
// data/chunk0.xml, its entries' lastmod (LastMod) masked.
//
// Run (writes orig_<format>.sldd, a save per edit and cases.json for the probe):
//   node test/parity/matlab/csc_dict_edits.mjs <outdir> [<binary .sldd with pExport>]
// with dist built. The text dictionary is test/fixtures/definition-file/r2027a/
// definition_file_text.sldd; the binary one MATLAB was asked about is data-explorer-view's
// test-integration/fixtures/cscattributes/csc_attributes_binary.sldd (MATLAB's too), not in this
// tree: test/parity/m9MergedSaves.truth.test.ts holds every binary fixture here to M9.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';

export const EDITS = [
  ['storageClass', 'Auto'],
  ['storageClass', 'ExportedGlobal'],
  ['storageClass', 'ImportedExtern'],
  ['storageClass', 'SimulinkGlobal'],
  ['alignment', '8'],
];

const ENTRY = 'pExport';
const sha = (data) => createHash('sha256').update(data).digest('hex');

/** What a save holds, with each entry's lastmod masked, as text. */
export function maskedText(bytes) {
  const binary = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const text = binary ? strFromU8(unzipSync(bytes)['data/chunk0.xml']) : new TextDecoder().decode(bytes);
  return binary
    ? text.replace(/(<P Name="LastMod" Class="char">)[^<]*(<\/P>)/g, '$1(masked)$2')
    : text.replace(/("lastmod": ")[^"]*(")/g, '$1(masked)$2');
}

/** One save per edit of pExport in the dictionary `bytes`, through `core`'s session. */
export function cscDictEdits(core, bytes, filename) {
  return EDITS.map(([key, value]) => {
    const session = core.createSession();
    const root = core.ingest(session, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { filename });
    const node = root.flatten().find((n) => n.name === ENTRY && !n.isContainer);
    session.setActive(root, node);
    const r = session.editProperty(node.id, key, value);
    const id = `${key}_${value}`;
    if (r !== true) {
      return { id, key, value, save: null, sha256: null, refused: r?.reason ?? String(r) };
    }
    const out = session.serializeSource(root.name);
    const save = out.kind === 'text' ? new TextEncoder().encode(out.text) : new Uint8Array(out.bytes);
    return { id, key, value, save, sha256: sha(maskedText(save)), refused: null };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [outdir, binaryFile] = process.argv.slice(2);
  if (!outdir) {
    console.error('usage: node test/parity/matlab/csc_dict_edits.mjs <outdir> [<binary .sldd>]');
    process.exit(2);
  }
  const here = fileURLToPath(new URL('.', import.meta.url));
  const core = await import(join(here, '../../../dist/index.js'));
  await import(join(here, '../../../dist/datamodel/node/data/NodeClassMap.js'));
  const files = { text: join(here, '../../fixtures/definition-file/r2027a/definition_file_text.sldd') };
  if (binaryFile) files.binary = binaryFile;
  mkdirSync(outdir, { recursive: true });
  const cases = [];
  for (const [format, file] of Object.entries(files)) {
    const bytes = new Uint8Array(readFileSync(file));
    const original = `orig_${format}.sldd`;
    writeFileSync(join(outdir, original), bytes);
    for (const row of cscDictEdits(core, bytes, original)) {
      const name = row.save ? `${format}_${row.id}.sldd` : null;
      if (name) writeFileSync(join(outdir, name), row.save);
      cases.push({ format, original, originalSha256: sha(bytes), id: row.id, key: row.key, value: row.value, file: name, sha256: row.sha256, refused: row.refused });
    }
  }
  writeFileSync(join(outdir, 'cases.json'), JSON.stringify(cases, null, 1) + '\n');
  console.log(`WROTE ${cases.length} cases to ${outdir}`);
}
