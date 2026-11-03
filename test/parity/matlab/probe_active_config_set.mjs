// Copyright 2026 The MathWorks, Inc.
//
// The Node half of probe_active_config_set.m, which runs it between its two MATLAB halves: for
// each model under OUT/gen (test/fixtures/active-config, copied there), one save per configuration
// set that is not active, made as a host makes it: the model opened in a session, the set made
// active (setActiveConfigSet), and the model saved (serializeSource), which moves the one mark the
// package keeps of the active set and writes every other member as read (ActiveConfigMark):
//
//   configSetInfo.json (R2026b+)  the entry's "Active":true field, moved to the set's entry
//   configSetInfo.xml (R2014b+)   the Active="true" attribute, moved to the set's <ConfigSet>
//   blockdiagram.xml (R2013b)     the ObjectID the <Object PropName="ActiveConfigurationSet">
//                                 reference names, made the set's own
//
// Also one save per model with no change at all (`none`), which must open as the model MATLAB
// wrote does. A change the session refuses is written as no save: the case holds the session's
// reason (`refused`), for the MATLAB half to set beside what MATLAB does with the same change.
//
// Reads the BUILT package (npm run build first). Writes OUT/cases/<id>/<model>.slx and
// OUT/manifest.json; anything it finds wrong is the case's `js` (anything but '' fails it): the save
// does not read back with the set active, or changes a member other than the mark.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { createSession, parseSlx } from '../../../dist/index.js';
import { activeMarkMember } from '../../../dist/datamodel/parser/ActiveConfigMark.js';

const OUT = process.argv[2];
if (!OUT || !path.isAbsolute(OUT)) throw new Error('Give the probe directory, an absolute path: ' + OUT);

const bufferOf = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const equalBytes = (a, b) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);

function opened(file, bytes) {
  const s = createSession();
  const model = s.addModelSource(file, bufferOf(bytes));
  s.setActiveContext(model);
  return { s, model, config: model.getSection('config').children };
}

const GEN = path.join(OUT, 'gen');
const manifest = [];
for (const file of readdirSync(GEN).filter((f) => f.endsWith('.slx')).sort()) {
  const model = file.slice(0, -4);
  const bytes = new Uint8Array(readFileSync(path.join(GEN, file)));
  const entries = unzipSync(bytes);
  const member = activeMarkMember(entries);
  const first = opened(file, bytes);
  const sets = first.config.map((c) => c.name);
  const from = first.config.find((c) => c.active)?.name ?? '';
  const write = (id, to, out, js, refused = '') => {
    if (out) {
      const dir = path.join(OUT, 'cases', id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, file), out);
    }
    manifest.push({ id, model, file, member, sets, from, to, js, refused });
  };
  write(`${model}__none`, from, first.s.serializeSource(file).bytes, '');
  for (const to of sets.filter((s) => s !== from)) {
    const { s, config } = opened(file, bytes);
    const set = config.find((c) => c.name === to);
    const refused = s.activeConfigSetRefusal(set.id);
    if (refused !== null) {
      write(`${model}__${to}`, to, null, s.setActiveConfigSet(set.id) ? 'the session makes the change it refuses' : '', refused);
      continue;
    }
    let js = '';
    let out = null;
    try {
      if (!s.setActiveConfigSet(set.id)) throw new Error('the session refuses the change it says it makes');
      out = s.serializeSource(file).bytes;
      const back = parseSlx(bufferOf(out), file).configSets;
      const active = back.filter((c) => c.active).map((c) => c.name);
      if (active.join() !== to) js += `core reads [${active.join(', ')}] active, not "${to}"; `;
      if (back.map((c) => c.name).join() !== sets.join()) js += 'core reads other sets; ';
      const saved = unzipSync(out);
      if (Object.keys(saved).join() !== Object.keys(entries).join()) js += 'the members are not those read, in their order; ';
      for (const name of Object.keys(entries)) {
        if (name !== member && !equalBytes(entries[name], saved[name])) js += `${name} changed; `;
      }
    } catch (err) {
      js += String(err?.message ?? err);
    }
    write(`${model}__${to}`, to, out, js.trim());
  }
}

writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(
  `PROBE_ACTIVE_CONFIG_SET_JS ${manifest.length} cases, ${manifest.filter((c) => c.refused).length} refused by the session, ` +
    `${manifest.filter((c) => c.js).length} with a Node-side failure`,
);
