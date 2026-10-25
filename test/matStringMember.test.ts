// Copyright 2026 The MathWorks, Inc.
//
// A struct field or a cell element of a MAT-file variable, at any depth, typed over as a string
// becomes one, as `s.a = "abc"` and `c{2} = "abc"` make one in MATLAB; and a string there typed
// over as anything else becomes that value, as `c{2} = 5` does.
//
// A MAT-file holds a string only as an object of its subsystem, which only a creation writes, so
// the edit cannot change the member in place: it was refused ("would be a string, which this
// package cannot write into a MAT-file"), and a string member typed a number was refused too
// ("takes only a string"), though a whole variable took both (matRetypeString.test.ts). Now the
// member is swapped as a variable is (MatNode._retype): a string made as the String tile makes
// one, merged into the file's subsystem (or a new one), or the plain value an Add makes, of the
// member's name, in its place, holding the text. The save writes the container fresh, the new
// string as the class-17 element MATLAB writes for a string in a cell or a struct, naming it by
// its id in the subsystem written (MatNode._createdElement). A string a member no longer holds is
// left in the subsystem, as a variable's is; MATLAB R2027a and R2023b load such a file with no
// warning (the live gate of 2026-10-25, notes "## T").
//
// The fixtures under fixtures/string-containers were written by MATLAB R2027a and R2023b
// (make_string_containers.m): plain.mat holds no object, so no subsystem; objects.mat holds a
// Simulink.Parameter beside the same containers; strings.mat holds strings, at the top and in
// containers, beside them.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const arrayBufferOf = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const fixture = (path: string): Uint8Array => new Uint8Array(readFileSync(fileURLToPath(new URL(path, import.meta.url))));
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);

/** A MatNode opened through the session, as a host opens one, and what a host does to it. */
function opened(bytes: Uint8Array, name = 'f.mat') {
  const session = createSession();
  const root: any = session.addMatSource(name, arrayBufferOf(bytes));
  const at = (path: string) => root.flatten().find((n: any) => n.matlabPath === path);
  // What the row at `path` shows: its class and text.
  const shown = (path: string): [string, string] | undefined => {
    const n = at(path);
    return n ? [n.className, n.displayValue] : undefined;
  };
  const edit = (path: string, value: string) => {
    const node = at(path);
    session.setActive(root, node);
    return session.editProperty(node.id, 'Value', value);
  };
  const save = (): Uint8Array => (session.serializeSource(name) as { bytes: Uint8Array }).bytes;
  return { session, root, at, shown, edit, save };
}

/** What a file shows at `path`, reopened: its class and text. */
function shownAt(bytes: Uint8Array, path: string): [string, string] | undefined {
  return opened(bytes, 'reopened.mat').shown(path);
}

/** Every row of a file, reopened: its path, class and text, in tree order. */
function rows(bytes: Uint8Array): string[] {
  return opened(bytes, 'reopened.mat').root.flatten().map((n: any) => [n.matlabPath, n.className, n.displayValue].join(' '));
}

/** Whether the row at `row` is the member at `path` or a container that holds it. */
const onPath = (row: string, path: string) => path === row || ['.', '{', '('].some((c) => path.startsWith(row + c));

/** The record bytes of each variable a file holds, by name, and the subsystem's ('' for it). */
function records(bytes: Uint8Array): Map<string, Uint8Array> {
  return new Map(parseMat(arrayBufferOf(bytes)).records!.map((r) => [r.anonymous ? '' : r.name!, r.bytes]));
}

const RELEASES = ['r2027a', 'r2023b'];
const FILES = ['plain', 'objects', 'strings'];
const containers = (release: string, file: string) => fixture(`./fixtures/string-containers/${release}/${file}.mat`);

// Each shape a member stands in: [label, path, the variable that holds it].
const SHAPES: [string, string, string][] = [
  ['a 1x1 struct field', 'st.a', 'st'],
  ['a field of an element of a struct array', 'sa(2).f', 'sa'],
  ['a cell element holding a char', 'ce{2}', 'ce'],
  ['a cell element holding an int8', 'ce{3}', 'ce'],
  ['a cell element in a struct', 'nest.c{1}', 'nest'],
  ['a field of a struct in a cell in a struct', 'nest.c{2}.g', 'nest'],
];

