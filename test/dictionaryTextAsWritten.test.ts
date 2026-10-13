// Copyright 2026 The MathWorks, Inc.
//
// A compressed-binary dictionary's text, as MATLAB wrote it.
//
// The dictionary XML reader used to turn every element's text that LOOKED like a number into
// a JavaScript number before `BinarySlddParser` had read the element's Class, and
// `getTextContent` then turned that number back into a string with `String()`. So a char
// whose text happened to look numeric came back in JavaScript's spelling of the number:
// '0.0' as '0', '1e-3' as '0.001', '2.384185791015625e-07' as '2.384185791015625e-7' — on
// screen, in the model, and in every save, because the writer writes what the model holds.
// The same `String()` gave `-0` back as '0', so a double MATLAB wrote as -0.0 was held as
// +0. Across the local corpus that was 193 char bodies (166 in distinct files) and 6 scalar
// -0 values; the reader is the only layer that knows the Class, so it is the only layer that
// can convert the text, and it now does.
//
// The second half is the carriage return. MATLAB writes a CR inside a char as `&#xD;`, and the
// reader handed the five characters `&#xD;` to the model, which showed them and then wrote
// `&amp;#xD;`. XML requires a reader to decode a numeric character reference, and both engines
// now do; the writer in turn has to write a CR back as `&#xD;`, because any XML reader turns a
// raw CR into a LF.
//
// The hosts are MATLAB's own fixtures, with entries added in MATLAB's spelling where the
// fixtures hold no such value.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession, ingest } from '../src/index.js';
import { escapeXml } from '../src/datamodel/parser/XmlUtils.js';
import { flatten } from './parity/loadFile.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const bytesAt = (rel: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(rel, import.meta.url))));
const chunkOf = (zip: Uint8Array) => strFromU8(unzipSync(zip)['data/chunk0.xml']);
const buffer = (u8: Uint8Array) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

const HOST = './fixtures/char_binary.sldd';

/** One DD.ENTRY in MATLAB's layout, holding `value` (one or more lines) as its Value. */
function entryXml(name: string, k: number, value: string, lastModBy = 'weiwang'): string {
  return (
    '    <Object Class="DD.ENTRY">\n' +
    '        <P Name="Name" Class="char">' + name + '</P>\n' +
    '        <P Name="UUID" Class="char">00000000-0000-4000-8000-0000000001' + String(k).padStart(2, '0') + '</P>\n' +
    '        <P Name="Namespace" Class="char">dacaf35e-55a5-454d-a7c1-93db038a210e</P>\n' +
    '        <P Name="LastMod" Class="char">20260917T175257.039945</P>\n' +
    '        <P Name="LastModBy" Class="char">' + lastModBy + '</P>\n' +
    '        <P Name="IsDerived" Class="char">0</P>\n' +
    '        ' + value + '\n' +
    '    </Object>\n'
  );
}

/** The host's chunk with `entries` added before its DD.Dictionary object. */
function chunkWith(entries: string[]): string {
  const xml = chunkOf(bytesAt(HOST));
  const tail = '    <Object Class="DD.Dictionary">';
  expect(xml).toContain(tail);
  return xml.replace(tail, entries.join('') + tail);
}

function open(host: string, chunk: string, filename: string): { session: ReturnType<typeof createSession>; root: any } {
  const files = unzipSync(bytesAt(host));
  files['data/chunk0.xml'] = strToU8(chunk);
  const session = createSession();
  const root: any = ingest(session, buffer(zipSync(files)), { filename });
  return { session, root };
}

const entryOf = (root: any, name: string) => flatten(root).find((n: any) => n?.isEntry && n.name === name);
const childOf = (node: any, name: string) => flatten(node).find((n: any) => n !== node && n.name === name);
const saveOf = (o: { session: any; root: any }) => chunkOf(o.session.serializeSource(o.root.name)!.bytes!);
/** The saved fragment of one entry, from its Name line to its closing tag. */
function savedEntry(saved: string, name: string): string {
  const at = saved.indexOf('<P Name="Name" Class="char">' + name + '</P>');
  expect(at, name).toBeGreaterThanOrEqual(0);
  return saved.slice(at, saved.indexOf('</Object>', at));
}

