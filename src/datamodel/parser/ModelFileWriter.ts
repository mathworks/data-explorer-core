// Copyright 2026 The MathWorks, Inc.

import { zipSync } from 'fflate';
import { asRead } from './ZipAsRead.js';
import { packageStampsOf } from './EntrySource.js';
import { serializeMatFile } from './MatFileWriter.js';
import { MatWriteError } from './MatWriter.js';
import { matOfWorkspaceStream, workspaceStreamOfMat, type WorkspaceStreamRead } from './ModelWorkspaceStream.js';
import { parseSlx } from './SlxParser.js';
import type ModelNode from '../node/container/ModelNode.js';
import type ModelWorkspaceNode from '../node/container/ModelWorkspaceNode.js';
import { CONTENT_TYPES, EMPTY_WORKSPACE, ROOT_RELS, WORKSPACE_MAT_PART, WORKSPACE_STREAM_PART, packageRefusal } from './ModelPackage.js';
import { ActiveMarkError, withActiveSet } from './ActiveConfigMark.js';
import { ConfigSetsError } from './ConfigSetsWriter.js';
import { basenameOf } from '../fileKinds.js';

// A save of a `.slx`: the package as it was read, every member's bytes as read, in the order its
// directory listed them, with the time stamp and compression each had there (ZipAsRead), and the
// Model Workspace's member written anew where it was edited: the MAT-file its editor saves
// (MatFileWriter), converted back into the part from R2019b (ModelWorkspaceStream), the MAT-file
// itself before.
//
// Measured on R2027a and its exports to R2025a, R2021a and R2018a (test/parity/matlab/
// probe_workspace_part.m): a model that keeps no variable holds no workspace part, and its first
// variable adds three things, the part, a Default of the part's extension in [Content_Types].xml
// and a `modelWorkspace` Relationship in _rels/.rels, each in its file's order (by extension, by
// id); deleting the last takes all three away again. Nothing else in the package changes:
// modelDictionary.xml, which lists the workspace's parameters, is brought up to date by MATLAB as
// it next saves the model, and a model whose workspace part alone was edited opens with no warning
// (a value, a variable added, one deleted, with and without Embedded Coder code mappings:
// probe_model_dictionary_sync.m). What MATLAB opens of every save is probe_model_workspace_save's
// gate to say.
//
// And the model's configuration sets as edited: renamed, described, added, deleted
// (ConfigSetsWriter); then, where another set was made active, the one member that marks it, with
// the mark moved (ActiveConfigMark). MATLAB opens each as its own save of the same change
// (probe_active_config_set.m, probe_config_set_edits.m).

const RELATIONSHIP_TYPE = 'http://schemas.mathworks.com/simulinkModel/2010/relationships/modelWorkspaceData';
const PART_TYPES: Record<string, { extension: string; contentType: string }> = {
  [WORKSPACE_STREAM_PART]: { extension: 'mxarray', contentType: 'application/vnd.mathworks.matlab.mxarray+binary' },
  [WORKSPACE_MAT_PART]: { extension: 'mat', contentType: 'application/vnd.mathworks.matlab.mat+binary' },
};

/**
 * The bytes of the `.slx` `model` is, as it stands now: its package as read, with its Model
 * Workspace's member as the workspace's save writes it, or no member where the workspace holds no
 * variable, and the active configuration set marked where another was made active. Throws
 * MatWriteError, naming the model and why, for a package no save of which can be written
 * (ModelPackage.packageRefusal), for a workspace whose save is refused (MatFileWriter's refusals, in
 * its words), for a mark that cannot be moved (ActiveConfigMark), and for a package that does not
 * read back holding the workspace saved and the set made active.
 */
