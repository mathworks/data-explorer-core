// Copyright 2026 The MathWorks, Inc.
//
// Complex values typed in MATLAB's forms, each read as MATLAB reads it: `i` is 0+1i and
// `-i` is 0-1i, `j` is the same unit as `i` (`1+2j` is 1+2i), and the sign between the parts
// may have spaces around it (`3 + 4i`). And an imaginary part of Inf or NaN typed before the
// unit (`Infi`, `NaNi`, `1+Infi`), which is not MATLAB syntax (MATLAB's expression for
// complex(Inf,-Inf) is `Inf-1i*Inf`, and for complex(1,NaN) `1+1i*NaN`: mcos/*.truth.json)
// but is how this package shows such a part (`1+Infi`, `1NaNi`), so that a value shown can
// be typed back.
//
// MatlabValueParser read a complex literal as two decimals and an `i`, or one decimal and
// an `i`, so it refused all six of those, and an element of a complex array, which takes
// MatlabValueParser's complex values and the spellings XmlUtils.parseComplexNum reads
// (#82), refused them too: "Array elements must be scalar numbers". parseComplexNum reads
// the text a FILE holds, which is MATLAB's or this package's own and never these forms, so
// it is not changed; only typed text goes through the parser.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import MatlabValueParser from '../src/datamodel/parser/MatlabValueParser.js';
import { parseComplexNum } from '../src/datamodel/parser/XmlUtils.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const fixture = (name: string): ArrayBuffer => {
  const u8 = new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
};

// What is typed, and the complex number it is read as, [re, im]. Those with an Inf or NaN
// imaginary part before the unit (`Infi`, `-Infi`, `NaNi`, `Infj`, `1+Infi`, `1 - Infi`,
// `Inf-Infi`, `1+NaNi`, `NaN+NaNj`) are this package's spelling of such a part, not MATLAB
// syntax; the other twenty are MATLAB's, each read as MATLAB reads it.
const FORMS: [typed: string, re: number, im: number][] = [
  ['i', 0, 1],
  ['j', 0, 1],
  ['-i', 0, -1],
  ['+i', 0, 1],
  ['-j', 0, -1],
  ['Infi', 0, Infinity],
  ['-Infi', 0, -Infinity],
  ['NaNi', 0, NaN],
  ['Infj', 0, Infinity],
  ['1+2j', 1, 2],
  ['1-2j', 1, -2],
  ['2.5j', 0, 2.5],
  ['3 + 4i', 3, 4],
  ['3 - 4i', 3, -4],
  ['3 +4i', 3, 4],
  ['3+ 4i', 3, 4],
  ['3  -  4j', 3, -4],
  ['1+i', 1, 1],
  ['1 - i', 1, -1],
  ['-2-j', -2, -1],
  ['1+Infi', 1, Infinity],
  ['1 - Infi', 1, -Infinity],
  ['Inf-Infi', Infinity, -Infinity],
  ['-Inf+2i', -Infinity, 2],
  ['NaN+1i', NaN, 1],
  ['1+NaNi', 1, NaN],
  ['NaN+NaNj', NaN, NaN],
  ['Inf + i', Infinity, 1],
  ['1e3j', 0, 1000],
];

// The forms the parser read before, each read as before.
const BEFORE: [typed: string, value: string][] = [
  ['3+4i', '3+4i'],
  ['3-4i', '3-4i'],
  ['-2.5-0.5i', '-2.5-0.5i'],
  ['2i', '0+2i'],
  ['-2i', '0-2i'],
  ['.5i', '0+0.5i'],
  ['1e3i', '0+1000i'],
  ['1e-7+2e-8i', '1e-7+2e-8i'],
  ['-0+1i', '0+1i'],
  ['1-0i', '1+0i'],
  ['1e+3+2e-1i', '1000+0.2i'],
];

// Text MATLAB does not read as a complex number, and this package never shows one in, which
// stays refused.
const NOT_COMPLEX = ['ii', 'ij', 'ji', '1+2k', '1+', '+', 'i1', '1 2i', '1++2i', '3i4', 'I', 'J', 'Inf i', 'infi', 'nani', 'Infinityi', 'NaN i', '1 NaNi', '3 + 4 i', '- i', '1 + + 2i', '2*i', 'i*2'];

