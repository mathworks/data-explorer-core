// Copyright 2026 The MathWorks, Inc.
import { defaultBus } from './EventBus.js';
export function createUndoManager(bus) {
    const stacks = new Map();
    function getStack(srcId) {
        if (!stacks.has(srcId)) {
            stacks.set(srcId, { undo: [], redo: [] });
        }
        return stacks.get(srcId);
    }
    function execute(srcId, command) {
        command.execute();
        const stack = getStack(srcId);
        stack.undo.push(command);
        stack.redo = [];
        bus.publish('undo/changed', { srcId });
    }
    function pushExecuted(srcId, command) {
        const stack = getStack(srcId);
        stack.undo.push(command);
        stack.redo = [];
        bus.publish('undo/changed', { srcId });
    }
    // The step on top of `from`, run, and moved onto `to` once it has run: one that throws stays
    // where it was, to be tried again. The change is published whether or not it threw, since what
    // ran of it before the throw may have changed the tree.
    function step(srcId, from, to, run) {
        if (from.length === 0) {
            return;
        }
        const command = from[from.length - 1];
        try {
            run(command);
            const at = from.lastIndexOf(command);
            if (at >= 0) {
                from.splice(at, 1);
                to.push(command);
            }
        }
        finally {
            bus.publish('undo/changed', { srcId });
        }
    }
    function undo(srcId) {
        const stack = getStack(srcId);
        step(srcId, stack.undo, stack.redo, (command) => command.undo());
    }
    function redo(srcId) {
        const stack = getStack(srcId);
        step(srcId, stack.redo, stack.undo, (command) => command.execute());
    }
    function canUndo(srcId) {
        if (!srcId || !stacks.has(srcId)) {
            return false;
        }
        return stacks.get(srcId).undo.length > 0;
    }
    function canRedo(srcId) {
        if (!srcId || !stacks.has(srcId)) {
            return false;
        }
        return stacks.get(srcId).redo.length > 0;
    }
    function clear(srcId) {
        if (srcId) {
            stacks.delete(srcId);
        }
        else {
            stacks.clear();
        }
        bus.publish('undo/changed', { srcId: srcId || '' });
    }
    bus.subscribe('datamodel/source-removed', (evt) => {
        clear(evt.srcId);
    });
    bus.subscribe('datamodel/cleared', () => {
        clear();
    });
    return { execute, pushExecuted, undo, redo, canUndo, canRedo, clear };
}
const defaultUndoManager = createUndoManager(defaultBus);
export const execute = defaultUndoManager.execute;
export const pushExecuted = defaultUndoManager.pushExecuted;
export const undo = defaultUndoManager.undo;
export const redo = defaultUndoManager.redo;
export const canUndo = defaultUndoManager.canUndo;
export const canRedo = defaultUndoManager.canRedo;
export const clear = defaultUndoManager.clear;
const UndoManager = { execute, pushExecuted, undo, redo, canUndo, canRedo, clear };
export default UndoManager;
//# sourceMappingURL=UndoManager.js.map