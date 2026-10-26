// Copyright 2026 The MathWorks, Inc.
//
// A value typed into a MAT-file that holds strings inside it, `{"a"}`, `{1, "a"}`, `{{"a"}}`,
// `{["a" "b"]}`, is taken and saved as MATLAB saves the same assignment: over a variable whose
// row offers a Value editor, a struct field or a cell element, at any depth, in a file with no
// objects, one with others, and one holding strings already.
//
// A MAT-file holds a string only as an object of its subsystem, so such a value was refused
// ("would hold a string, which this package cannot write into a MAT-file"), though a string typed
// in alone was taken (matRetypeString, matStringMember.test.ts) and a dictionary takes the same
// text. Now the retype puts a plain value in place of the one typed over, as it does for a value
// typed over a string (MatNode._retype), and makes each string it holds the object a member typed
// as a string is (_makeStringsIn: MATLAB's default string merged into the file's subsystem, set to
// the text), in its place in the cell. The save writes the cells fresh and each string as the
// class-17 element naming it; one undo puts the value back, and the file is saved as it was read.
//
// Fixtures: fixtures/string-containers, which MATLAB R2027a and R2023b wrote
// (make_string_containers.m).
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import { copiesOf } from './tools/matPaste.js';
import { ingest } from '../src/core/ingest.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const arrayBufferOf = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const fixture = (path: string): Uint8Array => new Uint8Array(readFileSync(fileURLToPath(new URL(path, import.meta.url))));
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);
const containers = (release: string, file: string) => fixture(`./fixtures/string-containers/${release}/${file}.mat`);

function opened(bytes: Uint8Array, name = 'f.mat') {
  const session = createSession();
  const root: any = session.addMatSource(name, arrayBufferOf(bytes));
  const at = (path: string) => root.flatten().find((n: any) => n.matlabPath === path);
  const edit = (path: string, value: string) => {
    const node = at(path);
    session.setActive(root, node);
    return session.editProperty(node.id, 'Value', value);
  };
  const undo = () => {
    session.setActive(root, root.children[0]);
    session.undo();
  };
  const redo = () => {
    session.setActive(root, root.children[0]);
    session.redo();
  };
  const save = (): Uint8Array => (session.serializeSource(name) as { bytes: Uint8Array }).bytes;
  return { session, root, at, edit, undo, redo, save };
}

/** The rows at and under `path`: each one's path, class and text. */
function rowsUnder(root: any, path: string): string[] {
  const under = (p: string) => p === path || ['{', '.', '('].some((c) => p.startsWith(path + c));
  return root.flatten().filter((n: any) => under(n.matlabPath)).map((n: any) => [n.matlabPath, n.className, n.displayValue].join(' '));
}

/** Every row of a file but those at and under `path`, and those of the containers holding it, whose summaries show it. */
function rowsBeside(root: any, path: string): string[] {
  const onPath = (p: string) => p === path || ['{', '.', '('].some((c) => path.startsWith(p + c) || p.startsWith(path + c));
  return root.flatten().filter((n: any) => !onPath(n.matlabPath)).map((n: any) => [n.matlabPath, n.className, n.displayValue].join(' '));
}

const reopened = (bytes: Uint8Array) => opened(bytes, 'reopened.mat').root;

/** The record bytes of each variable a file holds, by name, and the subsystem's (''). */
function records(bytes: Uint8Array): Map<string, Uint8Array> {
  return new Map(parseMat(arrayBufferOf(bytes)).records!.map((r) => [r.anonymous ? '' : r.name!, r.bytes]));
}

// What is typed, and where: [path, the variable holding it, text].
const EDITS: [string, string, string][] = [
  ['ce{1}', 'ce', '{"a"}'],
  ['ce{2}', 'ce', '{1, "a"}'],
  ['st.a', 'st', '{"a", "b"}'],
  ['nest.c{1}', 'nest', '{{"a"}}'],
  ['sa(2).f', 'sa', '{"a"; 2}'],
  ['ce{3}', 'ce', '{["a" "b"]}'],
  ['st.b', 'st', '{""}'],
  ['nest.c{2}.g', 'nest', '{"a" "b"; "c" "d"}'],
  ['ce', 'ce', '{"x", {1, "y"}}'],
];

