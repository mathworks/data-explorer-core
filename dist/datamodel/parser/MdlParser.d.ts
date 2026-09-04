import type { ParsedSlx } from './SlxParser.js';
/**
 * A `.mdl` parses to exactly the shape a `.slx` does. The alias exists so callers
 * can say what they opened without implying the result differs.
 */
export type ParsedMdl = ParsedSlx;
export declare function parseMdl(buffer: ArrayBuffer, filename: string): ParsedMdl;
//# sourceMappingURL=MdlParser.d.ts.map