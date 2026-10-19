// Copyright 2026 The MathWorks, Inc.
//
// A Simulink.VariantBank's own properties, read out of the saveobj envelope a dictionary holds
// it as, shown, and edited by MATLAB's rules (the 2026-10-18 group F ruling: C-168 option (b),
// under group E's theme 2, follow MATLAB; and theme 1 for a hand-edited file).
//
// MATLAB's bank has Name, Description, VariantConditions, AllChoicesCoderInfo and
// ActiveChoiceCoderInfo, and its envelope adds the Hidden BankCoderInfo. The node used to show
// none of them: a MATLAB-written bank showed an empty Description where the file held 'desc A',
// and its Property Inspector a stray `Other._saveobj` row. Its Description cell took an edit,
// answered `true`, and both save paths dropped it, so the edit was silently lost.
//
// What MATLAB does, measured by test/fixtures/make_variantbank_r2027a.m on R2027a
// (27.1.0.3409468), which also wrote the fixtures read here (vbN, vb1, vbD in
// variantbank_r2027a_{text,binary}.sldd):
//   - The setters refuse a Name that is not a C identifier or starts with "rt", a coder info
//     name that is not a valid variable name, a VariantConditions that is not a cell, a
//     condition that is not text, is empty, or does not parse, and an integer past int32.
//   - A condition is stored in MATLAB's spelling ('V==1' as 'V == 1'), and a cell of any shape
//     as 1xN; {} as 1x0.
//   - A dictionary holding a value a setter refuses loads the WHOLE bank as defaults, with no
//     warning; a Name or Description that is not text loads as ''; a VariantConditions that is
//     a bare char loads as a cell of that one condition.
// So every refused value is refused here too, an edit is written into the envelope only, in
// MATLAB's spelling, and a hand-edited file is shown as read, with a warning where MATLAB would
// not read it as written, and saved as read.
//
// Driven through the session API a host uses: `ingest`, the node's own `setProperty` (with the
// column ids the table sends), `toRow`, `toPIObject`, `editProperty`/`undo`, and
// `serializeSource`, whose bytes are read back.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession, ingest, type SerializedSource } from '../src/index.js';
import VariantBankNode from '../src/datamodel/node/data/VariantBankNode.js';
import VariantBankCoderInfoNode from '../src/datamodel/node/data/VariantBankCoderInfoNode.js';
import type DataNode from '../src/datamodel/node/DataNode.js';
import type { ParseWarning } from '../src/datamodel/parser/ParseWarning.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Format = 'text' | 'binary';
const FORMATS: Format[] = ['text', 'binary'];

const FIELDS = ['Name', 'Description', 'VariantConditions', 'AllChoicesCoderInfo', 'ActiveChoiceCoderInfo', 'BankCoderInfo'];
const cell = (...conditions: string[]) => ({ _array_type: 'Cell', _dimensions: [1, conditions.length], _elements: conditions });

// The banks MATLAB wrote, field by field, as MATLAB reads them back (the script's READBACK lines).
const MATLAB_WROTE: Record<string, Record<string, unknown>> = {
  vbN: { Name: 'bankA', Description: 'desc A', VariantConditions: cell('V == 1', 'V == 2'), AllChoicesCoderInfo: 'ciA', ActiveChoiceCoderInfo: 'ciB', BankCoderInfo: '' },
  vb1: { Name: 'bankOne', Description: "two\nlines, it's", VariantConditions: cell('W > 0 && ~X'), AllChoicesCoderInfo: 'ciA', ActiveChoiceCoderInfo: 'ciA', BankCoderInfo: 'ciA' },
  vbD: { Name: '', Description: '', VariantConditions: cell(), AllChoicesCoderInfo: '', ActiveChoiceCoderInfo: '', BankCoderInfo: '' },
};

const MSG_NAME = `'Name' property for Simulink.VariantBank must be a valid C identifier that does not start with "rt".`;
const MSG_CODER_INFO = (field: string, v: string) =>
  `'${field}' value '${v}' must be a valid variable name corresponding to Simulink.VariantBankCoderInfo object.`;
const MSG_NOT_CELL = `'VariantConditions' property for Simulink.VariantBank must be a cell array.`;
const MSG_NOT_STRING = `Conditions defined in 'VariantConditions' property must be a scalar string.`;
const MSG_EMPTY = "Invalid variant condition '' for Simulink.VariantBank.";
const MSG_RANGE = (token: string, expr: string) =>
  `Unsupported numeric value '${token}' in variant condition expression '${expr}'. Only integers that can fit into the integer type for this system are allowed.`;

function fixture(format: Format): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/variantbank_r2027a_${format}.sldd`, import.meta.url))));
}
const fixtureText = (): string => strFromU8(fixture('text'));

function textEntries(text: string): any[] {
  return JSON.parse(text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries as any[];
}
function chunkXml(bytes: Uint8Array): string {
  return strFromU8(unzipSync(bytes)['data/chunk0.xml']);
}
// The binary file's chunk XML with `edit` applied, zipped back.
function withXml(edit: (xml: string) => string): Uint8Array {
  const parts = unzipSync(fixture('binary'));
  const xml = strFromU8(parts['data/chunk0.xml']);
  const edited = edit(xml);
  expect(edited, 'the hand edit applied').not.toBe(xml);
  parts['data/chunk0.xml'] = strToU8(edited);
  return zipSync(parts);
}
// The `<Element Class="Simulink.VariantBank">` of one entry, as the binary file spells it.
function bankXml(xml: string, entry: string): string {
  const at = xml.indexOf(`<P Name="Name" Class="char">${entry}</P>`);
  expect(at, `no entry ${entry} in the chunk`).toBeGreaterThan(-1);
  const open = xml.indexOf('<Element Class="Simulink.VariantBank">', at);
  const close = xml.indexOf('</Object>', at);
  expect(open > at && open < close, `${entry} is not a bank`).toBe(true);
  return xml.slice(open, close);
}

function entryIn(root: any, name: string): DataNode {
  const stack = [root];
  while (stack.length) {
    const n = stack.shift();
    if (n?.name === name && n.className && !String(n.id ?? '').startsWith('section:')) {
      return n as DataNode;
    }
    stack.push(...(n?.children ?? []));
  }
  throw new Error(`no entry "${name}"`);
}

function open(content: Uint8Array | string) {
  const session = createSession();
  const source: any = ingest(session, content, { filename: 'banks.sldd' });
  return { session, source };
}
function saved(session: any, source: any): Uint8Array | string {
  const out = session.serializeSource(source.name) as SerializedSource;
  return out.kind === 'binary' ? out.bytes : out.text;
}

// What a save wrote for a bank: its envelope's one element as the reader reads the saved file
// back, every key of its bag (the envelope and anything beside it), and its own spelling there.
function savedBank(content: Uint8Array | string, entry: string) {
  const node = entryIn(open(content).source, entry) as any;
  const bag = node.serial._properties as Record<string, any>;
  const fields = bag._saveobj._elements[0] as Record<string, unknown>;
  const spelled = typeof content === 'string'
    ? JSON.stringify(textEntries(content).find((e) => e.name === entry).value)
    : bankXml(chunkXml(content), entry);
  return { node, keys: Object.keys(bag), fields, spelled };
}
// A field as compared: a cell reduced to its shape and elements (the binary reader adds
// `_mw_element_type`).
function plain(v: unknown): unknown {
  if (v && typeof v === 'object' && (v as any)._array_type === 'Cell') {
    return { _array_type: 'Cell', _dimensions: (v as any)._dimensions, _elements: (v as any)._elements };
  }
  return v;
}
function fieldsOf(bank: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(FIELDS.map((f) => [f, plain(bank[f])]));
}

function rowOf(node: DataNode): Record<string, any> {
  return node.toRow() as Record<string, any>;
}
const cellText = (row: Record<string, any>, column: string) => row[column]?.text ?? row[column];
function pi(node: DataNode) {
  const sheet = node.toPIObject()!;
  const groups = (sheet.propertySheet.groups as any[]).map((g) => ({ name: g.displayName, items: g.items.map((i: any) => i.name) }));
  return { groups, values: sheet.objects[0] as Record<string, unknown>, props: sheet.propertySheet.properties as any[] };
}

// ─── Shown as MATLAB wrote it ─────────────────────────────────────────────────────────────────

describe.each(FORMATS)('VariantBank fields (%s): a MATLAB-written bank shows its own properties', (format) => {
  it('in the row, each in its own editable cell, and its Description in the Description column', () => {
    const { source } = open(fixture(format));
    expect(source.warnings).toBeUndefined();
    const shown = (entry: string) => {
      const row = rowOf(entryIn(source, entry));
      return {
        Description: row.Description,
        bankName: cellText(row, 'bankName'),
        variantConditions: cellText(row, 'variantConditions'),
        allChoicesCoderInfo: cellText(row, 'allChoicesCoderInfo'),
        activeChoiceCoderInfo: cellText(row, 'activeChoiceCoderInfo'),
      };
    };
    expect(shown('vbN')).toEqual({ Description: 'desc A', bankName: 'bankA', variantConditions: "{'V == 1','V == 2'}", allChoicesCoderInfo: 'ciA', activeChoiceCoderInfo: 'ciB' });
    expect(shown('vb1')).toEqual({ Description: "two\nlines, it's", bankName: 'bankOne', variantConditions: "{'W > 0 && ~X'}", allChoicesCoderInfo: 'ciA', activeChoiceCoderInfo: 'ciA' });
    expect(shown('vbD')).toEqual({ Description: '', bankName: '', variantConditions: '{}', allChoicesCoderInfo: '', activeChoiceCoderInfo: '' });
    const row = rowOf(entryIn(source, 'vbN'));
    for (const column of ['bankName', 'variantConditions', 'allChoicesCoderInfo', 'activeChoiceCoderInfo']) {
      expect(row[column], column).toMatchObject({ editable: true, editor: 'text' });
    }
    expect(row._descriptionEditable).toBe(true);
    // Value stays as C-168(a) left it: the class has none.
    expect(row.Value).toBe('');
    expect(row._valueEditable).toBe(false);
  });

  it('in the Property Inspector, Description under General and the rest under Variant Bank, with no Other row', () => {
    const { groups, values, props } = pi(entryIn(open(fixture(format)).source, 'vbN'));
    expect(groups).toEqual([
      { name: 'General', items: ['Name', 'Value', 'DataType', 'Kind', 'Class', 'Description'] },
      { name: 'Variant Bank', items: ['BankName', 'VariantConditions', 'AllChoicesCoderInfo', 'ActiveChoiceCoderInfo'] },
    ]);
    expect(values).toMatchObject({ Description: 'desc A', BankName: 'bankA', VariantConditions: "{'V == 1','V == 2'}", AllChoicesCoderInfo: 'ciA', ActiveChoiceCoderInfo: 'ciB' });
    expect(Object.keys(values).filter((k) => k.startsWith('Other.'))).toEqual([]);
    const label = (name: string) => props.find((p) => p.name === name)?.displayName;
    expect(['BankName', 'VariantConditions', 'AllChoicesCoderInfo', 'ActiveChoiceCoderInfo'].map(label)).toEqual([
      'Bank Name', 'Variant Conditions', 'All Choices Coder Info', 'Active Choice Coder Info',
    ]);
  });

  it('and a save with no edit writes every bank as it was read', () => {
    const { session, source } = open(fixture(format));
    const out = saved(session, source);
    for (const entry of Object.keys(MATLAB_WROTE)) {
      expect(fieldsOf(savedBank(out, entry).fields), entry).toEqual(MATLAB_WROTE[entry]);
    }
    if (format === 'text') {
      expect(out).toBe(fixtureText());
    } else {
      expect(chunkXml(out as Uint8Array)).toBe(chunkXml(fixture('binary')));
    }
  });
});

// ─── Edited ───────────────────────────────────────────────────────────────────────────────────

// Each edit, by the column id the table sends: what it is typed as, the field it writes, what
// is written there and what the cell shows after.
const EDITS = [
  { column: 'bankName', typed: 'bankB', field: 'Name', written: 'bankB', shown: 'bankB' },
  { column: 'bankName', typed: '', field: 'Name', written: '', shown: '' },
  { column: 'Description', typed: 'a new description', field: 'Description', written: 'a new description', shown: 'a new description' },
  { column: 'Description', typed: '', field: 'Description', written: '', shown: '' },
  { column: 'variantConditions', typed: "{'V==3','W~=1'}", field: 'VariantConditions', written: cell('V == 3', 'W ~= 1'), shown: "{'V == 3','W ~= 1'}" },
  // A column is stored as a row, and a 2x2 in column order, as MATLAB stores them.
  { column: 'variantConditions', typed: "{'A==1';'B==2'}", field: 'VariantConditions', written: cell('A == 1', 'B == 2'), shown: "{'A == 1','B == 2'}" },
  { column: 'variantConditions', typed: "{'A==1','A==2';'A==3','A==4'}", field: 'VariantConditions', written: cell('A == 1', 'A == 3', 'A == 2', 'A == 4'), shown: "{'A == 1','A == 3','A == 2','A == 4'}" },
  { column: 'variantConditions', typed: '{}', field: 'VariantConditions', written: cell(), shown: '{}' },
  { column: 'variantConditions', typed: '["V==1","V==2"]', field: 'VariantConditions', written: cell('V == 1', 'V == 2'), shown: "{'V == 1','V == 2'}" },
  { column: 'allChoicesCoderInfo', typed: 'ciB', field: 'AllChoicesCoderInfo', written: 'ciB', shown: 'ciB' },
  { column: 'allChoicesCoderInfo', typed: '', field: 'AllChoicesCoderInfo', written: '', shown: '' },
  { column: 'activeChoiceCoderInfo', typed: 'ciA', field: 'ActiveChoiceCoderInfo', written: 'ciA', shown: 'ciA' },
  // The property's own key reaches the same field as its column id.
  { column: 'BankName', typed: 'byKey', field: 'Name', written: 'byKey', shown: 'byKey' },
] as const;

describe.each(FORMATS)('VariantBank fields (%s): an edit is saved into the envelope, and nowhere else', (format) => {
  it.each(EDITS)('$column = $typed', ({ column, typed, field, written, shown }) => {
    const { session, source } = open(fixture(format));
    const node = entryIn(source, 'vbN');
    expect(node.setProperty(column, typed)).toBe(true);
    expect(node.status).toBe('Modified');
    const after = savedBank(saved(session, source), 'vbN');
    // Into the envelope, MATLAB's empty for an empty, and every other field as MATLAB wrote it.
    expect(fieldsOf(after.fields)).toEqual({ ...MATLAB_WROTE.vbN, [field]: written });
    // Nothing beside the envelope.
    expect(after.keys).toEqual(['_saveobj']);
    if (format === 'text') {
      expect(JSON.parse(after.spelled)._elements[0]).not.toHaveProperty('_properties');
    } else {
      expect(after.spelled.split('<P Name="').length - 1, 'one P per envelope field').toBe(FIELDS.length);
    }
    // And read back as the edit left it.
    const cellAfter = cellText(rowOf(after.node), column === 'BankName' ? 'bankName' : column);
    expect(cellAfter).toBe(shown);
  });

  it('a Description edit survives the save (it used to answer true and be dropped)', () => {
    const { session, source } = open(fixture(format));
    expect(entryIn(source, 'vbN').setProperty('Description', 'kept')).toBe(true);
    const after = savedBank(saved(session, source), 'vbN');
    expect(after.fields.Description).toBe('kept');
    expect(rowOf(after.node).Description).toBe('kept');
  });

  it('an edited default bank is spelled as MATLAB spells the same bank', () => {
    const { session, source } = open(fixture(format));
    const node = entryIn(source, 'vbD');
    for (const [column, typed] of [
      ['bankName', 'bankOne'], ['Description', "two\nlines, it's"], ['variantConditions', "{'(W>0)&&~X'}"],
      ['allChoicesCoderInfo', 'ciA'], ['activeChoiceCoderInfo', 'ciA'],
    ]) {
      expect(node.setProperty(column, typed), column).toBe(true);
    }
    const out = saved(session, source);
    const ours = savedBank(out, 'vbD').spelled;
    const matlab = savedBank(format === 'text' ? fixtureText() : fixture('binary'), 'vb1').spelled;
    // vb1 is the same bank but for its BankCoderInfo, which MATLAB set and an edit cannot.
    const unbanked = (s: string) => format === 'text'
      ? JSON.stringify({ ...JSON.parse(s)._elements[0]._custom_save._elements[0], BankCoderInfo: undefined })
      : s.replace(/<P Name="BankCoderInfo" Class="char">ciA<\/P>|<P Name="BankCoderInfo" Class="char"\/>/, '');
    expect(unbanked(ours)).toBe(unbanked(matlab));
  });

  it('the text a cell shows, committed back, is no edit', () => {
    const { session, source } = open(fixture(format));
    const node = entryIn(source, 'vbN');
    const row = rowOf(node);
    for (const column of ['bankName', 'variantConditions', 'allChoicesCoderInfo', 'activeChoiceCoderInfo']) {
      expect(node.setProperty(column, row[column].text), column).toBe(true);
    }
    expect(node.setProperty('Description', row.Description)).toBe(true);
    expect(node.status).not.toBe('Modified');
    expect(fieldsOf(savedBank(saved(session, source), 'vbN').fields)).toEqual(MATLAB_WROTE.vbN);
  });
});

// ─── Refused ──────────────────────────────────────────────────────────────────────────────────

// One case per rule MATLAB's setter enforces (SET lines of the fixture script), with its own
// message, and the conditions MATLAB takes that this editor does not check.
const REFUSED = [
  { column: 'bankName', typed: '1bad', reason: MSG_NAME },
  { column: 'bankName', typed: 'a b', reason: MSG_NAME },
  { column: 'bankName', typed: ' bankA', reason: MSG_NAME },
  { column: 'bankName', typed: 'rtX', reason: MSG_NAME },
  { column: 'bankName', typed: 'rt', reason: MSG_NAME },
  { column: 'allChoicesCoderInfo', typed: '1bad', reason: MSG_CODER_INFO('AllChoicesCoderInfo', '1bad') },
  { column: 'allChoicesCoderInfo', typed: '_a', reason: MSG_CODER_INFO('AllChoicesCoderInfo', '_a') },
  { column: 'allChoicesCoderInfo', typed: 'a.b', reason: MSG_CODER_INFO('AllChoicesCoderInfo', 'a.b') },
  { column: 'activeChoiceCoderInfo', typed: '1bad', reason: MSG_CODER_INFO('ActiveChoiceCoderInfo', '1bad') },
  { column: 'variantConditions', typed: "'V==1'", reason: MSG_NOT_CELL },
  { column: 'variantConditions', typed: '5', reason: MSG_NOT_CELL },
  { column: 'variantConditions', typed: 'V==1', reason: MSG_NOT_CELL },
  { column: 'variantConditions', typed: '{1,2}', reason: MSG_NOT_STRING },
  { column: 'variantConditions', typed: "{{'V==1'}}", reason: MSG_NOT_STRING },
  // MATLAB makes a cell of one number of each ({1+1i}, {1+1i}, {-2}: probe_cell_sign_literals.m),
  // so its member is not text, as {1,2}'s are. A reader that did not take the imaginary-first or
  // the spaced-sign form as one value would answer "must be a cell array" instead.
  { column: 'variantConditions', typed: '{i+1}', reason: MSG_NOT_STRING },
  { column: 'variantConditions', typed: '{i + 1}', reason: MSG_NOT_STRING },
  { column: 'variantConditions', typed: '{- 2}', reason: MSG_NOT_STRING },
  { column: 'variantConditions', typed: "{''}", reason: MSG_EMPTY },
  { column: 'variantConditions', typed: "{'V==2147483648'}", reason: MSG_RANGE('2147483648', 'V==2147483648') },
  { column: 'variantConditions', typed: "{'V==-2147483649'}", reason: MSG_RANGE('-2147483649', 'V==-2147483649') },
  ...["V==", ' ', 'V=1', 'V!=1', '!V', 'end==1', 'V==1,W==2', 'V==E.', 'V==1A', 'V==1&&', '(V==1', 'true', 'false',
    // MATLAB takes these; this editor does not check them, so they are not written.
    'V==1.5', 'V==0x1F', 'V==1e3', 'V+1==2', 'V==1&W==2', 'V==1|W==2', '~V==1', 'V==~W', 'V>W>1', 'V==(W<1)',
    "V=='a'", 'V==int8(1)', 'V==1;', 'V==1i', '1', 'V&&1', 'V==true', 'V==Inf', "V==1\tW==2", 'V==1 %c',
    // Names MATLAB reads as a value of its own: 'V==1i' crashed it, so i and j are not taken either.
    'V==i', 'V==j', 'V==pi', 'V==NaN', 'V==eps', 'inf==V',
  ].map((c) => ({ column: 'variantConditions', typed: `{'${c.replace(/'/g, "''")}'}`, reason: expect.stringContaining('is not a variant condition this editor can check') })),
];

