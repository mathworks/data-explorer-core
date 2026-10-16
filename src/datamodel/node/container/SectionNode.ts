// Copyright 2026 The MathWorks, Inc.

import ContainerNode from '../ContainerNode.js';
import type { TableColumnConfig } from '../ContainerNode.js';
import type BaseNode from '../BaseNode.js';
import type DataNode from '../DataNode.js';
// Not a static import of NodeClassMap: NodeRegistry is the deliberately
// dependency-free indirection (types only) that every node class goes through to
// reach the class map without a cycle. NodeClassMap installs itself into it.
import * as NodeRegistry from '../NodeRegistry.js';
import { matlabTimestampNow } from '../../parser/XmlUtils.js';
import { validateMatlabName } from '../../matlabName.js';
import { registeredSubclasses, superclassOf } from '../registeredSubclasses.js';
import { MatBudgetError, oneWrite, textDictionaryForm } from '../../parser/MatWriter.js';
import type { SystemComposerCatalog } from '../../parser/ScCatalog.js';
import {
  classificationOf as _classificationOf,
  renameInCatalog as _renameInCatalog,
} from '../../parser/ScCatalog.js';

import { NS_DESIGN, NS_CONFIGURATIONS, NS_OTHER, SECTION_NAMESPACE } from '../../SectionConstants.js';
export { NS_DESIGN, NS_CONFIGURATIONS, NS_OTHER, SECTION_NAMESPACE };

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

  // The classes an entry may be CREATED as here: what addEntry builds, and what a host
  // offers to add. An empty list means "no restriction".
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
  _entryRenamed(oldName: string, newName: string): void {
    const dictionary = this.parent as unknown as { systemComposer?: SystemComposerCatalog | null } | null;
    _renameInCatalog(dictionary?.systemComposer, oldName, newName);
  }

  // A new entry of `className`, named `entryName` (or the class's default name),
  // with a counter appended when that name is taken in this section's namespace.
  // Returns null, and adds nothing, when the class is unknown or not on this section's
  // allow-list (getAllowedTypes), or when the name is not one MATLAB can load
  // (validateMatlabName, the rule a rename applies). The name is checked as asked for
  // and again with the counter: the first stops an invalid name becoming a valid one by
  // suffixing ('end' when an 'end' is already present must not become 'end1'), and the
  // second stops a valid 63-character name growing past namelengthmax.
  //
  // The allow-list and not allowsType: a class admitted only to a paste (an mpt.Parameter,
  // whose node can build a default) is never created from scratch.
  addEntry(className: string, entryName?: string): DataNode | null {
    const NodeClass = NodeRegistry.getClass(className);
    if (!NodeClass || !NodeClass.createDefault) {
      return null;
    }

    const allowed = this.getAllowedTypes();
    if (allowed.length !== 0 && allowed.indexOf(className) === -1) {
      return null;
    }

    const baseName = entryName || NodeClass.defaultName;
    if (validateMatlabName(baseName) !== null) {
      return null;
    }
    const uniqueName = this._uniqueName(baseName);
    if (validateMatlabName(uniqueName) !== null) {
      return null;
    }
    const node = NodeClass.createDefault(uniqueName, this) as DataNode;

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

  execAddEntry(className: string, entryName?: string): { node: DataNode; undo: () => void; redo: () => void } | null {
    const node = this.addEntry(className, entryName);
    if (!node) {
      return null;
    }
    const index = this.children.indexOf(node);
    return {
      node,
      undo: () => {
        this.removeChild(node);
      },
      redo: () => {
        this.addChild(node, index);
      },
    };
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
      },
      redo: () => {
        this.removeChild(node);
      },
    };
  }

  _uniqueName(baseName: string): string {
    const existing = new Set(this._namespaceEntryNames());
    if (!existing.has(baseName)) {
      return baseName;
    }
    let i = 1;
    while (existing.has(baseName + i)) {
      i++;
    }
    return baseName + i;
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
  parseEntry(rawEntry: Record<string, unknown>, systemComposer?: SystemComposerCatalog | null): DataNode {
    const text = (this.parent as { sourceFormat?: unknown } | null)?.sourceFormat === 'json';
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
    if (text) {
      const refusal = oneWrite(() => node._unwritableStream());
      if (refusal) {
        this.removeChild(node);
        throw refusal;
      }
    }
    return node;
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
    const classification = _classificationOf(systemComposer, entryName);
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
