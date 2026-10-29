import { type ScTextEdit } from '../datamodel/parser/ScCatalog.js';
/** The rename to carry: the name the FILE still spells, and the name it will spell. */
export interface CatalogRename {
    oldName: string;
    newName: string;
}
/**
 * Whether the System Composer catalog names the entries of this section: those of the Design
 * namespace — Design Data and Architectural Data — and no other. A section core does not know is
 * in no namespace the catalog names.
 */
export declare function catalogNamesSection(sectionName: string): boolean;
/**
 * The rename this cell edit carries into the catalog, or null if it carries none.
 *
 * MUST be called before the mutation: `node.name` is the name the file still spells, and
 * once `setProperty` has run there is nothing left to look the definition up by.
 */
export declare function catalogRenameOf(columnId: string, newValue: string, node: {
    name: string;
}, entry: {
    name: string;
    parent?: {
        name?: unknown;
    } | null;
}): CatalogRename | null;
/**
 * A rename of a service interface's function, which the catalog keeps its own copy of
 * (`p_Name` / `p_FunctionPrototype` under the interface's definition): the interface as the
 * file spells it, and the function's name in the file and next.
 */
export interface CatalogFunctionRename {
    interfaceName: string;
    oldName: string;
    newName: string;
}
/**
 * The function rename this cell edit carries into the catalog, or null if it carries none:
 * a Name edit of a `Simulink.FunctionElement` that is a direct child of the top-level entry,
 * which is the one function rename core records for its own save
 * (`FunctionElementNode._functionRenamed`).
 *
 * MUST be called before the mutation, like `catalogRenameOf`: `node.name` is the name the
 * file still spells. The interface's name needs no such care. Both providers carry an entry
 * rename into the document the moment it is made, so the file spells the interface as
 * `entry.name`.
 *
 * Not a lookup in the catalog either, for the same reason as `catalogRenameOf`: a function
 * the catalog does not list is answered by the helpers finding no sites.
 */
export declare function catalogFunctionRenameOf(columnId: string, newValue: string, node: {
    name: string;
    className?: string;
    parent?: unknown;
}, entry: {
    name: string;
}): CatalogFunctionRename | null;
/**
 * The range replacements that carry a rename into an uncompressed-text dictionary's
 * catalog, as offsets into the document text the caller is about to edit.
 *
 * Empty for the overwhelming majority of renames (an entry no catalog classifies, or a
 * dictionary with no catalog part at all), which is what keeps this off the hot path: a
 * dictionary without the part is one failed `indexOf` away from an empty answer.
 */
export declare function scJsonRenameEdits(text: string, oldName: string, newName: string): ScTextEdit[];
/**
 * The range replacements that carry a function rename into an uncompressed-text
 * dictionary's catalog, as offsets into the document text the caller is about to edit:
 * the function's `p_Name`, and its `p_FunctionPrototype` where that declares it by name.
 *
 * Core's own edits, the ones its save applies, run on the text as it stands. Empty when the
 * catalog does not list the function under that interface, or when there is no catalog part.
 */
export declare function scJsonFunctionRenameEdits(text: string, rename: CatalogFunctionRename): ScTextEdit[];
/** A pass-through zip member, before and after a rename was carried into it. */
export interface ScPartPatch {
    member: string;
    before: Uint8Array;
    after: Uint8Array;
}
/**
 * The catalog member swap that carries a rename into a compressed-binary dictionary, or
 * null when there is nothing to carry.
 *
 * Both halves are kept because the swap has to be undoable, and `before` is the member's
 * ORIGINAL BYTES rather than a re-serialization of them: everything but `data/chunk0.xml`
 * is written back verbatim, so an undo that rebuilt the part would land in the user's
 * file as a reformatting of a part this session never meant to touch.
 */
export declare function scXmlRenamePatch(zipMeta: Record<string, Uint8Array>, oldName: string, newName: string): ScPartPatch | null;
/**
 * The catalog member swap that carries a function rename into a compressed-binary
 * dictionary, or null when there is nothing to carry. It has `scXmlRenamePatch`'s shape, so
 * it rides `pushEdit` and its undo the same way, and `before` is again the member's original
 * bytes.
 */
export declare function scXmlFunctionRenamePatch(zipMeta: Record<string, Uint8Array>, rename: CatalogFunctionRename): ScPartPatch | null;
//# sourceMappingURL=scRename.d.ts.map