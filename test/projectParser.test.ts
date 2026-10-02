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

    // helper.m: a File with the 'design' label. Its path is qualified by the folder
    // it sits in — a File entity's `location` is relative to its PARENT entity, not
    // to the project root, so the bare name the store records is only half of it.
    const helper = byPath.get('utils/helper.m');
    expect(helper).toBeDefined();
    expect(helper?.isFolder).toBe(false);
    expect(helper?.labels).toContain('design');

    // projmodel.slx: a File, likewise under the folder that holds it.
    const model = byPath.get('models/projmodel.slx');
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
    expect(paths).toContain('models/projmodel.slx');
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
    expect(parsed.files.map((f) => f.path)).toContain('utils/helper.m');
    expect(parsed.pathFolders).toContain('utils');
    // Per-file label assignments (UUIDs) are still surfaced.
    const helper = parsed.files.find((f) => f.path === 'utils/helper.m');
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
    expect(parsed.labels).toEqual([
      { id: 'design', category: 'Classification', name: 'Design', readOnly: false },
    ]);
  });

  it('marks the labels MATLAB owns as read-only, and the project\'s own as not', () => {
    // The seven Classification labels ship with every project and are marked
    // ReadOnly in the store; a label the project ADDED is not. That marking is the
    // only thing separating the two, and it is what lets a page distinguish "this
    // project defines its own vocabulary" from "this project uses the defaults".
    //
    // THE ATTRIBUTE HAS A VOCABULARY PER ELEMENT: 'READ_ONLY'/'WRITABLE' on a
    // label, '1'/'0' on a category. `WRITABLE` is the case that matters and the one
    // no hand-typed fixture here had ever contained — the rule used to be presence,
    // which read a project's own label as one of MATLAB's and drew it on the page as
    // a built-in. Measured on a MATLAB-written project: see
    // test/parity/project.parity.test.ts, where the same claim is held to MATLAB's
    // refusal to remove its own labels.
    const parsed = parseProject(
      store({
        root: { cc: ['<Info location="Root" type="Categories"/>'] },
        cc: { cat: ['<Info location="c" type="Category"/>', '<Info Name="Classification" ReadOnly="1"/>'] },
        cat: {
          builtin: ['<Info location="design" type="Label"/>', '<Info Name="Design" ReadOnly="READ_ONLY"/>'],
          writable: ['<Info location="checked" type="Label"/>', '<Info Name="Checked" ReadOnly="WRITABLE"/>'],
          mine: ['<Info location="mine" type="Label"/>', '<Info Name="ForUser"/>'],
        },
      }),
      'fallback',
    );
    const byId = new Map(parsed.labels.map((l) => [l.id, l]));
    expect(byId.get('design')?.readOnly).toBe(true);
    expect(byId.get('checked')?.readOnly).toBe(false);
    // An older store writes no attribute at all on a label the project added.
    expect(byId.get('mine')?.readOnly).toBe(false);
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
    expect(parsed.labels).toEqual([
      { id: 'design', category: 'FileClassCategory', name: 'Design', readOnly: false },
    ]);
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
    // By category then name, not in store order: see the sort in parseProject —
    // one project in two metadata layouts handed its catalog over in two orders.
    expect(parsed.labels).toEqual([
      { id: 'lab2', category: 'Cat', name: 'lab2', readOnly: false },
      { id: 'lab1', category: 'Cat', name: 'Label One', readOnly: false },
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
    expect(parsed.references).toEqual([
      // The PATH is kept as the store spelled it, not just its basename: a host that
      // offers to open the referenced project needs somewhere to resolve, and the id
      // is a UUID.
      { id: 'uuid-root-ref', name: 'Lib.prj', path: '../Lib/Lib.prj' },
    ]);
  });

  it('falls back to the Ref as the id when the pointer has no location', () => {
    const parsed = parseProject(
      store({ root: { r: ['<Info type="Reference"/>', '<Info Ref="Sibling/Sibling.prj"/>'] } }),
      'fallback',
    );
    expect(parsed.references).toEqual([
      { id: 'Sibling/Sibling.prj', name: 'Sibling.prj', path: 'Sibling/Sibling.prj' },
    ]);
  });

  it('reports a null name for a reference with no Ref path', () => {
    // The id (a UUID) is all we have; null is what tells the tree to show the id
    // rather than an empty cell.
    const parsed = parseProject(
      store({ root: { r: ['<Info location="uuid-only" type="Reference"/>', '<Info/>'] } }),
      'fallback',
    );
    expect(parsed.references).toEqual([{ id: 'uuid-only', name: null, path: null }]);
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
    expect(parsed.references).toEqual([{ id: 'u', name: '///', path: '///' }]);
  });

  it('resolves a Windows-style backslash Ref to its basename', () => {
    const parsed = parseProject(
      store({ root: { r: ['<Info location="u" type="Reference"/>', '<Info Ref="..\\Lib\\Lib.prj"/>'] } }),
      'fallback',
    );
    expect(parsed.references).toEqual([
      { id: 'u', name: 'Lib.prj', path: '..\\Lib\\Lib.prj' },
    ]);
  });
});

