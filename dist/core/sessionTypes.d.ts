import type { EventBusInstance } from './EventBus.js';
import type { INode, IAllNode, SourceMeta } from './NodeInterfaces.js';
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
 *     built from an expression this could not read (see session.resolveLink()).
 *   - 'source-not-open' — the file is not open in this session. This is the one a host
 *     can act on: "open mdlparams.sldd to follow this" is a genuinely better answer
 *     than a dead link, and it is only possible because the status carries `sourceId`
 *     AND `name`, so the host can re-ask once the file is open.
 *   - 'empty' — the caller passed nothing at all (no target, or whitespace). Separated
 *     from the other two because it is a bug in the CALLER's plumbing rather than a
 *     fact about the session, and answering it with 'source-not-open' for the source
 *     named '' would send a host off to open a file with no name.
 *
 * Never throws, for the reason session.serializeSource() returns null rather than
 * throwing: a consumer walking every link in a table must not need a try/catch per row.
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
 * session.findNodes() hands back live nodes and for the same reason: an in-process host
 * edits what it followed, and toDTO is the projection applied at the out-of-process edge
 * by the caller that needs it (see src/core/dto.ts).
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
 * the block node itself passes `linkTarget` straight back to session.resolveLink().
 *
 * `linkTarget` is `blockKey@modelSrcId` — the SAME grammar ModelBlockNode writes for
 * the forward direction, so the reverse link needs no second target format and no
 * second resolver. It round-trips: resolveLink(usage.linkTarget) is the block node.
 *
 * No display text is pre-baked here. What a `UsedBy` cell should READ is a
 * presentation decision ("Const (Constant)" or "mdlcases.mdl: Const" or a count), and
 * this package is consumed by a VS Code extension, a CLI and an RPC server that will
 * not agree on it. The four facts a label could want are all here separately.
 */
export interface NodeUsage {
    /**
     * What the block READS as — 'Const', or `<SID: 65>` for one whose label the model does
     * not give (blockIdentity.blockLabel). Display text, and not an identity: two blocks of
     * one model can share it. `linkTarget` is what tells them apart.
     */
    blockName: string;
    /**
     * WHERE the block is — `Controller/Gain`, and just the label for one in the root
     * system (blockIdentity.joinBlockPath). Model-relative, because the model is already
     * named by `modelSrcId`.
     *
     * What makes two usages that read alike tell-apart-able for a PERSON: a dictionary
     * entry used by four blocks all named `Gain` renders as one word four times, each link
     * correctly reaching a different block, with nothing on screen to say which. Display
     * text like `blockName`, not an identity — `linkTarget` remains the identity.
     */
    blockPath: string;
    /** The block's type — 'Constant'. Empty when the model did not record one. */
    blockType: string;
    /** The block parameter that holds the reference — 'Value', 'Denominator'. */
    paramProperty: string;
    /** The parameter's value VERBATIM, which is an expression as often as a bare name: '[tau 1]'. */
    paramValue: string;
    /** The srcId of the model the block is in, as getDataSourceIds() reports it. */
    modelSrcId: string;
    /**
     * A target resolveLink() turns back into the block node — `blockKey@modelSrcId`, the key
     * being the block's SID where the file records one (blockIdentity.blockKey).
     */
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
 * has no criteria at all — see session.findNodes() for what that means, and
 * `core/findQuery.ts` for how each field above becomes a test.
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
//# sourceMappingURL=sessionTypes.d.ts.map