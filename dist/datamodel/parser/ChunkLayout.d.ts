/** How a chunk lays out the whitespace between its tags. */
export interface ChunkLayout {
    /** The line end: '\r\n', '\n', or '' for a chunk written on one line. */
    readonly nl: string;
    /** The indentation of a child of `<DataSource>`: an entry, or a dictionary-level object. */
    readonly base: string;
    /** One level more, below that. */
    readonly unit: string;
}
/** The layout the writers write in. Text in it is laid out as they write it, untouched. */
export declare const WRITER_LAYOUT: ChunkLayout;
/**
 * The layout of a chunk, read off the `<Object>` that starts at `at`: the line end and
 * indentation before it, and the indentation of the first line inside it. The writers' own
 * layout is `WRITER_LAYOUT` itself; null when the chunk does not show one this can follow
 * (no object, an object with nothing inside it, tabs and spaces mixed, a line end that
 * changes from one to the next), and what is written then is the writers' text as it is.
 */
export declare function layoutOf(xml: string, at: number): ChunkLayout | null;
/**
 * Text the writers wrote, laid out in `layout`: every run of whitespace between two tags
 * that is one LF and four spaces a level becomes the layout's line end and its indentation
 * for that level. A run that is the whole content of an element, and any run of another
 * shape, is left as it is; so is text with a comment or CDATA section in it, which the
 * writers do not write. `WRITER_LAYOUT` returns the text itself.
 */
export declare function inLayout(xml: string, layout: ChunkLayout): string;
//# sourceMappingURL=ChunkLayout.d.ts.map