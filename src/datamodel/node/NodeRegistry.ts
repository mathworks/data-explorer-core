// Copyright 2026 The MathWorks, Inc.

import type BaseNode from './BaseNode.js';
import type DataNode from './DataNode.js';

export interface NodeClassMapAPI {
    parseValue(rawVal: unknown, name: string, parent: BaseNode | null): DataNode;
    getClass(className: string): NodeClassType | null;
    getRegisteredClasses(): string[];
    // Reclass a just-parsed plain MATLAB variable as a Constant. SectionNode calls
    // this when an entry is derived (Architectural Data), so a Constant is modeled
    // by its own class without SectionNode importing it (avoids a cycle). Returns
    // the node unchanged if it isn't a plain MATLAB variable.
    wrapDerivedVariable(node: DataNode): DataNode;
}

// Anything that can turn a parsed value into a node. This is all the structural
// fallback chain needs — those entries are reached by value SHAPE, never by name,
// so they are never asked to create a blank entry and carry no defaultName.
export interface NodeParser {
    parse(rawVal: unknown, name: string, parent: BaseNode | null): DataNode;
}

// A class registered under a className, which additionally backs "Add <class>".
export interface NodeClassType extends NodeParser {
    // Optional: a class may be able to model existing data yet have no meaningful
    // blank instance, in which case "Add <class>" is not offered for it.
    createDefault?(name: string, parent: BaseNode | null): DataNode;
    // REQUIRED, even for a parse-only class: this is the user-facing name a new
    // entry gets, and it is deliberately not derivable from the className — an
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

export default { init, parseValue, getClass, getRegisteredClasses, wrapDerivedVariable };