describe.each(FORMATS)('VariantBank fields (%s): a value MATLAB would refuse is refused', (format) => {
  it.each(REFUSED)('$column = $typed', ({ column, typed, reason }) => {
    const { session, source } = open(fixture(format));
    const node = entryIn(source, 'vbN');
    const before = cellText(rowOf(node), column);
    const result = node.setProperty(column, typed) as any;
    expect(result).toMatchObject({ error: true, reason, invalidValue: typed, validValue: before });
    expect(node.status).not.toBe('Modified');
    expect(cellText(rowOf(node), column)).toBe(before);
    expect(fieldsOf(savedBank(saved(session, source), 'vbN').fields)).toEqual(MATLAB_WROTE.vbN);
  });

  it.each([
    ['bankName', 'RtX', 'Name', 'RtX'], ['bankName', '_a', 'Name', '_a'], ['bankName', 'end', 'Name', 'end'],
    ['bankName', 'int', 'Name', 'int'], ['bankName', 'a'.repeat(300), 'Name', 'a'.repeat(300)],
    ['allChoicesCoderInfo', 'end', 'AllChoicesCoderInfo', 'end'], ['allChoicesCoderInfo', 'rtX', 'AllChoicesCoderInfo', 'rtX'],
    ['activeChoiceCoderInfo', 'a'.repeat(64), 'ActiveChoiceCoderInfo', 'a'.repeat(64)],
    ['variantConditions', "{'V==2147483647','V==-2147483648'}", 'VariantConditions', cell('V == 2147483647', 'V == -2147483648')],
  ])('while what MATLAB takes at the edge of its rule is taken: %s = %s', (column, typed, field, written) => {
    const { session, source } = open(fixture(format));
    expect(entryIn(source, 'vbN').setProperty(column, typed)).toBe(true);
    expect(fieldsOf(savedBank(saved(session, source), 'vbN').fields)).toEqual({ ...MATLAB_WROTE.vbN, [field]: written });
  });
});

// ─── MATLAB's spelling of a condition ─────────────────────────────────────────────────────────

// Typed, and as MATLAB stored it (the SET lines of make_variantbank_r2027a.m), for every shape
// this editor reads.
const SPELLED: [string, string][] = [
  ['V==1', 'V == 1'], ['V == 1', 'V == 1'], ['  V==1  ', 'V == 1'], ['V ==1', 'V == 1'], [' V', 'V'], ['V', 'V'],
  ['V~=1', 'V ~= 1'], ['V>1', 'V > 1'], ['V<1', 'V < 1'], ['V>=1', 'V >= 1'], ['V<=1', 'V <= 1'],
  ['V==-1', 'V == -1'], ['V==- 1', 'V == -1'], ['V==-0', 'V == 0'], ['V==01', 'V == 1'], ['1==V', '1 == V'],
  ['V==2147483647', 'V == 2147483647'], ['V==-2147483648', 'V == -2147483648'],
  ['V==E.A', 'V == E.A'], ['V==E.A.B', 'V == E.A.B'], ['v.w.x==1', 'v.w.x == 1'], ['A.B==C.D', 'A.B == C.D'],
  ['V == W', 'V == W'], ['V_1==1', 'V_1 == 1'], ['rtV==1', 'rtV == 1'], ['V==a_', 'V == a_'], ['V==A1', 'V == A1'],
  ['V==1&&W==2', 'V == 1 && W == 2'], ['V==1||W==2', 'V == 1 || W == 2'], ['V==1 && W', 'V == 1 && W'],
  ['V==1&&W==2&&X==3', 'V == 1 && W == 2 && X == 3'], ['V==1||W==2||X==3', 'V == 1 || W == 2 || X == 3'],
  ['V==1&&W==2&&X==3&&Y==4', 'V == 1 && W == 2 && X == 3 && Y == 4'],
  ['V&&W', 'V && W'], ['(V&&W)&&X', 'V && W && X'], ['V&&(W&&X)', 'V && (W && X)'], ['(V||W)||X', 'V || W || X'],
  ['V||(W||X)', 'V || (W || X)'], ['(V||W)&&X', '(V || W) && X'], ['V&&W||X', '(V && W) || X'], ['V||W&&X', 'V || (W && X)'],
  ['V==1&&W==2||X==3', '(V == 1 && W == 2) || X == 3'], ['V==1||W==2&&X==3', 'V == 1 || (W == 2 && X == 3)'],
  ['V==1&&(W==2||X==3)', 'V == 1 && (W == 2 || X == 3)'], ['((V==1)&&(W==2))||(X==3)', '(V == 1 && W == 2) || X == 3'],
  ['V==1&&(W==2&&X==3)', 'V == 1 && (W == 2 && X == 3)'], ['(V==1||W==2)||X==3', 'V == 1 || W == 2 || X == 3'],
  ['~V', '~V'], ['~ V', '~V'], ['~(V)', '~V'], ['~~V', '~(~V)'], ['~(~V)', '~(~V)'], ['~(V==1)', '~(V == 1)'],
  ['~(V&&W)', '~(V && W)'], ['~V&&~W', '~V && ~W'], ['V==1&&~(W==2)', 'V == 1 && ~(W == 2)'], ['~(V==1)&&W', '~(V == 1) && W'],
  ['V==1&&~W', 'V == 1 && ~W'], ['~V||W', '~V || W'], ['~(V||W)&&X', '~(V || W) && X'],
  ['(V==1)', 'V == 1'], ['((V==1))', 'V == 1'], ['(V)', 'V'], ['(W>0)&&~X', 'W > 0 && ~X'],
];

describe('VariantBank fields: a condition is stored as MATLAB stores it', () => {
  it.each(SPELLED)('%s is written as %s', (typed, stored) => {
    const { session, source } = open(fixture('text'));
    const node = entryIn(source, 'vbD');
    expect(node.setProperty('variantConditions', `{'${typed}'}`)).toBe(true);
    expect(savedBank(saved(session, source), 'vbD').fields.VariantConditions).toEqual(cell(stored));
  });
});

// ─── A new bank ───────────────────────────────────────────────────────────────────────────────

describe('VariantBank fields: a new bank', () => {
  it('starts as the envelope MATLAB writes, showing its defaults, and takes an edit into it', () => {
    const node = VariantBankNode.createDefault('vbNew', null) as any;
    const before = node.serializeValue();
    expect(before._elements[0]).toEqual({
      _custom_save: { _array_type: 'Struct', _dimensions: [1, 1], _fields: FIELDS, _elements: [{ Name: '', Description: '', VariantConditions: cell(), AllChoicesCoderInfo: '', ActiveChoiceCoderInfo: '', BankCoderInfo: '' }] },
    });
    const row = rowOf(node);
    expect([row.Description, row.bankName.text, row.variantConditions.text, row.allChoicesCoderInfo.text, row.activeChoiceCoderInfo.text]).toEqual(['', '', '{}', '', '']);
    expect(node.setProperty('variantConditions', "{'M==2'}")).toBe(true);
    expect(node.setProperty('Description', 'new')).toBe(true);
    const after = node.serializeValue()._elements[0];
    expect(after).not.toHaveProperty('_properties');
    expect(after._custom_save._elements[0]).toEqual({ Name: '', Description: 'new', VariantConditions: cell('M == 2'), AllChoicesCoderInfo: '', ActiveChoiceCoderInfo: '', BankCoderInfo: '' });
    expect(node._getSerializedProperties()).toEqual({ _saveobj: after._custom_save });
  });
});

