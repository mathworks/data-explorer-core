// Copyright 2026 The MathWorks, Inc.
//
// A model's configuration sets in every layout, against what MATLAB opens of the same file: the
// sets in MATLAB's order, each one's class, and which one is active. The fixtures and truth.json
// in test/fixtures/active-config are written by test/parity/matlab/gen_active_config.m: a model of
// three sets and one holding a Simulink.ConfigSetRef, each in this release and exported to R2025a,
// R2021a, R2018a and R2013b.
//
// The R2013b exports are why this exists. R2013b keeps the sets inline in blockdiagram.xml, the
// active one named by the ObjectID of <Object PropName="ActiveConfigurationSet">, and an export to
// it from R2027a ALSO writes simulink/configSetInfo.xml, holding its XML declaration and nothing
// else. Read as the index it is from R2014b, it listed no set: the model opened with an empty
// Configurations section, and nothing said why.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync } from 'fflate';
import { createSession, parseSlx } from '../src/index.js';
import { asArray } from './parity/matlab/loadTruth.js';

const DIR = fileURLToPath(new URL('./fixtures/active-config/', import.meta.url));

interface SetTruth {
  name: string;
  class: string;
  stopTime: string;
}
interface ModelTruth {
  file: string;
  release: string;
  sets: SetTruth | SetTruth[];
  active: string;
}

const truth = JSON.parse(readFileSync(DIR + 'truth.json', 'utf8')) as ModelTruth[];
const bytesOf = (file: string): ArrayBuffer => {
  const b = readFileSync(DIR + file);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const expected = (t: ModelTruth) => asArray(t.sets).map((s) => [s.name, s.class, s.name === t.active]);

describe("a model's configuration sets, in every layout, are the ones MATLAB opens", () => {
  it('every layout is here: this release, R2025a, R2021a, R2018a and R2013b, of both models', () => {
    expect(truth.map((t) => [t.file, t.release]).sort()).toEqual(
      ['acs_ref', 'acs_sets']
        .flatMap((m) => [[`${m}.slx`, 'R2027a'], ...['R2013b', 'R2018a', 'R2021a', 'R2025a'].map((r) => [`${m}_${r}.slx`, r])])
        .sort(),
    );
  });

  it.each(truth.map((t) => [t.file, t] as const))('%s', (file, t) => {
    const parsed = parseSlx(bytesOf(file), file);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.configSets.map((s) => [s.name, s.objectClass || 'Simulink.ConfigSet', s.active])).toEqual(expected(t));
  });

  it.each(['acs_sets_R2013b.slx', 'acs_ref_R2013b.slx'])(
    '%s holds the empty index beside the sets kept inline, as R2027a exports it',
    (file) => {
      // So the case above is the one it is about: were the part ever to list the sets, or be
      // gone, it would be read as any other layout is.
      const entries = unzipSync(new Uint8Array(bytesOf(file)));
      const index = new TextDecoder().decode(entries['simulink/configSetInfo.xml']);
      expect(index.trim()).toBe('<?xml version="1.0" encoding="utf-8"?>');
      expect(Object.keys(entries).filter((n) => /configSet\d/.test(n))).toEqual([]);
      expect(new TextDecoder().decode(entries['simulink/blockdiagram.xml'])).toMatch(/<Object Reference="true" PropName="ActiveConfigurationSet" ObjectID="10">/);
    },
  );

  it('an index that cannot be read still says so, and is not taken for one that lists no set', () => {
    // The warning says no set was read, so none is: the sets inline are not read past it.
    const entries = unzipSync(new Uint8Array(bytesOf('acs_sets_R2013b.slx')));
    entries['simulink/configSetInfo.xml'] = new TextEncoder().encode('not a part');
    const parsed = parseSlx(zipSync(entries).buffer as ArrayBuffer, 'acs_sets_R2013b.slx');
    expect(parsed.configSets).toEqual([]);
    expect(parsed.warnings.map((w) => w.message)).toEqual([
      'The model part "simulink/configSetInfo.xml" holds nothing readable, so no configuration sets were read.',
    ]);
  });

  it.each(['acs_sets_R2013b.slx', 'acs_ref_R2013b.slx'])("%s opens with its sets in the model's Configurations section", (file) => {
    const s = createSession();
    const model = s.addModelSource(file, bytesOf(file)) as unknown as { getSection(id: string): { children: any[] } };
    const t = truth.find((x) => x.file === file)!;
    expect(model.getSection('config').children.map((c) => [c.name, c.className, c.active])).toEqual(expected(t));
  });
});
