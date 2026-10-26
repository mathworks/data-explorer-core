// Copyright 2026 The MathWorks, Inc.
//
// A text and a binary dictionary take the edits of an object's properties a MAT-file takes, held
// to the same rules, refused in the same words, and written as MATLAB writes them (dictObjectEdit;
// S12 of the 2026-10-26 edit bash, where a dictionary showed each "read-only here"). The values
// are the edit-bash fixtures', the same objects in every format.
//
// Every edit taken here was made by MATLAB too, on the original dictionary (`v = getValue(e);
// v.SampleTime = [0.2 0.1];`), and getValue of the entry core saved was isequaln to it, every
// other entry unchanged, with a control caught: R2027a's text and binary dictionaries, and
// R2023b's binary one.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { bufferOf } from './tools/matPaste.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const fixture = (path: string) => new Uint8Array(readFileSync(new URL('./fixtures/edit-bash/' + path, import.meta.url)));
const DICTIONARIES = ['r2027a/values_text.sldd', 'r2027a/values_binary.sldd', 'r2023b/values_binary.sldd'];
const ALL = ['r2027a/values.mat', 'r2023b/values.mat', ...DICTIONARIES];

/** A file opened through a session, as a host opens one, and what a host does to it. */
function opened(path: string, bytes: Uint8Array = fixture(path)) {
  const session = createSession();
  const filename = path.split('/').pop()!;
  const root: any = path.endsWith('.mat')
    ? session.addMatSource(filename, bufferOf(bytes))
    : ingest(session, filename.endsWith('_text.sldd') ? new TextDecoder().decode(bytes) : bytes, { filename });
  const at = (p: string): any => root.flatten().find((n: any) => n.matlabPath === p && !n.isContainer);
  const edit = (p: string, key: string, value: string) => {
    const node = at(p);
    session.setActive(root, node);
    return session.editProperty(node.id, key, value);
  };
  const save = (): Uint8Array => {
    const out: any = session.serializeSource(filename);
    return out.kind === 'text' ? new TextEncoder().encode(out.text) : out.bytes;
  };
  const undo = () => {
    session.setActive(root, null);
    session.undo();
  };
  const redo = () => {
    session.setActive(root, null);
    session.redo();
  };
  return { root, at, edit, save, undo, redo };
}

/** What a node shows of each property, in the table and in its Property Inspector, as text. */
function shown(node: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of node.getProperties()) {
    out[p.key] = String(node.getPropInfo(p).displayValue);
  }
  for (const [key, value] of Object.entries(node.toPIObject().objects[0] ?? {})) {
    if (key !== '_id') {
      out['PI:' + key] = String(value);
    }
  }
  return out;
}

/** The keys of `node`'s properties, table and Property Inspector, that offer an editor. */
function editable(node: any): string[] {
  const keys = node.getProperties().filter((p: any) => node.getPropInfo(p).editable).map((p: any) => p.key);
  const pi = node.toPIObject().propertySheet.properties.filter((p: any) => p.editable).map((p: any) => 'PI:' + p.name);
  // A Property Inspector shows a select as a label, in a dictionary (its storage class: the table's
  // select takes the edit in every format).
  return [...keys, ...pi.filter((k: string) => k !== 'PI:storageClass')].sort();
}

// Each edit, by row, key and text, with what MATLAB's own edit shows of it after.
const EDITS: [string, string, string][] = [
  ['pProps', 'DataType', 'double'], ['pProps', 'DataType', 'fixdt(1,16,4)'], ['pProps', 'DataType', 'auto'], ['pProps', 'Unit', 's'], ['pProps', 'Unit', ''],
  ['pInt8', 'Unit', 'm/s'],
  ['sig', 'DataType', 'int8'], ['sig', 'DataType', 'auto'], ['sig', 'Unit', 'V'], ['sig', 'dimensions', '[2 3]'], ['sig', 'dimensions', '5'], ['sig', 'dimensions', '-1'],
  ['sig', 'initialValue', '[1 2 3]'], ['sig', 'sampleTime', '0.1'], ['sig', 'sampleTime', '[0.2 0.1]'], ['sig', 'samplingMode', 'Sample based'],
  ['bus', 'headerFile', 'a.h'], ['bus', 'alignment', '8'], ['bus', 'preserveElementDimensions', 'true'], ['bus', 'dataScope', 'Exported'],
  ['bus.e1', 'DataType', 'int16'], ['bus.e1', 'Unit', 'm'], ['bus.e1', 'dimensions', '[3 1]'], ['bus.e2', 'dimensions', '4'],
  ['sHoldsParam.p', 'DataType', 'single'], ['cHoldsParam{1}', 'Unit', 'kg'],
  ['numType', 'wordLength', '8'], ['numType', 'fractionLength', '2'], ['numType', 'slope', '0.5'], ['numType', 'isAlias', 'true'], ['numType', 'dataTypeMode', 'Single'],
  ['numType', 'dataScope', 'Imported'], ['numType', 'headerFile', 'nt.h'], ['numType', 'signedness', 'Unsigned'], ['numType', 'dataTypeOverride', 'Off'],
];

