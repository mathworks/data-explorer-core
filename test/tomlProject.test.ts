// Copyright 2026 The MathWorks, Inc.
//
// The fourth project definition-file format: one hand-editable `matlab.toml` at the
// project root, with no `resources/` store and no `.prj` marker behind it.
//
// TWO SOURCES OF INPUT, and the split is the rule rather than a preference:
//
//   - THE PARITY FIXTURE for every assertion of the form "this is what MATLAB writes".
//     `test/parity/artifacts/project/Toml/parityProject/matlab.toml` was written by
//     `matlab.project.convertDefinitionFiles` and is committed; test/parity/matlab/README.md
//     says never to write an expected value by hand when MATLAB can be asked for it, and
//     hand-typed TOML standing in for MATLAB's own output is exactly the mistake that
//     cost the XML reader three wrong expectations (see project.parity.test.ts).
//
//   - INLINE DOCUMENTS for everything MATLAB would not write but a person will, because
//     hand editing is the whole point of this format: comments, a `#` inside a string,
//     literal strings, dotted keys, a single string where MATLAB writes an array, a
//     number where a path belongs, a document that will not parse at all. None of that
//     can be harvested — MATLAB does not emit it — so it is typed here, and it is typed
//     here ONLY for shapes the fixture cannot carry.
//
// What the cases below are chosen to pin is the set of decisions TomlProject.ts singles
// out in its comments as the ones a future maintainer would "fix" by accident: `files:
// []` is the FORMAT and not a parse failure, the ids are synthetic, the label catalog is
// in file order where the XML one is sorted, a bare string under `[dependencies]` is a
// package version and is skipped in SILENCE, and a shortcut with no resolvable path is
// still a shortcut the project declared.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseTomlProject } from '../src/datamodel/parser/TomlProject.js';
import { parseProject } from '../src/datamodel/parser/ProjectParser.js';
import type { ParsedProject } from '../src/datamodel/parser/ProjectParser.js';

/** What MATLAB wrote, converting the parity project into this format. */
const FIXTURE = readFileSync(
  fileURLToPath(
    new URL('./parity/artifacts/project/Toml/parityProject/matlab.toml', import.meta.url),
  ),
  'utf8',
);

// A name no document here records, so every assertion on `name` is about what the
// document said and not about what was passed in.
const FALLBACK = 'not-the-project-name';

const read = (text: string): ParsedProject => parseTomlProject(text, FALLBACK);

/** The one line `lines` makes, which is how a TOML document is written. */
const doc = (...lines: string[]): string => lines.join('\n');

/** The files of the entry points of one kind, in the order they were read. */
const filesOf = (parsed: ParsedProject, kind: string): string[] =>
  parsed.entryPoints.filter((e) => e.kind === kind).map((e) => e.file);

