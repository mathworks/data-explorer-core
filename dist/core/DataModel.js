// Copyright 2026 The MathWorks, Inc.
import { defaultBus, createEventBus } from './EventBus.js';
import { createUndoManager } from './UndoManager.js';
import SlddNode from '../datamodel/node/container/SlddNode.js';
import ModelNode from '../datamodel/node/container/ModelNode.js';
import MatNode from '../datamodel/node/container/MatNode.js';
import ProjectNode from '../datamodel/node/container/ProjectNode.js';
import { parseModel } from '../datamodel/parser/ModelParser.js';
import { parseMat } from '../datamodel/parser/MatParser.js';
import { parseProject } from '../datamodel/parser/ProjectParser.js';
import { serializeBinarySldd } from '../datamodel/parser/BinarySlddSerializer.js';
// Whether a query field was actually asked about.
//
// `undefined` is the field a host left out. `''` is the field it filled in from an
// empty search box, and it is treated as ALSO not asked: a substring test against ''
// passes for every node, so honouring it would answer "the user has typed nothing"
// with every node in every open file — the largest allocation the session can make
// and the one nobody asked for. A caller that really means "renders as empty" says
// so with a pattern, `/^$/`, which this leaves alone. A RegExp is never `''`, so an
// explicit `new RegExp('')` stays a match-all: a pattern object is a choice, an
// empty string is a blank.
function isAsked(field) {
    return field !== undefined && field !== '';
}
// A criterion over one piece of a node's text.
//
// The read is defensive. Name, class, kind and value are all getters over parsed
// content, and a host may hand the session a tree this package did not build
// (addParsedSource exists for exactly that), so one node that throws on read must not
// take a whole search down — the same rule readPropertyValue applies on the edit path.
//
// A failed read is NOT the empty string: a criterion is a claim about a field, and a
// field that cannot be read is a claim that cannot be checked, so it is false. Folding
// it to '' instead would let `{ value: /^$/ }` — a caller asking specifically which
// nodes render no value — answer with a node whose value might render as anything, if
// only it could be read.
function textCriterion(read, test) {
    return (node) => {
        let text;
        try {
            text = read(node);
        }
        catch {
            return false;
        }
        return typeof text === 'string' && test(text);
    };
}
// A caller's string or RegExp as a test over one piece of text. `whole` picks between
// the two kinds of string criterion described on FindNodesQuery.
function compileTextTest(pattern, caseSensitive, whole) {
    if (typeof pattern !== 'string') {
        // A RegExp is honoured exactly as written: `caseSensitive` never adds an `i` flag
        // and never takes one away, because the caller already made that choice and a
        // pattern that behaves differently inside this call than it did in the host's own
        // test is worse than either default.
        //
        // The one rewrite is `g`/`y`, and it is not optional. RegExp.prototype.test on a
        // global or sticky pattern advances lastIndex and resumes from there next call,
        // so reusing one caller-supplied pattern across a whole index would match roughly
        // every SECOND node — and because the state lives in the caller's object, a host
        // retyping the same search would watch its own results flicker. Cloned rather
        // than reset per node so the caller's own object is never mutated, and once per
        // query rather than once per node.
        if (pattern.global || pattern.sticky) {
            const stateless = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''));
            return (text) => stateless.test(text);
        }
        return (text) => pattern.test(text);
    }
    if (caseSensitive) {
        return whole ? (text) => text === pattern : (text) => text.includes(pattern);
    }
    // Folded once here, per query, rather than per node per criterion.
    const folded = pattern.toLowerCase();
    return whole ? (text) => text.toLowerCase() === folded : (text) => text.toLowerCase().includes(folded);
}
// The criteria a query asks for, in the order they should be evaluated: the two
// whole-string compares first, then the name substring, and the VALUE last —
// displayValue formats its content on read (a large matrix or cell renders through
// the display-convention machinery), so it is the one field worth not reading for a
// node another criterion has already rejected.
function compileCriteria(query) {
    const caseSensitive = query.caseSensitive === true;
    const criteria = [];
    if (isAsked(query.className)) {
        criteria.push(textCriterion((node) => node.className, compileTextTest(query.className, caseSensitive, true)));
    }
    if (isAsked(query.kind)) {
        criteria.push(textCriterion((node) => node.kind, compileTextTest(query.kind, caseSensitive, true)));
    }
    if (isAsked(query.name)) {
        // The node's own name — the identifier its id is built from, and the same string
        // findNodeById resolves against — not its rendered displayName. The two differ
        // only for positional elements, whose label embeds the PARENT's name ('Array(1)'
        // for the node named '1'), so matching the label as well would make a search for
        // `Array` return every element of every array and bury the variable in its own
        // contents. A host that wants label matching has displayName one field away.
        criteria.push(textCriterion((node) => node.name, compileTextTest(query.name, caseSensitive, false)));
    }
    if (isAsked(query.value)) {
        // Matched against displayValue, which is the string a host actually shows: it is
        // what PropValue.readValue returns for the Value column and what BaseNode.toRow
        // falls back to, so a user searches over exactly what a user can read. A node
        // with no value renders '' and so fails every non-empty pattern, which is what
        // keeps a value query from sweeping up the sections and the structure-only
        // entries the way a listing would.
        criteria.push(textCriterion((node) => node.displayValue, compileTextTest(query.value, caseSensitive, false)));
    }
    return criteria;
}
// A file name with any directory part removed, both separators honoured. A srcId or a
// recorded meta.path may have come from either platform and this layer never touches a
// filesystem, so there is no path module to defer to and nothing to normalize against.
function basenameOf(text) {
    return text.split(/[\\/]/).pop() || text;
}
// A model file name with its extension removed, or null when the name is not a model
// file at all.
//
// `.slx` and `.mdl` are the one pair this package treats as two spellings of the same
// thing (parseModel reads whichever the bytes are), and the reason this exists is that
// a model reference is recorded with the PARENT's extension: ModelNode.addReferenceEntry
// guesses, because a `.mdl` names its child without an extension, so the same child is
// 'mdl_child.mdl' seen from a `.mdl` and 'mdl_child.slx' seen from a `.slx`. Resolving
// that guess strictly would make the link dead for exactly the mixed hierarchy the
// guess was invented for. The extension match is case-insensitive because it is a file
// extension; the STEM comparison is not, because a srcId is the host's own key and two
// sources differing in case are two sources.
function modelStemOf(name) {
    const match = /^(.*)\.(slx|mdl)$/i.exec(name);
    return match ? match[1] : null;
}
// A link target split into the entry name it asks for and the source it asks in.
//
// Two grammars, and only two: `name@source` names an ENTRY inside a named source, and a
// bare target names a SOURCE. That is exactly what the three producers write —
// ModelBlockNode builds `${param}@${sourceId}`, DataSourceNode and ModelReferenceNode
// write a bare file name — and closing the grammar there is what makes a `fromNodeId`
// context parameter unnecessary: every target already says which file it means, so
// there is never a name to interpret relative to the node the caller came from. An
// unnecessary parameter is worse than none, because it is a promise (that a bare entry
// name resolves in the caller's own source) that nothing produces and nothing tests.
//
// There is deliberately no third form for a node ID. findNodeById IS that lookup, and
// accepting ids here would make the answer depend on which of two lookups happened to
// hit first for a string that could be read either way.
//
// Split at the FIRST `@`, not the last: the producer builds name-then-source, and a
// srcId is the host's key for a file, which may itself be a URI containing an `@`
// (credentials, a revision). Splitting from the right would make every such source
// unreachable.
function splitLinkTarget(target) {
    const at = target.indexOf('@');
    if (at < 0) {
        return { name: null, source: target };
    }
    return { name: target.slice(0, at), source: target.slice(at + 1) };
}
// The MATLAB identifiers in a block-parameter expression, in the order they appear.
//
// A block parameter's value is an expression as often as it is a bare name — mdlcases.mdl
// has `[tau 1]`, `1/Uo`, `2*Tau_inf` — and the names in it are the definitions the block
// refers to. Both directions of link resolution need the same reading of that, so both
// call this: findUsages asks whether a parameter names a given definition, and
// resolveLink asks what the name part of a target can mean (ModelBlockNode builds its
// target from the raw parameter VALUE, so `[tau 1]@mdlparams.sldd` is a target this
// package really produces).
//
// A token is skipped when the character before it is `.` or a digit. `.` is a field or
// property reference — `cfg.mode` refers to `cfg`, and the model resolves `cfg`, so the
// base name is the one credited and `mode` is not a definition of its own. A digit
// before an identifier cannot start one in MATLAB, so it is always the tail of a numeric
// literal (`1e5` would otherwise offer `e5`).
//
// What this does NOT do: it makes no attempt to exclude text inside quotes. In MATLAB
// `'` is both the char-literal delimiter and the transpose operator, so `A'*B'` is
// indistinguishable from a quoted span by any regular scan — and getting that wrong
// would DROP real usages, which is worse than the rare phantom one a char literal
// holding an entry's name would add. It also cannot tell a function call from an index,
// so a variable shadowed by a function of the same name is reported as a usage; MATLAB
// itself decides that at run time from the workspace, which is not something a file
// reader has.
function identifiersIn(expression) {
    // Constructed per call rather than hoisted: a `/g` RegExp carries lastIndex, and a
    // shared one would resume mid-string on the next call — the same reentrancy hazard
    // compileTextTest rewrites `g` away for.
    const pattern = /[A-Za-z_]\w*/g;
    const names = [];
    let match;
    while ((match = pattern.exec(expression)) !== null) {
        const before = match.index > 0 ? expression.charAt(match.index - 1) : '';
        if (before === '.' || (before >= '0' && before <= '9')) {
            continue;
        }
        names.push(match[0]);
    }
    return names;
}
export function createSession(opts = {}) {
    const bus = opts.bus ?? createEventBus();
    const UndoManager = createUndoManager(bus);
    const { publish, subscribe } = bus;
    const allNode = {
        __isAllNode: true,
        isContainer: true,
        name: '__all__',
        displayName: 'Root',
        icon: 'abstractClass',
        parent: null,
        id: '__all__',
    };
    const dataSources = new Map();
    const nodeIndex = new Map();
    let contextNode = null;
    let entryNodes = [];
    let previewNode = null;
    let batchDepth = 0;
    // Non-null only for the duration of one rowsOf() call, holding that call's reverse
    // projection so the rows it builds read a map instead of each running its own scan. Not
    // a cache: it is discarded when the call returns, so there is nothing to invalidate and
    // no way for it to go stale — see rowsOf.
    let usageBatch = null;
    function buildMeta(meta) {
        return {
            path: (meta && meta.path) || '',
            lastModified: (meta && meta.lastModified) || null,
            size: (meta && meta.size) || 0,
            fileHandle: (meta && meta.fileHandle) || null,
        };
    }
    function registerSource(srcId, sourceNode, meta, warnings) {
        sourceNode.meta = buildMeta(meta);
        // Only when there IS something to report: absence is what tells a host the read
        // was clean, so an empty array here would be a false reassurance for the readers
        // that do not yet have a diagnostics channel at all. See ParseWarning.
        if (warnings && warnings.length > 0) {
            sourceNode.warnings = warnings;
        }
        // How a node reaches the reverse usage index without knowing what a session is: the
        // resolver goes on the source ROOT, and a node walks up to its root to find it (see
        // BaseNode._usedByCell and UsageResolver). Stamped here beside `meta` because this is
        // the one place a tree becomes part of a session, so a tree that is in a session has
        // the resolver and a tree that is not cannot have a stale one. Unconditional, unlike
        // `warnings`: every source has nodes whose rows may want the column, and the resolver
        // answering with nothing is what an empty answer looks like.
        sourceNode._usageResolver = usagesForRow;
        // Re-registering a srcId REPLACES its tree, so the outgoing tree's nodes have to
        // leave nodeIndex first. `dataSources.set` drops the only reference to the old
        // source, but its node ids stay in nodeIndex forever otherwise — and findNodeById
        // would keep resolving them, handing callers a detached node from a tree the
        // session no longer owns. Edits routed there mutate an orphan and vanish on save.
        // Reloading the same file (parse → addDataSource on the same uri) is the ordinary
        // way to hit this, so it is a routine path, not a corner case.
        const previous = dataSources.get(srcId);
        if (previous) {
            deindexSource(previous);
        }
        dataSources.set(srcId, sourceNode);
        indexSource(sourceNode);
        publish('datamodel/source-added', { srcId, slddNode: sourceNode });
        return sourceNode;
    }
    function indexSource(source) {
        const flat = source.flatten();
        for (let i = 0; i < flat.length; i++) {
            nodeIndex.set(flat[i].id, flat[i]);
        }
    }
    function deindexSource(source) {
        const flat = source.flatten();
        for (let i = 0; i < flat.length; i++) {
            nodeIndex.delete(flat[i].id);
        }
    }
    function beginBatch() {
        batchDepth++;
    }
    function endBatch() {
        if (batchDepth > 0) {
            batchDepth--;
        }
        if (batchDepth === 0) {
            publish('active/changed');
        }
    }
    function publishActiveChanged() {
        if (batchDepth === 0) {
            publish('active/changed');
        }
    }
    function setActiveContext(node) {
        contextNode = node;
        entryNodes = [];
        publishActiveChanged();
    }
    function setActiveEntry(nodes) {
        if (nodes === null) {
            entryNodes = [];
        }
        else if (Array.isArray(nodes)) {
            entryNodes = nodes;
        }
        else {
            entryNodes = [nodes];
        }
        publishActiveChanged();
    }
    function setActive(context, entry) {
        contextNode = context;
        if (entry === null) {
            entryNodes = [];
        }
        else if (Array.isArray(entry)) {
            entryNodes = entry;
        }
        else {
            entryNodes = [entry];
        }
        publishActiveChanged();
    }
    function getContextNode() {
        return contextNode;
    }
    function getEntryNode() {
        return entryNodes.length > 0 ? entryNodes[0] : null;
    }
    function getEntryNodes() {
        return entryNodes;
    }
    function getActiveNode() {
        return entryNodes.length > 0 ? entryNodes[0] : contextNode;
    }
    // `warnings` is the sink a caller that already PARSED something passes in — `ingest`
    // does, for a compressed-binary `.sldd`, because it calls parseBinarySldd itself and the
    // dictionary reader reports through a caller-owned array rather than a result field (see
    // the header of BinarySlddParser.ts). It is not copied: `SlddNode.parse` appends the node
    // layer's own findings to the very same array, and that one list is what gets attached to
    // the source, so a host sees one list per file no matter which layer the loss was found
    // in. Callers that parse nothing pass nothing, and the sink starts empty here — a clean
    // read then leaves `warnings` off the node entirely, which registerSource enforces.
    function addDataSource(srcId, content, meta, warnings) {
        const collected = warnings || [];
        const slddNode = SlddNode.parse(content, srcId, collected);
        return registerSource(srcId, slddNode, meta, collected);
    }
    // The dictionary counterpart of addModelSourceParsed/addMatSourceParsed's forwarding. Those
    // two read `parsed.warnings` off the result object they are handed; a SlddNode is a TREE and
    // has no result object, so the only way a host that parsed off-thread can hand its findings
    // over is beside the node. Without this parameter that host — the worker-based one — would
    // be the single route into a session where a short dictionary read stays invisible.
    function addParsedSource(srcId, slddNode, meta, warnings) {
        return registerSource(srcId, slddNode, meta, warnings);
    }
    function addModelSource(srcId, buffer, meta) {
        // `.slx` or `.mdl` — parseModel reads whichever these bytes are.
        const parsed = parseModel(buffer, srcId);
        const modelNode = ModelNode.fromParsed(parsed, srcId);
        // Forwarded the way addProjectSource forwards a project's, and for the same reason: a
        // model that opened short is registered like any other source, so its tree looks
        // complete and the warnings are the only thing that says otherwise. A reader that
        // reports a loss into a `parsed.warnings` nobody passes on has reported it to nobody.
        return registerSource(srcId, modelNode, meta, parsed.warnings);
    }
    function addMatSource(srcId, buffer, meta) {
        const parsed = parseMat(buffer);
        const matNode = MatNode.fromParsed(parsed, srcId);
        return registerSource(srcId, matNode, meta, parsed.warnings);
    }
    function addProjectSource(srcId, files, meta) {
        // srcId may be a full path or an opaque URI, so prefer meta.path when the host
        // supplied one; either way the node is labelled with the basename, .prj included,
        // because the tree shows a file. parseProject wants a project NAME rather than a
        // filename for its fallback, hence the strip — note ProjectNode.fromParsed labels
        // itself from the basename and never reads parsed.name, so the stripped form only
        // shows up if a host calls parseProject itself.
        const basename = ((meta && meta.path) || srcId).split(/[\\/]/).pop() || srcId;
        const parsed = parseProject(files, basename.replace(/\.prj$/i, ''));
        const projectNode = ProjectNode.fromParsed(parsed, basename);
        return registerSource(srcId, projectNode, meta, parsed.warnings);
    }
    // The *Parsed entry points take `unknown` because the host parsed the file itself
    // (on a worker, say) and hands the result back across a boundary that erased its
    // type, so the cast here is the real one and not a papered-over mismatch.
    function addModelSourceParsed(srcId, parsed, meta) {
        const result = parsed;
        const modelNode = ModelNode.fromParsed(result, srcId);
        // These are the entry points a worker-based host uses, so this is the path a warning
        // most needs to survive: it was produced off the main thread and `parsed` arrived as
        // plain data. That is exactly what ParseWarning is shaped for. `registerSource`
        // ignores an absent or empty array, which is also what makes a host that hands over
        // an older parse — one with no `warnings` at all — behave as it always did.
        return registerSource(srcId, modelNode, meta, result.warnings);
    }
    function addMatSourceParsed(srcId, parsed, meta) {
        const result = parsed;
        const matNode = MatNode.fromParsed(result, srcId);
        return registerSource(srcId, matNode, meta, result.warnings);
    }
    // The source a node ultimately belongs to, or null for the synthetic all-node.
    function ownerSourceOf(node) {
        if (!node || ('__isAllNode' in node && node.__isAllNode)) {
            return null;
        }
        let cur = node;
        while (cur.parent) {
            cur = cur.parent;
        }
        return cur;
    }
    // Drop any selection or preview that points into `source` (all of them when
    // `source` is null). Closing a file must not leave the active/preview node
    // referencing a detached tree — getActiveSlddNode() would keep walking up to the
    // removed root and hand callers a source the session no longer owns, so edits
    // and undo would be routed at a document that is no longer open.
    function releaseSelection(source) {
        let activeChanged = false;
        if (contextNode && (source === null || ownerSourceOf(contextNode) === source)) {
            contextNode = null;
            activeChanged = true;
        }
        if (entryNodes.length > 0) {
            const kept = source === null ? [] : entryNodes.filter((n) => ownerSourceOf(n) !== source);
            if (kept.length !== entryNodes.length) {
                entryNodes = kept;
                activeChanged = true;
            }
        }
        if (previewNode && (source === null || ownerSourceOf(previewNode) === source)) {
            previewNode = null;
            publish('preview/changed');
        }
        if (activeChanged) {
            publishActiveChanged();
        }
    }
    // The same release, one subtree wide instead of one document wide: drop any
    // selection or preview pointing at a node in `subtree`, and leave everything else
    // alone. What releaseSelection is to closing a file, this is to deleting a node —
    // a selection left on a removed node is a node the session no longer owns, so
    // getActiveSlddNode() walks up a detached tree and an edit routed there mutates an
    // orphan that vanishes on save.
    //
    // The subtree is passed in by identity, captured BEFORE the removal, rather than
    // discovered afterwards by walking parents. Walking would work today, because every
    // container's removeChild nulls the removed node's parent and so stops the walk at
    // exactly the right place — but that makes correctness here depend on a detail of
    // five node classes, and the failure if one of them ever forgets is silent and
    // document-wide: ownerSourceOf would reach the live root and this would deselect
    // everything in the file.
    function releaseSubtreeSelection(subtree) {
        if (subtree.length === 0) {
            return;
        }
        const removed = new Set(subtree);
        let activeChanged = false;
        if (contextNode && !('__isAllNode' in contextNode) && removed.has(contextNode)) {
            contextNode = null;
            activeChanged = true;
        }
        if (entryNodes.length > 0) {
            const kept = entryNodes.filter((n) => !removed.has(n));
            if (kept.length !== entryNodes.length) {
                entryNodes = kept;
                activeChanged = true;
            }
        }
        if (previewNode && removed.has(previewNode)) {
            previewNode = null;
            publish('preview/changed');
        }
        if (activeChanged) {
            publishActiveChanged();
        }
    }
    function removeDataSource(srcId) {
        const source = dataSources.get(srcId);
        if (!source) {
            return;
        }
        deindexSource(source);
        dataSources.delete(srcId);
        // Drop the selection BEFORE announcing the removal. A subscriber to
        // 'datamodel/source-removed' legitimately asks what is selected now (to repaint a
        // property inspector, to decide whether to close a panel), and publishing first
        // answered that question with the tree that was just removed — getActiveSlddNode()
        // walks parents and would hand back the removed root, exactly the stale-context
        // hazard releaseSelection exists to prevent.
        releaseSelection(source);
        publish('datamodel/source-removed', { srcId });
    }
    function removeAll() {
        dataSources.clear();
        nodeIndex.clear();
        publish('datamodel/cleared');
        releaseSelection(null);
    }
    function getDataSource(srcId) {
        return dataSources.get(srcId) || null;
    }
    function hasDataSource(srcId) {
        return dataSources.has(srcId);
    }
    function getDataSourceIds() {
        return Array.from(dataSources.keys());
    }
    function getDataSourceCount() {
        return dataSources.size;
    }
    function isBatching() {
        return batchDepth > 0;
    }
    function findNodeById(nodeId) {
        return nodeIndex.get(nodeId) || null;
    }
    /**
     * Every node matching `query`, live, as findNodeById hands back live nodes.
     *
     * The lookup findNodeById could not do. There was no find-by-name, by class, by kind
     * or by value, and nothing that crossed sources, so each host wrote its own
     * flatten().filter(...) — the same predicate three times over, each walking the whole
     * tree again per keystroke. This walks nothing: nodeIndex is already flat and already
     * kept current by registerSource/indexSource/deindexSource and by the mutation paths,
     * so a query is one pass over the indexed nodes.
     *
     * Deliberately NOT backed by a name or prefix index of its own. A second index is a
     * second thing to keep correct on every add, delete, rename and reparse, and nothing
     * has asked for one: no profile shows this pass mattering, and a flat pass over one
     * Map is already the substance of the complaint. A prefix index can be layered
     * underneath later without changing this signature, which is the point of the
     * signature being a query object rather than a walk the caller writes.
     *
     * Decisions a caller can rely on:
     *
     *   - Criteria combine with AND. Two fields are a narrowing, never a union: it is the
     *     least surprising reading of a filled-in form, and it is the only one where
     *     adding a field cannot make the answer bigger.
     *
     *   - A query with no criteria matches NOTHING. `{}`, a query whose every field is
     *     `undefined`, one built from an empty search box, and one holding only modifiers
     *     all give the same empty answer — no field's absence is allowed to mean something
     *     different from any other's. The alternative reading (AND over nothing is true,
     *     so return the session) is defensible in logic and bad in practice: this is what
     *     a keystroke path calls, and "the user has typed nothing" must not answer with
     *     every node in every open file. Nothing is lost, because "give me everything" is
     *     already precise and cheap through getDataSource(id).flatten().
     *
     *   - A RegExp keeps its own flags; `caseSensitive` governs string criteria only. See
     *     compileTextTest, which also explains the one rewrite (`g`/`y`) and why it is
     *     forced.
     *
     *   - Results come back in the order the session indexed them: per source, the
     *     pre-order walk indexSource performs (parent before child, siblings in tree
     *     order), sources in the order they were indexed. That is document order — the
     *     order a tree view draws and a results list wants — and it is why nothing is
     *     sorted here: sorting by id would put '/x/10' before '/x/2' and section 'arch'
     *     before section 'design', an order matching nothing the user can see, for a cost
     *     the tree order does not charge. The one place index order and open-document
     *     order part company is a source RE-registered after another was opened, which
     *     re-indexes it at the back; still deterministic, and a caller that needs results
     *     grouped the way getDataSourceIds() reports them can query per source and
     *     concatenate.
     *
     *   - Live INode objects, not DTOs. An in-process host edits what it finds, and
     *     toDTO is the projection applied at the out-of-process edge by the caller that
     *     needs it (see src/core/dto.ts) — producing DTOs here would tax every in-process
     *     search to serve the boundary that already has its own answer.
     *
     * What is searched is what is INDEXED: every node inside each open source, not the
     * source roots themselves (ContainerNode.flatten excludes its receiver, so a root is
     * no more findable here than through findNodeById — a root is named by
     * getDataSourceIds()/getDataSource()). An unknown `sourceId` returns nothing, the same
     * answer getDataSource gives for an id it does not hold, rather than silently widening
     * to every source.
     */
    function findNodes(query) {
        const criteria = compileCriteria(query);
        if (criteria.length === 0) {
            return [];
        }
        // A cap, so a cap below one admits nothing. Reading 0 as "uncapped" instead would
        // turn an off-by-one in a host's paging arithmetic into the largest answer the
        // session can produce.
        const limit = query.limit === undefined ? Infinity : query.limit;
        if (limit < 1) {
            return [];
        }
        let scope = null;
        if (query.sourceId !== undefined) {
            const source = dataSources.get(query.sourceId);
            if (!source) {
                return [];
            }
            scope = source;
        }
        const found = [];
        for (const node of nodeIndex.values()) {
            // The scope narrows the candidate set the criteria then run over, so it goes
            // first. Compared by walking to the owning root rather than by testing the id for
            // a `sourceId/` prefix: an id is built from the root node's NAME, and that is not
            // always the srcId — addProjectSource names a `.prj` root by its basename — so a
            // prefix test would quietly answer a different question for those sources.
            if (scope && ownerSourceOf(node) !== scope) {
                continue;
            }
            let matched = true;
            for (let i = 0; i < criteria.length; i++) {
                if (!criteria[i](node)) {
                    matched = false;
                    break;
                }
            }
            if (!matched) {
                continue;
            }
            found.push(node);
            if (found.length >= limit) {
                break;
            }
        }
        return found;
    }
    /**
     * The first node matching `query`, or null — findNodes in the shape findNodeById
     * already has, for the caller that wants one node rather than a list.
     *
     * Worth its own entry point because it can stop at the first hit instead of building
     * a list to read one element of, and because "is there anything called X" and "resolve
     * this name to a node" are the questions a link resolver and a CLI argument actually
     * ask. Routed through findNodes with limit 1 rather than reimplemented, so the two can
     * never disagree about ordering or about what matches.
     *
     * A caller's own `limit` is overridden rather than respected: asking for the first
     * match is not a capped-list question, and there is no reading of `limit` that changes
     * which node is first.
     */
    function findNode(query) {
        const found = findNodes({ ...query, limit: 1 });
        return found.length > 0 ? found[0] : null;
    }
    // The srcId a source root is open under, or null for a root this session does not
    // hold. A linear scan of dataSources rather than a reverse map: the map is keyed by
    // srcId and holds one entry per OPEN FILE — a handful, not a tree — and a second map
    // would be a second thing to keep correct on every register and remove.
    function srcIdOf(source) {
        if (!source) {
            return null;
        }
        for (const [srcId, candidate] of dataSources) {
            if (candidate === source) {
                return srcId;
            }
        }
        return null;
    }
    // The open source a link target's file NAME means, or null when no open source answers
    // to it.
    //
    // A target only ever holds a file name, because that is all MATLAB records — a model
    // stores its dictionary as 'mdlparams.sldd' and never as a path. A host's srcId, on the
    // other hand, is whatever it opens files by: a basename from ingest(), a full path, or
    // an opaque document key with the real path in meta. Matching only exact srcIds would
    // make every link in this package dead for two of those three hosts, so four ways to
    // answer are tried, in order of how specific the evidence is:
    //
    //   4. the srcId is exactly the target;
    //   3. the srcId's basename is (a host keyed by path);
    //   2. the recorded meta.path's basename is (a host keyed by an opaque id);
    //   1. the target and the candidate are the same MODEL with the other extension — see
    //      modelStemOf for why that is a real case rather than a courtesy.
    //
    // Best rank wins, and ties go to the first source opened, so the answer is deterministic
    // and an exactly-named file is never shadowed by a looser match on another. Case-sensitive
    // throughout (except the extension itself): a srcId is a host key, not a filesystem
    // lookup, and folding case here would let two distinct open sources answer as one.
    function openSourceNamed(name) {
        if (!name) {
            return null;
        }
        const stem = modelStemOf(name);
        let best = null;
        for (const [srcId, source] of dataSources) {
            const path = source.meta && typeof source.meta.path === 'string' ? source.meta.path : '';
            let rank = 0;
            if (srcId === name) {
                rank = 4;
            }
            else if (basenameOf(srcId) === name) {
                rank = 3;
            }
            else if (path !== '' && basenameOf(path) === name) {
                rank = 2;
            }
            else if (stem !== null) {
                const candidateStem = modelStemOf(basenameOf(srcId)) ?? (path !== '' ? modelStemOf(basenameOf(path)) : null);
                if (candidateStem !== null && candidateStem === stem) {
                    rank = 1;
                }
            }
            if (rank > 0 && (best === null || rank > best.rank)) {
                best = { rank, srcId, source };
            }
        }
        return best === null ? null : { srcId: best.srcId, source: best.source };
    }
    // The top-level entries of one open source that are named `name`, in document order.
    //
    // Routed through findNodes rather than walking the tree, so the two can never disagree
    // about ordering or about which sources are in scope — and so this costs one pass over
    // the flat index that is already maintained, with no index of its own (the same decision
    // findNodes documents, for the same reason: a second index is a second thing to keep
    // correct on every add, delete, rename and reparse, and nothing has asked for one).
    //
    // findNodes' `name` criterion is a SUBSTRING test, because that is what a search box
    // wants, so the exact-name filter here is not redundant: a target for `Kp` must not
    // resolve to `Kprime`. The isEntry filter is what makes "a `.sldd` target names an
    // ENTRY" true — a bus element or a struct field is not a name a model can refer to, and
    // a link that resolved to one would send a host to a node no parameter could have meant.
    function entriesNamed(srcId, name) {
        const candidates = findNodes({ name, sourceId: srcId, caseSensitive: true });
        return candidates.filter((node) => node.name === name && node.isEntry === true);
    }
    /**
     * The node a `linkTarget` points at, or why it could not be reached.
     *
     * The lookup nothing in this package offered. Every node that could point into another
     * file already published a `linkTarget` string in its row — ModelBlockNode writes
     * `Kp@mdlparams.sldd`, DataSourceNode and ModelReferenceNode write a bare file name —
     * and no API turned one back into a node even when both files were already open in the
     * same session. Worse, a consumer had to know WHICH node class produced the string to
     * know how to read it, and needing to know the producer to parse the value is the tell
     * that resolution belongs to the session rather than to each caller.
     *
     * The grammar is `name@source` for an entry and a bare name for a source, and it is
     * closed — see splitLinkTarget for both forms, for why a bare target is a FILE even when
     * an open dictionary happens to hold an entry by that name, and for why there is no
     * `fromNodeId` parameter.
     *
     * The name part is read as an EXPRESSION, not as a whole name: ModelBlockNode builds its
     * target from the parameter's raw value, so `[tau 1]@mdlparams.sldd` is a target this
     * package genuinely produces, and a strict whole-string lookup would leave every such
     * link dead. The identifiers in it are the names it can mean (identifiersIn), tried in
     * the order the expression names them, and a `not-found` still reports the target's own
     * name part rather than whatever was extracted from it — the host is showing the user a
     * link, and the link said `[tau 1]`.
     *
     * Cost: one pass over the flat node index per identifier, and no cache. A resolver that
     * memoized would be a second thing to invalidate on every mutation and on every source
     * added or removed, and following a link is a click, not a keystroke path. This was a
     * decision, not an oversight; the signature does not change if a profile ever says
     * otherwise.
     *
     * What it does NOT do: nothing here follows a chain. A resolved sub-dictionary is a
     * root, and the entries it in turn inherits are the caller's next question, asked the
     * same way (see resolveDictionaryReferences).
     */
    function resolveLink(target) {
        if (typeof target !== 'string' || target.trim() === '') {
            return { status: 'empty' };
        }
        const { name, source } = splitLinkTarget(target);
        const open = openSourceNamed(source);
        if (open === null) {
            // The one answer a host can act on, so it carries both halves of the target: the
            // file to offer to open, and the name to go to once it is open.
            return { status: 'source-not-open', sourceId: source, name };
        }
        if (name === null) {
            // A bare target names the file itself, so the answer is its ROOT — which is a node
            // findNodeById cannot reach at all, because ContainerNode.flatten() excludes its
            // receiver and roots are therefore not in the node index.
            const root = open.source;
            return { status: 'resolved', sourceId: open.srcId, node: root, nodes: [root] };
        }
        const found = [];
        for (const identifier of identifiersIn(name)) {
            for (const node of entriesNamed(open.srcId, identifier)) {
                // An expression can name the same entry twice (`gravity + gravity`), and two
                // identifiers can reach the same node only that way, so identity is enough.
                if (!found.includes(node)) {
                    found.push(node);
                }
            }
        }
        if (found.length === 0) {
            return { status: 'not-found', sourceId: open.srcId, name };
        }
        return { status: 'resolved', sourceId: open.srcId, node: found[0], nodes: found };
    }
    // Whether `model` could resolve the name `definition` defines — the visibility rule
    // findUsages applies before crediting any usage.
    //
    // Two ways a model reaches a definition, and they are the two MATLAB itself offers:
    //
    //   - the model's OWN model workspace, which is private to it. This is why a section
    //     check is needed rather than just an owner check: a block is also a top-level entry
    //     of its model, and without this a block named `tau` would collect the usages of the
    //     workspace variable `tau`.
    //   - a file the model declares as external data — its linked data dictionary and any
    //     external `.mat`. Read off the `dataSources` section rather than from the
    //     `dataDictionary` field, because that section is where ModelNode.fromParsed puts
    //     BOTH, so one rule covers dictionary entries and MAT variables without naming
    //     either.
    //
    // Everything else is invisible: two unrelated projects open in one session, or a model
    // linked to a DIFFERENT dictionary that happens to define the same name, must not
    // collect each other's usages. That is the whole reason this is not just a name match.
    // `owner` and `definitionSrcId` are passed in rather than re-derived per model: they are
    // properties of the definition, which does not change across the scan.
    function modelCanSee(model, definition, owner, definitionSrcId) {
        if (model === owner) {
            const parent = definition.parent;
            return parent !== null && parent.name === 'workspace';
        }
        // A host-supplied tree (addParsedSource) need not have sections at all.
        const declared = typeof model.getSection === 'function' ? model.getSection('dataSources') : null;
        if (!declared || !Array.isArray(declared.children)) {
            return false;
        }
        for (const child of declared.children) {
            // The row's own name is the file name the model recorded, resolved through the same
            // matcher a bare link target goes through — so "the dictionary this model links" and
            // "the dictionary that link points at" can never be answered differently.
            const named = openSourceNamed(child.name);
            if (named !== null && named.srcId === definitionSrcId) {
                return true;
            }
        }
        return false;
    }
    /**
     * Every block parameter that references the definition `nodeId` names — the reverse of
     * resolveLink, and the index item 4's `UsedBy` column is a consumer of.
     *
     * A definition is a top-level entry of a dictionary, of a `.mat`, or of a model's own
     * workspace; anything else answers with nothing. A struct field and a bus element are
     * not definitions (a block parameter cannot name one: `cfg.mode` is a reference to
     * `cfg`, which is what gets the credit — see identifiersIn), and neither is a block,
     * even though a block is technically an entry of its model. "Which blocks use this
     * block" is a different question with a different answer shape, and so is "which models
     * use this model" or "which dictionaries reference this one": those are reverse
     * relationships between FILES, they would each return something that is not a
     * NodeUsage, and inventing a union to squeeze them in here would make every caller of
     * the common case handle three shapes. The file-level reverse direction is deliberately
     * not part of this.
     *
     * Visibility is enforced, not assumed — see modelCanSee. A name match alone would make
     * two unrelated projects open in one session report each other's usages.
     *
     * Cost: a scan over the block-parameter lists the open models already hold, per call,
     * with NO reverse index. Deliberate, and the same decision findNodes documents: a
     * name → usages map would have to be rebuilt or patched on every source added, removed
     * or re-registered and on every mutation, and the material being scanned is one array
     * per open model that the parser built once. If a profile ever disagrees, an index can
     * be layered underneath without changing this signature.
     *
     * One call per row is therefore one scan per row, and a row cell is now a consumer of
     * this (see UsageResolver): a five-hundred-row table asking one node at a time walks the
     * same arrays five hundred times. That is what rowsOf() is for — it asks collectUsages
     * once for every node it is about to project. Still no index: see rowsOf for why a batch
     * that cannot outlive its own call is not the thing this paragraph declined to build.
     *
     * Returns plain data with no live nodes on it, because its destination is a row cell
     * that crosses a structured-clone boundary — see NodeUsage.
     */
    function findUsages(nodeId) {
        const definition = nodeIndex.get(nodeId);
        // The same empty answer findNodeById gives for an id it does not hold: enumerating
        // rows and asking about each should not need a guard per row.
        if (!definition) {
            return [];
        }
        return collectUsages([definition]).get(nodeId) ?? [];
    }
    // Every usage of every definition in `definitions`, keyed by definition node id.
    //
    // The whole of the rule findUsages documents, with the definition loop lifted OUT so that
    // one pass over the open models can answer for a whole table at once. findUsages is this
    // with a list of one, so there is exactly one implementation of "what counts as a usage"
    // and the batch has no second copy to drift from — the same single gate SectionNode's
    // allowsType is for what may be pasted into a section.
    //
    // A node that is not a definition gets no key at all rather than an empty one: the caller
    // reads a miss and an empty list the same way, and building keys for every field and bus
    // element a table happens to contain would make the map the size of the tree.
    function collectUsages(definitions) {
        const result = new Map();
        // The definitions asked about, grouped by the NAME a block parameter would have to use
        // to reach one, because a name is what a scan over parameter values can look up. A name
        // maps to a LIST: a dictionary can hold the same name in two sections at once (a design
        // entry and its derived counterpart), and both are then used by the same block.
        const byName = new Map();
        for (const definition of definitions) {
            // A definition is a top-level entry that has a name. A struct field, a bus element and
            // an id the session does not hold are not, and answer with nothing; see the doc comment
            // above for why a block is excluded too, even though a block passes the isEntry gate.
            if (!definition || definition.isEntry !== true || !definition.name) {
                continue;
            }
            const owner = ownerSourceOf(definition);
            const srcId = srcIdOf(owner);
            if (srcId === null) {
                continue;
            }
            const usages = [];
            result.set(definition.id, usages);
            const named = byName.get(definition.name);
            if (named) {
                named.push({ node: definition, owner, srcId, usages });
            }
            else {
                byName.set(definition.name, [{ node: definition, owner, srcId, usages }]);
            }
        }
        if (byName.size === 0) {
            return result;
        }
        for (const [srcId, source] of dataSources) {
            // Duck-typed rather than `instanceof ModelNode`: addParsedSource takes a tree this
            // package did not build, and a host that supplies block-parameter usages in the
            // documented shape should be searchable. The reads below are defensive for the same
            // reason — one hostile source must not take the whole scan down, the rule
            // textCriterion applies on the search path.
            const declared = source.blockParamUsages;
            if (!Array.isArray(declared)) {
                continue;
            }
            // Visibility is a property of (model, definition) and does not vary across the usage
            // list, so it is settled once per source before the list is walked at all — which is
            // what the single-definition form did too, one definition at a time.
            const visible = new Map();
            for (const [name, defs] of byName) {
                const reachable = defs.filter((d) => modelCanSee(source, d.node, d.owner, d.srcId));
                if (reachable.length > 0) {
                    visible.set(name, reachable);
                }
            }
            if (visible.size === 0) {
                continue;
            }
            for (const raw of declared) {
                const usage = raw;
                if (!usage || typeof usage.paramValue !== 'string' || typeof usage.blockName !== 'string') {
                    continue;
                }
                // A Set of the identifiers, because an expression can name one definition twice
                // (`gravity + gravity`) and that is ONE place it is referenced, not two — which is
                // what the single-definition form's `includes()` said by construction.
                for (const identifier of new Set(identifiersIn(usage.paramValue))) {
                    const targets = visible.get(identifier);
                    if (!targets) {
                        continue;
                    }
                    for (const target of targets) {
                        target.usages.push({
                            blockName: usage.blockName,
                            blockType: typeof usage.blockType === 'string' ? usage.blockType : '',
                            paramProperty: typeof usage.paramProperty === 'string' ? usage.paramProperty : '',
                            paramValue: usage.paramValue,
                            modelSrcId: srcId,
                            // The forward grammar, reversed: an entry of the model named by the model. See
                            // NodeUsage for why this and not a second target format.
                            linkTarget: usage.blockName + '@' + srcId,
                        });
                    }
                }
            }
        }
        return result;
    }
    // What a row's `UsedBy` cell is filled from: the callback registerSource stamps on every
    // source root, and the only way a node ever reaches into the session (see UsageResolver).
    //
    // Answers out of the current rowsOf() batch when there is one and runs the scan itself
    // otherwise, which is what keeps the two paths one contract instead of two: a row
    // projected inside a batch and the same row projected on its own carry the same cell, and
    // the batch stays a cost decision no caller has to know about. A node id a batch does not
    // hold is a node collectUsages declined — not a definition — so the empty answer is the
    // right one and not a shortcut past a scan.
    function usagesForRow(nodeId) {
        if (usageBatch !== null) {
            return usageBatch.get(nodeId) ?? [];
        }
        return findUsages(nodeId);
    }
    /**
     * Every row of a container's subtree, with `UsedBy` filled, in one pass — the projection
     * a host renders a TABLE from.
     *
     * `node.toRow()` fills that column by itself, because the resolver is stamped on the
     * source root and a node walks up to find it; a host that changed nothing therefore stops
     * seeing a blank column. But it fills it by asking about ONE node, and asking about one
     * node costs a scan over every open model's block-parameter list. A five-hundred-row
     * table is five hundred walks of the same arrays.
     *
     * So this asks collectUsages once, for exactly the nodes it is about to project, and each
     * row reads its answer out of that map. One pass per open model, whatever the row count.
     *
     * The map lives for this call and is then dropped, which is precisely why it is not the
     * reverse index findUsages declined to build: there is nothing to invalidate when a source
     * is added, removed or re-registered or when a node is edited, because it cannot outlive
     * the call that made it. The previous batch is saved and restored rather than cleared, so
     * a nested call can never leave an outer one reading an emptied map.
     *
     * Skips the nodes that project no row — a container answers toRow() with null, a section
     * not being a row — rather than returning nulls for a caller to filter. Order is
     * flatten()'s, the order a tree draws, and it excludes the container itself.
     *
     * Takes a container rather than a node list: the caller holding a table holds a container,
     * and the caller holding a list can flatten its own. Something with no flatten() (a
     * host-supplied tree that is not a container) answers with no rows rather than throwing,
     * the rule serializeSource follows for a source it cannot serialize. A node whose own
     * toRow() throws still throws — this is the host's projection batched, not a more
     * forgiving one, and swallowing it would leave a table with an unexplained hole.
     */
    function rowsOf(container) {
        const nodes = container && typeof container.flatten === 'function' ? container.flatten() : [];
        const previous = usageBatch;
        usageBatch = collectUsages(nodes);
        try {
            const rows = [];
            for (const node of nodes) {
                const row = node.toRow();
                if (row !== null) {
                    rows.push(row);
                }
            }
            return rows;
        }
        finally {
            usageBatch = previous;
        }
    }
    /**
     * The sub-dictionaries `srcId` references, each with the same answer resolveLink gives.
     *
     * The one link in this package that was never projected into a row, so a host could not
     * even see it to follow it: a referenced sub-dictionary is parsed (both `.sldd` readers
     * keep DD.DICTIONARYREFERENCE / 'Dictionary References') and kept as a name on
     * SlddNode.dictionaryReferences, typed `unknown[]`, resolved by nobody. The consequence
     * is that entries a dictionary inherits from the one it references are simply invisible.
     *
     * Worth its own entry point rather than leaving hosts to iterate that field and call
     * resolveLink themselves, for the reason findNodes was worth one: otherwise all three
     * consumers write the same `unknown[]` narrowing, and the one that gets it wrong reports
     * a dictionary as having no references at all.
     *
     * What this does NOT do, and must not: it does not graft the sub-dictionary's entries
     * into the referencing dictionary. The reference is resolved — the sub-dictionary's root
     * is reachable, and its entries are then findable in it by every lookup this session has
     * — and that is the whole of it. The tree is what a host renders AND what serializeSource
     * writes back, so an inherited entry shown as living in the referencing file would be
     * edited there and lost on save, and it would appear in the JSON that file writes. A
     * host that wants to show inheritance shows two files.
     *
     * One level, not a chain, for the same reason: a resolved sub-dictionary's own
     * references are the next question, asked the same way. Recursing here would also have
     * to decide what to do about a cycle, which is a decision nothing has asked for yet.
     */
    function resolveDictionaryReferences(srcId) {
        const source = dataSources.get(srcId);
        if (!source) {
            return [];
        }
        const refs = source.dictionaryReferences;
        // Absent for every format but `.sldd`, and empty for a dictionary that references
        // nothing. Both are "no references", which is the honest answer to the question.
        if (!Array.isArray(refs)) {
            return [];
        }
        const resolved = [];
        for (const ref of refs) {
            // The field is `unknown[]` because it is written from two different readers, so a
            // non-string is possible and is skipped rather than coerced: 'undefined' is not a
            // file name, and reporting one would send a host looking for it.
            if (typeof ref !== 'string' || ref === '') {
                continue;
            }
            resolved.push({ name: ref, resolution: resolveLink(ref) });
        }
        return resolved;
    }
    function reindexAll() {
        nodeIndex.clear();
        dataSources.forEach((src) => indexSource(src));
    }
    subscribe('node/added', reindexAll);
    subscribe('node/deleted', reindexAll);
    subscribe('node/children-changed', reindexAll);
    // --- Mutation Actions ---
    // The value `propertyName` currently holds on `node`, as the string setProperty
    // accepts, so an edit can be undone without the caller having to supply the prior
    // value. Falls back to `fallback` when the node does not project the property (an
    // arbitrary key, or one absent from getProperties), which keeps a caller that DOES
    // pass oldValue authoritative for anything this cannot see.
    function readPropertyValue(node, propertyName, fallback) {
        try {
            const props = node.getProperties();
            for (let i = 0; i < props.length; i++) {
                const key = props[i].key;
                const column = props[i].column;
                if (key === propertyName || column === propertyName) {
                    // displayValue is the round-trippable text form (what the inspector shows
                    // and what an edit submits); `value` may be a live object reference.
                    return node.getPropInfo(props[i]).displayValue;
                }
            }
        }
        catch {
            // A node whose property projection throws must not break the edit itself.
        }
        return fallback;
    }
    function editProperty(nodeId, propertyName, newValue, oldValue) {
        const activeNode = getActiveNode();
        if (!activeNode || activeNode.id !== nodeId) {
            return false;
        }
        if ('__isAllNode' in activeNode) {
            return false;
        }
        const node = activeNode;
        if (!node.setProperty) {
            return false;
        }
        // Capture the pre-edit value so undo can restore it even when the caller omits
        // `oldValue`. The parameter is optional, and README's own example omits it, so
        // trusting it meant undo called setProperty(prop, undefined) — destroying the
        // prior value instead of restoring it, with redo unable to bring it back either.
        // Read through getPropInfo (the same path the property inspector displays) so the
        // captured value is in the shape setProperty round-trips; fall back to the passed
        // `oldValue` if this node does not project the property.
        const priorValue = readPropertyValue(node, propertyName, oldValue);
        const result = node.setProperty(propertyName, newValue);
        if (result !== true) {
            return result || false;
        }
        const slddNode = getActiveSlddNode();
        const kind = propertyName === 'Name' ? 'rename' : 'property';
        if (slddNode) {
            const cmd = {
                execute() {
                    node.setProperty(propertyName, newValue);
                    publish('node/edited', { source: 'undo', nodeId: node.id, kind });
                    if (kind === 'rename') {
                        publishActiveChanged();
                    }
                    publish('node/children-changed', { parent: node });
                },
                undo() {
                    node.setProperty(propertyName, priorValue);
                    publish('node/edited', { source: 'undo', nodeId: node.id, kind });
                    if (kind === 'rename') {
                        publishActiveChanged();
                    }
                    publish('node/children-changed', { parent: node });
                },
            };
            UndoManager.pushExecuted(slddNode.name, cmd);
        }
        publish('node/edited', { source: 'pi', nodeId: node.id, kind });
        if (kind === 'rename') {
            publishActiveChanged();
        }
        publish('node/children-changed', { parent: node });
        return true;
    }
    function addEntry(sectionKey, className, entryName) {
        const slddNode = getActiveSlddNode();
        if (!slddNode) {
            return null;
        }
        let section = slddNode.getSection(sectionKey);
        if (!section) {
            // When at root (sectionKey='sldd'), find the section that accepts this className
            for (const child of slddNode.children) {
                const sec = child;
                if (sec.getAllowedTypes && sec.getAllowedTypes().includes(className)) {
                    section = sec;
                    break;
                }
            }
            if (!section) {
                return null;
            }
        }
        if (!section.execAddEntry) {
            return null;
        }
        const result = section.execAddEntry(className, entryName);
        if (!result) {
            return null;
        }
        const srcId = slddNode.name;
        const node = result.node;
        const sectionRef = section;
        UndoManager.pushExecuted(srcId, {
            execute() {
                result.redo();
                nodeIndex.set(node.id, node);
                setActiveEntry(node);
                publish('node/added', { node, sectionKey: sectionRef.name });
            },
            undo() {
                result.undo();
                nodeIndex.delete(node.id);
                setActiveEntry(null);
                publish('node/deleted', { node, section: sectionRef });
            },
        });
        nodeIndex.set(node.id, node);
        publish('node/added', { node, sectionKey: section.name });
        setActiveEntry(node);
        return node;
    }
    // Where the selection goes once `removed` (a node and its descendants, captured
    // before the removal) is out of the tree. `next` is what 'follow' selects instead —
    // null for an entry, the surviving parent for a child.
    function selectAfterRemoval(policy, removed, next) {
        if (policy === 'follow') {
            setActiveEntry(next);
            return;
        }
        releaseSubtreeSelection(removed);
    }
    // The body addChild() and addChildTo() share. `scope` is the document the undo step
    // is filed under; null means there is nowhere to file it, which is NOT a refusal —
    // the mutation still happens, because that is what the selection-driven form has
    // always done for a node whose root tracks no `dirty` flag.
    function addChildOfNode(node, scope, policy) {
        if (!node.execAddChild) {
            return null;
        }
        const rawResult = node.execAddChild();
        if (!rawResult) {
            return null;
        }
        const result = rawResult;
        const child = result.node;
        if (scope) {
            UndoManager.pushExecuted(scope.name, {
                execute() {
                    result.redo();
                    nodeIndex.set(child.id, child);
                    if (policy === 'follow') {
                        setActiveEntry(child);
                    }
                    publish('node/children-changed', { parent: node });
                },
                undo() {
                    // Undoing an add is a removal, so the subtree has to be read while it is
                    // still attached — hence before result.undo() rather than after.
                    const removed = policy === 'follow' ? [] : child.flatten();
                    result.undo();
                    nodeIndex.delete(child.id);
                    selectAfterRemoval(policy, removed, node);
                    publish('node/children-changed', { parent: node });
                },
            });
        }
        nodeIndex.set(child.id, child);
        publish('node/children-changed', { parent: node });
        return child;
    }
    // One node's removal, shared by deleteNode() and deleteNodeById(). Every refusal the
    // tree can make returns false WITHOUT pushing an undo step for a removal that never
    // happened: no hook on the parent, a parent whose own canRemoveChild says no, or a
    // node its parent no longer contains (the stale-selection case).
    function deleteOneNode(node, scope, policy) {
        if (node.isEntry) {
            const section = node.parent;
            if (!section || !section.execRemoveEntry) {
                return false;
            }
            const nodeId = node.id;
            const removed = policy === 'follow' ? [] : node.flatten();
            const result = section.execRemoveEntry(node);
            if (!result) {
                return false;
            }
            UndoManager.pushExecuted(scope.name, {
                execute() {
                    const currentId = node.id;
                    const redoRemoved = policy === 'follow' ? [] : node.flatten();
                    result.redo();
                    nodeIndex.delete(currentId);
                    selectAfterRemoval(policy, redoRemoved, null);
                    publish('node/deleted', { node, section });
                },
                undo() {
                    result.undo();
                    nodeIndex.set(node.id, node);
                    if (policy === 'follow') {
                        setActiveEntry(node);
                    }
                    publish('node/added', { node, sectionKey: section.name });
                },
            });
            nodeIndex.delete(nodeId);
            // Release before announcing, for the same reason removeDataSource does: a
            // subscriber to 'node/deleted' legitimately asks what is selected now, and
            // answering with the node just removed is the hazard, not a detail.
            selectAfterRemoval(policy, removed, null);
            publish('node/deleted', { node, section });
            return true;
        }
        const parent = node.parent;
        if (!parent || !parent.execRemoveChild) {
            return false;
        }
        const nodeId = node.id;
        const removed = policy === 'follow' ? [] : node.flatten();
        const rawResult = parent.execRemoveChild(node);
        if (!rawResult) {
            return false;
        }
        const result = rawResult;
        UndoManager.pushExecuted(scope.name, {
            execute() {
                const currentId = node.id;
                const redoRemoved = policy === 'follow' ? [] : node.flatten();
                result.redo();
                nodeIndex.delete(currentId);
                selectAfterRemoval(policy, redoRemoved, parent);
                publish('node/children-changed', { parent });
            },
            undo() {
                result.undo();
                nodeIndex.set(node.id, node);
                if (policy === 'follow') {
                    setActiveEntry(node);
                }
                publish('node/children-changed', { parent });
            },
        });
        nodeIndex.delete(nodeId);
        selectAfterRemoval(policy, removed, parent);
        publish('node/children-changed', { parent });
        return true;
    }
    // A multi-entry removal as ONE undoable step, shared by deleteNode() and
    // deleteNodesById(). Entries only: a non-entry caught up in the list is skipped
    // rather than dragging its whole parent down with it.
    function deleteEntryBatch(nodes, scope, policy) {
        const undoInfo = [];
        const removed = [];
        for (const node of nodes) {
            if (!node.isEntry)
                continue;
            const section = node.parent;
            if (!section || !section.execRemoveEntry)
                continue;
            const nodeId = node.id;
            const subtree = policy === 'follow' ? [] : node.flatten();
            const result = section.execRemoveEntry(node);
            if (result) {
                undoInfo.push({ node, nodeId, section, result });
                removed.push(...subtree);
            }
        }
        if (undoInfo.length === 0) {
            return false;
        }
        UndoManager.pushExecuted(scope.name, {
            execute() {
                const redoRemoved = [];
                for (const info of undoInfo) {
                    const currentId = info.node.id;
                    if (policy !== 'follow') {
                        redoRemoved.push(...info.node.flatten());
                    }
                    info.result.redo();
                    nodeIndex.delete(currentId);
                }
                selectAfterRemoval(policy, redoRemoved, null);
                publish('node/deleted', { node: undoInfo[0].node, section: undoInfo[0].section });
            },
            undo() {
                for (let i = undoInfo.length - 1; i >= 0; i--) {
                    undoInfo[i].result.undo();
                    nodeIndex.set(undoInfo[i].node.id, undoInfo[i].node);
                }
                if (policy === 'follow') {
                    setActiveEntry(undoInfo.map((info) => info.node));
                }
                publish('node/added', { node: undoInfo[0].node, sectionKey: undoInfo[0].section.name });
            },
        });
        for (const info of undoInfo) {
            nodeIndex.delete(info.nodeId);
        }
        selectAfterRemoval(policy, removed, null);
        publish('node/deleted', { node: undoInfo[0].node, section: undoInfo[0].section });
        return true;
    }
    function addChild() {
        const node = entryNodes.length === 1 ? entryNodes[0] : null;
        if (!node) {
            return null;
        }
        // The undo scope comes from the CONTEXT here, not from the target: the two can
        // differ (a host may hold context on one document and an entry in another), and
        // which one the selection-driven form uses is established behaviour.
        return addChildOfNode(node, getActiveSlddNode(), 'follow');
    }
    // The explicit form of addChild, for a caller with no selection to mutate through.
    // The undo scope is resolved from the TARGET, because getActiveSlddNode() derives
    // from contextNode and a headless caller has none — which is the whole gap.
    function addChildTo(nodeId) {
        const node = nodeIndex.get(nodeId);
        if (!node) {
            return null;
        }
        return addChildOfNode(node, editableOwnerOf(node), 'keep');
    }
    function deleteNode() {
        const nodes = getEntryNodes();
        if (nodes.length === 0) {
            return false;
        }
        const slddNode = getActiveSlddNode();
        if (!slddNode) {
            return false;
        }
        if (nodes.length === 1) {
            return deleteOneNode(nodes[0], slddNode, 'follow');
        }
        return deleteEntryBatch(nodes, slddNode, 'follow');
    }
    // The explicit form of deleteNode. Unlike the zero-arg form it does not need a
    // selection at all: the document to record undo against is the one the target node
    // belongs to. Recording it against the selection instead would file the step under
    // whatever file happened to be selected — so undo in the file that actually changed
    // would do nothing, and undo in the untouched one would replay a change it never made.
    function deleteNodeById(nodeId) {
        const node = nodeIndex.get(nodeId);
        if (!node) {
            return false;
        }
        const scope = editableOwnerOf(node);
        if (!scope) {
            return false;
        }
        return deleteOneNode(node, scope, 'keep');
    }
    // The batch form. Exists because deleteNode() has a distinct multi-select branch
    // that records ONE undo step for the whole removal, and a headless caller needs that
    // as much as a UI does — deleting five entries one call at a time leaves five steps
    // the user has to undo five times.
    function deleteNodesById(nodeIds) {
        const nodes = [];
        for (const id of nodeIds) {
            const node = nodeIndex.get(id);
            if (node) {
                nodes.push(node);
            }
        }
        if (nodes.length === 0) {
            return false;
        }
        const scope = editableOwnerOf(nodes[0]);
        if (!scope) {
            return false;
        }
        // An undo command belongs to exactly one document's stack, so a batch spanning two
        // files could only be filed under one of them: undo there would half-restore two
        // files, and the other would be left holding a change with no step to undo it.
        // Refuse rather than record that, and let the caller loop per source — which is
        // what it wants anyway, one undoable step per document.
        for (const node of nodes) {
            if (editableOwnerOf(node) !== scope) {
                return false;
            }
        }
        if (nodes.length === 1) {
            return deleteOneNode(nodes[0], scope, 'keep');
        }
        return deleteEntryBatch(nodes, scope, 'keep');
    }
    function undoAction() {
        const slddNode = getActiveSlddNode();
        if (!slddNode) {
            return;
        }
        UndoManager.undo(slddNode.name);
    }
    function redoAction() {
        const slddNode = getActiveSlddNode();
        if (!slddNode) {
            return;
        }
        UndoManager.redo(slddNode.name);
    }
    function canUndoActive() {
        const slddNode = getActiveSlddNode();
        return slddNode ? UndoManager.canUndo(slddNode.name) : false;
    }
    function canRedoActive() {
        const slddNode = getActiveSlddNode();
        return slddNode ? UndoManager.canRedo(slddNode.name) : false;
    }
    function setPreviewNode(node) {
        previewNode = node;
        publish('preview/changed');
    }
    function getPreviewNode() {
        return previewNode;
    }
    function clearPreviewNode() {
        if (previewNode !== null) {
            previewNode = null;
            publish('preview/changed');
        }
    }
    // The editable source owning `node`. A `dirty` flag is what marks a root as an
    // editable document, so a root without one (e.g. a read-only project) is reported as
    // no editable owner at all — there is nothing to record an undo step against.
    //
    // Split out of getActiveSlddNode because the (nodeId) mutation forms need exactly
    // this answer for a node the caller named rather than for the context node: they must
    // work with no selection, and undo has to be filed under the document that actually
    // changed. Same rule, different starting node.
    function editableOwnerOf(node) {
        const root = ownerSourceOf(node);
        if (!root) {
            return null;
        }
        return root.dirty !== undefined ? root : null;
    }
    // The editable source owning the context node.
    function getActiveSlddNode() {
        return editableOwnerOf(contextNode);
    }
    /**
     * One source's content, in the form it should be written back in, or null when this
     * session cannot produce it.
     *
     * Null for two distinct absences, deliberately given the same answer: a srcId the
     * session does not hold (the same answer getDataSource gives the same question), and
     * a source whose format HAS no write path. `.slx`, `.mdl`, `.mat` and `.prj` are
     * read-only in this package — only `.sldd` has a writer, and only that writer has a
     * live MATLAB gate behind it. Null rather than a throw because a consumer enumerating
     * every open source to find the saveable ones should not need a try/catch per source,
     * and because there is nothing exceptional about a project file not being writable.
     *
     * The flavour follows the FILE, not a default: a `.sldd` that arrived as a
     * compressed-binary package is answered with zip bytes and one that arrived as JSON
     * text with JSON text, because the point of serializing is writing back over the
     * original. That is recorded rather than guessed — the binary reader emits a
     * `__rawXml` part, which is what makes SlddNode.parse set sourceFormat to 'xml'.
     */
    function serializeSource(srcId) {
        const source = dataSources.get(srcId);
        if (!source) {
            return null;
        }
        // An instanceof rather than a duck test on serializeJson: serializeBinarySldd
        // reaches for _zipMetadata and _dataSourceAttrs, so a lookalike that merely
        // answers the same method names would be handed to a writer built for the class.
        if (!(source instanceof SlddNode)) {
            return null;
        }
        if (source.sourceFormat === 'xml') {
            const zipped = serializeBinarySldd(source);
            return { kind: 'binary', sourceFormat: source.sourceFormat, bytes: new Uint8Array(zipped) };
        }
        // Tab-indented, which is what MATLAB itself writes (every textual fixture in this
        // repo opens `{\n\t"__MW_TEXT_COREPROPERTIES__"`), so a saved file keeps looking
        // like the one that was opened. Not byte-exact: MATLAB collapses some small objects
        // onto one line and JSON.stringify does not, so the round trip is a semantic one.
        return {
            kind: 'text',
            sourceFormat: source.sourceFormat,
            text: JSON.stringify(source.serializeJson(), null, '\t'),
        };
    }
    function getActiveSourceNode() {
        return ownerSourceOf(contextNode);
    }
    const session = {
        allNode,
        addDataSource,
        addParsedSource,
        addModelSource,
        addModelSourceParsed,
        addMatSource,
        addMatSourceParsed,
        addProjectSource,
        removeDataSource,
        removeAll,
        getDataSource,
        hasDataSource,
        getDataSourceIds,
        getDataSourceCount,
        serializeSource,
        isBatching,
        setActiveContext,
        setActiveEntry,
        setActive,
        getContextNode,
        getEntryNode,
        getEntryNodes,
        getActiveNode,
        getActiveSlddNode,
        getActiveSourceNode,
        setPreviewNode,
        getPreviewNode,
        clearPreviewNode,
        findNodeById,
        // The search surface beside the single-id lookup: findNodes for a result set,
        // findNode for the first match. Both read the same index findNodeById reads.
        findNodes,
        findNode,
        // Link resolution, both directions, over the same index: resolveLink follows a
        // `linkTarget` a node published, findUsages answers the reverse for a definition,
        // and resolveDictionaryReferences does the same for the one link that never
        // reached a row — a `.sldd`'s referenced sub-dictionaries.
        resolveLink,
        findUsages,
        resolveDictionaryReferences,
        // The batched row projection for a whole table. There is deliberately no `rowFor(node)`
        // beside it: `node.toRow()` IS that call now that the usage resolver is injected into
        // the tree, and a session-level alias for it would be a second name for one projection.
        rowsOf,
        beginBatch,
        endBatch,
        editProperty,
        addEntry,
        // The selection-driven mutation forms, for a host that already tracks a
        // selection, and the explicit (nodeId) forms beside them for one that does not.
        // Both are supported surface: neither is a deprecation of the other.
        addChild,
        deleteNode,
        addChildTo,
        deleteNodeById,
        deleteNodesById,
        undo: undoAction,
        redo: redoAction,
        canUndo: canUndoActive,
        canRedo: canRedoActive,
        bus,
    };
    return session;
}
const DataModel = createSession({ bus: defaultBus });
export default DataModel;
//# sourceMappingURL=DataModel.js.map