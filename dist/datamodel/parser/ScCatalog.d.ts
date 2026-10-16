export declare const SC_PART = "simulink/systemcomposer/interfaceDictionary";
export declare const SC_PART_XML = "simulink/systemcomposer/interfaceDictionary.xml";
export interface SystemComposerCatalog {
    interfaces: Record<string, string>;
    modeledDataTypes: Record<string, string>;
}
export declare const SC_TYPE_TO_CLASSIFICATION: Record<string, string>;
export declare function classificationOf(catalog: SystemComposerCatalog | null | undefined, entryName: string): string | null;
/**
 * An empty name-keyed bag for the catalog: no prototype, so a name is only ever an own
 * key. `__proto__` in particular is stored like any other name rather than handed to
 * `Object.prototype`'s setter, which drops a string without a word.
 */
export declare function emptyCatalogBag(): Record<string, string>;
/**
 * The names of the definitions a catalog lists with no type, interfaces first, each once.
 *
 * Unlike an empty catalog, this IS damage: the file lists the definition, and the record
 * that says what models it lost its type. Such a definition classifies nothing, so its
 * entry's Kind is its Simulink class's, and for a `Simulink.Bus` that is a wrong answer
 * that looks exactly like a right one (a struct type reads as a Data Interface). Both
 * readers record it as the empty string rather than dropping it (the text reader: no
 * `type`, or one that is not a string; the binary reader: no `type` attribute), and this
 * is what lets the dictionary reader warn about each from ONE place, so that the two
 * formats say the same thing about the same damage.
 *
 * Only the empty type. A type that is there but outside `SC_TYPE_TO_CLASSIFICATION` may
 * be a newer release's, which is not damage this reader can see. Own keys only, as for
 * `classificationOf`: a host's bag may have a prototype.
 */
export declare function untypedDefinitions(catalog: SystemComposerCatalog | null | undefined): string[];
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
/**
 * Fold definitions into the catalog the model classifies entries with.
 *
 * The bag is chosen by comparing `container`, never by indexing with it: this function
 * is public, a JS caller is not held to the union, and `catalog['__proto__'][name] = type`
 * writes onto `Object.prototype` itself. A container outside the union names no bag and
 * is skipped.
 */
export declare function catalogFromDefinitions(defs: ScDefinition[]): SystemComposerCatalog;
export interface XmlTag {
    index: number;
    end: number;
    closing: boolean;
    name: string;
    attrs: string;
    selfClosing: boolean;
}
export declare class XmlTagScanner {
    private readonly xml;
    private pos;
    private gtFrom;
    private gtAt;
    private qtFrom;
    private qtAt;
    private deadFrom;
    private parityAt;
    private parityOdd;
    private parityNext;
    constructor(xml: string);
    next(): XmlTag | null;
    private terminator;
    private walk;
    private oddSinceDead;
    private nextGt;
    private nextQuote;
}
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
 * The text and not the parsed object, because a rename has to become a span
 * replacement in it: the save writes the part back as read and changes only the
 * renamed names in it (`scJsonTextWithRenames`), and a host that edits a textual
 * `.sldd` as an open TEXT DOCUMENT splices the same spans (`scRenameEdits`).
 * Re-serializing the part instead would reformat every line of 20 MB of a customer's
 * catalog to change one name.
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
 * Kind the renamed entry no longer has. The save writes the part, from the renames this
 * records (`catalogRenames`); this keeps the tree saying the same thing in the meantime.
 *
 * Returns whether anything moved, so a caller can tell "the catalog classified this
 * entry" from "there was nothing to follow" — which is also the gate on carrying the
 * rename into the file at all.
 */
export declare function renameInCatalog(catalog: SystemComposerCatalog | null | undefined, oldName: string, newName: string): boolean;
/**
 * Every definition of this catalog renamed since it was read, as name in the file ->
 * name now. Empty for a catalog nothing has been renamed in, and for none at all.
 */
export declare function catalogRenames(catalog: SystemComposerCatalog | null | undefined): Map<string, string>;
/**
 * A compressed-binary dictionary's interface dictionary member, with every renamed
 * definition's name written where the definition spells it (`scRenameEdits`'s sites:
 * the definition and its own value-type descriptor, never a reference elsewhere that
 * happens to share the name), and every other byte as it was.
 *
 * A renamed function of a service interface (`functionRenames`, from
 * `catalogFunctionRenames`) is renamed at its own `p_Name` and in its `p_FunctionPrototype`.
 *
 * All renames are applied in one pass over the member as read, so a swap of two names
 * (A -> B and B -> A) lands as a swap rather than as two definitions named A.
 */