for (const release of ['r2027a', 'r2023b']) {
  for (const file of ['plain', 'objects', 'strings']) {
    describe(`a value holding strings typed in, ${release}/${file}.mat`, () => {
      it.each(EDITS)('%s (of %s) = %s: written and read back as the rows show it, every other variable as read', (path, variable, typed) => {
        const bytes = containers(release, file);
        const { root, edit, save } = opened(bytes);
        const beside = rowsBeside(root, path);
        expect(edit(path, typed)).toBe(true);
        const shown = rowsUnder(root, path);
        expect(shown.some((r) => / string /.test(r))).toBe(true);
        const saved = save();
        const back = reopened(saved);
        expect(rowsUnder(back, path)).toEqual(shown);
        expect(rowsBeside(back, path)).toEqual(beside);
        const read = records(bytes);
        for (const [name, record] of records(saved)) {
          if (name !== variable && name !== '') {
            expect(sameBytes(record, read.get(name)!), name).toBe(true);
          }
        }
      });

      it('is put back by one undo, the file then saved as it was read, and made again by the redo', () => {
        const bytes = containers(release, file);
        const { edit, undo, redo, save } = opened(bytes);
        expect(edit('nest.c{2}.g', '{1, "a"}')).toBe(true);
        const first = save();
        undo();
        expect(sameBytes(save(), bytes)).toBe(true);
        redo();
        expect(sameBytes(save(), first)).toBe(true);
        undo();
        expect(sameBytes(save(), bytes)).toBe(true);
      });

      it('then takes an edit of each string it made, of its text and as another value, and of its own text', () => {
        const bytes = containers(release, file);
        const { at, edit, undo, save } = opened(bytes);
        expect(edit('ce{1}', '{"a", "b"}')).toBe(true);
        // As a reopened file shows it: a cell holding no object but strings spells them by their
        // text, and takes an edit of it (MatlabVariableNode._spellsStrings).
        expect([at('ce{1}').displayValue, at('ce{1}').valueEditable]).toEqual(['{"a", "b"}', true]);
        expect(edit('ce{1}{1}', '"z"')).toBe(true);
        expect(edit('ce{1}{2}', '5')).toBe(true);
        expect(rowsUnder(reopened(save()), 'ce{1}')).toEqual(['ce{1} cell {"z", 5}', 'ce{1}{1} string "z"', 'ce{1}{2} double 5']);
        expect(edit('ce{1}', '{"q", ["r" "s"]}')).toBe(true);
        expect(rowsUnder(reopened(save()), 'ce{1}')).toEqual(['ce{1} cell {"q", ["r" "s"]}', 'ce{1}{1} string "q"', 'ce{1}{2} string ["r" "s"]', 'ce{1}{2}(1) string "r"', 'ce{1}{2}(2) string "s"']);
        for (let k = 0; k < 4; k++) undo();
        expect(sameBytes(save(), bytes)).toBe(true);
      });
    });
  }
}

describe('a value holding strings typed over a string', () => {
  it.each([
    ['s', '{"top", 2}'],
    ['st2.b', '{"was a string"}'],
    ['ce2{3}', '{["x" "yz"], 1}'],
  ])('%s = %s', (path, typed) => {
    const bytes = containers('r2027a', 'strings');
    const { root, edit, save } = opened(bytes);
    expect(edit(path, typed)).toBe(true);
    const shown = rowsUnder(root, path);
    expect(rowsUnder(reopened(save()), path)).toEqual(shown);
  });
});

