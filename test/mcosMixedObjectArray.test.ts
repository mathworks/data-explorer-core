// Copyright 2026 The MathWorks, Inc.
//
// F1-47: an object array held by an MCOS object's property (a .mat, a model workspace), whose
// elements are of more than one class. The MCOS reader named the array after its first element
// and gave no element a class of its own, so each element read, showed and copied as one of the
// first element's class:
//   - a config set's Components read as a Simulink.SolverCC array, and a copy of the config set
//     pasted into a dictionary wrote all nine components as Simulink.SolverCC;
//   - a dexdata.DerivedSignal beside a Simulink.Signal read as a dexdata.DerivedSignal array of
//     two dexdata.DerivedSignals.
// It now reads as the binary dictionary reader does (D6/D15; the rule is objectArrayClass.ts,
// shared by both): the array under the class MATLAB's text format names, and each element of
// another class under its own `_object_class`.
//
// configset.mat is MATLAB's (R2027a, test/fixtures/mcos/make_configset_fixture.m), and
// configset.truth.json is what MATLAB says each array and each element is, read back out of
// it: class() of the array, which is the class this reader names, and class() of each element.
// busArray.mat is re-pointed byte by byte where no MATLAB file holds the case.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { decodeMcosBlob, type OpaqueVarRef } from '../src/datamodel/parser/McosParser.js';
import { arrayClassOf } from '../src/datamodel/parser/objectArrayClass.js';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import { SECTION_NAMESPACE } from '../src/datamodel/SectionConstants.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const fixturePath = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const bytes = (name: string): Uint8Array => new Uint8Array(readFileSync(fixturePath(name)));
const buffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

/** The two inputs decodeMcosBlob takes, out of a .mat, as MatNode.fromParsed builds them. */
function blobParts(name: string): { raw: Uint8Array; vars: OpaqueVarRef[] } {
  const { variables } = parseMat(buffer(bytes(name)));
  const anon = variables.find((v) => (v as unknown as { _anonymous?: boolean })._anonymous)!;
  const opaque = variables.filter((v) => v.isOpaque && v.name);
  return { raw: anon._rawBytes!, vars: opaque.map((v) => ({ name: v.name, className: v.className, rawBytes: v._rawBytes })) };
}

interface ArrayTruth {
  class: string;
  size: number[];
  elements: string[];
  names?: string[];
}
interface ConfigSetTruth {
  class: string;
  Components: ArrayTruth;
  rtwIndex: number;
  RTWComponents: ArrayTruth;
}
const truth: { release: string; paths: { cs: ConfigSetTruth; csErt: ConfigSetTruth; mixed: { class: string; Kids: ArrayTruth } } } = JSON.parse(
  readFileSync(fixturePath('mcos/configset.truth.json'), 'utf8'),
);

/** An array's class and each element's, as a reader that holds no element class would name it. */
function classesOf(array: any): { arrayClass: string; elements: string[] } {
  return { arrayClass: array._array_class, elements: array._elements.map((e: any) => e._object_class ?? array._array_class) };
}

