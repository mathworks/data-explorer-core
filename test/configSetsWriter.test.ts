// Copyright 2026 The MathWorks, Inc.
//
// A model's configuration sets edited in its package (src/datamodel/parser/ConfigSetsWriter.ts):
// renamed, described, given a source, added and deleted, every other byte as read.
//
// Held to MATLAB's own save of each edit (test/fixtures/config-set-edits, probe_config_set_writes.m):
// the edit is made on MATLAB's save of the model as it opened (`<model>__none.slx`), and each member
// MATLAB's save of the edit changes is to be the same, byte for byte. What is not the same is said:
//
// - an added set's own part: MATLAB writes its components, this its Name and Version alone, which
//   MATLAB opens as a fresh set of its own release (probe_config_set_edits checks it);
// - a deleted set in the XML layouts: MATLAB's export keeps the deleted set's part, related from the
//   package's root as a 2026 relationship, where this takes the part out and its Override with it;
// - R2018a: MATLAB's export of an added set writes every set's part anew;
// - R2013b: MATLAB numbers every object of the block diagram again as it adds or deletes a set;
// - R2018a and R2013b: MATLAB's export of an added set writes the sets it keeps anew, without their
//   fixed-step solver, where this keeps them as read (probe_config_set_edits.m holds them to the model
//   as read).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync } from 'fflate';
import { parseSlx } from '../src/datamodel/parser/SlxParser.js';
import { ConfigSetsError, withConfigSets, type SetState, type SetToWrite } from '../src/datamodel/parser/ConfigSetsWriter.js';

const DIR = fileURLToPath(new URL('./fixtures/config-set-edits/', import.meta.url));
const buf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const text = (b: Uint8Array | undefined) => (b ? new TextDecoder().decode(b) : undefined);
const save = (model: string, edit: string) => new Uint8Array(readFileSync(`${DIR}${model}__${edit}.slx`));

type Sets = SetToWrite[];
const asReadOf = (bytes: Uint8Array, file: string): SetState[] =>
  parseSlx(buf(bytes), file).configSets.map((c) => ({
    name: c.name,
    className: c.objectClass === 'Simulink.ConfigSetRef' ? 'Simulink.ConfigSetRef' : 'Simulink.ConfigSet',
    description: c.description ?? '',
    sourceName: c.sourceName,
  }));
const kept = (asRead: SetState[]): Sets => asRead.map((s, read) => ({ ...s, read }));
const EDITS: Record<string, (s: Sets) => Sets> = {
  add: (s) => [...s, { read: null, name: 'Added', className: 'Simulink.ConfigSet', description: '', sourceName: '' }],
  addref: (s) => [...s, { read: null, name: 'AddedRef', className: 'Simulink.ConfigSetRef', description: '', sourceName: 'dictCfg' }],
  rename: (s) => s.map((x) => (x.name === 'Slow' ? { ...x, name: 'Slower' } : x)),
  describe: (s) => s.map((x) => (x.name === 'Fast' ? { ...x, description: 'Quick runs' } : x)),
  delete: (s) => s.filter((x) => x.name !== 'Slow'),
};

/** MATLAB's save of `model` as it opened, with `edit` made by the writer: its members, and its parse. */
function edited(model: string, edit: string) {
  const file = `${model}.slx`;
  const none = save(model, 'none');
  const entries = unzipSync(none);
  const asRead = asReadOf(none, file);
  const sets = EDITS[edit](kept(asRead));
  const changes = withConfigSets(entries, asRead, sets, { hasDictionary: parseSlx(buf(none), file).dataDictionary !== null });
  const out: Record<string, Uint8Array> = { ...entries };
  for (const [member, b] of Object.entries(changes)) {
    if (b === null) delete out[member];
    else out[member] = b;
  }
  const zipped = zipSync(out);
  return { entries, changes, out, parsed: parseSlx(buf(zipped), file), sets, matlab: unzipSync(save(model, edit)) };
}

// The members each edit's MATLAB save changes that the writer's is to hold byte for byte, by layout.
const INDEX = { json: 'simulink/configSetInfo.json', xml: 'simulink/configSetInfo.xml' };
const RELS = { json: 'simulink/_rels/configSetInfo.json.rels', xml: 'simulink/_rels/configSetInfo.xml.rels' };
const TYPES = '[Content_Types].xml';
const part = (layout: 'json' | 'xml', n: number) => `simulink/configSet${n}.${layout}`;

const PART_LAYOUTS: [string, 'json' | 'xml'][] = [
  ['acs_sets', 'json'],
  ['acs_sets_R2025a', 'xml'],
  ['acs_sets_R2021a', 'xml'],
  ['acs_sets_R2018a', 'xml'],
];

