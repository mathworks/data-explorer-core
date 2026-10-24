// Copyright 2026 The MathWorks, Inc.
//
// What McosObjectWrite reads of a MAT-file's objects for the property rules, and every edit its
// write refuses rather than writes: the save of an object edit hands back a refusal naming the
// property, never a subsystem written past what was asked.
//
//   - Read: an object the subsystem does not hold is refused, naming how many it does; each
//     triple is read by its kind (a text, an integer, a value cell, and an object held directly,
//     which no edit replaces); the class's defaults struct is what an omitted property loads as;
//     the objects a property holds are those its triple or its reference cell names, and none for
//     a plain value.
//   - A 'handle' CoderInfo (MATLAB R2024b and earlier, and the R2023b templates): its triples as
//     the rules read them, every property saved and no defaults; a cell that is no such opaque, or
//     one that holds no object, says so.
//   - The edits of one: StorageClass, Identifier (saved as Alias) and Alignment, each in every
//     form the rules hand them over in, written and read back; and refused, naming the property,
//     for a removal, another property, a form that is not the property's, a storage class whose
//     edit was not measured, and an owner that holds no such property.
//   - The edits of an object's own triples refused: a value cell that holds objects (a nested
//     CoderInfo, a Bus's elements), one another property names too, a text or an integer written
//     over a property held as another kind, an integer no triple can hold.
//   - And a programming error inside a write is thrown as one, not handed back as a refusal.
//
// The objects are MATLAB's: test/fixtures/mcos-rules/mix.mat (R2027a, which saves a defaults
// struct and a CoderInfo as a nested object) and the shipped templates (R2023b's own records).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzlibSync } from 'fflate';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import type { MatVariable } from '../src/datamodel/parser/MatParser.js';
import { subsystemElementOf } from '../src/datamodel/parser/MatFileWriter.js';
import { MCOS_TEMPLATES } from '../src/datamodel/parser/mcosTemplates.js';
import {
  McosValueKind,
  classNameOf,
  cloneSubsystem,
  propertiesOf,
  readHandleOpaque,
  readSubsystem,
  writeHandleOpaque,
  writeSubsystem,
  type McosSubsystemRecords,
} from '../src/datamodel/parser/McosSubsystemCodec.js';
import {
  applyHandleOps,
  applyTripleOps,
  defaultsOf,
  editedObjects,
  elementValue,
  handleRuleObjectOf,
  heldObjectIds,
  ruleObjectOf,
  writeObjectEdits,
  type McosObjectOps,
} from '../src/datamodel/parser/McosObjectWrite.js';
import type { McosRuleObject, McosTripleOp } from '../src/datamodel/parser/McosPropertyRules.js';

function readRecords(element: Uint8Array): McosSubsystemRecords {
  const r = readSubsystem(element);
  if (!r.ok) throw new Error(r.message);
  return r.subsystem;
}

function fileRecords(rel: string): McosSubsystemRecords {
  const u8 = new Uint8Array(readFileSync(fileURLToPath(new URL('./fixtures/' + rel, import.meta.url))));
  const parsed = parseMat(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer);
  return readRecords(subsystemElementOf(parsed.records.find((x) => x.offset === parsed.subsystemOffset)!)!);
}

const template = (cls: string) => readRecords(unzlibSync(new Uint8Array(Buffer.from(MCOS_TEMPLATES[cls].subsystem, 'base64'))));

const mix = fileRecords('mcos-rules/mix.mat');
const objectOf = (sub: McosSubsystemRecords, cls: string) => {
  for (let id = 1; id < sub.blob.objects.length; id++) {
    if (classNameOf(sub, sub.blob.objects[id].classIndex) === cls) return id;
  }
  throw new Error('no ' + cls);
};

const value = (v: Partial<MatVariable>): MatVariable =>
  ({ name: '', className: 'double', dimensions: [1, 1], isComplex: false, isLogical: false, value: 0, fields: null, ...v }) as MatVariable;
const chr = (t: string) => value({ className: 'char', dimensions: t ? [1, t.length] : [0, 0], value: t });

/** The written subsystem's bytes, which a refused write must leave as they were. */
const bytesOf = (sub: McosSubsystemRecords) => Buffer.from(writeSubsystem(sub));

