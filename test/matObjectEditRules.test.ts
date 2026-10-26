// Copyright 2026 The MathWorks, Inc.
//
// An edit of a MAT-file object's property through the session, as a host makes one, written by the
// property rules (McosPropertyRules) through the codec: a property at its default given a value
// inserts its triple, one set back to its default loses it, and the objects a node shows of what it
// holds (a CoderInfo's StorageClass, a Bus's elements) are edited as objects of their own. Over the
// originals of the rules probe (test/fixtures/mcos-rules), one per class, each saved by MATLAB R2027a.
// What MATLAB loads of such edits is the probe's (test/mcosPropertyRulesGoldens.test.ts) and the
// live gate's; here, what the save writes and what this package reads of it again.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import { subsystemElementOf } from '../src/datamodel/parser/MatFileWriter.js';
import { zlibSync } from 'fflate';
import { addValueCell, descriptorCell, handleCoderInfoOf, propertiesOf, readSubsystem, stringObjectOf, writeSubsystem, type McosSubsystemRecords } from '../src/datamodel/parser/McosSubsystemCodec.js';
import { heldObjectIds, ruleObjectOf } from '../src/datamodel/parser/McosObjectWrite.js';
import { objectIdOf } from '../src/datamodel/parser/McosSubsystemEdit.js';
import { mcosPlaceOf } from '../src/datamodel/node/mcosPlace.js';
import { matObjectStateOf } from '../src/datamodel/node/data/matObjectEdit.js';

const DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'mcos-rules');
const read = (file: string) => new Uint8Array(readFileSync(join(DIR, file)));
const bufferOf = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

function opened(bytes: Uint8Array) {
  const session = createSession();
  const root: any = session.addMatSource('f.mat', bufferOf(bytes));
  const by = (name: string) => root.children.find((c: any) => c.name === name);
  const edit = (node: any, prop: string, value: string) => {
    session.setActive(root, node);
    return session.editProperty(node.id, prop, value);
  };
  const save = (): Uint8Array => (session.serializeSource('f.mat') as { bytes: Uint8Array }).bytes;
  const shown = (node: any, key: string) => node.getPropInfo(node.getProperties().find((p: any) => p.key === key)).displayValue;
  return { session, root, by, edit, save, shown };
}

function recordsOf(bytes: Uint8Array): McosSubsystemRecords {
  const parsed = parseMat(bufferOf(bytes));
  const read = readSubsystem(subsystemElementOf(parsed.records.find((r) => r.offset === parsed.subsystemOffset)!)!);
  if (!read.ok) {
    throw new Error(read.message);
  }
  return read.subsystem;
}

/** The triples of the object a variable `name` of `bytes` holds, or of one it holds by `nested` ('CoderInfo', 'Elements_internal(1)'), as 'saved=kind:value'. */
function triplesOf(bytes: Uint8Array, name: string, nested?: string): Record<string, string> {
  const records = recordsOf(bytes);
  const node = opened(bytes).by(name);
  const place = mcosPlaceOf(node)!;
  let id = objectIdOf(place.variable.mcosHandle, place.index)!;
  if (nested) {
    const [, saved, index] = /^(\w+)(?:\((\d+)\))?$/.exec(nested)!;
    id = heldObjectIds(records, id, saved)![Number(index ?? 1) - 1];
  }
  const out: Record<string, string> = {};
  for (const [saved, held] of ruleObjectOf(records, id).held) {
    out[saved] =
      held.kind === 'str' ? 'str:' + held.text
        : held.kind === 'int' ? 'int:' + held.value
          : held.kind === 'cell' ? 'cell:' + (held.value ? JSON.stringify(held.value.value) : '?')
            : held.kind;
  }
  return out;
}