// A string the value holds whose text is refused, after the others were made: the file as it was
// (MatNode._retype puts the value back and the creations with it). No text a string's setter is
// handed refuses today, so the refusal is stubbed, for the second string made.
describe('a value holding strings, one of whose strings refuses its text', () => {
  it('leaves the file as it was, and takes the edit made next', () => {
    const bytes = containers('r2027a', 'objects');
    const { root, at, edit, save } = opened(bytes);
    const was = at('ce{2}');
    const refusal = { error: true, reason: 'Cannot edit "ce": refused for the test.', invalidValue: '"b"', validValue: '"b"' };
    const real = MatlabVariableNode.prototype.setProperty;
    let strings = 0;
    const spy = vi.spyOn(MatlabVariableNode.prototype, 'setProperty').mockImplementation(function (this: MatlabVariableNode, key: string, text: string) {
      const set = real.call(this, key, text);
      return this._isOpaque && ++strings === 2 ? refusal : set;
    });
    try {
      // Refused of the row typed into: the text typed, and the value the row shows.
      expect(edit('ce{2}', '{"a", "b"}')).toEqual({ ...refusal, invalidValue: '{"a", "b"}', validValue: "'two'" });
    } finally {
      spy.mockRestore();
    }
    expect([at('ce{2}'), was.parent, root.dirty, root._creation]).toEqual([was, at('ce'), false, undefined]);
    expect(sameBytes(save(), bytes)).toBe(true);
    expect(edit('ce{2}', '{"a", "b"}')).toBe(true);
    expect(rowsUnder(reopened(save()), 'ce{2}')).toEqual(['ce{2} cell {"a", "b"}', 'ce{2}{1} string "a"', 'ce{2}{2} string "b"']);
  });
});

describe('what is still refused', () => {
  it('a value holding a string, into an element of a numeric array, or as a Simulink.Parameter\'s Value', () => {
    const bytes = fixture('./parity/artifacts/mat/cases.mat');
    const { root, at, edit, save } = opened(bytes, 'cases.mat');
    expect(edit('cellFlat{3}(1)', '{"a"}')).toMatchObject({ error: true, reason: 'Array elements must be scalar numbers' });
    const p = root.children.find((c: any) => c.className === 'Simulink.Parameter');
    expect(edit(p.matlabPath, '{1, "a"}')).toMatchObject({ error: true, reason: expect.stringMatching(/^Invalid value specified for parameter/) });
    expect(at(p.matlabPath)).toBe(p);
    expect([root.dirty, sameBytes(save(), bytes)]).toEqual([false, true]);
  });
});

// A struct or a cell holding strings, copied out of a dictionary or another MAT-file and pasted into
// a MAT-file: made as it was copied, each string an object of the file, as a value typed in makes
// them (matPaste's stand-ins, MatNode._makeStrings). It was refused ("a paste writes no new object
// inside a struct or a cell"). Its undo leaves the file as it was read, and the deep pasteRefusal,
// which makes the paste and takes it back, says it is taken and changes nothing.
describe('a struct or a cell holding strings, pasted into a MAT-file', () => {
  // What a host copies of the entry `name` of `file` (a dictionary's or a MAT-file's).
  const copied = (file: string, name: string) => copiesOf('test/' + file).find((c) => c.entry.name === name)!.payload;
  const SOURCES: [string, string][] = [
    ['fixtures/cellstr_text.sldd', 'cStr'],
    ['fixtures/cellstr_binary.sldd', 'sStr'],
    ['fixtures/string-containers/r2027a/strings.mat', 'st2'],
    ['fixtures/string-containers/r2027a/strings.mat', 'sa2'],
    ['fixtures/string-containers/r2027a/strings.mat', 'ce2'],
    ['fixtures/string-containers/r2027a/strings.mat', 'nest2'],
  ];
  for (const into of ['plain', 'objects', 'strings']) {
    it.each(SOURCES)(`%s %s, into ${into}.mat: made, saved and read back as it shows, undone to the file as read`, (file, name) => {
      const payload = copied(file, name);
      const bytes = containers('r2027a', into);
      const { session, root, undo, redo, save } = opened(bytes);
      expect((session as any).pasteRefusal('f.mat', payload, { deep: true })).toBeNull();
      expect([root.dirty, sameBytes(save(), bytes)]).toEqual([false, true]);
      const made: any = (session as any).pasteEntries('f.mat', [payload]);
      expect(made.error).toBeUndefined();
      const pasted = made.nodes[0].name;
      const shown = rowsUnder(root, pasted);
      expect(shown.filter((r) => / string /.test(r)).length).toBeGreaterThan(0);
      const first = save();
      expect(rowsUnder(reopened(first), pasted)).toEqual(shown);
      undo();
      expect(sameBytes(save(), bytes)).toBe(true);
      redo();
      expect(sameBytes(save(), first)).toBe(true);
    });
  }

  it('takes a later edit of each string it made', () => {
    const { session, edit, save } = opened(containers('r2027a', 'plain'));
    const made: any = (session as any).pasteEntries('f.mat', [copied('fixtures/string-containers/r2027a/strings.mat', 'ce2')]);
    expect(made.error).toBeUndefined();
    expect(edit('ce2{2}', '"edited"')).toBe(true);
    expect(edit('ce2{3}', '7')).toBe(true);
    expect(rowsUnder(reopened(save()), 'ce2')).toEqual(['ce2 cell {1, "edited", 7}', 'ce2{1} double 1', 'ce2{2} string "edited"', 'ce2{3} double 7']);
  });

  it('is refused, saying why and changing nothing, where it holds an empty string or an object', () => {
    const bytes = containers('r2027a', 'plain');
    const { session, root, save } = opened(bytes);
    const empty = { name: 'e', metadata: null, value: { _array_type: 'Cell', _dimensions: [1, 1], _elements: [{ _array_type: 'String', _dimensions: [0, 3], _elements: [] }] } };
    expect((session as any).pasteEntries('f.mat', [empty])).toMatchObject({
      error: true,
      reason: 'Cannot paste "e" into "f.mat": e{1} is a string, which a paste makes anew of its text, and it is a 0x3 string array, which no text spells. Nothing was pasted.',
    });
    const object = copied('fixtures/strings_nested.mat', 'mixCell');
    expect((session as any).pasteEntries('f.mat', [object])).toMatchObject({ error: true, reason: expect.stringMatching(/mixCell\{1\} is a Simulink\.Parameter object/) });
    expect([root.dirty, root._creation, sameBytes(save(), bytes)]).toEqual([false, undefined, true]);
  });
});

