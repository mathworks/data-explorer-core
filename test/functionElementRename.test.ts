// Copyright 2026 The MathWorks, Inc.
//
// Renaming a Simulink.FunctionElement renames the function its Prototype declares (C-052).
//
// In MATLAB the two are one value: setting a FunctionElement's Name renames the function in
// its Prototype, and with an empty Prototype the Name cannot be set at all (measured on
// R2027a; see Simulink.FunctionElement.md). A rename that moved only the Name saved a Name
// its Prototype contradicts. What is pinned here:
//   * a rename rewrites the function-name token of the Prototype, as MATLAB's setter does —
//     that token only, so an output or argument that shares the old name stays as it was;
//   * it is ONE edit: one undo restores both the Name and the Prototype, one redo re-applies
//     both;
//   * in a text dictionary and in a binary one, the saved file (serializeSource) carries the new
//     Prototype, and an undone rename saves the old one;
//   * a Prototype whose function name cannot be found unambiguously refuses the rename,
//     changing neither field and recording no undo step.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { createSession, ingest } from '../src/index.js';
import { parseBinarySlddParts } from '../src/datamodel/parser/BinarySlddParser.js';
import { serializeEntryToXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import { ServiceBusNode } from '../src/datamodel/node/data/ServiceBusNode.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

function openText(name: string) {
  const u8 = new Uint8Array(readFileSync(fixture(name)));
  const s = createSession();
  const src: any = ingest(s, u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer, {
    filename: name,
  });
  return { s, src };
}

// The ServiceBus entry of the corpus's one binary dictionary that has one
// (example/dd1.sldd), trimmed to what a FunctionElement needs.
const ARG = (name: string) =>
  `<Element Class="Simulink.BusElement"><P Name="DimensionsMode" Class="char">Fixed</P><P Name="Name" Class="char">${name}</P><P Name="DataType_internal" Class="char">double</P><P Name="Complexity" Class="char">real</P><P Name="Dimensions" Class="double">1.0</P></Element>`;
const FN = (name: string, prototype: string, args: string[]) =>
  `<Element Class="Simulink.FunctionElement"><P Name="Prototype" Class="char">${prototype}</P><P Name="Name" Class="char">${name}</P><P Name="Asynchronous" Class="logical">0</P><P Name="Arguments" Dimension="${args.length}*1">${args.map(ARG).join('')}</P></Element>`;
const CHUNK = `<?xml version="1.0" encoding="UTF-8"?>
<DataSource FormatVersion="1" MinRelease="R2014a" Arch="maca64">
    <Object Class="DD.ENTRY">
        <P Name="Name" Class="char">ServiceInterface</P>
        <P Name="UUID" Class="char">1c399950-c59b-404a-91e9-0cd02c0527ce</P>
        <P Name="Namespace" Class="char">dacaf35e-55a5-454d-a7c1-93db038a210e</P>
        <P Name="LastMod" Class="char">20260306T201108.832214</P>
        <P Name="LastModBy" Class="char">user</P>
        <P Name="IsDerived" Class="char">1</P>
        <P Name="Value"><Element Class="Simulink.ServiceBus"><P Name="Description" Class="char"/><P Name="Elements_internal" Dimension="2*1">${FN('f', 'y = f(u)', ['u', 'y'])}${FN('g', '[a,b] = g(g)', ['g', 'a', 'b'])}</P></Element></P>
    </Object>
</DataSource>
`;

function openBinary() {
  const s = createSession();
  const src: any = s.addDataSource('mem://svc', parseBinarySlddParts(CHUNK, {}), { path: 'svc.sldd' });
  return { s, src };
}

const savedText = (s: any, src: any): string => s.serializeSource(src.name).text;
const savedChunk = (s: any, src: any): string =>
  new TextDecoder().decode(unzipSync(s.serializeSource(src.name).bytes)['data/chunk0.xml']);

function functionElement(src: any, name: string): any {
  const bus = (src.flatten() as any[]).find((n) => n.isEntry && n.name === 'ServiceInterface');
  const elem = bus.children.find((c: any) => c.name === name);
  expect(elem?.className).toBe('Simulink.FunctionElement');
  return elem;
}

function rename(s: any, src: any, elem: any, to: string) {
  s.setActive(src, elem);
  return s.editProperty(elem.id, 'Name', to);
}

describe('renaming a FunctionElement in a text dictionary', () => {
  it('rewrites the function name in the Prototype, and the save carries it', () => {
    const { s, src } = openText('arch.sldd');
    const elem = functionElement(src, 'f1');
    expect(rename(s, src, elem, 'compute')).toBe(true);
    expect(elem.name).toBe('compute');
    expect(elem.Prototype).toBe('y = compute(u,v,w,y)');
    expect(elem.displayValue).toBe('y = compute(u,v,w,y)');
    const text = savedText(s, src);
    expect(text).toContain('"Prototype": "y = compute(u,v,w,y)"');
    expect(text).not.toContain('"Prototype": "y = f1(u,v,w,y)"');
    // Its siblings are as they were.
    expect(text).toContain('"Prototype": "y = f(u,v)"');
    expect(text).toContain('"Prototype": "y = f2(u,v)"');
  });

  it('is one edit: undo restores both fields, redo re-applies both', () => {
    const { s, src } = openText('arch.sldd');
    const elem = functionElement(src, 'f2');
    expect(rename(s, src, elem, 'svc')).toBe(true);
    s.undo();
    expect(elem.name).toBe('f2');
    expect(elem.Prototype).toBe('y = f2(u,v)');
    expect(savedText(s, src)).toContain('"Prototype": "y = f2(u,v)"');
    expect(s.canUndo()).toBe(false);
    s.redo();
    expect(elem.name).toBe('svc');
    expect(elem.Prototype).toBe('y = svc(u,v)');
    expect(savedText(s, src)).toContain('"Prototype": "y = svc(u,v)"');
  });
});

describe('renaming a FunctionElement in a binary dictionary', () => {
  it('rewrites the function name in the Prototype, and the save carries it', () => {
    const { s, src } = openBinary();
    const elem = functionElement(src, 'f');
    expect(rename(s, src, elem, 'step')).toBe(true);
    expect(elem.Prototype).toBe('y = step(u)');
    const chunk = savedChunk(s, src);
    expect(chunk).toContain('<P Name="Prototype" Class="char">y = step(u)</P>');
    expect(chunk).toContain('<P Name="Name" Class="char">step</P>');
    expect(chunk).not.toContain('y = f(u)');
  });

  it('is one edit: undo restores both fields, redo re-applies both', () => {
    const { s, src } = openBinary();
    const elem = functionElement(src, 'f');
    expect(rename(s, src, elem, 'step')).toBe(true);
    s.undo();
    expect(elem.name).toBe('f');
    expect(elem.Prototype).toBe('y = f(u)');
    expect(savedChunk(s, src)).toContain('<P Name="Prototype" Class="char">y = f(u)</P>');
    s.redo();
    expect(elem.Prototype).toBe('y = step(u)');
    expect(savedChunk(s, src)).toContain('<P Name="Prototype" Class="char">y = step(u)</P>');
  });

  it('renames the function token only, not an output or argument spelled the same', () => {
    const { s, src } = openBinary();
    const elem = functionElement(src, 'g');
    expect(rename(s, src, elem, 'h')).toBe(true);
    expect(elem.Prototype).toBe('[a,b] = h(g)');
    expect(savedChunk(s, src)).toContain('<P Name="Prototype" Class="char">[a,b] = h(g)</P>');
  });

  it('reaches the entry fragment a host splices (node.setProperty + serializeEntryToXml)', () => {
    // The VS Code binary editor renames through node.setProperty, not session.editProperty,
    // and writes the owning entry with serializeEntryToXml.
    const { src } = openBinary();
    const elem = functionElement(src, 'f');
    expect(elem.setProperty('Name', 'step')).toBe(true);
    expect(serializeEntryToXml(elem.parent)).toContain('<P Name="Prototype" Class="char">y = step(u)</P>');
  });
});

describe('a Prototype whose function name cannot be found refuses the rename', () => {
  const cases: Array<[string, string]> = [
    ['names another function', 'y = other(u,v)'],
    ['is empty', ''],
    ['does not parse as a prototype', 'y = f0(u'],
    ['has two calls', 'y = f0(u) + f0(v)'],
    ['qualifies the function name', 'y = a.f0(u)'],
    ['has trailing text', 'y = f0(u) % c'],
  ];
  for (const [what, prototype] of cases) {
    it(`when it ${what}`, () => {
      const bus = ServiceBusNode.createDefault('Svc', null);
      const elem: any = bus.addChildNode();
      elem.Prototype = prototype;
      const result: any = elem.setProperty('Name', 'renamed');
      expect(result).not.toBe(true);
      expect(result.error).toBe(true);
      expect(result.reason).toMatch(/Prototype/);
      expect(result.validValue).toBe('f0');
      expect(elem.name).toBe('f0');
      expect(elem.Prototype).toBe(prototype);
    });
  }

  it('and records no undo step for it', () => {
    const { s, src } = openText('arch.sldd');
    const elem = functionElement(src, 'f');
    elem.Prototype = 'y = notf(u,v)';
    const result: any = rename(s, src, elem, 'renamed');
    expect(result.error).toBe(true);
    expect(elem.name).toBe('f');
    expect(s.canUndo()).toBe(false);
  });

});

describe('a rename the name checks refuse leaves the Prototype as it was', () => {
  it('for a name that is not a MATLAB identifier', () => {
    const bus = ServiceBusNode.createDefault('Svc', null);
    const elem: any = bus.addChildNode();
    const result: any = elem.setProperty('Name', '1abc');
    expect(result.error).toBe(true);
    expect(result.reason).not.toMatch(/Prototype/);
    expect(elem.name).toBe('f0');
    expect(elem.Prototype).toBe('y = f0(u,v)');
  });

  it("for a sibling's name", () => {
    const bus = ServiceBusNode.createDefault('Svc', null);
    bus.addChildNode();
    const elem: any = bus.addChildNode();
    const result: any = elem.setProperty('Name', 'f0');
    expect(result.error).toBe(true);
    expect(elem.name).toBe('f1');
    expect(elem.Prototype).toBe('y = f1(u,v)');
  });
});

describe('a FunctionElement that is not renamed saves its Prototype as it was read', () => {
  it('in a binary dictionary', () => {
    const { s, src } = openBinary();
    expect(savedChunk(s, src)).toContain('<P Name="Prototype" Class="char">y = f(u)</P>');
    expect(savedChunk(s, src)).toContain('<P Name="Prototype" Class="char">[a,b] = g(g)</P>');
  });

  it('and one read without a Prototype does not gain one', () => {
    const bus = ServiceBusNode.createDefault('Svc', null);
    const elem: any = bus.addChildNode();
    delete (elem.serial._properties as Record<string, unknown>).Prototype;
    elem.Prototype = '';
    expect('Prototype' in (elem.serializeValue() as any)._properties).toBe(false);
  });
});

describe('the Prototype forms MATLAB writes', () => {
  const cases: Array<[string, string]> = [
    ['y = f0(u,v)', 'y = g(u,v)'],
    ['[y1,y2] = f0(u)', '[y1,y2] = g(u)'],
    ['[y1, y2] = f0( u , v )', '[y1, y2] = g( u , v )'],
    ['f0(u)', 'g(u)'],
    ['f0()', 'g()'],
    ['y = f0()', 'y = g()'],
    ['f0 = f0(f0)', 'f0 = g(f0)'],
  ];
  for (const [before, after] of cases) {
    it(`'${before}' becomes '${after}'`, () => {
      const bus = ServiceBusNode.createDefault('Svc', null);
      const elem: any = bus.addChildNode();
      elem.Prototype = before;
      expect(elem.setProperty('Name', 'g')).toBe(true);
      expect(elem.Prototype).toBe(after);
      expect((elem.serializeValue() as any)._properties.Prototype).toBe(after);
    });
  }
});
