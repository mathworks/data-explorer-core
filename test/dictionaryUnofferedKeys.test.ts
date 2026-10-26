// Copyright 2026 The MathWorks, Inc.
//
// In a dictionary, an edit of a key no row of the node takes an edit of is refused, naming the row
// and the property, and changes nothing (DataNode._unofferedKeyRefusal). The tail of
// DataNode.setProperty wrote any key as a field of the node and answered as if the edit were
// taken: a Simulink.Parameter took `Bogus` and `StorageClass`, which the save wrote nowhere, and
// marked its entry Modified; it took `Dimensions` and `Complexity`, which MATLAB refuses on a
// Parameter unless they are its Value's (Simulink:Data:UDDData_CannotSetCustomDimensions,
// UDDData_CannotSetComplexity, R2027a); it saved a `DataType` of 'notAType!' and a `Unit`, both
// shown as labels in a dictionary; and `dataType` threw. A MAT-file refused each, naming
// `<path>.<Property>`, and a dictionary now says it the same way.
//
// Over every dictionary fixture, every row: each key its row offers (the table's editable cells,
// the Property Inspector's editable rows) passes the gate, and each the table shows read-only, and
// one it has no row of, is refused, and the file is not marked edited. Not inside a MAT stream
// holding objects, whose own gate answers for every key (test/slddStreamObjects.test.ts).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { inMcosStream } from '../src/datamodel/node/BaseNode.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Any = any;

const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

function slddUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...slddUnder(p));
    else if (e.name.endsWith('.sldd')) out.push(p);
  }
  return out.sort();
}

function opened(file: string) {
  const session = createSession();
  const root: Any = ingest(session, ab(new Uint8Array(readFileSync(file))), { filename: file.split('/').pop() });
  const save = (): string => {
    const out: Any = session.serializeSource(root.name);
    return out.kind === 'text' ? out.text : Buffer.from(out.bytes).toString('base64');
  };
  const edit = (node: Any, key: string, text: string) => {
    session.setActive(root, node);
    return session.editProperty(node.id, key, text);
  };
  return { session, root, save, edit };
}

const nodeAt = (root: Any, path: string): Any => (root.flatten() as Any[]).find((n) => n.matlabPath === path && !n.isContainer);