// ─── Undone ───────────────────────────────────────────────────────────────────────────────────

describe.each(FORMATS)('VariantBank fields (%s): an edit through the session is undone exactly', (format) => {
  it('to the value as read, which a save then writes as read', () => {
    const { session, source } = open(fixture(format));
    const node = entryIn(source, 'vbN');
    session.setActiveContext(source);
    session.setActive(source, node);
    expect(session.editProperty(node.id, 'variantConditions', "{'Z==9'}")).toBe(true);
    expect(session.editProperty(node.id, 'bankName', 'other')).toBe(true);
    session.undo();
    session.undo();
    expect(cellText(rowOf(node), 'variantConditions')).toBe("{'V == 1','V == 2'}");
    expect(cellText(rowOf(node), 'bankName')).toBe('bankA');
    expect(fieldsOf(savedBank(saved(session, source), 'vbN').fields)).toEqual(MATLAB_WROTE.vbN);
  });
});

// ─── Hand-edited ──────────────────────────────────────────────────────────────────────────────

// The text dictionary with one of vbN's fields edited by hand, as the fixture script's LOAD lines
// edited it, with what MATLAB read (in the comment), what is shown here, and the clause the
// warning carries (null: MATLAB reads it as written, so there is none).
const VB_N_CELL = /"VariantConditions": \{[^{}]*"V == 2"\s*\]\s*\}/;
const HAND_EDITS = [
  // MATLAB: the whole bank as defaults.
  { what: 'Name 1bad', from: '"Name": "bankA"', to: '"Name": "1bad"', column: 'bankName', shown: '1bad', says: `its Name '1bad' is not a valid C identifier that does not start with "rt", which MATLAB reads as a bank with every property at its default` },
  { what: 'Name rtX', from: '"Name": "bankA"', to: '"Name": "rtX"', column: 'bankName', shown: 'rtX', says: "its Name 'rtX' is not a valid C identifier" },
  // MATLAB: Name '', the rest as written.
  { what: 'Name a number', from: '"Name": "bankA"', to: '"Name": 5', column: 'bankName', shown: '5', says: "its Name is not text, which MATLAB reads as ''" },
  // MATLAB: Description '', the rest as written.
  { what: 'Description a number', from: '"Description": "desc A"', to: '"Description": 5', column: 'Description', shown: '5', says: "its Description is not text, which MATLAB reads as ''" },
  // MATLAB: the whole bank as defaults (vb1's AllChoicesCoderInfo is 'ciA' too, and is edited with it).
  { what: 'AllChoicesCoderInfo 1bad', from: /"AllChoicesCoderInfo": "ciA"/g, to: '"AllChoicesCoderInfo": "1bad"', column: 'allChoicesCoderInfo', shown: '1bad', says: "its AllChoicesCoderInfo '1bad' is not a valid variable name, which MATLAB reads as a bank with every property at its default" },
  { what: 'ActiveChoiceCoderInfo 1bad', from: '"ActiveChoiceCoderInfo": "ciB"', to: '"ActiveChoiceCoderInfo": "1bad"', column: 'activeChoiceCoderInfo', shown: '1bad', says: "its ActiveChoiceCoderInfo '1bad' is not a valid variable name" },
  // MATLAB: the whole bank as defaults.
  { what: 'a condition that does not parse', from: '"V == 2"', to: '"V =="', column: 'variantConditions', shown: "{'V == 1','V =='}", says: "its condition 'V ==' does not parse, which MATLAB reads as a bank with every property at its default" },
  { what: 'a condition with a lone =', from: '"V == 2"', to: '"V = 2"', column: 'variantConditions', shown: "{'V == 1','V = 2'}", says: "its condition 'V = 2' does not parse" },
  { what: 'a condition with unbalanced parentheses', from: '"V == 2"', to: '"(V == 2"', column: 'variantConditions', shown: "{'V == 1','(V == 2'}", says: "its condition '(V == 2' does not parse" },
  { what: 'an empty condition', from: '"V == 2"', to: '""', column: 'variantConditions', shown: "{'V == 1',''}", says: 'its condition at position 2 is empty' },
  { what: 'a condition that is a number', from: '"V == 2"', to: '2', column: 'variantConditions', shown: "{'V == 1',2}", says: 'its condition at position 2 is not text' },
  // MATLAB: no conditions, the rest as written.
  { what: 'VariantConditions a number', from: VB_N_CELL, to: '"VariantConditions": 5', column: 'variantConditions', shown: '5', says: 'its VariantConditions is not a cell, which MATLAB reads as no conditions' },
  // MATLAB reads each of these as written (normalised, a one-condition cell, a 1x2 cell).
  { what: 'an unspaced condition', from: '"V == 1"', to: '"V==1"', column: 'variantConditions', shown: "{'V==1','V == 2'}", says: null },
  { what: 'VariantConditions a char', from: VB_N_CELL, to: '"VariantConditions": "V==1"', column: 'variantConditions', shown: "'V==1'", says: null },
  // ...which MATLAB then parses as the one condition it holds.
  { what: 'VariantConditions a char that does not parse', from: VB_N_CELL, to: '"VariantConditions": "V =="', column: 'variantConditions', shown: "'V =='", says: "its condition 'V ==' does not parse" },
  { what: 'a condition MATLAB takes, an enumeration', from: '"V == 2"', to: '"V == E.A"', column: 'variantConditions', shown: "{'V == 1','V == E.A'}", says: null },
  // MATLAB writes these itself (its spelling of 'V==1&W==2' and 'V==1.5'): read correctly, so not
  // reported, though an edit would not write them.
  { what: 'a condition MATLAB writes that the editor does not', from: '"V == 2"', to: '"V == 1 & W == 2"', column: 'variantConditions', shown: "{'V == 1','V == 1 & W == 2'}", says: null },
  { what: 'a decimal MATLAB writes', from: '"V == 2"', to: '"V == 1.5"', column: 'variantConditions', shown: "{'V == 1','V == 1.5'}", says: null },
];

function handEdited(from: string | RegExp, to: string): string {
  const text = fixtureText();
  const edited = text.replace(from, to);
  expect(edited, 'the hand edit applied').not.toBe(text);
  return edited;
}

describe('VariantBank fields: a hand-edited bank is shown as read, never refused, and saved as read', () => {
  it.each(HAND_EDITS)('$what', ({ from, to, column, shown, says }) => {
    const text = handEdited(from, to);
    const { session, source } = open(text);
    const row = rowOf(entryIn(source, 'vbN'));
    expect(cellText(row, column)).toBe(shown);
    const warnings: ParseWarning[] = (source.warnings ?? []).filter((w: ParseWarning) => w.part === 'vbN');
    if (says === null) {
      expect(warnings).toEqual([]);
    } else {
      expect(warnings).toHaveLength(1);
      expect(warnings[0].code).toBe('part-unreadable');
      expect(warnings[0].message).toContain('"vbN" holds a Simulink.VariantBank MATLAB does not read as written: ');
      expect(warnings[0].message).toContain(says);
    }
    expect(saved(session, source)).toBe(text);
  });

  it('a hidden BankCoderInfo MATLAB would refuse is reported too, against its own entry', () => {
    const text = handEdited('"BankCoderInfo": "ciA"', '"BankCoderInfo": "1bad"');
    const warnings: ParseWarning[] = open(text).source.warnings ?? [];
    expect(warnings.map((w) => w.part)).toEqual(['vb1']);
    expect(warnings[0].message).toContain("its BankCoderInfo '1bad' is not a valid variable name, which MATLAB reads as a bank with every property at its default");
  });

  it('in a binary dictionary too', () => {
    const bytes = withXml((xml) => xml.replace('<P Name="Name" Class="char">bankA</P>', '<P Name="Name" Class="char">1bad</P>'));
    const { session, source } = open(bytes);
    expect(cellText(rowOf(entryIn(source, 'vbN')), 'bankName')).toBe('1bad');
    expect((source.warnings ?? []).map((w: ParseWarning) => w.part)).toEqual(['vbN']);
    expect(bankXml(chunkXml(saved(session, source) as Uint8Array), 'vbN')).toContain('<P Name="Name" Class="char">1bad</P>');
  });

  it('an edit repairs it, and the rest of the bank is written as read', () => {
    const { session, source } = open(handEdited('"Name": "bankA"', '"Name": "1bad"'));
    expect(entryIn(source, 'vbN').setProperty('bankName', 'bankA')).toBe(true);
    expect(fieldsOf(savedBank(saved(session, source), 'vbN').fields)).toEqual(MATLAB_WROTE.vbN);
  });

  it('a char VariantConditions is undone to itself, which its own text could not do', () => {
    const text = handEdited(VB_N_CELL, '"VariantConditions": "V==1"');
    const { session, source } = open(text);
    const node = entryIn(source, 'vbN');
    session.setActiveContext(source);
    session.setActive(source, node);
    expect(session.editProperty(node.id, 'variantConditions', "{'V==3'}")).toBe(true);
    session.undo();
    expect(cellText(rowOf(node), 'variantConditions')).toBe("'V==1'");
    expect(savedBank(saved(session, source), 'vbN').fields.VariantConditions).toBe('V==1');
  });

  it('a field the envelope does not have takes no edit, which would have nowhere to go', () => {
    const json = JSON.parse(fixtureText());
    const entry = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: any) => e.name === 'vbN');
    const envelope = entry.value._elements[0]._custom_save;
    envelope._fields = envelope._fields.filter((f: string) => f !== 'Description');
    delete envelope._elements[0].Description;
    const text = JSON.stringify(json, null, '\t');
    const { session, source } = open(text);
    const node = entryIn(source, 'vbN');
    expect(rowOf(node).Description).toBe('');
    expect(node.setProperty('Description', 'x')).toMatchObject({
      error: true,
      reason: "'vbN' was read with no Description in its saved form, so a Description edit has nowhere to be saved.",
    });
    expect(textEntries(saved(session, source) as string)).toEqual(textEntries(text));
  });
});

// ═══ Simulink.VariantBankCoderInfo ═══════════════════════════════════════════════════════════
//
// The coder info a bank names, and the other class C-169 option (b) is about. MATLAB's class has
// HeaderFile, DefinitionFile, PreStatement, PostStatement and Qualifier, all char, all '' but
// Qualifier, which defaults to 'None'; and no Description. The node used to show none of the five
// (its Property Inspector a stray `Other._saveobj` row), and its Description cell took an edit,
// answered `true`, and both save paths dropped it.
//
// What MATLAB does, measured by the coder info SET and LOAD lines of make_variantbank_r2027a.m
// (R2027a 27.1.0.3409468), which also wrote ciA and ciB:
//   - HeaderFile and DefinitionFile: '' or a name whose first '.'-separated part, after any
//     leading spaces, is a C identifier that does not start with "rt"; a HeaderFile's extension
//     must be exactly h or hpp. PreStatement and PostStatement take any text.
//   - Qualifier: None, Const, Volatile or ConstVolatile, typed in any case, stored in that one.
//   - A dictionary holding a HeaderFile or DefinitionFile the setter refuses loads the WHOLE coder
//     info as defaults, with no warning; a Qualifier that is not one of the four as MATLAB spells
//     them (even 'const', which the setter takes) loads as 'None'; a field that is not text as ''.

const CI_FIELDS = ['HeaderFile', 'DefinitionFile', 'PreStatement', 'PostStatement', 'Qualifier'];
const CI_COLUMNS = ['headerFile', 'definitionFile', 'preStatement', 'postStatement', 'qualifier'];
const QUALIFIERS = ['None', 'Const', 'Volatile', 'ConstVolatile'];
const CI_WROTE: Record<string, Record<string, unknown>> = {
  ciA: { HeaderFile: 'h.h', DefinitionFile: 'd.c', PreStatement: 'pre', PostStatement: 'post', Qualifier: 'Const' },
  ciB: { HeaderFile: '', DefinitionFile: '', PreStatement: '', PostStatement: '', Qualifier: 'None' },
};
const MSG_FILE_NAME = (field: string) =>
  `'${field}' property for Simulink.VariantBankCoderInfo must be a valid C identifier that does not start with "rt".`;
const MSG_EXTENSION = (ext: string) => `Change file extension '${ext}' to header file extension '.h' or '.hpp'.`;
const MSG_QUALIFIER = (v: string) =>
  `Error setting property 'Qualifier' of class 'VariantBankCoderInfo': There is no enumerated value named '${v}'.`;
const NOT_CHECKED = (what: string) => expect.stringContaining(`is not a ${what} this editor can check`);
const MSG_LENGTH = (v: string) =>
  `Check specified header file name '${v}' for invalid characters, invalid file name length, and trailing spaces.`;

// The `<Element Class="Simulink.VariantBankCoderInfo">` of one entry, as the binary file spells it.
function coderInfoXml(xml: string, entry: string): string {
  const at = xml.indexOf(`<P Name="Name" Class="char">${entry}</P>`);
  expect(at, `no entry ${entry} in the chunk`).toBeGreaterThan(-1);
  const open = xml.indexOf('<Element Class="Simulink.VariantBankCoderInfo">', at);
  const close = xml.indexOf('</Object>', at);
  expect(open > at && open < close, `${entry} is not a coder info`).toBe(true);
  return xml.slice(open, close);
}
// What a save wrote for a coder info, as savedBank reads a bank.
function savedCoderInfo(content: Uint8Array | string, entry: string) {
  const node = entryIn(open(content).source, entry) as any;
  const bag = node.serial._properties as Record<string, any>;
  const fields = bag._saveobj._elements[0] as Record<string, unknown>;
  const spelled = typeof content === 'string'
    ? JSON.stringify(textEntries(content).find((e) => e.name === entry).value)
    : coderInfoXml(chunkXml(content), entry);
  return { node, keys: Object.keys(bag), fields, spelled };
}
const ciFieldsOf = (ci: Record<string, unknown>) => Object.fromEntries(CI_FIELDS.map((f) => [f, ci[f]]));

