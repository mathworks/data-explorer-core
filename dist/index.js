// Copyright 2026 The MathWorks, Inc.
// Public entry point for data-explorer-core.
// Milestone 1: re-exports the surface consumed by data-explorer-vscode today,
// with no renaming. A curated REST-style facade lands in a later milestone.
// Side-effecting node-class registration (must be imported for registry setup).
import './datamodel/node/NodeClassMap.js';
// Runtime services (core).
export { default as DataModel } from './core/DataModel.js';
export * as EventBus from './core/EventBus.js';
export { publish, subscribe } from './core/EventBus.js';
export * as UndoManager from './core/UndoManager.js';
// Session/bus/undo factories (milestone 2 — per-instance state).
export { createSession } from './core/DataModel.js';
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
export { createUndoManager } from './core/UndoManager.js';
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
// Universal ingest (sniff + dispatch) — superset entry over addXSource.
export { ingest } from './core/ingest.js';
// Which KIND of file a name refers to. Public because every consumer decides this too —
// a host filters a folder listing, admits a drop, labels a tab — and each one that spells
// its own `endsWith('.sldd')` gets a case-sensitive test where the glob that admitted the
// file was not, so `Params.SLDD` is found, opened, and then classified as nothing. These
// are the tests this package's own readers dispatch on, so a host that shares them cannot
// disagree with the package about what a file is.
export { extOf, basenameOf, refBasename, modelNameOf, isModelFile, isSlddFile, isMatFile, isProjectFile, } from './datamodel/fileKinds.js';
// Reading a `.sldd` without a session: which of the two on-disk formats the bytes are,
// where the content sits inside the result, and what a reference means. Public because a
// consumer that scans dictionaries WITHOUT opening them — to index a folder, to resolve a
// chain — otherwise reimplements the format sniff, and a sniff that guesses from the
// extension reads a compressed dictionary as JSON and reports it as empty. normalizeRefNames
// is the one that had actually drifted: a reference is a bare string or a `{ file }` object
// depending on which writer produced the file, so a reader that accepts only strings
// resolves the sub-dictionaries of one flavour and none of the other.
export { readSlddContent, slddChunkContent, isJsonTextBytes, normalizeRefNames } from './datamodel/parser/SlddContent.js';
// Usage across a SET OF FILES rather than across a session — which blocks refer to a
// definition, and where a block parameter's names resolve, over files a caller has read
// but need not have opened. session.findUsages answers the same question for registered
// sources; this answers it for a workspace, with MATLAB's workspace → dictionary → MAT
// shadowing and transitive dictionary references, and needs no node trees to do it. The
// answers are `NodeUsage`, the same shape findUsages returns, so a host renders one cell
// either way.
export { buildUsageIndex, summarizeFiles, resolveName } from './datamodel/usage/UsageIndex.js';
// Serializable DTO projection — the machine contract for --json / RPC boundaries.
export { toDTO } from './core/dto.js';
// Nodes, schema bridge, kind map, section constants.
export { default as ModelBlockNode } from './datamodel/node/data/ModelBlockNode.js';
export { default as SlddNode } from './datamodel/node/container/SlddNode.js';
export { generateUuid } from './datamodel/node/container/SectionNode.js';
export { schemaColumnLabels } from './datamodel/node/schemaBridge.js';
export { kindForClass } from './datamodel/kindMap.js';
export { getSectionMetadata } from './datamodel/SectionConstants.js';
//# sourceMappingURL=index.js.map