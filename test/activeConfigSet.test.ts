// Copyright 2026 The MathWorks, Inc.
//
// Set as Active Configuration: one of a model's configuration sets made the active one, through the
// session (setActiveConfigSet, and activeConfigSetRefusal, which says why not), and its save.
//
// The save moves the one mark the package keeps of which set is active, every other member as read
// (ActiveConfigMark, held to MATLAB's own save in test/activeConfigMark.test.ts). Refused: a set
// active already; a model no save of which can be written, a `.mdl` among them; and a row that is no
// configuration set of a model. A Simulink.ConfigSetRef is made active too, with a warning
// (activeConfigSetCaution): MATLAB uses one only once it finds the set it refers to, in the model's
// dictionary or, with none, the base workspace (probe_active_config_set.m), which this editor cannot
// check without MATLAB.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { parseSlx } from '../src/datamodel/parser/SlxParser.js';
import { activeMarkMember } from '../src/datamodel/parser/ActiveConfigMark.js';

type Any = any;

const TEST = fileURLToPath(new URL('.', import.meta.url));
const ACTIVE = 'fixtures/active-config/';
const LAYOUTS = ['acs_sets.slx', 'acs_sets_R2025a.slx', 'acs_sets_R2021a.slx', 'acs_sets_R2018a.slx', 'acs_sets_R2013b.slx'];
const bufferOf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const fileBytes = (rel: string) => new Uint8Array(readFileSync(TEST + rel));
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

function opened(rel: string, bytes = fileBytes(rel)) {
  const s: Any = createSession();
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  const model: Any = s.addModelSource(name, bufferOf(bytes));
  s.setActiveContext(model);
  const config = model.getSection('config');
  const set = (n: string): Any => config.children.find((c: Any) => c.name === n);
  const actives = () => config.children.map((c: Any) => [c.name, !!c.active]);
  const save = (): Uint8Array => (s.serializeSource(name) as { bytes: Uint8Array }).bytes;
  return { s, model, config, set, actives, save, name, bytes };
}

const activeIn = (slx: Uint8Array) => parseSlx(bufferOf(slx), 'saved.slx').configSets.filter((c) => c.active).map((c) => c.name);

