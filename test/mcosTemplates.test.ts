// Copyright 2026 The MathWorks, Inc.
//
// mcosTemplates.ts, the generated templates core creates an MCOS object in a MAT-file from
// (test/parity/matlab/gen_mcos_templates.m, run in MATLAB R2023b): each one a subsystem the
// codec reads and writes back byte for byte, holding one object of its class where its variable
// says, nothing in it a path or a name, and the module what the generator's truth says it is.
//
// And what the codec makes of what R2023b's templates bring: a CoderInfo saved as a 'handle'
// opaque, which names none of the subsystem's objects; a stream that says it holds 'handle'
// objects; a blob with no file header, which an empty subsystem in a template's shape keeps.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { unzlibSync } from 'fflate';
import { MCOS_SAVED_ORDER, MCOS_TEMPLATE_RELEASE, MCOS_TEMPLATE_VERSION, MCOS_TEMPLATES } from '../src/datamodel/parser/mcosTemplates.js';
import {
  addClassSystems,
  classSystemsOf,
  createSubsystem,
  descriptorCell,
  classNameOf,
  objectReferenceElement,
  propertiesOf,
  readSubsystem,
  valueCellReferences,
  verifySubsystem,
  writeSubsystem,
  type McosSubsystemRecords,
} from '../src/datamodel/parser/McosSubsystemCodec.js';
import { MatWriteError } from '../src/datamodel/parser/MatWriter.js';
import { fixtureSubsystems } from './tools/mcosFixtureSubsystems.js';

const TRUTH = JSON.parse(readFileSync(new URL('./parity/matlab/mcos_templates.truth.json', import.meta.url), 'utf8')) as {
  version: string;
  release: string;
  templates: { file: string; class: string }[];
  savedOrder: Record<string, string[] | string>;
};

