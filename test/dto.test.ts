// test/dto.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession, ingest, toDTO, type SourceDTO } from '../src/index.js';

function text(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
}

describe('toDTO() — serializable snapshot', () => {
  it('shallow DTO has flat childIds, not nested objects', () => {
    const s = createSession();
    const src = ingest(s, text('object_array_text.sldd'), { filename: 'src.sldd' });
    const dto = toDTO(src);
    expect(typeof dto.id).toBe('string');
    expect(typeof dto.name).toBe('string');
    expect(Array.isArray(dto.childIds)).toBe(true);
    dto.childIds.forEach((c) => expect(typeof c).toBe('string'));
    expect(dto).not.toHaveProperty('children'); // shallow by default
    expect(Array.isArray(dto.props)).toBe(true);
  });

  it('is JSON-serializable (no cycles, no methods)', () => {
    const s = createSession();
    const src = ingest(s, text('object_array_text.sldd'), { filename: 'src.sldd' });
    expect(() => JSON.stringify(toDTO(src, { depth: 2 }))).not.toThrow();
  });

  it('depth option produces nested children', () => {
    const s = createSession();
    const src = ingest(s, text('object_array_text.sldd'), { filename: 'src.sldd' });
    const dto = toDTO(src, { depth: 1 });
    expect(Array.isArray(dto.children)).toBe(true);
    expect(src.children.length).toBeGreaterThan(0);
    expect(dto.children!.length).toBe(src.children.length);
    expect(dto.children![0]).not.toHaveProperty('children'); // depth 1 stops here
  });

  it('source node DTO carries dirty (and path when available)', () => {
    const s = createSession();
    const src = ingest(s, text('object_array_text.sldd'), { filename: 'src.sldd' });
    const dto = toDTO(src) as SourceDTO;
    expect(typeof dto.dirty).toBe('boolean');
  });

  it('props map key/displayName/value(displayValue)/editable', () => {
    const s = createSession();
    const src = ingest(s, text('object_array_text.sldd'), { filename: 'src.sldd' });
    const leaf = src.flatten().find((n) => n.getProperties().length > 0) ?? src;
    const dto = toDTO(leaf);
    for (const p of dto.props) {
      expect(typeof p.key).toBe('string');
      expect(typeof p.value).toBe('string');       // displayValue (string form)
      expect(typeof p.editable).toBe('boolean');
    }
  });

  it('propsOf returns [] for a node missing getProperties', () => {
    // A node shaped by the host (e.g. a bare container stub) may lack
    // getProperties entirely; the DTO layer must not throw on it or the
    // whole tree serialization fails.
    const stub = {
      id: 'stub', name: 'stub', displayName: 'Stub', kind: 'other',
      className: 'Stub', icon: 'stub.svg', isContainer: false, isEntry: false,
      children: [],
    };
    const dto = toDTO(stub as any);
    expect(dto.props).toEqual([]);
  });

  it('source DTO carries path and sourceFormat from the live node', () => {
    // The VS Code host reads SourceDTO.path and .sourceFormat to show the
    // file label and format badge; if either regresses to undefined the
    // UI falls back to blank.
    const s = createSession();
    const src = ingest(s, text('object_array_text.sldd'), {
      filename: 'src.sldd',
      meta: { path: '/work/src.sldd' },
    });
    const dto = toDTO(src) as SourceDTO;
    expect(dto.path).toBe('/work/src.sldd');
    expect(dto.sourceFormat).toBe('json');
  });

  it('source DTO carries parse warnings, and omits them for a clean read', () => {
    // The --json / RPC boundary is the one consumer that CANNOT inspect the live
    // node, so a warning absent from the DTO is a warning that does not exist as
    // far as an out-of-process host is concerned.
    const s = createSession();
    const junk = s.addProjectSource('/w/Junk.prj', { 'nothing/relevant.txt': 'not xml' });
    const dto = toDTO(junk) as SourceDTO;
    expect(dto.warnings?.map((w) => w.code)).toEqual(['source-empty']);
    expect(() => JSON.stringify(dto)).not.toThrow();

    const clean = ingest(s, text('object_array_text.sldd'), { filename: 'src.sldd' });
    expect((toDTO(clean) as SourceDTO).warnings).toBeUndefined();
  });
});