// A MAT-file cell that holds no object but strings spells them by their text, as a dictionary
// spells the same cell, and so takes an edit of its whole text, whether MATLAB wrote it or an edit
// made it: a retype, its new strings made objects of the file (MatNode._retype), the strings it no
// longer holds left among them; or, typed with no string, the plain cell set in place. A cell
// holding another object keeps every summary and its lock (MatlabVariableNode._spellsStrings).
describe("a MAT-file cell holding strings, edited as its text", () => {
  for (const release of ['r2027a', 'r2023b']) {
    it(`${release}/strings.mat ce2: shown and offered as its text, to a host's row too, and its copy as before`, () => {
      const { at } = opened(containers(release, 'strings'));
      const ce2 = at('ce2');
      expect([ce2.displayValue, ce2.valueEditable]).toEqual(['{1, "inCell", ["x" "yz"]}', true]);
      expect([ce2.toRow().Value, ce2.toRow()._valueEditable]).toEqual(['{1, "inCell", ["x" "yz"]}', true]);
      expect(ce2.serialize().value._elements).toMatchObject([
        1,
        { _array_type: 'String', _dimensions: [1, 1], _elements: ['inCell'] },
        { _array_type: 'String', _dimensions: [1, 2], _elements: ['x', 'yz'] },
      ]);
    });

    it.each([
      ['{"b", 1}', ['ce2 cell {"b", 1}', 'ce2{1} string "b"', 'ce2{2} double 1']],
      ['{1, 2}', ['ce2 cell {1, 2}', 'ce2{1} double 1', 'ce2{2} double 2']],
      ['{1, "inCell", ["x" "zz"]}', ['ce2 cell {1, "inCell", ["x" "zz"]}', 'ce2{1} double 1', 'ce2{2} string "inCell"', 'ce2{3} string ["x" "zz"]', 'ce2{3}(1) string "x"', 'ce2{3}(2) string "zz"']],
    ])(`${release}/strings.mat ce2 = %s: saved and read back, undone to the file as read`, (typed, rows) => {
      const bytes = containers(release, 'strings');
      const { root, edit, undo, save } = opened(bytes);
      expect(edit('ce2', typed)).toBe(true);
      expect(rowsUnder(root, 'ce2')).toEqual(rows);
      const saved = save();
      expect(rowsUnder(reopened(saved), 'ce2')).toEqual(rows);
      // The strings it held are left among the file's objects; with no string typed, nothing is made.
      if (!typed.includes('"')) {
        expect(sameBytes(records(saved).get('')!, records(bytes).get('')!)).toBe(true);
      }
      undo();
      expect(sameBytes(save(), bytes)).toBe(true);
    });
  }

  it('a cell an edit made holding strings takes an edit of its text, and its undo', () => {
    const bytes = containers('r2027a', 'objects');
    const { root, edit, undo, save } = opened(bytes);
    expect(edit('ce{1}', '{"a"}')).toBe(true);
    expect(edit('ce{1}', '{"b", 1}')).toBe(true);
    expect(edit('ce{1}', '{2, 3}')).toBe(true);
    expect(rowsUnder(reopened(save()), 'ce{1}')).toEqual(['ce{1} cell {2, 3}', 'ce{1}{1} double 2', 'ce{1}{2} double 3']);
    // No string is written for it: the file's objects as read.
    expect(sameBytes(records(save()).get('')!, records(bytes).get('')!)).toBe(true);
    undo();
    expect(rowsUnder(root, 'ce{1}')).toEqual(['ce{1} cell {"b", 1}', 'ce{1}{1} string "b"', 'ce{1}{2} double 1']);
    expect(rowsUnder(reopened(save()), 'ce{1}')).toEqual(['ce{1} cell {"b", 1}', 'ce{1}{1} string "b"', 'ce{1}{2} double 1']);
    undo();
    undo();
    expect(sameBytes(save(), bytes)).toBe(true);
  });

  it('a cell holding another object keeps every summary and takes no edit of its text', () => {
    const bytes = fixture('./fixtures/strings_nested.mat');
    const { root, at, edit, save } = opened(bytes, 'strings_nested.mat');
    expect([at('mixCell').displayValue, at('mixCell').valueEditable]).toEqual(['{<1x1 Simulink.Parameter>, <1x1 string>, 9}', false]);
    expect(edit('mixCell', '{1, "a"}')).toMatchObject({ error: true, reason: 'This cell shows an element as a summary, which is not its value. Edit the element instead.' });
    expect([root.dirty, sameBytes(save(), bytes)]).toEqual([false, true]);
  });

  it('a string no text spells keeps its summary, and its cell its lock; one with control characters is spelled as MATLAB would type it', () => {
    const { at } = opened(containers('r2027a', 'cells'));
    for (const [path, shown] of [['cMissing', '{<1x1 string>, "ok"}'], ['cEmpty', '{<0x3 string>, "x"}'], ['cNd', '{<2x2x2 string>}']]) {
      expect([at(path).displayValue, at(path).valueEditable], path).toEqual([shown, false]);
    }
    expect([at('cControl').displayValue, at('cControl').valueEditable]).toEqual(['{"line" + newline + "break", "tab" + char(9)}', true]);
    expect([at('cPlain').displayValue, at('cPlain').valueEditable]).toEqual(['{"plain", "with ""quotes""", "é中😀", ""}', true]);
  });
});