describe('a key a dictionary row does not offer', () => {
  // The parity fixtures' pInt8, Simulink.Parameter(int8([1 2 3])), sig and numType, in both
  // dictionary formats: the session's edit of each refused, as MAT-file's save says it.
  const REFUSED: [string, string, string, string][] = [
    ['pInt8', 'Dimensions', '[3 1]', 'pInt8.Dimensions follows its Value, and is written only with it.'],
    ['pInt8', 'dimensions', '[1 4]', 'pInt8.Dimensions follows its Value, and is written only with it.'],
    ['pInt8', 'Complexity', 'complex', 'pInt8.Complexity follows its Value, and is written only with it.'],
    ['pInt8', 'complexity', 'complex', 'pInt8.Complexity follows its Value, and is written only with it.'],
    ['pInt8', 'Bogus', 'x', 'pInt8.Bogus is not one this editor writes into a Simulink.Parameter.'],
    ['pInt8', 'StorageClass', 'ExportedGlobal', 'pInt8.StorageClass is not one this editor writes into a Simulink.Parameter.'],
    ['pInt8', 'dataType', 'single', 'pInt8.dataType is not one this editor writes into a Simulink.Parameter.'],
    ['pInt8', 'DocUnits', 'm', 'pInt8.DocUnits is not one this editor writes into a Simulink.Parameter.'],
    ['pInt8', 'DataType', 'notAType!', 'the Data Type of pInt8 is read-only here.'],
    ['pInt8', 'DataType', 'single', 'the Data Type of pInt8 is read-only here.'],
    ['pInt8', 'Unit', 'm', 'the Unit of pInt8 is read-only here.'],
    ['sig', 'DataType', 'single', 'the Data Type of sig is read-only here.'],
    ['sig', 'Bogus', 'x', 'sig.Bogus is not one this editor writes into a Simulink.Signal.'],
    ['sig', 'InitialValue', '1', 'sig.InitialValue is not one this editor writes into a Simulink.Signal.'],
    ['bus', 'Bogus', 'x', 'bus.Bogus is not one this editor writes into a Simulink.Bus.'],
    ['numType', 'WordLength', '8', 'numType.WordLength is not one this editor writes into a Simulink.NumericType.'],
  ];
  for (const file of ['test/fixtures/edit-bash/r2027a/values_text.sldd', 'test/fixtures/edit-bash/r2027a/values_binary.sldd', 'test/fixtures/edit-bash/r2023b/values_binary.sldd']) {
    it(`${file.split('/').slice(-2).join('/')}: is refused, naming the row and the property, and nothing is written`, () => {
      const o = opened(file);
      const saved = o.save();
      for (const [path, key, text, why] of REFUSED) {
        const node = nodeAt(o.root, path);
        const r: Any = o.edit(node, key, text);
        expect(r, path + '.' + key).toMatchObject({ error: true, reason: `Cannot edit "${path.split('.')[0]}": ${why}` });
        expect([node.status, o.root.dirty, o.session.canUndo()], path + '.' + key).toEqual(['', false, false]);
      }
      expect(o.save()).toBe(saved);
    });
  }

  it('an offered key of the same rows is still taken and saved', () => {
    for (const file of ['test/fixtures/edit-bash/r2027a/values_text.sldd', 'test/fixtures/edit-bash/r2027a/values_binary.sldd']) {
      const o = opened(file);
      for (const [path, key, text] of [['pInt8', 'storageClass', 'ExportedGlobal'], ['pInt8', 'Min', '0'], ['pInt8', 'Description', 'gain'], ['sig', 'complexity', 'complex']]) {
        expect(o.edit(nodeAt(o.root, path), key, text), file + ' ' + path + '.' + key).toBe(true);
      }
      const back = opened(file);
      // The saved file, read again.
      const s = createSession();
      const out: Any = o.session.serializeSource(o.root.name);
      const root: Any = ingest(s, ab(out.kind === 'text' ? new TextEncoder().encode(out.text) : out.bytes), { filename: file.split('/').pop() });
      expect(nodeAt(root, 'pInt8').toRow().storageClass.text, file).toBe('ExportedGlobal');
      expect(nodeAt(root, 'pInt8').toRow().Description, file).toBe('gain');
      expect(nodeAt(root, 'sig').toRow().complexity.text, file).toBe('complex');
      expect(nodeAt(back.root, 'pInt8').toRow().storageClass.text, file).toBe('Auto');
    }
  });

  // The table's columns (the extension's), and the Description the table shows beside them.
  const COLUMNS = ['Name', 'Value', 'DataType', 'Kind', 'Class', 'dimensions', 'dimensionsMode', 'complexity', 'Min', 'Max', 'Unit', 'storageClass',
    'headerFile', 'alignment', 'definitionFile', 'preStatement', 'postStatement', 'qualifier', 'bankName', 'variantConditions', 'allChoicesCoderInfo',
    'activeChoiceCoderInfo', 'Description'];
  function offeredIn(row: Any, key: string): boolean {
    switch (key) {
      case 'Value':
        return row._valueEditable === true;
      case 'Name':
        return !!row.Name?.editable;
      case 'Description':
        return row._descriptionEditable === true;
      default:
        return !!(row[key] && typeof row[key] === 'object' && row[key].editable);
    }
  }

  it('over every dictionary fixture: each offered key passes the gate; each other is refused and marks nothing', () => {
    const wrong: string[] = [];
    let offered = 0;
    let refused = 0;
    for (const file of slddUnder('test')) {
      let o: ReturnType<typeof opened>;
      try {
        o = opened(file);
      } catch {
        continue;
      }
      for (const n of o.root.flatten() as Any[]) {
        // Inside a MAT stream holding objects, the stream answers for every key (test/slddStreamObjects.test.ts).
        if (n.isContainer || inMcosStream(n)) continue;
        const row = n.toRow();
        const label = file.split('/').slice(-2).join('/') + ' ' + n.matlabPath;
        // The Property Inspector's editable rows, and the table's.
        const keys = new Set<string>();
        for (const g of n.getPILayout() ?? []) for (const p of g.items) if (n.getPropInfo(p).editable) keys.add(p.key);
        for (const key of COLUMNS) if (key in row && offeredIn(row, key)) keys.add(key);
        for (const key of keys) {
          offered++;
          const r = typeof n._unofferedKeyRefusal === 'function' ? n._unofferedKeyRefusal(key, 'zz9') : null;
          if (r) wrong.push(label + '.' + key + ' is offered, and the gate refuses it: ' + r.reason);
        }
        // An AliasType's Data Type column shows its BaseType, which the Property Inspector edits.
        for (const key of [...COLUMNS.filter((k) => k in row && !keys.has(k) && !(k === 'DataType' && keys.has('BaseType'))), 'Bogus']) {
          const r = n.setProperty(key, 'zz9');
          if (r === true || o.root.dirty) wrong.push(label + '.' + key + ' is not offered, and ' + (r === true ? 'was taken' : 'marked the file edited'));
          else refused++;
        }
      }
    }
    expect(wrong).toEqual([]);
    // Measured when this was written: 18431 offered, 95770 refused, over 93 files.
    expect(offered).toBeGreaterThanOrEqual(18000);
    expect(refused).toBeGreaterThanOrEqual(90000);
  }, 300_000);
});
