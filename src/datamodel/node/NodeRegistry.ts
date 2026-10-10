// Copyright 2026 The MathWorks, Inc.

import type BaseNode from './BaseNode.js';
import type DataNode from './DataNode.js';
import type { MatVariable } from '../parser/MatParser.js';
import type { McosDecoded } from './data/mcosTypedNode.js';

export interface NodeClassMapAPI {
    parseValue(rawVal: unknown, name: string, parent: BaseNode | null): DataNode;
    getClass(className: string): NodeClassType | null;
    getRegisteredClasses(): string[];
    // Reclass a just-parsed plain MATLAB variable as a Constant. SectionNode calls
    // this when an entry is derived (Architectural Data), so a Constant is modeled
    // by its own class without SectionNode importing it (avoids a cycle). Returns
    // the node unchanged if it isn't a plain MATLAB variable.
    wrapDerivedVariable(node: DataNode): DataNode;
    // Model an MCOS object nested in a struct field or a cell element of a .mat file or
    // a model workspace, once its container has decoded it, as the node the same object
    // gets at top level. MatlabVariableNode.parseMatVariable calls this from its opaque
    // arm, so it reaches mcosTypedNode without importing it — mcosTypedNode imports
    // MatlabVariableNode, so the direct import would be a cycle. Null means "model it as
    // the opaque variable it is".
    modelMcosVariable(variable: MatVariable, decoded: McosDecoded, name: string, parent: BaseNode | null): DataNode | null;
    // Decode every MCOS object in a parsed MAT stream against the stream's own subsystem
    // (mcosTypedNode.attachMcosDecoded), for a value MatlabVariableNode decodes itself — a
    // binary dictionary's encoded value — rather than a container. Through the registry
    // for the cycle modelMcosVariable records.
    attachMcosDecoded(blobBytes: Uint8Array | null | undefined, variables: MatVariable[]): void;
}

// Anything that can turn a parsed value into a node. This is all the structural
// fallback chain needs: those entries are reached by value SHAPE, never by
// className, so they are never asked to create a blank entry. It is a separate
// interface because ObjectNode — the chain's catch-all for any object shape — is
// parse-only and so carries no defaultName; typing the chain as NodeClassType
// would force a meaningless one on it.
export interface NodeParser {
    parse(rawVal: unknown, name: string, parent: BaseNode | null): DataNode;
}

// A class registered under a className, which additionally backs "Add <class>".
export interface NodeClassType extends NodeParser {
    // Optional: a class may be able to model existing data yet have no meaningful
    // blank instance, in which case "Add <class>" is not offered for it.
    createDefault?(name: string, parent: BaseNode | null): DataNode;
    // REQUIRED, even when createDefault is absent: this is the user-facing name a
    // new entry gets, and it is deliberately not derivable from the className — an
    // EnumTypeDefinition entry is named 'EnumType', a ServiceBus one
    // 'ServiceInterface'. Making it required is what stops a newly registered class
    // from silently inheriting a wrong name from a fallback.
    defaultName: string;
}

let classMap: NodeClassMapAPI | null = null;

export function init(map: NodeClassMapAPI): void {
    classMap = map;
}

export function parseValue(rawVal: unknown, name: string, parent: BaseNode | null): DataNode {
    return classMap!.parseValue(rawVal, name, parent);
}

export function getClass(className: string): NodeClassType | null {
    return classMap!.getClass(className);
}

export function getRegisteredClasses(): string[] {
    return classMap!.getRegisteredClasses();
}

export function wrapDerivedVariable(node: DataNode): DataNode {
    return classMap!.wrapDerivedVariable(node);
}

export function modelMcosVariable(
    variable: MatVariable,
    decoded: McosDecoded,
    name: string,
    parent: BaseNode | null,
): DataNode | null {
    return classMap!.modelMcosVariable(variable, decoded, name, parent);
}

export function attachMcosDecoded(blobBytes: Uint8Array | null | undefined, variables: MatVariable[]): void {
    classMap!.attachMcosDecoded(blobBytes, variables);
}

export default { init, parseValue, getClass, getRegisteredClasses, wrapDerivedVariable, modelMcosVariable, attachMcosDecoded };
