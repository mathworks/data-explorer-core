// Copyright 2026 The MathWorks, Inc.

import { buildPILayout } from './schemaBridge.js';
import { typeLinkCell } from './typeLinkCell.js';
import { buildOtherRows } from './piOther.js';
import { subscriptLabel } from '../display/Subscript.js';
import type { Bracket, ElementOrder } from '../display/Subscript.js';
import type RowCellPool from './RowCellPool.js';

export interface PropClass {
  key: string;
  displayName: string;
  column?: string | null;
  editor: string;
  nodeProperty?: string;
  readValue?: (node: BaseNode) => string;
  readOptions?: (node: BaseNode) => string[];
  // The inverse of `format`, for a prop whose DISPLAY differs from what is stored
  // — currently the ones shown as a quoted MATLAB literal. The table seeds its
  // in-place editor with the displayed text, so an edit arrives in display form;
  // without this the display decoration is stored as part of the value and grows
  // by one layer per edit. Omitted when format is the identity on strings.
  unformat?: (text: string) => string;
  // Top-level keys in the node's raw `_properties` bag that this prop consumes.
  // The PI "Other" catch-all group uses this to avoid re-listing already-shown
  // data. When omitted, toPIObject falls back to [nodeProperty ?? key].
  sourceKeys?: string[];
  format: (value: unknown) => string;
}

export interface PropInfo {
  key: string;
  displayName: string;
  value: unknown;
  displayValue: string;
  editable: boolean;
  editor: string;
  options?: string[];
}

export interface RowData {
  ID: string;
  parent: string | null;
  Status: string;
  // `element` marks a positional array/cell/string element (its name is a
  // synthetic index, not a real identifier) — the ONLY signal that grays a Name.
  // It is structural and format-independent. `editable` (whether the name can be
  // typed into) is separate and, together with document-level readonly, gates the
  // inline editor — it must never drive coloring.
  Name?: { label: string; iconId: string; disabled: boolean; editable: boolean; element: boolean };
  Value?: unknown;
  _valueEditable?: boolean;
  // Whether the Description cell takes an editor. Carried separately for the same
  // reason as `_valueEditable`: the column renders through a dedicated branch that
  // consumes a plain string.
  _descriptionEditable?: boolean;
  // A plain string for the far majority of rows, and a cell only when the value NAMES a
  // type definition in the same source — see typeLinkCell and _typeLinkCell. `prefix`
  // holds the qualifier of a value like `Bus: artFsAimCmd`, which renders as plain text
  // before the anchor so the underline marks exactly the name the dictionary holds. A
  // consumer that renders only `text` still shows the name; it loses the qualifier, which
  // is why the webview mirror of this type is pinned to it by a compile-time assert
  // (CoreCellFits, dex-tree-table.ts).
  DataType?: string | { prefix?: string; text: string; linkTarget?: string };
  Class?: string;
  Kind?: string;
  Description?: string;
  // The reverse projection: which blocks reference this definition. Filled by
  // toRow through the session's stamped resolver — see UsageResolver and
  // _usedByCell for the cell shape produced, the text chosen, and why a
  // definition nothing references gets no key here at all.
  UsedBy?: string | { text: string; linkTarget?: string } | { links: { text: string; linkTarget: string }[] };
  [key: string]: unknown;
}

/**
 * How a node reaches the reverse-usage index, which lives on the SESSION.
 *
 * A node has no reference to a session and must not acquire one: this package is
 * consumed by a VS Code extension, a CLI and an RPC server, and a node reaching for a
 * session would be reaching for whichever of them happened to build it. So the session
 * stamps this callback onto each source ROOT as it registers it — the same place, and in
 * the same way, registerSource already stamps `meta` and `warnings` — and a node walks
 * up to its root to find one, the walk `_markSourceDirty` already makes for the `dirty`
 * flag. Injection, not a dependency: nothing here imports the session, and a tree no
 * session registered simply has no resolver (see _usedByCell).
 *
 * Deliberately NARROWER than the session's own `NodeUsage`: the two fields a link cell
 * can hold, and nothing else. Naming NodeUsage here would have BaseNode import a type
 * from core for two thirds of it, and the narrow shape records at the seam exactly how
 * much of a usage a row is allowed to know. `NodeUsage[]` satisfies this, and stops
 * satisfying it the day either field is renamed — which is where that check belongs.
 */
