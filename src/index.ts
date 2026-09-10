// Copyright 2026 The MathWorks, Inc.
// Public entry point for data-explorer-core.
// Milestone 1: re-exports the surface consumed by data-explorer-vscode today,
// with no renaming. A curated REST-style facade lands in a later milestone.

// Side-effecting node-class registration (must be imported for registry setup).
import './datamodel/node/NodeClassMap.js';

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
export { blockKey, blockLabel, joinBlockPath } from './datamodel/blockIdentity.js';
export { createEventBus } from './core/EventBus.js';
export type { EventBusInstance } from './core/EventBus.js';
export { createUndoManager } from './core/UndoManager.js';
export type { UndoManagerInstance } from './core/UndoManager.js';

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
// sources; this answers it for a workspace, with MATLAB's workspace → dictionary → MAT
// shadowing and transitive dictionary references, and needs no node trees to do it. The
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

// Public data-shape types.
export type { RowData, PropClass, PropInfo, PIGroupDef, PIObject } from './datamodel/node/BaseNode.js';