// Every spelling the old coercion changed, or could have: the eight the corpus holds most
// often, and the ones its grammar also took (leading zeros, hex, a signed zero, a boolean word).
// The two boolean words came back as the same text before too (`String(true)` is 'true'), so
// they guard the branch that made them booleans rather than witness a loss.
const SPELLINGS = [
  '0.0',
  '10.0',
  '1e-3',
  '2.384185791015625e-07',
  '9.918212890625e-05',
  '1.8626451492309570312e-09',
  '1.0E+6',
  '007',
  '0x1F',
  '-0',
  '-0.0',
  '+7',
  '.5',
  'true',
  'false',
];

describe('a char that looks like a number is held, shown and written as MATLAB wrote it', () => {
  const entries = SPELLINGS.map((s, k) => entryXml('c' + k, k, '<P Name="Value" Class="char">' + s + '</P>'));

  for (const [k, s] of SPELLINGS.entries()) {
    it(`an entry's char ${JSON.stringify(s)}`, () => {
      const o = open(HOST, chunkWith(entries), 'char_binary.sldd');
      const n = entryOf(o.root, 'c' + k);
      expect([n._kind, n._scalarType]).toEqual(['scalar', 'char']);
      expect(n._scalarValue).toBe(s);
      expect(n.displayValue).toBe("'" + s + "'");
      expect(savedEntry(saveOf(o), 'c' + k)).toContain('<P Name="Value" Class="char">' + s + '</P>');
    });
  }

  it('an object property, and the number beside it keeps its value', () => {
    // The shape the corpus's respelled chars actually sit in: 191 of its 193 are object
    // properties or struct fields, and a Simulink.Signal's InitialValue is the visible one.
    const signal =
      '<P Name="Value">\n' +
      '            <Element Class="Simulink.Signal">\n' +
      '                <P Name="Dimensions" Class="double">1.0</P>\n' +
      '                <P Name="InitialValue" Class="char">2.384185791015625e-07</P>\n' +
      '                <P Name="Description" Class="char">0.0</P>\n' +
      '                <P Name="DataType" Class="char">auto</P>\n' +
      '                <P Name="Min" Class="double">1.0E-5</P>\n' +
      '                <P Name="Max" Class="double">10.0</P>\n' +
      '                <P Name="DocUnits" Class="char">1e-3</P>\n' +
      '            </Element>\n' +
      '        </P>';
    const o = open(HOST, chunkWith([entryXml('sig', 0, signal)]), 'char_binary.sldd');
    const sig = entryOf(o.root, 'sig');
    // The Property Inspector is where a user sees it.
    const pi = sig.toPIObject().objects[0];
    expect(pi.initialValue).toBe('2.384185791015625e-07');
    expect(pi.Description).toBe('0.0');
    expect(pi.Unit).toBe('1e-3');
    expect(sig.serial._properties.Min).toBe(1e-5);
    expect(sig.serial._properties.Max).toBe(10);
    const saved = savedEntry(saveOf(o), 'sig');
    expect(saved).toContain('<P Name="InitialValue" Class="char">2.384185791015625e-07</P>');
    expect(saved).toContain('<P Name="Description" Class="char">0.0</P>');
    expect(saved).toContain('<P Name="DocUnits" Class="char">1e-3</P>');
  });

  it('a struct field, a cell element and a string', () => {
    const struct =
      '<P Name="Value" Class="struct">\n' +
      '            <Element>\n' +
      '                <P Name="tol" Class="char">1e-3</P>\n' +
      '                <P Name="gain" Class="double">2.0</P>\n' +
      '            </Element>\n' +
      '        </P>';
    const cell =
      '<P Name="Value" Class="cell" Dimension="1*3">\n' +
      '            <Element Class="char">0.0</Element>\n' +
      '            <Element Class="char">0</Element>\n' +
      '            <Element Class="char">5.0</Element>\n' +
      '        </P>';
    const string =
      '<P Name="Value">\n' +
      '            <Element Class="string">\n' +
      '                <P Source="saveobj" PropertyType="any" Class="cell">\n' +
      '                    <Element Class="char">007</Element>\n' +
      '                </P>\n' +
      '            </Element>\n' +
      '        </P>';
    const o = open(HOST, chunkWith([entryXml('st', 0, struct), entryXml('ce', 1, cell), entryXml('sg', 2, string)]), 'char_binary.sldd');
    expect(childOf(entryOf(o.root, 'st'), 'tol')._scalarValue).toBe('1e-3');
    expect(childOf(entryOf(o.root, 'st'), 'gain')._scalarValue).toBe(2);
    expect(entryOf(o.root, 'ce').children.map((c: any) => c._scalarValue)).toEqual(['0.0', '0', '5.0']);
    expect([entryOf(o.root, 'sg')._kind, entryOf(o.root, 'sg')._elements]).toEqual(['string', ['007']]);
    const saved = saveOf(o);
    expect(savedEntry(saved, 'st')).toContain('<P Name="tol" Class="char">1e-3</P>');
    const cells = savedEntry(saved, 'ce');
    expect(cells).toContain('<Element Class="char">0.0</Element>');
    expect(cells).toContain('<Element Class="char">0</Element>');
    expect(cells).toContain('<Element Class="char">5.0</Element>');
    expect(savedEntry(saved, 'sg')).toContain('<Element Class="char">007</Element>');
  });

  it('an entry header field', () => {
    // LastModBy is a user name, and a user name can be digits.
    const o = open(HOST, chunkWith([entryXml('who', 0, '<P Name="Value" Class="double">1.0</P>', '007')]), 'char_binary.sldd');
    expect(entryOf(o.root, 'who').metadata.lastModifiedBy).toBe('007');
    expect(savedEntry(saveOf(o), 'who')).toContain('<P Name="LastModBy" Class="char">007</P>');
  });
});

