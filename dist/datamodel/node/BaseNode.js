// Copyright 2026 The MathWorks, Inc.
import { buildPILayout } from './schemaBridge.js';
import { typeLinkCell } from './typeLinkCell.js';
import { buildOtherRows } from './piOther.js';
import { subscriptLabel, subscriptsLabel } from '../display/Subscript.js';
import { classColumnText } from '../display/DisplayConvention.js';
import { mcosStreamGateAbove, mcosStreamGateOf } from './mcosStream.js';
// Columns the webview renders through a dedicated, format-specific branch (they
// consume a plain string cell and manage their own editability). Generic
// editable columns (the schema Code Generation columns) are NOT in this set, so
// only they receive the editable-object cell shape in toRow.
const DEDICATED_COLUMNS = new Set(['Name', 'Value', 'DataType', 'Class', 'Kind', 'Description', 'UsedBy', 'Status']);
/**
 * The node at or above `node`, within its entry, whose value is still the encoded byte
 * stream it was read from (DataNode._encoded, set by DataNode._adoptEncoded) — or null
 * when there is none.
 *
 * Such a node is written as that stream and nothing else, so everything at or under it is
 * read-only: an edit there could not reach the file. Asked here rather than on DataNode
 * because the editability getters below are BaseNode's, and duck-typed for the same
 * reason owningEntryOf is: a source root and a section are ContainerNodes and carry no
 * `_encoded`, so the walk stops at the first container and answers null for them.
 *
 * Null too inside a stream that holds MCOS objects (mcosStream), edited or not: what may be
 * edited there is the stream's own answer, which every getter and setter asking this asks next
 * (sourceEditRefusal), and which refuses everything but an allow-listed property of one of its
 * objects with the words this gives. The stream is the gate for as long as its node is, so an
 * edit, which drops `_encoded` (DataNode._markModified), leaves the rest of it read-only.
 */
export function encodedHolderOf(node) {
    for (let n = node; n && !n.isContainer; n = n.parent) {
        if (mcosStreamGateOf(n)) {
            return null;
        }
        if (n._encoded) {
            return n;
        }
    }
    return null;
}
/**
 * Why the source `node` is in refuses an edit of `key` at `node`, in words, or null where it
 * takes it. `key` is 'Name' for the node's own name, and the property's key for anything else,
 * 'Value' for a child added or removed.
 *
 * A source answers for itself, through the first container above the node, which an entry is a
 * child of: a MAT-file, whose save writes only some edits (MatNode._editRefusal). A dictionary's
 * section and a model's do not answer, and take every edit their nodes take. Asked by every
 * editability getter below, by the structural gates (DataNode._encodedReadOnly), by the setters
 * (DataNode._refuseEncodedEdit, the rename) and by the session's editProperty, so that what the
 * table offers and what an edit is taken for are one answer. Duck-typed, as encodedHolderOf is:
 * this class imports no container.
 *
 * A dictionary value that is a MAT stream holding MCOS objects answers first, for every node in
 * it (mcosStream): its save writes an allow-listed property of one of its objects into the
 * stream's subsystem, and nothing else.
 */
export function sourceEditRefusal(node, key) {
    const { entry, source } = sourceOf(node);
    if (!entry) {
        return null;
    }
    const stream = mcosStreamGateAbove(node)?._editRefusal(entry, node, key);
    if (stream) {
        return stream;
    }
    const refuse = source?._editRefusal;
    return typeof refuse === 'function' ? refuse.call(source, entry, node, key) : null;
}
/**
 * Why the source `node` is in refuses `value` as what an edit of `key` at `node` makes it hold, in
 * words, or null where it writes it, or judges no value. The second half of sourceEditRefusal,
 * asked by a setter once it knows what the edit makes, before it makes it: a MAT-file writes some
 * values of an object's property and not others (MatNode._editValueRefusal), a Min above its Max,
 * say. `value` is the property as the node would hold it. A dictionary's section and a model's do
 * not answer.
 */
