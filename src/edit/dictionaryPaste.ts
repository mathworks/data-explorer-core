// Copyright 2026 The MathWorks, Inc.
//
// WHAT A PASTE INTO A DICTIONARY'S SECTION MAKES OF AN ENTRY.
//
// Copied from data-explorer-vscode at c73da3c, which keeps its own copies until it adopts these
// (view-split step 6b), so each function below reads as it does there, texts verbatim:
//   src/host/structuralEdit.ts  StructuralResult, cloneForPaste, assertTypeAllowed,
//                               assertConstantValueAllowed, prepareEntryForPaste,
//                               refuseDisallowedPaste, refuseUnwrittenNumber, foldPasteEntries
//                               (and their helpers)
//   src/host/entryOps.ts        recordCopy, findEntryBySelector
//   src/host/transfer.ts        TransferRefused
// What changed in the copy: the imports, and `export` on refuseUnwrittenNumber, which a host
// writing a text dictionary's new entry calls.
//
// These are the rules a paste or a drop of one or more entries into a dictionary's section runs,
// whichever of the two .sldd formats the section is in and however the host writes the result:
// the class must have a home in the section; a classless payload is judged by what it becomes
// there; the name is made unique across the namespace; the entry is rebound to the section with
// a fresh uuid; a plain variable becoming a Constant must be scalar and numeric; and a new entry
// of a text dictionary holding a bare non-finite number is refused, never written as null. The
// session's pasteEntries (core/DataModel) makes the paste through them as one undo step.

import { getSectionMetadata } from '../datamodel/SectionConstants.js';
import { generateUuid } from '../datamodel/node/container/SectionNode.js';
import { toEntrySelector, type EntrySelector } from '../datamodel/parser/entrySelector.js';
import type { TextPatch } from './textPatch.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A refusal that changed nothing: a message, and no repair.
 *
 * Thrown by an adapter (or the policy) only while the document, its model and its rows are all
 * still exactly as they were — the cut stays on the clipboard for another try, and no repaint
 * is spent putting back what was never moved.
 */
export class TransferRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransferRefused';
  }
}

export interface StructuralResult {
  newText: string;
  selectId: string | null;
  /**
   * The ONE region of the input text this edit changed, when it is one region — which every
   * transform in this file is (see the header: an element spliced, dropped, or inserted).
   *
   * Reported so the host can write that region instead of the whole document: VS Code stores
   * an edit as what it was handed, so a full-text replace makes both the edit and its undo
   * cost a 47.8 MB rewrite to say a 1 KB thing. Optional because the multi-target paths
   * (deleteEntriesByName) change several regions and because the XML transforms share this
   * shape without reporting one — an absent patch simply means "write newText".
   */
  patch?: TextPatch;
}

/**
 * A deep copy of a serialized entry record, as a JSON round trip would make it — except that
 * every number is kept as the number it is.
 *
 * A binary dictionary's reader holds a scalar double as a bare JS number: a scalar entry's
 * value, a struct's field, an object's property. So an Inf, a NaN or a -0 is one in the record,
 * and JSON has no spelling for any of them — the round trip both copies used turned Infinity,
 * -Infinity and NaN into null and -0 into 0. A pasted entry, and an entry an undo rebuilt from
 * its record, came back as another value, with nothing said.
 *
 * Everything else is what the round trip did, on purpose, so that the only change is the one
 * that was a loss: an undefined, a function or a symbol is dropped from an object and is null
 * in an array, a `toJSON` is asked (a Date is its text), and a `__proto__` key stays a key.
 * structuredClone would be the other answer, and it keeps `undefined` members a writer would
 * then meet, and throws on a function.
 *
 * And a BigInt is refused, as JSON.stringify refuses one, with a TypeError — naming where it
 * stands, which JSON's does not. Core's MAT reader can hold a 64-bit integer as one, and a record
 * that holds one is a record neither writer here can write: the refusal is what made the entry
 * capture behind a removal (removeEntries) and an undo record refuse BEFORE anything changed,
 * and passing it through would move that failure to a later write, after the model has moved.
 */
export function recordCopy(value: unknown): unknown {
  return copyAt(value, '');
}

