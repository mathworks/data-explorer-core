import type { NodeClassType } from './NodeRegistry.js';
import type BaseNode from './BaseNode.js';
import type DataNode from './DataNode.js';
export declare function getClass(className: string): NodeClassType | null;
export declare function parseValue(rawVal: unknown, name: string, parent: BaseNode | null): DataNode;
export declare function getRegisteredClasses(): string[];
export declare function wrapDerivedVariable(node: DataNode): DataNode;
declare const api: {
    getClass: typeof getClass;
    parseValue: typeof parseValue;
    getRegisteredClasses: typeof getRegisteredClasses;
    wrapDerivedVariable: typeof wrapDerivedVariable;
};
export default api;
//# sourceMappingURL=NodeClassMap.d.ts.map