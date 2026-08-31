// Copyright 2026 The MathWorks, Inc.
// Unit tests for the EventBus: subscribe/publish/remove semantics, payload
// delivery, and dispatch isolation between subscribers.

import { describe, it, expect } from 'vitest';
import { createEventBus, EventBus, publish, subscribe } from '../src/index.js';

describe('EventBus — publish/subscribe', () => {
  it('delivers a payload to a subscriber', () => {
    const bus = createEventBus();
    const seen: string[] = [];
    bus.subscribe('undo/changed', (p) => { seen.push(p.srcId); });
    bus.publish('undo/changed', { srcId: 'a.sldd' });
    expect(seen).toEqual(['a.sldd']);
  });

  it('delivers a void-payload topic with no arguments', () => {
    const bus = createEventBus();
    let hits = 0;
    bus.subscribe('active/changed', () => { hits++; });
    bus.publish('active/changed');
    expect(hits).toBe(1);
  });

  it('publishing a topic with no subscribers is a no-op', () => {
    const bus = createEventBus();
    expect(() => bus.publish('datamodel/cleared')).not.toThrow();
  });

  it('fans out to every subscriber in subscription order', () => {
    const bus = createEventBus();
    const order: string[] = [];
    bus.subscribe('undo/changed', () => { order.push('first'); });
    bus.subscribe('undo/changed', () => { order.push('second'); });
    bus.subscribe('undo/changed', () => { order.push('third'); });
    bus.publish('undo/changed', { srcId: 'x' });
    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('does not cross-deliver between topics', () => {
    const bus = createEventBus();
    let undoHits = 0;
    let previewHits = 0;
    bus.subscribe('undo/changed', () => { undoHits++; });
    bus.subscribe('preview/changed', () => { previewHits++; });
    bus.publish('preview/changed');
    expect(undoHits).toBe(0);
    expect(previewHits).toBe(1);
  });

  it('keeps separate buses independent', () => {
    const a = createEventBus();
    const b = createEventBus();
    let aHits = 0;
    let bHits = 0;
    a.subscribe('active/changed', () => { aHits++; });
    b.subscribe('active/changed', () => { bHits++; });
    a.publish('active/changed');
    expect(aHits).toBe(1);
    expect(bHits).toBe(0);
  });
});

describe('EventBus — unsubscribe', () => {
  it('remove() stops further delivery', () => {
    const bus = createEventBus();
    let hits = 0;
    const sub = bus.subscribe('active/changed', () => { hits++; });
    bus.publish('active/changed');
    sub.remove();
    bus.publish('active/changed');
    expect(hits).toBe(1);
  });

  it('remove() is idempotent', () => {
    const bus = createEventBus();
    let hits = 0;
    const sub = bus.subscribe('active/changed', () => { hits++; });
    sub.remove();
    expect(() => sub.remove()).not.toThrow();
    bus.publish('active/changed');
    expect(hits).toBe(0);
  });

  it('removing one subscriber leaves its siblings subscribed', () => {
    const bus = createEventBus();
    const seen: string[] = [];
    const first = bus.subscribe('undo/changed', () => { seen.push('first'); });
    bus.subscribe('undo/changed', () => { seen.push('second'); });
    first.remove();
    bus.publish('undo/changed', { srcId: 'x' });
    expect(seen).toEqual(['second']);
  });

  it('unsubscribing during dispatch still notifies the already-scheduled siblings', () => {
    // remove() swaps in a filtered copy, so the in-flight forEach walks the
    // original array — a self-removing listener must not drop its siblings.
    const bus = createEventBus();
    const seen: string[] = [];
    const sub = bus.subscribe('undo/changed', () => { seen.push('first'); sub.remove(); });
    bus.subscribe('undo/changed', () => { seen.push('second'); });
    bus.publish('undo/changed', { srcId: 'x' });
    expect(seen).toEqual(['first', 'second']);
    // The self-removal still takes effect for the next publish.
    seen.length = 0;
    bus.publish('undo/changed', { srcId: 'x' });
    expect(seen).toEqual(['second']);
  });

  it('subscribing the same function twice delivers twice, and each subscription removes independently', () => {
    const bus = createEventBus();
    let hits = 0;
    const fn = () => { hits++; };
    const first = bus.subscribe('active/changed', fn);
    bus.subscribe('active/changed', fn);
    bus.publish('active/changed');
    expect(hits).toBe(2);

    // Releasing one handle must leave the other subscription intact.
    hits = 0;
    first.remove();
    bus.publish('active/changed');
    expect(hits).toBe(1);
  });

  it('clear() drops every subscription across all topics', () => {
    const bus = createEventBus();
    let hits = 0;
    bus.subscribe('active/changed', () => { hits++; });
    bus.subscribe('preview/changed', () => { hits++; });
    bus.clear();
    bus.publish('active/changed');
    bus.publish('preview/changed');
    expect(hits).toBe(0);
  });

  it('subscriptions still work after clear()', () => {
    const bus = createEventBus();
    let hits = 0;
    bus.clear();
    bus.subscribe('active/changed', () => { hits++; });
    bus.publish('active/changed');
    expect(hits).toBe(1);
  });
});

describe('EventBus — the module-level default bus', () => {
  // The bare publish/subscribe/clear exports forward to one process-wide bus, and
  // that bus is what the singleton DataModel and UndoManager are wired to. So a
  // consumer that imports `subscribe` from the barrel must land on the SAME bus
  // the singleton publishes to — if these ever forwarded to a fresh instance,
  // every such listener would go silent with nothing to show for it.
  //
  // Each test cleans up its own subscription: the bus outlives the test file, so a
  // leaked listener would fire during unrelated tests.
  it('delivers through the bare publish/subscribe exports', () => {
    const seen: string[] = [];
    const sub = subscribe('undo/changed', (p) => { seen.push(p.srcId); });
    try {
      publish('undo/changed', { srcId: 'default-bus' });
      expect(seen).toEqual(['default-bus']);
    } finally {
      sub.remove();
    }
  });

  it('routes the bare exports and the EventBus.defaultBus methods to one bus', () => {
    // Two spellings of the same bus — `subscribe(...)` and `EventBus.defaultBus`.
    // A listener registered through either must see a publish through the other.
    let viaBare = 0;
    let viaNamespace = 0;
    const a = subscribe('active/changed', () => { viaBare++; });
    const b = EventBus.defaultBus.subscribe('active/changed', () => { viaNamespace++; });
    try {
      EventBus.publish('active/changed');
      expect([viaBare, viaNamespace]).toEqual([1, 1]);
      publish('active/changed');
      expect([viaBare, viaNamespace]).toEqual([2, 2]);
    } finally {
      a.remove();
      b.remove();
    }
  });

  it('is a different bus from any created by createEventBus', () => {
    // The singleton is a convenience, not a global: a session-scoped bus must stay
    // isolated from it, or two open documents would cross-talk.
    let onDefault = 0;
    let onOwn = 0;
    const own = createEventBus();
    const sub = subscribe('preview/changed', () => { onDefault++; });
    try {
      own.subscribe('preview/changed', () => { onOwn++; });
      own.publish('preview/changed');
      expect([onDefault, onOwn]).toEqual([0, 1]);
      publish('preview/changed');
      expect([onDefault, onOwn]).toEqual([1, 1]);
    } finally {
      sub.remove();
    }
  });

  it('clear() drops the default bus subscriptions without breaking later ones', () => {
    // Exercised last, and deliberately: clear() on the shared bus would unsubscribe
    // the singleton DataModel's own listeners too, so it is called here only with
    // subscriptions this test owns.
    let hits = 0;
    subscribe('graph/expand-node', () => { hits++; });
    EventBus.clear();
    publish('graph/expand-node', { nodeId: 'n1' });
    expect(hits).toBe(0);

    const after = subscribe('graph/expand-node', () => { hits++; });
    try {
      publish('graph/expand-node', { nodeId: 'n1' });
      expect(hits).toBe(1);
    } finally {
      after.remove();
    }
  });
});

describe('EventBus — dispatch isolation', () => {
  it('a throwing subscriber does not prevent the others from being notified', () => {
    // One bad listener must not silence the rest of the application: the data
    // model publishes to many independent consumers per mutation.
    const bus = createEventBus();
    const seen: string[] = [];
    bus.subscribe('undo/changed', () => { throw new Error('listener blew up'); });
    bus.subscribe('undo/changed', () => { seen.push('second'); });
    bus.publish('undo/changed', { srcId: 'x' });
    expect(seen).toEqual(['second']);
  });

  it('a throwing subscriber does not propagate the error to the publisher', () => {
    const bus = createEventBus();
    bus.subscribe('active/changed', () => { throw new Error('listener blew up'); });
    expect(() => bus.publish('active/changed')).not.toThrow();
  });
});
