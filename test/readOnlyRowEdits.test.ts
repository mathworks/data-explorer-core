// Copyright 2026 The MathWorks, Inc.
//
// A row a dictionary shows read-only that names nothing its node holds: a NumericType's
// WordLength, a Parameter's HeaderFile, every node's Kind and Class, a plain value's DataType.
// An edit of one answered true and wrote nothing: DataNode.setProperty's last resort made a field
// of the row's key on the node, which nothing reads. And it marked the entry edited all the same, so
// that it was written again from the node, which spelled some values otherwise: a complex int16 of
// a binary dictionary went as a double (its Class row typed over), a 1x0 Parameter array as [].
// Now refused, naming the row, and nothing changes.
//
// Swept over every row of every dictionary fixture on 2026-10-24 (94000 edits, one per row): the
// rows that took an edit lost 46773 that wrote nothing and 96 that took nothing typed and changed
// the value as above, and none that wrote what was typed; no row an edit was refused at took one.
// The read-only rows that do write what is typed (an object's DataType and Unit held in a cell, a
// LookupTable's StorageClass) still take it, as do the rows shown editable.
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { bufferOf, fixture, rowsOf, sameBytes } from './tools/matPaste.js';

type Any = any;

function opened(path: string) {
  const session = createSession();
  const root: Any = ingest(session, bufferOf(fixture(path)), { filename: path.split('/').pop()! });
  const at = (name: string): Any => (root.flatten() as Any[]).find((n) => n.name === name);
  const edit = (node: Any, key: string, text: string) => {
    session.setActive(root, node);
    return session.editProperty(node.id, key, text);
  };
  const save = (): Uint8Array => {
    const out: Any = session.serializeSource(root.name);
    return out.kind === 'text' ? new TextEncoder().encode(out.text) : new Uint8Array(out.bytes);
  };
  return { session, root, at, edit, save };
}

/** Every row the node shows, by key: its columns and its Property Inspector's rows. */
function rowProps(node: Any): Any[] {
  const seen = new Set<string>();
  return [...node.getProperties(), ...(node.getPILayout() ?? []).flatMap((g: Any) => g.items)].filter((p: Any) => p && !seen.has(p.key) && seen.add(p.key));
}

/** A text other than `shown` that a row of its kind would take. */
function typedOver(shown: string, options?: string[]): string {
  if (options && options.length > 0) {
    return options.find((o) => o !== shown) ?? 'zz';
  }
  if (shown === 'true' || shown === 'false') {
    return shown === 'true' ? 'false' : 'true';
  }
  if (/^-?\d/.test(shown)) {
    return shown === '7' ? '8' : '7';
  }
  return shown === 'zz' ? 'zzz' : 'zz';
}

describe('an edit of a row shown read-only that names nothing its node holds', () => {
  it("is refused naming the row, and the dictionary is as it was: a NumericType's WordLength", () => {
    for (const file of ['test/parity/artifacts/text/params.sldd', 'test/parity/artifacts/binary/params.sldd']) {
      const { root, at, edit, save } = opened(file);
      const before = save();
      const node = at('MyNumType');
      expect(edit(node, 'wordLength', '8'), file).toEqual({
        error: true,
        reason: 'Cannot edit "MyNumType": the Word Length of MyNumType is read-only here.',
        invalidValue: '8',
        validValue: '16',
      });
      expect([root.dirty, rowsOf(node).find((r: string) => r.startsWith('wordLength'))], file).toEqual([false, 'wordLength = 16']);
      expect(sameBytes(save(), before), file).toBe(true);
    }
  });

  it('and its Kind and Class, and a plain value whose re-spelling turned an int16 into a double', () => {
    const { root, at, edit } = opened('test/fixtures/display/dispcat_bin.sldd');
    const node = at('z_int16');
    const rows = rowsOf(node);
    for (const [key, label] of [['Kind', 'Kind'], ['Class', 'Class'], ['DataType', 'Data Type']]) {
      const r = edit(node, key, 'zz') as Any;
      expect([r.error, r.reason], key).toEqual([true, 'Cannot edit "z_int16": the ' + label + ' of z_int16 is read-only here.']);
    }
    expect([rowsOf(node), root.dirty]).toEqual([rows, false]);
    expect(rows).toContain('Class = int16 (complex)');
  });

  it('is refused, and answers, where the row cannot be read', () => {
    const { at } = opened('test/parity/artifacts/text/params.sldd');
    const node = at('MyNumType');
    const read = node.getPropInfo.bind(node);
    node.getPropInfo = (prop: Any) => {
      if (prop.key === 'wordLength') throw new Error('unreadable row');
      return read(prop);
    };
    expect(node.setProperty('wordLength', '8')).toEqual({
      error: true,
      reason: 'Cannot edit "MyNumType": the Word Length of MyNumType is read-only here.',
      invalidValue: '8',
      validValue: '',
    });
  });

  it('is taken as no edit where the text is what the row shows, as every row is', () => {
    const { root, at, edit } = opened('test/parity/artifacts/text/params.sldd');
    expect(edit(at('MyNumType'), 'wordLength', '16')).toBe(true);
    expect(root.dirty).toBe(false);
  });
});

describe('a row that takes an edit', () => {
  it('still takes one where it is shown editable, or where it is shown read-only and writes what is typed', () => {
    // An editable row of the schema (a Signal's Complexity) and one of the node (a Description).
    const signal = opened('test/fixtures/classes_r2027a_binary.sldd');
    const sig = signal.at('sigA');
    expect(signal.edit(sig, 'complexity', 'complex')).toBe(true);
    expect(signal.edit(sig, 'Description', 'zz')).toBe(true);
    // A LookupTable's StorageClass, shown read-only and written all the same, as before.
    const lut = signal.at('lutD');
    expect(signal.edit(lut, 'storageClass', 'ExportedGlobal')).toBe(true);
    expect(rowsOf(lut)).toContain('storageClass = ExportedGlobal');
  });
});

function slddUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...slddUnder(p));
    else if (e.name.endsWith('.sldd')) out.push(p);
  }
  return out.sort();
}

describe('every row a dictionary fixture shows read-only', () => {
  it('refuses an edit, or takes one and shows what was typed', { timeout: 600_000 }, () => {
    let asked = 0;
    const silent: string[] = [];
    for (const file of slddUnder('test')) {
      let o: ReturnType<typeof opened>;
      try {
        o = opened(file);
      } catch {
        continue;
      }
      for (const node of (o.root.flatten() as Any[]).filter((n) => n.parent && n.parent !== o.root)) {
        for (const prop of rowProps(node)) {
          let info: Any;
          try {
            info = node.getPropInfo(prop);
          } catch {
            continue;
          }
          if (info.editable) continue;
          const shown = String(info.displayValue ?? '');
          const typed = typedOver(shown, info.options);
          asked++;
          const before = JSON.stringify(rowsOf(node));
          if (o.edit(node, prop.key, typed) !== true) continue;
          // Taken: then what the node shows is not what it showed, and the edit is undone for the next row.
          if (JSON.stringify(rowsOf(node)) === before) silent.push(file + ' ' + node.matlabPath + '.' + prop.key);
          o.session.undo();
        }
      }
    }
    expect(silent).toEqual([]);
    // What the sweep met: that many read-only rows asked (79000 when this was written).
    expect(asked).toBeGreaterThan(70_000);
  });
});
