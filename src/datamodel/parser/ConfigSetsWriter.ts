// Copyright 2026 The MathWorks, Inc.

import { BLOCK_DIAGRAM, JSON_INFO, XML_INFO, activeMarkMember } from './ActiveConfigMark.js';

// A `.slx` package with its configuration sets as edited: each set renamed, given a Description or,
// for a reference, a source, sets added and sets deleted, every other byte as read. No node is
// imported here. Which set is active is ActiveConfigMark's, applied after this.
//
// Measured on R2027a against MATLAB's own save of each edit, in every layout
// (test/parity/matlab/probe_config_set_writes.m):
//
//   R2026b+ (JSON), R2015a-R2026a (XML)  the index (configSetInfo.json/.xml) lists each set and its
//     part, simulink/configSetN.json/.xml; a set's part is related from
//     simulink/_rels/configSetInfo.*.rels and has an Override in [Content_Types].xml. An added set is
//     one more of each; a deleted one, one fewer. A rename moves the index's name and the part's
//     Name; a Description is the part's alone.
//   R2013b and earlier (inline)  every set is an <Object> of blockdiagram.xml's ConfigurationSets
//     array, numbered by ObjectIDs that are the whole file's.
//
// A set's part comes in three forms, by layout: JSON, where MATLAB writes only what differs from a
// fresh set's defaults; R2024b-R2026a's sparse XML, the same, each value with its Class; and the full
// XML of R2015a-R2021a, every property written. An added set is written as its Name and the Version
// of its layout's other sets and nothing else, as a dictionary's is (ConfigSetNode.createDefault):
// MATLAB opens it as a fresh set of its own release (measured: every one of 586 parameters, R2027a).

/** A set's class: a set, or a reference to one. */
export type SetClass = 'Simulink.ConfigSet' | 'Simulink.ConfigSetRef';

/** A configuration set as the package holds it, or as it is to hold it. */
export interface SetState {
  name: string;
  className: SetClass;
  description: string;
  /** What a reference points to; '' for a set. */
  sourceName: string;
}

/** A set the package is to hold: one it held (`read`, its place in the sets as read) or a new one. */
export interface SetToWrite extends SetState {
  read: number | null;
}

/** Why the sets cannot be written as asked, as a clause. */
export class ConfigSetsError extends Error {}

const SET_RELATIONSHIP = 'http://schemas.mathworks.com/simulink/2014/relationships/configSet';
const has = (entries: Record<string, Uint8Array>, name: string) => Object.prototype.hasOwnProperty.call(entries, name);
const text = (bytes: Uint8Array, member: string): string => {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new ConfigSetsError(`"${member}" is not text`);
  }
};
const bytes = (s: string) => new TextEncoder().encode(s);

/**
 * The members of `entries` the sets as asked change: each with its new bytes, or null for one taken
 * out. `asRead` is the package's sets as read, in order; `sets` the sets it is to hold, in order, as
 * read where `read` names one and added where it is null, every set as read that none names
 * deleted. Throws ConfigSetsError, saying why, where the package is not laid out as MATLAB writes it.
 */
export function withConfigSets(
  entries: Record<string, Uint8Array>,
  asRead: readonly SetState[],
  sets: readonly SetToWrite[],
  model: { hasDictionary: boolean },
): Record<string, Uint8Array | null> {
  const member = activeMarkMember(entries);
  if (!member) throw new ConfigSetsError('the model holds no part that lists its configuration sets');
  return member === BLOCK_DIAGRAM ? inlineSets(entries, asRead, sets) : partSets(entries, member, asRead, sets, model);
}

// --- The JSON and XML layouts: an index, and a part per set ---------------------------------------

interface Listed {
  name: string;
  part: string;
  active: boolean;
}

