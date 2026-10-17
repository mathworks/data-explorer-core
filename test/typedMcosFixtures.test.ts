// Copyright 2026 The MathWorks, Inc.
//
// C-033: a real number of a class other than double, inside an MCOS object, against
// MATLAB's own answers, on the fixtures test/fixtures/mcos/make_typed_fixtures.m writes
// (R2027a): typed_objects.mat; typed_ws.slx, whose MODEL WORKSPACE holds the same values;
// and typed_mcos.sldd (text) and typed_mcos_binary.sldd (compressed-binary), dictionaries
// holding them entry for variable. Every name is in all four.
//
// A Simulink.Parameter whose Value is int32([100 200 300 400]) showed class double in the
// .mat and the workspace, where both dictionaries showed int32; a logical row showed
// double; and single(3.3) showed 3.299999952316284 where both dictionaries showed 3.3. The
// MCOS decoder handed a non-double number over bare, which the node layer reads as a
// double, and MatParser read a single as the double it widens to. Each venue now presents
// each value as every other does, of MATLAB's class and size.
//
// The digits a single shows are MATLAB's: a dictionary holds MATLAB's own text for it, so
// sSingleSweep, 4,082 float32 bit patterns from the smallest subnormal to realmax, is
// MATLAB's rule for that text, element by element, and a single read out of MAT bytes is
// held to it. The sweep is in every venue but the binary dictionary (make_typed_fixtures.m's
// names_in gives the reason), whose text for the same singles was measured to be the text
// dictionary's.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { decodeMcosBlob } from '../src/datamodel/parser/McosParser.js';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import '../src/datamodel/node/data/NodeClassMap.js';
import { presentation } from './tools/nodePresentation.js';

const fixturePath = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const bytes = (name: string): Uint8Array => new Uint8Array(readFileSync(fixturePath(name)));
const buffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

interface ValueTruth {
  class: string;
  size: number[];
  numel?: number;
  mat2str?: string;
  elements?: string[];
}
interface Venue {
  file: string;
  paths: Record<string, { class: string; value: ValueTruth }>;
}
const truth: { release: string; names: string[]; mat: Venue; slx: Venue; text: Venue; binary: Venue } = JSON.parse(
  readFileSync(fixturePath('mcos/typed_fixtures.truth.json'), 'utf8'),
);

/** A venue's variables: the node MATLAB's top-level names sit under. */
function variablesOf(file: string, session = createSession()): any {
  const root: any = ingest(session, buffer(bytes(`mcos/${file}`)), { filename: file });
  if (file.endsWith('.slx')) return root.getSection('workspace');
  if (file.endsWith('.sldd')) return root.getSection('design');
  return root;
}
const VENUES = (['mat', 'slx', 'text', 'binary'] as const).map((key) => ({ key, file: truth[key].file, variables: variablesOf(truth[key].file) }));
const named = (variables: any, name: string): any => variables.children.find((c: any) => c.name === name);

/** The node that holds a value's numbers: a Parameter's value node, or the variable itself. */
function valueNodeOf(node: any): any | null {
  if (!/Parameter$/.test(node.className)) return node;
  return node._valueNode ?? node.children.find((c: any) => c.name === 'Value') ?? null;
}

