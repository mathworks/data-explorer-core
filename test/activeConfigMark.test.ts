// Copyright 2026 The MathWorks, Inc.
//
// The member of a `.slx` that says which configuration set is active, with another set made active
// (src/datamodel/parser/ActiveConfigMark.ts): the one mark moved, every other byte as read.
//
// Held to MATLAB's own save of the same change. test/fixtures/active-config/matlab-saves holds the
// mark member of each, from probe_active_config_set.m on R2027a (native/<case>/edited): MATLAB opened
// the model, made the set active (setActiveConfigSet) and saved it in the model's own layout. In the
// JSON and XML layouts the member is the same byte for byte; in R2013b's, the block diagram, MATLAB
// writes the whole member anew, so there it is the reference's ObjectID alone that changes.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync } from 'fflate';
import { parseSlx } from '../src/datamodel/parser/SlxParser.js';
import {
  ActiveMarkError,
  BLOCK_DIAGRAM,
  JSON_INFO,
  XML_INFO,
  activeMarkMember,
  withActiveSet,
} from '../src/datamodel/parser/ActiveConfigMark.js';

const DIR = fileURLToPath(new URL('./fixtures/active-config/', import.meta.url));
const entriesOf = (file: string) => unzipSync(new Uint8Array(readFileSync(DIR + file)));
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const bytes = (s: string) => new TextEncoder().encode(s);
const setsOf = (entries: Record<string, Uint8Array>, file: string) => {
  const z = zipSync(entries);
  return parseSlx(z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength) as ArrayBuffer, file).configSets;
};

const SAVES = readdirSync(DIR + 'matlab-saves').sort();

describe('the member that marks the active set, in each layout', () => {
  it.each([
    ['acs_sets.slx', JSON_INFO],
    ['acs_sets_R2025a.slx', XML_INFO],
    ['acs_sets_R2021a.slx', XML_INFO],
    ['acs_sets_R2018a.slx', XML_INFO],
    // An index there, listing no set: the sets are inline, as R2013b keeps them.
    ['acs_sets_R2013b.slx', BLOCK_DIAGRAM],
  ])('%s: %s', (file, member) => {
    expect(activeMarkMember(entriesOf(file))).toBe(member);
  });

  it('a package with none of them has none', () => {
    expect(activeMarkMember({ 'simulink/other.xml': bytes('<x/>') })).toBeNull();
    expect(() => withActiveSet({}, 'Fast')).toThrow(new ActiveMarkError('the model holds no part that says which configuration set is active'));
  });
});

describe("another set made active is MATLAB's own save of the change", () => {
  it('there is a save of each change MATLAB makes in the JSON and XML layouts', () => {
    expect(SAVES).toEqual([
      'acs_ref__RefFromDict.json',
      'acs_ref_R2018a__RefFromDict.xml',
      'acs_ref_R2021a__RefFromDict.xml',
      'acs_ref_R2025a__RefFromDict.xml',
      'acs_sets__Fast.json',
      'acs_sets__Slow.json',
      'acs_sets_R2018a__Fast.xml',
      'acs_sets_R2018a__Slow.xml',
      'acs_sets_R2021a__Fast.xml',
      'acs_sets_R2021a__Slow.xml',
      'acs_sets_R2025a__Fast.xml',
      'acs_sets_R2025a__Slow.xml',
    ].sort());
  });

  it.each(SAVES)('%s, byte for byte', (save) => {
    const [, model, to] = /^(.+)__(.+)\.(json|xml)$/.exec(save)!;
    const out = withActiveSet(entriesOf(model + '.slx'), to);
    expect(out.member).toBe(save.endsWith('.json') ? JSON_INFO : XML_INFO);
    expect(text(out.bytes)).toBe(readFileSync(DIR + 'matlab-saves/' + save, 'utf8'));
  });

  it.each(['Fast', 'Slow'])('R2013b, %s: the reference names its ObjectID, and nothing else of the block diagram changes', (to) => {
    const entries = entriesOf('acs_sets_R2013b.slx');
    const before = text(entries[BLOCK_DIAGRAM]);
    const out = withActiveSet(entries, to);
    expect(out.member).toBe(BLOCK_DIAGRAM);
    const id = to === 'Fast' ? '23' : '36';
    expect(text(out.bytes)).toBe(
      before.replace('<Object Reference="true" PropName="ActiveConfigurationSet" ObjectID="10">', `<Object Reference="true" PropName="ActiveConfigurationSet" ObjectID="${id}">`),
    );
    expect(setsOf({ ...entries, [BLOCK_DIAGRAM]: out.bytes }, 'acs_sets_R2013b.slx').map((s) => [s.name, s.active])).toEqual([
      ['Configuration', false],
      ['Fast', to === 'Fast'],
      ['Slow', to === 'Slow'],
    ]);
  });

  it.each(['acs_sets.slx', 'acs_sets_R2025a.slx', 'acs_sets_R2021a.slx', 'acs_sets_R2018a.slx', 'acs_sets_R2013b.slx'])(
    '%s: the set active as read, made active again, gives the member back as read',
    (file) => {
      const entries = entriesOf(file);
      const member = activeMarkMember(entries)!;
      const slow = withActiveSet(entries, 'Slow');
      expect(text(withActiveSet({ ...entries, [member]: slow.bytes }, 'Configuration').bytes)).toBe(text(entries[member]));
      expect(text(withActiveSet(entries, 'Configuration').bytes)).toBe(text(entries[member]));
    },
  );
});

