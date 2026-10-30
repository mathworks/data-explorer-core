// Copyright 2026 The MathWorks, Inc.

import ContainerNode from '../ContainerNode.js';
import type { TableColumnConfig } from '../ContainerNode.js';
import type BaseNode from '../BaseNode.js';
import { withArticle, type SourceOfferedEditor, type SourceSetResult } from '../BaseNode.js';
import { dictOfferedEditor, dictOfferedRestorer, dictSetOffered, dictUnofferedRefusal } from '../data/dictObjectEdit.js';
import { withSizeArticle } from '../editRefusal.js';
import type DataNode from '../DataNode.js';
// Not a static import of NodeClassMap: NodeRegistry is the deliberately
// dependency-free indirection (types only) that every node class goes through to
// reach the class map without a cycle. NodeClassMap installs itself into it.
import * as NodeRegistry from '../NodeRegistry.js';
import { matlabTimestampNow } from '../../parser/XmlUtils.js';
import { newEntryName, uniqueName } from '../../matlabName.js';
import { registeredSubclasses, superclassOf } from '../registeredSubclasses.js';
import { MatBudgetError, MatWriteError, heldByTextDictionary, oneWrite, textDictionaryForm } from '../../parser/MatWriter.js';
import { withoutHandleMarks } from '../../parser/McosParser.js';
import { withoutShownOfSaved } from '../mcosShown.js';
import type { SystemComposerCatalog } from '../../parser/ScCatalog.js';
import {
  classificationOf as _classificationOf,
  renameInCatalog as _renameInCatalog,
} from '../../parser/ScCatalog.js';

import { NS_DESIGN, NS_CONFIGURATIONS, NS_OTHER, SECTION_NAMESPACE } from '../../SectionConstants.js';
import { setOwn } from '../../parser/ownKeys.js';
import { valuePlace } from './valuePlace.js';
export { NS_DESIGN, NS_CONFIGURATIONS, NS_OTHER, SECTION_NAMESPACE };

// A namespace's entry-name counts, as a dictionary keeps them (SectionNode._namespaceHolds): how
// many entries hold each name, and the sections, and their versions, they were counted from.
interface NamespaceCounts {
  sections: SectionNode[];
  versions: number[];
  counts: Map<string, number>;
}

const ALLOWED_TYPES: Record<string, string[]> = {
  design: [
    'MatlabVariable',
    'MatlabStruct',
    'Simulink.Parameter',
    'Simulink.LookupTable',
    'Simulink.Breakpoint',
    'Simulink.Signal',
    'Simulink.Bus',
    'Simulink.ConnectionBus',
    'Simulink.NumericType',
    'Simulink.AliasType',
    'Simulink.ValueType',
    'Simulink.data.dictionary.EnumTypeDefinition',
    'Simulink.VariantExpression',
    'Simulink.VariantControl',
    'Simulink.VariantVariable',
    'Simulink.VariantBank',
    'Simulink.VariantBankCoderInfo',
    // Variant configuration data is DESIGN data, both spellings of it, and that is
    // MATLAB's rule rather than a preference. It reads like configuration — it is what the
    // Variant Manager edits — and it used to be listed under `config` for that reason, at
    // which MATLAB refused the entry outright in BOTH formats:
    //   SLDD:sldd:ValueClassNotAcceptedInSection
    //   Values of class 'Simulink.VariantConfigurations' are not supported in the
    //   'Configurations' section of the dictionary.
    // The error names the SECTION, and that is the whole of it: a dictionary MATLAB wrote
    // carries its own `Simulink.VariantConfigurations` entry in the design namespace with
    // `IsDerived` 0, beside the Parameters and Buses, and `addEntry` into 'Design Data' is
    // what MATLAB itself accepts. The class name and the saveobj envelope were already
    // right — they match those bytes field for field — so nothing about the VALUE was ever
    // the problem, and moving the two names here is the fix. The Configurations section
    // takes a ConfigSet and a ConfigSetRef, and nothing else.
    'Simulink.VariantConfigurationData',
    'Simulink.VariantConfigurations',
    'CustomObject',
  ],
  arch: [
    'Constant',
    // No Simulink.Signal: a signal is design data. Architectural data models
    // interfaces, and its bus/connection-bus entries are the interface types.
    'Simulink.Bus',
    'Simulink.ConnectionBus',
    'Simulink.ServiceBus',
    'Simulink.data.dictionary.EnumTypeDefinition',
    'Simulink.AliasType',
    // Architectural data models value types and numeric types too (a ValueType
    // interface and a modeled NumericType both live in arch — see the fixture).
    'Simulink.ValueType',
    'Simulink.NumericType',
  ],
  // Two classes, measured: MATLAB accepts a ConfigSet and a ConfigSetRef here and refuses
  // everything else by name. See the variant-configuration note in `design` above for the
  // one that looked like it belonged here and does not.
  config: ['Simulink.ConfigSet', 'Simulink.ConfigSetRef'],
  other: ['MatlabVariable', 'Simulink.VariantExpression', 'Simulink.VariantVariable', 'CustomObject'],
};