function copyAt(value: unknown, at: string): unknown {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') {
    throw new TypeError(`Do not know how to serialize a BigInt${at ? ` (at ${at})` : ''}`);
  }
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value === null || typeof value !== 'object') return value;
  const asJson = (value as { toJSON?: () => unknown }).toJSON;
  if (typeof asJson === 'function') return copyAt(asJson.call(value), at);
  if (Array.isArray(value)) {
    return value.map((element, i) => {
      const copy = copyAt(element, `${at}[${i}]`);
      return copy === undefined ? null : copy;
    });
  }
  const out: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(value)) {
    const copy = copyAt(member, at ? `${at}.${key}` : key);
    if (copy === undefined) continue;
    // Defined, not assigned: assigning `__proto__` would set the copy's prototype, where a
    // JSON.parse makes it an own key like any other.
    Object.defineProperty(out, key, { value: copy, enumerable: true, writable: true, configurable: true });
  }
  return out;
}

/**
 * The live entry a clipboard or drag selector means, or nothing.
 *
 * A move deletes its source by NAME (that is all a payload carries across documents), and
 * both providers need the model node behind that name to state the removal as an op. Same
 * rule as the text splices in `deleteEntriesByName`: match on name, and consult the uuid only
 * when more than one entry answers to it — because a .sldd holds several namespaces, so two
 * entries legitimately share a name.
 *
 * Answers null rather than guessing when the name is ambiguous and the uuid cannot settle it.
 * The caller's fallback is the wide repaint, which is slow; moving an entry the user did not
 * touch is wrong.
 */
export function findEntryBySelector(model: any, target: string | EntrySelector): any {
  const selector = toEntrySelector(target);
  const matches: any[] = [];
  for (const section of (model?.children ?? []) as any[]) {
    for (const entry of (section.children ?? []) as any[]) {
      if (entry.name === selector.name) matches.push(entry);
    }
  }
  if (matches.length <= 1) return matches[0] ?? null;
  if (!selector.uuid) return null;
  const byUuid = matches.filter((e) => (e.metadata as any)?.uuid === selector.uuid);
  return byUuid.length === 1 ? byUuid[0] : null;
}

/**
 * Refuse, before anything changes, a paste or drop the section's allow-list will not take.
 *
 * The same check foldPasteEntries makes for every payload before its fold, asked earlier: by
 * then a same-document move has already taken its sources out of the model, so a refusal there
 * has a tree to repair, and here it has none. Worded as it always was, so the message the user
 * sees for a refused class does not depend on which of the two caught it.
 */
export function refuseDisallowedPaste(section: any, payloads: readonly Record<string, unknown>[]): void {
  for (const payload of payloads) {
    try {
      assertTypeAllowed(section, payload);
    } catch (err) {
      throw new TransferRefused(`Failed to apply edit: ${(err as Error).message}`);
    }
  }
}

/**
 * Where in a serialized value a number sits that JSON.stringify writes as `null` — an Inf, a
 * -Inf or a NaN — as the names leading to it ([] for the value itself), or null when there is
 * none. `_dimensions` is passed by: a text dictionary's own dims can hold the infinity JSON.parse
 * makes of an overflowing extent, which its save writes as it always has, and a pasted one is
 * refused by core before it gets here (MatWriter.textDictionaryForm).
 */
function unwrittenNumberIn(value: unknown, path: string[] = []): { value: number; path: string[] } | null {
  if (typeof value === 'number') return Number.isFinite(value) ? null : { value, path };
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const element of value) {
      const found = unwrittenNumberIn(element, path);
      if (found) return found;
    }
    return null;
  }
  for (const [key, member] of Object.entries(value)) {
    if (key === '_dimensions') continue;
    // A bag's own keys (`_elements`, `_properties`) are not names a user knows the value by.
    const found = unwrittenNumberIn(member, key.startsWith('_') ? path : [...path, key]);
    if (found) return found;
  }
  return null;
}

