// Copyright 2026 The MathWorks, Inc.
//
// A Simulink.Parameter's Value typed as an empty, shown after the edit as it is after a save and a
// reopen, and as MATLAB holds it (R3 of the 2026-10-26 edit bash). MATLAB's `p.Value = v` leaves
// Dimensions and Complexity as they were where v is empty, but that an empty over an empty sets the
// Dimensions to its size (parity/matlab/probe_parameter_empty_value.m; R2023b the same). A
// MAT-file's save wrote the Complexity 'real' of every empty typed over a complex Value, which the
// row showed only once reopened; its reader read a Value of zeros(0,3) as a 0x0 double, which its
// gate then found was not the value the file holds, so the row reopened read-only; and zeros(0,3)
// typed on the Parameter's own row was saved a 0x0 double, as it was in a binary dictionary, whose
// writer wrote a Value of any empty as `Dimension="0*0"`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import '../src/datamodel/node/data/NodeClassMap.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TEST = fileURLToPath(new URL('.', import.meta.url));

const TRUTH: {
  release: string;
  cases: { from: string; to: string; dimensionsBefore: number[]; dimensions: number[]; complexityBefore: string; complexity: string }[];
  chains: { steps: string[]; reloaded: boolean; dimensions: number[][]; complexity: string[] }[];
} = JSON.parse(
  readFileSync(TEST + 'parity/matlab/parameter_empty_value.truth.json', 'utf8'),
);

function opened(rel: string, bytes: Uint8Array = new Uint8Array(readFileSync(TEST + rel))) {
  const session = createSession();
  const root: any = ingest(session, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { filename: rel.split('/').pop()! });
  const at = (path: string): any => root.flatten().find((n: any) => n.matlabPath === path && !n.isContainer);
  const edit = (path: string, text: string) => {
    session.setActive(root, at(path));
    return session.editProperty(at(path).id, 'Value', text);
  };
  const save = (): Uint8Array => {
    const out: any = session.serializeSource(root.name);
    return out.kind === 'text' ? new TextEncoder().encode(out.text) : out.bytes;
  };
  return { session, root, at, edit, save };
}

/** The Parameter's row as a host shows it, and the size and class of the Value it holds. */
function view(o: ReturnType<typeof opened>, name: string) {
  const p = o.at(name);
  const row = p.toRow();
  const cell = (c: any) => (c && typeof c === 'object' ? c.text : c);
  return {
    value: cell(row.Value),
    editable: row._valueEditable,
    dimensions: cell(row.dimensions),
    complexity: cell(row.complexity),
    // A Value held bare as `[]` is a 0x0 double, as one held in a node of its own is.
    held: p._valueNode ? [p._valueNode.className, p._valueNode._dims.join('x')] : Array.isArray(p.Value) && p.Value.length === 0 ? ['double', '0x0'] : [typeof p.Value, null],
  };
}

const matrix = (d: number[]) => '[' + d.join(' ') + ']';

