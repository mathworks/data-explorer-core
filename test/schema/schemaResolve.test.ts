// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { getLayout, getSchema } from '../../src/datamodel/schema/index.js';

describe('getSchema — resolve class reference lists', () => {
  it('resolves a bare ref to its registry descriptor', () => {
    const props = getSchema('Simulink.Parameter')!;
    const value = props.find(p => p.key === 'value')!;
    expect(value).toMatchObject({ key: 'value', label: 'Value', sourcePath: 'Value', editor: 'text' });
  });

  it('preserves reference order', () => {
    const props = getSchema('Simulink.Parameter')!;
    expect(props.map(p => p.key).slice(0, 3)).toEqual(['value', 'dataType', 'description']);
  });

  it('resolves a nested code-gen prop with its seeded default', () => {
    const props = getSchema('Simulink.Parameter')!;
    const alignment = props.find(p => p.key === 'alignment')!;
    expect(alignment).toMatchObject({ sourcePath: 'CoderInfo.Alignment', default: -1 });
  });

  it('applies a $ref override without mutating the shared registry', () => {
    const sig = getSchema('Simulink.Signal')!.find(p => p.key === 'dataType')!;
    expect(sig.default).toBe('auto');
    const param = getSchema('Simulink.Parameter')!.find(p => p.key === 'dataType')!;
    expect(param.default).toBe(''); // registry default unchanged
  });

  it('returns undefined for an unregistered class', () => {
    expect(getSchema('Simulink.NotAThing')).toBeUndefined();
  });
});

// The class name is the file's word, and the class-definition and alias tables are
// object literals: `CLASS_DEFS['toString']` is a function, so getSchema read `.props` off
// it and threw "Cannot read properties of undefined (reading 'map')". Every property
// edit asks for the schema first (DataNode.setProperty → trySetSchemaProperty), so an
// object of such a class — a valid MATLAB class name — could not be edited at all.
describe('getSchema / getLayout — a class named after an Object.prototype member', () => {
  const INHERITED = [
    'toString', 'valueOf', 'constructor', 'hasOwnProperty', 'isPrototypeOf',
    'propertyIsEnumerable', 'toLocaleString', '__proto__', '__defineGetter__',
  ];

  it.each(INHERITED)('has no schema and no layout for a class called %s', (name) => {
    expect(getSchema(name)).toBeUndefined();
    expect(getLayout(name)).toBeUndefined();
  });

  it('still resolves an alias the table does list', () => {
    expect(getSchema('mpt.Parameter')).toEqual(getSchema('Simulink.Parameter'));
  });
});
