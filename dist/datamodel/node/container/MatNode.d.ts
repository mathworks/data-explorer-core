import ContainerNode from '../ContainerNode.js';
import type BaseNode from '../BaseNode.js';
import type { PropClass, PIGroupDef } from '../BaseNode.js';
import type { MatVariable } from '../data/MatlabVariableNode.js';
export default class MatNode extends ContainerNode {
    header: string;
    dirty: boolean;
    _anonymousElements: MatVariable[];
    constructor(name: string);
    get displayName(): string;
    get readOnly(): boolean;
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
    static fromParsed(parsed: {
        header: string;
        variables: MatVariable[];
    }, filename: string): MatNode;
}
//# sourceMappingURL=MatNode.d.ts.map