export type UsageResolver = (nodeId: string) => { blockName: string; linkTarget: string }[];

/**
 * How a node reaches the forward TYPE index, which lives on the SESSION.
 *
 * The mirror of UsageResolver above, on the same seam and for the same reason: `UsedBy`
 * asks "what references this definition", a Data Type cell asks "which definition does
 * this name reach", and neither question is one a node can answer from inside itself.
 * Stamped on the source root by registerSource; a node walks up to find it.
 *
 * Takes the type NAME, not the cell text: the split of `Bus: artFsAimCmd` into a plain
 * qualifier and a linked name is a presentation decision that belongs with the cell (see
 * typeLinkCell), and pushing it across this seam would make the session responsible for
 * how a column reads. Returns the link target, or null when the name reaches nothing —
 * null rather than a throw, because a name with no definition behind it is the ordinary
 * case (every built-in type is one).
 */
export type TypeLinkResolver = (typeName: string) => string | null;

export interface PIGroupDef {
  group: string;
  items: PropClass[];
}

export interface PIObject {
  propertySheet: { properties: unknown[]; groups: unknown[] };
  objects: unknown[];
  showGroups: boolean;
  showDefaultGroup: boolean;
}

// Columns the webview renders through a dedicated, format-specific branch (they
// consume a plain string cell and manage their own editability). Generic
// editable columns (the schema Code Generation columns) are NOT in this set, so
// only they receive the editable-object cell shape in toRow.
const DEDICATED_COLUMNS = new Set(['Name', 'Value', 'DataType', 'Class', 'Kind', 'Description', 'UsedBy', 'Status']);

// Which of the four value shapes a MatlabVariableNode holds. Declared here, not in
// MatlabVariableNode, because `_kind` is declared on BaseNode (this class reads a
// parent's kind to derive indexed display names) and BaseNode must not depend on a
// subclass. Keeping it a closed union is load-bearing: MatlabVariableNode dispatches
// on it in five exhaustive switches with no fallback arm, so widening it to a fifth
// kind fails to compile (TS2366, "function lacks ending return statement") until
// every switch handles the new case, rather than silently returning '' at run time.
// Only serializeValue escapes the check, its `unknown` return type admitting
// undefined — but it cannot be reached without widening this union, which the other
// four switches refuse.
export type MatlabVariableKind = 'scalar' | 'array' | 'cell' | 'string';

// Where an element sits in its parent's array — everything needed to SPELL the
// element's row label, and nothing that is the label itself. A struct-array,
// object-array or .mat struct-array element is named by a subscript into its
// parent (`s(2,1)`), so the three parse sites that build such elements record
// this and displayName derives the text on demand.
//
// Deliberately not the finished string, which is what this replaced: baked at
// parse time, it went stale the moment the parent was renamed and every element
// row under `newName` still read `oldName(1,1)` until the file was reopened. The
// parent's own displayed name is read live, so a nested array's elements follow
// the row above them at any depth.
export interface ElementSubscript {
  index: number;
  dims: number[] | undefined;
  order: ElementOrder;
  bracket: Bracket;
}

export default class BaseNode {
  name: string;
  parent: BaseNode | null;
  children: BaseNode[];
  _displayName?: string;
  _subscript?: ElementSubscript;
  _kind?: MatlabVariableKind;
  _dims?: number[];

  constructor(name: string, parent: BaseNode | null) {
    this.name = name;
    this.parent = parent;
    this.children = [];
  }

  get id(): string {
    return this.parent ? this.parent.id + '/' + this.name : this.name;
  }

  get icon(): string {
    return 'wsDefault';
  }

  // The raw class identity (e.g. 'Simulink.Bus', 'double'), shown in the Class
  // column.
  get className(): string {
    return '';
  }

  // The user-facing Kind (e.g. 'Bus', 'MATLAB Variable'), shown in the Kind
  // column. Base nodes with no friendlier name fall back to the class identity.
  get kind(): string {
    return this.className;
  }

  // The value shown in the Data Type column. Base nodes carry no distinct data
  // type, so this falls back to the class identity; DataNode narrows this to a
  // real data type only (empty for object types).
  get dataType(): string {
    return this.className;
  }

