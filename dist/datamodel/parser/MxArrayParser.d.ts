import type { MatVariable } from './MatParser.js';
/**
 * Parse an .mxarray buffer and extract workspace variables.
 * Returns an array of variable objects (same shape as MatParser's parseMatrix output).
 * Each variable may have _rawBytes for pass-through serialization.
 * The returned array also has a `_trailingElements` property containing any
 * additional data elements (MCOS metadata) that must be preserved on round-trip.
 */
export declare function parseMxArray(buffer: ArrayBuffer): MatVariable[] & {
    _trailingElements: Uint8Array[];
};
//# sourceMappingURL=MxArrayParser.d.ts.map