describe('parseProject — nested member paths', () => {
  it('qualifies a nested file by the folders above it', () => {
    // A File entity's `location` is relative to its PARENT entity, not to the
    // project root: `utils/helper.m` is stored as a File named `helper.m` inside a
    // File named `utils`. Read verbatim, that file and a root-level `helper.m`
    // produce the same row, so a host cannot open either one reliably.
    const parsed = parseProject(
      store({
        root: { f: ['<Info location="Root" type="Files"/>'] },
        f: { a: ['<Info location="top" type="File"/>', '<Info/>'] },
        a: { b: ['<Info location="mid" type="File"/>', '<Info/>'] },
        b: { c: ['<Info location="leaf.m" type="File"/>', '<Info/>'] },
      }),
      'fallback',
    );
    expect(parsed.files.map((f) => f.path)).toEqual(['top', 'top/mid', 'top/mid/leaf.m']);
  });
});

describe('parseProject — two collections of one type', () => {
  it('reads the Root Files collection and ignores another one beside it', () => {
    // A real project carries BOTH `location="Root" type="Files"` (its members) and
    // `location="ALM" type="Files"` (artifact tracking). Matching on type alone
    // assigned `files` twice and let store order pick the winner — and the ALM
    // collection holds no member files at all, only a DIR_SIGNIFIER, so losing that
    // race produced a project with zero members.
    const parsed = parseProject(
      store({
        root: {
          rootFiles: ['<Info location="Root" type="Files"/>'],
          almFiles: ['<Info location="ALM" type="Files"/>'],
        },
        rootFiles: { m: ['<Info location="real.m" type="File"/>', '<Info/>'] },
        almFiles: { d: ['<Info location="1" type="DIR_SIGNIFIER"/>', '<Info/>'] },
      }),
      'fallback',
    );
    expect(parsed.files.map((f) => f.path)).toEqual(['real.m']);
  });
});

describe('parseProject — the project root on the path', () => {
  it('keeps the empty Ref that names the project root itself', () => {
    // The root is on the MATLAB path as `Ref=""` and is usually the FIRST folder
    // MATLAB adds, so testing the Ref for truthiness dropped a real entry from
    // almost every project. Empty-string is the root's name here; a host renders it.
    const parsed = parseProject(
      store({
        root: { pp: ['<Info location="Root" type="ProjectPath"/>'] },
        pp: {
          a: ['<Info location="u1" type="Reference"/>', '<Info Ref="" Type="Relative"/>'],
          b: ['<Info location="u2" type="Reference"/>', '<Info Ref="utils"/>'],
        },
      }),
      'fallback',
    );
    expect(parsed.pathFolders).toEqual(['', 'utils']);
  });
});

describe('parseProject — working folders', () => {
  const workingFolderStore = () =>
    store({
      root: { wf: ['<Info location="Root" type="WorkingFolders"/>'] },
      wf: {
        a: ['<Info location="SimulinkCacheFolder" type="Reference"/>', '<Info Ref="Cache"/>'],
        b: ['<Info location="DependencyCacheFile" type="Reference"/>', '<Info Ref="Dep/cache.graphml"/>'],
        c: ['<Info location="NewInSomeFutureRelease" type="Reference"/>', '<Info Ref="Somewhere"/>'],
      },
    });

  it('reads each designated location, keeping the store key verbatim', () => {
    // The key is NOT translated to a display name here: a newer release can
    // designate a purpose this version has no label for, and passing the raw key
    // through lets a host show it rather than silently drop the row.
    const parsed = parseProject(workingFolderStore(), 'fallback');
    // By key, not in store order — these are keyed by purpose and the store's own
    // order is its directory order, which differs between metadata layouts.
    expect(parsed.workingFolders).toEqual([
      { key: 'DependencyCacheFile', ref: 'Dep/cache.graphml' },
      { key: 'NewInSomeFutureRelease', ref: 'Somewhere' },
      { key: 'SimulinkCacheFolder', ref: 'Cache' },
    ]);
  });

  it('does not report them as project references', () => {
    // These are spelled `type="Reference"`, exactly like a project->project
    // reference and like a path folder — the collection they sit in is the ONLY
    // thing separating them. A scan that looked at every collection's Reference
    // children therefore INVENTED references: this project has none, and the
    // monophonic_syntethizer project was reported as referencing three.
    const parsed = parseProject(workingFolderStore(), 'fallback');
    expect(parsed.references).toEqual([]);
  });

  it('still finds a reference in a collection it does not model', () => {
    // The flip side of that fix: the collection holding real references is spelled
    // differently across releases, so the parser skips the collections it KNOWS are
    // not references rather than allow-listing the ones it thinks are.
    const parsed = parseProject(
      store({
        root: { c: ['<Info location="Root" type="SomeFutureReferenceCollection"/>'] },
        c: { r: ['<Info location="uuid-1" type="Reference"/>', '<Info Ref="../Lib/Lib.prj"/>'] },
      }),
      'fallback',
    );
    expect(parsed.references).toEqual([
      { id: 'uuid-1', name: 'Lib.prj', path: '../Lib/Lib.prj' },
    ]);
  });
});

