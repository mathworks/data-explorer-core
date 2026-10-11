// Copyright 2026 The MathWorks, Inc.
//
// Past the unbacked-bytes budget a value is not written at all: not in part, not as its
// summary, not as the full empty of its shape, not as XML of its elements one by one. The
// MatBudgetError reaches whoever asked, naming the entry, the path the budget ran out at and
// the budget, so a paste (a host's parseEntry and the entry's serialization, as
// insertNewEntry does it), a copy (serialize) or a save (serializeSource) holding the value
// fails. A failed save returns nothing and changes nothing, so the save after the value is
// taken out is the save there would have been. Only a value with no bytes of its own — pasted,
// built by a host, or edited — can get here: an unedited one is the bytes it was read from.
import { describe, it, expect } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { serializeEntryToXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import { cellVar, matFile, sparseVar } from './tools/matBytes.js';
import { BINARY, TEXT, copyOf, sparseFixture, thrownBy } from './tools/pasteVenues.js';

const literals = (n: number, dims = [1, n]) => ({
  _array_type: 'Cell',
  _dimensions: dims,
  _elements: Array.from({ length: n }, () => ({ _type: 'sparse', _value: 'Matrix(0,256)\n[]' })),
  _mw_element_type: 'MATLABArray',
});
const refusal = (entry: string, at: string, what: string) =>
  `Cannot write "${entry}": ${at} is ${what}, and with it the value would add more than 16 MiB that its data does not hold, the most one value may add. Nothing was written.`;
const COLUMNS_0x256 = 'a 0x256 sparse array whose data holds none of its 256 columns';

/** A dictionary as a host holds one, and what it saves to, as text (a binary one's chunk). */
function open(file: string) {
  const session = createSession();
  const root: any = ingest(session, sparseFixture(file), { filename: file });
  const save = (): string => {
    const out = session.serializeSource(root.name)!;
    return out.kind === 'text' ? out.text! : strFromU8(unzipSync(out.bytes!)['data/chunk0.xml']);
  };
  return { session, root, design: root.getSection('design'), save };
}
/** What a host's paste does: the entry built into the section, then written in its format. */
function paste(d: ReturnType<typeof open>, value: unknown, file: string): any {
  const node = d.design.parseEntry({ name: 'pasted', metadata: { uuid: '00000000-0000-4000-e900-000000000001' }, value });
  return { node, write: () => (file === BINARY ? serializeEntryToXml(node) : node.serialize()) };
}

/**
 * A value each dictionary type can write only as a stream, past the budget, with what its
 * paste has to do before it is one: a binary dictionary's cell of 16,385 0x256 literals,
 * which it writes as a stream as pasted; and a text one's 1x1x16386 cell of a [1 2 3] and
 * 16,385 of them. A text dictionary writes a pasted value as it was pasted until an edit,
 * and a cell of rank 3 has no spelling there but its stream, so the [1 2 3] is edited.
 */
const CASES: { file: string; value: unknown; edit: (node: any) => void; at: string }[] = [
  { file: BINARY, value: literals(16385), edit: () => {}, at: 'pasted{16385}' },
  {
    file: TEXT,
    value: { ...literals(16385, [1, 1, 16386]), _elements: [[1, 2, 3], ...literals(16385)._elements] },
    edit: (node) => expect(node.children[0].children[0].setProperty('Value', '5')).toBe(true),
    at: 'pasted{16386}',
  },
];

// Each of these pastes and saves a cell of 16,385 or more sparse arrays: up to 2.4 s here,
// 3.8 s on CI's runners, close to vitest's 5 s default; give them headroom.
const HEAVY_TIMEOUT = 60_000;

describe('past the budget, a paste, a copy and a save fail, and nothing is written', () => {
  for (const { file, value, edit, at } of CASES) {
    it(`${file}: the paste fails, naming the entry, the path and the budget`, { timeout: HEAVY_TIMEOUT }, () => {
      const d = open(file);
      const p = paste(d, value, file);
      edit(p.node);
      const [thrown, ms] = thrownBy(p.write);
      expect([thrown?.name, thrown?.message, ms < 5000]).toEqual(['MatBudgetError', refusal('pasted', at, COLUMNS_0x256), true]);
    });

    it(`${file}: the save fails, returns nothing, and the save after the value is taken out is the save there would have been`, { timeout: HEAVY_TIMEOUT }, () => {
      const untouched = open(file).save();
      const d = open(file);
      const others = () => d.design.children.filter((e: any) => e.name !== 'pasted').map((e: any) => JSON.stringify(e.serialize()));
      const before = others();
      const p = paste(d, value, file);
      edit(p.node);
      let saved: unknown = 'not reached';
      const [thrown] = thrownBy(() => {
        saved = d.session.serializeSource(d.root.name);
      });
      expect([thrown?.name, thrown?.message, saved]).toEqual(['MatBudgetError', refusal('pasted', at, COLUMNS_0x256), 'not reached']);
      // Again, the same: the failed save left nothing behind to change the next one.
      expect(thrownBy(() => d.session.serializeSource(d.root.name))[0]?.message).toBe(refusal('pasted', at, COLUMNS_0x256));
      expect(others()).toEqual(before);
      d.design.removeChild(p.node);
      expect(d.save()).toBe(untouched);
    });
  }

  it('text: the copy of the edited cell fails too; a binary dictionary\'s copy is the value as it was pasted', { timeout: HEAVY_TIMEOUT }, () => {
    const [binary, text] = CASES.map(({ file, value, edit }) => {
      const p = paste(open(file), value, file);
      edit(p.node);
      return thrownBy(() => copyOf(p.node))[0];
    });
    expect([binary, text?.name, text?.message]).toEqual([null, 'MatBudgetError', refusal('pasted', 'pasted{16386}', COLUMNS_0x256)]);
  });

  it('a text dictionary keeps the same cell as a 1x16385 row, which it writes as the literals it was read as', { timeout: HEAVY_TIMEOUT }, () => {
    const d = open(TEXT);
    const p = paste(d, literals(16385), TEXT);
    expect(thrownBy(p.write)[0]).toBeNull();
    expect(thrownBy(() => d.save())[0]).toBeNull();
  });

  it('just within the budget, each of them is written', { timeout: HEAVY_TIMEOUT }, () => {
    for (const { file, value, edit } of [
      { file: BINARY, value: literals(16384), edit: () => {} },
      { ...CASES[1], value: { ...literals(16384, [1, 1, 16385]), _elements: [[1, 2, 3], ...literals(16384)._elements] } },
    ]) {
      const d = open(file);
      edit(paste(d, value, file).node);
      expect(thrownBy(() => d.save())[0], file).toBeNull();
    }
  });

  it('an edited value: a .mat cell of 1000x1000 arrays whose index held one column each, copied once its rows are edited', { timeout: HEAVY_TIMEOUT }, () => {
    // Unedited, each member is the bytes it was read from and costs nothing; edited, it is
    // encoded from its non-zeros, and 999 of its columns no data backs, 3,996 bytes apiece.
    const member = sparseVar({ name: '', dimensions: [1000, 1000], ir: [0], jc: [0, 1], real: [5], nzmax: 1, sparseFlag: true });
    const c: any = createSession().addMatSource('c.mat', matFile([cellVar('c', Array.from({ length: 4199 }, () => member))])).children[0];
    expect(thrownBy(() => copyOf(c))[0]).toBeNull();
    for (const m of c.children) expect(m.children[0].setProperty('Value', '7')).toBe(true);
    const [thrown, ms] = thrownBy(() => copyOf(c));
    expect([thrown?.name, thrown?.message, ms < 5000]).toEqual([
      'MatBudgetError',
      refusal('c', 'c{4199}', 'a 1000x1000 sparse array whose data holds 1 of its 1000 columns'),
      true,
    ]);
  });

  it('a refusal for any other reason keeps its own spelling, out of the same budget: a host cell of int8 sparse arrays', { timeout: HEAVY_TIMEOUT }, () => {
    // MatWriter has no sparse storage for int8, so each member is written full, its zeros out
    // of the budget: two 1000x1000 of them are 16 MB of zeros, three are past it.
    const int8 = () => ({
      name: '', className: 'int8', dimensions: [1000, 1000], isComplex: false, isLogical: false, isSparse: true, value: '', fields: null,
      sparse: { row: Int32Array.from([0]), col: Int32Array.from([0]), re: Float64Array.from([5]), im: null },
    });
    const hostCell = (n: number): any =>
      createSession().addMatSourceParsed('h.mat', {
        header: '',
        warnings: [],
        variables: [{ name: 'h', className: 'cell', dimensions: [1, n], isComplex: false, isLogical: false, value: Array.from({ length: n }, int8), fields: null }],
      }).children[0];
    const two = copyOf(hostCell(2)) as any;
    expect(two._elements.map((e: any) => e._type)).toEqual(['int8', 'int8']);
    const [thrown] = thrownBy(() => copyOf(hostCell(3)));
    expect([thrown?.name, thrown?.message]).toEqual([
      'MatBudgetError',
      refusal('h', 'h{3}', 'a 1000x1000 sparse array that would be written full, 999999 zeros its data does not hold'),
    ]);
  });
});

describe('what a refused write throws is the package\'s own, exported', () => {
  it('a save past the budget throws the MatBudgetError the package entry point exports, a MatWriteError too', { timeout: HEAVY_TIMEOUT }, async () => {
    const index = await import('../src/index.js');
    const d = open(BINARY);
    paste(d, literals(16385), BINARY);
    const [thrown] = thrownBy(() => d.session.serializeSource(d.root.name));
    expect([thrown instanceof index.MatBudgetError, thrown instanceof index.MatWriteError]).toEqual([true, true]);
    const e = thrown as InstanceType<typeof index.MatBudgetError>;
    expect([e.entry, e.at, e.what, e.counted]).toEqual(['pasted', 'pasted{16385}', COLUMNS_0x256, true]);
  });
});
