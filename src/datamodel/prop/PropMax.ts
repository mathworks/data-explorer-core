// Copyright 2026 The MathWorks, Inc.

export default class PropMax {
    static key = 'Max';
    static displayName = 'Maximum';
    static editor = 'text';
    static column: string | null = 'Max';

    static format(value: unknown): string {
        return value !== undefined && value !== null ? String(value) : '';
    }
}
