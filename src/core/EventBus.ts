// Copyright 2026 The MathWorks, Inc.

import type { INode, IContainerNode, ISourceNode } from './NodeInterfaces.js';

export interface Topics {
  'active/changed': void;
  'preview/changed': void;
  'datamodel/source-added': { srcId: string; slddNode: ISourceNode };
  'datamodel/source-removed': { srcId: string };
  'datamodel/cleared': void;
  'node/edited': { source: string; nodeId: string; kind: string };
  'node/added': { node: INode; sectionKey: string };
  'node/deleted': { node: INode; section: IContainerNode };
  'node/children-changed': { parent: INode };
  'undo/changed': { srcId: string };
  'clipboard/changed': { mode: string; nodeId: string; nodeIds?: string[] } | null;
  'selection/multi': { nodeIds: string[] };
  'document/switched': { srcId: string; sectionKey: string | null; entryNode: INode | null };
  toolstrip: { actionId: string };
  'graph/expand-node': { nodeId: string };
  'app/open-folder': void;
  'app/push-graphture': void;
}

export interface Subscription {
  remove(): void;
}

type Listener<T> = T extends void ? () => void : (payload: T) => void;

// Listeners are held in per-subscription wrappers so that subscribing the same
// function twice yields two independently-removable subscriptions (filtering by
// function identity would drop both).
interface Entry<T> {
  fn: Listener<T>;
}

export interface EventBusInstance {
  publish<K extends keyof Topics>(topic: K, ...args: Topics[K] extends void ? [] : [Topics[K]]): void;
  subscribe<K extends keyof Topics>(topic: K, fn: Listener<Topics[K]>): Subscription;
  clear(): void;
}

export function createEventBus(): EventBusInstance {
  const listeners: { [K in keyof Topics]?: Array<Entry<Topics[K]>> } = {};

  function publish<K extends keyof Topics>(topic: K, ...args: Topics[K] extends void ? [] : [Topics[K]]): void {
    const entries = listeners[topic] as Array<Entry<Topics[K]>> | undefined;
    if (!entries) {
      return;
    }
    // Iterate a snapshot so a listener that subscribes or unsubscribes during
    // dispatch cannot perturb this round. One listener throwing must not silence
    // the remaining ones — the model fans a single mutation out to many
    // independent consumers — so report the failure without aborting the fan-out.
    for (const entry of entries.slice()) {
      try {
        (entry.fn as Function)(...args);
      } catch (err) {
        console.error(`EventBus: listener for "${String(topic)}" threw`, err);
      }
    }
  }

  function subscribe<K extends keyof Topics>(topic: K, fn: Listener<Topics[K]>): Subscription {
    if (!listeners[topic]) {
      (listeners as any)[topic] = [];
    }
    const entries = listeners[topic] as Array<Entry<Topics[K]>>;
    const entry: Entry<Topics[K]> = { fn };
    entries.push(entry);
    return {
      remove() {
        // Remove this subscription only, by wrapper identity.
        const current = listeners[topic] as Array<Entry<Topics[K]>> | undefined;
        if (!current) {
          return;
        }
        const at = current.indexOf(entry);
        if (at !== -1) {
          current.splice(at, 1);
        }
      },
    };
  }

  function clear(): void {
    (Object.keys(listeners) as Array<keyof Topics>).forEach((k) => delete listeners[k]);
  }

  return { publish, subscribe, clear };
}

const defaultBus = createEventBus();

export function publish<K extends keyof Topics>(topic: K, ...args: Topics[K] extends void ? [] : [Topics[K]]): void {
  return defaultBus.publish(topic, ...args);
}

export function subscribe<K extends keyof Topics>(topic: K, fn: Listener<Topics[K]>): Subscription {
  return defaultBus.subscribe(topic, fn);
}

export function clear(): void {
  return defaultBus.clear();
}

export { defaultBus };