function partSets(
  entries: Record<string, Uint8Array>,
  index: string,
  asRead: readonly SetState[],
  sets: readonly SetToWrite[],
  model: { hasDictionary: boolean },
): Record<string, Uint8Array | null> {
  const json = index === JSON_INFO;
  const ext = json ? 'json' : 'xml';
  const source = text(entries[index], index);
  const listed = json ? readJsonIndex(source) : readXmlIndex(source);
  // The index lists the sets as read, and is written as MATLAB writes it: the one condition under
  // which it is written again from the sets rather than spliced.
  if (listed.map((s) => s.name).join('\u0000') !== asRead.map((s) => s.name).join('\u0000')) {
    throw new ConfigSetsError(`"${index}" does not list the configuration sets as they were read`);
  }
  if ((json ? jsonIndex(listed) : xmlIndex(listed)) !== source) {
    throw new ConfigSetsError(`"${index}" is not laid out as MATLAB writes it`);
  }
  const out: Record<string, Uint8Array | null> = {};
  const used = new Set(listed.map((s) => s.part));
  let next = 1 + Math.max(-1, ...listed.map((s) => Number(/configSet(\d+)\.\w+$/.exec(s.part)?.[1] ?? -1)));
  const version = setVersion(entries, listed, json);
  const now: Listed[] = [];
  const added: string[] = [];
  for (const set of sets) {
    if (set.read === null) {
      let part = `/simulink/configSet${next++}.${ext}`;
      while (used.has(part) || has(entries, part.slice(1))) part = `/simulink/configSet${next++}.${ext}`;
      used.add(part);
      added.push(part);
      now.push({ name: set.name, part, active: false });
      const fresh = json ? newJsonPart(set, version, model) : newXmlPart(set, version);
      out[part.slice(1)] = bytes(fresh);
      continue;
    }
    const was = listed[set.read];
    now.push({ name: set.name, part: was.part, active: was.active });
    const member = was.part.slice(1);
    if (!has(entries, member)) throw new ConfigSetsError(`the configuration set "${was.name}" is listed as part "${member}", which the package does not hold`);
    const before = text(entries[member], member);
    const after = json ? editJsonPart(before, asRead[set.read], set, member) : editXmlPart(before, asRead[set.read], set, member);
    if (after !== before) out[member] = bytes(after);
  }
  const removed = listed.filter((s) => !now.some((n) => n.part === s.part)).map((s) => s.part);
  for (const part of removed) out[part.slice(1)] = null;
  if (now.length !== listed.length || now.some((s, i) => s.name !== listed[i].name || s.part !== listed[i].part)) {
    out[index] = bytes(json ? jsonIndex(now) : xmlIndex(now));
  }
  if (added.length || removed.length) {
    const rels = `simulink/_rels/configSetInfo.${ext}.rels`;
    if (!has(entries, rels)) throw new ConfigSetsError(`the package holds no "${rels}", which relates the configuration sets' parts`);
    out[rels] = bytes(withRelationships(text(entries[rels], rels), added, removed, rels));
    const types = '[Content_Types].xml';
    if (!has(entries, types)) throw new ConfigSetsError(`the package holds no "${types}", which names its parts' types`);
    out[types] = bytes(withOverrides(text(entries[types], types), added, removed, `application/vnd.mathworks.simulink.configSet+${ext}`));
  }
  return out;
}

function readJsonIndex(source: string): Listed[] {
  let parsed: { ConfigSetInfo?: unknown };
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new ConfigSetsError(`"${JSON_INFO}" cannot be read`);
  }
  const list = Array.isArray(parsed.ConfigSetInfo) ? parsed.ConfigSetInfo : [];
  return list.map((e: Record<string, unknown>) => ({ name: String(e.ConfigSetName ?? ''), part: String(e.PartName ?? ''), active: e.Active === true }));
}

const unescapeXml = (s: string) =>
  s.replace(/&(lt|gt|quot|apos|amp);/g, (_, e: string) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[e]!);
const escapeXml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

function readXmlIndex(source: string): Listed[] {
  return [...source.matchAll(/<ConfigSet PartName="([^"]*)"( Active="true")?>([^<]*)<\/ConfigSet>/g)].map((m) => ({
    name: unescapeXml(m[3]),
    part: unescapeXml(m[1]),
    active: !!m[2],
  }));
}

