import type { RowData } from './BaseNode.js';
/**
 * The pool for one materialization pass. Create one, pass it to every `toRow()` in the
 * pass, drop it when the rows are built.
 *
 * Not thread-shared and not re-entrancy-hostile: everything it touches is synchronous.
 */
export default class RowCellPool {
    private readonly texts;
    private readonly cells;
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
    share(row: RowData): RowData;
    /** Distinct values held, string and object cells together. For tests and probes. */
    get size(): number;
}
//# sourceMappingURL=RowCellPool.d.ts.map