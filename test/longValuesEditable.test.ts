// Copyright 2026 The MathWorks, Inc.
//
// A value shown as a summary only for its size takes an editor of its text written out whole (the
// D13 ruling of the 2026-10-26 edit bash): the row says so (`_hasEditText`), and the host fetches
// the text as the editor opens (session.editText, the D14 ruling). A value typed
// long showed its summary, `<1x500 double>`, and once saved and opened again its row took no
// editor of its Value, in every format (the edit bash's sweep: 363 dictionary cases, 236 MAT-file
// ones). The summary is still what the row shows, the same after the edit and after a reopen; the
// seed set back unchanged is no edit; an element changed in it saves exactly; and a value no text
// spells, or one too long to edit as text, keeps its lock.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { EDIT_TEXT_MAX_CHARS, spelledWhole } from '../src/datamodel/display/DisplayConvention.js';
import { elementNamed, encodeMatVariable } from '../src/datamodel/parser/MatWriter.js';
import { keptVerdict, sourceValuesChanged, valueChanged, verdictsJudged } from '../src/datamodel/node/valueGeneration.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TEST_ROOT = fileURLToPath(new URL('.', import.meta.url));
const FILES = ['r2027a/values.mat', 'r2023b/values.mat', 'r2027a/values_text.sldd', 'r2027a/values_binary.sldd', 'r2023b/values_binary.sldd'];

function opened(file: string, given?: Uint8Array) {
  const session = createSession();
  const bytes = given ?? new Uint8Array(readFileSync(file.startsWith('/') ? file : join(TEST_ROOT, 'fixtures/edit-bash', file)));
  const root: any = ingest(session, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { filename: file.split('/').pop()! });
  const at = (path: string) => root.flatten().find((n: any) => n.matlabPath === path && !n.isContainer);
  const save = (): Uint8Array => {
    const out: any = session.serializeSource(root.name);
    return out.bytes ?? new TextEncoder().encode(out.text);
  };
  const edit = (path: string, text: string) => {
    const node = at(path);
    session.setActive(root, node);
    const result = session.editProperty(node.id, 'Value', text);
    session.setActive(root, null);
    return result;
  };
  const row = (path: string) => {
    const node = at(path);
    const r = node.toRow();
    // The seed, fetched where the row says it has one, and only there.
    const fetched = session.editText(node.id);
    expect(fetched !== null, path).toBe(r._hasEditText === true);
    return { shown: r.Value as string, editable: r._valueEditable as boolean, seed: fetched ?? undefined, cls: r.Class as string };
  };
  return { session, root, at, save, edit, row, reopen: () => opened(file, save()) };
}

const isSummary = (text: string) => text.startsWith('<') && text.endsWith('>');
const digits = (n: number) => Array.from({ length: n }, (_, i) => String(i % 10)).join(' ');
const strings = (n: number) => Array.from({ length: n }, (_, i) => '"' + String.fromCharCode(97 + (i % 26)) + '"');

// The first number 0 of a text, made 7: an element changed, spelled as the value then shows it.
const firstZeroToSeven = (text: string) => text.replace(/(?<![\d.])0(?![\d.])/, '7');