  get displayValue(): string {
    return '';
  }

  get disabled(): boolean {
    return false;
  }

  // A positional element of a container whose parent is a bare array/cell/string:
  // its name is a synthetic index (1, 2, …), not a real identifier.
  get isIndexedName(): boolean {
    return !!(
      this.parent &&
      (this.parent._kind === 'cell' || this.parent._kind === 'array' || this.parent._kind === 'string')
    );
  }

  // The sole signal for graying a Name cell: this node's displayed name is a
  // synthetic positional subscript, not a user-assigned identifier. Covers bare
  // array/cell/string indices (isIndexedName), struct/object-array elements (which
  // carry an `_subscript` into their parent) and an explicit `_displayName` alias.
  // Structural and independent of file format — entries and struct FIELDS are never
  // elements, so they render normally.
  get isElementName(): boolean {
    return this.isIndexedName || !!this._subscript || !!this._displayName;
  }

  // True when this node's CHILDREN are the properties of a MATLAB class object
  // (ObjectNode overrides it). A class property's name is fixed by the class
  // definition, so — unlike a struct field — it can never be renamed. Children
  // consult `this.parent?.isObjectPropertyBag` in nameEditable. Kept as a getter
  // on BaseNode (rather than an `instanceof ObjectNode` check) to avoid the import
  // cycle ObjectNode → DataNode → BaseNode.
  get isObjectPropertyBag(): boolean {
    return false;
  }

  get nameEditable(): boolean {
    if (this.isIndexedName) {
      return false;
    }
    if (this._subscript || this._displayName) {
      return false;
    }
    // A class property name is fixed by the class definition.
    if (this.parent?.isObjectPropertyBag) {
      return false;
    }
    return true;
  }

  // Called on a node after a structural edit added or removed a child of `child`
  // — i.e. one of ITS children changed shape, not this node's own list. Every node
  // ignores it: a tree row's existence is normally decided once, at parse time.
  // Simulink.Parameter is the exception, because its Value row exists only while
  // the value has something to expand into (see ParameterNode), so an edit two
  // levels down can add or remove that row.
  childStructureChanged(_child: BaseNode): void {}

  canAddChild(): boolean {
    return false;
  }

  addChildNode(): BaseNode | null {
    return null;
  }

  addChild(child: BaseNode, index?: number): BaseNode {
    if (index !== undefined && index >= 0) {
      this.children.splice(index, 0, child);
    } else {
      this.children.push(child);
    }
    child.parent = this;
    // The STRUCTURAL choke point, and needed in ADDITION to _markSourceDirty: the undo and
    // redo closures SectionNode.execAddEntry/execRemoveEntry return call this and
    // removeChild directly, without marking the source dirty. Without this line, undoing
    // the addition of a type entry leaves a link pointing at an entry that no longer exists.
    this._invalidateTypeLinkIndex();
    return child;
  }

  removeChild(child: BaseNode): void {
    const idx = this.children.indexOf(child);
    if (idx >= 0) {
      this.children.splice(idx, 1);
      child.parent = null;
      // See addChild: the undo/redo closures reach here without marking dirty.
      this._invalidateTypeLinkIndex();
    }
  }

  _replaceWith(newNode: BaseNode): boolean {
    if (!this.parent) {
      return false;
    }
    const idx = this.parent.children.indexOf(this);
    if (idx < 0) {
      return false;
    }
    newNode.parent = this.parent;
    this.parent.children[idx] = newNode;
    this.parent = null;
    return true;
  }

  // Drop the source's cached type-definition index (see core/typeLinkIndex.ts).
  //
  // Invalidate-on-write, rebuild-on-read: one assignment here against one shallow walk on
  // the next row build, versus maintaining the set incrementally and needing every add,
  // remove, rename and undo path to be right forever. The rebuild also SELF-HEALS a hook
  // this class forgot to grow — the next unrelated edit corrects it — which an
  // incrementally-maintained set could not.
  //
  // Deliberately unconditional, unlike `dirty` below: a root that is not a source simply
  // gains a null property nothing reads, and guarding it would be a branch that exists to
  // protect nothing.
  _invalidateTypeLinkIndex(): void {
    let root: BaseNode = this;
    while (root.parent) {
      root = root.parent;
    }
    (root as unknown as { _typeLinkIndex?: unknown })._typeLinkIndex = null;
  }