// The classes a section holds, reads and takes a paste or a drop of, that addEntry makes no new
// entry of (_entryPlan). No MATLAB class is named CustomObject (CustomObject.md: a host-only
// passthrough), and MATLAB makes none ("Unrecognized function or variable 'CustomObject'", R2027a),
// so an entry made of it would be one MATLAB never made. Its node keeps createDefault, which the
// tests build one with; the Add gallery offers none (open-questions 15b).
const NOT_CREATED = new Set(['CustomObject']);

// The place in `value`, an entry's value as a copy holds it, of its first missing string (valuePlace),
// or null where it holds none: `x(2)` of a string array's second. A missing string is a null element
// of a String bag, as the MAT reader holds one; no dictionary holds one.
function missingStringAt(value: unknown, at: string): string | null {
  const found = valuePlace(value, at, (o) => {
    const elements = o._array_type === 'String' && Array.isArray(o._elements) ? (o._elements as unknown[]) : null;
    const i = elements ? elements.indexOf(null) : -1;
    return i === -1 ? null : elements!.length > 1 ? '(' + (i + 1) + ')' : '';
  });
  return found ? found.at : null;
}

// A new entry's metadata uuid: 32 random lowercase hex nibbles as 8-4-4-4-12, with no
// version or variant nibble fixed, which is the shape this function has always written.
//
// The uuid is an identity, not a secret. It only has to be unique: it tells two
// same-named entries apart (see entrySelector.ts), and the file stores it in plain text.
// It does not come from `Math.random`, because a uuid drawn from that published the
// generator's state: every nibble was four bits of V8's xorshift128+, and two uuids drawn
// back to back are enough to solve for its 128-bit state and predict the next uuid
// exactly (5 of 5 runs, Node 24). `crypto.getRandomValues` publishes nothing, and it is a
// global in every runtime this barrel runs in: Node 19+, so every VS Code extension host,
// browsers, and the Web Worker that hosts the web extension. Unlike `crypto.randomUUID`,
// it does not need a secure context, and it does not fix the version and variant nibbles.
export function generateUuid(): string {
  const hex = '0123456789abcdef';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) {
      s += '-';
    }
    s += hex[bytes[i] >> 4] + hex[bytes[i] & 15];
  }
  return s;
}

export default class SectionNode extends ContainerNode {
  label: string;
  iconId: string;
  // Moved by every change to which entries this section holds, so that the counts of its
  // namespace's names are known to be out of date unless they moved with it (_namespaceHolds).
  _entriesVersion = 0;

  constructor(name: string, parent: BaseNode | null, label: string, iconId: string) {
    super(name, parent);
    this.label = label;
    this.iconId = iconId;
  }

  get icon(): string {
    return this.iconId;
  }

  get displayName(): string {
    return this.label;
  }

  get tableColumnConfig(): TableColumnConfig {
    if (this.name === 'config') {
      return { columns: ['Name', 'Description', 'Status'] };
    }
    return { columns: ['Name', 'Value', 'DataType', 'Status', 'UsedBy'] };
  }

  // The classes an entry may be CREATED as here: what addEntry builds, but for the ones it makes
  // no new entry of (NOT_CREATED), and what a host offers to add. An empty list means "no
  // restriction".
  getAllowedTypes(): string[] {
    return ALLOWED_TYPES[this.name] || [];
  }