describe('a body the coercion took for a number keeps its shape and its digits', () => {
  // Neither shape is in the corpus. Both show that the loss happened in the reader, below every
  // class: a char matrix and an encoded stream were damaged by it as much as a scalar char was.

  it('a char matrix whose text looks like a number keeps its characters and its Dimension', () => {
    // '0.00' was the number 0, so a 2x2 char held one '0' and three holes, was shown as '0',
    // and was saved as a 1x1 char: `<P Name="Value" Class="char">0</P>`.
    const o = open(HOST, chunkWith([entryXml('shaped', 0, '<P Name="Value" Class="char" Dimension="2*2">0.00</P>')]), 'char_binary.sldd');
    const n = entryOf(o.root, 'shaped');
    expect(n._dims).toEqual([2, 2]);
    expect(n.displayValue).toBe("['00'; '.0']");
    expect(n.serialize().value).toEqual({ _type: 'mxchar', _value: 'Matrix(2,2)\n[[48, 48]; [46, 48]]' });
    expect(savedEntry(saveOf(o), 'shaped')).toContain('<P Name="Value" Class="char" Dimension="2*2">0.00</P>');
  });

  it('an encoded stream that is all digits keeps its leading zeros', () => {
    // '00010203' was the number 10203, so the stream lost its first three hex digits in the
    // model and in the save, and no longer matched its EncodedLength.
    const value = '<P Name="Value" Class="double" Encoding="hex" EncodedLength="4">00010203</P>';
    const o = open(HOST, chunkWith([entryXml('hexDigits', 0, value)]), 'char_binary.sldd');
    expect(entryOf(o.root, 'hexDigits').serialize().value).toEqual({
      _type: 'encoded',
      _attrs: { Class: 'double', Encoding: 'hex', EncodedLength: '4' },
      _value: '00010203',
    });
    expect(savedEntry(saveOf(o), 'hexDigits')).toContain(value);
  });
});