describe('matlab.toml, as MATLAB writes it', () => {
  const parsed = read(FIXTURE);

  it('names itself from the document, and reports the format it was dispatched as', () => {
    expect(parsed.name).toBe('parityProject');
    expect(parsed.name).not.toBe(FALLBACK);
    expect(parsed.format).toBe('toml');
    expect(parsed.warnings).toEqual([]);
  });

  it('enumerates no members, which is the FORMAT and not a failed parse', () => {
    // The distinction `membersEnumerated` exists for. MATLAB's rule is that the files in
    // the project root ARE the members, which is a statement about the filesystem and
    // not a list in this document — so "0 members" is a sentence this reader is not
    // entitled to say, and a maintainer who read `files: []` as an oversight and walked
    // the project folder would be inventing a list MATLAB does not have.
    expect(parsed.files).toEqual([]);
    expect(parsed.membersEnumerated).toBe(false);
    // And it is not for want of content: everything else in the document was read.
    expect(parsed.pathFolders).toEqual(['utils']);
  });

  it('puts the startup, shutdown and shortcut entries in run order, named by file stem', () => {
    // The whole collection, ids included, because the ids are the one field here with no
    // counterpart in an XML store: that layout carries MATLAB's own UUID per entry point
    // and this format carries none, so these are built from the kind and the file to be
    // unique within one parse. Nothing may persist one as a handle — renaming
    // startup_one.m changes its id, where in an XML store it would not.
    expect(parsed.entryPoints).toEqual([
      {
        id: 'StartUp:startup_one.m',
        name: 'startup_one',
        file: 'startup_one.m',
        kind: 'StartUp',
        visible: false,
        groupId: '',
      },
      {
        id: 'StartUp:startup_two.m',
        name: 'startup_two',
        file: 'startup_two.m',
        kind: 'StartUp',
        visible: false,
        groupId: '',
      },
      {
        id: 'Shutdown:shutdown_parity.m',
        name: 'shutdown_parity',
        file: 'shutdown_parity.m',
        kind: 'Shutdown',
        visible: false,
        groupId: '',
      },
      { id: 'Basic:main', name: 'main', file: 'main.m', kind: 'Basic', visible: true, groupId: '' },
    ]);
    // Hidden hooks, shown shortcuts: MATLAB's Shortcuts gallery holds the latter only.
    for (const e of parsed.entryPoints) {
      expect(e.visible, e.name).toBe(e.kind === 'Basic');
    }
  });

  it('has no entry-point groups, because the format has nowhere to name one', () => {
    // Not an empty gallery: every shortcut sits under one `[project.shortcuts]` table,
    // so the XML store's EntryPointGroups has no equivalent to be empty OF.
    expect(parsed.entryPointGroups).toEqual([]);
  });

  it('designates the working folders under the keys the XML store uses, in that order', () => {
    // The STORE's spelling, not the document's: `ProjectWorkingFolder.key` is documented
    // as the raw purpose name and hosts match on it, so a format that spells the cache
    // folder `cache-folder` must not hand a host a second name for one purpose. The order
    // is the one `parseProject` sorts its own into, which is what lets the parity suite
    // compare the two parses array-to-array.
    expect(parsed.workingFolders).toEqual([
      { key: 'ProjectStartupFolder', ref: 'utils' },
      { key: 'SimulinkCacheFolder', ref: 'cache' },
      { key: 'SimulinkCodeGenFolder', ref: 'codegen' },
    ]);
  });

  it('reads the dependency as a reference, keyed by the name MATLAB shows', () => {
    // The key is both id and name, where an XML store carries a UUID and a basename: it
    // is the only identity the format records, and a dependency is referred to by its
    // key rather than by the folder it resolves to.
    expect(parsed.references).toEqual([
      { id: 'parityLib', name: 'parityLib', path: '../parityLib' },
    ]);
  });

  it('keeps the files each label was declared against, which no XML layout can', () => {
    // The inversion that `declaredFiles` exists for. A store assigns labels per member
    // file, so its catalog entry has nothing to point back at; here the label declares
    // its files and the format records no member list for them to have been declared on,
    // which makes this the only place those paths can live.
    expect(parsed.labels).toEqual([
      {
        id: 'Review/Checked',
        category: 'Review',
        name: 'Checked',
        readOnly: false,
        declaredFiles: ['utils/helper.m'],
      },
    ]);
  });

  it('owns every label it defines, because the format records no ownership', () => {
    // `readOnly: false` is not a reading of an attribute. MATLAB's conversion into this
    // format drops the whole built-in read-only `Classification` category — the parity
    // corpus measures that, and MATLAB raises `LabelDataLoss` saying so — so every label
    // a document in this format can carry is one the project itself declared.
    expect(parsed.labels.every((l) => !l.readOnly)).toBe(true);
    expect(parsed.labels.map((l) => l.category)).not.toContain('Classification');
  });
});