describe('configset.mat, as MATLAB wrote it: each mixed array under MATLAB\'s class, each element under its own', () => {
  const decoded = (() => {
    const { raw, vars } = blobParts('mcos/configset.mat');
    return decodeMcosBlob(raw, vars);
  })();

  it('the truth is MATLAB\'s, and says what this file is for', () => {
    expect(truth.release).toBe('2027a');
    // Two arrays of each config set mix classes, and the holder's does, with the subclass first.
    expect(new Set(truth.paths.cs.Components.elements).size).toBeGreaterThan(5);
    expect(truth.paths.cs.RTWComponents.elements).toEqual(['Simulink.CodeAppCC', 'Simulink.GRTTargetCC']);
    expect(truth.paths.csErt.RTWComponents.elements).toEqual(['Simulink.CodeAppCC', 'Simulink.ERTTargetCC']);
    expect(truth.paths.mixed.Kids.elements).toEqual(['dexdata.DerivedSignal', 'Simulink.Signal']);
  });

  for (const name of ['cs', 'csErt'] as const) {
    it(`${name}: Components, and its RTWCC's Components, are Simulink.ConfigComponent arrays of MATLAB's components in order`, () => {
      const t = truth.paths[name];
      const components: any = decoded.get(name)!.properties.Components;
      expect(t.Components.class).toBe('Simulink.ConfigComponent');
      expect(components._array_class).toBe(t.Components.class);
      expect(components._dimensions).toEqual(t.Components.size);
      // Each element's own class, on every element, since none is the array's class.
      expect(components._elements.map((e: any) => e._object_class)).toEqual(t.Components.elements);

      const rtw = components._elements[t.rtwIndex - 1];
      expect(rtw._object_class).toBe('Simulink.RTWCC');
      const inner = rtw._properties.Components;
      expect(t.RTWComponents.class).toBe('Simulink.ConfigComponent');
      expect(inner._array_class).toBe(t.RTWComponents.class);
      expect(inner._elements.map((e: any) => e._object_class)).toEqual(t.RTWComponents.elements);
    });
  }

  it('mixed: a dexdata.DerivedSignal beside a Simulink.Signal is a Simulink.Signal array, the subclass marked', () => {
    const kids: any = decoded.get('mixed')!.properties.Kids;
    expect(truth.paths.mixed.Kids.class).toBe('Simulink.Signal');
    expect(classesOf(kids)).toEqual({ arrayClass: truth.paths.mixed.Kids.class, elements: truth.paths.mixed.Kids.elements });
    // Only the element of another class than the array's says so, as the binary reader writes it.
    expect(kids._elements.map((e: any) => e._object_class)).toEqual(['dexdata.DerivedSignal', undefined]);
    // The subclass's own properties are its own.
    expect(kids._elements[0]._properties.Routing).toBe('bus');
    expect('Routing' in kids._elements[1]._properties).toBe(false);
  });

  it('mixed shows a <1x2 Simulink.Signal> whose elements are a dexdata.DerivedSignal and a Simulink.Signal', () => {
    const root: any = ingest(createSession(), buffer(bytes('mcos/configset.mat')), { filename: 'configset.mat' });
    const kids = root.children.find((c: any) => c.name === 'mixed').children.find((c: any) => c.name === 'Kids');
    expect([kids.className, kids.displayValue]).toEqual(['Simulink.Signal', '<1x2 Simulink.Signal>']);
    expect(kids.children.map((c: any) => [c.constructor.name, c.className])).toEqual([
      ['ObjectNode', 'dexdata.DerivedSignal'],
      ['SignalNode', 'Simulink.Signal'],
    ]);
  });
});

// What a host copies out of the .mat goes into a dictionary under each element's own class: a
// copy used to write every component of a config set as a Simulink.SolverCC.
describe('configset.mat, copied into a binary dictionary and saved', () => {
  const session = createSession();
  const mat: any = ingest(session, buffer(bytes('mcos/configset.mat')), { filename: 'configset.mat' });
  const root: any = ingest(session, buffer(bytes('sparse/sparse_binary.sldd')), { filename: 'sparse_binary.sldd' });
  const meta = root.getSection('design').children[0].metadata;
  let seq = 0;
  const paste = (name: string, section: string): void => {
    const payload: any = JSON.parse(JSON.stringify(mat.children.find((c: any) => c.name === name).serialize()));
    payload.name = name + '_fromMat';
    payload.metadata = { ...meta, namespace: SECTION_NAMESPACE[section], uuid: `00000000-0000-4000-8000-f147000000${String(++seq).padStart(2, '0')}` };
    root.getSection(section).parseEntry(payload);
  };
  paste('cs', 'config');
  paste('csErt', 'config');
  paste('mixed', 'design');
  const saved: any = session.serializeSource(root.name);
  const xml = strFromU8(unzipSync(saved.bytes)['data/chunk0.xml']);
  const reopened: any = ingest(createSession(), buffer(saved.bytes), { filename: 'sparse_binary.sldd' });

  /** The `<Object>` of the entry `name` in the saved chunk. */
  const entryBlock = (name: string): string => {
    const at = xml.indexOf('<P Name="Name" Class="char">' + name + '</P>');
    expect(at, name).toBeGreaterThan(0);
    return xml.slice(xml.lastIndexOf('<Object', at), xml.indexOf('\n    </Object>', at));
  };
  /** The Class of each `<Element>` directly under the first `<P Name="prop" ...>` at `indent` in `block`. */
  const elementClasses = (block: string, prop: string, indent: number): string[] => {
    const open = new RegExp(`^ {${indent}}<P Name="${prop}" Dimension="[^"]*">$`, 'm').exec(block);
    expect(open, prop).not.toBeNull();
    const from = open!.index;
    const to = block.indexOf('\n' + ' '.repeat(indent) + '</P>', from);
    const span = block.slice(from, to);
    return [...span.matchAll(new RegExp(`^ {${indent + 4}}<Element Class="([^"]+)">$`, 'gm'))].map((m) => m[1]);
  };
  const entry = (section: string, name: string): any => reopened.getSection(section).children.find((e: any) => e.name === name);

  for (const name of ['cs', 'csErt'] as const) {
    it(`${name}: each component is written as MATLAB's class, and reads back so`, () => {
      const t = truth.paths[name];
      const block = entryBlock(name + '_fromMat');
      expect(elementClasses(block, 'Components', 16)).toEqual(t.Components.elements);
      expect(elementClasses(block, 'Components', 24)).toEqual(t.RTWComponents.elements);
      const components = entry('config', name + '_fromMat').serial._rawVal._elements[0]._properties.Components;
      expect(classesOf(components)).toEqual({ arrayClass: 'Simulink.ConfigComponent', elements: t.Components.elements });
      expect(classesOf(components._elements[t.rtwIndex - 1]._properties.Components)).toEqual({
        arrayClass: 'Simulink.ConfigComponent',
        elements: t.RTWComponents.elements,
      });
    });
  }

  it('mixed: Kids is written as a dexdata.DerivedSignal and a Simulink.Signal, and reads back as a Simulink.Signal array', () => {
    expect(elementClasses(entryBlock('mixed_fromMat'), 'Kids', 16)).toEqual(truth.paths.mixed.Kids.elements);
    const kids = entry('design', 'mixed_fromMat').children.find((c: any) => c.name === 'Kids');
    expect([kids.className, kids.displayValue]).toEqual(['Simulink.Signal', '<1x2 Simulink.Signal>']);
    expect(kids.children.map((c: any) => c.className)).toEqual(truth.paths.mixed.Kids.elements);
  });
});

