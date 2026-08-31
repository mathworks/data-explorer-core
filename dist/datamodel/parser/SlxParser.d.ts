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
    rawContents: Record<string, string>;
    zipEntries: Record<string, Uint8Array>;
}
export declare function parseSlx(buffer: ArrayBuffer, filename: string): ParsedSlx;
//# sourceMappingURL=SlxParser.d.ts.map