// Copyright 2026 The MathWorks, Inc.
//
// What McosTemplateMerge refuses, and that a refusal changes nothing: not the subsystem's records,
// and not the save session's class rows.
//
// test/mcosTemplateMerge.test.ts holds the refusals made before a copy begins (a class with no
// template, a name twice, a blob of another version). Held here are the rest:
//
//   - an empty subsystem is made only in the shape of a class that has a template;
//   - a merge refused part-way, by a class system the stream cannot be given beside the one it
//     holds, leaves every table, value cell and the stream's trailing element as they were, and
//     the session the class rows of the merges before it: a merge after it in the same save shares
//     their row, as MATLAB's append writes one class row per class per save;
//   - a Bus whose Elements are not the reference MATLAB saves (a value where the reference is, or a
//     cell another triple names too) takes no element added or removed, and one holding an element
//     whose name the file does not save as text takes none added, rather than a name beside it
//     unchecked: what the editor asks before it offers the row (matObjectEdit.busStructureRefusal).

import { describe, it, expect } from 'vitest';
import { addBusElements, busElementsOf, CREATABLE_MCOS_CLASSES, createAppendSession, createTemplateSubsystem, mergeTemplateObject, removeBusElement } from '../src/datamodel/parser/McosTemplateMerge.js';
import { addClassSystems, classSystemsOf, removePvTriple, writeSubsystem, type McosSubsystemRecords } from '../src/datamodel/parser/McosSubsystemCodec.js';
import { encodeMatVariable, MatWriteError } from '../src/datamodel/parser/MatWriter.js';
import type { MatVariable } from '../src/datamodel/parser/MatParser.js';

const bytes = (sub: McosSubsystemRecords) => Buffer.from(writeSubsystem(sub));

const double = (dimensions: number[], value: number[]): MatVariable =>
  ({ name: '', className: 'double', dimensions, isComplex: false, isLogical: false, value, fields: null }) as MatVariable;

/** Every table a merge appends to, by its length: what a refusal must leave as it was. */
const lengths = (sub: McosSubsystemRecords) => ({
  strings: sub.blob.strings.length,
  classes: sub.blob.classes.length,
  objects: sub.blob.objects.length,
  pvLists: sub.blob.pvLists.length,
  values: sub.values.length,
  defaults: sub.defaults?.entries.length,
});

/** A subsystem holding one new Bus of the elements named, and the Bus's id. */
function busOf(elements: string[]): { sub: McosSubsystemRecords; bus: number } {
  const sub = createTemplateSubsystem('Simulink.Bus');
  return { sub, bus: mergeTemplateObject(sub, 'Simulink.Bus', { elements }).objectId };
}

/** The triple of `saved` on object `id`, to change in place. */
const tripleOf = (sub: McosSubsystemRecords, id: number, saved: string) => sub.blob.pvLists[sub.blob.objects[id].pvList].find((t) => sub.blob.strings[t.name] === saved)!;

describe('an empty subsystem in a template\'s shape', () => {
  it('is made only for a class that has a template, naming those that do', () => {
    expect(() => createTemplateSubsystem('Simulink.Nope')).toThrow(MatWriteError);
    expect(() => createTemplateSubsystem('Simulink.Nope')).toThrow('no template for Simulink.Nope: a new object can be created only as ' + CREATABLE_MCOS_CLASSES.join(', '));
  });
});

describe('a merge refused part-way', () => {
  // A stream that names a class system beside MCOS that no merge was measured beside: a
  // Parameter's 'handle' CoderInfo cannot be added to it.
  function refusing() {
    const sub = createTemplateSubsystem('string');
    addClassSystems(sub, ['OtherSystem']);
    const session = createAppendSession();
    const first = mergeTemplateObject(sub, 'string', { session });
    return { sub, session, first };
  }

  it('says why, and leaves the records as they were', () => {
    const { sub, session } = refusing();
    const before = { lengths: lengths(sub), bytes: bytes(sub), rest: Buffer.from(sub.rest) };
    expect(() => mergeTemplateObject(sub, 'Simulink.Parameter', { session })).toThrow(
      "the subsystem's stream holds OtherSystem objects, beside which no handle system was measured",
    );
    expect(lengths(sub)).toEqual(before.lengths);
    expect(Buffer.from(sub.rest).equals(before.rest)).toBe(true);
    expect(bytes(sub).equals(before.bytes)).toBe(true);
    expect(classSystemsOf(sub)).toEqual(['MCOS', 'OtherSystem']);
  });

  it("and the session the rows of the merges before it, which a merge after it shares", () => {
    const { sub, session, first } = refusing();
    expect([...session.classes]).toEqual([['string', first.classIndex]]);
    expect(() => mergeTemplateObject(sub, 'Simulink.Parameter', { session })).toThrow(MatWriteError);
    expect([...session.classes]).toEqual([['string', first.classIndex]]);
    const classes = sub.blob.classes.length;
    const second = mergeTemplateObject(sub, 'string', { session });
    expect(second.classIndex).toBe(first.classIndex);
    expect(sub.blob.classes.length).toBe(classes);
    expect(second.objectId).toBeGreaterThan(first.objectId);
  });
});

describe("a Bus whose Elements are not the reference MATLAB saves", () => {
  it('a value where the reference is takes no element added or removed', () => {
    const { sub, bus } = busOf(['a']);
    sub.values[tripleOf(sub, bus, 'Elements_internal').value] = encodeMatVariable(double([0, 0], []));
    const before = bytes(sub);
    const why = "the Bus's elements are not a reference to BusElements of one class row, the shape MATLAB saves";
    expect(() => addBusElements(sub, bus, ['b'])).toThrow(why);
    expect(() => removeBusElement(sub, bus, 0)).toThrow(why);
    expect(() => busElementsOf(sub, bus)).toThrow(why);
    expect(bytes(sub).equals(before)).toBe(true);
  });

  it('nor a reference cell another triple names too, which an edit of it would change as well', () => {
    const { sub, bus } = busOf(['a']);
    tripleOf(sub, bus, 'Description').value = tripleOf(sub, bus, 'Elements_internal').value;
    const before = bytes(sub);
    expect(() => addBusElements(sub, bus, ['b'])).toThrow("the Bus's elements cell is named by another triple as well");
    expect(() => removeBusElement(sub, bus, 0)).toThrow("the Bus's elements cell is named by another triple as well");
    expect(bytes(sub).equals(before)).toBe(true);
  });
});

describe('a Bus holding an element whose name the file does not save as text', () => {
  const unnamed: Record<string, (sub: McosSubsystemRecords, element: number) => void> = {
    'saves no Name': (sub, e) => removePvTriple(sub, e, 'Name'),
    'saves its Name as a number': (sub, e) => {
      sub.values[tripleOf(sub, e, 'Name').value] = encodeMatVariable(double([1, 1], [3]));
    },
    'saves its Name as an miMATRIX of no bytes, MATLAB\'s []': (sub, e) => {
      sub.values[tripleOf(sub, e, 'Name').value] = new Uint8Array([14, 0, 0, 0, 0, 0, 0, 0]);
    },
  };
  for (const [what, damage] of Object.entries(unnamed)) {
    it(`takes no element added where one ${what}, rather than a name beside it unchecked`, () => {
      const { sub, bus } = busOf(['a']);
      damage(sub, busElementsOf(sub, bus)[0]);
      const before = bytes(sub);
      expect(() => addBusElements(sub, bus, ['b'])).toThrow('a Bus element needs a name');
      expect(bytes(sub).equals(before)).toBe(true);
    });
  }
});