export function sourceValueRefusal(node, key, value) {
    const { entry, source } = sourceOf(node);
    if (!entry) {
        return null;
    }
    // A stream's first, as sourceEditRefusal asks it.
    const stream = mcosStreamGateAbove(node)?._editValueRefusal(entry, node, key, value);
    if (stream) {
        return stream;
    }
    const refuse = source?._editValueRefusal;
    return typeof refuse === 'function' ? refuse.call(source, entry, node, key, value) : null;
}
/** Whether the source `node` is in judges an edit's value at all (sourceValueRefusal), for a setter that must build it to ask. */
export function sourceJudgesValues(node) {
    const { entry, source } = sourceOf(node);
    return (!!entry &&
        (!!mcosStreamGateAbove(node) || typeof source?._editValueRefusal === 'function'));
}
/**
 * Why a stream `node` is in (mcosStream) refuses `value`, a node built of the text an edit typed
 * in for `node`, or null where it takes it, or `node` is in none: the stream's half of a source's
 * answer to a value typed in (MatNode._valueRefusal), asked of it first by the setter that asks
 * the source's (MatlabVariableNode._refuseUnwritableValue).
 */
export function streamValueRefusal(node, value) {
    const { entry } = sourceOf(node);
    const gate = entry ? mcosStreamGateAbove(node) : null;
    return gate ? gate._valueRefusal(entry, node, value) : null;
}
/** Whether `node` is in a stream that judges a value typed in for it (streamValueRefusal). */
export function inMcosStream(node) {
    return !!mcosStreamGateAbove(node);
}
/**
 * What the source `node` is in says the property `key` of `node` is, as its file will hold it once
 * saved, where that follows from the node's other properties rather than from an edit of its own;
 * undefined where it says nothing, which every source but a MAT-file, and a dictionary value's MAT
 * stream holding objects (mcosStream, asked first), does. Asked by a setter after an edit it
 * follows: a Simulink.Parameter's DataType, which their save writes as MATLAB's own `p.Value = v`
 * re-derives it (MatNode._followedProperty), so that the node shows what MATLAB will load.
 */
export function sourceFollowedProperty(node, key) {
    const { entry, source } = sourceOf(node);
    if (!entry) {
        return undefined;
    }
    const stream = mcosStreamGateAbove(node)?._followedProperty(entry, node, key);
    if (stream !== undefined) {
        return stream;
    }
    const follow = source?._followedProperty;
    return typeof follow === 'function' ? follow.call(source, entry, node, key) : undefined;
}
/**
 * The nodes outside `node`'s subtree that the source `node` is in keeps in step with what is in it
 * (sourceMirrorTwins): in a MAT-file, the other nodes of each object at, above or under `node`, two
 * variables holding one handle, say (MatNode._twinsOutside); in a dictionary value's MAT stream
 * holding objects, asked first, those of a handle two fields of the value share (mcosStream). None
 * for every other source. Asked by the session before an edit there, to keep its index of them as
 * it keeps the edited subtree's.
 */
export function sourceTwinsOutside(node) {
    const { entry, source } = sourceOf(node);
    if (!entry) {
        return [];
    }
    const stream = mcosStreamGateAbove(node);
    if (stream) {
        return stream._twinsOutside(node);
    }
    const twins = source?._twinsOutside;
    return typeof twins === 'function' ? twins.call(source, node) : [];
}
/**
 * After an edit at or under `node`, has the source bring every node it keeps in step with one
 * there back in step (MatNode._mirrorTwins: the other nodes of one object show the edit; a stream's
 * first, as sourceTwinsOutside asks it), and answers the nodes it changed so. Asked by the session
 * after every edit it makes or wraps.
 */
export function sourceMirrorTwins(node) {
    const { entry, source } = sourceOf(node);
    if (!entry) {
        return [];
    }
    const stream = mcosStreamGateAbove(node);
    if (stream) {
        return stream._mirrorTwins(node);
    }
    const mirror = source?._mirrorTwins;
    return typeof mirror === 'function' ? mirror.call(source, node) : [];
}
// The entry `node` is in, and the container above it, as sourceEditRefusal walks to them.
function sourceOf(node) {
    let entry = null;
    let n = node;
    while (n && !n.isContainer) {
        entry = n;
        n = n.parent;
    }
    return { entry, source: n };
}
/**
 * The prop in `props` that an edit naming `name` is an edit of: the one whose key or column is
 * `name`, which is how an edit committed in the 'Value' column reaches the atom that owns it (a
 * Variant's Condition/Specification), or else the one whose node field (`nodeProperty`) is
 * `name`. The field is the same property under MATLAB's spelling (`Complexity` for the
 * `complexity` column), so an edit by that name is checked, and its undo captured, as the
 * column's is (C-030). Key and column first, so a prop's own name wins over another's field.
 * One rule for DataNode._propFor, which every per-property gate asks, and for the session's
 * capture of the value an edit replaces (DataModel.readPropertyValue).
 */