describe('a property at its default takes a value, and set back to its default loses its triple', () => {
  it("a Parameter's Value, Min and Description: inserted, then removed in a save of the saved file", () => {
    const { by, edit, save } = opened(read('p0.mat'));
    expect(triplesOf(read('p0.mat'), 'p')).not.toHaveProperty('Value');
    expect([edit(by('p'), 'Value', '5'), edit(by('p'), 'Min', '0'), edit(by('p'), 'Description', 'gain')]).toEqual([true, true, true]);
    const saved = save();
    expect(triplesOf(saved, 'p')).toMatchObject({ Value: 'cell:5', Min: 'cell:0', Description: 'cell:"gain"', Dimensions: 'cell:[1,1]' });
    const again = opened(saved);
    expect([again.by('p').displayValue, again.by('p').Min, again.by('p').Description]).toEqual(['5', 0, 'gain']);
    expect([again.edit(again.by('p'), 'Value', '[]'), again.edit(again.by('p'), 'Min', '[]'), again.edit(again.by('p'), 'Description', '')]).toEqual([true, true, true]);
    const back = again.save();
    const triples = triplesOf(back, 'p');
    for (const saved of ['Value', 'Min', 'Description']) {
      expect(triples, saved).not.toHaveProperty(saved);
    }
    const third = opened(back).by('p');
    expect([third.displayValue, third.Min, third.Description]).toEqual(['[ ]', undefined, '']);
  });

  it("a Parameter's DataType set over its double Value is written; a Value then of another class makes it that class", () => {
    const { by, edit, save } = opened(read('p0.mat'));
    expect(edit(by('p'), 'Value', '5')).toBe(true);
    expect(edit(by('p'), 'DataType', 'int8')).toBe(true);
    expect(triplesOf(save(), 'p').DataType).toBe('cell:"int8"');
    expect(edit(by('p'), 'Value', 'true')).toBe(true);
    expect(by('p').DataType).toBe('boolean');
    const saved = save();
    expect(triplesOf(saved, 'p')).toMatchObject({ Value: 'cell:1', DataType: 'cell:"boolean"' });
    expect(opened(saved).by('p').DataType).toBe('boolean');
  });

  it("a Signal's Complexity and DimensionsMode, indices into the file's text: inserted, and 'auto' removes them", () => {
    const { by, edit, save, shown } = opened(read('s0.mat'));
    expect([edit(by('sig'), 'complexity', 'complex'), edit(by('sig'), 'dimensionsMode', 'Variable')]).toEqual([true, true]);
    const saved = save();
    expect(triplesOf(saved, 'sig')).toMatchObject({ Complexity: 'str:complex', DimensionsMode: 'str:Variable' });
    const again = opened(saved);
    expect([shown(again.by('sig'), 'complexity'), shown(again.by('sig'), 'dimensionsMode')]).toEqual(['complex', 'Variable']);
    expect(again.edit(again.by('sig'), 'complexity', 'auto')).toBe(true);
    expect(triplesOf(again.save(), 'sig')).not.toHaveProperty('Complexity');
  });

  it("a ValueType's Min, Complexity and DimensionsMode (char cells), each at its default", () => {
    const { by, edit, save, shown } = opened(read('vt0.mat'));
    expect([edit(by('vt'), 'Min', '1'), edit(by('vt'), 'complexity', 'complex'), edit(by('vt'), 'dimensionsMode', 'Variable')]).toEqual([true, true, true]);
    const saved = save();
    expect(triplesOf(saved, 'vt')).toMatchObject({ Min: 'cell:1', Complexity: 'cell:"complex"', DimensionsMode: 'cell:"Variable"' });
    const again = opened(saved).by('vt');
    expect([again.Min, again.Complexity, again.DimensionsMode]).toEqual([1, 'complex', 'Variable']);
    expect(shown(opened(saved).by('vt'), 'complexity')).toBe('complex');
  });
});

