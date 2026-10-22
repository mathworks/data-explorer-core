// Copyright 2026 The MathWorks, Inc.
//
// McosTemplateMerge: a new MCOS object merged into a subsystem from MATLAB R2023b's own records
// of a default one (mcosTemplates.ts), in the order MATLAB's save -append writes them.
//
//   - Into an empty subsystem in a template's shape, a merge writes that template's subsystem
//     byte for byte: MATLAB's own save of the object.
//   - Class rows are per save session; a class's defaults objects come along and are renamed;
//     what a merge cannot do it refuses, changing nothing.
//   - A Bus gains new BusElements, as a new Bus or as one the file holds, and loses them.
//
// test/mcosTemplateGoldens.test.ts holds the merges MATLAB itself judged.
import { describe, it, expect } from 'vitest';
import { unzlibSync } from 'fflate';
import { MCOS_TEMPLATES } from '../src/datamodel/parser/mcosTemplates.js';
import {
  addBusElements,
  busElementsOf,
  CREATABLE_MCOS_CLASSES,
  createAppendSession,
  createTemplateSubsystem,
  mergeTemplateObject,
  newObjectVariable,
  removeBusElement,
} from '../src/datamodel/parser/McosTemplateMerge.js';
import {
  classNameOf,
  classSystemsOf,
  cloneSubsystem,
  createSubsystem,
  descriptorCell,
  mapObjectReferences,
  objectReferenceElement,
  propertiesOf,
  readDescriptor,
  readSubsystem,
  structFields,
  verifySubsystem,
  writeSubsystem,
  type McosSubsystemRecords,
} from '../src/datamodel/parser/McosSubsystemCodec.js';
import { MatWriteError } from '../src/datamodel/parser/MatWriter.js';
import { parseMatrix } from '../src/datamodel/parser/MatParser.js';

const templateBytes = (name: string): Uint8Array => unzlibSync(new Uint8Array(Buffer.from(MCOS_TEMPLATES[name].subsystem, 'base64')));

function read(bytes: Uint8Array): McosSubsystemRecords {
  const r = readSubsystem(bytes);
  if (!r.ok) throw new Error(`${r.reason}: ${r.message}`);
  return r.subsystem;
}

// Each subsystem a test edits, as it was before its first edit: what verifySubsystem holds every
// edit to (append only, nothing moved).
const originals = new WeakMap<McosSubsystemRecords, McosSubsystemRecords>();

function editing(sub: McosSubsystemRecords): McosSubsystemRecords {
  originals.set(sub, cloneSubsystem(sub));
  return sub;
}

function writesAndVerifies(sub: McosSubsystemRecords): Uint8Array {
  const original = originals.get(sub);
  if (!original) throw new Error('a subsystem edited without its original kept');
  const bytes = writeSubsystem(sub);
  expect(verifySubsystem(bytes, sub, original)).toEqual({ ok: true });
  return bytes;
}

const same = (a: Uint8Array, b: Uint8Array): boolean => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

describe('the classes a .mat variable can be created as', () => {
  it('are the v1 classes, each with a template, and not the BusElement, which only a Bus holds', () => {
    expect([...CREATABLE_MCOS_CLASSES].sort()).toEqual([
      'Simulink.AliasType', 'Simulink.Breakpoint', 'Simulink.Bus', 'Simulink.LookupTable', 'Simulink.NumericType',
      'Simulink.Parameter', 'Simulink.Signal', 'Simulink.ValueType', 'string',
    ]);
    expect(Object.isFrozen(CREATABLE_MCOS_CLASSES)).toBe(true);
    for (const c of CREATABLE_MCOS_CLASSES) expect(MCOS_TEMPLATES[c]).toBeDefined();
  });
});

