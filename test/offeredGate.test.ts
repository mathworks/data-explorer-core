// Copyright 2026 The MathWorks, Inc.
//
// An edit is taken exactly where the row offers its editor (DataNode._offerRefusal, S9 of the
// 2026-10-26 edit bash). A row's editor is what the table and the Property Inspector read of it:
// its Value cell (`_valueEditable`, or the cell's own `editable`), its Name cell, its Description
// (`_descriptionEditable` of an object that has one), and any other key a column or a Property
// Inspector row shows editable (getPropInfo). The API took edits no row offered: a MAT-file's struct
// took a number typed over it, a struct array's element one its save wrote as fields named '1' and
// '2', or emptied; a bus took a Value its save then refused; a <missing> string, an N-D array and a
// sparse matrix took a Value, in every format; a dictionary's Signal, Bus and NumericType took one
// and wrote nothing; and a dictionary's Dimensions and Complexity, typed as the text they show,
// answered true and changed nothing.
//
// Over the parity fixtures of every format, every row, every key it shows and a few it does not:
// each key the row does not offer is refused, through the node's setter (the dictionaries' editors)
// and through the session (the MAT-file's editor), whatever the text, its own shown text included,
// in words, and the file is as it was read; each key it offers takes its own shown text as no edit.
// And over every MAT-file and dictionary of the tests, every row's Value the same way.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import '../src/datamodel/node/data/NodeClassMap.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TEST = fileURLToPath(new URL('.', import.meta.url));

const DEEP = [
  'fixtures/edit-bash/r2027a/values.mat',
  'fixtures/edit-bash/r2027a/handles.mat',
  'fixtures/edit-bash/r2027a/values_text.sldd',
  'fixtures/edit-bash/r2027a/values_binary.sldd',
  'fixtures/edit-bash/r2023b/values.mat',
  'fixtures/edit-bash/r2023b/handles.mat',
  'fixtures/edit-bash/r2023b/values_binary.sldd',
  'parity/artifacts/mat/cases.mat',
  'parity/artifacts/text/cases.sldd',
  'parity/artifacts/binary/cases.sldd',
  'parity/artifacts/text/params.sldd',
  'parity/artifacts/binary/params.sldd',
  'fixtures/sldd-stream-objects/stream_objects_binary.sldd',
  'fixtures/sldd-stream-objects/stream_objects_text.sldd',
];

// Keys no row of most nodes shows, which the setters took all the same.
const UNSHOWN = ['Bogus', 'Dimensions', 'Complexity', 'dimensions', 'complexity', 'DataType', 'Min', 'Max', 'Unit', 'value'];

function opened(rel: string) {
  const bytes = new Uint8Array(readFileSync(join(TEST, rel)));
  const session = createSession();
  const filename = rel.split('/').pop()!;
  const root: any = ingest(session, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { filename });
  const save = (): string => {
    const out: any = session.serializeSource(root.name);
    return out.kind === 'text' ? out.text : Buffer.from(out.bytes).toString('base64');
  };
  return { session, root, save };
}

// The file opened, or null where it is not read at all.
function openedIfRead(rel: string): ReturnType<typeof opened> | null {
  try {
    return opened(rel);
  } catch {
    return null;
  }
}

const cellText = (cell: any): string => (cell && typeof cell === 'object' ? String(cell.text ?? cell.label ?? '') : String(cell ?? ''));

/** The props of `node` a key names, as the setters find them: by key, by column, by the field it writes. */
function propsNamed(node: any, key: string): any[] {
  const props = node.getProperties();
  const named = props.filter((p: any) => p.key === key || p.column === key);
  return named.length > 0 ? named : props.filter((p: any) => p.nodeProperty === key);
}

/** Whether the row of `node` offers an editor of `key`, and the text it shows for it, as a host reads them. */
function offerOf(node: any, key: string): { offered: boolean; shown: string } {
  const row = node.toRow() ?? {};
  const named = propsNamed(node, key);
  const column = named[0]?.column || named[0]?.key || (key === 'name' ? 'Name' : key);
  if (column === 'Value') {
    const offered = row.Value && typeof row.Value === 'object' ? row.Value.editable === true : row._valueEditable === true;
    return { offered, shown: cellText(row.Value) };
  }
  if (column === 'Name') {
    return { offered: row.Name?.editable === true, shown: cellText(row.Name) };
  }
  if (column === 'Description') {
    return { offered: row._descriptionApplies !== false && row._descriptionEditable === true, shown: String(row.Description ?? '') };
  }
  const shown = (p: any) => {
    try {
      return node.getPropInfo(p);
    } catch {
      return { editable: false, displayValue: '' };
    }
  };
  const rows = [...named, ...(node.getPILayout() ?? []).flatMap((g: any) => g.items).filter((p: any) => p.key === key)];
  const infos = rows.map(shown);
  return { offered: infos.some((i: any) => i.editable), shown: String(infos[0]?.displayValue ?? '') };
}

