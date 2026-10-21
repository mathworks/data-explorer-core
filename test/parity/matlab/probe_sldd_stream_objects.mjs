// Copyright 2026 The MathWorks, Inc.
//
// The live gate for an edit of an object's property INSIDE a dictionary value's MAT stream: does
// MATLAB read back what core saves?
//
// A compressed-binary dictionary holds an entry's whole Value as `Encoding="hex"`, the bytes of
// getByteStreamFromArray(value), when the value holds a sparse array; every Simulink.Parameter and
// Simulink.Signal in it rides in the stream's subsystem. Core pastes such an entry into a text
// dictionary as the cdata of the same stream. Core edits an allow-listed property of one of those
// objects by swapping its subsystem cell (mcosStreamEdit), and writes the stream again: the value's
// bytes as they were, the new subsystem after them, EncodedLength its exact byte count.
//
// Two halves, one manifest between them (PROBE_OUT must be ABSOLUTE):
//
//   npm run build
//   env PROBE_OUT=/tmp/sldd-stream node test/parity/matlab/probe_sldd_stream_objects.mjs
//   env PROBE_OUT=/tmp/sldd-stream mw -using Bmain matlab -nodesktop \
//       -batch "run('$PWD/test/parity/matlab/probe_sldd_stream_objects.m')"
//
// This half makes every save through the session, as a host makes it (setActive, then
// editProperty, addChildTo, deleteNodeById, undo), and writes the saves, the originals they were
// made from and manifest.json. The MATLAB half opens each save and reads every entry, and holds
// it to the original with the same edit made in MATLAB (closeAll first; nothing is saved).
//
// The cases (CASES): each one save of the binary fixture (fixtures/sldd-stream-objects), or of
// the text dictionary made of it (the fixture's text dictionary with every stream entry of the
// binary one pasted in, saved by core: `orig_text.sldd`, which MATLAB is asked about as a control
// too). Controls must PASS: a save of nothing, an edit undone. The negative control must FAIL: a
// save MATLAB is told to expect another value of. test/slddStreamObjects.test.ts makes the same
// saves from the package's source.

/**
 * One edit: at the node with MATLAB path `path`, the property `prop` set to `text`, or (`op`) a
 * row added to it or its child `child` removed, or the edit before undone or redone. `matlab` is the
 * same edit in MATLAB, of `v`, the entry's value. And (`op: 'same'`) no edit, but a check of the
 * session: the node at `path` shows what the node at `as` does, row for row, as two nodes of one
 * handle must, which MATLAB loads as one object.
 */
