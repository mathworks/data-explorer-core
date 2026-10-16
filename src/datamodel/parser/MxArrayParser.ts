// Copyright 2026 The MathWorks, Inc.

// Parser for .mxarray binary format (model workspace).
// Uses the same parseMatrix logic as MatParser for full variable data.

import { decodeMatStream } from './MatParser.js';
import type { MatVariable } from './MatParser.js';

/**
 * The record framing of an mxarray stream: the one outer MI_MATRIX, plus whatever
 * data elements follow it (MCOS metadata for opaque objects) — MatParser.decodeMatStream's
 * answer, with null for a stream it refuses.
 *
 * Split out from `parseMxArray` because a `.slx` and a `.mdl` disagree on what the
 * outer matrix CONTAINS while agreeing on the framing around it. In a `.slx`'s
 * `simulink/modelWorkspace.mxarray` the outer matrix is a struct whose fields are
 * the workspace variables; in a classic `.mdl`'s uuencoded `MatData` record it is
 * a 1xN struct ARRAY of Name/Value pairs. Only the interpretation differs, so only
 * that part lives in the callers — see MdlParser.
 */
export function readMxArrayRecords(buffer: ArrayBufferLike): {
    outer: MatVariable | null;
    trailingElements: Uint8Array[];
} {
    const stream = decodeMatStream(new Uint8Array(buffer));
    return stream.ok
        ? { outer: stream.variable, trailingElements: stream.trailingElements }
        : { outer: null, trailingElements: [] };
}

/**
 * Parse an .mxarray buffer and extract workspace variables.
 * Returns an array of variable objects (same shape as MatParser's parseMatrix output).
 * Each variable may have _rawBytes for pass-through serialization.
 * The returned array also has a `_trailingElements` property containing any
 * additional data elements (MCOS metadata) that must be preserved on round-trip.
 */
export function parseMxArray(buffer: ArrayBufferLike): MatVariable[] & { _trailingElements: Uint8Array[] } {
    const result: MatVariable[] & { _trailingElements: Uint8Array[] } = [] as unknown as MatVariable[] & { _trailingElements: Uint8Array[] };
    const { outer, trailingElements } = readMxArrayRecords(buffer);
    result._trailingElements = trailingElements;

    if (!outer || !outer.fields) { return result; }

    for (const [name, fieldVar] of Object.entries(outer.fields)) {
        // A field of a struct ARRAY is the list of its elements that were read, and the
        // list is empty when the stream ran out before any of them (MatParser keeps such
        // a field, so the array does not read as having none). Then there is no variable
        // to name. Skipped, the workspace is short of it. Named, the TypeError refused the
        // whole model, which the maintainer's ruling of 2026-10-16 on C-232 rules out: an
        // unreadable workspace part shows the Model Workspace section empty.
        const variable = (Array.isArray(fieldVar) ? fieldVar[0] : fieldVar) as MatVariable | undefined;
        if (!variable) { continue; }
        variable.name = name;
        result.push(variable);
    }

    return result;
}