describe('a number is still read by its class, and now keeps the sign of zero', () => {
  it('an entry double of -0.0 is held as -0 and shown as 0, as MATLAB shows it', () => {
    const o = open(HOST, chunkWith([entryXml('negZero', 0, '<P Name="Value" Class="double">-0.0</P>')]), 'char_binary.sldd');
    const n = entryOf(o.root, 'negZero');
    expect(Object.is(n._scalarValue, -0)).toBe(true);
    expect(Object.is(n.serialize().value, -0)).toBe(true);
    expect(n.displayValue).toBe('0');
  });

  it('a property of -0.0 is held as -0', () => {
    const signal =
      '<P Name="Value">\n' +
      '            <Element Class="Simulink.Signal">\n' +
      '                <P Name="Min" Class="double">-0.0</P>\n' +
      '                <P Name="Max" Class="double">1.0</P>\n' +
      '            </Element>\n' +
      '        </P>';
    const o = open(HOST, chunkWith([entryXml('sigZero', 0, signal)]), 'char_binary.sldd');
    const sig = entryOf(o.root, 'sigZero');
    expect(Object.is(sig.serial._properties.Min, -0)).toBe(true);
    expect(Object.is(sig.serialize().value._elements[0]._properties.Min, -0)).toBe(true);
    expect(Object.is(sig.serial._properties.Max, 1)).toBe(true);
  });

  it('every other numeric spelling MATLAB writes reads to the value it read to before', () => {
    // The classes the reader parses for itself, at the spellings MATLAB uses for each. The
    // conversion moved out of the XML layer, so these are the values the reader's own parsers
    // give; they are the values the coercion used to give too, which makes this a guard that
    // passes on either side of the change rather than a witness of it.
    const cases: [string, string, unknown][] = [
      ['d1', '<P Name="Value" Class="double">1.0E+6</P>', 1e6],
      ['d2', '<P Name="Value" Class="double">3.1415926535897931</P>', 3.141592653589793],
      ['d3', '<P Name="Value" Class="double">Inf</P>', Infinity],
      ['d4', '<P Name="Value" Class="double">NaN</P>', NaN],
      ['d5', '<P Name="Value" Class="double">-1.5</P>', -1.5],
      ['b1', '<P Name="Value" Class="logical">1</P>', true],
      ['b0', '<P Name="Value" Class="logical">0</P>', false],
    ];
    const o = open(HOST, chunkWith(cases.map(([name, xml], k) => entryXml(name, k, xml))), 'char_binary.sldd');
    for (const [name, , value] of cases) {
      expect(entryOf(o.root, name)._scalarValue, name).toBe(value);
    }
    const typed: [string, string, string][] = [
      ['i16', '<P Name="Value" Class="int16">-7</P>', '-7'],
      ['u8', '<P Name="Value" Class="uint8">200</P>', '200'],
      ['u64', '<P Name="Value" Class="uint64">18446744073709551615</P>', '18446744073709551615'],
      ['s1', '<P Name="Value" Class="single">0.5</P>', '0.5'],
    ];
    const t = open(HOST, chunkWith(typed.map(([name, xml], k) => entryXml(name, k, xml))), 'char_binary.sldd');
    for (const [name, , shown] of typed) {
      expect(entryOf(t.root, name).displayValue, name).toBe(shown);
    }
  });
});

