import type { INode } from './NodeInterfaces.js';
export interface PropDTO {
    key: string;
    displayName: string;
    value: string;
    editable: boolean;
}
export interface NodeDTO {
    id: string;
    name: string;
    displayName: string;
    kind: string;
    className: string;
    icon: string;
    isContainer: boolean;
    isEntry: boolean;
    childIds: string[];
    props: PropDTO[];
    children?: NodeDTO[];
}
export interface SourceDTO extends NodeDTO {
    path?: string;
    dirty: boolean;
    sourceFormat?: string;
}
export interface ToDTOOptions {
    depth?: number;
}
export declare function toDTO(node: INode, opts?: ToDTOOptions): NodeDTO;
//# sourceMappingURL=dto.d.ts.map