// [row, text typed, how one element of its text changes]
const CASES: [string, string, (t: string) => string][] = [
  ['dScalar', '[' + digits(500) + ']', firstZeroToSeven],
  ['i8', '[' + digits(11) + ']', firstZeroToSeven],
  ['sgl', '[' + digits(11) + ']', firstZeroToSeven],
  ['lScalar', '[' + Array.from({ length: 11 }, (_, i) => (i % 2 ? 'true' : 'false')).join(' ') + ']', (t) => t.replace('false', 'true')],
  ['dRow', '[1+2i ' + digits(11) + ']', firstZeroToSeven],
  ['d2x3', '[' + digits(6) + '; ' + digits(6) + ']', firstZeroToSeven],
  ['chRow', "'" + 'x'.repeat(2000) + "'", (t) => t.replace('x', 'y')],
  ['strScalar', '"' + 'x'.repeat(2000) + '"', (t) => t.replace('x', 'y')],
  ['strRow', '[' + strings(11).join(' ') + ']', (t) => t.replace('"a"', '"z"')],
  ['cEmpty', '{' + digits(11).split(' ').join(', ') + '}', firstZeroToSeven],
  ['cEmpty', '{1, [' + digits(12) + ']}', firstZeroToSeven],
  ['cEmpty', '{1, int8([' + digits(12) + '])}', firstZeroToSeven],
  ['cEmpty', '{' + strings(11).join(', ') + '}', (t) => t.replace('"a"', '"z"')],
  ['sLeaves.dScalar', '[' + digits(500) + ']', firstZeroToSeven],
  ['sLeaves.i8', '[' + digits(11) + ']', firstZeroToSeven],
  ['sLeaves.chRow', "'" + 'x'.repeat(2000) + "'", (t) => t.replace('x', 'y')],
  ['cLeaves{1}', '[' + digits(500) + ']', firstZeroToSeven],
  ['cLeaves{12}', '[' + digits(11) + ']', firstZeroToSeven],
  ['pInt8', '[' + digits(11) + ']', firstZeroToSeven],
  ['pInt8.Value', '[' + digits(11) + ']', firstZeroToSeven],
  ['pMatrix', '[' + digits(6) + '; ' + digits(6) + ']', firstZeroToSeven],
  ['pStruct.Value.inner.y', '[' + digits(11) + ']', firstZeroToSeven],
];

describe('a value typed long, saved and opened again, takes an editor of its whole text', () => {
  for (const file of FILES) {
    for (const [path, text, change] of CASES) {
      it(`${file} ${path} := ${text.slice(0, 24)}...`, () => {
        const o = opened(file);
        expect(o.edit(path, text)).toBe(true);
        const after = o.row(path);
        const re = o.reopen();
        const back = re.row(path);
        // The summary, the same after the edit and after the reopen, and an editor of its whole text.
        expect(isSummary(back.shown) || back.shown.includes('<')).toBe(true);
        expect([after.shown, after.cls, after.seed]).toEqual([back.shown, back.cls, back.seed]);
        expect(back.editable).toBe(true);
        expect(typeof back.seed).toBe('string');
        // Set back unchanged it is no edit: nothing to undo, the file as it was read.
        const node = re.at(path);
        expect(re.session.isUnchangedEdit(node.id, 'Value', back.seed!)).toBe(true);
        const read = re.save();
        expect(re.edit(path, back.seed!)).toBe(true);
        expect([re.session.canUndo(), re.root.dirty === true, Buffer.from(re.save()).equals(Buffer.from(read))]).toEqual([false, false, true]);
        // Typed again through the setter (a leading space is another text of the same value), it
        // makes the same value: saved and opened again, the same text, class and summary.
        expect(re.edit(path, ' ' + back.seed!)).toBe(true);
        expect(re.reopen().row(path)).toEqual(back);
        // An element changed in it is that element changed, and nothing else.
        const changed = change(back.seed!);
        expect(changed).not.toBe(back.seed);
        expect(re.edit(path, changed)).toBe(true);
        const third = re.reopen().row(path);
        expect([third.seed, third.cls, third.editable]).toEqual([changed, back.cls, true]);
      });
    }
  }
});

// An empty logical shows its size and class, `<1x0 logical>`, as MATLAB's Workspace browser does (the
// 2026-10-15 ruling, kept by D12), and its editor is seeded with the text MATLAB makes it of,
// `false(1,0)`, where that text set as its Value is taken and makes it exactly: everywhere but a
// text dictionary's shaped one, which a text dictionary holds typed only as a 0x0 one (D15).
// A Simulink.Parameter's Value row is edited as the Parameter's Value is, MATLAB's `p.Value = v`,
// which keeps no class: `[1 2 ...]` there makes a double. So the row's seed is the Parameter's own,
// spelled with its class where the bare text would make another value (the review's G3).
describe("a Parameter's Value row is seeded as the Parameter is", () => {
  for (const file of FILES) {
    for (const cls of ['int8', 'single']) {
      it(`${file}: a 1x11 ${cls} Value, its seed typed back at the Value row and at the Parameter`, () => {
        const o = opened(file);
        const text = cls + '([' + digits(11) + '])';
        expect(o.edit('pInt8', text)).toBe(true);
        const re = o.reopen();
        expect([re.row('pInt8').seed, re.row('pInt8.Value').seed]).toEqual([text, text]);
        expect(re.session.isUnchangedEdit(re.at('pInt8.Value').id, 'Value', text)).toBe(true);
        for (const path of ['pInt8.Value', 'pInt8']) {
          const again = re.reopen();
          expect(again.edit(path, text + ' ')).toBe(true);
          const back = again.reopen();
          expect([path, back.row('pInt8.Value').cls, back.row('pInt8.Value').seed]).toEqual([path, cls, text]);
        }
        // As a dictionary's editor sets it, through the node's setter.
        const direct = re.reopen();
        const n = direct.at('pInt8.Value');
        let entry = n;
        while (!entry.isEntry) entry = entry.parent;
        expect(direct.session.mutateSubtree(entry, () => n.setProperty('Value', text + ' '))).toBe(true);
        expect(direct.reopen().row('pInt8.Value').cls).toBe(cls);
      });
    }
  }
});