describe.each(FORMATS)('VariantBankCoderInfo fields (%s): a MATLAB-written coder info shows its own properties', (format) => {
  it('in the row, each in its own editable cell, HeaderFile in the Header File column, and no Description', () => {
    const { source } = open(fixture(format));
    expect(source.warnings).toBeUndefined();
    const shown = (entry: string) => Object.fromEntries(CI_COLUMNS.map((c) => [c, cellText(rowOf(entryIn(source, entry)), c)]));
    expect(shown('ciA')).toEqual({ headerFile: 'h.h', definitionFile: 'd.c', preStatement: 'pre', postStatement: 'post', qualifier: 'Const' });
    expect(shown('ciB')).toEqual({ headerFile: '', definitionFile: '', preStatement: '', postStatement: '', qualifier: 'None' });
    const row = rowOf(entryIn(source, 'ciA'));
    expect(row.headerFile).toMatchObject({ editable: true, editor: 'text' });
    expect(row.definitionFile).toMatchObject({ editable: true, editor: 'text' });
    expect(row.preStatement).toMatchObject({ editable: true, editor: 'textArea' });
    expect(row.postStatement).toMatchObject({ editable: true, editor: 'textArea' });
    expect(row.qualifier).toMatchObject({ editable: true, editor: 'select', options: QUALIFIERS });
    // MATLAB's class has no Description, so the cell offers none.
    expect(row.Description).toBe('');
    expect(row._descriptionEditable).toBe(false);
    // Value stays as C-169(a) left it: the class has none.
    expect(row.Value).toBe('');
    expect(row._valueEditable).toBe(false);
  });

  it('in the Property Inspector, under Code Generation, with no Description and no Other row', () => {
    const { groups, values, props } = pi(entryIn(open(fixture(format)).source, 'ciA'));
    expect(groups).toEqual([
      { name: 'General', items: ['Name', 'Value', 'DataType', 'Kind', 'Class'] },
      { name: 'Code Generation', items: CI_FIELDS },
    ]);
    expect(values).toMatchObject(CI_WROTE.ciA);
    expect(values).not.toHaveProperty('Description');
    expect(Object.keys(values).filter((k) => k.startsWith('Other.'))).toEqual([]);
    const label = (name: string) => props.find((p) => p.name === name)?.displayName;
    expect(CI_FIELDS.map(label)).toEqual(['Header File', 'Definition File', 'Pre Statement', 'Post Statement', 'Qualifier']);
  });

  it('and a save with no edit writes every coder info as it was read', () => {
    const { session, source } = open(fixture(format));
    const out = saved(session, source);
    for (const entry of Object.keys(CI_WROTE)) {
      const after = savedCoderInfo(out, entry);
      expect(ciFieldsOf(after.fields), entry).toEqual(CI_WROTE[entry]);
      expect(after.keys, entry).toEqual(['_saveobj']);
    }
    if (format === 'text') {
      expect(out).toBe(fixtureText());
    } else {
      expect(chunkXml(out as Uint8Array)).toBe(chunkXml(fixture('binary')));
    }
  });
});

// Each edit, by the column id the table sends: what it is typed as, the field it writes, and
// what is written there (and shown after). The odd-looking ones are MATLAB's own edges: it keeps
// a leading space, takes any '.'-separated parts after the first, takes a header file name of up
// to 255 characters (in each part of a path), and takes a definition file of any extension or none,
// and of any length: the header file's 255 is not a rule for it.
const CI_EDITS = [
  { column: 'headerFile', typed: 'x.h', field: 'HeaderFile', written: 'x.h' },
  { column: 'headerFile', typed: 'x.hpp', field: 'HeaderFile', written: 'x.hpp' },
  { column: 'headerFile', typed: '', field: 'HeaderFile', written: '' },
  { column: 'headerFile', typed: '_a.h', field: 'HeaderFile', written: '_a.h' },
  { column: 'headerFile', typed: 'RTa.h', field: 'HeaderFile', written: 'RTa.h' },
  { column: 'headerFile', typed: 'xrt.h', field: 'HeaderFile', written: 'xrt.h' },
  { column: 'headerFile', typed: 'a.c.h', field: 'HeaderFile', written: 'a.c.h' },
  { column: 'headerFile', typed: 'a.1b.h', field: 'HeaderFile', written: 'a.1b.h' },
  { column: 'headerFile', typed: 'a..hpp', field: 'HeaderFile', written: 'a..hpp' },
  { column: 'headerFile', typed: ' a.h', field: 'HeaderFile', written: ' a.h' },
  { column: 'headerFile', typed: '\ta.h', field: 'HeaderFile', written: '\ta.h' },
  { column: 'headerFile', typed: 'a'.repeat(253) + '.h', field: 'HeaderFile', written: 'a'.repeat(253) + '.h' },
  { column: 'headerFile', typed: 'a'.repeat(251) + '.hpp', field: 'HeaderFile', written: 'a'.repeat(251) + '.hpp' },
  { column: 'headerFile', typed: ' ' + 'a'.repeat(252) + '.h', field: 'HeaderFile', written: ' ' + 'a'.repeat(252) + '.h' },
  { column: 'headerFile', typed: 'a.' + 'b'.repeat(251) + '.h', field: 'HeaderFile', written: 'a.' + 'b'.repeat(251) + '.h' },
  { column: 'definitionFile', typed: 'x.cpp', field: 'DefinitionFile', written: 'x.cpp' },
  { column: 'definitionFile', typed: 'a.h', field: 'DefinitionFile', written: 'a.h' },
  { column: 'definitionFile', typed: 'a.txt', field: 'DefinitionFile', written: 'a.txt' },
  { column: 'definitionFile', typed: 'a', field: 'DefinitionFile', written: 'a' },
  { column: 'definitionFile', typed: 'a.', field: 'DefinitionFile', written: 'a.' },
  { column: 'definitionFile', typed: 'a.1', field: 'DefinitionFile', written: 'a.1' },
  { column: 'definitionFile', typed: 'int', field: 'DefinitionFile', written: 'int' },
  { column: 'definitionFile', typed: '', field: 'DefinitionFile', written: '' },
  // 302 characters, which MATLAB takes (the coder info SET lines), where a header file of that
  // length is refused (CI_REFUSED).
  { column: 'definitionFile', typed: 'a'.repeat(300) + '.c', field: 'DefinitionFile', written: 'a'.repeat(300) + '.c' },
  { column: 'preStatement', typed: '#pragma x', field: 'PreStatement', written: '#pragma x' },
  { column: 'preStatement', typed: 'a\nb', field: 'PreStatement', written: 'a\nb' },
  { column: 'preStatement', typed: '  x  ', field: 'PreStatement', written: '  x  ' },
  { column: 'preStatement', typed: '', field: 'PreStatement', written: '' },
  { column: 'postStatement', typed: "#pragma y // it's", field: 'PostStatement', written: "#pragma y // it's" },
  { column: 'postStatement', typed: 'é', field: 'PostStatement', written: 'é' },
  { column: 'qualifier', typed: 'Volatile', field: 'Qualifier', written: 'Volatile' },
  { column: 'qualifier', typed: 'ConstVolatile', field: 'Qualifier', written: 'ConstVolatile' },
  { column: 'qualifier', typed: 'None', field: 'Qualifier', written: 'None' },
  // Typed in any case, and stored in MATLAB's: a file holding 'const' loads as 'None'.
  { column: 'qualifier', typed: 'volatile', field: 'Qualifier', written: 'Volatile' },
  { column: 'qualifier', typed: 'CONSTVOLATILE', field: 'Qualifier', written: 'ConstVolatile' },
  { column: 'qualifier', typed: 'none', field: 'Qualifier', written: 'None' },
  // The property's own key reaches the same field as its column id.
  { column: 'HeaderFile', typed: 'byKey.h', field: 'HeaderFile', written: 'byKey.h' },
  { column: 'Qualifier', typed: 'volatile', field: 'Qualifier', written: 'Volatile' },
] as const;

describe.each(FORMATS)('VariantBankCoderInfo fields (%s): an edit is saved into the envelope, and nowhere else', (format) => {
  it.each(CI_EDITS)('$column = $typed', ({ column, typed, field, written }) => {
    const { session, source } = open(fixture(format));
    const node = entryIn(source, 'ciA');
    expect(node.setProperty(column, typed)).toBe(true);
    expect(node.status).toBe('Modified');
    const after = savedCoderInfo(saved(session, source), 'ciA');
    expect(ciFieldsOf(after.fields)).toEqual({ ...CI_WROTE.ciA, [field]: written });
    expect(after.keys).toEqual(['_saveobj']);
    if (format === 'text') {
      expect(JSON.parse(after.spelled)._elements[0]).not.toHaveProperty('_properties');
    } else {
      expect(after.spelled.split('<P Name="').length - 1, 'one P per envelope field').toBe(CI_FIELDS.length);
    }
    const shownColumn = CI_COLUMNS[CI_FIELDS.indexOf(field)];
    expect(cellText(rowOf(after.node), shownColumn)).toBe(written);
    // And nothing else in the dictionary moved.
    expect(ciFieldsOf(savedCoderInfo(saved(session, source), 'ciB').fields)).toEqual(CI_WROTE.ciB);
  });

  it('an edited default coder info is spelled as MATLAB spells the same coder info', () => {
    const { session, source } = open(fixture(format));
    const node = entryIn(source, 'ciB');
    for (const [column, typed] of [
      ['headerFile', 'h.h'], ['definitionFile', 'd.c'], ['preStatement', 'pre'], ['postStatement', 'post'], ['qualifier', 'const'],
    ]) {
      expect(node.setProperty(column, typed), column).toBe(true);
    }
    const ours = savedCoderInfo(saved(session, source), 'ciB').spelled;
    const matlab = savedCoderInfo(format === 'text' ? fixtureText() : fixture('binary'), 'ciA').spelled;
    expect(ours).toBe(matlab);
  });

  it('the text a cell shows, committed back, is no edit', () => {
    const { session, source } = open(fixture(format));
    const node = entryIn(source, 'ciA');
    const row = rowOf(node);
    for (const column of CI_COLUMNS) {
      expect(node.setProperty(column, row[column].text), column).toBe(true);
    }
    expect(node.status).not.toBe('Modified');
    expect(ciFieldsOf(savedCoderInfo(saved(session, source), 'ciA').fields)).toEqual(CI_WROTE.ciA);
  });
});

// One case per rule MATLAB's setter enforces (the coder info SET lines), with MATLAB's own
// message, and the names MATLAB takes that this editor does not check.
const CI_REFUSED = [
  // The extension, after the last '.' of the last part of a path: exactly h or hpp.
  { column: 'headerFile', typed: 'a.c', reason: MSG_EXTENSION('c') },
  { column: 'headerFile', typed: 'a.cpp', reason: MSG_EXTENSION('cpp') },
  { column: 'headerFile', typed: 'a.H', reason: MSG_EXTENSION('H') },
  { column: 'headerFile', typed: 'a.HPP', reason: MSG_EXTENSION('HPP') },
  { column: 'headerFile', typed: 'a.hh', reason: MSG_EXTENSION('hh') },
  { column: 'headerFile', typed: 'a', reason: MSG_EXTENSION('') },
  { column: 'headerFile', typed: 'a.', reason: MSG_EXTENSION('') },
  { column: 'headerFile', typed: 'a.h.c', reason: MSG_EXTENSION('c') },
  { column: 'headerFile', typed: 'a.h ', reason: MSG_EXTENSION('h ') },
  { column: 'headerFile', typed: 'a. h', reason: MSG_EXTENSION(' h') },
  { column: 'headerFile', typed: 'a.c/', reason: MSG_EXTENSION('c') },
  { column: 'headerFile', typed: 'a.h/x', reason: MSG_EXTENSION('') },
  // The first part, checked first: a C identifier that does not start with "rt".
  { column: 'headerFile', typed: 'a b.h', reason: MSG_FILE_NAME('HeaderFile') },
  { column: 'headerFile', typed: 'inc/a.h', reason: MSG_FILE_NAME('HeaderFile') },
  { column: 'headerFile', typed: 'inc\\a.h', reason: MSG_FILE_NAME('HeaderFile') },
  { column: 'headerFile', typed: '1a.h', reason: MSG_FILE_NAME('HeaderFile') },
  { column: 'headerFile', typed: '1a.c', reason: MSG_FILE_NAME('HeaderFile') },
  { column: 'headerFile', typed: 'rta.h', reason: MSG_FILE_NAME('HeaderFile') },
  { column: 'headerFile', typed: 'rt.h', reason: MSG_FILE_NAME('HeaderFile') },
  { column: 'headerFile', typed: ' rta.h', reason: MSG_FILE_NAME('HeaderFile') },
  { column: 'headerFile', typed: '.h', reason: MSG_FILE_NAME('HeaderFile') },
  { column: 'headerFile', typed: ' ', reason: MSG_FILE_NAME('HeaderFile') },
  { column: 'headerFile', typed: 'a-b.h', reason: MSG_FILE_NAME('HeaderFile') },
  { column: 'headerFile', typed: 'é.h', reason: MSG_FILE_NAME('HeaderFile') },
  { column: 'headerFile', typed: 'inc/', reason: MSG_FILE_NAME('HeaderFile') },
  { column: 'headerFile', typed: 'rt' + 'a'.repeat(300) + '.h', reason: MSG_FILE_NAME('HeaderFile') },
  { column: 'headerFile', typed: '1' + 'a'.repeat(300) + '.h', reason: MSG_FILE_NAME('HeaderFile') },
  // The length, checked next, before the extension: each '/'-separated part of the name at most
  // 255 characters, a leading space counted, and a character that decomposes (é is e and an
  // accent) counted as its parts. CI_EDITS has the longest names taken.
  ...['a'.repeat(254) + '.h', 'a'.repeat(252) + '.hpp', ' ' + 'a'.repeat(253) + '.h', 'a.' + 'b'.repeat(252) + '.h',
    'a'.repeat(300) + '.h', 'a'.repeat(300) + '.c', 'a'.repeat(300) + '.h ', 'a.' + 'é'.repeat(125) + 'xx.h',
    'a.' + 'ǖ'.repeat(84) + 'x.h', 'a.' + '€'.repeat(252) + '.h', 'a.' + '中'.repeat(252) + '.h', 'a.' + 'b'.repeat(260) + '/c.h']
    .map((typed) => ({ column: 'headerFile', typed, reason: MSG_LENGTH(typed) })),
  // MATLAB takes these (or, for '$.', refuses them for a token rule not measured here); this
  // editor does not check them, so they are not written.
  // Among them, names MATLAB takes at its length limit: 255 in a part, decomposed, or 257 in all
  // with no part longer than 253.
  ...['a.b/c.h', 'a.c/x.h', 'a.h/', 'a.hpp/', 'a. .h', 'a.-.h', 'a.c d.h', 'a.c$.h', 'a.é.h', 'a.' + 'é'.repeat(125) + 'x.h',
    'a.' + 'ǖ'.repeat(83) + 'x.h', 'a.' + '€'.repeat(251) + '.h', 'a.' + '中'.repeat(251) + '.h', 'a.b/' + 'c'.repeat(251) + '.h']
    .map((typed) => ({ column: 'headerFile', typed, reason: NOT_CHECKED('header file name') })),
  { column: 'definitionFile', typed: 'a b.c', reason: MSG_FILE_NAME('DefinitionFile') },
  { column: 'definitionFile', typed: '1a.c', reason: MSG_FILE_NAME('DefinitionFile') },
  { column: 'definitionFile', typed: 'rta.c', reason: MSG_FILE_NAME('DefinitionFile') },
  { column: 'definitionFile', typed: 'rt', reason: MSG_FILE_NAME('DefinitionFile') },
  { column: 'definitionFile', typed: '.c', reason: MSG_FILE_NAME('DefinitionFile') },
  { column: 'definitionFile', typed: 'x/a.c', reason: MSG_FILE_NAME('DefinitionFile') },
  { column: 'definitionFile', typed: 'a/', reason: MSG_FILE_NAME('DefinitionFile') },
  { column: 'definitionFile', typed: 'a .c', reason: MSG_FILE_NAME('DefinitionFile') },
  { column: 'definitionFile', typed: 'a\nb', reason: MSG_FILE_NAME('DefinitionFile') },
  ...['a.c ', 'a.c/', 'a.$', 'a. b', 'a.c/x', 'a.c d'].map((typed) => ({ column: 'definitionFile', typed, reason: NOT_CHECKED('definition file name') })),
  ...['foo', '', ' const', 'const ', 'Const Volatile', 'const volatile', 'VolatileConst', 'Con', 'c', 'None ', 'Const_Volatile', 'Restrict']
    .map((typed) => ({ column: 'qualifier', typed, reason: MSG_QUALIFIER(typed) })),
];

