import { parseMatrix } from './MatParser.js';
import type { MatVariable } from './MatParser.js';
/**
 * The record framing of an mxarray stream: the one outer MI_MATRIX, plus whatever
 * data elements follow it (MCOS metadata for opaque objects).
 *
 * Split out from `parseMxArray` because a `.slx` and a `.mdl` disagree on what the
 * outer matrix CONTAINS while agreeing on the framing around it. In a `.slx`'s
 * `simulink/modelWorkspace.mxarray` the outer matrix is a struct whose fields are
 * the workspace variables; in a classic `.mdl`'s uuencoded `MatData` record it is
 * a 1xN struct ARRAY of Name/Value pairs. Only the interpretation differs, so only
 * that part lives in the callers — see MdlParser.
 */
export declare function readMxArrayRecords(buffer: ArrayBufferLike): {
    outer: ReturnType<typeof parseMatrix> | null;
    trailingElements: Uint8Array[];
};
/**
 * Parse an .mxarray buffer and extract workspace variables.
 * Returns an array of variable objects (same shape as MatParser's parseMatrix output).
 * Each variable may have _rawBytes for pass-through serialization.
 * The returned array also has a `_trailingElements` property containing any
 * additional data elements (MCOS metadata) that must be preserved on round-trip.
 */
export declare function parseMxArray(buffer: ArrayBufferLike): MatVariable[] & {
    _trailingElements: Uint8Array[];
};
//# sourceMappingURL=MxArrayParser.d.ts.map