  // Flag the owning file as having unsaved changes. The `dirty` flag lives on the
  // source root (SlddNode/MatNode/ModelNode) — the node that knows about a file —
  // so any mutation deep in the tree has to walk up to find it. Silently does
  // nothing when the node is detached or the root is not a source (a bare subtree
  // in a test, or a section whose parent is not yet attached): a mutation with no
  // file behind it has nothing to mark.
  _markSourceDirty(): void {
    let root: BaseNode = this;
    while (root.parent) {
      root = root.parent;
    }
    const source = root as unknown as { dirty?: boolean };
    if (source.dirty !== undefined) {
      source.dirty = true;
    }
    // Every mutation reaches here, so this is where a rename — the edit that actually moves
    // a link — is caught. A value edit drops the index too, needlessly; the rebuild rides
    // the row build that edit was already going to cause.
    this._invalidateTypeLinkIndex();
  }

  // The `UsedBy` cell for this node, or undefined when there is nothing to say.
  //
  // ABSENT, rather than `{ links: [] }` or `''`, for a definition nothing references —
  // and absent for every node the column means nothing for, a struct field, a bus
  // element, a block or an external-data file row among them (findUsages answers all of
  // those with nothing, deliberately: the file-level reverse direction is not part of
  // it). The two absences are NOT distinguished, because a row cannot honestly
  // distinguish them: with no model open, every definition in a dictionary has zero
  // usages, so an empty list would render an emphatic "nothing uses this" over a file
  // whose users are merely not open yet. Absence is not a claim. It is the same rule
  // registerSource applies to `warnings` — say something only when there is something to
  // say — and it is why a host must not read a missing cell as "unused".
  //
  // The text is the block's NAME and nothing else. Of the four facts a usage carries it
  // is the only one that is a display name at all: `blockType` is a Simulink class token,
  // `paramProperty` and `paramValue` are code, and `modelSrcId` is the HOST's key for a
  // file, which may be a full path or a URI with credentials in it and has no business in
  // a table cell. This is the data model's DEFAULT, not an opinion about what the column
  // should read: a host that wants 'Const (Constant)', 'mdlcases.mdl: Const' or '3
  // blocks' calls session.findUsages(nodeId) and builds its own cell from the four facts,
  // which is why NodeUsage pre-bakes no text. The cost is accepted and worth naming: two
  // blocks of the same name in two models render the same text and differ only in their
  // linkTarget.
  //
  // `linkTarget` is the usage's own, verbatim — resolveLink() turns it back into the
  // block node, so the cell is clickable with no second target grammar and nothing for
  // the host to assemble.
  _usedByCell(): RowData['UsedBy'] | undefined {
    let root: BaseNode = this;
    while (root.parent) {
      root = root.parent;
    }
    const resolve = (root as unknown as { _usageResolver?: UsageResolver })._usageResolver;
    // No resolver for a tree no session registered: a bare subtree in a test, or a node
    // detached mid-edit. Silent, for the reason _markSourceDirty is silent about a root
    // that is not a source — a projection with no session behind it has nothing to
    // report, and throwing here would take a whole row down over an empty column.
    if (typeof resolve !== 'function') {
      return undefined;
    }
    const usages = resolve(this.id);
    if (!usages || usages.length === 0) {
      return undefined;
    }
    // Always the multi-link arm, never the single `{ text, linkTarget }` one, even for a
    // single usage. The declared type permits three shapes; producing more than one makes
    // every host test for each, and the branch it forgets is the one-usage case, which is
    // the common one. One shape, one render path.
    return { links: usages.map((u) => ({ text: u.blockName, linkTarget: u.linkTarget })) };
  }