describe('an empty logical takes an editor of the text MATLAB makes it of', () => {
  const BINARY_OBJECTS = join(TEST_ROOT, 'fixtures/text_empty_readback_binary.sldd');
  const cases: [string, string, string, string][] = [
    ['lArray', 'false(1,0)', '<1x0 logical>', 'false(0,2)'],
    ['lArray', 'false(0,3)', '<0x3 logical>', 'false(1,0)'],
    ['lArray', 'false(0,0)', '<0x0 logical>', 'false(2,0)'],
    ['sLeaves.lArray', 'false(0,3)', '<0x3 logical>', 'false(0,0)'],
    ['cLeaves{1}', 'false(1,0)', '<1x0 logical>', 'false(0,3)'],
  ];
  for (const file of ['r2027a/values.mat', 'r2023b/values.mat', 'r2027a/values_binary.sldd', 'r2023b/values_binary.sldd']) {
    for (const [path, text, shown, other] of cases) {
      it(`${file} ${path} := ${text}`, () => {
        const o = opened(file);
        expect(o.edit(path, text)).toBe(true);
        const re = o.reopen();
        const back = re.row(path);
        expect(back).toEqual({ shown, editable: true, seed: text, cls: 'logical' });
        expect([re.session.isUnchangedEdit(re.at(path).id, 'Value', text), re.session.valueEditRefusal(re.at(path).id)]).toEqual([true, null]);
        expect(re.edit(path, ' ' + text)).toBe(true);
        expect(re.reopen().row(path)).toEqual(back);
        expect(re.edit(path, other)).toBe(true);
        expect(re.reopen().row(path).seed).toBe(other);
      });
    }
  }

  it('in a text dictionary: a 0x0 one keeps its class and its seed; a shaped one is not typed', () => {
    const o = opened('r2027a/values_text.sldd');
    expect(o.edit('lArray', 'false(0,0)')).toBe(true);
    const re = o.reopen();
    expect(re.row('lArray')).toEqual({ shown: '<0x0 logical>', editable: true, seed: 'false(0,0)', cls: 'logical' });
    expect(re.edit('lArray', 'false(1,0)')).toMatchObject({ error: true, reason: expect.stringContaining('which a text dictionary holds only as a 0x0 one') });
  });

  it('in a text dictionary, a shaped one made otherwise takes no editor, and says why as its setter does', () => {
    const o = opened('r2027a/values_text.sldd');
    const n = o.at('lArray');
    // Made as no text dictionary reads one, which a value pasted from another source may be.
    o.session.mutateSubtree(n, () => {
      n.children = [];
      n._elements = [];
      n._dims = [1, 0];
    });
    expect(o.row('lArray')).toEqual({ shown: '<1x0 logical>', editable: false, seed: undefined, cls: 'logical' });
    expect(o.session.valueEditRefusal(n.id)).toBe(
      'Cannot edit the Value of "lArray": lArray would be a 1x0 logical, which a text dictionary holds only as a 0x0 one.',
    );
  });

  it("an object's property in a binary dictionary, its seed typed again and other shaped empties saved as typed", () => {
    for (const [text, cls] of [['false(1,0)', 'logical'], ['zeros(0,3)', 'double'], ["zeros(1,0,'int8')", 'int8']]) {
      const o = opened(BINARY_OBJECTS);
      expect(o.edit('w_Lg.Scalar', ' ' + text)).toBe(true);
      const back = o.reopen().at('w_Lg.Scalar');
      expect([text, back.className, back._dims]).toEqual([text, cls, text === 'zeros(0,3)' ? [0, 3] : [1, 0]]);
    }
    const o = opened(BINARY_OBJECTS);
    expect(o.row('w_Lg.Scalar')).toEqual({ shown: '<1x0 logical>', editable: true, seed: 'false(1,0)', cls: 'logical' });
  });

  it('an empty enumeration keeps its lock, with its reason', () => {
    const o = opened(join(TEST_ROOT, 'fixtures/display/dispcat_text.sldd'));
    expect(o.session.valueEditRefusal(o.at('dx_enum_0x0').id)).toBe(
      'Cannot edit the Value of "dx_enum_0x0": it is an empty matlab.lang.OnOffSwitchState array, shown as MATLAB shows it and not edited here.',
    );
  });
});

