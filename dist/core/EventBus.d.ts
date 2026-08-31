import type { INode, IContainerNode, ISourceNode } from './NodeInterfaces.js';
export interface Topics {
    'active/changed': void;
    'preview/changed': void;
    'datamodel/source-added': {
        srcId: string;
        slddNode: ISourceNode;
    };
    'datamodel/source-removed': {
        srcId: string;
    };
    'datamodel/cleared': void;
    'node/edited': {
        source: string;
        nodeId: string;
        kind: string;
    };
    'node/added': {
        node: INode;
        sectionKey: string;
    };
    'node/deleted': {
        node: INode;
        section: IContainerNode;
    };
    'node/children-changed': {
        parent: INode;
    };
    'undo/changed': {
        srcId: string;
    };
    'clipboard/changed': {
        mode: string;
        nodeId: string;
        nodeIds?: string[];
    } | null;
    'selection/multi': {
        nodeIds: string[];
    };
    'document/switched': {
        srcId: string;
        sectionKey: string | null;
        entryNode: INode | null;
    };
    toolstrip: {
        actionId: string;
    };
    'graph/expand-node': {
        nodeId: string;
    };
    'app/open-folder': void;
    'app/push-graphture': void;
}
export interface Subscription {
    remove(): void;
}
type Listener<T> = T extends void ? () => void : (payload: T) => void;
export interface EventBusInstance {
    publish<K extends keyof Topics>(topic: K, ...args: Topics[K] extends void ? [] : [Topics[K]]): void;
    subscribe<K extends keyof Topics>(topic: K, fn: Listener<Topics[K]>): Subscription;
    clear(): void;
}
export declare function createEventBus(): EventBusInstance;
declare const defaultBus: EventBusInstance;
export declare function publish<K extends keyof Topics>(topic: K, ...args: Topics[K] extends void ? [] : [Topics[K]]): void;
export declare function subscribe<K extends keyof Topics>(topic: K, fn: Listener<Topics[K]>): Subscription;
export declare function clear(): void;
export { defaultBus };
//# sourceMappingURL=EventBus.d.ts.map