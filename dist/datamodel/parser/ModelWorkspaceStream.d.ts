/** What a stream was read as, kept for its conversion back. */
export interface WorkspaceStreamRead {
    preamble: Uint8Array;
    head: Uint8Array;
    names: string[];
    fields: Map<string, Uint8Array>;
    records: Map<string, Uint8Array>;
}
export type WorkspaceMat = {
    ok: true;
    mat: Uint8Array;
    read: WorkspaceStreamRead;
} | {
    ok: false;
    why: string;
};
/**
 * The MAT-file `stream`, a model workspace part's bytes, is as this package edits it, and what was
 * read of it for the conversion back; or why it is not one this package can convert and convert
 * back exactly, as a clause.
 */
export declare function matOfWorkspaceStream(stream: Uint8Array): WorkspaceMat;
/**
 * The model workspace part of `mat`, a MAT-file this package wrote of one `read` was converted out
 * of (MatFileWriter.serializeMatFile of the MatNode made of it): each named record a field of the
 * struct, as it was read where the record is the one built of it, and the unnamed record the element
 * after it. Throws, saying why, where `mat` is not a MAT-file a stream can be made of: one with a
 * record this cannot read as an array, or more than one unnamed record.
 */
export declare function workspaceStreamOfMat(mat: Uint8Array, read: WorkspaceStreamRead): Uint8Array;
/**
 * The field-name length MATLAB's getByteStreamFromArray writes for a struct of fields `names`: the
 * longest name plus its terminator, never under 3, and 1 for no field. Not a MAT-file's (MatWriter's
 * struct, never under 5): measured on R2027a, test/parity/matlab/probe_workspace_stream.m.
 */
export declare function workspaceFieldStride(names: readonly string[]): number;
//# sourceMappingURL=ModelWorkspaceStream.d.ts.map