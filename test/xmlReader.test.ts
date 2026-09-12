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

  it('loses a leading zero when it coerces', () => {
    // `007` is not 7 to MATLAB, and once the engine has answered there is nothing left in
    // the tree to recover the original spelling from. Anything that must round-trip a
    // literal exactly reads it from the bytes, not from here.
    everyReader('<Q>007</Q>', { Q: 7 });
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
