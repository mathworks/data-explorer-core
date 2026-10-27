// Copyright 2026 The MathWorks, Inc.
//
// Text typed as a complex Simulink.Parameter's Value, in its Value cell or on its Value row, leaves
// its Complexity 'real', as MATLAB's p.Value = "x" makes it, a save and a load included (R2027a and
// R2023b: 'abc', "x", ['ab'; 'cd'], 'a"b', "" and '' over [1+2i 3-4i] each leave a string, Dimensions
// [1 1] and Complexity 'real'). A MAT-file's save kept 'complex', so the row showed 'real' after the
// edit and 'complex' once the file was opened again; the dictionaries wrote 'real'. MATLAB loads such
// a file 'real' all the same, so the Complexity the file holds is asked of the file itself.
//
// "" and '' are the string "" there (S15 of the 2026-10-26 edit bash): its DataType 'string', its Min,
// Max and Unit cleared, as any text clears them (R2027a and R2023b). A MAT-file refused both, "a char
// that is not one row of text"; the dictionaries took them.
import { describe, it, expect } from 'vitest';
import { EDIT_BASH_FORMATS, nodeAt, openEditBash, redo, reopened, saved, shownCell, typeInto, undo, type Opened } from './tools/editBash.js';
import { parseMat, type MatVariable } from '../src/datamodel/parser/MatParser.js';
import { attachMcosDecoded } from '../src/datamodel/node/data/mcosTypedNode.js';
import { mcosDecodedFor } from '../src/datamodel/node/data/mcosDecodedTable.js';

const TEXTS = ['"x"', "'abc'", "['ab'; 'cd']", "'a\"b'", '""', "''"];

// The Parameter's own columns MATLAB sets with its Value.
const shape = (o: Opened, path: string) => {
  const p = nodeAt(o, path);
  return { dimensions: shownCell(p, 'dimensions'), complexity: shownCell(p, 'complexity') };
};

// The Complexity a MAT-file's save holds for the Parameter at `path` (`p`, `s.p` or `c{1}`), as decoded,
// before any row shows it; undefined of a dictionary.
function heldComplexity(o: Opened, path: string): unknown {
  if (!o.format.startsWith('mat')) {
    return undefined;
  }
  const bytes = saved(o);
  const parsed = parseMat(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  attachMcosDecoded(parsed.variables.find((v) => v._anonymous)?._rawBytes, parsed.variables);
  const [, name, field, cell] = /^(\w+)(?:\.(\w+)|\{(\d+)\})?$/.exec(path)!;
  let v: MatVariable = parsed.variables.find((x) => x.name === name)!;
  if (field) {
    const f = v.fields![field];
    v = Array.isArray(f) ? f[0] : f;
  } else if (cell) {
    v = (v.value as MatVariable[])[Number(cell) - 1];
  }
  return mcosDecodedFor(v)?.properties?.Complexity;
}

// What heldComplexity answers of `o`: `complexity` of a MAT-file, nothing of a dictionary.
const held = (o: Opened, complexity: string) => (o.format.startsWith('mat') ? complexity : undefined);

const AS_READ = { dimensions: '[1 2]', complexity: 'complex' };
const TEXT = { dimensions: '[1 1]', complexity: 'real' };

describe.each(EDIT_BASH_FORMATS)("text as a complex Parameter's Value, %s", (format) => {
  it('the fixture holds a complex Parameter', () => {
    expect(shape(openEditBash(format), 'pComplex')).toEqual(AS_READ);
  });

  for (const at of ['pComplex', 'pComplex.Value']) {
    it.each(TEXTS)(`%s typed at ${at} leaves it real, after a reopen too`, (text) => {
      const o = openEditBash(format);
      expect(typeInto(o, at, 'Value', text)).toBe(true);
      expect(shape(o, 'pComplex')).toEqual(TEXT);
      expect(shape(reopened(o), 'pComplex')).toEqual(TEXT);
      expect(heldComplexity(o, 'pComplex')).toBe(held(o, 'real'));
      undo(o);
      expect(shape(o, 'pComplex')).toEqual(AS_READ);
      expect(shape(reopened(o), 'pComplex')).toEqual(AS_READ);
      expect(heldComplexity(o, 'pComplex')).toBe(held(o, 'complex'));
      redo(o);
      expect(shape(o, 'pComplex')).toEqual(TEXT);
      expect(shape(reopened(o), 'pComplex')).toEqual(TEXT);
      expect(heldComplexity(o, 'pComplex')).toBe(held(o, 'real'));
    });
  }

  // A Parameter held in a struct and in a cell, made complex and saved first.
  for (const at of ['sHoldsParam.p', 'cHoldsParam{1}']) {
    it(`text typed at ${at}, made complex, leaves it real`, () => {
      const first = openEditBash(format);
      expect(typeInto(first, at, 'Value', '1+2i')).toBe(true);
      const o = reopened(first);
      expect(shape(o, at)).toEqual({ dimensions: '[1 1]', complexity: 'complex' });
      expect(heldComplexity(o, at)).toBe(held(o, 'complex'));
      expect(typeInto(o, at, 'Value', "'abc'")).toBe(true);
      expect(shape(o, at)).toEqual(TEXT);
      expect(shape(reopened(o), at)).toEqual(TEXT);
      expect(heldComplexity(o, at)).toBe(held(o, 'real'));
    });
  }

  // The string "" of either, over a Parameter with a Min, a Max and a Unit, as MATLAB makes it; a
  // dictionary keeps '' the char it writes (the divergence DESIGN.md records), which MATLAB reads back
  // as "".
  it.each(['""', "''"])('%s typed at pProps is the string "", and clears Min, Max and Unit', (text) => {
    const o = openEditBash(format);
    const columns = (x: Opened) => Object.fromEntries(['Value', 'DataType', 'Min', 'Max', 'Unit', 'dimensions', 'complexity'].map((k) => [k, shownCell(nodeAt(x, 'pProps'), k)]));
    const before = columns(o);
    expect(before).toMatchObject({ Min: '0', Max: '10', Unit: 'm' });
    expect(typeInto(o, 'pProps', 'Value', text)).toBe(true);
    const made = { Value: format.startsWith('mat') ? '""' : text, DataType: 'string', Min: '', Max: '', Unit: '', dimensions: '[1 1]', complexity: 'real' };
    expect(columns(o)).toEqual(made);
    expect(columns(reopened(o))).toEqual(made);
    undo(o);
    expect(columns(o)).toEqual(before);
    expect(columns(reopened(o))).toEqual(before);
  });

  // A number after the text is MATLAB's again: complex where it is.
  it('a complex number typed after the text makes it complex again', () => {
    const o = openEditBash(format);
    expect(typeInto(o, 'pComplex', 'Value', '"x"')).toBe(true);
    const again = reopened(o);
    expect(typeInto(again, 'pComplex', 'Value', '[1+2i 3]')).toBe(true);
    expect(shape(again, 'pComplex')).toEqual(AS_READ);
    expect(shape(reopened(again), 'pComplex')).toEqual(AS_READ);
    expect(heldComplexity(again, 'pComplex')).toBe(held(again, 'complex'));
  });
});
