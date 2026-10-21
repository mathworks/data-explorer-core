// Copyright 2026 The MathWorks, Inc.
//
// What a MAT-file object's node shows once an edit of it is made through the session, beyond the
// property edited, held to what MATLAB loads of the save:
//
//   - the DataType MATLAB re-derives from a Value of another class, which the save co-writes into
//     the object's DataType cell (McosEditRules): shown at once, in a .mat only, and put back by an
//     undo (ParameterNode._followSourceDataType, mcosObjectEdit.shownDataType);
//   - the other nodes of the same object, two variables holding one handle (`r = h`) or a struct
//     field and a cell element holding it: each shows every edit of the object, its undo and redo
//     too, made through the node the first edit was made at, and takes none of its own; and the save
//     writes the edit once (MatNode._mirrorTwins, DataModel.mutateSubtree / addChildTo /
//     deleteNodeById).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import { MatWriteError } from '../src/datamodel/parser/MatWriter.js';
import { subsystemElementOf } from '../src/datamodel/parser/MatFileWriter.js';
import { mcosPlaceOf } from '../src/datamodel/node/mcosPlace.js';
import { sourceEditRefusal } from '../src/datamodel/node/BaseNode.js';

const TEST_ROOT = fileURLToPath(new URL('.', import.meta.url));
const CELLSWAP = join(TEST_ROOT, 'fixtures', 'mat-cellswap');
const ALLOWLIST = join(TEST_ROOT, 'fixtures', 'mat-allowlist');
const HEXOBJ = join(TEST_ROOT, 'fixtures', 'sparse', 'hexobj_values.mat');

const bufferOf = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const read = (path: string) => new Uint8Array(readFileSync(path));
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);

/** A MAT-file opened through the session, as a host opens one, and what a host does to it. */
function opened(bytes: Uint8Array, name = 'f.mat') {
  const session = createSession();
  const root: any = session.addMatSource(name, bufferOf(bytes));
  const all = (): any[] => {
    const out: any[] = [];
    const walk = (n: any) => {
      out.push(n);
      n.children.forEach(walk);
    };
    walk(root);
    return out;
  };
  const object = (path: string) => all().find((n) => mcosPlaceOf(n) && n.matlabPath === path);
  const edit = (node: any, prop: string, value: string) => {
    session.setActive(root, node);
    return session.editProperty(node.id, prop, value);
  };
  const undo = () => {
    session.setActive(root, root.children[0]);
    session.undo();
  };
  const redo = () => {
    session.setActive(root, root.children[0]);
    session.redo();
  };
  const save = (): Uint8Array => (session.serializeSource(name) as { bytes: Uint8Array }).bytes;
  return { session, root, object, edit, undo, redo, save };
}

/** The subsystem element of a MAT-file's bytes, inflated. */
function subsystemOf(bytes: Uint8Array): Uint8Array {
  const parsed = parseMat(bufferOf(bytes));
  return subsystemElementOf(parsed.records.find((r) => r.offset === parsed.subsystemOffset)!)!;
}

/** Every record but the subsystem, as its bytes. */
function variableRecords(bytes: Uint8Array): Uint8Array[] {
  const parsed = parseMat(bufferOf(bytes));
  return parsed.records.filter((r) => r.offset !== parsed.subsystemOffset).map((r) => r.bytes);
}

function thrownBy(fn: () => unknown): Error | null {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  return null;
}

/** What a node shows of an object: its value and the columns beside it, and every row under it. */
function shownOf(node: any): string[] {
  const out = [`${node.displayValue} | ${node.DataType} | ${node.Min} | ${node.Max} | ${node.Description} | ${node.Unit} | ${JSON.stringify(node.serial?._properties?.Dimensions)}`];
  const walk = (n: any, path: string) => {
    n.children.forEach((c: any, i: number) => {
      out.push(`${path}/${i} ${c.displayName} = ${c.displayValue} (${c.className})`);
      walk(c, path + '/' + i);
    });
  };
  walk(node, '');
  return out;
}

