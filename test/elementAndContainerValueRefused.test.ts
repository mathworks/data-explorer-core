// Copyright 2026 The MathWorks, Inc.
//
// A bus, connection or function element's Value, and a container's, takes no editor and no
// edit (the maintainer's ruling C-257, 2026-10-16).
//
// None of these has a Value of its own. A Simulink.BusElement, a Simulink.ConnectionElement
// and a Simulink.FunctionElement carry no Value property (Simulink.BusElement.md,
// Simulink.ConnectionElement.md, Simulink.FunctionElement.md list what each one edits), and
// a dictionary, a section, a model or a .mat file is a container of entries. But the Value
// column of each said it was editable: BaseNode.valueEditable answers true for the blank
// text an element and a container show, and a function element's Prototype is plain text.
// No element property maps to the Value column, so BaseNode.toRow copied that answer into
// the row's `_valueEditable`, and the host opened an editor on the cell.
//
// What the element then did with the edit was worse than refusing it. DataNode's generic
// tail kept the text on a `Value` field nothing writes, marked the bus Modified, stamped its
// lastmod, pushed an undo step and answered `true`; the save dropped the text. So an element
// now refuses a Value as #100's objects do (ObjectNode.setProperty), and says why. One still
// inside an encoded stream keeps that refusal's own reason.
//
// A container has no setProperty, so its edit was already refused (DataModel.editProperty
// answers false and changes nothing); that is pinned here beside the flag. The controls pin
// what stays: an element's own properties still take an edit, and save it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { BaseBusElementNode } from '../src/datamodel/node/data/BaseBusNode.js';
import ContainerNode from '../src/datamodel/node/ContainerNode.js';
import ProjectNode from '../src/datamodel/node/container/ProjectNode.js';
import ProjectSectionNode from '../src/datamodel/node/container/ProjectSectionNode.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Any = any;

const subtree = (node: Any): Any[] => [node, ...node.children.flatMap(subtree)];

/** `file` is relative to test/. A text dictionary is read as text, anything else as bytes. */
function open(file: string, session: Any = createSession()): { session: Any; root: Any } {
  const bytes = readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)));
  const filename = file.split('/').pop()!;
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const content = filename.endsWith('.sldd') && !isZip ? bytes.toString('utf8') : (new Uint8Array(bytes).buffer as ArrayBuffer);
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

// Every element class, in a text and a binary dictionary where a fixture has one. No
// fixture holds a function element in a binary dictionary.
const ELEMENTS: [file: string, path: string, className: string][] = [
  ['fixtures/arch.sldd', 'arch/DataInterface/Element', 'Simulink.BusElement'],
  ['fixtures/arch.sldd', 'arch/PhysicalInterface/Element', 'Simulink.ConnectionElement'],
  ['fixtures/arch.sldd', 'arch/ServiceInterface/f', 'Simulink.FunctionElement'],
  ['fixtures/bus_types_text.sldd', 'design/btBus/plain', 'Simulink.BusElement'],
  ['fixtures/bus_types_binary.sldd', 'design/btBus/plain', 'Simulink.BusElement'],
  ['parity/artifacts/binary/params.sldd', 'design/MyBus/x', 'Simulink.BusElement'],
  ['parity/artifacts/binary/params.sldd', 'design/MyConnBus/c1', 'Simulink.ConnectionElement'],
];

