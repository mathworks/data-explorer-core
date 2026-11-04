// Copyright 2026 The MathWorks, Inc.
//
// A `.slx`'s configuration sets edited through the session, as a dictionary's are: renamed, given a
// Description, a reference pointed at another set, a set or a reference added (addEntry 'config')
// and deleted, each one undo step, and saved (ConfigSetsWriter, held to MATLAB's own saves in
// test/configSetsWriter.test.ts) in every layout. Refused, saying why: a name MATLAB does not give a
// set (set_param(cs, 'Name'): not empty, of letters, digits, _, - and spaces; unique), the active set's
// delete (MATLAB's detachConfigSet refuses it), a set's settings, and a `.mdl`'s sets
// (test/modelSectionsRefuse.test.ts).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { parseSlx } from '../src/datamodel/parser/SlxParser.js';

type Any = any;

const DIR = fileURLToPath(new URL('./fixtures/active-config/', import.meta.url));
const LAYOUTS = ['acs_sets.slx', 'acs_sets_R2025a.slx', 'acs_sets_R2021a.slx', 'acs_sets_R2018a.slx', 'acs_sets_R2013b.slx'];
const buf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

function opened(file: string) {
  const bytes = new Uint8Array(readFileSync(DIR + file));
  const s: Any = createSession();
  const model: Any = s.addModelSource(file, buf(bytes));
  s.setActiveContext(model);
  const config = model.getSection('config');
  const set = (n: string): Any => config.children.find((c: Any) => c.name === n);
  const edit = (n: string, key: string, value: string) => {
    s.setActive(model, set(n));
    return s.editProperty(set(n).id, key, value);
  };
  const saved = () => parseSlx(buf((s.serializeSource(file) as { bytes: Uint8Array }).bytes), file);
  const read = (p = saved()) => p.configSets.map((c) => [c.name, c.objectClass || 'Simulink.ConfigSet', c.description ?? '', c.sourceName, c.active]);
  return { s, model, config, set, edit, saved, read, bytes, file };
}