/**
 * Refuse to write a NEW entry into a JSON dictionary with a `null` where its value holds a number.
 *
 * A binary dictionary, and a MAT-file, hold a scalar Inf, -Inf or NaN as the bare number, and so
 * does the record a copy of one carries. A text dictionary spells such a number as text
 * (`{"_type": "double", "_value": "Inf"}`, as MATLAB writes one), and core spells a bare one so as
 * it takes a pasted entry in (SectionNode.parseEntry), at an entry's value, a struct's field, a
 * cell's element and an object's property alike: so a paste never reaches this with one. This is
 * the safety net for a record core handed back as it was — a value it could not take apart, one
 * past its writer's budget — whose bare number this writer (textDictionaryJson, as JSON.stringify
 * does) would write as null:
 * the pasted entry would then read, and save, as another value, with nothing said. Refused
 * instead, naming the entry and where in it the number is; nothing is written.
 *
 * New entries only (a paste, a drop, an Add): the file's own entries are written as they read.
 */
export function refuseUnwrittenNumber(newNode: any, record: any): void {
  const found = unwrittenNumberIn(record?.value);
  if (!found) return;
  const spelled = Number.isNaN(found.value) ? 'NaN' : found.value > 0 ? 'Inf' : '-Inf';
  const where = found.path.length ? ` (in ${found.path.join('.')})` : '';
  throw new Error(
    `Cannot paste "${newNode?.name}" into a text dictionary: it holds ${spelled}${where}, ` +
      'which would be written there as null. Nothing was pasted.',
  );
}

/**
 * Deep-clone a clipboard payload so repeated pastes don't alias the same object.
 *
 * Through entryOps' recordCopy, which the undo records share, and not a JSON round trip: a
 * binary dictionary's payload holds an Inf, a NaN or a -0 as the bare number, which the round
 * trip turned into null or 0, so the pasted entry was another value.
 */
export function cloneForPaste(payload: Record<string, unknown>): Record<string, unknown> {
  return recordCopy(payload) as Record<string, unknown>;
}

/** The Simulink class name of a serialized entry payload, or '' if none. */
function payloadClassName(payload: Record<string, unknown>): string {
  const value = payload.value as Record<string, unknown> | undefined;
  return (value && typeof value === 'object' && (value._array_class as string)) || '';
}

/**
 * The allow-list token a payload has to answer for. An object entry names its own
 * class; a CLASSLESS payload — a plain MATLAB variable, or a variable whose value
 * is a struct — names none, and its token is what it WILL BE once pasted here: a
 * Constant in a derived section (Architectural Data), a MATLAB variable anywhere
 * else. Every payload therefore HAS a token, which is the point: "no class" used
 * to mean "no check", so the one payload kind that carries no class was the one
 * kind no section could refuse.
 *
 * A struct is judged as 'MatlabVariable' and not 'MatlabStruct' even though both
 * are real tokens (SectionNode.addEntry keys the registry by them). No section
 * allows MatlabStruct without also allowing MatlabVariable, so this can only ever
 * be the more permissive of the two — it cannot start refusing a struct anywhere a
 * plain variable is welcome, while still refusing both where neither is.
 */
function payloadAllowToken(section: any, payload: Record<string, unknown>): string {
  return (
    payloadClassName(payload) ||
    (getSectionMetadata(section.name).isderived === '1' ? 'Constant' : 'MatlabVariable')
  );
}

// Reject a payload the target section cannot hold. Shared by the single- and
// multi-paste paths, which differ only in WHEN they call it: paste checks its one
// payload, drop checks every payload up front so a rejected multi-drop leaves the
// document untouched. A section with no allow-list is unrestricted (SectionNode's
// own rule). Shared with the XML path too, so the two .sldd formats can't drift on
// what a section accepts.
export function assertTypeAllowed(section: any, payload: Record<string, unknown>): void {
  if (typeof section.allowsType !== 'function') return;
  const className = payloadClassName(payload);
  if (section.allowsType(payloadAllowToken(section, payload))) return;
  const where = section.displayName ?? section.name;
  // A classless payload has no class name to quote, so name the thing the user
  // dragged rather than the pseudo-token we judged it by.
  throw new Error(
    className
      ? `A "${className}" entry is not allowed in ${where}.`
      : `A MATLAB variable is not allowed in ${where}.`,
  );
}