describe.each(FORMATS)('VariantBankCoderInfo fields (%s): a value MATLAB would refuse is refused', (format) => {
  it.each(CI_REFUSED)('$column = $typed', ({ column, typed, reason }) => {
    const { session, source } = open(fixture(format));
    const node = entryIn(source, 'ciA');
    const before = cellText(rowOf(node), column);
    const result = node.setProperty(column, typed) as any;
    expect(result).toMatchObject({ error: true, reason, invalidValue: typed, validValue: before });
    expect(node.status).not.toBe('Modified');
    expect(cellText(rowOf(node), column)).toBe(before);
    expect(ciFieldsOf(savedCoderInfo(saved(session, source), 'ciA').fields)).toEqual(CI_WROTE.ciA);
  });

  it('a Description, which the class does not have, is refused rather than taken and dropped', () => {
    const { session, source } = open(fixture(format));
    const node = entryIn(source, 'ciA');
    expect(node.setProperty('Description', 'kept?')).toMatchObject({
      error: true,
      reason: "A Variant Bank Coder Info has no Description in a dictionary, so one cannot be saved for 'ciA'.",
      invalidValue: 'kept?',
    });
    expect(node.status).not.toBe('Modified');
    expect(rowOf(node).Description).toBe('');
    const out = saved(session, source);
    if (format === 'text') {
      expect(out).toBe(fixtureText());
    } else {
      expect(chunkXml(out as Uint8Array)).toBe(chunkXml(fixture('binary')));
    }
  });
});

describe('VariantBankCoderInfo fields: a new coder info', () => {
  it('starts as the envelope MATLAB writes, showing its defaults, and takes an edit into it', () => {
    const node = VariantBankCoderInfoNode.createDefault('ciNew', null) as any;
    const before = node.serializeValue();
    expect(before._elements[0]).toEqual({
      _custom_save: { _array_type: 'Struct', _dimensions: [1, 1], _fields: CI_FIELDS, _elements: [CI_WROTE.ciB] },
    });
    const row = rowOf(node);
    expect(CI_COLUMNS.map((c) => row[c].text)).toEqual(['', '', '', '', 'None']);
    expect(node.setProperty('headerFile', 'n.h')).toBe(true);
    expect(node.setProperty('qualifier', 'volatile')).toBe(true);
    const after = node.serializeValue()._elements[0];
    expect(after).not.toHaveProperty('_properties');
    expect(after._custom_save._elements[0]).toEqual({ ...CI_WROTE.ciB, HeaderFile: 'n.h', Qualifier: 'Volatile' });
    expect(node._getSerializedProperties()).toEqual({ _saveobj: after._custom_save });
  });
});

describe.each(FORMATS)('VariantBankCoderInfo fields (%s): an edit through the session is undone exactly', (format) => {
  it('to the value as read, which a save then writes as read', () => {
    const { session, source } = open(fixture(format));
    const node = entryIn(source, 'ciA');
    session.setActiveContext(source);
    session.setActive(source, node);
    expect(session.editProperty(node.id, 'qualifier', 'volatile')).toBe(true);
    expect(session.editProperty(node.id, 'headerFile', 'other.h')).toBe(true);
    session.undo();
    session.undo();
    expect(cellText(rowOf(node), 'qualifier')).toBe('Const');
    expect(cellText(rowOf(node), 'headerFile')).toBe('h.h');
    expect(ciFieldsOf(savedCoderInfo(saved(session, source), 'ciA').fields)).toEqual(CI_WROTE.ciA);
  });
});

// ciA in the text dictionary with one field edited by hand, as the coder info LOAD lines edited
// it, with what MATLAB read (in the comment), what is shown here, and the clause the warning
// carries (null: MATLAB reads it as written, so there is none).
const WHOLE_CODER_INFO = 'which MATLAB reads as a coder info with every property at its default';
const CI_HAND_EDITS = [
  // MATLAB: Qualifier 'None', the rest as written.
  { what: 'Qualifier const', from: '"Qualifier": "Const"', to: '"Qualifier": "const"', column: 'qualifier', shown: 'const', says: "its Qualifier 'const' is not None, Const, Volatile or ConstVolatile as MATLAB spells them, which MATLAB reads as 'None'" },
  { what: 'Qualifier CONST', from: '"Qualifier": "Const"', to: '"Qualifier": "CONST"', column: 'qualifier', shown: 'CONST', says: "its Qualifier 'CONST' is not None" },
  { what: 'Qualifier volatile', from: '"Qualifier": "Const"', to: '"Qualifier": "volatile"', column: 'qualifier', shown: 'volatile', says: "its Qualifier 'volatile' is not None" },
  { what: 'Qualifier foo', from: '"Qualifier": "Const"', to: '"Qualifier": "foo"', column: 'qualifier', shown: 'foo', says: "its Qualifier 'foo' is not None" },
  { what: 'Qualifier empty', from: '"Qualifier": "Const"', to: '"Qualifier": ""', column: 'qualifier', shown: '', says: "its Qualifier '' is not None" },
  { what: 'Qualifier a number', from: '"Qualifier": "Const"', to: '"Qualifier": 5', column: 'qualifier', shown: '5', says: "its Qualifier is not text, which MATLAB reads as 'None'" },
  // MATLAB: as written.
  { what: 'Qualifier Volatile', from: '"Qualifier": "Const"', to: '"Qualifier": "Volatile"', column: 'qualifier', shown: 'Volatile', says: null },
  { what: 'Qualifier ConstVolatile', from: '"Qualifier": "Const"', to: '"Qualifier": "ConstVolatile"', column: 'qualifier', shown: 'ConstVolatile', says: null },
  // MATLAB: the whole coder info as defaults.
  { what: 'HeaderFile a.c', from: '"HeaderFile": "h.h"', to: '"HeaderFile": "a.c"', column: 'headerFile', shown: 'a.c', says: `its HeaderFile 'a.c' is not a header file name MATLAB takes, ${WHOLE_CODER_INFO}` },
  { what: 'HeaderFile a b.h', from: '"HeaderFile": "h.h"', to: '"HeaderFile": "a b.h"', column: 'headerFile', shown: 'a b.h', says: "its HeaderFile 'a b.h' is not a header file name MATLAB takes" },
  { what: 'HeaderFile inc/a.h', from: '"HeaderFile": "h.h"', to: '"HeaderFile": "inc/a.h"', column: 'headerFile', shown: 'inc/a.h', says: "its HeaderFile 'inc/a.h' is not a header file name MATLAB takes" },
  { what: 'HeaderFile rta.h', from: '"HeaderFile": "h.h"', to: '"HeaderFile": "rta.h"', column: 'headerFile', shown: 'rta.h', says: "its HeaderFile 'rta.h' is not a header file name MATLAB takes" },
  { what: 'HeaderFile 256 characters', from: '"HeaderFile": "h.h"', to: `"HeaderFile": "${'a'.repeat(254)}.h"`, column: 'headerFile', shown: 'a'.repeat(254) + '.h', says: `its HeaderFile '${'a'.repeat(40)}...' is not a header file name MATLAB takes (it is longer than the 255 characters MATLAB takes in a file or folder name), ${WHOLE_CODER_INFO}` },
  { what: 'HeaderFile 302 characters', from: '"HeaderFile": "h.h"', to: `"HeaderFile": "${'a'.repeat(300)}.h"`, column: 'headerFile', shown: 'a'.repeat(300) + '.h', says: `(it is longer than the 255 characters MATLAB takes in a file or folder name), ${WHOLE_CODER_INFO}` },
  { what: 'HeaderFile of 131 characters, 256 decomposed', from: '"HeaderFile": "h.h"', to: `"HeaderFile": "a.${'é'.repeat(125)}xx.h"`, column: 'headerFile', shown: `a.${'é'.repeat(125)}xx.h`, says: `(it is longer than the 255 characters MATLAB takes in a file or folder name), ${WHOLE_CODER_INFO}` },
  { what: 'HeaderFile with a folder of 262 characters', from: '"HeaderFile": "h.h"', to: `"HeaderFile": "a.${'b'.repeat(260)}/c.h"`, column: 'headerFile', shown: `a.${'b'.repeat(260)}/c.h`, says: `(it is longer than the 255 characters MATLAB takes in a file or folder name), ${WHOLE_CODER_INFO}` },
  // MATLAB: HeaderFile '', the rest as written.
  { what: 'HeaderFile a number', from: '"HeaderFile": "h.h"', to: '"HeaderFile": 5', column: 'headerFile', shown: '5', says: "its HeaderFile is not text, which MATLAB reads as ''" },
  // MATLAB: as written, though an edit would not write a.h/, the name with a '/' or the one with é.
  { what: 'HeaderFile empty', from: '"HeaderFile": "h.h"', to: '"HeaderFile": ""', column: 'headerFile', shown: '', says: null },
  { what: 'HeaderFile a.hpp', from: '"HeaderFile": "h.h"', to: '"HeaderFile": "a.hpp"', column: 'headerFile', shown: 'a.hpp', says: null },
  { what: 'HeaderFile with a leading space', from: '"HeaderFile": "h.h"', to: '"HeaderFile": " h.h"', column: 'headerFile', shown: ' h.h', says: null },
  { what: 'HeaderFile a.c.h', from: '"HeaderFile": "h.h"', to: '"HeaderFile": "a.c.h"', column: 'headerFile', shown: 'a.c.h', says: null },
  { what: 'HeaderFile a.h/', from: '"HeaderFile": "h.h"', to: '"HeaderFile": "a.h/"', column: 'headerFile', shown: 'a.h/', says: null },
  { what: 'HeaderFile 255 characters', from: '"HeaderFile": "h.h"', to: `"HeaderFile": "${'a'.repeat(253)}.h"`, column: 'headerFile', shown: 'a'.repeat(253) + '.h', says: null },
  { what: 'HeaderFile of 257 characters in two parts', from: '"HeaderFile": "h.h"', to: `"HeaderFile": "a.b/${'c'.repeat(251)}.h"`, column: 'headerFile', shown: `a.b/${'c'.repeat(251)}.h`, says: null },
  { what: 'HeaderFile of 130 characters, 255 decomposed', from: '"HeaderFile": "h.h"', to: `"HeaderFile": "a.${'é'.repeat(125)}x.h"`, column: 'headerFile', shown: `a.${'é'.repeat(125)}x.h`, says: null },
  // MATLAB: the whole coder info as defaults.
  { what: 'DefinitionFile a b.c', from: '"DefinitionFile": "d.c"', to: '"DefinitionFile": "a b.c"', column: 'definitionFile', shown: 'a b.c', says: `its DefinitionFile 'a b.c' is not a definition file name MATLAB takes, ${WHOLE_CODER_INFO}` },
  { what: 'DefinitionFile 1a.c', from: '"DefinitionFile": "d.c"', to: '"DefinitionFile": "1a.c"', column: 'definitionFile', shown: '1a.c', says: "its DefinitionFile '1a.c' is not a definition file name MATLAB takes" },
  // MATLAB: DefinitionFile '', the rest as written.
  { what: 'DefinitionFile a number', from: '"DefinitionFile": "d.c"', to: '"DefinitionFile": 5', column: 'definitionFile', shown: '5', says: "its DefinitionFile is not text, which MATLAB reads as ''" },
  // MATLAB: as written.
  { what: 'DefinitionFile a.txt', from: '"DefinitionFile": "d.c"', to: '"DefinitionFile": "a.txt"', column: 'definitionFile', shown: 'a.txt', says: null },
  { what: 'DefinitionFile with a trailing space', from: '"DefinitionFile": "d.c"', to: '"DefinitionFile": "d.c "', column: 'definitionFile', shown: 'd.c ', says: null },
  // MATLAB: that statement '', the rest as written.
  { what: 'PreStatement a number', from: '"PreStatement": "pre"', to: '"PreStatement": 5', column: 'preStatement', shown: '5', says: "its PreStatement is not text, which MATLAB reads as ''" },
  { what: 'PostStatement a number', from: '"PostStatement": "post"', to: '"PostStatement": 5', column: 'postStatement', shown: '5', says: "its PostStatement is not text, which MATLAB reads as ''" },
  // MATLAB: as written.
  { what: 'PostStatement two lines', from: '"PostStatement": "post"', to: '"PostStatement": "a\\nb"', column: 'postStatement', shown: 'a\nb', says: null },
];

