// Copyright 2026 The MathWorks, Inc.
//
// The allow-list a MAT-file object's property edit is held to (McosPropertyRules), one case a row:
// an object as the file holds it (its triples and its class's defaults struct in the file), the
// edits of one save, and the triple operations written or the refusal. The rows follow the rules
// probe's tables, measured against MATLAB R2027a: each class's rows, the set back to a default that
// removes a triple, the co-writes of a setter, the checks of the object as a save leaves it, the
// order a NumericType's setters are run in. That the operations, written, load as MATLAB's own edit
// is test/mcosPropertyRulesGoldens.test.ts's to show.

import { describe, it, expect } from 'vitest';
import type { MatVariable } from '../src/datamodel/parser/MatParser.js';
import {
  hasPropertyRules,
  identicalValues,
  parameterDataTypeAfter,
  planPropertyEdits,
  propertyRowOf,
  type McosHeldValue,
  type McosRuleObject,
  type McosRuleTarget,
  type McosTripleOp,
} from '../src/datamodel/parser/McosPropertyRules.js';

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
const cplx = (pairs: { re: number; im: number }[], dims = [1, pairs.length]) => v('double', pairs, dims, { isComplex: true });
const chr = (text: string, dims = text === '' ? [0, 0] : [1, text.length]) => v('char', text, dims);
const empty = () => dbl([], [0, 0]);
const strct = (fields: Record<string, MatVariable>) => v('struct', null, [1, 1], { fields });

// A triple as the file holds it: a value cell, an index into the file's text, an integer.
type HeldSpec = MatVariable | { str: string } | { int: number } | 'object';
const heldOf = (spec: HeldSpec): McosHeldValue =>
  spec === 'object' ? { kind: 'other' } : 'str' in spec ? { kind: 'str', text: spec.str } : 'int' in spec ? { kind: 'int', value: spec.int } : { kind: 'cell', value: spec };

function object(className: string, held: Record<string, HeldSpec>, defaults: Record<string, MatVariable> = {}): McosRuleObject {
  return {
    className,
    held: new Map(Object.entries(held).map(([k, s]) => [k, heldOf(s)])),
    defaults: new Map(Object.entries(defaults)),
  };
}

// An op in a line: what it does to which saved name, and the value.
function said(op: McosTripleOp): string {
  if (op.op === 'remove') {
    return 'remove ' + op.savedName;
  }
  if (op.kind === 'str') {
    return 'set ' + op.savedName + ' str ' + op.text;
  }
  if (op.kind === 'int') {
    return 'set ' + op.savedName + ' int ' + op.value;
  }
  const x = op.value;
  return 'set ' + op.savedName + ' ' + (x.isLogical ? 'logical' : x.className) + (x.isComplex ? ' complex' : '') + '[' + x.dimensions.join(' ') + ']:' + JSON.stringify(x.value);
}

type Edit = [string, MatVariable];

/** The ops of the edits of one object, `key` 'p', in lines; or the refusal: the property and the message. */
function opsOf(o: McosRuleObject, edits: Edit[], key = 'p'): string[] | { refused: string; message: string } {
  const r = planPropertyEdits([{ key, object: o, edits: edits.map(([property, value]) => ({ property, value })) }]);
  if (!r.ok) {
    return { refused: r.property, message: r.message };
  }
  expect(r.objects.map((x) => x.key)).toEqual([key]);
  return r.objects[0].ops.map(said);
}

const refused = (property: string, message: RegExp) => ({ refused: property, message: expect.stringMatching(message) });

interface Row {
  name: string;
  of: McosRuleObject;
  edits: Edit[];
  expect: string[] | ReturnType<typeof refused>;
}

function rows(title: string, table: Row[]): void {
  describe(title, () => {
    for (const row of table) {
      it(row.name, () => {
        expect(opsOf(row.of, row.edits)).toEqual(row.expect);
      });
    }
  });
}

// ---- Objects as MATLAB R2027a saves them -----------------------------------------------------------

const P = 'Simulink.Parameter';
// A Parameter's defaults struct, as R2027a's holds it: what an omitted property loads as.
const PARAMETER_DEFAULTS = { Value: empty(), Description: chr(''), DocUnits: chr(''), DataType: chr('auto'), Min: empty(), Max: empty() };
const param = (held: Record<string, HeldSpec> = {}) =>
  object(P, { Complexity: { str: 'real' }, Dimensions: dbl([0, 0]), CoderInfo: 'object', ...held }, PARAMETER_DEFAULTS);
// `p = Simulink.Parameter; p.Value = 5; p.DataType = 'double'; …`
const pset = (held: Record<string, HeldSpec> = {}) =>
  param({ Value: dbl(5), Dimensions: dbl([1, 1]), DataType: chr('double'), Description: chr('d'), Min: dbl(0), Max: dbl(10), DocUnits: chr('m'), ...held });
const pint = () => param({ Value: num('int16', 5), Dimensions: dbl([1, 1]), DataType: chr('int16') });

const S = 'Simulink.Signal';
const SIGNAL_DEFAULTS = {
  Dimensions: dbl(-1),
  DimensionsMode: chr('auto'),
  Complexity: chr('auto'),
  SamplingMode: chr('auto'),
  SampleTime: dbl(-1),
  InitialValue: chr(''),
  Description: chr(''),
  DocUnits: chr(''),
  DataType: chr('auto'),
  Min: empty(),
  Max: empty(),
};
const sig = (held: Record<string, HeldSpec> = {}) => object(S, { CoderInfo: 'object', LoggingInfo: 'object', ...held }, SIGNAL_DEFAULTS);

const BUS = 'Simulink.Bus';
const bus = (held: Record<string, HeldSpec> = {}) =>
  object(BUS, { Description: chr(''), DataScope: { str: 'Auto' }, HeaderFile: chr(''), PreserveElementDimensions: { int: 0 }, Elements_internal: 'object', ...held }, { Alignment: dbl(-1) });

const BE = 'Simulink.BusElement';
const ELEMENT_DEFAULTS = { DataType_internal: chr('double'), Min_internal: empty(), Max_internal: empty(), Description: chr('') };
const element = (name: string, held: Record<string, HeldSpec> = {}) =>
  object(BE, { Name: chr(name), DocUnits: chr(''), Dimensions: dbl(1), DimensionsMode: { str: 'Fixed' }, Complexity: { str: 'real' }, ...held }, ELEMENT_DEFAULTS);

const VT = 'Simulink.ValueType';
const VALUE_TYPE_DEFAULTS = { DataType: chr('double'), Min: empty(), Max: empty(), Unit: chr(''), Description: chr(''), Complexity: chr('real'), DimensionsMode: chr('Fixed'), Dimensions: dbl(1) };
const vt = (held: Record<string, HeldSpec> = {}) => object(VT, held, VALUE_TYPE_DEFAULTS);

const LUT_DATA_DEFAULTS = { Value: empty(), Min: empty(), Max: empty() };
const table = (held: Record<string, HeldSpec> = {}) =>
  object('Simulink.lookuptable.Table', { Value: dbl([10, 20, 30, 40]), Dimensions: dbl([1, 4]), DataType: chr('auto'), Unit: chr(''), FieldName: chr('Table'), Description: chr(''), ...held }, LUT_DATA_DEFAULTS);
const breakpoint = (held: Record<string, HeldSpec> = {}) =>
  object(
    'Simulink.lookuptable.Breakpoint',
    { Value: dbl([1, 2, 3, 4]), Dimensions: dbl([1, 4]), DataType: chr('auto'), Unit: chr(''), FieldName: chr('BP1'), Description: chr(''), TunableSizeName: chr('N1'), TunableSizeValue: dbl(-1), ...held },
    LUT_DATA_DEFAULTS,
  );

const NT = 'Simulink.NumericType';
// Every property of a NumericType is saved, whatever its value: its defaults struct holds none.
const nt = (mode: string, held: Record<string, HeldSpec> = {}) =>
  object(NT, {
    DataTypeMode: { str: mode },
    SignednessBool: lgc(1),
    WordLength: dbl(64),
    FixedExponent: dbl(0),
    SlopeAdjustmentFactor: dbl(1),
    Bias: dbl(0),
    DataTypeOverride: { str: 'Inherit' },
    IsAlias: lgc(0),
    Description: chr(''),
    DataScope: { str: 'Auto' },
    HeaderFile: chr(''),
    ...held,
  });
const UNSPEC = 'Fixed-point: unspecified scaling';
const BINARY = 'Fixed-point: binary point scaling';
const SLOPE = 'Fixed-point: slope and bias scaling';

const AT = 'Simulink.AliasType';
const alias = (held: Record<string, HeldSpec> = {}) => object(AT, { BaseType: chr('double'), DataScope: { str: 'Auto' }, Description: chr(''), HeaderFile: chr(''), ...held });

const CI = 'Simulink.CoderInfo';
const coder = (held: Record<string, HeldSpec> = {}) => object(CI, { StorageClass: { str: 'Auto' }, CustomAttributes: 'object', ...held });

// ---- Simulink.Parameter -------------------------------------------------------------------------------

