// Copyright 2026 The MathWorks, Inc.
//
// The core half of probe_coderinfo_undefined.m: the dictionaries MATLAB is asked to read, each
// holding a Simulink.VariantBankCoderInfo whose saveobj envelope an earlier version of this
// package wrote back as `<P Name="undefined" Class="struct">` (an absent @_Name keyed under the
// string 'undefined'; DataNode.pxAttrs), in place of MATLAB's
// `<P Source="saveobj" PropertyType="any" Class="struct">`. Each is made from MATLAB's own R2027a
// fixture (test/fixtures/variantbank_r2027a_{binary,text}.sldd), with no core:
//   b_written         the binary fixture as MATLAB wrote it, for comparison
//   b_ciA_undefined   the binary fixture, ciA's envelope spelled so
//   b_both_undefined  the binary fixture, ciA's and ciB's envelopes spelled so
//   t_ciA_undefined   the text fixture, ciA held as a plain bag whose one property, 'undefined', is
//                     the envelope's struct: a text dictionary's spelling of the same object
//   t_ciA_undefined_beside  ciA's five properties in the bag, as R2026b spells them, and after
//                     them an 'undefined' struct holding other values
//   b_ciA_envelope_beside   the binary fixture, ciA's envelope as MATLAB wrote it, and after it an
//                     'undefined' struct holding other values
//   t_ciA_envelope_beside   the text fixture, ciA's envelope as MATLAB wrote it, and beside it a
//                     plain bag whose one property, 'undefined', holds other values
//   t_ciA_empty_bag   the text fixture, ciA held as a plain bag with no property at all
//   t_ciA_other_bag   the text fixture, ciA held as a plain bag whose one property, Foo, is 'x'
// The last four are controls: an 'undefined' beside an envelope, and a plain bag that has neither
// the five properties nor an 'undefined'.
// Each is written alone to <outdir>/<id>.sldd. <outdir>/names.json lists them, with the sha256 of
// the part edited (a binary file's data/chunk0.xml, a text file's whole text), which the test's own
// copy must match: the zip around a chunk carries the time it was made.
//
// Run:  node test/parity/matlab/coderinfo_undefined.mjs /tmp/ciundef
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const out = process.argv[2];
if (!out) {
  throw new Error('usage: node coderinfo_undefined.mjs <outdir>');
}
const fixture = (format) => new Uint8Array(readFileSync(new URL(`../../fixtures/variantbank_r2027a_${format}.sldd`, import.meta.url)));
const ENVELOPE = '<P Source="saveobj" PropertyType="any" Class="struct">';
const DAMAGED = '<P Name="undefined" Class="struct">';

/** The binary fixture's chunk with the envelope of each coder info in `entries` spelled as damaged. */
function damagedChunk(xml, entries) {
  let edited = xml;
  for (const entry of entries) {
    const at = edited.indexOf(`<P Name="Name" Class="char">${entry}</P>`);
    const open = edited.indexOf('<Element Class="Simulink.VariantBankCoderInfo">', at);
    const envelope = edited.indexOf(ENVELOPE, open);
    if (at < 0 || open < 0 || envelope < 0 || envelope > edited.indexOf('</Object>', at)) {
      throw new Error(`no coder info envelope for ${entry}`);
    }
    edited = edited.slice(0, envelope) + DAMAGED + edited.slice(envelope + ENVELOPE.length);
  }
  return edited;
}

/**
 * The text fixture with each coder info in `entries` held as a plain bag whose one property,
 * 'undefined', is the envelope's struct; or, `beside`, a plain bag of the five properties with
 * an 'undefined' after them whose struct holds other values (OTHER_VALUES), so that what MATLAB
 * reads says which of the two it read.
 */
const OTHER_VALUES = { DefinitionFile: 'u.c', HeaderFile: 'u.h', PostStatement: 'upost', PreStatement: 'upre', Qualifier: 'Volatile' };
function damagedText(text, entries, beside = false) {
  const json = JSON.parse(text);
  for (const entry of json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries) {
    if (entries.includes(entry.name)) {
      const envelope = entry.value._elements[0]._custom_save;
      const own = beside ? Object.fromEntries(Object.keys(envelope._elements[0]).sort().map((k) => [k, envelope._elements[0][k]])) : {};
      const held = beside ? { ...envelope, _elements: [OTHER_VALUES] } : envelope;
      entry.value._elements[0] = { _id: '1', _properties: { ...own, undefined: held } };
    }
  }
  return JSON.stringify(json, null, '\t');
}