export function propNamed(props, name) {
    return props.find((p) => p.key === name || p.column === name) ?? props.find((p) => p.nodeProperty === name);
}
export default class BaseNode {
    constructor(name, parent) {
        this.name = name;
        this.parent = parent;
        this.children = [];
    }
    get id() {
        return this.parent ? this.parent.id + '/' + this.name : this.name;
    }
    get icon() {
        return 'wsDefault';
    }
    // The raw class identity (e.g. 'Simulink.Bus', 'double'), shown in the Class
    // column.
    get className() {
        return '';
    }
    // The Class column's text, in the table and the Property Inspector alike: the class, and what
    // MATLAB's Workspace browser adds to it (DisplayConvention.classColumnText). A node whose
    // value can be complex or sparse says which it is (MatlabVariableNode).
    _classColumn() {
        return classColumnText(this.className);
    }
    // The user-facing Kind (e.g. 'Bus', 'MATLAB Variable'), shown in the Kind
    // column. Base nodes with no friendlier name fall back to the class identity.
    get kind() {
        return this.className;
    }
    // The value shown in the Data Type column. Base nodes carry no distinct data
    // type, so this falls back to the class identity; DataNode narrows this to a
    // real data type only (empty for object types).
    get dataType() {
        return this.className;
    }
    get displayValue() {
        return '';
    }
    get disabled() {
        return false;
    }
    // A positional element of a container whose parent is a bare array/cell/string:
    // its name is a synthetic index (1, 2, …), not a real identifier.
    get isIndexedName() {
        return !!(this.parent &&
            (this.parent._kind === 'cell' || this.parent._kind === 'array' || this.parent._kind === 'string'));
    }
    // The sole signal for graying a Name cell: this node's displayed name is a
    // synthetic positional subscript, not a user-assigned identifier. Covers bare
    // array/cell/string indices (isIndexedName), struct/object-array elements (which
    // carry an `_subscript` into their parent) and an explicit `_displayName` alias.
    // Structural and independent of file format — entries and struct FIELDS are never
    // elements, so they render normally.
    get isElementName() {
        return this.isIndexedName || !!this._subscript || !!this._displayName;
    }
    // True when this node's CHILDREN are the properties of a MATLAB class object
    // (ObjectNode overrides it). A class property's name is fixed by the class
    // definition, so — unlike a struct field — it can never be renamed. Children
    // consult `this.parent?.isObjectPropertyBag` in nameEditable. Kept as a getter
    // on BaseNode (rather than an `instanceof ObjectNode` check) to avoid the import
    // cycle ObjectNode → DataNode → BaseNode.
    get isObjectPropertyBag() {
        return false;
    }
    // True when NO child of this node can be renamed, whatever class the child is. The
    // same parent-side shape as isObjectPropertyBag, for a container whose own rule about
    // its children's names would otherwise reach only the children of its own class —
    // MatlabVariableNode, whose fields are fixed, and whose struct can hold a decoded MCOS
    // object built as a ParameterNode or a BusNode.
    get fixesChildNames() {
        return false;
    }
    get nameEditable() {
        // Inside a value that is still an encoded stream, a name is part of the stream. The
        // node holding the stream keeps its own: that name is written outside it.
        const holder = encodedHolderOf(this);
        if (holder && holder !== this) {
            return false;
        }
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
        if (this.parent?.fixesChildNames) {
            return false;
        }
        // Nor a name its source would not write (sourceEditRefusal).
        return !sourceEditRefusal(this, 'Name');
    }
    // Called on a node after a structural edit added or removed a child of `child`
    // — i.e. one of ITS children changed shape, not this node's own list. Every node
    // ignores it: a tree row's existence is normally decided once, at parse time.
    // Simulink.Parameter is the exception, because its Value row exists only while
    // the value has something to expand into (see ParameterNode), so an edit two
    // levels down can add or remove that row.
    childStructureChanged(_child) { }
    // What puts back, as it is now, what this node sets from `child` when told of a change to it
    // (childStructureChanged), or null where it sets nothing. Asked before an edit at or under
    // `child`, and called by the edit's undo once the undone change has been reported
    // (childEdit.holdersRestorer): setting it again from the restored child need not give what it
    // was. A Simulink.Parameter's Dimensions and Complexity are the one case (ParameterNode).
    childStructureRestorer(_child) {
        return null;
    }
    canAddChild() {
        return false;
    }
    addChildNode() {
        return null;
    }
    addChild(child, index) {
        if (index !== undefined && index >= 0) {
            this.children.splice(index, 0, child);
        }
        else {
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
    removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx >= 0) {
            this.children.splice(idx, 1);
            child.parent = null;
            // See addChild: the undo/redo closures reach here without marking dirty.
            this._invalidateTypeLinkIndex();
        }
    }
    _replaceWith(newNode) {
        if (!this.parent) {
            return false;
        }
        const idx = this.parent.children.indexOf(this);
        if (idx < 0) {
            return false;
        }
        newNode.parent = this.parent;
        this.parent.children[idx] = newNode;
        // A section counts the names of its entries (SectionNode._namespaceHolds), and a slot that
        // changes hands changes which names it holds: its version moves, so they are counted again.
        const holder = this.parent;
        if (typeof holder._entriesVersion === 'number') {
            holder._entriesVersion++;
        }
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
    _invalidateTypeLinkIndex() {
        let root = this;
        while (root.parent) {
            root = root.parent;
        }
        root._typeLinkIndex = null;
    }
    // Flag the owning file as having unsaved changes. The `dirty` flag lives on the
    // source root (SlddNode/MatNode/ModelNode) — the node that knows about a file —
    // so any mutation deep in the tree has to walk up to find it. Silently does
    // nothing when the node is detached or the root is not a source (a bare subtree
    // in a test, or a section whose parent is not yet attached): a mutation with no
    // file behind it has nothing to mark.
    _markSourceDirty() {
        let root = this;
        while (root.parent) {
            root = root.parent;
        }
        const source = root;
        if (source.dirty !== undefined) {
            source.dirty = true;
        }
        // And a source that keeps what it found of each of its entries is told which node changed,
        // so that it forgets what it found of that node's entry, and of no other (MatNode._nodeEdited).
        if (typeof source._nodeEdited === 'function') {
            source._nodeEdited(this);
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
    _usedByCell() {
        let root = this;
        while (root.parent) {
            root = root.parent;
        }
        const resolve = root._usageResolver;
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
    _typeLinkCell(cellText) {
        if (typeof cellText !== 'string' || cellText === '') {
            return undefined;
        }
        let root = this;
        while (root.parent) {
            root = root.parent;
        }
        const resolve = root._typeLinkResolver;
        if (typeof resolve !== 'function') {
            return undefined;
        }
        return typeLinkCell(cellText, resolve) ?? undefined;
    }
    flatten() {
        const result = [];
        const stack = [this];
        while (stack.length > 0) {
            const node = stack.pop();
            result.push(node);
            for (let i = node.children.length - 1; i >= 0; i--) {
                stack.push(node.children[i]);
            }
        }
        return result;
    }
    // Which slot of its parent this node occupies — O(1) where it can be, O(n) where it
    // has to be, and it decides which by CHECKING.
    //
    // An element's `name` already is its 1-based slot: every builder stamps String(i+1),
    // MatlabVariableNode's, StructNode's and ObjectNode's alike, and a sparse array names
    // its rows by their ordinals among its nonzeros (test/elementNameBase.test.ts holds
    // all of them to it). So the slot can be read instead of searched. But `name` is
    // data — nothing reindexes it when children are reordered — so a derived index is a
    // guess until the slot it names is confirmed to hold THIS node. Confirmed, it is the
    // answer; unconfirmed, the scan still is.
    //
    // This replaced a bare `children.indexOf(this)`, which is O(n) per element and so
    // O(n^2) per array. Measured on the 1000x1000 double that prompted this: 1.5 us at
    // index 0 rising to 325 us at index 999,999, ~161 s to label one entry, which was
    // most of the time the file spent failing to open. Eight lines below, the
    // struct/object-element path was already doing it this way (a stored
    // `_subscript.index`) and was 2000x faster on the same data — the two paths
    // answering one question two ways, with only one of them fast.
    _slotAmongSiblings() {
        const siblings = this.parent.children;
        const named = Number(this.name) - 1;
        if (named >= 0 && named < siblings.length && siblings[named] === this) {
            return named;
        }
        return siblings.indexOf(this);
    }
    get displayName() {
        const parent = this.parent;
        return (parent && this._labelUnder(() => parent.displayName)) || this._displayName || this.name;
    }
    /**
     * Where this node is, in MATLAB's spelling from its entry's name — `c{2}`, `st.sp`,
     * `pSp.Value`, `s(2).f` — its rows' own labels, joined by field and property names: what a
     * refused write names. A node a writer built on its own says where it was built for
     * (`_writtenAt`).
     */
    get matlabPath() {
        if (this._writtenAt) {
            return this._writtenAt.path;
        }
        const parent = this.parent;
        if (!parent || parent.isContainer) {
            return this.name;
        }
        return this._labelUnder(() => parent.matlabPath) || parent.matlabPath + '.' + this.name;
    }
    /**
     * This node's label as an element of its parent, the parent being called `parentLabel()`,
     * or null when it is not one (a field, a property, a node with no parent): displayName's
     * rule, and matlabPath's.
     */
    _labelUnder(parentLabel) {
        // A struct/object-array element, or a sparse array's non-zero: the subscript its
        // parse site recorded, read live from the parent's CURRENT displayed name, which is
        // what makes an element row follow a rename of the array above it. First, because a
        // sparse array's parent is an 'array' like any other, and its rows are not in slot
        // order.
        if (this._subscript && this.parent) {
            const s = this._subscript;
            return 'at' in s
                ? subscriptsLabel(parentLabel(), s.at, s.bracket)
                : subscriptLabel(parentLabel(), s.index, s.dims, s.order, s.bracket);
        }
        if (this.parent &&
            (this.parent._kind === 'cell' || this.parent._kind === 'array' || this.parent._kind === 'string')) {
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
            return subscriptLabel(parentLabel(), this._slotAmongSiblings(), this.parent._dims, this.parent._kind === 'array' ? 'row-major' : 'column-major', this.parent._kind === 'cell' ? '{}' : '()');
        }
        return null;
    }
    get valueEditable() {
        // A value still written as the encoded stream it was read from (encodedHolderOf).
        if (encodedHolderOf(this)) {
            return false;
        }
        const v = this.displayValue;
        if (v && v.charAt(0) === '<' && v.charAt(v.length - 1) === '>') {
            return false;
        }
        // Nor a value its source would not write (sourceEditRefusal).
        return !sourceEditRefusal(this, 'Value');
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
    get descriptionEditable() {
        return !encodedHolderOf(this) && !sourceEditRefusal(this, 'Description');
    }
    getPropInfo(PropClassRef) {
        const key = PropClassRef.key;
        let displayValue;
        if (PropClassRef.readValue) {
            displayValue = PropClassRef.readValue(this);
        }
        else {
            displayValue = PropClassRef.format(this[key]);
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
        if (editable && PropClassRef.editableFor) {
            editable = PropClassRef.editableFor(this);
        }
        // Every other column of a node whose value is still an encoded stream, schema-projected
        // ones included (Storage Class, Data Type…): they are all inside the stream. The Name
        // was answered above, by nameEditable.
        if (key !== 'Name' && encodedHolderOf(this)) {
            editable = false;
        }
        // And any its source would not write (sourceEditRefusal), the Name included: asked last,
        // and only of a property every rule above leaves editable, as it is the one that walks to
        // the source.
        if (editable && sourceEditRefusal(this, key)) {
            editable = false;
        }
        return {
            key,
            displayName: PropClassRef.displayName,
            value: this[PropClassRef.nodeProperty || key],
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
    toRow(pool) {
        const parentId = this.parent && !this.parent.isContainer ? this.parent.id : null;
        const props = this.getProperties();
        const row = {
            ID: this.id,
            parent: parentId,
            Status: this.status || '',
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
            }
            else if (colKey === 'Value') {
                // A 'select' editor carries its dropdown options on the cell so the
                // webview can render a combobox instead of a text input.
                if (info.editor === 'select') {
                    row.Value = { text: info.displayValue, editable: info.editable, editor: 'select', options: info.options || [] };
                }
                else {
                    row.Value = info.displayValue;
                }
                row._valueEditable = info.editable;
            }
            else if (info.editable && !DEDICATED_COLUMNS.has(colKey)) {
                // An editable GENERIC column (e.g. the schema Code Generation columns).
                // Carry the editor + options onto the cell so the webview can open the
                // right editor. Columns with a dedicated webview render branch (DataType,
                // Class, …) consume a plain string and set their own editability, so they
                // are excluded here and fall through to the string form below.
                row[colKey] = { text: info.displayValue, editable: true, editor: info.editor, options: info.options };
            }
            else {
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
            row.Class = this._classColumn();
        }
        if (!('Kind' in row)) {
            row.Kind = this.kind;
        }
        if (!('Description' in row)) {
            row.Description = this.Description || '';
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
    getProperties() {
        return [];
    }
    // The Property Inspector layout (ordered groups → props). Default: the
    // declarative schema layout for this node's class, when one exists (see
    // schema/classes/*.json + buildPILayout). Node subclasses without a schema
    // layout override this to author their groups directly; a subclass may also
    // override to fully replace the schema-driven layout. Returns null when neither
    // a schema layout nor an override applies → no curated groups (toPIObject may
    // still show the "Other" group).
    getPILayout() {
        return buildPILayout(this.className);
    }
    toPIObject() {
        const layout = this.getPILayout();
        if (!layout) {
            return null;
        }
        const properties = [];
        const groups = [];
        const obj = { _id: { nodeId: this.id } };
        // Top-level raw `_properties` keys the curated/schema layout already shows, so
        // the "Other" catch-all below never re-lists them. A prop names its consumed
        // keys via `sourceKeys`; absent that, it consumes [nodeProperty ?? key].
        const shownKeys = new Set();
        for (let g = 0; g < layout.length; g++) {
            const groupDef = layout[g];
            const groupItems = [];
            for (let i = 0; i < groupDef.items.length; i++) {
                const PropClassRef = groupDef.items[i];
                const info = this.getPropInfo(PropClassRef);
                // The same forward link the table's Data Type cell carries, from the same
                // _typeLinkCell — one derivation, so the two panes cannot disagree about which
                // half of `Bus: artFsAimCmd` is the link.
                //
                // `valueLink` and not `link`: the vendored PI's `link` anchors the property NAME
                // and mutes the value, which is right for a row whose label IS the link and wrong
                // for this one, where the value is. Nothing sets `link` today, so this is a new
                // field rather than an overloaded one. Spread conditionally so a property with no
                // link carries no key at all — the PI reads presence.
                //
                // Gated on the COLUMN, derived exactly as toRow derives it (:553-557), NOT on the
                // prop key: PropBaseType is keyed `BaseType` and declares `column = 'DataType'`, so
                // an alias's base type reaches this column under another key and the table links it.
                // A second hard-coded list of prop keys here would be free to drift from that one;
                // this way a prop marked `column: null` correctly links nothing, and a future prop
                // that joins the column gets the PI link with no change here.
                const piColumn = PropClassRef.column;
                const colKey = piColumn === null ? null : piColumn || info.key;
                const typeLink = colKey === 'DataType' ? this._typeLinkCell(info.displayValue) : undefined;
                const valueLink = typeLink && typeof typeLink === 'object' && typeof typeLink.linkTarget === 'string'
                    ? typeLink.linkTarget
                    : undefined;
                properties.push({
                    name: info.key,
                    displayName: info.displayName,
                    dataType: info.editor === 'bool' ? 'logical' : 'char',
                    renderer: info.editable ? 'rendererseditors/editors/TextBoxEditor' : 'rendererseditors/editors/LabelEditor',
                    inPlaceEditor: info.editable ? 'rendererseditors/editors/TextBoxEditor' : null,
                    editor: null,
                    editable: info.editable,
                    valid: true,
                    ...(valueLink === undefined ? {} : { valueLink }),
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
        const rawProps = this.serial?._properties;
        const otherRows = buildOtherRows(rawProps, shownKeys);
        if (otherRows.length > 0) {
            const otherItems = [];
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
    serialize() {
        return null;
    }
}
//# sourceMappingURL=BaseNode.js.map