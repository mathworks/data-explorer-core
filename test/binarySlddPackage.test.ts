// Copyright 2026 The MathWorks, Inc.
//
// A binary dictionary's package as vscode's binary editor holds it (src/datamodel/parser/
// BinarySlddPackage.ts, lifted from data-explorer-vscode's BinarySlddEditorProvider at c73da3c): read
// into the data part's text and the pass-through members, and zipped back up around the data part.
// What a save writes must be what vscode's own writeTo zips, member for member and byte for byte
// but each member's write time: fflate is 0.8.3 in both packages' lockfiles (same integrity).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { DATA_PART_XML, readBinarySlddPackage, writeBinarySlddPackage } from '../src/index.js';

// The binary originals P4 replays edits on (edit-bash r2027a and r2023b), and a third MATLAB wrote.
const ORIGINALS = [
  'test/fixtures/edit-bash/r2027a/values_binary.sldd',
  'test/fixtures/edit-bash/r2023b/values_binary.sldd',
  'test/parity/artifacts/binary/params.sldd',
];
const bytesOf = (path: string) => new Uint8Array(readFileSync(path));

// The members of a zip, in order: [name, bytes].
const membersOf = (zip: Uint8Array) => Object.entries(unzipSync(zip));

// A zip's bytes with every member's DOS write time and date zeroed (local file headers at +10,
// central directory headers at +12): what is left is the archive fflate wrote for those members.
function withoutWriteTimes(zip: Uint8Array): Uint8Array {
  const out = zip.slice();
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  for (let i = 0; i + 4 <= out.length; i++) {
    const sig = view.getUint32(i, true);
    if (sig === 0x04034b50 && i + 14 <= out.length) out.fill(0, i + 10, i + 14);
    if (sig === 0x02014b50 && i + 16 <= out.length) out.fill(0, i + 12, i + 16);
  }
  return out;
}

// vscode's writeTo, verbatim (BinarySlddEditorProvider.ts:1793-1795, c73da3c).
const vscodeWriteTo = (chunkXml: string, zipMeta: Record<string, Uint8Array>, mode: 'save' | 'backup') => {
  const parts: Record<string, Uint8Array> = { ...zipMeta };
  const zipEntries: Record<string, Uint8Array> = { ...parts, [DATA_PART_XML]: new TextEncoder().encode(chunkXml) };
  return zipSync(zipEntries, { level: mode === 'save' ? 6 : 1 });
};

describe('readBinarySlddPackage', () => {
  it('holds the data part as text and every other member as its bytes, in the archive order', () => {
    for (const path of ORIGINALS) {
      const bytes = bytesOf(path);
      const zip = unzipSync(bytes);
      const { chunkXml, parts } = readBinarySlddPackage(bytes);
      expect(chunkXml, path).toBe(new TextDecoder().decode(zip[DATA_PART_XML]));
      expect(Object.keys(parts), path).toEqual(Object.keys(zip).filter((m) => m !== DATA_PART_XML));
      for (const [member, data] of Object.entries(parts)) expect(data, `${path} ${member}`).toEqual(zip[member]);
    }
  });

  it('refuses a zip with no data part, in vscode’s words', () => {
    const zip = zipSync({ 'metadata/mwcoreProperties.xml': strToU8('<x/>') });
    expect(() => readBinarySlddPackage(zip)).toThrow('Missing data/chunk0.xml in binary SLDD');
  });

  it('throws fflate’s own error for bytes that are no zip', () => {
    expect(() => readBinarySlddPackage(strToU8('{"not": "a zip"}'))).toThrow();
  });
});

describe('writeBinarySlddPackage', () => {
  it('round-trips: what it writes reads back as the same data part and the same members', () => {
    for (const path of ORIGINALS) {
      const read = readBinarySlddPackage(bytesOf(path));
      for (const level of [6, 1] as const) {
        const again = readBinarySlddPackage(writeBinarySlddPackage(read.chunkXml, read.parts, level));
        expect(again.chunkXml, `${path} level ${level}`).toBe(read.chunkXml);
        expect(Object.keys(again.parts), `${path} level ${level}`).toEqual(Object.keys(read.parts));
        for (const [member, data] of Object.entries(read.parts)) expect(again.parts[member], `${path} ${member}`).toEqual(data);
      }
    }
  });

  it('puts the parts in their own order and the data part last', () => {
    const parts = { 'b.xml': strToU8('b'), 'a.xml': strToU8('a'), '[Content_Types].xml': strToU8('c') };
    const names = membersOf(writeBinarySlddPackage('<chunk/>', parts, 6)).map(([name]) => name);
    expect(names).toEqual(['b.xml', 'a.xml', '[Content_Types].xml', DATA_PART_XML]);
    // A bag that still held the data part has it replaced by the chunk given, in its place.
    const held = { 'a.xml': strToU8('a'), [DATA_PART_XML]: strToU8('<old/>'), 'z.xml': strToU8('z') };
    const zipped = unzipSync(writeBinarySlddPackage('<new/>', held, 6));
    expect(Object.keys(zipped)).toEqual(['a.xml', DATA_PART_XML, 'z.xml']);
    expect(new TextDecoder().decode(zipped[DATA_PART_XML])).toBe('<new/>');
  });

  it('compresses at the level asked: a backup (1) and a save (6) hold the same members', () => {
    const read = readBinarySlddPackage(bytesOf(ORIGINALS[0]));
    const save = writeBinarySlddPackage(read.chunkXml, read.parts, 6);
    const backup = writeBinarySlddPackage(read.chunkXml, read.parts, 1);
    expect(membersOf(backup)).toEqual(membersOf(save));
    expect(withoutWriteTimes(backup)).not.toEqual(withoutWriteTimes(save));
    expect(save.length).toBeLessThanOrEqual(backup.length);
  });

  it('is vscode’s writeTo: the same members, and the same bytes but each member’s write time', () => {
    for (const path of ORIGINALS) {
      const read = readBinarySlddPackage(bytesOf(path));
      for (const [mode, level] of [['save', 6], ['backup', 1]] as const) {
        const ours = writeBinarySlddPackage(read.chunkXml, read.parts, level);
        const theirs = vscodeWriteTo(read.chunkXml, read.parts, mode);
        expect(membersOf(ours), `${path} ${mode}`).toEqual(membersOf(theirs));
        expect(withoutWriteTimes(ours), `${path} ${mode}`).toEqual(withoutWriteTimes(theirs));
      }
    }
  });
});
