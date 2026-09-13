// Copyright 2026 The MathWorks, Inc.
// Public entry point for data-explorer-core.
// Milestone 1: re-exports the surface consumed by data-explorer-vscode today,
// with no renaming. A curated REST-style facade lands in a later milestone.

// Side-effecting node-class registration (must be imported for registry setup).
import './datamodel/node/data/NodeClassMap.js';

// Runtime services (core).
export { default as DataModel } from './core/DataModel.js';
export type { AllNode, SourceMeta } from './core/DataModel.js';
export * as EventBus from './core/EventBus.js';
export { publish, subscribe } from './core/EventBus.js';
export type { Topics, Subscription } from './core/EventBus.js';
export * as UndoManager from './core/UndoManager.js';

// Session/bus/undo factories (milestone 2 — per-instance state).
export { createSession } from './core/DataModel.js';
export type { Session, CreateSessionOptions } from './core/DataModel.js';
// What session.serializeSource() hands back. Public because a consumer writing the
// result to a file has to be able to name the discriminated shape it switches on.
export type { SerializedSource } from './core/DataModel.js';
// What session.findNodes()/findNode() take. Public for the same reason: a host builds
// one of these from its own search UI, holds it in a field, and passes it around —
// none of which it can write down while the type has no name.
export type { FindNodesQuery } from './core/DataModel.js';
// What the link resolver hands back. LinkResolution is a discriminated union a host
// switches on — the 'source-not-open' arm is the one it acts on, by offering to open the
// file — so it has to be nameable to be switched on in a helper of the host's own.
// NodeUsage is what session.findUsages() returns and what a `UsedBy` cell is built from,
// and DictionaryReference the same for a `.sldd`'s referenced sub-dictionaries: both end
// up in a host's own arrays and function signatures.
export type { LinkResolution, NodeUsage, DictionaryReference } from './core/DataModel.js';
// How this package reads a block-parameter expression: the names in `2*Kp`, `[tau 1]`,
// `cfg.mode`. Public because a host can have a resolver of its own that this package
// cannot be, and that resolver has to read an expression the SAME way, or the same file
// yields two different usage answers depending on which asked. It did: the host's own
// copy credited `mode` in `cfg.mode`, inventing a usage for any entry named `mode`. The
// rule is the shared thing; the scope is not.
export { identifiersIn } from './datamodel/expressions.js';
// How a block is identified, labelled and located, for the same reason `identifiersIn` is
// public: a host that builds an index of its own over `parseModel`'s output — a search
// index over every block in a folder of models, say — must key a block the way this
// package does and print it the way this package does, or the two disagree about which
// blocks a model even has. A name is unique only within one system, so keying by name
// merges blocks and dropping the blank ones hides them; both are decisions this package
// has already made once, in blockIdentity.
// `isInsideBlockPath` is here for the same reason and answers the question the other three
// leave open: whether one of those paths is inside another. Its own reason to exist is that
// `/` is escaped by doubling, so `A//B/C` is a block inside a block NAMED `a/b` and not
// inside a block `A` — which a plain `startsWith` gets wrong.
export { blockKey, blockLabel, isInsideBlockPath, joinBlockPath } from './datamodel/blockIdentity.js';
export { createEventBus } from './core/EventBus.js';
export type { EventBusInstance } from './core/EventBus.js';
export { createUndoManager } from './core/UndoManager.js';
export type { UndoManagerInstance } from './core/UndoManager.js';

// The inflate seam. Every decompression in this package goes through it, and it finds
// `node:zlib` by itself on Node 22.3+ (`process.getBuiltinModule`), falling back to
// fflate everywhere else — a browser bundle included. `setNativeInflate` is published
// because detection cannot cover every host: a consumer on an older Node, or one that
// imports only this barrel and knows it is in Node, can arm the fast engine explicitly
// and get ~5x on inflate. Passing `null` forces the fflate path.
export { setNativeInflate, nativeInflateAvailable } from './datamodel/parser/Inflate.js';
export type { NativeInflate } from './datamodel/parser/Inflate.js';