describe('mergeTemplateObject', () => {
  for (const name of CREATABLE_MCOS_CLASSES) {
    it(`into an empty subsystem in its template's shape writes the ${name} template, MATLAB's own save, byte for byte`, () => {
      const sub = editing(createTemplateSubsystem(name));
      const obj = mergeTemplateObject(sub, name);
      expect(same(writesAndVerifies(sub), templateBytes(name))).toBe(true);
      const t = MCOS_TEMPLATES[name];
      expect(obj).toEqual({ objectId: t.ids[0], classIndex: t.classIndex, className: name, descriptor: { dims: [1, 1], ids: [t.ids[0]], classIndex: t.classIndex } });
      const element = newObjectVariable('x', obj);
      expect(same(element, objectReferenceElement('x', name, obj.descriptor))).toBe(true);
      expect(readDescriptor(element)).toEqual(obj.descriptor);
    });
  }

  it('appends to a subsystem that holds objects, renumbering nothing it held', () => {
    const sub = editing(read(templateBytes('Simulink.LookupTable')));
    const before = cloneSubsystem(sub);
    const obj = mergeTemplateObject(sub, 'Simulink.Parameter');
    const b = sub.blob;
    expect(b.strings.slice(0, before.blob.strings.length)).toEqual(before.blob.strings);
    expect(b.classes.slice(0, before.blob.classes.length)).toEqual(before.blob.classes);
    expect(b.objects.slice(0, before.blob.objects.length)).toEqual(before.blob.objects);
    expect(b.pvLists.slice(0, before.blob.pvLists.length)).toEqual(before.blob.pvLists);
    expect(sub.values.slice(0, before.values.length).every((v, i) => same(v, before.values[i]))).toBe(true);
    expect(obj.objectId).toBe(before.blob.objects.length);
    expect(classNameOf(sub, obj.classIndex)).toBe('Simulink.Parameter');
    expect(propertiesOf(sub, obj.objectId).map((p) => p.savedName)).toEqual(['Value', 'CoderInfo', 'Description', 'DataType', 'Min', 'Max', 'DocUnits', 'Complexity', 'Dimensions']);
    writesAndVerifies(sub);
  });

  it('gives each class a new row per save session, even where the file holds the class, and shares it within one', () => {
    const sub = editing(read(templateBytes('Simulink.Parameter')));
    const session = createAppendSession();
    const a = mergeTemplateObject(sub, 'Simulink.Parameter', { session });
    const b = mergeTemplateObject(sub, 'Simulink.Parameter', { session });
    expect(a.classIndex).toBe(2);
    expect(b.classIndex).toBe(a.classIndex);
    expect(b.objectId).toBe(a.objectId + 1);
    const c = mergeTemplateObject(sub, 'Simulink.Parameter');
    expect(c.classIndex).toBe(3);
    writesAndVerifies(sub);
  });

  it("copies the objects a class's defaults struct holds, and the struct names their new rows", () => {
    const sub = editing(read(templateBytes('Simulink.Parameter')));
    const obj = mergeTemplateObject(sub, 'Simulink.ValueType');
    const fields = structFields(sub.defaults!.entries[obj.classIndex])!;
    const be = readDescriptor(fields.find((f) => f.name === 'be')!.value)!;
    expect(classNameOf(sub, be.classIndex!)).toBe('Simulink.BusElement');
    expect(classNameOf(sub, sub.blob.objects[be.ids[0]].classIndex)).toBe('Simulink.BusElement');
    expect(be.ids[0]).toBeGreaterThan(obj.objectId);
    writesAndVerifies(sub);
  });

  it("says the stream holds 'handle' objects once a 'handle' CoderInfo is merged in", () => {
    const sub = editing(createSubsystem());
    expect(classSystemsOf(sub)).toEqual(['MCOS']);
    mergeTemplateObject(sub, 'Simulink.NumericType');
    expect(classSystemsOf(sub)).toEqual(['MCOS']);
    mergeTemplateObject(sub, 'Simulink.Signal');
    expect(classSystemsOf(sub)).toEqual(['MCOS', 'handle']);
    writesAndVerifies(sub);
  });

  it('refuses, changing nothing, a class with no template, a BusElement on its own, and a blob of another version', () => {
    const sub = read(templateBytes('string'));
    const before = writeSubsystem(sub);
    expect(() => mergeTemplateObject(sub, 'Simulink.ConfigSet')).toThrow(MatWriteError);
    expect(() => mergeTemplateObject(sub, 'Simulink.BusElement')).toThrow(MatWriteError);
    const v5 = cloneSubsystem(sub);
    v5.blob.major = 5;
    expect(() => mergeTemplateObject(v5, 'Simulink.Parameter')).toThrow(/blob version 5.0/);
    expect(same(writeSubsystem(sub), before)).toBe(true);
  });
});

describe('the codec edits a merge is made of', () => {
  it('renames the object references inside an element in place, and refuses a rename that changes their size', () => {
    const inner = descriptorCell({ dims: [1, 2], ids: [3, 4], classIndex: 2 });
    const renamed = mapObjectReferences(inner, (d) => ({ ...d, ids: d.ids.map((i) => i + 10), classIndex: 7 }));
    expect(readDescriptor(renamed)).toEqual({ dims: [1, 2], ids: [13, 14], classIndex: 7 });
    expect(readDescriptor(inner)).toEqual({ dims: [1, 2], ids: [3, 4], classIndex: 2 });
    expect(() => mapObjectReferences(inner, (d) => ({ dims: [1, 1], ids: [1], classIndex: d.classIndex }))).toThrow(MatWriteError);
    expect(() => mapObjectReferences(inner, (d) => ({ ...d, classIndex: null }))).toThrow(MatWriteError);
    const opaque = objectReferenceElement('', 'Simulink.Parameter', { dims: [1, 1], ids: [1], classIndex: 1 });
    expect(() => mapObjectReferences(opaque, (d) => d)).toThrow(MatWriteError);
  });

  it("reads a defaults struct's fields, and none of a fieldless one", () => {
    const vt = read(templateBytes('Simulink.ValueType'));
    const fields = structFields(vt.defaults!.entries[MCOS_TEMPLATES['Simulink.ValueType'].classIndex]);
    expect(fields?.map((f) => f.name)).toContain('be');
    expect(structFields(vt.defaults!.entries[0])).toEqual([]);
    expect(structFields(descriptorCell({ dims: [1, 1], ids: [1], classIndex: 1 }))).toBeNull();
  });
});

