// Copyright 2026 The MathWorks, Inc.
//
// A model's configuration set copied with every setting it holds, and a set pasted into a model's
// Configurations section, as a dictionary's are (pasteEntries), held to MATLAB's own saves
// (test/fixtures/config-set-paste, gen_config_set_paste.m: pm.slx and pd.sldd hold the same set and
// reference; pm__dup.slx is pm.slx with Fast duplicated as MATLAB names a duplicate, Fast1).
//
// In R2026b+'s layout a set's part holds the same `_properties` as a text dictionary's entry of it,
// byte for byte (measured, R2027a), so a set travels between the two whole. A set of an older layout
// is not copied, nor pasted into one, saying why: its settings are written another way, which this
// does not convert. A reference, whose settings are its source and its Description, travels in
// every layout.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { createSession, parseBinarySldd } from '../src/index.js';
import { parseSlx } from '../src/datamodel/parser/SlxParser.js';

type Any = any;

const PASTE = fileURLToPath(new URL('./fixtures/config-set-paste/', import.meta.url));
const ACTIVE = fileURLToPath(new URL('./fixtures/active-config/', import.meta.url));
const EDITS = fileURLToPath(new URL('./fixtures/config-set-edits/', import.meta.url));
const buf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const text = (b: Uint8Array | undefined) => (b ? new TextDecoder().decode(b) : undefined);

function session() {
  const s: Any = createSession();
  const model = (path: string, name = path.split('/').pop()!) => {
    const root = s.addModelSource(name, buf(new Uint8Array(readFileSync(path))));
    return { root, config: root.getSection('config'), set: (n: string) => root.getSection('config').children.find((c: Any) => c.name === n) };
  };
  const dictionary = (path: string, name = path.split('/').pop()!) => {
    const root = s.addDataSource(name, JSON.parse(readFileSync(path, 'utf8')));
    const config = root.children.find((c: Any) => c.name === 'config');
    return { root, config, entry: (n: string) => config.children.find((c: Any) => c.name === n) };
  };
  const saved = (srcId: string) => (s.serializeSource(srcId) as { bytes: Uint8Array }).bytes;
  return { s, model, dictionary, saved };
}
const propsOf = (payload: Any) => payload.value._elements[0]._properties;

describe("a model's configuration set, copied", () => {
  it('in R2026b+: with every setting, as a dictionary holding the same set copies it', () => {
    const o = session();
    const m = o.model(PASTE + 'pm.slx');
    const d = o.dictionary(PASTE + 'pd.sldd');
    for (const name of ['Fast', 'R']) {
      expect(o.s.copyRefusal(m.set(name).id)).toBeNull();
      expect([name, m.set(name).serialize().value]).toEqual([name, d.entry(name).serialize().value]);
    }
  });

  it.each(['acs_sets_R2025a.slx', 'acs_sets_R2021a.slx', 'acs_sets_R2018a.slx', 'acs_sets_R2013b.slx'])(
    '%s: a set is not copied, saying why; a reference is, with its source and its Description',
    (file) => {
      const o = session();
      const m = o.model(ACTIVE + file);
      expect(o.s.copyRefusal(m.set('Fast').id)).toBe(
        `Cannot copy "Fast": a configuration set's settings are copied out of a model saved in R2026b or later, and "${file}" is saved in an earlier release's layout: copy it in MATLAB. Nothing was copied.`,
      );
      const r = o.model(ACTIVE + file.replace('acs_sets', 'acs_ref'));
      expect(o.s.copyRefusal(r.set('RefFromDict').id)).toBeNull();
      expect(propsOf(r.set('RefFromDict').serialize())).toMatchObject({ Name: 'RefFromDict', SourceName: 'dictCfg' });
    },
  );
});

