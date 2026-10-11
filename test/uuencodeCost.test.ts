// Copyright 2026 The MathWorks, Inc.
//
// What uuencode costs: the stream's text once (test/textOfBytes.test.ts pins the text
// itself). The cost is memory, so memory is what is measured: how far writing the cdata of a
// 16 MB stream raises the peak RSS of a process holding nothing else. Built a string per
// character and joined, it raised it by 679 MB, about 32 bytes a character of the text; built
// in one buffer of character codes and read as text once, by 43 MB, two bytes a character,
// the buffer and the text. Held to three times that. Its own file, so that the peak is this
// case's (test/tools/pasteVenues.ts). The time is a backstop: 0.8 s against 150 ms here.
import { it, expect } from 'vitest';
import { uuencode } from '../src/datamodel/parser/CdataCodec.js';
import { peakMB, timed } from './tools/pasteVenues.js';

// The backstop below is past vitest's 5 s default.
const HEAVY_TIMEOUT = 60_000;

it('the cdata of a 16 MB stream costs two bytes a character of it, the buffer and the text', { timeout: HEAVY_TIMEOUT }, () => {
  const stream = Uint8Array.from({ length: 16 * 1024 * 1024 }, (_, i) => (i * 131) & 0xff);
  const before = peakMB();
  const [text, ms] = timed(() => uuencode(stream));
  expect(text.length).toBe(Math.ceil(Math.ceil((stream.length * 8) / 6) / 4) * 4 + 1);
  expect(peakMB() - before).toBeLessThan((3 * 2 * text.length) / 1048576);
  expect(ms).toBeLessThan(5000);
});