  // The classes an entry PASTED or DROPPED here may have: getAllowedTypes, and each
  // registered subclass of a class on it (registeredSubclasses.ts), so an mpt.Parameter is
  // admitted wherever a Simulink.Parameter may live. A paste copies an object MATLAB
  // already wrote, which is not the claim creating one would make (the maintainer's ruling
  // on C-180, 2026-10-16). Empty when getAllowedTypes is, meaning "no restriction" as it
  // does there. The list a host predicts a paste or a drop from, as allowsType is the
  // check it makes before one.
  getAdmittedTypes(): string[] {
    const allowed = this.getAllowedTypes();
    const admitted = allowed.slice();
    for (const subclass of registeredSubclasses()) {
      if (admitted.indexOf(subclass) === -1 && allowed.indexOf(superclassOf(subclass)!) !== -1) {
        admitted.push(subclass);
      }
    }
    return admitted;
  }

  // Whether an entry of `className` may be pasted or dropped into this section: listed by
  // getAdmittedTypes, or anything at all when the section has no allow-list. There are two
  // gates, and they differ by exactly the registered subclasses: this one, admission, which
  // a host asks before a paste or a drop (core's own parseEntry builds whatever it is
  // handed), and creation, which addEntry applies with getAllowedTypes alone.
  allowsType(className: string): boolean {
    return this.getAllowedTypes().length === 0 || this.getAdmittedTypes().indexOf(className) !== -1;
  }

  // Every entry name that shares this section's namespace, across all sibling
  // sections. Design and Architectural Data both live in NS_DESIGN, so they
  // share one flat name space — a paste into either must avoid colliding with
  // names in the other. Falls back to this section's own children when the
  // section is detached or its namespace is unknown.
  _namespaceEntryNames(): string[] {
    const myNs = SECTION_NAMESPACE[this.name];
    const siblings = (this.parent?.children ?? null) as BaseNode[] | null;
    if (!myNs || !siblings) {
      return this.children.map((c) => c.name);
    }
    const names: string[] = [];
    for (const s of siblings) {
      if (SECTION_NAMESPACE[(s as SectionNode).name] === myNs) {
        for (const c of s.children) {
          names.push(c.name);
        }
      }
    }
    return names;
  }

  // The editors a dictionary offers of an object's properties a MAT-file's object takes an edit of
  // (a Signal's Dimensions, a BusElement's DataType, a Bus's HeaderFile), its source's
  // (BaseNode.sourceOfferedEditor, sourceSetOffered, sourceRestorerFor, sourceUnofferedRefusal): judged by the rules a
  // MAT-file's save holds them to, and written into the object's bag (dictObjectEdit).
  _offeredEditor(entry: BaseNode, node: BaseNode, key: string): SourceOfferedEditor | null {
    return dictOfferedEditor(entry, node, key);
  }

  _setOffered(entry: BaseNode, node: BaseNode, key: string, text: string): SourceSetResult | null {
    return dictSetOffered(entry, node, key, text);
  }

  _offeredRestorer(entry: BaseNode, node: BaseNode, key: string): (() => void) | null {
    return dictOfferedRestorer(entry, node, key);
  }

  _unofferedRefusal(entry: BaseNode, node: BaseNode, key: string): string | null {
    return dictUnofferedRefusal(entry, node, key);
  }

  /**
   * Why `value`, a node built of the text an edit typed in for `node` (of `entry`), cannot be
   * written into this dictionary, or null where it can (MatlabVariableNode._refuseUnwritableValue,
   * as a MAT-file's _valueRefusal is asked): of a text dictionary, a numeric, logical or char empty
   * of another size than 0x0, whole or in a cell or a struct, which MATLAB's own text format reads
   * back as a 0x0 one (MatlabVariableNode._textDictionaryLostEmpty, the D15 ruling of the 2026-10-26
   * edit bash). A MAT stream it is written into keeps its size, and so does a binary dictionary.
   * Said of `path`, the node's own unless a Parameter names its Value.
   */
  _valueRefusal(entry: BaseNode, node: BaseNode, value: BaseNode, path = node.matlabPath): string | null {
    // Not in a MAT stream of a value above it, which writes it into the stream: its own is written as
    // its value's form says (_textDictionaryLostEmpty).
    const at = node as unknown as { _ownerFormat?: () => string | undefined; _openStream?: () => BaseNode | null };
    const made = value as unknown as { _textDictionaryLostEmpty?: () => { _dims?: number[]; className?: string } | null };
    const stream = at._openStream?.();
    if (at._ownerFormat?.() !== 'json' || (stream && stream !== node) || typeof made._textDictionaryLostEmpty !== 'function') {
      return null;
    }
    const lost = made._textDictionaryLostEmpty();
    if (!lost) {
      return null;
    }
    const what = withSizeArticle((lost._dims ?? []).join('x') + ' ' + (lost.className ?? ''));
    return 'Cannot edit "' + entry.name + '": ' + path + (lost === made ? ' would be ' : ' would hold ') + what + ', which a text dictionary holds only as a 0x0 one.';
  }