// Parsers + serializer (datamodel).
export { parseBinarySldd, parseBinarySlddParts } from './datamodel/parser/BinarySlddParser.js';
// The whole write path for a compressed-binary `.sldd`: serializeBinarySldd rebuilds
// the package, serializeEntryToXml one entry's fragment for the splice edit path.
// Both are what the live MATLAB write-back gate proves, and neither was reachable
// from outside this repo — the exports map publishes no deep import, so a consumer
// could read a dictionary the package had verified it could write, and then not
// write it. Prefer session.serializeSource() when a session already holds the file:
// it picks the flavour the file arrived in, which this cannot know.
export { serializeBinarySldd, serializeEntryToXml } from './datamodel/parser/BinarySlddSerializer.js';
export { parseSlx } from './datamodel/parser/SlxParser.js';
export { parseMdl } from './datamodel/parser/MdlParser.js';
// The format-agnostic reader: `.slx` or either flavour of `.mdl`, decided by the
// bytes. Prefer it over parseSlx/parseMdl unless the format is already known.
export { parseModel } from './datamodel/parser/ModelParser.js';
export { parseMat } from './datamodel/parser/MatParser.js';
export { parseProject } from './datamodel/parser/ProjectParser.js';
export type { ParsedProject, ProjectFile, ProjectLabel, ProjectReference } from './datamodel/parser/ProjectParser.js';

// What the model and MAT readers return. A consumer has to be able to NAME a parse
// result to hold one in a field, annotate a variable, or write a function that takes
// one — exporting parseSlx while hiding ParsedSlx leaves it able to call the reader
// and unable to say what came back. These go all the way down: BlockParamUsage and
// MatVariable are the named types the two result shapes are BUILT from, and an
// exported function whose return type mentions an unexported interface is the same
// defect one level lower. ParsedMdl is `ParsedSlx` under the name parseMdl declares,
// because a classic `.mdl` and a `.slx` are the same model to this package.
export type { ParsedSlx, BlockParamUsage } from './datamodel/parser/SlxParser.js';
export type { ParsedMdl } from './datamodel/parser/MdlParser.js';
export type { ParsedMat, MatVariable } from './datamodel/parser/MatParser.js';

// The diagnostics channel for a parse that succeeded but is short. A consumer has
// to be able to NAME this type to render "opened with 2 warnings", so it is public
// surface, not an internal detail.
export type { ParseWarning, ParseWarningCode } from './datamodel/parser/ParseWarning.js';

// Universal ingest (sniff + dispatch) — superset entry over addXSource.
export { ingest } from './core/ingest.js';
export type { IngestContent, IngestOptions } from './core/ingest.js';

// Which KIND of file a name refers to. Public because every consumer decides this too —
// a host filters a folder listing, admits a drop, labels a tab — and each one that spells
// its own `endsWith('.sldd')` gets a case-sensitive test where the glob that admitted the
// file was not, so `Params.SLDD` is found, opened, and then classified as nothing. These
// are the tests this package's own readers dispatch on, so a host that shares them cannot
// disagree with the package about what a file is.
// `refModelExt` is here for a sharper version of the same reason: it is not a question
// about a file this package was GIVEN, it is the guess this package MAKES when a model
// names a reference without an extension — and a host that indexes `parseModel`'s raw
// `modelReferences` has to make the identical guess to resolve an edge by filename. Both
// spelled `/\.mdl$/i.test(name) ? '.mdl' : '.slx'` independently, so the tree row and the
// graph edge agreed only by coincidence; now there is one of them.
// `projectNameOf` is the third of that kind, and the plainest: `parseProject` is public and
// takes a project NAME, not a filename, so every caller has to strip the `.prj` first —
// this package before it builds a project's node tree, a host before it builds its own
// index over the same parse. The result is a label a user reads on both sides.
export {
  extOf,
  basenameOf,
  refBasename,
  modelNameOf,
  refModelExt,
  projectNameOf,
  isModelFile,
  isSlddFile,
  isMatFile,
  isProjectFile,
} from './datamodel/fileKinds.js';

