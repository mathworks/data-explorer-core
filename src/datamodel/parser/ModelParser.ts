// Copyright 2026 The MathWorks, Inc.

import { parseSlx } from './SlxParser.js';
import type { ParsedSlx } from './SlxParser.js';
import { parseMdl } from './MdlParser.js';

// A zip local-file header: `PK\x03\x04`.
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

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
export function parseModel(buffer: ArrayBuffer, filename: string): ParsedSlx {
  const bytes = new Uint8Array(buffer);
  const isZip = ZIP_MAGIC.every((byte, i) => bytes[i] === byte);
  return isZip ? parseSlx(buffer, filename) : parseMdl(buffer, filename);
}