describe('VariantBankCoderInfo fields: a hand-edited coder info is shown as read, never refused, and saved as read', () => {
  it.each(CI_HAND_EDITS)('$what', ({ from, to, column, shown, says }) => {
    const text = handEdited(from, to);
    const { session, source } = open(text);
    expect(cellText(rowOf(entryIn(source, 'ciA')), column)).toBe(shown);
    const warnings: ParseWarning[] = source.warnings ?? [];
    if (says === null) {
      expect(warnings).toEqual([]);
    } else {
      expect(warnings.map((w) => w.part)).toEqual(['ciA']);
      expect(warnings[0].code).toBe('part-unreadable');
      expect(warnings[0].message).toContain('"ciA" holds a Simulink.VariantBankCoderInfo MATLAB does not read as written: ');
      expect(warnings[0].message).toContain(says);
    }
    expect(saved(session, source)).toBe(text);
  });

  it('in a binary dictionary too', () => {
    const bytes = withXml((xml) => xml.replace('<P Name="Qualifier" Class="char">Const</P>', '<P Name="Qualifier" Class="char">const</P>'));
    const { session, source } = open(bytes);
    expect(cellText(rowOf(entryIn(source, 'ciA')), 'qualifier')).toBe('const');
    expect((source.warnings ?? []).map((w: ParseWarning) => w.part)).toEqual(['ciA']);
    expect(coderInfoXml(chunkXml(saved(session, source) as Uint8Array), 'ciA')).toContain('<P Name="Qualifier" Class="char">const</P>');
  });

  it('an edit repairs it, in MATLAB\'s spelling, and the rest is written as read', () => {
    const { session, source } = open(handEdited('"Qualifier": "Const"', '"Qualifier": "const"'));
    expect(entryIn(source, 'ciA').setProperty('qualifier', 'Const')).toBe(true);
    expect(ciFieldsOf(savedCoderInfo(saved(session, source), 'ciA').fields)).toEqual(CI_WROTE.ciA);
  });

  it('a field that is not text is undone to itself, which its own text could not do', () => {
    const text = handEdited('"HeaderFile": "h.h"', '"HeaderFile": 5');
    const { session, source } = open(text);
    const node = entryIn(source, 'ciA');
    session.setActiveContext(source);
    session.setActive(source, node);
    expect(session.editProperty(node.id, 'headerFile', 'x.h')).toBe(true);
    session.undo();
    expect(cellText(rowOf(node), 'headerFile')).toBe('5');
    expect(savedCoderInfo(saved(session, source), 'ciA').fields).toEqual({ ...CI_WROTE.ciA, HeaderFile: 5 });
  });

  it('a field the envelope does not have takes no edit, which would have nowhere to go', () => {
    const json = JSON.parse(fixtureText());
    const entry = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: any) => e.name === 'ciA');
    const envelope = entry.value._elements[0]._custom_save;
    envelope._fields = envelope._fields.filter((f: string) => f !== 'Qualifier');
    delete envelope._elements[0].Qualifier;
    const text = JSON.stringify(json, null, '\t');
    const { session, source } = open(text);
    const node = entryIn(source, 'ciA');
    expect(cellText(rowOf(node), 'qualifier')).toBe('');
    expect(node.setProperty('qualifier', 'Volatile')).toMatchObject({
      error: true,
      reason: "'ciA' was read with no Qualifier in its saved form, so a Qualifier edit has nowhere to be saved.",
    });
    expect(textEntries(saved(session, source) as string)).toEqual(textEntries(text));
  });
});

// ─── R2026b's spelling ────────────────────────────────────────────────────────────────────────

// A text dictionary R2026b wrote holds a coder info as plain properties, with no envelope
// (two such dictionaries): `"_elements": [{"_id": "1", "_properties":
// {"DefinitionFile": "", "HeaderFile": "", "PostStatement": "", "PreStatement": "", "Qualifier":
// "None"}}]`. R2027a reads it property by property, through the setters (the r2026b LOAD lines of
// make_variantbank_r2027a.m, which respell ciA so, and a copy of one of those dictionaries edited
// by hand): HeaderFile 'x.h' and Qualifier 'Const' as written, a Qualifier 'const' as 'Const' and
// 'foo' as 'None', and a HeaderFile 'a.c', a DefinitionFile 'a b.c' or a HeaderFile 5 as '' with
// every other property as written. This is the committed R2027a text fixture with ciA and ciB
// spelled that way.
function r2026b(text: string = fixtureText()): string {
  const json = JSON.parse(text);
  for (const entry of json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries) {
    if (entry.value?._array_class !== 'Simulink.VariantBankCoderInfo') {
      continue;
    }
    const fields = entry.value._elements[0]._custom_save._elements[0];
    entry.value._elements[0] = { _id: '1', _properties: Object.fromEntries(Object.keys(fields).sort().map((k) => [k, fields[k]])) };
  }
  return JSON.stringify(json, null, '\t');
}
const plainOf = (text: string, entry: string) => textEntries(text).find((e) => e.name === entry).value._elements[0];

describe('VariantBankCoderInfo fields: a coder info R2026b wrote, as plain properties', () => {
  it('is shown from them, with no Other row and no warning', () => {
    const { source } = open(r2026b());
    expect(source.warnings).toBeUndefined();
    const node = entryIn(source, 'ciA');
    expect(Object.fromEntries(CI_COLUMNS.map((c) => [c, cellText(rowOf(node), c)]))).toEqual({
      headerFile: 'h.h', definitionFile: 'd.c', preStatement: 'pre', postStatement: 'post', qualifier: 'Const',
    });
    const { values } = pi(node);
    expect(values).toMatchObject(CI_WROTE.ciA);
    expect(Object.keys(values).filter((k) => k.startsWith('Other.'))).toEqual([]);
    expect(cellText(rowOf(entryIn(source, 'ciB')), 'qualifier')).toBe('None');
  });

  it('takes an edit into the plain property, in MATLAB\'s spelling, and invents no envelope', () => {
    const text = r2026b();
    const { session, source } = open(text);
    expect(saved(session, source)).toBe(text);
    const node = entryIn(source, 'ciA');
    expect(node.setProperty('qualifier', 'volatile')).toBe(true);
    expect(node.setProperty('headerFile', 'x.h')).toBe(true);
    expect(node.setProperty('headerFile', 'a.c')).toMatchObject({ error: true, reason: MSG_EXTENSION('c') });
    const out = saved(session, source) as string;
    const element = plainOf(out, 'ciA');
    expect(element).not.toHaveProperty('_custom_save');
    expect(element._properties).toEqual({ ...CI_WROTE.ciA, Qualifier: 'Volatile', HeaderFile: 'x.h' });
    expect(cellText(rowOf(entryIn(open(out).source, 'ciA')), 'qualifier')).toBe('Volatile');
    expect(plainOf(out, 'ciB')).toEqual(plainOf(text, 'ciB'));
  });

  it.each([
    { what: 'HeaderFile a.c', field: 'HeaderFile', value: 'a.c', column: 'headerFile', shown: 'a.c', says: "its HeaderFile 'a.c' is not a header file name MATLAB takes, which MATLAB reads as ''" },
    { what: 'DefinitionFile a b.c', field: 'DefinitionFile', value: 'a b.c', column: 'definitionFile', shown: 'a b.c', says: "its DefinitionFile 'a b.c' is not a definition file name MATLAB takes, which MATLAB reads as ''" },
    { what: 'HeaderFile a number', field: 'HeaderFile', value: 5, column: 'headerFile', shown: '5', says: "its HeaderFile is not text, which MATLAB reads as ''" },
    { what: 'HeaderFile 256 characters', field: 'HeaderFile', value: 'a'.repeat(254) + '.h', column: 'headerFile', shown: 'a'.repeat(254) + '.h', says: "(it is longer than the 255 characters MATLAB takes in a file or folder name), which MATLAB reads as ''" },
    // MATLAB: as written.
    { what: 'HeaderFile 255 characters', field: 'HeaderFile', value: 'a'.repeat(253) + '.h', column: 'headerFile', shown: 'a'.repeat(253) + '.h', says: null },
    { what: 'Qualifier foo', field: 'Qualifier', value: 'foo', column: 'qualifier', shown: 'foo', says: "its Qualifier 'foo' is not None, Const, Volatile or ConstVolatile, which MATLAB reads as 'None'" },
    // MATLAB: 'Const', read through the setter; so not reported.
    { what: 'Qualifier const', field: 'Qualifier', value: 'const', column: 'qualifier', shown: 'const', says: null },
  ])('hand-edited, $what, is shown as read and saved as read, warned as MATLAB reads it', ({ field, value, column, shown, says }) => {
    const json = JSON.parse(r2026b());
    json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: any) => e.name === 'ciA').value._elements[0]._properties[field] = value;
    const text = JSON.stringify(json, null, '\t');
    const { session, source } = open(text);
    expect(cellText(rowOf(entryIn(source, 'ciA')), column)).toBe(shown);
    const warnings: ParseWarning[] = source.warnings ?? [];
    if (says === null) {
      expect(warnings).toEqual([]);
    } else {
      expect(warnings.map((w) => w.part)).toEqual(['ciA']);
      expect(warnings[0].message).toContain(says);
      expect(warnings[0].message).not.toContain(WHOLE_CODER_INFO);
    }
    expect(saved(session, source)).toBe(text);
  });
});

// ─── A saveobj envelope spelled <P Name="undefined"> ──────────────────────────────────────────

// An earlier version of this package wrote a saveobj envelope back as `<P Name="undefined"
// Class="struct">` (its absent Name keyed under the string 'undefined'; DataNode.pxAttrs), in place
// of MATLAB's `<P Source="saveobj" PropertyType="any" Class="struct">`, and a dictionary saved so
// still holds a coder info that way. The node reads the five properties from the envelope, or
// from R2026b's plain properties, and found neither there, so the coder info showed blank, with
// its state only as an `Other.undefined` row and no warning (S1-26, theme 1).
//
// What R2027a (27.1.0.3409468) makes of it, measured by test/parity/matlab/probe_coderinfo_undefined.m
// on files made from the R2027a fixtures (coderinfo_undefined.mjs), whose truth is read here, with
// no warning in any case:
//   - in a binary dictionary it cannot make the coder info at all: the entry's value fails with
//     "Data dictionary unable to create an object of class 'Simulink.VariantBankCoderInfo'.",
//     while the dictionary and its other entries open as written;
//   - a text dictionary's plain bag holding only that struct is read as a coder info with every
//     property at its default;
//   - and one holding the five properties too is read from those, the 'undefined' ignored, as is
//     one holding only some of the five, or one of them alone (controls below), the others at
//     their defaults.
// So the coder info is shown as read, with one warning that names 'undefined' and says what
// MATLAB does, and it is saved as read. An edit of one of its five has nowhere to be saved, as
// for any field the file does not have.
type UndefinedCase = { id: string; format: Format; entries: string[]; beside?: boolean; shape?: 'envelope-beside' | 'empty' | 'other' | 'partial'; fields?: string[]; sha256: string };
type CoderInfoRead = Record<string, string>;
const UNDEFINED_TRUTH: { release: string; cases: UndefinedCase[]; rows: { id: string; warning: string; reads: Record<string, CoderInfoRead> }[] } = JSON.parse(
  readFileSync(fileURLToPath(new URL('./parity/matlab/coderinfo_undefined.truth.json', import.meta.url)), 'utf8'),
);
const ENVELOPE_XML = '<P Source="saveobj" PropertyType="any" Class="struct">';
const UNDEFINED_XML = '<P Name="undefined" Class="struct">';
const OTHER_VALUES = { DefinitionFile: 'u.c', HeaderFile: 'u.h', PostStatement: 'upost', PreStatement: 'upre', Qualifier: 'Volatile' };
// The file a case of the truth names, made as coderinfo_undefined.mjs made it, and checked to be
// the one MATLAB opened (a binary file by its chunk, as the zip around it carries the time it was
// made).
function undefinedCaseFile(id: string): Uint8Array | string {
  const c = UNDEFINED_TRUTH.cases.find((k) => k.id === id)!;
  const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
  if (c.format === 'binary') {
    let edited = '';
    const bytes = c.entries.length === 0 ? fixture('binary') : withXml((xml) => {
      edited = xml;
      for (const entry of c.entries) {
        const element = coderInfoXml(edited, entry);
        const at = edited.indexOf(element);
        expect(element.startsWith(`<Element Class="Simulink.VariantBankCoderInfo">\n${' '.repeat(16)}${ENVELOPE_XML}`), entry).toBe(true);
        // The envelope kept, and an 'undefined' struct of other values after it.
        const close = `${' '.repeat(16)}</P>\n${' '.repeat(12)}</Element>`;
        expect(element.includes(close), entry).toBe(true);
        const sibling = [`${' '.repeat(16)}${UNDEFINED_XML}`, `${' '.repeat(20)}<Element>`,
          ...CI_FIELDS.map((f) => `${' '.repeat(24)}<P Name="${f}" Class="char">${OTHER_VALUES[f as keyof typeof OTHER_VALUES]}</P>`),
          `${' '.repeat(20)}</Element>`, `${' '.repeat(16)}</P>`, ''].join('\n');
        const changed = c.shape === 'envelope-beside'
          ? element.replace(close, `${' '.repeat(16)}</P>\n${sibling}${' '.repeat(12)}</Element>`)
          : element.replace(ENVELOPE_XML, UNDEFINED_XML);
        edited = edited.slice(0, at) + changed + edited.slice(at + element.length);
      }
      return edited;
    });
    expect(sha(chunkXml(bytes)), `${id} is the file MATLAB read`).toBe(c.sha256);
    return bytes;
  }
  const json = JSON.parse(fixtureText());
  for (const entry of json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries) {
    if (c.entries.includes(entry.name)) {
      const envelope = entry.value._elements[0]._custom_save;
      const own = c.beside ? Object.fromEntries(Object.keys(envelope._elements[0]).sort().map((k) => [k, envelope._elements[0][k]])) : {};
      // `partial`: only the properties the case names, as the envelope holds them, then an
      // 'undefined' struct of other values.
      const some = Object.fromEntries((c.fields ?? []).map((k) => [k, envelope._elements[0][k]]));
      entry.value._elements[0] = c.shape === 'envelope-beside'
        ? { _custom_save: envelope, _id: '1', _properties: { undefined: { ...envelope, _elements: [OTHER_VALUES] } } }
        : c.shape === 'partial'
          ? { _id: '1', _properties: { ...some, undefined: { ...envelope, _elements: [OTHER_VALUES] } } }
          : c.shape !== undefined
          ? { _id: '1', _properties: c.shape === 'empty' ? {} : { Foo: 'x' } }
          : { _id: '1', _properties: { ...own, undefined: c.beside ? { ...envelope, _elements: [OTHER_VALUES] } : envelope } };
    }
  }
  const text = JSON.stringify(json, null, '\t');
  expect(sha(text), `${id} is the file MATLAB read`).toBe(c.sha256);
  return text;
}
const undefinedRead = (id: string) => UNDEFINED_TRUTH.rows.find((r) => r.id === id)!.reads;
const asRead = (ci: Record<string, unknown>) => ({ class: 'Simulink.VariantBankCoderInfo', ...ci });
const CI_DEFAULTS = CI_WROTE.ciB;
const NO_OBJECT = "Data dictionary unable to create an object of class 'Simulink.VariantBankCoderInfo'.";
const shownCoderInfo = (node: DataNode) => Object.fromEntries(CI_COLUMNS.map((c) => [c, cellText(rowOf(node), c)]));
const CI_SHOWN: Record<string, Record<string, string>> = {
  ciA: { headerFile: 'h.h', definitionFile: 'd.c', preStatement: 'pre', postStatement: 'post', qualifier: 'Const' },
  ciB: { headerFile: '', definitionFile: '', preStatement: '', postStatement: '', qualifier: 'None' },
};
const BLANK = { headerFile: '', definitionFile: '', preStatement: '', postStatement: '', qualifier: '' };
const UNDEFINED_SAYS = {
  binary: "its properties are held in a property named 'undefined' instead of the saveobj envelope MATLAB reads, so MATLAB cannot read it at all (getting its value fails)",
  text: "its properties are held in a property named 'undefined' instead of as its own, which MATLAB reads as a coder info with every property at its default",
};

