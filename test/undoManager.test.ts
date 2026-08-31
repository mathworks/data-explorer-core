// Copyright 2026 The MathWorks, Inc.
// Unit tests for the UndoManager: per-source stack isolation, undo/redo
// ordering, redo invalidation, and the data-source lifecycle wiring.

import { describe, it, expect } from 'vitest';
import { createEventBus, createUndoManager } from '../src/index.js';

/** A command that appends to a shared log so ordering is observable. */
function loggingCommand(log: string[], label: string) {
  return {
    execute() { log.push(`do:${label}`); },
    undo() { log.push(`undo:${label}`); },
  };
}

describe('UndoManager — execute', () => {
  it('runs the command and makes it undoable', () => {
    const um = createUndoManager(createEventBus());
    const log: string[] = [];
    um.execute('a', loggingCommand(log, 'one'));
    expect(log).toEqual(['do:one']);
    expect(um.canUndo('a')).toBe(true);
    expect(um.canRedo('a')).toBe(false);
  });

  it('pushExecuted records an already-applied command without re-running it', () => {
    const um = createUndoManager(createEventBus());
    const log: string[] = [];
    um.pushExecuted('a', loggingCommand(log, 'one'));
    expect(log).toEqual([]);
    expect(um.canUndo('a')).toBe(true);
  });

  it('publishes undo/changed for the affected source', () => {
    const bus = createEventBus();
    const um = createUndoManager(bus);
    const seen: string[] = [];
    bus.subscribe('undo/changed', (p) => { seen.push(p.srcId); });
    um.execute('a.sldd', loggingCommand([], 'one'));
    expect(seen).toEqual(['a.sldd']);
  });
});

describe('UndoManager — undo/redo ordering', () => {
  it('undoes in last-in-first-out order', () => {
    const um = createUndoManager(createEventBus());
    const log: string[] = [];
    um.execute('a', loggingCommand(log, 'one'));
    um.execute('a', loggingCommand(log, 'two'));
    log.length = 0;
    um.undo('a');
    um.undo('a');
    expect(log).toEqual(['undo:two', 'undo:one']);
  });

  it('redoes in the original execution order', () => {
    const um = createUndoManager(createEventBus());
    const log: string[] = [];
    um.execute('a', loggingCommand(log, 'one'));
    um.execute('a', loggingCommand(log, 'two'));
    um.undo('a');
    um.undo('a');
    log.length = 0;
    um.redo('a');
    um.redo('a');
    expect(log).toEqual(['do:one', 'do:two']);
  });

  it('round-trips through a full undo/redo cycle', () => {
    const um = createUndoManager(createEventBus());
    um.execute('a', loggingCommand([], 'one'));
    um.undo('a');
    expect(um.canUndo('a')).toBe(false);
    expect(um.canRedo('a')).toBe(true);
    um.redo('a');
    expect(um.canUndo('a')).toBe(true);
    expect(um.canRedo('a')).toBe(false);
  });

  it('undo on an empty stack is a no-op', () => {
    const um = createUndoManager(createEventBus());
    expect(() => um.undo('a')).not.toThrow();
    expect(um.canUndo('a')).toBe(false);
  });

  it('redo on an empty stack is a no-op', () => {
    const um = createUndoManager(createEventBus());
    um.execute('a', loggingCommand([], 'one'));
    expect(() => um.redo('a')).not.toThrow();
    expect(um.canRedo('a')).toBe(false);
  });
});

describe('UndoManager — redo invalidation', () => {
  it('a new execute() discards the pending redo branch', () => {
    const um = createUndoManager(createEventBus());
    um.execute('a', loggingCommand([], 'one'));
    um.undo('a');
    expect(um.canRedo('a')).toBe(true);
    um.execute('a', loggingCommand([], 'two'));
    expect(um.canRedo('a')).toBe(false);
  });

  it('a new pushExecuted() also discards the pending redo branch', () => {
    const um = createUndoManager(createEventBus());
    um.execute('a', loggingCommand([], 'one'));
    um.undo('a');
    um.pushExecuted('a', loggingCommand([], 'two'));
    expect(um.canRedo('a')).toBe(false);
  });
});

describe('UndoManager — per-source isolation', () => {
  it('keeps a separate stack per source id', () => {
    const um = createUndoManager(createEventBus());
    um.execute('a', loggingCommand([], 'a1'));
    expect(um.canUndo('a')).toBe(true);
    expect(um.canUndo('b')).toBe(false);
  });

  it('undoing one source does not touch another', () => {
    const um = createUndoManager(createEventBus());
    const log: string[] = [];
    um.execute('a', loggingCommand(log, 'a1'));
    um.execute('b', loggingCommand(log, 'b1'));
    log.length = 0;
    um.undo('a');
    expect(log).toEqual(['undo:a1']);
    expect(um.canUndo('b')).toBe(true);
  });

  it('canUndo/canRedo are false for an unknown or empty source id', () => {
    const um = createUndoManager(createEventBus());
    expect(um.canUndo('never-seen')).toBe(false);
    expect(um.canRedo('never-seen')).toBe(false);
    expect(um.canUndo('')).toBe(false);
    expect(um.canRedo('')).toBe(false);
  });
});

describe('UndoManager — clear', () => {
  it('clear(srcId) drops only that source history', () => {
    const um = createUndoManager(createEventBus());
    um.execute('a', loggingCommand([], 'a1'));
    um.execute('b', loggingCommand([], 'b1'));
    um.clear('a');
    expect(um.canUndo('a')).toBe(false);
    expect(um.canUndo('b')).toBe(true);
  });

  it('clear() with no argument drops every source history', () => {
    const um = createUndoManager(createEventBus());
    um.execute('a', loggingCommand([], 'a1'));
    um.execute('b', loggingCommand([], 'b1'));
    um.clear();
    expect(um.canUndo('a')).toBe(false);
    expect(um.canUndo('b')).toBe(false);
  });

  it('clear() discards redo history too', () => {
    const um = createUndoManager(createEventBus());
    um.execute('a', loggingCommand([], 'a1'));
    um.undo('a');
    um.clear('a');
    expect(um.canRedo('a')).toBe(false);
  });
});

describe('UndoManager — data-source lifecycle wiring', () => {
  it('discards a source history when that source is removed', () => {
    const bus = createEventBus();
    const um = createUndoManager(bus);
    um.execute('a', loggingCommand([], 'a1'));
    um.execute('b', loggingCommand([], 'b1'));
    bus.publish('datamodel/source-removed', { srcId: 'a' });
    expect(um.canUndo('a')).toBe(false);
    expect(um.canUndo('b')).toBe(true);
  });

  it('discards every history when the model is cleared', () => {
    const bus = createEventBus();
    const um = createUndoManager(bus);
    um.execute('a', loggingCommand([], 'a1'));
    um.execute('b', loggingCommand([], 'b1'));
    bus.publish('datamodel/cleared');
    expect(um.canUndo('a')).toBe(false);
    expect(um.canUndo('b')).toBe(false);
  });

  it('binds to its own bus, not a shared global one', () => {
    const busA = createEventBus();
    const busB = createEventBus();
    const um = createUndoManager(busA);
    um.execute('a', loggingCommand([], 'a1'));
    busB.publish('datamodel/cleared');
    expect(um.canUndo('a')).toBe(true);
  });
});