// The JSON MATLAB writes, string by string: `/` as `\/`, as its part names show.
const jsonString = (s: string) => JSON.stringify(s).replace(/\//g, '\\/');

function jsonIndex(sets: readonly Listed[]): string {
  const entry = (s: Listed) =>
    '    {\n' + (s.active ? '      "Active":true,\n' : '') + `      "ConfigSetName":${jsonString(s.name)},\n      "PartName":${jsonString(s.part)}\n    }`;
  return '{\n  "ConfigSetInfo":[\n' + sets.map(entry).join(',\n') + '\n  ]\n}';
}

function xmlIndex(sets: readonly Listed[]): string {
  const line = (s: Listed) => `  <ConfigSet PartName="${escapeXml(s.part)}"${s.active ? ' Active="true"' : ''}>${escapeXml(s.name)}</ConfigSet>\n`;
  return '<?xml version="1.0" encoding="utf-8"?>\n<ConfigSetInfo>\n' + sets.map(line).join('') + '</ConfigSetInfo>\n';
}

// The Version a new set is stamped with: that of a set its layout holds, as MATLAB stamps its own.
function setVersion(entries: Record<string, Uint8Array>, listed: readonly Listed[], json: boolean): { value: string; attribute: boolean } {
  for (const s of listed) {
    const member = s.part.slice(1);
    if (!has(entries, member)) continue;
    const t = text(entries[member], member);
    if (json) {
      const v = /^ {4}"Version":"([^"]+)"/m.exec(t)?.[1];
      if (v) return { value: v, attribute: false };
      continue;
    }
    const attr = /<Object ObjectID="1" Version="([^"]+)" ClassName="Simulink\.ConfigSet(?:Ref)?">/.exec(t)?.[1];
    if (attr) return { value: attr, attribute: true };
    const prop = /^ {4}<P Name="Version" Class="char">([^<]+)<\/P>/m.exec(t)?.[1];
    if (prop) return { value: prop, attribute: false };
  }
  throw new ConfigSetsError('no configuration set the model holds says the Version a new one is to have');
}

function newJsonPart(set: SetToWrite, version: { value: string }, model: { hasDictionary: boolean }): string {
  const head = '{\n  "_id":"1",\n  "_mw_element_name":"ConfigSet",\n  "_mw_element_type":"COSObject",\n';
  const props =
    set.className === 'Simulink.ConfigSetRef'
      ? [
          '    "ConfigPrmDlgPosition":[0,  0,  0,  0]',
          '    "CurrentDlgPage":""',
          ...(set.description ? [`    "Description":${jsonString(set.description)}`] : []),
          `    "Name":${jsonString(set.name)}`,
          '    "ParameterOverrideValues":{\n      "_array_type":"Cell",\n      "_dimensions":[0,  1],\n      "_elements":[]\n    }',
          '    "ParameterOverrides":{\n      "_array_type":"Cell",\n      "_dimensions":[0,  0],\n      "_elements":[]\n    }',
          `    "SourceLocation":"${model.hasDictionary ? 'Data Dictionary' : 'Base Workspace'}"`,
          `    "SourceName":${jsonString(set.sourceName)}`,
          '    "UserParameterOverrides":{\n      "_array_type":"Cell",\n      "_dimensions":[0,  0],\n      "_elements":[]\n    }',
          `    "Version":${jsonString(version.value)}`,
        ]
      : [...(set.description ? [`    "Description":${jsonString(set.description)}`] : []), `    "Name":${jsonString(set.name)}`, `    "Version":${jsonString(version.value)}`];
  return head + `  "_object_class":"${set.className}",\n  "_properties":{\n` + props.join(',\n') + '\n  }\n}';
}