export function serializeModelFile(model: ModelNode): Uint8Array {
  const label = basenameOf(model.name) || model.name;
  const refused = packageRefusal(model);
  if (refused) {
    throw new MatWriteError('Cannot save "' + label + '": ' + refused + '. Nothing was written.');
  }
  const entries: Record<string, Uint8Array> = { ...model._zipEntries! };
  const workspace = workspaceOf(model);
  if (workspace && workspace._modelRefusal === null) {
    writeWorkspace(entries, workspace, model);
  }
  const sets = model._configSetsToWrite;
  const active = model._activeSetToWrite;
  try {
    model._configEdited(entries);
    if (active !== null) {
      const marked = withActiveSet(entries, active);
      entries[marked.member] = marked.bytes;
    }
  } catch (e) {
    if (e instanceof ActiveMarkError || e instanceof ConfigSetsError) {
      throw new MatWriteError('Cannot save "' + label + '": ' + e.message + '. Nothing was written.');
    }
    throw e;
  }
  const zipped = zipSync(asRead(entries, packageStampsOf(model._zipEntries)), { level: 6 });
  readsBack(zipped, label, workspace, active, sets);
  return zipped;
}

// The model's Model Workspace where it is a MAT-file's editor (ModelWorkspaceNode), told by what it
// holds of its part: this folder imports no node.
function workspaceOf(model: ModelNode): ModelWorkspaceNode | null {
  const section = model.getSection('workspace') as unknown as Partial<ModelWorkspaceNode> | null;
  return section && '_streamRead' in section && '_modelRefusal' in section ? (section as ModelWorkspaceNode) : null;
}

// The workspace's member of `entries` as its save writes it, and the parts that name it.
function writeWorkspace(entries: Record<string, Uint8Array>, workspace: ModelWorkspaceNode, model: ModelNode): void {
  const part = workspace._part ?? (streamEra(model.release) ? WORKSPACE_STREAM_PART : WORKSPACE_MAT_PART);
  if (workspace.children.length === 0) {
    if (workspace._part) {
      delete entries[workspace._part];
      unregister(entries, workspace._part);
    }
    return;
  }
  const mat = serializeMatFile(workspace);
  if (part === WORKSPACE_MAT_PART) {
    entries[part] = mat;
  } else {
    entries[part] = workspaceStreamOfMat(mat, workspace._streamRead ?? emptyStreamRead());
  }
  if (!workspace._part) {
    register(entries, part);
  }
}

// Whether a model of `release` keeps its workspace as a stream (R2019b and after) rather than as a
// MAT-file; a model of no release this reads is taken as one of now.
function streamEra(release: string): boolean {
  const m = /^R(\d{4})([ab])$/.exec(release.trim());
  if (!m) {
    return true;
  }
  const year = Number(m[1]);
  return year > 2019 || (year === 2019 && m[2] === 'b');
}

function emptyStreamRead(): WorkspaceStreamRead {
  const made = matOfWorkspaceStream(EMPTY_WORKSPACE);
  if (!made.ok) {
    throw new Error(made.why);
  }
  return made.read;
}

// [Content_Types].xml and _rels/.rels naming `part`, as MATLAB writes them for a workspace's first
// variable: each entry on its own line, in its file's order.
function register(entries: Record<string, Uint8Array>, part: string): void {
  const { extension, contentType } = PART_TYPES[part];
  edited(entries, CONTENT_TYPES, (xml) =>
    new RegExp('<Default[^>]*Extension="' + extension + '"').test(xml)
      ? xml
      : inOrder(xml, /<Default\b[^>]*\/>/g, /Extension="([^"]*)"/, extension, '<Default ContentType="' + contentType + '" Extension="' + extension + '"/>'),
  );
  edited(entries, ROOT_RELS, (xml) =>
    /<Relationship\b[^>]*Id="modelWorkspace"/.test(xml)
      ? xml
      : inOrder(xml, /<Relationship\b[^>]*\/>/g, /Id="([^"]*)"/, 'modelWorkspace', '<Relationship Id="modelWorkspace" Target="' + part + '" Type="' + RELATIONSHIP_TYPE + '"/>'),
  );
}

// The two parts, no longer naming `part`, as MATLAB writes them once the workspace's last variable
// is deleted: its Relationship taken out, and its extension's Default where no other part has it.
function unregister(entries: Record<string, Uint8Array>, part: string): void {
  const { extension } = PART_TYPES[part];
  edited(entries, ROOT_RELS, (xml) => withoutLine(xml, /<Relationship\b[^>]*Id="modelWorkspace"[^>]*\/>/));
  if (!Object.keys(entries).some((name) => name.endsWith('.' + extension))) {
    edited(entries, CONTENT_TYPES, (xml) => withoutLine(xml, new RegExp('<Default\\b[^>]*Extension="' + extension + '"[^>]*/>')));
  }
}

