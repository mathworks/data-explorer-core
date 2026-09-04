// Copyright 2026 The MathWorks, Inc.
//
// A .prj holds no single manifest. Its contents live in a content-addressed store
// under resources/project/, where every entity is a pair of files — a POINTER
// (`<hash>p.xml` or `<hash>_sp.xml`, carrying `location` + `type`) and a DEF
// (`<hash>d.xml` / `_sd.xml`, carrying the attributes) — and an entity's children
// live in a sibling DIRECTORY named by its hash. Nothing in the store declares its
// own schema, so the parser walks it entirely by convention.
//
// That makes the malformed and partial cases the interesting ones. A .prj comes
// from a MATLAB release we may not know, and a store written by a newer (or
// older) one will carry entity types we do not recognize, pairs missing their def,
// and pointers missing attributes we read. parseProject is documented to NEVER
// throw — the whole open must degrade to fewer rows, never to an error dialog — so
// the tests below drive each unrecognized/missing/self-referential shape
// individually rather than trusting the outer try/catch to have caught them.
import { describe, it, expect } from 'vitest';
import { parseProject, type ParsedProject } from '../src/datamodel/parser/ProjectParser.js';

/** The store path of the helper.m pointer — the doc the malformed cases corrupt. */
const HELPER_POINTER =
  'resources/project/-V17xoKMQuak4-chxc1ixTLv0tA/8AEHllJDJXphBkrgA4Qqq-Hbo_sp.xml';

const DECL = '<?xml version="1.0" encoding="UTF-8"?>';

function info(body: string): string {
  return `${DECL}\n${body}`;
}

/** Path of a store file, relative to the project root. */
const at = (rel: string): string => `resources/project/${rel}`;

/**
 * A store built from `<hash> -> [pointerBody, defBody?]` pairs, keyed by the
 * directory they live in. This is the minimum shape the parser walks: one
 * pointer/def pair per entity, in a directory named by its parent's hash.
 */
function store(dirs: Record<string, Record<string, [string, string?]>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [dir, entities] of Object.entries(dirs)) {
    for (const [hash, [pointer, def]] of Object.entries(entities)) {
      out[at(`${dir}/${hash}p.xml`)] = info(pointer);
      if (def !== undefined) {
        out[at(`${dir}/${hash}d.xml`)] = info(def);
      }
    }
  }
  return out;
}