describe('an object a node shows of what its object holds is edited as an object of its own', () => {
  it("a Signal's StorageClass, its CoderInfo's: one index into the file's text", () => {
    const { by, edit, save, shown } = opened(read('sset.mat'));
    expect(edit(by('sig'), 'storageClass', 'ExportedGlobal')).toBe(true);
    const saved = save();
    expect(triplesOf(saved, 'sig', 'CoderInfo').StorageClass).toBe('str:ExportedGlobal');
    expect(shown(opened(saved).by('sig'), 'storageClass')).toBe('ExportedGlobal');
    // A custom storage class, whose attributes object a change replaces: refused by its value.
    // The storage classes its editor offers are the rules', as saved: no custom one, nor 'Model
    // default', which is saved, and read back, as 'SimulinkGlobal'.
    const sc = by('sig').getPropInfo(by('sig').getProperties().find((p: any) => p.key === 'storageClass'));
    expect(sc.options).toEqual(['Auto', 'SimulinkGlobal', 'ExportedGlobal', 'ImportedExtern', 'ImportedExternPointer']);
    expect(edit(by('sig'), 'storageClass', 'Custom')).toMatchObject({ error: true, reason: 'Cannot edit "sig": Invalid value for Storage Class.' });
  });

  it("a Bus's own Description, and its elements' Name and Min, each an object of the file", () => {
    const original = read('bset.mat');
    const { by, edit, save } = opened(original);
    const b = by('b');
    const [e1, e2] = b.children;
    expect([edit(b, 'Description', 'renamed bus'), edit(e1, 'Name', 'first'), edit(e2, 'Min', '-1'), edit(e2, 'Description', 'second')]).toEqual([true, true, true, true]);
    const saved = save();
    expect(triplesOf(saved, 'b').Description).toBe('cell:"renamed bus"');
    expect(triplesOf(saved, 'b', 'Elements_internal(1)').Name).toBe('cell:"first"');
    expect(triplesOf(saved, 'b', 'Elements_internal(2)')).toMatchObject({ Min_internal: 'cell:-1', Description: 'cell:"second"' });
    const again = opened(saved).by('b');
    expect([again.Description, again.children.map((e: any) => e.name), again.children[1].Min, again.children[1].Description]).toEqual(['renamed bus', ['first', 'e2'], -1, 'second']);
  });

  it("a bus element's Name a sibling holds, or that is no identifier, and a Min the element's DataType cannot hold", () => {
    const { by, edit, root } = opened(read('bset.mat'));
    const [e1, e2] = by('b').children;
    // The node's own rule says it first, as MATLAB's assignment does.
    expect(edit(e2, 'Name', 'e1')).toMatchObject({ error: true, reason: "Cannot rename \"b.e2\": 'e1' already names another member of b." });
    expect(edit(e2, 'Name', '2x')).toMatchObject({ error: true, reason: expect.stringMatching(/^Cannot rename "b\.e2": Invalid MATLAB name/) });
    expect(edit(e1, 'Min', '-40000')).toMatchObject({ error: true, reason: expect.stringMatching(/b\.Elements\(1\)\.Min \(-40000\) would be outside the range \[-32768, 32767\] of its DataType 'int16'/) });
    expect(root.dirty).toBe(false);
  });
});

