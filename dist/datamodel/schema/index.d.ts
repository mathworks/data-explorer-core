import type { PILayoutGroup, ResolvedProp } from './types.js';
export declare function getSchema(className: string): ResolvedProp[] | undefined;
export declare function getLayout(className: string): PILayoutGroup[] | undefined;
export declare function getSchemaClasses(): string[];
export declare function resolveSourcePath(properties: Record<string, unknown> | undefined, path: string): unknown;
export declare function writeSourcePath(properties: Record<string, unknown> | undefined, path: string, value: unknown): boolean;
export declare function isTypedScalar(value: unknown): value is {
    _type: unknown;
    _value: unknown;
};
export declare function sourceLeaf(properties: Record<string, unknown> | undefined, path: string): {
    bag: Record<string, unknown>;
    key: string;
} | null;
export declare function hydrate(properties: Record<string, unknown> | undefined, prop: ResolvedProp): unknown;
//# sourceMappingURL=index.d.ts.map