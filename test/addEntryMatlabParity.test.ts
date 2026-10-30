// Copyright 2026 The MathWorks, Inc.
//
// Ported from data-explorer-vscode test/addEntryMatlabParity.test.ts at c73da3c: the global
// DataModel and view's getModel are a core session (the text base registered in it as view's
// registry registers it); view's readSlddParts is core's parseBinarySlddParts, which it wraps; the
// tiles are data-explorer-view v1.0.0's ADD_CATALOG (vscode c73da3c's pin), transcribed below in
// drawn order, where vscode imported them; vscode's test/matlabDefaults.ts is copied to
// test/fixtures/vscode-c73da3c/. The bases: vscode's empty_text.sldd is copied to
// test/fixtures/vscode-c73da3c/; its empty_bin.sldd, a MATLAB-authored binary dictionary with the
// entries removed, is made here the same way, from MATLAB's own parity/artifacts/binary/params.sldd
// with every DD.ENTRY and DD.DICTIONARYREFERENCE taken out of its chunk (what is left is the
// chunk's DD.Dictionary, as empty_bin.sldd's is, and every other part as MATLAB wrote it). The
// files this emits for a MATLAB check go to a temporary folder rather than test/fixtures/parity_out
// (vscode's MATLAB verifier, test/parity/gen_add_entry_verify.m, is vscode's).
//
// Add-gallery parity with real MATLAB, for every tile, in both .sldd formats.
//
// addEntryHost.test.ts pins that an add produces what CORE says it produces, and that the two
// formats agree with EACH OTHER. Neither catches the case where core and both serializers agree on
// something MATLAB does not accept. So this suite adds the third leg: what MATLAB itself writes,
// transcribed into matlabDefaults.ts from a real R2027a run. The `expect`s are OFFLINE.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import { createSession, parseBinarySlddParts } from '../src/index.js';
import { addNewEntry, sectionByName } from '../src/edit/structuralEdit.js';
import { addNewEntryXml } from '../src/edit/xmlStructuralEdit.js';
import { MATLAB_DEFAULTS, MATLAB_ABSENT, MATLAB_CUSTOM_SAVE } from './fixtures/vscode-c73da3c/matlabDefaults.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const OUT_DIR = mkdtempSync(join(tmpdir(), 'add-parity-'));

// Every tile, in drawn order: data-explorer-view v1.0.0's ADD_CATALOG, flattened. One row per
// tile, so a class offered in two sections is exercised in both — which is the point for
// `isderived`.
const TILES: { label: string; className: string; section: string }[] = [
  { label: 'MATLAB Variable', className: 'MatlabVariable', section: 'design' },
  { label: 'MATLAB Structure', className: 'MatlabStruct', section: 'design' },
  { label: 'Simulink Parameter', className: 'Simulink.Parameter', section: 'design' },
  { label: 'LookUp Table', className: 'Simulink.LookupTable', section: 'design' },
  { label: 'Breakpoint', className: 'Simulink.Breakpoint', section: 'design' },
  { label: 'Constant', className: 'Constant', section: 'arch' },
  { label: 'Simulink Signal', className: 'Simulink.Signal', section: 'design' },
  { label: 'Simulink Bus', className: 'Simulink.Bus', section: 'design' },
  { label: 'Connection Bus', className: 'Simulink.ConnectionBus', section: 'design' },
  { label: 'Data Interface', className: 'Simulink.Bus', section: 'arch' },
  { label: 'Physical Interface', className: 'Simulink.ConnectionBus', section: 'arch' },
  { label: 'Service Interface', className: 'Simulink.ServiceBus', section: 'arch' },
  { label: 'Numeric Type', className: 'Simulink.NumericType', section: 'design' },
  { label: 'Alias Type', className: 'Simulink.AliasType', section: 'design' },
  { label: 'Value Type', className: 'Simulink.ValueType', section: 'design' },
  { label: 'Enum Type', className: 'Simulink.data.dictionary.EnumTypeDefinition', section: 'design' },
  { label: 'Numeric Type', className: 'Simulink.NumericType', section: 'arch' },
  { label: 'Alias Type', className: 'Simulink.AliasType', section: 'arch' },
  { label: 'Value Type', className: 'Simulink.ValueType', section: 'arch' },
  { label: 'Enum Type', className: 'Simulink.data.dictionary.EnumTypeDefinition', section: 'arch' },
  { label: 'Variant Expression', className: 'Simulink.VariantExpression', section: 'design' },
  { label: 'Variant Control', className: 'Simulink.VariantControl', section: 'design' },
  { label: 'Variant Variable', className: 'Simulink.VariantVariable', section: 'design' },
  { label: 'Variant Bank', className: 'Simulink.VariantBank', section: 'design' },
  { label: 'Bank Coder Info', className: 'Simulink.VariantBankCoderInfo', section: 'design' },
  { label: 'Variant Config', className: 'Simulink.VariantConfigurationData', section: 'design' },
  { label: 'Config Set', className: 'Simulink.ConfigSet', section: 'config' },
  { label: 'Config Reference', className: 'Simulink.ConfigSetRef', section: 'config' },
];