/** Build the REAL example store (MyProj) as a project-relative files map. */
function myProjStore(): Record<string, string> {
  const p = (rel: string): string => `resources/project/${rel}`;
  const store: Record<string, string> = {};

  // root/ entry pointers + defs
  store[p('root/GiiBklLgTxteCEmomM8RCvWT0nQd.xml')] = info('<Info Name="MyProj"/>');
  store[p('root/GiiBklLgTxteCEmomM8RCvWT0nQp.xml')] = info('<Info location="ProjectData" type="Info"/>');
  store[p('root/qaw0eS1zuuY1ar9TdPn1GMfrjbQp.xml')] = info('<Info location="Root" type="Files"/>');
  store[p('root/EEtUlUb-dLAdf0KpMVivaUlztwAp.xml')] = info('<Info location="Root" type="ProjectPath"/>');
  store[p('root/fjRQtWiSIy7hIlj-Kmk87M7s21kp.xml')] = info('<Info location="Root" type="Categories"/>');
  store[p('rootp.xml')] = info('<Info/>');
  store[p('Project.xml')] = info('<Info MetadataType="fixedPathV2"/>');

  // Files collection dir (hash = qaw0eS1zuuY1ar9TdPn1GMfrjbQ)
  const files = 'qaw0eS1zuuY1ar9TdPn1GMfrjbQ';
  store[p(`${files}/-V17xoKMQuak4-chxc1ixTLv0tAp.xml`)] = info('<Info location="utils" type="File"/>');
  store[p(`${files}/-V17xoKMQuak4-chxc1ixTLv0tAd.xml`)] = info('<Info/>');
  store[p(`${files}/aPSZTDXRjCsxkLD0Rd1_fiBDTLQp.xml`)] = info('<Info location="models" type="File"/>');
  store[p(`${files}/aPSZTDXRjCsxkLD0Rd1_fiBDTLQd.xml`)] = info('<Info/>');

  // utils File entity's own dir (hash = -V17xoKMQuak4-chxc1ixTLv0tA)
  const utils = '-V17xoKMQuak4-chxc1ixTLv0tA';
  store[p(`${utils}/8AEHllJDJXphBkrgA4Qqq-Hbo_sp.xml`)] = info('<Info location="helper.m" type="File"/>');
  store[p(`${utils}/8AEHllJDJXphBkrgA4Qqq-Hbo_sd.xml`)] = info(
    '<Info><Category UUID="FileClassCategory"><Label UUID="design"/></Category></Info>',
  );
  store[p(`${utils}/QJOBPzj8Qgmn1nMVM7YX0Z_g6ysp.xml`)] = info('<Info location="1" type="DIR_SIGNIFIER"/>');
  store[p(`${utils}/QJOBPzj8Qgmn1nMVM7YX0Z_g6ysd.xml`)] = info('<Info/>');

  // models File entity's own dir (hash = aPSZTDXRjCsxkLD0Rd1_fiBDTLQ)
  const models = 'aPSZTDXRjCsxkLD0Rd1_fiBDTLQ';
  store[p(`${models}/xAPbjHwzmXYjO5A4yMgoSh3c6fwp.xml`)] = info('<Info location="projmodel.slx" type="File"/>');
  store[p(`${models}/xAPbjHwzmXYjO5A4yMgoSh3c6fwd.xml`)] = info(
    '<Info><Category UUID="FileClassCategory"><Label UUID="design"/></Category></Info>',
  );
  store[p(`${models}/dCH3sRzeKdhf0RKOhtZCvQWzhW0p.xml`)] = info('<Info location="1" type="DIR_SIGNIFIER"/>');

  // ProjectPath collection dir (hash = EEtUlUb-dLAdf0KpMVivaUlztwA)
  const path = 'EEtUlUb-dLAdf0KpMVivaUlztwA';
  store[p(`${path}/nl_xHEu2T28pQPegRCeBLV7lu6Up.xml`)] = info(
    '<Info location="9b447c9e-6062-4c9d-b0b9-bb73ea7a6cd2" type="Reference"/>',
  );
  store[p(`${path}/nl_xHEu2T28pQPegRCeBLV7lu6Ud.xml`)] = info('<Info Ref="utils" Type="Relative"/>');

  // Categories collection dir (hash = fjRQtWiSIy7hIlj-Kmk87M7s21k)
  const cats = 'fjRQtWiSIy7hIlj-Kmk87M7s21k';
  store[p(`${cats}/NjSPEMsIuLUyIpr2u1Js5bVPsOsp.xml`)] = info('<Info location="FileClassCategory" type="Category"/>');
  store[p(`${cats}/NjSPEMsIuLUyIpr2u1Js5bVPsOsd.xml`)] = info(
    '<Info DataType="None" Name="Classification" ReadOnly="1" SingleValued="1"/>',
  );

  // FileClassCategory's dir holds Labels (hash = NjSPEMsIuLUyIpr2u1Js5bVPsOs)
  const labelDir = 'NjSPEMsIuLUyIpr2u1Js5bVPsOs';
  const labels: Array<[string, string, string]> = [
    // [hashSeed, labelId, displayName]
    ['j4xwF_j8iFTVayUMfxLgMnTbenc', 'design', 'Design'],
    ['aaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'derived', 'Derived'],
    ['bbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'other', 'Other'],
    ['cccccccccccccccccccccccccccc', 'convenience', 'Convenience'],
    ['dddddddddddddddddddddddddddd', 'none', 'None'],
    ['eeeeeeeeeeeeeeeeeeeeeeeeeeee', 'artifact', 'Artifact'],
    ['ffffffffffffffffffffffffffff', 'test', 'Test'],
  ];
  for (const [seed, id, display] of labels) {
    store[p(`${labelDir}/${seed}p.xml`)] = info(`<Info location="${id}" type="Label"/>`);
    store[p(`${labelDir}/${seed}d.xml`)] = info(`<Info Name="${display}" ReadOnly="READ_ONLY"/>`);
  }

  // An unrelated file OUTSIDE resources/project/ that must be ignored.
  store['MyProj.prj'] = 'not xml';
  store['models/projmodel.slx'] = 'binary';

  return store;
}

describe('parseProject', () => {
  it('parses the real MyProj example store', () => {
    const parsed: ParsedProject = parseProject(myProjStore(), 'fallback');

    expect(parsed.name).toBe('MyProj');

    const byPath = new Map(parsed.files.map((f) => [f.path, f]));

    // helper.m: a File with the 'design' label.
    const helper = byPath.get('helper.m');
    expect(helper).toBeDefined();
    expect(helper?.isFolder).toBe(false);
    expect(helper?.labels).toContain('design');

    // projmodel.slx: a File.
    const model = byPath.get('projmodel.slx');
    expect(model).toBeDefined();
    expect(model?.isFolder).toBe(false);

    // models + utils are folders (their dirs carry a DIR_SIGNIFIER child).
    expect(byPath.get('models')?.isFolder).toBe(true);
    expect(byPath.get('utils')?.isFolder).toBe(true);

    // Files are returned sorted by path.
    const paths = parsed.files.map((f) => f.path);
    expect(paths).toEqual([...paths].sort((a, b) => a.localeCompare(b)));

    // Path folders include 'utils'.
    expect(parsed.pathFolders).toContain('utils');

    // Label catalog includes the FileClassCategory labels.
    const labelNames = parsed.labels.map((l) => l.name);
    expect(labelNames).toContain('Design');
    expect(labelNames).toContain('Derived');
    expect(labelNames).toContain('Other');
    expect(labelNames).toContain('Test');
    // The category display name is resolved from the Category def.
    expect(parsed.labels.every((l) => l.category === 'Classification')).toBe(true);
  });

  it('returns fallback name and empty arrays for an empty store (no throw)', () => {
    const parsed = parseProject({}, 'EmptyProj');
    expect(parsed.name).toBe('EmptyProj');
    expect(parsed.files).toEqual([]);
    expect(parsed.pathFolders).toEqual([]);
    expect(parsed.labels).toEqual([]);
    expect(parsed.references).toEqual([]);
  });

  it('skips a malformed XML file and parses the rest (no throw)', () => {
    const store = myProjStore();
    // Corrupt the helper.m pointer; the rest of the store should survive.
    store[HELPER_POINTER] = '<Info location="helper.m" type=BROKEN <<<';

    const parsed = parseProject(store, 'fallback');
    expect(parsed.name).toBe('MyProj');
    // The other file (projmodel.slx) and folders still parse.
    const paths = parsed.files.map((f) => f.path);
    expect(paths).toContain('projmodel.slx');
    expect(paths).toContain('models');
    // Label catalog is unaffected.
    expect(parsed.labels.map((l) => l.name)).toContain('Design');
  });

  it('yields an empty label catalog when the Categories collection is missing', () => {
    const store = myProjStore();
    // Drop the Categories collection pointer and its dir contents.
    for (const key of Object.keys(store)) {
      if (
        key.includes('fjRQtWiSIy7hIlj-Kmk87M7s21k') ||
        key.includes('NjSPEMsIuLUyIpr2u1Js5bVPsOs')
      ) {
        delete store[key];
      }
    }

    const parsed = parseProject(store, 'fallback');
    expect(parsed.labels).toEqual([]);
    // Other sections still parse.
    expect(parsed.name).toBe('MyProj');
    expect(parsed.files.map((f) => f.path)).toContain('helper.m');
    expect(parsed.pathFolders).toContain('utils');
    // Per-file label assignments (UUIDs) are still surfaced.
    const helper = parsed.files.find((f) => f.path === 'helper.m');
    expect(helper?.labels).toContain('design');
  });

  it('resolves a genuine project->project reference by Ref basename', () => {
    const store = myProjStore();
    const p = (rel: string): string => `resources/project/${rel}`;

    // Add a top-level References collection in root.
    store[p('root/RefsCollHash0000000000000000p.xml')] = info('<Info location="Root" type="References"/>');
    // Its dir holds a type="Reference" entry (a real cross-project ref).
    const refDir = 'RefsCollHash0000000000000000';
    store[p(`${refDir}/ref1hash000000000000000000p.xml`)] = info(
      '<Info location="uuid-1234" type="Reference"/>',
    );
    store[p(`${refDir}/ref1hash000000000000000000d.xml`)] = info(
      '<Info Ref="../LibProj/LibProj.prj" Type="Relative"/>',
    );

    const parsed = parseProject(store, 'fallback');
    const ref = parsed.references.find((r) => r.id === 'uuid-1234');
    expect(ref).toBeDefined();
    expect(ref?.name).toBe('LibProj.prj');
    // The ProjectPath 'Reference' entries must NOT be misread as project refs.
    expect(parsed.references.some((r) => r.name === 'utils')).toBe(false);
  });
});

// A .prj has no fallback view, so parseProject is documented never to throw — and
// that contract is exactly what makes a failed read indistinguishable from a real
// but empty project. Every case below already returned a well-formed result before
// the warnings channel existed; what they lacked was any way to say the result is
// short. The distinction the channel has to hold is between a document we could not
// READ (corrupt, truncated) and one we merely do not MODEL (a sidecar from a newer
// release) — warning on the second would make every newer .prj noisy, which trains
// a host to ignore the count.
describe('parseProject — the warnings channel', () => {
  it('reports no warnings for a store it read completely', () => {
    // The clean store also carries two non-store files (MyProj.prj, a .slx) that are
    // skipped before any XML parse, so neither may register as unreadable.
    expect(parseProject(myProjStore(), 'fallback').warnings).toEqual([]);
  });

  it('warns about the one document it could not parse, naming it', () => {
    const store = myProjStore();
    store[HELPER_POINTER] = '<Info location="helper.m" type=BROKEN <<<';

    const parsed = parseProject(store, 'fallback');
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0].code).toBe('part-unreadable');
    // The relpath is the actionable part: it is what a user can go and look at.
    expect(parsed.warnings[0].part).toBe(HELPER_POINTER);
  });

  it('warns about a document that is not XML at all, not just one that fails to parse', () => {
    // A truncated or wrongly-encoded write can leave a .xml file the parser accepts
    // without producing a single element. That is unreadable, not unmodelled.
    const store = myProjStore();
    store[HELPER_POINTER] = 'plain text, no elements';

    const parsed = parseProject(store, 'fallback');
    expect(parsed.warnings.map((w) => w.part)).toEqual([HELPER_POINTER]);
    expect(parsed.warnings[0].code).toBe('part-unreadable');
  });

  it('stays silent about a well-formed document it does not model', () => {
    // The sidecar case from the indexing suite: valid XML, root element we do not
    // read. A newer release adding documents is not a defect in the file.
    const store = myProjStore();
    store['resources/project/root/sidecar.xml'] =
      '<?xml version="1.0" encoding="UTF-8"?>\n<SomethingElse Name="NotTheProject"/>';

    expect(parseProject(store, 'fallback').warnings).toEqual([]);
  });

  it('warns that a store with nothing readable in it yielded an empty project', () => {
    // This is the shape the channel exists for: name resolved, every collection
    // empty, and before now no way at all to tell that from a genuinely empty project.
    const parsed = parseProject({ 'nothing/relevant.txt': 'not xml' }, 'Junk');
    expect(parsed.files).toEqual([]);
    expect(parsed.warnings.map((w) => w.code)).toEqual(['source-empty']);
  });

  it('warns when the walk threw, so the empty result is not read as an empty project', () => {
    const parsed = parseProject(null as unknown as Record<string, string>, 'F');
    expect(parsed.name).toBe('F');
    expect(parsed.warnings.map((w) => w.code)).toEqual(['source-unreadable']);
    // The thrown message is carried through: it is the only clue to what broke.
    expect(parsed.warnings[0].message).toContain('null');
  });

  it('keeps the warnings JSON-safe, so they survive a worker boundary', () => {
    // Hosts parse off-thread and hand the result back through structured clone /
    // JSON, so a warning may not carry an Error object.
    const store = myProjStore();
    store[HELPER_POINTER] = '<Info type=BROKEN <<<';
    const parsed = parseProject(store, 'fallback');
    expect(JSON.parse(JSON.stringify(parsed.warnings))).toEqual(parsed.warnings);
  });
});

