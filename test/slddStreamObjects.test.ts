// Copyright 2026 The MathWorks, Inc.
//
// An edit of a Simulink.Parameter's or a Simulink.Signal's property INSIDE a dictionary value that
// is a MAT stream, saved: a binary dictionary's hex value, which MATLAB writes for an entry's whole
// Value when the entry also holds a sparse array, and the cdata of the same stream a text
// dictionary holds once this package pastes such an entry into one. The objects ride in the
// stream's own subsystem; an allow-listed property the stream stores a value for takes an edit,
// which the save writes by swapping its cell (mcosStreamEdit), and everything else in the stream
// stays read-only, with the words it had.
//
// The fixture is MATLAB's (fixtures/sldd-stream-objects/make_stream_objects.m): ten entries MATLAB
// wrote as hex, each a struct, a cell or a Parameter holding objects beside a sparse array, and two
// it wrote as XML. Every expectation about bytes is cut from the files with string slicing and the
// strict subsystem reader, never produced by the reader under test; what the edited objects read
// as after a save is asked of a session that reopens it. MATLAB itself reopens these saves in
// test/parity/matlab/probe_sldd_stream_objects.{mjs,m}.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { decodeMatStream } from '../src/datamodel/parser/MatParser.js';
import { readMcosSubsystem } from '../src/datamodel/parser/McosSubsystemEdit.js';
import { mcosStreamParts, streamWithSubsystem } from '../src/datamodel/parser/McosStreamEdit.js';
import { objectSubsystemEdit } from '../src/datamodel/node/data/mcosObjectEdit.js';
import { uudecode, uuencode } from '../src/datamodel/parser/CdataCodec.js';
import { matStreamPrefix } from '../src/datamodel/parser/EncodedValue.js';
import { MatWriteError } from '../src/datamodel/parser/MatWriter.js';
import { mcosStreamGateOf } from '../src/datamodel/node/mcosStream.js';
import { CASES, applyEdits, entryOfPath, pasteStreams, streamObjectSaves } from './parity/matlab/probe_sldd_stream_objects.mjs';
import '../src/datamodel/node/data/NodeClassMap.js';

const DIR = new URL('./fixtures/sldd-stream-objects/', import.meta.url);
const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(fileURLToPath(new URL(name, DIR))));
const buffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const TRUTH = JSON.parse(new TextDecoder().decode(fixture('stream_objects.truth.json')));
const BINARY = fixture('stream_objects_binary.sldd');
const TEXT = fixture('stream_objects_text.sldd');
const CHUNK = 'data/chunk0.xml';
const chunkOf = (zip: Uint8Array): string => new TextDecoder().decode(unzipSync(zip)[CHUNK]);
const MATLAB_CHUNK = chunkOf(BINARY);
const subtree = (n: any): any[] => [n, ...n.children.flatMap(subtree)];

const ENCODED_REASON = /is stored as an encoded MATLAB value that this editor can show but not write, so it is read-only\.$/;
const STREAMS = ['arr', 'cPh', 'nested', 'pSp', 'pStruct', 'sPh', 'sTh', 'shared', 'sigH'];

// The clock is frozen, so the LastMod an edit stamps is one string.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T12:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

function open(bytes: Uint8Array = BINARY, filename = 'stream_objects_binary.sldd'): { session: any; root: any } {
  const session = createSession();
  const root: any = ingest(session, buffer(bytes), { filename });
  session.setActiveContext(root);
  return { session, root };
}

/** The node at `path`, a MATLAB path from an entry of Design Data. */
function nodeAt(root: any, path: string): any {
  for (const entry of root.getSection('design').children) {
    for (const node of subtree(entry)) {
      if (node.matlabPath === path) {
        return node;
      }
    }
  }
  throw new Error('no node ' + path);
}

/** One edit as a host makes it: the node made active, then session.editProperty. */
function edit(session: any, root: any, path: string, prop: string, text: string): unknown {
  const node = nodeAt(root, path);
  session.setActive(root, node);
  return session.editProperty(node.id, prop, text);
}

/** An entry's `<Object>…</Object>`, exactly as written. */
function objectOf(xml: string, name: string): string {
  const at = xml.indexOf('<P Name="Name" Class="char">' + name + '</P>');
  expect(at, name).toBeGreaterThan(-1);
  const from = xml.lastIndexOf('<Object', at);
  return xml.slice(from, xml.indexOf('</Object>', at) + '</Object>'.length);
}

/** An entry's Value element, exactly as written. */
function valueTag(xml: string, name: string): string {
  const object = objectOf(xml, name);
  const from = object.indexOf('<P Name="Value"');
  return object.slice(from, object.indexOf('</P>', from) + 4);
}

/** The stream an entry's hex Value holds, and what its tag says of it. */
function hexStream(xml: string, name: string): { bytes: Uint8Array; encodedLength: number; digits: number } {
  const tag = valueTag(xml, name);
  const m = /^<P Name="Value" Class="[^"]*" Encoding="hex" EncodedLength="(\d+)">([^<]*)<\/P>$/.exec(tag);
  expect(m, name + ': ' + tag.slice(0, 120)).not.toBeNull();
  const digits = m![2].replace(/\s+/g, '');
  const bytes = new Uint8Array(digits.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(digits.substr(2 * i, 2), 16);
  }
  return { bytes, encodedLength: Number(m![1]), digits: digits.length };
}