describe('parseProject — entry points', () => {
  /** A store with a two-file shutdown chain, written in the REVERSE of run order. */
  const chainStore = () =>
    store({
      root: { ep: ['<Info location="Root" type="EntryPoints"/>'] },
      ep: {
        second: [
          '<Info location="id-second" type="EntryPoint"/>',
          '<Info File="b.m" Name="second" Type="Shutdown" Visible="0">' +
            '<Extension Name="ShutdownPrev" Value="id-first"/></Info>',
        ],
        first: [
          '<Info location="id-first" type="EntryPoint"/>',
          '<Info File="a.m" Name="first" Type="Shutdown" Visible="0">' +
            '<Extension Name="ShutdownPrev" Value="HEAD"/></Info>',
        ],
      },
    });

  it('puts a hook in run order, not store order', () => {
    // MATLAB runs these top-down, and the order lives ONLY in the *Prev chain —
    // each entry naming its predecessor, HEAD marking the first. Nothing else in
    // the store recovers it, so presenting these in store order (or sorted by name)
    // silently misreports the sequence a project shuts down in.
    const parsed = parseProject(chainStore(), 'fallback');
    expect(parsed.entryPoints.map((e) => e.name)).toEqual(['first', 'second']);
  });

  it('puts a hook in run order when the first file is unchained rather than HEAD', () => {
    // The OTHER spelling of first, and the common one: a project that added two
    // startup files and never reordered them writes no Extension on the first at
    // all — only the second carries a link. Reading `HEAD` as the only head found
    // no head here and fell back to document order, which is the order the store
    // serializes UUIDs in: reversed, in the project MATLAB wrote for
    // test/parity/project.parity.test.ts, against the order MATLAB runs them.
    const parsed = parseProject(
      store({
        root: { ep: ['<Info location="Root" type="EntryPoints"/>'] },
        ep: {
          // Written second-first, as the monolithic document does.
          two: [
            '<Info location="id-two" type="EntryPoint"/>',
            '<Info File="startup_two.m" Name="startup_two" Type="StartUp" Visible="0">' +
              '<Extension Name="StartUpPrev" Value="id-one"/></Info>',
          ],
          one: [
            '<Info location="id-one" type="EntryPoint"/>',
            '<Info File="startup_one.m" Name="startup_one" Type="StartUp" Visible="0"/>',
          ],
        },
      }),
      'fallback',
    );
    expect(parsed.entryPoints.map((e) => e.name)).toEqual(['startup_one', 'startup_two']);
  });

  it('yields every entry exactly once when the chain is a cycle', () => {
    // Nothing in the store prevents it, and a chain walk that trusts the links
    // would never terminate. Order is then undefined, but completeness is not.
    const parsed = parseProject(
      store({
        root: { ep: ['<Info location="Root" type="EntryPoints"/>'] },
        ep: {
          a: [
            '<Info location="id-a" type="EntryPoint"/>',
            '<Info File="a.m" Name="a" Type="StartUp"><Extension Name="StartUpPrev" Value="id-b"/></Info>',
          ],
          b: [
            '<Info location="id-b" type="EntryPoint"/>',
            '<Info File="b.m" Name="b" Type="StartUp"><Extension Name="StartUpPrev" Value="id-a"/></Info>',
          ],
        },
      }),
      'fallback',
    );
    expect(parsed.entryPoints.map((e) => e.name).sort()).toEqual(['a', 'b']);
  });

  it('keeps an unchained hook file, which is what a single-file hook looks like', () => {
    // A project with one startup file writes no Extension at all, so the absent
    // chain is the COMMON case here and not a damaged store.
    const parsed = parseProject(
      store({
        root: { ep: ['<Info location="Root" type="EntryPoints"/>'] },
        ep: { a: ['<Info location="id-a" type="EntryPoint"/>', '<Info File="s.m" Name="s" Type="StartUp"/>'] },
      }),
      'fallback',
    );
    expect(parsed.entryPoints).toEqual([
      { id: 'id-a', name: 's', file: 's.m', kind: 'StartUp', visible: true, groupId: '' },
    ]);
  });

  it('orders startup before shutdown, then the shortcuts', () => {
    const parsed = parseProject(
      store({
        root: { ep: ['<Info location="Root" type="EntryPoints"/>'] },
        ep: {
          s: ['<Info location="id-s" type="EntryPoint"/>', '<Info File="c.m" Name="shortcut" Type="Basic"/>'],
          d: ['<Info location="id-d" type="EntryPoint"/>', '<Info File="d.m" Name="down" Type="Shutdown"/>'],
          u: ['<Info location="id-u" type="EntryPoint"/>', '<Info File="u.m" Name="up" Type="StartUp"/>'],
        },
      }),
      'fallback',
    );
    expect(parsed.entryPoints.map((e) => e.name)).toEqual(['up', 'down', 'shortcut']);
  });

  it("reads Visible as the string it is, and normalizes the 'default' group", () => {
    // Attributes are not coerced by the reader, so Visible arrives as '1'/'0' —
    // comparing it to a number or to `false` would make every entry visible.
    // 'default' is the store's spelling for ungrouped; passed through, a host would
    // render a shortcuts group literally named default.
    const parsed = parseProject(
      store({
        root: { ep: ['<Info location="Root" type="EntryPoints"/>'] },
        ep: {
          a: [
            '<Info location="id-a" type="EntryPoint"/>',
            '<Info File="a.m" Name="hidden" Type="Shutdown" Visible="0" GroupUUID="default"/>',
          ],
          b: [
            '<Info location="id-b" type="EntryPoint"/>',
            '<Info File="b.m" Name="shown" Type="Basic" Visible="1" GroupUUID="grp-1"/>',
          ],
        },
      }),
      'fallback',
    );
    const byName = new Map(parsed.entryPoints.map((e) => [e.name, e]));
    expect(byName.get('hidden')?.visible).toBe(false);
    expect(byName.get('hidden')?.groupId).toBe('');
    expect(byName.get('shown')?.visible).toBe(true);
    expect(byName.get('shown')?.groupId).toBe('grp-1');
  });

  it('keeps a shortcut that targets a folder', () => {
    // An entry point is not always a file: a real project ships shortcuts whose
    // File attribute names a DIRECTORY, which a host must open differently.
    const parsed = parseProject(
      store({
        root: { ep: ['<Info location="Root" type="EntryPoints"/>'] },
        ep: { a: ['<Info location="id-a" type="EntryPoint"/>', '<Info File="utilities" Name="utilities" Type="Basic"/>'] },
      }),
      'fallback',
    );
    expect(parsed.entryPoints[0].file).toBe('utilities');
  });

  it('skips an entry with neither a name nor a file, and a non-EntryPoint member', () => {
    const parsed = parseProject(
      store({
        root: { ep: ['<Info location="Root" type="EntryPoints"/>'] },
        ep: {
          empty: ['<Info location="id-empty" type="EntryPoint"/>', '<Info Type="Basic"/>'],
          other: ['<Info location="id-other" type="SomethingElse"/>', '<Info File="x.m" Name="x"/>'],
          good: ['<Info location="id-good" type="EntryPoint"/>', '<Info File="g.m" Name="g" Type="Basic"/>'],
        },
      }),
      'fallback',
    );
    expect(parsed.entryPoints.map((e) => e.name)).toEqual(['g']);
  });

  it('reads the named shortcut groups', () => {
    const parsed = parseProject(
      store({
        root: { g: ['<Info location="Root" type="EntryPointGroups"/>'] },
        g: {
          a: ['<Info location="grp-1" type="EntryPointGroup"/>', '<Info Name="Utility"/>'],
          unnamed: ['<Info location="grp-2" type="EntryPointGroup"/>', '<Info/>'],
          other: ['<Info location="grp-3" type="NotAGroup"/>', '<Info Name="Ignored"/>'],
        },
      }),
      'fallback',
    );
    expect(parsed.entryPointGroups).toEqual([{ id: 'grp-1', name: 'Utility' }]);
  });
});