  // How many entries named `name` share this section's namespace: how many times
  // _namespaceEntryNames would list it, and the question an entry rename asks
  // (DataNode.setProperty). A lookup rather than that scan (F1-23): renaming every entry of a
  // 140,000-entry dictionary scanned 140,000 names a rename, more than 300 s for all of them.
  //
  // The counts are kept per namespace on the dictionary, for every section of the namespace to
  // share. They are made when first asked for, and kept as long as they can be shown to hold:
  // each section of the namespace is the one they were counted from, at the version they were
  // counted at (`_entriesVersion`). An entry added, removed or renamed moves the counts with it
  // (_entriesMoved), and anything else that changes which entries a section holds moves only
  // the version (BaseNode._replaceWith), so the counts are made again when next asked for.
  // Detached, or with no namespace, a section counts its own entries, as _namespaceEntryNames
  // lists them.
  _namespaceHolds(name: string): number {
    const counts = this._namespaceCounts();
    if (counts) {
      return counts.get(name) ?? 0;
    }
    let held = 0;
    for (const c of this.children) {
      if (c.name === name) {
        held++;
      }
    }
    return held;
  }

  addChild(child: BaseNode, index?: number): BaseNode {
    super.addChild(child, index);
    this._entriesMoved(null, child.name);
    return child;
  }

  removeChild(child: BaseNode): void {
    const before = this.children.length;
    super.removeChild(child);
    if (this.children.length < before) {
      this._entriesMoved(child.name, null);
    }
  }

  // One of my entries stopped being called `gone`, and one started being called `came` (either
  // null): an entry removed, added or renamed. The version moves, and the namespace's counts, when
  // they hold, move with it and go on holding.
  _entriesMoved(gone: string | null, came: string | null): void {
    const held = this._heldCounts();
    this._entriesVersion++;
    const at = held ? held.sections.indexOf(this) : -1;
    if (!held || at < 0) {
      return;
    }
    held.versions[at] = this._entriesVersion;
    if (gone !== null) {
      const left = (held.counts.get(gone) ?? 0) - 1;
      if (left > 0) {
        held.counts.set(gone, left);
      } else {
        held.counts.delete(gone);
      }
    }
    if (came !== null) {
      held.counts.set(came, (held.counts.get(came) ?? 0) + 1);
    }
  }

  // The sections of the dictionary that share this section's namespace, in the dictionary's
  // order, or null when this section has no dictionary or no namespace.
  _namespaceSections(): SectionNode[] | null {
    const myNs = SECTION_NAMESPACE[this.name];
    if (!myNs || !this.parent) {
      return null;
    }
    const sections: SectionNode[] = [];
    for (const s of this.parent.children) {
      if (SECTION_NAMESPACE[(s as SectionNode).name] === myNs) {
        sections.push(s as SectionNode);
      }
    }
    return sections;
  }

  // The counts the dictionary keeps for this section's namespace, when they still hold, else null.
  _heldCounts(): NamespaceCounts | null {
    const index = (this.parent as unknown as { _namespaceIndex?: Map<string, NamespaceCounts> } | null)?._namespaceIndex;
    const held = index ? index.get(SECTION_NAMESPACE[this.name]) : undefined;
    if (!held) {
      return null;
    }
    const sections = this._namespaceSections();
    if (
      sections &&
      held.sections.length === sections.length &&
      sections.every((s, i) => held.sections[i] === s && held.versions[i] === s._entriesVersion)
    ) {
      return held;
    }
    return null;
  }