describe("an edit of a model's configuration sets is MATLAB's own save of it", () => {
  for (const [model, layout] of PART_LAYOUTS) {
    it(`${model}: rename moves the index's name and the part's Name`, () => {
      const e = edited(model, 'rename');
      expect(Object.keys(e.changes).sort()).toEqual([INDEX[layout], part(layout, 2)].sort());
      expect(text(e.out[INDEX[layout]])).toBe(text(e.matlab[INDEX[layout]]));
      expect(text(e.out[part(layout, 2)])).toBe(text(e.matlab[part(layout, 2)]));
    });

    it(`${model}: a Description is the set's part alone`, () => {
      const e = edited(model, 'describe');
      expect(Object.keys(e.changes)).toEqual([part(layout, 1)]);
      expect(text(e.out[part(layout, 1)])).toBe(text(e.matlab[part(layout, 1)]));
    });

    it(`${model}: an added set is one more of the index, the relationships and the content types`, () => {
      const e = edited(model, 'add');
      expect(Object.keys(e.changes).sort()).toEqual([INDEX[layout], RELS[layout], TYPES, part(layout, 3)].sort());
      for (const m of [INDEX[layout], RELS[layout], TYPES]) expect([m, text(e.out[m])]).toEqual([m, text(e.matlab[m])]);
    });

    it(`${model}: a deleted set is one fewer of each, its part taken out`, () => {
      const e = edited(model, 'delete');
      expect(e.changes[part(layout, 2)]).toBeNull();
      for (const m of [INDEX[layout], RELS[layout]]) expect([m, text(e.out[m])]).toEqual([m, text(e.matlab[m])]);
      if (layout === 'json') {
        expect(text(e.out[TYPES])).toBe(text(e.matlab[TYPES]));
      } else {
        // MATLAB's export keeps the deleted part, and its Override: here both go.
        const override = `  <Override ContentType="application/vnd.mathworks.simulink.configSet+xml" PartName="/simulink/configSet2.xml"/>\n`;
        expect(text(e.matlab[TYPES])).toContain(override);
        expect(text(e.out[TYPES])).toBe(text(e.matlab[TYPES])!.replace(override, ''));
      }
    });
  }

  for (const [model, layout] of [['acs_ref', 'json'], ['acs_ref_R2025a', 'xml'], ['acs_ref_R2021a', 'xml'], ['acs_ref_R2018a', 'xml']] as const) {
    it(`${model}: an added reference is one more of the index, the relationships and the content types`, () => {
      const e = edited(model, 'addref');
      for (const m of [INDEX[layout], RELS[layout], TYPES]) expect([m, text(e.out[m])]).toEqual([m, text(e.matlab[m])]);
      // A reference's part is MATLAB's own, its SourceLocation aside where the export resolves it.
      const mine = text(e.out[part(layout, 2)])!;
      const theirs = text(e.matlab[part(layout, 2)])!;
      expect(mine.replace(/"SourceLocation":"[^"]*"|<P Name="SourceLocation"[^>]*>[^<]*<\/P>/, '')).toBe(
        theirs.replace(/"SourceLocation":"[^"]*"|<P Name="SourceLocation"[^>]*>[^<]*<\/P>/, ''),
      );
    });
  }

  it.each(['rename', 'describe'])('acs_sets_R2013b: %s is the block diagram MATLAB saves', (edit) => {
    const e = edited('acs_sets_R2013b', edit);
    expect(Object.keys(e.changes)).toEqual(['simulink/blockdiagram.xml']);
    expect(text(e.out['simulink/blockdiagram.xml'])).toBe(text(e.matlab['simulink/blockdiagram.xml']));
  });
});

describe('every edit, in every layout, reads back as asked', () => {
  const MODELS = ['acs_sets', 'acs_sets_R2025a', 'acs_sets_R2021a', 'acs_sets_R2018a', 'acs_sets_R2013b'];
  for (const model of MODELS) {
    for (const edit of ['add', 'rename', 'describe', 'delete']) {
      it(`${model}: ${edit}`, () => {
        const e = edited(model, edit);
        expect(e.parsed.warnings).toEqual([]);
        expect(e.parsed.configSets.map((c) => [c.name, c.objectClass || 'Simulink.ConfigSet', c.description ?? '', c.sourceName])).toEqual(
          e.sets.map((s) => [s.name, s.className, s.description, s.sourceName]),
        );
        expect(e.parsed.configSets.filter((c) => c.active).map((c) => c.name)).toEqual(['Configuration']);
      });
    }
  }
  it.each(['acs_ref', 'acs_ref_R2025a', 'acs_ref_R2021a', 'acs_ref_R2018a', 'acs_ref_R2013b'])('%s: addref', (model) => {
    const e = edited(model, 'addref');
    expect(e.parsed.warnings).toEqual([]);
    expect(e.parsed.configSets.map((c) => [c.name, c.objectClass, c.sourceName])).toEqual([
      ['Configuration', 'Simulink.ConfigSet', ''],
      ['RefFromDict', 'Simulink.ConfigSetRef', 'dictCfg'],
      ['AddedRef', 'Simulink.ConfigSetRef', 'dictCfg'],
    ]);
  });
});