describe('parseProject — the distributed layout', () => {
  /**
   * A store in the `distributed` layout: no pointer documents at all. An entity's
   * location and type are its FILENAME (`<location>.type.<Type>.xml` for the def,
   * `<location>.type.<Type>/` for the child directory), directories nest the way
   * the entities do, and the top-level entities sit directly in the store root.
   */
  function distStore(files: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {
      [at('Project.xml')]: info('<Info MetadataType="distributed"/>'),
    };
    for (const [rel, body] of Object.entries(files)) {
      out[at(rel)] = info(body);
    }
    return out;
  }

  it('reads a whole project out of filenames', () => {
    const parsed = parseProject(
      distStore({
        'ProjectData.type.Info.xml': '<Info Name="DistProj"/>',
        'Root.type.Files/top.m.type.File.xml': '<Info><Category UUID="c"><Label UUID="design"/></Category></Info>',
        'Root.type.Files/utils.type.File/1.type.DIR_SIGNIFIER.xml': '<Info/>',
        'Root.type.Files/utils.type.File/helper.m.type.File.xml': '<Info/>',
        'Root.type.ProjectPath/u1.type.Reference.xml': '<Info Ref=""/>',
        'Root.type.ProjectPath/u2.type.Reference.xml': '<Info Ref="utils"/>',
        'Root.type.EntryPoints/id-a.type.EntryPoint.xml': '<Info File="utils" Name="utils" Type="Basic"/>',
      }),
      'fallback',
    );
    expect(parsed.name).toBe('DistProj');
    expect(parsed.format).toBe('distributed');
    expect(parsed.warnings).toEqual([]);
    expect(parsed.files.map((f) => f.path)).toEqual(['top.m', 'utils', 'utils/helper.m']);
    expect(parsed.files.find((f) => f.path === 'utils')?.isFolder).toBe(true);
    expect(parsed.files.find((f) => f.path === 'top.m')?.labels).toEqual(['design']);
    expect(parsed.pathFolders).toEqual(['', 'utils']);
    expect(parsed.entryPoints.map((e) => e.file)).toEqual(['utils']);
  });

  it('finds a collection that has no def document of its own', () => {
    // `Root.type.Files/` exists as a directory with no `Root.type.Files.xml` beside
    // it — normal in this layout, not a loss — so entities must be discovered from
    // directory names and not only from documents.
    const parsed = parseProject(
      distStore({ 'Root.type.Files/only.m.type.File.xml': '<Info/>' }),
      'fallback',
    );
    expect(parsed.files.map((f) => f.path)).toEqual(['only.m']);
  });

  it('splits a location that contains the type marker itself', () => {
    // The separator is the LAST `.type.`: a project file may be NAMED `a.type.File`,
    // whose def is then `a.type.File.type.File.xml`. Splitting on the first
    // occurrence truncates the name to `a`.
    const parsed = parseProject(
      distStore({ 'Root.type.Files/a.type.File.type.File.xml': '<Info/>' }),
      'fallback',
    );
    expect(parsed.files.map((f) => f.path)).toEqual(['a.type.File']);
  });

  it('infers the layout when the manifest is missing', () => {
    const noManifest = {
      [at('ProjectData.type.Info.xml')]: info('<Info Name="Inferred"/>'),
      [at('Root.type.Files/f.m.type.File.xml')]: info('<Info/>'),
    };
    const parsed = parseProject(noManifest, 'fallback');
    expect(parsed.format).toBe('distributed');
    expect(parsed.name).toBe('Inferred');
    expect(parsed.files.map((f) => f.path)).toEqual(['f.m']);
  });
});