  // The entry-name counts of this section's namespace (_namespaceHolds): the dictionary's, made
  // now when they do not hold. Null for a section with no dictionary or no namespace.
  _namespaceCounts(): Map<string, number> | null {
    const held = this._heldCounts();
    if (held) {
      return held.counts;
    }
    const sections = this._namespaceSections();
    if (!sections) {
      return null;
    }
    const counts = new Map<string, number>();
    for (const s of sections) {
      for (const c of s.children) {
        counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
      }
    }
    const dictionary = this.parent as unknown as { _namespaceIndex?: Map<string, NamespaceCounts> };
    if (!dictionary._namespaceIndex) {
      dictionary._namespaceIndex = new Map();
    }
    dictionary._namespaceIndex.set(SECTION_NAMESPACE[this.name], { sections, versions: sections.map((s) => s._entriesVersion), counts });
    return counts;
  }

  // One of MY entries was renamed — follow it wherever else the dictionary spells that
  // name. Today that is the System Composer catalog, which keys its definitions by
  // entry name and so decides an architectural entry's Kind by it: a catalog left
  // holding the old name reclassifies the entry (a struct type re-reads as a plain data
  // interface) the next time anything rebuilds it from a record.
  //
  // Called by DataNode.setProperty for the same reason `_renameField` is: a rename is
  // only complete when every structure keyed by the name has been told, and only the
  // parent knows which those are. Nested children (bus elements, struct fields) have no
  // such parent, which is what keeps an element that happens to share a definition's
  // name from moving the catalog under the entry that really carries it.
  //
  // Only for an entry of the namespace the catalog names (_namesCatalog): an Other Data entry
  // sharing a definition's name renamed the definition, which a save wrote into the catalog.
  _entryRenamed(oldName: string, newName: string): void {
    const dictionary = this.parent as unknown as { systemComposer?: SystemComposerCatalog | null } | null;
    if (this._namesCatalog()) {
      _renameInCatalog(dictionary?.systemComposer, oldName, newName);
    }
    // And the namespace's name counts (_namespaceHolds).
    this._entriesMoved(oldName, newName);
  }

  // A new entry of `className`, named `entryName` (or the class's default name),
  // with a counter appended when that name is taken in this section's namespace.
  // Returns null, and adds nothing, when the class is unknown, one no new entry is made of
  // (NOT_CREATED), or not on this section's allow-list (getAllowedTypes), or when the name is
  // not one MATLAB can load (validateMatlabName, the rule a rename applies), as asked for or
  // with its counter: a MAT-file's Add names one by the same rule (matlabName.newEntryName).
  //
  // The allow-list and not allowsType: a class admitted only to a paste (an mpt.Parameter,
  // whose node can build a default) is never created from scratch.
  addEntry(className: string, entryName?: string): DataNode | null {
    const plan = this._entryPlan(className, entryName);
    if ('why' in plan) {
      return null;
    }
    const node = plan.NodeClass.createDefault!(plan.name, this) as DataNode;

    node.metadata = {
      uuid: generateUuid(),
      namespace: SECTION_NAMESPACE[this.name] || NS_OTHER,
      lastmod: matlabTimestampNow(),
      modifiedby: '',
      isderived: this.name === 'arch' ? '1' : '0',
    };
    node.status = 'New';

    this.addChild(node);
    this._markSourceDirty();

    return node;
  }

  /**
   * Why addEntry makes no entry of `className` here, named `entryName` or the class's default name,
   * in words naming the section, or null where it makes one: the session's addEntryRefusal.
   */
  entryRefusal(className: string, entryName?: string): string | null {
    const plan = this._entryPlan(className, entryName);
    return 'why' in plan ? 'Cannot add ' + withArticle(className || 'entry') + ' to "' + this.label + '": ' + plan.why + '.' : null;
  }

  // The class an entry of `className` is made of here, and its name, or why none is made: a class
  // this package makes no new entry of, one the section does not hold (getAllowedTypes; a section
  // that does is named), and a name, asked for or with its counter, that is no MATLAB name.
  _entryPlan(className: string, entryName?: string): { NodeClass: ReturnType<typeof NodeRegistry.getClass> & object; name: string } | { why: string } {
    const NodeClass = NodeRegistry.getClass(className);
    if (!NodeClass || !NodeClass.createDefault || NOT_CREATED.has(className)) {
      return { why: 'this editor makes no new entry of that class' };
    }
    const allowed = this.getAllowedTypes();
    if (allowed.length !== 0 && allowed.indexOf(className) === -1) {
      const home = this.parent?.children.find((s) => s !== this && (s as SectionNode).getAllowedTypes?.().includes(className)) as SectionNode | undefined;
      return { why: 'the section holds no entry of that class' + (home ? ', which "' + home.label + '" does' : '') };
    }
    const { name, invalid } = newEntryName(entryName || NodeClass.defaultName, this._nameTaken());
    if (invalid !== null) {
      return { why: "'" + name + "' is not a name MATLAB can load (" + invalid + ')' };
    }
    return { NodeClass, name };
  }

