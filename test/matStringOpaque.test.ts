// Copyright 2026 The MathWorks, Inc.
//
// A MATLAB `string` out of a .mat file — its shape, its Data Type and its TEXT.
//
// A `string` array is ONE MCOS object however big it is (unlike a 1x3
// Simulink.Parameter, which is three), so the object handle a named variable carries
// says [1,1] for every case in this fixture. Both the extents and the characters are
// inside the object's own payload cell, reached through the type-1 property block — see
// test/parity/matlab/STRING_MCOS.md, which is where every expectation below comes
// from and which records how MATLAB was asked.
//
// The text assertions are made twice on purpose. Once against MATLAB's own text
// (`linear`), which is the answer a reader wants, and once against MATLAB's own CODE
// UNITS (`codes`), which is the answer that catches the failures text comparison can
// miss: a surrogate pair counted as one character, and the off-by-one-bit character an
// inexact 64-bit read produced (`"café"` came back as `"`afé"` — see STRING_MCOS.md,
// "The blocker"). Comparing code units is comparing what the packing actually says.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadFile, findEntry } from './parity/loadFile.js';

// MATLAB's own answers for every case in strings.mat: class, size, ismissing,
// strlength, the text, the code units — all flat and column-major.
const truth = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/strings_truth.json', import.meta.url)), 'utf8'),
);
// The Phase 2 corpus's own truth, for the two entries this defect was found on.
const corpus = JSON.parse(
  readFileSync(fileURLToPath(new URL('./parity/artifacts/truth.json', import.meta.url)), 'utf8'),
);
const root = loadFile('../fixtures/strings.mat');
const mixed = loadFile('../fixtures/strings_mixed.mat');

function entryNamed(name: string): any {
  return findEntry(root, name);
}

// MATLAB's text per element, column-major, with a `missing` as null — the shape the
// decoder produces. jsonencode flattens `missing` to "" in `linear`, so `ismissing` is
// the only channel that tells the two apart and it has to be consulted.
function truthElements(name: string): (string | null)[] {
  const t = truth[name];
  const linear: string[] = t.linear;
  const flags: boolean[] = Array.isArray(t.ismissing) ? t.ismissing : [t.ismissing];
  return linear.map((s, i) => (flags[i] ? null : s));
}

// MATLAB's code units per element. jsonencode collapses a cell of scalars into a flat
// array (s2x3's six one-character elements arrive as [97,100,98,...]), so a scalar entry
// is one element's single unit and has to be re-wrapped.
function truthCodes(name: string): number[][] {
  const codes: unknown[] = truth[name].codes;
  return codes.map((c) => (Array.isArray(c) ? (c as number[]) : [c as number]));
}

// The code units of a JS string, which is UTF-16 like MATLAB's own storage — so a
// non-BMP character is two units in both, and the counts line up without conversion.
function unitsOf(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
  return out;
}

// Every case MATLAB wrote, so a shape is asserted for each rank and each edge rather
// than for one representative. jsonencode gives `size` back as a plain array.
const CASES: string[] = Object.keys(truth);

