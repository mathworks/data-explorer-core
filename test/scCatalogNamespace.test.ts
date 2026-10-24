// Copyright 2026 The MathWorks, Inc.
//
// The System Composer catalog names the definitions of a dictionary's Design namespace, Design and
// Architectural Data, and nothing else: an entry of Other Data or Configurations that shares a name
// with one is not classified by it, and renaming it does not rename the definition.
//
// The catalog is keyed by name (ScCatalog), and a name is unique only within a namespace: Other Data
// and Configurations are each their own. The reader classified every section's entries by bare
// name, so an Other Data double named after an architecture's struct type showed as a Struct Type;
// and renaming it renamed the catalog's definition, which a save then wrote into the catalog,
// taking the name from the architectural entry that holds it. Alike in a text and a binary
// dictionary, which hold the catalog in two forms and read it into one.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession, ingest } from '../src/index.js';
import { NS_CONFIGURATIONS, NS_OTHER } from '../src/datamodel/SectionConstants.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const read = (name: string): Uint8Array => new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
const bufferOf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

// The two entries outside the Design namespace, each named after a definition of the catalog:
// StructType (a modeled data type) and DataInterface (an interface), as doubles.
const OUTSIDE: [string, string, number][] = [
  ['StructType', NS_OTHER, 5],
  ['DataInterface', NS_CONFIGURATIONS, 6],
];

// arch_binary_as_text.sldd, a text dictionary with a catalog, with OUTSIDE added.
function textDictionary(): string {
  const json = JSON.parse(new TextDecoder().decode(read('arch_binary_as_text.sldd')));
  const entries = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
  OUTSIDE.forEach(([name, namespace, value], i) => {
    entries.push({ name, metadata: { uuid: `00000000-0000-4000-8000-00000000000${i + 1}`, namespace, lastmod: '20261023T000000.000000', modifiedby: 'user', isderived: '0' }, value });
  });
  return JSON.stringify(json, null, '\t');
}

// arch_binary.sldd, the same dictionary in the binary form, with OUTSIDE added to its chunk.
function binaryDictionary(): Uint8Array {
  const members = unzipSync(read('arch_binary.sldd'));
  const chunk = strFromU8(members['data/chunk0.xml']);
  const objects = OUTSIDE.map(([name, namespace, value], i) => [
    '    <Object Class="DD.ENTRY">',
    `        <P Name="Name" Class="char">${name}</P>`,
    `        <P Name="UUID" Class="char">00000000-0000-4000-8000-00000000000${i + 1}</P>`,
    `        <P Name="Namespace" Class="char">${namespace}</P>`,
    '        <P Name="LastMod" Class="char">20261023T000000.000000</P>',
    '        <P Name="LastModBy" Class="char">user</P>',
    '        <P Name="IsDerived" Class="char">0</P>',
    `        <P Name="Value" Class="double">${value}.0</P>`,
    '    </Object>',
  ].join('\n')).join('\n');
  members['data/chunk0.xml'] = strToU8(chunk.replace('</DataSource>', objects + '\n</DataSource>'));
  return zipSync(members);
}

const FORMATS: [string, () => string | Uint8Array][] = [
  ['a text dictionary', textDictionary],
  ['a binary dictionary', binaryDictionary],
];

function opened(input: string | Uint8Array) {
  const session = createSession();
  const root: any = ingest(session, typeof input === 'string' ? input : bufferOf(input), { filename: 'arch.sldd' });
  const entry = (section: string, name: string): any => root.getSection(section).children.find((e: any) => e.name === name);
  const save = (): string | Uint8Array => {
    const out = session.serializeSource(root.name) as { text?: string; bytes?: Uint8Array };
    return out.text ?? out.bytes!;
  };
  const rename = (node: any, name: string) => {
    session.setActive(root, node);
    return session.editProperty(node.id, 'Name', name);
  };
  return { session, root, entry, save, rename };
}

describe('the System Composer catalog and the entries outside the Design namespace', () => {
  for (const [what, make] of FORMATS) {
    it(`${what}: an Other Data or Configurations entry named after a definition is not classified by it`, () => {
      const o = opened(make());
      expect([o.entry('arch', 'StructType').kind, o.entry('arch', 'DataInterface').kind]).toEqual(['Struct Type', 'Data Interface']);
      for (const [section, name] of [['other', 'StructType'], ['config', 'DataInterface']]) {
        const node = o.entry(section, name);
        expect(node, section + '/' + name).toBeDefined();
        expect(node.classification).toBeUndefined();
        expect(node.kind).not.toMatch(/Struct Type|Data Interface/);
      }
    });

    it(`${what}: renaming such an entry leaves the definition its name, saved and read back`, () => {
      const o = opened(make());
      expect(o.rename(o.entry('other', 'StructType'), 'Renamed')).toBe(true);
      expect(o.rename(o.entry('config', 'DataInterface'), 'Renamed2')).toBe(true);
      expect([Object.keys(o.root.systemComposer.modeledDataTypes), Object.keys(o.root.systemComposer.interfaces)].flat()).toEqual(expect.arrayContaining(['StructType', 'DataInterface']));
      expect(Object.keys(o.root.systemComposer.modeledDataTypes)).not.toContain('Renamed');
      expect(Object.keys(o.root.systemComposer.interfaces)).not.toContain('Renamed2');
      const again = opened(o.save());
      expect([again.entry('arch', 'StructType').kind, again.entry('arch', 'DataInterface').kind]).toEqual(['Struct Type', 'Data Interface']);
      expect([again.entry('other', 'Renamed')?.classification, again.entry('config', 'Renamed2')?.classification]).toEqual([undefined, undefined]);
    });

    it(`${what}: renaming the architectural entry still renames its definition`, () => {
      const o = opened(make());
      expect(o.rename(o.entry('arch', 'StructType'), 'StructType2')).toBe(true);
      expect(Object.keys(o.root.systemComposer.modeledDataTypes)).toContain('StructType2');
      const again = opened(o.save());
      expect(again.entry('arch', 'StructType2').kind).toBe('Struct Type');
      expect(again.entry('other', 'StructType').classification).toBeUndefined();
    });
  }
});
