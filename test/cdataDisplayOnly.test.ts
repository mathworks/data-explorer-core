// Copyright 2026 The MathWorks, Inc.
//
// A value a text dictionary holds as a MAT stream (`{"_type": "cdata"}`) that is no plain value
// is shown and not edited: the maintainer's ruling of 2026-10-15 on C-012. "If the entry is
// created from parsing xml or json string, then allow editing. If it is from the mat stream in
// the json sldd, do not allow editing, only present the data." Revised on 2026-10-24: a plain
// value, a number, a logical or a char, real or complex, of any size, takes edits, judged by the
// rule a MAT-file's save writes a variable fresh by (MatFileWriter.streamWriteRefusal); a stream
// holding a cell, a struct, a string, a sparse array, a function handle or a value not decoded is
// still shown and not edited (test/textStreamEdits.test.ts holds the rule over every stream).
//
// MATLAB's own text dictionary keeps a stream for a value its JSON cannot spell: every rank
// >= 3 value, every complex one, a sparse array. Only a stream holding an MCOS object was
// read-only (23f9b20, DataNode._adoptEncoded). The rest took edits, and an edit is what sent a
// save down MatWriter's refusal: typing "str" into an element of nd_text.sldd's 2x2x2 cell C
// gave "no MAT class for string", and `["a" "b"]` went out as the char 'ab' without a word.
//
// Such a node and every row under it say valueEditable false, the setter refuses what the cell
// refuses, and no row is added or removed under it. The entry itself can still be renamed and
// deleted: neither writes the stream again. A value parsed from the JSON beside it, or from a
// binary dictionary's XML, is as editable as it was.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import '../src/datamodel/node/data/NodeClassMap.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
const buffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

function open(name: string): { session: any; source: any } {
  const session = createSession();
  const source = ingest(session, buffer(fixture(name)), { filename: name.split('/').pop() }) as any;
  return { session, source };
}

const subtree = (node: any): any[] => [node, ...node.children.flatMap(subtree)];
const entryOf = (source: any, name: string): any => source.getSection('design').children.find((e: any) => e.name === name);
/** The node at `path` under an entry: child names, `/`-separated. */
const at = (entry: any, path: string): any =>
  path.split('/').reduce((n: any, name: string) => n.children.find((c: any) => c.name === name), entry);

const STREAM_REASON = /is stored as a MAT-file stream, which this editor can show but not edit, so it is read-only/;
const refused = (path: string) => ({ error: true, reason: expect.stringMatching(new RegExp(`^'${path.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}' ` + STREAM_REASON.source)) });

/** Every row at and under `node` takes no value edit and no structural edit, and its setter refuses. */
function expectDisplayOnly(node: any, holderPath: string): void {
  for (const n of subtree(node)) {
    const label = n.id;
    expect(n.valueEditable, label).toBe(false);
    expect(typeof n.canAddChild === 'function' ? n.canAddChild() : false, label).toBe(false);
    expect(typeof n.canRemoveChild === 'function' ? n.canRemoveChild() : false, label).toBe(false);
    expect(n.setProperty('Value', '1'), label).toMatchObject(refused(holderPath));
  }
}

describe('a text dictionary value read from a MAT stream that is no plain value is display-only', () => {
  // nd_text.sldd: MATLAB-written, A a 2x3x2 double, C a 2x2x2 cell, s a 2x3x2 struct, each a
  // stream; Kp a 2x3 double literal beside them.
  for (const name of ['C', 's']) {
    it(`nd_text.sldd ${name}, and every row under it`, () => {
      const { source } = open('nd_text.sldd');
      const entry = entryOf(source, name);
      const before = JSON.stringify(entry.serialize());
      expectDisplayOnly(entry, name);
      expect(entry.status).not.toBe('Modified');
      expect(JSON.stringify(entry.serialize())).toBe(before);
    });
  }

  it('the two edits that reached MatWriter refusing or rewriting a value are refused', () => {
    const { session, source } = open('nd_text.sldd');
    const element = entryOf(source, 'C').children[0];
    expect(element.setProperty('Value', '"str"')).toMatchObject(refused('C'));
    expect(element.setProperty('Value', '["a" "b"]')).toMatchObject(refused('C'));
    // The save that threw "no MAT class for string", or wrote 'ab', writes the stream as read.
    const saved = JSON.parse(session.serializeSource(source.name).text);
    const original = JSON.parse(new TextDecoder().decode(fixture('nd_text.sldd')));
    const values = (d: any) => JSON.stringify(d).match(/"_type":"cdata","_value":"[^"]*"/g);
    expect(values(saved)).toEqual(values(original));
  });

  it('a value parsed from the JSON beside them is editable, as it was', () => {
    const { source } = open('nd_text.sldd');
    const kp = entryOf(source, 'Kp');
    expect(kp.valueEditable).toBe(true);
    expect(kp.children[0].valueEditable).toBe(true);
    expect(kp.children[0].setProperty('Value', '9')).toBe(true);
    expect(kp.setProperty('Value', '[1 2]')).toBe(true);
  });

  it('the entry holding the stream can still be renamed, and is saved with the stream it was read with', () => {
    const { session, source } = open('nd_text.sldd');
    const entry = entryOf(source, 'C');
    const value = JSON.stringify(entry.serialize().value);
    expect(entry.nameEditable).toBe(true);
    expect(entry.setProperty('Name', 'C2')).toBe(true);
    const saved = session.serializeSource(source.name).text as string;
    const reopened = ingest(createSession(), buffer(new TextEncoder().encode(saved)), { filename: 'nd_text.sldd' }) as any;
    expect(JSON.stringify(entryOf(reopened, 'C2').serialize().value)).toBe(value);
  });

  it('the entry holding the stream can still be deleted', () => {
    const { session, source } = open('nd_text.sldd');
    const entry = entryOf(source, 'A');
    expect(session.deleteNodeById(entry.id)).toBe(true);
    expect(entryOf(source, 'A')).toBeUndefined();
  });

  it('sparse_text.sldd: a sparse array, and its rows', () => {
    const { source } = open('sparse/sparse_text.sldd');
    expectDisplayOnly(entryOf(source, 'spTall'), 'spTall');
  });
});

