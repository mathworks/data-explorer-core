import type { PropClass, PIGroupDef } from './BaseNode.js';
import type BaseNode from './BaseNode.js';
import type { SetPropertyResult } from './DataNode.js';
export declare function buildPILayout(className: string): PIGroupDef[] | null;
export declare function schemaColumns(className: string): PropClass[];
export declare function trySetSchemaProperty(node: BaseNode, key: string, stringValue: string): true | SetPropertyResult | null;
export declare function schemaColumnLabels(): Record<string, string>;
//# sourceMappingURL=schemaBridge.d.ts.map