// What the review of 4a5a23c..1be16fa found, each held here.
describe('a string a cell or a struct holds, of every kind the review found wrong', () => {
  const str = (els: (string | null)[], dims?: number[]) => ({ _array_type: 'String', _dimensions: dims ?? [1, els.length], _elements: els });
  const cell = (els: unknown[], dims?: number[]) => ({ _array_type: 'Cell', _dimensions: dims ?? [1, els.length], _elements: els });
  const struct = (o: Record<string, unknown>) => ({ _array_type: 'Struct', _dimensions: [1, 1], _elements: [o], _fields: Object.keys(o) });
  const structs = (els: Record<string, unknown>[]) => ({ _array_type: 'Struct', _dimensions: [1, els.length], _elements: els, _fields: Object.keys(els[0]) });
  const paste = (into: string, value: unknown) => {
    const o = opened(containers('r2027a', into));
    const made: any = (o.session as any).pasteEntries('f.mat', [{ name: 'p', metadata: null, value }]);
    return { ...o, made };
  };

  // An empty string's text is the made string's own (MATLAB's default ""), so setting it set
  // nothing, and a container a paste read its stand-in into was written as read: a char ' '.
  it.each([
    ['{{""}, "a"}', cell([cell([str([''])]), str(['a'])])],
    ['{"a", {""}}', cell([str(['a']), cell([str([''])])])],
    ['{1, {"", 2}, "b"}', cell([1, cell([str(['']), 2]), str(['b'])])],
    ['{"", 1}', cell([str(['']), 1])],
    ['struct x={""} y="a"', struct({ x: cell([str([''])]), y: str(['a']) })],
    ['struct s.x="" y="a"', struct({ s: struct({ x: str(['']) }), y: str(['a']) })],
    ['struct x=""', struct({ x: str(['']) })],
    ['sa(1).f={""} sa(2).f="a"', structs([{ f: cell([str([''])]) }, { f: str(['a']) }])],
  ])('"" in %s, pasted: saved and read back as the string it is, and the paste a new variable', (_what, value) => {
    for (const into of ['plain', 'objects']) {
      const { root, made, save } = paste(into, value);
      expect(made.error, into).toBeUndefined();
      // Named p, or p1 in objects.mat, which holds a Parameter p.
      const name = made.nodes[0].name;
      const shown = rowsUnder(root, name);
      expect(shown.filter((r) => r.endsWith(' string ""')).length, into).toBeGreaterThan(0);
      expect(rowsUnder(reopened(save()), name), into).toEqual(shown);
      expect(made.nodes[0].status, into).toBe('New');
    }
  });

  it.each([['{{""}, "a"}'], ['{1, {"", 2}, "b"}'], ['{"", 1}']])('"" in %s, typed: saved and read back as the string it is', (typed) => {
    const { root, edit, save } = opened(containers('r2027a', 'plain'));
    expect(edit('ce{1}', typed)).toBe(true);
    const shown = rowsUnder(root, 'ce{1}');
    expect(rowsUnder(reopened(save()), 'ce{1}')).toEqual(shown);
  });

  it('a MAT-file variable holding {""} copied into another MAT-file', () => {
    const src = opened(containers('r2027a', 'plain'));
    expect(src.edit('ce{1}', '{""}')).toBe(true);
    const copy = structuredClone(src.at('ce').serialize());
    const { root, save, session } = opened(containers('r2027a', 'objects'));
    const made: any = (session as any).pasteEntries('f.mat', [copy]);
    expect(made.error).toBeUndefined();
    expect(rowsUnder(reopened(save()), made.nodes[0].name)).toEqual(rowsUnder(root, made.nodes[0].name));
  });

  // A string's text was its displayValue, a summary past the display's budget.
  const long = 'x'.repeat(5000);
  const eleven = Array.from({ length: 11 }, (_, i) => 's' + i);
  const fifty = Array.from({ length: 50 }, (_, i) => 's' + i);
  it.each([
    ['a 5000-character string', '{"' + long + '"}'],
    ['an 11-element string array', '{[' + eleven.map((t) => '"' + t + '"').join(' ') + ']}'],
    ['a 50-element string array beside a string', '{"a"; [' + fifty.map((t) => '"' + t + '"').join(' ') + ']}'],
  ])('%s, typed in a cell: taken, saved and read back with every character', (_what, typed) => {
    const { root, at, edit, save } = opened(containers('r2027a', 'plain'));
    expect(edit('ce{1}', typed)).toBe(true);
    const back = reopened(save());
    expect(rowsUnder(back, 'ce{1}')).toEqual(rowsUnder(root, 'ce{1}'));
    const first = (n: any) => n.flatten().find((x: any) => x.matlabPath === 'ce{1}{1}' || x.matlabPath === 'ce{1}{2}(50)');
    expect(first(back)._elements).toEqual(first(at('ce{1}'))._elements);
  });

  it.each([
    ['a 5000-character string', cell([str([long])])],
    ['an 11-element string array', cell([str(eleven)])],
    ['a 2x2 string array', cell([str(['a', 'b', 'c', 'd'], [2, 2])])],
    ['quotes and control characters', cell([str(['a"b', 'c\tdx\ny'])])],
  ])('%s, pasted in a cell: saved and read back with every character', (_what, value) => {
    const { root, made, save } = paste('plain', value);
    expect(made.error).toBeUndefined();
    const back = reopened(save());
    expect(rowsUnder(back, 'p')).toEqual(rowsUnder(root, 'p'));
    const string = (r: any) => r.flatten().find((x: any) => x.matlabPath === 'p{1}');
    expect(string(back)._elements).toEqual(string(root)._elements);
  });

  it.each([
    ['<missing> alone', cell([str([null])]), 'it holds <missing>'],
    ['<missing> in an array', cell([str(['a', null])]), 'it holds <missing>'],
    ['a 2x2x2 string array', cell([str(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], [2, 2, 2])]), 'it is a 2x2x2 string array'],
    ['an empty string array', cell([str([], [0, 3])]), 'it is a 0x3 string array'],
  ])('%s, pasted in a cell: refused, saying which, nothing changed', (_what, value, why) => {
    const { root, made, save } = paste('plain', value);
    expect(made).toMatchObject({ error: true, reason: 'Cannot paste "p" into "f.mat": p{1} is a string, which a paste makes anew of its text, and ' + why + ', which no text spells. Nothing was pasted.' });
    expect([root.dirty, root._creation, sameBytes(save(), containers('r2027a', 'plain'))]).toEqual([false, undefined, true]);
  });
});