describe('what the rules read of an object', () => {
  it('an object the subsystem does not hold is refused, naming how many it does', () => {
    const held = mix.blob.objects.length - 1;
    for (const id of [0, -1, held + 1]) {
      expect(() => ruleObjectOf(mix, id)).toThrow(`object ${id} is not one of the ${held} the subsystem holds`);
    }
  });

  it('each triple by its kind, and the defaults struct of its class, which an omitted property loads as', () => {
    const p = ruleObjectOf(mix, objectOf(mix, 'Simulink.Parameter'));
    expect(p.className).toBe('Simulink.Parameter');
    expect(p.held.get('Complexity')).toEqual({ kind: 'str', text: 'real' });
    expect(p.held.get('Dimensions')).toMatchObject({ kind: 'cell', value: { className: 'double', dimensions: [1, 2] } });
    // A value cell holding objects (its CoderInfo, saved by R2027a as a nested object) is no value
    // an edit replaces.
    expect(p.held.get('CoderInfo')).toEqual({ kind: 'cell', value: null });
    expect([...p.defaults.keys()]).toEqual(['Value', 'Description', 'DataType', 'Min', 'Max', 'DocUnits']);
    const bus = ruleObjectOf(mix, objectOf(mix, 'Simulink.Bus'));
    expect(bus.held.get('PreserveElementDimensions')).toEqual({ kind: 'int', value: expect.any(Number) });
  });

  it('an object held directly by a triple is read as what no edit replaces', () => {
    const sub = cloneSubsystem(mix);
    const id = objectOf(sub, 'Simulink.Parameter');
    const t = sub.blob.pvLists[sub.blob.objects[id].pvList].find((x) => sub.blob.strings[x.name] === 'CoderInfo')!;
    const nested = heldObjectIds(sub, id, 'CoderInfo')!;
    Object.assign(t, { flag: McosValueKind.object, value: nested[0] });
    expect(ruleObjectOf(sub, id).held.get('CoderInfo')).toEqual({ kind: 'other' });
    expect(heldObjectIds(sub, id, 'CoderInfo')).toEqual(nested);
  });

  it('the objects a property holds: those its reference names, and none for a plain value or a property it does not save', () => {
    const id = objectOf(mix, 'Simulink.Parameter');
    const [coderInfo, ...more] = heldObjectIds(mix, id, 'CoderInfo')!;
    expect(more).toEqual([]);
    expect(classNameOf(mix, mix.blob.objects[coderInfo].classIndex)).toBe('Simulink.CoderInfo');
    expect(heldObjectIds(mix, id, 'Dimensions')).toBeNull();
    expect(heldObjectIds(mix, id, 'Value')).toBeNull();
  });

  it('a class row with no defaults struct in the file has none', () => {
    expect(defaultsOf(mix, mix.blob.classes.length + 5).size).toBe(0);
  });

  it('a value cell too short to be an element reads as no value', () => {
    expect(elementValue(new Uint8Array(0))).toBeNull();
    expect(elementValue(new Uint8Array(7))).toBeNull();
  });
});

