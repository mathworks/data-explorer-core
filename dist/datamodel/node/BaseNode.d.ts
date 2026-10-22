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
    unformat?: (text: string) => string;
    sourceKeys?: string[];
    format: (value: unknown) => string;
    editableFor?: (node: BaseNode) => boolean;
    sourceEditable?: boolean;
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
    Name?: {
        label: string;
        iconId: string;
        disabled: boolean;
        editable: boolean;
        element: boolean;
    };
    Value?: unknown;
    _valueEditable?: boolean;
    _descriptionEditable?: boolean;
    DataType?: string | {
        prefix?: string;
        text: string;
        linkTarget?: string;
    };
    Class?: string;
    Kind?: string;
    Description?: string;
    UsedBy?: string | {
        text: string;
        linkTarget?: string;
    } | {
        links: {
            text: string;
            linkTarget: string;
        }[];
    };
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
export type UsageResolver = (nodeId: string) => {
    blockName: string;
    linkTarget: string;
}[];
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
    propertySheet: {
        properties: unknown[];
        groups: unknown[];
    };
    objects: unknown[];
    showGroups: boolean;
    showDefaultGroup: boolean;
}
export type MatlabVariableKind = 'scalar' | 'array' | 'cell' | 'string';
export type ElementSubscript = {
    index: number;
    dims: number[] | undefined;
    order: ElementOrder;
    bracket: Bracket;
} | {
    at: number[];
    bracket: Bracket;
};
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
export declare function encodedHolderOf(node: BaseNode | null | undefined): BaseNode | null;
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
 *
 * `describe` false asks only whether the edit is refused (sourceEditRefused): a source may then
 * answer a refusal it has not put in words.
 */
export declare function sourceEditRefusal(node: BaseNode, key: string, describe?: boolean): string | null;
/**
 * Whether the source `node` is in refuses an edit of `key` at `node` (sourceEditRefusal), for an
 * editor drawn or not, which needs no reason: every editability getter asks it of every cell a
 * host shows, and a reason can name the node and more, each a walk to the root.
 */
export declare function sourceEditRefused(node: BaseNode, key: string): boolean;
/** A source's answer to sourceEditRefusal, for `node`, which is `entry` or a node under it. */
export type SourceEditRefusal = (entry: BaseNode, node: BaseNode, key: string, describe?: boolean) => string | null;
/**
 * Why the source `node` is in refuses `value` as what an edit of `key` at `node` makes it hold, in
 * words, or null where it writes it, or judges no value. The second half of sourceEditRefusal,
 * asked by a setter once it knows what the edit makes, before it makes it: a MAT-file writes some
 * values of an object's property and not others (MatNode._editValueRefusal), a Min above its Max,
 * say. `value` is the property as the node would hold it. A dictionary's section and a model's do
 * not answer.
 */
export declare function sourceValueRefusal(node: BaseNode, key: string, value: unknown): string | null;
/** Whether the source `node` is in judges an edit's value at all (sourceValueRefusal), for a setter that must build it to ask. */
export declare function sourceJudgesValues(node: BaseNode): boolean;
/**
 * Why a stream `node` is in (mcosStream) refuses `value`, a node built of the text an edit typed
 * in for `node`, or null where it takes it, or `node` is in none: the stream's half of a source's
 * answer to a value typed in (MatNode._valueRefusal), asked of it first by the setter that asks
 * the source's (MatlabVariableNode._refuseUnwritableValue).
 */
export declare function streamValueRefusal(node: BaseNode, value: BaseNode): string | null;
/** Whether `node` is in a stream that judges a value typed in for it (streamValueRefusal). */
export declare function inMcosStream(node: BaseNode): boolean;
/** A source's answer to sourceValueRefusal. */
export type SourceValueRefusal = (entry: BaseNode, node: BaseNode, key: string, value: unknown) => string | null;
/**
 * What the source `node` is in says the property `key` of `node` is, as its file will hold it once
 * saved, where that follows from the node's other properties rather than from an edit of its own;
 * undefined where it says nothing, which every source but a MAT-file, and a dictionary value's MAT
 * stream holding objects (mcosStream, asked first), does. Asked by a setter after an edit it
 * follows: a Simulink.Parameter's DataType, which their save writes as MATLAB's own `p.Value = v`
 * re-derives it (MatNode._followedProperty), so that the node shows what MATLAB will load.
 */
export declare function sourceFollowedProperty(node: BaseNode, key: string): unknown;
/** A source's answer to sourceFollowedProperty. */
export type SourceFollowedProperty = (entry: BaseNode, node: BaseNode, key: string) => unknown;
/**
 * The nodes outside `node`'s subtree that the source `node` is in keeps in step with what is in it
 * (sourceMirrorTwins): in a MAT-file, the other nodes of each object at, above or under `node`, two
 * variables holding one handle, say (MatNode._twinsOutside); in a dictionary value's MAT stream
 * holding objects, asked first, those of a handle two fields of the value share (mcosStream). None
 * for every other source. Asked by the session before an edit there, to keep its index of them as
 * it keeps the edited subtree's.
 */
export declare function sourceTwinsOutside(node: BaseNode): BaseNode[];
/**
 * After an edit at or under `node`, has the source bring every node it keeps in step with one
 * there back in step (MatNode._mirrorTwins: the other nodes of one object show the edit; a stream's
 * first, as sourceTwinsOutside asks it), and answers the nodes it changed so. Asked by the session
 * after every edit it makes or wraps.
 */
