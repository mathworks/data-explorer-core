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
export { createEventBus } from './core/EventBus.js';
export type { EventBusInstance } from './core/EventBus.js';
export { createUndoManager } from './core/UndoManager.js';
export type { UndoManagerInstance } from './core/UndoManager.js';

// Parsers + serializer (datamodel).
export { parseBinarySldd, parseBinarySlddParts } from './datamodel/parser/BinarySlddParser.js';
export { serializeEntryToXml } from './datamodel/parser/BinarySlddSerializer.js';
export { parseSlx } from './datamodel/parser/SlxParser.js';
export { parseMat } from './datamodel/parser/MatParser.js';
export { parseProject } from './datamodel/parser/ProjectParser.js';

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
