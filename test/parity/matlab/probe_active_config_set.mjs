// Copyright 2026 The MathWorks, Inc.
//
// The Node half of probe_active_config_set.m, which runs it between its two MATLAB halves: for
// each model under OUT/gen (test/fixtures/active-config, copied there), one copy per
// configuration set that is not active, with that set made active by the smallest change to the
// package that says so, and every other member as read. What the change is, per layout:
//
//   configSetInfo.json (R2026b+)  the entry's "Active":true field, moved to the set's entry
//   configSetInfo.xml (R2014b+)   the Active="true" attribute, moved to the set's <ConfigSet>
//   blockdiagram.xml (R2013b)     the ObjectID the <Object PropName="ActiveConfigurationSet">
//                                 reference names, made the set's own
//
// The member is spliced as text, never written anew, and the package zipped again with each
// member's stamp as read (ZipAsRead), as the model writer does. Also one case per model with no
// change at all (`none`), which must open as the model MATLAB wrote does.
//
// Reads the BUILT package (npm run build first). Writes OUT/cases/<id>/<model>.slx and
// OUT/manifest.json; anything it finds wrong is the case's `js` (anything but '' fails it).
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import { parseSlx } from '../../../dist/index.js';
import { asRead } from '../../../dist/datamodel/parser/ZipAsRead.js';
import { zipMemberStamps } from '../../../dist/datamodel/parser/Inflate.js';

const OUT = process.argv[2];
if (!OUT || !path.isAbsolute(OUT)) throw new Error('Give the probe directory, an absolute path: ' + OUT);

const JSON_INFO = 'simulink/configSetInfo.json';
const XML_INFO = 'simulink/configSetInfo.xml';
const BLOCK_DIAGRAM = 'simulink/blockdiagram.xml';
const text = (bytes) => new TextDecoder().decode(bytes);
const bytesOf = (s) => new TextEncoder().encode(s);

