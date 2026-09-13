// Copyright 2026 The MathWorks, Inc.
//
// RowCellPool shares one instance per distinct cell value across a table's rows. A row set
// is mostly repetition — measured over a 128,111-row customer dictionary, 217,784 object
// cells hold 49,301 distinct values — and sharing takes it from 566 bytes per row to 314.
//
// Two properties have to hold, and they pull against each other:
//
//   The rows must be UNCHANGED in value. `session.rowsOf()` pools and the per-node
//   `toRow()` path does not, and usedByColumn.test.ts asserts those two agree exactly, so
//   that comparison is the widest test of this file. What is tested here is the part that
//   comparison cannot see: which cells end up as the SAME object.
//
//   Two cells that merely look alike must NOT be shared. The pool keys a cell by its
//   fields and their values, and a key collision would put one row's value on another
//   row — the only failure this file can cause, and the reason the key length-prefixes
//   every part instead of trusting a separator.
import { describe, it, expect } from 'vitest';
import BaseNode from '../src/datamodel/node/BaseNode.js';
import RowCellPool from '../src/datamodel/node/RowCellPool.js';
import type { PropClass, RowData } from '../src/datamodel/node/BaseNode.js';

// A node with one generic editable column, which is the cell shape toRow allocates most
// of: `{ text, editable, editor, options }`, fresh for every row.
function aligned(name: string, value: string): BaseNode {
  class Aligned extends BaseNode {
    getProperties(): PropClass[] {
      return [{ key: 'alignment', displayName: 'Alignment', editor: 'text', format: () => value } as PropClass];
    }
  }
  return new Aligned(name, null);
}

// A row carrying exactly the cells a test hands it. Rows are plain objects to the pool, so
// the keying rules can be exercised on shapes no node happens to build today.
function rowWith(id: string, cells: Record<string, unknown>): RowData {
  return { ID: id, parent: null, Status: '', ...cells } as unknown as RowData;
}

