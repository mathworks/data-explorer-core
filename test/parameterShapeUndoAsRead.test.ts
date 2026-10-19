// Copyright 2026 The MathWorks, Inc.
//
// The undo of an edit of a Simulink.Parameter's Value gives back the Dimensions and Complexity the
// Parameter held before it, as the file holds them, also where they disagree with its Value (B-37).
//
// After every edit of the Value they are set from it, as MATLAB sets them (B-25,
// test/parameterShape.test.ts). MATLAB refuses a numeric Dimensions other than its Value's size
// and any Complexity set, so a file MATLAB writes holds the Value's shape, and setting it again
// from the restored Value gives what was read. A hand-edited file need not: here pRow, a complex
// [1+2i 3+4i 5+6i], says [1 5], or 'real'. The undo of an Add, a removal or an element edit set
// the shape again from the restored Value, so it gave [1 3] and 'complex', and saved them: an undo
// that did not give what was read (theme 1; B-25's own row, "undo gives what was read"). The
// undo of a Value typed on the Parameter already put back both as they were (_restorerFor).
//
// The edits are made through the session as a host makes them (applyStep), on copies made here
// of the repo fixtures with one tag of the entry changed.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { fileURLToPath } from 'node:url';
import { createSession, ingest } from '../src/index.js';
import '../src/datamodel/node/data/NodeClassMap.js';
import { applyStep } from './parity/matlab/parameter_shape.mjs';

const here = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));
const arrayBuffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

// The plan's steps (parameter_shape.mjs), and one more: ['row', text] sets the Value row's own
// Value, the value node under the Parameter, as a host does when that row is edited.
type Step = ['cut', number] | ['add'] | ['element', number, string] | ['typed', string] | ['row', string];
type Shape = [unknown, unknown];

const entryOf = (root: any, name: string): any => root.getSection('design').children.find((e: any) => e.name === name);

function apply(session: any, root: any, name: string, step: Step): void {
  if (step[0] !== 'row') {
    applyStep(session, root, name, step);
    return;
  }
  const value = entryOf(root, name)._valueNode;
  session.setActive(root, value);
  if (session.editProperty(value.id, 'Value', step[1]) !== true) {
    throw new Error(`${name}: ${JSON.stringify(step)} was refused`);
  }
}

const cellOf = (cell: unknown): string =>
  cell !== null && typeof cell === 'object' ? String((cell as { text: unknown }).text) : String(cell ?? '');
const dimsText = (dims: unknown): string => (Array.isArray(dims) ? `[${dims.join(' ')}]` : String(dims));

/** The entry's [Dimensions, Complexity] as its save writes them, and as its row shows them. */
function shapeOf(entry: any): { saved: Shape; rows: string[] } {
  const props = entry.serializeValue()._elements[0]._properties;
  const row = entry.toRow();
  return { saved: [props.Dimensions, props.Complexity], rows: [cellOf(row.dimensions), cellOf(row.complexity)] };
}
const shown = (shape: Shape) => ({ saved: shape, rows: [dimsText(shape[0]), String(shape[1])] });

/** complex_binary.sldd with, in `entry`'s object, the tag `from` replaced by `to`. */
function binaryCopy(entry: string, from: string, to: string): ArrayBuffer {
  const parts = unzipSync(new Uint8Array(readFileSync(here('./fixtures/mcos/complex_binary.sldd'))));
  const xml = strFromU8(parts['data/chunk0.xml']);
  const at = xml.indexOf(`<P Name="Name" Class="char">${entry}</P>`);
  const end = xml.indexOf('</Object>', at);
  const tag = xml.indexOf(from, at);
  if (at < 0 || tag < 0 || tag > end) {
    throw new Error(`complex_binary.sldd: no ${from} in ${entry}`);
  }
  parts['data/chunk0.xml'] = strToU8(xml.slice(0, tag) + to + xml.slice(tag + from.length));
  return arrayBuffer(zipSync(parts));
}

const textEntries = (doc: any): any[] => doc.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;

/** typed_mcos.sldd with pDoubleRow's `key` set to `value`. */
function textCopy(key: 'Dimensions' | 'Complexity', value: unknown): ArrayBuffer {
  const doc = JSON.parse(readFileSync(here('./fixtures/mcos/typed_mcos.sldd'), 'utf8'));
  textEntries(doc).find((x) => x.name === 'pDoubleRow').value._elements[0]._properties[key] = value;
  return arrayBuffer(strToU8(JSON.stringify(doc, null, '\t')));
}

/** The entry `name`'s [Dimensions, Complexity] as the session's save of `root` writes them, read from its bytes. */
function savedShape(session: any, root: any, name: string): Shape {
  const out = session.serializeSource(root.name);
  if (out.kind === 'text') {
    const props = textEntries(JSON.parse(out.text)).find((x) => x.name === name).value._elements[0]._properties;
    return [props.Dimensions, props.Complexity];
  }
  const back: any = ingest(createSession(), arrayBuffer(out.bytes), { filename: root.name });
  return shapeOf(entryOf(back, name)).saved;
}

interface Case {
  label: string;
  steps: Step[];
  after: Shape;
}

/**
 * Open `bytes`, check that `name` reads as `asRead`, make the steps, check the Value's shape
 * `after`, then undo them one by one: each undo gives the shape the one before it left, the last
 * one what was read, shown, held and saved. Redone, they give the same shapes again.
 */