/** configSetInfo.json with set `to` active: "Active":true leaves the entry that has it, for `to`'s. */
function spliceJson(source, to) {
  let found = 0;
  const out = source.replace(/\{[^{}]*\}/g, (entry) => {
    const name = /"ConfigSetName"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(entry);
    const active = /"Active"\s*:\s*true\s*,\s*/.exec(entry);
    if (name && JSON.parse(name[1]) === to) {
      found++;
      return active ? entry : entry.replace(/^\{(\s*)/, (_, ws) => `{${ws}"Active":true,${ws}`);
    }
    return active ? entry.slice(0, active.index) + entry.slice(active.index + active[0].length) : entry;
  });
  if (found !== 1) throw new Error(`${JSON_INFO} lists "${to}" ${found} times`);
  return out;
}

const unescapeXml = (s) =>
  s.replace(/&(lt|gt|quot|apos|amp);/g, (_, e) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[e]);

/** configSetInfo.xml with set `to` active: Active="true" leaves the <ConfigSet> that has it, for `to`'s. */
function spliceXml(source, to) {
  let found = 0;
  const out = source.replace(/<ConfigSet\b([^>]*)>([^<]*)<\/ConfigSet>/g, (all, attrs, name) => {
    const plain = attrs.replace(/\s+Active="true"/, '');
    if (unescapeXml(name) === to) {
      found++;
      return `<ConfigSet${plain} Active="true">${name}</ConfigSet>`;
    }
    return `<ConfigSet${plain}>${name}</ConfigSet>`;
  });
  if (found !== 1) throw new Error(`${XML_INFO} lists "${to}" ${found} times`);
  return out;
}

/**
 * The top-level configuration sets of an R2013b blockdiagram.xml: each <Object> of class
 * Simulink.ConfigSet or ConfigSetRef, its ObjectID, and the Name its own <P> elements give (a
 * component object nested in it has a Name too, so only the set's own depth is read).
 */
function inlineSets(source) {
  const sets = [];
  const open = /<Object\b[^>]*\bClassName="Simulink\.ConfigSet(?:Ref)?"[^>]*>/g;
  for (let m; (m = open.exec(source)); ) {
    const id = /\bObjectID="(\d+)"/.exec(m[0])?.[1];
    const tags = /<Object\b[^>]*?(\/?)>|<\/Object>|<P Name="Name"[^>]*>([^<]*)<\/P>/g;
    tags.lastIndex = m.index + m[0].length;
    let depth = 1;
    let name;
    for (let t; depth > 0 && (t = tags.exec(source)); ) {
      if (t[0] === '</Object>') depth--;
      else if (t[0].startsWith('<Object')) depth += t[1] ? 0 : 1;
      else if (depth === 1) name = unescapeXml(t[2]);
    }
    sets.push({ id, name });
    open.lastIndex = tags.lastIndex;
  }
  return sets;
}

/** blockdiagram.xml with set `to` active: the ActiveConfigurationSet reference names its ObjectID. */
function spliceInline(source, to) {
  const target = inlineSets(source).filter((s) => s.name === to);
  if (target.length !== 1) throw new Error(`${BLOCK_DIAGRAM} holds "${to}" ${target.length} times`);
  const ref = /(<Object\b[^>]*\bPropName="ActiveConfigurationSet"[^>]*\bObjectID=")(\d+)(")/;
  if (!ref.test(source)) throw new Error(`${BLOCK_DIAGRAM} names no ActiveConfigurationSet`);
  return source.replace(ref, (_, a, __, c) => a + target[0].id + c);
}

/**
 * The member that says which set is active, and the splice that makes `to` the one. An R2013b
 * export from R2027a holds a configSetInfo.xml that lists no set, beside the sets inline: there
 * the block diagram says it, as core's reader has it.
 */
function activeMember(entries) {
  if (entries[JSON_INFO]) return { member: JSON_INFO, splice: spliceJson };
  if (entries[XML_INFO] && /<ConfigSet\b/.test(text(entries[XML_INFO]))) return { member: XML_INFO, splice: spliceXml };
  return { member: BLOCK_DIAGRAM, splice: spliceInline };
}

/** The package with `member` replaced, every member's place and stamp as read. */
function rezip(bytes, entries, member, replaced) {
  return zipSync(asRead({ ...entries, ...(member ? { [member]: replaced } : {}) }, zipMemberStamps(bytes) ?? undefined), { level: 6 });
}

const GEN = path.join(OUT, 'gen');
const manifest = [];
for (const file of readdirSync(GEN).filter((f) => f.endsWith('.slx')).sort()) {
  const model = file.slice(0, -4);
  const bytes = new Uint8Array(readFileSync(path.join(GEN, file)));
  const parsed = parseSlx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), file);
  const entries = unzipSync(bytes);
  const { member, splice } = activeMember(entries);
  const sets = parsed.configSets.map((s) => s.name);
  const from = parsed.configSets.find((s) => s.active)?.name ?? '';
  const write = (id, to, out, js) => {
    const dir = path.join(OUT, 'cases', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, file), out);
    manifest.push({ id, model, file, member, sets, from, to, js });
  };
  write(`${model}__none`, from, rezip(bytes, entries, null), '');
  for (const to of sets.filter((s) => s !== from)) {
    let js = '';
    let out = bytes;
    try {
      const before = text(entries[member]);
      const after = splice(before, to);
      // The splice is its own inverse: made active again, the set read active gives the member back.
      if (splice(after, from) !== before) js += `making "${from}" active again does not give ${member} back as read; `;
      out = rezip(bytes, entries, member, bytesOf(after));
      const again = parseSlx(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength), file);
      const active = again.configSets.filter((s) => s.active).map((s) => s.name);
      if (active.join() !== to) js += `core reads [${active.join(', ')}] active, not "${to}"; `;
      if (again.configSets.map((s) => s.name).join() !== sets.join()) js += 'core reads other sets; ';
      const outEntries = unzipSync(out);
      for (const name of Object.keys(entries)) {
        if (name !== member && !equalBytes(entries[name], outEntries[name])) js += `${name} changed; `;
      }
    } catch (err) {
      js += String(err?.message ?? err);
    }
    write(`${model}__${to}`, to, out, js.trim());
  }
}

function equalBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`PROBE_ACTIVE_CONFIG_SET_JS ${manifest.length} cases, ${manifest.filter((c) => c.js).length} with a Node-side failure`);