type Added = { className: string; section: string; name: string; node: any };

// A MATLAB-written binary dictionary with its entries removed: parity params.sldd's parts, its
// chunk holding only the DD.Dictionary object.
function emptyBinaryParts(): Record<string, Uint8Array> {
  const zip = unzipSync(new Uint8Array(readFileSync('test/parity/artifacts/binary/params.sldd')));
  const chunk = new TextDecoder().decode(zip['data/chunk0.xml']);
  // Each top-level `    <Object Class="DD.ENTRY">…\n    </Object>\n` (and the reference) cut, by
  // offsets rather than a regex over the file.
  let emptied = chunk;
  for (const cls of ['DD.ENTRY', 'DD.DICTIONARYREFERENCE']) {
    const open = `    <Object Class="${cls}">`;
    const close = '\n    </Object>\n';
    for (let at = emptied.indexOf(open); at >= 0; at = emptied.indexOf(open)) {
      const end = emptied.indexOf(close, at);
      emptied = emptied.slice(0, at) + emptied.slice(end + close.length);
    }
  }
  expect(emptied).not.toContain('DD.ENTRY');
  expect(emptied).toContain('<Object Class="DD.Dictionary">');
  return { ...zip, 'data/chunk0.xml': new TextEncoder().encode(emptied) };
}

// ---------------------------------------------------------------------------------
// Drive the real add path once per format, accumulating every tile into one
// dictionary — which is also the realistic case, since it forces `_uniqueName`
// to do its job across a shared namespace.
// ---------------------------------------------------------------------------------
function addAllText(): { added: Added[]; text: string } {
  const session: any = createSession();
  let text = readFileSync('test/fixtures/vscode-c73da3c/empty_text.sldd', 'utf8');
  const model = session.addDataSource('test://add-parity-text.sldd', JSON.parse(text), { path: 'empty_text.sldd' }) as any;
  const added: Added[] = [];
  for (const tile of TILES) {
    const section = sectionByName(model, tile.section);
    const result = addNewEntry(text, section, tile.className);
    text = result.newText;
    const node = (section.children as any[])[section.children.length - 1];
    added.push({ className: tile.className, section: tile.section, name: node.name, node });
  }
  return { added, text };
}

function addAllBinary(): { added: Added[]; xml: string; meta: Record<string, Uint8Array> } {
  const session: any = createSession();
  const srcId = 'test://add-parity-bin.sldd';
  const zip = emptyBinaryParts();
  const meta: Record<string, Uint8Array> = {};
  for (const [member, data] of Object.entries(zip)) {
    if (member !== 'data/chunk0.xml') meta[member] = data as Uint8Array;
  }
  let xml = new TextDecoder().decode(zip['data/chunk0.xml']);
  const model = session.addDataSource(srcId, parseBinarySlddParts(xml, meta), {
    path: 'empty_bin.sldd',
  }) as any;
  const added: Added[] = [];
  for (const tile of TILES) {
    const section = sectionByName(model, tile.section);
    const result = addNewEntryXml(xml, section, tile.className);
    xml = result.newText;
    const node = (section.children as any[])[section.children.length - 1];
    added.push({ className: tile.className, section: tile.section, name: node.name, node });
  }
  return { added, xml, meta };
}

let textRun: { added: Added[]; text: string };
let binRun: { added: Added[]; xml: string; meta: Record<string, Uint8Array> };

