// Copyright 2026 The MathWorks, Inc.
//
// One function, four project formats, ONE shape out — and the branch that decides which of
// the two things on disk to read.
//
// `readProjectStore` is the whole of what a host needs to know about where a project's definition
// lives. Until R2026b that was a single rule (walk `resources/project/` beside the `.prj`),
// and `matlab.project.DefinitionFiles.Toml` makes it two: that format puts the entire
// definition in one `matlab.toml` at the project root and DELETES both `resources/` and the
// `.prj` marker, so there is no store to walk at all. Both answers are a relpath -> text map
// because the map is the interface `parseProject` dispatches on — it runs the TOML reader when
// it finds a `matlab.toml` entry among the keys — which is why the key is as much the contract
// here as the content is, and why the last tests below hand the real map to the real parser
// rather than trusting that the key "looks right".
//
// Over a REAL directory tree in a temp dir, for the reason the vscode extension's copy of these
// tests gave (they came here with the walk): what is being checked is a walk of a filesystem and
// a read of a file, and a hand-written map of what the walk "would have" returned asserts against
// this test's own idea of the layout. Every case runs twice — through `readProjectStore` over a
// plain `StoreFs` written below, and through the ./node entry's `readProjectStoreFromDisk` — so
// the walk and the adapter a Node host uses are both held to it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseProject,
  projectFallbackName,
  readProjectStore,
  TOML_PROJECT_FILE,
  type StoreFs,
} from '../src/index.js';
import { readProjectStoreFromDisk } from '../src/node/index.js';

/**
 * The plainest `StoreFs` there is: `node:fs`, an entry typed by what `readdir` says it is, and a
 * throw for anything absent. The walk owns everything else.
 */
const plainFs: StoreFs = {
  readText: async (path) => new TextDecoder().decode(readFileSync(path)),
  list: async (path) =>
    readdirSync(path, { withFileTypes: true }).map((e) => ({
      name: e.name,
      type: e.isDirectory() ? 'directory' : e.isFile() ? 'file' : 'other',
    })),
};

const ROUTES: ReadonlyArray<readonly [string, (marker: string) => Promise<Record<string, string>>]> = [
  ['readProjectStore over a StoreFs', (marker) => readProjectStore(marker, plainFs)],
  ['readProjectStoreFromDisk', (marker) => readProjectStoreFromDisk(marker)],
];

let tmpRoot: string;