describe('MAT string shape and type', () => {
  it('covers every case the probe wrote', () => {
    expect(CASES).toEqual([
      'sScalar',
      'sRow',
      's2x3',
      'sCol',
      'sNd',
      'sEmptyE',
      'sEmptyA',
      'sMissing',
      'sUnicode',
      'sLong',
      'sAstral',
    ]);
  });

  it('reports `string` as the Data Type, not as a blank Class column', () => {
    for (const name of CASES) {
      expect(truth[name].class).toBe('string');
      expect(entryNamed(name).dataType, name).toBe('string');
    }
  });

  it('reports the shape MATLAB reports, for every rank', () => {
    for (const name of CASES) {
      expect(entryNamed(name).dims, name).toEqual(truth[name].size);
    }
  });

  it('keeps a rank-3 string a rank-3 string', () => {
    // The one case where a two-extent reading would look plausible: 2x2x2 has the
    // same element count as a 4x2 and the same first two extents as a 2x2. It is also
    // the one case here that summarizes — rank >= 3 has no MATLAB literal at all — and
    // the summary has to carry all three extents, not the first two.
    expect(truth.sNd.size).toEqual([2, 2, 2]);
    expect(entryNamed('sNd').dims).toEqual([2, 2, 2]);
    expect(entryNamed('sNd').displayValue).toBe('<2x2x2 string>');
  });

  it('distinguishes a 0x0 string array from a 1x1 empty string', () => {
    expect(entryNamed('sEmptyA').dims).toEqual([0, 0]);
    expect(entryNamed('sEmptyE').dims).toEqual([1, 1]);
  });

  it('finds the payload of a string that is not the first object in the file', () => {
    // strings_mixed.mat is mix_order.mat: a Simulink.Parameter FIRST, then the
    // string. The string is object 4 and its payload is cells[9], because the
    // Parameter's seven property values were allocated on the heap ahead of it — so
    // `payload cell = objId + 1`, which fits every string-only file, is refuted here.
    // A reader built on that coincidence reads the Parameter's CoderInfo as text.
    expect(findEntry(mixed, 'mixStr').dataType).toBe('string');
    expect(findEntry(mixed, 'mixStr').dims).toEqual([1, 1]);
    // The control: the Parameter in the same file still decodes.
    expect(findEntry(mixed, 'mixParam').className).toBe('Simulink.Parameter');
  });

  it('fixes the corpus cases this was found on', () => {
    // strArray and strMat are the two entries in the Phase 2 corpus that reported
    // [1,1] with a blank Data Type. Asserted against the corpus's own truth.json, so
    // this is the same claim Phase 11's display suite will make, on the same bytes.
    const cases = loadFile('./artifacts/mat/cases.mat');
    for (const [name, size] of [
      ['strScalar', [1, 1]],
      ['strArray', [1, 3]],
      ['strMat', [2, 3]],
    ] as [string, number[]][]) {
      expect(corpus.vars[name].class, name).toBe('string');
      expect(corpus.vars[name].size, name).toEqual(size);
      const n = findEntry(cases, name);
      expect(n.dataType, name).toBe('string');
      expect(n.dims, name).toEqual(size);
    }
  });

  it('does not hijack the Data Type of an object that has a real one', () => {
    // A Simulink.Parameter routes to its own typed node, whose DataType column is
    // MATLAB's DataType property. Only an OPAQUE node's blank Class-name column is
    // what the `string` exemption replaces — see matlabVariableNode.test.ts for the
    // unit-level pair.
    expect(findEntry(mixed, 'mixParam').dataType).toBe('auto');
  });

  it('shows a string icon, not the default one', () => {
    // A string array out of a .sldd has always shown the string icon; out of a .mat it
    // showed the generic one, because the icon is keyed on the MCOS class name and
    // `string` — the one opaque class that is a data type — had no entry.
    for (const name of CASES) {
      expect(entryNamed(name).icon, name).toBe('wsString');
    }
  });
});