/** The value cells of a stream's subsystem, each as its bytes. */
function cellsOf(stream: Uint8Array): Uint8Array[] {
  const parts = mcosStreamParts(stream);
  expect(parts.ok).toBe(true);
  const read = readMcosSubsystem((parts as { subsystem: Uint8Array }).subsystem);
  expect(read.ok).toBe(true);
  const s = (read as { subsystem: any }).subsystem;
  return s.cells.map((c: any) => s.bytes.slice(c.at, c.end));
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** The saved chunk of a binary dictionary. */
function savedChunk(session: any, root: any): string {
  return chunkOf(session.serializeSource(root.name).bytes);
}

/** A saved dictionary opened again, in a session of its own. */
function reopened(session: any, root: any): any {
  const out = session.serializeSource(root.name);
  const bytes = out.kind === 'binary' ? out.bytes : new TextEncoder().encode(out.text);
  return open(bytes, root.name).root;
}

/** What an object's node shows of the properties an edit writes. */
function shown(node: any): Record<string, unknown> {
  return { value: node.displayValue, Description: node.Description, Min: node.Min, Max: node.Max, Unit: node.Unit, DataType: node.DataType };
}

describe('the fixture is what these tests need', () => {
  it('MATLAB wrote every stream entry as hex, the controls as XML, and refused none', () => {
    expect(TRUTH.binary.refused ?? []).toEqual([]);
    const hex = TRUTH.binary.valueTags.filter((t: any) => t.isHex).map((t: any) => t.name).sort();
    expect(hex).toEqual([...STREAMS].sort());
    for (const name of STREAMS) {
      expect(valueTag(MATLAB_CHUNK, name), name).toMatch(/^<P Name="Value" Class="[^"]+" Encoding="hex" EncodedLength="\d+">/);
    }
    expect(valueTag(MATLAB_CHUNK, 'plainP')).not.toContain('Encoding');
    expect(valueTag(MATLAB_CHUNK, 'plainS')).not.toContain('Encoding');
  });

  it('each stream is a value and its subsystem and nothing else, and its EncodedLength is its byte count', () => {
    for (const name of STREAMS) {
      const { bytes, encodedLength, digits } = hexStream(MATLAB_CHUNK, name);
      expect(encodedLength, name).toBe(bytes.length);
      expect(digits, name).toBe(2 * bytes.length);
      expect(mcosStreamParts(bytes).ok, name).toBe(true);
    }
  });
});

describe('inside a stream, an allow-listed property the stream stores a value for takes an edit, and nothing else does', () => {
  // What the table and the Property Inspector offer (getPropInfo), node by node: every node of every
  // stream entry, and the two controls, which are XML and edit as they always did.
  const { root } = open();
  const offered = (node: any): string[] =>
    node.getProperties().filter((p: any) => node.getPropInfo(p).editable).map((p: any) => p.key);
  const OFFERED: Record<string, string[]> = {
    'arr': ['Name'],
    'arr.ps(1)': ['Value', 'Description'],
    'arr.ps(2)': ['Value', 'Description'],
    'cPh': ['Name'],
    'cPh{1}': ['Value', 'Description'],
    'cPh{1}.Value': ['Value'],
    'cPh{1}.Value(1)': ['Value'],
    'cPh{1}.Value(2)': ['Value'],
    'cPh{1}.Value(3)': ['Value'],
    'nested': ['Name'],
    'nested.inner.p': ['Value', 'Description'],
    'pSp': ['Name', 'Min', 'Max', 'Description'],
    'pStruct': ['Name'],
    'pStruct.p.Value.a': ['Name', 'Value'],
    'pStruct.p.Value.b': ['Name', 'Value'],
    'pStruct.p.Value.b(1)': ['Value'],
    'pStruct.p.Value.b(2)': ['Value'],
    'sPh': ['Name'],
    'sPh.p': ['Value', 'Min', 'Max', 'Description'],
    'sTh': ['Name'],
    'sTh.t': ['Value', 'Max'],
    'shared': ['Name'],
    'shared.a': ['Value', 'Description'],
    'shared.b': ['Value', 'Description'],
    'sigH': ['Name'],
    'sigH.sig': ['Min', 'Max', 'Description'],
  };

  it('every node of a stream offers exactly these, and the rest of it nothing', () => {
    const got: Record<string, string[]> = {};
    for (const name of STREAMS) {
      for (const node of subtree(nodeAt(root, name))) {
        const keys = offered(node);
        if (keys.length > 0) {
          got[node.matlabPath] = keys;
        }
      }
    }
    expect(got).toEqual(OFFERED);
  });

  it('a node offered no Value takes no Value editor, and only a Parameter\'s Value a row added or removed', () => {
    // A Parameter's array Value, its struct Value and an array in a field of that: each an edit of
    // the Value, as in a MAT-file (mcosObjectEdit.propertyAt).
    const STRUCTURAL = ['cPh{1}.Value', 'pStruct.p.Value', 'pStruct.p.Value.b'];
    for (const name of STREAMS) {
      for (const node of subtree(nodeAt(root, name))) {
        const label = node.matlabPath + ' (' + node.constructor.name + ')';
        expect(node.valueEditable, label).toBe((OFFERED[node.matlabPath] ?? []).includes('Value'));
        const structural = STRUCTURAL.includes(node.matlabPath);
        expect(typeof node.canAddChild === 'function' ? node.canAddChild() : false, label).toBe(structural);
        expect(typeof node.canRemoveChild === 'function' ? node.canRemoveChild() : false, label).toBe(structural);
      }
    }
  });

  it('what is not offered is refused with the words an encoded value always had', () => {
    // Every property each class's setter edits through an override of its own, and the generic ones,
    // at every node of every stream that is no object of a class with rules and under none.
    const PROPS = ['Value', 'Min', 'Max', 'DataType', 'Description', 'Unit', 'Complexity', 'Dimensions', 'Name'];
    const { root: fresh } = open();
    for (const name of STREAMS) {
      for (const node of subtree(nodeAt(fresh, name)).slice(1)) {
        if (/^Simulink\.(Parameter|Signal)$/.test(node.className) || /\.Value\b|\.p\.Value/.test(node.matlabPath)) {
          continue;
        }
        for (const prop of PROPS) {
          const result = node.setProperty(prop, '1');
          expect(result, node.matlabPath + ' ' + prop).toMatchObject({ error: true, reason: expect.stringMatching(ENCODED_REASON) });
        }
      }
    }
  });

  it('an object\'s property no rule writes is refused with those words too, and one at its default with the rules\' own', () => {
    const { root: fresh } = open();
    for (const [path, prop, text] of [
      ['sPh.p', 'DataType', 'single'],
      ['sPh.p', 'Complexity', 'complex'],
      ['sPh.p', 'Dimensions', '[1 2]'],
      ['sPh.p', 'StorageClass', 'ExportedGlobal'],
      ['sPh.p', 'Name', 'pp'],
      ['sigH.sig', 'Complexity', 'complex'],
    ]) {
      expect(nodeAt(fresh, path).setProperty(prop, text), path + ' ' + prop).toMatchObject({ error: true, reason: expect.stringMatching(ENCODED_REASON) });
    }
    expect(nodeAt(fresh, 'sTh.t').setProperty('Description', 'x')).toMatchObject({
      error: true,
      reason: 'Cannot edit "sTh": sTh.t.Description is at its class default: the file holds no value for it, and a save can replace only a value the file holds.',
    });
  });

  it('the entry holding the stream keeps its rename, and the controls edit as XML always did', () => {
    const { root: fresh } = open();
    expect(nodeAt(fresh, 'sPh').setProperty('Name', 'sPhRenamed')).toBe(true);
    expect(nodeAt(fresh, 'plainP').setProperty('Description', 'still XML')).toBe(true);
    expect(nodeAt(fresh, 'plainS.x').setProperty('Value', '2')).toBe(true);
    expect(offered(nodeAt(fresh, 'plainP'))).toEqual(['Name', 'Value', 'Min', 'Max', 'Description', 'storageClass']);
  });
});

// Every row of an entry as the tree shows it, with what the editor writes of each object.
const rows = (entry: any): string[] =>
  subtree(entry).map((n: any) => {
    const object = /^Simulink\.(Parameter|Signal)$/.test(n.className)
      ? ' ' + JSON.stringify([n.Description, n.Min, n.Max, n.Unit, n.className === 'Simulink.Signal' ? n.DataType : null])
      : '';
    return `${n.matlabPath} ${n.constructor.name} ${n.className} ${n.displayValue}${object}`;
  });

const entriesOf = (c: (typeof CASES)[number]): string[] => [...new Set(c.edits.filter((e: any) => e.path).map((e: any) => entryOfPath(e.path)))];
const LASTMOD = /<P Name="LastMod" Class="char">[^<]*<\/P>/;

/** A case made again as streamObjectSaves makes it, keeping the session it was made in. */
function made(c: (typeof CASES)[number]): { session: any; root: any } {
  const original = c.format === 'bin' ? BINARY : SAVES.files['orig_text.sldd'];
  const { session, root } = open(original, c.format === 'bin' ? 'orig_bin.sldd' : 'orig_text.sldd');
  applyEdits(session, root, c.edits);
  return { session, root };
}

const SAVES = streamObjectSaves({ createSession, ingest }, { binary: BINARY, text: TEXT });

describe('an edit in a binary dictionary\'s hex stream is saved as that stream with only its cells swapped', () => {
  for (const c of CASES.filter((x) => x.format === 'bin')) {
    const saved = chunkOf(SAVES.files[c.name + '.sldd']);
    const edited = c.control && c.edits.length === 0 ? [] : entriesOf(c);

    it(`${c.name}: every other entry is the bytes MATLAB wrote`, () => {
      for (const t of TRUTH.binary.valueTags) {
        if (!edited.includes(t.name)) {
          expect(objectOf(saved, t.name), t.name).toBe(objectOf(MATLAB_CHUNK, t.name));
        }
      }
    });

    for (const name of edited) {
      it(`${c.name}: ${name} changes in its Value and its LastMod alone, its hex exact`, () => {
        const before = objectOf(MATLAB_CHUNK, name);
        const after = objectOf(saved, name);
        const tag = valueTag(saved, name);
        expect(after.replace(tag, '<VALUE/>').replace(LASTMOD, '')).toBe(before.replace(valueTag(MATLAB_CHUNK, name), '<VALUE/>').replace(LASTMOD, ''));
        // The Class as read, EncodedLength the byte count, and MATLAB's layout: lines of 128 digits, 16 spaces in.
        const cls = /Class="([^"]*)"/.exec(valueTag(MATLAB_CHUNK, name))![1];
        expect(tag).toMatch(new RegExp(`^<P Name="Value" Class="${cls.replace('.', '\\.')}" Encoding="hex" EncodedLength="\\d+">(?:\\n {16}[0-9A-F]{128})*\\n {16}[0-9A-F]{2,128}</P>$`));
        const { bytes, encodedLength, digits } = hexStream(saved, name);
        expect(encodedLength).toBe(bytes.length);
        expect(digits).toBe(2 * bytes.length);
        const decoded = decodeMatStream(bytes, { whole: true });
        expect(decoded.ok && decoded.trailingElements.length).toBe(1);
      });

      it(`${c.name}: ${name}'s value element is the bytes it was, and ${c.cells} subsystem cell(s) changed`, () => {
        const was = hexStream(MATLAB_CHUNK, name).bytes;
        const is = hexStream(saved, name).bytes;
        const wasParts = mcosStreamParts(was) as { valueEnd: number };
        const isParts = mcosStreamParts(is) as { valueEnd: number };
        expect(isParts.valueEnd).toBe(wasParts.valueEnd);
        expect(sameBytes(is.subarray(0, isParts.valueEnd), was.subarray(0, wasParts.valueEnd))).toBe(true);
        const before = cellsOf(was);
        const after = cellsOf(is);
        expect(after.length).toBe(before.length);
        expect(sameBytes(after[0], before[0]), 'the metadata blob').toBe(true);
        expect(before.filter((cell, i) => !sameBytes(cell, after[i])).length).toBe(c.cells);
      });
    }

    if (edited.length > 0 && !c.control) {
      it(`${c.name}: opened again, the edited entries read as the session showed them`, () => {
        const { session, root } = made(c);
        const back = reopened(session, root);
        for (const name of edited) {
          expect(rows(nodeAt(back, name))).toEqual(rows(nodeAt(root, name)));
        }
      });
    }
  }

  it('an edit undone writes the stream MATLAB wrote, byte for byte', () => {
    const saved = chunkOf(SAVES.files['control_undo.sldd']);
    expect(valueTag(saved, 'sPh')).toBe(valueTag(MATLAB_CHUNK, 'sPh'));
    expect(chunkOf(SAVES.files['control_identity.sldd'])).toBe(MATLAB_CHUNK);
  });

  it('a renamed entry keeps its stream, and an edit after the rename is written into it', () => {
    const { session, root } = open();
    edit(session, root, 'sPh', 'Name', 'sPhRenamed');
    expect(valueTag(savedChunk(session, root), 'sPhRenamed')).toBe(valueTag(MATLAB_CHUNK, 'sPh'));
    expect(edit(session, root, 'sPhRenamed.p', 'Value', '7')).toBe(true);
    const back = reopened(session, root);
    expect(nodeAt(back, 'sPhRenamed.p').displayValue).toBe('7');
    expect(valueTag(savedChunk(session, root), 'sPhRenamed')).toBe(valueTag(chunkOf(SAVES.files['sPh_value.sldd']), 'sPh'));
  });

  it('the Parameter the edit co-writes is MATLAB\'s: a resize writes Dimensions, a double over a single Value its DataType', () => {
    const resized = reopened(...(Object.values(made(CASES.find((x) => x.name === 'sPh_resize')!)) as [any, any]));
    expect(nodeAt(resized, 'sPh.p').serial._properties.Dimensions).toEqual([2, 3]);
    expect(nodeAt(open().root, 'sPh.p').serial._properties.Dimensions).toEqual([1, 1]);
    expect(nodeAt(resized, 'sPh.p').displayValue).toBe('[1 2 3; 4 5 6]');
    expect(nodeAt(open().root, 'sTh.t').DataType).toBe('single');
    const edited = made(CASES.find((x) => x.name === 'sTh_value_double')!);
    // Shown at once, as the save writes it and MATLAB loads it (ParameterNode._followSourceDataType),
    // as in a MAT-file; and undone, the DataType read.
    expect(nodeAt(edited.root, 'sTh.t').DataType).toBe('auto');
    const typed = reopened(edited.session, edited.root);
    expect(nodeAt(typed, 'sTh.t').DataType).toBe('auto');
    edited.session.setActive(edited.root, nodeAt(edited.root, 'sTh'));
    edited.session.undo();
    expect([nodeAt(edited.root, 'sTh.t').displayValue, nodeAt(edited.root, 'sTh.t').DataType]).toEqual([nodeAt(open().root, 'sTh.t').displayValue, 'single']);
  });

});