export declare function scXmlWithRenames(xml: string, renames: ReadonlyMap<string, string>, functionRenames?: CatalogFunctionRenames): string;
/**
 * An uncompressed-text dictionary's whole JSON text, with every renamed definition's name
 * written where the definition spells it in the interface dictionary part, and every other
 * character as it was: the text twin of `scXmlWithRenames`, and the same sites, a renamed
 * function's among them.
 *
 * The save writes a text dictionary's parts back as read, so this is what carries a rename
 * into its catalog. All renames are applied in one pass over the text as written, so a swap
 * of two names lands as a swap.
 */
export declare function scJsonTextWithRenames(text: string, renames: ReadonlyMap<string, string>, functionRenames?: CatalogFunctionRenames): string;
/** One function of a service interface definition, as the source text spells it. */
export interface ScFunction {
    /** The interface's name in the source text. */
    interfaceName: string;
    /** The function's name in the source text: the text at `nameSite`. */
    name: string;
    /** Where the function's own `p_Name` value is written. */
    nameSite: ScNameSite;
    /**
     * Where the function's own `p_FunctionPrototype` value is written. Null when the function
     * has no Prototype text to rename.
     */
    prototypeSite: ScNameSite | null;
}
/**
 * Function renames to carry into a catalog: interface name -> (function name -> new function
 * name), both keyed by the names the catalog text being edited spells. The session's own record
 * keeps them keyed by the names in the FILE as read, so a function rename and a rename of its
 * interface, in either order, both land at save; a host that carries one rename into its open
 * text keys by the names that text spells now.
 */
export type CatalogFunctionRenames = ReadonlyMap<string, ReadonlyMap<string, string>>;
/**
 * Record that the function `oldName` of the service interface entry now called
 * `interfaceName` is renamed `newName`, so the save renames the catalog's copy of it
 * (`catalogFunctionRenames`). Nothing is recorded for an interface the catalog does not
 * list. Returns whether anything was recorded.
 */
export declare function renameFunctionInCatalog(catalog: SystemComposerCatalog | null | undefined, interfaceName: string, oldName: string, newName: string): boolean;
/**
 * Every function of this catalog renamed since it was read, per interface: interface name
 * in the file -> (function name in the file -> name now). Empty for a catalog none has been
 * renamed in, and for none at all.
 */
export declare function catalogFunctionRenames(catalog: SystemComposerCatalog | null | undefined): Map<string, Map<string, string>>;
/**
 * `prototype` with its function name `from` replaced by `to` (that token only, so an output or
 * input spelled like the function keeps its spelling), or null when the Prototype does not have
 * that form or declares a function other than `from`. The rule MATLAB's FunctionElement Name
 * setter follows (Simulink.FunctionElement.md), shared by the node and the catalog's copy.
 */
export declare function renamedPrototype(prototype: unknown, from: string, to: string): string | null;
/**
 * The edits that carry the function renames into a catalog part: each renamed function's
 * `p_Name`, and its `p_FunctionPrototype` where that declares the function by the name in the
 * file. A Prototype in another form keeps its text; the name still moves.
 *
 * `text` is the text `fns` was scanned from (`scanScJsonFunctions` for a textual dictionary's
 * whole JSON, `scanScXmlFunctions` for a binary one's catalog member), and `renames` is keyed
 * by the names that text spells: interface name -> (function name -> new name). The edits are
 * spans of that text, for `applyScEdits`, in scan order rather than ascending position
 * (`applyScEdits` sorts them). What both save writers apply; public, like `scRenameEdits`, for
 * a host that edits its open document in place.
 */
export declare function scFunctionRenameEdits(text: string, fns: ScFunction[], renames: CatalogFunctionRenames): ScTextEdit[];
/**
 * The functions of every service interface definition in a compressed-binary dictionary's
 * catalog member: the same tag walk as `scanScXml`, reading a definition's direct-child
 * `p_FunctionElements` and, in each, its own direct-child `p_Name` and `p_FunctionPrototype`.
 * Empty for a member with no service interface.
 */
export declare function scanScXmlFunctions(xml: string): ScFunction[];
/**
 * The functions of every service interface definition in an uncompressed-text dictionary's
 * whole JSON text, the text twin of `scanScXmlFunctions`: each interface definition's
 * `content.p_FunctionElements`, and in each function its `content.p_Name` and
 * `content.p_FunctionPrototype`. Empty for a dictionary with no service interface in its
 * interface dictionary part, or with no such part.
 */
export declare function scanScJsonFunctions(text: string): ScFunction[];
//# sourceMappingURL=ScCatalog.d.ts.map