describe('the rows a node shows only in its Property Inspector, which a MAT-file offers an editor of', () => {
  it("a NumericType's Description and its mode's rows, as MATLAB's setters take them; an AliasType's BaseType", () => {
    const nt = opened(read('ntf.mat'));
    expect(nt.edit(nt.by('nt'), 'Description', 'fixed')).toBe(true);
    expect(triplesOf(nt.save(), 'nt').Description).toBe('cell:"fixed"');
    // nt is fixdt(1,16,4), binary point: a WordLength and a FractionLength taken, a Slope that is
    // no power of two and a Bias refused, as MATLAB refuses or warns.
    expect([nt.edit(nt.by('nt'), 'wordLength', '8'), nt.edit(nt.by('nt'), 'fractionLength', '2')]).toEqual([true, true]);
    expect(nt.edit(nt.by('nt'), 'slope', '0.75')).toMatchObject({ error: true, reason: expect.stringMatching(/binary point scaling takes only a power of two/) });
    expect(nt.edit(nt.by('nt'), 'bias', '1')).toMatchObject({ error: true, reason: expect.stringMatching(/nt\.Bias is set only in slope and bias scaling/) });
    expect(triplesOf(nt.save(), 'nt')).toMatchObject({ WordLength: 'cell:8', FixedExponent: 'cell:-2' });
    // A floating mode set: its WordLength and scaling follow, as MATLAB's setter sets them.
    expect(nt.edit(nt.by('nt'), 'dataTypeMode', 'Single')).toBe(true);
    const shown = (n: any, key: string) => n.getPropInfo(n.getPILayout().flatMap((g: any) => g.items).find((p: any) => p.key === key)).displayValue;
    expect(['wordLength', 'fractionLength', 'slope', 'signedness'].map((k) => shown(nt.by('nt'), k))).toEqual(['32', '0', '1', 'Signed']);
    expect(['wordLength', 'fractionLength'].map((k) => shown(opened(nt.save()).by('nt'), k))).toEqual(['32', '0']);
    const at = opened(read('at0.mat'));
    expect(at.edit(at.by('at'), 'BaseType', 'int16')).toBe(true);
    expect(at.edit(at.by('at'), 'BaseType', ' int8')).toMatchObject({ error: true, reason: "Cannot edit \"at\": at.BaseType would be ' int8', which MATLAB would load as 'int8': it trims the white space at either end." });
    expect(triplesOf(at.save(), 'at').BaseType).toBe('cell:"int16"');
  });

  it('a LookupTable, which its node offers no editor of a property of, shows none', () => {
    const { by } = opened(read('lt1.mat'));
    const lt = by('lt');
    expect(lt.getProperties().filter((p: any) => p.key !== 'Name' && lt.getPropInfo(p).editable)).toEqual([]);
  });
});

describe("a string's text is written into its payload, and the variable that holds it as it was read", () => {
  // str.mat: s1 = "abc"; s2 = ["x", "y"]; st.a = "in struct", st.k = 1; c = {"in cell", 2}.
  const payloadOf = (bytes: Uint8Array, name: string, field?: (v: any) => any) => {
    const records = recordsOf(bytes);
    const node = opened(bytes).by(name);
    const at = field ? field(node) : node;
    const place = mcosPlaceOf(at)!;
    return stringObjectOf(records, objectIdOf(place.variable.mcosHandle, place.index)!);
  };
  const recordBytes = (bytes: Uint8Array, name: string) =>
    parseMat(bufferOf(bytes)).records.filter((r) => r.name === name).map((r) => Array.from(r.bytes).join(','));

  it('a scalar, an element of an array, the whole array at another size, a struct field and a cell element', () => {
    const original = read('str.mat');
    const { by, edit, save } = opened(original);
    const st = by('st');
    const c = by('c');
    expect([
      edit(by('s1'), 'Value', '"xyz"'),
      edit(by('s2').children[0], 'Value', '"q"'),
      edit(st.children.find((f: any) => f.name === 'a'), 'Value', '"field"'),
      edit(c.children[0], 'Value', '"cell"'),
    ]).toEqual([true, true, true, true]);
    let saved = save();
    expect(payloadOf(saved, 's1')).toMatchObject({ dims: [1, 1], texts: ['xyz'] });
    expect(payloadOf(saved, 's2')).toMatchObject({ dims: [1, 2], texts: ['q', 'y'] });
    expect(payloadOf(saved, 'st', (n) => n.children.find((f: any) => f.name === 'a'))).toMatchObject({ texts: ['field'] });
    expect(payloadOf(saved, 'c', (n) => n.children[0])).toMatchObject({ texts: ['cell'] });
    // Every variable's record as it was read: the edits are the subsystem's.
    for (const name of ['s1', 's2', 'st', 'c', 'p', 'x']) {
      expect(recordBytes(saved, name), name).toEqual(recordBytes(original, name));
    }
    // A string array typed in whole, at another size: its payload says the new one.
    expect(edit(by('s2'), 'Value', '["a" "b"; "c" "d"]')).toBe(true);
    saved = save();
    const again = opened(saved).by('s2');
    expect([again.displayValue, again.dims]).toEqual(['["a" "b"; "c" "d"]', [2, 2]]);
    expect(payloadOf(saved, 's2')).toMatchObject({ dims: [2, 2], texts: ['a', 'c', 'b', 'd'] });
  });

  // A value of another class typed over a string makes it another variable (MatNode._retype;
  // matRetypeString.test.ts).
  it('a row added to a string array is its text, which a save writes into its payload', () => {
    const { by, root } = opened(read('str.mat'));
    // As a dictionary's string array takes one (test/matStringArrayRows.test.ts).
    expect([by('s2').canAddChild(), by('s2').canRemoveChild()]).toEqual([true, true]);
    expect(root.dirty).toBe(false);
  });
});