// Spelled so that this file does not match the leak check's own needles.
const PATHS = [/\/System\/Volumes/, /mathworks\/devel/, /jobarchiv[e]/, /\/Users\/[A-Za-z0-9._-]+/, /\/home\/[A-Za-z0-9._-]+/, /\/tmp\//, /\/private\//, /[A-Za-z]:\\/, /sandbox/i];

const inflated = (name: string): Uint8Array => unzlibSync(new Uint8Array(Buffer.from(MCOS_TEMPLATES[name].subsystem, 'base64')));

function template(name: string): McosSubsystemRecords {
  const r = readSubsystem(inflated(name));
  if (!r.ok) throw new Error(`${r.reason}: ${r.message}`);
  return r.subsystem;
}

/** The value cell property `saved` of the template's root object names. */
function cellOf(name: string, saved: string): Uint8Array {
  const s = template(name);
  const p = propertiesOf(s, MCOS_TEMPLATES[name].ids[0]).find((x) => x.savedName === saved);
  if (!p) throw new Error(`${name} saves no ${saved}`);
  return s.values[p.value];
}

const same = (a: Uint8Array, b: Uint8Array): boolean => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

describe('the MCOS templates', () => {
  it('are the generator truth\'s, from MATLAB R2023b', () => {
    expect(MCOS_TEMPLATE_RELEASE).toBe('R2023b');
    expect(MCOS_TEMPLATE_VERSION).toBe(TRUTH.version);
    expect(`R${TRUTH.release}`).toBe(MCOS_TEMPLATE_RELEASE);
    expect(Object.keys(MCOS_TEMPLATES)).toEqual(TRUTH.templates.map((t) => t.class));
    const order = Object.fromEntries(Object.entries(TRUTH.savedOrder).map(([k, v]) => [k.replace(/__/g, '.'), Array.isArray(v) ? v : [v]]));
    expect(MCOS_SAVED_ORDER).toEqual(order);
  });

  it('are small', () => {
    const total = Object.values(MCOS_TEMPLATES).reduce((a, t) => a + t.subsystem.length, 0);
    expect(total).toBeLessThan(16 * 1024);
  });

  for (const name of Object.keys(MCOS_TEMPLATES)) {
    describe(name, () => {
      const t = MCOS_TEMPLATES[name];
      const bytes = inflated(name);

      it('is a subsystem the codec reads, writes back byte for byte, and verifies', () => {
        const r = readSubsystem(bytes);
        if (!r.ok) throw new Error(`${r.reason}: ${r.message}`);
        expect([r.subsystem.blob.major, r.subsystem.blob.minor]).toEqual([4, 0]);
        const again = writeSubsystem(r.subsystem);
        expect(Buffer.compare(Buffer.from(again), Buffer.from(bytes))).toBe(0);
        expect(verifySubsystem(again, r.subsystem)).toEqual({ ok: true });
      });

      it('holds one object of its class where its variable says', () => {
        const r = readSubsystem(bytes);
        if (!r.ok) throw new Error(r.message);
        expect(t.dims).toEqual([1, 1]);
        expect(t.ids).toHaveLength(1);
        expect(t.variableClass).toBe(name);
        expect(classNameOf(r.subsystem, t.classIndex)).toBe(name);
        expect(r.subsystem.blob.objects[t.ids[0]].classIndex).toBe(t.classIndex);
      });

      it('holds no path and no name', () => {
        const b = Buffer.from(bytes);
        for (const view of [b.toString('latin1'), b.subarray(0, b.length & ~1).toString('utf16le'), b.subarray(1, 1 + ((b.length - 1) & ~1)).toString('utf16le')]) {
          for (const re of PATHS) expect(re.exec(view)?.[0] ?? null).toBeNull();
        }
      });
    });
  }
});

describe('what the R2023b templates bring, as the codec reads it', () => {
  it("a CoderInfo is a 'handle' opaque that names none of the subsystem's objects; a Bus's Elements is an object reference", () => {
    for (const name of ['Simulink.Parameter', 'Simulink.Signal', 'Simulink.LookupTable', 'Simulink.Breakpoint']) {
      const ci = cellOf(name, 'CoderInfo');
      expect(Buffer.from(ci).includes(Buffer.from('handle'))).toBe(true);
      expect(valueCellReferences(ci)).toBe('none');
    }
    expect(valueCellReferences(cellOf('Simulink.Signal', 'LoggingInfo'))).toBe('none');
    expect(valueCellReferences(cellOf('Simulink.Bus', 'Elements_internal'))).toBe('descriptor');
    for (const saved of ['Table', 'Breakpoints', 'StructTypeInfo']) {
      expect(valueCellReferences(cellOf('Simulink.LookupTable', saved))).toBe('descriptor');
    }
    expect(valueCellReferences(cellOf('Simulink.Parameter', 'Value'))).toBe('none');
  });

  it('an object reference inside a struct, or an MCOS opaque, is a reference nested out of reach', () => {
    const s = template('Simulink.ValueType');
    // The ValueType's defaults struct holds a BusElement of the subsystem by reference.
    expect(valueCellReferences(s.defaults!.entries[MCOS_TEMPLATES['Simulink.ValueType'].classIndex])).toBe('nested');
    expect(valueCellReferences(descriptorCell({ dims: [1, 1], ids: [1], classIndex: 1 }))).toBe('descriptor');
    expect(valueCellReferences(objectReferenceElement('', 'Simulink.Parameter', { dims: [1, 1], ids: [1], classIndex: 1 }))).toBe('nested');
  });

  it("the stream says which class systems it holds objects of, and gains 'handle' as MATLAB's own save writes it", () => {
    const withHandle = ['Simulink.Parameter', 'Simulink.Signal', 'Simulink.LookupTable', 'Simulink.Breakpoint'];
    for (const name of Object.keys(MCOS_TEMPLATES)) {
      expect(classSystemsOf(template(name))).toEqual(withHandle.includes(name) ? ['MCOS', 'handle'] : ['MCOS']);
    }
    const bus = template('Simulink.Bus');
    addClassSystems(bus, ['MCOS']);
    expect(same(bus.rest, template('Simulink.Bus').rest)).toBe(true);
    addClassSystems(bus, ['handle', 'MCOS', 'handle']);
    expect(same(bus.rest, template('Simulink.Parameter').rest)).toBe(true);
    expect(classSystemsOf(bus)).toEqual(['MCOS', 'handle']);
    // A Bus holds no 'handle' object, and MATLAB writes 'handle' there only once one is saved: the
    // self-check refuses the shape, which no MATLAB save was seen to write.
    const written = writeSubsystem(bus);
    expect(verifySubsystem(written, bus, template('Simulink.Bus'))).toMatchObject({ ok: false, reason: 'broken', message: expect.stringContaining("no 'handle' opaque") });
    const odd = template('string');
    odd.rest = Uint8Array.of(14, 0, 0, 0, 0, 0, 0, 0);
    expect(classSystemsOf(odd)).toBeNull();
    expect(() => addClassSystems(odd, ['handle'])).toThrow(MatWriteError);
  });

  it('an empty subsystem in an R2023b template\'s shape has no file header, as R2023b writes none', () => {
    for (const name of Object.keys(MCOS_TEMPLATES)) {
      const shape = template(name);
      expect(shape.blob.fileHeader).toBeNull();
      const empty = createSubsystem(shape);
      expect(empty.blob.fileHeader).toBeNull();
      expect(empty.blob.removedProps).toEqual([]);
      // The shape's bytes, copied: a template is read once for the process.
      expect(same(empty.rest, shape.rest)).toBe(true);
      expect(empty.rest).not.toBe(shape.rest);
      expect(verifySubsystem(writeSubsystem(empty), empty)).toEqual({ ok: true });
    }
    expect(createSubsystem().blob.fileHeader).toEqual({ perArray: [] });
  });

  // Every subsystem of the test tree, read whole: 0.3 s alone, up to 3.0 s in a full run.
  it('every subsystem the test tree holds has a stream of class systems, MCOS first, and a value cell of each kind reads', { timeout: 30_000 }, () => {
    const seen = new Set<string>();
    let cells = 0;
    for (const f of fixtureSubsystems()) {
      const r = readSubsystem(f.bytes);
      if (!r.ok) continue;
      expect(classSystemsOf(r.subsystem)?.[0], f.where).toBe('MCOS');
      for (const v of r.subsystem.values) {
        seen.add(valueCellReferences(v));
        cells++;
      }
    }
    expect(cells).toBeGreaterThan(1000);
    expect([...seen].sort()).toEqual(['descriptor', 'nested', 'none']);
  });
});
