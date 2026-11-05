// Copyright 2026 The MathWorks, Inc.
//
// MATLAB's JSON, as it writes a model's parts (src/datamodel/parser/MatlabJson.ts): every JSON member
// of every `.slx` in this repo, which MATLAB wrote, is written again from its parse byte for byte. A
// configuration set pasted into a model is written by it (ConfigSetsWriter), so it is MATLAB's own
// layout of the same object.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { formatMatlabJson } from '../src/datamodel/parser/MatlabJson.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

function slxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) slxFiles(path, out);
    else if (name.endsWith('.slx')) out.push(path);
  }
  return out;
}

const members: [string, string][] = [];
for (const file of [...slxFiles(join(ROOT, 'fixtures')), ...slxFiles(join(ROOT, 'parity', 'artifacts'))]) {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(readFileSync(file)));
  } catch {
    continue;
  }
  // A package with no content types is no MATLAB save (a hand-made fixture): its JSON is not MATLAB's.
  if (!entries['[Content_Types].xml']) continue;
  for (const [name, bytes] of Object.entries(entries)) {
    if (name.endsWith('.json')) members.push([`${file.slice(ROOT.length)}:${name}`, new TextDecoder().decode(bytes)]);
  }
}

describe("MATLAB's JSON, as it writes a model's parts", () => {
  it('finds the corpus: configuration sets, their index, and the other JSON parts', () => {
    expect(members.filter(([n]) => /configSet\d+\.json$/.test(n)).length).toBeGreaterThan(50);
    expect(members.filter(([n]) => /configSetInfo\.json$/.test(n)).length).toBeGreaterThan(30);
    expect(members.length).toBeGreaterThan(150);
  });

  // Written by another of MATLAB's writers, which indents four spaces: no configuration set's part is.
  const OTHER_WRITER = ['parity/artifacts/mdl/mdlmask.slx:simulink/graphicalInterface.json'];

  it('writes every JSON part MATLAB wrote, from its parse, as MATLAB wrote it', () => {
    const differing = members.filter(([n, text]) => !OTHER_WRITER.includes(n) && formatMatlabJson(JSON.parse(text)) !== text).map(([n]) => n);
    expect(differing).toEqual([]);
  });

  it.each([
    [{}, '{}'],
    [[], '[]'],
    [{ a: [1, 2] }, '{\n  "a":[1,  2]\n}'],
    [{ a: [{ b: 1 }] }, '{\n  "a":[{\n      "b":1\n    }]\n}'],
    [{ a: [[]] }, '{\n  "a":[[]]\n}'],
    [{ a: [{ b: 1 }, { c: 'x/y' }] }, '{\n  "a":[\n    {\n      "b":1\n    },\n    {\n      "c":"x\\/y"\n    }\n  ]\n}'],
  ])('%j', (value, text) => {
    expect(formatMatlabJson(value)).toBe(text);
  });
});