describe('parseProject — resolving the project name', () => {
  it('prefers the ProjectData def', () => {
    const parsed = parseProject(
      store({
        root: {
          bare: ['<Info location="somewhere"/>', '<Info Name="FromBareDef"/>'],
          data: ['<Info location="ProjectData" type="Info"/>', '<Info Name="FromProjectData"/>'],
        },
      }),
      'fallback',
    );
    expect(parsed.name).toBe('FromProjectData');
  });

  it('falls back to a bare def Name when no ProjectData entry names the project', () => {
    // Some stores carry the name on an untyped <Info Name="..."/> def alone. The
    // fallback is gated on the name still being the caller's placeholder, so it
    // cannot override a name we already resolved properly.
    const parsed = parseProject(
      store({ root: { bare: ['<Info location="somewhere"/>', '<Info Name="FromBareDef"/>'] } }),
      'fallback',
    );
    expect(parsed.name).toBe('FromBareDef');
  });

  it('ignores a bare def whose pointer is typed', () => {
    // A typed pointer means the def belongs to a known entity (a File, a Category,
    // …) whose Name is that entity's name, not the project's.
    const parsed = parseProject(
      store({ root: { f: ['<Info location="helper.m" type="File"/>', '<Info Name="helper.m"/>'] } }),
      'fallback',
    );
    expect(parsed.name).toBe('fallback');
  });

  it('keeps the caller-supplied name when nothing in the store names the project', () => {
    // The filename is the fallback, which is why the caller passes it in. Both an
    // empty store and a ProjectData entry with no Name at all land here.
    expect(parseProject({}, 'FromFilename').name).toBe('FromFilename');
    const noName = parseProject(
      store({ root: { data: ['<Info location="ProjectData" type="Info"/>', '<Info/>'] } }),
      'FromFilename',
    );
    expect(noName.name).toBe('FromFilename');
  });
});