  execAddEntry(className: string, entryName?: string): { node: DataNode; undo: () => void; redo: () => void } | null {
    const node = this.addEntry(className, entryName);
    if (!node) {
      return null;
    }
    const index = this.children.indexOf(node);
    // Its undo and redo change what a save writes as the add does, and mark the dictionary dirty
    // as it does: a dictionary saved after the add and then undone said it held nothing to save.
    return {
      node,
      undo: () => {
        this.removeChild(node);
        this._markSourceDirty();
      },
      redo: () => {
        this.addChild(node, index);
        this._markSourceDirty();
      },
    };
  }

  /** Why execRemoveEntry refuses `node`, as a clause, or null where it deletes it. */
  removeEntryRefusal(node: BaseNode): string | null {
    return this.children.includes(node) ? null : '"' + this.name + '" holds no such entry';
  }

  execRemoveEntry(node: BaseNode): { undo: () => void; redo: () => void } | null {
    const index = this.children.indexOf(node);
    if (index < 0) {
      return null;
    }
    this.removeChild(node);
    this._markSourceDirty();
    return {
      undo: () => {
        this.addChild(node, index);
        this._markSourceDirty();
      },
      redo: () => {
        this.removeChild(node);
        this._markSourceDirty();
      },
    };
  }

  _uniqueName(baseName: string): string {
    return uniqueName(baseName, this._nameTaken());
  }

  // Whether an entry of this section's namespace holds a name, as _namespaceEntryNames lists
  // them now: for the name a new entry is given (_uniqueName, addEntry).
  _nameTaken(): (name: string) => boolean {
    const existing = new Set(this._namespaceEntryNames());
    return (name) => existing.has(name);
  }

