// Copyright 2026 The MathWorks, Inc.
//
// A new entry is named alike in a MAT-file and in a dictionary (matlabName.newEntryName): the name
// asked for, or the class's default, with a counter appended where the file holds it already; and
// nothing added where the name asked for is no name MATLAB can load, or the name with its counter
// is not one ('end' is never made 'end1', and a taken name of 63 characters is not made one of 64).
// That is what the session's addEntry says it does. A MAT-file refused a name asked for that it held
// already, where a dictionary appended the counter.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { newEntryName, uniqueName } from '../src/datamodel/matlabName.js';
import { CLASS, matFile, numericVar } from './tools/matBytes.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const LONG = 'a'.repeat(63);
const scalar = (name: string, value: number) => numericVar({ name, cls: CLASS.DOUBLE, dimensions: [1, 1], real: [value] });

// Each source holding `x`, `x1` and a name of 63 characters; and what an Add of a name makes in it.
function matAdder() {
  const session = createSession();
  const root: any = session.addMatSource('f.mat', matFile([scalar('x', 1), scalar('x1', 2), scalar(LONG, 3)]));
  return (name: string): string | null => {
    session.setActive(root, null);
    const node: any = session.addEntry('', 'MatlabVariable', name);
    return node ? node.name : null;
  };
}

function dictionaryAdder() {
  const session = createSession();
  const json = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/numeric_json.sldd', import.meta.url)), 'utf8'));
  const src: any = session.addDataSource('d.sldd', json);
  session.setActiveContext(src);
  for (const name of ['x', 'x1', LONG]) {
    expect((session.addEntry('design', 'Simulink.Parameter', name) as any)?.name).toBe(name);
  }
  return (name: string): string | null => {
    const node: any = session.addEntry('design', 'Simulink.Parameter', name);
    return node ? node.name : null;
  };
}

const CASES: [string, string | null][] = [
  ['free', 'free'],
  ['x', 'x2'],
  ['x1', 'x11'],
  [LONG, null],
  ['end', null],
  ['1bad', null],
  ['a b', null],
];

describe('a new entry named in a MAT-file and in a dictionary alike', () => {
  for (const [asked, made] of CASES) {
    it(`${asked.length > 8 ? asked.slice(0, 8) + '…' : asked}: ${made === null ? 'refused' : 'named ' + made}`, () => {
      expect([matAdder()(asked), dictionaryAdder()(asked)]).toEqual([made, made]);
    });
  }

  it('says why a MAT-file added nothing, of the name with its counter too', () => {
    const session = createSession();
    const root: any = session.addMatSource('f.mat', matFile([scalar(LONG, 1)]));
    session.setActive(root, null);
    expect(session.addEntry('', 'MatlabVariable', LONG)).toBeNull();
    expect(session.addEntryRefusal()).toBe(`Cannot add a variable to "f.mat": '${LONG}1' is not a name MATLAB can load (Name exceeds maximum length of 63 characters).`);
    expect(session.addEntry('', 'MatlabVariable', 'end')).toBeNull();
    expect(session.addEntryRefusal()).toBe('Cannot add a variable to "f.mat": \'end\' is not a name MATLAB can load (\'end\' is a reserved MATLAB keyword).');
  });
});

describe('newEntryName', () => {
  const taken = (names: string[]) => (name: string) => names.includes(name);

  it('is the name asked for where none holds it, and with the first counter none holds otherwise', () => {
    expect(newEntryName('p', taken([]))).toEqual({ name: 'p', invalid: null });
    expect(newEntryName('p', taken(['p', 'p1', 'p3']))).toEqual({ name: 'p2', invalid: null });
    expect(uniqueName('p', taken(['p']))).toBe('p1');
  });

  it('judges the name asked for before any counter, and the name with its counter after', () => {
    expect(newEntryName('end', taken(['end']))).toEqual({ name: 'end', invalid: "'end' is a reserved MATLAB keyword" });
    expect(newEntryName(LONG, taken([LONG]))).toEqual({ name: LONG + '1', invalid: 'Name exceeds maximum length of 63 characters' });
  });
});
