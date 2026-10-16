// Copyright 2026 The MathWorks, Inc.
//
// One node, one id, for a model's references and its external data sources.
//
// A model that references `plant` from two Model blocks gets two reference rows, and both
// are named `plant.slx`: the name is the FILE, which is what the Name column shows and what
// the row's link follows. The inherited id was `parent.id + '/' + name`, so the two rows
// shared one id. A node id is what findNodeById resolves, what a row is keyed by and what a
// host remembers a selection as, so two nodes with one id were two rows the host could not
// tell apart: the session index kept only one of them, and the other could not be looked up.
// An external data source is named after the basename of its path, so `a/signals.mat` and
// `b/signals.mat` collided the same way.
//
// ModelBlockNode.id is the precedent: it keys a block on its SID rather than its name. These
// two nodes key on what they record and their name does not: the referencing block's path,
// and the source's path as the model wrote it.
//
// Every model here goes through the real parsers and the real ingest, so the ids under test
// are the ones a host sees.
import { describe, it, expect } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A `.slx` with only the parts these tests read. `graphicalInterface` is the R2026b flat
// shape extractModelReferences reads; `dataSources` become ExternalDataSourceSettings.xml.
function slxModel(opts: { references?: { BlockPath: string; ModelName: string }[]; dataSources?: string[] }): ArrayBuffer {
  const parts: Record<string, Uint8Array> = {
    'simulink/blockDiagram.json': strToU8(JSON.stringify({ BlockDiagram: { ModelUUID: 'u1' } })),
    'simulink/systems/system_root.xml': strToU8(`<?xml version="1.0" encoding="utf-8"?><System></System>`),
    'metadata/coreProperties.xml': strToU8(
      `<?xml version="1.0"?><coreProperties><version>R2026b</version></coreProperties>`,
    ),
  };
  if (opts.references) {
    parts['simulink/graphicalInterface.json'] = strToU8(JSON.stringify({ ModelReferences: opts.references }));
  }
  if (opts.dataSources) {
    parts['simulink/ExternalDataSourceSettings.xml'] = strToU8(
      `<?xml version="1.0"?><ExternalDataSourceSettings>` +
        opts.dataSources
          .map((p) => `<ExplicitExternalBrokerSources><fullPathToSource>${p}</fullPathToSource></ExplicitExternalBrokerSources>`)
          .join('') +
        `</ExternalDataSourceSettings>`,
    );
  }
  const zipped = zipSync(parts);
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

// A classic `.mdl` whose GraphicalInterface records two Model blocks referencing one model,
// in the form mdlParser.test.ts's CLASSIC fixture uses. The block paths are written with the
// model's own name as their root, which the parser rewrites to `$bdroot`.
const CLASSIC_TWO_REFS = String.raw`Model {
  Name                    "top"
  Version                 7.8
  GraphicalInterface {
    ModelReference {
      ModelRefBlockPath     "top/A|plant"
    }
    ModelReference {
      ModelRefBlockPath     "top/B|plant"
    }
  }
  System {
    Name                    "top"
  }
}
`;

function section(model: any, name: string): any[] {
  return model.getSection(name).children;
}

function duplicateIds(model: any): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const node of model.flatten()) {
    if (seen.has(node.id)) dupes.push(node.id);
    seen.add(node.id);
  }
  return dupes;
}

