// Copyright 2026 The MathWorks, Inc.
//
// A complex value written into an uncompressed-text dictionary. MATLAB stores every
// complex value there as a MAT byte stream (defect 24), and reads the plain complex text a
// binary dictionary uses — `{"_type": "cdata", "_value": "3+4i"}` — back out of a text
// dictionary as an EMPTY double. That text is also the form the MCOS decoder hands the
// node layer for a complex value in a .mat or a model workspace, and an untouched value
// writes itself back by replaying the form it was read in. So a Parameter pasted into a
// text dictionary out of a binary one, or copied in out of a .mat, used to go into the
// file as text and reopen in MATLAB as [].
//
// Graded against MATLAB's own entries: test/fixtures/mcos/complex.sldd (text),
// complex_binary.sldd and complex_objects.mat hold the same values, all written by
// make_complex_fixtures.m on R2027a. A value put into complex.sldd, saved and reopened,
// must present exactly as MATLAB's own entry of the same name does there.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { isMatCdata, uudecode } from '../src/datamodel/parser/CdataCodec.js';
import { parseMatrix } from '../src/datamodel/parser/MatParser.js';
import { complexTextVariable, encodeMatVariable } from '../src/datamodel/parser/MatWriter.js';
import '../src/datamodel/node/data/NodeClassMap.js';
import { presentation } from './tools/nodePresentation.js';

