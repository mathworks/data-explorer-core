// Copyright 2026 The MathWorks, Inc.
//
// The Add gallery's Simulink.ConfigSet is written with the Version MATLAB stamps on a config set,
// for the release that wrote the dictionary, and nothing else beside its Name: MATLAB fills in the
// rest. Written with no Version, R2027a loaded it as a set an old release saved, with
// PropagateSignalLabelsOutOfModel 'off' where its own fresh set has 'on' (as R2026a's and R2026b's
// do); with one, R2023b and R2027a each load it as their own fresh set (open-questions 15a, measured
// 2026-10-30).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import ConfigSetNode from '../src/datamodel/node/data/ConfigSetNode.js';

type Any = any;

const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const FIXTURES = 'test/fixtures/edit-bash/';

function opened(bytes: Uint8Array, filename: string) {
  const session: Any = createSession();
  const root: Any = ingest(session, ab(bytes), { filename });
  return { session, root };
}
const open = (path: string) => opened(new Uint8Array(readFileSync(path)), path.split('/').pop()!);

// The properties the save wrote for the entry `name` of the Configurations section, as MATLAB reads
// them: a text dictionary's `_properties`, and a binary one's `<P>`s, in the order written.
function savedProperties(d: { session: Any; root: Any }, name: string): [string, unknown][] {
  const out: Any = d.session.serializeSource(d.root.name);
  if (out.kind === 'text') {
    const parts = JSON.parse(out.text).__MW_TEXT_PARTS__;
    const entries = Object.values(parts).flatMap((p: Any) => p.__MW_TEXT_content?.entries ?? []);
    const entry: Any = entries.find((e: Any) => e.name === name);
    return Object.entries(entry.value._elements[0]._properties);
  }
  const xml = strFromU8(unzipSync(out.bytes)['data/chunk0.xml']);
  const at = xml.indexOf('<Element Class="Simulink.ConfigSet">', xml.indexOf('<P Name="Name" Class="char">' + name + '</P>'));
  const body = xml.slice(at, xml.indexOf('</Element>', at));
  return [...body.matchAll(/<P Name="(\w+)" Class="char">([^<]*)<\/P>/g)].map((m) => [m[1], m[2]]);
}

function addConfigSet(d: { session: Any; root: Any }): Any {
  d.session.setActive(d.root, null);
  const node = d.session.addEntry('config', 'Simulink.ConfigSet');
  expect(node?.name).toBe('Configuration');
  return node;
}

describe('the gallery ConfigSet carries its dictionary release’s Version', () => {
  it.each([
    ['r2023b/values_binary.sldd', '23.1.0'],
    ['r2027a/values_binary.sldd', '27.0.0'],
    ['r2027a/values_text.sldd', '27.0.0'],
  ])('%s: Name and Version %s, and nothing else', (file, version) => {
    const d = open(FIXTURES + file);
    addConfigSet(d);
    expect(savedProperties(d, 'Configuration')).toEqual([['Name', 'Configuration'], ['Version', version]]);
    // And a reopen reads it as the config set it is, under its name.
    const out: Any = d.session.serializeSource(d.root.name);
    const back = opened(out.kind === 'text' ? new TextEncoder().encode(out.text) : out.bytes, file.split('/').pop()!);
    const read = back.root.children.find((s: Any) => s.name === 'config').children.find((e: Any) => e.name === 'Configuration');
    expect([read.className, read.name]).toEqual(['Simulink.ConfigSet', 'Configuration']);
  });

  // Each a fresh Simulink.ConfigSet's own Version in that release (measured 2026-10-30): no rule of
  // the release's name gives them (R2025b's is R2025a's; R2026b's has a third part).
  it.each([
    ['R2023b', '23.1.0'],
    ['R2024a', '24.0.0'],
    ['R2024b', '24.1.0'],
    ['R2025a', '25.0.0'],
    ['R2025b', '25.0.0'],
    ['R2026a', '26.0.0'],
    ['R2026b', '26.1.1'],
    ['R2027a', '27.0.0'],
  ])('a dictionary %s wrote: %s', (release, version) => {
    const d = open(FIXTURES + 'r2027a/values_text.sldd');
    d.root.coreProperties = { ...d.root.coreProperties, release };
    addConfigSet(d);
    expect(savedProperties(d, 'Configuration')).toEqual([['Name', 'Configuration'], ['Version', version]]);
  });

  it.each([
    ['no core properties', null],
    ['no release', {}],
    ['an empty release', { release: '' }],
    ['a release with no half', { release: 'R2027' }],
    ['a release before the table', { release: 'R2023a' }],
    ['a release after it', { release: 'R2027b' }],
    ['a name of no release in it', { release: 'toString' }],
    ['no release name', { release: 'banana' }],
    ['not a string', { release: 2027 }],
  ])('%s: the fallback 23.1.0', (_what, coreProperties) => {
    for (const file of ['r2027a/values_text.sldd', 'r2027a/values_binary.sldd']) {
      const d = open(FIXTURES + file);
      d.root.coreProperties = coreProperties;
      addConfigSet(d);
      expect(savedProperties(d, 'Configuration')).toEqual([['Name', 'Configuration'], ['Version', '23.1.0']]);
    }
  });

  it('a ConfigSet made in no dictionary takes the fallback, and a renamed one keeps its Version', () => {
    expect((ConfigSetNode.createDefault('cs', null) as Any).serial._rawVal._elements[0]._properties).toEqual({ Name: 'cs', Version: '23.1.0' });
    const d = open(FIXTURES + 'r2027a/values_text.sldd');
    const node = addConfigSet(d);
    d.session.setActive(d.root, node);
    expect(d.session.editProperty(node.id, 'Name', 'Fast', node.name)).toBe(true);
    expect(savedProperties(d, 'Fast')).toEqual([['Name', 'Fast'], ['Version', '27.0.0']]);
  });

  it('the gallery ConfigSetRef is as it was: no Version', () => {
    for (const file of ['r2027a/values_text.sldd', 'r2027a/values_binary.sldd']) {
      const d = open(FIXTURES + file);
      d.session.setActive(d.root, null);
      const node = d.session.addEntry('config', 'Simulink.ConfigSetRef');
      expect(node?.className).toBe('Simulink.ConfigSetRef');
      expect(JSON.stringify(node.serialize())).not.toContain('Version');
    }
  });
});
