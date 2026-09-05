import type { MatVariable } from './MatParser.js';
import type { ParseWarning } from './ParseWarning.js';
export interface BlockParamUsage {
    blockName: string;
    blockType: string;
    paramProperty: string;
    paramValue: string;
}
/**
 * One configuration set, or a REFERENCE to one, normalized across all five layouts.
 *
 * `objectClass` and `sourceName` are here rather than left for the node layer to dig
 * out of `data` because *where* they are recorded is era-specific, and hiding that is
 * this parser's job. Measured against R2027a, then exported to each era
 * (`test/parity/matlab/probe_configsetref.m` — item 15):
 *
 *   - R2026b+ JSON  `configSetN.json`  `"_object_class":"Simulink.ConfigSetRef"`
 *                                      `"SourceName":"dictCfg"`
 *   - R2015a–R2026a `configSetN.xml`   `<Object ClassName="Simulink.ConfigSetRef">`
 *                                      `<P Name="SourceName">` (R2021a and later)
 *                                      `<P Name="WSVarName">`  (R2018a and earlier)
 *   - R2014b and earlier               inline in `blockdiagram.xml`, same
 *                                      `ClassName=` attribute, `WSVarName`
 *
 * So the class is an ATTRIBUTE in every XML era and a FIELD in JSON, always spelled
 * with the full `Simulink.ConfigSetRef` — but the property naming what it points at
 * was renamed between R2018a and R2021a, which is the one fact here that could not
 * have been guessed. `sourceName` is `''` for an ordinary set, which has no source.
 *
 * NOT read: `SourceLocation`. It survives the export as the literal `Base Workspace`
 * in every XML era even when the set really came from a data dictionary (the JSON
 * layout says `Data Dictionary` for the same model), so on a file this reader might
 * be handed it is not a fact about the model.
 */
export interface ParsedConfigSet {
    name: string;
    active: boolean;
    data: unknown;
    objectClass: string;
    sourceName: string;
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
    configSets: ParsedConfigSet[];
    workspace: MatVariable[] & {
        _trailingElements: Uint8Array[];
    };
    blockParamUsages: BlockParamUsage[];
    rawContents: Record<string, string> | null;
    zipEntries: Record<string, Uint8Array> | null;
    warnings: ParseWarning[];
}
export declare function configSetIdentity(data: unknown): {
    objectClass: string;
    sourceName: string;
};
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