function edited(entries: Record<string, Uint8Array>, name: string, edit: (xml: string) => string): void {
  const bytes = entries[name];
  if (!bytes) {
    throw new MatWriteError('Cannot save the model: its part "' + name + '" is missing, which names its parts. Nothing was written.');
  }
  const xml = new TextDecoder().decode(bytes);
  const out = edit(xml);
  if (out !== xml) {
    entries[name] = new TextEncoder().encode(out);
  }
}

// `xml` with `line` added among the elements `element` matches, before the first whose key (`key`'s
// group) sorts after `value`, or after the last of them, indented as they are.
function inOrder(xml: string, element: RegExp, key: RegExp, value: string, line: string): string {
  const found = [...xml.matchAll(element)];
  if (found.length === 0) {
    throw new MatWriteError('Cannot save the model: a part that names its parts lists none. Nothing was written.');
  }
  const after = found.find((m) => (key.exec(m[0])?.[1] ?? '') > value);
  const at = after ? after.index! : found[found.length - 1].index! + found[found.length - 1][0].length;
  const lineStart = xml.lastIndexOf('\n', found[0].index!) + 1;
  const indent = xml.slice(lineStart, found[0].index!);
  return after ? xml.slice(0, at) + line + '\n' + indent + xml.slice(at) : xml.slice(0, at) + '\n' + indent + line + xml.slice(at);
}

// `xml` without the element `element` matches, and the line it was on.
function withoutLine(xml: string, element: RegExp): string {
  const m = element.exec(xml);
  if (!m) {
    return xml;
  }
  const start = xml.lastIndexOf('\n', m.index) + 1;
  const end = xml.indexOf('\n', m.index + m[0].length);
  const blankBefore = xml.slice(start, m.index).trim() === '';
  const blankAfter = (end < 0 ? xml.slice(m.index + m[0].length) : xml.slice(m.index + m[0].length, end)).trim() === '';
  return blankBefore && blankAfter ? xml.slice(0, start) + xml.slice(end < 0 ? xml.length : end + 1) : xml.slice(0, m.index) + xml.slice(m.index + m[0].length);
}

// The package written, read back: it holds the workspace's variables, by name, as saved, and the set
// made active (`active`, where one was) is the one active.
function readsBack(
  zipped: Uint8Array,
  label: string,
  workspace: ModelWorkspaceNode | null,
  active: string | null,
  sets: readonly { name: string; className: string; description: string; sourceName: string }[] | null,
): void {
  let back;
  try {
    back = parseSlx(zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer, label);
  } catch (e) {
    throw new MatWriteError('Cannot save "' + label + '": what would be written does not read back as a model (' + (e as Error).message + '). Nothing was written.');
  }
  if (active !== null) {
    const got = back.configSets.filter((c) => c.active).map((c) => c.name);
    if (got.length !== 1 || got[0] !== active) {
      throw new MatWriteError('Cannot save "' + label + '": what would be written does not read back with "' + active + '" the active configuration set. Nothing was written.');
    }
  }
  if (sets !== null) {
    const spell = (s: { name: string; className: string; description: string; sourceName: string }) => [s.name, s.className, s.description, s.sourceName].join('\u0000');
    const got = back.configSets.map((c) => spell({ name: c.name, className: c.objectClass || 'Simulink.ConfigSet', description: c.description ?? '', sourceName: c.sourceName }));
    if (got.join('\u0001') !== sets.map(spell).join('\u0001')) {
      throw new MatWriteError('Cannot save "' + label + '": what would be written does not read back with its configuration sets as edited. Nothing was written.');
    }
  }
  if (!workspace || workspace._modelRefusal !== null) {
    return;
  }
  const wanted = workspace.children.map((c) => c.name).sort();
  const got = back.workspace.map((v) => v.name).sort();
  if (wanted.length !== got.length || wanted.some((n, i) => n !== got[i])) {
    throw new MatWriteError('Cannot save "' + label + '": what would be written does not read back with its Model Workspace\'s variables. Nothing was written.');
  }
}