export const CASES = [
  { name: 'sPh_value', format: 'bin', edits: [{ path: 'sPh.p', prop: 'Value', text: '7', matlab: 'v.p.Value = 7;' }], cells: 1 },
  { name: 'sPh_description', format: 'bin', edits: [{ path: 'sPh.p', prop: 'Description', text: 'new description', matlab: "v.p.Description = 'new description';" }], cells: 1 },
  { name: 'sPh_description_empty', format: 'bin', edits: [{ path: 'sPh.p', prop: 'Description', text: '', matlab: "v.p.Description = '';" }], cells: 1 },
  {
    name: 'sPh_bounds',
    format: 'bin',
    edits: [
      { path: 'sPh.p', prop: 'Min', text: '-2', matlab: 'v.p.Min = -2;' },
      { path: 'sPh.p', prop: 'Max', text: '20', matlab: 'v.p.Max = 20;' },
    ],
    cells: 2,
  },
  { name: 'sPh_bound_cleared', format: 'bin', edits: [{ path: 'sPh.p', prop: 'Min', text: '[]', matlab: 'v.p.Min = [];' }], cells: 1 },
  { name: 'sPh_unit', format: 'bin', edits: [{ path: 'sPh.p', prop: 'Unit', text: 'km', matlab: "v.p.DocUnits = 'km';" }], cells: 1 },
  { name: 'sPh_resize', format: 'bin', edits: [{ path: 'sPh.p', prop: 'Value', text: '[1 2 3; 4 5 6]', matlab: 'v.p.Value = [1 2 3; 4 5 6];' }], cells: 2 },
  { name: 'cPh_element', format: 'bin', edits: [{ path: 'cPh{1}.Value(2)', prop: 'Value', text: '20', matlab: 'v{1}.Value(2) = 20;' }], cells: 1 },
  { name: 'cPh_add_element', format: 'bin', edits: [{ path: 'cPh{1}.Value', op: 'add', matlab: 'v{1}.Value = [1 2 3 0];' }], cells: 2 },
  { name: 'cPh_remove_element', format: 'bin', edits: [{ path: 'cPh{1}.Value', op: 'remove', child: 'cPh{1}.Value(3)', matlab: 'v{1}.Value = [1 2];' }], cells: 2 },
  { name: 'cPh_description', format: 'bin', edits: [{ path: 'cPh{1}', prop: 'Description', text: 'c2', matlab: "v{1}.Description = 'c2';" }], cells: 1 },
  { name: 'sTh_value_double', format: 'bin', edits: [{ path: 'sTh.t', prop: 'Value', text: '3.5', matlab: 'v.t.Value = 3.5;' }], cells: 2 },
  { name: 'sTh_max', format: 'bin', edits: [{ path: 'sTh.t', prop: 'Max', text: '50', matlab: 'v.t.Max = 50;' }], cells: 1 },
  { name: 'pSp_description', format: 'bin', edits: [{ path: 'pSp', prop: 'Description', text: 'sparse described', matlab: "v.Description = 'sparse described';" }], cells: 1 },
  { name: 'pSp_min', format: 'bin', edits: [{ path: 'pSp', prop: 'Min', text: '0', matlab: 'v.Min = 0;' }], cells: 1 },
  {
    name: 'sigH_all',
    format: 'bin',
    edits: [
      { path: 'sigH.sig', prop: 'Min', text: '-4', matlab: 'v.sig.Min = -4;' },
      { path: 'sigH.sig', prop: 'Max', text: '6', matlab: 'v.sig.Max = 6;' },
      { path: 'sigH.sig', prop: 'Description', text: 's2', matlab: "v.sig.Description = 's2';" },
      { path: 'sigH.sig', prop: 'Unit', text: 'mV', matlab: "v.sig.DocUnits = 'mV';" },
      { path: 'sigH.sig', prop: 'DataType', text: 'single', matlab: "v.sig.DataType = 'single';" },
    ],
    cells: 5,
  },
  { name: 'shared_value', format: 'bin', edits: [{ path: 'shared.a', prop: 'Value', text: '40', matlab: 'v.a.Value = 40;' }, { op: 'same', path: 'shared.b', as: 'shared.a' }], cells: 1 },
  // A handle two fields share, edited through one of them, in every way an edit of a Value is made:
  // each shown by the other at once, and written once.
  {
    name: 'shared_steps',
    format: 'bin',
    edits: [
      { path: 'shared.b', prop: 'Value', text: '[1 2 3]', matlab: 'v.b.Value = [1 2 3];' },
      { path: 'shared.b.Value(2)', prop: 'Value', text: '9', matlab: 'v.b.Value(2) = 9;' },
      { path: 'shared.b.Value', op: 'add', matlab: 'v.b.Value = [1 9 3 0];' },
      { path: 'shared.b', prop: 'Description', text: 'twice held', matlab: "v.b.Description = 'twice held';" },
      { op: 'same', path: 'shared.a', as: 'shared.b' },
    ],
    cells: 3,
  },
  {
    name: 'shared_undo_redo',
    format: 'bin',
    edits: [
      { path: 'shared.a', prop: 'Value', text: '41', matlab: 'v.a.Value = 41;' },
      { path: 'shared.a', prop: 'Description', text: 'gone again', matlab: '' },
      { op: 'undo' },
      { op: 'undo' },
      { op: 'redo' },
      { op: 'same', path: 'shared.b', as: 'shared.a' },
    ],
    cells: 1,
  },
  {
    name: 'arr_two',
    format: 'bin',
    edits: [
      { path: 'arr.ps(1)', prop: 'Value', text: '10', matlab: 'v.ps(1).Value = 10;' },
      { path: 'arr.ps(2)', prop: 'Description', text: 'zwei', matlab: "v.ps(2).Description = 'zwei';" },
    ],
    cells: 2,
  },
  { name: 'nested_value', format: 'bin', edits: [{ path: 'nested.inner.p', prop: 'Value', text: '9', matlab: 'v.inner.p.Value = 9;' }], cells: 2 },
  { name: 'pStruct_field', format: 'bin', edits: [{ path: 'pStruct.p.Value.a', prop: 'Value', text: '11', matlab: 'v.p.Value.a = 11;' }], cells: 1 },
  { name: 'pStruct_element', format: 'bin', edits: [{ path: 'pStruct.p.Value.b(2)', prop: 'Value', text: '30', matlab: 'v.p.Value.b(2) = 30;' }], cells: 1 },
  { name: 'pStruct_add_field', format: 'bin', edits: [{ path: 'pStruct.p.Value', op: 'add', matlab: 's = v.p.Value; s.field = 0; v.p.Value = s;' }], cells: 1 },
  { name: 'pStruct_remove_field', format: 'bin', edits: [{ path: 'pStruct.p.Value', op: 'remove', child: 'pStruct.p.Value.b', matlab: "v.p.Value = rmfield(v.p.Value, 'b');" }], cells: 1 },
  { name: 'pStruct_rename_field', format: 'bin', edits: [{ path: 'pStruct.p.Value.a', prop: 'Name', text: 'aa', matlab: "v.p.Value = struct('aa', 1, 'b', [2 3]);" }], cells: 1 },
  {
    name: 'two_entries',
    format: 'bin',
    edits: [
      { path: 'sPh.p', prop: 'Value', text: '8', matlab: 'v.p.Value = 8;' },
      { path: 'cPh{1}', prop: 'Description', text: 'both', matlab: "v{1}.Description = 'both';" },
    ],
    cells: 1,
  },
  { name: 'control_identity', format: 'bin', edits: [], cells: 0, control: true },
  { name: 'control_undo', format: 'bin', edits: [{ path: 'sPh.p', prop: 'Value', text: '7', matlab: '' }, { op: 'undo' }], cells: 0, control: true },
  {
    name: 'neg_wrong_expectation',
    format: 'bin',
    edits: [{ path: 'sPh.p', prop: 'Value', text: '7', matlab: 'v.p.Value = 8;' }],
    cells: 1,
    expectFail: true,
  },

  { name: 'txt_sPh_value', format: 'txt', edits: [{ path: 'sPh.p', prop: 'Value', text: '7', matlab: 'v.p.Value = 7;' }], cells: 1 },
  { name: 'txt_sPh_resize', format: 'txt', edits: [{ path: 'sPh.p', prop: 'Value', text: '[1 2 3; 4 5 6]', matlab: 'v.p.Value = [1 2 3; 4 5 6];' }], cells: 2 },
  { name: 'txt_pSp_description', format: 'txt', edits: [{ path: 'pSp', prop: 'Description', text: 'sparse described', matlab: "v.Description = 'sparse described';" }], cells: 1 },
  {
    name: 'txt_sigH_bounds',
    format: 'txt',
    edits: [
      { path: 'sigH.sig', prop: 'Min', text: '-4', matlab: 'v.sig.Min = -4;' },
      { path: 'sigH.sig', prop: 'Max', text: '6', matlab: 'v.sig.Max = 6;' },
    ],
    cells: 2,
  },
  { name: 'txt_cPh_element', format: 'txt', edits: [{ path: 'cPh{1}.Value(2)', prop: 'Value', text: '20', matlab: 'v{1}.Value(2) = 20;' }], cells: 1 },
  { name: 'txt_shared_value', format: 'txt', edits: [{ path: 'shared.a', prop: 'Value', text: '40', matlab: 'v.a.Value = 40;' }, { op: 'same', path: 'shared.b', as: 'shared.a' }], cells: 1 },
  {
    name: 'txt_shared_steps',
    format: 'txt',
    edits: [
      { path: 'shared.b', prop: 'Value', text: '[1 2 3]', matlab: 'v.b.Value = [1 2 3];' },
      { path: 'shared.b.Value(2)', prop: 'Value', text: '9', matlab: 'v.b.Value(2) = 9;' },
      { path: 'shared.b.Value', op: 'add', matlab: 'v.b.Value = [1 9 3 0];' },
      { path: 'shared.b', prop: 'Description', text: 'twice held', matlab: "v.b.Description = 'twice held';" },
      { op: 'same', path: 'shared.a', as: 'shared.b' },
    ],
    cells: 3,
  },
  { name: 'txt_pStruct_field', format: 'txt', edits: [{ path: 'pStruct.p.Value.a', prop: 'Value', text: '11', matlab: 'v.p.Value.a = 11;' }], cells: 1 },
  { name: 'txt_nested_value', format: 'txt', edits: [{ path: 'nested.inner.p', prop: 'Value', text: '9', matlab: 'v.inner.p.Value = 9;' }], cells: 2 },
  { name: 'txt_control_identity', format: 'txt', edits: [], cells: 0, control: true },
  // The binary entry edited, then pasted into the text dictionary: its cdata is the edited stream.
  { name: 'txt_paste_edited', format: 'paste', edits: [{ path: 'sPh.p', prop: 'Description', text: 'pasted edit', matlab: "v.p.Description = 'pasted edit';" }], cells: 1 },
];

