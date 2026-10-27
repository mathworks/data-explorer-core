// Copyright 2026 The MathWorks, Inc.
//
// A Simulink.Parameter whose Value MATLAB saved as a string, in a MAT-file (p.Value = "abc", saved by
// MATLAB R2027a and R2023b): its Value cell names a `string` object of the file, whose payload holds
// the text. It was shown and took no edit, "pStr.Value has no value in the file that reads, nor a
// default of its class there", where a dictionary edits it, and a MAT-file this package wrote holds
// its text as a char row, which takes one.
//
// Text typed is written into the string's payload, as MATLAB's own save of p.Value = "xyz" writes it:
// the two subsystems are one, byte for byte (both releases: param_string_longer.mat is MATLAB's). A
// value of another class swaps the Value cell for the value's, the string's object left in the file,
// named by nothing, as the codec leaves what no edit names any more; MATLAB loads it as its own save
// of p.Value = 5, which drops the object.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession, ingest } from '../src/index.js';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import { readDescriptor, readSubsystem } from '../src/datamodel/parser/McosSubsystemCodec.js';
import '../src/datamodel/node/data/NodeClassMap.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const DIR = fileURLToPath(new URL('./fixtures/param-string/', import.meta.url));
const RELEASES = ['2027a', '2023b'];

const bytesOf = (file: string) => new Uint8Array(readFileSync(DIR + file));

function opened(bytes: Uint8Array): { session: any; root: any } {
  const session = createSession();
  return { session, root: ingest(session, bytes, { filename: 'param_string.mat' }) };
}

const nodeAt = (root: any, path: string): any => root.flatten().find((n: any) => !n.isContainer && n.matlabPath === path);

function shownCell(node: any, key: string): string {
  const cell = node?.toRow()?.[key];
  return cell && typeof cell === 'object' ? String(cell.text ?? cell.label ?? '') : String(cell ?? '');
}

function typeInto(o: { session: any; root: any }, path: string, text: string, key = 'Value'): unknown {
  const node = nodeAt(o.root, path);
  o.session.setActive(o.root, node);
  return o.session.editProperty(node.id, key, text, shownCell(node, key));
}

function saved(o: { session: any; root: any }): Uint8Array {
  return o.session.serializeSource(o.root.name).bytes;
}

// The subsystem element a MAT-file's objects are saved in, inflated.
function subsystemOf(bytes: Uint8Array): Uint8Array {
  const parsed = parseMat(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return parsed.variables.find((v: any) => v._anonymous)!._rawBytes as Uint8Array;
}

// What the Parameter at `path` shows: its Value and the columns its Value sets.
const columns = (root: any, path: string) => Object.fromEntries(['Value', 'DataType', 'dimensions', 'complexity'].map((k) => [k, shownCell(nodeAt(root, path), k)]));

const PARAMETERS: [string, string][] = [['pStr', '"abc"'], ['sHolds.p', '"in a struct"'], ['cHolds{1}', '"in a cell"']];

describe.each(RELEASES)('a Parameter whose Value MATLAB %s saved as a string', (rel) => {
  const file = `r${rel}/param_string.mat`;

  it.each(PARAMETERS)('%s shows its text and offers an editor of it', (path, text) => {
    const { root } = opened(bytesOf(file));
    expect(columns(root, path)).toEqual({ Value: text, DataType: 'string', dimensions: '[1 1]', complexity: 'real' });
    expect(nodeAt(root, path).valueEditable).toBe(true);
  });

  it("text typed is saved as MATLAB's own save of the same edit, byte for byte", () => {
    const o = opened(bytesOf(file));
    expect(typeInto(o, 'pStr', '"a longer text, with ünïcødé"')).toBe(true);
    expect(subsystemOf(saved(o))).toEqual(subsystemOf(bytesOf(`r${rel}/param_string_longer.mat`)));
  });

  for (const [path] of PARAMETERS) {
    it.each(['"xyz"', "'xyz'", '""', '"a longer text, with ünïcødé"'])(`%s typed at ${path} is the string MATLAB makes, in the file's string`, (text) => {
      const o = opened(bytesOf(file));
      expect(typeInto(o, path, text)).toBe(true);
      const made = { Value: text === "'xyz'" ? '"xyz"' : text, DataType: 'string', dimensions: '[1 1]', complexity: 'real' };
      expect(columns(o.root, path)).toEqual(made);
      const bytes = saved(o);
      const again = opened(bytes);
      expect(columns(again.root, path)).toEqual(made);
      // Its Value cell still names a string object: the payload was written, not the cell.
      const records = readSubsystem(subsystemOf(bytes));
      const before = readSubsystem(subsystemOf(bytesOf(file)));
      expect(records.ok && before.ok).toBe(true);
      if (records.ok && before.ok) {
        expect(records.subsystem.blob.objects.length).toBe(before.subsystem.blob.objects.length);
        expect(records.subsystem.values.filter((c) => readDescriptor(c)).length).toBe(before.subsystem.values.filter((c) => readDescriptor(c)).length);
      }
      // And it takes another edit, opened again: but "", which the rules write no char of yet (S15
      // of the 2026-10-26 edit bash: "a char that is not one row of text", as pEmpty is refused).
      if (text !== '""') {
        expect(typeInto(again, path, '"again"')).toBe(true);
        expect(shownCell(nodeAt(opened(saved(again)).root, path), 'Value')).toBe('"again"');
      }
    });

    it.each([
      ['5', { Value: '5', DataType: 'auto', dimensions: '[1 1]', complexity: 'real' }],
      ['[1+2i 3]', { Value: '[1+2i 3+0i]', DataType: 'auto', dimensions: '[1 2]', complexity: 'complex' }],
      ['int8([1 2])', { Value: '[1 2]', DataType: 'int8', dimensions: '[1 2]', complexity: 'real' }],
      ['true', { Value: 'true', DataType: 'boolean', dimensions: '[1 1]', complexity: 'real' }],
    ])(`%s typed at ${path} is that value, as MATLAB's p.Value = v makes it`, (text, made) => {
      const o = opened(bytesOf(file));
      expect(typeInto(o, path, text)).toBe(true);
      expect(columns(o.root, path)).toEqual(made);
      const again = opened(saved(o));
      expect(columns(again.root, path)).toEqual(made);
      // And text typed back over it is held as text again.
      expect(typeInto(again, path, '"back"')).toBe(true);
      expect(shownCell(nodeAt(opened(saved(again)).root, path), 'Value')).toBe('"back"');
    });
  }

  it.each(['"xyz"', '5'])('%s typed and undone saves the file as it was read', (text) => {
    const o = opened(bytesOf(file));
    const read = subsystemOf(bytesOf(file));
    expect(typeInto(o, 'pStr', text)).toBe(true);
    o.session.setActive(o.root, null);
    o.session.undo();
    expect(columns(o.root, 'pStr')).toEqual({ Value: '"abc"', DataType: 'string', dimensions: '[1 1]', complexity: 'real' });
    expect(subsystemOf(saved(o))).toEqual(read);
    o.session.redo();
    expect(shownCell(nodeAt(opened(saved(o)).root, 'pStr'), 'Value')).toBe(text === '5' ? '5' : text);
  });

  it('an edit of another property beside it leaves its string as it was', () => {
    const o = opened(bytesOf(file));
    expect(typeInto(o, 'pStr', 'other', 'Description')).toBe(true);
    const again = opened(saved(o));
    expect([shownCell(nodeAt(again.root, 'pStr'), 'Value'), shownCell(nodeAt(again.root, 'pStr'), 'Description')]).toEqual(['"abc"', 'other']);
  });
});