/**
 * The authoritative Variable→Constant gate, shared by the JSON and XML paste
 * paths. A plain MATLAB variable pasted into a DERIVED section (Architectural
 * Data) becomes a Constant, which must be scalar-numeric. `newNode` is the node
 * section.parseEntry already built — a derived plain variable is reclassed to a
 * ConstantNode, so we test its `isScalarNumeric`. Throws if it isn't, so both
 * keyboard/menu Paste and drop are gated (drop feedback alone is only advisory).
 * Non-variable entries (Bus, Signal, …) have no such flag and are unaffected.
 *
 * `isClassless` says the payload named no class, i.e. it is being MADE a Constant
 * here — such a node must PROVE it is scalar-numeric. Trusting the flag alone was
 * a hole: a struct payload parses to a StructNode, which exposes no
 * `isScalarNumeric` at all, and "no flag" read as "not a variable, exempt" — so a
 * struct landed in Architectural Data as an invalid Constant, even though the
 * webview's drag predictor had already said no-drop for the same gesture.
 */
export function assertConstantValueAllowed(section: any, newNode: any, isClassless = false): void {
  if (getSectionMetadata(section.name).isderived !== '1') return;
  // Only MATLAB-variable / Constant nodes expose `isScalarNumeric`, so the typeof
  // guard restricts this to the variable path — object entries are exempt.
  const mustBeScalarNumeric = isClassless || typeof newNode?.isScalarNumeric === 'boolean';
  if (mustBeScalarNumeric && newNode?.isScalarNumeric !== true) {
    throw new Error(`The value for constant '${newNode?.name}' must be scalar and numeric.`);
  }
}

/**
 * Everything a paste does BEFORE it touches text: gate the payload, clone it,
 * rename it, rebind it to the target section, build the node, and gate its value.
 * Returns the new node, already added to the live `section`.
 *
 * Shared by the JSON and XML paste paths, which differ ONLY in how they splice
 * the resulting node into their document. This ran as two copies whose comments
 * each said "mirrors the other path" — the drift they were worried about is what
 * this removes, because every rule below decides where a pasted entry LANDS and a
 * one-sided fix would silently reclassify entries in one format only.
 *
 * The rules, in order:
 *  - The class must have a home in the target section (a Simulink.ServiceBus
 *    cannot go into Design), and a payload with no class is judged by the token it
 *    becomes here — see payloadAllowToken.
 *  - The payload is deep-cloned, so a repeated paste of one clipboard entry does
 *    not alias (and then mutate) the same object.
 *  - The name is made unique across the section's whole NAMESPACE, not just the
 *    section — Design and Architectural Data share one.
 *  - The entry is rebound to the target section UNCONDITIONALLY, creating the
 *    metadata object when the payload carries none. `metadata` is null for an
 *    entry whose source .sldd never declared one (e.g. hand-added in the text
 *    view), and skipping the rebind there left the pasted entry with no namespace
 *    at all — so getSectionKey fell through to its 'design' default and the
 *    reloaded file put the entry in Design Data no matter which section it was
 *    pasted into.
 *  - It gets a FRESH uuid rather than the source's, so it is a distinct object,
 *    matching the add-entry path (SectionNode). Pasting into Architectural Data
 *    is still allowed: the new uuid is simply one the ArchitecturePart /
 *    SystemComposer mapping does not reference yet, which leaves every existing
 *    (referenced) entry intact — the same benign desync already accepted for
 *    add-child. It never corrupts existing references.
 *  - Both metadata fields matter: `namespace` routes the entry, and `isderived`
 *    is what actually distinguishes Arch from Design (they share NS_DESIGN), so
 *    rewriting it is what declassifies an arch paste into a genuine, editable
 *    Design entry.
 */
export function prepareEntryForPaste(section: any, payload: Record<string, unknown>): any {
  assertTypeAllowed(section, payload);

  const raw = cloneForPaste(payload);
  const baseName = typeof raw.name === 'string' ? raw.name : 'Entry';
  raw.name = section._uniqueName(baseName);
  const md = (raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {}) as Record<
    string,
    unknown
  >;
  md.uuid = generateUuid();
  const sectionMeta = getSectionMetadata(section.name);
  md.namespace = sectionMeta.namespace;
  md.isderived = sectionMeta.isderived;
  raw.metadata = md;

  // PRECONDITION (untested): parseEntry always returns a node — an unrecognized
  // class becomes a plain ObjectNode and a valueless payload a MatlabVariableNode,
  // so no payload reaching here (they are all serialize() output of a real entry,
  // or clipboard JSON with a name) can make it null. Kept as a defensive net.
  const newNode = section.parseEntry(raw);
  if (!newNode) throw new Error('Failed to paste the entry.');
  assertConstantValueAllowed(section, newNode, !payloadClassName(payload));
  return newNode;
}