// <tmp>/XmlProj/                       the long-standing format: marker + store
//   XmlProj.prj
//   resources/project/root/pointer.xml
//   resources/project/Root.XML          upper-cased, deliberately (see the test)
//   resources/project/notes.txt         not a store document
// <tmp>/TomlProj/                      R2026b: ONE file, no marker, no resources/
//   matlab.toml
// <tmp>/HalfConverted/                 both, which is a conversion left unfinished
//   HalfConverted.prj
//   matlab.toml
//   resources/project/root/pointer.xml
// <tmp>/ShoutingProj/MATLAB.TOML       the name as a case-insensitive filesystem may spell it
const TOML_TEXT = [
  '# A definition that records no name, which is the case the fallback exists for.',
  'folders = ["src"]',
  '',
  '[project]',
  'description = "read by the TOML reader, not by ProjectParser"',
  '',
].join('\n');

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'dex-projectstore-unit-'));

  const xml = join(tmpRoot, 'XmlProj');
  mkdirSync(join(xml, 'resources', 'project', 'root'), { recursive: true });
  writeFileSync(join(xml, 'XmlProj.prj'), 'PK');
  writeFileSync(join(xml, 'resources', 'project', 'root', 'pointer.xml'), '<pointer/>');
  writeFileSync(join(xml, 'resources', 'project', 'Root.XML'), '<shouted/>');
  writeFileSync(join(xml, 'resources', 'project', 'notes.txt'), 'not a store document');

  const toml = join(tmpRoot, 'TomlProj');
  mkdirSync(toml, { recursive: true });
  writeFileSync(join(toml, TOML_PROJECT_FILE), TOML_TEXT);

  const half = join(tmpRoot, 'HalfConverted');
  mkdirSync(join(half, 'resources', 'project', 'root'), { recursive: true });
  writeFileSync(join(half, 'HalfConverted.prj'), 'PK');
  writeFileSync(join(half, TOML_PROJECT_FILE), TOML_TEXT);
  writeFileSync(join(half, 'resources', 'project', 'root', 'pointer.xml'), '<pointer/>');

  const shouting = join(tmpRoot, 'ShoutingProj');
  mkdirSync(shouting, { recursive: true });
  writeFileSync(join(shouting, 'MATLAB.TOML'), TOML_TEXT);
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe.each(ROUTES)('%s', (_route, readStore) => {
  describe('a .prj reads its resources/project store, exactly as before', () => {
    it('keys every store document by its POSIX path relative to the project ROOT', async () => {
      const files = await readStore(join(tmpRoot, 'XmlProj', 'XmlProj.prj'));
      // The keys are what ProjectParser matches on — it only reads entries under
      // "resources/project/" — so they are the contract, not an implementation detail.
      expect(Object.keys(files).sort()).toEqual([
        'resources/project/Root.XML',
        'resources/project/root/pointer.xml',
      ]);
      expect(files['resources/project/root/pointer.xml']).toBe('<pointer/>');
    });

    it('reads an upper-cased store document and skips a non-document', async () => {
      const files = await readStore(join(tmpRoot, 'XmlProj', 'XmlProj.prj'));
      // `.XML` because these names come off a case-insensitive filesystem; `notes.txt` because
      // `.xml` is a part name inside the store, not everything that can sit in the folder.
      expect(files['resources/project/Root.XML']).toBe('<shouted/>');
      expect(Object.keys(files)).not.toContain('resources/project/notes.txt');
    });

    it('answers an empty map for a store that is not there, rather than throwing', async () => {
      // Normal, not exceptional: `parseProject` turns an empty map into an empty project that
      // says so in its warnings, which is what puts an unreachable store on the page instead of
      // behind a throw.
      const files = await readStore(join(tmpRoot, 'Nowhere', 'Nowhere.prj'));
      expect(files).toEqual({});
    });
  });

  describe('a matlab.toml IS the definition', () => {
    it('returns exactly one entry, keyed by the name parseProject dispatches on', async () => {
      const files = await readStore(join(tmpRoot, 'TomlProj', TOML_PROJECT_FILE));
      expect(Object.keys(files)).toEqual([TOML_PROJECT_FILE]);
      expect(files[TOML_PROJECT_FILE]).toBe(TOML_TEXT);
    });

    it('walks no store, since the format deletes the one a .prj has', async () => {
      // The discrimination that matters: the branch is taken on the MARKER's name, not on
      // whether a store happens to be reachable. Read through the `matlab.toml` of a root that
      // ALSO still has a `resources/project/` tree — a conversion left unfinished — and the
      // store is absent from the answer, so the TOML reader is what `parseProject` will run.
      const files = await readStore(join(tmpRoot, 'HalfConverted', TOML_PROJECT_FILE));
      expect(Object.keys(files)).toEqual([TOML_PROJECT_FILE]);
    });

    it('keys by the constant even when the filesystem spells the name differently', async () => {
      // `MATLAB.TOML` is the same file on macOS and Windows, and the kind test that admitted it
      // is case-insensitive for that reason. `parseProject` matches the entry by basename, so
      // either spelling would be read — but the map a host hands over should carry the one
      // spelling there is, not whatever case the disk had.
      const files = await readStore(join(tmpRoot, 'ShoutingProj', 'MATLAB.TOML'));
      expect(Object.keys(files)).toEqual([TOML_PROJECT_FILE]);
    });

    it('answers an empty map for a marker that is gone', async () => {
      // The window between a glob and a read is real — a `findFiles` result can be deleted
      // before the tree gets to it — and the answer is the same empty map a missing store gives.
      const files = await readStore(join(tmpRoot, 'Nowhere', TOML_PROJECT_FILE));
      expect(files).toEqual({});
    });
  });

  // The seam: the key is chosen by the walk and dispatched on by `parseProject`, and those are
  // two modules. test/tomlProject.test.ts covers the TOML reader over its text; what is pinned
  // here is that the map the walk builds is a map that reaches that reader at all.
  describe('the map reaches the TOML reader', () => {
    it('parses as the TOML format, named after the project FOLDER', async () => {
      const path = join(tmpRoot, 'TomlProj', TOML_PROJECT_FILE);
      const parsed = parseProject(await readStore(path), projectFallbackName(path));
      expect(parsed.format).toBe('toml');
      // The definition above records no name, so the fallback is what titles the page — and for
      // this format the fallback is the parent folder, because the file is called `matlab.toml`
      // in every project that has one.
      expect(parsed.name).toBe('TomlProj');
    });

    it('parses the half-converted root’s .prj through ProjectParser, not the TOML reader', async () => {
      // The same root, read through the other marker: the store map carries no `matlab.toml`
      // key, so `parseProject` walks the XML layout. This is what "the .prj branch is bit-for-bit
      // what it was" means in terms `parseProject` can be asked about.
      const path = join(tmpRoot, 'HalfConverted', 'HalfConverted.prj');
      const files = await readStore(path);
      expect(Object.keys(files)).toEqual(['resources/project/root/pointer.xml']);
      expect(files[TOML_PROJECT_FILE]).toBeUndefined();
      expect(parseProject(files, projectFallbackName(path)).format).not.toBe('toml');
    });
  });
});