describe('parseProject — indexing the content store', () => {
  it('reads only .xml files under resources/project/', () => {
    const s = store({ root: { d: ['<Info location="ProjectData" type="Info"/>', '<Info Name="Named"/>'] } });
    // Neither of these may be handed to the XML parser.
    s[at('root/notes.txt')] = 'plain text';
    s['MyProj.prj'] = 'not xml';
    s['models/model.slx'] = 'binary';
    expect(parseProject(s, 'fallback').name).toBe('Named');
  });

  it('skips a document whose root element is not <Info>', () => {
    // Newer releases add sidecar documents to the store; one we do not understand
    // must be passed over, not treated as an entity with no attributes.
    const s = store({ root: { d: ['<Info location="ProjectData" type="Info"/>', '<Info Name="Named"/>'] } });
    s[at('root/sidecar.xml')] = info('<SomethingElse Name="NotTheProject"/>');
    expect(parseProject(s, 'fallback').name).toBe('Named');
  });

  it('ignores a store file whose name carries no pointer/def suffix', () => {
    // The p/d suffix is the only thing that says which half of a pair a file is.
    // Without one there is no entity, so the directory reads as empty.
    const s = store({ root: { fh: ['<Info location="Root" type="Files"/>'] } });
    s[at('fh/nosuffix.xml')] = info('<Info location="orphan.m" type="File"/>');
    expect(parseProject(s, 'fallback').files).toEqual([]);
  });

  it('reads only the immediate children of a directory', () => {
    // A grandchild belongs to the child's own entity dir; counting it here would
    // list a nested file twice, once under each ancestor.
    const s = store({ root: { fh: ['<Info location="Root" type="Files"/>'] } });
    s[at('fh/deeper/nested.xml')] = info('<Info location="nested.m" type="File"/>');
    expect(parseProject(s, 'fallback').files).toEqual([]);
  });

  it('tolerates a store file whose name is nothing but the suffix', () => {
    // `p.xml` parses to a pointer with an EMPTY hash, i.e. an entity naming no
    // child directory. Reading children of "" must yield nothing rather than
    // re-reading the whole store as this entity's contents.
    const s: Record<string, string> = {
      [at('root/p.xml')]: info('<Info location="Root" type="Files"/>'),
      [at('root/d.xml')]: info('<Info Name="Nameless"/>'),
    };
    const parsed = parseProject(s, 'fallback');
    expect(parsed.files).toEqual([]);
    expect(parsed.references).toEqual([]);
  });

  it('never throws, whatever it is handed', () => {
    // The documented contract. The host has no fallback view for a .prj, so an
    // exception here is a failed open.
    expect(() => parseProject(null as unknown as Record<string, string>, 'F')).not.toThrow();
    const parsed = parseProject(null as unknown as Record<string, string>, 'F');
    expect(parsed).toMatchObject({
      name: 'F',
      files: [],
      pathFolders: [],
      labels: [],
      references: [],
    });
    // What it could not read is reported rather than swallowed — see the warnings suite.
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });
});

