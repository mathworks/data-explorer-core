// test/sourceFormat.test.ts
//
// What every source root says it IS, and what a source without a write path says
// about being unsaved. docs/TODO.md items 18 and 20.
//
// `SourceDTO.sourceFormat` is the only field in the projection that names the format,
// and before item 18 only a `.sldd` and a `.prj` supplied it: `toDTO`'s
// `if (asSource.sourceFormat)` was simply never true for a `.slx`, `.mdl` or `.mat`, so
// an out-of-process host reading it took its `undefined` branch for three of the five
// formats. These tests are the table that was missing — one assertion per format, which
// is the whole cost item 18 estimated.
//
// Two things make that table worth pinning rather than obvious:
//
//   1. A `.mdl` is TWO formats. The classic flavour is one flat text file; the modern one
//      is an OPC package of parts, the same shape a `.slx` is. Both arrive through
//      parseMdl and only one of them yields parts, so the value cannot come from the
//      extension. Real fixtures of each are asserted rather than synthesized ones,
//      because the point is what MATLAB actually writes.
//   2. The values must not COLLIDE. `sourceFormat` is not decoration —
//      `serializeSource` switches on `'xml'` to pick a writer, and ProjectNode's comment
//      records why a project is not called 'xml' even though it is a zip of XML: the
//      token already means a compressed-binary dictionary. A model answering 'xml' would
//      be a lookalike for one.
//
// Item 20 has no runtime behaviour to test — it made `ISourceNode.dirty` optional so the
// interface stops asserting something false about ProjectNode, and removing the six
// `as unknown as ISourceNode` casts that hid it is checked by `tsc`, not here (tsconfig
// excludes `test/`, so a compile-time assertion in this file would never be checked).
// What IS testable is the contract those types describe, so that a later "fix" giving
// ProjectNode a `dirty: false` field to satisfy the old required type would fail here:
// the absence is load-bearing, because `editableOwnerOf` reads a missing `dirty` as "not
// an editable document" and that is what keeps a read-only project out of the edit path.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession, ingest, toDTO, type SourceDTO } from '../src/index.js';

