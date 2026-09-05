import { type EventBusInstance } from './EventBus.js';
import type { INode, ISourceNode, IAllNode, SourceMeta } from './NodeInterfaces.js';
import type { ParseWarning } from '../datamodel/parser/ParseWarning.js';
import type { RowData } from '../datamodel/node/BaseNode.js';
export type { IAllNode as AllNode, SourceMeta };
export interface CreateSessionOptions {
    bus?: EventBusInstance;
}
/**
 * One source's content, ready to be written back over the file it came from.
 *
 * Discriminated on `kind` rather than left as `ArrayBuffer | string`, because this is
 * a machine contract in the same register as SourceDTO: a caller about to write a
 * file must not have to `typeof` the answer to find out which of the two it got, and
 * a `typeof` check is exactly the kind of test that stops being correct the moment a
 * third flavour appears. `bytes` is a Uint8Array rather than an ArrayBuffer because
 * that is what a filesystem write actually accepts.
 *
 * `sourceFormat` is the source node's OWN format string — the same vocabulary
 * SourceDTO.sourceFormat publishes ('json' for a textual `.sldd`, 'xml' for a
 * compressed-binary one) — so a consumer can correlate the two without a mapping
 * table of its own.
 */
export type SerializedSource = {
    kind: 'binary';
    sourceFormat: string;
    bytes: Uint8Array;
} | {
    kind: 'text';
    sourceFormat: string;
    text: string;
};
/**
 * What a link target resolved to — see session.resolveLink().
 *
 * Discriminated on `status` for the reason SerializedSource is discriminated on `kind`:
 * this is a machine contract, and the interesting part of it is the FAILURES. A bare
 * `INode | null` would fold three different situations into one answer and leave the
 * host unable to tell them apart, which matters because they call for different
 * behaviour:
 *
 *   - 'resolved' — a node to go to.
 *   - 'not-found' — the file IS open and holds nothing by that name. Report it; there
 *     is nothing to offer the user, and the link is probably stale or the target was
 *     built from an expression this could not read (see resolveLink).
 *   - 'source-not-open' — the file is not open in this session. This is the one a host
 *     can act on: "open mdlparams.sldd to follow this" is a genuinely better answer
 *     than a dead link, and it is only possible because the status carries `sourceId`
 *     AND `name`, so the host can re-ask once the file is open.
 *   - 'empty' — the caller passed nothing at all (no target, or whitespace). Separated
 *     from the other two because it is a bug in the CALLER's plumbing rather than a
 *     fact about the session, and answering it with 'source-not-open' for the source
 *     named '' would send a host off to open a file with no name.
 *
 * Never throws, for the reason serializeSource returns null rather than throwing: a
 * consumer walking every link in a table must not need a try/catch per row.
 *
 * `nodes` is every candidate in document order and `node` is `nodes[0]`. Both are
 * present on purpose: a `.sldd` target names an ENTRY, not a node id, and a dictionary
 * can hold that name in two sections at once (a design entry and its derived
 * counterpart). A host with nowhere to put a choice follows `node` and is right for
 * the ordinary case; a host that can offer a picker has the alternatives without
 * having to re-run the search. Being ambiguous is therefore not a separate status —
 * it would make every caller handle a fourth case to learn something the list already
 * says.
 *
 * Plain data apart from the nodes themselves. The nodes are LIVE INodes, as
 * findNodes() hands back live nodes and for the same reason: an in-process host edits
 * what it followed, and toDTO is the projection applied at the out-of-process edge by
 * the caller that needs it (see src/core/dto.ts).
 */
export type LinkResolution = {
    status: 'resolved';
    sourceId: string;
    node: INode;
    nodes: INode[];
} | {
    status: 'not-found';
    sourceId: string;
    name: string;
} | {
    status: 'source-not-open';
    sourceId: string;
    name: string | null;
} | {
    status: 'empty';
};
/**
 * One place a definition is referenced — see session.findUsages().
 *
 * Plain data, with NO live node on it, which is the opposite of the choice
 * LinkResolution makes and deliberate. This is what fills a `UsedBy` cell: it goes
 * into a RowData, and a RowData is a plain-data shape that hosts pass through
 * structured clone or JSON to a webview or an RPC client (the same reason ParseWarning
 * carries a reason string instead of an Error). A live node on this object would make
 * the whole result unclonable for the consumer it exists to serve. A caller that wants
 * the block node itself passes `linkTarget` straight back to resolveLink().
 *
 * `linkTarget` is `blockName@modelSrcId` — the SAME grammar ModelBlockNode writes for
 * the forward direction, so the reverse link needs no second target format and no
 * second resolver. It round-trips: resolveLink(usage.linkTarget) is the block node.
 *
 * No display text is pre-baked here. What a `UsedBy` cell should READ is a
 * presentation decision ("Const (Constant)" or "mdlcases.mdl: Const" or a count), and
 * this package is consumed by a VS Code extension, a CLI and an RPC server that will
 * not agree on it. The four facts a label could want are all here separately.
 */