// Reading a `.sldd` without a session: which of the two on-disk formats the bytes are,
// where the content sits inside the result, and what a reference means. Public because a
// consumer that scans dictionaries WITHOUT opening them — to index a folder, to resolve a
// chain — otherwise reimplements the format sniff, and a sniff that guesses from the
// extension reads a compressed dictionary as JSON and reports it as empty. normalizeRefNames
// is the one that had actually drifted: a reference is a bare string or a `{ file }` object
// depending on which writer produced the file, so a reader that accepts only strings
// resolves the sub-dictionaries of one flavour and none of the other.
export { readSlddContent, slddChunkContent, isJsonTextBytes, normalizeRefNames } from './datamodel/parser/SlddContent.js';

// The same read, for a caller that wants ONLY the entry names and the referenced
// sub-dictionaries. Published because that caller exists three times over — two indexes
// in the extension and `summarizeFiles` here — and each was paying for the whole entry
// tree to read one string per entry: 3230 ms and 31,345 objects on the larger customer
// dictionary, against ~100 ms for the scan. It is a strict substitute, not a second
// format reader: it falls back to `readSlddContent` for anything it has not been proven
// equivalent on, and that equivalence is checked over the whole corpus by the oracle.
export { scanSldd, type SlddScanResult } from './datamodel/parser/SlddScan.js';

// The same trade on the other format a usage index reads. `parseMat` decodes every element
// of every matrix to hand back a list of names, which is all two of its three callers ever
// read: 1271 ms over the corpus's `.mat` files against 4.4 ms here. Published because one
// of those callers is in the extension — its name index calls `parseMat` and reads only
// `variables[].name` — and it cannot reach a module this barrel does not export. Same
// discipline as `scanSldd`: a strict substitute that falls back to `parseMat` for anything
// it has not been proven equivalent on, checked name-by-name over the corpus by the oracle
// and over the fixtures by the test suite.
export { scanMat, type MatScanResult } from './datamodel/parser/MatScan.js';

// The same trade for the third format, and the one whose caller pays most often: a host
// that draws a model's relationships rebuilds them on every save, and `parseModel` walks
// every block to hand back three strings' worth of them. 1600 ms over a 127-model corpus
// against 75 ms here, for the same 76 dictionary links, 82 references and 13 external
// sources; 605 ms against 2.0 ms on a 13 MB model, where the parts these three fields come
// from total 1.4 KB. Unlike the two scanners above this one reads no bytes of its own — it
// runs the FULL parser over a smaller set of OPC parts, so the answer is the same answer
// rather than a second derivation of it.
export { scanModelStructure, type ModelStructure } from './datamodel/parser/ModelStructureScan.js';

// WHERE those entries sit — the zip member name and the three-step JSON key path to the
// one part a dictionary keeps its entries in. Published for the same reason `SC_PART` is,
// and more sharply: a host that WRITES a dictionary owns the document this package cannot
// touch. It holds the open zip's other members and must preserve them byte-for-byte while
// replacing exactly one, and it splices byte offsets into the raw JSON text rather than
// re-serializing it — so it looks the part up, excludes it, and re-inserts it under names
// that have to be identical to these. Drift is not a throw at either end: the wrong
// exclusion ships a zip carrying the entries twice, and the wrong JSON key hands back
// content this package reads as `null` and reports as an empty dictionary.
export { DATA_PART, DATA_PART_XML, DATA_PART_KEY, TEXT_PARTS, TEXT_CONTENT } from './datamodel/parser/SlddParts.js';

// The System Composer catalog: what says a `Simulink.Bus` is a struct type rather than
// a data interface. It is a SEPARATE part of the dictionary that references its entries
// BY NAME, so a host that renames a catalogued entry has to carry the rename into that
// part or the entry silently loses its classification on the next read — and the part is
// stored two ways (a JSON object in a textual `.sldd`, a zipped MF0 XML member in a
// compressed-binary one), so the carry needs one rule and two readers. Public because
// the rename happens in the HOST: it owns the open document's text and the zip members,
// and this package cannot splice either for it. `classificationOf` is the read side, for
// a consumer that wants an entry's System Composer type without walking the tree.
export {
  SC_PART,
  SC_PART_XML,
  SC_TYPE_TO_CLASSIFICATION,
  applyScEdits,
  catalogFromDefinitions,
  classificationOf,
  scRenameEdits,
  scanScJsonText,
  scanScXml,
} from './datamodel/parser/ScCatalog.js';
export type { ScDefinition, ScNameSite, ScTextEdit, SystemComposerCatalog } from './datamodel/parser/ScCatalog.js';