describe('matlab.toml, as a person edits it', () => {
  it('reads comments, including a # that is inside a string value', () => {
    const parsed = read(
      doc(
        '# the project this file defines',
        'name = "Commented" # and what it is called',
        '',
        '[project]',
        '# the folder MATLAB starts in',
        'startup-folder = "utils # not a comment"',
      ),
    );
    expect(parsed.name).toBe('Commented');
    // The `#` is inside the quotes, so it is part of the path and not the start of a
    // comment. A reader that stripped comments with a line-wise regex would truncate it.
    expect(parsed.workingFolders).toEqual([
      { key: 'ProjectStartupFolder', ref: 'utils # not a comment' },
    ]);
    expect(parsed.warnings).toEqual([]);
  });

  it('reads a literal string raw and a basic string escaped', () => {
    // The distinction a hand-edited file turns on: a Windows path in single quotes keeps
    // its backslashes, where the same text in double quotes is read for escapes.
    const parsed = read(
      doc(
        String.raw`name = 'C:\raw\path'`,
        '[project]',
        String.raw`startup-folder = "escaped\tcolumn"`,
      ),
    );
    expect(parsed.name).toBe(String.raw`C:\raw\path`);
    expect(parsed.workingFolders).toEqual([
      { key: 'ProjectStartupFolder', ref: 'escaped\tcolumn' },
    ]);
  });

  it('reads a dotted key as the table it is shorthand for', () => {
    // `project.startup-folder = "utils"` and a `[project]` table holding
    // `startup-folder` are the same document, and a person writing one setting writes
    // the first. Nothing in this reader looks at how a table was spelled.
    const dotted = read('project.startup-folder = "utils"');
    const sectioned = read(doc('[project]', 'startup-folder = "utils"'));
    expect(dotted.workingFolders).toEqual([{ key: 'ProjectStartupFolder', ref: 'utils' }]);
    expect(dotted).toEqual(sectioned);
  });

  it('reads a multi-line array with a trailing comma', () => {
    // Valid TOML, invisible in MATLAB's own output (it writes one anyway, see the
    // fixture), and the shape a person leaves behind after deleting the last entry.
    const parsed = read(doc('[folders]', 'path = [', '  "utils",', '  "models",', ']'));
    expect(parsed.pathFolders).toEqual(['utils', 'models']);
    expect(parsed.warnings).toEqual([]);
  });

  it('reads a single string where MATLAB writes an array', () => {
    // `startup-files = "startup.m"` is valid TOML and means exactly one thing, so
    // refusing it would drop the whole field rather than one entry of it.
    const parsed = read(
      doc('[folders]', 'path = "utils"', '[project]', 'startup-files = "startup.m"'),
    );
    expect(parsed.pathFolders).toEqual(['utils']);
    expect(parsed.entryPoints.map((e) => e.file)).toEqual(['startup.m']);
    expect(parsed.warnings).toEqual([]);
  });

  it('falls back to the name the caller passed for a document that records none', () => {
    const parsed = read(doc('[folders]', 'path = ["utils"]'));
    expect(parsed.name).toBe(FALLBACK);
    // A document with no `name` is not a document with no content: `fallbackName` is a
    // missing field, not a failed read.
    expect(parsed.pathFolders).toEqual(['utils']);
    expect(parsed.warnings).toEqual([]);
  });

  it('names an entry point by its file stem, wherever the file sits', () => {
    const parsed = read(
      doc(
        '[project]',
        'startup-files = ["utils/sub/startup_one.m", "Startup.M", "noext", ".gitignore"]',
      ),
    );
    // The stem, so that the same file is the same entry-point NAME in all four formats:
    // the XML layouts record a `Name` attribute beside the `File` one and MATLAB writes
    // the stem into it. The extension is matched case-insensitively and the name keeps
    // its own case, which is what `Startup.M` is here for. A name that is ALL extension
    // has no stem to take, and an entry point with an empty name is not something a
    // gallery can show, so the basename stands in.
    expect(parsed.entryPoints.map((e) => e.name)).toEqual([
      'startup_one',
      'Startup',
      'noext',
      '.gitignore',
    ]);
    expect(parsed.entryPoints.map((e) => e.file)).toEqual([
      'utils/sub/startup_one.m',
      'Startup.M',
      'noext',
      '.gitignore',
    ]);
  });

  it('skips a startup entry that names no file', () => {
    // Nothing to show and nothing to open: the name here is derived from the file, so an
    // empty path leaves no entry point to make. (A shortcut is the opposite case — see
    // below — because there the KEY is the name.)
    const parsed = read(doc('[project]', 'startup-files = ["", "startup.m"]'));
    expect(parsed.entryPoints.map((e) => e.file)).toEqual(['startup.m']);
  });

  it('takes a shortcut written as a table OR as a bare string', () => {
    const parsed = read(
      doc('[project.shortcuts]', 'tabled = {path = "main.m"}', 'bare = "other.m"'),
    );
    expect(parsed.entryPoints).toEqual([
      {
        id: 'Basic:tabled',
        name: 'tabled',
        file: 'main.m',
        kind: 'Basic',
        visible: true,
        groupId: '',
      },
      {
        id: 'Basic:bare',
        name: 'bare',
        file: 'other.m',
        kind: 'Basic',
        visible: true,
        groupId: '',
      },
    ]);
    // The asymmetry with `[dependencies]`, where a bare string is skipped, is in the
    // formats and not in the reader: under `shortcuts` there is nothing else a string
    // beside a key could mean, and under `dependencies` there is.
    expect(parsed.warnings).toEqual([]);
  });

  it('keeps a shortcut whose path it could not resolve', () => {
    // The key IS the shortcut's name, so there is still a gallery entry the project
    // declared. Dropping it would make a shortcut written in a shape this reader does not
    // know disappear, rather than read as a shortcut whose target needs fixing.
    const parsed = read(
      doc('[project.shortcuts]', 'misspelled = {target = "main.m"}', 'numbered = 5'),
    );
    expect(parsed.entryPoints.map((e) => ({ name: e.name, file: e.file }))).toEqual([
      { name: 'misspelled', file: '' },
      { name: 'numbered', file: '' },
    ]);
    expect(parsed.entryPoints.every((e) => e.kind === 'Basic' && e.visible)).toBe(true);
  });

  it('omits a working folder the document does not designate', () => {
    // No entry at all, where an entry with an empty `ref` would read as the project ROOT
    // having been designated for that purpose.
    const parsed = read(
      doc('[project]', 'startup-folder = ""', '[simulink]', 'cache-folder = "c"'),
    );
    expect(parsed.workingFolders).toEqual([{ key: 'SimulinkCacheFolder', ref: 'c' }]);
  });

  it('emits the working folders in the STORE’s order, not the document’s', () => {
    // `parseProject` sorts its working folders by key, and these three keys sort into
    // exactly this sequence — which is what lets the parity suite compare a TOML parse
    // against an XML one array-to-array with no sort on either side. MATLAB happens to
    // write them in that order too, so the fixture cannot tell the two apart; a
    // document a person reordered can.
    const parsed = read(
      doc(
        '[simulink]',
        'codegen-folder = "codegen"',
        'cache-folder = "cache"',
        '[project]',
        'startup-folder = "utils"',
      ),
    );
    expect(parsed.workingFolders).toEqual([
      { key: 'ProjectStartupFolder', ref: 'utils' },
      { key: 'SimulinkCacheFolder', ref: 'cache' },
      { key: 'SimulinkCodeGenFolder', ref: 'codegen' },
    ]);
  });

  it('reads the label catalog in FILE order, not sorted', () => {
    // Unlike the XML reader, which sorts its catalog. The two orders are not the same
    // kind of thing: a store's order is its directory order, which means nothing and
    // differed between layouts, where this one is the order a person wrote the categories
    // down in. Spelled here with categories and labels that sort the other way, so a sort
    // added later cannot pass.
    const parsed = read(
      doc(
        '[project.labels.Zeta]',
        'Last = ["z.m"]',
        'Alpha = []',
        '',
        '[project.labels.Aaa]',
        'Only = "single.m"',
      ),
    );
    expect(parsed.labels).toEqual([
      { id: 'Zeta/Last', category: 'Zeta', name: 'Last', readOnly: false, declaredFiles: ['z.m'] },
      { id: 'Zeta/Alpha', category: 'Zeta', name: 'Alpha', readOnly: false, declaredFiles: [] },
      // A bare string is one declared file, for the same reason it is one path above.
      {
        id: 'Aaa/Only',
        category: 'Aaa',
        name: 'Only',
        readOnly: false,
        declaredFiles: ['single.m'],
      },
    ]);
  });

  it('skips a package dependency in SILENCE, warning about nothing', () => {
    // `[dependencies]` is also where a MATLAB PACKAGE dependency goes, with a version
    // constraint rather than a path, so a bare string there is a valid entry of a kind
    // this package does not model — not a malformed reference. This is the one place in
    // the reader where a warning would be wrong: it would put a count on every project
    // that depends on a package, and a count that fires on healthy files is a count a
    // host learns to hide.
    const parsed = read(
      doc('[dependencies]', 'someToolbox = "^1.2"', 'parityLib = {path = "../parityLib"}'),
    );
    expect(parsed.references).toEqual([
      { id: 'parityLib', name: 'parityLib', path: '../parityLib' },
    ]);
    expect(parsed.warnings).toEqual([]);
  });
});