describe("a Parameter's DataType, as MATLAB's edit of its Value leaves it", () => {
  it("a double over an int16 or a single Value: 'auto', at once, in every place, and as the file reads again", () => {
    const { object, edit, save } = opened(read(join(ALLOWLIST, 'al_nested.mat')));
    expect([object('s.p').DataType, object('c{3}').DataType, object('arr(2)').DataType]).toEqual(['int16', 'single', 'single']);
    expect([edit(object('s.p'), 'Value', '9'), edit(object('c{3}'), 'Value', '4.5'), edit(object('arr(2)'), 'Value', '[1 2]')]).toEqual([true, true, true]);
    expect([object('s.p').DataType, object('c{3}').DataType, object('arr(2)').DataType]).toEqual(['auto', 'auto', 'auto']);
    // An object no edit reached keeps its own.
    expect([object('arr(1)').DataType, object('c{1}').DataType]).toEqual(['auto', 'auto']);
    const again = opened(save());
    expect([again.object('s.p').DataType, again.object('c{3}').DataType, again.object('arr(2)').DataType]).toEqual(['auto', 'auto', 'auto']);
  });

  it('a logical, a char: boolean and string; a double over a double Value under a DataType: the DataType kept', () => {
    const { object, edit, save } = opened(read(join(ALLOWLIST, 'al_dtype.mat')));
    expect([edit(object('tD'), 'Value', 'true'), edit(object('tF'), 'Value', "'abc'"), edit(object('tId'), 'Value', '7'), edit(object('tSd'), 'Value', '1.5')]).toEqual([true, true, true, true]);
    expect([object('tD').DataType, object('tF').DataType, object('tId').DataType, object('tSd').DataType]).toEqual(['boolean', 'string', 'int16', 'single']);
    const again = opened(save());
    expect([again.object('tD').DataType, again.object('tF').DataType, again.object('tId').DataType, again.object('tSd').DataType]).toEqual(['boolean', 'string', 'int16', 'single']);
  });

  it('an element of an int16 Value keeps its class and the DataType; the Value typed whole as a double does not', () => {
    const { object, edit, save } = opened(read(join(ALLOWLIST, 'al_shape.mat')));
    const spI = object('spI');
    expect(edit(spI._valueNode.children[1], 'Value', '7')).toBe(true);
    expect([spI.displayValue, spI.DataType]).toEqual(['[1 7 3]', 'int16']);
    // Typed on its row, the Value keeps the class its row is (an entry's rule, MatlabVariableNode).
    expect(edit(spI._valueNode, 'Value', '[4 5]')).toBe(true);
    expect([spI.displayValue, spI._valueNode.className, spI.DataType, JSON.stringify(spI.serial._properties.Dimensions)]).toEqual(['[4 5]', 'int16', 'int16', '[1,2]']);
    // Typed as the Parameter's, it is the double MATLAB makes of `[6 7]`.
    expect(edit(spI, 'Value', '[6 7]')).toBe(true);
    expect([spI.displayValue, spI._valueNode.className, spI.DataType]).toEqual(['[6 7]', 'double', 'auto']);
    const again = opened(save());
    expect([again.object('spI').displayValue, again.object('spI').DataType]).toEqual(['[6 7]', 'auto']);
  });

  it('undone, the DataType read; redone, the one written; and an undone edit writes nothing', () => {
    const original = read(join(ALLOWLIST, 'al_dtype.mat'));
    const { object, edit, undo, redo, save } = opened(original);
    expect(edit(object('tI'), 'Value', '7')).toBe(true);
    expect(object('tI').DataType).toBe('auto');
    undo();
    expect([object('tI').displayValue, object('tI').DataType]).toEqual(['5', 'int16']);
    expect(sameBytes(save(), original)).toBe(true);
    redo();
    expect([object('tI').displayValue, object('tI').DataType]).toEqual(['7', 'auto']);
    // And an Add to an int16 Value, undone: the class, and so the DataType, never changed.
    const shape = opened(read(join(ALLOWLIST, 'al_shape.mat')));
    const spI = shape.object('spI');
    expect(shape.session.addChildTo(spI._valueNode.id)).not.toBeNull();
    expect([spI.displayValue, spI.DataType]).toEqual(['[1 2 3 0]', 'int16']);
    shape.undo();
    expect([spI.displayValue, spI.DataType]).toEqual(['[1 2 3]', 'int16']);
  });

  it('a DataType changed around the session is not one a save writes', () => {
    const { object, save } = opened(read(join(ALLOWLIST, 'al_dtype.mat')));
    expect(object('tI').setProperty('Value', '7')).toBe(true);
    object('tI').DataType = 'single';
    const thrown = thrownBy(save);
    expect([thrown instanceof MatWriteError, thrown?.message]).toEqual([
      true,
      'Cannot write "tI": tI holds an edit of a property a save does not write into a Simulink.Parameter. Nothing was written.',
    ]);
  });

  it('in a dictionary, the DataType a Parameter holds, which the dictionary writes as it is', () => {
    const session = createSession();
    const root: any = session.addDataSource('params.sldd', JSON.parse(readFileSync(join(TEST_ROOT, 'parity', 'artifacts', 'text', 'params.sldd'), 'utf8')));
    const find = (n: any): any => (n.name === 'pInt16' ? n : n.children.map(find).find((x: any) => x));
    const p = find(root);
    session.setActive(root, p);
    expect([session.editProperty(p.id, 'Value', '7'), p.displayValue, p.DataType]).toEqual([true, '7', 'int16']);
  });
});

