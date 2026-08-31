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
});