for (const release of RELEASES) {
  for (const file of FILES) {
    describe(`a string typed into a member, ${release}/${file}.mat`, () => {
      it.each(SHAPES)('%s becomes the string, which a save writes and a reopen reads; every other variable is written as read', (_what, path, variable) => {
        const bytes = containers(release, file);
        const before = rows(bytes);
        const { shown, edit, save } = opened(bytes);
        expect(edit(path, '"abc"')).toBe(true);
        expect(shown(path)).toEqual(['string', '"abc"']);
        const saved = save();
        expect(shownAt(saved, path)).toEqual(['string', '"abc"']);
        // The rows of every other member are what they were (but the member's and those of the
        // containers that hold it, whose summaries show it), and so is every other variable's record.
        const other = (row: string) => !onPath(row.slice(0, row.indexOf(' ')), path);
        expect(rows(saved).filter(other)).toEqual(before.filter(other));
        const read = records(bytes);
        for (const [name, record] of records(saved)) {
          if (name !== variable && name !== '') {
            expect(sameBytes(record, read.get(name)!), name).toBe(true);
          }
        }
      });

      it('is put back by one undo, the save then writing the file as it was read, and made again by the redo', () => {
        const bytes = containers(release, file);
        const { session, at, shown, edit, save } = opened(bytes);
        expect(edit('nest.c{2}.g', '"abc"')).toBe(true);
        const first = save();
        session.undo();
        expect(shown('nest.c{2}.g')).toEqual(['double', '2']);
        expect(sameBytes(save(), bytes)).toBe(true);
        session.redo();
        expect(at('nest.c{2}.g').className).toBe('string');
        expect(sameBytes(save(), first)).toBe(true);
        session.undo();
        expect(sameBytes(save(), bytes)).toBe(true);
      });

      it('takes a string array, an empty string and a later edit of its text', () => {
        const { at, edit, save } = opened(containers(release, file));
        expect(edit('st.a', '["x" "yz"]')).toBe(true);
        expect(edit('st.b', '""')).toBe(true);
        expect(edit('ce{1}', '"abc"')).toBe(true);
        expect(edit('ce{1}', '"xyz"')).toBe(true);
        expect(at('st.a').displayValue).toBe('["x" "yz"]');
        const saved = save();
        expect([shownAt(saved, 'st.a'), shownAt(saved, 'st.b'), shownAt(saved, 'ce{1}')]).toEqual([
          ['string', '["x" "yz"]'],
          ['string', '""'],
          ['string', '"xyz"'],
        ]);
      });

      it('typed back to a number, writes no string for the member and none of the one it made', () => {
        const bytes = containers(release, file);
        const { edit, save } = opened(bytes);
        expect(edit('ce{1}', '"abc"')).toBe(true);
        expect(edit('ce{1}', '9')).toBe(true);
        const saved = save();
        expect(shownAt(saved, 'ce{1}')).toEqual(['double', '9']);
        // The subsystem is the file's own, as read, or none, as the file held none.
        expect(records(saved).get('')).toEqual(records(bytes).get(''));
      });
    });
  }
}

// Each string a member of strings.mat holds: [path, its text].
const STRING_MEMBERS: [string, string][] = [
  ['st2.b', '"inStruct"'],
  ['sa2(1).f', '"one"'],
  ['ce2{2}', '"inCell"'],
  ['ce2{3}', '["x" "yz"]'],
  ['nest2.c{2}.g', '"deep"'],
];