describe('a handle two fields of a stream share is one object, shown as one, as a MAT-file shows one', () => {
  // `shared` is struct('a', h, 'b', h, 'sp', sparse(…)): MATLAB loads its a and b as one handle.
  const shows = (root: any, path: string): string[] => {
    const node = nodeAt(root, path);
    return subtree(node).map((n: any) => `${n.matlabPath.slice(node.matlabPath.length)} ${n.displayValue} ${n.Description ?? ''} ${n.DataType ?? ''}`);
  };
  const inStep = (root: any) => expect(shows(root, 'shared.b')).toEqual(shows(root, 'shared.a'));

  it('an edit of one is shown by the other at once, read back by both, and written once', () => {
    const { session, root } = made(CASES.find((x) => x.name === 'shared_value')!);
    expect([nodeAt(root, 'shared.a').displayValue, nodeAt(root, 'shared.b').displayValue]).toEqual(['40', '40']);
    inStep(root);
    const back = reopened(session, root);
    expect(rows(nodeAt(back, 'shared'))).toEqual(rows(nodeAt(root, 'shared')));
    // The save is the one the edit made through a alone writes (one cell, the case's own).
    expect(valueTag(savedChunk(session, root), 'shared')).toBe(valueTag(chunkOf(SAVES.files['shared_value.sldd']), 'shared'));
  });

  it('the other takes no edit of its own, and the one first edited takes every later one', () => {
    const { session, root } = made(CASES.find((x) => x.name === 'shared_value')!);
    const refusal = 'Cannot edit "shared": shared.b is one object with shared.a (one handle), and shared.a holds an edit of it: the object is edited through shared.a, and shared.b shows each edit.';
    expect(edit(session, root, 'shared.b', 'Value', '41')).toMatchObject({ error: true, reason: refusal });
    expect(edit(session, root, 'shared.b', 'Description', 'mine')).toMatchObject({ error: true, reason: refusal });
    expect(nodeAt(root, 'shared.b').valueEditable).toBe(false);
    expect(edit(session, root, 'shared.a', 'Value', '42')).toBe(true);
    expect(nodeAt(root, 'shared.b').displayValue).toBe('42');
    inStep(root);
  });

  it('an edit undone leaves the object no master: the other field takes the next edit, and the first shows it', () => {
    const { session, root } = open();
    expect(edit(session, root, 'shared.a', 'Value', '7')).toBe(true);
    session.undo();
    inStep(root);
    expect(valueTag(savedChunk(session, root), 'shared')).toBe(valueTag(MATLAB_CHUNK, 'shared'));
    expect(nodeAt(root, 'shared.b').valueEditable).toBe(true);
    expect(edit(session, root, 'shared.b', 'Value', '8')).toBe(true);
    expect(nodeAt(root, 'shared.a').displayValue).toBe('8');
    inStep(root);
    expect(edit(session, root, 'shared.a', 'Value', '9')).toMatchObject({
      error: true,
      reason: 'Cannot edit "shared": shared.a is one object with shared.b (one handle), and shared.b holds an edit of it: the object is edited through shared.b, and shared.a shows each edit.',
    });
    const back = reopened(session, root);
    expect([nodeAt(back, 'shared.a').displayValue, nodeAt(back, 'shared.b').displayValue]).toEqual(['8', '8']);
  });

  it('every kind of Value edit, each undone and redone, shown by both, and all undone the stream MATLAB wrote', () => {
    const { session, root } = open();
    const a = () => nodeAt(root, 'shared.a');
    expect(edit(session, root, 'shared.a', 'Value', '[1 2 3]')).toBe(true);
    inStep(root);
    expect(edit(session, root, 'shared.a.Value(2)', 'Value', '9')).toBe(true);
    inStep(root);
    session.setActive(root, a()._valueNode);
    expect(session.addChildTo(a()._valueNode.id)).not.toBeNull();
    inStep(root);
    const last = a()._valueNode.children[3];
    session.setActive(root, last);
    expect(session.deleteNodeById(last.id)).toBe(true);
    inStep(root);
    // The rows copied into b are the session's, found by their ids.
    const element = nodeAt(root, 'shared.b.Value(2)');
    expect(session.findNodeById(element.id)).toBe(element);
    expect(edit(session, root, 'shared.a', 'Description', 'held twice')).toBe(true);
    inStep(root);
    expect(nodeAt(root, 'shared.b').Description).toBe('held twice');
    const steps: string[] = [];
    for (let i = 0; i < 5; i++) {
      session.undo();
      inStep(root);
      steps.push(nodeAt(root, 'shared.b').displayValue + ' ' + nodeAt(root, 'shared.b').Description);
    }
    expect(steps).toEqual(['[1 9 3] shared', '[1 9 3 0] shared', '[1 9 3] shared', '[1 2 3] shared', '4 shared']);
    expect(valueTag(savedChunk(session, root), 'shared')).toBe(valueTag(MATLAB_CHUNK, 'shared'));
    for (let i = 0; i < 5; i++) {
      session.redo();
      inStep(root);
    }
    const back = reopened(session, root);
    expect(rows(nodeAt(back, 'shared'))).toEqual(rows(nodeAt(root, 'shared')));
  });

  it('a host that edits the node itself, inside mutateSubtree, has the other shown too', () => {
    const { session, root } = open();
    const a = nodeAt(root, 'shared.a');
    expect(session.mutateSubtree(a, () => a.setProperty('Value', '[5 6]'))).toBe(true);
    expect(nodeAt(root, 'shared.b').displayValue).toBe('[5 6]');
    const element = nodeAt(root, 'shared.b.Value(1)');
    expect(session.findNodeById(element.id)).toBe(element);
    expect(nodeAt(reopened(session, root), 'shared.b').displayValue).toBe('[5 6]');
  });

  it('edits made around the session, two values of one property, are refused by the value, and the save never writes either over the other', () => {
    const { session, root } = open();
    expect(nodeAt(root, 'shared.a').setProperty('Value', '40')).toBe(true);
    // No session around it: nothing copied into b, which holds the value read.
    expect(nodeAt(root, 'shared.b').displayValue).toBe('4');
    expect(nodeAt(root, 'shared.b').setProperty('Value', '41')).toMatchObject({
      error: true,
      reason: 'Cannot edit "shared": shared.b and shared.a are one object, whose Value shared.a holds another value of.',
    });
    expect(nodeAt(root, 'shared.b').setProperty('Value', '40')).toBe(true);
    expect([nodeAt(reopened(session, root), 'shared.a').displayValue, nodeAt(reopened(session, root), 'shared.b').displayValue]).toEqual(['40', '40']);
  });
});

