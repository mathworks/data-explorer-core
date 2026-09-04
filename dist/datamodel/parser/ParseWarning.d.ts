/**
 * Stable, machine-readable warning kinds. Hosts group, filter and localize on
 * `code`; `message` is for display and may be reworded at any time.
 *
 * Deliberately about CONTAINERS AND PARTS rather than about any one format, so a
 * `.slx` part, a `.prj` store document and a `.mat` variable all report through
 * the same three shapes as their readers gain the channel.
 */
export type ParseWarningCode = 
/** One named piece of the source could not be read; the rest of it was. */
'part-unreadable'
/** The source opened but held nothing this reader recognizes; the result is empty. */
 | 'source-empty'
/** Reading the source failed outright and was recovered from; the result is empty. */
 | 'source-unreadable';
/** One thing that could not be read, in a source that otherwise opened. */
export interface ParseWarning {
    code: ParseWarningCode;
    /** One line, host-renderable, naming what was lost rather than where it broke. */
    message: string;
    /**
     * The piece this is about, in whatever way the format names one: an OPC part
     * path, a project-store relpath, a variable name. Absent when the warning is
     * about the source as a whole.
     */
    part?: string;
}
/**
 * The reason an unknown throw carried, reduced to a string.
 *
 * Warnings cross a worker boundary by structured clone or JSON in every host that
 * parses off-thread, and an `Error` does not survive that in a form anything can
 * read. Keeping the cause as text is what makes a warning a value rather than a
 * live object — which is also why nothing here holds the Error itself.
 */
export declare function reasonOf(err: unknown): string;
//# sourceMappingURL=ParseWarning.d.ts.map