const ab = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
const subtree = (n) => [n, ...n.children.flatMap(subtree)];

/** The entry of `root`'s Design Data the node at MATLAB path `path` is in, by the path's leading name. */
export const entryOfPath = (path) => /^[A-Za-z]\w*/.exec(path)[0];

function nodeAt(root, path) {
  for (const entry of root.getSection('design').children) {
    for (const node of subtree(entry)) {
      if (node.matlabPath === path) {
        return node;
      }
    }
  }
  throw new Error('no node ' + path);
}

// What a node of an object shows, and every row under it, each by its path below the node: what
// two nodes of one handle must show alike.
function shownRows(node) {
  const at = node.matlabPath.length;
  return subtree(node).map((n) => [n.matlabPath.slice(at), n.displayValue, n.Description, n.Min, n.Max, n.Unit, n.DataType].join(' | '));
}

/** Every edit of `edits` made on `root` through `session`, as a host makes it; throws on a refusal or a check that fails. */
export function applyEdits(session, root, edits) {
  for (const e of edits) {
    if (e.op === 'undo' || e.op === 'redo') {
      session[e.op]();
      continue;
    }
    if (e.op === 'same') {
      const [mine, theirs] = [shownRows(nodeAt(root, e.path)), shownRows(nodeAt(root, e.as))];
      if (JSON.stringify(mine) !== JSON.stringify(theirs)) {
        throw new Error(e.path + ' does not show what ' + e.as + ' does: ' + JSON.stringify(mine) + ' vs ' + JSON.stringify(theirs));
      }
      continue;
    }
    const node = nodeAt(root, e.path);
    session.setActive(root, node);
    let ok;
    if (e.op === 'add') {
      ok = session.addChildTo(node.id) ? true : 'refused';
    } else if (e.op === 'remove') {
      ok = session.deleteNodeById(nodeAt(root, e.child).id) ? true : 'refused';
    } else {
      ok = session.editProperty(node.id, e.prop, e.text);
    }
    if (ok !== true) {
      throw new Error((e.op ?? e.prop) + ' at ' + e.path + ' was refused: ' + JSON.stringify(ok));
    }
  }
}