describe('a value too long to edit as text, or one no text spells, keeps its lock, and says why', () => {
  for (const file of ['r2027a/values.mat', 'r2027a/values_text.sldd']) {
    it(`${file}: a 1x120000 double, past ${EDIT_TEXT_MAX_CHARS} characters, shows its summary and takes no editor`, () => {
      const o = opened(file);
      expect(o.edit('dScalar', '[' + digits(120000) + ']')).toBe(true);
      const re = o.reopen();
      expect(re.row('dScalar')).toEqual({ shown: '<1x120000 double>', editable: false, seed: undefined, cls: 'double' });
      expect(re.session.valueEditRefusal(re.at('dScalar').id)).toBe(
        'Cannot edit the Value of "dScalar": its text would be longer than the 200,000 characters an editor of it takes: its elements are edited one at a time.',
      );
    });
  }

  it('an N-D array, a struct, a sparse array and a <missing> string take none, each named with its reason', () => {
    const o = opened('r2027a/values.mat');
    const why = (path: string) => [o.row(path).editable, o.row(path).seed, o.session.valueEditRefusal(o.at(path).id)];
    expect(why('nd2x2x2')).toEqual([false, undefined, 'Cannot edit the Value of "nd2x2x2": it is a 2x2x2 double array, which no text spells: its elements are edited one at a time.']);
    expect(why('sLeaves')).toEqual([false, undefined, 'Cannot edit the Value of "sLeaves": it is a struct, whose fields are edited one at a time.']);
    expect(why('spMatrix')).toEqual([false, undefined, 'Cannot edit the Value of "spMatrix": it is a sparse array, which no text spells: its non-zeros are edited one at a time.']);
    expect(why('strMissing')).toEqual([false, undefined, 'Cannot edit the Value of "strMissing": it holds <missing>, which no text spells: its elements are edited one at a time.']);
    expect(why('cLeaves')).toEqual([false, undefined, 'Cannot edit the Value of "cLeaves": it holds an element no text spells: its elements are edited one at a time.']);
  });

  it('is null where the Value takes an editor, a summary of size alone included, and names an id no row has', () => {
    const o = opened('r2027a/values.mat');
    expect(o.session.valueEditRefusal(o.at('dScalar').id)).toBeNull();
    expect(o.edit('dScalar', '[' + digits(500) + ']')).toBe(true);
    expect(o.session.valueEditRefusal(o.at('dScalar').id)).toBeNull();
    expect(o.session.valueEditRefusal('nowhere/x')).toBe('Cannot edit "nowhere/x": no row of that id is open.');
  });
});

// Every row of every fixture whose Value shows a summary, or a cell's literal holding one.
function fixtureFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) {
        walk(p);
      } else if (/\.(mat|sldd)$/.test(e)) {
        out.push(p);
      }
    }
  };
  walk(join(TEST_ROOT, 'fixtures'));
  return out;
}