function undoesToAsRead(file: string, bytes: ArrayBuffer, name: string, asRead: Shape, c: Case): void {
  const session = createSession();
  const root: any = ingest(session, bytes, { filename: file });
  expect(shapeOf(entryOf(root, name)), 'as read').toEqual(shown(asRead));
  expect(savedShape(session, root, name), 'as read, saved').toEqual(asRead);
  const before: { saved: Shape; rows: string[] }[] = [];
  for (const step of c.steps) {
    before.push(shapeOf(entryOf(root, name)));
    apply(session, root, name, step);
  }
  const edited = shapeOf(entryOf(root, name));
  expect(edited, 'after the edit').toEqual(shown(c.after));
  session.setActive(root, entryOf(root, name));
  for (let k = c.steps.length - 1; k >= 0; k--) {
    session.undo();
    expect(shapeOf(entryOf(root, name)), `undo of ${JSON.stringify(c.steps[k])}`).toEqual(before[k]);
  }
  expect(shapeOf(entryOf(root, name)), 'every edit undone').toEqual(shown(asRead));
  expect(savedShape(session, root, name), 'every edit undone, saved').toEqual(asRead);
  for (let k = 0; k < c.steps.length; k++) {
    session.redo();
  }
  expect(shapeOf(entryOf(root, name)), 'redone').toEqual(edited);
  expect(savedShape(session, root, name), 'redone, saved').toEqual(c.after);
}

// pRow's Value is the complex row [1+2i 3+4i 5+6i]: what each edit leaves is the Value's shape.
const binaryCases: Case[] = [
  { label: 'a removal', steps: [['cut', 2]], after: [[1, 2], 'complex'] },
  { label: 'two removals, collapsing it to a scalar', steps: [['cut', 2], ['cut', 1]], after: [[1, 1], 'complex'] },
  { label: 'an Add', steps: [['add']], after: [[1, 4], 'complex'] },
  { label: 'an Add, then a removal', steps: [['add'], ['cut', 3]], after: [[1, 3], 'complex'] },
  { label: 'an element edit', steps: [['element', 0, '7']], after: [[1, 3], 'complex'] },
  { label: 'every element set real', steps: [['element', 0, '7'], ['element', 1, '8'], ['element', 2, '9']], after: [[1, 3], 'real'] },
  { label: 'the Value row typed in', steps: [['row', '[1 2]']], after: [[1, 2], 'real'] },
  { label: 'a Value typed on the Parameter', steps: [['typed', '[1 2 3 4]']], after: [[1, 4], 'real'] },
];

const DIMS_13 = '<P Name="Dimensions" Class="double" Dimension="1*2">1.0 3.0</P>';
const COMPLEX = '<P Name="Complexity" Class="char">complex</P>';

describe('binary: a hand-edited Parameter is given back its Dimensions and Complexity as read by an undo', () => {
  const dims15 = binaryCopy('pRow', DIMS_13, '<P Name="Dimensions" Class="double" Dimension="1*2">1.0 5.0</P>');
  const real = binaryCopy('pRow', COMPLEX, '<P Name="Complexity" Class="char">real</P>');
  for (const c of binaryCases) {
    it(`Dimensions [1 5]: ${c.label}, undone`, () => {
      undoesToAsRead('complex_binary.sldd', dims15, 'pRow', [[1, 5], 'complex'], c);
    });
    it(`Complexity 'real': ${c.label}, undone`, () => {
      undoesToAsRead('complex_binary.sldd', real, 'pRow', [[1, 3], 'real'], c);
    });
  }

  it("a struct Value's Dimensions [1 5]: a field added, undone", () => {
    const bytes = binaryCopy(
      'pStruct',
      '<P Name="Dimensions" Class="double" Dimension="1*2">1.0 1.0</P>',
      '<P Name="Dimensions" Class="double" Dimension="1*2">1.0 5.0</P>',
    );
    undoesToAsRead('complex_binary.sldd', bytes, 'pStruct', [[1, 5], 'real'], { label: 'a field added', steps: [['add']], after: [[1, 1], 'real'] });
  });

  it('as MATLAB wrote it: each undo gives back the shape it read, which is its Value\'s', () => {
    const bytes = arrayBuffer(new Uint8Array(readFileSync(here('./fixtures/mcos/complex_binary.sldd'))));
    for (const c of binaryCases) {
      undoesToAsRead('complex_binary.sldd', bytes, 'pRow', [[1, 3], 'complex'], c);
    }
  });
});

// typed_mcos.sldd's pDoubleRow is the real row [1.1 2.2 3.3], which a text dictionary holds as JSON.
const textCases: Case[] = [
  { label: 'a removal', steps: [['cut', 2]], after: [[1, 2], 'real'] },
  { label: 'an Add', steps: [['add']], after: [[1, 4], 'real'] },
  { label: 'an element edit', steps: [['element', 0, '7']], after: [[1, 3], 'real'] },
  { label: 'the Value row typed in', steps: [['row', '[1 2]']], after: [[1, 2], 'real'] },
  { label: 'a Value typed on the Parameter', steps: [['typed', '[1 2 3 4]']], after: [[1, 4], 'real'] },
];

describe('text: a hand-edited Parameter is given back its Dimensions and Complexity as read by an undo', () => {
  for (const c of textCases) {
    it(`Dimensions [1 5]: ${c.label}, undone`, () => {
      undoesToAsRead('typed_mcos.sldd', textCopy('Dimensions', [1, 5]), 'pDoubleRow', [[1, 5], 'real'], c);
    });
    it(`Complexity 'complex': ${c.label}, undone`, () => {
      undoesToAsRead('typed_mcos.sldd', textCopy('Complexity', 'complex'), 'pDoubleRow', [[1, 3], 'complex'], c);
    });
  }
});
