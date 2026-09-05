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