  // The Data Type cell's link, or undefined when the cell stays the plain string it
  // already is. The forward mirror of _usedByCell above, reached the same way: walk to the
  // source root, read the callback the session stamped there, and stay silent when there
  // is none (a bare subtree in a test, a node detached mid-edit).
  //
  // Takes the cell TEXT rather than reading `this.dataType`, and that is the whole point
  // of the method: `row.DataType` is written on two different lines of toRow — the schema
  // prop loop for a class whose schema lists dataType, the fallback for one whose schema
  // does not — and re-deriving the value here would be a third reading of it, free to
  // disagree with both. One post-step over whatever landed in the cell cannot.
  _typeLinkCell(cellText: unknown): RowData['DataType'] | undefined {
    if (typeof cellText !== 'string' || cellText === '') {
      return undefined;
    }
    let root: BaseNode = this;
    while (root.parent) {
      root = root.parent;
    }
    const resolve = (root as unknown as { _typeLinkResolver?: TypeLinkResolver })._typeLinkResolver;
    if (typeof resolve !== 'function') {
      return undefined;
    }
    return typeLinkCell(cellText, resolve) ?? undefined;
  }

  flatten(): BaseNode[] {
    const result: BaseNode[] = [];
    const stack: BaseNode[] = [this];
    while (stack.length > 0) {
      const node = stack.pop()!;
      result.push(node);
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i]);
      }
    }
    return result;
  }

  get displayName(): string {
    if (
      this.parent &&
      (this.parent._kind === 'cell' || this.parent._kind === 'array' || this.parent._kind === 'string')
    ) {
      // The order is NOT uniform across these three kinds, and assuming it was
      // mislabelled every non-square cell and string array in every format.
      //
      //   'array'  (numeric) ROW-major    -- MatParser.parseMatrix runs its
      //                                      numeric branch through
      //                                      transposeFromColMajor (:234).
      //   'cell'               COLUMN-major -- the cell branch (:317) stores the
      //   'string'                            elements in file order, and MATLAB
      //                                        writes them column-major. Nothing
      //                                        transposes them, on any path.
      //
      // Verified against MATLAB's own linearSubs/linearValues for cell2x3 and
      // strMat in all four formats -- see test/cellElementOrder.test.ts. A square
      // fixture cannot see this: the label SET is right either way, only the
      // label->value pairing is wrong.
      return subscriptLabel(
        this.parent.displayName,
        this.parent.children.indexOf(this),
        this.parent._dims,
        this.parent._kind === 'array' ? 'row-major' : 'column-major',
        this.parent._kind === 'cell' ? '{}' : '()',
      );
    }
    // A struct/object-array element: the same derivation, off the spec its parse
    // site recorded. Read live from the parent's CURRENT displayed name, which is
    // what makes an element row follow a rename of the array above it.
    if (this._subscript && this.parent) {
      const s = this._subscript;
      return subscriptLabel(this.parent.displayName, s.index, s.dims, s.order, s.bracket);
    }
    return this._displayName || this.name;
  }

  get valueEditable(): boolean {
    const v = this.displayValue;
    if (v && v.charAt(0) === '<' && v.charAt(v.length - 1) === '>') {
      return false;
    }
    return true;
  }

  // Whether a Description typed onto this row could be SAVED — the third member of the
  // nameEditable/valueEditable family, and one for the same reason: the Description
  // column exists for every row, but only a node that serializes a MATLAB property bag
  // has anywhere to put one. A plain variable (and a struct) goes out as
  // `{name, metadata, value}`, so a Description set on it showed in the cell and was
  // gone on the next read of the file.
  //
  // True here, false in the two classes that cannot hold one, rather than the other way
  // round: every Simulink object can be described, and a new class that cannot has to
  // say so — which is the same direction nameEditable and valueEditable are declared in.
  //
  // It used to be answered by `valueEditable`, which is a different question: a
  // Parameter whose value displays as a `<1x12 double>` summary takes no value editor
  // and can still be described.
  get descriptionEditable(): boolean {
    return true;
  }

  getPropInfo(PropClassRef: PropClass): PropInfo {
    const key = PropClassRef.key;
    let displayValue: string;
    if (PropClassRef.readValue) {
      displayValue = PropClassRef.readValue(this);
    } else {
      displayValue = PropClassRef.format((this as unknown as Record<string, unknown>)[key]);
    }

    let editable = PropClassRef.editor !== 'label';
    if (key === 'Name') {
      editable = editable && this.nameEditable;
    }
    if (key === 'Value') {
      editable = editable && this.valueEditable;
    }
    // Consulted HERE and not only in toRow so the property inspector honours it too: it
    // builds its fields from getPropInfo, and it offered the same unkeepable Description
    // the table did.
    if (key === 'Description') {
      editable = editable && this.descriptionEditable;
    }

    return {
      key,
      displayName: PropClassRef.displayName,
      value: (this as unknown as Record<string, unknown>)[PropClassRef.nodeProperty || key],
      displayValue,
      editable,
      editor: PropClassRef.editor,
      options: PropClassRef.readOptions ? PropClassRef.readOptions(this) : undefined,
    };
  }

  // `pool`, when a caller building MANY rows brings one, shares each cell with the rows
  // that already hold the same value — 566 bytes per row down to 314 on a large
  // dictionary. Optional, and absent it this returns exactly what it always did: the
  // pooling is one call at the bottom of this method, over the finished row, so there is
  // no second construction path that could disagree about a value. See RowCellPool.
  toRow(pool?: RowCellPool): RowData | null {
    const parentId =
      this.parent && !(this.parent as unknown as { isContainer?: boolean }).isContainer ? this.parent.id : null;
    const props = this.getProperties();
    const row: RowData = {
      ID: this.id,
      parent: parentId,
      Status: (this as unknown as { status?: string }).status || '',
    };

    for (let i = 0; i < props.length; i++) {
      const info = this.getPropInfo(props[i]);
      const column = props[i].column;
      if (column === null) {
        continue;
      }
      const colKey = column || info.key;

      if (colKey === 'Name') {
        row.Name = { label: info.displayValue, iconId: this.icon, disabled: this.disabled, editable: info.editable, element: this.isElementName };
      } else if (colKey === 'Value') {
        // A 'select' editor carries its dropdown options on the cell so the
        // webview can render a combobox instead of a text input.
        if (info.editor === 'select') {
          row.Value = { text: info.displayValue, editable: info.editable, editor: 'select', options: info.options || [] };
        } else {
          row.Value = info.displayValue;
        }
        row._valueEditable = info.editable;
      } else if (info.editable && !DEDICATED_COLUMNS.has(colKey)) {
        // An editable GENERIC column (e.g. the schema Code Generation columns).
        // Carry the editor + options onto the cell so the webview can open the
        // right editor. Columns with a dedicated webview render branch (DataType,
        // Class, …) consume a plain string and set their own editability, so they
        // are excluded here and fall through to the string form below.
        row[colKey] = { text: info.displayValue, editable: true, editor: info.editor, options: info.options };
      } else {
        row[colKey] = info.displayValue;
      }
    }

    if (!row.Name) {
      row.Name = { label: this.displayName, iconId: this.icon, disabled: this.disabled, editable: this.nameEditable, element: this.isElementName };
    }
    if (!('Value' in row)) {
      row.Value = this.displayValue;
      row._valueEditable = this.valueEditable;
    }
    if (!('DataType' in row)) {
      row.DataType = this.dataType;
    }
    if (!('Class' in row)) {
      row.Class = this.className;
    }
    if (!('Kind' in row)) {
      row.Kind = this.kind;
    }
    if (!('Description' in row)) {
      row.Description = (this as unknown as { Description?: string }).Description || '';
    }
    // Unconditional, and beside the cell rather than inside it: Description renders
    // through a dedicated webview branch that consumes a plain string (see
    // DEDICATED_COLUMNS), so the editability has to travel as its own key — the same
    // arrangement `_valueEditable` already has, and for the same reason.
    row._descriptionEditable = this.descriptionEditable;

    // The reverse projection, reached through the resolver the session stamped on this
    // node's source root rather than through a session reference a node must not hold.
    // This is the seam that makes the column non-blank in a host that changed nothing:
    // `toRow` is called from nowhere inside this package, so a session-level row builder
    // alone would leave every existing caller with the blank column item 4 is about. The
    // two subclasses that override toRow reach this through super.toRow()
    // (DataSourceNode, ModelReferenceNode); ModelBlockNode builds its row from scratch
    // and is the one that must NOT have it, a block being the subject of a usage rather
    // than its object. Assigned only when there IS a usage — see _usedByCell.
    const usedBy = this._usedByCell();
    if (usedBy !== undefined) {
      row.UsedBy = usedBy;
    }

    // The forward projection, and the mirror of UsedBy above. ONE post-step, deliberately
    // downstream of BOTH lines that write this cell — the schema prop loop and the
    // fallback — rather than a branch inside each. Two implementations of one rule is the
    // failure this codebase keeps paying for; a post-step over the finished cell cannot
    // drift from itself. Assigned only when there IS a link, so an unlinked cell stays the
    // plain string it has always been and no consumer sees a new shape for an old value.
    const typeLink = this._typeLinkCell(row.DataType);
    if (typeLink !== undefined) {
      row.DataType = typeLink;
    }

    return pool ? pool.share(row) : row;
  }

  getProperties(): PropClass[] {
    return [];
  }

  // The Property Inspector layout (ordered groups → props). Default: the
  // declarative schema layout for this node's class, when one exists (see
  // schema/classes/*.json + buildPILayout). Node subclasses without a schema
  // layout override this to author their groups directly; a subclass may also
  // override to fully replace the schema-driven layout. Returns null when neither
  // a schema layout nor an override applies → no curated groups (toPIObject may
  // still show the "Other" group).
  getPILayout(): PIGroupDef[] | null {
    return buildPILayout(this.className);
  }

  toPIObject(): PIObject | null {
    const layout = this.getPILayout();
    if (!layout) {
      return null;
    }

    const properties: unknown[] = [];
    const groups: unknown[] = [];
    const obj: Record<string, unknown> = { _id: { nodeId: this.id } };

    // Top-level raw `_properties` keys the curated/schema layout already shows, so
    // the "Other" catch-all below never re-lists them. A prop names its consumed
    // keys via `sourceKeys`; absent that, it consumes [nodeProperty ?? key].
    const shownKeys = new Set<string>();

    for (let g = 0; g < layout.length; g++) {
      const groupDef = layout[g];
      const groupItems: unknown[] = [];
      for (let i = 0; i < groupDef.items.length; i++) {
        const PropClassRef = groupDef.items[i];
        const info = this.getPropInfo(PropClassRef);
        properties.push({
          name: info.key,
          displayName: info.displayName,
          dataType: info.editor === 'bool' ? 'logical' : 'char',
          renderer: info.editable ? 'rendererseditors/editors/TextBoxEditor' : 'rendererseditors/editors/LabelEditor',
          inPlaceEditor: info.editable ? 'rendererseditors/editors/TextBoxEditor' : null,
          editor: null,
          editable: info.editable,
          valid: true,
        });
        groupItems.push({ name: info.key, type: 'property' });
        obj[info.key] = info.displayValue;
        const keys = PropClassRef.sourceKeys ?? [PropClassRef.nodeProperty ?? PropClassRef.key];
        for (const k of keys) {
          shownKeys.add(k);
        }
      }
      // Schema-driven classes open with a fixed "General" identity group, so group
      // titles are normally literal. A layout MAY still embed the `{name}` token to
      // fold its object name into a title (buildPILayout has no node instance); the
      // node substitutes its displayName here. Titles without the token pass through.
      const displayName = groupDef.group.replace('{name}', this.displayName);
      groups.push({
        name: displayName.replace(/[^A-Za-z0-9]+/g, '') + 'Group',
        type: 'group',
        displayName,
        items: groupItems,
        expanded: true,
      });
    }

    // "Other" catch-all: every remaining raw property this node carries but the
    // curated/schema layout did not surface. Namespaced property names ('Other.X')
    // avoid colliding with a group prop that shares a bare key.
    const rawProps = (this as unknown as { serial?: { _properties?: unknown } }).serial?._properties;
    const otherRows = buildOtherRows(rawProps, shownKeys);
    if (otherRows.length > 0) {
      const otherItems: unknown[] = [];
      for (const row of otherRows) {
        const propName = 'Other.' + row.name;
        properties.push({
          name: propName,
          displayName: row.name,
          dataType: 'char',
          renderer: 'rendererseditors/editors/LabelEditor',
          inPlaceEditor: null,
          editor: null,
          editable: false,
          valid: true,
        });
        otherItems.push({ name: propName, type: 'property' });
        obj[propName] = row.value;
      }
      groups.push({
        name: 'OtherGroup',
        type: 'group',
        displayName: 'Other',
        items: otherItems,
        expanded: false,
      });
    }

    return {
      propertySheet: { properties, groups },
      objects: [obj],
      showGroups: true,
      showDefaultGroup: false,
    };
  }

  serialize(): unknown {
    return null;
  }
}