describe('parseProject — the Files collection', () => {
  it('skips a member that is not a File, or that has no location', () => {
    // location IS the path. Without one there is nothing to show in the tree, so
    // the entry is dropped rather than listed as a blank row.
    const parsed = parseProject(
      store({
        root: { fh: ['<Info location="Root" type="Files"/>'] },
        fh: {
          noLocation: ['<Info type="File"/>'],
          notAFile: ['<Info location="something" type="SomeNewType"/>'],
          good: ['<Info location="ok.m" type="File"/>'],
        },
      }),
      'fallback',
    );
    expect(parsed.files).toEqual([{ path: 'ok.m', isFolder: false, labels: [] }]);
  });

  it('stops at a File entity that lists itself as its own child', () => {
    // Hashes are content-addressed, so a folder whose dir repeats its own hash is
    // possible — and the recursion into folder contents would not terminate.
    const parsed = parseProject(
      store({
        root: { ch: ['<Info location="Root" type="Files"/>'] },
        ch: { selfhash: ['<Info location="dir" type="File"/>'] },
        selfhash: {
          selfhash: ['<Info location="dir" type="File"/>'],
          sig: ['<Info location="1" type="DIR_SIGNIFIER"/>'],
        },
      }),
      'fallback',
    );
    expect(parsed.files).toEqual([{ path: 'dir', isFolder: true, labels: [] }]);
  });

  it('deduplicates the labels on one file', () => {
    // A file can carry the same label id under two Category elements; the tree
    // must not render it twice.
    const parsed = parseProject(
      store({
        root: { fh: ['<Info location="Root" type="Files"/>'] },
        fh: {
          f: [
            '<Info location="a.m" type="File"/>',
            '<Info>' +
              '<Category UUID="c1"><Label UUID="design"/><Label UUID="design"/></Category>' +
              '<Category UUID="c2"><Label UUID="design"/><Label UUID="test"/></Category>' +
              '</Info>',
          ],
        },
      }),
      'fallback',
    );
    expect(parsed.files[0].labels).toEqual(['design', 'test']);
  });

  it('accepts a File entity with no def at all', () => {
    // The def is where labels live; a pair missing its def is an unlabelled file,
    // not a broken one.
    const parsed = parseProject(
      store({
        root: { fh: ['<Info location="Root" type="Files"/>'] },
        fh: { f: ['<Info location="a.m" type="File"/>'] },
      }),
      'fallback',
    );
    expect(parsed.files).toEqual([{ path: 'a.m', isFolder: false, labels: [] }]);
  });
});

