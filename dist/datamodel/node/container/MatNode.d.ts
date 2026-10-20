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
    get sourceFormat(): string;
    get icon(): string;
    get NumberOfEntries(): number;
    getProperties(): PropClass[];
    getPILayout(): PIGroupDef[];
    getSection(): null;
    execAddEntry(_className?: string, entryName?: string): {
        node: BaseNode;
        undo: () => void;
        redo: () => void;
    };
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