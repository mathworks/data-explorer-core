// Copyright 2026 The MathWorks, Inc.
//
// A double and a single as a compressed-binary dictionary spells them, against MATLAB's own
// text for the same value. test/numbers/battery_binary.sldd is MATLAB's (R2027a,
// make_number_battery.m): 2,109 doubles and 1,807 singles of random magnitude and sign, and
// powers, integers, subnormals, both zeros, the non-finites, +-realmax and the values where
// the layout changes, beside the exact bits of each in the .bin files. battery.truth.json is
// MATLAB's reading of the dictionary it wrote: every token is the value whose bits sit at
// the same place in the .bin.
//
// The battery is not under test/fixtures, where every binary dictionary is walked by tests
// that make each edit a node offers (binarySaveKeepsUnedited): its 4,000 element nodes, each
// offered five, took that walk past its two-minute budget. It is a truth about spelling, and
// these tests are the ones that read it.
//
// MATLAB's rule, measured on the battery: a double is C's `%.15g` where that is the same
// double and `%.17g` where it is not; a single is `%.6g`, else `%.9g`, else `%.10g`, a
// candidate past realmax('single') not counting. Rounding is C's, an exact tie to the even
// digit (1125899906842624.25 is `1125899906842624.2`). An integral mantissa gains `.0`, and
// the exponent is `E+n` or `E-n`, from where `%g` switches to it: `1.0E-5`, `1.0E+15`,
// `9007199254740992.0`, `3.1415926535897931`, `-0.0`, `1.0E+6` for the single 1e6.
//
// The writers spelled a number as JavaScript's String() does, plus `.0`: `-0` as `0.0`
// (C-062), 1e-5 as `0.00001`, pi as `3.141592653589793`, the single 1e6 as `1000000.0`.
// Every one is the same value MATLAB reads, but not the text MATLAB writes, so a save
// rewrote numbers nobody edited in every entry it regenerated, and a -0 came back +0.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { regenerateEntryXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import { formatFloatXml, formatComplexBodyXml, formatComplexNum } from '../src/datamodel/parser/XmlUtils.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const DIR = new URL('./numbers/', import.meta.url);
const bytesOf = (name: string): Uint8Array => new Uint8Array(readFileSync(fileURLToPath(new URL(name, DIR))));
const chunkOf = (zip: Uint8Array): string => new TextDecoder().decode(unzipSync(zip)['data/chunk0.xml']);

interface TruthEntry {
  name: string;
  class: 'double' | 'single';
  isComplex: boolean;
  size: number[];
  bin: string;
  bitsEqual: boolean;
}
const TRUTH = JSON.parse(new TextDecoder().decode(bytesOf('battery.truth.json'))) as {
  release: string;
  entries: TruthEntry[];
  edgeP: { name: string; bitsEqual: boolean; minSignbit: boolean };
};
const FIXTURE = bytesOf('battery_binary.sldd');
const MATLAB_CHUNK = chunkOf(FIXTURE);

/** One entry's `<Object>` block, found by its Name. */
function entryBlock(xml: string, name: string): string {
  const at = xml.indexOf('<P Name="Name" Class="char">' + name + '</P>');
  expect(at, name).toBeGreaterThan(-1);
  const open = xml.lastIndexOf('<Object ', at);
  return xml.slice(open, xml.indexOf('</Object>', at));
}

/** The first `<P Name="…">` property named `prop` in `block`, as written. */
function propTag(block: string, prop: string): string {
  const m = new RegExp('<P Name="' + prop + '"[^>]*>[^<]*</P>').exec(block);
  expect(m, prop).not.toBeNull();
  return m![0];
}

const bodyOf = (tag: string): string => tag.replace(/^<[^>]*>|<\/P>$/g, '');
const tokensOf = (tag: string): string[] => bodyOf(tag).split(' ');

/** The elements an entry's .bin holds, each a double (a single's widened exactly). */
function binValues(entry: TruthEntry): number[] {
  const b = bytesOf(entry.bin);
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const width = entry.class === 'single' ? 4 : 8;
  const out: number[] = [];
  for (let at = 0; at < b.byteLength; at += width) {
    out.push(width === 4 ? view.getFloat32(at, true) : view.getFloat64(at, true));
  }
  return out;
}

const REAL = TRUTH.entries.filter((e) => !e.isComplex);
const COMPLEX = TRUTH.entries.filter((e) => e.isComplex);

