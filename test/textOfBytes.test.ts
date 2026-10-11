// Copyright 2026 The MathWorks, Inc.
//
// The two writers of a MAT stream as text: hexText, a binary dictionary's hex element, and
// uuencode, a text dictionary's cdata. Each is pinned to MATLAB's own text, character for
// character, on every value of the kind in the fixtures. What each costs is held to the
// stream's text once in a file of its own, test/hexTextCost.test.ts and
// test/uuencodeCost.test.ts, so that the peak RSS is that case's. Built a character at a
// time with `+=`, the hex of a stream cost about 45 bytes of heap per byte of it: 2.2 GB for
// 32 MB, which is what made an 88 MB stream a fatal out-of-memory no caller could catch.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { hexText, matStreamPrefix } from '../src/datamodel/parser/EncodedValue.js';
import { isMatCdata, uudecode, uuencode } from '../src/datamodel/parser/CdataCodec.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

function slddFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return slddFiles(path);
    return name.endsWith('.sldd') ? [path] : [];
  });
}
const files = slddFiles(FIXTURES).map((path) => ({ name: path.slice(FIXTURES.length), bytes: new Uint8Array(readFileSync(path)) }));
const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b;

/** Every hex element in the binary fixtures: its text as MATLAB wrote it, and its indent level. */
const hexValues = files.filter((f) => isZip(f.bytes)).flatMap((f) =>
  Object.entries(unzipSync(f.bytes))
    .filter(([part]) => part.endsWith('.xml'))
    .flatMap(([part, data]) =>
      [...strFromU8(data).matchAll(/\n( *)<(\w+) [^>]*Encoding="hex"[^>]*>([^<]*)<\/\2>/g)].map((m) => ({
        where: `${f.name} ${part}`,
        indent: m[1].length / 4,
        text: m[3],
      })),
    ),
);

/** Every MAT stream in the text fixtures, as the cdata MATLAB wrote it. */
function cdataIn(x: unknown, out: string[]): string[] {
  if (Array.isArray(x)) {
    x.forEach((y) => cdataIn(y, out));
  } else if (x && typeof x === 'object') {
    if (isMatCdata(x)) out.push((x as { _value: string })._value);
    Object.values(x).forEach((y) => cdataIn(y, out));
  }
  return out;
}
const cdataValues = files.filter((f) => !isZip(f.bytes)).flatMap((f) => cdataIn(JSON.parse(strFromU8(f.bytes)), []).map((text) => ({ where: f.name, text })));

const bytesOfHex = (text: string) => Uint8Array.from(text.replace(/\s+/g, '').match(/../g) ?? [], (h) => parseInt(h, 16));

describe('MATLAB\'s own text, character for character', () => {
  it('hexText writes every hex value in the binary fixtures as MATLAB wrote it', () => {
    // MATLAB puts hex around a whole entry only, so every one is at an entry's indent.
    expect([hexValues.length >= 20, [...new Set(hexValues.map((h) => h.indent))]]).toEqual([true, [2]]);
    for (const h of hexValues) {
      expect(hexText(bytesOfHex(h.text), h.indent), h.where).toBe(h.text);
    }
  });

  it('uuencode writes every MAT stream in the text fixtures as MATLAB wrote it', () => {
    expect(cdataValues.length).toBeGreaterThanOrEqual(50);
    for (const c of cdataValues) {
      // uudecode reads the padding as bits too; the stream is what its element declares.
      const stream = matStreamPrefix(uudecode(c.text));
      expect(stream, c.where).not.toBeNull();
      expect(uuencode(stream!), c.where).toBe(c.text);
    }
  });

  it('and at every length, the last line and the padding included', () => {
    // A line holds 64 bytes, and four characters carry three of them.
    for (const n of [0, 1, 2, 3, 4, 63, 64, 65, 127, 128, 129, 1000]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff);
      const digits = Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
      const lines = digits.match(/.{1,128}/g) ?? [];
      expect(hexText(bytes, 3), `hex ${n}`).toBe(lines.map((l) => '\n' + ' '.repeat(20) + l).join(''));
      const text = uuencode(bytes);
      const dataChars = Math.ceil((n * 8) / 6);
      expect([text.length, text.slice(dataChars), uudecode(text).slice(0, n)], `uuencode ${n}`).toEqual([
        Math.ceil(dataChars / 4) * 4 + 1,
        '\0'.repeat(Math.ceil(dataChars / 4) * 4 + 1 - dataChars),
        bytes,
      ]);
    }
  });
});