rows('Simulink.Parameter: its Value, and what MATLAB changes with it', [
  // At its default, `[]`: a triple inserted, its Dimensions following.
  { name: 'a Value set away from its default inserts it, and its Dimensions follows', of: param(), edits: [['Value', dbl(5)]], expect: ['set Dimensions double[1 2]:[1,1]', 'set Value double[1 1]:5'] },
  { name: 'a matrix Value: Dimensions its size', of: param(), edits: [['Value', dbl([1, 2, 3, 4, 5, 6], [2, 3])]], expect: ['set Dimensions double[1 2]:[2,3]', 'set Value double[2 3]:[1,2,3,4,5,6]'] },
  { name: 'an N-D Value: Dimensions every extent', of: param(), edits: [['Value', dbl([1, 2, 3, 4, 5, 6, 7, 8], [2, 2, 2])]], expect: ['set Dimensions double[1 3]:[2,2,2]', 'set Value double[2 2 2]:[1,2,3,4,5,6,7,8]'] },
  // Back at its default: the triple removed; Dimensions kept, as MATLAB keeps it for an empty Value over one that is not.
  { name: 'a Value set back to [] removes its triple, and keeps the Dimensions', of: pset(), edits: [['Value', empty()]], expect: ['remove Value'] },
  { name: 'an empty Value over an empty one: Dimensions follows (zeros(0,3) gives [0 3])', of: param(), edits: [['Value', dbl([], [0, 3])]], expect: ['set Dimensions double[1 2]:[0,3]', 'set Value double[0 3]:[]'] },
  { name: 'the Value it holds: nothing written', of: pset(), edits: [['Value', dbl(5)]], expect: [] },
  { name: 'an int16 Value over a double: the DataType follows to its class', of: pset(), edits: [['Value', num('int16', 3)]], expect: ['set Value int16[1 1]:3', 'set DataType char[1 5]:"int16"'] },
  { name: 'a double Value over an int16: the DataType follows to auto, its default, and is removed', of: pint(), edits: [['Value', dbl(7)]], expect: ['set Value double[1 1]:7', 'remove DataType'] },
  { name: 'a logical Value: boolean', of: param(), edits: [['Value', lgc(1)]], expect: ['set Dimensions double[1 2]:[1,1]', 'set Value logical[1 1]:1', 'set DataType char[1 7]:"boolean"'] },
  { name: 'a char Value: string, and Dimensions a string scalar\'s', of: param(), edits: [['Value', chr('abc')]], expect: ['set Dimensions double[1 2]:[1,1]', 'set Value char[1 3]:"abc"', 'set DataType char[1 6]:"string"'] },
  { name: 'a struct Value: struct', of: param(), edits: [['Value', strct({ a: dbl(1) })]], expect: ['set Dimensions double[1 2]:[1,1]', expect.stringMatching(/^set Value struct\[1 1\]/), 'set DataType char[1 6]:"struct"'] as unknown as string[] },
  { name: 'a complex Value: Complexity complex', of: pset(), edits: [['Value', cplx([{ re: 1, im: 2 }])]], expect: ['set Complexity str complex', 'set Value double complex[1 1]:[{"re":1,"im":2}]'] },
  { name: 'a cell Value', of: param(), edits: [['Value', v('cell', [dbl(1)], [1, 1])]], expect: refused('Value', /p\.Value would be a cell, which this editor does not write into a Simulink\.Parameter/) },
  { name: 'a sparse Value', of: param(), edits: [['Value', dbl([1], [1, 1]) && { ...dbl(1), isSparse: true }]], expect: refused('Value', /a sparse double/) },
  // The string "" MATLAB makes of '', "" and any empty char, written as a 1x0 char, which MATLAB
  // loads as "" (S15, R2027a and R2023b).
  { name: 'an empty char Value: string, written 1x0', of: param(), edits: [['Value', chr('')]], expect: ['set Dimensions double[1 2]:[1,1]', 'set Value char[1 0]:""', 'set DataType char[1 6]:"string"'] },
  { name: 'an empty char of two rows: the same string, written 1x0', of: param(), edits: [['Value', chr('', [2, 0])]], expect: ['set Dimensions double[1 2]:[1,1]', 'set Value char[1 0]:""', 'set DataType char[1 6]:"string"'] },
  { name: 'a struct Value holding a char', of: param(), edits: [['Value', strct({ a: chr('x') })]], expect: ['set Dimensions double[1 2]:[1,1]', expect.stringMatching(/^set Value struct\[1 1\]/), 'set DataType char[1 6]:"struct"'] as unknown as string[] },
  { name: 'a struct Value holding an empty char', of: param(), edits: [['Value', strct({ a: chr('') })]], expect: refused('Value', /a struct holding a char that is empty, or not text/) },
  { name: 'an object Value', of: param(), edits: [['Value', v('Simulink.Signal', null, [1, 1], { isOpaque: true })]], expect: refused('Value', /a Simulink\.Signal/) },
  { name: 'a complex logical Value', of: param(), edits: [['Value', v('uint8', [{ re: 1, im: 1 }], [1, 1], { isLogical: true, isComplex: true })]], expect: refused('Value', /a complex logical/) },
]);

rows('Simulink.Parameter: its DataType, set on its own or with its Value', [
  { name: 'a builtin over a double Value: written', of: pset(), edits: [['DataType', chr('int8')]], expect: ['set DataType char[1 4]:"int8"'] },
  { name: 'at its default: inserted', of: param(), edits: [['DataType', chr('single')]], expect: ['set DataType char[1 6]:"single"'] },
  { name: "'auto' removes the triple", of: pset(), edits: [['DataType', chr('auto')]], expect: ['remove DataType'] },
  { name: 'fixdt, an enumeration, an alias', of: pset(), edits: [['DataType', chr('fixdt(1,16,4)')]], expect: ['set DataType char[1 13]:"fixdt(1,16,4)"'] },
  { name: 'an enumeration', of: pset(), edits: [['DataType', chr('Enum: Color')]], expect: ['set DataType char[1 11]:"Enum: Color"'] },
  { name: 'an alias, dotted', of: pset(), edits: [['DataType', chr('pkg.MyType')]], expect: ['set DataType char[1 10]:"pkg.MyType"'] },
  { name: 'a bus over an empty Value', of: param(), edits: [['DataType', chr('Bus: B')]], expect: ['set DataType char[1 6]:"Bus: B"'] },
  { name: 'a bus over a double Value: MATLAB warns of the two, on every load', of: pset(), edits: [['DataType', chr('Bus: B')]], expect: refused('DataType', /inconsistent/) },
  { name: 'over an int16 Value, another type: MATLAB converts the Value', of: pint(), edits: [['DataType', chr('double')]], expect: refused('DataType', /converts the Value to double/) },
  { name: 'over an int16 Value, its own class: no change', of: pint(), edits: [['DataType', chr('int16')]], expect: [] },
  { name: 'with the Value that makes it right: int16 Value and DataType together', of: pset(), edits: [['Value', num('int16', 3)], ['DataType', chr('int16')]], expect: ['set Value int16[1 1]:3', 'set DataType char[1 5]:"int16"'] },
  { name: "'string', which is not written for a Parameter", of: pset(), edits: [['DataType', chr('string')]], expect: refused('DataType', /'string', which this editor does not write here/) },
  { name: "'half', whose range is not checked", of: pset(), edits: [['DataType', chr('half')]], expect: refused('DataType', /'half', whose range this editor does not check/) },
  { name: 'white space at an end', of: pset(), edits: [['DataType', chr(' int8')]], expect: refused('DataType', /it trims the white space at either end/) },
  { name: 'a control character', of: pset(), edits: [['DataType', chr('in\tt8')]], expect: refused('DataType', /control character/) },
  { name: 'a bus with no space after the colon', of: param(), edits: [['DataType', chr('Bus:B')]], expect: refused('DataType', /one space after the colon/) },
  { name: 'text that names no type', of: pset(), edits: [['DataType', chr('fixdt(foo)')]], expect: refused('DataType', /not a data type this editor writes here/) },
  { name: 'a number', of: pset(), edits: [['DataType', dbl(3)]], expect: refused('DataType', /must be text/) },
]);

rows("Simulink.Parameter: a Value held to its DataType's range", [
  { name: 'uint8: 300 is out', of: pset(), edits: [['DataType', chr('uint8')], ['Value', dbl(300)]], expect: refused('Value', /p\.Value would hold 300, outside the range \[0, 255\] of its DataType 'uint8'/) },
  { name: 'a Value edit under a kept uint8 DataType', of: pset({ DataType: chr('uint8'), Min: empty(), Max: empty() }), edits: [['Value', dbl(300)]], expect: refused('Value', /outside the range \[0, 255\]/) },
  { name: 'uint8: 255 is in', of: pset({ DataType: chr('uint8'), Min: empty(), Max: empty() }), edits: [['Value', dbl(255)]], expect: ['set Value double[1 1]:255'] },
  { name: 'int64: 2^63 is past its top', of: pset({ DataType: chr('int64'), Min: empty(), Max: empty() }), edits: [['Value', dbl(2 ** 63)]], expect: refused('Value', /9223372036854775807/) },
  { name: 'single: past realmax', of: pset({ DataType: chr('single'), Min: empty(), Max: empty() }), edits: [['Value', dbl(1e39)]], expect: refused('Value', /realmax\('single'\)/) },
  { name: 'double: Inf', of: pset(), edits: [['Value', dbl(Infinity)]], expect: refused('Value', /would hold Inf/) },
  { name: 'double: NaN', of: pset(), edits: [['Value', dbl(NaN)]], expect: refused('Value', /would hold NaN/) },
  { name: 'boolean: 1 is in', of: pset({ DataType: chr('boolean'), Min: empty(), Max: empty() }), edits: [['Value', dbl(1)]], expect: ['set Value double[1 1]:1'] },
  { name: 'boolean: 0.5 is not 0 or 1', of: pset({ DataType: chr('boolean'), Min: empty(), Max: empty() }), edits: [['Value', dbl(0.5)]], expect: refused('Value', /takes only 0 and 1/) },
  { name: 'boolean: a complex value', of: pset({ DataType: chr('boolean'), Min: empty(), Max: empty() }), edits: [['Value', cplx([{ re: 1, im: 0 }])]], expect: refused('Value', /a complex value/) },
  { name: 'an imaginary part out of range', of: pset({ DataType: chr('int8'), Min: empty(), Max: empty() }), edits: [['Value', cplx([{ re: 1, im: 200 }])]], expect: refused('Value', /would hold 200/) },
  { name: 'fixdt is not checked', of: pset({ DataType: chr('fixdt(1,8,0)'), Min: empty(), Max: empty() }), edits: [['Value', dbl(1e6)]], expect: ['set Value double[1 1]:1000000'] },
]);