describe("a model's configuration set, edited as a dictionary's is", () => {
  it.each(LAYOUTS)('%s: renamed, described, added, deleted, and saved as each', (file) => {
    const o = opened(file);
    expect(o.edit('Fast', 'Name', 'Fast run-2')).toBe(true);
    expect(o.edit('Fast run-2', 'Description', 'Quick <runs> & "more"')).toBe(true);
    const added = o.s.addEntry('config', 'Simulink.ConfigSet');
    expect(added?.name).toBe('Configuration1');
    expect(o.s.deleteNodeById(o.set('Slow').id)).toBe(true);
    expect(o.model.dirty).toBe(true);
    expect(o.read()).toEqual([
      ['Configuration', 'Simulink.ConfigSet', '', '', true],
      ['Fast run-2', 'Simulink.ConfigSet', 'Quick <runs> & "more"', '', false],
      ['Configuration1', 'Simulink.ConfigSet', '', '', false],
    ]);
    // Every member the edits do not touch is as read.
    const before = unzipSync(o.bytes);
    const after = unzipSync((o.s.serializeSource(file) as { bytes: Uint8Array }).bytes);
    const touched = Object.keys(before).filter((n) => !(n in after) || before[n].length !== after[n].length || before[n].some((x, i) => x !== after[n][i]));
    expect(touched.every((n) => /configSet|_rels\/configSetInfo|\[Content_Types\]|blockdiagram\.xml/.test(n))).toBe(true);
  });

  it.each(LAYOUTS)('%s: each edit one undo step, all of them undone the sets as read', (file) => {
    const o = opened(file);
    const asRead = o.read();
    o.edit('Fast', 'Name', 'Faster');
    o.edit('Faster', 'Description', 'd');
    o.s.addEntry('config', 'Simulink.ConfigSetRef');
    o.s.setActive(o.model, o.set('Slow'));
    o.s.deleteNodeById(o.set('Slow').id);
    for (let i = 0; i < 4; i++) o.s.undo();
    expect(o.s.canUndo()).toBe(false);
    expect(o.read()).toEqual(asRead);
    for (let i = 0; i < 4; i++) o.s.redo();
    expect(o.read().map((r) => r[0])).toEqual(['Configuration', 'Faster', 'Reference']);
  });

  it.each(['acs_ref.slx', 'acs_ref_R2025a.slx', 'acs_ref_R2021a.slx', 'acs_ref_R2018a.slx', 'acs_ref_R2013b.slx'])(
    '%s: a reference added and pointed at a set, another pointed elsewhere',
    (file) => {
      const o = opened(file);
      const ref = o.s.addEntry('config', 'Simulink.ConfigSetRef');
      expect(ref?.name).toBe('Reference');
      expect(o.edit('Reference', 'SourceName', 'dictCfg')).toBe(true);
      expect(o.edit('RefFromDict', 'SourceName', 'otherCfg')).toBe(true);
      expect(o.read()).toEqual([
        ['Configuration', 'Simulink.ConfigSet', '', '', true],
        ['RefFromDict', 'Simulink.ConfigSetRef', '', 'otherCfg', false],
        ['Reference', 'Simulink.ConfigSetRef', '', 'dictCfg', false],
      ]);
    },
  );

  it.each(LAYOUTS)('%s: a reference added and pointed at nothing yet, as an Add makes it, reads back so', (file) => {
    const o = opened(file);
    expect(o.s.addEntry('config', 'Simulink.ConfigSetRef')?.name).toBe('Reference');
    expect(o.saved().warnings).toEqual([]);
    expect(o.read().at(-1)).toEqual(['Reference', 'Simulink.ConfigSetRef', '', '', false]);
  });

  it.each(LAYOUTS)('%s: a set added, renamed, made active and saved: the mark is on it', (file) => {
    const o = opened(file);
    const added = o.s.addEntry('config', 'Simulink.ConfigSet');
    expect(o.edit(added.name, 'Name', 'Newest')).toBe(true);
    expect(o.s.setActiveConfigSet(o.set('Newest').id)).toBe(true);
    expect(o.edit('Configuration', 'Name', 'Original')).toBe(true);
    expect(o.read().map((r) => [r[0], r[4]])).toEqual([
      ['Original', false],
      ['Fast', false],
      ['Slow', false],
      ['Newest', true],
    ]);
  });

  it.each(LAYOUTS)('%s: a name and a Description with spaces and line breaks around them, kept as MATLAB keeps them', (file) => {
    // MATLAB takes both, and writes and reads every space and line break of them in every layout
    // (probe_config_set_edits.m, `spaced`); SlxParser's XML reader trims them as it reads a set back.
    const o = opened(file);
    expect(o.edit('Fast', 'Name', ' Fast run ')).toBe(true);
    expect(o.edit(' Fast run ', 'Description', '  two\nlines\n')).toBe(true);
    const saved = (o.s.serializeSource(file) as { bytes: Uint8Array }).bytes;
    const texts = Object.values(unzipSync(saved)).map((b) => new TextDecoder().decode(b));
    const written = file === 'acs_sets.slx' ? '"Description":"  two\\nlines\\n"' : '>  two\nlines\n</P>';
    expect(texts.filter((t) => t.includes(written))).toHaveLength(1);
    expect(o.read(parseSlx(buf(saved), file)).map((r) => r[0].trim())).toEqual(['Configuration', 'Fast run', 'Slow']);
  });

  it('a set renamed and saved twice: the second save holds the first edit and the second', () => {
    const o = opened('acs_sets_R2021a.slx');
    o.edit('Fast', 'Name', 'Faster');
    o.saved();
    o.edit('Faster', 'Description', 'twice');
    expect(o.read()[1]).toEqual(['Faster', 'Simulink.ConfigSet', 'twice', '', false]);
  });
});

describe('a model of one set, as most are', () => {
  const DIR2 = fileURLToPath(new URL('./fixtures/config-set-edits/', import.meta.url));
  it('takes every edit of its set, and a set added, saved as MATLAB lists two', () => {
    const bytes = new Uint8Array(readFileSync(DIR2 + 'one__none.slx'));
    const s: Any = createSession();
    const model: Any = s.addModelSource('one.slx', buf(bytes));
    s.setActiveContext(model);
    expect(model.configEditRefusal()).toBeNull();
    expect(s.addEntryRefusal(model.getSection('config').id, 'Simulink.ConfigSet')).toBeNull();
    expect(s.addEntry('config', 'Simulink.ConfigSet')?.name).toBe('Configuration1');
    const saved = parseSlx(buf((s.serializeSource('one.slx') as { bytes: Uint8Array }).bytes), 'one.slx');
    expect(saved.configSets.map((c) => [c.name, c.active])).toEqual([
      ['Configuration', true],
      ['Configuration1', false],
    ]);
  });
});