describe("a 'handle' CoderInfo, as the rules read it", () => {
  const param = template('Simulink.Parameter');
  const cellOf = (sub: McosSubsystemRecords) => sub.values[propertiesOf(sub, 1).find((t) => t.savedName === 'CoderInfo')!.value];

  it('is its own object 1, every property saved, with no defaults', () => {
    const r = handleRuleObjectOf(cellOf(param)) as McosRuleObject;
    expect(r.className).toBe('Simulink.CoderInfo');
    expect(r.handle).toBe(true);
    expect(r.defaults.size).toBe(0);
    expect(r.held.get('StorageClass')).toEqual({ kind: 'str', text: 'Auto' });
    expect(r.held.get('Alias')).toMatchObject({ kind: 'cell', value: { className: 'char', value: '' } });
    expect(r.held.get('Alignment')).toMatchObject({ kind: 'cell', value: { className: 'double', value: -1 } });
    // CustomAttributes is an object of the opaque's own: no value.
    expect(r.held.get('CustomAttributes')).toEqual({ kind: 'cell', value: null });
  });

  it("a cell that is no 'handle' opaque, or one holding no object, says why", () => {
    expect(handleRuleObjectOf(param.values[propertiesOf(param, 1).find((t) => t.savedName === 'Description')!.value])).toBe(
      "its 'handle' opaque does not read as one this editor writes (the cell is not a 'handle' opaque)",
    );
    const read = readHandleOpaque(cellOf(param));
    if (!read.ok) throw new Error(read.message);
    read.opaque.blob.objects.length = 1;
    expect(handleRuleObjectOf(writeHandleOpaque(read.opaque))).toBe("its 'handle' opaque holds no object");
  });

  describe('its edits', () => {
    const edited = (ops: McosTripleOp[]) => {
      const w = writeObjectEdits(param, [{ objectId: 1, ops, handleOf: 'CoderInfo' }]);
      expect(w, JSON.stringify(w)).toMatchObject({ ok: true });
      return (handleRuleObjectOf(cellOf((w as { records: McosSubsystemRecords }).records)) as McosRuleObject).held;
    };

    it('are written in every form the rules hand them over in, and read back so', () => {
      expect(edited([{ op: 'set', savedName: 'StorageClass', kind: 'str', text: 'ExportedGlobal' }]).get('StorageClass')).toEqual({ kind: 'str', text: 'ExportedGlobal' });
      expect(edited([{ op: 'set', savedName: 'StorageClass', kind: 'cell', value: chr('ImportedExtern') }]).get('StorageClass')).toEqual({ kind: 'str', text: 'ImportedExtern' });
      expect(edited([{ op: 'set', savedName: 'Alias', kind: 'str', text: 'k_gain' }]).get('Alias')).toMatchObject({ value: { value: 'k_gain' } });
      expect(edited([{ op: 'set', savedName: 'Alias', kind: 'cell', value: chr('k_gain') }]).get('Alias')).toMatchObject({ value: { value: 'k_gain' } });
      // An empty char of any size is no identifier.
      expect(edited([{ op: 'set', savedName: 'Alias', kind: 'cell', value: value({ className: 'char', dimensions: [1, 0], value: [] as never }) }]).get('Alias')).toMatchObject({ value: { value: '' } });
      expect(edited([{ op: 'set', savedName: 'Alignment', kind: 'int', value: 16 }]).get('Alignment')).toMatchObject({ value: { className: 'double', value: 16 } });
      expect(edited([{ op: 'set', savedName: 'Alignment', kind: 'cell', value: value({ value: 8 }) }]).get('Alignment')).toMatchObject({ value: { className: 'double', value: 8 } });
    });

    const refused: [string, McosTripleOp[], string][] = [
      ['a removal', [{ op: 'remove', savedName: 'Alias' }], 'CoderInfo.Identifier is always saved, and is not removed'],
      ['another property', [{ op: 'set', savedName: 'CustomStorageClass', kind: 'str', text: 'Const' }], 'CoderInfo.CustomStorageClass is not one of the properties an edit writes of a CoderInfo held as this one is'],
      ['Alignment as text', [{ op: 'set', savedName: 'Alignment', kind: 'str', text: '8' }], 'CoderInfo.Alignment is not one of the properties an edit writes of a CoderInfo held as this one is'],
      ['an Identifier as a number', [{ op: 'set', savedName: 'Alias', kind: 'cell', value: value({ value: 3 }) }], 'CoderInfo.Identifier is not one of the properties an edit writes of a CoderInfo held as this one is'],
      ['a storage class as a number', [{ op: 'set', savedName: 'StorageClass', kind: 'int', value: 2 }], 'CoderInfo.StorageClass is not one of the properties an edit writes of a CoderInfo held as this one is'],
      [
        'a storage class whose edit was not measured',
        [{ op: 'set', savedName: 'StorageClass', kind: 'str', text: 'Volatile' }],
        'CoderInfo could not be edited (no edit to storage class "Volatile" was measured; those measured are Auto, ExportedGlobal, ImportedExtern, ImportedExternPointer, SimulinkGlobal, Model default)',
      ],
    ];
    for (const [what, ops, message] of refused) {
      it(`refuse ${what}, naming the property as a user does, and change nothing`, () => {
        const before = bytesOf(param);
        expect(writeObjectEdits(param, [{ objectId: 1, ops, handleOf: 'CoderInfo' }])).toEqual({ ok: false, message });
        expect(bytesOf(param).equals(before)).toBe(true);
      });
    }

    it('refuse an owner that holds no such property', () => {
      expect(() => applyHandleOps(cloneSubsystem(param), 1, 'LoggingInfo', [])).toThrow('object 1 holds no LoggingInfo');
      expect(writeObjectEdits(param, [{ objectId: 1, ops: [], handleOf: 'LoggingInfo' }])).toEqual({ ok: false, message: 'object 1 holds no LoggingInfo' });
    });
  });
});