describe('matlab.toml edited into the wrong shape', () => {
  // None of these may throw, and none may coerce: `parseTomlProject` is documented never
  // to throw for a sharper reason than the other readers have, because this is the one
  // format a user EDITS. A number where a path belongs and a key spelled the way last
  // year's release spelled it are ordinary states of a real file.

  it('ignores a value of the wrong type everywhere one can appear', () => {
    const parsed = read(
      doc(
        'name = 42',
        '[folders]',
        'path = 7',
        '[project]',
        'startup-folder = 7',
        'startup-files = true',
        'shortcuts = "not a table"',
        'labels = "not a table either"',
        '[simulink]',
        'cache-folder = ["an array where a string belongs"]',
      ),
    );
    expect(parsed.name).toBe(FALLBACK);
    expect(parsed.pathFolders).toEqual([]);
    expect(parsed.entryPoints).toEqual([]);
    expect(parsed.labels).toEqual([]);
    expect(parsed.workingFolders).toEqual([]);
    // And still the format, still read: the document declared keys, so it is not empty.
    expect(parsed.format).toBe('toml');
    expect(parsed.warnings).toEqual([]);
  });

  it('skips a non-string array entry rather than coercing it', () => {
    // `String(42)` would put a member called `42` on a page and a path called `42` in a
    // host's resolver. A number where a path belongs is not a path.
    const parsed = read(
      doc(
        '[folders]',
        'path = ["utils", 42, true]',
        '[project]',
        'startup-files = ["startup.m", 7]',
        '[project.labels.Review]',
        'Checked = ["helper.m", 42]',
      ),
    );
    expect(parsed.pathFolders).toEqual(['utils']);
    expect(parsed.entryPoints.map((e) => e.file)).toEqual(['startup.m']);
    expect(parsed.labels.map((l) => l.declaredFiles)).toEqual([['helper.m']]);
    expect(JSON.stringify(parsed)).not.toContain('42');
  });

  it('reads an array of tables as declaring nothing, not as declaring none', () => {
    // `[[dependencies]]` writes an ARRAY of tables, which is an object too — reading one
    // AS a table finds every key absent. The `Array.isArray` guard is what keeps that
    // from reporting a document which declares something this reader does not model as a
    // document that declares nothing.
    const parsed = read(
      doc('[[dependencies]]', 'path = "../one"', '[[dependencies]]', 'path = "../two"'),
    );
    expect(parsed.references).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.format).toBe('toml');
  });

  it('ignores a TOML value no field here can be, without coercing it', () => {
    // TOML has dates, times and integers-with-underscores, and smol-toml hands back a
    // Date (and a bigint for a large integer) rather than a string. Neither is a path,
    // and neither may reach a page as one — `String(new Date(...))` would put a weekday
    // on a project.
    const parsed = read(
      doc(
        'name = 2026-10-02',
        '[project]',
        'startup-folder = 09:30:00',
        'startup-files = [2026-10-02]',
        '[project.shortcuts]',
        'listed = [{path = "main.m"}]',
      ),
    );
    expect(parsed.name).toBe(FALLBACK);
    expect(parsed.workingFolders).toEqual([]);
    expect(filesOf(parsed, 'StartUp')).toEqual([]);
    // The shortcut survives on its key, as any unresolvable one does, and its file is
    // empty rather than the stringification of an array of tables.
    expect(parsed.entryPoints.map((e) => ({ name: e.name, file: e.file }))).toEqual([
      { name: 'listed', file: '' },
    ]);
    expect(parsed.warnings).toEqual([]);
  });

  it('reads a label category that is not a table as no labels at all', () => {
    const parsed = read(
      doc('[project.labels]', 'Review = "not a table"', '[project.labels.Real]', 'Checked = []'),
    );
    expect(parsed.labels.map((l) => l.id)).toEqual(['Real/Checked']);
  });
});

