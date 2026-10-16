// Copyright 2026 The MathWorks, Inc.
//
// A value typed into an object's own Value cell is refused, not taken and then lost.
//
// An object that is not an enumeration value shows its summary, `<1x1 Widget>`, in the
// Value column, and the table offers no editor there (valueEditable is false, as
// ObjectNode.md records: Value is a read-only label). Its value is edited through its
// property rows. But ObjectNode.setProperty refused a Value only for an enumeration value,
// so a caller that asked anyway, `session.editProperty(id, 'Value', '42')`, reached
// DataNode's generic tail. That kept the text on a `Value` field nothing writes, marked the
// entry Modified, pushed an undo step and answered `true`. ObjectNode serializes from its
// raw value and its child rows, so the save dropped the edit. README's contract is that an
// edit made through the API is saved; one that cannot be saved is refused instead, as the
// enumeration case already was.
//
// The controls pin what stays: an object still read from an encoded stream keeps that
// refusal's own reason, an enumeration value keeps its own, and a property row under the
// object still takes a value and saves it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import ObjectNode from '../src/datamodel/node/data/ObjectNode.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Any = any;

const subtree = (node: Any): Any[] => [node, ...node.children.flatMap(subtree)];

function open(file: string, session: Any = createSession()): { session: Any; root: Any } {
  const bytes = readFileSync(fileURLToPath(new URL(`./fixtures/${file}`, import.meta.url)));
  const filename = file.split('/').pop()!;
  const content = file.endsWith('_text.sldd')
    ? bytes.toString('utf8')
    : (new Uint8Array(bytes).buffer as ArrayBuffer);
  return { session, root: ingest(session, content, { filename }) };
}

function nodeAt(root: Any, path: string): Any {
  const id = `${root.id}/${path}`;
  const node = subtree(root).find((n: Any) => n.id === id);
  expect(node, id).toBeDefined();
  return node;
}

/** What a save writes: the binary dictionary's chunk, or the text dictionary's JSON. */
function saved(session: Any, root: Any): string {
  const out = session.serializeSource(root.name)!;
  return out.kind === 'binary' ? new TextDecoder().decode(unzipSync(out.bytes)['data/chunk0.xml']) : out.text;
}

// Every case is an object that is not an enumeration value: an entry, a property of an
// entry, an object array and an element of one, and an object held in a cell.
const CASES: [file: string, path: string][] = [
  ['custom_object_binary.sldd', 'other/widget'],
  ['custom_object_binary.sldd', 'other/widget/Part'],
  ['custom_object_binary.sldd', 'other/widget/Parts'],
  ['custom_object_binary.sldd', 'other/widget/Parts/1'],
  ['custom_object_binary.sldd', 'design/partCell/1'],
  ['custom_object_text.sldd', 'other/widget'],
  ['custom_object_text.sldd', 'other/widget/Part'],
  ['custom_object_text.sldd', 'other/widget/Parts/1'],
  ['custom_object_text.sldd', 'other/widget/Tuning'],
  ['sparse/sparse_text.sldd', 'design/fhAlias'],
  ['sparse/hexobj_text.sldd', 'design/anonAlias'],
];

describe("a value typed into an object's own Value cell", () => {
  for (const [file, path] of CASES) {
    it(`is refused by setProperty, and the save is the untouched one: ${file} ${path}`, () => {
      const { session, root } = open(file);
      const node = nodeAt(root, path);
      expect(node).toBeInstanceOf(ObjectNode);
      expect(node.valueEditable, 'the table offers no editor').toBe(false);
      expect(node._encodedReadOnly, 'not the encoded-stream refusal').toBe(false);
      const entry = node.owningEntry ?? node;
      const shown = node.displayValue;
      expect(shown).toMatch(/^<\d+x\d+ /);
      const status = entry.status;
      const field = node.Value;
      const untouched = saved(session, root);

      const result = node.setProperty('Value', '42');
      expect(result).toMatchObject({ error: true, invalidValue: '42', validValue: shown });
      expect((result as Any).reason).toContain(node.className);

      expect(node.Value, 'nothing kept on the node').toBe(field);
      expect(node.displayValue).toBe(shown);
      expect(entry.status, 'the entry is not marked').toBe(status);
      expect(saved(session, root)).toBe(untouched);
    });

    it(`is refused by session.editProperty, with no undo step: ${file} ${path}`, () => {
      const { session, root } = open(file);
      const node = nodeAt(root, path);
      session.setActive(root, node);
      expect(session.editProperty(node.id, 'Value', '42')).toMatchObject({ error: true, invalidValue: '42' });
      expect(session.canUndo()).toBe(false);
    });
  }
});

describe('the refusals that were already there, and the edit that still lands', () => {
  it("an object still in its encoded stream keeps that refusal's own reason", () => {
    const { root } = open('sparse/sparse_binary.sldd');
    const node = nodeAt(root, 'design/fhAlias');
    expect(node).toBeInstanceOf(ObjectNode);
    expect(node._encodedReadOnly).toBe(true);
    expect(node.setProperty('Value', '42')).toMatchObject({
      error: true,
      reason: expect.stringMatching(/is stored as an encoded MATLAB value that this editor can show but not write/),
    });
  });

  it('an enumeration value keeps its own reason', () => {
    const { root } = open('custom_object_binary.sldd');
    const node = nodeAt(root, 'design/gearValue');
    expect(node.displayValue).toBe('GearMode.Reverse');
    expect(node.setProperty('Value', 'GearMode.Park')).toMatchObject({
      error: true,
      reason: expect.stringMatching(/is an enumeration value, which this editor shows but cannot change/),
    });
  });

  for (const file of ['custom_object_binary.sldd', 'custom_object_text.sldd']) {
    it(`a property row under the object still takes a value, and the save keeps it: ${file}`, () => {
      const { session, root } = open(file);
      const scalar = nodeAt(root, 'other/widget/Scalar');
      expect(scalar.valueEditable).toBe(true);
      session.setActive(root, scalar);
      expect(session.editProperty(scalar.id, 'Value', '7')).toBe(true);

      const out = session.serializeSource(root.name)!;
      const content = out.kind === 'binary' ? (out.bytes.slice().buffer as ArrayBuffer) : out.text;
      const again = ingest(createSession(), content, { filename: root.name }) as Any;
      expect(nodeAt(again, 'other/widget/Scalar').displayValue).toBe('7');
    });
  }
});