describe("an edit of an object's own triples, refused", () => {
  const set = (savedName: string, v: MatVariable): McosTripleOp => ({ op: 'set', savedName, kind: 'cell', value: v });
  const refusalOf = (sub: McosSubsystemRecords, objects: McosObjectOps[]) => {
    const before = bytesOf(sub);
    const w = writeObjectEdits(sub, objects);
    expect(bytesOf(sub).equals(before), 'the records written from are as they were').toBe(true);
    return w;
  };

  it('a value cell that holds objects, which an edit of its value does not replace', () => {
    expect(refusalOf(mix, [{ objectId: objectOf(mix, 'Simulink.Parameter'), ops: [set('CoderInfo', chr('x'))] }])).toEqual({
      ok: false,
      message: 'CoderInfo holds objects, which an edit of its value does not replace',
    });
    expect(refusalOf(mix, [{ objectId: objectOf(mix, 'Simulink.Bus'), ops: [set('Elements_internal', value({ dimensions: [0, 0], value: [] as never }))] }])).toEqual({
      ok: false,
      message: 'Elements_internal holds objects, which an edit of its value does not replace',
    });
  });

  it('a value cell another property names too, which writing would change as well', () => {
    const sub = cloneSubsystem(template('Simulink.Parameter'));
    const pv = sub.blob.pvLists[sub.blob.objects[1].pvList];
    const named = (n: string) => pv.find((t) => sub.blob.strings[t.name] === n)!;
    named('DocUnits').value = named('Description').value;
    expect(() => applyTripleOps(cloneSubsystem(sub), 1, [set('Description', chr('x'))])).toThrow(
      'Description holds its value in one place with another property, which writing it would change too',
    );
    // DocUnits is the Parameter's Unit, as a user names it.
    expect(refusalOf(sub, [{ objectId: 1, ops: [set('DocUnits', chr('m'))] }])).toEqual({
      ok: false,
      message: 'Unit holds its value in one place with another property, which writing it would change too',
    });
  });

  it('a text or an integer written over a property held as another kind', () => {
    const id = objectOf(mix, 'Simulink.Parameter');
    expect(refusalOf(mix, [{ objectId: id, ops: [{ op: 'set', savedName: 'Dimensions', kind: 'str', text: '[1 1]' }] }])).toEqual({
      ok: false,
      message: 'Dimensions is held as another kind of value than the one written',
    });
    expect(refusalOf(mix, [{ objectId: id, ops: [{ op: 'set', savedName: 'Complexity', kind: 'int', value: 1 }] }])).toEqual({
      ok: false,
      message: 'Complexity is held as another kind of value than the one written',
    });
  });

  for (const n of [-1, 0.5, 2 ** 32, Number.NaN]) {
    it(`an integer no triple holds: ${n}`, () => {
      const bus = objectOf(mix, 'Simulink.Bus');
      expect(refusalOf(mix, [{ objectId: bus, ops: [{ op: 'set', savedName: 'PreserveElementDimensions', kind: 'int', value: n }] }])).toEqual({
        ok: false,
        message: `PreserveElementDimensions would be ${n}, which is not a whole number from 0 to 4294967295`,
      });
    });
  }

  it('and the integers a triple holds are written, its name kept where it was', () => {
    const bus = objectOf(mix, 'Simulink.Bus');
    const w = writeObjectEdits(mix, [{ objectId: bus, ops: [{ op: 'set', savedName: 'PreserveElementDimensions', kind: 'int', value: 4294967295 }] }]);
    expect(w).toMatchObject({ ok: true });
    const after = (w as { records: McosSubsystemRecords }).records;
    expect(propertiesOf(after, bus).map((t) => t.savedName)).toEqual(propertiesOf(mix, bus).map((t) => t.savedName));
    expect(ruleObjectOf(after, bus).held.get('PreserveElementDimensions')).toEqual({ kind: 'int', value: 4294967295 });
  });
});

describe('a write of object edits', () => {
  it('throws a programming error inside it as one, not as a refusal', () => {
    expect(() =>
      writeObjectEdits(mix, [], () => {
        throw new TypeError('not a refusal');
      }),
    ).toThrow(TypeError);
  });

  it('declares each object once, with every property its ops, its handle and the save name', () => {
    expect(
      editedObjects(
        [
          { objectId: 4, ops: [{ op: 'set', savedName: 'Description', kind: 'str', text: '' }] },
          { objectId: 4, ops: [], handleOf: 'CoderInfo' },
          { objectId: 9, ops: [{ op: 'remove', savedName: 'Min' }] },
        ],
        [{ objectId: 4, properties: ['Description', 'any'] }, { objectId: 2, properties: ['any'] }],
      ),
    ).toEqual([
      { objectId: 4, properties: ['Description', 'CoderInfo', 'any'] },
      { objectId: 9, properties: ['Min'] },
      { objectId: 2, properties: ['any'] },
    ]);
  });
});
