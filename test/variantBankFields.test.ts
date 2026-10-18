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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession, ingest, type SerializedSource } from '../src/index.js';
import VariantBankNode from '../src/datamodel/node/data/VariantBankNode.js';
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
