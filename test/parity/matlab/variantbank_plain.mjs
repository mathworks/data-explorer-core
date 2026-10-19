// Copyright 2026 The MathWorks, Inc.
//
// The core half of probe_variantbank_plain.m: the text dictionaries MATLAB is asked to read, each
// holding its Simulink.VariantBank entries in R2026b's spelling, as plain properties with no
// saveobj envelope (`"_elements": [{"_id": "1", "_properties": {...}}]`), which is how a text
// dictionary that release wrote holds one. Each is made from MATLAB's own R2027a text fixture
// (test/fixtures/variantbank_r2027a_text.sldd), its banks and coder infos respelled so: the
// envelope's one element, whose keys MATLAB already wrote in name order, becomes the plain bag.
//
// Two kinds of case:
//   hand  one hand edit of that respelled file (`edit`: the entries it applies to, the fields it
//         sets, the fields it drops, and a key order), as a hand-edited file can hold it. Made
//         without core, so it is made the same way before and after a change to the reader.
//   save  core's own save of that respelled file after the edits in `edits` (entry, column id
//         the table sends, text typed), each of which core must take. Needs dist built.
// Each is written alone to <outdir>/<id>.sldd. <outdir>/names.json lists them, with the case as
// data, which the probe copies into its truth, so the test can make the same file and grade
// core's reading of it against MATLAB's: a hand case with the sha256 of the file's text, which the
// test's own copy must match, and a save case with the element core wrote for each entry it edited.
//
// Run, with dist built:  node test/parity/matlab/variantbank_plain.mjs /tmp/vbplain
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const out = process.argv[2];
if (!out) {
  throw new Error('usage: node variantbank_plain.mjs <outdir>');
}
const FIXTURE = new URL('../../fixtures/variantbank_r2027a_text.sldd', import.meta.url);
const CLASSES = ['Simulink.VariantBank', 'Simulink.VariantBankCoderInfo'];
const BANKS = ['vbN', 'vb1', 'vbD'];
const cell = (...elements) => ({ _array_type: 'Cell', _dimensions: [1, elements.length], _elements: elements });

const entriesOf = (json) => json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;

/** The fixture with its banks and coder infos in R2026b's plain spelling, and `edit` applied. */
function plainText(edit = {}) {
  const json = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  for (const entry of entriesOf(json)) {
    if (!CLASSES.includes(entry.value?._array_class)) {
      continue;
    }
    let bag = { ...entry.value._elements[0]._custom_save._elements[0] };
    if ((edit.entries ?? []).includes(entry.name)) {
      Object.assign(bag, edit.set ?? {});
      for (const field of edit.drop ?? []) {
        delete bag[field];
      }
      if (edit.order) {
        bag = Object.fromEntries([...edit.order.filter((k) => k in bag), ...Object.keys(bag).filter((k) => !edit.order.includes(k))].map((k) => [k, bag[k]]));
      }
    }
    entry.value._elements[0] = { _id: '1', _properties: bag };
  }
  return JSON.stringify(json, null, '\t');
}

const HAND = [
  { id: 'h_written', what: 'as written', edit: {} },
  { id: 'h_name_1bad', what: "vbN's Name '1bad'", edit: { entries: ['vbN'], set: { Name: '1bad' } } },
  { id: 'h_name_rtX', what: "vbN's Name 'rtX'", edit: { entries: ['vbN'], set: { Name: 'rtX' } } },
  { id: 'h_name_number', what: "vbN's Name a number", edit: { entries: ['vbN'], set: { Name: 5 } } },
  { id: 'h_desc_number', what: "vbN's Description a number", edit: { entries: ['vbN'], set: { Description: 5 } } },
  { id: 'h_all_1bad', what: "vbN's AllChoicesCoderInfo '1bad'", edit: { entries: ['vbN'], set: { AllChoicesCoderInfo: '1bad' } } },
  { id: 'h_active_1bad', what: "vbN's ActiveChoiceCoderInfo '1bad'", edit: { entries: ['vbN'], set: { ActiveChoiceCoderInfo: '1bad' } } },
  { id: 'h_all_number', what: "vbN's AllChoicesCoderInfo a number", edit: { entries: ['vbN'], set: { AllChoicesCoderInfo: 5 } } },
  { id: 'h_cond_unspaced', what: "vbN's condition 'V==1'", edit: { entries: ['vbN'], set: { VariantConditions: cell('V==1', 'V == 2') } } },
  { id: 'h_cond_unparsable', what: "vbN's condition 'V =='", edit: { entries: ['vbN'], set: { VariantConditions: cell('V == 1', 'V ==') } } },
  { id: 'h_cond_enum', what: "vbN's condition 'V == E.A'", edit: { entries: ['vbN'], set: { VariantConditions: cell('V == 1', 'V == E.A') } } },
  { id: 'h_cond_empty', what: "vbN's condition ''", edit: { entries: ['vbN'], set: { VariantConditions: cell('V == 1', '') } } },
  { id: 'h_cond_number', what: "vbN's condition a number", edit: { entries: ['vbN'], set: { VariantConditions: cell('V == 1', 2) } } },
  { id: 'h_cond_int32', what: "vbN's condition 'V == 2147483648'", edit: { entries: ['vbN'], set: { VariantConditions: cell('V == 1', 'V == 2147483648') } } },
  { id: 'h_conds_char', what: "vbN's VariantConditions the char 'V==1'", edit: { entries: ['vbN'], set: { VariantConditions: 'V==1' } } },
  { id: 'h_conds_number', what: "vbN's VariantConditions a number", edit: { entries: ['vbN'], set: { VariantConditions: 5 } } },
  { id: 'h_conds_2x1', what: "vbN's VariantConditions a 2x1 cell", edit: { entries: ['vbN'], set: { VariantConditions: { _array_type: 'Cell', _dimensions: [2, 1], _elements: ['V == 1', 'V == 2'] } } } },
  { id: 'h_vb1_all_ciB', what: "vb1's AllChoicesCoderInfo 'ciB', before its BankCoderInfo 'ciA'", edit: { entries: ['vb1'], set: { AllChoicesCoderInfo: 'ciB' } } },
  { id: 'h_vb1_all_ciB_after', what: "vb1's AllChoicesCoderInfo 'ciB', after its BankCoderInfo 'ciA'", edit: { entries: ['vb1'], set: { AllChoicesCoderInfo: 'ciB' }, order: ['BankCoderInfo'] } },
  { id: 'h_vb1_active_ciB', what: "vb1's ActiveChoiceCoderInfo 'ciB', before its BankCoderInfo 'ciA'", edit: { entries: ['vb1'], set: { ActiveChoiceCoderInfo: 'ciB' } } },
  { id: 'h_vb1_bank_empty', what: "vb1's BankCoderInfo ''", edit: { entries: ['vb1'], set: { BankCoderInfo: '' } } },
  { id: 'h_vb1_bank_ciB', what: "vb1's BankCoderInfo 'ciB'", edit: { entries: ['vb1'], set: { BankCoderInfo: 'ciB' } } },
  { id: 'h_vb1_bank_1bad', what: "vb1's BankCoderInfo '1bad'", edit: { entries: ['vb1'], set: { BankCoderInfo: '1bad' } } },
  { id: 'h_no_bank', what: 'no bank has a BankCoderInfo', edit: { entries: BANKS, drop: ['BankCoderInfo'] } },
  { id: 'h_no_desc', what: 'vbN has no Description', edit: { entries: ['vbN'], drop: ['Description'] } },
  { id: 'h_no_name', what: 'vbN has no Name', edit: { entries: ['vbN'], drop: ['Name'] } },
  { id: 'h_no_conds', what: 'vbN has no VariantConditions', edit: { entries: ['vbN'], drop: ['VariantConditions'] } },
  { id: 'h_name_first', what: "vbN's Name first, then the rest", edit: { entries: ['vbN'], order: ['Name', 'VariantConditions'] } },
  { id: 'h_value_key', what: "vbN has a Value 'x'", edit: { entries: ['vbN'], set: { Value: 'x' } } },
  { id: 'h_unknown_key', what: 'vbN has a property Foo', edit: { entries: ['vbN'], set: { Foo: 1 } } },
];