describe('MAT string text', () => {
  it('recovers MATLAB\'s own text for every element of every case', () => {
    for (const name of CASES) {
      expect(entryNamed(name).elements, name).toEqual(truthElements(name));
    }
  });

  it('recovers MATLAB\'s own code units, which is the stricter claim', () => {
    for (const name of CASES) {
      const got: (string | null)[] = entryNamed(name).elements;
      const want = truthCodes(name);
      expect(got.length, name).toBe(want.length);
      for (let i = 0; i < want.length; i++) {
        // A `missing` contributes no units; MATLAB's own codes entry for it is empty.
        expect(unitsOf(got[i] ?? ''), name + '[' + i + ']').toEqual(want[i]);
      }
    }
  });

  it('reads a non-BMP character as the surrogate PAIR it is stored as', () => {
    // "a😀b" is 3 characters and 4 code units, and MATLAB's own strlength says 4. The
    // count word is units, so a decoder that walked characters would take one unit too
    // few here and every later element in the file would start one unit early.
    expect(truth.sAstral.lengths).toBe(4);
    expect(truth.sAstral.linear[0]).toBe('a\u{1F600}b');
    expect(entryNamed('sAstral').elements).toEqual(['a\u{1F600}b']);
    expect(unitsOf(entryNamed('sAstral').elements[0])).toEqual([97, 55357, 56832, 98]);
  });

  it('reads text whose packed words a double cannot hold exactly', () => {
    // The regression that made the text half wait for Task 10.2. Every one of these was
    // wrong by one character — always the FIRST of a 4-unit group, because the rounding
    // lands in the low bits — while looking like plausible mojibake.
    expect(entryNamed('sRow').elements).toEqual(['alpha', 'beta', 'gamma']);
    expect(entryNamed('sUnicode').elements).toEqual(['café', 'naïve', '日本']);
    expect(entryNamed('sCol').elements).toEqual(['one', 'two']);
    expect(entryNamed('s2x3').elements).toEqual(['a', 'd', 'b', 'e', 'c', 'f']);
  });

  it('keeps the elements COLUMN-major, as MATLAB stores them', () => {
    // s2x3 is ["a" "b" "c"; "d" "e" "f"], so the payload order is a,d,b,e,c,f. Reading
    // it row-major would transpose the value silently — every element present, every
    // one in the wrong place, and the 2x3 shape unchanged to hide it.
    expect(truth.s2x3.linear).toEqual(['a', 'd', 'b', 'e', 'c', 'f']);
    expect(entryNamed('s2x3').elements).toEqual(['a', 'd', 'b', 'e', 'c', 'f']);
    expect(entryNamed('sNd').elements).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });

  it('labels the child rows with MATLAB subscripts, in payload order', () => {
    expect(entryNamed('sRow').children.map((c: any) => c.displayName)).toEqual([
      'sRow(1)',
      'sRow(2)',
      'sRow(3)',
    ]);
    expect(entryNamed('sRow').children.map((c: any) => c.displayValue)).toEqual([
      '"alpha"',
      '"beta"',
      '"gamma"',
    ]);
    // A matrix gets (row,col) pairs, and the FIRST subscript varies fastest — which is
    // what makes s2x3(2,1) the second row and "d" its value.
    expect(entryNamed('s2x3').children.map((c: any) => c.displayName)).toEqual([
      's2x3(1,1)',
      's2x3(2,1)',
      's2x3(1,2)',
      's2x3(2,2)',
      's2x3(1,3)',
      's2x3(2,3)',
    ]);
    expect(entryNamed('s2x3').children.map((c: any) => c.displayValue)).toEqual([
      '"a"',
      '"d"',
      '"b"',
      '"e"',
      '"c"',
      '"f"',
    ]);
    // Rank 3 summarizes in the cell, so the child rows are the ONLY place its eight
    // elements are visible — and their third subscript has to be right.
    expect(entryNamed('sNd').children.map((c: any) => c.displayName)).toEqual([
      'sNd(1,1,1)',
      'sNd(2,1,1)',
      'sNd(1,2,1)',
      'sNd(2,2,1)',
      'sNd(1,1,2)',
      'sNd(2,1,2)',
      'sNd(1,2,2)',
      'sNd(2,2,2)',
    ]);
  });

  it('displays a scalar as one quoted string and an array as a literal', () => {
    expect(entryNamed('sScalar').displayValue).toBe('"hello"');
    expect(entryNamed('sRow').displayValue).toBe('["alpha" "beta" "gamma"]');
    expect(entryNamed('sCol').displayValue).toBe('["one"; "two"]');
    expect(entryNamed('s2x3').displayValue).toBe('["a" "b" "c"; "d" "e" "f"]');
    expect(entryNamed('sUnicode').displayValue).toBe('["café" "naïve" "日本"]');
  });

  it('prints a `missing` as MATLAB does — unquoted, so it cannot read as text', () => {
    // MATLAB's own disp is `    <missing>    "x"`. Unquoted is the whole point: the
    // string whose four characters ARE "<missing>" still prints with its quotes, so the
    // display never conflates a value with the absence of one. It also means the cell
    // gets no editor, which is right — no text a user can type produces a `missing`.
    expect(truth.sMissing.disp).toBe('    <missing>    "x"\n');
    expect(truth.sMissing.ismissing).toEqual([true, false]);
    expect(entryNamed('sMissing').elements).toEqual([null, 'x']);
    expect(entryNamed('sMissing').displayValue).toBe('[<missing> "x"]');
    expect(entryNamed('sMissing').children.map((c: any) => c.displayValue)).toEqual([
      '<missing>',
      '"x"',
    ]);
  });

  it('tells the three kinds of empty apart', () => {
    // The distinction lives in the count word: 0 for "", all ones for a `missing`, and
    // no count words at all for strings(0,0) — which is why an "absent" reading of
    // `missing` would have collapsed all three into the same value.
    expect(entryNamed('sEmptyE').elements).toEqual(['']);
    expect(entryNamed('sEmptyE').displayValue).toBe('""');
    expect(entryNamed('sMissing').elements[0]).toBe(null);
    // A 0x0 has no elements at all, hence no child rows and the empty-value spelling
    // rather than the bare '[]' the literal loop would otherwise produce.
    expect(entryNamed('sEmptyA').elements).toEqual([]);
    expect(entryNamed('sEmptyA').children.length).toBe(0);
    expect(entryNamed('sEmptyA').displayValue).toBe('[ ]');
  });

  it('prints a long scalar string in full, under the char budget', () => {
    // 300 characters is well under SUMMARY_MAX_CHARS, and a scalar string has no child
    // row to expand — so summarizing it would hide the value with nowhere else to see it.
    expect(truth.sLong.lengths).toBe(300);
    expect(entryNamed('sLong').displayValue).toBe('"' + truth.sLong.linear[0] + '"');
  });

  it('decodes a string that is not the first object in the file', () => {
    // The shape half of this is asserted above; this is the TEXT half. If the payload
    // were found by `objId + 1`, mixStr would read out of the Parameter's own heap
    // slots — plausible-looking characters from the wrong cell.
    // probe_string.m line 55: mixStr = "after", saved AFTER a Simulink.Parameter(42).
    expect(findEntry(mixed, 'mixStr').elements).toEqual(['after']);
    expect(findEntry(mixed, 'mixStr').displayValue).toBe('"after"');
  });
});