describe('a set made active', () => {
  it.each(LAYOUTS)('%s: Fast is the one active, the model is unsaved, and its save holds it, every other member as read', (file) => {
    const o = opened(ACTIVE + file);
    expect(o.s.activeConfigSetRefusal(o.set('Fast').id)).toBeNull();
    expect(o.s.setActiveConfigSet(o.set('Fast').id)).toBe(true);
    expect(o.actives()).toEqual([['Configuration', false], ['Fast', true], ['Slow', false]]);
    expect(o.config.children.map((c: Any) => c.icon)).toEqual(['settings', 'check_settings', 'settings']);
    expect(o.model.dirty).toBe(true);

    const out = o.s.serializeSource(o.name);
    expect([out.kind, out.sourceFormat]).toEqual(['binary', 'slx']);
    expect(activeIn(out.bytes)).toEqual(['Fast']);
    const read = unzipSync(o.bytes);
    const saved = unzipSync(out.bytes);
    const mark = activeMarkMember(read)!;
    expect(Object.keys(saved)).toEqual(Object.keys(read));
    expect(Object.keys(read).filter((n) => !same(saved[n], read[n]))).toEqual([mark]);
  });

  it.each([
    ['acs_ref.slx', 'in the data dictionary "acs_dict.sldd"'],
    ['acs_ref_R2025a.slx', 'in the data dictionary "acs_dict.sldd"'],
    ['acs_ref_R2021a.slx', 'in the data dictionary "acs_dict.sldd"'],
    ['acs_ref_R2018a.slx', 'in the data dictionary "acs_dict.sldd"'],
    // R2013b keeps no dictionary: its export dropped the link, and MATLAB looks in the base workspace.
    ['acs_ref_R2013b.slx', 'in the base workspace'],
  ])('%s: a reference to a set is made active too, warning that MATLAB alone can check it', (file, where) => {
    const o = opened(ACTIVE + file);
    const ref = o.set('RefFromDict');
    expect(o.s.activeConfigSetRefusal(ref.id)).toBeNull();
    expect(o.s.activeConfigSetCaution(ref.id)).toBe(
      `"RefFromDict" refers to the configuration set "dictCfg" ${where}. Without MATLAB this editor cannot check ` +
        'that the set is there: open the model in MATLAB to confirm.',
    );
    expect(o.s.setActiveConfigSet(ref.id)).toBe(true);
    expect(o.actives()).toEqual([['Configuration', false], ['RefFromDict', true]]);
    expect(o.config.children.map((c: Any) => c.icon)).toEqual(['settings', 'check_configurationReference']);
    expect(activeIn(o.save())).toEqual(['RefFromDict']);
    // Active now, it is not made active again, and there is nothing to warn of.
    expect(o.s.activeConfigSetCaution(ref.id)).toBeNull();
  });

  it('warns of nothing for a set that is no reference, a set not made active, or a row that is none', () => {
    const o = opened(ACTIVE + 'acs_sets.slx');
    const asked = [o.set('Fast').id, o.set('Configuration').id, o.config.id, 'no such row'].map((id) => o.s.activeConfigSetCaution(id));
    expect(asked).toEqual([null, null, null, null]);
  });

  it('one undo step: Undo makes active again the set that was, Redo the one made', () => {
    const o = opened(ACTIVE + 'acs_sets.slx');
    expect(o.s.canUndo()).toBe(false);
    expect(o.s.setActiveConfigSet(o.set('Slow').id)).toBe(true);
    expect(o.s.canUndo()).toBe(true);
    o.s.undo();
    expect(o.actives()).toEqual([['Configuration', true], ['Fast', false], ['Slow', false]]);
    expect(activeIn(o.save())).toEqual(['Configuration']);
    o.s.redo();
    expect(o.actives()).toEqual([['Configuration', false], ['Fast', false], ['Slow', true]]);
    expect(activeIn(o.save())).toEqual(['Slow']);
  });

  it('each set it changes is told as edited: the one made active, then the one that was', () => {
    const o = opened(ACTIVE + 'acs_sets.slx');
    const edited: [string, string, string][] = [];
    o.s.bus.subscribe('node/edited', (p: Any) => edited.push([p.source, p.nodeId, p.kind]));
    o.s.setActiveConfigSet(o.set('Fast').id);
    o.s.undo();
    const [conf, fast] = [o.set('Configuration').id, o.set('Fast').id];
    expect(edited).toEqual([
      ['pi', fast, 'property'],
      ['pi', conf, 'property'],
      ['undo', conf, 'property'],
      ['undo', fast, 'property'],
    ]);
  });

  it('the set active as read, made active again, saves the mark as read', () => {
    const o = opened(ACTIVE + 'acs_sets_R2021a.slx');
    const mark = activeMarkMember(unzipSync(o.bytes))!;
    expect(o.s.setActiveConfigSet(o.set('Fast').id)).toBe(true);
    expect(o.s.setActiveConfigSet(o.set('Configuration').id)).toBe(true);
    expect(same(unzipSync(o.save())[mark], unzipSync(o.bytes)[mark])).toBe(true);
  });

  it('made active beside an edit of the Model Workspace, the save holds both', () => {
    const o = opened('parity/artifacts/slx_layouts/slxcases_R2021a.slx');
    const label = o.model.getSection('workspace').children.find((c: Any) => c.name === 'label');
    o.s.setActive(o.model, label);
    expect(o.s.editProperty(label.id, 'Value', "'edited'")).toBe(true);
    expect(o.s.setActiveConfigSet(o.set('Fast').id)).toBe(true);
    const parsed = parseSlx(bufferOf(o.save()), 'slxcases_R2021a.slx');
    expect(parsed.configSets.filter((c) => c.active).map((c) => c.name)).toEqual(['Fast']);
    expect(parsed.workspace.find((v) => v.name === 'label')?.value).toBe('edited');
  });

});

