// Copyright 2026 The MathWorks, Inc.
//
// One shared instance per DISTINCT cell value across a table's rows.
//
// A row is mostly repetition. Measured over a 128,111-row customer dictionary, the rows
// hold 217,784 object cells with 49,301 distinct values, and 1,144,074 string cells with
// 148,534 distinct values — every one of them a separate allocation, because `toRow()`
// builds a fresh `{ text, editable, editor, options }` for each row and `format()` returns
// a fresh string each time it is asked. Sharing the duplicates takes the row set from
// 69.2 MB to 38.3 MB retained (566 → 314 bytes per row).
//
// The two halves are NOT the same kind of change, and the difference is why they are
// documented together here rather than treated as one trick:
//
//   Strings are immutable primitives. Two strings with the same characters are already
//   `===`, so replacing one with the other is unobservable — there is no aliasing to
//   reason about, only heap that stops being wasted.
//
//   Object cells are references. Sharing one means two rows hold the SAME cell, so a
//   caller that mutated a cell in place would now change another row too. Nothing in
//   either repo does (the consumer's row builder copies with `{ ...row.Name, … }` rather
//   than assigning into it), and the pooled cells are FROZEN so that the day something
//   starts to, it throws where it happens instead of silently painting one row's value
//   onto another.
//
// LIFETIME is the whole design. A pool belongs to ONE materialization pass and is then
// dropped: the rows keep the cells they were given, so the saving is permanent, while the
// index that found them is not. A pool held for a session's lifetime would instead retain
// ~198,000 map entries against a table nobody is looking at any more. This is the same
// bargain, for the same reason, that `DataModel.rowsOf` already strikes with its usage
// batch — "the map lives for this call and is then dropped" — and it is why this is a
// value a caller creates rather than ambient state a node reaches for.
import type { RowData } from './BaseNode.js';

// `ID` is the node's own path, unique by construction: pooling it would add one map entry
// per row and share nothing. Every other column repeats — `Status` was one distinct value
// across all 128,111 rows, `DataType` 276, `parent` 1,990.
const NEVER_POOLED = 'ID';

/**
 * The key a cell is shared under: its fields and their values, and nothing about which
 * column it came from — a `Min` cell and a `Max` cell that read the same ARE the same
 * cell, and the object carries no column identity for anyone to read back.
 *
 * Every part is length-prefixed, and so is every element of an array part. Without that, a
 * value holding the separator could spell another cell's key: joined on a space,
 * `['Exported Global', 'x']` and `['Exported', 'Global x']` are the same string of the same
 * length, and a storage-class dropdown really does offer options with spaces in them. The
 * failure mode of a key collision here is one row showing another row's value — the exact
 * class of bug this file must not introduce — so it is spelled out of existence rather
 * than argued to be unlikely.
 *
 * Returns null for a shape it cannot key — a nested object, an array of objects (the
 * `UsedBy` link list) — and such a cell is then left exactly as `toRow` built it. Refusing
 * is the safe direction: an unpooled cell costs memory, a wrongly pooled one is wrong.
 * Field ORDER is part of the key, so two cells with the same fields written in a different
 * order simply fail to merge, which costs the same nothing.
 */
function keyOf(cell: Record<string, unknown>): string | null {
  let key = '';
  for (const field of Object.keys(cell)) {
    const value = cell[field];
    let part: string;
    if (typeof value === 'string') {
      part = 's' + value;
    } else if (typeof value === 'boolean') {
      part = value ? 'b1' : 'b0';
    } else if (typeof value === 'number') {
      part = 'n' + value;
    } else if (value === undefined) {
      part = 'u';
    } else if (value === null) {
      part = 'z';
    } else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      part = 'a';
      for (const item of value as string[]) {
        part += item.length + ':' + item;
      }
    } else {
      return null;
    }
    key += field.length + ':' + field + ':' + part.length + ':' + part;
  }
  return key;
}

/**
 * The pool for one materialization pass. Create one, pass it to every `toRow()` in the
 * pass, drop it when the rows are built.
 *
 * Not thread-shared and not re-entrancy-hostile: everything it touches is synchronous.
 */
export default class RowCellPool {
  private readonly texts = new Map<string, string>();
  private readonly cells = new Map<string, object>();

  /**
   * Replace every cell of `row` with this pool's instance of the same value, adopting the
   * row's own cells for the values it has not seen. Returns the same row, mutated in
   * place — the row object is freshly built by `toRow` and owned by nobody else yet.
   *
   * Called on the FINISHED row rather than woven into `toRow`'s branches on purpose: the
   * pooled and unpooled paths then cannot produce different VALUES, because there is only
   * one path that produces values. The cost is that a duplicate cell is allocated before
   * it is discarded, which buys back nothing in peak memory but is garbage that dies in
   * the nursery.
   *
   * Idempotent, so a subclass that rewrites a cell after `super.toRow()` may share again.
   */
  share(row: RowData): RowData {
    const cells = row as Record<string, unknown>;
    for (const column of Object.keys(cells)) {
      if (column === NEVER_POOLED) {
        continue;
      }
      const value = cells[column];
      if (typeof value === 'string') {
        const seen = this.texts.get(value);
        if (seen === undefined) {
          this.texts.set(value, value);
        } else {
          cells[column] = seen;
        }
      } else if (value !== null && typeof value === 'object') {
        const key = keyOf(value as Record<string, unknown>);
        if (key === null) {
          continue;
        }
        const seen = this.cells.get(key);
        if (seen === undefined) {
          // Frozen, not copied: see the header. Shallow on purpose — a cell's `options`
          // array is the prop atom's own module-level constant, ALREADY shared by every
          // row that renders that dropdown, and freezing it from here would freeze
          // package state on behalf of a caller that only asked for rows.
          this.cells.set(key, Object.freeze(value));
        } else {
          cells[column] = seen;
        }
      }
    }
    return row;
  }

  /** Distinct values held, string and object cells together. For tests and probes. */
  get size(): number {
    return this.texts.size + this.cells.size;
  }
}