function bytes(relative: string): ArrayBuffer {
  const u8 = new Uint8Array(readFileSync(fileURLToPath(new URL(relative, import.meta.url))));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

function text(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
}

// Same three-pointer store as test/dto.test.ts; test/projectParser.test.ts documents it.
const PRJ_STORE = {
  'resources/project/root/FILESHASHp.xml': '<Info location="Root" type="Files"/>',
  'resources/project/FILESHASH/AAAp.xml': '<Info location="helper.m" type="File"/>',
  'resources/project/FILESHASH/AAAd.xml': '<Info/>',
};

const SLX = './fixtures/model_with_refs.slx';
const MDL_PACKAGE = './parity/artifacts/mdl/mdlcases.mdl';
const MDL_CLASSIC = './parity/artifacts/mdl/mdlcases_R2011b.mdl';
const MDL_CLASSIC_2017B = './parity/artifacts/mdl/mdlcases_R2017b.mdl';
const MAT = './fixtures/strings.mat';

describe('sourceFormat — every source root names its own format', () => {
  it('a .slx says slx', () => {
    const s = createSession();
    const src = s.addModelSource('m.slx', bytes(SLX));
    expect((toDTO(src) as SourceDTO).sourceFormat).toBe('slx');
  });

  it('a classic flat-text .mdl says mdl', () => {
    // R2011b, which predates the OPC package entirely: one flat `Model { ... }` text
    // file, no parts, and the flavour ModelNode.serialize() falls back to summarizing.
    const s = createSession();
    const src = s.addModelSource('m.mdl', bytes(MDL_CLASSIC));
    expect((toDTO(src) as SourceDTO).sourceFormat).toBe('mdl');
  });

  it('a modern OPC-package .mdl says mdl-package, not mdl and not slx', () => {
    // The case the extension alone gets wrong in one direction and the content alone
    // gets wrong in the other: these bytes are a package of parts like a `.slx`, read by
    // the same parseModelParts, but the file is a `.mdl` and a host offering to open it
    // in Simulink needs that. Asserting it is neither neighbour is the point.
    const s = createSession();
    const src = s.addModelSource('m.mdl', bytes(MDL_PACKAGE));
    const format = (toDTO(src) as SourceDTO).sourceFormat;
    expect(format).toBe('mdl-package');
    expect(format).not.toBe('mdl');
    expect(format).not.toBe('slx');
  });

  it('a .mat says mat', () => {
    const s = createSession();
    const src = s.addMatSource('v.mat', bytes(MAT));
    expect((toDTO(src) as SourceDTO).sourceFormat).toBe('mat');
  });

  it('a .sldd still says json or xml, and a .prj still says prj', () => {
    // The two formats that already supplied the field, asserted here so the table is
    // complete in one place: item 18 must not have moved them while filling the gaps.
    const s = createSession();
    const sldd = ingest(s, text('object_array_text.sldd'), { filename: 'src.sldd' });
    expect((toDTO(sldd) as SourceDTO).sourceFormat).toBe('json');

    const prj = s.addProjectSource('scheme://87f2a1', PRJ_STORE, { path: '/w/MyProj.prj' });
    expect((toDTO(prj) as SourceDTO).sourceFormat).toBe('prj');
  });

  it('the five formats answer five distinct tokens, and no model borrows a dictionary token', () => {
    // `serializeSource` picks a writer by this field, so a collision is not cosmetic: a
    // model or project answering 'xml' would be handed to serializeBinarySldd's branch
    // if the `instanceof SlddNode` guard in front of it were ever relaxed. This is the
    // assertion that would fail if someone named a package flavour after its parts.
    const s = createSession();
    const formats = [
      (toDTO(s.addModelSource('a.slx', bytes(SLX))) as SourceDTO).sourceFormat,
      (toDTO(s.addModelSource('b.mdl', bytes(MDL_CLASSIC))) as SourceDTO).sourceFormat,
      (toDTO(s.addModelSource('c.mdl', bytes(MDL_PACKAGE))) as SourceDTO).sourceFormat,
      (toDTO(s.addMatSource('d.mat', bytes(MAT))) as SourceDTO).sourceFormat,
      (toDTO(s.addProjectSource('e.prj', PRJ_STORE)) as SourceDTO).sourceFormat,
    ];
    expect(new Set(formats).size).toBe(formats.length);
    expect(formats).not.toContain('xml');
    expect(formats).not.toContain('json');
    expect(formats.every((f) => typeof f === 'string' && f.length > 0)).toBe(true);
  });

  it('survives the JSON boundary, which a getter is the risky way to supply', () => {
    // ModelNode and MatNode answer with getters rather than fields (ProjectNode's
    // reasoning: this cannot change once the file is read, and a field could drift from
    // the parse). A getter is NOT an enumerable own property, so `JSON.stringify(node)`
    // drops it — this passes only because `toDTO` reads the field explicitly, and that
    // is exactly the step worth pinning for the consumer this DTO exists for.
    const s = createSession();
    const src = s.addModelSource('m.slx', bytes(SLX));
    const roundTripped = JSON.parse(JSON.stringify(toDTO(src))) as SourceDTO;
    expect(roundTripped.sourceFormat).toBe('slx');
    // The node itself cannot be stringified at all (parent/children cycle), which is
    // why toDTO exists; the own-property check is the direct form of the same point.
    expect(Object.prototype.hasOwnProperty.call(src, 'sourceFormat')).toBe(false);
    expect(Object.keys(src)).not.toContain('sourceFormat');
  });

  it('both classic-era .mdl fixtures agree, so the value tracks the shape not the release', () => {
    // R2011b and R2017b are six years apart and differ in what they record (R2011b
    // cannot use a data dictionary at all), but both are one flat text file, and this
    // field names the SHAPE. If a release-specific branch ever creeps in, these diverge.
    const s = createSession();
    const older = (toDTO(s.addModelSource('old.mdl', bytes(MDL_CLASSIC))) as SourceDTO).sourceFormat;
    const newer = (toDTO(s.addModelSource('new.mdl', bytes(MDL_CLASSIC_2017B))) as SourceDTO).sourceFormat;
    expect(older).toBe('mdl');
    expect(newer).toBe(older);
  });

  it('reports the flavour it READ for a package truncated before its first part', () => {
    // The documented wrinkle rather than a hidden one. A package cut before any part
    // survives falls through to the classic grammar reader, which finds the
    // compatibility stub a modern `.mdl` opens with — so the format reads 'mdl' while
    // the file on disk was a package. Nothing on the node distinguishes the two (both
    // part fields are null on that path); the `source-unreadable` warning is what tells
    // a host the file was more than the stub, and this asserts BOTH halves so the
    // understatement stays paired with the thing that explains it.
    const cut = new TextEncoder().encode(
      '__MWOPC_PACKAGE_BEGIN__\nModel {\n  Version 9.0\n}\n__MWOPC_PART_BEGIN__ /simulink/blockDiagr',
    );
    const s = createSession();
    const src = s.addModelSource('cut.mdl', cut.buffer.slice(0, cut.byteLength) as ArrayBuffer);
    const dto = toDTO(src) as SourceDTO;
    expect(dto.sourceFormat).toBe('mdl');
    expect(dto.warnings?.map((w) => w.code)).toEqual(['source-unreadable']);
  });
});

describe('dirty — a source with no write path has no flag, and that is the point', () => {
  it('a .prj carries no dirty flag at all, while the writable formats carry false', () => {
    // The asymmetry item 20 made the type tell the truth about. `dirty` is optional on
    // ISourceNode because ProjectNode genuinely has none; a well-meaning `dirty = false`
    // added to ProjectNode to satisfy the old required type would fail here, and would
    // silently promote a read-only project into the edit path.
    const s = createSession();
    const prj = s.addProjectSource('p.prj', PRJ_STORE);
    expect('dirty' in prj).toBe(false);
    expect(prj.dirty).toBeUndefined();

    expect(s.addModelSource('m.slx', bytes(SLX)).dirty).toBe(false);
    expect(s.addMatSource('v.mat', bytes(MAT)).dirty).toBe(false);
    expect(ingest(s, text('object_array_text.sldd'), { filename: 's.sldd' }).dirty).toBe(false);
  });

  it('the DTO still answers the question the node declines', () => {
    // SourceDTO.dirty stays REQUIRED and reads false for a project: a projection
    // crossing a process boundary has to answer, whereas a node may decline and be
    // asked with `!== undefined`. This is the pairing item 17 concluded with, restated
    // here because item 20 changed the node half of it.
    const s = createSession();
    const prj = s.addProjectSource('p.prj', PRJ_STORE, { path: '/w/P.prj' });
    const dto = toDTO(prj) as SourceDTO;
    expect(dto.dirty).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(dto, 'dirty')).toBe(true);
  });
});