// The third layout, and the only one that is not a tree of files at all:
// `matlab.project.convertDefinitionFiles(root, "SingleFile")` collapses the whole
// content store into ONE `resources/project/Project.xml` whose root element is
// `<project MetadataType="monolithic">`. There are no pointer documents and no
// filename convention — the entity tree IS the element tree, where an element's tag
// is its type, its `Location` attribute is its location, and its `<Info>` child is
// its def. Before this layout was read, such a store indexed to nothing (every
// document in it is the one document, and its root is not `<Info>`), so a converted
// project reported "no readable project entries" and showed as empty.
describe('parseProject — the monolithic layout', () => {
  /** A monolithic store: one document, with `body` as the children of `<project>`. */
  function monoStore(body: string, declared = ' MetadataType="monolithic"'): Record<string, string> {
    return { [at('Project.xml')]: info(`<project${declared}>${body}</project>`) };
  }

  /** The example project's shape, trimmed to one of each thing it holds. */
  const MONO_BODY = `
    <Categories Location="Root">
      <Category Location="FileClassCategory">
        <Info DataType="None" Name="Classification" ReadOnly="1" SingleValued="1"/>
        <Label Location="design"><Info Name="Design" ReadOnly="READ_ONLY"/></Label>
        <Label Location="test"><Info Name="Test" ReadOnly="READ_ONLY"/></Label>
      </Category>
    </Categories>
    <EntryPointGroups Location="Root">
      <EntryPointGroup Location="g-1"><Info Name="Synth"/></EntryPointGroup>
    </EntryPointGroups>
    <EntryPoints Location="Root">
      <EntryPoint Location="ep-1">
        <Info File="utils/helper.m" GroupUUID="g-1" Name="helper" Type="Basic" Visible="1"/>
      </EntryPoint>
      <EntryPoint Location="ep-2">
        <Info File="ProjectScript/second.m" GroupUUID="default" Name="second" Type="StartUp" Visible="0">
          <Extension Name="StartUpPrev" Value="ep-3"/>
        </Info>
      </EntryPoint>
      <EntryPoint Location="ep-3">
        <Info File="ProjectScript/first.m" GroupUUID="default" Name="first" Type="StartUp" Visible="0">
          <Extension Name="StartUpPrev" Value="HEAD"/>
        </Info>
      </EntryPoint>
    </EntryPoints>
    <Files Location="ALM">
      <Info DigitalThread_ArtifactTracking="true"/>
      <DIR_SIGNIFIER Location="1"><Info/></DIR_SIGNIFIER>
    </Files>
    <Files Location="Root">
      <File Location="top.m">
        <Info><Category UUID="FileClassCategory"><Label UUID="design"/></Category></Info>
      </File>
      <File Location="utils">
        <DIR_SIGNIFIER Location="1"><Info/></DIR_SIGNIFIER>
        <File Location="helper.m">
          <Info><Category UUID="FileClassCategory"><Label UUID="test"/></Category></Info>
        </File>
      </File>
    </Files>
    <Info Location="ProjectData"><Info Name="MonoProj"/></Info>
    <ProjectPath Location="Root">
      <Reference Location="p-1"><Info Ref="" Type="Relative"/></Reference>
      <Reference Location="p-2"><Info Ref="utils" Type="Relative"/></Reference>
    </ProjectPath>
    <WorkingFolders Location="Root">
      <Reference Location="SimulinkCacheFolder"><Info Ref="Cache" Type="Relative"/></Reference>
    </WorkingFolders>`;

  it('reads a whole project out of one document', () => {
    const parsed = parseProject(monoStore(MONO_BODY), 'fallback');

    expect(parsed.format).toBe('monolithic');
    expect(parsed.warnings).toEqual([]);
    expect(parsed.name).toBe('MonoProj');
    expect(parsed.files.map((f) => f.path)).toEqual(['top.m', 'utils', 'utils/helper.m']);
    expect(parsed.pathFolders).toEqual(['', 'utils']);
    expect(parsed.workingFolders).toEqual([{ key: 'SimulinkCacheFolder', ref: 'Cache' }]);
    expect(parsed.entryPointGroups).toEqual([{ id: 'g-1', name: 'Synth' }]);
  });

  it('keeps the name entity apart from the project element it sits in', () => {
    // `<Info>` is TWO things in this layout: the def of every entity that has one,
    // AND the type of the entity holding the project's name. Only the `Location`
    // attribute separates them, so treating the first `<Info>` child as the def
    // would make `<Info Location="ProjectData">` the def of `<project>` itself and
    // leave the project titled by its filename.
    expect(parseProject(monoStore(MONO_BODY), 'fallback').name).toBe('MonoProj');
    // …and the def one level down is still read, which is where the name actually is.
    expect(parseProject(monoStore('<Info Location="ProjectData"/>'), 'fallback').name).toBe(
      'fallback',
    );
  });

  it('marks a folder from its DIR_SIGNIFIER and qualifies the paths beneath it', () => {
    const parsed = parseProject(monoStore(MONO_BODY), 'fallback');
    const byPath = new Map(parsed.files.map((f) => [f.path, f]));
    expect(byPath.get('utils')?.isFolder).toBe(true);
    expect(byPath.get('top.m')?.isFolder).toBe(false);
    // A File's `Location` is its basename relative to its PARENT, as in the other
    // two layouts, so a nested member's path has to be built from the walk.
    expect(byPath.get('utils/helper.m')?.labels).toEqual(['test']);
    expect(byPath.get('top.m')?.labels).toEqual(['design']);
  });

  it('reads the Root Files collection and ignores the ALM one beside it', () => {
    // The two-collections-of-one-type case is not hypothetical here: the example
    // project writes both, the ALM one FIRST, and it holds no members at all.
    const parsed = parseProject(monoStore(MONO_BODY), 'fallback');
    expect(parsed.files.map((f) => f.path)).toEqual(['top.m', 'utils', 'utils/helper.m']);
  });

  it('reads the label catalog and its category name', () => {
    const parsed = parseProject(monoStore(MONO_BODY), 'fallback');
    expect(parsed.labels).toEqual([
      { id: 'design', category: 'Classification', name: 'Design', readOnly: true },
      { id: 'test', category: 'Classification', name: 'Test', readOnly: true },
    ]);
  });

  it('puts the startup files in run order', () => {
    // The order lives only in the `<Extension StartUpPrev>` chain nested inside each
    // entry point's def — so this also pins that a def's own child elements survive
    // the walk rather than being mistaken for child entities.
    const parsed = parseProject(monoStore(MONO_BODY), 'fallback');
    expect(parsed.entryPoints.map((e) => e.name)).toEqual(['first', 'second', 'helper']);
    expect(parsed.entryPoints.find((e) => e.name === 'helper')?.groupId).toBe('g-1');
    // 'default' is the store's spelling for "no group", not a group called default.
    expect(parsed.entryPoints.find((e) => e.name === 'first')?.groupId).toBe('');
  });

  it('walks a document that declares no format at all', () => {
    // A `<project>` root is itself the statement that this store is one document,
    // which is the same reason `inferLayout` exists for the other two.
    const parsed = parseProject(monoStore(MONO_BODY, ''), 'fallback');
    expect(parsed.format).toBe('monolithic');
    expect(parsed.name).toBe('MonoProj');
    expect(parsed.files.map((f) => f.path)).toEqual(['top.m', 'utils', 'utils/helper.m']);
  });

  it('reports a single-document store whose declared format it cannot walk', () => {
    // Same rule as for the other layouts: a nesting convention we do not know would
    // read as a complete, empty project, so the declared name is reported instead.
    const parsed = parseProject(monoStore(MONO_BODY, ' MetadataType="monolithicV2"'), 'fallback');
    expect(parsed.format).toBe('');
    expect(parsed.files).toEqual([]);
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0].message).toContain('monolithicV2');
  });

  it('reads a real project reference out of its collection', () => {
    const parsed = parseProject(
      monoStore(
        '<ProjectReferences Location="Root">' +
          '<Reference Location="uuid-1"><Info Ref="../LibProj/LibProj.prj" Type="Relative"/></Reference>' +
          '</ProjectReferences>' +
          '<ProjectPath Location="Root">' +
          '<Reference Location="p-1"><Info Ref="utils" Type="Relative"/></Reference>' +
          '</ProjectPath>',
      ),
      'fallback',
    );
    expect(parsed.references).toEqual([
      { id: 'uuid-1', name: 'LibProj.prj', path: '../LibProj/LibProj.prj' },
    ]);
  });
});