function newXmlPart(set: SetToWrite, version: { value: string; attribute: boolean }): string {
  const v = escapeXml(version.value);
  const d = escapeXml(set.description);
  const n = escapeXml(set.name);
  const s = escapeXml(set.sourceName);
  let body: string;
  if (set.className === 'Simulink.ConfigSetRef') {
    body = !version.attribute
      ? `  <Object ObjectID="1" ClassName="Simulink.ConfigSetRef">\n    <P Name="SourceName" Class="char">${s}</P>\n    <P Name="SourceLocation" Class="char">Base Workspace</P>\n` +
        '    <Array PropName="ParameterOverrides" Type="Cell" Dimension="0*0"/>\n    <Array PropName="ParameterOverrideValues" Type="Cell" Dimension="0*1"/>\n' +
        `    <Array PropName="UserParameterOverrides" Type="Cell" Dimension="0*0"/>\n    <P Name="Name" Class="char">${n}</P>\n    <P Name="CurrentDlgPage" Class="char"/>\n` +
        `    <P Name="ConfigPrmDlgPosition" Class="double">[0.0, 0.0, 0.0, 0.0]</P>\n${d ? `    <P Name="Description" Class="char">${d}</P>\n` : ''}    <P Name="Version" Class="char">${v}</P>\n  </Object>\n`
      : v.startsWith('1.')
        ? `  <Object ObjectID="1" Version="${v}" ClassName="Simulink.ConfigSetRef">\n    <P Name="DisabledProps">[]</P>\n    <P Name="Description"${d ? `>${d}</P>` : '/>'}\n` +
          `    <P Name="Components">[]</P>\n    <P Name="Name">${n}</P>\n    <P Name="WSVarName">${s}</P>\n    <P Name="SourceLocation">Base Workspace</P>\n  </Object>\n`
        : `  <Object ObjectID="1" Version="${v}" ClassName="Simulink.ConfigSetRef">\n    <P Name="DisabledProps">[]</P>\n    <P Name="Description"${d ? `>${d}</P>` : '/>'}\n` +
          `    <P Name="Components">[]</P>\n    <P Name="Name">${n}</P>\n    <P Name="CurrentDlgPage"/>\n    <P Name="ConfigPrmDlgPosition" Class="double">[0, 0, 0, 0]</P>\n` +
          `    <P Name="SourceName">${s}</P>\n    <P Name="SourceLocation">Base Workspace</P>\n    <P Name="ParameterOverrides">[]</P>\n` +
          '    <P Name="ParameterOverrideValues">[]</P>\n    <P Name="UserParameterOverrides">[]</P>\n  </Object>\n';
  } else {
    body = version.attribute
      ? `  <Object ObjectID="1" Version="${v}" ClassName="Simulink.ConfigSet">\n    <P Name="Description"${d ? `>${d}</P>` : '/>'}\n    <P Name="Name">${n}</P>\n  </Object>\n`
      : `  <Object ObjectID="1" ClassName="Simulink.ConfigSet">\n    <P Name="Name" Class="char">${n}</P>\n${d ? `    <P Name="Description" Class="char">${d}</P>\n` : ''}    <P Name="Version" Class="char">${v}</P>\n  </Object>\n`;
  }
  return `<?xml version="1.0" encoding="utf-8"?>\n<ConfigSet>\n${body}</ConfigSet>\n`;
}

// --- A set's own properties, edited in place -------------------------------------------------------

/** The top-level keys of the JSON object at `[open, close]` (its braces), each with its line. */
function jsonKeys(src: string, open: number, close: number): { key: string; start: number; end: number; valueStart: number; valueEnd: number }[] {
  const keys: { key: string; start: number; end: number; valueStart: number; valueEnd: number }[] = [];
  let depth = 0;
  for (let i = open + 1; i < close; i++) {
    const ch = src[i];
    if (ch === '"') {
      const start = i;
      for (i++; i < close && src[i] !== '"'; i++) if (src[i] === '\\') i++;
      if (depth === 0 && src[i + 1] === ':') {
        const key = JSON.parse(src.slice(start, i + 1)) as string;
        const valueStart = i + 2;
        let j = valueStart;
        let d = 0;
        for (; j < close; j++) {
          const c = src[j];
          if (c === '"') {
            for (j++; j < close && src[j] !== '"'; j++) if (src[j] === '\\') j++;
          } else if (c === '{' || c === '[') d++;
          else if (c === '}' || c === ']') d--;
          else if (c === ',' && d === 0) break;
        }
        let valueEnd = j;
        while (/\s/.test(src[valueEnd - 1])) valueEnd--;
        keys.push({ key, start: src.lastIndexOf('\n', start) + 1, end: valueEnd, valueStart, valueEnd });
        i = j - 1;
      }
    } else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
  }
  return keys;
}

/** The span of the root object's `_properties` object in a set's JSON part. */
function jsonProperties(src: string): { open: number; close: number } {
  const root = { open: src.indexOf('{'), close: src.lastIndexOf('}') };
  const props = jsonKeys(src, root.open, root.close).find((k) => k.key === '_properties');
  if (!props || src[props.valueStart] !== '{') throw new ConfigSetsError('a configuration set\'s part holds no "_properties"');
  return { open: props.valueStart, close: props.valueEnd - 1 };
}