export interface NodeUsage {
    /** The block's name, as its node is named — 'Const'. */
    blockName: string;
    /** The block's type — 'Constant'. Empty when the model did not record one. */
    blockType: string;
    /** The block parameter that holds the reference — 'Value', 'Denominator'. */
    paramProperty: string;
    /** The parameter's value VERBATIM, which is an expression as often as a bare name: '[tau 1]'. */
    paramValue: string;
    /** The srcId of the model the block is in, as getDataSourceIds() reports it. */
    modelSrcId: string;
    /** A target resolveLink() turns back into the block node — `blockName@modelSrcId`. */
    linkTarget: string;
}
/**
 * One sub-dictionary a `.sldd` references, and whether this session can reach it —
 * see session.resolveDictionaryReferences().
 *
 * `name` is what the FILE records (a bare file name, e.g. 'common.sldd'), normalized to
 * a string: the node keeps these as `unknown[]` because the two `.sldd` readers put
 * different shapes in it, and every consumer would otherwise repeat the same narrowing.
 */
export interface DictionaryReference {
    /** The sub-dictionary as the referencing file names it. */
    name: string;
    /** The same answer resolveLink() gives for that name — a root node, or why not. */
    resolution: LinkResolution;
}
/**
 * What session.findNodes() matches on.
 *
 * `name` and `value` are searches, so a string is a SUBSTRING test — what a search
 * box does. `className` and `kind` are filters over closed vocabularies a host holds
 * verbatim (see kindForClass), so a string there is a WHOLE-string test: 'Simulink.Bus'
 * must not also answer for Simulink.BusElement. Neither takes a RegExp today; widening
 * either to `string | RegExp` later is a backward-compatible change.
 *
 * `sourceId`, `caseSensitive` and `limit` are modifiers rather than criteria: they
 * shape an answer, they do not select one. A query holding only modifiers therefore
 * has no criteria at all — see findNodes for what that means.
 */