describe('a Description is written as each layout writes one', () => {
  const DESCRIPTION = 'line1 <a&b> "q" \'s\'\nline2';
  // The line MATLAB wrote it on, in its save of acs_sets with Fast so described (esc*.slx).
  const linesOf = (t: string) => t.split('\n').filter((l) => l.includes('line1') || l.startsWith('line2'));
  it.each([
    ['acs_sets', 'esc', 'simulink/configSet1.json'],
    ['acs_sets_R2025a', 'esc_R2025a', 'simulink/configSet1.xml'],
    ['acs_sets_R2021a', 'esc_R2021a', 'simulink/configSet1.xml'],
    ['acs_sets_R2018a', 'esc_R2018a', 'simulink/configSet1.xml'],
    ['acs_sets_R2013b', 'esc_R2013b', 'simulink/blockdiagram.xml'],
  ])('%s', (model, esc, member) => {
    const file = `${model}.slx`;
    const none = save(model, 'none');
    const asRead = asReadOf(none, file);
    const sets = kept(asRead).map((x) => (x.name === 'Fast' ? { ...x, description: DESCRIPTION } : x));
    const out = withConfigSets(unzipSync(none), asRead, sets, { hasDictionary: false });
    const matlab = text(unzipSync(new Uint8Array(readFileSync(`${DIR}${esc}.slx`)))[member])!;
    expect(linesOf(text(out[member]!)!)).toEqual(linesOf(matlab));
  });

  it.each(['acs_sets', 'acs_sets_R2025a', 'acs_sets_R2013b'])('%s: cleared, it is taken out, as a set with none writes none', (model) => {
    const e = edited(model, 'describe');
    const asRead = asReadOf(zipSync(e.out), `${model}.slx`);
    const cleared = kept(asRead).map((x) => (x.name === 'Fast' ? { ...x, description: '' } : x));
    const back = withConfigSets(e.out, asRead, cleared, { hasDictionary: false });
    const member = Object.keys(back)[0];
    expect(text(back[member]!)).toBe(text(e.entries[member]));
  });

  it('cleared in the full XML, it is the empty element MATLAB writes there', () => {
    const e = edited('acs_sets_R2021a', 'describe');
    const asRead = asReadOf(zipSync(e.out), 'acs_sets_R2021a.slx');
    const back = withConfigSets(e.out, asRead, kept(asRead).map((x) => (x.name === 'Fast' ? { ...x, description: '' } : x)), { hasDictionary: false });
    expect(text(back['simulink/configSet1.xml']!)).toBe(text(e.entries['simulink/configSet1.xml']));
  });
});

describe('a package not laid out as MATLAB writes it is refused, saying why', () => {
  it('an index written otherwise', () => {
    const entries = unzipSync(save('acs_sets', 'none'));
    const asRead = asReadOf(save('acs_sets', 'none'), 'acs_sets.slx');
    const index = text(entries['simulink/configSetInfo.json'])!;
    entries['simulink/configSetInfo.json'] = new TextEncoder().encode(JSON.stringify(JSON.parse(index)));
    expect(() => withConfigSets(entries, asRead, EDITS.rename(kept(asRead)), { hasDictionary: false })).toThrow(
      new ConfigSetsError('"simulink/configSetInfo.json" is not laid out as MATLAB writes it'),
    );
  });

  it('sets as read that the index does not list', () => {
    const none = save('acs_sets', 'none');
    const asRead = asReadOf(none, 'acs_sets.slx').slice(0, 2);
    expect(() => withConfigSets(unzipSync(none), asRead, kept(asRead), { hasDictionary: false })).toThrow(
      new ConfigSetsError('"simulink/configSetInfo.json" does not list the configuration sets as they were read'),
    );
  });

  it('no change asked, no member changed', () => {
    for (const model of ['acs_sets', 'acs_sets_R2021a', 'acs_sets_R2013b']) {
      const none = save(model, 'none');
      const asRead = asReadOf(none, `${model}.slx`);
      expect([model, withConfigSets(unzipSync(none), asRead, kept(asRead), { hasDictionary: false })]).toEqual([model, {}]);
    }
  });
});
