/** The release the templates were saved by: what an object merged from them looks saved by. */
export declare const MCOS_TEMPLATE_RELEASE = "R2023b";
export declare const MCOS_TEMPLATE_VERSION = "23.2.0.3186351 (R2023b) Update 11";
export interface McosTemplateAsset {
    variableClass: string;
    dims: readonly number[];
    ids: readonly number[];
    classIndex: number;
    subsystem: string;
}
export declare const MCOS_TEMPLATES: Readonly<Record<string, McosTemplateAsset>>;
/**
 * Per class the templates hold an MCOS object of, the order that release saves its properties in:
 * metaclass PropertyList order without Transient, Dependent and Constant properties.
 */
export declare const MCOS_SAVED_ORDER: Readonly<Record<string, readonly string[]>>;
//# sourceMappingURL=mcosTemplates.d.ts.map