const fixture = (name: string): ArrayBuffer => {
  const u8 = new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/mcos/${name}`, import.meta.url))));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
};
const textBytes = (text: string): ArrayBuffer => {
  const u8 = new TextEncoder().encode(text);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
};

/** A MAT stream's variable, as the reader decodes one (MatlabVariableNode.parseCdata). */
function streamVariable(cdata: any): any {
  const bytes = uudecode(cdata._value);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return parseMatrix(dv, 16, dv.getUint32(12, true));
}

/** Every complex value inside an entry's saved JSON value, by where it sits. */
function cdataIn(x: unknown, path = ''): [string, any][] {
  if (x === null || typeof x !== 'object') return [];
  const o = x as Record<string, unknown>;
  if (o._type === 'cdata') return [[path, o]];
  return Object.entries(o).flatMap(([k, v]) => cdataIn(v, path + '/' + k));
}

const SOURCES = [
  { file: 'complex_objects.mat', label: 'a .mat', section: (r: any) => r },
  { file: 'complex_binary.sldd', label: 'a binary dictionary', section: (r: any) => r.getSection('design') },
];

for (const source of SOURCES) {
  describe(`a complex Parameter put into a text dictionary out of ${source.label} reopens as MATLAB's own`, () => {
    const session = createSession();
    const from: any = source.section(ingest(session, fixture(source.file), { filename: source.file }));
    const txt: any = ingest(session, fixture('complex.sldd'), { filename: 'complex.sldd' });
    const design = txt.getSection('design');
    const native = new Set(design.children.map((e: any) => e.name));
    const meta = design.children.find((e: any) => e.name === 'pScalar').metadata;
    // Every object both hold whose value has a complex number in it: the Parameters, and
    // a LookupTable, whose complex numbers are one object further down (Table.Value), in a
    // bag replayed whole.
    const shared = from.children.filter(
      (e: any) =>
        (/Parameter$/.test(e.className) || e.className === 'Simulink.LookupTable') &&
        native.has(e.name) &&
        /cdata/.test(JSON.stringify(e.serialize())),
    );
    let seq = 0;
    for (const e of shared) {
      const payload: any = JSON.parse(JSON.stringify(e.serialize()));
      payload.name = e.name + '_pasted';
      payload.metadata = { ...meta, uuid: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}` };
      design.parseEntry(payload);
    }
    const saved = session.serializeSource(txt.name);
    const entries: any[] = JSON.parse(saved.text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const reopened: any = ingest(createSession(), textBytes(saved.text), { filename: 'complex.sldd' }).getSection('design');

    it('pastes every complex Parameter both files hold', () => {
      expect(saved.kind).toBe('text');
      expect(shared.map((e: any) => e.name)).toEqual(
        expect.arrayContaining(['pScalar', 'pRow', 'pMat', 'pNd', 'pInt64', 'pInt16Row', 'pMixedNF', 'pNonFinite', 'pStruct', 'lut']),
      );
    });

    for (const e of shared) {
      it(e.name, () => {
        const ours = entries.find((x) => x.name === e.name + '_pasted');
        const theirs = entries.find((x) => x.name === e.name);
        // Every complex value in it is a MAT stream, as in MATLAB's own entry, and holds
        // the class MATLAB's does.
        const a = cdataIn(ours.value);
        const b = cdataIn(theirs.value);
        expect(a.length, e.name).toBeGreaterThan(0);
        // At the same places, up to how a nested object is spelled: a binary dictionary's
        // reader gives one as `{_array_class, _elements: [{_properties}]}`, a text one's as
        // `{_object_class, _properties}` (the LookupTable's Table), which is not about
        // complex numbers and is left as it is.
        const place = (p: string) => p.replace(/\/_elements\/0(?=\/_properties)/g, '');
        expect(a.map(([p]) => place(p))).toEqual(b.map(([p]) => place(p)));
        a.forEach(([p, cdata], k) => {
          expect(isMatCdata(cdata), `${e.name}${p}`).toBe(true);
          const [ov, tv] = [streamVariable(cdata), streamVariable(b[k][1])];
          expect([ov.className, ov.dimensions, ov.isComplex], `${e.name}${p}`).toEqual([tv.className, tv.dimensions, true]);
          expect(ov.value, `${e.name}${p}`).toEqual(tv.value);
        });
        // And it reopens as MATLAB's entry presents.
        const pasted = reopened.children.find((x: any) => x.name === e.name + '_pasted');
        const own = reopened.children.find((x: any) => x.name === e.name);
        expect(presentation(pasted, pasted.displayName)).toEqual(presentation(own, own.displayName));
      });
    }
  });
}

describe('in its own dictionary a complex value nobody edited is still MATLAB\'s bytes', () => {
  it('a text dictionary\'s streams, and a binary dictionary\'s text', () => {
    const session = createSession();
    const txt: any = ingest(session, fixture('complex.sldd'), { filename: 'complex.sldd' });
    const original = JSON.parse(new TextDecoder().decode(new Uint8Array(fixture('complex.sldd'))));
    const saved = JSON.parse(session.serializeSource(txt.name).text);
    const values = (j: any) =>
      j.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.flatMap((x: any) => cdataIn(x.value, x.name));
    expect(values(saved)).toEqual(values(original));
    expect(values(saved).length).toBeGreaterThanOrEqual(30);
    // The binary dictionary's text replays as text: complexBinaryWriteBack.test.ts grades
    // the XML it becomes.
    const bin: any = ingest(session, fixture('complex_binary.sldd'), { filename: 'complex_binary.sldd' });
    const p = bin.getSection('design').children.find((x: any) => x.name === 'pRow');
    expect(cdataIn(p.serialize())).toEqual([['/value/_elements/0/_properties/Value', { _type: 'cdata', _value: '1.0+2.0i 3.0+4.0i 5.0+6.0i', _dimensions: [1, 3] }]]);
  });
});

describe('an edited complex value keeps its class and its NaN parts', () => {
  // An element edit rebuilds the value from its rows (_buildVarObject), which used to
  // class every complex value double and read an Inf or NaN part, and an element edited to
  // a real number, as 0+0i.
  const editAndReopen = (name: string, k: number, typed: string): any => {
    const session = createSession();
    const mat: any = ingest(session, fixture('complex_objects.mat'), { filename: 'complex_objects.mat' });
    const txt: any = ingest(session, fixture('complex.sldd'), { filename: 'complex.sldd' });
    const design = txt.getSection('design');
    const payload: any = JSON.parse(JSON.stringify(mat.children.find((e: any) => e.name === name).serialize()));
    payload.name = name + '_edited';
    payload.metadata = { ...design.children[0].metadata, uuid: '00000000-0000-4000-8000-0000000000ff' };
    const node = design.parseEntry(payload);
    expect(node.children[0].children[k].setProperty('Value', typed)).toBe(true);
    const saved = session.serializeSource(txt.name).text;
    return ingest(createSession(), textBytes(saved), { filename: 'complex.sldd' })
      .getSection('design')
      .children.find((e: any) => e.name === name + '_edited');
  };

  it('an int16 array stays int16', () => {
    const e = editAndReopen('pInt16Row', 1, '9');
    expect([e.displayValue, e.children[0].className]).toEqual(['[1+2i 9+0i 5+6i]', 'int16']);
  });

  it('a NaN part stays NaN', () => {
    const e = editAndReopen('pMixedNF', 0, '7');
    expect(e.displayValue).toBe('[7+0i NaN+0i 3-4i]');
  });

  it('every non-finite part stays what it was', () => {
    const e = editAndReopen('pNonFinite', 0, '5');
    // The text dictionary's own spelling of an infinity (complexMcosFixtures pins it).
    expect(e.displayValue).toBe('[5+0i NaN+1i 1NaNi -Infinity+2i]');
  });
});

describe('the pieces', () => {
  it('MatWriter writes a NaN as NaN', () => {
    const round = (v: any) => {
      const bytes = encodeMatVariable({ name: '', isLogical: false, fields: null, ...v });
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return parseMatrix(dv, 8, dv.getUint32(4, true)).value;
    };
    expect(round({ className: 'double', dimensions: [1, 3], isComplex: false, value: [1, NaN, Infinity] })).toEqual([1, NaN, Infinity]);
    expect(round({ className: 'single', dimensions: [1, 2], isComplex: false, value: [NaN, 2] })).toEqual([NaN, 2]);
    expect(
      round({ className: 'double', dimensions: [1, 2], isComplex: true, value: [{ re: NaN, im: 1 }, { re: 1, im: NaN }] }),
    ).toEqual([{ re: NaN, im: 1 }, { re: 1, im: NaN }]);
  });

  it('complex text, in any reader\'s spelling, is the variable it stands for', () => {
    const v = complexTextVariable({
      _type: 'cdata',
      _value: 'Inf-Infi NaN+1.0i 1.0NaNi -Inf+2.0i',
      _dimensions: [2, 2],
    });
    // Column-major text, row-major variable.
    expect(v).toMatchObject({ className: 'double', dimensions: [2, 2], isComplex: true });
    expect(v!.value).toEqual([
      { re: Infinity, im: -Infinity },
      { re: 1, im: NaN },
      { re: NaN, im: 1 },
      { re: -Infinity, im: 2 },
    ]);
    expect(complexTextVariable({ _type: 'cdata', _value: '9223372036854775807+1i', _class: 'int64' })).toMatchObject({
      className: 'int64',
      dimensions: [1, 1],
      value: [{ re: '9223372036854775807', im: 1 }],
    });
    // Not complex text: a stream, a count the shape does not hold, a token that is not one.
    for (const bad of [
      { _type: 'cdata', _value: '1+2i 3+4i', _dimensions: [1, 3] },
      { _type: 'cdata', _value: '1+2i junk' },
      { _type: 'double', _value: '3' },
    ]) {
      expect(complexTextVariable(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
