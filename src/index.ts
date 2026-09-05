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
// cannot be — data-explorer-vscode scans a whole workspace of files on disk, with
// MATLAB's shadowing over them — and that resolver has to read an expression the SAME
// way, or the same file yields two different usage answers depending on which asked.
// It did: the host's own copy credited `mode` in `cfg.mode`, inventing a usage for any
// entry named `mode`. The rule is the shared thing; the scope is not.
export { identifiersIn } from './core/DataModel.js';
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
