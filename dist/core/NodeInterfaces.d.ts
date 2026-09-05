/**
 * Structural interfaces for data model nodes used by the core layer.
 *
 * These are duck-typed — any object matching the shape satisfies the interface.
 * The actual BaseNode/ContainerNode/DataNode classes do NOT need explicit
 * `implements` declarations; TypeScript structural typing handles it.
 *
 * NOTE: We use `import type` from datamodel for shared type definitions
 * (PropClass, etc.). This is safe — type-only imports are erased at compile
 * time and do not create runtime circular dependencies.
 */
import type { PropClass, PropInfo, RowData, PIGroupDef, PIObject } from '../datamodel/node/BaseNode.js';
import type { ParseWarning } from '../datamodel/parser/ParseWarning.js';
export type { PropClass, PropInfo, RowData, PIGroupDef };
export type { PIObject as NodePIObject };
export type { ParseWarning };
/** Minimal interface any node exposes to the core layer */
export interface INode {
    name: string;
    parent: INode | null;
    children: INode[];
    readonly id: string;
    readonly icon: string;
    readonly className: string;
    readonly kind: string;
    readonly dataType: string;
    readonly displayValue: string;
    readonly displayName: string;
    readonly disabled: boolean;
    readonly nameEditable: boolean;
    readonly valueEditable: boolean;
    readonly isEntry?: boolean;
    readonly isContainer?: boolean;
    status?: string;
    flatten(): INode[];
    toRow(): RowData | null;
    getProperties(): PropClass[];
    getPILayout(): PIGroupDef[] | null;
    toPIObject(): PIObject | null;
    serialize(): unknown;
    getPropInfo(PropClassRef: PropClass): PropInfo;
    setProperty?(propName: string, value: unknown): unknown;
    addChild(child: INode, index?: number): INode;
    removeChild(child: INode): void;
    canAddChild?(): boolean;
    execAddChild?(): unknown;
    execRemoveChild?(child?: INode): unknown;
    /** For clipboard: serialize value for class key detection */
    serializeValue?(): unknown;
    /** For XML-based sources: serialize to XML */
    serializeXml?(tagName: string, attrs: Record<string, string>, indent: number): string;
    /** Raw bytes for MAT variable display */
    _rawBytes?: Uint8Array;
    /** Internal display name override */
    _displayName?: string;
    /** Kind tag for array/cell/string children */
    _kind?: string;
    /** Dimensions for indexed children */
    _dims?: number[];
    /** Discriminant — only IAllNode has this */
    __isAllNode?: never;
}
/** Container node — sections, source roots */
export interface IContainerNode extends INode {
    readonly isContainer: boolean;
    children: INode[];
    getSection?(key: string): IContainerNode | null;
    getAllowedTypes?(): string[];
    execAddEntry?(className: string, entryName?: string): {
        node: INode;
        undo: () => void;
        redo: () => void;
    } | null;
    execRemoveEntry?(node: INode): {
        undo: () => void;
        redo: () => void;
    } | null;
    /** For paste support */
    _uniqueName?(baseName: string): string;
    parseEntry?(rawEntry: Record<string, unknown>): INode | null;
    /** Section-specific */
    label?: string;
    /** Source-level properties (optional, not all containers have these) */
    dirty?: boolean;
    readOnly?: boolean;
    meta?: SourceMeta;
    warnings?: ParseWarning[];
    NumberOfEntries?: number;
    dictionaryReferences?: unknown[];
    dataDictionary?: string | null;
    allowAccessBWS?: boolean;
    coreProperties?: Record<string, unknown> | null;
    header?: string;
    rawContents?: Record<string, string> | null;
    release?: string;
    uuid?: string;
    sourceFormat?: string;
    /** Properties exposed on the PI panel */
    Release?: string;
    FileFormat?: string;
}
/** The root source node — a top-level loaded file */
export interface ISourceNode extends IContainerNode {
    /**
     * Whether this source has unsaved changes — and ABSENT on a source that cannot
     * have them. Optional because a `.prj` has no writer and so has no flag to offer:
     * `editableOwnerOf` reads a missing `dirty` as "not an editable document", which is
     * what keeps a project out of the edit path, so the absence is load-bearing rather
     * than an omission for ProjectNode to fill in. Required here (as it was) made the
     * interface state something false about a project, which only the double cast at
     * every registerSource call site kept from being a diagnostic.
     *
     * Contrast SourceDTO.dirty, which is required and reads `false` for such a source:
     * a projection crossing a process boundary has to answer the question, whereas a
     * node in this layer may decline it and be asked with `!== undefined`.
     */
    dirty?: boolean;
    meta?: SourceMeta;
    /**
     * What the reader could not read, when it could not read something. ABSENT for
     * a clean read, and absent for a format whose reader has no diagnostics channel
     * yet — an always-present empty array would promise every source reports
     * warnings, and a host would read a clean `[]` from a reader that simply cannot
     * speak as proof the file was whole. See ParseWarning.
     */
    warnings?: ParseWarning[];
    getSection(key: string): IContainerNode | null;
}
/** Source metadata attached to root source nodes */
export interface SourceMeta {
    path: string;
    lastModified: number | null;
    size: number;
    fileHandle: any | null;
}
/** The synthetic __all__ node used for graph view */
export interface IAllNode {
    __isAllNode: true;
    isContainer: true;
    name: string;
    displayName: string;
    icon: string;
    parent: null;
    id: string;
}
//# sourceMappingURL=NodeInterfaces.d.ts.map