describe('an edit in a text dictionary\'s pasted cdata is saved as that cdata with only its cells swapped', () => {
  const entries = (text: string): any[] =>
    JSON.parse(text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
  const ORIGINAL = entries(new TextDecoder().decode(SAVES.files['orig_text.sldd']));
  const streamOf = (value: any): Uint8Array => matStreamPrefix(uudecode(value._value))!;

  it('the text dictionary holds every stream entry as the cdata of the binary one\'s stream', () => {
    for (const name of STREAMS) {
      const value = ORIGINAL.find((e) => e.name === name).value;
      expect(Object.keys(value), name).toEqual(['_type', '_value']);
      expect(value._type).toBe('cdata');
      expect(sameBytes(streamOf(value), hexStream(MATLAB_CHUNK, name).bytes), name).toBe(true);
      expect(value._value, name).toBe(uuencode(streamOf(value)));
    }
  });

  for (const c of CASES.filter((x) => x.format !== 'bin')) {
    const saved = entries(new TextDecoder().decode(SAVES.files[c.name + '.sldd']));
    const edited = entriesOf(c);

    it(`${c.name}: every other entry is as it was, and the edited one only its cdata's text`, () => {
      expect(saved.map((e) => e.name)).toEqual(ORIGINAL.map((e) => e.name));
      for (const e of saved) {
        const was = ORIGINAL.find((o) => o.name === e.name);
        if (!edited.includes(e.name)) {
          expect(e, e.name).toEqual(was);
          continue;
        }
        expect(e.name).toBe(was.name);
        expect(Object.keys(e.value)).toEqual(['_type', '_value']);
        expect(e.value._type).toBe('cdata');
        expect(e.value._value).not.toBe(was.value._value);
        expect(e.value._value).toBe(uuencode(streamOf(e.value)));
        const { lastmod: _a, ...meta } = e.metadata;
        const { lastmod: _b, ...metaWas } = was.metadata;
        expect(meta).toEqual(metaWas);
      }
    });

    // The same edit of the binary dictionary writes the same stream, byte for byte.
    const twin = CASES.find((x) => x.format === 'bin' && x.name === c.name.replace(/^txt_/, ''));
    if (twin) {
      it(`${c.name}: the stream is the one the same edit writes into the binary dictionary`, () => {
        const bin = chunkOf(SAVES.files[twin.name + '.sldd']);
        for (const name of edited) {
          expect(sameBytes(streamOf(saved.find((e) => e.name === name).value), hexStream(bin, name).bytes), name).toBe(true);
        }
      });
    }

    if (c.format === 'txt') {
      it(`${c.name}: opened again, the edited entries read as the session showed them`, () => {
        const { session, root } = made(c);
        const back = reopened(session, root);
        for (const name of edited) {
          expect(rows(nodeAt(back, name))).toEqual(rows(nodeAt(root, name)));
        }
      });
    }
  }

  it('a binary entry edited and then pasted is the edited stream; its edit undone, the stream as read', () => {
    const value = (file: string) => entries(new TextDecoder().decode(SAVES.files[file])).find((e) => e.name === 'sPh').value;
    const { session, root } = open();
    expect(edit(session, root, 'sPh.p', 'Description', 'pasted edit')).toBe(true);
    const payload = JSON.parse(JSON.stringify(nodeAt(root, 'sPh').serialize()));
    expect(payload.value._type).toBe('encoded');
    expect(payload.value._attrs.EncodedLength).toBe(String(streamOf(value('txt_paste_edited.sldd')).length));
    expect(value('txt_paste_edited.sldd')).not.toEqual(value('orig_text.sldd'));
    session.undo();
    expect(nodeAt(root, 'sPh').serialize().value).toEqual(hexOfMatlab('sPh'));
  });
});

/** The hex value MATLAB wrote for an entry, as the reader holds one (EncodedValue). */
function hexOfMatlab(name: string): unknown {
  const { root } = open();
  return nodeAt(root, name).serialize().value;
}

describe('what the rules refuse is refused before it is made, and the dictionary is as it was', () => {
  const REFUSED: [string, string, string, RegExp][] = [
    ['sPh.p', 'Min', '20', /^Cannot edit "sPh": sPh\.p\.Min \(20\) would be greater than its Max \(10\)/],
    ['sPh.p', 'Max', '-1', /^Cannot edit "sPh": sPh\.p\.Min \(0\) would be greater than its Max \(-1\)/],
    ['pSp', 'Value', '[1 2]', /^Cannot edit "pSp": pSp\.Value is a sparse double, which this package does not write into a Simulink\.Parameter\.$/],
    ['pSp.Value(1,2)', 'Value', '8', /^Cannot edit "pSp": pSp\.Value is a sparse double/],
    ['pStruct.p.Value.a', 'Value', "'x'", /^Cannot edit "pStruct": pStruct\.p\.Value\.a would be a char, which this package does not write into a Simulink\.Parameter's Value\.$/],
    ['sigH.sig', 'DataType', 'Inherit: auto', /^Cannot edit "sigH": sigH\.sig\.DataType would be 'Inherit: auto'/],
    ['sTh.t', 'Description', 'x', /^Cannot edit "sTh": sTh\.t\.Description is at its class default/],
    ['cPh{1}', 'Min', '0', /^Cannot edit "cPh": cPh\{1\}\.Min is at its class default/],
    ['sPh.q', 'Value', '6', ENCODED_REASON],
    ['sPh.sp(1,2)', 'Value', '8', ENCODED_REASON],
    ['sPh.p', 'DataType', 'single', ENCODED_REASON],
    ['sPh', 'Value', '1', ENCODED_REASON],
  ];
  for (const [path, prop, text, reason] of REFUSED) {
    it(`${path} ${prop} = ${text}`, () => {
      const { session, root } = open();
      const before = rows(nodeAt(root, entryOfPath(path)));
      const result = edit(session, root, path, prop, text) as { error?: boolean; reason?: string };
      expect(result).toMatchObject({ error: true });
      expect(result.reason).toMatch(reason);
      expect(rows(nodeAt(root, entryOfPath(path)))).toEqual(before);
      expect(savedChunk(session, root)).toBe(MATLAB_CHUNK);
    });
  }
});

describe('a stream a save could not write again exactly takes no edit', () => {
  // The fixture with one entry's Value element changed as `change` says, zipped again.
  const withValue = (name: string, change: (tag: string) => string): Uint8Array => {
    const parts = unzipSync(BINARY);
    const tag = valueTag(MATLAB_CHUNK, name);
    parts[CHUNK] = strToU8(MATLAB_CHUNK.replace(tag, change(tag)));
    return zipSync(parts);
  };
  const refusedIn = (bytes: Uint8Array, path: string, prop: string, text: string): string => {
    const { session, root } = open(bytes);
    const result = edit(session, root, path, prop, text) as { error?: boolean; reason?: string };
    expect(result).toMatchObject({ error: true });
    return result.reason!;
  };

  it('hex holding digits past its EncodedLength, which a save would drop', () => {
    const bytes = withValue('sPh', (tag) => tag.replace('</P>', '00</P>'));
    expect(nodeAt(open(bytes).root, 'sPh.p').displayValue).toBe('5');
    expect(refusedIn(bytes, 'sPh.p', 'Value', '7')).toBe(
      'Cannot edit "sPh": its hex text is not the 3816 bytes its EncodedLength says, and nothing more, which a save would have to write again.',
    );
  });

  it('a stream holding an element after its objects', () => {
    // An empty miMATRIX after the subsystem: the readers decode the objects, and a save could not say what it is.
    const extra = '0E00000000000000';
    const bytes = withValue('sPh', (tag) => tag.replace(/EncodedLength="(\d+)"/, (_m, n) => `EncodedLength="${Number(n) + 8}"`).replace('</P>', extra + '</P>'));
    expect(nodeAt(open(bytes).root, 'sPh.p').displayValue).toBe('5');
    expect(refusedIn(bytes, 'sPh.p', 'Value', '7')).toBe(
      'Cannot edit "sPh": its stream is not a value and its objects, which a save rewrites: it holds more after its objects, which a save would not write.',
    );
  });

  it('cdata whose text is not the six-bit text of its stream (no NUL padding)', () => {
    const json = JSON.parse(new TextDecoder().decode(SAVES.files['orig_text.sldd']));
    const value = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: any) => e.name === 'sPh').value;
    expect(value._value.endsWith('\u0000')).toBe(true);
    value._value = value._value.replace(/\u0000+$/, '');
    const bytes = new TextEncoder().encode(JSON.stringify(json, null, '\t'));
    // MATLAB reads it (the probe's tol_text_nopad), and so does this package; a save could not write it again as it is.
    expect(nodeAt(open(bytes, 'orig_text.sldd').root, 'sPh.p').displayValue).toBe('5');
    expect(refusedIn(bytes, 'sPh.p', 'Description', 'x')).toBe(
      'Cannot edit "sPh": its encoded text is not its stream, and nothing more, which a save would have to write again.',
    );
  });
});

