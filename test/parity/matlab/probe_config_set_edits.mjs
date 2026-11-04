// Copyright 2026 The MathWorks, Inc.
//
// The Node half of probe_config_set_edits.m, which runs it between its two MATLAB halves: for each
// model under OUT/gen (test/fixtures/active-config, copied there), one save per edit of its
// configuration sets, made as a host makes it: the model opened in a session, the edit made there
// (editProperty, addEntry('config', ...), deleteNodeById, setActiveConfigSet), and the model saved
// (serializeSource). The edits, each the one probe_config_set_edits.m makes in MATLAB too:
//
//   rename    Fast renamed 'Fast run-2'
//   describe  Fast's Description set to a text with markup, quotes and a second line
//   add       a Simulink.ConfigSet added (Configuration1)
//   delete    Slow deleted
//   combo     a set added and renamed Newest, made active, Configuration deleted, Fast described
//   spaced    Fast renamed ' Fast run ', and described with spaces and line breaks around its text
//   bareref   a Simulink.ConfigSetRef added (Reference), pointed at nothing yet, as an Add makes it
//   addref    a Simulink.ConfigSetRef added (Reference), pointed at dictCfg (acs_ref)
//   source    RefFromDict pointed at dictCfg2 (acs_ref)
//
// Reads the BUILT package (npm run build first). Writes OUT/cases/<model>__<edit>/<model>.slx and
// OUT/manifest.json; anything it finds wrong is the case's `js` (anything but '' fails it).
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createSession } from '../../../dist/index.js';

const OUT = process.argv[2];
if (!OUT || !path.isAbsolute(OUT)) throw new Error('Give the probe directory, an absolute path: ' + OUT);

const DESCRIPTION = 'Quick <runs> & "more" \'s\'\nsecond line';
const bufferOf = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

const EDITS = {
  rename: (o) => o.edit('Fast', 'Name', 'Fast run-2'),
  describe: (o) => o.edit('Fast', 'Description', DESCRIPTION),
  add: (o) => o.s.addEntry('config', 'Simulink.ConfigSet')?.name === 'Configuration1',
  delete: (o) => o.s.deleteNodeById(o.set('Slow').id),
  combo: (o) => {
    const added = o.s.addEntry('config', 'Simulink.ConfigSet');
    return (
      !!added &&
      o.edit(added.name, 'Name', 'Newest') === true &&
      o.s.setActiveConfigSet(o.set('Newest').id) &&
      o.s.deleteNodeById(o.set('Configuration').id) &&
      o.edit('Fast', 'Description', 'Quick runs') === true
    );
  },
  spaced: (o) => o.edit('Fast', 'Name', ' Fast run ') === true && o.edit(' Fast run ', 'Description', '  two\nlines\n'),
  bareref: (o) => o.s.addEntry('config', 'Simulink.ConfigSetRef')?.name === 'Reference',
  addref: (o) => o.s.addEntry('config', 'Simulink.ConfigSetRef')?.name === 'Reference' && o.edit('Reference', 'SourceName', 'dictCfg') === true,
  source: (o) => o.edit('RefFromDict', 'SourceName', 'dictCfg2'),
};
const SETS_EDITS = ['rename', 'describe', 'add', 'delete', 'combo', 'spaced', 'bareref'];
const REF_EDITS = ['addref', 'source'];

const GEN = path.join(OUT, 'gen');
const manifest = [];
for (const file of readdirSync(GEN).filter((f) => f.endsWith('.slx')).sort()) {
  const model = file.slice(0, -4);
  const bytes = new Uint8Array(readFileSync(path.join(GEN, file)));
  for (const edit of model.startsWith('acs_ref') ? REF_EDITS : SETS_EDITS) {
    const s = createSession();
    const root = s.addModelSource(file, bufferOf(bytes));
    s.setActiveContext(root);
    const config = root.getSection('config');
    const set = (n) => config.children.find((c) => c.name === n);
    const o = {
      s,
      set,
      edit: (n, key, value) => {
        s.setActive(root, set(n));
        return s.editProperty(set(n).id, key, value);
      },
    };
    let js = '';
    try {
      const made = EDITS[edit](o);
      if (made !== true) js = 'the session refused the edit: ' + JSON.stringify(made);
      else {
        const out = s.serializeSource(file).bytes;
        const dir = path.join(OUT, 'cases', `${model}__${edit}`);
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, file), out);
      }
    } catch (err) {
      js = String(err?.message ?? err);
    }
    manifest.push({ id: `${model}__${edit}`, model, file, edit, js });
  }
}
writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`PROBE_CONFIG_SET_EDITS_JS ${manifest.length} cases, ${manifest.filter((c) => c.js).length} with a Node-side failure`);
