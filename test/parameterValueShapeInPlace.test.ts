// Copyright 2026 The MathWorks, Inc.
//
// A Simulink.Parameter's Dimensions and Complexity follow its Value (ParameterNode._followValueShape)
// whichever way an element of the Value is added or removed: through the session (addChildTo,
// deleteNodeById, and their undo) or in place, as the dictionary editors make the edit, with the
// node's own addChildNode and removeChildNode inside mutateSubtree. The session's route told the
// Parameter (childEdit's notifyParent) and the node's did not, so the editors saved a Parameter whose
// Value went from three elements to two with Dimensions [1 3], and one grown to four with [1 3]; a
// complex one cut to a scalar kept its old size. MATLAB keeps both as its Value's, and refuses a
// Dimensions other than its size (Simulink:Data:UDDData_CannotSetCustomDimensions).
//
// Over every Parameter of every dictionary fixture whose Value takes an Add or the removal of an
// element: both routes save the same entry, and its Dimensions and Complexity are the Value's.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createSession, owningEntryOf } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { inMcosStream } from '../src/datamodel/node/BaseNode.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Any = any;

const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

function slddUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...slddUnder(p));
    else if (e.name.endsWith('.sldd')) out.push(p);
  }
  return out.sort();
}

const open = (bytes: Uint8Array, filename: string) => {
  const session = createSession();
  return { session, root: ingest(session, ab(bytes), { filename }) as Any };
};
const nodeAt = (root: Any, path: string): Any => (root.flatten() as Any[]).find((n) => n.matlabPath === path && !n.isContainer);
const saved = (o: { session: Any; root: Any }): Uint8Array => {
  const out = o.session.serializeSource(o.root.name);
  return out.kind === 'text' ? new TextEncoder().encode(out.text) : out.bytes;
};
// What the entry shows of its shape, and what its Value is, as the table shows them.
const shapeOf = (p: Any) => {
  const row = p.toRow();
  const text = (c: Any) => (c && typeof c === 'object' ? c.text : c);
  return { value: text(row.Value), dimensions: text(row.dimensions), complexity: text(row.complexity) };
};
// The size and complexity of a Parameter's Value, as its node holds it.
const valueShape = (p: Any) => {
  const v = p._valueNode;
  const dims = v ? (v._kind === 'scalar' ? [1, 1] : v._dims) : [1, 1];
  return { dimensions: '[' + dims.join(' ') + ']', complexity: v?._isComplexValue?.() ? 'complex' : 'real' };
};

// Every (file, Parameter, edit) a Parameter's Value offers: an Add on it, the removal of its first element.
const EDITS: { file: string; path: string; op: 'add' | 'remove' }[] = [];
for (const file of slddUnder('test')) {
  let root: Any;
  try {
    root = open(new Uint8Array(readFileSync(file)), file.split('/').pop()!).root;
  } catch {
    continue;
  }
  for (const p of root.flatten() as Any[]) {
    const v = p.className === 'Simulink.Parameter' ? p._valueNode : null;
    // Not one in a binary dictionary's MAT stream holding objects, whose edit the session copies into
    // the node of each field that holds the same handle (DataModel's withTwins), which an edit made
    // in place does not: its save refuses it, naming it (test/slddStreamObjects.test.ts).
    // Nor one with no row of its own (a scalar's, an empty's), which neither route can reach.
    if (!v || v.constructor.name !== 'MatlabVariableNode' || inMcosStream(v) || !p.children.includes(v)) continue;
    if (v.canAddChild()) EDITS.push({ file, path: p.matlabPath, op: 'add' });
    if (v.children[0] && v.canRemoveChild()) EDITS.push({ file, path: p.matlabPath, op: 'remove' });
  }
}

describe("a Simulink.Parameter's Dimensions and Complexity, after an element of its Value is added or removed", () => {
  it('are the Value\'s, whether the edit is made through the session or in place, and both save the same entry', () => {
    // Measured when this was written: 98 edits.
    expect(EDITS.length).toBeGreaterThanOrEqual(90);
    const wrong: string[] = [];
    for (const { file, path, op } of EDITS) {
      const bytes = new Uint8Array(readFileSync(file));
      const name = file.split('/').pop()!;
      const label = `${name} ${path} ${op}`;
      // The session's route.
      const a = open(bytes, name);
      const pa = nodeAt(a.root, path);
      const va = pa._valueNode;
      a.session.setActive(a.root, va);
      const took = op === 'add' ? a.session.addChildTo(va.id) !== null : a.session.deleteNodeById(va.children[0].id);
      // The editors' route: the node's own method, inside mutateSubtree.
      const b = open(bytes, name);
      const pb = nodeAt(b.root, path);
      const vb = pb._valueNode;
      b.session.mutateSubtree(owningEntryOf(vb), () => (op === 'add' ? vb.addChildNode() : vb.removeChildNode(vb.children[0])));
      if (!took) {
        wrong.push(label + ': the session refused it');
        continue;
      }
      const [sa, sb] = [shapeOf(pa), shapeOf(pb)];
      if (JSON.stringify(sa) !== JSON.stringify(sb)) wrong.push(label + ': session ' + JSON.stringify(sa) + ', in place ' + JSON.stringify(sb));
      const want = valueShape(pb);
      if (sb.dimensions !== want.dimensions || sb.complexity !== want.complexity) wrong.push(label + ': shows ' + JSON.stringify(sb) + ', its Value is ' + JSON.stringify(want));
      const [ra, rb] = [nodeAt(open(saved(a), name).root, path), nodeAt(open(saved(b), name).root, path)];
      if (JSON.stringify(shapeOf(ra)) !== JSON.stringify(shapeOf(rb))) wrong.push(label + ': saved, session ' + JSON.stringify(shapeOf(ra)) + ', in place ' + JSON.stringify(shapeOf(rb)));
      // Read again, as shown: the Value's text aside, where an element Add makes of a complex array
      // shows 0 until a reopen spells it 0+0i.
      const [back, shown] = [shapeOf(rb), sb];
      if (back.dimensions !== shown.dimensions || back.complexity !== shown.complexity) wrong.push(label + ': saved in place, reopened as ' + JSON.stringify(back) + ', shown ' + JSON.stringify(shown));
    }
    expect(wrong).toEqual([]);
  }, 300_000);

  it('the session\'s undo still puts back the Dimensions the file held', () => {
    const file = 'test/fixtures/edit-bash/r2027a/values_text.sldd';
    const o = open(new Uint8Array(readFileSync(file)), 'values_text.sldd');
    const p = nodeAt(o.root, 'pInt8');
    const before = shapeOf(p);
    o.session.setActive(o.root, p._valueNode);
    expect(o.session.deleteNodeById(p._valueNode.children[0].id)).toBe(true);
    expect(shapeOf(p).dimensions).toBe('[1 2]');
    o.session.setActive(o.root, null);
    o.session.undo();
    expect(shapeOf(p)).toEqual(before);
  });
});