describe('RowCellPool', () => {
  it('gives two rows of the same value one cell object', () => {
    const pool = new RowCellPool();
    const a = aligned('a', '8').toRow(pool)!;
    const b = aligned('b', '8').toRow(pool)!;

    expect(a.alignment).toBe(b.alignment);
    // And the shared value is still the right one, in both.
    expect(a.alignment).toEqual({ text: '8', editable: true, editor: 'text', options: undefined });
    expect(b.alignment).toEqual({ text: '8', editable: true, editor: 'text', options: undefined });
  });

  it('leaves the rows themselves separate objects', () => {
    // Only cells are shared. Two rows sharing a row object would put every column of one
    // node onto the other, and the ID column is what makes that impossible to miss.
    const pool = new RowCellPool();
    const a = aligned('a', '8').toRow(pool)!;
    const b = aligned('b', '8').toRow(pool)!;
    expect(a).not.toBe(b);
    expect(a.ID).toBe('a');
    expect(b.ID).toBe('b');
  });

  it('keeps rows of DIFFERENT values apart', () => {
    const pool = new RowCellPool();
    const a = aligned('a', '8').toRow(pool)!;
    const b = aligned('b', '16').toRow(pool)!;
    expect(a.alignment).not.toBe(b.alignment);
    expect((a.alignment as { text: string }).text).toBe('8');
    expect((b.alignment as { text: string }).text).toBe('16');
  });

  it('changes nothing when the caller brings no pool', () => {
    // The unpooled path is what every existing consumer is on, so it must still allocate
    // per row: this is the assertion that the optimization is opt-in.
    const a = aligned('a', '8').toRow()!;
    const b = aligned('b', '8').toRow()!;
    expect(a.alignment).not.toBe(b.alignment);
    expect(a.alignment).toEqual(b.alignment);
  });

  it('projects exactly the values the unpooled path projects', () => {
    const nodes = [aligned('a', '8'), aligned('b', '8'), aligned('c', '16')];
    const pool = new RowCellPool();
    const pooled = nodes.map((n) => n.toRow(pool));
    const plain = nodes.map((n) => n.toRow());
    expect(pooled).toEqual(plain);
    // Not vacuous: something really was shared.
    expect(pooled[0]!.alignment).toBe(pooled[1]!.alignment);
  });

  it('shares a cell across two different columns', () => {
    // A cell carries no column identity, so a Min and a Max that read the same ARE the
    // same cell. Documented behaviour rather than an accident: it is where the empty
    // Min/Max pairs of tens of thousands of rows collapse to one object.
    const pool = new RowCellPool();
    const row = rowWith('r', { Min: { text: '', editable: true }, Max: { text: '', editable: true } });
    pool.share(row);
    expect(row.Min).toBe(row.Max);
  });

  it('does not share two cells that only spell alike', () => {
    // Concatenated without length prefixes, `a=x b=yz` and `a=xy b=z` are the same string.
    const pool = new RowCellPool();
    const one = rowWith('1', { c: { a: 'x', b: 'yz' } });
    const two = rowWith('2', { c: { a: 'xy', b: 'z' } });
    pool.share(one);
    pool.share(two);
    expect(one.c).not.toBe(two.c);
    expect(one.c).toEqual({ a: 'x', b: 'yz' });
    expect(two.c).toEqual({ a: 'xy', b: 'z' });
  });

  it('does not share two option lists that only join alike', () => {
    // A storage-class dropdown really does offer options with spaces in them, so joining
    // the list on a space is not enough to tell these apart.
    const pool = new RowCellPool();
    const one = rowWith('1', { c: { options: ['Exported Global', 'x'] } });
    const two = rowWith('2', { c: { options: ['Exported', 'Global x'] } });
    pool.share(one);
    pool.share(two);
    expect(one.c).not.toBe(two.c);
    expect(one.c).toEqual({ options: ['Exported Global', 'x'] });
    expect(two.c).toEqual({ options: ['Exported', 'Global x'] });
  });

  it('shares two option lists that really are the same', () => {
    const pool = new RowCellPool();
    const one = rowWith('1', { c: { options: ['real', 'complex'] } });
    const two = rowWith('2', { c: { options: ['real', 'complex'] } });
    pool.share(one);
    pool.share(two);
    expect(one.c).toBe(two.c);
  });

  it('tells a boolean field from the string that spells it', () => {
    const pool = new RowCellPool();
    const yes = rowWith('1', { c: { editable: true } });
    const spelled = rowWith('2', { c: { editable: 'true' } });
    pool.share(yes);
    pool.share(spelled);
    expect(yes.c).not.toBe(spelled.c);
    expect((yes.c as { editable: unknown }).editable).toBe(true);
    expect((spelled.c as { editable: unknown }).editable).toBe('true');
  });

  it('tells a missing field from one that is present and undefined', () => {
    const pool = new RowCellPool();
    const absent = rowWith('1', { c: { text: 'x' } });
    const present = rowWith('2', { c: { text: 'x', options: undefined } });
    pool.share(absent);
    pool.share(present);
    expect(absent.c).not.toBe(present.c);
  });

  it('leaves a shape it cannot key exactly as it found it', () => {
    // The UsedBy link list is an array of OBJECTS. Rather than key it, the pool declines:
    // an unshared cell costs memory, a wrongly shared one is wrong.
    const pool = new RowCellPool();
    const links = { links: [{ text: 'Ka', linkTarget: 'Ka@a.slx' }] };
    const one = rowWith('1', { UsedBy: links });
    const two = rowWith('2', { UsedBy: { links: [{ text: 'Ka', linkTarget: 'Ka@a.slx' }] } });
    pool.share(one);
    pool.share(two);
    expect(one.UsedBy).toBe(links);
    expect(one.UsedBy).not.toBe(two.UsedBy);
    expect(one.UsedBy).toEqual(two.UsedBy);
    // Declining to key it must not stop the pool sharing the rest of the row.
    expect(pool.size).toBeGreaterThan(0);
  });

  it('freezes a shared cell, so an in-place edit fails loudly', () => {
    // Sharing means two rows hold one cell. Nothing in either repo mutates a cell — the
    // consumer's row builder copies with `{ ...row.Name }` — and this is what makes the
    // day that changes a thrown error at the mutation instead of one row silently
    // painting its value onto another.
    const pool = new RowCellPool();
    const row = aligned('a', '8').toRow(pool)!;
    expect(Object.isFrozen(row.alignment)).toBe(true);
    expect(() => {
      (row.alignment as { text: string }).text = 'other';
    }).toThrow(TypeError);
    // The row itself is not frozen: a subclass rewrites a whole cell after super.toRow().
    expect(Object.isFrozen(row)).toBe(false);
  });

  it('shares nothing under the ID column', () => {
    // A node id is unique by construction, so pooling it would add one map entry per row
    // and share nothing. Invisible in the rows (two equal strings are already ===), so
    // the pool's own size is what shows it.
    const pool = new RowCellPool();
    pool.share(rowWith('some/unique/id', {}));
    // parent (null) is not poolable; Status ('') is one string; the ID is skipped.
    expect(pool.size).toBe(1);
  });

  it('is idempotent, so a subclass may share a row twice', () => {
    const pool = new RowCellPool();
    const row = aligned('a', '8').toRow(pool)!;
    const cell = row.alignment;
    const before = pool.size;
    pool.share(row);
    expect(row.alignment).toBe(cell);
    expect(pool.size).toBe(before);
  });
});
