// Copyright 2026 The MathWorks, Inc.
// The contract of the XML seam (src/datamodel/parser/XmlReader.ts).
//
// Every fact in here was already load-bearing before this file existed, and every one was
// recorded somewhere else — in a comment beside the assertion that happened to trip over
// it. `parseWarnings.test.ts` knows that plain text reads as the empty object and that an
// unclosed CDATA throws; `blockParamUsages.test.ts` knows that `<version>42</version>` is
// the NUMBER 42 and that `<X/>` is the empty string; `slddScan.test.ts` knows that
// `&amp;` is decoded. Each of those tests asserts something else and would have gone red
// for a reason it did not name.
//
// So this file asserts the engine's behaviour DIRECTLY, and that is its whole job. When
// the engine is swapped — the reason the seam exists — this is the file that says what
// changed, in one place, before three walkers start returning subtly different trees.
//
// TWO RULES IT FOLLOWS, both of which cost something:
//
//   * Expected values are LITERAL. Computing them from the engine would make every
//     assertion agree with the engine by construction, which is exactly the agreement a
//     swap needs to be able to break. They were taken from the engine once
//     (`.scratch/probe-xmlreader-expected.mjs`) and written down.
//   * A fact shared by all three readers is asserted THROUGH ALL THREE, in a loop. The
//     model and project readers share one parser today; asserting the model reader alone
//     would keep passing on the day someone gives one of them an option of its own.
//
// What is NOT pinned here is desirability. That an unclosed tag parses cleanly, or that
// `007` reads as 7, is not a behaviour this package chose — it is one the callers have to
// survive, and the notes in `XmlReader` say which of them survive it how.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readDictionaryXml,
  readModelXml,
  readProjectXml,
} from '../src/datamodel/parser/XmlReader.js';

const READERS: Array<[string, (text: string) => unknown]> = [
  ['dictionary', readDictionaryXml],
  ['model', readModelXml],
  ['project', readProjectXml],
];

/**
 * Asserts one fact through every reader. `Q` and `R` are deliberately outside the
 * dictionary's `isArray` list (`Object`, `P`, `Element`), so a shared fact can be stated
 * once without the array forcing showing up in the expected value and hiding it.
 */
function everyReader(xml: string, expected: unknown): void {
  for (const [name, read] of READERS) {
    expect(read(xml), name).toEqual(expected);
  }
}

