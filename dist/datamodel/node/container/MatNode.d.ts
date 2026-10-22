import ContainerNode from '../ContainerNode.js';
import type BaseNode from '../BaseNode.js';
import type { PropClass, PIGroupDef, SourceInspectorRows, SourceOfferedEditor, SourceSetResult } from '../BaseNode.js';
import type { MatVariable } from '../data/MatlabVariableNode.js';
import type { ParseWarning } from '../../parser/ParseWarning.js';
import type { MatRecord, ParsedMat } from '../../parser/MatParser.js';
import { type McosSubsystemRecords } from '../../parser/McosSubsystemCodec.js';
import { type McosAppendSession, type McosNewObject } from '../../parser/McosTemplateMerge.js';
import { type McosTwin, type McosTwinGroup } from '../data/mcosObjectEdit.js';
import { MatSpotVerdicts, type MatObjectState, type MatObjectsWritten, type MatSharing } from '../data/matObjectEdit.js';
export type MatParse = Pick<ParsedMat, 'header' | 'variables'> & Partial<Pick<ParsedMat, 'warnings' | 'headerBytes' | 'subsystemOffset' | 'records' | 'framed' | 'unframed'>>;
export default class MatNode extends ContainerNode {
    header: string;
    dirty: boolean;
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
    _valueVerdicts: WeakMap<BaseNode, string | null>;
    _nameCounts: Map<string, number> | null;
    _countedAt: number;
    _entriesVersion: number;
    _objects: {
        record: MatRecord;
        records: McosSubsystemRecords;
    } | string | undefined;
    _objectStates: WeakMap<BaseNode, MatObjectState | string>;
    _propertyVerdicts: MatSpotVerdicts;
    _twins: McosTwinGroup[] | undefined;
    _twinOf: Map<BaseNode, McosTwinGroup> | undefined;
    _objectNodesById: Map<number, BaseNode[]> | undefined;
    _creation: {
        records: McosSubsystemRecords;
        original: McosSubsystemRecords;
        session: McosAppendSession;
        created: Map<BaseNode, McosNewObject>;
        rows: Map<BaseNode, number[]>;
    } | undefined;
    _busProjections: WeakMap<BaseNode, {
        rows: BaseNode[];
        state: MatObjectState | string;
    }>;
    _followed: {
        node: BaseNode;
        key: string;
        values: Record<string, unknown>;
    } | undefined;
    _addRefused: string | null;
    _classVerdicts: Map<string, string | null> | undefined;
    _rebuilt: {
        from: McosSubsystemRecords;
        live: BaseNode[];
        made: {
            records: McosSubsystemRecords;
            session: McosAppendSession;
            objects: Map<BaseNode, McosNewObject>;
            remap: (node: BaseNode, state: MatObjectState) => MatObjectState;
        };
    } | undefined;
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
    _nodeEdited(node: BaseNode): void;
    addChild(child: BaseNode, index?: number): BaseNode;
    removeChild(child: BaseNode): void;
    _entryRenamed(oldName: string, newName: string): void;
    _entriesMoved(gone: string | null, came: string | null): void;
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
    _editRefusal(entry: BaseNode, node: BaseNode, key: string, describe?: boolean): string | null;
    /**
     * Why an edit of `key` at `node`, at or under `object`, the node of an MCOS object in `entry`, is
     * refused whatever its value, or null where the value decides (_editValueRefusal): the edit of a
     * variable one of two of one name (duplicateWhy), of a part of the object that is no property a
     * save writes (matObjectEdit.matPropertyAt), of a file whose objects a save cannot read, of an
     * object it cannot find in them, and of a property the rules refuse (propertyRefusal). The
     * object's state is what this asks first, and is made then (_objectState). With `describe` false
     * (an editor drawn, BaseNode.sourceEditRefused) a part of the object refused is not described
     * (propertyAt): every other refusal is said as it is.
     */
    _objectKeyRefusal(entry: BaseNode, object: BaseNode, node: BaseNode, key: string, describe?: boolean): string | null;
    /**
     * Which other node of the file the object at `object` is too, and how (matObjectEdit.MatSharing):
     * a Parameter's or a Signal's twins (_twinGroups), each shown the edits of the others; any other
     * object another node holds the handle of, which would show none. Null for one no other node is.
     */
    _sharingOf(object: BaseNode): MatSharing;
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
    _objectNodesOfFile(): BaseNode[];
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
     * (McosPropertyRules.planPropertyEdits): a Min above its Max, a Value out of its DataType's range.
     * Asked by the setters before they set it (BaseNode.sourceValueRefusal), so that the edit is not
     * taken, rather than taken and then refused by the save.
     */
    _editValueRefusal(entry: BaseNode, node: BaseNode, key: string, value: unknown): string | null;
    /**
     * The rows of `node`'s Property Inspector this file offers in its property groups
     * (BaseNode.sourceInspectorRows), where `node` is an object's or a row under one: its Name; where
     * it stands, its Kind and Class; of a string, its DataType, as of every MATLAB value; and the
     * properties a save writes into the object
     * (matObjectEdit.matPropertyAt finds a spot of them), each of which takes an edit in some state of
     * it (a storage class other than Auto opens an Identifier; a NumericType's mode opens its scaling).
     * A property it saves no edit of (a Parameter's Dimensions, which follow its Value; a CoderInfo's
     * custom attributes) is shown read-only in "Other". The saved keys a row shows already are not
     * shown again there, stale until a save: a NumericType's SignednessBool, FixedExponent and
     * SlopeAdjustmentFactor, which its Signedness, FractionLength and Slope show; a Bus's elements,
     * which its rows are; a ValueType's own element. Of a MATLAB value, every row, and none of a
     * Description, which no MATLAB value has.
     */
    _inspectorRows(entry: BaseNode, node: BaseNode): SourceInspectorRows | null;
    /**
     * The editor this file offers of `key` at `node` (of `entry`), a property of an object's node
     * shown read-only in every other source (BaseNode.sourceOfferedEditor): one a save writes into
     * the object (matObjectEdit.matBagEditorOf), a text box, or a dropdown of the rules' choices or
     * true and false; null for any other. Whether it takes an edit now is _editRefusal's.
     */
    _offeredEditor(entry: BaseNode, node: BaseNode, key: string): SourceOfferedEditor | null;
    /**
     * The edit of `key` at `node` (of `entry`) to `text`, of a property this file offers an editor of
     * (_offeredEditor): the text taken as the editor takes it, held to what a save writes
     * (DataNode._refuseSourceValue, _editValueRefusal), and written into the node's property bag where
     * the node shows it, its field too where one shows it; for a NumericType, with what MATLAB's setter
     * changes beside it. Null for a key it offers no editor of, which the node's own setter takes.
     */
    _setOffered(entry: BaseNode, node: BaseNode, key: string, text: string): SourceSetResult | null;
    /**
     * What puts `key` of `node` (of `entry`) back as it stands now, a property this file offers an
     * editor of (_offeredEditor): every bag key and field its class's editors write, as they are, an
     * edit of a NumericType's changing more than its own. Null for any other key.
     */
    _offeredRestorer(entry: BaseNode, node: BaseNode, key: string): (() => void) | null;
    /**
     * What `key` of `node`, of `entry`, follows to once its edits are saved, for the node to show
     * (BaseNode.sourceFollowedProperty), or undefined: the DataType of a Simulink.Parameter's node, as
     * the save writes it with an edit of the Value (matObjectEdit.matShownDataType). Nothing else, and
     * nothing for a node that is no object's, or one whose object a save cannot find.
     */
    _followedProperty(entry: BaseNode, node: BaseNode, key: string): unknown;
    /**
     * The subsystem of this file as a save writes edits into it: its record, and its element read
     * whole into records (McosSubsystemCodec.readSubsystem); or why no object's edit can be written,
     * read once.
     */
    _mcosSubsystem(): {
        record: MatRecord;
        records: McosSubsystemRecords;
    } | string;
    /**
     * What the file holds of the object at `object`, and what its node held the first time this was
     * asked (matObjectEdit.matObjectStateOf), or why no edit of it can be written; made once a node,
     * the first time the editor asks about the object, which every edit of it does before it is
     * made, and kept.
     */
    _objectState(object: BaseNode): MatObjectState | string;
    /**
     * The state of the object at `object` as the gate judges an edit of it now: _objectState's, but
     * for a Bus with element rows added or removed since, whose state is projected onto a copy of
     * the records it was read from (matObjectEdit.projectedBusState), kept while its rows stay those.
     */
    _objectStateNow(object: BaseNode): MatObjectState | string;
    /**
     * For the save (MatFileWriter): the subsystem's record (null for a file that held none) and its
     * element with every edit of an object under `entries` written into it, the records it was read
     * as (`original`, which the save holds it to append-only), and the cells written; or null where
     * none of them holds one and no object was created. `entries` are the variables whose edits
     * reached objects only, whose records are written as they were, and those created as objects
     * (_createObject), whose subsystem is written while any of them is in the tree. Throws
     * MatWriteError for an edit it cannot write (matObjectEdit.matObjectSubsystemEdit).
     */
    _objectSubsystemEdit(entries: readonly BaseNode[]): ({
        record: MatRecord | null;
        original: McosSubsystemRecords;
    } & MatObjectsWritten) | null;
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
     *
     * Counted when first asked, and moved with every variable added, removed or renamed after
     * (_entriesMoved), so that a rename costs a lookup and not a count of every name: as a
     * dictionary's are (SectionNode._namespaceHolds, F1-23).
     *
     * A record the reader dropped without a name, one that does not inflate or holds no matrix,
     * is counted under none: what it would be called is not known, so an added or renamed
     * variable is not held to it (MatFileWriter.refuseDuplicates, likewise). Every such record
     * already breaks a rule MATLAB loads a file by (MatFileCheck: `compressed-wrapper`,
     * `top-level-type`), and for all of them but one past the inflate ceiling that is a rule
     * MATLAB fails the whole load on: no variable of the file is loaded beside it, whatever its name.
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
    /**
     * The classes a new variable of this file may be, which a host offers (its Add gallery) and
     * execAddEntry takes, exactly: a plain variable, the double 0; a 1x1 struct of no field; and each
     * of MAT_CREATABLE_CLASSES MATLAB's own default object of which merges into the file's subsystem
     * (_classRefusal: it reads whole, at a blob version an edit was measured on, and takes the merge),
     * or the file has none. None for a file no save of which can be written (_fileRefusal), whose view
     * takes no edit at all.
     */
    getAllowedTypes(): string[];
    _creationRefusal(): string | null;
    _classRefusal(className: string): string | null;
    execAddEntry(className?: string, entryName?: string): {
        node: BaseNode;
        undo: () => void;
        redo: () => void;
    } | null;
    /**
     * Why the last execAddEntry added nothing, in words naming this file, or null where it added a
     * variable: what a host shows of a refused Add, as it shows a refused edit's reason (DataModel's
     * addEntryRefusal).
     */
    addEntryRefusal(): string | null;
    _addRefusalOf(kind: 'plain' | 'struct' | 'object', className: string | undefined, entryName: string | undefined): string | null;
    /**
     * MATLAB's default object of `className`, merged into the subsystem this file's saves write
     * (McosTemplateMerge.mergeTemplateObject: MATLAB R2023b's own records of one, copied in the order
     * its `save -append` writes them), and the node of the variable `name` holding it, as a file
     * holding it shows it: the typed node of a Simulink object, a `string`'s node. Null where the
     * merge refuses.
     */
    _createObject(className: string, name: string): BaseNode | null;
    /**
     * The properties a child row added at `node` (of `entry`) starts with (BaseNode.sourceNewChildProperties):
     * of a Bus of the file's objects, MATLAB's default Simulink.BusElement, as this package reads one
     * from a file, which is what a save writes for the row (matObjectEdit.projectedBusState) but its
     * name. Undefined for any other node.
     */
    _newChildProperties(entry: BaseNode, node: BaseNode): Record<string, unknown> | undefined;
    /** The class-17 element a save writes for `node`, a variable created in this file as an object (_createObject), or null for any other. */
    _createdElement(node: BaseNode): Uint8Array | null;
    /**
     * The subsystem a save writes the objects created since the read into, which are in the tree now
     * (_liveCreations), and each one's object there. Where every object created is, the one they were
     * merged into (_creation). Where one was deleted since, merged again of the file's subsystem
     * alone, those in the tree in the order made, with one append session, so that none of a deleted
     * one is written, as MATLAB's own save writes none: and what was judged of each by its old ids is
     * the object's under its new ones (remap). Made once for a set of those.
     */
    _liveCreation(): {
        records: McosSubsystemRecords;
        session: McosAppendSession;
        objects: Map<BaseNode, McosNewObject>;
        remap: (node: BaseNode, state: MatObjectState) => MatObjectState;
    };
    /** The variables created as objects that are in the tree now. */
    _liveCreations(): BaseNode[];
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
/**
 * The classes a new variable of a MAT-file may be created as an object of (MATLAB's own default one,
 * merged from its records: McosTemplateMerge): every class with a template whose node offers an
 * editor of each property MATLAB sets. A file offers each where its subsystem takes the merge
 * (MatNode.getAllowedTypes, which a host's Add gallery is to read, per file).
 */
export declare const MAT_CREATABLE_CLASSES: readonly string[];
//# sourceMappingURL=MatNode.d.ts.map