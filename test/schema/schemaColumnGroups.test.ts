// Copyright 2026 The MathWorks, Inc.
//
// Schema class enumeration. The picker column grouping (rowBuilder.COLUMN_GROUPS)
// is a presentation concern owned by the extension and is tested there.
import { describe, it, expect } from 'vitest';
import { getSchemaClasses } from '../../src/datamodel/schema/index.js';

describe('getSchemaClasses', () => {
  it('enumerates the classes that have a schema', () => {
    const classes = getSchemaClasses();
    expect(classes).toContain('Simulink.Parameter');
    expect(classes).toContain('Simulink.Signal');
  });
});
