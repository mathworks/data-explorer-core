import type { INode } from './NodeInterfaces.js';
import type { ParseWarning } from '../datamodel/parser/ParseWarning.js';
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
    /**
     * What the reader could not read, omitted when it read everything. An
     * out-of-process consumer has only this projection to go on, so a warning the
     * live node carries and the DTO drops does not exist as far as that host is
     * concerned — which is the whole failure the channel was added to fix.
     */
    warnings?: ParseWarning[];
}
export interface ToDTOOptions {
    depth?: number;
}
export declare function toDTO(node: INode, opts?: ToDTOOptions): NodeDTO;
//# sourceMappingURL=dto.d.ts.map