/** What a host is shown for a value: its own cell, class and size, and every element's. */
function shownOf(node: any): unknown {
  const v = valueNodeOf(node);
  return {
    className: node.className,
    displayValue: node.displayValue,
    row: node.toRow().Value,
    value: v && {
      className: v.className,
      dims: v.dims,
      displayValue: v.displayValue,
      elements: v.children.map((c: any) => [c.toRow().Name.label.replace(/^[^(]*/, ''), c.className, c.displayValue]),
    },
  };
}

// A double or a logical SCALAR in a Parameter is shown inline, with no node of its own
// to carry a class (parameterNode.test.ts): there the class is graded on the dictionaries'
// side alone, by the presentation being theirs.
const INLINE = new Set(['pDouble', 'pLogical']);

// The two values of more than 64 elements, whose truth is their size (make_typed_fixtures.m).
const LONG = new Set(['sSingleSweep']);

// The names a venue holds, by its truth: every one, but for the sweep in the binary dictionary.
const holds = (key: (typeof VENUES)[number]['key'], name: string): boolean => name in truth[key].paths;

describe('typed MCOS fixtures: every venue holds every name', () => {
  it('as MATLAB read it back', () => {
    expect(truth.release).toBe('2027a');
    for (const { key, variables } of VENUES) {
      const expected = truth.names.filter((n) => !(key === 'binary' && LONG.has(n)));
      expect(Object.keys(truth[key].paths).sort(), key).toEqual([...expected].sort());
      for (const name of expected) {
        expect(named(variables, name), `${key} ${name}`).toBeDefined();
      }
    }
  });
});

describe('typed MCOS fixtures: each value presents alike in every venue, as MATLAB\'s class and size', () => {
  for (const name of truth.names) {
    it(name, () => {
      const t = truth.mat.paths[name];
      const text = shownOf(named(VENUES[2].variables, name));
      // The .mat, the workspace and the binary dictionary, each as the text dictionary.
      for (const { key, variables } of VENUES.filter((v) => holds(v.key, name))) {
        expect(shownOf(named(variables, name)), `${key} ${name}`).toEqual(text);
      }
      const node = named(VENUES[0].variables, name);
      expect(node.className, name).toBe(t.class);
      if (INLINE.has(name)) {
        expect(valueNodeOf(node), name).toBeNull();
        return;
      }
      const v = valueNodeOf(node);
      expect(v.className, name).toBe(t.value.class);
      expect(v.dims, name).toEqual(t.value.size);
    });
  }
});

/** A float32's value from MATLAB's num2hex of it. */
const fromHex = (hex: string): number => {
  const view = new DataView(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < hex.length; i += 2) view.setUint8(i / 2, parseInt(hex.slice(i, i + 2), 16));
  return hex.length === 8 ? view.getFloat32(0) : view.getFloat64(0);
};

// An element row's label names its subscripts, and the truth is column-major.
function columnMajorIndex(label: string, size: number[]): number {
  const m = /\(([\d,]+)\)$/.exec(label);
  if (!m) return 0;
  const subs = m[1].split(',').map(Number);
  if (subs.length === 1) return subs[0] - 1;
  let k = 0;
  let stride = 1;
  subs.forEach((s, d) => {
    k += (s - 1) * stride;
    stride *= size[d];
  });
  return k;
}

describe('typed MCOS fixtures: the .mat\'s numbers are MATLAB\'s', () => {
  for (const name of truth.names.filter((n) => !INLINE.has(n) && !LONG.has(n))) {
    it(name, () => {
      const t = truth.mat.paths[name].value;
      const v = valueNodeOf(named(VENUES[0].variables, name));
      const rows: any[] = v.children.length > 0 ? v.children : [v];
      expect(rows, name).toHaveLength(t.elements!.length);
      for (const row of rows) {
        const label = row === v ? '' : row.toRow().Name.label;
        const k = columnMajorIndex(label, t.size);
        const matlab = t.elements![k];
        const ours = row.displayValue;
        if (t.class === 'single' || t.class === 'double') {
          // The number shown is the one MATLAB stored, to the bit.
          const bits = fromHex(matlab);
          expect(t.class === 'single' ? Math.fround(Number(ours)) : Number(ours), `${name}${label}`).toBe(bits);
        } else if (t.class === 'logical') {
          expect(ours, `${name}${label}`).toBe(matlab === '1' ? 'true' : 'false');
        } else {
          expect(ours, `${name}${label}`).toBe(matlab);
        }
      }
    });
  }
});

describe('typed MCOS fixtures: a single shows the digits MATLAB writes for it', () => {
  // MATLAB's own text for each element of sSingleSweep, out of each dictionary's bytes.
  const textTokens = (): string[] => {
    const json = JSON.parse(new TextDecoder().decode(bytes('mcos/typed_mcos.sldd')));
    const entries: any[] = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const value: string = entries.find((e) => e.name === 'sSingleSweep').value._value;
    return value.slice(value.indexOf('[') + 1, value.lastIndexOf(']')).split(',').map((s) => s.trim().replace(/F$/, ''));
  };
  it('the sweep is the 4,082 singles it says', () => {
    expect(textTokens()).toHaveLength(4082);
    expect(truth.mat.paths.sSingleSweep.value).toMatchObject({ class: 'single', size: [1, 4082] });
  });

  for (const key of ['mat', 'slx', 'text'] as const) {
    it(`${key}: every element of the sweep shows MATLAB's digits`, () => {
      const matlab = textTokens().map((s) => String(Number(s)));
      const sweep = named(VENUES.find((v) => v.key === key)!.variables, 'sSingleSweep');
      expect(sweep.children).toHaveLength(matlab.length);
      const ours: string[] = sweep.children.map((c: any) => c.displayValue);
      const differ = ours.map((o, k) => [k, o, matlab[k]]).filter(([, o, m]) => o !== m);
      expect(differ).toEqual([]);
    });
  }

  it('an exact tie at nine digits goes to the even one, in every venue', () => {
    for (const { key, variables } of VENUES) {
      expect(named(variables, 'sSingleTies').displayValue, key).toBe('[1000000.12 1000000.38 1000000.62 -1000000.12 2097151.88]');
    }
  });
});

describe('typed MCOS fixtures: a Parameter out of the .mat goes into a dictionary as MATLAB\'s own entry is', () => {
  const PARAMS = truth.names.filter((n) => truth.mat.paths[n].class === 'Simulink.Parameter');

  /** The Value `<P>` of an entry in a binary dictionary's chunk XML. */
  const valueTag = (xml: string): string => /<P Name="Value"[^>]*>[^<]*<\/P>/.exec(xml)![0];
  const entryBlock = (xml: string, name: string): string => {
    const at = xml.indexOf('<P Name="Name" Class="char">' + name + '</P>');
    return xml.slice(xml.lastIndexOf('<Object', at), xml.indexOf('</Object>', at));
  };

  for (const target of ['typed_mcos.sldd', 'typed_mcos_binary.sldd']) {
    describe(target, () => {
      const session = createSession();
      const mat = variablesOf('typed_objects.mat', session);
      const root: any = ingest(session, buffer(bytes(`mcos/${target}`)), { filename: target });
      const design = root.getSection('design');
      const meta = named(design, 'pInt8').metadata;
      let seq = 0;
      for (const name of PARAMS) {
        const payload: any = JSON.parse(JSON.stringify(named(mat, name).serialize()));
        payload.name = name + '_fromMat';
        payload.metadata = { ...meta, uuid: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}` };
        design.parseEntry(payload);
      }
      const saved: any = session.serializeSource(root.name);
      const reopened: any = ingest(createSession(), buffer(saved.bytes ?? new TextEncoder().encode(saved.text)), { filename: target }).getSection('design');

      for (const name of PARAMS) {
        it(name, () => {
          const pasted = named(reopened, name + '_fromMat');
          const own = named(reopened, name);
          expect(presentation(pasted, pasted.displayName)).toEqual(presentation(own, own.displayName));
          if (target.endsWith('binary.sldd')) {
            // The Value MATLAB wrote for the same value: its class, its shape, its text.
            const xml = new TextDecoder().decode(unzipSync(saved.bytes)['data/chunk0.xml']);
            const matlab = new TextDecoder().decode(unzipSync(bytes(`mcos/${target}`))['data/chunk0.xml']);
            expect(valueTag(entryBlock(xml, name + '_fromMat')), name).toBe(valueTag(entryBlock(matlab, name)));
          }
        });
      }
    });
  }
});

describe('what reads a typed number back out of an MCOS property', () => {
  it('an int32 enumeration keeps the number each enumeral stands for', () => {
    // display/dispcat_opaque.mat (R2027a) holds a Simulink.Parameter whose Value is
    // DispColor.Green, DispColor being an Simulink.IntEnumType. The enumeral's number is its
    // object's `int32.Data`, an int32 the decoder now spells typed; the enumeration reader
    // takes its number from that spelling as it took it from the bare number.
    const buf = bytes('display/dispcat_opaque.mat');
    const { variables } = parseMat(buffer(buf));
    const anon = variables.find((v) => (v as unknown as { _anonymous?: boolean })._anonymous)!;
    const opaque = variables.filter((v) => v.isOpaque && v.name);
    const decoded = decodeMcosBlob(anon._rawBytes!, opaque.map((v) => ({ name: v.name, className: v.className, rawBytes: v._rawBytes })));
    const enumerals = [...decoded.values()].flatMap((d) => {
      const value = d.properties.Value as { _elements?: { _enumeration?: unknown }[] } | undefined;
      return (value?._elements ?? []).map((e) => e._enumeration).filter(Boolean);
    });
    expect(enumerals).toContainEqual({ name: 'Green', type: 'int32', value: '2' });
  });
});
