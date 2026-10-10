import type { NodeClassType } from '../NodeRegistry.js';
import type BaseNode from '../BaseNode.js';
import type DataNode from '../DataNode.js';
import type { MatVariable } from '../../parser/MatParser.js';
import { attachMcosDecoded, type McosDecoded } from './mcosTypedNode.js';
export declare function getClass(className: string): NodeClassType | null;
export declare function parseValue(rawVal: unknown, name: string, parent: BaseNode | null): DataNode;
export declare function getRegisteredClasses(): string[];
export declare function wrapDerivedVariable(node: DataNode): DataNode;
export declare function modelMcosVariable(variable: MatVariable, decoded: McosDecoded, name: string, parent: BaseNode | null): DataNode | null;
declare const api: {
    getClass: typeof getClass;
    parseValue: typeof parseValue;
    getRegisteredClasses: typeof getRegisteredClasses;
    wrapDerivedVariable: typeof wrapDerivedVariable;
    modelMcosVariable: typeof modelMcosVariable;
    attachMcosDecoded: typeof attachMcosDecoded;
};
export default api;
//# sourceMappingURL=NodeClassMap.d.ts.map