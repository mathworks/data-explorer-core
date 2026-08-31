export declare const NS_DESIGN = "dacaf35e-55a5-454d-a7c1-93db038a210e";
export declare const NS_CONFIGURATIONS = "a3b2532e-8e6e-47f5-94fb-b15daf666a84";
export declare const NS_OTHER = "42516768-0ace-4981-8ac7-0a9b32cba471";
export declare const SECTION_NAMESPACE: Record<string, string>;
export declare function getSectionKey(meta: Record<string, unknown>): string;
export declare function getSectionMetadata(sectionKey: string): {
    namespace: string;
    isderived: string;
};
//# sourceMappingURL=SectionConstants.d.ts.map