// Where no MATLAB file holds the case: busArray.mat's object table re-pointed, one word at a time.
// Its bus(2).Elements_internal is two Simulink.BusElements, objects 4 and 5; bus(3)'s is three,
// objects 7 to 9.
describe('busArray.mat re-pointed: an object array property of two classes', () => {
  // The blob offset of busArray.mat's metadata table (mcosParser.test.ts asserts it there too).
  const META = 304;
  const { raw, vars } = blobParts('mcos/busArray.mat');
  const u32 = (b: Uint8Array, at: number): number => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(at, true);
  const header = Array.from({ length: 10 }, (_, i) => u32(raw, META + i * 4));
  const classRow = (k: number): number => META + header[2] + k * 16;
  const objectRow = (k: number): number => META + header[4] + k * 24;
  const patched = (words: [number, number][]): Uint8Array => {
    const copy = raw.slice();
    const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
    for (const [at, value] of words) view.setUint32(at, value, true);
    return copy;
  };
  const elementsOf = (blob: Uint8Array, bus: number): any => (decodeMcosBlob(blob, vars).get('buses')!.elements[bus] as any).Elements_internal;

  it('the tables are where, and what, these cases assume', () => {
    // Class rows 1 and 2 are Simulink.BusElement and Simulink.Bus, and objects 4 and 5 are
    // bus(2)'s elements, of class row 1.
    const { raw: r } = blobParts('mcos/busArray.mat');
    expect(Array.from({ length: 9 }, (_, k) => u32(r, objectRow(k + 1)))).toEqual([2, 1, 2, 1, 1, 2, 1, 1, 1]);
    const plain = elementsOf(raw, 1);
    expect(classesOf(plain)).toEqual({ arrayClass: 'Simulink.BusElement', elements: ['Simulink.BusElement', 'Simulink.BusElement'] });
    expect(plain._elements.map((e: any) => '_object_class' in e)).toEqual([false, false]);
    expect(classesOf(elementsOf(patched([[objectRow(5), 2]]), 2))).toEqual(classesOf(elementsOf(raw, 2)));
  });

  it('a Simulink.BusElement beside a Simulink.Bus keeps the first\'s class for the array, and the second its own', () => {
    // Two MathWorks classes: no base can be derived, so the array is the first element's class.
    const ei = elementsOf(patched([[objectRow(5), 2]]), 1);
    expect(ei._array_class).toBe('Simulink.BusElement');
    expect(ei._elements.map((e: any) => e._object_class)).toEqual([undefined, 'Simulink.Bus']);
    // Each is still its own object.
    expect(ei._elements.map((e: any) => e._properties.Name)).toEqual(elementsOf(raw, 1)._elements.map((e: any) => e._properties.Name));
  });

  it('a user\'s class beside the one MathWorks class is an array of the MathWorks class', () => {
    // Class row 1's package word set to the empty string: its objects are of a class `BusElement`
    // of no package, a user's. Object 5 is re-pointed at Simulink.Bus.
    const blob = patched([[classRow(1), 0], [objectRow(5), 2]]);
    const ei = elementsOf(blob, 1);
    expect(ei._array_class).toBe('Simulink.Bus');
    expect(ei._elements.map((e: any) => e._object_class)).toEqual(['BusElement', undefined]);
    // bus(3)'s three, all of the user's class, are an array of it, with no element marked.
    const three = elementsOf(blob, 2);
    expect(three._array_class).toBe('BusElement');
    expect(three._elements.map((e: any) => '_object_class' in e)).toEqual([false, false, false]);
  });

  it('a later element whose object names no class is one of the first element\'s class, as in a binary dictionary', () => {
    // bus(3): object 7 of the user's class, object 8 re-pointed at Simulink.Bus, and object 9
    // at a class row past the table. The binary reader reads a classless later <Element> as one
    // of the first element's class (objectArrayElementClass.test.ts), which names the array
    // here as it does there: the user's class twice beside the one MathWorks class.
    const blob = patched([[classRow(1), 0], [objectRow(8), 2], [objectRow(9), 99]]);
    const ei = elementsOf(blob, 2);
    expect(ei._array_class).toBe('Simulink.Bus');
    expect(ei._elements.map((e: any) => e._object_class)).toEqual(['BusElement', undefined, 'BusElement']);
    // Its own properties are still read.
    expect(ei._elements[2]._properties.Name).toBe(elementsOf(raw, 2)._elements[2]._properties.Name);
  });
});