// The three layouts are three ENCODINGS of one thing, and MATLAB converts a project
// between them in place (`matlab.project.convertDefinitionFiles`). So the invariant
// worth holding is not "each walker reads its own layout" — the tests above pin that,
// and all three can pass while the walkers disagree about the same project. It is
// that converting a project cannot change what the project IS.
//
// Checked once against MATLAB before it was written down: the example project
// (372 members, 89 folders, 197 labelled, 88 path folders, 7 labels, 14 entry points)
// converted to all three formats by R2027a parses to byte-identical results, `format`
// aside. This is that measurement reduced to a fixture small enough to read.
describe('parseProject — one project, three layouts', () => {
  /** One project: a folder with a labelled file in it, a path folder, a startup file. */
  const FIXED_PATH: Record<string, string> = {
    [at('Project.xml')]: info('<Info MetadataType="fixedPathV2"/>'),
    [at('root/namep.xml')]: info('<Info location="ProjectData" type="Info"/>'),
    [at('root/named.xml')]: info('<Info Name="Parity"/>'),
    [at('root/filesp.xml')]: info('<Info location="Root" type="Files"/>'),
    [at('root/pathp.xml')]: info('<Info location="Root" type="ProjectPath"/>'),
    [at('root/catsp.xml')]: info('<Info location="Root" type="Categories"/>'),
    [at('root/epsp.xml')]: info('<Info location="Root" type="EntryPoints"/>'),
    [at('root/wfp.xml')]: info('<Info location="Root" type="WorkingFolders"/>'),
    [at('files/utilsp.xml')]: info('<Info location="utils" type="File"/>'),
    [at('utils/dirp.xml')]: info('<Info location="1" type="DIR_SIGNIFIER"/>'),
    [at('utils/helperp.xml')]: info('<Info location="helper.m" type="File"/>'),
    [at('utils/helperd.xml')]: info(
      '<Info><Category UUID="FileClassCategory"><Label UUID="design"/></Category></Info>',
    ),
    [at('path/p1p.xml')]: info('<Info location="u-1" type="Reference"/>'),
    [at('path/p1d.xml')]: info('<Info Ref="utils" Type="Relative"/>'),
    [at('cats/fccp.xml')]: info('<Info location="FileClassCategory" type="Category"/>'),
    [at('cats/fccd.xml')]: info('<Info Name="Classification"/>'),
    [at('fcc/designp.xml')]: info('<Info location="design" type="Label"/>'),
    [at('fcc/designd.xml')]: info('<Info Name="Design" ReadOnly="READ_ONLY"/>'),
    [at('eps/s1p.xml')]: info('<Info location="e-1" type="EntryPoint"/>'),
    [at('eps/s1d.xml')]: info('<Info File="startup.m" Name="startup" Type="StartUp" Visible="0"/>'),
    [at('wf/c1p.xml')]: info('<Info location="SimulinkCacheFolder" type="Reference"/>'),
    [at('wf/c1d.xml')]: info('<Info Ref="Cache" Type="Relative"/>'),
  };

  const DISTRIBUTED: Record<string, string> = {
    [at('Project.xml')]: info('<Info MetadataType="distributed"/>'),
    [at('ProjectData.type.Info.xml')]: info('<Info Name="Parity"/>'),
    [at('Root.type.Files/utils.type.File/1.type.DIR_SIGNIFIER.xml')]: info('<Info/>'),
    [at('Root.type.Files/utils.type.File/helper.m.type.File.xml')]: info(
      '<Info><Category UUID="FileClassCategory"><Label UUID="design"/></Category></Info>',
    ),
    [at('Root.type.ProjectPath/u-1.type.Reference.xml')]: info('<Info Ref="utils" Type="Relative"/>'),
    [at('Root.type.Categories/FileClassCategory.type.Category.xml')]: info(
      '<Info Name="Classification"/>',
    ),
    [at('Root.type.Categories/FileClassCategory.type.Category/design.type.Label.xml')]: info(
      '<Info Name="Design" ReadOnly="READ_ONLY"/>',
    ),
    [at('Root.type.EntryPoints/e-1.type.EntryPoint.xml')]: info(
      '<Info File="startup.m" Name="startup" Type="StartUp" Visible="0"/>',
    ),
    [at('Root.type.WorkingFolders/SimulinkCacheFolder.type.Reference.xml')]: info(
      '<Info Ref="Cache" Type="Relative"/>',
    ),
  };

  const MONOLITHIC: Record<string, string> = {
    [at('Project.xml')]: info(
      '<project MetadataType="monolithic">' +
        '<Info Location="ProjectData"><Info Name="Parity"/></Info>' +
        '<Files Location="Root">' +
        '<File Location="utils">' +
        '<DIR_SIGNIFIER Location="1"><Info/></DIR_SIGNIFIER>' +
        '<File Location="helper.m">' +
        '<Info><Category UUID="FileClassCategory"><Label UUID="design"/></Category></Info>' +
        '</File>' +
        '</File>' +
        '</Files>' +
        '<ProjectPath Location="Root">' +
        '<Reference Location="u-1"><Info Ref="utils" Type="Relative"/></Reference>' +
        '</ProjectPath>' +
        '<Categories Location="Root">' +
        '<Category Location="FileClassCategory">' +
        '<Info Name="Classification"/>' +
        '<Label Location="design"><Info Name="Design" ReadOnly="READ_ONLY"/></Label>' +
        '</Category>' +
        '</Categories>' +
        '<EntryPoints Location="Root">' +
        '<EntryPoint Location="e-1">' +
        '<Info File="startup.m" Name="startup" Type="StartUp" Visible="0"/>' +
        '</EntryPoint>' +
        '</EntryPoints>' +
        '<WorkingFolders Location="Root">' +
        '<Reference Location="SimulinkCacheFolder"><Info Ref="Cache" Type="Relative"/></Reference>' +
        '</WorkingFolders>' +
        '</project>',
    ),
  };

  /** Everything the layout is not supposed to decide — i.e. all of it but `format`. */
  function project(store: Record<string, string>): Omit<ParsedProject, 'format'> {
    const { format: _format, ...rest } = parseProject(store, 'fallback');
    return rest;
  }

  it('reads one project the same way out of all three', () => {
    const fixed = project(FIXED_PATH);
    // Stated positively first: a parity assertion between two empty results passes,
    // so the thing being compared has to be known to hold the project.
    expect(fixed).toEqual({
      name: 'Parity',
      files: [
        { path: 'utils', isFolder: true, labels: [] },
        { path: 'utils/helper.m', isFolder: false, labels: ['design'] },
      ],
      pathFolders: ['utils'],
      labels: [{ id: 'design', category: 'Classification', name: 'Design', readOnly: true }],
      references: [],
      entryPoints: [
        {
          id: 'e-1',
          name: 'startup',
          file: 'startup.m',
          kind: 'StartUp',
          visible: false,
          groupId: '',
        },
      ],
      entryPointGroups: [],
      workingFolders: [{ key: 'SimulinkCacheFolder', ref: 'Cache' }],
      warnings: [],
    });
    expect(project(DISTRIBUTED)).toEqual(fixed);
    expect(project(MONOLITHIC)).toEqual(fixed);
  });

  it('reports which of the three it read', () => {
    expect(parseProject(FIXED_PATH, 'fallback').format).toBe('fixedPathV2');
    expect(parseProject(DISTRIBUTED, 'fallback').format).toBe('distributed');
    expect(parseProject(MONOLITHIC, 'fallback').format).toBe('monolithic');
  });
});