const SAVE = [
  {
    id: 's_vbD_every_field',
    what: "every field of the default bank vbD edited",
    edits: [
      ['vbD', 'bankName', 'bankZ'],
      ['vbD', 'Description', "two\nlines, it's"],
      ['vbD', 'variantConditions', "{'A==1','A==2';'A==3','A==4'}"],
      ['vbD', 'allChoicesCoderInfo', 'ciA'],
      ['vbD', 'activeChoiceCoderInfo', 'ciB'],
    ],
  },
  {
    id: 's_vbN_cleared',
    what: "every field of vbN cleared",
    edits: [
      ['vbN', 'bankName', ''],
      ['vbN', 'Description', ''],
      ['vbN', 'variantConditions', '{}'],
      ['vbN', 'allChoicesCoderInfo', ''],
      ['vbN', 'activeChoiceCoderInfo', ''],
    ],
  },
  { id: 's_vbN_string_array', what: "vbN's conditions typed as a string array", edits: [['vbN', 'variantConditions', '["V==3","W~=1"]']] },
  { id: 's_vb1_all_ciB', what: "vb1's AllChoicesCoderInfo edited to 'ciB', beside its BankCoderInfo 'ciA'", edits: [['vb1', 'allChoicesCoderInfo', 'ciB']] },
];

function entryIn(root, name) {
  const stack = [root];
  while (stack.length) {
    const n = stack.shift();
    if (n?.name === name && n.className && !String(n.id ?? '').startsWith('section:')) {
      return n;
    }
    stack.push(...(n?.children ?? []));
  }
  throw new Error(`no entry "${name}"`);
}

/** Core's save of the respelled fixture after `edits`, each of which core must take. */
async function savedAfter(edits) {
  const core = await import(new URL('../../../dist/index.js', import.meta.url).href);
  const session = core.createSession();
  const source = core.ingest(session, plainText(), { filename: 'banks.sldd' });
  for (const [entry, column, typed] of edits) {
    const answer = entryIn(source, entry).setProperty(column, typed);
    if (answer !== true) {
      throw new Error(`core refused ${entry}.${column} = ${JSON.stringify(typed)}: ${answer.reason}`);
    }
  }
  const text = session.serializeSource(source.name).text;
  const json = JSON.parse(text);
  const wrote = Object.fromEntries([...new Set(edits.map(([entry]) => entry))].map((name) => [name, entriesOf(json).find((e) => e.name === name).value._elements[0]]));
  return { text, wrote };
}
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

mkdirSync(out, { recursive: true });
const names = [];
for (const c of HAND) {
  const text = plainText(c.edit);
  writeFileSync(`${out}/${c.id}.sldd`, text);
  names.push({ id: c.id, kind: 'hand', what: c.what, edit: c.edit, sha256: sha256(text) });
}
if (process.env.VB_PLAIN_KINDS !== 'hand') {
  for (const c of SAVE) {
    const { text, wrote } = await savedAfter(c.edits);
    writeFileSync(`${out}/${c.id}.sldd`, text);
    names.push({ id: c.id, kind: 'save', what: c.what, edits: c.edits, wrote });
  }
}
writeFileSync(`${out}/names.json`, JSON.stringify(names, null, 1));
console.log('wrote', names.length, 'dictionaries to', out);
