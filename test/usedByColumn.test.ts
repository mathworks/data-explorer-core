// test/usedByColumn.test.ts
// Copyright 2026 The MathWorks, Inc.
//
// The `UsedBy` column, finally assigned.
//
// `RowData.UsedBy` was declared on the row type, listed in the column layout of every
// section — labelled `Usage` on a model — and named in DEDICATED_COLUMNS, and nothing
// in this package ever put a value in it. So the one question a data explorer exists to
// answer, "what uses this?", rendered as an empty column in every host.
//
// The material was all there: both model readers publish `blockParamUsages`, and
// session.findUsages() turns that into the reverse projection. What was missing was the
// bridge from a session-level index to a row, because a node has no reference to the
// session and `toRow()` is a projection HOSTS call — nothing in `src/` calls it at all.
//
// This suite is about that bridge, and about the two decisions it forces:
//
//   - the cell's own shape and text. Always the multi-link `{ links: [...] }` arm, even
//     for one usage, and the text is the block's NAME and nothing else — the least
//     opinionated label available, because it is the only one of NodeUsage's four facts
//     that is a display name at all.
//   - what a definition NOTHING uses gets. Nothing: no `UsedBy` key on the row. An
//     empty `links` array would assert "asked, and nothing uses this", which this
//     package cannot honestly claim while the models that use it may simply not be open.
//
// And about the cost. The per-row path costs one scan of the open models' usage lists
// per row, so session.rowsOf() exists to project a whole table in one pass; the last
// describe here holds that to a counted number of scans rather than to a comment.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

function artifact(rel: string): ArrayBuffer {
  const u8 = new Uint8Array(readFileSync(fileURLToPath(new URL(`./parity/artifacts/${rel}`, import.meta.url))));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

function fixtureBytes(name: string): ArrayBuffer {
  const u8 = new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

function paramsJson(): any {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL('./parity/artifacts/text/params.sldd', import.meta.url)), 'utf8'),
  );
}