for (const release of RELEASES) {
  describe(`a value typed over a string member, ${release}/strings.mat`, () => {
    it.each(STRING_MEMBERS)('%s becomes the value; the file\'s objects are written as read, the string left among them', (path) => {
      const bytes = containers(release, 'strings');
      const { at, edit } = opened(bytes);
      for (const [typed, shown] of [['5', ['double', '5']], ["'chr'", ['char', "'chr'"]], ['true', ['logical', 'true']], ['-0.5', ['double', '-0.5']]] as const) {
        const o = opened(bytes);
        expect(o.edit(path, typed), typed).toBe(true);
        const saved = o.save();
        expect(shownAt(saved, path), typed).toEqual(shown);
        expect(sameBytes(records(saved).get('')!, records(bytes).get('')!), typed).toBe(true);
      }
      expect(edit(path, '5')).toBe(true);
      expect(at(path).className).toBe('double');
    });

    it('is put back by one undo, the save then writing the file as it was read', () => {
      const bytes = containers(release, 'strings');
      const { session, shown, edit, save } = opened(bytes);
      expect(edit('ce2{2}', '5')).toBe(true);
      session.undo();
      expect(shown('ce2{2}')).toEqual(['string', '"inCell"']);
      expect(sameBytes(save(), bytes)).toBe(true);
      session.redo();
      expect(shownAt(save(), 'ce2{2}')).toEqual(['double', '5']);
    });

    it('takes a string typed back over the value, as a new string', () => {
      const { edit, save } = opened(containers(release, 'strings'));
      expect(edit('st2.b', '5')).toBe(true);
      expect(edit('st2.b', '"again"')).toBe(true);
      expect(shownAt(save(), 'st2.b')).toEqual(['string', '"again"']);
    });
  });
}

describe("the user's repros", () => {
  // A struct and a cell pasted into a file, then a member of each typed as a string.
  it.each([
    'fixtures/mcos-templates/targets/r2023b/none.mat',
    'fixtures/mcos-templates/targets/r2027a/mixed.mat',
  ])('a pasted struct\'s field and cell\'s element take "abc", in %s', (file) => {
    const session = createSession();
    const root: any = session.addMatSource('m.mat', arrayBufferOf(fixture('./' + file)));
    const pasted: any = session.pasteEntries('m.mat', [
      { name: 'st', value: { _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ a: 1, b: 2 }], _fields: ['a', 'b'] } },
      { name: 'ce', value: { _array_type: 'Cell', _dimensions: [1, 2], _elements: [1, 2] } },
    ]);
    expect(pasted.error).toBeFalsy();
    const paths = pasted.nodes.map((v: any) => v.children[0].matlabPath);
    for (const v of pasted.nodes) {
      const k = v.children[0];
      session.setActive(root, k);
      expect(session.editProperty(k.id, 'Value', '"abc"'), k.matlabPath).toBe(true);
    }
    const saved = (session.serializeSource('m.mat') as { bytes: Uint8Array }).bytes;
    for (const path of paths) {
      expect(shownAt(saved, path), path).toEqual(['string', '"abc"']);
    }
  });

  it('strings_nested.mat: a string in a container takes new text, a number, and a string where a number was', () => {
    const bytes = fixture('./fixtures/strings_nested.mat');
    const { edit, save } = opened(bytes);
    expect(edit('mixCell{2}', '"zzz"')).toBe(true);
    expect(edit('mixStruct.s', '"zzz"')).toBe(true);
    expect(edit('mixCell{2}', '5')).toBe(true);
    expect(edit('mixCell{3}', '"abc"')).toBe(true);
    const saved = save();
    expect([shownAt(saved, 'mixCell{2}'), shownAt(saved, 'mixStruct.s'), shownAt(saved, 'mixCell{3}'), shownAt(saved, 'mixCell{1}')]).toEqual([
      ['double', '5'],
      ['string', '"zzz"'],
      ['string', '"abc"'],
      ['Simulink.Parameter', '8'],
    ]);
  });
});

// A member's retype that the value put in place refuses leaves the file as it was: the member back
// in its place, the container's marks as they were (so a save writes it as read), the file not
// dirty, and nothing created (MatNode._retype). No text the new value's setter is handed refuses
// today, so the refusal is stubbed, after the setter ran.
describe('a member retype the value put in place refuses', () => {
  it.each([
    ['a string', 'st.a', '"abc"'],
    ['a number over a string', 'st2.b', '5'],
  ])('leaves the file as it was for %s, and takes the retype made next', (_what, path, typed) => {
    const bytes = containers('r2027a', 'strings');
    const { root, at, edit, save } = opened(bytes);
    const was = at(path);
    const refusal = { error: true, reason: 'Cannot edit "x": refused for the test.', invalidValue: typed, validValue: was.displayValue };
    const real = MatlabVariableNode.prototype.setProperty;
    const spy = vi.spyOn(MatlabVariableNode.prototype, 'setProperty').mockImplementationOnce(function (this: MatlabVariableNode, key: string, text: string) {
      real.call(this, key, text);
      return refusal;
    });
    try {
      expect(edit(path, typed)).toEqual(refusal);
    } finally {
      spy.mockRestore();
    }
    expect([at(path), root.dirty, root._creation]).toEqual([was, false, undefined]);
    expect(sameBytes(save(), bytes)).toBe(true);
    expect(edit(path, typed)).toBe(true);
  });
});