describe('matlab.toml that could not be read', () => {
  it('reports a document that will not parse, in ONE line that says where', () => {
    const parsed = read('name = "unterminated');
    expect(parsed.warnings).toHaveLength(1);
    const [warning] = parsed.warnings;
    expect(warning.code).toBe('source-unreadable');
    expect(warning.part).toBe('matlab.toml');
    // ONE line, deliberately. smol-toml appends a code excerpt with a caret under the
    // offending character, which is right in a terminal and arrives in a tree row, a
    // tooltip or a notification as ASCII art with the diagnosis scrolled off. So the
    // excerpt is dropped and the position the caret pointed at is said in words instead,
    // because a user editing this file by hand needs it.
    expect(warning.message.split('\n')).toHaveLength(1);
    expect(warning.message).not.toContain('^');
    expect(warning.message).toContain('unfinished string');
    expect(warning.message).toContain('at line 1, column 8');
    expect(warning.message).toContain('matlab.toml');
  });

  it('says where in words for a failure further into the document', () => {
    // The position is read off the error rather than assumed to be the first line, which
    // is the only thing that makes it worth printing.
    const parsed = read(doc('name = "fine"', '[project]', 'startup-files = [,]'));
    expect(parsed.warnings[0].code).toBe('source-unreadable');
    expect(parsed.warnings[0].message).toMatch(/at line 3, column \d+/);
    expect(parsed.warnings[0].message.split('\n')).toHaveLength(1);
  });

  it('reports a document carrying none of the keys that declare a project', () => {
    const parsed = read(doc('# a TOML file, but not this one', 'unrelated = true'));
    expect(parsed.warnings.map((w) => w.code)).toEqual(['source-empty']);
    expect(parsed.warnings[0].message).toContain('declares no project settings');
    expect(parsed.warnings[0].part).toBe('matlab.toml');
  });

  it('reports an empty file as empty', () => {
    expect(read('').warnings.map((w) => w.code)).toEqual(['source-empty']);
    expect(read('\n\n# nothing but a comment\n').warnings.map((w) => w.code)).toEqual([
      'source-empty',
    ]);
  });

  it('does NOT report a document whose only keys are ones this reader does not model', () => {
    // A newer release's file, or a hand-written future one: it declares project settings,
    // so it must not be reported as empty. The test is "none of the five known keys",
    // which `name` alone satisfies here.
    const parsed = read(doc('name = "Future"', 'quantum-folders = ["q"]'));
    expect(parsed.warnings).toEqual([]);
    expect(parsed.name).toBe('Future');
  });

  it('still reports the format on BOTH failure paths, and still enumerates no members', () => {
    // Where `ProjectParser`'s equivalent reports ''. The difference is real: a store that
    // could not be walked never said which layout it was in, whereas this format is KNOWN
    // even when the content is not — the caller dispatched on the file's NAME to get
    // here. Blanking it would make a page that titles the view with the format show no
    // format at all, for the one reason that has nothing to do with the format.
    for (const parsed of [read('name = "unterminated'), read('unrelated = true')]) {
      expect(parsed.format).toBe('toml');
      expect(parsed.membersEnumerated).toBe(false);
      expect(parsed.files).toEqual([]);
      expect(parsed.name).toBe(FALLBACK);
      // Empty but complete: every collection is an array, so nothing downstream guards.
      expect(parsed.pathFolders).toEqual([]);
      expect(parsed.labels).toEqual([]);
      expect(parsed.references).toEqual([]);
      expect(parsed.entryPoints).toEqual([]);
      expect(parsed.entryPointGroups).toEqual([]);
      expect(parsed.workingFolders).toEqual([]);
    }
  });
});

describe('matlab.toml through parseProject', () => {
  it('is dispatched on by name, and keeps the fallback name it was handed', () => {
    // The name a caller passes comes from `projectFallbackName`, which for a
    // `matlab.toml` is the parent FOLDER's basename — the file is called `matlab.toml` in
    // every project that has one, so a stem reduction would title all of them "matlab".
    // This is the seam where that name arrives: a document recording no `name` must come
    // back under the folder's.
    const parsed = parseProject(
      { 'matlab.toml': doc('[folders]', 'path = ["utils"]') },
      'FolderName',
    );
    expect(parsed.name).toBe('FolderName');
    expect(parsed.format).toBe('toml');
    expect(parsed.membersEnumerated).toBe(false);
    expect(parsed.pathFolders).toEqual(['utils']);
  });

  it('reads the parity fixture identically through either entry point', () => {
    expect(parseProject({ 'matlab.toml': FIXTURE }, FALLBACK)).toEqual(
      parseTomlProject(FIXTURE, FALLBACK),
    );
  });
});
