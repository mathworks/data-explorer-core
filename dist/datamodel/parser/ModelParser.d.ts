import type { ParsedSlx } from './SlxParser.js';
/**
 * Is this a ZIP OPC package — i.e. a `.slx` rather than either `.mdl` spelling?
 *
 * Exported so that the structural scanner dispatches on the SAME test this file does.
 * Two copies of the magic bytes is two places for the answer to drift, and a scanner
 * that disagreed with `parseModel` about the format would route a file to a reader it
 * is not for.
 */
export declare function isZipPackage(bytes: Uint8Array): boolean;
/**
 * Open a Simulink model, whichever of its on-disk forms it is in.
 *
 * A `.slx` is a ZIP OPC package; a `.mdl` is the same package written as text, or
 * the classic pre-R2012 brace format. All three produce the same ParsedSlx.
 *
 * The BYTES decide, not the extension. Both extensions are in daily use for both
 * generations of content — `save_system` to `<name>.slx` beside a `<name>.mdl` is an
 * in-place format upgrade, models get renamed by hand, and a mislabelled file should
 * open rather than fail with "invalid zip data" from a parser it was never for. The
 * same reasoning already routes a textual vs. binary `.sldd` in `ingest`.
 */
export declare function parseModel(buffer: ArrayBuffer, filename: string): ParsedSlx;
//# sourceMappingURL=ModelParser.d.ts.map