rows('Simulink.Parameter: Min, Max, Description, Unit', [
  { name: 'a Min at its default: inserted', of: param(), edits: [['Min', dbl(-1)]], expect: ['set Min double[1 1]:-1'] },
  { name: 'a Min set back to []: removed', of: pset(), edits: [['Min', empty()]], expect: ['remove Min'] },
  { name: 'zeros(1,0) is not [], and is saved', of: pset(), edits: [['Min', dbl([], [1, 0])]], expect: ['set Min double[1 0]:[]'] },
  { name: 'Min above Max', of: pset(), edits: [['Min', dbl(20)]], expect: refused('Min', /p\.Min \(20\) would be greater than its Max \(10\)/) },
  { name: 'Min and Max set together are held to each other as they will be', of: pset(), edits: [['Min', dbl(20)], ['Max', dbl(30)]], expect: ['set Min double[1 1]:20', 'set Max double[1 1]:30'] },
  { name: 'Min out of its int16 DataType', of: pint(), edits: [['Min', dbl(-40000)]], expect: refused('Min', /outside the range \[-32768, 32767\]/) },
  { name: 'a bus DataType takes bounds on a Parameter', of: param({ DataType: chr('Bus: B') }), edits: [['Min', dbl(1)]], expect: ['set Min double[1 1]:1'] },
  { name: 'an int16 Min', of: pset(), edits: [['Min', num('int16', 3)]], expect: refused('Min', /must be a finite real double scalar or \[\]/) },
  { name: 'a Min of -Inf', of: pset(), edits: [['Min', dbl(-Infinity)]], expect: refused('Min', /finite real double/) },
  { name: 'a vector Min', of: pset(), edits: [['Min', dbl([1, 2])]], expect: refused('Min', /finite real double/) },
  { name: 'a Description', of: param(), edits: [['Description', chr('  x  ')]], expect: ['set Description char[1 5]:"  x  "'] },
  { name: "a Description set back to ''", of: pset(), edits: [['Description', chr('')]], expect: ['remove Description'] },
  { name: 'a Description of white space alone', of: pset(), edits: [['Description', chr(' \t')]], expect: refused('Description', /which MATLAB would load as '': it loads text of white space alone as empty/) },
  { name: 'a numeric Description', of: pset(), edits: [['Description', dbl(3)]], expect: refused('Description', /p\.Description must be text: MATLAB refuses a 1x1 double/) },
  { name: 'a Description with a lone surrogate', of: pset(), edits: [['Description', chr('a\uD800b')]], expect: refused('Description', /lone UTF-16 surrogate/) },
  { name: 'a Unit is saved as DocUnits', of: param(), edits: [['Unit', chr('km')]], expect: ['set DocUnits char[1 2]:"km"'] },
  { name: 'a Unit of white space alone', of: pset(), edits: [['Unit', chr(' ')]], expect: refused('Unit', /white space alone/) },
  { name: 'Dimensions is no property an edit sets', of: pset(), edits: [['Dimensions', dbl([1, 1])]], expect: refused('Dimensions', /p\.Dimensions is not one this editor writes into a Simulink\.Parameter/) },
  { name: 'nor Complexity', of: pset(), edits: [['Complexity', chr('complex')]], expect: refused('Complexity', /is not one this editor writes/) },
  // A triple held another way than R2027a saves it: of a layout the rules were not measured on.
  // MATLAB R2023b saves a Parameter's Complexity as a char cell: the edit keeps the triple's own encoding.
  { name: 'a Complexity held as a char cell, as R2023b saves it, written as one', of: pset({ Complexity: chr('real') }), edits: [['Value', cplx([{ re: 1, im: 2 }])]], expect: ['set Complexity char[1 7]:"complex"', 'set Value double complex[1 1]:[{"re":1,"im":2}]'] },
  { name: 'a Complexity held as an object, which no text is written as', of: pset({ Complexity: 'object' }), edits: [['Value', cplx([{ re: 1, im: 2 }])]], expect: refused('Value', /p\.Complexity is held in this file as an object, where this editor writes an index into the file's text/) },
  { name: 'a property the object neither holds nor has a default for (its release saves none)', of: object(P, { Value: dbl(5), Dimensions: dbl([1, 1]), Complexity: { str: 'real' } }, {}), edits: [['Min', dbl(0)]], expect: refused('Min', /p\.Min is not a property the MATLAB release that wrote this object saves, nor one its class records a default of in the file/) },
]);

// ---- Simulink.Signal ----------------------------------------------------------------------------------

rows('Simulink.Signal: every property omittable', [
  { name: 'Dimensions set away from -1: inserted', of: sig(), edits: [['Dimensions', dbl([2, 3])]], expect: ['set Dimensions double[1 2]:[2,3]'] },
  { name: 'Dimensions back to -1: removed', of: sig({ Dimensions: dbl([2, 3]) }), edits: [['Dimensions', dbl(-1)]], expect: ['remove Dimensions'] },
  { name: 'Dimensions [1 1] is saved as given', of: sig(), edits: [['Dimensions', dbl([1, 1])]], expect: ['set Dimensions double[1 2]:[1,1]'] },
  { name: 'Dimensions 0', of: sig(), edits: [['Dimensions', dbl(0)]], expect: refused('Dimensions', /must hold positive whole numbers, or be -1: MATLAB refuses 0/) },
  { name: 'Dimensions 0.5', of: sig(), edits: [['Dimensions', dbl(0.5)]], expect: refused('Dimensions', /MATLAB refuses 0\.5/) },
  { name: 'Dimensions with a trailing 1', of: sig(), edits: [['Dimensions', dbl([2, 3, 1])]], expect: refused('Dimensions', /trailing 1 past its second extent/) },
  { name: 'Dimensions []', of: sig(), edits: [['Dimensions', empty()]], expect: refused('Dimensions', /double row of positive whole numbers, or -1/) },
  { name: 'Dimensions int32', of: sig(), edits: [['Dimensions', num('int32', 2)]], expect: refused('Dimensions', /double row/) },
  { name: 'Dimensions past 2^31-1 elements', of: sig(), edits: [['Dimensions', dbl([65536, 65536])]], expect: refused('Dimensions', /more than 2\^31-1/) },
  { name: 'Dimensions symbolic text', of: sig(), edits: [['Dimensions', chr('[1,N]')]], expect: refused('Dimensions', /symbolic char/) },
  { name: 'DimensionsMode Fixed: an index', of: sig(), edits: [['DimensionsMode', chr('Fixed')]], expect: ['set DimensionsMode str Fixed'] },
  { name: "DimensionsMode back to 'auto': removed", of: sig({ DimensionsMode: { str: 'Fixed' } }), edits: [['DimensionsMode', chr('auto')]], expect: ['remove DimensionsMode'] },
  { name: "DimensionsMode 'fixed', which MATLAB re-spells", of: sig(), edits: [['DimensionsMode', chr('fixed')]], expect: refused('DimensionsMode', /must be one of 'auto', 'Fixed', 'Variable', spelled so: MATLAB refuses or re-spells 'fixed'/) },
  { name: 'Complexity complex', of: sig(), edits: [['Complexity', chr('complex')]], expect: ['set Complexity str complex'] },
  { name: "Complexity 'Complex'", of: sig(), edits: [['Complexity', chr('Complex')]], expect: refused('Complexity', /spelled so/) },
  { name: 'SamplingMode Frame based', of: sig(), edits: [['SamplingMode', chr('Frame based')]], expect: ['set SamplingMode str Frame based'] },
  { name: 'SampleTime 0.1', of: sig(), edits: [['SampleTime', dbl(0.1)]], expect: ['set SampleTime double[1 1]:0.1'] },
  { name: 'SampleTime Inf', of: sig(), edits: [['SampleTime', dbl(Infinity)]], expect: ['set SampleTime double[1 1]:null'] },
  { name: 'SampleTime [Ts offset]', of: sig(), edits: [['SampleTime', dbl([0.1, 0.05])]], expect: ['set SampleTime double[1 2]:[0.1,0.05]'] },
  { name: 'SampleTime back to -1: removed', of: sig({ SampleTime: dbl(0.1) }), edits: [['SampleTime', dbl(-1)]], expect: ['remove SampleTime'] },
  { name: 'SampleTime [Ts 0], which MATLAB makes Ts', of: sig(), edits: [['SampleTime', dbl([0.1, 0])]], expect: refused('SampleTime', /makes \[Ts 0\] Ts/) },
  { name: 'SampleTime -2', of: sig(), edits: [['SampleTime', dbl(-2)]], expect: refused('SampleTime', /must be -1, 0, a positive double or Inf/) },
  { name: 'SampleTime offset past Ts', of: sig(), edits: [['SampleTime', dbl([0.1, 0.2])]], expect: refused('SampleTime', /0 < offset < Ts/) },
  { name: 'InitialValue', of: sig(), edits: [['InitialValue', chr('3')]], expect: ['set InitialValue char[1 1]:"3"'] },
  { name: 'InitialValue with white space at an end', of: sig(), edits: [['InitialValue', chr(' 3')]], expect: refused('InitialValue', /it trims the white space at either end/) },
  { name: 'InitialValue not ASCII', of: sig(), edits: [['InitialValue', chr('é')]], expect: refused('InitialValue', /takes only ASCII text/) },
  { name: 'DataType string', of: sig(), edits: [['DataType', chr('string')]], expect: ['set DataType char[1 6]:"string"'] },
  { name: "DataType 'auto' removes it", of: sig({ DataType: chr('int16') }), edits: [['DataType', chr('auto')]], expect: ['remove DataType'] },
  { name: 'a bus DataType with a Min', of: sig({ Min: dbl(0) }), edits: [['DataType', chr('Bus: B')]], expect: refused('DataType', /MATLAB ignores a minimum and a maximum for a bus/) },
  { name: 'a uint8 DataType under a Max of 300', of: sig({ Max: dbl(300) }), edits: [['DataType', chr('uint8')]], expect: refused('DataType', /p\.Max \(300\) would be outside the range \[0, 255\]/) },
  { name: 'a Max of 300 under a uint8 DataType', of: sig({ DataType: chr('uint8') }), edits: [['Max', dbl(300)]], expect: refused('Max', /outside the range/) },
  { name: 'a Description of white space alone', of: sig(), edits: [['Description', chr(' ')]], expect: refused('Description', /white space alone/) },
  { name: 'a Unit', of: sig(), edits: [['Unit', chr('V')]], expect: ['set DocUnits char[1 1]:"V"'] },
  { name: 'StorageClass is its CoderInfo\'s, not its own', of: sig(), edits: [['StorageClass', chr('ExportedGlobal')]], expect: refused('StorageClass', /is not one this editor writes into a Simulink\.Signal/) },
]);

// ---- Simulink.Bus, Simulink.BusElement ---------------------------------------------------------------------

rows('Simulink.Bus', [
  { name: 'Description', of: bus(), edits: [['Description', chr('a bus')]], expect: ['set Description char[1 5]:"a bus"'] },
  { name: "Description '' is saved (no default)", of: bus({ Description: chr('x') }), edits: [['Description', chr('')]], expect: ['set Description char[0 0]:""'] },
  { name: 'HeaderFile with white space at an end, which MATLAB trims', of: bus(), edits: [['HeaderFile', chr(' b.h')]], expect: refused('HeaderFile', /it trims the white space at either end/) },
  // White space as MATLAB's setters trim it: NEL too, which JavaScript's trim does not; a
  // byte-order mark, which they keep, refused all the same, as are U+001C to U+001F, which they keep
  // and the verified rule counts as white space; another control character, written.
  { name: 'HeaderFile ending in a NEL (U+0085), which MATLAB trims', of: bus(), edits: [['HeaderFile', chr('b.h\u0085')]], expect: refused('HeaderFile', /it trims the white space at either end/) },
  { name: 'HeaderFile ending in a no-break space', of: bus(), edits: [['HeaderFile', chr('b.h\u00a0')]], expect: refused('HeaderFile', /it trims the white space at either end/) },
  { name: 'HeaderFile ending in a byte-order mark, not measured', of: bus(), edits: [['HeaderFile', chr('b.h\ufeff')]], expect: refused('HeaderFile', /it trims the white space at either end/) },
  ...['\u001c', '\u001d', '\u001e', '\u001f'].map((c) => ({ name: `HeaderFile ending in U+00${c.charCodeAt(0).toString(16).toUpperCase()}`, of: bus(), edits: [['HeaderFile', chr('b.h' + c)]] as [string, MatVariable][], expect: refused('HeaderFile', /it trims the white space at either end/) })),
  { name: 'a Description of U+001C alone', of: bus(), edits: [['Description', chr('\u001c')]], expect: refused('Description', /white space alone/) },
  { name: 'HeaderFile ending in U+001B, which is no white space', of: bus(), edits: [['HeaderFile', chr('b.h\u001b')]], expect: ['set HeaderFile char[1 4]:"b.h\\u001b"'] },
  { name: 'a Description of a NEL alone', of: bus(), edits: [['Description', chr('\u0085')]], expect: refused('Description', /white space alone/) },
  { name: 'a HeaderFile not ASCII, which MATLAB refuses', of: bus(), edits: [['HeaderFile', chr('b\u00e9.h')]], expect: refused('HeaderFile', /it takes ASCII characters only/) },
  { name: 'HeaderFile', of: bus(), edits: [['HeaderFile', chr('b.h')]], expect: ['set HeaderFile char[1 3]:"b.h"'] },
  { name: 'DataScope Exported: an index swapped', of: bus(), edits: [['DataScope', chr('Exported')]], expect: ['set DataScope str Exported'] },
  { name: "DataScope 'exported'", of: bus(), edits: [['DataScope', chr('exported')]], expect: refused('DataScope', /'Auto', 'Exported', 'Imported'/) },
  { name: 'Alignment 8: inserted', of: bus(), edits: [['Alignment', dbl(8)]], expect: ['set Alignment double[1 1]:8'] },
  { name: 'Alignment back to -1: removed', of: bus({ Alignment: dbl(8) }), edits: [['Alignment', dbl(-1)]], expect: ['remove Alignment'] },
  { name: 'Alignment 3', of: bus(), edits: [['Alignment', dbl(3)]], expect: refused('Alignment', /power of two up to 128/) },
  { name: 'Alignment 2.5, which MATLAB rounds', of: bus(), edits: [['Alignment', dbl(2.5)]], expect: refused('Alignment', /power of two/) },
  { name: 'Alignment 256, which MATLAB takes against its own message', of: bus(), edits: [['Alignment', dbl(256)]], expect: refused('Alignment', /256 and 512/) },
  { name: 'Alignment int32(4)', of: bus(), edits: [['Alignment', num('int32', 4)]], expect: refused('Alignment', /as a double/) },
  { name: 'PreserveElementDimensions true: an integer', of: bus(), edits: [['PreserveElementDimensions', lgc(1)]], expect: ['set PreserveElementDimensions int 1'] },
  { name: 'PreserveElementDimensions 1', of: bus(), edits: [['PreserveElementDimensions', dbl(1)]], expect: ['set PreserveElementDimensions int 1'] },
  { name: 'PreserveElementDimensions 2, which MATLAB makes true', of: bus(), edits: [['PreserveElementDimensions', dbl(2)]], expect: refused('PreserveElementDimensions', /MATLAB makes 2 true/) },
  { name: "PreserveElementDimensions 'true'", of: bus(), edits: [['PreserveElementDimensions', chr('true')]], expect: refused('PreserveElementDimensions', /must be true or false/) },
  { name: 'Elements is no property edit', of: bus(), edits: [['Elements', dbl(1)]], expect: refused('Elements', /is not one this editor writes into a Simulink\.Bus/) },
]);

rows('Simulink.BusElement', [
  { name: 'Name', of: element('e1'), edits: [['Name', chr('speed')]], expect: ['set Name char[1 5]:"speed"'] },
  { name: 'Name, a hundred characters', of: element('e1'), edits: [['Name', chr('a'.repeat(100))]], expect: ['set Name char[1 100]:"' + 'a'.repeat(100) + '"'] },
  { name: "Name '1x'", of: element('e1'), edits: [['Name', chr('1x')]], expect: refused('Name', /must be a MATLAB identifier: MATLAB refuses '1x'/) },
  { name: "Name ''", of: element('e1'), edits: [['Name', chr('')]], expect: refused('Name', /MATLAB identifier/) },
  { name: "Name 'sl_padding1'", of: element('e1'), edits: [['Name', chr('sl_padding1')]], expect: refused('Name', /sl_padding/) },
  { name: 'DataType int16: inserted as DataType_internal', of: element('e1'), edits: [['DataType', chr('int16')]], expect: ['set DataType_internal char[1 5]:"int16"'] },
  { name: 'DataType back to double: removed', of: element('e1', { DataType_internal: chr('int16') }), edits: [['DataType', chr('double')]], expect: ['remove DataType_internal'] },
  { name: "DataType 'auto'", of: element('e1'), edits: [['DataType', chr('auto')]], expect: refused('DataType', /cannot be 'auto'/) },
  { name: 'DataType a value type', of: element('e1'), edits: [['DataType', chr('ValueType: VT')]], expect: ['set DataType_internal char[1 13]:"ValueType: VT"'] },
  { name: 'Dimensions [2 1]', of: element('e1'), edits: [['Dimensions', dbl([2, 1])]], expect: ['set Dimensions double[1 2]:[2,1]'] },
  { name: 'Dimensions -1, which a bus element does not take', of: element('e1'), edits: [['Dimensions', dbl(-1)]], expect: refused('Dimensions', /MATLAB refuses -1/) },
  { name: 'DimensionsMode Variable', of: element('e1'), edits: [['DimensionsMode', chr('Variable')]], expect: ['set DimensionsMode str Variable'] },
  { name: "DimensionsMode 'auto'", of: element('e1'), edits: [['DimensionsMode', chr('auto')]], expect: refused('DimensionsMode', /'Fixed', 'Variable'/) },
  { name: 'Complexity complex', of: element('e1'), edits: [['Complexity', chr('complex')]], expect: ['set Complexity str complex'] },
  { name: 'Min and Max: saved as Min_internal and Max_internal', of: element('e1'), edits: [['Min', dbl(-5)], ['Max', dbl(5)]], expect: ['set Min_internal double[1 1]:-5', 'set Max_internal double[1 1]:5'] },
  // MATLAB's load does not check a bus element's bounds at all: the rules do.
  { name: 'Min above Max', of: element('e1', { Max_internal: dbl(0) }), edits: [['Min', dbl(1)]], expect: refused('Min', /greater than its Max/) },
  { name: 'an int16 Min, which would load as written', of: element('e1'), edits: [['Min', num('int16', 3)]], expect: refused('Min', /finite real double scalar/) },
  { name: 'a Min of Inf', of: element('e1'), edits: [['Min', dbl(Infinity)]], expect: refused('Min', /finite real double scalar/) },
  { name: 'a Min out of its int8 DataType', of: element('e1', { DataType_internal: chr('int8') }), edits: [['Min', dbl(-200)]], expect: refused('Min', /outside the range \[-128, 127\]/) },
  { name: 'a Min under a bus DataType', of: element('e1', { DataType_internal: chr('Bus: B') }), edits: [['Min', dbl(1)]], expect: refused('Min', /ignores a minimum and a maximum for a bus/) },
  { name: 'Unit of white space is kept as typed', of: element('e1'), edits: [['Unit', chr(' ')]], expect: ['set DocUnits char[1 1]:" "'] },
  { name: 'Description of white space is kept as typed', of: element('e1'), edits: [['Description', chr(' ')]], expect: ['set Description char[1 1]:" "'] },
  { name: "Description '' removes it", of: element('e1', { Description: chr('first') }), edits: [['Description', chr('')]], expect: ['remove Description'] },
]);

describe("Simulink.BusElement: the names of a bus's elements, unique after every edit of the save", () => {
  const e1 = element('e1');
  const e2 = element('e2');
  const elements = [e1, e2];
  const target = (k: number, name: string): McosRuleTarget => ({
    key: 'b.Elements(' + (k + 1) + ')',
    object: elements[k],
    edits: [{ property: 'Name', value: chr(name) }],
    bus: { key: 'b', elements, index: k },
  });

  it("a name another element holds is refused: MATLAB refuses it at the assignment, and its load takes it", () => {
    const r = planPropertyEdits([target(1, 'e1')]);
    expect(r).toMatchObject({ ok: false, key: 'b.Elements(2)', property: 'Name', message: expect.stringMatching(/b would hold two elements named 'e1'/) });
  });

  it('two names swapped in one save are written: the save leaves them unique', () => {
    const r = planPropertyEdits([target(0, 'e2'), target(1, 'e1')]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.objects.map((o) => [o.key, o.ops.map(said)])).toEqual([
        ['b.Elements(1)', ['set Name char[1 2]:"e2"']],
        ['b.Elements(2)', ['set Name char[1 2]:"e1"']],
      ]);
    }
  });

  it('a new name no element holds', () => {
    const r = planPropertyEdits([target(1, 'speed')]);
    expect(r.ok).toBe(true);
  });

  it('the edits of one key are one list', () => {
    const r = planPropertyEdits([target(1, 'x'), { ...target(1, 'y') }]);
    expect(r.ok && r.objects.map((o) => o.ops.map(said))).toEqual([['set Name char[1 1]:"y"']]);
  });
});

// ---- Simulink.ValueType -------------------------------------------------------------------------------

rows('Simulink.ValueType: every property omittable, nothing cross-checked', [
  { name: 'Complexity complex: a char cell', of: vt(), edits: [['Complexity', chr('complex')]], expect: ['set Complexity char[1 7]:"complex"'] },
  { name: 'Complexity back to real: removed', of: vt({ Complexity: chr('complex') }), edits: [['Complexity', chr('real')]], expect: ['remove Complexity'] },
  { name: "Complexity 'auto'", of: vt(), edits: [['Complexity', chr('auto')]], expect: refused('Complexity', /'real', 'complex'/) },
  { name: 'DimensionsMode Variable: a char cell', of: vt(), edits: [['DimensionsMode', chr('Variable')]], expect: ['set DimensionsMode char[1 8]:"Variable"'] },
  { name: 'Dimensions [2 3]', of: vt(), edits: [['Dimensions', dbl([2, 3])]], expect: ['set Dimensions double[1 2]:[2,3]'] },
  { name: 'Dimensions back to 1: removed', of: vt({ Dimensions: dbl([2, 3]) }), edits: [['Dimensions', dbl(1)]], expect: ['remove Dimensions'] },
  { name: 'Dimensions -1', of: vt(), edits: [['Dimensions', dbl(-1)]], expect: refused('Dimensions', /MATLAB refuses -1/) },
  { name: 'DataType int16', of: vt(), edits: [['DataType', chr('int16')]], expect: ['set DataType char[1 5]:"int16"'] },
  { name: "DataType 'auto'", of: vt(), edits: [['DataType', chr('auto')]], expect: refused('DataType', /cannot be 'auto'/) },
  { name: 'DataType another value type', of: vt(), edits: [['DataType', chr('ValueType: V2')]], expect: refused('DataType', /not a data type this editor writes here/) },
  { name: 'DataType a bus', of: vt(), edits: [['DataType', chr('Bus: B')]], expect: ['set DataType char[1 6]:"Bus: B"'] },
  { name: 'Min above Max, which MATLAB does not check for a value type', of: vt(), edits: [['Min', dbl(5)], ['Max', dbl(1)]], expect: ['set Min double[1 1]:5', 'set Max double[1 1]:1'] },
  { name: 'an int16 Max', of: vt(), edits: [['Max', num('int16', 1)]], expect: refused('Max', /finite real double scalar/) },
  { name: 'Unit, saved as Unit', of: vt(), edits: [['Unit', chr('m')]], expect: ['set Unit char[1 1]:"m"'] },
  // A unit expression MATLAB parses (unitExpression; test/unitExpression.test.ts), which a file loads
  // as '' when it does not parse.
  { name: 'Unit m/s^2', of: vt(), edits: [['Unit', chr('m/s^2')]], expect: ['set Unit char[1 5]:"m/s^2"'] },
  { name: 'Unit of two names', of: vt(), edits: [['Unit', chr('m s')]], expect: refused('Unit', /^p\.Unit would be 'm s', which MATLAB refuses: Encountered error while parsing unit expression 'm s' at position 3$/) },
  { name: 'Unit with a comma', of: vt(), edits: [['Unit', chr('m,s')]], expect: refused('Unit', /^p\.Unit would be 'm,s', which MATLAB refuses: Invalid unit expression 'm,s' in 'Unit' property$/) },
  { name: 'Description of white space, kept', of: vt(), edits: [['Description', chr(' ')]], expect: ['set Description char[1 1]:" "'] },
]);

// ---- Lookup tables ---------------------------------------------------------------------------------

rows('Simulink.LookupTable and Simulink.Breakpoint: their own flags', [
  { name: 'SupportTunableSize true', of: object('Simulink.LookupTable', { SupportTunableSize: { int: 0 }, BreakpointsSpecification: { str: 'Explicit values' } }), edits: [['SupportTunableSize', lgc(1)]], expect: ['set SupportTunableSize int 1'] },
  { name: 'AllowMultiple… true', of: object('Simulink.LookupTable', { AllowMultipleInstancesOfTypeToHaveDifferentTableBreakpointSizes: { int: 0 } }), edits: [['AllowMultipleInstancesOfTypeToHaveDifferentTableBreakpointSizes', lgc(1)]], expect: ['set AllowMultipleInstancesOfTypeToHaveDifferentTableBreakpointSizes int 1'] },
  { name: 'BreakpointsSpecification as it is: no change', of: object('Simulink.LookupTable', { BreakpointsSpecification: { str: 'Explicit values' } }), edits: [['BreakpointsSpecification', chr('Explicit values')]], expect: [] },
  { name: 'BreakpointsSpecification at its default, as it is', of: object('Simulink.LookupTable', {}), edits: [['BreakpointsSpecification', chr('Explicit values')]], expect: [] },
  { name: 'BreakpointsSpecification changed, which replaces the Breakpoints objects', of: object('Simulink.LookupTable', {}), edits: [['BreakpointsSpecification', chr('Even spacing')]], expect: refused('BreakpointsSpecification', /replaces the objects of its Breakpoints/) },
  { name: 'a Simulink.Breakpoint has no AllowMultiple…', of: object('Simulink.Breakpoint', { SupportTunableSize: { int: 0 } }), edits: [['AllowMultipleInstancesOfTypeToHaveDifferentTableBreakpointSizes', lgc(1)]], expect: refused('AllowMultipleInstancesOfTypeToHaveDifferentTableBreakpointSizes', /is not one this editor writes into a Simulink\.Breakpoint/) },
  { name: "StorageClass is its CoderInfo's", of: object('Simulink.LookupTable', {}), edits: [['StorageClass', chr('Auto')]], expect: refused('StorageClass', /is not one this editor writes into a Simulink\.LookupTable/) },
]);

rows("Simulink.lookuptable.Table and .Breakpoint: a Value, and its Dimensions following", [
  { name: 'a Table Value resized: its Dimensions follows', of: table(), edits: [['Value', dbl([1, 2, 3])]], expect: ['set Value double[1 3]:[1,2,3]', 'set Dimensions double[1 2]:[1,3]'] },
  { name: 'a Table Value of int8, its DataType not derived', of: table(), edits: [['Value', num('int8', [1, 2, 3, 4])]], expect: ['set Value int8[1 4]:[1,2,3,4]'] },
  { name: 'a Table Value set back to []: removed, Dimensions [0 0]', of: table(), edits: [['Value', empty()]], expect: ['set Dimensions double[1 2]:[0,0]', 'remove Value'] },
  { name: 'a symbolic Dimensions stays', of: table({ Dimensions: chr('[1,N]') }), edits: [['Value', dbl([1, 2])]], expect: ['set Value double[1 2]:[1,2]'] },
  { name: 'a scalar Table', of: table(), edits: [['Value', dbl(5)]], expect: refused('Value', /cannot be a scalar/) },
  { name: 'a char Table', of: table(), edits: [['Value', chr('ab')]], expect: refused('Value', /must be numeric or logical/) },
  { name: 'a Breakpoint vector', of: breakpoint(), edits: [['Value', dbl([1, 2, 3])]], expect: ['set Value double[1 3]:[1,2,3]', 'set Dimensions double[1 2]:[1,3]'] },
  { name: 'a Breakpoint column', of: breakpoint(), edits: [['Value', dbl([1, 2], [2, 1])]], expect: ['set Value double[2 1]:[1,2]', 'set Dimensions double[1 2]:[2,1]'] },
  { name: 'a Breakpoint matrix', of: breakpoint(), edits: [['Value', dbl([1, 2, 3, 4], [2, 2])]], expect: refused('Value', /a vector of two or more elements/) },
  { name: 'a scalar Breakpoint', of: breakpoint(), edits: [['Value', dbl(5)]], expect: refused('Value', /a vector of two or more/) },
  { name: 'a complex Breakpoint', of: breakpoint(), edits: [['Value', cplx([{ re: 1, im: 1 }, { re: 2, im: 0 }])]], expect: refused('Value', /must be real/) },
  { name: 'TunableSizeValue 2', of: breakpoint(), edits: [['TunableSizeValue', dbl(2)]], expect: ['set TunableSizeValue double[1 1]:2'] },
  { name: 'TunableSizeValue 1', of: breakpoint(), edits: [['TunableSizeValue', dbl(1)]], expect: refused('TunableSizeValue', /-1 or a whole number of 2 or more/) },
  { name: 'TunableSizeValue 2.5', of: breakpoint(), edits: [['TunableSizeValue', dbl(2.5)]], expect: refused('TunableSizeValue', /whole number/) },
  { name: 'TunableSizeName', of: breakpoint(), edits: [['TunableSizeName', chr('N2')]], expect: ['set TunableSizeName char[1 2]:"N2"'] },
  { name: "TunableSizeName 'bad name'", of: breakpoint(), edits: [['TunableSizeName', chr('bad name')]], expect: refused('TunableSizeName', /MATLAB identifier/) },
  { name: 'a Table has no TunableSizeName', of: table(), edits: [['TunableSizeName', chr('N2')]], expect: refused('TunableSizeName', /is not one this editor writes into a Simulink\.lookuptable\.Table/) },
  { name: 'FieldName', of: table(), edits: [['FieldName', chr('T')]], expect: ['set FieldName char[1 1]:"T"'] },
  { name: 'a Table Unit', of: table(), edits: [['Unit', chr('kg*m')]], expect: ['set Unit char[1 4]:"kg*m"'] },
  { name: 'a Table Unit of two names', of: table(), edits: [['Unit', chr('kg m')]], expect: refused('Unit', /Encountered error while parsing unit expression 'kg m' at position 4/) },
  { name: 'a Breakpoint Unit with a trailing operator', of: breakpoint(), edits: [['Unit', chr('m*')]], expect: refused('Unit', /Encountered error while parsing unit expression 'm\*' at position 3/) },
  { name: 'Min, with no check against Max or the data', of: table({ Max: dbl(0) }), edits: [['Min', dbl(5)]], expect: ['set Min double[1 1]:5'] },
  { name: 'a Min set back to []', of: table({ Min: dbl(1) }), edits: [['Min', empty()]], expect: ['remove Min'] },
]);

rows('Simulink.lookuptable.StructTypeInfo', [
  { name: "Name '' is taken", of: object('Simulink.lookuptable.StructTypeInfo', { Name: chr('S'), DataScope: { str: 'Auto' }, HeaderFileName: chr('') }), edits: [['Name', chr('')]], expect: ['set Name char[0 0]:""'] },
  { name: "Name '_x'", of: object('Simulink.lookuptable.StructTypeInfo', { Name: chr('S') }), edits: [['Name', chr('_x')]], expect: refused('Name', /MATLAB identifier/) },
  { name: 'DataScope Imported', of: object('Simulink.lookuptable.StructTypeInfo', { DataScope: { str: 'Auto' } }), edits: [['DataScope', chr('Imported')]], expect: ['set DataScope str Imported'] },
  { name: 'HeaderFileName kept as typed', of: object('Simulink.lookuptable.StructTypeInfo', { HeaderFileName: chr('') }), edits: [['HeaderFileName', chr(' x.h ')]], expect: ['set HeaderFileName char[1 5]:" x.h "'] },
]);

// ---- Simulink.NumericType -------------------------------------------------------------------------------

rows("Simulink.NumericType: a DataTypeMode, and the properties MATLAB's setter sets with it", [
  { name: 'Double to Single: WordLength 32', of: nt('Double'), edits: [['DataTypeMode', chr('Single')]], expect: ['set DataTypeMode str Single', 'set WordLength double[1 1]:32'] },
  { name: 'Double to Half: WordLength 16', of: nt('Double'), edits: [['DataTypeMode', chr('Half')]], expect: ['set DataTypeMode str Half', 'set WordLength double[1 1]:16'] },
  { name: 'Double to Boolean: WordLength 1, unsigned', of: nt('Double'), edits: [['DataTypeMode', chr('Boolean')]], expect: ['set DataTypeMode str Boolean', 'set SignednessBool logical[1 1]:0', 'set WordLength double[1 1]:1'] },
  { name: 'Boolean to Double: WordLength 64, signed', of: nt('Boolean', { SignednessBool: lgc(0), WordLength: dbl(1) }), edits: [['DataTypeMode', chr('Double')]], expect: ['set DataTypeMode str Double', 'set SignednessBool logical[1 1]:1', 'set WordLength double[1 1]:64'] },
  { name: 'Double to binary point: WordLength 16, signed', of: nt('Double'), edits: [['DataTypeMode', chr(BINARY)]], expect: ['set DataTypeMode str ' + BINARY, 'set WordLength double[1 1]:16'] },
  { name: 'Boolean to unspecified: WordLength 16, signed', of: nt('Boolean', { SignednessBool: lgc(0), WordLength: dbl(1) }), edits: [['DataTypeMode', chr(UNSPEC)]], expect: ['set DataTypeMode str ' + UNSPEC, 'set SignednessBool logical[1 1]:1', 'set WordLength double[1 1]:16'] },
  { name: 'unspecified (WL 12) to binary point: WordLength kept', of: nt(UNSPEC, { WordLength: dbl(12) }), edits: [['DataTypeMode', chr(BINARY)]], expect: ['set DataTypeMode str ' + BINARY] },
  { name: 'binary point (signed, FE -4) to slope and bias: all kept', of: nt(BINARY, { WordLength: dbl(16), FixedExponent: dbl(-4) }), edits: [['DataTypeMode', chr(SLOPE)]], expect: ['set DataTypeMode str ' + SLOPE] },
  { name: 'slope and bias (SAF 1.5, Bias 1) to binary point: SlopeAdjustmentFactor 1, Bias 0', of: nt(SLOPE, { WordLength: dbl(16), FixedExponent: dbl(-3), SlopeAdjustmentFactor: dbl(1.5), Bias: dbl(1) }), edits: [['DataTypeMode', chr(BINARY)]], expect: ['set DataTypeMode str ' + BINARY, 'set SlopeAdjustmentFactor double[1 1]:1', 'set Bias double[1 1]:0'] },
  { name: 'slope and bias to unspecified: FixedExponent 0 too', of: nt(SLOPE, { WordLength: dbl(16), FixedExponent: dbl(-3), SlopeAdjustmentFactor: dbl(1.5), Bias: dbl(1) }), edits: [['DataTypeMode', chr(UNSPEC)]], expect: ['set DataTypeMode str ' + UNSPEC, 'set FixedExponent double[1 1]:0', 'set SlopeAdjustmentFactor double[1 1]:1', 'set Bias double[1 1]:0'] },
  { name: 'binary point (Auto signedness) to Double: the floating values', of: nt(BINARY, { WordLength: dbl(8), FixedExponent: dbl(-2), SignednessBool: lgc([], [0, 0]) }), edits: [['DataTypeMode', chr('Double')]], expect: ['set DataTypeMode str Double', 'set SignednessBool logical[1 1]:1', 'set WordLength double[1 1]:64', 'set FixedExponent double[1 1]:0'] },
  { name: 'to unspecified while IsAlias is true', of: nt(BINARY, { WordLength: dbl(16), IsAlias: lgc(1) }), edits: [['DataTypeMode', chr(UNSPEC)]], expect: refused('DataTypeMode', /an unscaled type cannot be an alias/) },
  { name: 'the mode it is in: no change', of: nt('Double'), edits: [['DataTypeMode', chr('Double')]], expect: [] },
  { name: "'double', which MATLAB re-spells", of: nt('Double'), edits: [['DataTypeMode', chr('double')]], expect: refused('DataTypeMode', /spelled so/) },
]);

rows('Simulink.NumericType: each setter in the mode the edits leave it', [
  { name: 'WordLength then DataTypeMode: the WordLength is refused in Double', of: nt('Double'), edits: [['WordLength', dbl(8)], ['DataTypeMode', chr(BINARY)]], expect: refused('WordLength', /does not change the WordLength of a Double type/) },
  { name: 'DataTypeMode then WordLength: written', of: nt('Double'), edits: [['DataTypeMode', chr(BINARY)], ['WordLength', dbl(8)]], expect: ['set DataTypeMode str ' + BINARY, 'set WordLength double[1 1]:8'] },
  { name: 'WordLength the value it holds, in Double: no change', of: nt('Double'), edits: [['WordLength', dbl(64)]], expect: [] },
  { name: 'WordLength 2.5', of: nt(BINARY, { WordLength: dbl(16) }), edits: [['WordLength', dbl(2.5)]], expect: refused('WordLength', /must be a whole number: MATLAB rounds 2\.5/) },
  { name: 'WordLength 0', of: nt(BINARY, { WordLength: dbl(16) }), edits: [['WordLength', dbl(0)]], expect: refused('WordLength', /must be in \[1, 65535\]/) },
  { name: 'WordLength int16(8)', of: nt(BINARY, { WordLength: dbl(16) }), edits: [['WordLength', num('int16', 8)]], expect: ['set WordLength double[1 1]:8'] },
  { name: 'FractionLength 4: FixedExponent -4', of: nt(BINARY, { WordLength: dbl(16) }), edits: [['FractionLength', dbl(4)]], expect: ['set FixedExponent double[1 1]:-4'] },
  { name: 'FractionLength 0 over FixedExponent 0: no change, never -0', of: nt(BINARY, { WordLength: dbl(16) }), edits: [['FractionLength', dbl(0)]], expect: [] },
  { name: 'FractionLength in unspecified scaling', of: nt(UNSPEC, { WordLength: dbl(16) }), edits: [['FractionLength', dbl(4)]], expect: refused('FractionLength', /does not change it/) },
  { name: 'Slope 0.25 in binary point: FixedExponent -2', of: nt(BINARY, { WordLength: dbl(16) }), edits: [['Slope', dbl(0.25)]], expect: ['set FixedExponent double[1 1]:-2'] },
  { name: 'Slope 3 in binary point', of: nt(BINARY, { WordLength: dbl(16) }), edits: [['Slope', dbl(3)]], expect: refused('Slope', /takes only a power of two/) },
  { name: 'Slope 0', of: nt(SLOPE, { WordLength: dbl(16) }), edits: [['Slope', dbl(0)]], expect: refused('Slope', /positive finite double/) },
  { name: 'Slope in Double', of: nt('Double'), edits: [['Slope', dbl(0.5)]], expect: refused('Slope', /in a scaled fixed-point mode/) },
  { name: 'Bias 1 in slope and bias', of: nt(SLOPE, { WordLength: dbl(16) }), edits: [['Bias', dbl(1)]], expect: ['set Bias double[1 1]:1'] },
  { name: 'Slope then Bias in binary point: the Bias is refused', of: nt(BINARY, { WordLength: dbl(16) }), edits: [['Slope', dbl(0.5)], ['Bias', dbl(1)]], expect: refused('Bias', /slope and bias scaling only/) },
  { name: 'Bias 0 in binary point: the value it holds', of: nt(BINARY, { WordLength: dbl(16) }), edits: [['Bias', dbl(0)]], expect: [] },
  { name: 'Bias Inf', of: nt(SLOPE, { WordLength: dbl(16) }), edits: [['Bias', dbl(Infinity)]], expect: refused('Bias', /finite double/) },
  { name: 'SlopeAdjustmentFactor 1.25', of: nt(SLOPE, { WordLength: dbl(16) }), edits: [['SlopeAdjustmentFactor', dbl(1.25)]], expect: ['set SlopeAdjustmentFactor double[1 1]:1.25'] },
  { name: 'SlopeAdjustmentFactor 2', of: nt(SLOPE, { WordLength: dbl(16) }), edits: [['SlopeAdjustmentFactor', dbl(2)]], expect: refused('SlopeAdjustmentFactor', /\[1, 2\)/) },
  { name: 'Signedness Unsigned in binary point', of: nt(BINARY, { WordLength: dbl(16) }), edits: [['Signedness', chr('Unsigned')]], expect: ['set SignednessBool logical[1 1]:0'] },
  { name: 'Signedness Auto: a 0x0 logical', of: nt(BINARY, { WordLength: dbl(16) }), edits: [['Signedness', chr('Auto')]], expect: ['set SignednessBool logical[0 0]:[]'] },
  { name: 'Signedness Signed in Double: the value it holds', of: nt('Double'), edits: [['Signedness', chr('Signed')]], expect: [] },
  { name: 'Signedness Unsigned in Double', of: nt('Double'), edits: [['Signedness', chr('Unsigned')]], expect: refused('Signedness', /does not change the Signedness of a Double type/) },
  { name: 'Signedness Signed in Boolean', of: nt('Boolean', { SignednessBool: lgc(0), WordLength: dbl(1) }), edits: [['Signedness', chr('Signed')]], expect: refused('Signedness', /Boolean type/) },
  { name: 'SignednessBool is no property of its own', of: nt('Double'), edits: [['SignednessBool', lgc(0)]], expect: refused('SignednessBool', /is not one this editor writes into a Simulink\.NumericType/) },
  { name: 'IsAlias true', of: nt('Double'), edits: [['IsAlias', lgc(1)]], expect: ['set IsAlias logical[1 1]:1'] },
  { name: 'IsAlias true in unspecified scaling', of: nt(UNSPEC, { WordLength: dbl(16) }), edits: [['IsAlias', lgc(1)]], expect: refused('IsAlias', /cannot be an alias/) },
  { name: 'IsAlias 2', of: nt('Double'), edits: [['IsAlias', dbl(2)]], expect: refused('IsAlias', /MATLAB makes 2 true/) },
  { name: 'DataTypeOverride Off', of: nt('Double'), edits: [['DataTypeOverride', chr('Off')]], expect: ['set DataTypeOverride str Off'] },
  { name: "DataTypeOverride 'off'", of: nt('Double'), edits: [['DataTypeOverride', chr('off')]], expect: refused('DataTypeOverride', /'Inherit', 'Off'/) },
  { name: 'DataScope Exported', of: nt('Double'), edits: [['DataScope', chr('Exported')]], expect: ['set DataScope str Exported'] },
  { name: 'Description of white space alone', of: nt('Double'), edits: [['Description', chr(' ')]], expect: refused('Description', /white space alone/) },
  { name: 'HeaderFile trimmed', of: nt('Double'), edits: [['HeaderFile', chr('h.h ')]], expect: refused('HeaderFile', /it trims the white space at either end/) },
  { name: 'a WordLength held as an index, not a number', of: nt('Double', { WordLength: { str: '64' } }), edits: [['Description', chr('x')]], expect: refused('Description', /WordLength is not held as a number/) },
]);

describe('Simulink.NumericType: a Slope in slope and bias scaling, exactly', () => {
  // To the ends of the doubles: 2^1023, realmax, the smallest normal and the smallest subnormal.
  for (const slope of [0.1, 1 / 3, 0.3, 1e-10, 2 ** 60, 3, 2 ** 1023, Number.MAX_VALUE, 1e308, 2 ** -1022, Number.MIN_VALUE, 3e-320]) {
    it(`Slope ${slope} = SlopeAdjustmentFactor · 2^FixedExponent, the factor in [1, 2)`, () => {
      const r = planPropertyEdits([{ key: 'nt', object: nt(SLOPE, { WordLength: dbl(16) }), edits: [{ property: 'Slope', value: dbl(slope) }] }]);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const set = new Map(r.objects[0].ops.map((op) => [op.savedName, op.op === 'set' && op.kind === 'cell' ? (op.value.value as number) : NaN]));
      const fe = set.get('FixedExponent') ?? 0;
      const saf = set.get('SlopeAdjustmentFactor') ?? 1;
      expect(saf).toBeGreaterThanOrEqual(1);
      expect(saf).toBeLessThan(2);
      expect(Number.isInteger(fe)).toBe(true);
      expect(saf * 2 ** fe).toBe(slope);
    });
  }

  it('0.1: FixedExponent -4, SlopeAdjustmentFactor 1.6', () => {
    const r = planPropertyEdits([{ key: 'nt', object: nt(SLOPE, { WordLength: dbl(16) }), edits: [{ property: 'Slope', value: dbl(0.1) }] }]);
    expect(r.ok && r.objects[0].ops.map(said)).toEqual(['set FixedExponent double[1 1]:-4', 'set SlopeAdjustmentFactor double[1 1]:' + JSON.stringify(0.1 * 16)]);
  });
});

// ---- Simulink.AliasType, Simulink.CoderInfo ---------------------------------------------------------------

rows('Simulink.AliasType: always saved', [
  { name: 'BaseType int16', of: alias(), edits: [['BaseType', chr('int16')]], expect: ['set BaseType char[1 5]:"int16"'] },
  { name: 'BaseType fixdt', of: alias(), edits: [['BaseType', chr("fixdt('sfix16_En4')")]], expect: ['set BaseType char[1 19]:"fixdt(\'sfix16_En4\')"'] },
  { name: "BaseType 'auto'", of: alias(), edits: [['BaseType', chr('auto')]], expect: refused('BaseType', /cannot be 'auto'/) },
  { name: 'BaseType a bus', of: alias(), edits: [['BaseType', chr('Bus: B')]], expect: refused('BaseType', /not a data type this editor writes here/) },
  { name: 'BaseType a value type', of: alias(), edits: [['BaseType', chr('ValueType: VT')]], expect: refused('BaseType', /not a data type/) },
  { name: "BaseType ''", of: alias(), edits: [['BaseType', chr('')]], expect: refused('BaseType', /not a data type/) },
  { name: "BaseType 'not a type'", of: alias(), edits: [['BaseType', chr('not a type')]], expect: refused('BaseType', /not a data type/) },
  { name: 'BaseType with white space at the ends', of: alias(), edits: [['BaseType', chr(' int16 ')]], expect: refused('BaseType', /which MATLAB would load as 'int16': it trims the white space at either end/) },
  { name: 'DataScope Imported', of: alias(), edits: [['DataScope', chr('Imported')]], expect: ['set DataScope str Imported'] },
  { name: 'Description', of: alias(), edits: [['Description', chr('an alias')]], expect: ['set Description char[1 8]:"an alias"'] },
  { name: 'HeaderFile trimmed', of: alias(), edits: [['HeaderFile', chr(' a.h')]], expect: refused('HeaderFile', /it trims the white space at either end/) },
]);

rows('Simulink.CoderInfo: a built-in storage class, one index', [
  { name: 'ExportedGlobal', of: coder(), edits: [['StorageClass', chr('ExportedGlobal')]], expect: ['set StorageClass str ExportedGlobal'] },
  { name: "'Model default' is saved as 'SimulinkGlobal'", of: coder(), edits: [['StorageClass', chr('Model default')]], expect: ['set StorageClass str SimulinkGlobal'] },
  { name: 'SimulinkGlobal itself', of: coder(), edits: [['StorageClass', chr('SimulinkGlobal')]], expect: ['set StorageClass str SimulinkGlobal'] },
  { name: 'back to Auto', of: coder({ StorageClass: { str: 'ImportedExtern' } }), edits: [['StorageClass', chr('Auto')]], expect: ['set StorageClass str Auto'] },
  { name: "'Custom'", of: coder(), edits: [['StorageClass', chr('Custom')]], expect: refused('StorageClass', /must be one of 'Auto', 'Model default', 'SimulinkGlobal', 'ExportedGlobal', 'ImportedExtern', 'ImportedExternPointer'/) },
  { name: 'a custom storage class', of: coder(), edits: [['StorageClass', chr('Const')]], expect: refused('StorageClass', /must be one of/) },
  { name: 'while it has a custom storage class', of: coder({ StorageClass: { str: 'Custom' } }), edits: [['StorageClass', chr('ExportedGlobal')]], expect: refused('StorageClass', /cannot change while the object has a custom storage class/) },
  { name: 'while its CustomStorageClass is not Default', of: coder({ CustomStorageClass: chr('Const') }), edits: [['StorageClass', chr('ExportedGlobal')]], expect: refused('StorageClass', /custom storage class/) },
  { name: 'its CustomStorageClass Default is no custom one', of: coder({ CustomStorageClass: chr('Default') }), edits: [['StorageClass', chr('ImportedExtern')]], expect: ['set StorageClass str ImportedExtern'] },
  { name: 'Identifier under Auto', of: coder({ Alias: chr('') }), edits: [['Identifier', chr('x')]], expect: refused('Identifier', /under StorageClass 'Auto'/) },
  { name: 'Identifier and Alignment under ExportedGlobal, in one save', of: coder({ Alias: chr(''), Alignment: { int: 0 } }), edits: [['StorageClass', chr('ExportedGlobal')], ['Identifier', chr('myid')], ['Alignment', dbl(8)]], expect: ['set StorageClass str ExportedGlobal', 'set Alias char[1 4]:"myid"', 'set Alignment int 8'] },
  { name: 'an Identifier that is no identifier', of: coder({ Alias: chr(''), StorageClass: { str: 'ExportedGlobal' } }), edits: [['Identifier', chr('bad name')]], expect: refused('Identifier', /must be an identifier/) },
  { name: 'an Alignment of 3', of: coder({ Alignment: { int: 0 }, StorageClass: { str: 'ExportedGlobal' } }), edits: [['Alignment', dbl(3)]], expect: refused('Alignment', /power of two up to 128/) },
  { name: 'back to Auto while an Identifier is set', of: coder({ Alias: chr('myid'), StorageClass: { str: 'ExportedGlobal' } }), edits: [['StorageClass', chr('Auto')]], expect: refused('StorageClass', /under StorageClass 'Auto'/) },
  // Under a custom storage class, nothing: no edit under one was measured.
  { name: 'an Identifier under a custom storage class', of: coder({ Alias: chr(''), StorageClass: { str: 'Custom' } }), edits: [['Identifier', chr('abc')]], expect: refused('Identifier', /cannot change while the object has a custom storage class/) },
  { name: 'an Alignment under a custom storage class', of: coder({ Alignment: { int: 0 }, StorageClass: { str: 'Custom' } }), edits: [['Alignment', dbl(8)]], expect: refused('Alignment', /cannot change while the object has a custom storage class/) },
  { name: 'an Identifier while its CustomStorageClass is not Default', of: coder({ Alias: chr(''), StorageClass: { str: 'ExportedGlobal' }, CustomStorageClass: chr('Const') }), edits: [['Identifier', chr('abc')]], expect: refused('Identifier', /custom storage class/) },
]);

// ---- What no edit takes --------------------------------------------------------------------------------

describe('what the rules take no edit of, in words', () => {
  it('a class with no rules: a subclass, whose setters are its own', () => {
    expect(opsOf(object('mpt.Parameter', { Value: dbl(1) }), [['Value', dbl(2)]])).toEqual(refused('Value', /^p is a mpt\.Parameter, whose properties this editor does not write into a MAT-file$/));
  });

  it('the refusal names the object and property it is about', () => {
    const r = planPropertyEdits([
      { key: 'ok', object: sig(), edits: [{ property: 'Unit', value: chr('V') }] },
      { key: 's.p', object: pset(), edits: [{ property: 'Min', value: dbl(Infinity) }] },
    ]);
    expect(r).toMatchObject({ ok: false, key: 's.p', property: 'Min' });
  });

  it('no edits is no ops', () => {
    expect(planPropertyEdits([{ key: 'p', object: pset(), edits: [] }])).toEqual({ ok: true, objects: [{ key: 'p', ops: [] }] });
    expect(planPropertyEdits([])).toEqual({ ok: true, objects: [] });
  });

  it('hasPropertyRules and propertyRowOf answer what the table holds', () => {
    for (const cls of [P, S, BUS, BE, VT, 'Simulink.LookupTable', 'Simulink.Breakpoint', 'Simulink.lookuptable.Table', 'Simulink.lookuptable.Breakpoint', 'Simulink.lookuptable.StructTypeInfo', NT, AT, CI]) {
      expect(hasPropertyRules(cls), cls).toBe(true);
    }
    expect(hasPropertyRules('mpt.Parameter')).toBe(false);
    expect(hasPropertyRules('toString')).toBe(false);
    expect(propertyRowOf(P, 'Unit')).toEqual({ savedName: 'DocUnits', kind: 'cell' });
    expect(propertyRowOf(BE, 'Min')).toEqual({ savedName: 'Min_internal', kind: 'cell' });
    expect(propertyRowOf(S, 'Complexity')).toEqual({ savedName: 'Complexity', kind: 'str' });
    expect(propertyRowOf(BUS, 'PreserveElementDimensions')).toEqual({ savedName: 'PreserveElementDimensions', kind: 'int' });
    expect(propertyRowOf(NT, 'FractionLength')).toEqual({ savedName: 'FixedExponent', kind: 'cell' });
    expect(propertyRowOf(P, 'Dimensions')).toBeNull();
    expect(propertyRowOf(P, 'constructor')).toBeNull();
  });
});

describe('the values the rules compare', () => {
  it("identicalValues is class- and size-strict, NaN equal to NaN", () => {
    expect(identicalValues(empty(), dbl([], [1, 0]))).toBe(false);
    expect(identicalValues(dbl(NaN), dbl(NaN))).toBe(true);
    expect(identicalValues(dbl(1), num('single', 1))).toBe(false);
    expect(identicalValues(chr(''), v('char', '', [1, 0]))).toBe(false);
    expect(identicalValues(chr('a'), chr('a'))).toBe(true);
    expect(identicalValues(lgc(1), v('logical', 1, [1, 1], { isLogical: true }))).toBe(true);
    expect(identicalValues(strct({ a: dbl(1) }), strct({ a: dbl(1) }))).toBe(true);
    expect(identicalValues(strct({ a: dbl(1) }), strct({ b: dbl(1) }))).toBe(false);
    expect(identicalValues(cplx([{ re: 1, im: 2 }]), cplx([{ re: 1, im: 2 }]))).toBe(true);
    expect(identicalValues(cplx([{ re: 1, im: 0 }]), dbl(1))).toBe(false);
  });

  it("parameterDataTypeAfter: MATLAB's `p.Value = v` re-derives the DataType", () => {
    expect(parameterDataTypeAfter('double', 'int16', 'auto')).toBe('int16');
    expect(parameterDataTypeAfter('double', 'logical', 'auto')).toBe('boolean');
    expect(parameterDataTypeAfter('double', 'char', 'auto')).toBe('string');
    expect(parameterDataTypeAfter('int16', 'double', 'int16')).toBe('auto');
    expect(parameterDataTypeAfter('double', 'double', 'uint8')).toBe('uint8');
    expect(parameterDataTypeAfter('struct', 'struct', 'Bus: B')).toBe('Bus: B');
    expect(parameterDataTypeAfter('double', 'struct', 'auto')).toBe('struct');
  });
});
