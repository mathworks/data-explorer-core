export default class PropMin {
    static key: string;
    static displayName: string;
    static editor: string;
    static column: string | null;
    static defaultValue: number | undefined;
    static format(value: unknown): string;
    static parse(raw: unknown): number | undefined | string;
    static validate(value: unknown): string | null;
}
//# sourceMappingURL=PropMin.d.ts.map