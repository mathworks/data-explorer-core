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
 * dims word one corrupted byte turned from 2 columns to 2^31-1 was 8 GB. The rest of the
 * index, the columns past the backed ones, is written out of one budget per encode, shared
 * with every other array and container in it (MatWriter.UNBACKED_BYTES_BUDGET): an array
 * whose unbacked index alone is past it can never be written, so MatWriter refuses it
 * (sparseWriteRefusal) and the node layer offers it no editor. Absent, as on non-zeros a host
 * builds itself, the entries back columns, one apiece (backedColumnsOf), and the rest come
 * out of the budget like anyone's; a host that knows better says so here.
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
 * for an array MatWriter has no sparse storage for (a class or a rank MATLAB never stores
 * sparse), spells every element, and past this many it has nothing to spell them with. A
 * million is the size the reader used to refuse a sparse array past, and the size a 1000x1000
 * is. The zeros come out of the write's budget too (MatlabVariableNode._sparseFallback), so a
 * value of many such arrays is refused rather than a million zeros apiece. A value refused
 * for the budget never reaches it: that refusal is final (MatWriter.MatBudgetError).
 */
export declare const MAX_DENSE_ELEMENTS = 1000000;
/** A sparse array of nothing but zeros, backed for `backedColumns` columns when known. */
export declare function emptySparse(complex: boolean, backedColumns?: number): SparseData;
/** An independent copy: an edit to one is not an edit to the other. */
export declare function cloneSparse(s: SparseData): SparseData;
/** The columns `s` is backed for: what its source recorded, or one per entry it holds. */
export declare function backedColumnsOf(s: SparseData): number;
/**
 * Why a sparse array's declared columns are more than what it was read from backs
 * (SparseData.backedColumns), or null when they are not — the reason a reader reports the
 * array as read short, phrased to follow its name.
 */
export declare function unbackedColumns(s: SparseData, dims: number[]): string | null;
/**
 * One complex element as the node layer holds it, `1+2i`, `3-4i`, `1NaNi`, `1+Infi`:
 * XmlUtils.formatComplexNum's spelling, a -0 part's sign kept. The one spelling of an element
 * of a complex array read out of MAT bytes, full or sparse (MatlabVariableNode.
 * _createFromMatNumeric), so the two show a value the same way, and the same way a binary
 * dictionary's text shows it.
 * Through 1.40.0 each part was String()'d, so an infinite part read `Infinity`, which MATLAB
 * neither writes nor reads (`{1+Infinityi}` is "Unrecognized function or variable
 * 'Infinityi'", R2027a): a text dictionary's complex(1, Inf) showed `1+Infinityi` beside
 * its binary twin's `1+Infi`. parseComplexNum still reads that spelling back.
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
 * The first of `s`'s non-zeros that is not at a whole row and column, or -1. A host's need
 * not be Int32Arrays: a row of 0.5, or one that is no number, is at no element.
 */
export declare function sparseIndexFault(s: SparseData): number;
/**
 * Every element, row-major, as the node layer holds a full array's: a number, or for a
 * complex array complexElement's text (`0+0i` for a zero). Null past MAX_DENSE_ELEMENTS.
 * Refused for a non-zero at no element (sparseIndexFault), which the list would drop and
 * leave a zero where it was.
 */
export declare function sparseToDense(s: SparseData, dims: number[]): (number | string)[] | null;
//# sourceMappingURL=SparseData.d.ts.map