/** The binary dictionary's stream entries pasted into the text one, as a host pastes them (the entry's serialize(), deep-copied). */
export function pasteStreams(binaryRoot, textRoot) {
  for (const entry of binaryRoot.getSection('design').children) {
    const tag = entry.serialize();
    if (!tag || typeof tag !== 'object' || !tag.value || tag.value._type !== 'encoded') {
      continue;
    }
    textRoot.getSection('design').parseEntry(JSON.parse(JSON.stringify(tag)));
  }
}

/**
 * Every case's save, made with `core` ({ createSession, ingest }) from the fixture's bytes
 * (`binary`, `text`): { files, cases }, `files` the saves and the two originals by name, `cases`
 * one row per case naming its original and its save.
 */
export function streamObjectSaves(core, { binary, text }) {
  const { createSession, ingest } = core;
  const open = (bytes, filename) => {
    const session = createSession();
    const root = ingest(session, ab(bytes), { filename });
    session.setActiveContext(root);
    return { session, root };
  };
  const files = { 'orig_bin.sldd': binary };
  // The text original: the fixture's text dictionary with the binary one's stream entries pasted in.
  const pasted = (edits) => {
    const session = createSession();
    const bin = ingest(session, ab(binary), { filename: 'orig_bin.sldd' });
    const txt = ingest(session, ab(text), { filename: 'orig_text.sldd' });
    session.setActiveContext(bin);
    applyEdits(session, bin, edits);
    pasteStreams(bin, txt);
    return new TextEncoder().encode(session.serializeSource(txt.name).text);
  };
  files['orig_text.sldd'] = pasted([]);
  const cases = [];
  for (const c of CASES) {
    const file = c.name + '.sldd';
    let bytes;
    if (c.format === 'paste') {
      bytes = pasted(c.edits);
    } else {
      const original = c.format === 'bin' ? 'orig_bin.sldd' : 'orig_text.sldd';
      const { session, root } = open(files[original], original);
      applyEdits(session, root, c.edits);
      const out = session.serializeSource(root.name);
      bytes = out.kind === 'binary' ? out.bytes : new TextEncoder().encode(out.text);
    }
    files[file] = bytes;
    cases.push({
      name: c.name,
      format: c.format === 'bin' ? 'bin' : 'txt',
      original: c.format === 'bin' ? 'orig_bin.sldd' : 'orig_text.sldd',
      file,
      edits: c.edits.filter((e) => e.matlab).map((e) => ({ entry: entryOfPath(e.path), matlab: e.matlab })),
      control: !!c.control,
      expectFail: !!c.expectFail,
    });
  }
  return { files, cases };
}

// As a script: the saves, the originals and manifest.json into PROBE_OUT, from the built package.
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  const { mkdirSync, readFileSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { createSession, ingest } = await import('../../../dist/index.js');
  const out = process.env.PROBE_OUT || '/tmp/sldd-stream-objects-probe';
  mkdirSync(out, { recursive: true });
  const fixture = (name) => new Uint8Array(readFileSync(new URL('../../fixtures/sldd-stream-objects/' + name, import.meta.url)));
  const { files, cases } = streamObjectSaves(
    { createSession, ingest },
    { binary: fixture('stream_objects_binary.sldd'), text: fixture('stream_objects_text.sldd') },
  );
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(join(out, name), bytes);
  }
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(cases, null, 2) + '\n');
  console.log('wrote ' + cases.length + ' cases and ' + Object.keys(files).length + ' files to ' + out);
}