// An in-memory `.slx` holding only what a link needs — the same builder
// resolveLink.test.ts uses, so these sessions go through the real parser and the real
// ingest path rather than through a hand-assembled ModelNode.
function slxModel(dictionary: string | null, blocksXml: string, workspaceMat?: string): ArrayBuffer {
  const diagram: Record<string, unknown> = { ModelUUID: 'u1' };
  if (dictionary) {
    diagram.DataDictionary = dictionary;
  }
  if (workspaceMat) {
    diagram.ModelWorkspace = { WSDataSource: 'MAT-File', WSSourceFileName: workspaceMat };
  }
  const parts: Record<string, Uint8Array> = {
    'simulink/blockDiagram.json': strToU8(JSON.stringify({ BlockDiagram: diagram })),
    'simulink/systems/system_root.xml': strToU8(
      `<?xml version="1.0" encoding="utf-8"?><System>${blocksXml}</System>`,
    ),
    'metadata/coreProperties.xml': strToU8(
      `<?xml version="1.0"?><coreProperties><version>R2026b</version></coreProperties>`,
    ),
  };
  const zipped = zipSync(parts);
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

const block = (name: string, type: string, prop: string, value: string) =>
  `<Block BlockType="${type}" Name="${name}" SID="${name}"><P Name="${prop}">${value}</P></Block>`;

// The item's own example, assembled from the two fixtures it names: mdlcases.mdl is a
// real harvested model whose `Const` (Constant) block holds `Value = Kp`, and whose
// linked dictionary is recorded as `mdlparams.sldd`. That dictionary was never harvested
// (only its NAME is in the model file), so compressed.sldd's bytes are opened UNDER that
// name — it holds exactly one design entry, `Kp`, which makes it the dictionary the model
// was always describing. Opening bytes under a chosen srcId is what a host does anyway.
function itemFourSession() {
  const s = createSession();
  ingest(s, artifact('mdl/mdlcases.mdl'), { filename: 'mdlcases.mdl' });
  ingest(s, fixtureBytes('compressed.sldd'), { filename: 'mdlparams.sldd' });
  return s;
}

// params.sldd (40-odd entries, including `gravity`, `sig1` and `MyBus`) under the name a
// model records, for the cases that need a dictionary with more than one entry in it.
function openParamsAs(s: any, srcId = 'mdlparams.sldd') {
  return ingest(s, artifact('text/params.sldd'), { filename: srcId }) as any;
}

// The `UsedBy` cell off a node's own row — the projection a host calls, unchanged.
function usedByOf(s: any, nodeId: string): any {
  const node = s.findNodeById(nodeId);
  expect(node, nodeId).not.toBe(null);
  return node.toRow().UsedBy;
}

// Every link's text and target, flattened for comparison.
function linksOf(cell: any): string[] {
  return cell.links.map((l: any) => `${l.text} -> ${l.linkTarget}`);
}

describe('UsedBy — the reverse projection, in the row a host already renders', () => {
  it('says which block uses a dictionary entry, and links to that block', () => {
    const s = itemFourSession();
    // Verbatim the sentence item 4 asks for: `Kp` in mdlparams.sldd is used by `Const`
    // in mdlcases.mdl. Read off the row projection, not off findUsages, because the
    // column being blank in a host that calls toRow() was the whole defect.
    expect(usedByOf(s, 'mdlparams.sldd/design/Kp')).toEqual({
      links: [{ text: 'Const', linkTarget: 'Const@mdlcases.mdl' }],
    });
  });

  it('uses the multi-link shape for a single usage too', () => {
    const s = itemFourSession();
    const cell = usedByOf(s, 'mdlparams.sldd/design/Kp');
    // RowData.UsedBy permits three arms — a string, one `{ text, linkTarget }`, or
    // `{ links: [...] }`. Only the last is ever produced, INCLUDING for one usage: a
    // host that had to test `'links' in cell` would branch on cell count, and the branch
    // it forgets is the single-usage one, which is the common case.
    expect(Array.isArray(cell.links)).toBe(true);
    expect(cell.links).toHaveLength(1);
    expect('text' in cell).toBe(false);
    expect('linkTarget' in cell).toBe(false);
  });

  it('carries a linkTarget the same session resolves back to the block node', () => {
    const s = itemFourSession();
    const cell: any = usedByOf(s, 'mdlparams.sldd/design/Kp');
    // The reverse link is clickable with nothing assembled by the host: the cell's
    // target is the usage's own, and the usage's own is the forward grammar reversed.
    const back = s.resolveLink(cell.links[0].linkTarget);
    expect(back.status).toBe('resolved');
    expect(back.node).toBe(s.findNodeById('mdlcases.mdl/blocks/Const'));
  });

  it('lists every block in one model that references the entry, in the model’s own order', () => {
    const s = createSession();
    ingest(
      s,
      slxModel(
        'mdlparams.sldd',
        block('K1', 'Constant', 'Value', 'gravity') +
          block('K2', 'Gain', 'Gain', '2*gravity') +
          block('K3', 'Constant', 'Value', 'sig1'),
      ),
      { filename: 'many.slx' },
    );
    openParamsAs(s);
    expect(linksOf(usedByOf(s, 'mdlparams.sldd/design/gravity'))).toEqual([
      'K1 -> K1@many.slx',
      'K2 -> K2@many.slx',
    ]);
    // The third block is a usage of a different entry, and lands on that entry's row.
    expect(linksOf(usedByOf(s, 'mdlparams.sldd/design/sig1'))).toEqual(['K3 -> K3@many.slx']);
  });

  it('lists blocks from every open model that can see the entry', () => {
    const s = createSession();
    ingest(s, slxModel('mdlparams.sldd', block('Ka', 'Constant', 'Value', 'gravity')), { filename: 'a.slx' });
    ingest(s, slxModel('mdlparams.sldd', block('Kb', 'Gain', 'Gain', 'gravity')), { filename: 'b.slx' });
    // A third model referencing the same NAME while linked to nothing cannot see this
    // entry, and contributes no link — the visibility rule findUsages enforces, showing
    // through to the cell.
    ingest(s, slxModel(null, block('Loose', 'Constant', 'Value', 'gravity')), { filename: 'none.slx' });
    openParamsAs(s);
    // Two blocks, both named by their own name only. Which MODEL each is in is not in
    // the text: a srcId is the host's key for a file and may be a full path or a URI,
    // so baking it into display text would put a URI in a table cell. It IS in the
    // linkTarget, and the four facts behind the label are in findUsages().
    expect(linksOf(usedByOf(s, 'mdlparams.sldd/design/gravity'))).toEqual([
      'Ka -> Ka@a.slx',
      'Kb -> Kb@b.slx',
    ]);
  });

  it('credits a model-workspace variable referenced through an expression', () => {
    const s = createSession();
    ingest(s, artifact('mdl/mdlcases.mdl'), { filename: 'mdlcases.mdl' });
    // mdlcases.mdl's TransferFcn holds `[tau 1]`, and `tau` is its own model-workspace
    // variable. A whole-string match would leave this row blank, which is exactly the
    // case that made both directions of link resolution read a parameter as an
    // expression rather than as a name.
    expect(usedByOf(s, 'mdlcases.mdl/workspace/tau')).toEqual({
      links: [{ text: 'TF', linkTarget: 'TF@mdlcases.mdl' }],
    });
    // A block in a nested subsystem is a usage the same way — the usages are the
    // model's, not one system's.
    expect(linksOf(usedByOf(s, 'mdlcases.mdl/workspace/inner'))).toEqual(['InnerGain -> InnerGain@mdlcases.mdl']);
  });

  it('credits a dictionary entry referenced through an expression', () => {
    const s = createSession();
    ingest(
      s,
      slxModel(
        'mdlparams.sldd',
        block('Div', 'Gain', 'Gain', '1/gravity') + block('Sel', 'Constant', 'Value', 'MyBus.x'),
      ),
      { filename: 'expr.slx' },
    );
    openParamsAs(s);
    // `1/gravity`: the identifier is neither the whole value nor at its start.
    expect(linksOf(usedByOf(s, 'mdlparams.sldd/design/gravity'))).toEqual(['Div -> Div@expr.slx']);
    // `MyBus.x` is a reference to MyBus — the name the model resolves — so the usage
    // belongs to the entry and not to the bus element under it.
    expect(linksOf(usedByOf(s, 'mdlparams.sldd/design/MyBus'))).toEqual(['Sel -> Sel@expr.slx']);
    expect(usedByOf(s, 'mdlparams.sldd/design/MyBus/x')).toBeUndefined();
  });

  it('credits a .mat variable a model declares as its workspace source', () => {
    const s = createSession();
    // A dictionary is not the only file a model takes definitions from: a model
    // workspace can be sourced from a `.mat`, and those variables are definitions the
    // same way — so the column is filled on a `.mat`'s rows too.
    ingest(s, slxModel(null, block('K', 'Constant', 'Value', 'kp'), 'signals.mat'), { filename: 'ws.slx' });
    ingest(s, artifact('mat/cases.mat'), { filename: 'signals.mat' });
    expect(usedByOf(s, 'signals.mat/kp')).toEqual({ links: [{ text: 'K', linkTarget: 'K@ws.slx' }] });
    // The same bytes open under a name the model does not declare define the same `kp`,
    // and it is not this model's kp — so that row stays blank rather than borrowing one.
    ingest(s, artifact('mat/cases.mat'), { filename: 'unrelated.mat' });
    expect(usedByOf(s, 'unrelated.mat/kp')).toBeUndefined();
  });
});

describe('UsedBy — a definition nothing uses gets no cell at all', () => {
  it('leaves the key off the row rather than writing an empty list or an empty string', () => {
    const s = createSession();
    ingest(s, artifact('mdl/mdlcases.mdl'), { filename: 'mdlcases.mdl' });
    // `label` is in mdlcases.mdl's model workspace and no block parameter mentions it.
    const row: any = (s.findNodeById('mdlcases.mdl/workspace/label') as any).toRow();
    // Absence, not `{ links: [] }` and not `''`. An empty list would assert "asked, and
    // nothing uses this", and this package cannot honestly claim that: with no model
    // open, EVERY entry has zero usages, so the emphatic answer would be wrong for a
    // dictionary whose users are merely not open. Absence is the same reasoning
    // registerSource applies to `warnings` — only stamp when there is something to say.
    expect('UsedBy' in row).toBe(false);
    expect(Object.keys(row)).not.toContain('UsedBy');
    // And the rest of the row is untouched, so a host reading it sees no new shape.
    expect(row.Value).toBe("'hello'");
    expect(row.Kind).toBe('MATLAB Variable');
  });

  it('gives no cell to the nodes the column means nothing for', () => {
    const s = itemFourSession();
    openParamsAs(s, 'other.sldd');
    const rowFor = (id: string) => (s.findNodeById(id) as any).toRow();

    // A struct FIELD is not a definition: `cfg.mode` is a reference to `cfg`, and `cfg`
    // takes the credit.
    expect('UsedBy' in rowFor('mdlcases.mdl/workspace/cfg/mode')).toBe(false);
    // A bus ELEMENT is not a name a block parameter can name.
    expect('UsedBy' in rowFor('other.sldd/design/MyBus/x')).toBe(false);
    // A BLOCK is technically an entry of its model, and "which blocks use this block"
    // is a different question with a different answer shape. Its row still carries the
    // FORWARD link, in DataType, which is where it always was.
    const blockRow = rowFor('mdlcases.mdl/blocks/Const');
    expect('UsedBy' in blockRow).toBe(false);
    expect(blockRow.DataType).toEqual({ text: 'Value=Kp', linkTarget: 'Kp@mdlparams.sldd' });
    // An external-data FILE row is the file-level reverse direction ("which models use
    // this dictionary"), which findUsages deliberately does not answer. Its own forward
    // link is untouched.
    const fileRow = rowFor('mdlcases.mdl/dataSources/mdlparams.sldd');
    expect('UsedBy' in fileRow).toBe(false);
    expect(fileRow.Value).toEqual({ text: 'mdlparams.sldd', linkTarget: 'mdlparams.sldd' });
    // A model REFERENCE row, same reason.
    expect('UsedBy' in rowFor('mdlcases.mdl/references/mdl_child.mdl')).toBe(false);
    // A container projects no row at all, and still does not.
    expect((s.getDataSource('mdlparams.sldd') as any).getSection('design').toRow()).toBe(null);
  });

  it('leaves a node with no session behind it alone', () => {
    // A bare subtree — a node this package built outside any session, which is how most
    // of the suite constructs nodes — has no resolver to reach, so its row is exactly
    // what it was before this change. The projection degrades to silence rather than
    // throwing on the way up to a root that is not a source.
    const dict = paramsJson();
    const s = createSession();
    const attached = s.addDataSource('p.sldd', dict) as any;
    const detached = attached.getSection('design').children[0];
    detached.parent = null;
    expect(() => detached.toRow()).not.toThrow();
    expect('UsedBy' in detached.toRow()).toBe(false);
  });
});

describe('UsedBy — the cell reads the live session', () => {
  it('empties when the referencing model is closed and fills again when it is re-registered', () => {
    const s = createSession();
    ingest(s, slxModel('mdlparams.sldd', block('Ka', 'Constant', 'Value', 'gravity')), { filename: 'a.slx' });
    openParamsAs(s);
    expect(linksOf(usedByOf(s, 'mdlparams.sldd/design/gravity'))).toEqual(['Ka -> Ka@a.slx']);

    s.removeDataSource('a.slx');
    // Not a stale link into a tree the session no longer owns: the row is a projection
    // taken fresh, and the scan behind it is over what is open.
    expect(usedByOf(s, 'mdlparams.sldd/design/gravity')).toBeUndefined();

    // Re-opened under the same srcId with a different block name, which is what a reload
    // after an edit in Simulink looks like.
    ingest(s, slxModel('mdlparams.sldd', block('Kb', 'Gain', 'Gain', 'gravity')), { filename: 'a.slx' });
    expect(linksOf(usedByOf(s, 'mdlparams.sldd/design/gravity'))).toEqual(['Kb -> Kb@a.slx']);
  });

  it('follows the dictionary when the dictionary itself is re-registered', () => {
    const s = createSession();
    ingest(s, slxModel('mdlparams.sldd', block('Ka', 'Constant', 'Value', 'gravity')), { filename: 'a.slx' });
    openParamsAs(s);
    const before = s.findNodeById('mdlparams.sldd/design/gravity');
    s.addDataSource('mdlparams.sldd', paramsJson());
    const after = s.findNodeById('mdlparams.sldd/design/gravity');
    // A new tree for the same file. The resolver is stamped by registerSource, so the
    // incoming root has one too — a row projected from the NEW node is filled, and the
    // outgoing node is not the one the session hands out any more.
    expect(after).not.toBe(before);
    expect(linksOf((after as any).toRow().UsedBy)).toEqual(['Ka -> Ka@a.slx']);
  });
});

describe('session.rowsOf() — a whole table in one pass', () => {
  // Counts reads of a model's `blockParamUsages`, which is the array every usage scan
  // walks. One read per scan, so this counts scans without reaching into the session.
  function countScans(model: any): () => number {
    const list = model.blockParamUsages;
    let reads = 0;
    Object.defineProperty(model, 'blockParamUsages', {
      get() {
        reads++;
        return list;
      },
      configurable: true,
    });
    return () => reads;
  }

  function tableSession() {
    const s = createSession();
    ingest(s, slxModel('mdlparams.sldd', block('Ka', 'Constant', 'Value', 'gravity')), { filename: 'a.slx' });
    const dict = openParamsAs(s);
    return { s, dict, section: dict.getSection('design') };
  }

  it('projects the same rows the per-row path projects', () => {
    const { s, section } = tableSession();
    // The whole subtree a table draws — entries and the struct fields and bus elements
    // under them — projected one node at a time, which is what a host does today.
    const perRow = section
      .flatten()
      .map((n: any) => n.toRow())
      .filter((r: any) => r !== null);
    expect(perRow.length).toBeGreaterThan(section.children.length);
    expect(s.rowsOf(section)).toEqual(perRow);
    // Including the filled cell, which is the point of comparing the two at all.
    const gravity = s.rowsOf(section).find((r: any) => r.ID === 'mdlparams.sldd/design/gravity');
    expect(gravity!.UsedBy).toEqual({ links: [{ text: 'Ka', linkTarget: 'Ka@a.slx' }] });
  });

  it('costs one scan per open model instead of one per row', () => {
    const { s, section } = tableSession();
    const scans = countScans(s.getDataSource('a.slx'));
    const rowCount = section.children.length;
    expect(rowCount).toBeGreaterThan(10);

    // The per-row path: one scan of the model's whole usage list for every row.
    section.children.forEach((n: any) => n.toRow());
    expect(scans()).toBe(rowCount);

    // The batch: the reverse projection is built once for the nodes being projected, so
    // the usage list is walked once no matter how many rows come out.
    const before = scans();
    s.rowsOf(section);
    expect(scans() - before).toBe(1);
  });

  it('skips the nodes that project no row, and leaves no batch state behind', () => {
    const { s } = tableSession();
    const model = s.getDataSource('a.slx') as any;
    // A model root flattens to its five sections and their entries; a section projects
    // null and is not a row.
    const flat = model.flatten();
    const rows = s.rowsOf(model);
    expect(rows).toHaveLength(flat.filter((n: any) => n.toRow() !== null).length);
    expect(rows.length).toBeLessThan(flat.length);

    // And the batch does not outlive the call: a row projected straight off a node
    // afterwards is filled by a real scan, not by a map left behind.
    expect(linksOf(usedByOf(s, 'mdlparams.sldd/design/gravity'))).toEqual(['Ka -> Ka@a.slx']);
  });

  it('answers for a container it has nothing to say about', () => {
    const { s, dict } = tableSession();
    // An empty section is a table with no rows, not an error, and a node that is not a
    // container flattens to nothing worth a row.
    expect(s.rowsOf(dict.getSection('arch'))).toEqual([]);
  });
});
