import type { MatVariable } from './MatParser.js';
export interface BlockParamUsage {
    blockName: string;
    blockType: string;
    paramProperty: string;
    paramValue: string;
}
export interface ParsedSlx {
    name: string;
    release: string;
    creator: string;
    lastModified: string;
    uuid: string;
    dataDictionary: string | null;
    modelReferences: {
        blockPath: string;
        modelName: string;
    }[];
    externalDataSources: string[];
    configSets: {
        name: string;
        active: boolean;
        data: unknown;
    }[];
    workspace: MatVariable[] & {
        _trailingElements: Uint8Array[];
    };
    blockParamUsages: BlockParamUsage[];
    rawContents: Record<string, string> | null;
    zipEntries: Record<string, Uint8Array> | null;
}
export declare function normalizeBlockName(name: string): string;
/**
 * Does `propName = value` on a block count as a reference to named data?
 *
 * The one gate both model formats go through, so a `.mdl` and the `.slx` of the
 * SAME diagram surface the same rows. Exported for MdlParser, which reads the
 * classic nested-brace flavour and has no `<P>` elements to work from.
 */
export declare function isParamReference(propName: string, value: string): boolean;
export declare function parseSlx(buffer: ArrayBuffer, filename: string): ParsedSlx;
/**
 * The model behind an OPC part map — everything `parseSlx` does except unzipping.
 *
 * A `.slx` is a ZIP OPC package; the modern `.mdl` is the SAME part set written as
 * a TEXT OPC package (`__MWOPC_PART_BEGIN__` delimiters, binary parts base64'd).
 * The two formats differ only in how the bytes of each part are framed, so the
 * reading of those parts belongs in one place — see MdlParser, which decodes the
 * text framing and calls straight in here.
 */
export declare function parseModelParts(entries: Record<string, Uint8Array>, filename: string): ParsedSlx;
//# sourceMappingURL=SlxParser.d.ts.map