describe('parseProject — the ProjectPath collection', () => {
  it('takes the Ref of each Reference entry, skipping anything else', () => {
    // A path folder is named by its def's Ref, NOT by the pointer location (which
    // is a UUID). An entry of another type, or one whose def has no Ref, has no
    // folder name to contribute.
    const parsed = parseProject(
      store({
        root: { pp: ['<Info location="Root" type="ProjectPath"/>'] },
        pp: {
          wrongType: ['<Info location="u1" type="SomeOtherType"/>', '<Info Ref="notAPathFolder"/>'],
          noRef: ['<Info location="u2" type="Reference"/>', '<Info/>'],
          good: ['<Info location="u3" type="Reference"/>', '<Info Ref="kept"/>'],
        },
      }),
      'fallback',
    );
    expect(parsed.pathFolders).toEqual(['kept']);
  });

  it('returns the path folders sorted', () => {
    // The store's iteration order is hash order, i.e. arbitrary. The tree shows
    // these verbatim, so the parser is what makes the order stable.
    const parsed = parseProject(
      store({
        root: { sp: ['<Info location="Root" type="ProjectPath"/>'] },
        sp: {
          s1: ['<Info location="u1" type="Reference"/>', '<Info Ref="zeta"/>'],
          s2: ['<Info location="u2" type="Reference"/>', '<Info Ref="alpha"/>'],
          s3: ['<Info location="u3" type="Reference"/>', '<Info Ref="mid"/>'],
        },
      }),
      'fallback',
    );
    expect(parsed.pathFolders).toEqual(['alpha', 'mid', 'zeta']);
  });
});

