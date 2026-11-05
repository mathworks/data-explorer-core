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
//   dup       Fast copied and pasted into its own model: Fast1, every setting Fast's (R2026b+'s layout)
//   fromdict  dictCfg copied out of acs_dict.sldd and pasted into the model (R2026b+'s layout)
//   refpaste  RefFromDict copied and pasted into its own model: RefFromDict1 (acs_ref, every layout)
//   todict    Fast copied out of the model and pasted into acs_dict.sldd, the dictionary saved
//             (OUT/cases/<id>/acs_dict.sldd) and the model left as it was (R2026b+'s layout)
//   frombindict, tobindict  the same with a binary dictionary, acs_bin.sldd (MATLAB's R2027a save
//             test/parity/oldsaves/old_saves_r2027a_binary.sldd): its csAutosar, a set with an
//             AUTOSAR target's dynamic properties, into the model; Fast into it
//   add1, rename1 (Configuration renamed Main), describe1: on `one`, a model of one set, which
//             MATLAB's index lists inline; and `delete` on `two` (Configuration and Slow), down to one
//   addref    a Simulink.ConfigSetRef added (Reference), pointed at dictCfg (acs_ref)
//   source    RefFromDict pointed at dictCfg2 (acs_ref)
//
// Reads the BUILT package (npm run build first). Writes OUT/cases/<model>__<edit>/<model>.slx and
// OUT/manifest.json; anything it finds wrong is the case's `js` (anything but '' fails it).
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createSession, parseBinarySldd } from '../../../dist/index.js';

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
  add1: (o) => o.s.addEntry('config', 'Simulink.ConfigSet')?.name === 'Configuration1',
  rename1: (o) => o.edit('Configuration', 'Name', 'Main'),
  describe1: (o) => o.edit('Configuration', 'Description', 'The one set'),
  dup: (o) => o.paste(o.config.id, [o.set('Fast').serialize()]) === 'Fast1',
  fromdict: (o) => o.paste(o.config.id, [o.dict().entry('dictCfg').serialize()]) === 'dictCfg',
  refpaste: (o) => o.paste(o.config.id, [o.set('RefFromDict').serialize()]) === 'RefFromDict1',
  todict: (o) => o.paste(o.dict().config.id, [o.set('Fast').serialize()]) === 'Fast' && ((o.dictSaved = 'acs_dict.sldd'), true),
  frombindict: (o) => o.paste(o.config.id, [o.dict('acs_bin.sldd').entry('csAutosar').serialize()]) === 'csAutosar',
  tobindict: (o) => o.paste(o.dict('acs_bin.sldd').config.id, [o.set('Fast').serialize()]) === 'Fast' && ((o.dictSaved = 'acs_bin.sldd'), true),
  bareref: (o) => o.s.addEntry('config', 'Simulink.ConfigSetRef')?.name === 'Reference',
  addref: (o) => o.s.addEntry('config', 'Simulink.ConfigSetRef')?.name === 'Reference' && o.edit('Reference', 'SourceName', 'dictCfg') === true,
  source: (o) => o.edit('RefFromDict', 'SourceName', 'dictCfg2'),
};
const SETS_EDITS = ['rename', 'describe', 'add', 'delete', 'combo', 'spaced', 'bareref'];
const REF_EDITS = ['addref', 'source', 'refpaste'];
// A set's settings are copied and pasted in R2026b+'s layout alone: acs_sets, as R2027a saves it.
const PASTE_EDITS = ['dup', 'fromdict', 'todict', 'frombindict', 'tobindict'];
const EDITS_OF = (model) =>
  model.startsWith('acs_ref') ? REF_EDITS : model === 'one' ? ['add1', 'rename1', 'describe1'] : model === 'two' ? ['delete'] : model === 'acs_sets' ? [...SETS_EDITS, ...PASTE_EDITS] : SETS_EDITS;
const DICTS = path.join(OUT, 'dict');

const GEN = path.join(OUT, 'gen');
const manifest = [];
for (const file of readdirSync(GEN).filter((f) => f.endsWith('.slx')).sort()) {
  const model = file.slice(0, -4);
  const bytes = new Uint8Array(readFileSync(path.join(GEN, file)));
  for (const edit of EDITS_OF(model)) {
    const s = createSession();
    const root = s.addModelSource(file, bufferOf(bytes));
    s.setActiveContext(root);
    const config = root.getSection('config');
    const set = (n) => config.children.find((c) => c.name === n);
    const dicts = {};
    const o = {
      s,
      set,
      config,
      edit: (n, key, value) => {
        s.setActive(root, set(n));
        return s.editProperty(set(n).id, key, value);
      },
      // The name the one entry pasted is given, or what the session said.
      paste: (into, payloads) => {
        const made = s.pasteEntries(into, payloads);
        return made.error ? made.reason : made.nodes.map((n) => n.name).join(',');
      },
      // A dictionary of OUT/dict, text or binary, opened in the session as a host opens it.
      dict: (name = 'acs_dict.sldd') => {
        if (!dicts[name]) {
          const raw = readFileSync(path.join(DICTS, name));
          const content = raw[0] === 0x50 ? parseBinarySldd(bufferOf(new Uint8Array(raw))) : JSON.parse(raw.toString('utf8'));
          const droot = s.addDataSource(name, content, { path: name });
          const dconfig = droot.children.find((c) => c.name === 'config');
          dicts[name] = { config: dconfig, entry: (n) => dconfig.children.find((c) => c.name === n) };
        }
        return dicts[name];
      },
    };
    let js = '';
    try {
      const made = EDITS[edit](o);
      if (made !== true) js = 'the session refused the edit: ' + JSON.stringify(made);
      else {
        const dir = path.join(OUT, 'cases', `${model}__${edit}`);
        mkdirSync(dir, { recursive: true });
        if (o.dictSaved) {
          // The dictionary, as the session saves it; the model, as it was read.
          const saved = s.serializeSource(o.dictSaved);
          writeFileSync(path.join(dir, o.dictSaved), saved.text ?? saved.bytes);
          writeFileSync(path.join(dir, file), bytes);
        } else {
          writeFileSync(path.join(dir, file), s.serializeSource(file).bytes);
        }
      }
    } catch (err) {
      js = String(err?.message ?? err);
    }
    manifest.push({ id: `${model}__${edit}`, model, file, edit, js });
  }
}
writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`PROBE_CONFIG_SET_EDITS_JS ${manifest.length} cases, ${manifest.filter((c) => c.js).length} with a Node-side failure`);