export declare function sourceMirrorTwins(node: BaseNode): BaseNode[];
/**
 * The properties a child row added at `node` starts with, as the source `node` is in holds a new
 * one, or undefined where it says none, which every source but a MAT-file does: in one, a Bus's
 * new element row is MATLAB's default Simulink.BusElement, as the file will hold it once saved
 * (MatNode._newChildProperties). Asked by the Add of a class whose new child is an object.
 */
export declare function sourceNewChildProperties(node: BaseNode): Record<string, unknown> | undefined;
/** An editor a source offers of a property its node shows read-only (sourceOfferedEditor). */
export interface SourceOfferedEditor {
    editor: 'text' | 'select';
    options?: string[];
}
/**
 * The editor the source `node` is in offers of `key` at `node`, a property the node shows
 * read-only in every other source (PropClass.sourceEditable), or null, which every source but a
 * MAT-file answers: there, an object's property its save writes (MatNode._offeredEditor), a
 * Signal's InitialValue or a NumericType's WordLength, say. Whether this node takes an edit of it
 * now is sourceEditRefusal's, asked after.
 */
export declare function sourceOfferedEditor(node: BaseNode, key: string): SourceOfferedEditor | null;
/** The answer of a setter: taken, or refused in words. */
export type SourceSetResult = true | {
    error: true;
    reason: string;
    invalidValue: string;
    validValue: string;
};
/**
 * The edit of `key` at `node` to `text`, made by the source that offers its editor
 * (sourceOfferedEditor), which writes it where the node shows it and holds it to what its save
 * writes; or null where it offers none, and the node's own setter makes the edit. Asked by
 * DataNode.setProperty once the edit is one the source takes at all (DataNode._refuseEncodedEdit).
 */
export declare function sourceSetOffered(node: BaseNode, key: string, text: string): SourceSetResult | null;
/**
 * What puts `key` of `node` back as it stands now, where its source made the edit
 * (sourceSetOffered) and so keeps what it changed with it, or null: what an undo of such an edit
 * runs (DataModel.editProperty), as a node's own restorer is.
 */
export declare function sourceRestorerFor(node: BaseNode, key: string): (() => void) | null;
/**
 * Which rows of a node's Property Inspector its source offers in its groups, which of its rows are
 * of no property the node has, and which saved keys a row shows already (sourceInspectorRows).
 */
export interface SourceInspectorRows {
    shows: (key: string) => boolean;
    hides: (key: string) => boolean;
    skips: readonly string[];
}
/**
 * Which rows of `node`'s Property Inspector its source offers in its property groups, by key, and
 * the saved keys of the node's bag a row it shows shows already, and the rows of properties the
 * node has none of; or null where it shows every row the node lays out: what every source but a
 * MAT-file answers. A MAT-file's object offers only the
 * rows of properties its save writes (and where it stands, its Kind and Class), each of which
 * takes an edit in some state of the object (MatNode._inspectorRows); every other row is shown
 * read-only in the "Other" group, as the keys no row shows are.
 */
export declare function sourceInspectorRows(node: BaseNode): SourceInspectorRows | null;
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
export declare function propNamed(props: PropClass[], name: string): PropClass | undefined;
export default class BaseNode {
    name: string;
    parent: BaseNode | null;
    children: BaseNode[];
    _displayName?: string;
    _subscript?: ElementSubscript;
    _kind?: MatlabVariableKind;
    _dims?: number[];
    _writtenAt?: {
        entry: string;
        path: string;
    };
    constructor(name: string, parent: BaseNode | null);
    get id(): string;
    get icon(): string;
    get className(): string;
    _classColumn(): string;
    get kind(): string;
    get dataType(): string;
    get displayValue(): string;
    get disabled(): boolean;
    get isIndexedName(): boolean;
    get isElementName(): boolean;
    get isObjectPropertyBag(): boolean;
    get fixesChildNames(): boolean;
    get nameEditable(): boolean;
    childStructureChanged(_child: BaseNode): void;
    childStructureRestorer(_child: BaseNode): (() => void) | null;
    canAddChild(): boolean;
    addChildNode(): BaseNode | null;
    addChild(child: BaseNode, index?: number): BaseNode;
    removeChild(child: BaseNode): void;
    _replaceWith(newNode: BaseNode): boolean;
    _invalidateTypeLinkIndex(): void;
    _markSourceDirty(): void;
    _usedByCell(): RowData['UsedBy'] | undefined;
    _typeLinkCell(cellText: unknown): RowData['DataType'] | undefined;
    flatten(): BaseNode[];
    private _slotAmongSiblings;
    get displayName(): string;
    /**
     * Where this node is, in MATLAB's spelling from its entry's name — `c{2}`, `st.sp`,
     * `pSp.Value`, `s(2).f` — its rows' own labels, joined by field and property names: what a
     * refused write names. A node a writer built on its own says where it was built for
     * (`_writtenAt`).
     */
    get matlabPath(): string;
    /**
     * This node's label as an element of its parent, the parent being called `parentLabel()`,
     * or null when it is not one (a field, a property, a node with no parent): displayName's
     * rule, and matlabPath's.
     */
    _labelUnder(parentLabel: () => string): string | null;
    get valueEditable(): boolean;
    get descriptionEditable(): boolean;
    getPropInfo(PropClassRef: PropClass): PropInfo;
    toRow(pool?: RowCellPool): RowData | null;
    getProperties(): PropClass[];
    getPILayout(): PIGroupDef[] | null;
    toPIObject(): PIObject | null;
    serialize(): unknown;
}
//# sourceMappingURL=BaseNode.d.ts.map