describe('two nodes of one object show one object', () => {
  it("a Value edited through h is r's, and the save writes it once: MATLAB's own bytes for the edit", () => {
    const original = read(join(CELLSWAP, 'pv_shared.mat'));
    const { object, edit, save } = opened(original);
    expect(edit(object('h'), 'Value', '7')).toBe(true);
    expect([object('h').displayValue, object('r').displayValue, object('r').status]).toEqual(['7', '7', 'Modified']);
    expect(shownOf(object('r'))).toEqual(shownOf(object('h')));
    const saved = save();
    // One cell: the subsystem MATLAB passed for `h.Value = 7`, and each variable's record as read.
    expect(sameBytes(subsystemOf(saved), subsystemOf(read(join(CELLSWAP, 'mut_shared_handle.mat'))))).toBe(true);
    variableRecords(saved).forEach((bytes, i) => expect(sameBytes(bytes, variableRecords(original)[i])).toBe(true));
    const again = opened(saved);
    expect([again.object('h').displayValue, again.object('r').displayValue]).toEqual(['7', '7']);
  });

  it('every kind of Value edit, its undo and its redo, made through the node first edited', () => {
    const original = read(join(CELLSWAP, 'pv_shared.mat'));
    const { session, object, edit, undo, redo, save } = opened(original);
    const inStep = () => expect(shownOf(object('h'))).toEqual(shownOf(object('r')));
    // Either node takes the first edit; r does here.
    expect([object('h').getPropInfo(object('h').getProperties().find((p: any) => p.key === 'Value')).editable, object('r').valueEditable]).toEqual([true, true]);
    expect(edit(object('r'), 'Value', '[1 2 3]')).toBe(true);
    inStep();
    expect([object('h').displayValue, JSON.stringify(object('h').serial._properties.Dimensions)]).toEqual(['[1 2 3]', '[1,3]']);
    expect(edit(object('r')._valueNode.children[1], 'Value', '9')).toBe(true);
    inStep();
    expect(session.addChildTo(object('r')._valueNode.id)).not.toBeNull();
    inStep();
    const last = object('r')._valueNode.children[3];
    session.setActive(object('r'), last);
    expect(session.deleteNodeById(last.id)).toBe(true);
    inStep();
    expect(object('h').displayValue).toBe('[1 9 3]');
    // The rows copied into h are the session's, found by their ids; and h takes no edit of its own.
    const element = object('h')._valueNode.children[2];
    expect(session.findNodeById(element.id)).toBe(element);
    const refusal = 'Cannot edit "h": h is one object with r (one handle), and r holds an edit of it: the object is edited through r, and h shows each edit.';
    expect(edit(element, 'Value', '4')).toMatchObject({ error: true, reason: refusal });
    expect(edit(object('h'), 'Value', '4')).toMatchObject({ error: true, reason: refusal });
    expect([object('h').valueEditable, element.valueEditable, object('h').canAddChild?.() ?? false, object('h')._valueNode.canAddChild()]).toEqual([false, false, false, false]);
    expect(edit(object('r')._valueNode.children[2], 'Value', '4')).toBe(true);
    inStep();
    expect(object('h').displayValue).toBe('[1 9 4]');
    const shown = [object('h').displayValue, object('r').displayValue];
    const again = opened(save());
    expect([again.object('h').displayValue, again.object('r').displayValue]).toEqual(shown);
    // Every step undone, one at a time, each shown by both; then all redone.
    const steps: string[] = [];
    for (let i = 0; i < 5; i++) {
      undo();
      inStep();
      steps.push(object('r').displayValue);
    }
    expect(steps).toEqual(['[1 9 3]', '[1 9 3 0]', '[1 9 3]', '[1 2 3]', '5']);
    expect(sameBytes(save(), original)).toBe(true);
    // Redone, each step is shown by both too, and saved as shown. (Not every step is redone where
    // it was made: a Value typed whole and redone is a new Value, and the redo of an element edit of
    // the one before it changes nothing, in any file, twins or none.)
    for (let i = 0; i < 5; i++) {
      redo();
      inStep();
    }
    const redone = opened(save());
    expect([redone.object('h').displayValue, redone.object('r').displayValue]).toEqual([object('h').displayValue, object('r').displayValue]);
  });

  it('an edit undone leaves the object no master: the other node takes the next edit, and the first shows it', () => {
    const original = read(join(CELLSWAP, 'pv_shared.mat'));
    const { session, object, edit, undo, redo, save } = opened(original);
    const inStep = () => expect(shownOf(object('h'))).toEqual(shownOf(object('r')));
    expect(edit(object('h'), 'Value', '7')).toBe(true);
    expect(object('r').valueEditable).toBe(false);
    undo();
    inStep();
    expect([object('h').displayValue, object('r').valueEditable, object('h').valueEditable]).toEqual(['5', true, true]);
    expect(sameBytes(save(), original)).toBe(true);
    // r takes the next edit, its rows' too, and h shows each and takes none of its own.
    expect(edit(object('r'), 'Value', '[1 2 3]')).toBe(true);
    expect(edit(object('r')._valueNode.children[1], 'Value', '9')).toBe(true);
    inStep();
    expect(edit(object('h'), 'Value', '4')).toMatchObject({
      error: true,
      reason: 'Cannot edit "h": h is one object with r (one handle), and r holds an edit of it: the object is edited through r, and h shows each edit.',
    });
    const again = opened(save());
    expect([again.object('h').displayValue, again.object('r').displayValue]).toEqual(['[1 9 3]', '[1 9 3]']);
    // Both undone, h takes one again; its Add, undone and redone, is shown by r.
    undo();
    undo();
    inStep();
    expect(sameBytes(save(), original)).toBe(true);
    expect(edit(object('h'), 'Value', '[4 5]')).toBe(true);
    expect(session.addChildTo(object('h')._valueNode.id)).not.toBeNull();
    inStep();
    expect(object('r').displayValue).toBe('[4 5 0]');
    undo();
    inStep();
    redo();
    inStep();
    expect(opened(save()).object('r').displayValue).toBe('[4 5 0]');
    undo();
    undo();
    inStep();
    expect(sameBytes(save(), original)).toBe(true);
  });

  it('an edit typed back to what the file holds leaves no master either, and what each node shows is what the save writes', () => {
    const original = read(join(CELLSWAP, 'pv_shared.mat'));
    const { object, edit, undo, save } = opened(original);
    const inStep = () => expect(shownOf(object('h'))).toEqual(shownOf(object('r')));
    expect([edit(object('h'), 'Value', '7'), edit(object('h'), 'Value', '5')]).toEqual([true, true]);
    expect(edit(object('r'), 'Value', '8')).toBe(true);
    inStep();
    expect(opened(save()).object('h').displayValue).toBe('8');
    // Undone, step by step: r's edit, then h's two, each shown by both and saved as shown.
    const steps: string[] = [];
    for (let i = 0; i < 3; i++) {
      undo();
      inStep();
      steps.push(object('h').displayValue);
      expect(opened(save()).object('r').displayValue).toBe(object('r').displayValue);
    }
    expect(steps).toEqual(['5', '7', '5']);
    expect(sameBytes(save(), original)).toBe(true);
  });

  it('the node an edit was made through, deleted: the other still carries it to the save', () => {
    const { session, root, object, edit, save } = opened(read(join(CELLSWAP, 'pv_shared.mat')));
    expect(edit(object('h'), 'Value', '11')).toBe(true);
    session.setActive(root, object('h'));
    expect(session.deleteNodeById(object('h').id)).toBe(true);
    expect(edit(object('r'), 'Value', '12')).toMatchObject({
      error: true,
      reason: 'Cannot edit "r": r is one object with h (one handle), and h, which holds an edit of it, is deleted: r takes no edit of its own until that delete is undone, or the file is read again.',
    });
    const again = opened(save());
    expect(again.root.children.map((c: any) => c.name)).toEqual(['r']);
    expect(again.object('r').displayValue).toBe('11');
  });

  it('a struct field and a cell element of one handle, in an uncompressed (-v6) file', () => {
    const original = read(HEXOBJ);
    const { object, edit, save } = opened(original);
    expect(edit(object('objsCell{7}'), 'Value', '42')).toBe(true);
    expect([object('objs.prm').displayValue, object('objsCell{7}').displayValue]).toEqual(['42', '42']);
    expect(shownOf(object('objs.prm'))).toEqual(shownOf(object('objsCell{7}')));
    expect(edit(object('objs.prm'), 'Value', '43')).toMatchObject({
      error: true,
      reason: 'Cannot edit "objs": objs.prm is one object with objsCell{7} (one handle), and objsCell{7} holds an edit of it: the object is edited through objsCell{7}, and objs.prm shows each edit.',
    });
    const saved = save();
    expect(parseMat(bufferOf(saved)).records.map((r) => r.compressed)).toEqual(parseMat(bufferOf(original)).records.map((r) => r.compressed));
    const again = opened(saved);
    expect([again.object('objs.prm').displayValue, again.object('objsCell{7}').displayValue]).toEqual(['42', '42']);
  });

  it('an edit of one, made around the session, forgets what the gate found of every variable holding the object', () => {
    const { root, object } = opened(read(HEXOBJ));
    const [objs, objsCell] = ['objs', 'objsCell'].map((name) => root.children.find((c: any) => c.name === name));
    // Asked of a plain part of each variable, the gate keeps what it found of the variable; asked
    // of an object, it finds which nodes are one object.
    for (const entry of [objs, objsCell]) {
      expect(sourceEditRefusal(entry.children[0].children[0], 'Value')).not.toBeNull();
    }
    expect(sourceEditRefusal(object('objsCell{7}'), 'Value')).toBeNull();
    expect([root._valueVerdicts.has(objs), root._valueVerdicts.has(objsCell)]).toEqual([true, true]);
    // The node's own setter, which copies nothing into objs.prm: MATLAB loads the edit in both.
    expect(object('objsCell{7}').setProperty('Value', '42')).toBe(true);
    expect(object('objs.prm').displayValue).not.toBe('42');
    expect([root._valueVerdicts.has(objs), root._valueVerdicts.has(objsCell)]).toEqual([false, false]);
  });

  it('a host that edits nodes itself, inside mutateSubtree, has the other shown too', () => {
    const { session, object, save } = opened(read(join(CELLSWAP, 'pv_shared.mat')));
    const h = object('h');
    expect(session.mutateSubtree(h, () => h.setProperty('Value', '[5 6]'))).toBe(true);
    expect(object('r').displayValue).toBe('[5 6]');
    const element = object('r')._valueNode.children[0];
    expect(session.findNodeById(element.id)).toBe(element);
    expect(opened(save()).object('r').displayValue).toBe('[5 6]');
  });

  it('a twin in a variable one of two of its name takes no edit, and neither does the node it is one object with', () => {
    // pv_shared.mat with r's record twice: MATLAB loads one of the two.
    const original = read(join(CELLSWAP, 'pv_shared.mat'));
    const parsed = parseMat(bufferOf(original));
    const [h, r, subsystem] = parsed.records;
    expect([h.name, r.name, subsystem.offset]).toEqual(['h', 'r', parsed.subsystemOffset]);
    const header = original.slice(0, 128);
    const at = 128 + h.bytes.byteLength + 2 * r.bytes.byteLength;
    new DataView(header.buffer).setBigUint64(116, BigInt(at), true);
    const bytes = new Uint8Array([...header, ...h.bytes, ...r.bytes, ...r.bytes, ...subsystem.bytes]);
    const { object, edit } = opened(bytes);
    const answer: any = edit(object('h'), 'Value', '7');
    expect(answer).toMatchObject({ error: true });
    expect(answer.reason).toBe(
      'Cannot edit "h": h is one object with r (one handle), so an edit of it is an edit of the variable r too, which shares its name with another variable of the file, and MATLAB loads only one of them.',
    );
    expect(object('h').displayValue).toBe('5');
  });
});
