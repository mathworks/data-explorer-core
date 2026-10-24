// Copyright 2026 The MathWorks, Inc.
//
// A number no JavaScript literal spells as MATLAB does, an infinity or NaN, shown as MATLAB spells it
// wherever a property's value is formatted: a schema row (schemaBridge.formatSchemaValue, a Signal's
// SampleTime, a NumericType's Bias), a bound (PropMin, PropMax), alone and in a row. String() spelled
// them "Infinity" and "-Infinity", which no editor here takes back and MATLAB never shows.
import { describe, it, expect } from 'vitest';
import { formatSchemaValue } from '../src/datamodel/node/schemaBridge.js';
import PropMin from '../src/datamodel/prop/PropMin.js';
import PropMax from '../src/datamodel/prop/PropMax.js';

describe('a non-finite number, shown as MATLAB spells it', () => {
  it('in a schema row, alone and in a row', () => {
    expect([Infinity, -Infinity, NaN, 0.5].map(formatSchemaValue)).toEqual(['Inf', '-Inf', 'NaN', '0.5']);
    expect(formatSchemaValue([0.2, Infinity, -Infinity, NaN])).toBe('[0.2 Inf -Inf NaN]');
    expect([formatSchemaValue('Inf'), formatSchemaValue(undefined), formatSchemaValue(true)]).toEqual(['Inf', '', 'true']);
  });

  it('as a bound', () => {
    expect([PropMin.format(-Infinity), PropMax.format(Infinity), PropMin.format(NaN), PropMax.format(3), PropMin.format(undefined)]).toEqual(['-Inf', 'Inf', 'NaN', '3', '']);
  });
});