describe('one holding a plain value takes edits, as a MAT-file\'s and a binary dictionary\'s does', () => {
  it('nd_text.sldd A: a 2x3x2 double, at its elements', () => {
    const { source } = open('nd_text.sldd');
    const a = entryOf(source, 'A');
    expect(a.children[0].valueEditable).toBe(true);
    expect(a.children[0].setProperty('Value', '9')).toBe(true);
    expect(a.children[0].displayValue).toBe('9');
  });

  // nd_nested.sldd: a stream inside a JSON cell, a JSON struct, two JSON structs and a
  // Parameter's Value, each an N-D double.
  it('nd_nested.sldd: a stream in a cell, a struct and a Parameter, and what holds it', () => {
    const { source } = open('nd_nested.sldd');
    const inCell = entryOf(source, 'ndInCell');
    expect(inCell.children[1].children[0].setProperty('Value', '9')).toBe(true);
    expect(inCell.children[0].setProperty('Value', '2')).toBe(true);
    expect(inCell.canRemoveChild()).toBe(true);
    const inStruct = entryOf(source, 'ndInStruct');
    expect(at(inStruct, 'deep').children[0].setProperty('Value', '9')).toBe(true);
    expect(at(inStruct, 'flat').setProperty('Value', '8')).toBe(true);
    expect(at(entryOf(source, 'ndTwoLevel'), 'inner/deep').children[0].setProperty('Value', '9')).toBe(true);
    const param = entryOf(source, 'ndParam');
    expect(at(param, 'Value').children[0].setProperty('Value', '9')).toBe(true);
    expect(param.setProperty('Description', 'gain')).toBe(true);
  });

  // mcos/complex.sldd: MATLAB writes every complex value of a text dictionary as a stream,
  // a scalar one as well.
  it('mcos/complex.sldd: a complex scalar, a complex Parameter Value and a complex row', () => {
    const { source } = open('mcos/complex.sldd');
    expect(entryOf(source, 'z').setProperty('Value', '5-6i')).toBe(true);
    expect(entryOf(source, 'zRow').children[0].setProperty('Value', '5-6i')).toBe(true);
    const p = entryOf(source, 'pScalar');
    expect(p.valueEditable).toBe(true);
    expect(p.setProperty('Value', '1+1i')).toBe(true);
    expect(at(entryOf(source, 'pRow'), 'Value').children[0].setProperty('Value', '5-6i')).toBe(true);
  });

  it('char_text.sldd: an N-D char, shown as a summary and so with no editor, as a binary dictionary shows it; a char matrix written as JSON', () => {
    const { source } = open('char_text.sldd');
    const nd = entryOf(source, 'ndChar');
    expect([nd.valueEditable, nd._streamHolder()]).toEqual([false, null]);
    expect(entryOf(source, 'charMat').valueEditable).toBe(true);
    expect(entryOf(source, 'charMat').setProperty('Value', "['xy'; 'zw']")).toBe(true);
  });
});

describe('what is not read from a text dictionary\'s stream stays editable', () => {
  it('nd_binary.sldd: the binary twin\'s XML values', () => {
    const { source } = open('nd_binary.sldd');
    const a = entryOf(source, 'A');
    expect(a.children[0].valueEditable).toBe(true);
    expect(a.children[0].setProperty('Value', '9')).toBe(true);
  });

  it('a complex Value typed into a JSON Parameter, which is held as complex text and not as a stream', () => {
    const { source } = open('nd_nested.sldd');
    // ndParam as JSON with a plain Value, the way a host pastes an entry (serialize, renamed).
    const payload: any = JSON.parse(JSON.stringify(entryOf(source, 'ndParam').serialize()));
    payload.name = 'pJson';
    payload.metadata = { ...payload.metadata, uuid: '00000000-0000-4000-8000-000000000001' };
    payload.value._elements[0]._properties.Value = 2;
    source.getSection('design').parseEntry(payload);
    const p = entryOf(source, 'pJson');
    expect(p.valueEditable).toBe(true);
    expect(p.setProperty('Value', '3+4i')).toBe(true);
    expect(p.valueEditable).toBe(true);
    expect(p.setProperty('Value', '1-2i')).toBe(true);
    expect(p.displayValue).toBe('1-2i');
  });
});
