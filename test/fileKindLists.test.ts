// Copyright 2026 The MathWorks, Inc.
//
// The file-kind LISTS, pinned against the file-kind TESTS they enumerate.
//
// The two are halves of one rule, and they are not independent:
//   - in the list, in none of the kind tests → discovered, then classified as nothing
//   - in a kind test, absent from the list   → never discovered at all
// Neither half can see the other, so this file is where their agreement is checked, in
// BOTH directions. The lists came here from the vscode host (src/common/fileTypes.ts),
// which kept them beside its globs; the cases below are the ones it pinned them with,
// minus the globs, which stay with the host that speaks that dialect.
//
// R2026b added a format identified by NAME rather than by extension — `matlab.toml`, the
// whole definition of a project in one file — so the list is two lists and every pin comes
// in two halves. The name half carries a hazard the extension half does not: `.toml` as an
// EXTENSION would admit every `Cargo.toml` and `pyproject.toml` in a workspace as a MATLAB
// project, so the exclusion is pinned as hard as the inclusion.
import { describe, it, expect } from 'vitest';
import {
  createSession,
  ingest,
  isMatFile,
  isModelFile,
  isProjectFile,
  isSlddFile,
  isTomlProjectFile,
  TOML_PROJECT_FILE,
  MODEL_EXTS,
  SUPPORTED_EXTS,
  SUPPORTED_NAMES,
  GRAPH_EXTS,
  isSupportedPath,
  isGraphPath,
} from '../src/index.js';

describe('the shared extension list', () => {
  it('treats .mdl as a model alongside .slx', () => {
    expect([...MODEL_EXTS]).toEqual(['slx', 'mdl']);
  });

  it('includes both model containers in the supported and graph lists', () => {
    for (const ext of MODEL_EXTS) {
      expect(SUPPORTED_EXTS, `${ext} must be a supported format`).toContain(ext);
      expect(GRAPH_EXTS, `${ext} must participate in the usage graph`).toContain(ext);
    }
  });

  it('keeps .prj out of the graph list, since it defines no variables', () => {
    expect(SUPPORTED_EXTS).toContain('prj');
    expect(GRAPH_EXTS).not.toContain('prj');
  });

  it('carries the named project marker, and never as an extension', () => {
    // The hazard, pinned from both sides. In the name list, so a TOML-format project is
    // discovered at all; absent from SUPPORTED_EXTS, so a `.toml` suffix admits nothing —
    // the one-word edit that would make `Cargo.toml` a MATLAB project is adding it there.
    expect([...SUPPORTED_NAMES]).toEqual([TOML_PROJECT_FILE]);
    expect(SUPPORTED_EXTS as readonly string[]).not.toContain('toml');
    // Not in the graph list either: a project defines no variables and no parameter
    // usages, in any of its formats.
    expect(GRAPH_EXTS as readonly string[]).not.toContain('toml');
  });

  it('spells each extension bare and lower-case, ready for a host to put in a glob', () => {
    // The lists are the input to every host's own spelling — a `**/*.{…}` glob, an Open
    // dialog's filter, a manifest selector — and each of those wants the extension with no
    // dot and nothing to escape. One host writing `.SLX` here would make the others' globs
    // case-dependent in a way the kind tests are not.
    for (const ext of [...SUPPORTED_EXTS, ...GRAPH_EXTS]) {
      expect(ext, `${ext} is a bare lower-case extension`).toMatch(/^[a-z0-9]+$/);
    }
    expect(new Set(SUPPORTED_EXTS).size, 'no extension listed twice').toBe(SUPPORTED_EXTS.length);
    // And the graph list is a SUBSET: a graph reads only files a host discovers at all.
    for (const ext of GRAPH_EXTS) expect(SUPPORTED_EXTS).toContain(ext);
  });
});

// The seam. Every listed extension is claimed by exactly one kind test, and every kind
// test's extension is listed — written out by hand, because adding a format to
// SUPPORTED_EXTS without saying which test claims it must fail HERE, where the answer is
// cheap, rather than as a file that appears in a host's tree and then renders as nothing.
const KINDS: ReadonlyArray<readonly [string, string, (p: string) => boolean]> = [
  ['sldd', 'dictionary', isSlddFile],
  ['mat', 'MAT-file', isMatFile],
  ['prj', 'project', isProjectFile],
  ['slx', 'model', isModelFile],
  ['mdl', 'model', isModelFile],
];

