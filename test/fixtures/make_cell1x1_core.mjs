// Copyright 2026 The MathWorks, Inc.
// Writes cell1x1_core.sldd: cell1x1_binary.sldd with its chunk written by core from the model
// (regenerateChunkXml), and every other part as MATLAB wrote it. make_cell1x1.m's 'read' phase
// has MATLAB read it back. Run it from the repository root after `npm run build`, since it reads
// the built package:
//
//   node test/fixtures/make_cell1x1_core.mjs <absolute out dir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { createSession, ingest } from '../../dist/index.js';
import { regenerateChunkXml } from '../../dist/datamodel/parser/BinarySlddSerializer.js';

const out = process.argv[2];
if (!out || !out.startsWith('/')) {
  throw new Error('usage: node test/fixtures/make_cell1x1_core.mjs <absolute out dir>');
}
const u8 = new Uint8Array(readFileSync(new URL('./cell1x1_binary.sldd', import.meta.url)));
const root = ingest(createSession(), u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength), { filename: 'cell1x1_binary.sldd' });
const parts = unzipSync(u8);
parts['data/chunk0.xml'] = strToU8(regenerateChunkXml(root));
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'cell1x1_core.sldd'), zipSync(parts, { level: 6 }));
console.log('WROTE', join(out, 'cell1x1_core.sldd'));
