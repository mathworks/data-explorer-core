// Copyright 2026 The MathWorks, Inc.
//
// The rules a MAT-file object's property edit is held to (McosEditRules), one case a row: an
// object as the file holds it, the edits, and the cells written or the refusal. The rows follow
// the allow-list probe's case groups, measured against MATLAB R2027a: Min and Max; a Value's class
// against each kind of DataType; Dimensions; text; a Signal's own properties; what no edit takes.
// That the cells are MATLAB's, byte for byte, is test/mcosObjectEdit.test.ts's to show.

import { describe, it, expect } from 'vitest';
import type { MatVariable } from '../src/datamodel/parser/MatParser.js';
import type { McosEditRefusal } from '../src/datamodel/parser/McosSubsystemEdit.js';
import {
  dataTypeAfter,
  objectEditCells,
  propertyEditRefusal,
  propertyValueRefusal,
  type McosHeld,
  type McosObjectHeld,
  type McosPropertyEdit,
} from '../src/datamodel/parser/McosEditRules.js';

const v = (className: string, value: unknown, dimensions: number[], more: Partial<MatVariable> = {}): MatVariable => ({
  name: '',
  className,
  dimensions,
  isComplex: false,
  isLogical: false,
  value,
  fields: null,
  ...more,
});
const shapeOf = (x: unknown): number[] => (Array.isArray(x) ? [1, x.length] : [1, 1]);
const dbl = (x: number | number[], dims = shapeOf(x)) => v('double', x, dims);
const num = (cls: string, x: number | number[], dims = shapeOf(x)) => v(cls, x, dims);
const lgc = (x: number | number[], dims = shapeOf(x)) => v('uint8', x, dims, { isLogical: true });
const cplx = (pairs: { re: number; im: number }[], dims = [1, pairs.length], cls = 'double') => v(cls, pairs, dims, { isComplex: true });
const chr = (text: string, dims = text === '' ? [0, 0] : [1, text.length]) => v('char', text, dims);
const empty = () => dbl([], [0, 0]);
const strct = (fields: Record<string, MatVariable>) => v('struct', null, [1, 1], { fields });

type HeldSpec = MatVariable | McosEditRefusal | [McosEditRefusal, MatVariable];

// An object of `className` holding a triple for each of `props`: a value cell, or a cell whose swap
// is refused for the reason named (with the value it reads as, where one is given).
function held(className: string, props: Record<string, HeldSpec>): McosObjectHeld {
  const stored = new Map<string, McosHeld>();
  for (const [name, spec] of Object.entries(props)) {
    if (typeof spec === 'string') {
      stored.set(name, { refusal: spec, value: null });
    } else if (Array.isArray(spec)) {
      stored.set(name, { refusal: spec[0], value: spec[1] });
    } else {
      stored.set(name, { refusal: null, value: spec });
    }
  }
  return { className, stored };
}
const P = 'Simulink.Parameter';
const S = 'Simulink.Signal';
const param = (props: Record<string, HeldSpec>) => held(P, { Value: dbl(5), Complexity: 'not-a-cell', Dimensions: dbl([1, 1]), CoderInfo: 'object-reference', ...props });
const signal = (props: Record<string, HeldSpec>) => held(S, { CoderInfo: 'object-reference', ...props });

// What a cell holds, in a line: its saved name, class, size and value.
const said = (c: { savedName: string; value: MatVariable }) =>
  c.savedName + '=' + (c.value.isLogical ? 'logical' : c.value.className) + (c.value.isComplex ? ' complex' : '') + '[' + c.value.dimensions.join(' ') + ']:' + JSON.stringify(c.value.value);

function cellsOf(h: McosObjectHeld, edits: McosPropertyEdit[]): string[] | { refused: string; message: string } {
  const r = objectEditCells(h, edits, 'p');
  return r.ok ? r.cells.map(said).sort() : { refused: r.property, message: r.message };
}

const refused = (property: string, message: RegExp | string) => ({ refused: property, message: typeof message === 'string' ? message : expect.stringMatching(message) });
const WARNS = ', which MATLAB loads with a warning on every load';

interface Row {
  name: string;
  of: McosObjectHeld;
  edits: [string, MatVariable][];
  expect: string[] | ReturnType<typeof refused>;
}

