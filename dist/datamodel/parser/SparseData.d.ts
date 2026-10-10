/**
 * The non-zeros of a sparse array: entry k is at 0-based (row[k], col[k]) and holds re[k]
 * (+ im[k]i). Sorted by column and, within a column, by row — the order MATLAB's display
 * lists them in, `(row,col) value` — with no (row, col) twice.
 *
 * `re` holds a logical array's values as 1 and a single array's as the doubles they are.
 * `im` is null for a real array and present for a complex one, every entry of it, so it IS
 * the array's complexity: a complex array whose every non-zero has been set to a real number
 * is still complex, as it is in MATLAB.
 *
 * As read, every entry is a non-zero (MATLAB's nnz rule: anything but 0 in either part, so
 * NaN stays and -0 goes). An edit can set one to zero, and it stays an entry — its element
 * row is still that entry's row — until the array is written, which keeps only the
 * non-zeros, or read again.
 *
 * `backedColumns` is how many columns what the array was read from backs: the column
 * starts its file's column index (jc) held, or, for a source with no index — a dense list,
 * this package's `sparse` literal — one column per element it holds. Never the dims alone:
 * a writer writes every column's start whatever the rows, so `Matrix(0,134217728)\n[]`,
 * credited the columns its header declared, was a 512 MB index from 52 characters, and a
 * dims word one corrupted byte turned from 2 columns to 2^31-1 was 8 GB. MatWriter refuses
 * an array that declares more columns than are backed, past the few any array has for free
 * (UNBACKED_COLUMNS_ALLOWED; sparseWriteRefusal), and the node layer offers it no editor. Absent, as on non-zeros a host builds itself, only the
 * entries back columns, one apiece (backedColumnsOf); a host that knows better says so here.
 */
export interface SparseData {
    row: Int32Array;
    col: Int32Array;
    re: Float64Array;
    im: Float64Array | null;
    backedColumns?: number;
}
/**
 * The most elements this package lays out densely for a sparse array: the writers' fallback,
 * for an array MatWriter cannot write as one (a class or a rank MATLAB never stores
 * sparse), spells every element, and past this many it has nothing to spell them with. A
 * million is the size the reader used to refuse a sparse array past, and the size a 1000x1000
 * is.
 */
export declare const MAX_DENSE_ELEMENTS = 1000000;
/** A sparse array of nothing but zeros, backed for `backedColumns` columns when known. */
export declare function emptySparse(complex: boolean, backedColumns?: number): SparseData;
/** An independent copy: an edit to one is not an edit to the other. */
export declare function cloneSparse(s: SparseData): SparseData;
/**
 * How many columns any sparse array may declare with nothing behind them. A column index is
 * cols + 1 words whatever the rows, so sparse(0, 5) — valid, and holding nothing — has six
 * that no element backs; up to this many are written for free, so such an array stays
 * sparse wherever it goes.
 *
 * Small, because it is free per ARRAY, and a value or a file can hold many arrays. Measured
 * on a cell of `Matrix(0,N)` literals pasted into a binary dictionary and saved: with a
 * million free columns, 25 of them (1.4 KB of text) took 15 s and 7.3 GB, and 50 ran the
 * process out of memory. With 256, 10000 of them (480 KB) take 1.5 s and 1 GB, against
 * 0.2 s and 260 MB for the same cell at 5 columns: the free columns cost a few times what
 * the arrays already cost, and no more.
 */
export declare const UNBACKED_COLUMNS_ALLOWED = 256;
/** The columns `s` is backed for: what its source recorded, or one per entry it holds. */
export declare function backedColumnsOf(s: SparseData): number;
/**
 * Why a sparse array's declared columns are more than what it was read from backs
 * (SparseData.backedColumns), or null when they are not — the reason a reader reports the
 * array as read short, phrased to follow its name.
 */
export declare function unbackedColumns(s: SparseData, dims: number[]): string | null;
/**
 * One complex element as the node layer holds it, `1+2i`, `3-4i`, `1NaNi`: each part
 * String()'d, and between them the imaginary part's own sign, or '+' when it is >= 0. The one
 * spelling of an element of a complex array read out of MAT bytes, full or sparse
 * (MatlabVariableNode._createFromMatNumeric), so the two show a value the same way.
 */
export declare function complexElement(re: number | string, im: number | string): string;
/** Entry k as the node layer holds an element: a number, or complexElement's text. */
export declare function sparseEntry(s: SparseData, k: number): number | string;
/**
 * Entry k set to `x`, an element in any of elementParts' forms — what an element row's edit
 * leaves in the row. A real array takes the real part alone: an element row of one takes
 * only a real number.
 */
export declare function setSparseEntry(s: SparseData, k: number, x: unknown): void;
/**
 * The non-zeros of a dense row-major element list — what a writer or a host that built a
 * variable by hand hands over, and the body of this package's own `sparse` literal. A
 * missing element is a zero.
 *
 * It costs what the list holds, whatever its dims declare: the elements present are visited
 * once and the non-zeros sorted into column-major order. A `Matrix(1000000,1000000)` literal
 * holding one element visited all 1e12 cells of its declared shape. The list backs one
 * column per element it holds, and no more than the array declares
 * (SparseData.backedColumns): a complete list of rows x cols elements backs every column
 * except when it has no rows, and then it backs none.
 */
export declare function sparseFromDense(rowMajor: unknown[], dims: number[], complex: boolean): SparseData;
/**
 * Every element, row-major, as the node layer holds a full array's: a number, or for a
 * complex array complexElement's text (`0+0i` for a zero). Null past MAX_DENSE_ELEMENTS.
 */
export declare function sparseToDense(s: SparseData, dims: number[]): (number | string)[] | null;
//# sourceMappingURL=SparseData.d.ts.map