// A bare word in a cell typed in, which no value of this package evaluates: it was kept as a char
// (`{missing}` as {'missing'}, `{strings(0,3)}` as {'strings(0', '3)'}); typed into a variable's
// Value, a MAT-file's or a dictionary's, it is refused, naming the word (MatlabValueParser.parseTyped).
// What a file holds is read as it was: the reader of a value's text is the lenient parse.
describe('a bare word typed in a cell', () => {
  it.each([
    ['{missing}', 'missing'],
    ['{strings(0,3)}', 'strings(...)'],
    ['{1, abc}', 'abc'],
    ['{"a", {b}}', 'b'],
  ])('%s is refused in a MAT-file, naming %s, nothing changed', (typed, word) => {
    const bytes = containers('r2027a', 'plain');
    const { root, edit, save } = opened(bytes);
    for (const path of ['ce', 'ce{1}', 'st.a']) {
      expect(edit(path, typed), path).toMatchObject({
        error: true,
        reason: word + ' is a name or a call, which this editor does not evaluate: a char is typed in quotes, a string in double quotes',
        invalidValue: typed,
      });
    }
    expect([root.dirty, sameBytes(save(), bytes)]).toEqual([false, true]);
  });

  it('is refused in a text and a binary dictionary too, and a quoted char is taken', () => {
    const s = createSession();
    for (const file of ['parity/artifacts/text/cases.sldd', 'parity/artifacts/binary/cases.sldd']) {
      const root: any = ingest(s, arrayBufferOf(fixture('./' + file)), { filename: file.split('/').pop() });
      const entry = root.children.flatMap((x: any) => x.children).find((e: any) => e.className === 'cell' && e.valueEditable);
      s.setActive(root, entry);
      const before = entry.displayValue;
      expect(s.editProperty(entry.id, 'Value', '{missing}'), file).toMatchObject({ error: true, reason: 'missing is a name or a call, which this editor does not evaluate: a char is typed in quotes, a string in double quotes' });
      expect(entry.displayValue, file).toBe(before);
      expect(s.editProperty(entry.id, 'Value', "{'missing'}"), file).toBe(true);
      expect(entry.displayValue, file).toBe("{'missing'}");
    }
  });
});