// A config set's Components is a Simulink.ConfigComponent array whatever components it holds:
// its place names its class (componentsBaseOf), and the shared element rule (arrayClassOf) is
// not asked. On configset.mat as MATLAB wrote it the two agree, because every component there
// is one CONFIG_COMPONENTS lists; a binary dictionary of the corpus holds components it does
// not list (a CoderTarget.SettingsController, an SSC.SimscapeCC), whose array the shared rule
// names after its first element. configset.mat's class table re-pointed, one word at a time,
// to hold such a component, in a config set's Components and in its RTWCC's.
describe('configset.mat re-pointed: a Components array the shared element rule would name otherwise', () => {
  // The blob offset of configset.mat's metadata table, which is busArray.mat's too.
  const META = 304;
  const { raw, vars } = blobParts('mcos/configset.mat');
  const u32 = (b: Uint8Array, at: number): number => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(at, true);
  const header = Array.from({ length: 10 }, (_, i) => u32(raw, META + i * 4));
  const classRow = (k: number): number => META + header[2] + k * 16;
  const objectRow = (k: number): number => META + header[4] + k * 24;
  const patched = (words: [number, number][]): Uint8Array => {
    const copy = raw.slice();
    const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
    for (const [at, value] of words) view.setUint32(at, value, true);
    return copy;
  };
  // Class row 12 is SlCovCC.ConfigComp, the last component of both config sets (objects 12 and
  // 24). Its package word set to the empty string makes it `ConfigComp`, a class of no package:
  // one CONFIG_COMPONENTS does not list, and one the shared rule counts as not MathWorks', as it
  // counts a CoderTarget or an SSC class (objectArrayClass.ts isMathWorksClass).
  const UNLISTED = [classRow(12), 0] as [number, number];
  // Object 11 is cs's Simulink.GRTTargetCC, the second of its RTWCC's two components.
  const RTW_TARGET_UNLISTED = [objectRow(11), 12] as [number, number];
  const decoded = decodeMcosBlob(patched([UNLISTED, RTW_TARGET_UNLISTED]), vars);
  // Each config set's components, as MATLAB wrote them but the last, now `ConfigComp`.
  const repointed = [...truth.paths.cs.Components.elements.slice(0, -1), 'ConfigComp'];

  it('the tables are where, and what, these cases assume, and the shared rule names these arrays otherwise', () => {
    const strings = new TextDecoder().decode(raw.slice(META + 40, META + header[2])).split('\0');
    const nameOf = (row: number): string => [strings[u32(raw, row) - 1], strings[u32(raw, row + 4) - 1]].join('.');
    expect([nameOf(classRow(12)), nameOf(classRow(9))]).toEqual(['SlCovCC.ConfigComp', 'Simulink.GRTTargetCC']);
    expect([12, 24, 11].map((k) => u32(raw, objectRow(k)))).toEqual([12, 12, 9]);
    // Unpatched, both readings agree: MATLAB's components, each listed.
    expect(decodeMcosBlob(raw, vars).get('cs')!.properties.Components).toMatchObject({ _array_class: 'Simulink.ConfigComponent' });
    // Patched, the shared rule alone would name the config set's Components after its first
    // component (no derivable base among eight MathWorks classes and one other), and the
    // RTWCC's after its one MathWorks class beside one that is not.
    expect(truth.paths.csErt.Components.elements).toEqual(truth.paths.cs.Components.elements);
    expect(arrayClassOf(repointed)).toBe('Simulink.SolverCC');
    expect(arrayClassOf(['Simulink.CodeAppCC', 'ConfigComp'])).toBe('Simulink.CodeAppCC');
  });

  it('a config set\'s Components holding an unlisted component is still a Simulink.ConfigComponent array, each element its own class', () => {
    for (const name of ['cs', 'csErt'] as const) {
      const components: any = decoded.get(name)!.properties.Components;
      expect(components._array_class, name).toBe('Simulink.ConfigComponent');
      expect(components._elements.map((e: any) => e._object_class), name).toEqual(repointed);
    }
  });

  it('an RTWCC\'s Components holding an unlisted component is still a Simulink.ConfigComponent array', () => {
    const rtw = (decoded.get('cs')!.properties.Components as any)._elements[truth.paths.cs.rtwIndex - 1];
    expect(rtw._object_class).toBe('Simulink.RTWCC');
    const inner = rtw._properties.Components;
    expect(inner._array_class).toBe('Simulink.ConfigComponent');
    expect(inner._elements.map((e: any) => e._object_class)).toEqual(['Simulink.CodeAppCC', 'ConfigComp']);
    // csErt's RTWCC was not re-pointed, and reads as MATLAB wrote it.
    const ert = (decoded.get('csErt')!.properties.Components as any)._elements[truth.paths.csErt.rtwIndex - 1];
    expect(ert._properties.Components._elements.map((e: any) => e._object_class)).toEqual(truth.paths.csErt.RTWComponents.elements);
  });

  it('control: the same classes in a place that names none are read by the shared rule', () => {
    // mixed's Kids, a property of an NdHolder, re-pointed at the two classes the RTWCC's
    // Components holds above: the shared rule, so the one MathWorks class.
    const kidsIds = [26, 30];
    expect(kidsIds.map((k) => u32(raw, objectRow(k)))).toEqual([18, 19]);
    const blob = patched([UNLISTED, [objectRow(26), 8], [objectRow(30), 12]]);
    const kids: any = decodeMcosBlob(blob, vars).get('mixed')!.properties.Kids;
    expect(kids._array_class).toBe('Simulink.CodeAppCC');
    expect(kids._elements.map((e: any) => e._object_class)).toEqual([undefined, 'ConfigComp']);
  });
});