// The two spellings this package shows a complex value in that are not among the forms
// above, each with the number it shows: an imaginary NaN with no sign
// (XmlUtils.formatComplexNum's, `1NaNi`, which is how NaNi itself is shown, `0NaNi`), and an
// infinite part spelled `Infinity` (a text dictionary's MAT stream,
// SparseData.complexElement: `1+Infinityi`).
const SHOWN: [shown: string, re: number, im: number][] = [
  ['0NaNi', 0, NaN],
  ['1NaNi', 1, NaN],
  ['-2.5NaNi', -2.5, NaN],
  ['NaNNaNi', NaN, NaN],
  ['InfNaNi', Infinity, NaN],
  ['-InfNaNi', -Infinity, NaN],
  ['0+Infinityi', 0, Infinity],
  ['1+Infinityi', 1, Infinity],
  ['0-Infinityi', 0, -Infinity],
  ['Infinity-Infinityi', Infinity, -Infinity],
  ['-Infinity+2i', -Infinity, 2],
  ['InfinityNaNi', Infinity, NaN],
];

/** The two parts of a complex text, for comparison: Object.is, so NaN and -0 are exact. */
function partsOf(text: string): [number, number] {
  const pair = parseComplexNum(text);
  expect(pair, text).not.toBeNull();
  return [Number(pair!.re), Number(pair!.im)];
}

const sameParts = (text: string, re: number, im: number, label: string) => {
  const [a, b] = partsOf(text);
  expect([Object.is(a, re) || a === re, Object.is(b, im) || b === im], `${label}: ${text} is [${re}, ${im}]`).toEqual([true, true]);
};

/** One part as MATLAB writes it, for a test's title. */
const part = (x: number) => (Number.isNaN(x) ? 'NaN' : x === Infinity ? 'Inf' : x === -Infinity ? '-Inf' : String(x));

/** [re, im] for a test's title: each part as MATLAB writes a real number, and its sign. */
const spelled = (re: number, im: number): string => part(re) + (im < 0 ? '' : '+') + part(im) + 'i';