// What the walk owes any host, whatever filesystem it brings — asserted over a StoreFs that
// records what it was asked, and over the ./node adapter on a tree only a real disk can hold.
describe('the walk, over whatever filesystem a host supplies', () => {
  it('answers an empty map, never a throw, when every read fails', async () => {
    // The contract `parseProject` relies on to put an unreachable store ON the page: a host's
    // filesystem is allowed to throw for anything absent, and the walk turns that into "nothing
    // there" for both formats.
    const failing: StoreFs = {
      readText: async () => {
        throw new Error('EACCES');
      },
      list: async () => {
        throw new Error('ENOENT');
      },
    };
    expect(await readProjectStore('/w/P/P.prj', failing)).toEqual({});
    expect(await readProjectStore(`/w/P/${TOML_PROJECT_FILE}`, failing)).toEqual({});
  });

  it('skips a store document it cannot read, and keeps the rest', async () => {
    const fs: StoreFs = {
      readText: async (path) => {
        if (path.endsWith('locked.xml')) throw new Error('EACCES');
        return `<${path.split('/').pop()}/>`;
      },
      list: async () => [
        { name: 'locked.xml', type: 'file' },
        { name: 'open.xml', type: 'file' },
        // An entry the host could not type (a dangling link) is neither walked nor read, even
        // when its name says store document.
        { name: 'dangling.xml', type: 'other' },
      ],
    };
    expect(await readProjectStore('/w/P/P.prj', fs)).toEqual({ 'resources/project/open.xml': '<open.xml/>' });
  });

  it('finds the store beside a marker named on either separator', async () => {
    // A Windows host hands over `C:\w\P\P.prj`. The walk joins with `/`, which every filesystem
    // API a host has accepts, but the PARENT must be found on either separator.
    const asked: string[] = [];
    const fs: StoreFs = {
      readText: async () => '',
      list: async (path) => {
        asked.push(path);
        return [];
      },
    };
    await readProjectStore('C:\\w\\P\\P.prj', fs);
    await readProjectStore('/w/Q/Q.prj', fs);
    expect(asked).toEqual(['C:\\w\\P/resources/project', '/w/Q/resources/project']);
  });

  describe('the ./node adapter', () => {
    let root: string;
    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), 'dex-projectstore-links-'));
      // A store whose `root/` directory and one document are symbolic links — the layout a
      // project checked out through a link farm has, and the one a type test by EQUALITY skips
      // in silence (see StoreEntry). Plus a dangling link, which must be skipped, not thrown.
      const real = join(root, 'real');
      mkdirSync(join(real, 'root'), { recursive: true });
      writeFileSync(join(real, 'root', 'pointer.xml'), '<pointer/>');
      writeFileSync(join(real, 'shared.xml'), '<shared/>');
      const store = join(root, 'Linked', 'resources', 'project');
      mkdirSync(store, { recursive: true });
      writeFileSync(join(root, 'Linked', 'Linked.prj'), 'PK');
      symlinkSync(join(real, 'root'), join(store, 'root'));
      symlinkSync(join(real, 'shared.xml'), join(store, 'Shared.xml'));
      symlinkSync(join(root, 'nowhere.xml'), join(store, 'dangling.xml'));
      writeFileSync(join(store, 'b.xml'), '<b/>');
      writeFileSync(join(store, 'a.xml'), '<a/>');
    });
    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it('follows a linked directory and a linked document, and skips a dangling link', async () => {
      const files = await readProjectStoreFromDisk(join(root, 'Linked', 'Linked.prj'));
      expect(files['resources/project/root/pointer.xml']).toBe('<pointer/>');
      expect(files['resources/project/Shared.xml']).toBe('<shared/>');
      expect(Object.keys(files)).not.toContain('resources/project/dangling.xml');
    });

    it('hands the map back in key order, whatever order the disk listed it in', async () => {
      const files = await readProjectStoreFromDisk(join(root, 'Linked', 'Linked.prj'));
      expect(Object.keys(files)).toEqual([
        'resources/project/Shared.xml',
        'resources/project/a.xml',
        'resources/project/b.xml',
        'resources/project/root/pointer.xml',
      ]);
    });
  });
});