/** Every key a row of `node` shows, and those of UNSHOWN. */
function keysOf(node: any): string[] {
  const keys = new Set<string>(['Value', 'Name', 'Description', ...UNSHOWN]);
  for (const p of node.getProperties()) {
    keys.add(p.key);
    if (p.column) keys.add(p.column);
  }
  for (const g of node.getPILayout() ?? []) for (const p of g.items) keys.add(p.key);
  return [...keys];
}

/** Texts typed into a key a row does not offer: one each setter took, and what the row shows. */
function textsFor(key: string, shown: string): string[] {
  const typed = key === 'Name' || key === 'name' ? 'zz_new' : key === 'Value' ? '7' : key === 'Description' ? 'zz' : "'zz'";
  return [...new Set([typed, ...(key === 'Value' ? ['zeros(0,3)', "'abc'"] : []), shown])];
}

const nodesOf = (root: any): any[] => root.flatten().filter((n: any) => !n.isContainer && typeof n.setProperty === 'function');

describe('an edit is taken exactly where the row offers its editor', () => {
  const totals = { refused: 0, offered: 0, files: 0 };

  for (const rel of DEEP) {
    it(rel, { timeout: 120_000 }, () => {
      const node$ = opened(rel);
      const session$ = opened(rel);
      const untouched = node$.save();
      const wrong: string[] = [];
      let dirtied = false;
      const sessionNodes = new Map(nodesOf(session$.root).map((n: any) => [n.id, n]));
      for (const node of nodesOf(node$.root)) {
        for (const key of keysOf(node)) {
          const { offered, shown } = offerOf(node, key);
          const label = `${node.matlabPath} ${key}`;
          if (offered) {
            // Its own shown text, committed unchanged, is no edit.
            const r = node.setProperty(key, shown);
            if (r !== true) wrong.push(`${label} is offered, and its own text ${JSON.stringify(shown)} is refused: ${r?.reason}`);
            if (node$.root.dirty && !dirtied) {
              dirtied = true;
              wrong.push(`${label} is offered, and its own text ${JSON.stringify(shown)} marked the file edited`);
            }
            totals.offered++;
            continue;
          }
          const twin: any = sessionNodes.get(node.id);
          for (const text of textsFor(key, shown)) {
            const set = node.setProperty(key, text);
            if (set === true || !set?.error || !String(set.reason ?? '').trim()) {
              wrong.push(`${label} = ${JSON.stringify(text)}: not offered, and setProperty answered ${JSON.stringify(set)}`);
            }
            if (node$.root.dirty && !dirtied) {
              dirtied = true;
              wrong.push(`${label} = ${JSON.stringify(text)}: not offered, refused, and marked the file edited`);
            }
            if (twin) {
              session$.session.setActive(session$.root, twin);
              const edited: any = session$.session.editProperty(twin.id, key, text);
              if (edited === true || !edited?.error || !String(edited.reason ?? '').trim()) {
                wrong.push(`${label} = ${JSON.stringify(text)}: not offered, and editProperty answered ${JSON.stringify(edited)}`);
              }
              if (session$.session.isUnchangedEdit(twin.id, key, text)) {
                wrong.push(`${label} = ${JSON.stringify(text)}: not offered, and isUnchangedEdit says it is no edit`);
              }
            }
            totals.refused++;
          }
        }
      }
      expect(wrong.slice(0, 40)).toEqual([]);
      expect(wrong.length).toBe(0);
      // Nothing any refusal or any unchanged text did changed the file, by either route.
      expect([node$.root.dirty, session$.root.dirty, session$.session.canUndo()]).toEqual([false, false, false]);
      expect(node$.save() === untouched, 'the file as it was read, after every edit through the node').toBe(true);
      expect(session$.save() === untouched, 'the file as it was read, after every edit through the session').toBe(true);
      totals.files++;
    });
  }

  it('reaches both kinds over every format', () => {
    expect(totals.files).toBe(DEEP.length);
    // Measured when this was written.
    expect(totals.offered).toBeGreaterThanOrEqual(4000);
    expect(totals.refused).toBeGreaterThanOrEqual(70000);
  });
});