describe('the list and the kind tests agree', () => {
  it('names a kind test for every supported extension, and no extension a test alone knows', () => {
    expect([...new Set(KINDS.map(([ext]) => ext))].sort()).toEqual([...SUPPORTED_EXTS].sort());
  });

  it('classifies every supported extension as exactly its own kind', () => {
    for (const [ext, kind, test] of KINDS) {
      expect(test(`/w/thing.${ext}`), `.${ext} must be a ${kind}`).toBe(true);
      for (const [otherExt, otherKind, otherTest] of KINDS) {
        if (otherKind === kind) continue;
        expect(otherTest(`/w/thing.${ext}`), `.${ext} is not a ${otherKind}`).toBe(false);
        expect(test(`/w/thing.${otherExt}`), `.${otherExt} is not a ${kind}`).toBe(false);
      }
    }
  });

  it('classifies an upper-cased name, which is why the tests are shared', () => {
    // `Params.SLDD` is found by any case-insensitive glob built from the list, so a
    // classifier stricter than the glob accepts the file and then does nothing with it.
    for (const [ext, kind, test] of KINDS) {
      expect(test(`/w/Thing.${ext.toUpperCase()}`), `.${ext.toUpperCase()} must be a ${kind}`).toBe(true);
    }
  });

  it('anchors at the end, so a glob built from the list and the kind tests admit the same files', () => {
    // `**/*.{...}` matches the end of the name only; a kind test that did not would
    // classify files discovery never offers.
    expect(isSlddFile('/w/params.slddx')).toBe(false);
    expect(isMatFile('/w/notes.material')).toBe(false);
    expect(isModelFile('/w/model.mdl.bak')).toBe(false);
    expect(isSupportedPath('/w/slx/readme.txt')).toBe(false);
  });
});

// The same seam for the half of the list identified by NAME. One row, and a table anyway,
// so that the next marker is a line here rather than a second way of asking the question.
const NAME_KINDS: ReadonlyArray<readonly [string, string, (p: string) => boolean]> = [
  [TOML_PROJECT_FILE, 'project', isTomlProjectFile],
];

describe('the named markers and the kind tests agree', () => {
  it('names a kind test for every supported name, and no name a test alone knows', () => {
    expect(NAME_KINDS.map(([name]) => name).sort()).toEqual([...SUPPORTED_NAMES].sort());
  });

  it('classifies a marker found by name as a project, in any case', () => {
    for (const [name, kind, test] of NAME_KINDS) {
      // The PATH, because a name marker is only a marker in a folder: `isTomlProjectFile`
      // compares basenames, and a host listing a folder holds paths, not bare names.
      expect(test(`/w/MyProj/${name}`), `${name} must be a ${kind} definition`).toBe(true);
      expect(isProjectFile(`/w/MyProj/${name}`), `${name} must be a ${kind}`).toBe(true);
      expect(isProjectFile(`/w/MyProj/${name.toUpperCase()}`), `${name} is case-insensitive`).toBe(true);
      // Not any other kind: the marker reaching the dictionary or model readers would be a
      // text file handed to a zip parser.
      for (const other of [isSlddFile, isMatFile, isModelFile]) {
        expect(other(`/w/MyProj/${name}`), `${name} is a ${kind} and nothing else`).toBe(false);
      }
    }
  });

  it('claims no other .toml in the workspace, which is why this is a NAME', () => {
    for (const stray of ['/w/Cargo.toml', '/w/pyproject.toml', '/w/ruff.toml', '/w/matlab.toml.bak']) {
      expect(isProjectFile(stray), `${stray} must not be a project`).toBe(false);
      expect(isSupportedPath(stray), `${stray} must not be supported`).toBe(false);
    }
    // A folder NAMED matlab.toml is not one either — the test is the last segment of a
    // path, and a directory never reaches these predicates as one.
    expect(isProjectFile('/w/matlab.toml/readme.md')).toBe(false);
  });
});

