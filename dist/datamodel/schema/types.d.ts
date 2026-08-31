export interface RawProp {
    label: string;
    sourcePath: string;
    default?: unknown;
    type: string;
    editor: string;
    options?: string[];
    projected?: boolean;
}
export type ClassRef = string | ({
    $ref: string;
} & Partial<RawProp>);
export interface PILayoutGroup {
    group: string;
    items: string[];
}
export interface ClassDef {
    props: ClassRef[];
    layout?: PILayoutGroup[];
}
export interface SchemaBundle {
    props: Record<string, RawProp>;
    classes: Record<string, ClassDef>;
}
export interface ResolvedProp {
    key: string;
    label: string;
    sourcePath: string;
    default?: unknown;
    type: string;
    editor: string;
    options?: string[];
    projected?: boolean;
}
//# sourceMappingURL=types.d.ts.map