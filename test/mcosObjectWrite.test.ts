// Copyright 2026 The MathWorks, Inc.
//
// The write of a MAT-file object's edits holds what it wrote to what was asked
// (McosObjectWrite.editedObjects, verifySubsystem's `edited`): an object no op names keeps every
// triple and every value cell it names; one edited changes only the properties its ops name; and
// no other value cell of the file changes but those of the properties declared. A write that
// reaches past that is refused.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import { subsystemElementOf } from '../src/datamodel/parser/MatFileWriter.js';
import { encodeMatVariable } from '../src/datamodel/parser/MatWriter.js';
import { McosValueKind, classNameOf, propertiesOf, readSubsystem, replaceValueCell, type McosSubsystemRecords } from '../src/datamodel/parser/McosSubsystemCodec.js';
import { writeObjectEdits } from '../src/datamodel/parser/McosObjectWrite.js';

const read = (rel: string) => new Uint8Array(readFileSync(fileURLToPath(new URL('./fixtures/' + rel, import.meta.url))));

function recordsOf(bytes: Uint8Array): McosSubsystemRecords {
  const parsed = parseMat(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const r = readSubsystem(subsystemElementOf(parsed.records.find((x) => x.offset === parsed.subsystemOffset)!)!);
  if (!r.ok) throw new Error(r.message);
  return r.subsystem;
}

const chr = (t: string) => ({ name: '', className: 'char', dimensions: [1, t.length], isComplex: false, isLogical: false, value: t, fields: null });

// mix.mat holds a Parameter, a Signal and more, each its own object.
const records = recordsOf(read('mcos-rules/mix.mat'));
const objectWith = (saved: string) => {
  for (let id = 1; id < records.blob.objects.length; id++) {
    if (propertiesOf(records, id).some((t) => t.savedName === saved && t.flag === McosValueKind.cell)) return id;
  }
  throw new Error('no object holds ' + saved);
};
const descriptionCell = (id: number) => propertiesOf(records, id).find((t) => t.savedName === 'Description')!.value;

describe('the write of an object edit changes what its ops name, and nothing else', () => {
  const p = objectWith('Description');
  const op = { op: 'set' as const, savedName: 'Description', kind: 'cell' as const, value: chr('edited') };

  it('an edit of one property is written', () => {
    expect(writeObjectEdits(records, [{ objectId: p, ops: [op] }])).toMatchObject({ ok: true });
  });

  it("a value cell of another object, changed beside it, is refused", () => {
    const other = [...Array(records.blob.objects.length).keys()].slice(1).find((id) => id !== p && propertiesOf(records, id).some((t) => t.savedName === 'Description'))!;
    const r = writeObjectEdits(records, [{ objectId: p, ops: [op] }], (sub) => replaceValueCell(sub, descriptionCell(other), encodeMatVariable(chr('stray'))));
    expect(r).toMatchObject({ ok: false, message: `the edits changed value cell ${descriptionCell(other)}, which no property edited names` });
    // Declared, the same cell is written.
    const also = [{ objectId: other, properties: ['Description'] }];
    expect(writeObjectEdits(records, [{ objectId: p, ops: [op] }], (sub) => replaceValueCell(sub, descriptionCell(other), encodeMatVariable(chr('stray'))), also)).toMatchObject({ ok: true });
  });

  it('a refusal names the property as a user does, not as the file saves it', () => {
    const coderInfo = [...Array(records.blob.objects.length).keys()].slice(1).find((id) => classNameOf(records, records.blob.objects[id].classIndex) === 'Simulink.CoderInfo')!;
    const r = writeObjectEdits(records, [{ objectId: coderInfo, ops: [{ op: 'set', savedName: 'Alias', kind: 'int', value: -1 }] }]);
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/^Identifier (is held as another kind of value than the one written|would be -1, which is not a whole number from 0 to 4294967295)$/) });
  });

  it("an edited object's property no op names, changed, is refused", () => {
    const triple = propertiesOf(records, p).find((t) => t.savedName !== 'Description' && t.flag === McosValueKind.cell)!;
    const r = writeObjectEdits(records, [{ objectId: p, ops: [op] }], (sub) => replaceValueCell(sub, triple.value, encodeMatVariable(chr('stray'))));
    expect(r).toMatchObject({ ok: false, message: `the edits changed value cell ${triple.value}, which no property edited names` });
  });
});