describe('MAT/SLX string vs the dictionary formats', () => {
  // The parity claim Phase 9 exists to make: the SAME string, authored once in MATLAB
  // and saved four ways, reads back identically. Before the payload was decoded the two
  // MCOS channels showed `<1x3 string>` where the two dictionary channels showed the
  // text, so the format a user opened decided whether they could see their own value.
  const CHANNELS: [string, string][] = [
    ['mat', './artifacts/mat/cases.mat'],
    ['slx', './artifacts/slx/cases.slx'],
    ['text', './artifacts/text/cases.sldd'],
    ['binary', './artifacts/binary/cases.sldd'],
  ];
  const ENTRIES = ['strScalar', 'strArray', 'strMat'];

  it('shows the same value, shape, type and icon in all four formats', () => {
    const seen: Record<string, Record<string, unknown>[]> = {};
    for (const [channel, rel] of CHANNELS) {
      const loaded = loadFile(rel);
      seen[channel] = ENTRIES.map((name) => {
        const n = findEntry(loaded, name);
        return {
          displayValue: n.displayValue,
          dims: n.dims,
          dataType: n.dataType,
          icon: n.icon,
          children: n.children.map((c: any) => [c.displayName, c.displayValue]),
        };
      });
    }
    for (const [channel] of CHANNELS.slice(1)) {
      expect(seen[channel], channel + ' vs mat').toEqual(seen.mat);
    }
  });

  it('matches the corpus truth MATLAB wrote, not just itself', () => {
    // Four channels agreeing on a wrong answer is still wrong. truth.json is MATLAB's
    // own class/size, and `disp` is its own printed text.
    const cases = loadFile('./artifacts/mat/cases.mat');
    for (const [name, size, elements] of [
      ['strScalar', [1, 1], ['world']],
      ['strArray', [1, 3], ['a', 'bb', 'ccc']],
      ['strMat', [2, 3], ['a', 'd', 'bb', 'ee', 'ccc', 'fff']],
    ] as [string, number[], string[]][]) {
      expect(corpus.vars[name].class, name).toBe('string');
      expect(corpus.vars[name].size, name).toEqual(size);
      const n = findEntry(cases, name);
      expect(n.dims, name).toEqual(size);
      expect(n.elements, name).toEqual(elements);
    }
  });
});

describe('a decoded MCOS string stays read-only', () => {
  // Nothing in this package writes a .mat MCOS subsystem: an opaque variable's own bytes
  // go back out verbatim. So a decoded string is a value you can now READ, and an edit
  // committed against it would update the node and change nothing in the file — the
  // node and the bytes disagreeing is worse than not offering the edit.
  //
  // A decoded string is also the first opaque node to have CHILD rows and to display
  // ordinary editable-looking text, so it is the first one for which these gates matter.
  it('offers no editor, on the array or on its elements', () => {
    for (const name of CASES) {
      const n = entryNamed(name);
      expect(n.valueEditable, name).toBe(false);
      for (const c of n.children) {
        expect(c.valueEditable, name + '/' + c.name).toBe(false);
      }
    }
  });

  it('offers no Add Child or Remove Child, even on a vector', () => {
    // The shape gate alone would have allowed both on sRow and sCol: a 1xN string is a
    // vector, which is exactly the case Add Child exists for on the dictionary path.
    for (const name of CASES) {
      const n = entryNamed(name);
      expect(n.canAddChild(), name).toBe(false);
      expect(n.canRemoveChild(), name).toBe(false);
    }
  });

  it('refuses a Value set on an element rather than accepting it silently', () => {
    const child = entryNamed('sRow').children[0];
    const result = child.setProperty('Value', '"zulu"');
    expect(result).toMatchObject({ error: true, invalidValue: '"zulu"', validValue: '"alpha"' });
    // And the value did not move.
    expect(entryNamed('sRow').elements).toEqual(['alpha', 'beta', 'gamma']);
    expect(child.displayValue).toBe('"alpha"');
  });

  it('hands the variable back byte-for-byte, so an untouched file round-trips', () => {
    // The hazard the read-only gates exist to prevent, stated as an assertion: if a
    // string node ever became editable, `_var` would stop returning the MCOS variable
    // and _buildVarObject would emit a `char` beside the file's own stale payload.
    const n: any = entryNamed('sRow');
    expect(n._isOpaque).toBe(true);
    expect(n._var).toBe(n._matVar);
    expect(n._var.className).toBe('string');
    expect(n._var.isOpaque).toBe(true);
  });
});