describe('a model referenced from two Model blocks', () => {
  it('gives the two reference nodes in a .slx distinct ids, each findable by its own', () => {
    const s = createSession();
    const model = ingest(
      s,
      slxModel({
        references: [
          { BlockPath: 'top/A', ModelName: 'plant' },
          { BlockPath: 'top/B', ModelName: 'plant' },
        ],
      }),
      { filename: 'top.slx' },
    ) as any;
    const refs = section(model, 'references');
    expect(refs.map((r) => r.blockPath)).toEqual(['top/A', 'top/B']);
    // Both still name the FILE they reference: the Name column and the link are unchanged.
    expect(refs.map((r) => r.name)).toEqual(['plant.slx', 'plant.slx']);
    expect(refs.map((r) => r.toRow().Value.linkTarget)).toEqual(['plant.slx', 'plant.slx']);

    expect(refs[0].id).not.toBe(refs[1].id);
    // The spelling is the ruling's: the referenced name, then the referencing block's path.
    expect(refs.map((r) => r.id)).toEqual([
      'top.slx/references/plant.slx@top/A',
      'top.slx/references/plant.slx@top/B',
    ]);
    // The session index holds both, and each id hands back its own node.
    expect(s.findNodeById(refs[0].id)).toBe(refs[0]);
    expect(s.findNodeById(refs[1].id)).toBe(refs[1]);
    expect((s.findNodeById(refs[0].id) as any).blockPath).toBe('top/A');
    expect((s.findNodeById(refs[1].id) as any).blockPath).toBe('top/B');
    expect(duplicateIds(model)).toEqual([]);
  });

  it('gives the two reference nodes in a classic .mdl distinct ids, each findable by its own', () => {
    const s = createSession();
    const model = ingest(s, strToU8(CLASSIC_TWO_REFS), { filename: 'top.mdl' }) as any;
    const refs = section(model, 'references');
    expect(refs.map((r) => r.blockPath)).toEqual(['$bdroot/A', '$bdroot/B']);
    expect(refs.map((r) => r.name)).toEqual(['plant.mdl', 'plant.mdl']);

    expect(refs[0].id).not.toBe(refs[1].id);
    expect(s.findNodeById(refs[0].id)).toBe(refs[0]);
    expect(s.findNodeById(refs[1].id)).toBe(refs[1]);
    expect((s.findNodeById(refs[0].id) as any).blockPath).toBe('$bdroot/A');
    expect((s.findNodeById(refs[1].id) as any).blockPath).toBe('$bdroot/B');
    expect(duplicateIds(model)).toEqual([]);
  });
});

describe('two external data sources with one file name', () => {
  it('gives each its own id, while both rows are still named after the file', () => {
    const s = createSession();
    const model = ingest(s, slxModel({ dataSources: ['a/signals.mat', 'b/signals.mat'] }), {
      filename: 'top.slx',
    }) as any;
    const sources = section(model, 'dataSources');
    expect(sources.map((d) => d.fullPath)).toEqual(['a/signals.mat', 'b/signals.mat']);
    expect(sources.map((d) => d.name)).toEqual(['signals.mat', 'signals.mat']);
    expect(sources.map((d) => d.toRow().Name.label)).toEqual(['signals.mat', 'signals.mat']);
    expect(sources.map((d) => d.toRow().Value.linkTarget)).toEqual(['signals.mat', 'signals.mat']);

    expect(sources[0].id).not.toBe(sources[1].id);
    expect(sources.map((d) => d.id)).toEqual([
      'top.slx/dataSources/signals.mat@a/signals.mat',
      'top.slx/dataSources/signals.mat@b/signals.mat',
    ]);
    expect(s.findNodeById(sources[0].id)).toBe(sources[0]);
    expect(s.findNodeById(sources[1].id)).toBe(sources[1]);
    expect((s.findNodeById(sources[0].id) as any).fullPath).toBe('a/signals.mat');
    expect((s.findNodeById(sources[1].id) as any).fullPath).toBe('b/signals.mat');
    expect(duplicateIds(model)).toEqual([]);
  });

  it('keeps a Windows path apart from its sibling the same way', () => {
    // MATLAB on Windows records `..\shared\signals.mat`; the name is still the basename.
    const s = createSession();
    const model = ingest(s, slxModel({ dataSources: ['..\\a\\signals.mat', '..\\b\\signals.mat'] }), {
      filename: 'top.slx',
    }) as any;
    const sources = section(model, 'dataSources');
    expect(sources.map((d) => d.name)).toEqual(['signals.mat', 'signals.mat']);
    expect(sources[0].id).not.toBe(sources[1].id);
    expect(s.findNodeById(sources[0].id)).toBe(sources[0]);
    expect(s.findNodeById(sources[1].id)).toBe(sources[1]);
    expect(duplicateIds(model)).toEqual([]);
  });
});

describe('the ids are stable', () => {
  it('gives the same ids when the same bytes are ingested again', () => {
    const bytes = slxModel({
      references: [
        { BlockPath: 'top/A', ModelName: 'plant' },
        { BlockPath: 'top/B', ModelName: 'plant' },
      ],
      dataSources: ['a/signals.mat', 'b/signals.mat'],
    });
    const idsOf = (): string[] => {
      const model = ingest(createSession(), bytes.slice(0), { filename: 'top.slx' }) as any;
      return [...section(model, 'references'), ...section(model, 'dataSources')].map((n) => n.id);
    };
    const first = idsOf();
    expect(new Set(first).size).toBe(4);
    expect(idsOf()).toEqual(first);
  });
});