describe('an edit of the stream no gate asked about refuses the save, and nothing is written', () => {
  it('a value beside the objects changed around the editor', () => {
    const { session, root } = open();
    const q = nodeAt(root, 'sPh.q');
    q._scalarValue = 6;
    q._markModified();
    expect(() => session.serializeSource(root.name)).toThrow(MatWriteError);
    expect(() => session.serializeSource(root.name)).toThrow(
      'Cannot write "sPh": sPh holds an edit of a part of its value that is no object of it, which a save does not write into its stream. Nothing was written.',
    );
  });

  it('a property no rule writes changed around the editor', () => {
    const { session, root } = open();
    const p = nodeAt(root, 'sPh.p');
    expect(edit(session, root, 'sPh.p', 'Value', '7')).toBe(true);
    p.DataType = 'single';
    expect(() => session.serializeSource(root.name)).toThrow(/^Cannot write "sPh": sPh\.p holds an edit of a property a save does not write into a Simulink\.Parameter\. Nothing was written\.$/);
  });
});

describe('a stream that is not an entry\'s whole value stays read-only, as it was', () => {
  it('a cell element holding the stream: every node in it refuses, and the save writes it as read', () => {
    const parts = unzipSync(BINARY);
    const hex = valueTag(MATLAB_CHUNK, 'sPh').replace(/^<P Name="Value" /, '<Element ').replace(/<\/P>$/, '</Element>');
    const cell = '<P Name="Value" Class="cell" Dimension="1*2">\n            <Element Class="double">1.0</Element>\n            ' + hex + '\n        </P>';
    // plainS's struct Value, to the close of the Value element before the object's own close.
    const object = objectOf(MATLAB_CHUNK, 'plainS');
    const value = object.slice(object.indexOf('<P Name="Value"'), object.lastIndexOf('</P>') + 4);
    const xml = MATLAB_CHUNK.replace(object, object.replace(value, cell));
    parts[CHUNK] = strToU8(xml);
    const { session, root } = open(zipSync(parts));
    const held = nodeAt(root, 'plainS{2}');
    expect(held._encoded).toBeDefined();
    expect(nodeAt(root, 'plainS{2}.p').displayValue).toBe('5');
    for (const node of subtree(held)) {
      expect(node.valueEditable, node.matlabPath).toBe(false);
      for (const prop of ['Value', 'Description', 'Min']) {
        expect(node.setProperty(prop, '1'), node.matlabPath + ' ' + prop).toMatchObject({ error: true, reason: expect.stringMatching(ENCODED_REASON) });
      }
    }
    expect(edit(session, root, 'plainS{1}', 'Value', '2')).toBe(true);
    expect(savedChunk(session, root)).toContain(hex);
  });
});