describe('the shape every reader produces', () => {
  it('puts an attribute under `@_` and text under `#text`', () => {
    everyReader('<Q Name="v">x</Q>', { Q: { '@_Name': 'v', '#text': 'x' } });
  });

  it('collapses an element with only text to that text, with no `#text` key', () => {
    // Which is why every walker in the package tests `typeof node === 'object'` before
    // reaching for a child: half the elements in a real file are this shape.
    everyReader('<Q>x</Q>', { Q: 'x' });
  });

  it('coerces numeric-looking TEXT to a number', () => {
    // `blockParamUsages` sees this on `<version>42</version>` and every numeric block
    // parameter, and it is the reason the walkers stringify before they compare.
    everyReader('<Q>7</Q>', { Q: 7 });
  });

  it('does NOT coerce an attribute value', () => {
    // The asymmetry is the point: `Dimension="7"` stays a string while the same digit as
    // text does not, so a walker cannot assume one rule for both halves of an element.
    everyReader('<Q Dim="7"/>', { Q: { '@_Dim': '7' } });
  });

  it('loses the SPELLING of a number when it coerces', () => {
    // `007` and `1.0` are not `7` and `1` to MATLAB, and once the engine has answered
    // there is nothing left in the tree to recover the original spelling from. Anything
    // that must round-trip a literal exactly reads it from the bytes, not from here.
    everyReader('<Q>007</Q>', { Q: 7 });
    everyReader('<Q>1.0</Q>', { Q: 1 });
    // Hex too, which is easier to miss: the option is on by default, so a dictionary
    // value written `0x1F` reads as the decimal 31 and would save back that way.
    everyReader('<Q>0x1F</Q>', { Q: 31 });
  });

  it('leaves an integer too large for a double as a STRING', () => {
    // The one place the coercion protects itself, and it is worth knowing it is there:
    // 9007199254740993 cannot round-trip through a JS number, so it is not converted.
    // A UUID-sized integer in a dictionary survives exactly; a 15-digit one does not.
    everyReader('<Q>9007199254740993</Q>', { Q: '9007199254740993' });
  });

  it('coerces `true` and `false` to BOOLEANS, lowercase only', () => {
    // Not a number and not documented anywhere before this: the engine tests the trimmed
    // text against these two words before it tries `strnum`. So a `<P Name="Foo">true`
    // arrives as a boolean and stringifies as 'true' rather than as whatever the file
    // said — and `TRUE`, which MATLAB would not write but a hand-edited file might,
    // does not. Every walker that compares a parsed value to a string depends on which
    // of these two it got.
    everyReader('<Q>true</Q>', { Q: true });
    everyReader('<Q>false</Q>', { Q: false });
    everyReader('<Q>TRUE</Q>', { Q: 'TRUE' });
    everyReader('<Q>True</Q>', { Q: 'True' });
  });

  it('coerces none of it in an ATTRIBUTE value', () => {
    everyReader('<Q Flag="true"/>', { Q: { '@_Flag': 'true' } });
  });

  it('decodes a NAMED entity but leaves a numeric character reference alone', () => {
    // Both halves matter. The first is why `SlddScan` refuses a name containing an entity
    // rather than mirror a decoder it does not own; the second is why a `&#65;` reaching a
    // cell must still render flat, which `blockParamUsages` asserts from the other side.
    everyReader('<Q>a&amp;b&#65;</Q>', { Q: 'a&b&#65;' });
  });

  it('delivers CDATA as ordinary text, markup characters intact', () => {
    everyReader('<Q><![CDATA[a < b]]></Q>', { Q: 'a < b' });
  });

  it('reads an empty element as the empty STRING when it has no attributes', () => {
    everyReader('<R><Q/></R>', { R: { Q: '' } });
  });

  it('reads an empty element as an object with no `#text` when it HAS attributes', () => {
    // So "has attributes" and "has text" are independent questions, and the absence of
    // `#text` is not the absence of the element.
    everyReader('<R><Q Name="v"/></R>', { R: { Q: { '@_Name': 'v' } } });
  });

  it('keeps the XML declaration as a `?xml` key', () => {
    // Which is a key at the ROOT, beside the document element. Anything that decides a
    // part is empty by counting root keys is counting this one too: a part holding only a
    // declaration is not the empty object, so it passes that check and then fails to have
    // the element the caller wanted. All three callers test for the KEY they need for
    // exactly this reason.
    everyReader('<?xml version="1.0" encoding="UTF-8"?><Q>x</Q>', {
      '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
      Q: 'x',
    });
  });
});

describe('what a reader refuses, and what it lets through', () => {
  it('answers with the EMPTY OBJECT for input carrying no markup', () => {
    // The single most consequential fact in this file. It is the shape a truncated or
    // mis-encoded write takes, it is not a throw, and all three callers therefore test
    // for it explicitly and report it as a loss — `BinarySlddParser`'s DataSource check,
    // `SlxParser.readPart`, `ProjectParser.parseInfo`.
    everyReader('hello', {});
    everyReader('', {});
  });

  it('accepts an unclosed tag, dropping its text', () => {
    // Lenient, not strict: the attributes survive and the text does not, silently.
    everyReader('<Q Name="v">x', { Q: { '@_Name': 'v' } });
  });

  it('accepts a mismatched close tag', () => {
    everyReader('<Q Name="v">x</Z>', { Q: { '@_Name': 'v', '#text': 'x' } });
  });

  it('parses a document whose root is not the expected element', () => {
    // The failure that `source-unreadable` exists for. A wrong-root part parses CLEANLY,
    // so "it parsed" cannot mean "it is the document I asked for"; a caller has to test
    // for the key it needs, or it reports a healthy dictionary with zero entries.
    everyReader('<Nonsense><Q>x</Q></Nonsense>', { Nonsense: { Q: 'x' } });
  });

  it('throws on an unclosed CDATA', () => {
    // One of the few malformations it refuses outright, and the reason all three callers
    // wrap the parse in a try/catch: this throw used to escape and take the whole open
    // down, naming no file.
    for (const [name, read] of READERS) {
      expect(() => read('<Q><![CDATA[a < b</Q>'), name).toThrow(/CDATA/);
    }
  });
});