describe("a configuration set pasted into a model's Configurations", () => {
  it('a copy of a set of the same model: named as MATLAB names a duplicate, its part MATLAB\'s own, one undo step', () => {
    const o = session();
    const m = o.model(PASTE + 'pm.slx');
    o.s.setActiveContext(m.root);
    const result = o.s.pasteEntries(m.config.id, [m.set('Fast').serialize()]);
    expect(result.error).toBeUndefined();
    expect(result.nodes.map((n: Any) => n.name)).toEqual(['Fast1']);
    expect(m.root.dirty).toBe(true);
    const out = unzipSync(o.saved('pm.slx'));
    const matlab = unzipSync(new Uint8Array(readFileSync(PASTE + 'pm__dup.slx')));
    for (const member of ['simulink/configSet3.json', 'simulink/configSetInfo.json', 'simulink/_rels/configSetInfo.json.rels', '[Content_Types].xml']) {
      expect([member, text(out[member])]).toEqual([member, text(matlab[member])]);
    }
    o.s.undo();
    expect(m.set('Fast1')).toBeUndefined();
    o.s.redo();
    expect(m.set('Fast1')).toBeTruthy();
  });

  it("a set and a reference out of a dictionary: each part is MATLAB's own save of it in a model", () => {
    const o = session();
    const m = o.model(EDITS + 'one__none.slx', 'one.slx');
    const d = o.dictionary(PASTE + 'pd.sldd');
    const result = o.s.pasteEntries(m.config.id, [d.entry('Fast').serialize(), d.entry('R').serialize()]);
    expect(result.nodes?.map((n: Any) => n.name)).toEqual(['Fast', 'R']);
    const out = unzipSync(o.saved('one.slx'));
    const matlab = unzipSync(new Uint8Array(readFileSync(PASTE + 'pm.slx')));
    expect(text(out['simulink/configSet1.json'])).toBe(text(matlab['simulink/configSet1.json']));
    expect(text(out['simulink/configSet2.json'])).toBe(text(matlab['simulink/configSet2.json']));
    expect(parseSlx(buf(o.saved('one.slx')), 'one.slx').configSets.map((c) => [c.name, c.objectClass, c.description, c.sourceName])).toEqual([
      ['Configuration', 'Simulink.ConfigSet', '', ''],
      ['Fast', 'Simulink.ConfigSet', 'd1\nd2', ''],
      ['R', 'Simulink.ConfigSetRef', 'refdesc', 'dictCfg'],
    ]);
  });

  it("a model's set pasted into a dictionary: the dictionary holds it with every setting", () => {
    const o = session();
    const m = o.model(PASTE + 'pm.slx');
    const d = o.dictionary(PASTE + 'pd.sldd');
    const before = d.entry('Fast').serialize().value;
    const result = o.s.pasteEntries(d.config.id, [m.set('Fast').serialize()]);
    expect(result.nodes?.map((n: Any) => n.name)).toEqual(['Fast1']);
    expect(propsOf(d.entry('Fast1').serialize())).toEqual({ ...before._elements[0]._properties, Name: 'Fast1' });
  });

  it('a reference carrying its name, source and Description alone: its part what an added reference is, so pointed', () => {
    // Copied out of an older layout, which holds no more of it: the rest is a fresh reference's
    // (newJsonPart), its layout's Version, and its source looked for in the base workspace, as the
    // model has no dictionary.
    const o = session();
    const old = o.model(ACTIVE + 'acs_ref_R2021a.slx');
    const m = o.model(PASTE + 'pm.slx');
    expect(o.s.pasteEntries(m.config.id, [old.set('RefFromDict').serialize()]).nodes?.map((n: Any) => n.name)).toEqual(['RefFromDict']);
    const pasted = text(unzipSync(o.saved('pm.slx'))['simulink/configSet3.json']);
    const added = session();
    const a = added.model(PASTE + 'pm.slx');
    added.s.setActiveContext(a.root);
    const ref = added.s.addEntry('config', 'Simulink.ConfigSetRef', 'RefFromDict');
    added.s.setActive(a.root, ref);
    expect(added.s.editProperty(ref.id, 'SourceName', 'dictCfg')).toBe(true);
    expect(pasted).toBe(text(unzipSync(added.saved('pm.slx'))['simulink/configSet3.json']));
    expect(JSON.parse(pasted!)._properties).toMatchObject({ SourceLocation: 'Base Workspace', SourceName: 'dictCfg', Version: '27.0.0' });
  });

  it("a binary dictionary's set: written in a text dictionary's form, its reader's bookkeeping left out", () => {
    // MATLAB opens the model so saved with csAutosar's every parameter, and warns of nothing, where
    // it warned of `_property_source` (probe_config_set_edits.m, frombindict).
    const o = session();
    const m = o.model(PASTE + 'pm.slx');
    const bin = new Uint8Array(readFileSync(fileURLToPath(new URL('./parity/oldsaves/old_saves_r2027a_binary.sldd', import.meta.url))));
    const root = o.s.addDataSource('b.sldd', parseBinarySldd(buf(bin)), { path: 'b.sldd' });
    const cs = root.children.find((c: Any) => c.name === 'config').children.find((c: Any) => c.name === 'csAutosar');
    expect(JSON.stringify(cs.serialize())).toContain('"_property_source"');
    expect(o.s.pasteEntries(m.config.id, [cs.serialize()]).nodes?.map((n: Any) => n.name)).toEqual(['csAutosar']);
    const part = text(unzipSync(o.saved('pm.slx'))['simulink/configSet3.json'])!;
    expect(part).toContain('"Name":"csAutosar"');
    expect(part).not.toContain('_property_source');
    expect(JSON.parse(part)._properties.Components._elements.length).toBe(cs.serialize().value._elements[0]._properties.Components._elements.length);
  });

  it.each(['acs_sets_R2025a.slx', 'acs_sets_R2021a.slx', 'acs_sets_R2013b.slx'])(
    '%s: a set is not pasted, saying why; a reference is, and saved with its source',
    (file) => {
      const o = session();
      const m = o.model(ACTIVE + file);
      const d = o.dictionary(PASTE + 'pd.sldd');
      const why = `Cannot paste "Fast" into "Configurations": a configuration set's settings are written into a model saved in R2026b or later, and "${file}" is saved in an earlier release's layout: paste it in MATLAB. Nothing was pasted.`;
      expect(o.s.pasteRefusal(m.config.id, d.entry('Fast').serialize())).toBe(why);
      expect(o.s.pasteEntries(m.config.id, [d.entry('Fast').serialize()])).toEqual({ error: true, reason: why });
      expect(m.root.dirty).toBe(false);
      expect(o.s.pasteEntries(m.config.id, [d.entry('R').serialize()]).nodes?.map((n: Any) => n.name)).toEqual(['R']);
      const back = parseSlx(buf(o.saved(file)), file).configSets.at(-1)!;
      expect([back.name, back.objectClass, back.sourceName, back.description]).toEqual(['R', 'Simulink.ConfigSetRef', 'dictCfg', 'refdesc']);
    },
  );

  it('what the Configurations section holds no entry of is not pasted, saying why', () => {
    const o = session();
    const m = o.model(PASTE + 'pm.slx');
    const payload = { name: 'p', metadata: null, value: { _array_class: 'Simulink.Parameter', _dimensions: [1, 1], _elements: [{ _properties: { Value: 1 } }] } };
    expect(o.s.pasteRefusal(m.config.id, payload)).toBe('Cannot paste "p" into "Configurations": the section holds no entry of that class. Nothing was pasted.');
    expect(o.s.pasteEntries(m.config.id, [payload]).error).toBe(true);
  });
});
