import { type ParseWarning } from './ParseWarning.js';
import { type Span } from './EntrySource.js';
/**
 * Read a `Dimension="d1*d2*...*dn"` attribute into every extent it declares.
 *
 * All of them are kept: MATLAB's own binary dictionary writes a 2x3x2 as
 * `"2*3*2"` with a flat column-major body, so folding the trailing extents into
 * the column count (2x6) reported a shape MATLAB never had, mislabelled every
 * element, and wrote `Matrix(2,6)` back on save. The serial string carries the
 * full rank now — `Matrix(2,3,2)` — so there is nothing left to fold into.
 *
 * A trailing singleton is dropped because MATLAB's `size()` drops it too: a
 * 2x3x1 IS a 2x3.
 *
 * The two off-nominal extent counts still have to be normalized here so every
 * caller folds them the SAME way — they used to each `split('*')` for
 * themselves, and both cases went wrong:
 *
 *   - Fewer than two extents (`Dimension="3"`) left `cols` undefined, so the value
 *     formatted as `Matrix(3,undefined)` with an EMPTY body — every element
 *     dropped on load, and re-saved as the scalar 0. A lone extent N is a row
 *     vector of N.
 *   - An unparseable Dimension has to become SOMETHING; a scalar is the least
 *     destructive guess.
 */
export declare function parseDims(dimension: string): number[];
/**
 * Read a compressed-binary `.sldd` package into dictionary content.
 *
 * `warnings`, when given, is appended to for anything the package CLAIMED to hold and
 * this reader could not read — see the header of this file for why the diagnostics
 * arrive through a parameter instead of the return value. Omitting it is supported and
 * unchanged: nothing is thrown, nothing is logged, and the content is identical.
 *
 * A package with no `data/chunk0.xml` at all still throws, because that is not a
 * dictionary this reader can answer for at all — there is no content to hand back and
 * warn beside. The line between the throw and a warning is whether the part is there:
 * present-and-unreadable is a short read, absent is not a `.sldd`. A chunk the package
 * holds and that could not be inflated (it runs past the size its directory entry
 * declares, see `unzipEntries`) is present-and-unreadable: an empty dictionary, and a
 * `source-unreadable` warning saying why.
 */
export declare function parseBinarySldd(arrayBuffer: ArrayBuffer, warnings?: ParseWarning[]): Record<string, unknown>;
export declare function parseBinarySlddParts(xmlString: string, zipMetadata: Record<string, Uint8Array>, warnings?: ParseWarning[]): Record<string, unknown>;
/**
 * Where each entry's `<Object Class="DD.ENTRY">…</Object>` sits in the chunk, in document
 * order, found by reading the chunk's markup rather than by searching its text.
 *
 * A search for the open tag and the first `</Object>` after it trusts every such text to be a
 * tag, and XML lets text that spells one sit inside an entry in five places: a comment, a
 * processing instruction, a CDATA section, and an attribute value in either quote. A
 * `</Object>` in one of them ended the span early; in the last entry nothing after it could
 * tell, and renaming or deleting that entry wrote a document with one `</Object>` too many.
 * So this reads the chunk as XML does, one piece of markup after another: a comment, CDATA
 * section or processing instruction is skipped to its end, a tag is read attribute by attribute
 * with each value skipped to its closing quote, and every element is closed by name. A span is
 * then exactly one element: a direct child of the root whose open tag is MATLAB's, from that
 * tag to the `</Object>` that closes it.
 *
 * The fast reader (`DictionaryXmlFast`) records the same spans as it reads a chunk, so this
 * scan is run only for a chunk that reader declines, or one whose line ends it normalized:
 * it is the general engine's half of the same answer. The two are held to each other over
 * every binary fixture (test/binarySaveKeepsUnedited.test.ts).
 *
 * `clean` is false wherever the scan cannot vouch for the spans, and `entryFrame` then pairs
 * nothing:
 *   - markup it cannot account for: a comment, CDATA section or processing instruction that is
 *     never closed, a DOCTYPE or any other `<!`, a `<` that starts no tag, a tag that is not
 *     a name followed by quoted attributes, or a close tag that does not close the element
 *     open. The scan stops there, and the spans it has are the entries before that point,
 *     which is what `rawXml` needs;
 *   - a document that is not one element: a second root, or an element still open at the end;
 *   - a processing instruction the reader would end elsewhere. XML ends one at its first `?>`,
 *     and fast-xml-parser at the first `?>` outside quotes, so a quote in one can make the two
 *     read different elements from that point on. The scan stops there too;
 *   - an object open tag at the top that is not MATLAB's entry tag (`<Object Class="DD.ENTRY">`)
 *     and spells `DD.ENTRY` or holds an entity (`spellsEntry`), as `<Object  Class='DD.ENTRY'>`
 *     does, which the reader reads as an entry. The scan stops there, since the entries after
 *     it could no longer be counted off against the reader's;
 *   - an object nested in an entry, or an entry closed other than by `</Object>`. Neither is
 *     a doubt about the span, and the scan goes on, but MATLAB writes neither, and the pairing
 *     declines them as it did when the search could not tell them from a span cut short.
 *
 * Given `root`, the scan also sets `root.contentAt` to just past the root's open tag when the
 * root is a `<DataSource …>` that is not self-closed, and to -1 otherwise: where a first entry
 * goes in a chunk that has none (`dataSourceContentStart`).
 *
 * Linear in the chunk's length: every step moves forward, and none searches past the point
 * where the scan then stops. It reads the 5.7 M tags of the largest chunk measured (207 MB,
 * 140,000 entries) in 323 ms.
 */
export declare function entrySpans(xml: string, root?: {
    contentAt: number;
}): {
    spans: Span[];
    clean: boolean;
};
export declare function transposeColumnMajor<T>(values: T[], dims: number[]): T[];
//# sourceMappingURL=BinarySlddParser.d.ts.map