function setJsonKey(src: string, key: string, value: string | null, member: string): string {
  const { open, close } = jsonProperties(src);
  const keys = jsonKeys(src, open, close);
  const at = keys.find((k) => k.key === key);
  if (at) {
    if (value !== null) return src.slice(0, at.valueStart) + jsonString(value) + src.slice(at.valueEnd);
    // Taken out, its line and the comma that joins it to the next (or the previous, where it is last).
    const i = keys.indexOf(at);
    if (i + 1 < keys.length) return src.slice(0, at.start) + src.slice(keys[i + 1].start);
    const prevEnd = keys[i - 1]?.valueEnd ?? open + 1;
    return src.slice(0, prevEnd) + src.slice(at.end);
  }
  if (value === null) return src;
  // Put in among the keys, which MATLAB writes in order of their names.
  const after = keys.find((k) => k.key > key);
  const indent = keys[0] ? src.slice(keys[0].start, src.indexOf('"', keys[0].start)) : '    ';
  if (after) return src.slice(0, after.start) + `${indent}${jsonString(key)}:${jsonString(value)},\n` + src.slice(after.start);
  const last = keys[keys.length - 1];
  if (!last) throw new ConfigSetsError(`"${member}" holds a configuration set with no properties`);
  return src.slice(0, last.valueEnd) + `,\n${indent}${jsonString(key)}:${jsonString(value)}` + src.slice(last.valueEnd);
}

function editJsonPart(src: string, was: SetState, set: SetState, member: string): string {
  let out = src;
  if (set.name !== was.name) out = setJsonKey(out, 'Name', set.name, member);
  if (set.description !== was.description) out = setJsonKey(out, 'Description', set.description || null, member);
  if (set.sourceName !== was.sourceName) out = setJsonKey(out, 'SourceName', set.sourceName, member);
  return out;
}

interface XmlProp {
  name: string;
  /** The element's line, from its indentation to its newline. */
  start: number;
  end: number;
  element: string;
}

/** The properties directly under the <Object> opening at `open`, and where the object closes. */
function xmlProps(src: string, open: number): { props: XmlProp[]; close: number } {
  const openEnd = src.indexOf('>', open) + 1;
  const tags = /<Object\b[^>]*?(\/?)>|<\/Object>|<Array\b[^>]*?(\/?)>|<\/Array>|<P Name="([^"]+)"[^>]*?(?:\/>|>[^<]*<\/P>)/g;
  tags.lastIndex = openEnd;
  const props: XmlProp[] = [];
  let depth = 0;
  for (let t: RegExpExecArray | null; (t = tags.exec(src)); ) {
    const tag = t[0];
    if (tag === '</Object>' || tag === '</Array>') {
      if (depth === 0) return { props, close: t.index };
      depth--;
    } else if (tag.startsWith('<Object') || tag.startsWith('<Array')) {
      if (!(t[1] || t[2])) depth++;
    } else if (depth === 0) {
      const start = src.lastIndexOf('\n', t.index) + 1;
      const nl = src.indexOf('\n', t.index + tag.length);
      props.push({ name: t[3], start, end: nl < 0 ? src.length : nl + 1, element: tag });
    }
  }
  throw new ConfigSetsError('a configuration set\'s <Object> is not closed');
}