// What MATLAB refuses or loads otherwise, refused in every format in the words a MAT-file gives.
const REFUSED: [string, string, string, string][] = [
  ['bus', 'alignment', '3', 'Cannot edit "bus": bus.Alignment must be -1 or a power of two up to 128, as a double: MATLAB refuses or rounds anything else (it takes 256 and 512 too, against its own message, which this editor does not).'],
  ['bus', 'headerFile', 'bé.h', "Cannot edit \"bus\": bus.HeaderFile would be 'bé.h', which MATLAB refuses: it takes ASCII characters only."],
  ['bus', 'headerFile', ' a.h ', "Cannot edit \"bus\": bus.HeaderFile would be ' a.h ', which MATLAB would load as 'a.h': it trims the white space at either end."],
  ['bus', 'dataScope', 'Global', "Cannot edit \"bus\": bus.DataScope must be one of 'Auto', 'Exported', 'Imported', spelled so: MATLAB refuses or re-spells 'Global'."],
  ['bus', 'preserveElementDimensions', '2', 'Cannot edit "bus": bus.PreserveElementDimensions must be true or false.'],
  ['sig', 'sampleTime', '-2', 'Cannot edit "sig": sig.SampleTime must be -1, 0, a positive double or Inf, or [Ts offset] with 0 < offset < Ts: MATLAB refuses anything else, and makes [Ts 0] Ts.'],
  ['sig', 'dimensions', '1.5', 'Cannot edit "sig": sig.Dimensions must hold positive whole numbers, or be -1: MATLAB refuses 1.5.'],
  ['sig', 'initialValue', 'é', "Cannot edit \"sig\": sig.InitialValue would be 'é', which MATLAB would load as '': its InitialValue takes only ASCII text."],
  ['sig', 'samplingMode', 'Frame', "Cannot edit \"sig\": sig.SamplingMode must be one of 'auto', 'Sample based', 'Frame based', spelled so: MATLAB refuses or re-spells 'Frame'."],
  ['sig', 'DataType', 'uint8', "Cannot edit \"sig\": sig.Min (-5) would be outside the range [0, 255] of its DataType 'uint8', which MATLAB loads with a warning on every load."],
  ['pProps', 'DataType', 'Bus: MyBus', "Cannot edit \"pProps\": pProps.DataType 'Bus: MyBus' over a Value of class double: MATLAB warns that the two are inconsistent, on every load."],
  ['pInt8', 'DataType', 'int16', 'Cannot edit "pInt8": pInt8.DataType follows its Value, of class int8: set to another, MATLAB converts the Value to double, with a warning on every load.'],
  ['bus.e1', 'DataType', 'auto', "Cannot edit \"bus\": bus.Elements(1).DataType cannot be 'auto': MATLAB refuses it, and the file would load it as the default."],
  ['bus.e1', 'dimensions', '-1', 'Cannot edit "bus": bus.Elements(1).Dimensions must hold positive whole numbers: MATLAB refuses -1.'],
  ['numType', 'bias', '1', "Cannot edit \"numType\": numType.Bias is set only in slope and bias scaling: MATLAB keeps a binary point type's 0."],
];

describe("a dictionary's objects offer the property editors a MAT-file's objects offer", () => {
  it('on every object of the fixtures, the same keys in every format', () => {
    const paths = opened(ALL[0]).root.flatten().filter((n: any) => /^Simulink\./.test(n.className) && !n.isContainer).map((n: any) => n.matlabPath);
    expect(paths.length).toBeGreaterThanOrEqual(12);
    for (const path of paths) {
      const each = ALL.map((file) => [file, editable(opened(file).at(path))] as const);
      for (const [file, keys] of each) {
        expect(keys, file + ' ' + path).toEqual(each[0][1]);
      }
    }
  });
});