describe('what only the dictionary reader does', () => {
  it('forces `Object`, `P` and `Element` to arrays even when singular', () => {
    const xml = '<Root><Object><Element>a</Element></Object></Root>';
    expect(readDictionaryXml(xml)).toEqual({ Root: { Object: [{ Element: ['a'] }] } });
    // Without it, the SAME document hands back objects — which is the coercion the model
    // and project walkers carry by hand, in a dozen places each, and the dictionary
    // walker does not have to.
    expect(readModelXml(xml)).toEqual({ Root: { Object: { Element: 'a' } } });
    expect(readProjectXml(xml)).toEqual({ Root: { Object: { Element: 'a' } } });
  });

  it('makes a one-entry dictionary the same shape as a many-entry one', () => {
    // The reason the option is worth its cost. `P` is an array in both, so a walker never
    // has to ask how many there were.
    const one = readDictionaryXml('<Object><P Name="a">1</P></Object>') as any;
    const two = readDictionaryXml('<Object><P Name="a">1</P><P Name="b">2</P></Object>') as any;
    expect(Array.isArray(one.Object[0].P)).toBe(true);
    expect(one.Object[0].P).toHaveLength(1);
    expect(two.Object[0].P).toHaveLength(2);
  });

  it('keeps leading and trailing whitespace in TEXT', () => {
    // A dictionary's text is MATLAB's, where '  abc  ' is a different char array from
    // 'abc' and the in-place editor is seeded with whatever the file said. Trimming here
    // would edit the user's data on the way in.
    expect(readDictionaryXml('<Q>  abc  </Q>')).toEqual({ Q: '  abc  ' });
    expect(readDictionaryXml('<Q>\n  abc\n</Q>')).toEqual({ Q: '\n  abc\n' });
    expect(readModelXml('<Q>  abc  </Q>')).toEqual({ Q: 'abc' });
    expect(readProjectXml('<Q>  abc  </Q>')).toEqual({ Q: 'abc' });
  });

  it('keeps leading and trailing whitespace in an ATTRIBUTE value too', () => {
    // Not obvious from the option's name, and it reaches entry names: a dictionary that
    // says `Name="  Kp  "` has an entry called '  Kp  ', and renaming it has to write the
    // same padding back.
    expect(readDictionaryXml('<Q Name="  Kp  "/>')).toEqual({ Q: { '@_Name': '  Kp  ' } });
    expect(readModelXml('<Q Name="  Kp  "/>')).toEqual({ Q: { '@_Name': 'Kp' } });
    expect(readProjectXml('<Q Name="  Kp  "/>')).toEqual({ Q: { '@_Name': 'Kp' } });
  });

  it('stores no `#text` for the whitespace BETWEEN two tags, though it keeps every value', () => {
    // Trimming off would otherwise make the newline and indent of a pretty-printed parent
    // into text like any other — CONCATENATED across the gaps, so a one-child parent holds
    // two newlines. Found by deep-comparing the tree against an independently built one:
    // 204,373 of the differences were this, every one on a non-leaf element, 80.7 MB of
    // the 232.1 MB that parse retains. Nothing read them, so `dropLayoutWhitespace` stops
    // the engine producing them, and a pretty-printed parent now reads the same as one
    // written without the newlines.
    const pretty = readDictionaryXml('<Object>\n  <P Name="a">1</P>\n</Object>');
    expect(pretty).toEqual({ Object: [{ P: [{ '@_Name': 'a', '#text': 1 }] }] });
    expect(pretty).toEqual(readDictionaryXml('<Object><P Name="a">1</P></Object>'));
    // The KEY is gone, not emptied: a walker asking `'#text' in node` gets the same answer
    // as for a parent whose source had no whitespace in it.
    expect(Object.keys((pretty as any).Object[0])).toEqual(['P']);
    // The model reader trims first, is left with nothing, and adds no key either — it
    // arrives at the same shape by the other route.
    expect(readModelXml('<Object>\n  <P Name="a">1</P>\n</Object>')).toEqual({
      Object: { P: { '@_Name': 'a', '#text': 1 } },
    });
  });

  it('drops the whitespace beside markup in MIXED content, which is the one value it changes', () => {
    // The cost of the rule above, pinned rather than described. The engine calls the hook
    // once per text CHUNK, so an element holding BOTH text and children loses the
    // whitespace-only chunks next to the markup from a value that used to concatenate
    // them: this reads '\n  abc\n  ' where it once read '\n  abc\n  \n'.
    //
    // No character of real text is ever affected, and no dictionary in the corpus holds
    // this shape — 22 XML parts, 155 MB, 2.09 M elements, zero with both text and children
    // — because a property tree serializes an element as a value OR children. The corpus
    // cannot promise that about a file it has not seen, so the behaviour is written down
    // here: if a future format nests markup inside a value, this test is the one that has
    // to be argued with first.
    expect(readDictionaryXml('<P Name="v">\n  abc\n  <Element>x</Element>\n</P>')).toEqual({
      P: [{ '@_Name': 'v', '#text': '\n  abc\n  ', Element: ['x'] }],
    });
    // Text with no whitespace against the markup is untouched on both sides.
    expect(readDictionaryXml('<P Name="v">abc<Element>x</Element>def</P>')).toEqual({
      P: [{ '@_Name': 'v', '#text': 'abcdef', Element: ['x'] }],
    });
    // And whitespace that is MEANT survives beside markup if it is written as CDATA: the
    // engine hands CDATA to the hook as leaf text whatever its siblings are, so the rule
    // never sees it. Not a workaround anybody has needed — it is the evidence that the
    // rule keys on "the engine found this between two tags" and not on "this is spaces".
    expect(readDictionaryXml('<R>\n  <Q>a</Q>\n  <![CDATA[   ]]>\n</R>')).toEqual({
      R: { Q: 'a', '#text': '   ' },
    });
  });

  it('keeps a whitespace-only value, where the model reader empties it', () => {
    // The same rule at the leaf, and here it is fidelity rather than weight: three spaces
    // is a 1x3 char array in MATLAB and the empty string is a 0x0.
    expect(readDictionaryXml('<Q>   </Q>')).toEqual({ Q: '   ' });
    expect(readDictionaryXml('<Q Name="v">   </Q>')).toEqual({ Q: { '@_Name': 'v', '#text': '   ' } });
    expect(readModelXml('<Q>   </Q>')).toEqual({ Q: '' });
    expect(readModelXml('<Q Name="v">   </Q>')).toEqual({ Q: { '@_Name': 'v' } });
  });

  it('does not COERCE a padded value either, which the model reader does', () => {
    // A consequence of the flag rather than a second flag, and the more useful half of it.
    // With trimming off the engine returns any value that differs from its own trim RAW,
    // unparsed — so padding protects a dictionary value from every coercion above: ' 7 '
    // stays the three characters it was written as, and '  true  ' stays a string. The
    // model reader trims first and then coerces, so the same bytes become 7 and true.
    expect(readDictionaryXml('<Q> 7 </Q>')).toEqual({ Q: ' 7 ' });
    expect(readDictionaryXml('<Q>  true  </Q>')).toEqual({ Q: '  true  ' });
    expect(readModelXml('<Q> 7 </Q>')).toEqual({ Q: 7 });
    expect(readModelXml('<Q>  true  </Q>')).toEqual({ Q: true });
  });

  it('trims only the ENDS — interior whitespace survives everywhere', () => {
    // So a model part's multi-line block label keeps its newline, which is what
    // `blockLabel` flattens. Trimming is not normalization.
    everyReader('<Q>a\n  b</Q>', { Q: 'a\n  b' });
  });
});

describe('the seam', () => {
  it('is the only module in the package that imports the XML engine', () => {
    // Without this the seam is a suggestion. A second `new XMLParser(...)` somewhere else
    // in src/ would work perfectly, drift from these options by one flag, and be found by
    // whoever eventually swaps the engine — after they had already decided the swap was a
    // one-file change.
    const srcDir = fileURLToPath(new URL('../src', import.meta.url));
    const importers: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (name.endsWith('.ts')) {
          const text = readFileSync(full, 'utf8');
          if (/from\s+['"]fast-xml-parser['"]|require\(\s*['"]fast-xml-parser['"]/.test(text)) {
            importers.push(full.slice(srcDir.length + 1));
          }
        }
      }
    };
    walk(srcDir);
    expect(importers).toEqual(['datamodel/parser/XmlReader.ts']);
  });
});