describe('what the gate finds of an object in a stream is kept until an edit of it', () => {
  it('found once, and forgotten by an edit of the object, its undo and a copy into its twin', () => {
    const { session, root } = open();
    const stream: any = mcosStreamGateOf(nodeAt(root, 'shared'));
    const kept = (path: string) => stream._propertyVerdicts._byNode.has(nodeAt(root, path));
    expect([nodeAt(root, 'shared.a').valueEditable, nodeAt(root, 'shared.b').valueEditable]).toEqual([true, true]);
    expect([kept('shared.a'), kept('shared.b')]).toEqual([true, true]);
    expect(edit(session, root, 'shared.a', 'Value', '7')).toBe(true);
    expect([kept('shared.a'), kept('shared.b')]).toEqual([false, false]);
    expect(nodeAt(root, 'shared.b').valueEditable).toBe(false);
    expect(kept('shared.b')).toBe(true);
    session.undo();
    expect([kept('shared.a'), kept('shared.b')]).toEqual([false, false]);
    expect(nodeAt(root, 'shared.b').valueEditable).toBe(true);
  });
});

describe('the save re-reads the stream it wrote, and refuses one that does not read as planned', () => {
  // The writer's own check (mcosStreamEdit._selfCheck), asked of streams it did not write: what the
  // save hands back always passed it.
  const setUp = () => {
    const { session, root } = open();
    expect(edit(session, root, 'sPh.p', 'Value', '7')).toBe(true);
    const holder = nodeAt(root, 'sPh');
    const stream: any = mcosStreamGateOf(holder);
    const good: Uint8Array = stream.rewritten();
    const framed = stream._framing();
    const parts = mcosStreamParts(good) as { valueEnd: number; subsystem: Uint8Array };
    return { session, root, stream, good, framed, element: parts.subsystem, edited: [nodeAt(root, 'sPh.p')] };
  };

  it('passes the stream it wrote', () => {
    const { stream, good, framed, element, edited } = setUp();
    const decoded = decodeMatStream(good) as { variable: any; trailingElements: Uint8Array[] };
    expect(stream._readBackWrong(decoded.variable, decoded.trailingElements[0], edited)).toBeNull();
    expect(sameBytes(stream.rewritten(), good)).toBe(true);
    expect(framed.valueEnd).toBe((mcosStreamParts(good) as { valueEnd: number }).valueEnd);
    expect(element.length).toBeGreaterThan(0);
  });

  it('refuses a stream whose objects read back holding the value as it was', () => {
    const { stream, edited } = setUp();
    const was = hexStream(MATLAB_CHUNK, 'sPh').bytes;
    const decoded = decodeMatStream(was) as { variable: any; trailingElements: Uint8Array[] };
    expect(stream._readBackWrong(decoded.variable, decoded.trailingElements[0], edited)).toMatch(/^sPh\.p\.Value/);
  });

  it('refuses a stream whose subsystem is the one read, or whose value is not the bytes it was', () => {
    const { stream, good, framed, element, edited } = setUp();
    const original = (mcosStreamParts(hexStream(MATLAB_CHUNK, 'sPh').bytes) as { subsystem: Uint8Array }).subsystem;
    const cells = [{ objectId: 0, cellIndex: 0, savedName: 'Value', value: null }];
    expect(stream._selfCheck(good, framed, original, cells, edited)).toBe('its objects are not the element written for them');
    const valueChanged = good.slice();
    valueChanged[20] ^= 1;
    expect(stream._selfCheck(valueChanged, framed, element, cells, edited)).toBe('its value is not the bytes it was read as');
    const stale = new Uint8Array(good.length + 8);
    stale.set(good);
    expect(stream._selfCheck(stale, framed, element, cells, edited)).toMatch(/^it /);
  });

  it("refuses a stream whose subsystem holds a byte the rewrite copies as read changed, as a MAT-file's check does", () => {
    const { stream, framed, edited } = setUp();
    const written = objectSubsystemEdit(framed.subsystem, edited, (n) => stream._state(n), () => 'sPh')!;
    const data = (readMcosSubsystem(written.element) as { subsystem: any }).subsystem.outer.subs[3];
    const tampered = written.element.slice();
    tampered[data.data + 4] = 0xab;
    const bytes = streamWithSubsystem(stream.read.bytes, framed.valueEnd, tampered);
    expect(stream._selfCheck(streamWithSubsystem(stream.read.bytes, framed.valueEnd, written.element), framed, written.element, written.cells, edited)).toBeNull();
    expect(stream._selfCheck(bytes, framed, tampered, written.cells, edited)).toBe('its objects read back with the preamble of their payload, which no edit wrote, changed');
  });
});

