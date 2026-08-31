import type BaseNode from './BaseNode.js';
import type DataNode from './DataNode.js';
export interface NodeClassMapAPI {
    parseValue(rawVal: unknown, name: string, parent: BaseNode | null): DataNode;
    getClass(className: string): NodeClassType | null;
    getRegisteredClasses(): string[];
    wrapDerivedVariable(node: DataNode): DataNode;
}
export interface NodeClassType {
    parse(rawVal: unknown, name: string, parent: BaseNode | null): DataNode;
    createDefault?(name: string, parent: BaseNode | null): DataNode;
    defaultName?: string;
}
export declare function init(map: NodeClassMapAPI): void;
export declare function parseValue(rawVal: unknown, name: string, parent: BaseNode | null): DataNode;
export declare function getClass(className: string): NodeClassType | null;
export declare function getRegisteredClasses(): string[];
declare const _default: {
    init: typeof init;
    parseValue: typeof parseValue;
    getClass: typeof getClass;
    getRegisteredClasses: typeof getRegisteredClasses;
};
export default _default;
//# sourceMappingURL=NodeRegistry.d.ts.map