describe('a carriage return MATLAB wrote as &#xD; is a carriage return', () => {
  it('at entry level: held and shown as a CR, and written back as &#xD;', () => {
    const o = open(
      HOST,
      chunkWith([
        entryXml('varStrCR', 0, '<P Name="Value" Class="char">&#xD;</P>'),
        entryXml('varStrCRLF', 1, '<P Name="Value" Class="char">A\nB&#xD;C\n&#xD;D&#xD;\nE&#xD;&#xD;F</P>'),
      ]),
      'char_binary.sldd',
    );
    const cr = entryOf(o.root, 'varStrCR');
    expect(cr._scalarValue).toBe('\r');
    expect(cr.displayValue).toBe("'\r'");
    const crlf = entryOf(o.root, 'varStrCRLF');
    expect(crlf._scalarValue).toBe('A\nB\rC\n\rD\r\nE\r\rF');
    const saved = saveOf(o);
    expect(savedEntry(saved, 'varStrCR')).toContain('<P Name="Value" Class="char">&#xD;</P>');
    expect(savedEntry(saved, 'varStrCRLF')).toContain('<P Name="Value" Class="char">A\nB&#xD;C\n&#xD;D&#xD;\nE&#xD;&#xD;F</P>');
    expect(saved).not.toContain('&amp;#xD;');
  });

  it('in an object property of a MATLAB-written fixture (custom_object_binary.sldd widget.Cr)', () => {
    const host = './fixtures/custom_object_binary.sldd';
    const chunk = chunkOf(bytesAt(host));
    expect(chunk).toContain('<P Name="Cr" Class="char">a&#xD;b</P>');
    const o = open(host, chunk, 'custom_object_binary.sldd');
    const widget = entryOf(o.root, 'widget');
    const cr = widget.children.find((c: any) => c.name === 'Cr');
    expect(cr._scalarValue).toBe('a\rb');
    expect(cr.displayValue).toBe("'a\rb'");
    // Another property edited, so the entry is written from the model whatever a save does
    // with an untouched one.
    expect(widget.children.find((c: any) => c.name === 'Scalar').setProperty('Value', '2.5')).toBe(true);
    const saved = saveOf(o);
    expect(saved).toContain('<P Name="Cr" Class="char">a&#xD;b</P>');
    expect(saved).not.toContain('&amp;#xD;');
  });

  it('a renamed entry holding one is written with &#xD; too', () => {
    const o = open(HOST, chunkWith([entryXml('withCr', 0, '<P Name="Value" Class="char">a&#xD;b</P>')]), 'char_binary.sldd');
    expect(entryOf(o.root, 'withCr').setProperty('Name', 'withCr2')).toBe(true);
    expect(savedEntry(saveOf(o), 'withCr2')).toContain('<P Name="Value" Class="char">a&#xD;b</P>');
  });

  it('other numeric references decode to their characters as well', () => {
    const o = open(HOST, chunkWith([entryXml('refs', 0, '<P Name="Value" Class="char">&#65;&#x42;&#X43;&#x1F600;</P>')]), 'char_binary.sldd');
    expect(entryOf(o.root, 'refs')._scalarValue).toBe('ABC\u{1F600}');
  });

  it('a raw CR in the bytes is still a LF, which is what XML says it is', () => {
    // The reason MATLAB writes `&#xD;` at all: XML 1.0 §2.11 has a reader present a literal
    // CR, or a CRLF, as one LF. Decoding the reference does not change that, so this passed
    // before the change as well; it guards against the decoder taking over line ends.
    const o = open(HOST, chunkWith([entryXml('rawCr', 0, '<P Name="Value" Class="char">a\r\nb\rc</P>')]), 'char_binary.sldd');
    expect(entryOf(o.root, 'rawCr')._scalarValue).toBe('a\nb\nc');
  });
});

describe('escapeXml', () => {
  it('writes a CR as &#xD;, and the four characters it already escaped as before', () => {
    expect(escapeXml('a\rb')).toBe('a&#xD;b');
    expect(escapeXml('\r\n')).toBe('&#xD;\n');
    expect(escapeXml('& < > "')).toBe('&amp; &lt; &gt; &quot;');
    expect(escapeXml('&#xD;')).toBe('&amp;#xD;');
    expect(escapeXml("a\tb\nc'")).toBe("a\tb\nc'");
  });
});