describe("a dictionary's setter, called past the gate, refuses a Value no row offers as the gate does", () => {
  it('in the words session.valueEditRefusal says of the row', () => {
    // The undo's and the redo's setter (DataNode._setProperty), whose tail asks _unofferedKeyRefusal.
    const { session, root } = opened('fixtures/edit-bash/r2027a/values_text.sldd');
    for (const n of nodesOf(root).filter((x: any) => ['sig', 'numType', 'bus'].includes(x.matlabPath))) {
      const gate = n.setProperty('Value', '7');
      expect(n._setProperty('Value', '7'), n.matlabPath).toEqual(gate);
      expect(gate.reason, n.matlabPath).toBe(session.valueEditRefusal(n.id));
    }
  });
});

/** Every MAT-file and dictionary under `dir`, the large ones and the parity fixtures apart. */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...filesUnder(p));
    } else if (/\.(mat|sldd)$/.test(e.name) && statSync(p).size < 2_000_000) {
      out.push(p.slice(TEST.length));
    }
  }
  return out.sort();
}

describe("over every MAT-file and dictionary of the tests, a row's Value is taken exactly where the row offers its editor", () => {
  it('a Value no row offers an editor of is refused through the node and through the session, and changes nothing', { timeout: 600_000 }, () => {
    const wrong: string[] = [];
    let refused = 0;
    let files = 0;
    for (const rel of filesUnder(TEST).filter((f) => !DEEP.includes(f))) {
      const o = openedIfRead(rel);
      if (!o) continue;
      files++;
      const nodes = nodesOf(o.root);
      // Every row of a small file; of a large one, a stride through it.
      const stride = Math.max(1, Math.ceil(nodes.length / 400));
      for (let i = 0; i < nodes.length; i += stride) {
        const node = nodes[i];
        let offer: { offered: boolean; shown: string };
        try {
          offer = offerOf(node, 'Value');
        } catch {
          continue;
        }
        if (offer.offered) continue;
        const set = node.setProperty('Value', '7');
        if (set === true || !set?.error) wrong.push(`${rel} ${node.matlabPath}: not offered, and setProperty answered ${JSON.stringify(set)}`);
        o.session.setActive(o.root, node);
        // (False where two rows answer to its id, which the session edits neither of.)
        const edited: any = o.session.editProperty(node.id, 'Value', '7');
        if (edited === true) wrong.push(`${rel} ${node.matlabPath}: not offered, and editProperty answered true`);
        refused++;
      }
      if (o.root.dirty) wrong.push(`${rel}: marked edited by a refused edit`);
    }
    expect(wrong.slice(0, 40)).toEqual([]);
    // Measured when this was written.
    expect(files).toBeGreaterThanOrEqual(650);
    expect(refused).toBeGreaterThanOrEqual(5000);
  });
});

// And the other way: an editor a row offers takes some value of it. A Storage Class offered where the
// object held no CoderInfo for it to be written into, and a Unit of a Parameter whose Value the
// dictionary's rules do not read, were offered and refused whatever was chosen (the review of
// offered-gate): each is now shown read-only, and refused in its own words.
describe('over every MAT-file and dictionary of the tests, a select or a Unit a row offers takes one of its values', () => {
  it('each offered dropdown takes one of its other options, and each offered Unit a unit', { timeout: 600_000 }, () => {
    const wrong: string[] = [];
    let taken = 0;
    for (const rel of filesUnder(TEST)) {
      const o = openedIfRead(rel);
      if (!o) continue;
      // One session for the file, each row's offer read as it stands when it is edited: an edit of
      // one node of an object two variables hold leaves the other's read-only (MatNode's twins).
      for (const node of nodesOf(o.root)) {
        for (const p of node.getProperties()) {
          if (p.key === 'Name' || p.key === 'Value' || p.key === 'Description') continue;
          let info: any;
          try {
            info = node.getPropInfo(p);
          } catch {
            continue;
          }
          if (!info.editable) continue;
          const candidates = info.editor === 'select' ? (info.options ?? []).filter((x: string) => x !== info.displayValue).slice(0, 3) : p.key === 'Unit' ? ['m'] : [];
          if (candidates.length === 0) continue;
          const answers = candidates.map((text: string) => {
            o.session.setActive(o.root, node);
            return o.session.editProperty(node.id, p.key, text);
          });
          if (answers.some((a: any) => a === true)) {
            taken++;
          } else {
            wrong.push(`${rel} ${node.matlabPath} ${p.key}: offered, and refused ${JSON.stringify(candidates)}: ${answers.map((a: any) => a?.reason ?? a).join(' | ')}`);
          }
        }
      }
    }
    expect(wrong.slice(0, 20)).toEqual([]);
    // Measured when this was written.
    expect(taken).toBeGreaterThanOrEqual(2400);
  });
});
