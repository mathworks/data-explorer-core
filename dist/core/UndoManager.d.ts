import { type EventBusInstance } from './EventBus.js';
export interface Command {
    execute(): void;
    undo(): void;
}
export interface UndoManagerInstance {
    execute(srcId: string, command: Command): void;
    pushExecuted(srcId: string, command: Command): void;
    undo(srcId: string): void;
    redo(srcId: string): void;
    canUndo(srcId: string): boolean;
    canRedo(srcId: string): boolean;
    clear(srcId?: string): void;
}
export declare function createUndoManager(bus: EventBusInstance): UndoManagerInstance;
export declare const execute: (srcId: string, command: Command) => void;
export declare const pushExecuted: (srcId: string, command: Command) => void;
export declare const undo: (srcId: string) => void;
export declare const redo: (srcId: string) => void;
export declare const canUndo: (srcId: string) => boolean;
export declare const canRedo: (srcId: string) => boolean;
export declare const clear: (srcId?: string) => void;
declare const UndoManager: {
    execute: (srcId: string, command: Command) => void;
    pushExecuted: (srcId: string, command: Command) => void;
    undo: (srcId: string) => void;
    redo: (srcId: string) => void;
    canUndo: (srcId: string) => boolean;
    canRedo: (srcId: string) => boolean;
    clear: (srcId?: string) => void;
};
export default UndoManager;
//# sourceMappingURL=UndoManager.d.ts.map