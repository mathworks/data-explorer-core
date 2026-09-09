export declare const SC_PART = "simulink/systemcomposer/interfaceDictionary";
export declare const SC_PART_XML = "simulink/systemcomposer/interfaceDictionary.xml";
export interface SystemComposerCatalog {
    interfaces: Record<string, string>;
    modeledDataTypes: Record<string, string>;
}
export declare const SC_TYPE_TO_CLASSIFICATION: Record<string, string>;
export declare function classificationOf(catalog: SystemComposerCatalog | null | undefined, entryName: string): string | null;
export declare function scPartUnreadableMessage(part: string): string;
/** Where a name is written in the source text, as a half-open span. */
export interface ScNameSite {
    start: number;
    end: number;
}
/**
 * One catalog definition: what it is called, what models it, and every place the
 * source spells its name.
 *
 * `nameSites` is plural because a value type definition writes its name TWICE — on
 * the definition and on the value-type descriptor nested inside it, which MATLAB
 * keeps equal (11,964 of 11,964 in the customer dictionary this was measured on).
 * A rename that moved only one of them would leave the descriptor naming a type
 * that no longer exists.
 */
export interface ScDefinition {
    name: string;
    /** The systemcomposer type, e.g. `…interface.CompositeDataInterface`. */
    type: string;
    /** Whether the definition is an interface or a modeled data type. */
    container: 'interfaces' | 'modeledDataTypes';
    nameSites: ScNameSite[];
}
/** Fold definitions into the catalog the model classifies entries with. */
export declare function catalogFromDefinitions(defs: ScDefinition[]): SystemComposerCatalog;
/**
 * Scan the MF0 XML of a compressed-binary dictionary's interface dictionary.
 *
 * A tag walk rather than a DOM parse for two reasons: the part is 20 MB in a real
 * customer dictionary, and a rename has to know the BYTE RANGE of each name so the
 * member can be patched in place instead of re-serialized (which would rewrite 20 MB
 * of a file the user did not touch).
 *
 * Names are compared and returned raw. Dictionary entry names are MATLAB
 * identifiers, so there is nothing for XML escaping to do to them.
 */
export declare function scanScXml(xml: string): ScDefinition[];
/**
 * Scan the JSON text of an uncompressed-text dictionary's interface dictionary.
 *
 * The text and not the parsed object, because that is what the host holds: a textual
 * `.sldd` is an open TEXT DOCUMENT, edited by splicing spans, and a rename has to
 * become a span replacement in it. Re-serializing the part instead would rewrite 20 MB
 * of a customer's file — and reformat every line of it — to change one name.
 *
 * The walk is deliberately shallow: it finds the two container keys, then reads only
 * what a definition is (its type, its name, and the value-type descriptor nested
 * directly in it), skipping every other value wholesale. Whitespace is irrelevant to
 * it, so it reads MATLAB's tab-indented layout and a re-saved minified one alike.
 */
export declare function scanScJsonText(text: string): ScDefinition[];
/** One replacement in a source text, as a half-open span and the text to put there. */
export interface ScTextEdit {
    start: number;
    end: number;
    text: string;
}
/**
 * The edits that carry a rename into the catalog: every place the definition named
 * `oldName` spells that name, and nothing else.
 *
 * Nothing else is the point. In a real dictionary a catalog name occurs three times
 * in this part — on the definition, on the definition's own value-type descriptor,
 * and on a bus element in ANOTHER interface that happens to be named after the type
 * it references. The first two are the definition's name and move with it; the third
 * is an element's name in someone else's interface and must not move. A global
 * string replace gets that wrong every time.
 *
 * Returns edits in ascending position, or an empty array when no definition carries
 * the name (the overwhelming majority of renames: an entry no catalog classifies).
 */
export declare function scRenameEdits(defs: ScDefinition[], oldName: string, newName: string): ScTextEdit[];
/** Apply non-overlapping edits to a text, back to front so earlier spans stay valid. */
export declare function applyScEdits(text: string, edits: ScTextEdit[]): string;
/**
 * Move a definition's key in a catalog the model is holding, to follow a rename.
 *
 * The other half of `scRenameEdits`, and the one that is about the TREE rather than the
 * file: the catalog is keyed by name, and every narrow repaint rebuilds an entry through
 * `parseEntry(record, catalog)`, so a catalog left keyed by the old name re-derives a
 * Kind the renamed entry no longer has. The host writes the part; this keeps the tree it
 * is holding saying the same thing.
 *
 * Returns whether anything moved, so a caller can tell "the catalog classified this
 * entry" from "there was nothing to follow" — which is also the gate on carrying the
 * rename into the file at all.
 */
export declare function renameInCatalog(catalog: SystemComposerCatalog | null | undefined, oldName: string, newName: string): boolean;
//# sourceMappingURL=ScCatalog.d.ts.map