// Controls: what shares one class reads as it did.
describe('an object array property of one class, and an enumeration value, read as they did', () => {
  it('busArray.mat\'s Elements_internal and ndNested.mat\'s Kids carry no element class', () => {
    const { raw, vars } = blobParts('mcos/busArray.mat');
    for (const bus of decodeMcosBlob(raw, vars).get('buses')!.elements.slice(1) as any[]) {
      expect(bus.Elements_internal._array_class).toBe('Simulink.BusElement');
      expect(bus.Elements_internal._elements.every((e: any) => Object.keys(e).join() === '_properties')).toBe(true);
    }
    const nd = blobParts('mcos/ndNested.mat');
    const kids: any = decodeMcosBlob(nd.raw, nd.vars).get('h')!.properties.Kids;
    expect(kids._array_class).toBe('Simulink.Parameter');
    expect(kids._elements).toHaveLength(12);
    expect(kids._elements.every((e: any) => Object.keys(e).join() === '_properties')).toBe(true);
  });

  it('display/dispcat_opaque.mat\'s enumeration Value is its class, with no element class', () => {
    const { raw, vars } = blobParts('display/dispcat_opaque.mat');
    const values = [...decodeMcosBlob(raw, vars).values()]
      .map((d) => d.properties.Value as any)
      .filter((v) => v && Array.isArray(v._elements) && v._elements.some((e: any) => e._enumeration));
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) {
      expect(v._array_class).toBe('DispColor');
      expect(v._elements.every((e: any) => !('_object_class' in e))).toBe(true);
    }
  });
});