describe('Bus elements', () => {
  const nameOf = (sub: McosSubsystemRecords, id: number): string => {
    const p = propertiesOf(sub, id).find((x) => x.savedName === 'Name');
    const cell = sub.values[p!.value];
    const v = parseMatrix(new DataView(cell.buffer, cell.byteOffset, cell.byteLength), 8, cell.length - 8);
    return v.value as string;
  };
  const elementsOf = (sub: McosSubsystemRecords, busId: number) => {
    const p = propertiesOf(sub, busId).find((x) => x.savedName === 'Elements_internal')!;
    return readDescriptor(sub.values[p.value])!;
  };

  it('a new Bus holds new BusElements, a column of them in one class row, named as asked', () => {
    const sub = editing(createTemplateSubsystem('Simulink.Bus'));
    const bus = mergeTemplateObject(sub, 'Simulink.Bus', { elements: ['a', 'a1', 'speed'] });
    const d = elementsOf(sub, bus.objectId);
    expect(d.dims).toEqual([3, 1]);
    expect(busElementsOf(sub, bus.objectId)).toEqual(d.ids);
    expect(d.ids.map((id) => nameOf(sub, id))).toEqual(['a', 'a1', 'speed']);
    expect(classNameOf(sub, d.classIndex!)).toBe('Simulink.BusElement');
    expect(d.ids.every((id) => sub.blob.objects[id].classIndex === d.classIndex)).toBe(true);
    // The elements are numbered after the Bus and before its reference cell, as MATLAB writes them.
    expect(Math.min(...d.ids)).toBeGreaterThan(bus.objectId);
    writesAndVerifies(sub);
    const plain = createTemplateSubsystem('Simulink.Bus');
    mergeTemplateObject(plain, 'Simulink.Bus', { elements: [] });
    expect(same(writeSubsystem(plain), templateBytes('Simulink.Bus'))).toBe(true);
  });

  it('an existing Bus gains elements in its own BusElement row, and loses one by its reference alone', () => {
    const sub = editing(createTemplateSubsystem('Simulink.Bus'));
    const bus = mergeTemplateObject(sub, 'Simulink.Bus', { elements: ['a'] });
    const row = elementsOf(sub, bus.objectId).classIndex!;
    const classes = sub.blob.classes.length;
    const added = addBusElements(sub, bus.objectId, ['a1', 'b']);
    expect(sub.blob.classes.length).toBe(classes);
    expect(added.every((id) => sub.blob.objects[id].classIndex === row)).toBe(true);
    expect(busElementsOf(sub, bus.objectId).map((id) => nameOf(sub, id))).toEqual(['a', 'a1', 'b']);
    expect(elementsOf(sub, bus.objectId).dims).toEqual([3, 1]);
    writesAndVerifies(sub);

    const objects = sub.blob.objects.length;
    expect(removeBusElement(sub, bus.objectId, 1)).toBe(added[0]);
    expect(busElementsOf(sub, bus.objectId).map((id) => nameOf(sub, id))).toEqual(['a', 'b']);
    expect(sub.blob.objects.length).toBe(objects);
    removeBusElement(sub, bus.objectId, 0);
    removeBusElement(sub, bus.objectId, 0);
    expect(elementsOf(sub, bus.objectId)).toEqual({ dims: [0, 0], ids: [], classIndex: row });
    writesAndVerifies(sub);
    addBusElements(sub, bus.objectId, ['c']);
    expect(busElementsOf(sub, bus.objectId).map((id) => nameOf(sub, id))).toEqual(['c']);
    writesAndVerifies(sub);
  });

  it('refuses, changing nothing, a name twice, an element that is not there, and an object that is no Bus', () => {
    const sub = editing(createTemplateSubsystem('Simulink.Bus'));
    const bus = mergeTemplateObject(sub, 'Simulink.Bus', { elements: ['a'] });
    const before = writeSubsystem(sub);
    expect(() => addBusElements(sub, bus.objectId, ['a'])).toThrow(MatWriteError);
    expect(() => addBusElements(sub, bus.objectId, ['b', 'b'])).toThrow(MatWriteError);
    expect(() => addBusElements(sub, bus.objectId, [''])).toThrow(MatWriteError);
    expect(() => removeBusElement(sub, bus.objectId, 1)).toThrow(MatWriteError);
    const element = busElementsOf(sub, bus.objectId)[0];
    expect(() => addBusElements(sub, element, ['b'])).toThrow(MatWriteError);
    expect(() => mergeTemplateObject(sub, 'Simulink.Bus', { elements: ['x', 'x'] })).toThrow(MatWriteError);
    expect(() => mergeTemplateObject(sub, 'Simulink.Parameter', { elements: ['x'] })).toThrow(MatWriteError);
    expect(same(writeSubsystem(sub), before)).toBe(true);
  });
});