describe("a bus, connection or function element's Value", () => {
  for (const [file, path, className] of ELEMENTS) {
    it(`offers no editor: ${file} ${path}`, () => {
      const { root } = open(file);
      const node = nodeAt(root, path);
      expect(node).toBeInstanceOf(BaseBusElementNode);
      expect(node.className).toBe(className);
      expect(node.valueEditable).toBe(false);
      const row = node.toRow();
      // What the cell shows is unchanged: blank, or a function element's Prototype.
      expect(row.Value).toBe(node.displayValue);
      expect(row._valueEditable, 'the host opens no editor on the cell').toBe(false);
    });

    it(`is refused by setProperty, and the save is the untouched one: ${file} ${path}`, () => {
      const { session, root } = open(file);
      const node = nodeAt(root, path);
      expect(node._encodedReadOnly, 'not the encoded-stream refusal').toBe(false);
      const bus = node.parent;
      const shown = node.displayValue;
      const status = bus.status;
      const untouched = saved(session, root);

      const result = node.setProperty('Value', '5');
      expect(result).toMatchObject({ error: true, invalidValue: '5', validValue: shown });
      expect((result as Any).reason).toContain(className);

      expect(node.Value, 'nothing kept on the node').toBeUndefined();
      expect(node.displayValue).toBe(shown);
      expect(bus.status, 'the bus is not marked').toBe(status);
      expect(saved(session, root)).toBe(untouched);
    });

    it(`is refused by session.editProperty, with no undo step: ${file} ${path}`, () => {
      const { session, root } = open(file);
      const node = nodeAt(root, path);
      session.setActive(root, node);
      expect(session.editProperty(node.id, 'Value', '5')).toMatchObject({ error: true, invalidValue: '5' });
      expect(session.canUndo()).toBe(false);
    });
  }
});

describe("an element's own properties still take an edit", () => {
  for (const [file, path] of [
    ['fixtures/arch.sldd', 'arch/DataInterface/Element'],
    ['fixtures/arch.sldd', 'arch/PhysicalInterface/Element'],
    ['parity/artifacts/binary/params.sldd', 'design/MyConnBus/c1'],
  ] as const) {
    it(`a Description lands, and the save keeps it: ${file} ${path}`, () => {
      const { session, root } = open(file);
      const node = nodeAt(root, path);
      session.setActive(root, node);
      expect(session.editProperty(node.id, 'Description', 'kept')).toBe(true);
      expect(saved(session, root)).toContain('kept');
    });
  }

  it("a function element's rename lands, and renames its Prototype with it", () => {
    const { root } = open('fixtures/arch.sldd');
    const node = nodeAt(root, 'arch/ServiceInterface/f');
    expect(node.setProperty('Name', 'g')).toBe(true);
    expect(node.displayValue).toBe('y = g(u,v)');
  });
});

describe("a container's Value", () => {
  // Every ContainerNode class: a dictionary and its sections, a .mat file, a model and its
  // sections, and a project and its sections.
  const opened: [file: string, classes: string[]][] = [
    ['fixtures/arch.sldd', ['SlddNode', 'SectionNode']],
    ['fixtures/bus_types_binary.sldd', ['SlddNode', 'SectionNode']],
    ['fixtures/strings.mat', ['MatNode']],
    ['fixtures/model_with_refs.slx', ['ModelNode', 'ModelSectionNode']],
  ];
  for (const [file, classes] of opened) {
    it(`offers no editor: ${file}`, () => {
      const { root } = open(file);
      const containers = subtree(root).filter((n: Any) => n instanceof ContainerNode);
      expect([...new Set(containers.map((n: Any) => n.constructor.name))].sort()).toEqual([...classes].sort());
      for (const node of containers) {
        expect(node.displayValue, node.id).toBe('');
        expect(node.valueEditable, node.id).toBe(false);
      }
    });
  }

  it('offers no editor: a project and a project section', () => {
    const project = new ProjectNode('p.prj');
    const section = project.addChild(new ProjectSectionNode('files', null, 'Files', 'folder'));
    expect(project.valueEditable).toBe(false);
    expect(section.valueEditable).toBe(false);
  });

  it('takes no edit: session.editProperty refuses it and changes nothing', () => {
    const { session, root } = open('fixtures/arch.sldd');
    const untouched = saved(session, root);
    for (const node of subtree(root).filter((n: Any) => n instanceof ContainerNode)) {
      expect(node.setProperty, node.id).toBeUndefined();
      session.setActive(root, node);
      expect(session.editProperty(node.id, 'Value', '5'), node.id).toBe(false);
    }
    expect(session.canUndo()).toBe(false);
    expect(saved(session, root)).toBe(untouched);
  });
});