describe("a member's retype, as the session tells a host of it", () => {
  it('is a change of the rows of the container that holds it, the new member selected and found by its id', () => {
    const { session, root, at, edit } = opened(containers('r2027a', 'plain'));
    const told: any[] = [];
    const deleted: any[] = [];
    session.bus.subscribe('node/children-changed', (p: any) => told.push(p.parent));
    session.bus.subscribe('node/deleted', (p: any) => deleted.push(p.node));
    const holder = at('nest.c');
    expect(edit('nest.c{1}', '"abc"')).toBe(true);
    const made = at('nest.c{1}');
    expect([told, deleted]).toEqual([[holder], []]);
    expect(session.getEntryNodes()).toEqual([made]);
    expect(session.findNodeById(made.id)).toBe(made);
    session.setActive(root, made);
    session.undo();
    expect(told).toEqual([holder, holder]);
    expect(at('nest.c{1}').className).toBe('double');
  });
});

describe("a variable's retype, as the session tells a host of it", () => {
  it('is still the delete of the one and the add of the other', () => {
    const { session, at, edit } = opened(containers('r2027a', 'plain'));
    const events: string[] = [];
    for (const name of ['node/deleted', 'node/added', 'node/children-changed']) {
      session.bus.subscribe(name, (p: any) => events.push(name + ' ' + (p.node?.name ?? p.parent?.name)));
    }
    expect(edit('ce', '"abc"')).toBe(true);
    expect([at('ce').className, events]).toEqual(['string', ['node/deleted ce', 'node/added ce']]);
  });
});

// A complex array typed into a member (#185) beside a string typed into another, and each over the
// other in one member: MATLAB R2027a loaded each save equal to the same assignments (notes "## T").
describe('a complex array and a string typed into members', () => {
  it.each([
    ['plain', [['st.a', '[1+2i 3-4i]'], ['st.b', '"abc"']]],
    ['objects', [['ce{1}', '[1+2i, 3]'], ['ce{2}', '"s"']]],
    ['strings', [['ce2{2}', '[1i 2]'], ['sa2(1).f', '[-1-2i; 5]']]],
    ['plain', [['nest.c{1}', '[1+1i 2]'], ['nest.c{1}', '"x"']]],
    ['plain', [['sa(2).f', '"x"'], ['sa(2).f', '[2-3i 4]']]],
  ] as [string, [string, string][]][])('in %s.mat, each saved and read back as it shows, and undone to the file as read', (file, edits) => {
    const bytes = containers('r2027a', file);
    const { session, at, edit, save } = opened(bytes);
    for (const [path, typed] of edits) {
      expect(edit(path, typed), path + ' = ' + typed).toBe(true);
    }
    const saved = save();
    for (const path of new Set(edits.map(([p]) => p))) {
      expect(shownAt(saved, path), path).toEqual([at(path).className, at(path).displayValue]);
    }
    for (let k = 0; k < edits.length; k++) session.undo();
    expect(sameBytes(save(), bytes)).toBe(true);
  });
});