describe('VariantBankCoderInfo fields: a coder info whose envelope is spelled <P Name="undefined">', () => {
  const DAMAGED = [
    { id: 'b_ciA_undefined', damaged: ['ciA'] },
    { id: 'b_both_undefined', damaged: ['ciA', 'ciB'] },
    { id: 't_ciA_undefined', damaged: ['ciA'] },
  ];
  // Not this: an 'undefined' beside the envelope MATLAB wrote, which MATLAB reads the envelope of;
  // a plain bag with neither the five nor an 'undefined', which MATLAB reads as every default;
  // and a plain bag with an 'undefined' beside only some of the five, which MATLAB reads from
  // those it holds, every other at its default. None is warned of, by MATLAB or here. Each of the
  // five is held alone in one of the partial bags, so a check that leaves any of them out warns of
  // that one.
  const CONTROLS = [
    { id: 'b_ciA_envelope_beside', read: CI_WROTE.ciA, shown: CI_SHOWN.ciA, other: ['Other.undefined'] },
    { id: 't_ciA_envelope_beside', read: CI_WROTE.ciA, shown: CI_SHOWN.ciA, other: ['Other.undefined'] },
    { id: 't_ciA_empty_bag', read: CI_DEFAULTS, shown: BLANK, other: [] },
    { id: 't_ciA_other_bag', read: CI_DEFAULTS, shown: BLANK, other: ['Other.Foo'] },
    { id: 't_ciA_partial_header', read: { ...CI_DEFAULTS, HeaderFile: 'h.h' }, shown: { ...BLANK, headerFile: 'h.h' }, other: ['Other.undefined'] },
    {
      id: 't_ciA_partial_definition', read: { ...CI_DEFAULTS, DefinitionFile: 'd.c', Qualifier: 'Const' },
      shown: { ...BLANK, definitionFile: 'd.c', qualifier: 'Const' }, other: ['Other.undefined'],
    },
    {
      id: 't_ciA_partial_definition_alone', read: { ...CI_DEFAULTS, DefinitionFile: 'd.c' },
      shown: { ...BLANK, definitionFile: 'd.c' }, other: ['Other.undefined'],
    },
    { id: 't_ciA_partial_qualifier', read: { ...CI_DEFAULTS, Qualifier: 'Const' }, shown: { ...BLANK, qualifier: 'Const' }, other: ['Other.undefined'] },
    { id: 't_ciA_partial_pre', read: { ...CI_DEFAULTS, PreStatement: 'pre' }, shown: { ...BLANK, preStatement: 'pre' }, other: ['Other.undefined'] },
    { id: 't_ciA_partial_post', read: { ...CI_DEFAULTS, PostStatement: 'post' }, shown: { ...BLANK, postStatement: 'post' }, other: ['Other.undefined'] },
  ];

  it('is a case MATLAB was given, each graded here, and MATLAB warned of none of them', () => {
    expect(UNDEFINED_TRUTH.release).toBe('2027a');
    expect(UNDEFINED_TRUTH.cases.map((c) => c.id).sort()).toEqual(['b_written', 't_ciA_undefined_beside', ...DAMAGED.map((d) => d.id), ...CONTROLS.map((c) => c.id)].sort());
    expect(UNDEFINED_TRUTH.rows.map((r) => r.warning).filter((w) => w !== '')).toEqual([]);
    // The binary fixture, as MATLAB wrote it, is read as written: the cases differ from it only
    // where they say.
    expect(undefinedRead('b_written')).toEqual({ ciA: asRead(CI_WROTE.ciA), ciB: asRead(CI_WROTE.ciB) });
    const { source } = open(undefinedCaseFile('b_written'));
    expect(source.warnings).toBeUndefined();
  });

  it.each(DAMAGED)('$id: is shown as read, warned of by name, and saved as read', ({ id, damaged }) => {
    const content = undefinedCaseFile(id);
    const format: Format = typeof content === 'string' ? 'text' : 'binary';
    // What MATLAB read: no coder info at all from a binary dictionary, every default from a text one.
    const reads = undefinedRead(id);
    for (const entry of ['ciA', 'ciB']) {
      const read = damaged.includes(entry) ? (format === 'binary' ? { error: NO_OBJECT } : asRead(CI_DEFAULTS)) : asRead(CI_WROTE[entry]);
      expect(reads[entry], `MATLAB's ${entry}`).toEqual(read);
    }
    const { session, source } = open(content);
    // Shown as read: the five are not in the file, and the struct is listed under Other.
    for (const entry of ['ciA', 'ciB']) {
      const node = entryIn(source, entry);
      expect(shownCoderInfo(node), entry).toEqual(damaged.includes(entry) ? BLANK : CI_SHOWN[entry]);
      expect(Object.keys(pi(node).values).filter((k) => k.startsWith('Other.')), entry).toEqual(damaged.includes(entry) ? ['Other.undefined'] : []);
    }
    // One warning for each, naming 'undefined', and saying what MATLAB does with it.
    const warnings: ParseWarning[] = source.warnings ?? [];
    expect(warnings.map((w) => [w.part, w.code])).toEqual(damaged.map((entry) => [entry, 'part-unreadable']));
    for (const [k, entry] of damaged.entries()) {
      expect(warnings[k].message).toBe(
        `"${entry}" holds a Simulink.VariantBankCoderInfo MATLAB does not read as written: ${UNDEFINED_SAYS[format]}. `
          + 'It is shown as read, and saved as read unless edited.',
      );
    }
    // An edit has nowhere to be saved, and the file is saved as read.
    const node = entryIn(source, damaged[0]);
    expect(node.setProperty('headerFile', 'x.h')).toMatchObject({
      error: true,
      reason: `'${damaged[0]}' was read with no HeaderFile in its saved form, so a Header File edit has nowhere to be saved.`,
    });
    const out = saved(session, source);
    if (typeof content === 'string') {
      expect(out).toBe(content);
    } else {
      expect(chunkXml(out as Uint8Array)).toBe(chunkXml(content));
    }
  });

  it('one that holds its own five properties too is read from them, as MATLAB reads it, with no warning', () => {
    expect(undefinedRead('t_ciA_undefined_beside')).toEqual({ ciA: asRead(CI_WROTE.ciA), ciB: asRead(CI_WROTE.ciB) });
    const text = undefinedCaseFile('t_ciA_undefined_beside') as string;
    const { session, source } = open(text);
    expect(source.warnings).toBeUndefined();
    expect(shownCoderInfo(entryIn(source, 'ciA'))).toEqual(CI_SHOWN.ciA);
    expect(saved(session, source)).toBe(text);
  });

  it.each(CONTROLS)('$id: is read as MATLAB reads it, and not warned of', ({ id, read, shown, other }) => {
    expect(undefinedRead(id)).toEqual({ ciA: asRead(read), ciB: asRead(CI_WROTE.ciB) });
    const content = undefinedCaseFile(id);
    const { session, source } = open(content);
    expect(source.warnings).toBeUndefined();
    const node = entryIn(source, 'ciA');
    expect(shownCoderInfo(node)).toEqual(shown);
    expect(Object.keys(pi(node).values).filter((k) => k.startsWith('Other.'))).toEqual(other);
    const out = saved(session, source);
    if (typeof content === 'string') {
      expect(out).toBe(content);
    } else {
      expect(chunkXml(out as Uint8Array)).toBe(chunkXml(content));
    }
  });
});

// ═══ A Simulink.VariantBank in R2026b's spelling ═════════════════════════════════════════════
//
// A text dictionary R2026b wrote holds a bank as plain properties too, with no envelope, as it
// holds a coder info (above). The bank used to be read out of the envelope alone, so there its
// four Variant Bank cells showed their defaults ('' and {}), the file's values showed only as
// Other rows, and every edit was refused, as having nowhere to be saved (S1-24; C-168, with
// #141's "the same fix shape C-169B uses").
//
// What MATLAB does with that spelling, measured on R2027a (27.1.0.3409468) by
// test/parity/matlab/probe_variantbank_plain.m, whose truth is read here: it reads the bag
// property by property, each through its setter, and gives no warning. A value a setter refuses
// is read as that property's default ALONE ('' for a name, no conditions for VariantConditions),
// not the whole bank as from an envelope; and a char VariantConditions, which the setter refuses,
// as no conditions, where an envelope's is read as a cell of that one condition. A field the bag
// does not have is read as its default, BankCoderInfo is read independently of the two coder
// infos, and a Value key or a key the class does not have is ignored. MATLAB also read back as
// written core's own saves of such a bank (the truth's save cases).
//
// The probe opened the text this helper makes (the R2027a fixture with its banks and coder infos
// respelled so, then one hand edit), which the sha256 its truth records pins.
type PlainEdit = { entries?: string[]; set?: Record<string, unknown>; drop?: string[]; order?: string[] };
type PlainRead = { class: string; Name: string; Description: string; VariantConditions: { class: string; size: number[]; elements: unknown[] }; AllChoicesCoderInfo: string; ActiveChoiceCoderInfo: string; BankCoderInfo: string };
type PlainCase = { id: string; kind: 'hand' | 'save'; what: string; edit?: PlainEdit; sha256?: string; edits?: [string, string, string][]; wrote?: Record<string, any> };
const PLAIN_TRUTH: { release: string; cases: PlainCase[]; rows: { id: string; warning: string; reads: Record<string, PlainRead> }[] } = JSON.parse(
  readFileSync(fileURLToPath(new URL('./parity/matlab/variantbank_plain.truth.json', import.meta.url)), 'utf8'),
);
const plainCase = (id: string) => PLAIN_TRUTH.cases.find((c) => c.id === id)!;
const matlabRead = (id: string) => PLAIN_TRUTH.rows.find((r) => r.id === id)!;

function plainBanks(edit: PlainEdit = {}): string {
  const json = JSON.parse(fixtureText());
  for (const entry of json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries) {
    if (entry.value?._array_class !== 'Simulink.VariantBank' && entry.value?._array_class !== 'Simulink.VariantBankCoderInfo') {
      continue;
    }
    let bag: Record<string, unknown> = { ...entry.value._elements[0]._custom_save._elements[0] };
    if ((edit.entries ?? []).includes(entry.name)) {
      Object.assign(bag, edit.set ?? {});
      for (const field of edit.drop ?? []) {
        delete bag[field];
      }
      if (edit.order) {
        const order = edit.order;
        bag = Object.fromEntries([...order.filter((k) => k in bag), ...Object.keys(bag).filter((k) => !order.includes(k))].map((k) => [k, bag[k]]));
      }
    }
    entry.value._elements[0] = { _id: '1', _properties: bag };
  }
  return JSON.stringify(json, null, '\t');
}
// The hand case `id`'s text, checked to be the one MATLAB opened.
function plainCaseText(id: string): string {
  const c = plainCase(id);
  const text = plainBanks(c.edit);
  expect(createHash('sha256').update(text, 'utf8').digest('hex'), `${id} is the file MATLAB read`).toBe(c.sha256);
  return text;
}
// A bank as MATLAB reads it: its fields, its conditions as the 1xN cell it holds.
function asMatlabReads(bank: Record<string, unknown>): Record<string, unknown> {
  return { ...bank, VariantConditions: cell(...(((bank.VariantConditions as any)._elements ?? []) as string[])) };
}
function readOf(read: PlainRead): Record<string, unknown> {
  expect(read.class).toBe('Simulink.VariantBank');
  expect(read.VariantConditions.class).toBe('cell');
  expect(read.VariantConditions.size).toEqual([1, read.VariantConditions.elements.length]);
  return {
    Name: read.Name, Description: read.Description, VariantConditions: cell(...(read.VariantConditions.elements as string[])),
    AllChoicesCoderInfo: read.AllChoicesCoderInfo, ActiveChoiceCoderInfo: read.ActiveChoiceCoderInfo, BankCoderInfo: read.BankCoderInfo,
  };
}
const BANK_COLUMNS = ['Description', 'bankName', 'variantConditions', 'allChoicesCoderInfo', 'activeChoiceCoderInfo'];
const shownCells = (node: DataNode) => Object.fromEntries(BANK_COLUMNS.map((c) => [c, cellText(rowOf(node), c)]));
// What a MATLAB-written bank shows (the first describe above), which the same bank in R2026b's
// spelling shows too.
const SHOWN: Record<string, Record<string, string>> = {
  vbN: { Description: 'desc A', bankName: 'bankA', variantConditions: "{'V == 1','V == 2'}", allChoicesCoderInfo: 'ciA', activeChoiceCoderInfo: 'ciB' },
  vb1: { Description: "two\nlines, it's", bankName: 'bankOne', variantConditions: "{'W > 0 && ~X'}", allChoicesCoderInfo: 'ciA', activeChoiceCoderInfo: 'ciA' },
  vbD: { Description: '', bankName: '', variantConditions: '{}', allChoicesCoderInfo: '', activeChoiceCoderInfo: '' },
};

