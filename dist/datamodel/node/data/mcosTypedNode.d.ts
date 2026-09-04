import type BaseNode from '../BaseNode.js';
import type DataNode from '../DataNode.js';
import type { MatVariable } from '../../parser/MatParser.js';
export declare function buildTypedNodeFromMcos(className: string, name: string, parent: BaseNode | null, properties?: Record<string, unknown> | null, elements?: Record<string, unknown>[] | null, dimensions?: number[] | null): DataNode | null;
export interface McosDecoded {
    value: unknown;
    properties: Record<string, unknown>;
    elements: Record<string, unknown>[];
    dimensions: number[];
    stringElements?: (string | null)[] | null;
}
export declare function decodeMcosObjects(blobBytes: Uint8Array | null | undefined, variables: MatVariable[]): Map<string, McosDecoded> | null;
export declare function modelOpaqueMcosVariable(variable: MatVariable, decoded: McosDecoded | undefined, parent: BaseNode): DataNode | null;
//# sourceMappingURL=mcosTypedNode.d.ts.map