  // Always returns a node: parseValue's matcher chain falls through to
  // MatlabVariableNode for any shape it does not recognize, so an unfamiliar value
  // still models as something rather than dropping the entry out of the file.
  //
  // An entry handed in to a text dictionary, a paste or a drop, is held as the text dictionary
  // will hold it (MatWriter.textDictionaryForm), so that what it shows is what a save writes and
  // a reopen reads. A value copied out of a binary dictionary is in that reader's form, which a
  // text dictionary spells otherwise: an enumeration value, an empty that keeps its class and
  // size. Held in it, the pasted entry showed `GearMode.Reverse` or `<0x2 dSomeColors>`, and the
  // save wrote what a text dictionary holds for it, which reopened as `<1x1 GearMode>` or `[ ]`.
  // What this changes is what a save would change of the text dictionary's own entry: the binary
  // reader's forms, which say they are its own (XmlUtils.ENUM_KEY, XmlUtils.BINARY_EMPTY_KEY), an
  // encoded stream, complex text. So a value copied out of a text dictionary, or re-read from its
  // text, is held as the text dictionary holds its own. A value the save will refuse for what
  // MatWriter's budget measures (a MatBudgetError) is held as it came, so that the refusal is the
  // save's, naming the entry (DataNode.serialize). A file's own entries are read as they are
  // (_readEntry).
  //
  // But a value the text dictionary could hold only as a MAT stream MatWriter cannot write is
  // refused here, at the paste, naming the entry and the reason, and is not added (the
  // maintainer's ruling A1, 2026-10-15 evening). Held as it came, it was written as its bag, with
  // rank >= 3 dims, which MATLAB writes there for no value: a binary dictionary's N-D cell
  // holding a string, unedited or edited before the copy. The refusal is worded as the save's
  // refusal of such a stream (MatlabVariableNode._unwritableStream), and every paste and drop a
  // host makes builds its entry here.
  //
  // A host that re-reads an entry from the text dictionary's own text, as a view of the file's
  // JSON re-reads the element the user edited there, says so with `{ asRead: true }`. The entry
  // is then recorded as the file's read records it (MatWriter.heldByTextDictionary): dims
  // holding the infinity that JSON.parse makes of a hand-typed 1e400, and complex text with no
  // MAT stream to be instead, both of which a save writes back as read. Without the option, the
  // text that was accepted when the file was opened was refused once re-read, and so was the
  // entry's copy (F1-22). Nor is the re-read refused as a paste is for a MAT stream MatWriter
  // cannot write: the file's read holds such a value as it reads it (a hand-typed bag of an N-D
  // cell holding a string), and so does the re-read. It is for that re-read alone, never for a
  // paste, a drop or an undo record, whose value is not the file's text. In a binary dictionary
  // it records nothing, as that dictionary's read records nothing.
  parseEntry(rawEntry: Record<string, unknown>, systemComposer?: SystemComposerCatalog | null, options?: { asRead?: boolean }): DataNode {
    const text = (this.parent as { sourceFormat?: unknown } | null)?.sourceFormat === 'json';
    // An entry handed in with metadata that names no namespace — core's own API takes
    // `{ name, metadata: { uuid }, value }` — was written with an empty Namespace into a binary
    // dictionary and with none into a text one, and MATLAB refuses to open either file, whole
    // ("Failed to open file", R2027a, a pasted 5). It takes this section's namespace and
    // isderived, as a host's paste supplies them and addEntry stamps them: the two say which
    // section a reopened file puts the entry in. A text dictionary's writer writes metadata as
    // it is held, and MATLAB refuses to open one whose entry lacks any of uuid, namespace,
    // lastmod, modifiedby and isderived, so there a missing lastmod and modifiedby are stamped
    // as addEntry stamps them too; a binary writer stamps the save's time and an empty author
    // itself (regenerateEntryXml). The keys go in MATLAB's order, and what metadata names is
    // kept, a binary reader's _rawLastMod and lastModifiedBy as a lastmod and a modifiedby. The
    // metadata handed in is not changed. Metadata that is absent is left absent: with no uuid
    // there is no entry MATLAB would open either way. And a re-read of the dictionary's own text
    // (asRead) is stamped with nothing, as the file's read stamps nothing: it showed a Last
    // Modified of now for an entry the file holds none for, which a read of the file shows blank.
    const given = rawEntry.metadata;
    if (!options?.asRead && given !== undefined && given !== null && typeof given === 'object' && !Array.isArray(given)) {
      const md = given as Record<string, unknown>;
      const unnamed = (v: unknown) => v === undefined || v === null || v === '';
      const stamp: Record<string, unknown> = {};
      if (unnamed(md.namespace)) {
        stamp.namespace = SECTION_NAMESPACE[this.name] || NS_OTHER;
      }
      if (unnamed(md.isderived)) {
        stamp.isderived = this.name === 'arch' ? '1' : '0';
      }
      if (text && md.lastmod == null && md._rawLastMod == null) {
        stamp.lastmod = matlabTimestampNow();
      }
      if (text && md.modifiedby == null && md.lastModifiedBy == null) {
        stamp.modifiedby = '';
      }
      if (Object.keys(stamp).length !== 0) {
        const metadata: Record<string, unknown> = {};
        for (const key of ['uuid', 'namespace', 'lastmod', 'modifiedby', 'isderived']) {
          if (key in stamp) {
            metadata[key] = stamp[key];
          } else if (Object.prototype.hasOwnProperty.call(md, key)) {
            metadata[key] = md[key];
          }
        }
        for (const [key, val] of Object.entries(md)) {
          if (!Object.prototype.hasOwnProperty.call(metadata, key)) {
            setOwn(metadata, key, val);
          }
        }
        rawEntry = { ...rawEntry, metadata };
      }
    }
    // A value read out of a MAT-file's 'handle' opaque, as a dictionary holds it: without the
    // reader's mark (McosParser.withoutHandleMarks), and refused, naming it, where the reader did
    // not read it whole, as the dictionary would hold the class's defaults for the rest and MATLAB
    // load another value than the file's.
    if (rawEntry.value !== undefined && !options?.asRead) {
      const { value, unread } = withoutHandleMarks(rawEntry.value);
      if (unread) {
        throw new MatWriteError(
          'Cannot write "' + String(rawEntry.name ?? '') + '": its ' + (unread.at || 'value') + " is MATLAB's own handle data, which was not read whole (" + unread.why
            + '), and a dictionary would hold the rest as its defaults. Nothing was written.',
        );
      }
      // And no missing string (<missing>), at any depth: MATLAB does not save one in a dictionary
      // ("<missing> string element not supported", R2027a, at an entry, in a cell and in a struct),
      // so no copy of one is a copy MATLAB would make. A MAT-file holds one, and it was written, as
      // "" or as a null element MATLAB reads as "" (open-questions 14, group A).
      const lost = missingStringAt(value, String(rawEntry.name ?? ''));
      if (lost !== null) {
        throw new MatWriteError(
          'Cannot write "' + String(rawEntry.name ?? '') + '": ' + lost + ' is a missing string (<missing>), which MATLAB does not save in a dictionary. Nothing was written.',
        );
      }
      // And by the keys MATLAB saves alone (mcosShown.withoutShownOfSaved): a MAT-file's object
      // holds what MATLAB shows of it under other names too, which its copy carried into the file.
      // Here, the one place a value enters a dictionary from elsewhere, and not when it is written:
      // a file's own entries are saved as it holds them. Into a binary dictionary (`!text`), a
      // CoderInfo is also put in the order MATLAB writes one there.
      const saved = withoutShownOfSaved(value, !text);
      if (saved !== rawEntry.value) {
        rawEntry = { ...rawEntry, value: saved };
      }
    }
    // Before textDictionaryForm, which asks the record, as SlddNode.parse records each entry
    // before it is read.
    if (options?.asRead && text && rawEntry.value !== undefined) {
      heldByTextDictionary(rawEntry.value);
    }
    if (text && rawEntry.value !== undefined) {
      let value: unknown = rawEntry.value;
      try {
        value = oneWrite(() => textDictionaryForm(rawEntry.value));
      } catch (e) {
        if (!(e instanceof MatBudgetError)) {
          throw e;
        }
      }
      if (value !== rawEntry.value) {
        rawEntry = { ...rawEntry, value };
      }
    }
    const node = this._readEntry(rawEntry, systemComposer);
    // Not for a re-read of the file's own text, which the file's read holds as it reads it: a
    // save writes it back as read, and refuses it once it is edited (F1-22).
    if (text && !options?.asRead) {
      const refusal = oneWrite(() => node._unwritableStream());
      if (refusal) {
        this.removeChild(node);
        throw refusal;
      }
    }
    return node;
  }