describe("MATLAB's p.Value = v, where v or the Value it replaces is empty", () => {
  it('leaves Dimensions and Complexity as they were, but the Dimensions of an empty over an empty', () => {
    expect(TRUTH.release).toBe('(R2027a)');
    const empty = (text: string) => /^(\[\]|zeros\(|false\(|single\(\[\]\)|complex\(zeros)/.test(text);
    for (const c of TRUTH.cases) {
      const label = c.from + ' -> ' + c.to;
      if (!empty(c.to)) {
        // The CONTROLS: a Value that is not empty sets them, here each time to another.
        expect(c.complexity !== c.complexityBefore || c.dimensions.join('x') !== c.dimensionsBefore.join('x'), label).toBe(true);
        continue;
      }
      expect(c.complexity, label).toBe(c.complexityBefore);
      expect(c.dimensions.join('x') === c.dimensionsBefore.join('x'), label).toBe(!empty(c.from));
    }
  });
});

describe("a Parameter's Value typed as an empty shows, after the edit, what it shows reopened, as MATLAB holds it", () => {
  const COMPLEX = TRUTH.cases.filter((c) => c.from === '[1+2i 3-4i]' && ['[]', 'zeros(0,3)', 'false(1,0)'].includes(c.to));
  const HELD: Record<string, [string, string]> = { '[]': ['double', '0x0'], 'zeros(0,3)': ['double', '0x3'], 'false(1,0)': ['logical', '1x0'] };
  for (const file of ['fixtures/edit-bash/r2027a/values.mat', 'fixtures/edit-bash/r2023b/values.mat', 'fixtures/edit-bash/r2027a/values_binary.sldd']) {
    for (const at of ['pComplex', 'pComplex.Value']) {
      it(`${file}: typed at ${at}`, () => {
        expect(COMPLEX).toHaveLength(3);
        for (const c of COMPLEX) {
          const o = opened(file);
          expect(o.edit(at, c.to), c.to).toBe(true);
          const after = view(o, 'pComplex');
          const back = view(opened(file, o.save()), 'pComplex');
          expect(back, c.to + ' reopened').toEqual(after);
          expect([after.dimensions, after.complexity], c.to).toEqual([matrix(c.dimensions), c.complexity]);
          // An empty the row shows as `[ ]` takes an edit; a logical one is its summary, which takes none.
          expect([after.held, after.editable], c.to).toEqual([HELD[c.to], c.to !== 'false(1,0)']);
        }
      });
    }
  }

  it('an empty typed over an empty Value sets its Dimensions to its size, shown so after the edit', () => {
    for (const release of ['r23', 'r24', 'r27']) {
      const file = `fixtures/mcos-rules-parity/originals/${release}_pz.mat`;
      const o = opened(file);
      const c = TRUTH.cases.find((x) => x.from === 'zeros(1,0)' && x.to === '[]')!;
      expect(view(o, 'p').dimensions, file).toBe(matrix(c.dimensionsBefore));
      expect(o.edit('p', '[]'), file).toBe(true);
      const after = view(o, 'p');
      expect(after.dimensions, file).toBe(matrix(c.dimensions));
      expect(view(opened(file, o.save()), 'p'), file).toEqual(after);
    }
  });
});

// The oracle's 15 cases of the edit bash's full2 run: zeros(0,3) typed as a Parameter's Value was
// saved a 0x0 double in a MAT-file and a binary dictionary alike, wherever the Parameter stood (a
// variable, a cell's element, a struct's field) and wherever it was typed (its row, its Value's).
// A text dictionary refuses each (test/textDictionaryEmpties.test.ts).
describe("a Parameter's Value typed as a shaped empty keeps its size and class, wherever it stands", () => {
  const TYPED: [string, [string, string]][] = [
    ['zeros(0,3)', ['double', '0x3']],
    ["zeros(1,0,'int8')", ['int8', '1x0']],
    ['false(1,0)', ['logical', '1x0']],
  ];
  for (const file of ['fixtures/edit-bash/r2027a/values.mat', 'fixtures/edit-bash/r2023b/values.mat', 'fixtures/edit-bash/r2027a/values_binary.sldd']) {
    it(file, () => {
      for (const path of ['pProps', 'cHoldsParam{1}', 'sHoldsParam.p', 'pMatrix', 'pComplex.Value']) {
        const parameter = path.replace(/\.Value$/, '');
        for (const [text, held] of TYPED) {
          // pProps' Max of 10 would be outside its DataType's range once a logical Value makes that
          // 'boolean', which a MAT-file refuses (D10); a dictionary takes it, as MATLAB does.
          if (path === 'pProps' && text === 'false(1,0)' && file.endsWith('.mat')) {
            continue;
          }
          const o = opened(file);
          expect(o.edit(path, text), path + ' = ' + text).toBe(true);
          expect(view(o, parameter).held, path + ' = ' + text).toEqual(held);
          expect(view(opened(file, o.save()), parameter), path + ' = ' + text + ' reopened').toEqual(view(o, parameter));
        }
      }
    });
  }
});

// The review of offered-gate: the save of an empty typed over an empty set the Dimensions to its size
// where the Value it replaced was empty, whatever Dimensions it held; MATLAB keys it on those: 5,
// then zeros(0,3), then [] leaves [1 1], saved and loaded between or not (R2027a and R2023b alike).
describe('an empty typed over an empty Value follows the Dimensions it holds, as MATLAB does', () => {
  it('in MATLAB: its size where they are an empty\'s (a 0 in them), else as they were', () => {
    expect(TRUTH.chains).toHaveLength(8);
    const SIZE: Record<string, string> = { '[]': '0x0', 'zeros(0,3)': '0x3', 'zeros(1,0)': '1x0', 'zeros(2,0)': '2x0' };
    for (const c of TRUTH.chains) {
      for (let k = 1; k < c.steps.length; k++) {
        const label = c.steps.join(' -> ') + (c.reloaded ? ' (reloaded)' : '') + ' at ' + k;
        const was = c.dimensions[k - 1];
        expect(c.dimensions[k].join('x'), label).toBe(was.includes(0) ? SIZE[c.steps[k]] : was.join('x'));
      }
    }
  });

  for (const file of ['fixtures/edit-bash/r2027a/values.mat', 'fixtures/edit-bash/r2023b/values.mat', 'fixtures/edit-bash/r2027a/values_binary.sldd']) {
    it(`${file}: pProps, a scalar, typed zeros(0,3), saved, reopened, and typed another empty`, () => {
      for (const c of TRUTH.chains.filter((x) => x.steps[0] === '5' && x.reloaded)) {
        let o = opened(file);
        for (let k = 1; k < c.steps.length; k++) {
          const label = c.steps.join(' -> ') + ' at ' + k;
          expect(o.edit('pProps', c.steps[k]), label).toBe(true);
          const after = view(o, 'pProps');
          expect(after.dimensions, label).toBe(matrix(c.dimensions[k]));
          o = opened(file, o.save());
          expect(view(o, 'pProps'), label + ' reopened').toEqual(after);
        }
      }
    });
  }
});