describe('the two routing questions', () => {
  it('supports precisely the extensions in the supported list', () => {
    for (const ext of SUPPORTED_EXTS) {
      expect(isSupportedPath(`/w/thing.${ext}`), `.${ext} must be supported`).toBe(true);
      expect(isSupportedPath(`/w/Thing.${ext.toUpperCase()}`), `.${ext} must be case-insensitive`).toBe(true);
    }
    expect(isSupportedPath('/w/notes.txt')).toBe(false);
    expect(isSupportedPath('/w/archive.zip')).toBe(false);
  });

  it('supports every name in the name list, in any case', () => {
    for (const name of SUPPORTED_NAMES) {
      expect(isSupportedPath(`/w/MyProj/${name}`), `${name} must be supported`).toBe(true);
      expect(isSupportedPath(`/w/MyProj/${name.toUpperCase()}`), `${name} must be case-insensitive`).toBe(true);
    }
  });

  it('admits precisely the graph list to the usage and name graphs', () => {
    for (const ext of GRAPH_EXTS) {
      expect(isGraphPath(`/w/thing.${ext}`), `.${ext} must participate`).toBe(true);
      expect(isGraphPath(`/w/Thing.${ext.toUpperCase()}`), `.${ext} must be case-insensitive`).toBe(true);
    }
    // The one difference between the two questions, and the reason there are two: a
    // project is opened but contributes no variables and no parameter usages — in EVERY
    // format, which is why the named marker is tested here beside the `.prj`.
    expect(isGraphPath('/w/proj.prj')).toBe(false);
    expect(isSupportedPath('/w/proj.prj')).toBe(true);
    for (const name of SUPPORTED_NAMES) {
      expect(isGraphPath(`/w/MyProj/${name}`), `${name} is not a graph participant`).toBe(false);
    }
    for (const ext of SUPPORTED_EXTS) {
      if (GRAPH_EXTS.includes(ext as never)) continue;
      expect(isGraphPath(`/w/thing.${ext}`), `.${ext} is not a graph participant`).toBe(false);
    }
  });

  it('takes a Windows path as readily as a POSIX one', () => {
    // A host on Windows lists `C:\work\Params.SLDD`; the kind tests read the extension
    // and the basename on either separator, and these unions inherit that.
    expect(isSupportedPath('C:\\work\\Params.SLDD')).toBe(true);
    expect(isSupportedPath('C:\\work\\MyProj\\matlab.toml')).toBe(true);
    expect(isGraphPath('C:\\work\\Engine.MDL')).toBe(true);
    expect(isGraphPath('C:\\work\\MyProj\\matlab.toml')).toBe(false);
  });
});

// The agreement this package can check and a host cannot: the list against what `ingest`
// actually DISPATCHES. A format on the list that ingest refuses would be offered by every
// host and then fail to open; one ingest takes that is off the list would open from a
// drop and never be found in a folder.
describe('the list and ingest agree', () => {
  // True when ingest refused the NAME — not when it took the name and then failed on the
  // placeholder bytes, which is a different question (and the expected answer for most of
  // the formats here, since four zero bytes are no file at all).
  const refusesName = (filename: string): boolean => {
    try {
      ingest(createSession(), new Uint8Array(4), { filename });
      return false;
    } catch (error) {
      return /unsupported extension/.test(String((error as Error).message));
    }
  };

  it('dispatches every supported extension and name, in either case', () => {
    for (const ext of SUPPORTED_EXTS) {
      expect(refusesName(`thing.${ext}`), `ingest must take .${ext}`).toBe(false);
      expect(refusesName(`Thing.${ext.toUpperCase()}`), `ingest must take .${ext.toUpperCase()}`).toBe(false);
    }
    for (const name of SUPPORTED_NAMES) {
      expect(refusesName(`MyProj/${name}`), `ingest must take ${name}`).toBe(false);
    }
  });

  it('refuses exactly the names isSupportedPath refuses', () => {
    const samples = [
      'notes.txt',
      'archive.zip',
      'Cargo.toml',
      'pyproject.toml',
      'matlab.toml.bak',
      'params.slddx',
      'model.mdl.bak',
      'README',
      'thing.sldd',
      'Thing.MAT',
      'work.prj',
      'MyProj/matlab.toml',
    ];
    for (const name of samples) {
      expect(refusesName(name), `ingest and isSupportedPath disagree about ${name}`).toBe(!isSupportedPath(name));
    }
  });
});
