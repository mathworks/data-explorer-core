// Copyright 2026 The MathWorks, Inc.
//
// What hexText costs: the stream's text once (test/textOfBytes.test.ts pins the text itself).
// The cost is memory, so memory is what is measured: how far writing the hex of a 16 MB
// stream raises the peak RSS of a process holding nothing else. Built a character at a time
// with `+=`, it raised it by 1,040 MB, about 29 bytes a character of the text; built in one
// buffer of character codes and read as text once, by 73 MB, two bytes a character, the
// buffer and the text. Held to three times that. Its own file, so that the peak is this
// case's (test/tools/pasteVenues.ts). The time is a backstop: 2.0 s against 70 ms here.
import { it, expect } from 'vitest';
import { hexText } from '../src/datamodel/parser/EncodedValue.js';
import { peakMB, timed } from './tools/pasteVenues.js';

// The backstop below is past vitest's 5 s default.
const HEAVY_TIMEOUT = 60_000;

it('the hex of a 16 MB stream costs two bytes a character of it, the buffer and the text', { timeout: HEAVY_TIMEOUT }, () => {
  const stream = Uint8Array.from({ length: 16 * 1024 * 1024 }, (_, i) => (i * 131) & 0xff);
  const before = peakMB();
  const [text, ms] = timed(() => hexText(stream, 2));
  expect(text.length).toBe(stream.length * 2 + (stream.length / 64) * 17);
  expect(peakMB() - before).toBeLessThan((3 * 2 * text.length) / 1048576);
  expect(ms).toBeLessThan(5000);
});