describe('every row of every fixture that shows a summary', () => {
  it('takes an editor only with its whole text; that text is no edit, and typed again makes the same value', () => {
    let summaries = 0;
    const seeded: string[] = [];
    const wrong: string[] = [];
    for (const file of fixtureFiles()) {
      let o: ReturnType<typeof opened>;
      try {
        o = opened(file);
      } catch {
        continue;
      }
      const label = file.slice(join(TEST_ROOT, 'fixtures').length + 1);
      for (const node of o.root.flatten().filter((n: any) => !n.isContainer)) {
        const r = node.toRow?.();
        const shown = r && typeof r.Value === 'string' ? r.Value : null;
        if (shown === null || !(isSummary(shown) || (shown.startsWith('{') && shown.includes('<')))) {
          continue;
        }
        summaries++;
        const seed = o.session.editText(node.id);
        if ((seed !== null) !== (r._hasEditText === true)) wrong.push(`${label} ${node.matlabPath}: the row's flag and editText disagree`);
        if (seed === null) {
          if (r._valueEditable && isSummary(shown)) wrong.push(`${label} ${node.matlabPath}: an editor of ${shown} with no text to seed it`);
          continue;
        }
        seeded.push(label + ' ' + node.matlabPath);
        if (!r._valueEditable) wrong.push(`${label} ${node.matlabPath}: a seed on a row that takes no editor`);
        if (!o.session.isUnchangedEdit(node.id, 'Value', seed)) wrong.push(`${label} ${node.matlabPath}: its seed is an edit`);
        const fresh = opened(file);
        if (fresh.edit(node.matlabPath, ' ' + seed) !== true) {
          wrong.push(`${label} ${node.matlabPath}: its seed typed again is refused`);
          continue;
        }
        const back = fresh.reopen().row(node.matlabPath);
        if (back.seed !== seed || back.cls !== r.Class || back.shown !== shown) {
          wrong.push(`${label} ${node.matlabPath}: typed again, it reopened as ${JSON.stringify(back).slice(0, 120)}`);
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(summaries).toBeGreaterThan(40000);
    expect(seeded.length).toBeGreaterThanOrEqual(20);
  }, 120000);
});

// Each row of `o` that says it has a seed is seeded with its value's text spelled now, of the value
// as it stands, and no older text of it.
function expectSeedsSpelledNow(o: ReturnType<typeof opened>, label: string): void {
  for (const node of o.root.flatten().filter((n: any) => !n.isContainer && typeof n._kind === 'string')) {
    const r = node.toRow();
    if (!r._hasEditText) continue;
    const now = spelledWhole(() => node.displayValue);
    expect(o.session.editText(node.id), `${label}: ${node.matlabPath}`).toBe(now);
  }
}

// The seed is judged once of a value and kept until an edit, an undo or a redo in its entry, or a
// change in its source of what is in no entry, may have changed it (valueGeneration, the D14
// ruling). After every step of edits, Adds, removals, nested edits, renames, undos and redos, each
// seed is the value's text spelled now.
describe('the seed kept for a value is never stale', () => {
  const steps = (o: ReturnType<typeof opened>): [string, () => unknown][] => {
    const undo = () => (o.session.undo(), true);
    const redo = () => (o.session.redo(), true);
    return [
      ['typed long', () => o.edit('dScalar', '[' + digits(500) + ']')],
      ['an element edited', () => o.edit('dScalar(3)', '9')],
      ['an element added', () => o.session.addChildTo(o.at('dScalar').id)],
      ['an element deleted', () => o.session.deleteNodeById(o.at('dScalar(1)').id)],
      ['undone', undo],
      ['undone again', undo],
      ['redone', redo],
      ['a cell typed', () => o.edit('cEmpty', '{1, [' + digits(12) + ']}')],
      ['a nested element edited', () => o.edit('cEmpty{2}(1)', '5')],
      ['undone', undo],
      ['redone', redo],
      ['a field typed long', () => o.edit('sLeaves.dScalar', '[' + digits(20) + ']')],
      ['the field renamed', () => {
        const n = o.at('sLeaves.dScalar');
        o.session.setActive(o.root, n);
        return o.session.editProperty(n.id, 'Name', 'dRenamed');
      }],
      ['its element edited', () => o.edit('sLeaves.dRenamed(2)', '8')],
      ['typed long again, over a long value', () => o.edit('dScalar', '[' + digits(300) + ']')],
      ['undone, back to the long value it was', undo],
      ['redone', redo],
      ['a cell typed over a long cell', () => o.edit('cEmpty', '{2, [' + digits(15) + ']}')],
      ['undone', undo],
      // A host's own undo, as a dictionary's editor makes one: the value put back as it stood, through
      // mutateSubtree, which marks nothing edited.
      ['put back by a host', () => {
        const n = o.at('dScalar');
        const restore = n._restorerFor('Value');
        o.edit('dScalar', '[' + digits(40) + ']');
        // Judged of the value the host then puts back over.
        expect(o.session.editText(n.id)).toBe('[' + digits(40) + ']');
        return o.session.mutateSubtree(n, () => (restore(), true));
      }],
      ['a Parameter Value typed long', () => o.edit('pInt8.Value', '[' + digits(11) + ']')],
      ['and again', () => o.edit('pInt8.Value', '[' + digits(13) + ']')],
      ['undone', undo],
      ['its element edited', () => o.edit('pInt8.Value(2)', '6')],
      ['undone', undo],
      ['undone again', undo],
    ];
  };
  for (const file of FILES) {
    it(`${file}`, () => {
      const o = opened(file);
      for (const [label, step] of steps(o)) {
        o.session.setActive(o.root, null);
        expect(step(), label).toBeTruthy();
        expectSeedsSpelledNow(o, label);
      }
    });
  }
});

describe('a value shown by two nodes of one object (a MAT-file handle held twice)', () => {
  const TWINS = join(TEST_ROOT, 'fixtures/mat-twins/twins.mat');
  it('keeps the seed of the node edited fresh, and names the twin the edit is made through', () => {
    const o = opened(TWINS);
    expect(o.edit('q.Value', '[' + digits(20) + ']')).toBe(true);
    expectSeedsSpelledNow(o, 'typed long');
    expect(o.edit('q.Value(3)', '9')).toBe(true);
    expectSeedsSpelledNow(o, 'an element edited');
    o.session.undo();
    expectSeedsSpelledNow(o, 'undone');
    o.session.redo();
    expectSeedsSpelledNow(o, 'redone');
    expect(o.row('q.Value').seed).toBe('[0 1 9' + digits(20).slice(5) + ']');
    // The twin shows the edit and takes none of its own, saying through which node it is made.
    expect([o.row('q2.Value').shown, o.row('q2.Value').editable]).toEqual(['<1x20 double>', false]);
    expect(o.session.valueEditRefusal(o.at('q2.Value').id)).toBe(
      'Cannot edit the Value of "q2.Value": q2 is one object with q (one handle), and q holds an edit of it: the object is edited through q, and q2 shows each edit.',
    );
  });
});

describe('every row whose Value takes no editor says why, in its own words', () => {
  it('a struct, a value of no value, an object', () => {
    const o = opened('r2027a/values_text.sldd');
    const why = (path: string) => o.session.valueEditRefusal(o.at(path).id);
    expect(why('sLeaves')).toBe('Cannot edit the Value of "sLeaves": it is a struct, whose fields are edited one at a time.');
    expect(why('bus')).toBe('Cannot edit the Value of "bus": it has no value of its own to edit here.');
    expect(why('cHoldsParam')).toBe('Cannot edit the Value of "cHoldsParam": it holds an element no text spells: its elements are edited one at a time.');
  });
});

describe('a verdict kept for the generations it was judged at (valueGeneration)', () => {
  it('is judged again once its entry or its source moves on, and an entry-less node goes by its top', () => {
    const top: any = { parent: null };
    const entry: any = { parent: top, owningEntry: null };
    entry.owningEntry = entry;
    const node: any = { parent: entry, owningEntry: entry };
    let judged = 0;
    const ask = () => keptVerdict(node, () => ++judged);
    expect([ask(), ask()]).toEqual([1, 1]);
    valueChanged(entry);
    expect([ask(), ask()]).toEqual([2, 2]);
    sourceValuesChanged(node);
    expect(ask()).toBe(3);
    const loose: any = { parent: { parent: null } };
    const looseAsk = () => keptVerdict(loose, () => ++judged);
    expect(looseAsk()).toBe(4);
    sourceValuesChanged(loose);
    expect(looseAsk()).toBe(5);
  });

  it("a host's own edit through mutateSubtree, marked or not, has the value judged again", () => {
    const o = opened('r2027a/values.mat');
    expect(o.edit('dScalar', '[' + digits(20) + ']')).toBe(true);
    const n = o.at('dScalar');
    expect(o.session.editText(n.id)).toBe('[' + digits(20) + ']');
    // Changed as no setter changes it, and marked as nothing: the session's bracket is all there is.
    o.session.mutateSubtree(n, () => {
      n.children[0]._scalarValue = 7;
    });
    expect(o.session.editText(n.id)).toBe('[7' + digits(20).slice(1) + ']');
  });
});

// What a row costs: a flag, not the text (the D14 ruling), and a value judged once.
describe('rows of many long values', () => {
  const matFile = (records: Uint8Array[]): ArrayBuffer => {
    const header = new Uint8Array(128);
    header.fill(0x20, 0, 116);
    header.set(new TextEncoder().encode('MATLAB 5.0 MAT-file, built by test/longValuesEditable.test.ts'), 0);
    header.set([0x00, 0x01, 0x49, 0x4d], 124);
    const out = new Uint8Array(128 + records.reduce((n, r) => n + r.length, 0));
    out.set(header, 0);
    let at = 128;
    for (const r of records) {
      out.set(r, at);
      at += r.length;
    }
    return out.buffer;
  };
  const variable = (name: string, n: number) =>
    elementNamed(encodeMatVariable({ name, className: 'double', dimensions: [1, n], isComplex: false, isLogical: false, value: Array.from({ length: n }, (_, i) => i * 0.5) } as any), name)!;

  it('1000 variables of 1x500 doubles: each row a flag, the rows small, built again fast', () => {
    const session = createSession();
    const root: any = ingest(session, matFile(Array.from({ length: 1000 }, (_, i) => variable('v' + i, 500))), { filename: 'many.mat' });
    const top = root.children;
    expect(top.length).toBe(1000);
    let t0 = performance.now();
    const rows = top.map((n: any) => n.toRow());
    const first = performance.now() - t0;
    expect(rows.every((r: any) => r._hasEditText === true && r.Value === '<1x500 double>')).toBe(true);
    // A flag, not 1000 texts of 4,000 characters each.
    expect(JSON.stringify(rows).length).toBeLessThan(1_000_000);
    t0 = performance.now();
    top.forEach((n: any) => n.toRow());
    const again = performance.now() - t0;
    // Generous bounds, for a loaded machine: judged once, the second build is no dearer than rows
    // that hold no long value (measured some 50 ms here, 217 ms when each judged its value again).
    expect(first).toBeLessThan(10_000);
    expect(again).toBeLessThan(1_000);
    expect(session.editText(top[7].id)).toBe('[' + Array.from({ length: 500 }, (_, i) => String(i * 0.5)).join(' ') + ']');
    // One element edited, then undone: only the variable it is in is judged again, not the file.
    const element = top[7].children[2];
    session.setActive(root, element);
    expect(session.editProperty(element.id, 'Value', '9')).toBe(true);
    let judged = verdictsJudged();
    top.forEach((n: any) => n.toRow());
    expect(verdictsJudged() - judged).toBe(1);
    expect(session.editText(top[7].id)!.startsWith('[0 0.5 9 1.5')).toBe(true);
    session.setActive(root, null);
    session.undo();
    judged = verdictsJudged();
    top.forEach((n: any) => n.toRow());
    expect(verdictsJudged() - judged).toBe(1);
    expect(session.editText(top[7].id)!.startsWith('[0 0.5 1 1.5')).toBe(true);
  });

  it('a 1x100000 double, too long to edit as text, is judged so without being spelled, once', () => {
    const session = createSession();
    const root: any = ingest(session, matFile([variable('big', 100_000)]), { filename: 'big.mat' });
    const node = root.children[0];
    let t0 = performance.now();
    const row = node.toRow();
    const first = performance.now() - t0;
    expect([row.Value, row._valueEditable, row._hasEditText]).toEqual(['<1x100000 double>', false, undefined]);
    t0 = performance.now();
    for (let i = 0; i < 20; i++) node.toRow();
    const each = (performance.now() - t0) / 20;
    expect(first).toBeLessThan(2_000);
    expect(each).toBeLessThan(50);
  });
});