/** Where `got` differs from MATLAB's tokens, at most `limit` of them, and how many. */
function mismatches(matlab: string[], got: string[], limit = 8): { count: number; first: string[] } {
  const first: string[] = [];
  let count = 0;
  matlab.forEach((t, i) => {
    if (got[i] !== t) {
      if (count++ < limit) first.push(`#${i}: MATLAB ${t}, written ${got[i]}`);
    }
  });
  return { count, first };
}

describe('the battery is what these tests need', () => {
  it('MATLAB read back the bits it was given, for every entry', () => {
    expect(TRUTH.release).toBe('2027a');
    expect(TRUTH.entries.map((e) => e.name)).toEqual(['battery_d', 'battery_s', 'edge_d', 'edge_s', 'edge_c', 'edge_cs']);
    for (const e of TRUTH.entries) {
      expect(e.bitsEqual, e.name).toBe(true);
    }
    expect(TRUTH.edgeP).toMatchObject({ name: 'edge_p', bitsEqual: true, minSignbit: true });
  });

  it('each entry holds one token for each value of its .bin', () => {
    for (const e of TRUTH.entries) {
      const tokens = tokensOf(propTag(entryBlock(MATLAB_CHUNK, e.name), 'Value'));
      const n = e.size.reduce((a, b) => a * b, 1);
      expect(tokens.length, e.name).toBe(n);
      expect(binValues(e).length, e.name).toBe(e.isComplex ? 2 * n : n);
    }
  });

  it('and between them every layout MATLAB has', () => {
    const all = TRUTH.entries.flatMap((e) => tokensOf(propTag(entryBlock(MATLAB_CHUNK, e.name), 'Value')));
    expect(all.length).toBeGreaterThan(3900);
    for (const token of ['-0.0', '0.0', 'Inf', '-Inf', 'NaN', '1.0E-5', '1.0E+15', '9007199254740992.0', '3.1415926535897931',
      '4.94065645841247E-324', '1125899906842624.2', '3.402823466E+38', '1.0E+6', '1000000.12', '1.4013E-45', '0.333333343']) {
      expect(all, token).toContain(token);
    }
  });
});

describe('formatFloatXml spells every number of the battery as MATLAB does', () => {
  for (const e of REAL) {
    it(`${e.name}: ${e.size.reduce((a, b) => a * b, 1)} ${e.class}s`, () => {
      const matlab = tokensOf(propTag(entryBlock(MATLAB_CHUNK, e.name), 'Value'));
      const ours = binValues(e).map((x) => formatFloatXml(x, e.class));
      expect(mismatches(matlab, ours)).toEqual({ count: 0, first: [] });
    });
  }

  it('a single is the float32 the number names, as MATLAB holds a single', () => {
    // A single's value can reach a writer as the double of its decimal (0.1 from `0.1F`) or
    // one past a single's range; MATLAB holds it as single() makes it.
    expect(formatFloatXml(0.1, 'single')).toBe('0.1');
    expect(formatFloatXml(3.3, 'single')).toBe('3.3');
    expect(formatFloatXml(1 / 3, 'single')).toBe('0.333333343');
    expect(formatFloatXml(1e39, 'single')).toBe('Inf');
    expect(formatFloatXml(-1e39, 'single')).toBe('-Inf');
  });

  it('what is not a finite number is written as it was', () => {
    // The exact decimal text of a 64-bit integer, and MATLAB's words for the non-finites.
    expect(formatFloatXml('9223372036854775807', 'double')).toBe('9223372036854775807');
    expect(formatFloatXml(Infinity, 'double')).toBe('Inf');
    expect(formatFloatXml(-Infinity, 'single')).toBe('-Inf');
    expect(formatFloatXml(NaN, 'double')).toBe('NaN');
  });
});

describe('a complex element is spelled part by part, as MATLAB spells it', () => {
  for (const e of COMPLEX) {
    it(`${e.name}: ${e.size.reduce((a, b) => a * b, 1)} complex ${e.class}s, typed in`, () => {
      // An element edited in the inspector is this package's own text for it (formatComplexNum,
      // `1e-7+2e-8i`), which is what the writer is handed. A part of -0 is signed here, as a
      // reader's text holds it; formatComplexNum's String() spells it 0, which is F2-9's.
      const matlab = tokensOf(propTag(entryBlock(MATLAB_CHUNK, e.name), 'Value'));
      const parts = binValues(e);
      const signed = (x: number): string => (Object.is(x, -0) ? '-0' : String(x));
      const typed = matlab.map((_, i) => {
        const [re, im] = [parts[2 * i], parts[2 * i + 1]];
        return Object.is(re, -0) || Object.is(im, -0)
          ? signed(re) + (im < 0 || Object.is(im, -0) ? '' : '+') + signed(im) + 'i'
          : formatComplexNum(re, im);
      });
      expect(typed.some((t) => t.includes('e-'))).toBe(true);
      expect(formatComplexBodyXml(typed.join(' '), e.class)).toBe(matlab.join(' '));
    });
  }

  it('a NaN imaginary part keeps its sign, the one spelling of it MATLAB reads back', () => {
    expect(formatComplexBodyXml('1NaNi 1e-7NaNi NaN-0i', 'double')).toBe('1.0+NaNi 1.0E-7+NaNi NaN-0.0i');
  });
});