export interface FindNodesQuery {
    /** Substring of the node's own name, or a RegExp tested against it. */
    name?: string | RegExp;
    /** The Class column, matched whole — e.g. 'Simulink.Parameter'. */
    className?: string;
    /** The Kind column, matched whole — e.g. 'Bus Element'. */
    kind?: string;
    /** Substring of the node's rendered value, or a RegExp tested against it. */
    value?: string | RegExp;
    /** Restrict the search to one open source. Omitted means every open source. */
    sourceId?: string;
    /** Applies to STRING criteria only; a RegExp always keeps its own flags. Default false. */
    caseSensitive?: boolean;
    /** Cap on the number of matches. Omitted means uncapped. */
    limit?: number;
}
export declare function identifiersIn(expression: string): string[];
export declare function createSession(opts?: CreateSessionOptions): {
    allNode: IAllNode;
    addDataSource: (srcId: string, content: Record<string, unknown>, meta?: Partial<SourceMeta>, warnings?: ParseWarning[]) => ISourceNode;
    addParsedSource: (srcId: string, slddNode: ISourceNode, meta?: Partial<SourceMeta>, warnings?: ParseWarning[]) => ISourceNode;
    addModelSource: (srcId: string, buffer: ArrayBuffer, meta?: Partial<SourceMeta>) => ISourceNode;
    addModelSourceParsed: (srcId: string, parsed: unknown, meta?: Partial<SourceMeta>) => ISourceNode;
    addMatSource: (srcId: string, buffer: ArrayBuffer, meta?: Partial<SourceMeta>) => ISourceNode;
    addMatSourceParsed: (srcId: string, parsed: unknown, meta?: Partial<SourceMeta>) => ISourceNode;
    addProjectSource: (srcId: string, files: Record<string, string>, meta?: Partial<SourceMeta>) => ISourceNode;
    removeDataSource: (srcId: string) => void;
    removeAll: () => void;
    getDataSource: (srcId: string) => ISourceNode | null;
    hasDataSource: (srcId: string) => boolean;
    getDataSourceIds: () => string[];
    getDataSourceCount: () => number;
    serializeSource: (srcId: string) => SerializedSource | null;
    isBatching: () => boolean;
    setActiveContext: (node: INode | IAllNode) => void;
    setActiveEntry: (nodes: INode | INode[] | null) => void;
    setActive: (context: INode | IAllNode | null, entry: INode | INode[] | null) => void;
    getContextNode: () => INode | IAllNode | null;
    getEntryNode: () => INode | null;
    getEntryNodes: () => INode[];
    getActiveNode: () => INode | IAllNode | null;
    getActiveSlddNode: () => ISourceNode | null;
    getActiveSourceNode: () => ISourceNode | null;
    setPreviewNode: (node: INode | null) => void;
    getPreviewNode: () => INode | null;
    clearPreviewNode: () => void;
    findNodeById: (nodeId: string) => INode | null;
    findNodes: (query: FindNodesQuery) => INode[];
    findNode: (query: FindNodesQuery) => INode | null;
    resolveLink: (target: string) => LinkResolution;
    findUsages: (nodeId: string) => NodeUsage[];
    resolveDictionaryReferences: (srcId: string) => DictionaryReference[];
    rowsOf: (container: INode) => RowData[];
    beginBatch: () => void;
    endBatch: () => void;
    editProperty: (nodeId: string, propertyName: string, newValue: unknown, oldValue?: unknown) => true | false | {
        error: boolean;
        reason: string;
        invalidValue: string;
        validValue: string;
    };
    addEntry: (sectionKey: string, className: string, entryName?: string) => INode | null;
    addChild: () => INode | null;
    deleteNode: () => boolean;
    addChildTo: (nodeId: string) => INode | null;
    deleteNodeById: (nodeId: string) => boolean;
    deleteNodesById: (nodeIds: string[]) => boolean;
    undo: () => void;
    redo: () => void;
    canUndo: () => boolean;
    canRedo: () => boolean;
    bus: EventBusInstance;
};
export type Session = ReturnType<typeof createSession>;
declare const DataModel: {
    allNode: IAllNode;
    addDataSource: (srcId: string, content: Record<string, unknown>, meta?: Partial<SourceMeta>, warnings?: ParseWarning[]) => ISourceNode;
    addParsedSource: (srcId: string, slddNode: ISourceNode, meta?: Partial<SourceMeta>, warnings?: ParseWarning[]) => ISourceNode;
    addModelSource: (srcId: string, buffer: ArrayBuffer, meta?: Partial<SourceMeta>) => ISourceNode;
    addModelSourceParsed: (srcId: string, parsed: unknown, meta?: Partial<SourceMeta>) => ISourceNode;
    addMatSource: (srcId: string, buffer: ArrayBuffer, meta?: Partial<SourceMeta>) => ISourceNode;
    addMatSourceParsed: (srcId: string, parsed: unknown, meta?: Partial<SourceMeta>) => ISourceNode;
    addProjectSource: (srcId: string, files: Record<string, string>, meta?: Partial<SourceMeta>) => ISourceNode;
    removeDataSource: (srcId: string) => void;
    removeAll: () => void;
    getDataSource: (srcId: string) => ISourceNode | null;
    hasDataSource: (srcId: string) => boolean;
    getDataSourceIds: () => string[];
    getDataSourceCount: () => number;
    serializeSource: (srcId: string) => SerializedSource | null;
    isBatching: () => boolean;
    setActiveContext: (node: INode | IAllNode) => void;
    setActiveEntry: (nodes: INode | INode[] | null) => void;
    setActive: (context: INode | IAllNode | null, entry: INode | INode[] | null) => void;
    getContextNode: () => INode | IAllNode | null;
    getEntryNode: () => INode | null;
    getEntryNodes: () => INode[];
    getActiveNode: () => INode | IAllNode | null;
    getActiveSlddNode: () => ISourceNode | null;
    getActiveSourceNode: () => ISourceNode | null;
    setPreviewNode: (node: INode | null) => void;
    getPreviewNode: () => INode | null;
    clearPreviewNode: () => void;
    findNodeById: (nodeId: string) => INode | null;
    findNodes: (query: FindNodesQuery) => INode[];
    findNode: (query: FindNodesQuery) => INode | null;
    resolveLink: (target: string) => LinkResolution;
    findUsages: (nodeId: string) => NodeUsage[];
    resolveDictionaryReferences: (srcId: string) => DictionaryReference[];
    rowsOf: (container: INode) => RowData[];
    beginBatch: () => void;
    endBatch: () => void;
    editProperty: (nodeId: string, propertyName: string, newValue: unknown, oldValue?: unknown) => true | false | {
        error: boolean;
        reason: string;
        invalidValue: string;
        validValue: string;
    };
    addEntry: (sectionKey: string, className: string, entryName?: string) => INode | null;
    addChild: () => INode | null;
    deleteNode: () => boolean;
    addChildTo: (nodeId: string) => INode | null;
    deleteNodeById: (nodeId: string) => boolean;
    deleteNodesById: (nodeIds: string[]) => boolean;
    undo: () => void;
    redo: () => void;
    canUndo: () => boolean;
    canRedo: () => boolean;
    bus: EventBusInstance;
};
export default DataModel;
//# sourceMappingURL=DataModel.d.ts.map