describe("MatlabValueParser reads MATLAB's complex forms, and the Inf and NaN forms this package shows a value in", () => {
  for (const [typed, re, im] of FORMS) {
    it(`${JSON.stringify(typed)} is ${spelled(re, im)}`, () => {
      const parsed = MatlabValueParser.parse(typed);
      expect(parsed?.type, typed).toBe('complex');
      sameParts(String(parsed!.value), re, im, typed);
    });
  }

  it('reads the forms it read before as it read them', () => {
    for (const [typed, value] of BEFORE) {
      expect(MatlabValueParser.parse(typed), typed).toEqual({ type: 'complex', value });
    }
  });

  it('spells an infinite or NaN part as formatComplexNum does, which every reader of complex text reads', () => {
    expect(MatlabValueParser.parse('Infi')).toEqual({ type: 'complex', value: '0+Infi' });
    expect(MatlabValueParser.parse('-Infi')).toEqual({ type: 'complex', value: '0-Infi' });
    expect(MatlabValueParser.parse('NaNi')).toEqual({ type: 'complex', value: '0NaNi' });
    expect(MatlabValueParser.parse('Inf-Infi')).toEqual({ type: 'complex', value: 'Inf-Infi' });
  });

  it('reads every value it makes, which is the text the value is shown in', () => {
    for (const [typed] of FORMS) {
      const made = MatlabValueParser.parse(typed)!.value as string;
      expect(MatlabValueParser.parse(made), `${typed}, shown as ${made}`).toEqual({ type: 'complex', value: made });
    }
  });

  for (const [shown, re, im] of SHOWN) {
    it(`reads ${JSON.stringify(shown)}, which is how this package shows complex(${part(re)}, ${part(im)})`, () => {
      const parsed = MatlabValueParser.parse(shown);
      expect(parsed?.type, shown).toBe('complex');
      sameParts(String(parsed!.value), re, im, shown);
    });
  }

  it('still refuses what is not a complex number', () => {
    for (const text of NOT_COMPLEX) {
      expect(MatlabValueParser.parse(text), text).toBeNull();
    }
  });

  it('reads a real number as it did', () => {
    expect(MatlabValueParser.parse('Inf')).toEqual({ type: 'double', value: Infinity });
    expect(MatlabValueParser.parse('-3')).toEqual({ type: 'double', value: -3 });
    expect(MatlabValueParser.parse('NaN')?.type).toBe('double');
  });

  it('reads a long run of digits in linear time', () => {
    // Every quantifier in the literal is bounded by what follows it, as the decimal's is
    // (`\d+(?:\.\d*)?`, see parseMatlabNumber): 100,000 digits and no `i` is one pass.
    const digits = '1'.repeat(100_000);
    const start = performance.now();
    expect(MatlabValueParser.parse(digits + '+' + digits + 'x')).toBeNull();
    expect(MatlabValueParser.parse(digits + ' ' + digits + 'i')).toBeNull();
    expect(MatlabValueParser.parse('+' + ' '.repeat(100_000) + 'x')).toBeNull();
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

// The complex element of a double array and of an int16 one, in a text and a binary
// dictionary MATLAB wrote.
const VENUES = [
  { file: 'mcos/complex.sldd', format: 'text' },
  { file: 'mcos/complex_binary.sldd', format: 'binary' },
];
const ELEMENTS = [
  { path: ['zRow', '1'], cls: 'double' },
  { path: ['pInt16Row', 'Value', '1'], cls: 'int16' },
];

function open(file: string, session = createSession()): any {
  return ingest(session, fixture(file), { filename: file.split('/').pop() });
}

function nodeAt(root: any, path: string[]): any {
  let node = root.getSection('design');
  for (const name of path) {
    node = node.children.find((c: any) => c.name === name);
    expect(node, path.join('/')).toBeDefined();
  }
  return node;
}

/** The complex number an int16 element holds for [re, im]: each part as MATLAB converts it. */
const int16 = (x: number): number => (Number.isNaN(x) ? 0 : Math.max(-32768, Math.min(32767, x < 0 ? -Math.round(-x) : Math.round(x))));

/** The body of the element a binary save writes for `name`'s Value. */
function savedBody(saved: { bytes: Uint8Array }, name: string): string {
  const xml = new TextDecoder().decode(unzipSync(saved.bytes)['data/chunk0.xml']);
  const at = xml.indexOf(`<P Name="Name" Class="char">${name}</P>`);
  expect(at, name).toBeGreaterThan(-1);
  const m = /<P Name="Value" Class="[^"]+" IsComplex="1"[^>]*>([^<]*)<\/P>/.exec(xml.slice(at));
  expect(m, name).not.toBeNull();
  return m![1];
}

describe('an element of a complex array takes each form, as the complex number it is read as', () => {
  for (const { file, format } of VENUES) {
    for (const { path, cls } of ELEMENTS) {
      it(`${file}: ${path.join('.')} (${cls})`, () => {
        if (format === 'text') {
          // A text dictionary holds the array as its MAT stream, which is shown and not edited
          // (the C-012 ruling, 2026-10-15).
          for (const [typed] of FORMS) {
            expect(nodeAt(open(file), path).setProperty('Value', typed), typed).toMatchObject({ error: true });
          }
          return;
        }
        for (const [typed, re, im] of FORMS) {
          const want: [number, number] = cls === 'int16' ? [int16(re), int16(im)] : [re, im];
          const session = createSession();
          const root = open(file, session);
          const el = nodeAt(root, path);
          const shown = el.displayValue;
          session.setActive(root, el);
          expect(session.editProperty(el.id, 'Value', typed), `${typed} into ${path.join('.')}`).toBe(true);
          sameParts(el.displayValue, want[0], want[1], typed);
          session.undo();
          expect(el.displayValue, `${typed}, undone`).toBe(shown);
          session.redo();
          sameParts(el.displayValue, want[0], want[1], `${typed}, redone`);
          const saved = session.serializeSource(root.name);
          if (format === 'text') {
            // A text dictionary holds the array as its MAT stream, which reopens as numbers.
            const reopened = ingest(createSession(), new TextEncoder().encode(saved.text).buffer as ArrayBuffer, { filename: root.name });
            sameParts(nodeAt(reopened, path).displayValue, want[0], want[1], `${typed}, reopened`);
          } else {
            // A binary dictionary holds it as complex text: the element's is what is written.
            const body = savedBody(saved, path[0]).split(' ');
            sameParts(body[0], want[0], want[1], `${typed}, saved`);
          }
        }
      });
    }
  }
});

// A value is set back to the text it shows by a commit of that text unchanged. So every
// complex value the parser takes has to be read again from the text it is shown in. (The undo
// of a later edit typed that text back in for a Parameter's Value too, until F1-16: it puts the
// Value back from the Parameter's own state now, as an entry's undo does, _restorerFor.)
// Read as the forms in FORMS alone, `NaNi` and `1+NaNi` are taken and shown as `0NaNi` and
// `1NaNi`, which are not among them: a commit of either as it shows fails with "Invalid
// MATLAB expression". A text dictionary holds the value as its MAT stream, which shows an
// infinite part as `Infinity` once the file is opened again (`1+Infinityi`), and that is
// refused the same way.
const NON_FINITE_TYPED: [typed: string, re: number, im: number][] = [
  ['NaNi', 0, NaN],
  ['1+NaNi', 1, NaN],
  ['1-NaNi', 1, NaN],
  ['NaN+NaNi', NaN, NaN],
  ['Infi', 0, Infinity],
  ['1+Infi', 1, Infinity],
  ['-Infi', 0, -Infinity],
  ['Inf-Infi', Infinity, -Infinity],
  ['NaN+Infi', NaN, Infinity],
];
// A scalar complex value: an entry, a Parameter's Value and the Value of a Parameter held in
// a cell.
const HOLDERS = [
  { path: ['z'], what: 'an entry' },
  { path: ['pScalar'], what: "a Parameter's Value" },
  { path: ['c', '1'], what: "the Value of a Parameter in a cell" },
];

/** What a save writes, opened again in a session of its own. */
function saveAndReopen(session: any, root: any, session2: any): any {
  const saved = session.serializeSource(root.name);
  const bytes: Uint8Array = saved.kind === 'binary' ? saved.bytes : new TextEncoder().encode(saved.text);
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return ingest(session2, ab, { filename: root.name });
}

describe('a complex value with an Inf or NaN part is set back by the text it shows', () => {
  for (const { file, format } of VENUES) {
    for (const { path, what } of HOLDERS) {
      it(`${file}: ${what} (${path.join('.')})`, () => {
        if (format === 'text') {
          // A text dictionary holds the value as its MAT stream, which is shown and not edited
          // (the C-012 ruling, 2026-10-15).
          for (const [typed] of NON_FINITE_TYPED) {
            expect(nodeAt(open(file), path).setProperty('Value', typed), typed).toMatchObject({ error: true });
          }
          return;
        }
        for (const [typed, re, im] of NON_FINITE_TYPED) {
          let session = createSession();
          let root = open(file, session);
          let node = nodeAt(root, path);
          const edit = (text: string) => {
            session.setActive(root, node);
            return session.editProperty(node.id, 'Value', text);
          };
          // Set back each way it can be, from the text it shows now.
          const setBack = (label: string) => {
            const shown = node.displayValue;
            sameParts(shown, re, im, label);
            expect(edit(shown), `${label}: ${shown}, committed as shown`).toBe(true);
            sameParts(node.displayValue, re, im, `${label}: ${shown}, committed as shown`);
            expect(edit('7'), label).toBe(true);
            session.undo();
            sameParts(node.displayValue, re, im, `${label}: 7, undone`);
          };
          expect(edit(typed), typed).toBe(true);
          setBack(typed);
          // The save writes what the undo put back, and the file opened again shows it in its
          // own spelling, which is set back the same way.
          const next = createSession();
          root = saveAndReopen(session, root, next);
          session = next;
          node = nodeAt(root, path);
          setBack(`${typed}, saved and reopened`);
          sameParts(nodeAt(saveAndReopen(session, root, createSession()), path).displayValue, re, im, `${typed}, saved twice`);
        }
      });
    }
  }
});