beforeAll(() => {
  textRun = addAllText();
  binRun = addAllBinary();

  writeFileSync(`${OUT_DIR}/add_text.sldd`, textRun.text, 'utf8');
  const parts: Record<string, Uint8Array> = { ...binRun.meta };
  parts['data/chunk0.xml'] = new TextEncoder().encode(binRun.xml);
  writeFileSync(`${OUT_DIR}/add_bin.sldd`, Buffer.from(zipSync(parts, { level: 6 })));

  // The manifest tells a MATLAB verifier which tile each entry name came from; entry
  // names are core's to choose, so the verifier must be told, not guess.
  writeFileSync(
    `${OUT_DIR}/manifest.json`,
    JSON.stringify(
      {
        text: textRun.added.map((a) => ({ name: a.name, className: a.className, section: a.section })),
        bin: binRun.added.map((a) => ({ name: a.name, className: a.className, section: a.section })),
      },
      null,
      2,
    ),
    'utf8',
  );
});

describe('every gallery tile produces an entry in both formats', () => {
  it('adds all 28 tiles to a text dictionary', () => {
    expect(textRun.added).toHaveLength(TILES.length);
    expect(new Set(textRun.added.map((a) => a.name)).size).toBe(TILES.length);
  });

  it('adds all 28 tiles to a binary dictionary', () => {
    expect(binRun.added).toHaveLength(TILES.length);
    expect(new Set(binRun.added.map((a) => a.name)).size).toBe(TILES.length);
  });

  it('gives the same tile the same name and class in both formats', () => {
    // The two serializers start from the same core node, so a divergence here is a
    // divergence in the add path, not in the bytes.
    expect(binRun.added.map((a) => `${a.section}/${a.className}/${a.name}`)).toEqual(
      textRun.added.map((a) => `${a.section}/${a.className}/${a.name}`),
    );
  });

  it('emits text output that is still parseable JSON', () => {
    expect(() => JSON.parse(textRun.text)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------------
// The comparison against MATLAB. For each class MATLAB can default-construct, every
// property MATLAB's own default carries must be present in ours with the same value.
// ---------------------------------------------------------------------------------
// Read the property bag out of the TEXT WE EMIT rather than off the live node: comparing file
// against file compares like with like and catches a serializer that drops or renames on the
// way out.
function emittedProps(className: string): { name: string; props: Record<string, unknown> } {
  const parsed = JSON.parse(textRun.text);
  const entries = parsed.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content
    .entries as any[];
  const hit = entries.find((e) => e.value?._array_class === className);
  expect(hit, `no emitted entry of class ${className}`).toBeTruthy();
  return { name: hit.name, props: (hit.value?._elements?.[0]?._properties ?? {}) as Record<string, unknown> };
}

describe('our default entry matches MATLAB default entry, property for property', () => {
  for (const className of Object.keys(MATLAB_DEFAULTS)) {
    it(`${className}`, () => {
      const { props: ours } = emittedProps(className);
      const theirs = MATLAB_DEFAULTS[className];

      for (const [prop, want] of Object.entries(theirs)) {
        expect(ours, `${className}.${prop} missing from our default`).toHaveProperty(prop);
        expect(String(ours[prop]), `${className}.${prop}`).toBe(String(want));
      }
    });
  }
});

describe('we do not invent properties MATLAB does not have', () => {
  for (const className of Object.keys(MATLAB_ABSENT)) {
    it(`${className} carries no property outside MATLAB's set`, () => {
      const { props } = emittedProps(className);
      const extra = Object.keys(props).filter((p) => MATLAB_ABSENT[className].indexOf(p) === -1);
      expect(extra, `${className} has properties MATLAB's default does not`).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------------
// The custom-save envelope, in BOTH formats. Per format, the envelope's field names and their
// order, against MATLAB's. Where the envelope HANGS differs by format on purpose (text spells it
// element-level `_custom_save`; binary writes an unnamed `<P Source="saveobj">`), so each
// spelling is located separately and then compared against one table.
// ---------------------------------------------------------------------------------
const CUSTOM_SAVE_KEY = '_custom_save';

/** The envelope's field names as the TEXT writer spells them, in written order. */
function textEnvelopeFields(className: string): string[] {
  const parsed = JSON.parse(textRun.text);
  const entries = parsed.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content
    .entries as any[];
  const hit = entries.find((e) => e.value?._array_class === className);
  expect(hit, `no emitted text entry of class ${className}`).toBeTruthy();
  const elem = hit.value._elements[0];
  // No property bag beside the envelope, which is the text half of defect 57.
  expect(Object.keys(elem), `${className} text element`).toEqual([CUSTOM_SAVE_KEY]);
  return Object.keys(elem[CUSTOM_SAVE_KEY]._elements[0]);
}

/**
 * The contents of the first `openTag` element, matched to its own close by DEPTH.
 *
 * Counting `</Element>`s instead would be wrong in a way that matters here: the fix being
 * regression-tested was a property written AFTER the envelope, so a slice that stops early
 * hides the very bytes under test and the assertion passes on nothing.
 */
function elementBody(xml: string, openTag: string): string {
  const at = xml.indexOf(openTag);
  expect(at, `no ${openTag} found`).toBeGreaterThan(-1);
  const re = /<(\/?)Element\b[^>]*?(\/?)>/g;
  re.lastIndex = at;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m[1]) {
      depth -= 1;
      if (depth === 0) return xml.slice(at + openTag.length, m.index);
    } else if (!m[2]) {
      depth += 1;
    }
  }
  throw new Error(`unterminated ${openTag}`);
}

/** The DIRECT `<P>` children of an element body, in order; an unnamed one reads `<unnamed>`. */
function directProps(body: string): string[] {
  const names: string[] = [];
  let depth = 0;
  const re = /<(\/?)([A-Za-z]+)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const [, close, tag, attrs, selfClose] = m;
    if (close) {
      depth -= 1;
      continue;
    }
    if (tag === 'P' && depth === 0) {
      const named = /Name="([^"]*)"/.exec(attrs);
      names.push(named ? named[1] : '<unnamed>');
    }
    if (!selfClose) {
      depth += 1;
    }
  }
  return names;
}

/** The same names as the BINARY writer spells them, plus every property beside the envelope. */
function binEnvelopeFields(className: string): { fields: string[]; beside: string[] } {
  const objBody = elementBody(binRun.xml, `<Element Class="${className}">`);
  // The object's own property list, which for a custom saver is the unnamed saveobj `<P>`
  // and nothing else. A NAMED `<P>` at this level is defect 57 exactly.
  const beside = directProps(objBody).filter((n) => n !== '<unnamed>');
  expect(objBody, `${className} has no saveobj envelope in the binary run`).toContain(
    '<P Source="saveobj"',
  );
  const structBody = elementBody(objBody.slice(objBody.indexOf('<P Source="saveobj"')), '<Element>');
  return { fields: directProps(structBody), beside };
}

describe('a custom-saving class writes MATLAB’s envelope, and nothing beside it', () => {
  // The bytes defect 57 actually produced, written out by hand, so the `beside` assertion
  // below is known to be capable of failing.
  it('would catch the invented property, in the place it was written', () => {
    const pre =
      '<Element Class="Simulink.VariantBank">' +
      '<P Source="saveobj" PropertyType="any" Class="struct">' +
      '<Element><P Name="Name" Class="char"/><P Name="Description" Class="char"/></Element>' +
      '</P>' +
      '<P Name="Value" Class="char"/>' +
      '</Element>';
    const body = elementBody(pre, '<Element Class="Simulink.VariantBank">');
    expect(directProps(body)).toEqual(['<unnamed>', 'Value']);
    expect(directProps(elementBody(body.slice(body.indexOf('<P Source="saveobj"')), '<Element>'))).toEqual([
      'Name',
      'Description',
    ]);
  });

  for (const className of Object.keys(MATLAB_CUSTOM_SAVE)) {
    const want = MATLAB_CUSTOM_SAVE[className];

    it(`${className} — text`, () => {
      expect(textEnvelopeFields(className)).toEqual(want);
    });

    it(`${className} — binary`, () => {
      const { fields, beside } = binEnvelopeFields(className);
      // Stated first because it is the defect: no property may sit beside the envelope.
      expect(beside, `${className} carries properties beside its envelope`).toEqual([]);
      expect(fields).toEqual(want);
    });

    it(`${className} — the two formats agree`, () => {
      // The invariant BETWEEN the paths: neither format is the reference, they have to match
      // each other as well as MATLAB.
      expect(binEnvelopeFields(className).fields).toEqual(textEnvelopeFields(className));
    });
  }
});
