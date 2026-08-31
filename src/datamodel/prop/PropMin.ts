// Copyright 2026 The MathWorks, Inc.

export default class PropMin {
    static key = 'Min';
    static displayName = 'Minimum';
    static editor = 'text';
    static column: string | null = 'Min';

    static format(value: unknown): string {
        return value !== undefined && value !== null ? String(value) : '';
    }
}
