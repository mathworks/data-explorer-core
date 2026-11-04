// Copyright 2026 The MathWorks, Inc.

// Where a `.slx` says which of its configuration sets is active, and that member with another set
// made active: the one mark moved, every other byte of the member as read. No node is imported here.
//
//   configSetInfo.json (R2026b+)  the entry's "Active":true field
//   configSetInfo.xml (R2014b+)   the Active="true" attribute of the set's <ConfigSet>
//   blockdiagram.xml (R2013b)     the ObjectID that <Object PropName="ActiveConfigurationSet"> names
//
// Measured on R2027a and R2023b against MATLAB's own save of the same change, in every layout
// (test/parity/matlab/probe_active_config_set.m): the mark is all MATLAB reads of it, and in the JSON
// and XML layouts MATLAB's save holds the member byte for byte as this one does. An export to R2013b
// from R2027a also holds a configSetInfo.xml listing no set, beside the sets inline: there the block
// diagram says it, as SlxParser reads it. And in that layout the coverage settings are the model's,
// one copy of them (blockdiagram.xml's <Verification>), which this keeps as read: a MATLAB of a later
// release gives them to the active set as it opens the model and writes them from it as it saves,
// so there a set made active opens with the coverage settings the model was read with, where MATLAB's
// save gives it its own (R2023b; R2027a gives every set the same ones; probe_config_set_edits.m).

export const JSON_INFO = 'simulink/configSetInfo.json';
export const XML_INFO = 'simulink/configSetInfo.xml';
export const BLOCK_DIAGRAM = 'simulink/blockdiagram.xml';

/** Why a member cannot be given another active set, as a clause. */
export class ActiveMarkError extends Error {}

const has = (entries: Record<string, Uint8Array>, name: string) => Object.prototype.hasOwnProperty.call(entries, name);

/** The member of `entries` that marks the active set, or null where there is none. */
export function activeMarkMember(entries: Record<string, Uint8Array>): string | null {
  if (has(entries, JSON_INFO)) return JSON_INFO;
  // An index that lists no set leaves them to the block diagram, as SlxParser reads it.
  if (has(entries, XML_INFO) && /<ConfigSet\b/.test(new TextDecoder().decode(entries[XML_INFO]))) return XML_INFO;
  return has(entries, BLOCK_DIAGRAM) ? BLOCK_DIAGRAM : null;
}

/**
 * The member of `entries` that marks the active set, with set `to` made active, or an
 * ActiveMarkError saying why it cannot be. Each splice is checked by reading its result again: the
 * sets as they were, `to` the one active.
 */
export function withActiveSet(entries: Record<string, Uint8Array>, to: string): { member: string; bytes: Uint8Array } {
  const member = activeMarkMember(entries);
  if (!member) throw new ActiveMarkError('the model holds no part that says which configuration set is active');
  const source = decoded(entries[member], member);
  const after = member === JSON_INFO ? spliceJson(source, to) : member === XML_INFO ? spliceXml(source, to) : spliceInline(source, to);
  return { member, bytes: new TextEncoder().encode(after) };
}

/** `bytes` as text, a byte order mark kept: refused where they are not UTF-8, which re-encoding would change. */
function decoded(bytes: Uint8Array, member: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new ActiveMarkError(`"${member}" is not text`);
  }
}

// --- configSetInfo.json ---------------------------------------------------------------------------

/** Where each object in `text` starts and ends, with its depth (the root object is 1); strings skipped. */
function objectSpans(text: string): { start: number; end: number; depth: number }[] {
  const spans: { start: number; end: number; depth: number }[] = [];
  const open: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
    } else if (ch === '{') {
      open.push(i);
    } else if (ch === '}' && open.length) {
      const start = open.pop()!;
      spans.push({ start, end: i + 1, depth: open.length + 1 });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

const ACTIVE_FIRST = /"Active"\s*:\s*true\s*,\s*/;
const ACTIVE_LAST = /\s*,\s*"Active"\s*:\s*true(?=\s*\}$)/;

function spliceJson(source: string, to: string): string {
  let parsed: { ConfigSetInfo?: unknown };
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new ActiveMarkError(`"${JSON_INFO}" cannot be read`);
  }
  const listed = listOf(parsed.ConfigSetInfo);
  const named = listed.filter((e) => e.ConfigSetName === to).length;
  if (named !== 1) throw new ActiveMarkError(listedWhy(JSON_INFO, to, named));
  // Each entry is an object directly in the ConfigSetInfo list: one level below the root.
  let out = '';
  let at = 0;
  for (const span of objectSpans(source).filter((s) => s.depth === 2)) {
    const entry = source.slice(span.start, span.end);
    let name: unknown;
    try {
      name = (JSON.parse(entry) as { ConfigSetName?: unknown }).ConfigSetName;
    } catch {
      throw new ActiveMarkError(`"${JSON_INFO}" cannot be read`);
    }
    const active = ACTIVE_FIRST.exec(entry) ?? ACTIVE_LAST.exec(entry);
    let spliced = entry;
    if (name === to) {
      if (!active) spliced = entry.replace(/^\{(\s*)/, (_, ws: string) => `{${ws}"Active":true,${ws}`);
    } else if (active) {
      spliced = entry.slice(0, active.index) + entry.slice(active.index + active[0].length);
    }
    out += source.slice(at, span.start) + spliced;
    at = span.end;
  }
  out += source.slice(at);
  // Read again: the same entries, each as it was but for its Active, and `to` the one active.
  let again: { ConfigSetInfo?: unknown };
  try {
    again = JSON.parse(out);
  } catch {
    throw new ActiveMarkError(`"${JSON_INFO}" is not laid out as MATLAB writes it`);
  }
  const strip = (o: { ConfigSetInfo?: unknown }) =>
    JSON.stringify({ ...o, ConfigSetInfo: listOf(o.ConfigSetInfo).map(({ Active: _, ...rest }) => rest) });
  // Active as SlxParser reads it: any value but false, null, 0 or "" (`!!entry.Active`).
  const actives = listOf(again.ConfigSetInfo).filter((e) => !!e.Active).map((e) => e.ConfigSetName);
  if (strip(again) !== strip(parsed) || actives.length !== 1 || actives[0] !== to) {
    throw new ActiveMarkError(`"${JSON_INFO}" is not laid out as MATLAB writes it`);
  }
  return out;
}