// Strings made in two members, one of them then undone or typed away: the save merges the one left
// again, alone, into the file's subsystem (MatNode._liveCreation), and writes its text where it is
// merged now (the remap of its ids and of its text's cell). So its subsystem is the one a session
// that made it alone writes, whichever of the two it was made as; in strings.mat its ids are past
// the file's own objects.
describe('strings made in two members, one of them then left out', () => {
  const run = (bytes: Uint8Array, steps: (o: ReturnType<typeof opened>) => void) => {
    const o = opened(bytes);
    steps(o);
    return o.save();
  };
  const undo = (o: ReturnType<typeof opened>) => {
    o.session.setActive(o.root, o.root.children[0]);
    o.session.undo();
  };
  for (const file of ['plain', 'strings']) {
    it(`${file}.mat: the second undone, the first is written with its text, as made alone`, () => {
      const bytes = containers('r2027a', file);
      const saved = run(bytes, (o) => {
        expect(o.edit('st.a', '"one"')).toBe(true);
        expect(o.edit('ce{2}', '"two"')).toBe(true);
        undo(o);
      });
      expect([shownAt(saved, 'st.a'), shownAt(saved, 'ce{2}')]).toEqual([['string', '"one"'], ['char', "'two'"]]);
      const alone = run(bytes, (o) => expect(o.edit('st.a', '"one"')).toBe(true));
      expect(sameBytes(records(saved).get('')!, records(alone).get('')!)).toBe(true);
    });

    it(`${file}.mat: the first typed away, the second is written with its text, as made alone`, () => {
      const bytes = containers('r2027a', file);
      const saved = run(bytes, (o) => {
        expect(o.edit('st.a', '"one"')).toBe(true);
        expect(o.edit('ce{2}', '"two"')).toBe(true);
        expect(o.edit('st.a', '5')).toBe(true);
      });
      expect([shownAt(saved, 'st.a'), shownAt(saved, 'ce{2}')]).toEqual([['double', '5'], ['string', '"two"']]);
      const alone = run(bytes, (o) => expect(o.edit('ce{2}', '"two"')).toBe(true));
      expect(sameBytes(records(saved).get('')!, records(alone).get('')!)).toBe(true);
    });

    it(`${file}.mat: the first undone before the second is made, the second is written as made alone`, () => {
      const bytes = containers('r2027a', file);
      const saved = run(bytes, (o) => {
        expect(o.edit('st.a', '"one"')).toBe(true);
        undo(o);
        expect(o.edit('ce{2}', '"two"')).toBe(true);
      });
      expect([shownAt(saved, 'st.a'), shownAt(saved, 'ce{2}')]).toEqual([['double', '1'], ['string', '"two"']]);
      const alone = run(bytes, (o) => expect(o.edit('ce{2}', '"two"')).toBe(true));
      expect(sameBytes(saved, alone)).toBe(true);
    });

    it(`${file}.mat: one undone and redone, then another made, both written with their own text`, () => {
      const bytes = containers('r2027a', file);
      const saved = run(bytes, (o) => {
        expect(o.edit('st.a', '"one"')).toBe(true);
        undo(o);
        o.session.redo();
        expect(o.edit('ce{2}', '"two"')).toBe(true);
      });
      expect([shownAt(saved, 'st.a'), shownAt(saved, 'ce{2}')]).toEqual([['string', '"one"'], ['string', '"two"']]);
      const straight = run(bytes, (o) => {
        expect(o.edit('st.a', '"one"')).toBe(true);
        expect(o.edit('ce{2}', '"two"')).toBe(true);
      });
      expect(sameBytes(saved, straight)).toBe(true);
    });
  }
});

// The variable that holds a member made a string, renamed and then deleted: written under its new
// name, and then not at all, with nothing of the string made for it among the file's objects; and
// both undone with the edit, the file as it was read.
describe("a member's string, its variable renamed and deleted", () => {
  for (const file of ['plain', 'strings']) {
    it(`${file}.mat`, () => {
      const bytes = containers('r2027a', file);
      const { session, root, at, edit, save } = opened(bytes);
      expect(edit('st.a', '"abc"')).toBe(true);
      session.setActive(root, at('st'));
      expect(session.editProperty(at('st').id, 'Name', 'st9')).toBe(true);
      const renamed = save();
      expect([shownAt(renamed, 'st9.a'), shownAt(renamed, 'st.a')]).toEqual([['string', '"abc"'], undefined]);
      session.setActive(root, at('st9'));
      expect(session.deleteNode()).toBe(true);
      const deleted = save();
      expect(rows(deleted).some((r) => r.startsWith('st9'))).toBe(false);
      // No object made for it: the file's subsystem as read, or none, as the file held none.
      expect(records(deleted).get('')).toEqual(records(bytes).get(''));
      for (let k = 0; k < 3; k++) {
        session.setActive(root, root.children[0]);
        session.undo();
      }
      expect(sameBytes(save(), bytes)).toBe(true);
    });
  }
});