const rows: Row[] = [
  // ---- Min and Max ----
  { name: 'Min inside', of: param({ Min: dbl(0), Max: dbl(10) }), edits: [['Min', dbl(2)]], expect: ['Min=double[1 1]:2'] },
  { name: 'Min above the Value (not checked)', of: param({ Min: dbl(0), Max: dbl(10) }), edits: [['Min', dbl(7)]], expect: ['Min=double[1 1]:7'] },
  { name: 'Min a fraction', of: param({ Min: dbl(0), Max: dbl(10) }), edits: [['Min', dbl(-3.5)]], expect: ['Min=double[1 1]:-3.5'] },
  { name: 'Min cleared', of: param({ Min: dbl(0), Max: dbl(10) }), edits: [['Min', empty()]], expect: ['Min=double[0 0]:[]'] },
  { name: 'Max cleared', of: param({ Min: dbl(0), Max: dbl(10) }), edits: [['Max', empty()]], expect: ['Max=double[0 0]:[]'] },
  { name: 'Min = Max', of: param({ Min: dbl(0), Max: dbl(10) }), edits: [['Min', dbl(10)]], expect: ['Min=double[1 1]:10'] },
  { name: 'Min and Max together', of: param({ Min: dbl(0), Max: dbl(10) }), edits: [['Min', dbl(1)], ['Max', dbl(9)]], expect: ['Max=double[1 1]:9', 'Min=double[1 1]:1'] },
  { name: 'Min above Max', of: param({ Min: dbl(0), Max: dbl(10) }), edits: [['Min', dbl(20)]], expect: refused('Min', 'p.Min (20) would be greater than its Max (10)' + WARNS) },
  { name: 'Max below Min', of: param({ Min: dbl(0), Max: dbl(10) }), edits: [['Max', dbl(-5)]], expect: refused('Max', 'p.Min (0) would be greater than its Max (-5)' + WARNS) },
  { name: 'Min and Max crossed together', of: param({ Min: dbl(0), Max: dbl(10) }), edits: [['Min', dbl(9)], ['Max', dbl(1)]], expect: refused('Min', /^p\.Min \(9\) would be greater than its Max \(1\)/) },
  { name: 'Min int16', of: param({ Min: dbl(0), Max: dbl(10) }), edits: [['Min', num('int16', 3)]], expect: refused('Min', 'p.Min must be a finite real double scalar or []: MATLAB refuses anything else, and loads it as []') },
  { name: 'Min -Inf', of: param({ Min: dbl(0) }), edits: [['Min', dbl(-Infinity)]], expect: refused('Min', /^p\.Min must be a finite real double scalar/) },
  { name: 'Max NaN', of: param({ Max: dbl(10) }), edits: [['Max', dbl(NaN)]], expect: refused('Max', /^p\.Max must be a finite real double scalar/) },
  { name: 'Max [1 2]', of: param({ Max: dbl(10) }), edits: [['Max', dbl([1, 2])]], expect: refused('Max', /^p\.Max must be a finite real double scalar/) },
  { name: 'Max complex', of: param({ Max: dbl(10) }), edits: [['Max', cplx([{ re: 1, im: 2 }])]], expect: refused('Max', /^p\.Max must be a finite real double scalar/) },
  {
    name: 'Max out of an int16 DataType',
    of: param({ Value: num('int16', 5), DataType: chr('int16'), Min: dbl(0), Max: dbl(10) }),
    edits: [['Max', dbl(40000)]],
    expect: refused('Max', "p.Max (40000) would be outside the range [-32768, 32767] of its DataType 'int16'" + WARNS),
  },
  {
    name: 'Min out of an int16 DataType',
    of: param({ Value: num('int16', 5), DataType: chr('int16'), Min: dbl(0), Max: dbl(10) }),
    edits: [['Min', dbl(-40000)]],
    expect: refused('Min', /^p\.Min \(-40000\) would be outside the range \[-32768, 32767\]/),
  },
  { name: 'a fraction inside an int16 DataType', of: param({ Value: num('int16', 5), DataType: chr('int16'), Max: dbl(10) }), edits: [['Max', dbl(7.5)]], expect: ['Max=double[1 1]:7.5'] },
  { name: 'Max past a single DataType', of: param({ Value: num('single', 2.5), DataType: chr('single'), Max: dbl(10) }), edits: [['Max', dbl(1e39)]], expect: refused('Max', /outside the range \[-realmax\('single'\), realmax\('single'\)\]/) },
  { name: 'Max under fixdt (not checked)', of: param({ DataType: chr('fixdt(1,16,4)'), Max: dbl(10) }), edits: [['Max', dbl(1e6)]], expect: ['Max=double[1 1]:1000000'] },
  { name: 'Min at its default', of: param({}), edits: [['Min', dbl(1)]], expect: refused('Min', 'p.Min is at its class default: the file holds no value for it, and a save can replace only a value the file holds') },
  {
    name: 'an edit that touches no bound, of a file whose bounds already cross',
    of: param({ Min: dbl(20), Max: dbl(10), Description: chr('d') }),
    edits: [['Description', chr('e')]],
    expect: ['Description=char[1 1]:"e"'],
  },
  { name: 'a bound edit that leaves them crossed', of: param({ Min: dbl(20), Max: dbl(10) }), edits: [['Min', dbl(15)]], expect: refused('Min', /^p\.Min \(15\) would be greater than its Max \(10\)/) },

  // ---- A Value's class against its DataType ----
  { name: 'double over double, no DataType', of: param({}), edits: [['Value', dbl(7)]], expect: ['Value=double[1 1]:7'] },
  { name: 'int16 with no DataType: nothing to co-write', of: param({}), edits: [['Value', num('int16', -4)]], expect: ['Value=int16[1 1]:-4'] },
  { name: 'double over single under single: auto', of: param({ Value: num('single', 2.5), DataType: chr('single') }), edits: [['Value', dbl(7)]], expect: ['DataType=char[1 4]:"auto"', 'Value=double[1 1]:7'] },
  { name: 'double past single over single: auto, so not checked', of: param({ Value: num('single', 2.5), DataType: chr('single') }), edits: [['Value', dbl(1e40)]], expect: ['DataType=char[1 4]:"auto"', 'Value=double[1 1]:1e+40'] },
  { name: 'int32 over single: int32', of: param({ Value: num('single', 2.5), DataType: chr('single') }), edits: [['Value', num('int32', 7)]], expect: ['DataType=char[1 5]:"int32"', 'Value=int32[1 1]:7'] },
  { name: 'logical over single: boolean', of: param({ Value: num('single', 2.5), DataType: chr('single') }), edits: [['Value', lgc(1)]], expect: ['DataType=char[1 7]:"boolean"', 'Value=logical[1 1]:1'] },
  { name: 'single over single: kept', of: param({ Value: num('single', 2.5), DataType: chr('single') }), edits: [['Value', num('single', 3.5)]], expect: ['Value=single[1 1]:3.5'] },
  { name: 'double over double under single, in range', of: param({ DataType: chr('single') }), edits: [['Value', dbl(3.25)]], expect: ['Value=double[1 1]:3.25'] },
  { name: 'double over double under single, past realmax', of: param({ DataType: chr('single') }), edits: [['Value', dbl(1e40)]], expect: refused('Value', "p.Value would hold 1e+40, outside the range [-realmax('single'), realmax('single')] of its DataType 'single'" + WARNS) },
  { name: 'NaN under single', of: param({ DataType: chr('single') }), edits: [['Value', dbl(NaN)]], expect: refused('Value', /^p\.Value would hold NaN, outside/) },
  { name: '40000 under int16', of: param({ DataType: chr('int16') }), edits: [['Value', dbl(40000)]], expect: refused('Value', "p.Value would hold 40000, outside the range [-32768, 32767] of its DataType 'int16'" + WARNS) },
  { name: '3.25 under int16 (a fraction in range)', of: param({ DataType: chr('int16') }), edits: [['Value', dbl(3.25)]], expect: ['Value=double[1 1]:3.25'] },
  { name: '-Inf under int16', of: param({ DataType: chr('int16') }), edits: [['Value', dbl(-Infinity)]], expect: refused('Value', /^p\.Value would hold -Inf, outside/) },
  // The top of int64 and of uint64 is no double: the nearest, 2^63 and 2^64, is past it.
  { name: '2^63 under int64', of: param({ DataType: chr('int64') }), edits: [['Value', dbl(2 ** 63)]], expect: refused('Value', 'p.Value would hold ' + String(2 ** 63) + ", outside the range [-9223372036854775808, 9223372036854775807] of its DataType 'int64'" + WARNS) },
  { name: 'the double below 2^63 under int64', of: param({ DataType: chr('int64') }), edits: [['Value', dbl(2 ** 63 - 1024)]], expect: ['Value=double[1 1]:' + String(2 ** 63 - 1024)] },
  { name: '-2^63 under int64', of: param({ DataType: chr('int64') }), edits: [['Value', dbl(-(2 ** 63))]], expect: ['Value=double[1 1]:' + String(-(2 ** 63))] },
  { name: '2^64 under uint64', of: param({ DataType: chr('uint64') }), edits: [['Value', dbl(2 ** 64)]], expect: refused('Value', 'p.Value would hold ' + String(2 ** 64) + ", outside the range [0, 18446744073709551615] of its DataType 'uint64'" + WARNS) },
  { name: 'the double below 2^64 under uint64', of: param({ DataType: chr('uint64') }), edits: [['Value', dbl(2 ** 64 - 2048)]], expect: ['Value=double[1 1]:' + String(2 ** 64 - 2048)] },
  { name: 'a Max of 2^63 under int64', of: param({ DataType: chr('int64'), Max: dbl(10) }), edits: [['Max', dbl(2 ** 63)]], expect: refused('Max', 'p.Max (' + String(2 ** 63) + ") would be outside the range [-9223372036854775808, 9223372036854775807] of its DataType 'int64'" + WARNS) },
  { name: '255.4 under uint8', of: param({ DataType: chr('uint8') }), edits: [['Value', dbl(255.4)]], expect: refused('Value', /^p\.Value would hold 255\.4, outside the range \[0, 255\]/) },
  { name: '255 under uint8', of: param({ DataType: chr('uint8') }), edits: [['Value', dbl(255)]], expect: ['Value=double[1 1]:255'] },
  { name: '-1 under uint8', of: param({ DataType: chr('uint8') }), edits: [['Value', dbl(-1)]], expect: refused('Value', /^p\.Value would hold -1, outside/) },
  { name: 'a complex part out of int16', of: param({ DataType: chr('int16') }), edits: [['Value', cplx([{ re: 1, im: 40000 }])]], expect: refused('Value', /^p\.Value would hold 40000, outside/) },
  { name: 'a complex value inside int16', of: param({ DataType: chr('int16') }), edits: [['Value', cplx([{ re: 1, im: 2 }])]], expect: ['Value=double complex[1 1]:[{"re":1,"im":2}]'] },
  { name: '7 under boolean', of: param({ DataType: chr('boolean') }), edits: [['Value', dbl(7)]], expect: refused('Value', "p.Value would hold 7, and a DataType of 'boolean' takes only 0 and 1" + WARNS) },
  { name: '1 under boolean', of: param({ DataType: chr('boolean') }), edits: [['Value', dbl(1)]], expect: ['Value=double[1 1]:1'] },
  { name: 'complex under boolean', of: param({ DataType: chr('boolean') }), edits: [['Value', cplx([{ re: 1, im: 0 }])]], expect: refused('Value', /^p\.Value would hold a complex value, and a DataType of 'boolean'/) },
  { name: '[1 0 1] under boolean, resized', of: param({ DataType: chr('boolean') }), edits: [['Value', dbl([1, 0, 1])]], expect: ['Dimensions=double[1 2]:[1,3]', 'Value=double[1 3]:[1,0,1]'] },
  { name: 'double over logical under boolean: auto', of: param({ Value: lgc(1), DataType: chr('boolean') }), edits: [['Value', dbl(7)]], expect: ['DataType=char[1 4]:"auto"', 'Value=double[1 1]:7'] },
  { name: 'NaN under double', of: param({ DataType: chr('double') }), edits: [['Value', dbl(NaN)]], expect: refused('Value', /^p\.Value would hold NaN, outside the range \[-Inf, Inf\]/) },
  { name: 'Inf under double', of: param({ DataType: chr('double') }), edits: [['Value', dbl(Infinity)]], expect: refused('Value', /^p\.Value would hold Inf/) },
  { name: 'Inf under auto (not checked)', of: param({}), edits: [['Value', dbl(Infinity)]], expect: ['Value=double[1 1]:null'] },
  { name: '5000 under fixdt (not checked)', of: param({ DataType: chr('fixdt(1,16,4)') }), edits: [['Value', dbl(5000)]], expect: ['Value=double[1 1]:5000'] },
  { name: '5000 under an alias (not checked)', of: param({ DataType: chr('MyNT') }), edits: [['Value', dbl(5000)]], expect: ['Value=double[1 1]:5000'] },
  { name: 'int16 under an alias: int16', of: param({ DataType: chr('MyNT') }), edits: [['Value', num('int16', 3)]], expect: ['DataType=char[1 5]:"int16"', 'Value=int16[1 1]:3'] },
  { name: 'double under half (range not known here)', of: param({ DataType: chr('half') }), edits: [['Value', dbl(1)]], expect: refused('Value', "p.Value would be double under a DataType of 'half', whose range this editor does not check") },
  { name: 'logical over double under double: boolean', of: param({ DataType: chr('double') }), edits: [['Value', lgc(1)]], expect: ['DataType=char[1 7]:"boolean"', 'Value=logical[1 1]:1'] },
  { name: 'text over int16-typed double: string, size 1x1', of: param({ DataType: chr('int16') }), edits: [['Value', chr('abc')]], expect: ['DataType=char[1 6]:"string"', 'Value=char[1 3]:"abc"'] },
  { name: 'a struct over a double: struct', of: param({ DataType: chr('int16') }), edits: [['Value', strct({ a: dbl(1) })]], expect: ['DataType=char[1 6]:"struct"', 'Value=struct[1 1]:null'] },
  { name: 'a struct over a struct: its bus kept', of: param({ Value: strct({ a: dbl(1) }), DataType: chr('Bus: MyBus') }), edits: [['Value', strct({ a: dbl(5) })]], expect: ['Value=struct[1 1]:null'] },
  { name: 'a double over a struct: auto', of: param({ Value: strct({ a: dbl(1) }), DataType: chr('Bus: MyBus') }), edits: [['Value', dbl(7)]], expect: ['DataType=char[1 4]:"auto"', 'Value=double[1 1]:7'] },
  { name: 'a DataType that has to follow, held where it cannot be rewritten', of: param({ Value: num('single', 2.5), DataType: ['shared-cell', chr('single')] }), edits: [['Value', dbl(7)]], expect: refused('Value', /^p\.DataType would have to follow the Value, and p\.DataType is held in a value the file names for another property/) },
  { name: 'a DataType that stays, held where it cannot be rewritten', of: param({ Value: num('single', 2.5), DataType: ['shared-cell', chr('single')] }), edits: [['Value', num('single', 1)]], expect: ['Value=single[1 1]:1'] },
  { name: 'a cell Value', of: param({}), edits: [['Value', v('cell', [dbl(1)], [1, 1])]], expect: refused('Value', 'p.Value would be a cell, which this editor does not write into a Simulink.Parameter') },
  { name: 'a sparse Value', of: param({}), edits: [['Value', v('double', [], [2, 2], { isSparse: true })]], expect: refused('Value', /^p\.Value would be a sparse double/) },
  { name: 'a char matrix', of: param({}), edits: [['Value', chr('abcd', [2, 2])]], expect: refused('Value', /^p\.Value would be a char that is not one row of text/) },
  { name: "the empty char ''", of: param({}), edits: [['Value', chr('')]], expect: refused('Value', /^p\.Value would be a char that is not one row of text/) },
  { name: 'a struct with a char field', of: param({}), edits: [['Value', strct({ a: chr('x') })]], expect: refused('Value', /^p\.Value would be a struct holding a char/) },
  { name: 'an object', of: param({}), edits: [['Value', v('Simulink.Parameter', null, [1, 1], { isOpaque: true })]], expect: refused('Value', /^p\.Value would be a Simulink\.Parameter/) },
  { name: 'a value this package has no variable for', of: param({}), edits: [['Value', v('Simulink.Bus', null, [1, 1], { _unwritable: 'a Simulink.Bus MatWriter has no variable for' })]], expect: refused('Value', /^p\.Value would be a Simulink\.Bus MatWriter has no variable for/) },
  { name: 'a Value at its default', of: held(P, { Complexity: 'not-a-cell', Dimensions: dbl([0, 0]) }), edits: [['Value', dbl(5)]], expect: refused('Value', /^p\.Value is at its class default/) },

  // ---- Dimensions, which follows a resized Value ----
  { name: 'resized to a row', of: param({}), edits: [['Value', dbl([1, 2, 3])]], expect: ['Dimensions=double[1 2]:[1,3]', 'Value=double[1 3]:[1,2,3]'] },
  { name: 'resized to 3x2', of: param({}), edits: [['Value', dbl([1, 2, 3, 4, 5, 6], [3, 2])]], expect: ['Dimensions=double[1 2]:[3,2]', 'Value=double[3 2]:[1,2,3,4,5,6]'] },
  { name: 'resized to 2x3x4', of: param({}), edits: [['Value', dbl(Array.from({ length: 24 }, (_, i) => i + 1), [2, 3, 4])]], expect: ['Dimensions=double[1 3]:[2,3,4]', expect.stringMatching(/^Value=double\[2 3 4\]:/)] as unknown as string[] },
  { name: 'the same size', of: param({ Dimensions: dbl([1, 3]), Value: dbl([1, 2, 3]) }), edits: [['Value', dbl([4, 5, 6])]], expect: ['Value=double[1 3]:[4,5,6]'] },
  { name: 'emptied: Dimensions kept', of: param({}), edits: [['Value', empty()]], expect: ['Value=double[0 0]:[]'] },
  { name: 'a 1x0: Dimensions kept', of: param({}), edits: [['Value', dbl([], [1, 0])]], expect: ['Value=double[1 0]:[]'] },
  { name: 'a symbolic Dimensions: kept', of: param({ Dimensions: chr('[1,N]'), Value: dbl([1, 2, 3]) }), edits: [['Value', dbl([1, 2])]], expect: ['Value=double[1 2]:[1,2]'] },
  { name: 'a Dimensions held where it cannot be rewritten: left to load', of: param({ Dimensions: ['shared-cell', dbl([1, 1])] }), edits: [['Value', dbl([1, 2])]], expect: ['Value=double[1 2]:[1,2]'] },
  { name: 'text, a string scalar: [1 1] kept', of: param({}), edits: [['Value', chr('abc')]], expect: ['Value=char[1 3]:"abc"'] },

  // ---- Text ----
  { name: 'Description', of: param({ Description: chr('desc') }), edits: [['Description', chr('new description')]], expect: ['Description=char[1 15]:"new description"'] },
  { name: "Description ''", of: param({ Description: chr('desc') }), edits: [['Description', chr('')]], expect: ['Description=char[0 0]:""'] },
  { name: 'Description non-ASCII', of: param({ Description: chr('desc') }), edits: [['Description', chr('Température — 温度 😀')]], expect: ['Description=char[1 19]:"Température — 温度 😀"'] },
  { name: 'Description with a lone surrogate', of: param({ Description: chr('desc') }), edits: [['Description', chr('a\uD800b')]], expect: refused('Description', 'p.Description holds a lone UTF-16 surrogate, which the file would hold as another character') },
  { name: 'Description numeric', of: param({ Description: chr('desc') }), edits: [['Description', dbl(5)]], expect: refused('Description', 'p.Description must be text: MATLAB refuses anything else, and loads it as empty') },
  { name: 'Description a char matrix', of: param({ Description: chr('desc') }), edits: [['Description', chr('abcd', [2, 2])]], expect: refused('Description', /^p\.Description must be text/) },
  { name: 'Unit, saved as DocUnits', of: param({ DocUnits: chr('m') }), edits: [['Unit', chr('km')]], expect: ['DocUnits=char[1 2]:"km"'] },
  { name: 'Unit at its default', of: param({}), edits: [['Unit', chr('km')]], expect: refused('Unit', /^p\.Unit is at its class default/) },
  { name: 'several cells of one object', of: param({ Description: chr('d'), DocUnits: chr('m'), Min: dbl(0), Max: dbl(10) }), edits: [['Value', dbl([1, 2])], ['Description', chr('multi')], ['Unit', chr('kg')], ['Max', dbl(20)]], expect: ['Description=char[1 5]:"multi"', 'Dimensions=double[1 2]:[1,2]', 'DocUnits=char[1 2]:"kg"', 'Max=double[1 1]:20', 'Value=double[1 2]:[1,2]'] },

  // ---- What no edit of a Parameter takes ----
  { name: 'DataType on its own', of: param({ DataType: chr('single') }), edits: [['DataType', chr('double')]], expect: refused('DataType', 'p.DataType follows its Value, and is written only with it: set on its own, MATLAB converts a Value that is not double to double on every load') },
  { name: 'Dimensions on its own', of: param({}), edits: [['Dimensions', dbl([2, 3])]], expect: refused('Dimensions', 'p.Dimensions follows its Value, and is written only with it') },
  { name: 'Complexity', of: param({}), edits: [['Complexity', chr('complex')]], expect: refused('Complexity', /^p\.Complexity is held as an index into the file's text/) },
  { name: 'StorageClass', of: param({}), edits: [['StorageClass', chr('ExportedGlobal')]], expect: refused('StorageClass', 'p.StorageClass belongs to its CoderInfo, an object of its own, which a save does not rewrite') },
  { name: 'CoderInfo', of: param({}), edits: [['CoderInfo', dbl(1)]], expect: refused('CoderInfo', /^p\.CoderInfo belongs to its CoderInfo/) },
  { name: 'a property no rule names', of: param({}), edits: [['SomethingElse', dbl(1)]], expect: refused('SomethingElse', 'p.SomethingElse is not one this editor writes into a MAT-file object') },
  { name: 'a Description held as an index', of: param({ Description: 'not-a-cell' }), edits: [['Description', chr('x')]], expect: refused('Description', "p.Description is held as an index into the file's text, not as a value, which a save does not rewrite") },
  { name: 'a Description holding an object', of: param({ Description: 'object-reference' }), edits: [['Description', chr('x')]], expect: refused('Description', 'p.Description holds an object, which a save does not rewrite') },
  { name: "a Value in a property list another object holds", of: param({ Value: ['shared-list', dbl(5)] }), edits: [['Value', dbl(7)]], expect: refused('Value', "p.Value is held in a list of properties another of the file's objects holds as well, which a save would change too") },
  { name: 'a Description that does not read', of: param({ Description: 'malformed' }), edits: [['Description', chr('x')]], expect: refused('Description', 'p.Description is held in a value that does not read as one a save can replace') },
  { name: 'an mpt.Parameter', of: held('mpt.Parameter', { Value: dbl(5) }), edits: [['Value', dbl(7)]], expect: refused('Value', 'p is a mpt.Parameter, whose properties this editor does not write into a MAT-file') },
  { name: 'one property twice', of: param({ Description: chr('d') }), edits: [['Description', chr('a')], ['Description', chr('b')]], expect: refused('Description', 'p.Description is edited twice in one save') },

  // ---- Simulink.Signal ----
  { name: 'Signal Description', of: signal({ Description: chr('a signal') }), edits: [['Description', chr('new text')]], expect: ['Description=char[1 8]:"new text"'] },
  { name: 'Signal Min', of: signal({ Min: dbl(0), Max: dbl(10), DataType: chr('int16') }), edits: [['Min', dbl(2)]], expect: ['Min=double[1 1]:2'] },
  { name: 'Signal Max below its Min', of: signal({ Min: dbl(0), Max: dbl(10) }), edits: [['Max', dbl(-5)]], expect: refused('Max', /^p\.Min \(0\) would be greater than its Max \(-5\)/) },
  { name: 'Signal Min out of an int8 DataType', of: signal({ Min: dbl(0), DataType: chr('int8') }), edits: [['Min', dbl(-200)]], expect: refused('Min', /^p\.Min \(-200\) would be outside the range \[-128, 127\]/) },
  { name: 'Signal DataType single', of: signal({ DataType: chr('int16'), Min: dbl(0), Max: dbl(10) }), edits: [['DataType', chr('single')]], expect: ['DataType=char[1 6]:"single"'] },
  { name: 'Signal DataType fixdt', of: signal({ DataType: chr('int16') }), edits: [['DataType', chr('fixdt(1,16,4)')]], expect: ['DataType=char[1 13]:"fixdt(1,16,4)"'] },
  { name: 'Signal DataType an enumeration', of: signal({ DataType: chr('int16') }), edits: [['DataType', chr('Enum: MyEnum')]], expect: ['DataType=char[1 12]:"Enum: MyEnum"'] },
  { name: 'Signal DataType an alias', of: signal({ DataType: chr('int16') }), edits: [['DataType', chr('MyNT')]], expect: ['DataType=char[1 4]:"MyNT"'] },
  { name: 'Signal DataType boolean, its Max 10', of: signal({ DataType: chr('int16'), Min: dbl(0), Max: dbl(10) }), edits: [['DataType', chr('boolean')]], expect: refused('DataType', "p.Max (10) would be outside the range [0, 1] of its DataType 'boolean'" + WARNS) },
  { name: 'Signal DataType a bus, its Min and Max held', of: signal({ DataType: chr('int16'), Min: dbl(0), Max: dbl(10) }), edits: [['DataType', chr('Bus: MyBus')]], expect: refused('DataType', "p.Min would be set while its DataType is 'Bus: MyBus', and MATLAB ignores a minimum and a maximum for a bus" + WARNS) },
  { name: 'Signal DataType a bus, no bounds', of: signal({ DataType: chr('int16') }), edits: [['DataType', chr('Bus: MyBus')]], expect: ['DataType=char[1 10]:"Bus: MyBus"'] },
  { name: "Signal DataType 'auto' (not measured)", of: signal({ DataType: chr('int16') }), edits: [['DataType', chr('auto')]], expect: refused('DataType', "p.DataType would be 'auto', which is not a data type this editor writes into a Simulink.Signal") },
  { name: "Signal DataType 'Inherit: auto'", of: signal({ DataType: chr('int16') }), edits: [['DataType', chr('Inherit: auto')]], expect: refused('DataType', /^p\.DataType would be 'Inherit: auto'/) },
  { name: 'Signal DataType a number', of: signal({ DataType: chr('int16') }), edits: [['DataType', dbl(5)]], expect: refused('DataType', /^p\.DataType would be no text/) },
  { name: 'Signal Dimensions [2 3]', of: signal({ Dimensions: dbl(3) }), edits: [['Dimensions', dbl([2, 3])]], expect: ['Dimensions=double[1 2]:[2,3]'] },
  { name: 'Signal Dimensions [2 3 4]', of: signal({ Dimensions: dbl(3) }), edits: [['Dimensions', dbl([2, 3, 4])]], expect: ['Dimensions=double[1 3]:[2,3,4]'] },
  { name: 'Signal Dimensions -1', of: signal({ Dimensions: dbl(3) }), edits: [['Dimensions', dbl(-1)]], expect: ['Dimensions=double[1 1]:-1'] },
  { name: 'Signal Dimensions 0.5', of: signal({ Dimensions: dbl(3) }), edits: [['Dimensions', dbl(0.5)]], expect: refused('Dimensions', 'p.Dimensions must be -1 or a row of positive whole numbers: MATLAB refuses anything else, and loads it as -1') },
  { name: 'Signal Dimensions [0 3]', of: signal({ Dimensions: dbl(3) }), edits: [['Dimensions', dbl([0, 3])]], expect: refused('Dimensions', /^p\.Dimensions must be -1 or a row/) },
  { name: 'Signal Dimensions [2 3 1] (a trailing 1, not measured)', of: signal({ Dimensions: dbl(3) }), edits: [['Dimensions', dbl([2, 3, 1])]], expect: refused('Dimensions', /^p\.Dimensions must be -1 or a row/) },
  { name: 'Signal Dimensions a column', of: signal({ Dimensions: dbl(3) }), edits: [['Dimensions', dbl([2, 3], [2, 1])]], expect: refused('Dimensions', /^p\.Dimensions must be -1 or a row/) },
  { name: 'Signal InitialValue', of: signal({ InitialValue: chr('3') }), edits: [['InitialValue', chr('[1 2 3]')]], expect: ['InitialValue=char[1 7]:"[1 2 3]"'] },
  { name: "Signal InitialValue ''", of: signal({ InitialValue: chr('3') }), edits: [['InitialValue', chr('')]], expect: ['InitialValue=char[0 0]:""'] },
  { name: 'Signal InitialValue a number', of: signal({ InitialValue: chr('3') }), edits: [['InitialValue', dbl(5)]], expect: refused('InitialValue', /^p\.InitialValue must be text/) },
  { name: 'Signal Complexity', of: signal({}), edits: [['Complexity', chr('real')]], expect: refused('Complexity', /^p\.Complexity is held as an index/) },
  { name: 'Signal Value, which it has none of', of: signal({}), edits: [['Value', dbl(1)]], expect: refused('Value', 'p.Value is not one this editor writes into a MAT-file object') },
];

describe('the cells an edit of a MAT-file object writes, or why none', () => {
  for (const row of rows) {
    it(row.name, () => {
      expect(cellsOf(row.of, row.edits.map(([property, value]) => ({ property, value })))).toEqual(row.expect);
    });
  }

  it('no edits, no cells', () => {
    expect(objectEditCells(param({}), [], 'p')).toEqual({ ok: true, cells: [] });
  });
});

// Measured against MATLAB R2027a: a Signal's DataType set method takes any text, and a file whose
// DataType cell holds any of these loads it as written, garbage included, but for white space at
// either end, which it trims (the text loads as other text than was written). So the cell is held
// to the forms that name a type, each of which loaded as written.
describe("a Signal's DataType, held to the forms that name a type", () => {
  const taken = [
    'fixdt(1,16,4)', 'fixdt(0,8)', 'fixdt(1, 16, 4)', 'fixdt(true,16,4)', 'fixdt(1,16,-4)', 'fixdt(1,16,1,-4,0)',
    'fixdt(1,16,0.0625,0)', 'fixdt(1,16,6.25e-2,0)', "fixdt('double')", "fixdt('sfix16_En4')",
    "fixdt(1,16,4,'DataTypeOverride','Off')", 'Enum: MyEnum', 'Enum:MyEnum', 'Enum: pkg.MyEnum', 'Bus: MyBus', 'Bus:MyBus',
    'MyNT', 'a.b', 'my_type_1', 'single', 'int8', 'uint64', 'boolean',
  ];
  // Each loads as written, but means no type (an expression, extra arguments, a word length of 0, a
  // name with a space in it), or loads trimmed, or holds a control character.
  const refusedTexts = [
    'fixdt(foo)', 'fixdt(1,16,4,5,6,7)', 'fixdt(1,16,2^-4,0)', 'fixdt()', 'fixdt(1,16,4', 'fixdt(1,16,4);disp(1)',
    'fixdt(fixdt(1,16,4))', 'fixdt(1,+16,4)', 'fixdt(1,0,4)', 'fixdt(1,\t16,4)', 'fixdt(1,\n16,4)', 'fixdt(1,16,4)\n',
    'Enum: 3abc', 'Enum: My Enum', 'Enum: MyEnum ', 'Enum: MyEnum\n', ' Enum: MyEnum', 'Bus: My Bus', 'Bus: 3abc', 'Bus: MyBus(1)',
    'int16\u0007', 'single ', '3abc', 'a..b',
  ];
  for (const text of taken) {
    it('takes ' + JSON.stringify(text), () => {
      expect(cellsOf(signal({ DataType: chr('int16') }), [{ property: 'DataType', value: chr(text) }])).toEqual(['DataType=char[1 ' + text.length + ']:' + JSON.stringify(text)]);
    });
  }
  for (const text of refusedTexts) {
    it('refuses ' + JSON.stringify(text), () => {
      expect(cellsOf(signal({ DataType: chr('int16') }), [{ property: 'DataType', value: chr(text) }])).toEqual(
        refused('DataType', "p.DataType would be '" + text + "', which is not a data type this editor writes into a Simulink.Signal"),
      );
    });
  }
});

describe('what an edit is refused for whatever its value, asked before it is made', () => {
  it('a property held, at its default, excluded, or of a class with no rules', () => {
    const p = param({ Min: dbl(0), Description: 'not-a-cell' });
    expect(propertyEditRefusal(p, 'Min', 'p')).toBeNull();
    expect(propertyEditRefusal(p, 'Max', 'p')).toMatch(/^p\.Max is at its class default/);
    expect(propertyEditRefusal(p, 'Description', 'p')).toMatch(/^p\.Description is held as an index/);
    expect(propertyEditRefusal(p, 'DataType', 'p')).toMatch(/^p\.DataType follows its Value/);
    expect(propertyEditRefusal(held('Simulink.Bus', {}), 'Description', 'b')).toBe('b is a Simulink.Bus, whose properties this editor does not write into a MAT-file');
  });

  it('a Value of a class a cell is not written of, which an edit of an element of it keeps', () => {
    expect(propertyValueRefusal(P, 'Value', v('double', [], [3, 3], { isSparse: true }), 'p')).toBe('p.Value is a sparse double, which this editor does not write into a Simulink.Parameter');
    expect(propertyValueRefusal(P, 'Value', dbl([1, 2]), 'p')).toBeNull();
    expect(propertyValueRefusal(P, 'Min', dbl([1, 2]), 'p')).toMatch(/^p\.Min must be a finite real double scalar/);
  });
});

describe("MATLAB's DataType after p.Value = v, measured", () => {
  it.each([
    ['single', 'double', 'single', 'auto'],
    ['double', 'double', 'single', 'single'],
    ['double', 'int32', 'single', 'int32'],
    ['double', 'logical', 'double', 'boolean'],
    ['int16', 'char', 'int16', 'string'],
    ['double', 'struct', 'int16', 'struct'],
    ['struct', 'struct', 'Bus: MyBus', 'Bus: MyBus'],
    ['struct', 'double', 'Bus: MyBus', 'auto'],
    ['logical', 'double', 'boolean', 'auto'],
    ['double', 'uint64', 'fixdt(1,16,4)', 'uint64'],
  ])('a %s Value, set to a %s one, under %s: %s', (old, now, dt, after) => {
    expect(dataTypeAfter(old, now, dt)).toBe(after);
  });
});
