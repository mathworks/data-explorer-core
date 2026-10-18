// Copyright 2026 The MathWorks, Inc.
// A model part and a project document keep their text as the file wrote it.
//
// The dictionary reader stopped converting text years of corpus ago (#92): a value is
// converted by the Class its element declares, by the code that knows that Class, and
// numeric character references are decoded because XML requires it. The model and project
// readers kept the engine's defaults, which turn `false` into a BOOLEAN, `10.0` into the
// number 10 and `1e-3` into 0.001, and leave `&#65;` standing as five characters.
//
// The first of those was a visible loss. `SlxParser` reads a block parameter's text with
// `|| ''`, so the boolean `false` read as no value at all and the block was dropped from
// Model Elements: 80 rows in 16 corpus models (a Constant, Outport or UnitDelay whose
// value is `false`), where the same block in a `.mdl` was listed. Its twin `true` survived,
// but as a boolean in a field typed `string`. The configuration sets lost their spelling
// quietly, in a public parse output no row reads today.
//
// Every case here goes through the reader a host reaches — `parseSlx`, a session's
// `ingest`, or the exported reader a parser calls — and starts from a model MATLAB wrote.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession, ingest } from '../src/index.js';
import { parseMdl } from '../src/datamodel/parser/MdlParser.js';
import { parseSlx } from '../src/datamodel/parser/SlxParser.js';
import { readModelXml, readProjectXml } from '../src/datamodel/parser/XmlReader.js';

/** An R2021a model: XML system parts, and two XML configuration sets MATLAB wrote. */
const FIXTURE = './parity/artifacts/slx_layouts/slxcases_R2021a.slx';
const ROOT_SYSTEM = 'simulink/systems/system_root.xml';

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function fixtureBytes(): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(FIXTURE, import.meta.url))));
}

/** The fixture with `blocksXml` appended to its root system. Every other part is the fixture's own. */
function fixtureWithBlocks(blocksXml: string): ArrayBuffer {
  const parts = unzipSync(fixtureBytes());
  const root = strFromU8(parts[ROOT_SYSTEM]);
  const end = root.lastIndexOf('</System>');
  expect(end, 'the root system part closes its <System>').toBeGreaterThan(0);
  parts[ROOT_SYSTEM] = strToU8(root.slice(0, end) + blocksXml + root.slice(end));
  return toArrayBuffer(zipSync(parts));
}

/** The text of every `<P Name="name">` in a parsed part, in document order. */
function propTexts(node: unknown, name: string, out: unknown[] = []): unknown[] {
  if (Array.isArray(node)) {
    for (const one of node) propTexts(one, name, out);
  } else if (node !== null && typeof node === 'object') {
    const rec = node as Record<string, unknown>;
    if (rec['@_Name'] === name && '#text' in rec) out.push(rec['#text']);
    for (const [key, value] of Object.entries(rec)) {
      if (!key.startsWith('@_')) propTexts(value, name, out);
    }
  }
  return out;
}

const FLAG_BLOCKS =
  '<Block BlockType="Constant" Name="Flag" SID="901">' +
  '<P Name="Position">[35, 300, 65, 330]</P><P Name="Value">false</P></Block>' +
  '<Block BlockType="Constant" Name="On" SID="902">' +
  '<P Name="Position">[35, 360, 65, 390]</P><P Name="Value">true</P></Block>';

describe('a block parameter keeps the text the model wrote', () => {
  it('lists a Constant whose Value is `false`, and gives `true` as the text it is', () => {
    const usages = parseSlx(fixtureWithBlocks(FLAG_BLOCKS), 'flags.slx').blockParamUsages;
    expect(usages.filter((u) => u.sid === '901' || u.sid === '902')).toEqual([
      { blockName: 'Flag', blockType: 'Constant', paramProperty: 'Value', paramValue: 'false', sid: '901', systemPath: '' },
      { blockName: 'On', blockType: 'Constant', paramProperty: 'Value', paramValue: 'true', sid: '902', systemPath: '' },
    ]);
  });

  it('shows that Constant in Model Elements, beside the blocks the model already had', () => {
    const model = ingest(createSession(), fixtureWithBlocks(FLAG_BLOCKS), { filename: 'flags.slx' }) as any;
    // A row's DataType is a link (`{ text, linkTarget }`) when the model names a
    // dictionary, as this one does; the text is what the row reads.
    const rows = model
      .getSection('blocks')
      .children.map((c: any) => [c.displayName, c.toRow().DataType.text]);
    // The fixture's own Constant, so a red below cannot mean the walk missed the system.
    expect(rows).toContainEqual(['Const', 'Value=Kp']);
    expect(rows).toContainEqual(['Flag', 'Value=false']);
    expect(rows).toContainEqual(['On', 'Value=true']);
  });

  it('gives the verdict the classic .mdl of the same blocks gives', () => {
    // The `.mdl` reader has its own tokenizer and never converted anything, so it always
    // listed both blocks; the two parsers share one gate and now see the same text.
    const mdl = strToU8(`Model {
  Name                    "flags"
  System {
    Name                  "flags"
    Block {
      BlockType           Constant
      Name                "Flag"
      SID                 "901"
      Value               "false"
    }
    Block {
      BlockType           Constant
      Name                "On"
      SID                 "902"
      Value               "true"
    }
  }
}
`);
    const fromMdl = parseMdl(toArrayBuffer(mdl), 'flags.mdl').blockParamUsages;
    const fromSlx = parseSlx(fixtureWithBlocks(FLAG_BLOCKS), 'flags.slx').blockParamUsages;
    expect(fromMdl.map((u) => u.sid)).toEqual(['901', '902']);
    expect(fromSlx.filter((u) => u.sid === '901' || u.sid === '902')).toEqual(fromMdl);
  });

  it('decodes a numeric character reference, as XML requires of a reader', () => {
    const usages = parseSlx(
      fixtureWithBlocks('<Block BlockType="Gain" Name="G" SID="903"><P Name="Gain">K&#65;</P></Block>'),
      'refs.slx',
    ).blockParamUsages;
    expect(usages.filter((u) => u.sid === '903').map((u) => u.paramValue)).toEqual(['KA']);
    // And MATLAB's spelling of a carriage return, which is how it writes one inside text.
    expect(readModelXml('<P Name="Description">a&#xD;b</P>')).toEqual({
      P: { '@_Name': 'Description', '#text': 'a\rb' },
    });
  });
});

describe('a configuration set keeps the numbers as MATLAB spelled them', () => {
  it('reads `0.0`, `10.0` and `1e-3` back as those strings, in both of the fixture\'s sets', () => {
    const { configSets } = parseSlx(toArrayBuffer(fixtureBytes()), 'slxcases_R2021a.slx');
    expect(configSets).toHaveLength(2);
    for (const set of configSets) {
      expect(
        ['StartTime', 'StopTime', 'RelTol'].map((name) => propTexts(set.data, name)),
        set.name,
      ).toEqual([['0.0'], ['10.0'], ['1e-3']]);
    }
  });
});

describe('a project document keeps its text as text', () => {
  it('reads `007` as the three characters it is', () => {
    expect(readProjectXml('<Info><Version>007</Version></Info>')).toEqual({ Info: { Version: '007' } });
  });
});