/**
 * The binary fixture's chunk with, after the envelope of each coder info in `entries`, an
 * 'undefined' struct holding OTHER_VALUES, its five in the order MATLAB writes them.
 */
function besideEnvelopeChunk(xml, entries) {
  const pad = (n) => ' '.repeat(n);
  const fields = ['HeaderFile', 'DefinitionFile', 'PreStatement', 'PostStatement', 'Qualifier']
    .map((k) => `${pad(24)}<P Name="${k}" Class="char">${OTHER_VALUES[k]}</P>\n`).join('');
  const sibling = `${pad(16)}${DAMAGED}\n${pad(20)}<Element>\n${fields}${pad(20)}</Element>\n${pad(16)}</P>\n`;
  const close = `${pad(16)}</P>\n${pad(12)}</Element>`;
  let edited = xml;
  for (const entry of entries) {
    const at = edited.indexOf(`<P Name="Name" Class="char">${entry}</P>`);
    const open = edited.indexOf('<Element Class="Simulink.VariantBankCoderInfo">', at);
    const envelope = edited.indexOf(ENVELOPE, open);
    const end = edited.indexOf(close, envelope);
    if (at < 0 || open < 0 || envelope < 0 || end < 0 || end > edited.indexOf('</Object>', at)) {
      throw new Error(`no coder info envelope for ${entry}`);
    }
    const after = end + `${pad(16)}</P>\n`.length;
    edited = edited.slice(0, after) + sibling + edited.slice(after);
  }
  return edited;
}

/**
 * The text fixture with each coder info in `entries` in another shape: `envelope-beside`, its
 * envelope as MATLAB wrote it and beside it a plain bag whose one property, 'undefined', holds
 * OTHER_VALUES; `empty`, a plain bag with no property; `other`, a plain bag whose one property is
 * Foo 'x'.
 */
function shapedText(text, entries, shape) {
  const json = JSON.parse(text);
  for (const entry of json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries) {
    if (entries.includes(entry.name)) {
      const envelope = entry.value._elements[0]._custom_save;
      entry.value._elements[0] = shape === 'envelope-beside'
        ? { _custom_save: envelope, _id: '1', _properties: { undefined: { ...envelope, _elements: [OTHER_VALUES] } } }
        : { _id: '1', _properties: shape === 'empty' ? {} : { Foo: 'x' } };
    }
  }
  return JSON.stringify(json, null, '\t');
}

const CASES = [
  { id: 'b_written', format: 'binary', entries: [] },
  { id: 'b_ciA_undefined', format: 'binary', entries: ['ciA'] },
  { id: 'b_both_undefined', format: 'binary', entries: ['ciA', 'ciB'] },
  { id: 't_ciA_undefined', format: 'text', entries: ['ciA'] },
  { id: 't_ciA_undefined_beside', format: 'text', entries: ['ciA'], beside: true },
  { id: 'b_ciA_envelope_beside', format: 'binary', entries: ['ciA'], shape: 'envelope-beside' },
  { id: 't_ciA_envelope_beside', format: 'text', entries: ['ciA'], shape: 'envelope-beside' },
  { id: 't_ciA_empty_bag', format: 'text', entries: ['ciA'], shape: 'empty' },
  { id: 't_ciA_other_bag', format: 'text', entries: ['ciA'], shape: 'other' },
];

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

{
  mkdirSync(out, { recursive: true });
  const names = [];
  for (const c of CASES) {
    let edited;
    let bytes;
    if (c.format === 'binary') {
      const parts = unzipSync(fixture('binary'));
      edited = (c.shape ? besideEnvelopeChunk : damagedChunk)(strFromU8(parts['data/chunk0.xml']), c.entries);
      parts['data/chunk0.xml'] = strToU8(edited);
      bytes = zipSync(parts);
    } else {
      edited = c.shape ? shapedText(strFromU8(fixture('text')), c.entries, c.shape) : damagedText(strFromU8(fixture('text')), c.entries, c.beside);
      bytes = strToU8(edited);
    }
    writeFileSync(`${out}/${c.id}.sldd`, bytes);
    names.push({ ...c, sha256: sha256(edited) });
  }
  writeFileSync(`${out}/names.json`, JSON.stringify(names, null, 1));
  console.log('wrote', names.length, 'dictionaries to', out);
}
