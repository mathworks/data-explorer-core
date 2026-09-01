// Copyright 2026 The MathWorks, Inc.

// Parser for .mxarray binary format (model workspace).
// Uses the same parseMatrix logic as MatParser for full variable data.

import { parseMatrix } from './MatParser.js';
import type { MatVariable } from './MatParser.js';

const MXARRAY_MAGIC = [0x00, 0x01, 0x49, 0x4D]; // \x00\x01IM
const MI_MATRIX = 14;

// A little-endian uint32. The `>>> 0` is load-bearing, not decoration: `<< 24`
// yields a SIGNED 32-bit result, so any length with the high bit set read as a
// negative number. A corrupt or malicious trailing length of 0xfffffff8 then read
// as -8, which made `offset += 8 + size` advance by zero — the scan loop below span
// forever pushing empty views until the heap died, taking the extension host with
// it. Unsigned, that length is simply larger than the file and the loop's own
// clamp-and-stop handles it.
function ru32(buf: Uint8Array, offset: number): number {
    return (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) >>> 0;
}

/**
 * Parse an .mxarray buffer and extract workspace variables.
 * Returns an array of variable objects (same shape as MatParser's parseMatrix output).
 * Each variable may have _rawBytes for pass-through serialization.
 * The returned array also has a `_trailingElements` property containing any
 * additional data elements (MCOS metadata) that must be preserved on round-trip.
 */
export function parseMxArray(buffer: ArrayBuffer): MatVariable[] & { _trailingElements: Uint8Array[] } {
    const buf = new Uint8Array(buffer);
    const result: MatVariable[] & { _trailingElements: Uint8Array[] } = [] as unknown as MatVariable[] & { _trailingElements: Uint8Array[] };
    result._trailingElements = [];

    if (buf.length < 16) { return result; }

    // Verify magic: 00 01 49 4D
    if (buf[0] !== MXARRAY_MAGIC[0] || buf[1] !== MXARRAY_MAGIC[1] ||
        buf[2] !== MXARRAY_MAGIC[2] || buf[3] !== MXARRAY_MAGIC[3]) {
        return result;
    }

    // First record starts at offset 8: outer MI_MATRIX containing all variables.
    // outerSize is self-declared, so clamp it to the bytes present — a truncated
    // file would otherwise send parseMatrix reading past the end of the buffer.
    const outerTag = ru32(buf, 8);
    const outerSize = Math.min(ru32(buf, 12), buf.length - 16);
    if (outerTag !== MI_MATRIX || outerSize <= 0) { return result; }

    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

    // Parse the outer struct — it's a struct whose fields are the workspace variables
    const outer = parseMatrix(view, 16, outerSize);
    if (!outer || !outer.fields) { return result; }

    for (const [name, fieldVar] of Object.entries(outer.fields)) {
        const variable = (Array.isArray(fieldVar) ? fieldVar[0] : fieldVar) as MatVariable;
        variable.name = name;
        result.push(variable);
    }

    // Capture any trailing elements (MCOS metadata for opaque objects). `size` is
    // self-declared, so a truncated file can name more bytes than remain — taking
    // it on trust made the Uint8Array constructor throw a RangeError out of the
    // parser, which no caller catches. Keep whatever bytes are actually there so
    // the variables already parsed above still open, and stop: past a bad length
    // there is no way to find the next tag.
    let offset = 8 + 8 + outerSize;
    while (offset + 8 <= buf.length) {
        const tag = ru32(buf, offset);
        const size = ru32(buf, offset + 4);
        if (tag === 0 && size === 0) { break; }
        const available = buf.length - offset;
        const take = Math.min(8 + size, available);
        result._trailingElements.push(new Uint8Array(buf.buffer, buf.byteOffset + offset, take));
        if (take < 8 + size) { break; }
        offset += 8 + size;
    }

    return result;
}
