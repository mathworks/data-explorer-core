// Copyright 2026 The MathWorks, Inc.
//
// MATLAB subscript labels for array element rows, in ONE place. Three call
// sites used to carry their own copy of this formula:
//
//   BaseNode.displayName   numeric elements                  (row-major list)
//   BaseNode.displayName   cell / string elements            (column-major list)
//   ObjectNode.parse       object-array elements             (column-major list)
//   StructNode.parse       struct-array elements             (column-major list)
//
// All of them consulted dims[0] and dims[1] only, so every rank->=3 array emitted
// subscripts for elements that do not exist (A(4,3) in a two-row array), and the
// column-major sites additionally read their list as if it were row-major, which
// named 4 of the 6 elements of a 2x3 object array after the wrong object.
// Vectors hid it, because there the two orders coincide -- and every fixture the
// repo had was a vector or a square 2x2.
//
// Note the split inside displayName: ONLY numeric is row-major. MatParser
// transposes just its numeric branch (MatParser.ts:234); the cell branch (:317)
// keeps MATLAB's file order, which is column-major. Callers pass the order, so
// this file does not have to know -- but a caller that guesses gets it wrong for
// three of the four kinds. See test/cellElementOrder.test.ts.
import { effectiveDims } from './DisplayConvention.js';
// MATLAB's ind2sub, on a 0-based column-major linear index.
export function ind2sub(colMajorIndex, dims) {
    const d = effectiveDims(dims);
    const subs = [];
    let rest = colMajorIndex;
    for (let k = 0; k < d.length; k++) {
        subs.push((rest % d[k]) + 1);
        rest = Math.floor(rest / d[k]);
    }
    return subs;
}
// Where element `linearIndex` of a row-major-within-page list sits in MATLAB's
// own column-major order. This is the exact inverse of the reordering
// MatParser.transposeFromColMajor applies on the way in: per page, page order
// untouched.
export function toColumnMajorIndex(linearIndex, dims) {
    const rows = dims[0];
    const cols = dims[1];
    if (rows <= 1 || cols <= 1) {
        return linearIndex;
    }
    const page = rows * cols;
    const p = Math.floor(linearIndex / page);
    const within = linearIndex % page;
    const r = Math.floor(within / cols);
    const c = within % cols;
    return p * page + c * rows + r;
}
// `name(2,1)` / `name{1,2,2}` / `name(3)`.
//
// A vector takes the single linear subscript MATLAB itself uses, which is both
// correct and what the existing suite pins.
export function subscriptLabel(name, linearIndex, dims, order, bracket) {
    const d = effectiveDims(dims);
    const open = bracket === '{}' ? '{' : '(';
    const close = bracket === '{}' ? '}' : ')';
    const spread = d.filter(function (n) {
        return n > 1;
    }).length;
    if (spread <= 1) {
        return name + open + (linearIndex + 1) + close;
    }
    const colMajor = order === 'column-major' ? linearIndex : toColumnMajorIndex(linearIndex, d);
    return name + open + ind2sub(colMajor, d).join(',') + close;
}
//# sourceMappingURL=Subscript.js.map