describe('parseProject — the declared metadata format', () => {
  it('reports the format it read', () => {
    expect(parseProject(myProjStore(), 'fallback').format).toBe('fixedPathV2');
  });

  it('warns and reads nothing for a layout it cannot walk, keeping the name', () => {
    // Guessing is the one thing not to do here: the collection readers would find
    // nothing in an unknown layout and return a project that looks complete and
    // empty — the single outcome a user cannot tell apart from a fact about their
    // project. The name is still salvaged, since it titles the view.
    const parsed = parseProject(
      {
        [at('Project.xml')]: info('<Info MetadataType="fixedPathV3"/>'),
        [at('ProjectData.type.Info.xml')]: info('<Info Name="Mono"/>'),
      },
      'fallback',
    );
    expect(parsed.name).toBe('Mono');
    expect(parsed.format).toBe('');
    expect(parsed.files).toEqual([]);
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0].code).toBe('source-empty');
    expect(parsed.warnings[0].message).toContain('fixedPathV3');
  });

  it('will not read a store that declares monolithic and holds no such document', () => {
    // `monolithic` is a layout this reader walks, but only the document it names:
    // the declaration alone is not one, and reading the sidecar index instead would
    // walk the store under a layout it has just said it is not in.
    const parsed = parseProject(
      {
        [at('Project.xml')]: info('<Info MetadataType="monolithic"/>'),
        [at('ProjectData.type.Info.xml')]: info('<Info Name="Mono"/>'),
      },
      'fallback',
    );
    expect(parsed.name).toBe('Mono');
    expect(parsed.format).toBe('');
    expect(parsed.files).toEqual([]);
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0].code).toBe('source-empty');
  });

  it('names matlab.toml rather than reporting an empty store', () => {
    // A toml store holds no XML at all, so it lands in the same place as a store
    // that did not survive its trip. It is not damaged, and a user told "nothing
    // readable" would go looking for a corrupt file that does not exist.
    const parsed = parseProject({ 'resources/project/matlab.toml': '[project]\nname = "T"\n' }, 'TomlProj');
    expect(parsed.name).toBe('TomlProj');
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0].code).toBe('source-empty');
    expect(parsed.warnings[0].message).toContain('matlab.toml');
    expect(parsed.warnings[0].part).toBe('resources/project/matlab.toml');
  });
});
