// test/dto.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession, ingest, toDTO, type SourceDTO } from '../src/index.js';

function text(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
}

// A .prj content store the parser reads whole, so a project built from it reports
// no warnings and the assertions below are about the source fields alone. Same
// three-pointer shape as test/dataModelSources.test.ts; test/projectParser.test.ts
// documents the store format.
const PRJ_STORE = {
  'resources/project/root/FILESHASHp.xml': '<Info location="Root" type="Files"/>',
  'resources/project/FILESHASH/AAAp.xml': '<Info location="helper.m" type="File"/>',
  'resources/project/FILESHASH/AAAd.xml': '<Info/>',
};

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

  it('a read-only source keeps path, sourceFormat and dirty in its DTO', () => {
    // A project has no write path and so tracks no dirty flag, and gating the
    // source-level fields on that flag dropped ALL of them for a .prj: the DTO
    // arrived with no path (a blank file label out of process), no format, and
    // without the `dirty` key SourceDTO declares as required. `false` is the true
    // reading of that flag here rather than a stand-in for unknown — a source that
    // cannot be written cannot be unsaved.
    const s = createSession();
    const prj = s.addProjectSource('scheme://87f2a1', PRJ_STORE, { path: '/w/MyProj.prj' });
    const dto = toDTO(prj) as SourceDTO;
    expect(dto.path).toBe('/w/MyProj.prj');
    expect(dto.sourceFormat).toBe('prj');
    expect(dto.dirty).toBe(false);
  });

  it('a node below a source root does not project as a SourceDTO', () => {
    // The other half of the gate above: `meta` is stamped on the root the session
    // registered and on nothing else, so a section must not pick up source fields.
    // A consumer reading `dirty` off every row would take the whole tree for a
    // treeful of saveable documents.
    const s = createSession();
    const src = ingest(s, text('object_array_text.sldd'), {
      filename: 'src.sldd',
      meta: { path: '/work/src.sldd' },
    });
    const section = toDTO(src.children[0]);
    expect(section).not.toHaveProperty('dirty');
    expect(section).not.toHaveProperty('path');
    expect(section).not.toHaveProperty('sourceFormat');
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

  it('source DTO carries a model parse warning, part and all, across the JSON boundary', () => {
    // The same boundary as the test above, for the model reader — and with the round
    // trip actually performed, because `part` is what tells an out-of-process host WHICH
    // piece of the file is missing, and a field that survives toDTO but not
    // JSON.stringify is no use to the consumer this DTO exists for. A modern `.mdl` is
    // an OPC text package; this one stops inside the header line naming its first part,
    // so nothing but the compatibility stub is readable.
    const truncatedPackage = new TextEncoder().encode(
      '__MWOPC_PACKAGE_BEGIN__\nModel {\n  Version 9.0\n}\n__MWOPC_PART_BEGIN__ /simulink/blockDiagr',
    );
    const s = createSession();
    const model = s.addModelSource(
      'cut.mdl',
      truncatedPackage.buffer.slice(0, truncatedPackage.byteLength) as ArrayBuffer,
    );
    const dto = JSON.parse(JSON.stringify(toDTO(model))) as SourceDTO;
    expect(dto.warnings?.map((w) => w.code)).toEqual(['source-unreadable']);
    expect(dto.warnings?.[0].message).toContain('cut.mdl');
  });

  it('source DTO carries a dictionary parse warning across the JSON boundary', () => {
    // And for the dictionary reader, whose warnings travel further than the others': the
    // `.sldd` diagnostics are collected in a sink threaded from the parser through the
    // node layer, so this asserts that what a host receives out-of-process is the same
    // plain data every other reader sends. A file that is valid JSON and not a dictionary
    // opens as a tree with four empty sections, and this DTO is all an out-of-process host
    // has to tell that from a dictionary the user just created.
    const s = createSession();
    const notes = ingest(s, '{"notes":"this is not a data dictionary"}', { filename: 'notes.sldd' });
    const dto = JSON.parse(JSON.stringify(toDTO(notes))) as SourceDTO;
    expect(dto.warnings?.map((w) => w.code)).toEqual(['source-empty']);
    expect(dto.warnings?.[0].message).toContain('notes.sldd');

    const clean = ingest(s, text('typed_text.sldd'), { filename: 'typed.sldd' });
    expect((toDTO(clean) as SourceDTO).warnings).toBeUndefined();
  });
});