describe('a member another set cannot be made active in says why', () => {
  const json = (entries: object[]) => ({ [JSON_INFO]: bytes(JSON.stringify({ ConfigSetInfo: entries }, null, 2)) });

  it.each([
    ['acs_sets.slx', `"${JSON_INFO}" lists no configuration set named "Fastest"`],
    ['acs_sets_R2021a.slx', `"${XML_INFO}" lists no configuration set named "Fastest"`],
    ['acs_sets_R2013b.slx', `"${BLOCK_DIAGRAM}" lists no configuration set named "Fastest"`],
  ])('%s: a set it does not list', (file, why) => {
    expect(() => withActiveSet(entriesOf(file), 'Fastest')).toThrow(new ActiveMarkError(why));
  });

  it('an entry whose Active comes last gives it up, as one whose Active comes first does', () => {
    const last = json([
      { ConfigSetName: 'A', PartName: '/simulink/configSet0.json', Active: true },
      { ConfigSetName: 'B', PartName: '/simulink/configSet1.json' },
    ]);
    const out = JSON.parse(text(withActiveSet(last, 'B').bytes));
    expect(out.ConfigSetInfo).toEqual([
      { ConfigSetName: 'A', PartName: '/simulink/configSet0.json' },
      { Active: true, ConfigSetName: 'B', PartName: '/simulink/configSet1.json' },
    ]);
  });

  it('a set listed twice', () => {
    const twice = json([
      { Active: true, ConfigSetName: 'A', PartName: '/simulink/configSet0.json' },
      { ConfigSetName: 'B', PartName: '/simulink/configSet1.json' },
      { ConfigSetName: 'B', PartName: '/simulink/configSet2.json' },
    ]);
    expect(() => withActiveSet(twice, 'B')).toThrow(new ActiveMarkError(`"${JSON_INFO}" lists "B" 2 times`));
  });

  it('an index marked in a way MATLAB does not write it, which the move would leave with two sets active', () => {
    // "Active":1 reads active (SlxParser: !!entry.Active), and is not the mark the move takes away.
    const odd = json([
      { Active: 1, ConfigSetName: 'A', PartName: '/simulink/configSet0.json' },
      { ConfigSetName: 'B', PartName: '/simulink/configSet1.json' },
    ]);
    expect(() => withActiveSet(odd, 'B')).toThrow(new ActiveMarkError(`"${JSON_INFO}" is not laid out as MATLAB writes it`));
  });

  it('an index that is not JSON, or not text', () => {
    expect(() => withActiveSet({ [JSON_INFO]: bytes('{"ConfigSetInfo":[') }, 'B')).toThrow(new ActiveMarkError(`"${JSON_INFO}" cannot be read`));
    expect(() => withActiveSet({ [JSON_INFO]: Uint8Array.of(0x7b, 0xff, 0x7d) }, 'B')).toThrow(new ActiveMarkError(`"${JSON_INFO}" is not text`));
  });

  it('a block diagram that names no active set, or two', () => {
    const entries = entriesOf('acs_sets_R2013b.slx');
    const bd = text(entries[BLOCK_DIAGRAM]);
    const ref = '<Object Reference="true" PropName="ActiveConfigurationSet" ObjectID="10">';
    const none = { ...entries, [BLOCK_DIAGRAM]: bytes(bd.replace(ref, '<Object Reference="true" PropName="Other" ObjectID="10">')) };
    const two = { ...entries, [BLOCK_DIAGRAM]: bytes(bd.replace(ref, ref + '</Object>' + ref)) };
    expect(() => withActiveSet(none, 'Fast')).toThrow(new ActiveMarkError(`"${BLOCK_DIAGRAM}" names no active configuration set`));
    expect(() => withActiveSet(two, 'Fast')).toThrow(new ActiveMarkError(`"${BLOCK_DIAGRAM}" names more than one active configuration set`));
  });

  it('a set whose name is escaped is found by the name MATLAB gives it', () => {
    const xml = (name: string, active: boolean) => `  <ConfigSet PartName="/simulink/configSet.xml"${active ? ' Active="true"' : ''}>${name}</ConfigSet>\n`;
    const source = `<?xml version="1.0" encoding="utf-8"?>\n<ConfigSetInfo>\n${xml('A', true)}${xml('R&amp;D', false)}</ConfigSetInfo>\n`;
    expect(text(withActiveSet({ [XML_INFO]: bytes(source) }, 'R&D').bytes)).toBe(
      `<?xml version="1.0" encoding="utf-8"?>\n<ConfigSetInfo>\n${xml('A', false)}${xml('R&amp;D', true)}</ConfigSetInfo>\n`,
    );
  });
});
