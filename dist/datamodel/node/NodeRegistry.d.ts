import type BaseNode from './BaseNode.js';
import type DataNode from './DataNode.js';
import type { MatVariable } from '../parser/MatParser.js';
import type { McosDecoded } from './data/mcosTypedNode.js';
import type { ParseWarning } from '../parser/ParseWarning.js';
import type { McosStreamRead } from './data/mcosStreamEdit.js';
export interface NodeClassMapAPI {
    parseValue(rawVal: unknown, name: string, parent: BaseNode | null): DataNode;
    getClass(className: string): NodeClassType | null;
    getRegisteredClasses(): string[];
    wrapDerivedVariable(node: DataNode): DataNode;
    modelMcosVariable(variable: MatVariable, decoded: McosDecoded, name: string, parent: BaseNode | null): DataNode | null;
    attachMcosDecoded(blobBytes: Uint8Array | null | undefined, variables: MatVariable[], warnings?: ParseWarning[], rootPath?: string): void;
    adoptMcosStream(holder: DataNode, read: McosStreamRead): void;
}
export interface NodeParser {
    parse(rawVal: unknown, name: string, parent: BaseNode | null): DataNode;
}
export interface NodeClassType extends NodeParser {
    createDefault?(name: string, parent: BaseNode | null): DataNode;
    defaultName: string;
}
export declare function init(map: NodeClassMapAPI): void;
export declare function parseValue(rawVal: unknown, name: string, parent: BaseNode | null): DataNode;
export declare function getClass(className: string): NodeClassType | null;
export declare function getRegisteredClasses(): string[];
export declare function wrapDerivedVariable(node: DataNode): DataNode;
export declare function modelMcosVariable(variable: MatVariable, decoded: McosDecoded, name: string, parent: BaseNode | null): DataNode | null;
export declare function attachMcosDecoded(blobBytes: Uint8Array | null | undefined, variables: MatVariable[], warnings?: ParseWarning[], rootPath?: string): void;
export declare function adoptMcosStream(holder: DataNode, read: McosStreamRead): void;
declare const _default: {
    init: typeof init;
    parseValue: typeof parseValue;
    getClass: typeof getClass;
    getRegisteredClasses: typeof getRegisteredClasses;
    wrapDerivedVariable: typeof wrapDerivedVariable;
    modelMcosVariable: typeof modelMcosVariable;
    attachMcosDecoded: typeof attachMcosDecoded;
    adoptMcosStream: typeof adoptMcosStream;
};
export default _default;
//# sourceMappingURL=NodeRegistry.d.ts.map