/**
 * Drop-completion transform: paste MANY payloads into `section` in one edit —
 * exactly what a multi-select drop needs. Shared by both .sldd formats, which
 * supply their own single-entry paste (`pasteOne`) and differ in nothing else.
 *
 * It is a fold: each paste re-inserts into the text produced by the previous one
 * AND adds the new node to the live `section`, so `_uniqueName` sees the growing
 * namespace and every dropped entry gets a distinct name (a first Bus becomes
 * Bus1, a second Bus2).
 *
 * The allow-check is all-or-nothing and runs BEFORE the fold: any disallowed
 * payload throws before any text changes, so a rejected multi-drop leaves the
 * document untouched rather than half-applied. That ordering is the whole reason
 * this is shared rather than written per format.
 *
 * A move deletes the sources separately (the host, via deleteEntry) — this side
 * is purely the paste, identical to how drop mirrors copy/cut + paste.
 */
export function foldPasteEntries(
  text: string,
  section: any,
  payloads: Record<string, unknown>[],
  pasteOne: (text: string, section: any, payload: Record<string, unknown>) => StructuralResult,
): { newText: string; selectIds: string[]; patch?: TextPatch } {
  for (const payload of payloads) {
    assertTypeAllowed(section, payload);
  }
  let currentText = text;
  const selectIds: string[] = [];
  // The insertions, folded into one — see composeInsertions for when that is possible and
  // why it is checked rather than assumed.
  let combined: TextPatch | null | undefined = null;
  for (const payload of payloads) {
    const step = pasteOne(currentText, section, payload);
    combined = composeInsertions(combined, step.patch);
    currentText = step.newText;
    if (step.selectId) selectIds.push(step.selectId);
  }
  return { newText: currentText, selectIds, patch: combined ?? undefined };
}

/**
 * Fold a step's patch into the insertion built so far, or give up (undefined).
 *
 * A paste appends its element to the entries array, so the next paste's insertion point is
 * exactly the end of the one before it: N pastes into one text are N appends at one place,
 * hence a single insertion of the concatenated elements. That is what lets a multi-select
 * drop be one narrow write.
 *
 * Every part of that is CHECKED, not trusted: each step must be a pure insertion (`length`
 * 0) landing exactly where the previous one ended, and a step reporting no patch at all (the
 * XML paste, which shares this fold) folds to nothing. Anything else returns undefined,
 * which is the caller's cue to write the whole text — correct, just not narrow. Guessing
 * here would write a document that has an element in it twice, or not at all.
 *
 * `null` means "nothing folded yet"; `undefined` means "cannot be folded".
 */
function composeInsertions(
  soFar: TextPatch | null | undefined,
  step: TextPatch | undefined,
): TextPatch | undefined {
  if (soFar === undefined || !step || step.length !== 0) return undefined;
  if (soFar === null) return { ...step };
  if (step.offset !== soFar.offset + soFar.text.length) return undefined;
  return { offset: soFar.offset, length: 0, text: soFar.text + step.text };
}

// ---- The paste through the session (core's own, not copied) -----------------------------------
//
// vscode makes a paste into a dictionary as one edit of its own document, a WorkspaceEdit or a
// chunk pushed on its stack, with the rules above. A host that keeps the model as the truth makes
// it here instead, as one step of the session's undo stack (DataModel.pasteEntries): the entries a
// same-document move takes out first, then each payload through prepareEntryForPaste, all of it or
// none.

/** What a paste into a section made: the entries pasted, those taken out first, and the undo. */
export interface SectionPasteMade {
  /** The entries pasted, in the order the payloads were handed over. */
  nodes: any[];
  undo(): void;
  redo(): void;
}

/** A paste into a section refused, whole: why, in the rule's own words, and the entry's name. */
export interface SectionPasteRefused {
  error: true;
  reason: string;
  name?: string;
}

/**
 * The entries of `dictionary` that `targets` name, for a same-document move to take out before
 * it pastes (TransferCommit.removeFirst), each once, in the order named: by findEntryBySelector's
 * rule. A target that names no entry is passed by, as the text splices pass it by
 * (deleteEntriesByName): its entry is already gone. One that names two, which its uuid does not
 * tell apart, refuses the paste, since taking out either could take out the wrong one.
 */