describe('objects another MATLAB release wrote: the encoding of the triple held, and a CoderInfo in a handle opaque', () => {
  // test/fixtures/mcos-handle (CoderInfos saved by MATLAB R2023b and R2024b, a 'handle' opaque each)
  // and test/fixtures/mcos-templates (objects merged from R2023b's templates into an R2027a file).
  const HANDLE = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures');
  const readAt = (rel: string) => new Uint8Array(readFileSync(join(HANDLE, rel)));
  const coderInfoOf = (bytes: Uint8Array, name: string) => {
    const records = recordsOf(bytes);
    const node = opened(bytes).by(name);
    const place = mcosPlaceOf(node)!;
    const id = objectIdOf(place.variable.mcosHandle, place.index)!;
    const t = propertiesOf(records, id).find((p) => p.savedName === 'CoderInfo')!;
    const read = handleCoderInfoOf(records.values[t.value]);
    return read.ok ? read.settings : read.message;
  };

  it("an R2023b Parameter's StorageClass, inside its CoderInfo's opaque, ImportedExternPointer included", () => {
    const original = readAt('mcos-handle/r2023b/p0.mat');
    expect(coderInfoOf(original, 'p')).toEqual({ StorageClass: 'Auto', Identifier: '', Alignment: -1 });
    const { by, edit, save, shown } = opened(original);
    expect(edit(by('p'), 'storageClass', 'ImportedExternPointer')).toBe(true);
    const saved = save();
    expect(coderInfoOf(saved, 'p')).toEqual({ StorageClass: 'ImportedExternPointer', Identifier: '', Alignment: -1 });
    expect(shown(opened(saved).by('p'), 'storageClass')).toBe('ImportedExternPointer');
  });

  it("an Alignment under a storage class other than Auto; and Auto then refused while it is set", () => {
    const { by, edit, save, shown, root } = opened(readAt('mcos-handle/r2023b/pexp.mat'));
    expect(edit(by('p'), 'alignment', '8')).toBe(true);
    const saved = save();
    expect(coderInfoOf(saved, 'p')).toEqual({ StorageClass: 'ExportedGlobal', Identifier: '', Alignment: 8 });
    expect(shown(opened(saved).by('p'), 'alignment')).toBe('8');
    expect(edit(by('p'), 'alignment', '256')).toMatchObject({ error: true, reason: expect.stringMatching(/power of two up to 128/) });
    expect(edit(by('p'), 'storageClass', 'Auto')).toMatchObject({ error: true, reason: expect.stringMatching(/an Identifier or an Alignment under StorageClass 'Auto'/) });
    expect(root.dirty).toBe(true);
  });

  it('an R2024b Signal: its Complexity, an index it always saves, and its StorageClass', () => {
    const original = readAt('mcos-handle/r2024b/s0.mat');
    const { by, edit, save } = opened(original);
    expect([edit(by('sig'), 'complexity', 'complex'), edit(by('sig'), 'storageClass', 'ExportedGlobal')]).toEqual([true, true]);
    const saved = save();
    expect(triplesOf(saved, 'sig').Complexity).toBe('str:complex');
    expect(coderInfoOf(saved, 'sig')).toMatchObject({ StorageClass: 'ExportedGlobal' });
  });

  it("an object merged from R2023b's template: every property saved, its Complexity a char cell, written as one", () => {
    const original = readAt('mcos-templates/merged/r2027a/D_Simulink_Parameter__param.mat');
    expect(triplesOf(original, 'pnew').Complexity).toBe('cell:"real"');
    const { by, edit, save } = opened(original);
    expect([edit(by('pnew'), 'Value', '1+2i'), edit(by('pnew'), 'storageClass', 'ExportedGlobal')]).toEqual([true, true]);
    const saved = save();
    expect(triplesOf(saved, 'pnew')).toMatchObject({ Complexity: 'cell:"complex"' });
    expect(coderInfoOf(saved, 'pnew')).toMatchObject({ StorageClass: 'ExportedGlobal' });
    expect(opened(saved).by('pnew').displayValue).toBe('1+2i');
  });
});