// Usage across a SET OF FILES rather than across a session — which blocks refer to a
// definition, and where a block parameter's names resolve, over files a caller has read
// but need not have opened. session.findUsages answers the same question for registered
// sources; this answers it for a workspace, with MATLAB's mask → workspace → dictionary →
// MAT shadowing and transitive dictionary references, and needs no node trees to do it. The
// answers are `NodeUsage`, the same shape findUsages returns, so a host renders one cell
// either way.
export { buildUsageIndex, summarizeFiles, resolveName } from './datamodel/usage/UsageIndex.js';
export type {
  UsageIndex,
  UsageFile,
  FileSummaries,
  ModelSummary,
  DataSummary,
  ParamOrigin,
  OriginKind,
} from './datamodel/usage/UsageIndex.js';
// The innermost of those scopes, and the only one that is not a file: a masked subsystem's
// own parameters. On the barrel because `ParamOrigin.maskBlock` hands one out — a host
// rendering a mask-resolved parameter needs the block's path to name the source of the
// value, and its key to link there.
export { maskDefining } from './datamodel/maskScope.js';
export type { MaskScope } from './datamodel/maskScope.js';

// Serializable DTO projection — the machine contract for --json / RPC boundaries.
export { toDTO } from './core/dto.js';
export type { NodeDTO, PropDTO, SourceDTO, ToDTOOptions } from './core/dto.js';

// Nodes, schema bridge, kind map, section constants.
export { default as ModelBlockNode } from './datamodel/node/data/ModelBlockNode.js';
export { default as SlddNode } from './datamodel/node/container/SlddNode.js';
export { generateUuid } from './datamodel/node/container/SectionNode.js';
export { schemaColumnLabels } from './datamodel/node/schemaBridge.js';
export { kindForClass } from './datamodel/kindMap.js';
export { getSectionMetadata } from './datamodel/SectionConstants.js';

// One shared cell per distinct value across a table's rows. A host with its own row
// builder (the VS Code table stamps its own columns over each node's row) creates one per
// materialization pass and passes it to `toRow`; `rowsOf` does it internally.
export { default as RowCellPool } from './datamodel/node/RowCellPool.js';

// WHICH REGION of a document an edit changed, and the one way to apply it. This package
// already produces the new text for every structural edit; "what changed" is the same
// question about the same two strings whatever renders them, so it is not a fact about a
// front-end. Public because the write path lives in the CONSUMER: a host owns the open
// document and writes the region itself, and any host writing a 47.8 MB dictionary back has
// to write a region rather than the whole file. `minimalReplacement` is the part worth
// sharing — it nudges both boundaries off a surrogate pair, so an offset never lands between
// the two code units of an emoji, which is the subtle rule each host would otherwise
// reimplement (and a `.sldd` really does carry emoji in Description strings).
export { applyTextPatch, minimalReplacement } from './edit/textPatch.js';
export type { TextPatch } from './edit/textPatch.js';

// WHERE an entry lives in a binary .sldd's `data/chunk0.xml`, and WHICH entry that is.
// This package already owns every other part of that format — the parser, the serializer,
// the parts, the catalog, the inflater — and the span finders are the piece a host needs
// to write a structural edit back into the text those produce. They belong beside the
// parser for a concrete reason: `findEntryObjectSpan` matches the Name P-node on its
// `Name` attribute ALONE, because `BinarySlddParser` does, and when the two disagreed the
// result was an entry the table listed and no edit could touch. Keeping the finder and
// the parser in one package is what keeps that agreement checkable.
//
// `EntrySelector` is the identity half, and the reason it is public rather than an
// implementation detail: a name is not an identity in a .sldd, because names are unique
// only per NAMESPACE and one file holds several, so `Array` in Design Data and `Array` in
// Other Data are two entries. Every front-end that deletes or renames a row has to know
// that, and would otherwise rediscover it as a bug — a delete that removed the wrong row.
//
// Asymmetry to be honest about: the JSON-side splicer for text .sldd files is still in
// data-explorer-vscode, because it needs a JSON parser this package does not depend on.
export { findEntryObjectSpan, findEntryElementSpan, findEntryInsertionPoint } from './datamodel/parser/xmlEntrySplice.js';
export type { XmlSpan } from './datamodel/parser/xmlEntrySplice.js';
export { toEntrySelector, entrySelectorOf } from './datamodel/parser/entrySelector.js';
export type { EntrySelector } from './datamodel/parser/entrySelector.js';