export function entriesToRemoveFirst(dictionary: any, targets: readonly (string | EntrySelector)[]): any[] | SectionPasteRefused {
  const entries: any[] = [];
  for (const target of targets) {
    const selector = toEntrySelector(target);
    const named = ((dictionary?.children ?? []) as any[]).some((s) => ((s.children ?? []) as any[]).some((e) => e.name === selector.name));
    if (!named) continue;
    const entry = findEntryBySelector(dictionary, selector);
    if (!entry) {
      return {
        error: true,
        reason: `Cannot move "${selector.name}": two entries of "${dictionary?.name ?? ''}" have that name, and nothing tells which one is meant. Nothing was pasted.`,
        name: selector.name,
      };
    }
    if (!entries.includes(entry)) entries.push(entry);
  }
  return entries;
}

/**
 * Paste `payloads` into the dictionary section `section` as new entries, after taking `removeFirst`
 * (entries of the same dictionary, entriesToRemoveFirst) out of it, so that a moved entry keeps its
 * name. Every payload is judged by the section's allow-list before anything changes
 * (assertTypeAllowed, as foldPasteEntries judges them), then made by prepareEntryForPaste in turn,
 * so each sees the names of those before it. A new entry of a text dictionary is refused where its
 * record holds a number that dictionary would write as null (refuseUnwrittenNumber), as vscode's
 * JSON paste refuses it.
 *
 * All of it or none: where one payload is refused, every entry pasted before it is taken out, every
 * entry taken out is put back where it was, and the dictionary's dirty flag is what it was. The
 * answer then says why, in the words of the rule that refused it, naming the entry. Made, the
 * section's source is dirty, and `undo` and `redo` take the whole of it back and make it again.
 * Indexing, events and the undo stack are the session's.
 */
export function execPasteIntoSection(
  section: any,
  payloads: readonly Record<string, unknown>[],
  removeFirst: readonly any[] = [],
): SectionPasteMade | SectionPasteRefused {
  const nameOf = (payload: Record<string, unknown>): string | undefined => (typeof payload?.name === 'string' ? payload.name : undefined);
  for (const payload of payloads) {
    try {
      assertTypeAllowed(section, payload);
    } catch (err) {
      return { error: true, reason: (err as Error).message, name: nameOf(payload) };
    }
  }
  let root: any = section;
  while (root.parent) root = root.parent;
  const dirty = root.dirty;
  const text = section.parent?.sourceFormat === 'json';
  const removed: { entry: any; undo: () => void; redo: () => void }[] = [];
  const pasted: any[] = [];
  const takeBack = (): void => {
    for (let i = pasted.length - 1; i >= 0; i--) section.removeChild(pasted[i]);
    for (let i = removed.length - 1; i >= 0; i--) removed[i].undo();
    if (root.dirty !== undefined) root.dirty = dirty;
  };
  for (const entry of removeFirst) {
    const removal = entry.parent?.execRemoveEntry?.(entry);
    if (removal) removed.push({ entry, ...removal });
  }
  for (const payload of payloads) {
    const from = section.children.length;
    try {
      const node = prepareEntryForPaste(section, payload);
      pasted.push(node);
      if (text) refuseUnwrittenNumber(node, node.serialize());
    } catch (err) {
      // What the refused payload attached before its refusal goes too (assertConstantValueAllowed
      // refuses a node parseEntry has already added).
      for (const left of (section.children as any[]).slice(from)) {
        if (!pasted.includes(left)) section.removeChild(left);
      }
      takeBack();
      if (!(err instanceof Error)) throw err;
      return { error: true, reason: err.message, name: nameOf(payload) };
    }
  }
  section._markSourceDirty();
  const at = pasted.map((node) => section.children.indexOf(node));
  return {
    nodes: pasted,
    undo: () => {
      for (let i = pasted.length - 1; i >= 0; i--) section.removeChild(pasted[i]);
      for (let i = removed.length - 1; i >= 0; i--) removed[i].undo();
      section._markSourceDirty();
    },
    redo: () => {
      for (const removal of removed) removal.redo();
      pasted.forEach((node, i) => section.addChild(node, at[i]));
      section._markSourceDirty();
    },
  };
}