describe('a subsystem of a blob version no edit was measured on', () => {
  it('takes no edit of its objects, saying so', () => {
    const bytes = read('p0.mat');
    const records = recordsOf(bytes);
    records.blob.major = 5;
    expect(matObjectStateOf(records, opened(bytes).by('p'))).toBe("p's object is in a subsystem of blob version 5.0, which no edit was measured on against MATLAB");
  });
});

describe('an object or a payload the file names from two places, which MATLAB never writes', () => {
  // The file with its subsystem replaced by `records` written, in the record's own compression.
  function withRecords(bytes: Uint8Array, edit: (records: McosSubsystemRecords) => void): Uint8Array {
    const parsed = parseMat(bufferOf(bytes));
    const record = parsed.records.find((r) => r.offset === parsed.subsystemOffset)!;
    const records = recordsOf(bytes);
    edit(records);
    const element = writeSubsystem(records);
    const stream = record.compressed ? zlibSync(element, { level: 6 }) : element;
    const tag = new Uint8Array(8);
    new DataView(tag.buffer).setUint32(0, 15, true);
    new DataView(tag.buffer).setUint32(4, stream.length, true);
    const parts = record.compressed ? [bytes.subarray(0, record.offset), tag, stream] : [bytes.subarray(0, record.offset), stream];
    const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
    return out;
  }
  const idOf = (bytes: Uint8Array, name: string) => {
    const place = mcosPlaceOf(opened(bytes).by(name))!;
    return objectIdOf(place.variable.mcosHandle, place.index)!;
  };

  it("a string whose payload another string names: its edit refused, as one of both", () => {
    const original = read('str.mat');
    const shared = withRecords(original, (records) => {
      const s2 = stringObjectOf(records, idOf(original, 's2'))!;
      const row = records.blob.objects[idOf(original, 's1')];
      records.blob.ctorLists[row.ctorList][0].value = s2.valueIndex;
    });
    const { by, edit, root } = opened(shared);
    expect(edit(by('s1'), 'Value', '"changed"')).toMatchObject({
      error: true,
      reason: 'Cannot edit "s1": s1\'s text is held in a payload the file names for another string as well, which an edit would change too.',
    });
    expect(root.dirty).toBe(false);
  });

  it("a CoderInfo another value cell names as well: its StorageClass refused", () => {
    const original = read('p0.mat');
    const shared = withRecords(original, (records) => {
      const coder = heldObjectIds(records, idOf(original, 'p'), 'CoderInfo')![0];
      addValueCell(records, descriptorCell({ dims: [1, 1], ids: [coder], classIndex: records.blob.objects[coder].classIndex }));
    });
    const { by, edit } = opened(shared);
    expect(edit(by('p'), 'storageClass', 'ExportedGlobal')).toMatchObject({
      error: true,
      reason: 'Cannot edit "p": p.CoderInfo is one object of the file that another object holds as well, which an edit of it would change too.',
    });
    // Its own properties are its own still.
    expect(edit(by('p'), 'Value', '5')).toBe(true);
  });
});