function listOf(value: unknown): Record<string, unknown>[] {
  const list = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
  return list.filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && !Array.isArray(e));
}

function listedWhy(member: string, to: string, times: number): string {
  return times === 0 ? `"${member}" lists no configuration set named "${to}"` : `"${member}" lists "${to}" ${times} times`;
}

// --- configSetInfo.xml ----------------------------------------------------------------------------

const CONFIG_SET = /<ConfigSet\b([^>]*)>([^<]*)<\/ConfigSet>/g;
const ACTIVE_ATTRIBUTE = /\s+Active\s*=\s*(["'])true\1/;

const unescapeXml = (s: string) =>
  s.replace(/&(lt|gt|quot|apos|amp);/g, (_, e: string) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[e]!);

/** Each <ConfigSet> of `source`: its name and whether it is marked active. */
function xmlSets(source: string): { name: string; active: boolean }[] {
  return [...source.matchAll(CONFIG_SET)].map((m) => ({ name: unescapeXml(m[2]), active: ACTIVE_ATTRIBUTE.test(m[1]) }));
}

function spliceXml(source: string, to: string): string {
  const before = xmlSets(source);
  const named = before.filter((s) => s.name === to).length;
  if (named !== 1) throw new ActiveMarkError(listedWhy(XML_INFO, to, named));
  const out = source.replace(CONFIG_SET, (all, attrs: string, name: string) => {
    const active = ACTIVE_ATTRIBUTE.exec(attrs);
    if (unescapeXml(name) === to) return active ? all : `<ConfigSet${attrs} Active="true">${name}</ConfigSet>`;
    return active ? `<ConfigSet${attrs.slice(0, active.index)}${attrs.slice(active.index + active[0].length)}>${name}</ConfigSet>` : all;
  });
  const after = xmlSets(out);
  const actives = after.filter((s) => s.active).map((s) => s.name);
  if (after.map((s) => s.name).join('\u0000') !== before.map((s) => s.name).join('\u0000') || actives.length !== 1 || actives[0] !== to) {
    throw new ActiveMarkError(`"${XML_INFO}" is not laid out as MATLAB writes it`);
  }
  return out;
}

// --- blockdiagram.xml (R2013b) --------------------------------------------------------------------

const ACTIVE_REFERENCE = /(<Object\b[^>]*\bPropName="ActiveConfigurationSet"[^>]*\bObjectID=")(\d+)(")/g;

/**
 * The configuration sets kept inline: each <Object> of class Simulink.ConfigSet or ConfigSetRef, its
 * ObjectID, and the Name its own <P> gives (a component object nested in it has a Name too, so only
 * the set's own depth is read).
 */
function inlineSets(source: string): { id: string; name: string }[] {
  const sets: { id: string; name: string }[] = [];
  const open = /<Object\b[^>]*\bClassName="Simulink\.ConfigSet(?:Ref)?"[^>]*>/g;
  for (let m: RegExpExecArray | null; (m = open.exec(source)); ) {
    const id = /\bObjectID="(\d+)"/.exec(m[0])?.[1] ?? '';
    const tags = /<Object\b[^>]*?(\/?)>|<\/Object>|<P Name="Name"[^>]*>([^<]*)<\/P>/g;
    tags.lastIndex = m.index + m[0].length;
    let depth = m[0].endsWith('/>') ? 0 : 1;
    let name = '';
    for (let t: RegExpExecArray | null; depth > 0 && (t = tags.exec(source)); ) {
      if (t[0] === '</Object>') depth--;
      else if (t[0].startsWith('<Object')) depth += t[1] ? 0 : 1;
      else if (depth === 1) name = unescapeXml(t[2]);
    }
    sets.push({ id, name });
    open.lastIndex = Math.max(open.lastIndex, tags.lastIndex);
  }
  return sets;
}

function spliceInline(source: string, to: string): string {
  const sets = inlineSets(source);
  const target = sets.filter((s) => s.name === to);
  if (target.length !== 1 || !target[0].id) throw new ActiveMarkError(listedWhy(BLOCK_DIAGRAM, to, target.length));
  const refs = [...source.matchAll(ACTIVE_REFERENCE)];
  if (refs.length !== 1) {
    throw new ActiveMarkError(`"${BLOCK_DIAGRAM}" names ${refs.length ? 'more than one' : 'no'} active configuration set`);
  }
  const out = source.replace(ACTIVE_REFERENCE, (_, head: string, __: string, tail: string) => head + target[0].id + tail);
  const again = inlineSets(out);
  if (JSON.stringify(again) !== JSON.stringify(sets)) {
    throw new ActiveMarkError(`"${BLOCK_DIAGRAM}" is not laid out as MATLAB writes it`);
  }
  return out;
}