  // Whether the System Composer catalog names this section's entries: those of the Design
  // namespace, Design and Architectural Data, where every architectural entry is. The catalog is
  // keyed by name, and a name is unique only within a namespace: Other Data and Configurations are
  // each their own, and an entry of either sharing a definition's name is not that definition.
  _namesCatalog(): boolean {
    return SECTION_NAMESPACE[this.name] === NS_DESIGN;
  }

  // parseEntry for an entry of the file being read, as the file holds it (SlddNode.parse).
  _readEntry(rawEntry: Record<string, unknown>, systemComposer?: SystemComposerCatalog | null): DataNode {
    const entryName = (rawEntry.name as string) || '';
    let dataNode = NodeRegistry.parseValue(rawEntry.value, entryName, this) as DataNode;
    dataNode.metadata = (rawEntry.metadata as Record<string, unknown>) || null;
    if (rawEntry.rawXml) {
      dataNode.rawXml = rawEntry.rawXml as string;
    }

    // A plain MATLAB variable in a DERIVED (Architectural Data) entry is a
    // Constant. parseValue picks the class from the value shape alone (it never
    // sees metadata), so we reclass here now that isderived is known — the single
    // seam that makes Design↔Arch conversion automatic (paste/drop rebinds
    // isderived before re-parsing, so the class follows the section).
    if (dataNode.isDerived) {
      dataNode = NodeRegistry.wrapDerivedVariable(dataNode);
    }

    // Classify entries via the systemcomposer catalog. The classification token
    // (e.g. 'DataInterface', 'StructType') drives the entry's user-facing Kind
    // and also distinguishes a StructType from a DataInterface (both Simulink.Bus).
    // Only the entries of the namespace it names (_namesCatalog).
    const classification = this._namesCatalog() ? _classificationOf(systemComposer, entryName) : null;
    if (classification) {
      dataNode.classification = classification;
      if (classification === 'StructType') {
        (dataNode as unknown as { isStructType?: boolean }).isStructType = true;
      }
    }

    this.addChild(dataNode);
    return dataNode;
  }
}