describe('the -v7 .mat flavour', () => {
  // A scalar, a vector and a matrix, saved with -v7 instead of the default (the three
  // probe_string.m line 77 writes). One decoder has to cover both flavours, and
  // STRING_MCOS.md's claim that it does was made from a raw dump — this is the same claim
  // made through the reader, which also has to inflate the miCOMPRESSED wrapper -v7 puts
  // every variable in. (-v7.3 is HDF5, a container MatParser does not read at all: its
  // fixture is test/fixtures/strings_v73.mat, and the only thing asserted about it is
  // the refusal, in test/matParser.test.ts.)
  const v7 = loadFile('../fixtures/strings_v7.mat');

  it('decodes each case identically to the default flavour', () => {
    for (const name of ['sScalar', 'sRow', 's2x3']) {
      const n = findEntry(v7, name);
      expect(n.dims, name).toEqual(truth[name].size);
      expect(n.elements, name).toEqual(truthElements(name));
      expect(n.displayValue, name).toBe(entryNamed(name).displayValue);
    }
  });
});

describe('a string held as an object PROPERTY', () => {
  // The other end of the same decoder. A `string` property is its own MCOS object with
  // its own payload cell, reached exactly as a named variable's is, and every one of
  // these four rows read '<not available>' before it was decoded.
  //
  // Only a user-written class gets here: assigning a string to a Simulink class's
  // property converts it to a char (STRING_MCOS.md, "What is NOT reachable"), so
  // object_props.mat — two hand-authored classes, Vehicle and Fleet — is the corpus's
  // only artifact that exercises the path.
  const objects = loadFile('../fixtures/mcos/object_props.mat');

  it('shows the text, the Data Type and the string icon on a property row', () => {
    for (const [name, text] of [
      ['Name', 'Model-X'],
      ['FleetName', 'east'],
      // Nested one object deeper: Vehicle.Engine.Label and Fleet.Lead.Location.
      ['Label', 'V8'],
      ['Location', 'Boston'],
    ] as [string, string][]) {
      const n = findEntry(objects, name);
      expect(n.displayValue, name).toBe('"' + text + '"');
      expect(n.dataType, name).toBe('string');
      expect(n.icon, name).toBe('wsString');
    }
  });

  it('leaves the char properties beside them chars', () => {
    // The distinction the sentinel used to blur: `color` really is a char in MATLAB and
    // prints single-quoted, so a decoder that turned every text-ish property into a
    // string would be wrong in the other direction.
    expect(findEntry(objects, 'color').displayValue).toBe("'blue'");
    expect(findEntry(objects, 'color').dataType).toBe('char');
  });
});

describe('a string nested in a struct or a cell', () => {
  // A KNOWN GAP, pinned rather than fixed. A string that is a struct field or a cell
  // element does not arrive through the named-variable path at all: it is an opaque
  // MatVariable built by MatlabVariableNode._createOpaque, and decodeMcosObjects only
  // ever sees variables that have a NAME. So it presents as a summary.
  //
  // This is not string-specific — a nested Simulink.Parameter presents as a summary with
  // no property rows in the same file, for the same reason. Closing it means threading
  // the blob down into the nested constructors (and making MatParser's cell branch set
  // _rawBytes at all, which today only its struct branch does). Recorded in
  // test/parity/matlab/DESIGN.md; this test says what today's answer is, so a change to
  // it is a deliberate one.
  const nested = loadFile('../fixtures/strings_nested.mat');

  it('shows the shape and the type but not the text', () => {
    const field = findEntry(nested, 's');
    expect(field.dataType).toBe('string');
    expect(field.icon).toBe('wsString');
    expect(field.displayValue).toBe('<1x1 string>');

    const cellEl = findEntry(nested, 'mixCell').children[1];
    expect(cellEl.dataType).toBe('string');
    expect(cellEl.displayValue).toBe('<1x1 string>');
  });

  it('shows the same for a nested Simulink object, which is why this is not a string bug', () => {
    expect(findEntry(nested, 'p').className).toBe('Simulink.Parameter');
    expect(findEntry(nested, 'p').displayValue).toBe('<1x1 Simulink.Parameter>');
    expect(findEntry(nested, 'p').children.length).toBe(0);
  });
});