/** `src` with the property `name` of the <Object> at `open` set to `value`, or taken out (null). */
function setXmlProp(src: string, open: number, name: string, value: string | null, mode: { sparse: boolean; empty: 'self' | 'pair' | 'none'; before: string | null }): string {
  const { props, close } = xmlProps(src, open);
  const at = props.find((p) => p.name === name);
  const cls = mode.sparse ? ' Class="char"' : '';
  const indent = (p: XmlProp | undefined) => (p ? src.slice(p.start, src.indexOf('<', p.start)) : src.slice(src.lastIndexOf('\n', open) + 1, open) + '  ');
  const element = (v: string | null) =>
    v ? `<P Name="${name}"${cls}>${escapeXml(v)}</P>` : mode.empty === 'self' ? `<P Name="${name}"${cls}/>` : mode.empty === 'pair' ? `<P Name="${name}"${cls}></P>` : null;
  const wanted = element(value);
  if (at) {
    if (wanted === null) return src.slice(0, at.start) + src.slice(at.end);
    return src.slice(0, at.start) + indent(at) + wanted + src.slice(at.start + indent(at).length + at.element.length);
  }
  if (wanted === null) return src;
  // Its object's first child (before: ''), the line after its opening tag, as MATLAB writes a
  // Description in R2013b; or before the property `before`, or last.
  if (mode.before === '') {
    const pos = src.indexOf('\n', open) + 1;
    return src.slice(0, pos) + indent(undefined) + wanted + '\n' + src.slice(pos);
  }
  const before = props.find((p) => p.name === mode.before) ?? null;
  const pos = before ? before.start : src.lastIndexOf('\n', close) + 1;
  return src.slice(0, pos) + indent(before ?? props[0]) + wanted + '\n' + src.slice(pos);
}

function editXmlPart(src: string, was: SetState, set: SetState, member: string): string {
  const open = src.indexOf('<Object ObjectID="1"');
  if (open < 0) throw new ConfigSetsError(`"${member}" holds no configuration set`);
  const sparse = !/^<Object ObjectID="1" Version=/.test(src.slice(open));
  let out = src;
  if (set.name !== was.name) out = setXmlProp(out, open, 'Name', set.name, { sparse, empty: 'self', before: null });
  if (set.description !== was.description) {
    out = setXmlProp(out, open, 'Description', set.description || null, { sparse, empty: sparse ? 'none' : 'self', before: sparse ? 'Version' : 'Name' });
  }
  if (set.sourceName !== was.sourceName) {
    const key = xmlProps(out, open).props.some((p) => p.name === 'WSVarName') ? 'WSVarName' : 'SourceName';
    out = setXmlProp(out, open, key, set.sourceName, { sparse, empty: 'self', before: null });
  }
  return out;
}

function withRelationships(src: string, added: readonly string[], removed: readonly string[], member: string): string {
  let out = src;
  for (const part of removed) {
    const target = part.slice('/simulink/'.length);
    const line = new RegExp(`^ *<Relationship [^>]*Target="${target.replace(/\./g, '\\.')}"[^>]*/>\\n`, 'm');
    out = out.replace(line, '');
  }
  if (!out.includes('</Relationships>')) throw new ConfigSetsError(`"${member}" is not laid out as MATLAB writes it`);
  for (const part of added) {
    const target = part.slice('/simulink/'.length);
    const id = target.replace(/\.\w+$/, '');
    out = out.replace('</Relationships>', `  <Relationship Id="${id}" Target="${target}" Type="${SET_RELATIONSHIP}"/>\n</Relationships>`);
  }
  return out;
}

function withOverrides(src: string, added: readonly string[], removed: readonly string[], contentType: string): string {
  let out = src;
  for (const part of removed) {
    out = out.replace(new RegExp(`^ *<Override [^>]*PartName="${part.replace(/[./]/g, (c) => '\\' + c)}"[^>]*/>\\n`, 'm'), '');
  }
  for (const part of added) {
    const line = `  <Override ContentType="${contentType}" PartName="${part}"/>\n`;
    // Among the Overrides, which MATLAB writes in order of their parts' names.
    const overrides = [...out.matchAll(/^ *<Override [^>]*PartName="([^"]+)"[^>]*\/>\n/gm)];
    const after = overrides.find((m) => m[1] > part);
    const pos = after ? after.index! : out.indexOf('</Types>');
    if (pos < 0) throw new ConfigSetsError('"[Content_Types].xml" is not laid out as MATLAB writes it');
    out = out.slice(0, pos) + line + out.slice(pos);
  }
  return out;
}

// --- R2013b and earlier: the sets inline in the block diagram --------------------------------------