describe('an entry the writer rebuilds is written with MATLAB\'s spelling of every number', () => {
  const session = createSession();
  const root: any = ingest(session, FIXTURE.buffer.slice(FIXTURE.byteOffset, FIXTURE.byteOffset + FIXTURE.byteLength) as ArrayBuffer, {
    filename: 'battery_binary.sldd',
  });
  const design = root.getSection('design');
  const entryNamed = (name: string): any => design.children.find((c: any) => c.name === name);

  // regenerateEntryXml is what a save writes for an entry it does not keep the bytes of.
  //
  // But for one number: a -0 ELEMENT of a real vector. The reader holds a vector as its text
  // literal (BinarySlddParser, formatNumLiteral), which spells -0 as 0, so the writer is handed
  // a 0; a scalar, a property and a complex part keep -0. That is F2-9's (the -0 of a model
  // literal), not the writer's spelling, and these are the only numbers it reaches here.
  const NEGATIVE_ZERO_ELEMENTS: Record<string, number[]> = { edge_d: [1], edge_s: [1] };

  for (const e of REAL) {
    it(e.name, () => {
      const matlab = tokensOf(propTag(entryBlock(MATLAB_CHUNK, e.name), 'Value'));
      const ours = tokensOf(propTag(regenerateEntryXml(entryNamed(e.name)), 'Value'));
      const lost = NEGATIVE_ZERO_ELEMENTS[e.name] ?? [];
      expect(mismatches(matlab, ours)).toEqual({
        count: lost.length,
        first: lost.map((i) => `#${i}: MATLAB -0.0, written 0.0`),
      });
    });
  }

  it('a complex entry, whose text the reader holds as MATLAB wrote it, comes back as that text', () => {
    // A guard, which passes on either side of the change: the writer used to leave MATLAB's
    // text as it was, and now reads each part and spells it again, -0 parts included.
    for (const e of COMPLEX) {
      const matlab = propTag(entryBlock(MATLAB_CHUNK, e.name), 'Value');
      expect(propTag(regenerateEntryXml(entryNamed(e.name)), 'Value'), e.name).toBe(matlab);
    }
  });

  it('a Parameter whose Min is -0, saved after an edit, keeps it -0.0 (C-062)', () => {
    const p = entryNamed('edge_p');
    session.setActive(root, p);
    expect(session.editProperty(p.id, 'Description', 'edited')).toBe(true);
    const saved = entryBlock(chunkOf(session.serializeSource(root.name)!.bytes as Uint8Array), 'edge_p');
    expect(saved).toContain('<P Name="Description" Class="char">edited</P>');
    const matlab = entryBlock(MATLAB_CHUNK, 'edge_p');
    for (const prop of ['Min', 'Max', 'Value']) {
      expect(propTag(saved, prop), prop).toBe(propTag(matlab, prop));
    }
    expect(propTag(saved, 'Min')).toBe('<P Name="Min" Class="double">-0.0</P>');
  });

  it('a complex element typed as 0.0000001+0.00000002i is saved as MATLAB writes it, 1.0E-7+2.0E-8i', () => {
    const fresh = createSession();
    const r: any = ingest(fresh, FIXTURE.buffer.slice(FIXTURE.byteOffset, FIXTURE.byteOffset + FIXTURE.byteLength) as ArrayBuffer, {
      filename: 'battery_binary.sldd',
    });
    const c = r.getSection('design').children.find((n: any) => n.name === 'edge_c');
    const second = c.children[1];
    fresh.setActive(r, second);
    expect(fresh.editProperty(second.id, 'Value', '0.0000001+0.00000002i')).toBe(true);
    const saved = propTag(entryBlock(chunkOf(fresh.serializeSource(r.name)!.bytes as Uint8Array), 'edge_c'), 'Value');
    const matlab = tokensOf(propTag(entryBlock(MATLAB_CHUNK, 'edge_c'), 'Value'));
    expect(tokensOf(saved)).toEqual([matlab[0], '1.0E-7+2.0E-8i', ...matlab.slice(2)]);
  });
});
