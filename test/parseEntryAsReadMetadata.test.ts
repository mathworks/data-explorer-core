// Copyright 2026 The MathWorks, Inc.
//
// An entry re-read from a text dictionary's own text (parseEntry with asRead, as a host that shows
// the dictionary as its JSON re-reads an entry edited there) holds the metadata the whole file's
// read holds for it: a read stamps nothing.
//
// parseEntry stamps what a text dictionary's writer needs and a record handed in may lack, for a
// paste or a new entry: a section's namespace and isderived, a lastmod of now and an empty
// modifiedby. It stamped a re-read too, so an entry of a file written without a lastmod showed Last
// Modified as now once re-read after a keystroke, and as nothing once the file was read again.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const text = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
const entriesOf = (json: any): any[] => json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;

describe('an entry re-read from a text dictionary\'s own text', () => {
  for (const file of ['object_props_text.sldd', 'object_array_text.sldd', 'numeric_json.sldd']) {
    it(`${file}: holds the metadata and shows the Last Modified the whole file's read does`, () => {
      const source = text(file);
      const records = entriesOf(JSON.parse(source));
      expect(records.length).toBeGreaterThan(0);
      for (const record of records) {
        const read: any = ingest(createSession(), source, { filename: file });
        const whole = read.flatten().find((n: any) => n.isEntry && n.name === record.name);
        const section = whole.parent;
        section.removeChild(whole);
        const again = section.parseEntry(JSON.parse(JSON.stringify(record)), read.systemComposer, { asRead: true });
        expect(again.metadata, record.name).toEqual(whole.metadata);
        expect([again.lastModified, again.lastModifiedBy], record.name).toEqual([whole.lastModified, whole.lastModifiedBy]);
      }
    });
  }

  it('a paste is still stamped as a text dictionary needs it', () => {
    const read: any = ingest(createSession(), text('object_props_text.sldd'), { filename: 'p.sldd' });
    const record = { ...entriesOf(JSON.parse(text('object_props_text.sldd')))[0], name: 'pasted', metadata: { uuid: 'u' } };
    const pasted = read.getSection('design').parseEntry(record);
    expect(Object.keys(pasted.metadata)).toEqual(['uuid', 'namespace', 'lastmod', 'modifiedby', 'isderived']);
    expect(pasted.metadata.lastmod).toMatch(/^\d{8}T\d{6}\.\d{6}$/);
  });
});