describe('VariantBank fields: a bank R2026b wrote, as plain properties', () => {
  // Each hand case of the truth, on vbN unless named: the cell it shows (the rest of the bank
  // showing as written), the clause its warning carries (null: MATLAB reads it as written), and
  // what MATLAB read of the bank where it is not what the R2027a fixture holds, which the truth
  // must agree with. A bank whose bag has no such field takes no edit of it (`noEdit`).
  const NONE = cell();
  const PLAIN_HAND = [
    { id: 'h_name_1bad', column: 'bankName', shown: '1bad', says: `its Name '1bad' is not a valid C identifier that does not start with "rt", which MATLAB reads as ''`, matlab: { Name: '' } },
    { id: 'h_name_rtX', column: 'bankName', shown: 'rtX', says: `its Name 'rtX' is not a valid C identifier that does not start with "rt", which MATLAB reads as ''`, matlab: { Name: '' } },
    { id: 'h_name_number', column: 'bankName', shown: '5', says: "its Name is not text, which MATLAB reads as ''", matlab: { Name: '' } },
    { id: 'h_desc_number', column: 'Description', shown: '5', says: "its Description is not text, which MATLAB reads as ''", matlab: { Description: '' } },
    { id: 'h_all_1bad', column: 'allChoicesCoderInfo', shown: '1bad', says: "its AllChoicesCoderInfo '1bad' is not a valid variable name, which MATLAB reads as ''", matlab: { AllChoicesCoderInfo: '' } },
    { id: 'h_active_1bad', column: 'activeChoiceCoderInfo', shown: '1bad', says: "its ActiveChoiceCoderInfo '1bad' is not a valid variable name, which MATLAB reads as ''", matlab: { ActiveChoiceCoderInfo: '' } },
    { id: 'h_all_number', column: 'allChoicesCoderInfo', shown: '5', says: "its AllChoicesCoderInfo is not text, which MATLAB reads as ''", matlab: { AllChoicesCoderInfo: '' } },
    { id: 'h_cond_unspaced', column: 'variantConditions', shown: "{'V==1','V == 2'}", says: null, matlab: {} },
    { id: 'h_cond_unparsable', column: 'variantConditions', shown: "{'V == 1','V =='}", says: "its condition 'V ==' does not parse, which MATLAB reads as no conditions", matlab: { VariantConditions: NONE } },
    { id: 'h_cond_enum', column: 'variantConditions', shown: "{'V == 1','V == E.A'}", says: null, matlab: { VariantConditions: cell('V == 1', 'V == E.A') } },
    { id: 'h_cond_empty', column: 'variantConditions', shown: "{'V == 1',''}", says: 'its condition at position 2 is empty, which MATLAB reads as no conditions', matlab: { VariantConditions: NONE } },
    { id: 'h_cond_number', column: 'variantConditions', shown: "{'V == 1',2}", says: 'its condition at position 2 is not text, which MATLAB reads as no conditions', matlab: { VariantConditions: NONE } },
    { id: 'h_conds_char', column: 'variantConditions', shown: "'V==1'", says: 'its VariantConditions is not a cell, which MATLAB reads as no conditions', matlab: { VariantConditions: NONE } },
    { id: 'h_conds_number', column: 'variantConditions', shown: '5', says: 'its VariantConditions is not a cell, which MATLAB reads as no conditions', matlab: { VariantConditions: NONE } },
    { id: 'h_conds_2x1', column: 'variantConditions', shown: "{'V == 1';'V == 2'}", says: null, matlab: {} },
    { id: 'h_vb1_all_ciB', entry: 'vb1', column: 'allChoicesCoderInfo', shown: 'ciB', says: null, matlab: { AllChoicesCoderInfo: 'ciB' } },
    { id: 'h_vb1_all_ciB_after', entry: 'vb1', column: 'allChoicesCoderInfo', shown: 'ciB', says: null, matlab: { AllChoicesCoderInfo: 'ciB' } },
    { id: 'h_vb1_active_ciB', entry: 'vb1', column: 'activeChoiceCoderInfo', shown: 'ciB', says: null, matlab: { ActiveChoiceCoderInfo: 'ciB' } },
    { id: 'h_vb1_bank_empty', entry: 'vb1', column: 'allChoicesCoderInfo', shown: 'ciA', says: null, matlab: { BankCoderInfo: '' } },
    { id: 'h_vb1_bank_ciB', entry: 'vb1', column: 'allChoicesCoderInfo', shown: 'ciA', says: null, matlab: { BankCoderInfo: 'ciB' } },
    { id: 'h_vb1_bank_1bad', entry: 'vb1', column: 'allChoicesCoderInfo', shown: 'ciA', says: "its BankCoderInfo '1bad' is not a valid variable name, which MATLAB reads as ''", matlab: { BankCoderInfo: '' } },
    { id: 'h_no_bank', entry: 'vb1', column: 'allChoicesCoderInfo', shown: 'ciA', says: null, matlab: { BankCoderInfo: '' } },
    { id: 'h_no_desc', column: 'Description', shown: '', says: null, matlab: { Description: '' }, noEdit: ['Description', 'Description'] },
    { id: 'h_no_name', column: 'bankName', shown: '', says: null, matlab: { Name: '' }, noEdit: ['bankName', 'Name'] },
    { id: 'h_no_conds', column: 'variantConditions', shown: '{}', says: null, matlab: { VariantConditions: NONE }, noEdit: ['variantConditions', 'VariantConditions'] },
    { id: 'h_name_first', column: 'bankName', shown: 'bankA', says: null, matlab: {} },
    { id: 'h_value_key', column: 'bankName', shown: 'bankA', says: null, matlab: {} },
    { id: 'h_unknown_key', column: 'bankName', shown: 'bankA', says: null, matlab: {} },
  ];
  // Not graded: MATLAB's setter refuses an integer past int32 ('V == 2147483648' is read as no
  // conditions), which the reader does not check in either spelling (conditionCannotParse), so
  // it is not warned of. A follow-up for both spellings, not this one's own.
  const NOT_GRADED = ['h_written', 'h_cond_int32'];

  it('is shown from them, as MATLAB reads it, with no warning, the Hidden BankCoderInfo under Other', () => {
    // Every hand case MATLAB was given is graded below, and MATLAB warned of none of them.
    expect(PLAIN_TRUTH.release).toBe('2027a');
    const hand = PLAIN_TRUTH.cases.filter((c) => c.kind === 'hand').map((c) => c.id);
    expect(hand.filter((id) => !NOT_GRADED.includes(id)).sort()).toEqual(PLAIN_HAND.map((h) => h.id).sort());
    expect(PLAIN_TRUTH.rows.map((r) => r.warning).filter((w) => w !== '')).toEqual([]);
    const { source } = open(plainCaseText('h_written'));
    expect(source.warnings).toBeUndefined();
    for (const entry of Object.keys(MATLAB_WROTE)) {
      expect(readOf(matlabRead('h_written').reads[entry]), `MATLAB's ${entry}`).toEqual(MATLAB_WROTE[entry]);
      const node = entryIn(source, entry);
      expect(shownCells(node), entry).toEqual(SHOWN[entry]);
      // BankCoderInfo has no row, as MATLAB hides it; held in plain sight, it is listed under
      // Other, read-only, as read (inside an envelope it is not listed at all).
      const { values } = pi(node);
      expect(Object.entries(values).filter(([k]) => k.startsWith('Other.')), entry).toEqual([['Other.BankCoderInfo', MATLAB_WROTE[entry].BankCoderInfo]]);
    }
    expect(pi(entryIn(source, 'vbN')).values).toMatchObject({ Description: 'desc A', BankName: 'bankA', VariantConditions: "{'V == 1','V == 2'}", AllChoicesCoderInfo: 'ciA', ActiveChoiceCoderInfo: 'ciB' });
  });

  it('takes an edit into the plain property, in MATLAB\'s spelling, and invents no envelope', () => {
    const text = plainCaseText('h_written');
    const { session, source } = open(text);
    expect(saved(session, source)).toBe(text);
    const node = entryIn(source, 'vbN');
    expect(node.setProperty('bankName', 'bankB')).toBe(true);
    expect(node.setProperty('Description', 'a new description')).toBe(true);
    expect(node.setProperty('variantConditions', "{'V==3';'W~=1'}")).toBe(true);
    expect(node.setProperty('allChoicesCoderInfo', 'ciB')).toBe(true);
    expect(node.setProperty('activeChoiceCoderInfo', '')).toBe(true);
    // Refused by MATLAB's own rules, as from an envelope.
    expect(node.setProperty('bankName', 'rtX')).toMatchObject({ error: true, reason: MSG_NAME });
    expect(node.setProperty('variantConditions', "'V==1'")).toMatchObject({ error: true, reason: MSG_NOT_CELL });
    const out = saved(session, source) as string;
    const element = plainOf(out, 'vbN');
    expect(element).not.toHaveProperty('_custom_save');
    expect(Object.keys(element._properties)).toEqual(Object.keys(plainOf(text, 'vbN')._properties));
    expect(element._properties).toEqual({
      ...MATLAB_WROTE.vbN, Name: 'bankB', Description: 'a new description', VariantConditions: cell('V == 3', 'W ~= 1'), AllChoicesCoderInfo: 'ciB', ActiveChoiceCoderInfo: '',
    });
    for (const entry of ['vb1', 'vbD', 'ciA', 'ciB']) {
      expect(plainOf(out, entry), entry).toEqual(plainOf(text, entry));
    }
    expect(shownCells(entryIn(open(out).source, 'vbN'))).toEqual({
      Description: 'a new description', bankName: 'bankB', variantConditions: "{'V == 3','W ~= 1'}", allChoicesCoderInfo: 'ciB', activeChoiceCoderInfo: '',
    });
  });

  it('an edit is undone to the plain property as read', () => {
    const text = plainCaseText('h_conds_char');
    const { session, source } = open(text);
    const node = entryIn(source, 'vbN');
    session.setActiveContext(source);
    session.setActive(source, node);
    expect(session.editProperty(node.id, 'variantConditions', "{'V==3'}")).toBe(true);
    expect(cellText(rowOf(node), 'variantConditions')).toBe("{'V == 3'}");
    session.undo();
    expect(cellText(rowOf(node), 'variantConditions')).toBe("'V==1'");
    // The bank as read; the entry keeps the edit's lastmod, as from an envelope.
    expect(plainOf(saved(session, source) as string, 'vbN')).toEqual(plainOf(text, 'vbN'));
  });


  it.each(PLAIN_HAND)('hand-edited, $id, is shown as read and saved as read, warned as MATLAB reads it', ({ id, entry = 'vbN', column, shown, says, matlab, noEdit }) => {
    const reads = matlabRead(id).reads;
    for (const bank of Object.keys(MATLAB_WROTE)) {
      expect(readOf(reads[bank]), `MATLAB's ${bank}`).toEqual(bank === entry ? { ...MATLAB_WROTE[bank], ...matlab } : MATLAB_WROTE[bank]);
    }
    const text = plainCaseText(id);
    const { session, source } = open(text);
    const node = entryIn(source, entry);
    expect(shownCells(node)).toEqual({ ...SHOWN[entry], [column]: shown });
    const warnings: ParseWarning[] = source.warnings ?? [];
    if (says === null) {
      expect(warnings).toEqual([]);
    } else {
      expect(warnings.map((w) => [w.part, w.code])).toEqual([[entry, 'part-unreadable']]);
      expect(warnings[0].message).toContain(`"${entry}" holds a Simulink.VariantBank MATLAB does not read as written: ${says}.`);
    }
    if (noEdit) {
      expect(node.setProperty(noEdit[0], 'x')).toMatchObject({
        error: true,
        reason: `'${entry}' was read with no ${noEdit[1]} in its saved form, so a ${noEdit[1] === 'Name' ? 'Bank Name' : noEdit[1] === 'VariantConditions' ? 'Variant Conditions' : 'Description'} edit has nowhere to be saved.`,
      });
    }
    expect(saved(session, source)).toBe(text);
  });

  it.each(PLAIN_TRUTH.cases.filter((c) => c.kind === 'save'))('saved by core, $id, is read back by MATLAB as written', ({ id, edits, wrote }) => {
    const text = plainBanks();
    const { session, source } = open(text);
    for (const [entry, column, typed] of edits!) {
      expect(entryIn(source, entry).setProperty(column, typed), `${entry}.${column}`).toBe(true);
    }
    const out = saved(session, source) as string;
    const reads = matlabRead(id).reads;
    for (const entry of Object.keys(MATLAB_WROTE)) {
      const element = plainOf(out, entry);
      expect(element, entry).not.toHaveProperty('_custom_save');
      if (entry in wrote!) {
        // What core writes now is what it wrote for MATLAB, which MATLAB read as written.
        expect(element, entry).toEqual(wrote![entry]);
        expect(readOf(reads[entry]), `MATLAB's ${entry}`).toEqual(asMatlabReads(element._properties));
      } else {
        expect(element, entry).toEqual(plainOf(text, entry));
        expect(readOf(reads[entry]), `MATLAB's ${entry}`).toEqual(MATLAB_WROTE[entry]);
      }
    }
  });
});
