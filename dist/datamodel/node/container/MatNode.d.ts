import ContainerNode from '../ContainerNode.js';
import type BaseNode from '../BaseNode.js';
import type { PropClass, PIGroupDef } from '../BaseNode.js';
import type { MatVariable } from '../data/MatlabVariableNode.js';
import type { ParseWarning } from '../../parser/ParseWarning.js';
import type { MatRecord, ParsedMat } from '../../parser/MatParser.js';
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
     *
     * Phase 2 of the MAT-file save widens the last of these, for the properties of an object it
     * writes into the subsystem.
     */
    _editRefusal(entry: BaseNode, node: BaseNode, key: string): string | null;
    /**
     * Why `value`, a node built of the text an edit typed in for `node`, of `entry`, cannot be
     * written into this file, or null where it can: a string, which MatWriter has no MAT class
     * for. Asked of the edit before it is made (MatlabVariableNode.setProperty), so that a value
     * that would leave the variable one a save refuses (freshRefusal) is never taken.
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