describe('a property edit of an object in a dictionary', () => {
  for (const file of DICTIONARIES) {
    it(`${file}: taken, shown, saved and reopened as shown; undone, shown as it was`, () => {
      for (const [path, key, text] of EDITS) {
        const label = file + ' ' + path + '.' + key + ' = ' + text;
        const o = opened(file);
        const before = shown(o.at(path));
        // Every key of its bag a plan writes, put back by the undo, an added one removed: a
        // NumericType's mode changes its WordLength and FixedExponent with it.
        const bag = JSON.stringify(o.at(path).serial._properties);
        expect(o.edit(path, key, text), label).toBe(true);
        const after = shown(o.at(path));
        expect(after, path + '.' + key).not.toEqual(before);
        expect(shown(opened(file, o.save()).at(path)), label + ', reopened').toEqual(after);
        o.undo();
        expect(shown(o.at(path)), label + ', undone').toEqual(before);
        expect(JSON.stringify(o.at(path).serial._properties), label + ', undone: its bag').toBe(bag);
        o.redo();
        expect(shown(o.at(path)), label + ', redone').toEqual(after);
      }
    });

    it(`${file}: a second edit after a save and a reopen`, () => {
      const o = opened(file);
      expect(o.edit('sig', 'dimensions', '[2 3]')).toBe(true);
      const again = opened(file, o.save());
      expect(again.edit('sig', 'sampleTime', '0.5')).toBe(true);
      const back = opened(file, again.save()).at('sig');
      expect([shown(back).dimensions, shown(back)['PI:sampleTime']]).toEqual(['[2 3]', '0.5']);
    });
  }

  it("writes what MATLAB's setter changes with an edit: a NumericType set to Single is 32 bits, unscaled", () => {
    for (const file of DICTIONARIES) {
      const o = opened(file);
      expect(o.edit('numType', 'dataTypeMode', 'Single'), file).toBe(true);
      const props = o.at('numType').serial._properties;
      expect([props.DataTypeMode, props.WordLength, props.FixedExponent], file).toEqual(['Single', 32, 0]);
    }
  });

  it('is refused where MATLAB refuses it, or loads it otherwise, in the same words in every format, and nothing changes', () => {
    for (const file of ALL) {
      for (const [path, key, text, reason] of REFUSED) {
        const o = opened(file);
        const before = shown(o.at(path));
        const r: any = o.edit(path, key, text);
        expect(r?.reason, file + ' ' + path + '.' + key + ' = ' + text).toBe(reason);
        expect(shown(o.at(path)), file + ' ' + path + '.' + key).toEqual(before);
      }
    }
  });
});

describe("a ValueType's and an AliasType's properties in a dictionary", () => {
  // MATLAB R2027a's parity dictionaries (test/parity/artifacts), text and binary.
  const params = (dir: string) => new Uint8Array(readFileSync(new URL('./parity/artifacts/' + dir + '/params.sldd', import.meta.url)));
  for (const dir of ['text', 'binary']) {
    it(`${dir}: taken, saved and reopened as shown, and refused where MATLAB refuses them`, () => {
      const file = dir === 'text' ? 'params_text.sldd' : 'params.sldd';
      for (const [path, key, text] of [['MyValueType', 'DataType', 'int8'], ['MyValueType', 'Unit', 'm'], ['MyValueType', 'dimensions', '[2 2]'], ['MyAlias', 'headerFile', 'al.h'], ['MyAlias', 'dataScope', 'Exported']]) {
        const o = opened(file, params(dir));
        expect(o.edit(path, key, text), dir + ' ' + path + '.' + key).toBe(true);
        expect(shown(opened(file, o.save()).at(path)), dir + ' ' + path + '.' + key + ', reopened').toEqual(shown(o.at(path)));
      }
      expect((opened(file, params(dir)).edit('MyValueType', 'DataType', 'auto') as any)?.reason).toBe(
        "Cannot edit \"MyValueType\": MyValueType.DataType cannot be 'auto': MATLAB refuses it, and the file would load it as the default.",
      );
      expect((opened(file, params(dir)).edit('MyAlias', 'headerFile', 'bé.h') as any)?.reason).toBe(
        "Cannot edit \"MyAlias\": MyAlias.HeaderFile would be 'bé.h', which MATLAB refuses: it takes ASCII characters only.",
      );
    });
  }
});