describe('an edit of a set that MATLAB would not make is refused, saying why', () => {
  it.each([
    ['R&D', 'Cannot rename "Fast": Invalid character in name for configuration object. Valid characters are {(a-z), (A-Z), (0-9), _, -} and a space.'],
    ['', 'Cannot rename "Fast": Name for a configuration object cannot be empty.'],
    ['Slow', 'Cannot rename "Fast": \'Slow\' already exists in the configuration sets of "acs_sets.slx".'],
  ])('a rename to %j', (name, why) => {
    const o = opened('acs_sets.slx');
    expect(o.edit('Fast', 'Name', name)).toMatchObject({ error: true, reason: why });
    expect(o.set('Fast')).toBeTruthy();
    expect(o.model.dirty).toBe(false);
  });

  it('the active set deleted', () => {
    const o = opened('acs_sets.slx');
    expect(o.s.deleteRefusal(o.set('Configuration').id)).toBe(
      'Cannot delete "Configuration": it is the active configuration set, which MATLAB does not delete: make another set active first. Nothing was deleted.',
    );
    expect(o.s.deleteNodeById(o.set('Configuration').id)).toBe(false);
    // Once another is active, it is deleted.
    o.s.setActiveConfigSet(o.set('Fast').id);
    expect(o.s.deleteNodeById(o.set('Configuration').id)).toBe(true);
    expect(o.read().map((r) => [r[0], r[4]])).toEqual([
      ['Fast', true],
      ['Slow', false],
    ]);
  });

  it('a class the Configurations section does not hold', () => {
    const o = opened('acs_sets.slx');
    expect(o.s.addEntryRefusal(o.config.id, 'Simulink.Parameter')).toBe(
      'Cannot add a Simulink.Parameter to "Configurations": the section holds no entry of that class.',
    );
    expect(o.s.addEntry('config', 'Simulink.Parameter')).toBeNull();
    expect(o.s.addEntryRefusal(o.config.id, 'Simulink.ConfigSet')).toBeNull();
  });

  it("a package an Add or a Delete could not be written into takes no edit of its sets", () => {
    const entries = unzipSync(new Uint8Array(readFileSync(DIR + 'acs_sets_R2021a.slx')));
    const rels = new TextDecoder().decode(entries['simulink/_rels/configSetInfo.xml.rels']);
    entries['simulink/_rels/configSetInfo.xml.rels'] = new TextEncoder().encode(rels.replace(/ *<Relationship [^>]*configSet2\.xml[^>]*\/>\n/, ''));
    const s: Any = createSession();
    const model: Any = s.addModelSource('acs_sets_R2021a.slx', buf(zipSync(entries)));
    expect(model.configEditRefusal()).toBe('"simulink/_rels/configSetInfo.xml.rels" is not laid out as MATLAB writes it');
    expect(s.addEntryRefusal(model.getSection('config').id, 'Simulink.ConfigSet')).toMatch(/is not laid out as MATLAB writes it/);
  });

  it("a package not laid out as MATLAB writes it: its sets are shown, and none takes an edit", () => {
    const entries = unzipSync(new Uint8Array(readFileSync(DIR + 'acs_sets.slx')));
    const index = new TextDecoder().decode(entries['simulink/configSetInfo.json']);
    entries['simulink/configSetInfo.json'] = new TextEncoder().encode(JSON.stringify(JSON.parse(index)));
    const s: Any = createSession();
    const model: Any = s.addModelSource('acs_sets.slx', buf(zipSync(entries)));
    const fast = model.getSection('config').children.find((c: Any) => c.name === 'Fast');
    s.setActive(model, fast);
    expect(s.renameRefusal(fast.id)).toBe('Cannot rename "Fast": "simulink/configSetInfo.json" is not laid out as MATLAB writes it.');
    expect(fast.toRow().Name.editable).toBe(false);
  });
});
