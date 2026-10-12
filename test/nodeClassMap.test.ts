// Copyright 2026 The MathWorks, Inc.
//
// The class an entry's value names is the FILE's word, and the class map answers it
// by key. A class the map does not register is a class like any user class: the
// value becomes a generic ObjectNode whose Kind is its raw class name. But the map
// is an object literal, and an object literal answers every name Object.prototype
// carries — `toString`, `valueOf`, `constructor`, `hasOwnProperty`… — with an
// inherited member. Those are valid MATLAB class names, and a dictionary holding one
// failed to open at all, in either format: `CLASS_MAP['toString']` is a function, the
// dispatch called its `parse`, and the whole read threw
// "TypeError: NodeClass.parse is not a function". `__proto__` (which MATLAB cannot
// write, but a file can carry) answered Object.prototype itself, with the same result.
//
// Each case is checked against a CONTROL class the map does not register either, read
// from the same fixture in the same format, so "an unregistered class" means exactly
// what it means for Unknown.Klass.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync } from 'fflate';
import { createSession, ingest, toDTO } from '../src/index.js';
import { getClass } from '../src/datamodel/node/data/NodeClassMap.js';
import type DataNode from '../src/datamodel/node/DataNode.js';
import ObjectNode from '../src/datamodel/node/data/ObjectNode.js';
import ParameterNode from '../src/datamodel/node/data/ParameterNode.js';
import { OBJECT_ICON } from '../src/datamodel/node/icons.js';
import { NS_DESIGN, NS_OTHER } from '../src/datamodel/SectionConstants.js';

const INHERITED = [
  'toString',
  'valueOf',
  'constructor',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  '__proto__',
  '__defineGetter__',
];
const CONTROL = 'Unknown.Klass';

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
}

// rt_text.sldd and rt_bin.sldd each hold one entry, `gadget`, whose value is a
// MyGadget object (MATLAB-authored: test/fixtures/mcos/rt_author.m). The class is
// renamed in the value and nowhere else; `derived` moves the entry into
// Architectural Data, which reads its Kind through a second table.
function textWithClass(cls: string, derived = false): string {
  let text = new TextDecoder().decode(fixture('rt_text.sldd'))
    .replace('"_array_class": "MyGadget"', `"_array_class": ${JSON.stringify(cls)}`);
  if (derived) {
    text = text
      .replace(`"namespace": "${NS_OTHER}"`, `"namespace": "${NS_DESIGN}"`)
      .replace('"isderived": "0"', '"isderived": "1"');
  }
  return text;
}

function binaryWithClass(cls: string, derived = false): Uint8Array {
  const files = unzipSync(fixture('rt_bin.sldd'));
  let xml = new TextDecoder().decode(files['data/chunk0.xml'])
    .replace('<Element Class="MyGadget">', `<Element Class="${cls}">`);
  if (derived) {
    xml = xml
      .replace(`<P Name="Namespace" Class="char">${NS_OTHER}</P>`, `<P Name="Namespace" Class="char">${NS_DESIGN}</P>`)
      .replace('<P Name="IsDerived" Class="char">0</P>', '<P Name="IsDerived" Class="char">1</P>');
  }
  files['data/chunk0.xml'] = new TextEncoder().encode(xml);
  return zipSync(files);
}

const FORMATS = [
  ['text', textWithClass],
  ['binary', binaryWithClass],
] as const;

function open(content: string | Uint8Array, entryName = 'gadget') {
  const session = createSession();
  const source = ingest(session, content, { filename: 'gadget.sldd' });
  const entry = source.flatten().find((n) => n.name === entryName) as unknown as ObjectNode;
  return { session, source, entry };
}

// What the tree shows of an entry, minus its class: the same for every class the
// map does not register.
function shape(entry: ObjectNode) {
  return {
    node: entry.constructor.name,
    icon: entry.icon,
    value: entry.displayValue.replace(entry.className, '<class>'),
    children: entry.children.map((c) => [c.name, (c as unknown as { displayValue: string }).displayValue]),
  };
}

describe('an entry whose class is named after an Object.prototype member', () => {
  it.each(FORMATS)('the control opens as a generic object in a %s dictionary', (_, withClass) => {
    const { entry } = open(withClass(CONTROL));
    expect(entry).toBeInstanceOf(ObjectNode);
    expect([entry.className, entry.kind, entry.icon]).toEqual([CONTROL, CONTROL, OBJECT_ICON]);
    // And a registered class still takes its own node: the lookup is narrowed, not dropped.
    expect(open(withClass('Simulink.Parameter')).entry).toBeInstanceOf(ParameterNode);
  });

  describe.each(FORMATS)('in a %s dictionary', (_, withClass) => {
    const control = shape(open(withClass(CONTROL)).entry);

    it.each(INHERITED)('opens one of class %s as the same generic object', (cls) => {
      const { entry } = open(withClass(cls));
      expect(shape(entry)).toEqual(control);
      expect(entry.className).toBe(cls);
      // The Kind of a class with no friendly name is the raw class name, a string, on
      // every surface a host reads it from.
      expect(entry.kind).toBe(cls);
      expect(entry.toRow().Kind).toBe(cls);
      expect(toDTO(entry).kind).toBe(cls);
    });

    it.each(INHERITED)('reads the Kind of a derived entry of class %s as its class name', (cls) => {
      // An Architectural Data entry asks the derived-Kind table first, then the plain
      // one: a second lookup the same name used to answer with a function.
      const { entry } = open(withClass(cls, true));
      expect(entry.isDerived).toBe(true);
      expect(entry.kind).toBe(cls);
      expect(open(withClass(CONTROL, true)).entry.kind).toBe(CONTROL);
    });

    it.each(INHERITED)('renames, edits, saves and reopens an entry of class %s', (cls) => {
      // Every edit of the entry asks the property schema for its class first
      // (trySetSchemaProperty), and that lookup threw "Cannot read properties of
      // undefined (reading 'map')" for these names once the dictionary could open.
      const { session, source, entry } = open(withClass(cls));
      expect(entry.setProperty('Name', 'renamed')).toBe(true);
      const wheels = entry.children.find((c) => c.name === 'Wheels') as unknown as DataNode;
      expect(wheels.setProperty('Value', '6')).toBe(true);
      const saved = session.serializeSource(source.name)!;
      const reopened = open(saved.kind === 'text' ? saved.text : saved.bytes, 'renamed').entry;
      expect([reopened.className, reopened.kind]).toEqual([cls, cls]);
      expect((reopened.children.find((c) => c.name === 'Wheels') as unknown as DataNode).displayValue).toBe('6');
    });
  });

  it('is unregistered to getClass, as any class the map does not name', () => {
    for (const cls of [...INHERITED, CONTROL]) {
      expect(getClass(cls)).toBeNull();
    }
    expect(getClass('Simulink.Parameter')).toBe(ParameterNode);
  });
});
