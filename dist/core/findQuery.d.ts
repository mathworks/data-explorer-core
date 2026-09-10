import type { INode } from './NodeInterfaces.js';
import type { FindNodesQuery } from './sessionTypes.js';
export type NodeCriterion = (node: INode) => boolean;
export declare function compileCriteria(query: FindNodesQuery): NodeCriterion[];
//# sourceMappingURL=findQuery.d.ts.map