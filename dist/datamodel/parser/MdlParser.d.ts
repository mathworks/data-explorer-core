import type { ParsedSlx } from './SlxParser.js';
/**
 * A `.mdl` parses to exactly the shape a `.slx` does. The alias exists so callers
 * can say what they opened without implying the result differs.
 */
export type ParsedMdl = ParsedSlx;
export declare function parseMdl(buffer: ArrayBuffer, filename: string): ParsedMdl;
/**
 * A mask style with its options cut off, `popup(a|b)` to `popup`, exactly as
 * `style.replace(/\(.*$/, '')` cut them, on every input.
 *
 * With no `m` flag `$` is the end of the text, and `.` passes no line terminator (`\n`,
 * `\r`, U+2028, U+2029), so the regex cut at the first `(` that no line terminator
 * follows. It found that `(` by trying each in turn, and each try walked to the next
 * line terminator before it failed, so a style of many `(` ahead of one cost their count
 * times that walk. The scanner keeps a line break inside a quoted value and unescapes
 * `\n` and `\r`, so a file puts one wherever it likes. The `(` the regex cut at is the
 * first after the last line terminator, which five scans of the text find.
 */
export declare function styleWithoutOptions(style: string): string;
//# sourceMappingURL=MdlParser.d.ts.map