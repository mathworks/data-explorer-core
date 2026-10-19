// Copyright 2026 The MathWorks, Inc.
// Writes cell_zero_imaginary_core_binary.sldd and cell_zero_imaginary_core_text.sldd: core's
// saves of MATLAB's cell_zero_imaginary_*.sldd after the edits cellZeroImaginaryMember.test.ts
// makes. In cZero, cZeroNeg and cZeroNest the 5 is set to 6 as an element (their literal is not
// their value, so it takes no edit); in cTwoI, the control, the literal {1+2i, 6} is set.
// make_cell_zero_imaginary.m's 'read' phase has MATLAB read them back. Run it from the
// repository root after `npm run build`, since it reads the built package:
//
//   node test/fixtures/make_cell_zero_imaginary_core.mjs <absolute out dir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSession, ingest } from '../../dist/index.js';

const out = process.argv[2];
if (!out || !out.startsWith('/')) {
  throw new Error('usage: node test/fixtures/make_cell_zero_imaginary_core.mjs <absolute out dir>');
}
mkdirSync(out, { recursive: true });
for (const format of ['binary', 'text']) {
  const file = `cell_zero_imaginary_${format}.sldd`;
  const u8 = new Uint8Array(readFileSync(new URL(`./${file}`, import.meta.url)));
  const session = createSession();
  const root = ingest(session, u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength), { filename: file });
  const entry = (name) => root.getSection('design').children.find((e) => e.name === name);
  for (const name of ['cZero', 'cZeroNeg', 'cZeroNest']) {
    const five = entry(name).children[1];
    session.setActive(root, five);
    if (session.editProperty(five.id, 'Value', '6') !== true) {
      throw new Error(`${file}: ${name}'s 5 was not set to 6`);
    }
  }
  const control = entry('cTwoI');
  session.setActive(root, control);
  if (session.editProperty(control.id, 'Value', '{1+2i, 6}') !== true) {
    throw new Error(`${file}: cTwoI's literal was not set`);
  }
  const saved = session.serializeSource(root.name);
  const target = join(out, `cell_zero_imaginary_core_${format}.sldd`);
  writeFileSync(target, saved.kind === 'text' ? saved.text : saved.bytes);
  console.log('WROTE', target);
}