describe('parseProject — the label catalog', () => {
  it('skips a non-Category collection member and a non-Label category member', () => {
    const parsed = parseProject(
      store({
        root: { cc: ['<Info location="Root" type="Categories"/>'] },
        cc: {
          notACategory: ['<Info location="x" type="SomeOtherType"/>', '<Info Name="Ignored"/>'],
          cat: ['<Info location="FileClassCategory" type="Category"/>', '<Info Name="Classification"/>'],
        },
        cat: {
          l1: ['<Info location="design" type="Label"/>', '<Info Name="Design"/>'],
          notALabel: ['<Info location="x" type="SomeOtherType"/>', '<Info Name="Ignored"/>'],
        },
      }),
      'fallback',
    );
    expect(parsed.labels).toEqual([{ id: 'design', category: 'Classification', name: 'Design' }]);
  });

  it('names a category by its pointer location when its def has no Name', () => {
    // The location is the category id — a poor display name, but the alternative
    // is an unlabelled group in the picker.
    const parsed = parseProject(
      store({
        root: { cc: ['<Info location="Root" type="Categories"/>'] },
        cc: { cat: ['<Info location="FileClassCategory" type="Category"/>'] },
        cat: { l1: ['<Info location="design" type="Label"/>', '<Info Name="Design"/>'] },
      }),
      'fallback',
    );
    expect(parsed.labels).toEqual([{ id: 'design', category: 'FileClassCategory', name: 'Design' }]);
  });

  it('names a label by its id when its def has no Name, and drops one with neither', () => {
    // A label with no name and no id cannot be rendered or matched to a file
    // assignment, so it contributes nothing.
    const parsed = parseProject(
      store({
        root: { cc: ['<Info location="Root" type="Categories"/>'] },
        cc: { cat: ['<Info location="c" type="Category"/>', '<Info Name="Cat"/>'] },
        cat: {
          named: ['<Info location="lab1" type="Label"/>', '<Info Name="Label One"/>'],
          idOnly: ['<Info location="lab2" type="Label"/>'],
          neither: ['<Info type="Label"/>', '<Info/>'],
        },
      }),
      'fallback',
    );
    expect(parsed.labels).toEqual([
      { id: 'lab1', category: 'Cat', name: 'Label One' },
      { id: 'lab2', category: 'Cat', name: 'lab2' },
    ]);
  });
});

describe('parseProject — project references', () => {
  it('resolves a Reference that lives directly in root', () => {
    // References appear either in their own collection (covered above) or as a
    // root entry in their own right, depending on the writing release.
    const parsed = parseProject(
      store({ root: { r: ['<Info location="uuid-root-ref" type="Reference"/>', '<Info Ref="../Lib/Lib.prj"/>'] } }),
      'fallback',
    );
    expect(parsed.references).toEqual([{ id: 'uuid-root-ref', name: 'Lib.prj' }]);
  });

  it('falls back to the Ref as the id when the pointer has no location', () => {
    const parsed = parseProject(
      store({ root: { r: ['<Info type="Reference"/>', '<Info Ref="Sibling/Sibling.prj"/>'] } }),
      'fallback',
    );
    expect(parsed.references).toEqual([{ id: 'Sibling/Sibling.prj', name: 'Sibling.prj' }]);
  });

  it('reports a null name for a reference with no Ref path', () => {
    // The id (a UUID) is all we have; null is what tells the tree to show the id
    // rather than an empty cell.
    const parsed = parseProject(
      store({ root: { r: ['<Info location="uuid-only" type="Reference"/>', '<Info/>'] } }),
      'fallback',
    );
    expect(parsed.references).toEqual([{ id: 'uuid-only', name: null }]);
  });

  it('drops a reference with neither a location nor a Ref', () => {
    // Nothing identifies it, so it cannot be navigated to or matched.
    const parsed = parseProject(
      store({ root: { r: ['<Info type="Reference"/>', '<Info/>'] } }),
      'fallback',
    );
    expect(parsed.references).toEqual([]);
  });

  it('keeps a Ref made only of separators as its own name', () => {
    // Splitting it yields no path components; the raw string beats an empty name.
    const parsed = parseProject(
      store({ root: { r: ['<Info location="u" type="Reference"/>', '<Info Ref="///"/>'] } }),
      'fallback',
    );
    expect(parsed.references).toEqual([{ id: 'u', name: '///' }]);
  });

  it('resolves a Windows-style backslash Ref to its basename', () => {
    const parsed = parseProject(
      store({ root: { r: ['<Info location="u" type="Reference"/>', '<Info Ref="..\\Lib\\Lib.prj"/>'] } }),
      'fallback',
    );
    expect(parsed.references).toEqual([{ id: 'u', name: 'Lib.prj' }]);
  });
});
