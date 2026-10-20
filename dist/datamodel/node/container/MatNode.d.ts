import ContainerNode from '../ContainerNode.js';
import type BaseNode from '../BaseNode.js';
import type { PropClass, PIGroupDef } from '../BaseNode.js';
import type { MatVariable } from '../data/MatlabVariableNode.js';
import type { ParseWarning } from '../../parser/ParseWarning.js';
import type { MatRecord, ParsedMat } from '../../parser/MatParser.js';
import { type McosSubsystem } from '../../parser/McosSubsystemEdit.js';
import { type McosObjectState, type McosPlannedCell, type McosTwin, type McosTwinGroup } from '../data/mcosObjectEdit.js';
export type MatParse = Pick<ParsedMat, 'header' | 'variables'> & Partial<Pick<ParsedMat, 'warnings' | 'headerBytes' | 'subsystemOffset' | 'records' | 'framed' | 'unframed'>>;
export default class MatNode extends ContainerNode {
    header: string;
    _dirty: boolean;
    _anonymousElements: MatVariable[];
    headerBytes: Uint8Array | null;
    records: MatRecord[] | null;
    subsystemOffset: number;
    framed: boolean;
    unframed: {
        at: number;
        reason: string;
    } | null;
    _recordNodes: Map<MatRecord, BaseNode>;
    _nodeRecords: Map<BaseNode, MatRecord>;
    _fileVerdict: string | null | undefined;
    _subsystem: MatRecord | null | undefined;
    _valueVerdicts: Map<BaseNode, string | null>;
    _nameCounts: Map<string, number> | null;
    _objects: {
        record: MatRecord;
        subsystem: McosSubsystem;
    } | string | undefined;
    _objectStates: WeakMap<BaseNode, McosObjectState | string>;
    _twins: McosTwinGroup[] | undefined;
    constructor(name: string);
    /**
     * The record `node` was read from, or null for a node no record became: a variable added
     * since the file was read, or any node of a tree with no records (`records` null).
     */
    recordOf(node: BaseNode): MatRecord | null;
    /**
     * The node `record` became, whether or not it is still in the tree (a deleted one's
     * `parent` is not this), or null for a record that became no node: the subsystem or
     * another unnamed element (`_anonymousElements`), and a record the reader dropped.
     */
    nodeOf(record: MatRecord): BaseNode | null;
    get displayName(): string;
    get readOnly(): boolean;
    get dirty(): boolean;
    set dirty(value: boolean);
    /**
     * Why an edit of `key` at `node`, which is `entry` or a node under it, is refused, as a
     * message naming the variable or the file, or null where a save of this file writes it.
     * `key` is 'Name' for `node`'s own name, and a property's key for anything else: 'Value'
     * for a value typed in, a child added or removed, and an element's or a field's edit.
     *
     *   - every edit, of a file no save of which can be written (_fileRefusal), its variables'
     *     delete and the addition of one included (execRemoveEntry, execAddEntry);
     *   - every edit of a variable stored after the subsystem, its name included: MATLAB does
     *     not read it there, and moved, what MATLAB loads would change. It can be deleted;
     *   - a variable's own name: taken, and written as its record with the name replaced;
     *   - a property of an MCOS object, at the top of the file, in a struct field or a cell, or an
     *     element of an object array (anything at or under its node, mcosObjectEdit.objectNodeAt),
     *     which a save writes into the subsystem cell that holds it and leaves the variable's
     *     record as it was: taken where the rules for the object take it whatever its value
     *     (_objectKeyRefusal; _editValueRefusal judges the value);
     *   - anything else, which writes the variable fresh: refused where the writer refuses that
     *     (freshRefusal: an object's typed node, a string, a function handle, a value not
     *     decoded, and a variable holding one at any depth), or where another variable of the
     *     file has its name;
     *   - and Add ('Add', MatlabVariableNode.canAddChild) on a struct that is not 1x1 or is an
     *     element of one, which is written, but not as the tree shows it. Add gives a struct a
     *     field row of its own: the rows of a struct array are its elements, so the row was an
     *     element of no fields the save did not write; a 0x0 struct's field was written with no
     *     element to hold it, which reads back as no field; and a field added to one element of
     *     a struct array is written into every element, as MATLAB adds one, `[]` in the others,
     *     which the tree did not show.
     */
    _editRefusal(entry: BaseNode, node: BaseNode, key: string): string | null;
    /**
     * Why an edit of `key` at `node`, at or under `object`, the node of an MCOS object in `entry`, is
     * refused whatever its value, or null where the value decides (_editValueRefusal): the edit of a
     * variable one of two of one name (duplicateWhy), of a part of the object that is no property a
     * save writes (mcosObjectEdit.propertyAt), of a file whose objects a save cannot read, of an
     * object it cannot find in them, and of a property the rules refuse (propertyRefusal). The
     * object's state is what this asks first, and is made then (_objectState).
     */
    _objectKeyRefusal(entry: BaseNode, object: BaseNode, node: BaseNode, key: string): string | null;
    /**
     * Why no edit of the object at `object` is taken for the other nodes that are the same object
     * (_twinGroups), each of which an edit is copied into (_mirrorTwins), as a clause, or null: an
     * edit of the object was made through another of them, its master, through which every later one
     * is made; or one of them is in a variable no edit of which a save writes, stored after the
     * subsystem, or one of two of one name.
     */
    _twinRefusal(object: BaseNode): string | null;
    /**
     * The nodes of each object two or more nodes of this file are, two variables holding one handle
     * (`r = h`) or a struct holding it in two fields, of a class whose properties a save writes; found
     * once, the first time an editor asks, which is before any edit of one: each node's state is made
     * then (_objectState), and what it shows of the object (mcosObjectEdit.twinOf). A node a variable's
     * delete takes out of the tree is still in its group, and is passed over while it is out
     * (_attachedTwins).
     */
    _twinGroups(): McosTwinGroup[];
    /** The group of the nodes that are the object `object` is, or null where no other node is it. */
    _twinGroupOf(object: BaseNode): McosTwinGroup | null;
    /** The members of `group` in the tree now, or none where fewer than two are. */
    _attachedTwins(group: McosTwinGroup): McosTwin[];
    /**
     * The nodes an edit at or under `root` is copied into (_mirrorTwins) that are not at or under it:
     * the other nodes of every object at or above or under `root`, for the session to keep its index of
     * them as it keeps the index of `root` (DataModel.mutateSubtree).
     */
    _twinsOutside(root: BaseNode): BaseNode[];
    /**
     * After an edit at or under `root`, made by any path: every other node of an object it reached
     * shows the object as the edit left it (mcosObjectEdit.mirrorTwins), and is edited so. Answers the
     * nodes copied into. Asked by the session after every edit it makes or wraps (DataModel.mutateSubtree,
     * addChildTo, deleteNodeById, and the undo and redo of each).
     */
    _mirrorTwins(root: BaseNode): BaseNode[];
    _twinsTouching(root: BaseNode): McosTwinGroup[];
    _entryOf(node: BaseNode): BaseNode | null;
    /**
     * Why `value`, what an edit of `key` at `node` (of `entry`) is about to make the property hold,
     * as the node would hold it (a bound as a number or undefined, text as a string, a Value as the
     * value node the edit makes), cannot be written into this file, or null where it can, or where
     * `node` is no object's. Judged with the object's other edits as the save will judge them
     * (McosEditRules.objectEditCells): a Min above its Max, a Value out of its DataType's range.
     * Asked by the setters before they set it (BaseNode.sourceValueRefusal), so that the edit is not
     * taken, rather than taken and then refused by the save.
     */
    _editValueRefusal(entry: BaseNode, node: BaseNode, key: string, value: unknown): string | null;
    /**
     * What `key` of `node`, of `entry`, follows to once its edits are saved, for the node to show
     * (BaseNode.sourceFollowedProperty), or undefined: the DataType of a Simulink.Parameter's node, as
     * the save writes it with an edit of the Value (mcosObjectEdit.shownDataType). Nothing else, and
     * nothing for a node that is no object's, or one whose object a save cannot find.
     */
    _followedProperty(entry: BaseNode, node: BaseNode, key: string): unknown;
    /**
     * The subsystem of this file as a save swaps cells in it: its record, and its element read whole
     * (McosSubsystemEdit.readMcosSubsystem); or why no object's edit can be written, read once.
     */
    _mcosSubsystem(): {
        record: MatRecord;
        subsystem: McosSubsystem;
    } | string;
    /**
     * What the file holds of the object at `object`, and what its node held the first time this was
     * asked (mcosObjectEdit.objectStateOf), or why no edit of it can be written; made once a node,
     * the first time the editor asks about the object, which every edit of it does before it is
     * made, and kept.
     */
    _objectState(object: BaseNode): McosObjectState | string;
    /**
     * For the save (MatFileWriter): the subsystem's record and its element with every edit of an
     * object under `entries` written into its cells, and the cells written; or null where none of
     * them holds one. `entries` are the variables whose edits reached objects only, whose records are
     * written as they were. Throws MatWriteError for an edit it cannot write
     * (mcosObjectEdit.objectSubsystemEdit).
     */
    _objectSubsystemEdit(entries: readonly BaseNode[]): {
        record: MatRecord;
        element: Uint8Array;
        cells: McosPlannedCell[];
    } | null;
    /**
     * Why `value`, a node built of the text an edit typed in for `node`, of `entry`, cannot be
     * written into this file, or null where it can: a string, which MatWriter has no MAT class
     * for. Asked of the edit before it is made (MatlabVariableNode.setProperty), so that a value
     * that would leave the variable one a save refuses (freshRefusal) is never taken. A value typed
     * as a Simulink.Parameter's whole Value, on its Value row, is the object's, and judged as one
     * (_editValueRefusal); one typed into a field of its struct Value, as what such a field may hold
     * (mcosObjectEdit.memberRefusal).
     */
    _valueRefusal(entry: BaseNode, node: BaseNode, value: BaseNode): string | null;
    /**
     * Why `node`, a variable of this file, cannot be renamed, or null where it can: its record is not
     * one whole element whose name a save can replace (MatFileWriter.renameWhy), which only a damaged
     * file holds. Asked by the rename itself (DataNode.setProperty) and not by the editability
     * getters, as finding out inflates the record: a rename refused so is refused before it is made.
     */
    _renameRefusal(node: BaseNode): string | null;
    /** Why no edit of this file is taken, or null (unsavableRefusal, structureRefusal). */
    _fileRefusal(): string | null;
    /** The subsystem's record (MatFileWriter.subsystemOf), found once: the records never change. */
    _subsystemRecord(): MatRecord | null;
    /**
     * How many variables of the file a save writes under `name`: the variables in the tree, and
     * each record that became none (one the reader dropped) under its own name, as a save writes
     * it (MatFileWriter.refuseDuplicates). A rename into a name another holds is refused for it
     * (DataNode.setProperty), naming this file (_namespaceLabel).
     */
    _namespaceHolds(name: string): number;
    /** Where a rename into a name already held is said to collide (DataNode.setProperty): this file. */
    get _namespaceLabel(): string;
    get sourceFormat(): string;
    get icon(): string;
    get NumberOfEntries(): number;
    getProperties(): PropClass[];
    getPILayout(): PIGroupDef[];
    getSection(): null;
    execAddEntry(className?: string, entryName?: string): {
        node: BaseNode;
        undo: () => void;
        redo: () => void;
    } | null;
    _uniqueName(baseName: string): string;
    execRemoveEntry(node: BaseNode): {
        undo: () => void;
        redo: () => void;
    } | null;
    getVariables(): MatVariable[];
    static fromParsed(parsed: MatParse, filename: string, options?: {
        nodeCeiling?: number;
    }): MatNode;
    _bindRecord(child: BaseNode, record: MatRecord | undefined): void;
    static _addVariables(node: MatNode, parsed: {
        variables: MatVariable[];
        warnings?: ParseWarning[];
    }, recordOf?: ReadonlyMap<MatVariable, MatRecord> | null): void;
}
//# sourceMappingURL=MatNode.d.ts.map