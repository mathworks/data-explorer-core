import ContainerNode from '../ContainerNode.js';
import type { TableColumnConfig } from '../ContainerNode.js';
import type { MatVariable } from '../data/MatlabVariableNode.js';
import type BaseNode from '../BaseNode.js';
import type { ParsedConfigSet } from '../../parser/SlxParser.js';
export default class ModelSectionNode extends ContainerNode {
    label: string;
    iconId: string;
    constructor(name: string, parent: BaseNode | null, label: string, iconId: string);
    get icon(): string;
    get displayName(): string;
    get tableColumnConfig(): TableColumnConfig;
    _editRefusal(entry: BaseNode, node: BaseNode, key: string, describe?: boolean): string | null;
    /** Why an entry of this section is not deleted, as a clause (the session's deleteRefusal). */
    removeEntryRefusal(node: BaseNode): string | null;
    execRemoveEntry(node: BaseNode): {
        undo: () => void;
        redo: () => void;
    } | null;
    /** The classes this section holds and is added: a model's configuration sets', or none. */
    getAllowedTypes(): string[];
    /**
     * Why addEntry makes no entry of `className` here, named `entryName` or the class's default name,
     * in words naming the section, or null where it makes one (the session's addEntryRefusal).
     */
    entryRefusal(className: string, entryName?: string): string | null;
    execAddEntry(className: string, entryName?: string): {
        node: BaseNode;
        undo: () => void;
        redo: () => void;
    } | null;
    _entryPlan(className: string, entryName?: string): {
        name: string;
    } | {
        why: string;
    };
    /**
     * Why a name typed in for a child of this section is not one, or null where it is (DataNode's
     * rename asks it in place of a MATLAB name's rule): a configuration set's, as MATLAB's
     * set_param(cs, 'Name') takes one, measured on R2027a: not empty, of letters, digits, _, - and
     * spaces.
     */
    _childNameError(text: string): string | null;
    get _namespaceLabel(): string | undefined;
    _configRefusal(): string | null;
    _configKeyRefusal(entry: BaseNode, node: BaseNode, key: string): string | null;
    _notEditedWhy(): string;
    addWorkspaceEntry(entry: MatVariable): BaseNode;
    addConfigSetEntry(cfg: ParsedConfigSet): BaseNode;
    addReferenceEntry(ref: {
        blockPath: string;
        modelName: string;
    }, defaultExt: string): BaseNode;
    addBlockEntry(blockName: string, blockType: string, paramUsages: Array<{
        property: string;
        value: string;
    }>, modelSrcId: string, paramSourceId: string | null, sid?: string, systemPath?: string): BaseNode;
    addDataSourceEntry(path: string): BaseNode;
}
//# sourceMappingURL=ModelSectionNode.d.ts.map