describe('a cell of 2000 strings', () => {
  // A creation's place in the tree was looked up among its holder's rows, for each creation, at each
  // ask of a save's or a gate's (MatNode._holds, _liveCreations): a paste of 2000 took 6 s and its
  // save 5 s, an edit of a member after it 2.7 s. Generous bounds, far above what it takes now.
  it('is pasted, saved and edited in reasonable time', () => {
    const value = { _array_type: 'Cell', _dimensions: [1, 2001], _elements: [1, ...Array.from({ length: 2000 }, (_, i) => ({ _array_type: 'String', _dimensions: [1, 1], _elements: ['s' + i] }))] };
    const { session, edit, save, root } = opened(containers('r2027a', 'plain'));
    let t = performance.now();
    const made: any = (session as any).pasteEntries('f.mat', [{ name: 'p', metadata: null, value }]);
    const pasted = performance.now() - t;
    expect(made.error).toBeUndefined();
    t = performance.now();
    const saved = save();
    const written = performance.now() - t;
    t = performance.now();
    expect(edit('p{1}', '5')).toBe(true);
    const edited = performance.now() - t;
    expect({ pasted: pasted < 3000, written: written < 3000, edited: edited < 1500 }).toEqual({ pasted: true, written: true, edited: true });
    expect(rowsUnder(reopened(saved), 'p').length).toBe(rowsUnder(root, 'p').length);
  });
});