describe('a stream pasted into the other kind of dictionary takes the same edits there', () => {
  it('binary into text, edited before any save: the cdata of the edited stream', () => {
    const session = createSession();
    const bin: any = ingest(session, buffer(BINARY), { filename: 'b.sldd' });
    const text: any = ingest(session, buffer(TEXT), { filename: 't.sldd' });
    pasteStreams(bin, text);
    session.setActiveContext(text);
    expect(edit(session, text, 'sPh.p', 'Value', '7')).toBe(true);
    const saved = session.serializeSource(text.name).text as string;
    const value = JSON.parse(saved).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: any) => e.name === 'sPh').value;
    expect(value._type).toBe('cdata');
    expect(sameBytes(matStreamPrefix(uudecode(value._value))!, hexStream(chunkOf(SAVES.files['sPh_value.sldd']), 'sPh').bytes)).toBe(true);
    expect(nodeAt(open(new TextEncoder().encode(saved), 't.sldd').root, 'sPh.p').displayValue).toBe('7');
  });

  it('text into binary, edited: the hex of the edited stream, its EncodedLength exact', () => {
    const session = createSession();
    const text: any = ingest(session, buffer(SAVES.files['orig_text.sldd']), { filename: 't.sldd' });
    const bin: any = ingest(session, buffer(BINARY), { filename: 'b.sldd' });
    // Into a binary dictionary that holds no sPh: the fixture's own, its sPh deleted.
    const design = bin.getSection('design');
    session.setActiveContext(bin);
    expect(session.deleteNodeById(design.children.find((e: any) => e.name === 'sPh').id)).toBe(true);
    const payload = JSON.parse(JSON.stringify(text.getSection('design').children.find((e: any) => e.name === 'sPh').serialize()));
    expect(payload.value._type).toBe('cdata');
    design.parseEntry(payload);
    expect(edit(session, bin, 'sPh.p', 'Value', '7')).toBe(true);
    const saved = savedChunk(session, bin);
    const { bytes, encodedLength, digits } = hexStream(saved, 'sPh');
    expect([encodedLength, digits]).toEqual([bytes.length, 2 * bytes.length]);
    expect(sameBytes(bytes, hexStream(chunkOf(SAVES.files['sPh_value.sldd']), 'sPh').bytes)).toBe(true);
  });
});

describe('a row added to a Value, and undone, writes the stream as it was read', () => {
  it('an element added to cPh{1}\'s Value and a field to pStruct\'s, both undone', () => {
    const { session, root } = open();
    for (const path of ['cPh{1}.Value', 'pStruct.p.Value']) {
      session.setActive(root, nodeAt(root, path));
      expect(session.addChildTo(nodeAt(root, path).id)).toBeTruthy();
    }
    session.undo();
    session.undo();
    const saved = savedChunk(session, root);
    expect(valueTag(saved, 'cPh')).toBe(valueTag(MATLAB_CHUNK, 'cPh'));
    expect(valueTag(saved, 'pStruct')).toBe(valueTag(MATLAB_CHUNK, 'pStruct'));
  });
});