// WHICH ENTRY a row belongs to. Public because it is the first question every entry-scoped
// gesture in a front-end asks — an entry is the unit both .sldd formats splice, so deleting
// a bus element, dragging three rows of one bus, and pasting beside a row all have to
// resolve rows to entries before they can do anything. `isEntry` and `parent` are both node
// members of ours, so the walk is a fact about this model; the consumer that spelled it out
// for itself was answering our question with its own copy of our rule.
//
// A function rather than only the `DataNode.owningEntry` getter, because the callers that
// need it most cannot reach a getter: a SECTION or a source root is a ContainerNode and has
// no `isEntry` at all (its answer is null, not itself), and a host testing its own edit
// paths holds stand-ins shaped like nodes. Both already read `isEntry` off the object, so
// this narrows nothing that was ever narrow.
export { owningEntryOf } from './datamodel/node/DataNode.js';

// WHAT DELETING A SET OF ROWS MEANS, which is not the same question as how to delete them.
// Delete is the one action with no destination, so it is the one that acts on ROWS rather
// than entries: its operands can mix whole entries with nested children of other entries,
// across sections, and turning that mix into model work is arithmetic about `isEntry` and
// `parent` — ours, and identical for every front-end. `findNode` is injected precisely so
// the planner does not care who resolved the row.
//
// Public because the two halves it does NOT do are the consumer's: splicing the text and
// pushing the undo step. What it exists to prevent is a front-end grouping the rows itself
// and getting the grouping wrong — two children of one bus must arrive as ONE group,
// because each group reserializes its entry, so two groups over one entry would each write
// a stale copy and the second would silently undo the first. That defect looks like a
// delete that half-worked, and it is invisible until a file is saved and re-read.
export { planDeletion } from './core/deletionPlan.js';
export type { DeletionPlan, ChildGroup } from './core/deletionPlan.js';

// WHAT SHAPE a node actually has, which is not what its `dims` reports. MATLAB's `size()`
// has no trailing singleton dimensions past the second — a 2x3x1 IS a 2x3 — and this package
// normalizes through this rule everywhere it renders a shape, ELEMENT LABELS included: the
// element rows of a [2,3,1] are labelled with two subscripts, not three, because
// `subscriptLabel` normalizes first. What it does NOT do is normalize every `dims` accessor
// on the way out: `ObjectNode` and `StructNode` happen to, `MatlabVariableNode` — the class
// with element children, so the one a grid reads — reports `_dims` raw.
//
// Public because that leaves a consumer holding two facts of ours that only agree once the
// rule is applied. Read a node's three-entry `dims` against the two-subscript labels this
// package wrote for its elements and the ranks disagree, so a front-end placing those
// elements into a dims-shaped buffer refuses a perfectly good matrix. The consumer's grid
// did exactly that until it carried a copy of this function, in a comment naming this file:
// the rule is ours, and a second copy of it in a host is a second answer to `size()` that
// can drift from the labels it has to line up with.
//
// The rest of DisplayConvention — the thresholds, the empty spellings, `summaryForm` — stays
// internal, because those are decisions about how THIS package prints a value, and it is the
// one printing it. `effectiveDims` is different: it is a fact about the array.
export { effectiveDims } from './datamodel/display/DisplayConvention.js';

// Public data-shape types.
export type { RowData, PropClass, PropInfo, PIGroupDef, PIObject } from './datamodel/node/BaseNode.js';