function inlineSets(entries: Record<string, Uint8Array>, asRead: readonly SetState[], sets: readonly SetToWrite[]): Record<string, Uint8Array | null> {
  const src = text(entries[BLOCK_DIAGRAM], BLOCK_DIAGRAM);
  const arrayOpen = /<Array PropName="ConfigurationSets" Type="Handle" Dimension="1\*(\d+)">/.exec(src);
  if (!arrayOpen) throw new ConfigSetsError(`"${BLOCK_DIAGRAM}" holds no ConfigurationSets array`);
  // The sets, each by its <Object>'s span, in the array's order.
  const objects: { open: number; start: number; end: number; id: string }[] = [];
  const objectOpen = /<Object ObjectID="(\d+)" Version="[^"]+" ClassName="Simulink\.ConfigSet(?:Ref)?">/g;
  objectOpen.lastIndex = arrayOpen.index + arrayOpen[0].length;
  let arrayClose = -1;
  for (let m: RegExpExecArray | null; (m = objectOpen.exec(src)); ) {
    const { close } = xmlProps(src, m.index);
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    const end = src.indexOf('\n', close) + 1;
    objects.push({ open: m.index, start: lineStart, end, id: m[1] });
    objectOpen.lastIndex = end;
    const nextTag = /<\/Array>|<Object /.exec(src.slice(end));
    if (nextTag && nextTag[0] === '</Array>') {
      arrayClose = end + nextTag.index;
      break;
    }
  }
  if (objects.length !== asRead.length || objects.length !== Number(arrayOpen[1]) || arrayClose < 0) {
    throw new ConfigSetsError(`"${BLOCK_DIAGRAM}" does not hold the configuration sets as they were read`);
  }
  const version = /<Object ObjectID="\d+" Version="([^"]+)" ClassName="Simulink\.ConfigSet(?:Ref)?">/.exec(src.slice(objects[0].open))![1];
  let nextId = 1 + Math.max(...[...src.matchAll(/ObjectID="(\d+)"/g)].map((m) => Number(m[1])));
  const indent = src.slice(objects[0].start, objects[0].open);
  // Each set's text as it is to be: an edit of its object, or a new one.
  const pieces: string[] = [];
  for (const set of sets) {
    if (set.read === null) {
      const n = escapeXml(set.name);
      const d = escapeXml(set.description);
      const inner = indent + '  ';
      pieces.push(
        set.className === 'Simulink.ConfigSetRef'
          ? `${indent}<Object ObjectID="${nextId++}" Version="${version}" ClassName="Simulink.ConfigSetRef">\n${inner}<P Name="DisabledProps">[]</P>\n${inner}<P Name="Description">${d}</P>\n` +
              `${inner}<P Name="Components">[]</P>\n${inner}<P Name="Name">${n}</P>\n${inner}<P Name="WSVarName">${escapeXml(set.sourceName)}</P>\n${inner}<P Name="SourceLocation">Base Workspace</P>\n${indent}</Object>\n`
          : `${indent}<Object ObjectID="${nextId++}" Version="${version}" ClassName="Simulink.ConfigSet">\n${d ? `${inner}<P Name="Description">${d}</P>\n` : ''}${inner}<P Name="Name">${n}</P>\n${indent}</Object>\n`,
      );
      continue;
    }
    const o = objects[set.read];
    const was = asRead[set.read];
    let piece = src.slice(o.start, o.end);
    const open = o.open - o.start;
    const ref = was.className === 'Simulink.ConfigSetRef';
    if (set.name !== was.name) piece = setXmlProp(piece, open, 'Name', set.name, { sparse: false, empty: 'pair', before: null });
    if (set.description !== was.description) {
      piece = setXmlProp(piece, open, 'Description', set.description || null, { sparse: false, empty: ref ? 'pair' : 'none', before: '' });
    }
    if (set.sourceName !== was.sourceName) piece = setXmlProp(piece, open, 'WSVarName', set.sourceName, { sparse: false, empty: 'pair', before: null });
    pieces.push(piece);
  }
  const unchanged = sets.length === objects.length && sets.every((s, i) => s.read === i && pieces[i] === src.slice(objects[i].start, objects[i].end));
  if (unchanged) return {};
  const head = src.slice(0, arrayOpen.index) + arrayOpen[0].replace(/1\*\d+/, `1*${sets.length}`) + src.slice(arrayOpen.index + arrayOpen[0].length, objects[0].start);
  return { [BLOCK_DIAGRAM]: bytes(head + pieces.join('') + src.slice(objects[objects.length - 1].end)) };
}