describe('a set that is not made active says why, and nothing changes', () => {
  const refused = (o: ReturnType<typeof opened>, row: Any, why: string) => {
    expect(o.s.activeConfigSetRefusal(row.id)).toBe(why);
    expect(o.s.setActiveConfigSet(row.id)).toBe(false);
    expect(o.model.dirty).toBe(false);
    expect(o.s.canUndo()).toBe(false);
  };

  it('the active one', () => {
    const o = opened(ACTIVE + 'acs_sets.slx');
    refused(o, o.set('Configuration'), 'Cannot make "Configuration" the active configuration set: it is the active one already. Nothing was changed.');
  });

  it('a .mdl', () => {
    const o = opened('parity/artifacts/mdl/mdlcases.mdl');
    const idle = o.config.children.find((c: Any) => !c.active);
    refused(o, idle, `Cannot make "${idle.name}" the active configuration set: a .mdl model is not written by this editor. Nothing was changed.`);
  });

  it('a package that cannot be written', () => {
    const entries = unzipSync(fileBytes(ACTIVE + 'acs_sets.slx'));
    delete entries['[Content_Types].xml'];
    const o = opened(ACTIVE + 'acs_sets.slx', zipSync(entries));
    refused(
      o,
      o.set('Fast'),
      'Cannot make "Fast" the active configuration set: it holds no "[Content_Types].xml", which a package names its parts in. Nothing was changed.',
    );
  });

  it('a mark that cannot be moved', () => {
    const entries = unzipSync(fileBytes(ACTIVE + 'acs_sets.slx'));
    // Read as listing Fast, and no longer in the form the move is made in.
    entries['simulink/configSetInfo.json'] = new TextEncoder().encode(
      JSON.stringify({ ConfigSetInfo: [{ Active: 1, ConfigSetName: 'Configuration', PartName: '/simulink/configSet0.json' }, { ConfigSetName: 'Fast', PartName: '/simulink/configSet1.json' }, { ConfigSetName: 'Slow', PartName: '/simulink/configSet2.json' }] }),
    );
    const o = opened(ACTIVE + 'acs_sets.slx', zipSync(entries));
    refused(o, o.set('Fast'), 'Cannot make "Fast" the active configuration set: "simulink/configSetInfo.json" is not laid out as MATLAB writes it. Nothing was changed.');
  });

  it('a row that is no configuration set of a model', () => {
    const o = opened('parity/artifacts/slx_layouts/slxcases.slx');
    const label = o.model.getSection('workspace').children.find((c: Any) => c.name === 'label');
    const why = (name: string) => `Cannot make "${name}" the active configuration set: it is not a configuration set of a model. Nothing was changed.`;
    refused(o, label, why('label'));
    refused(o, o.config, why('config'));
    refused(o, o.model.getSection('blocks').children[0], why(o.model.getSection('blocks').children[0].name));
    expect(o.s.activeConfigSetRefusal('no such row')).toBe(
      'Cannot make "no such row" the active configuration set: no row of that id is open. Nothing was changed.',
    );
    expect(o.s.setActiveConfigSet('no such row')).toBe(false);
  });

  it("a dictionary's configuration set, which no model has active", () => {
    const s: Any = createSession();
    const dict: Any = ingest(s, bufferOf(fileBytes(ACTIVE + 'acs_dict.sldd')), { filename: 'acs_dict.sldd' });
    const set = dict.getSection('config').children[0];
    expect(s.activeConfigSetRefusal(set.id)).toBe(
      `Cannot make "${set.name}" the active configuration set: it is not a configuration set of a model. Nothing was changed.`,
    );
  });

  it("a set's other edits are refused as before", () => {
    const o = opened(ACTIVE + 'acs_sets.slx');
    o.s.setActive(o.model, o.set('Fast'));
    expect(o.s.editProperty(o.set('Fast').id, 'Name', 'Faster')).toMatchObject({ error: true });
    expect(o.model.dirty).toBe(false);
  });
});

describe('asking changes nothing, and agrees with the change', () => {
  it.each([...LAYOUTS, 'acs_ref.slx', 'acs_ref_R2013b.slx'])('%s: of every row', (file) => {
    const o = opened(ACTIVE + file);
    const rows: Any[] = o.model.flatten();
    const saved = o.save();
    const answers = rows.map((r) => [r.id, o.s.activeConfigSetRefusal(r.id)] as const);
    expect(same(o.save(), saved)).toBe(true);
    expect(o.model.dirty).toBe(false);
    for (const [id, why] of answers) {
      const again = opened(ACTIVE + file);
      expect([id, again.s.setActiveConfigSet(id)]).toEqual([id, why === null]);
    }
    expect(answers.filter(([, why]) => why === null).length).toBe(file.startsWith('acs_sets') ? 2 : 1);
    // And the warning a reference is made active with: a question, as the refusal is.
    for (const r of rows) o.s.activeConfigSetCaution(r.id);
    expect(same(o.save(), saved)).toBe(true);
  });
});
