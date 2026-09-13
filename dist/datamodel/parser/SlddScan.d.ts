import type { ParseWarning } from './ParseWarning.js';
/** Entry names and referenced sub-dictionary names, both in document order. */
export interface SlddScanResult {
    /**
     * One name per entry, in document order, INCLUDING `''` for an entry that has no
     * readable Name.
     *
     * The empty string is kept because the reference keeps it: `parseEntry` does
     * `getProperty(obj, 'Name') || ''` and pushes the entry regardless, so an unnamed
     * entry occupies a position in `entries`. Dropping it here would shift every later
     * name by one against a consumer that indexes positionally -- which is a wrong-name
     * bug, not a missing-name one.
     */
    names: string[];
    /**
     * Referenced sub-dictionary filenames, in document order, with empties dropped --
     * which is what `normalizeRefNames` does, and it is the reference for this field.
     */
    refs: string[];
}
/**
 * Names and refs out of a `data/chunk0.xml` body.
 *
 * Refuses (throws `UnscannableDictionary`, so the caller falls back to the full parse)
 * on every one of:
 *
 *  - a root element that is not `<DataSource>`.
 *  - a `DD.ENTRY` whose first child element is not `<P Name="Name"`, or a
 *    `DD.DICTIONARYREFERENCE` whose first is not `<P Name="Subdictionary"`. The
 *    reference reads the FIRST DIRECT child with that name (`getProperty` walks
 *    `obj.P`), and "first child" is how this module finds the same one without building
 *    the children. It holds for 241,599 of 241,599 corpus entries and 12 of 12
 *    references; if it ever does not, guessing would return a name from somewhere else
 *    in the entry.
 *  - an `<Object>` nested inside another `<Object>`. The reference only ever sees
 *    `<DataSource>`'s DIRECT children, so a nested one must not be counted -- and a
 *    nested `DD.ENTRY` is precisely the shape that would make this module invent an
 *    entry the parser does not report. Depth is tracked rather than assumed from
 *    indentation, because indentation is NOT reliable: this package's own splice writer
 *    emits top-level objects indented 20 and 32 spaces.
 *  - a name or reference containing `&` (see the file header) or introduced by `<!`,
 *    which is CDATA or a comment where this reads plain text.
 *  - an `<Object>` attribute whose value is not double-quoted, or that has no value. See
 *    `classValueAt`: reading a `Class` that is PRESENT as missing is how a scan returns an
 *    EMPTY name list for a full dictionary, which is far worse than being slow.
 *  - a truncated document: an unterminated tag, or a missing `</Object>`.
 *
 * `FormatVersion` is deliberately NOT one of them, though an earlier draft of this gated
 * on `"1"` because that is what all 32 compressed corpus dictionaries carry. Two things
 * killed it. It protects against nothing: every assumption above is checked DIRECTLY, by
 * looking at the shape it depends on, so a version that changes the shape is refused on
 * the shape and a version that does not needs no refusing -- and `test/fixtures/
 * compressed.sldd` is exactly that case, `FormatVersion="4"` with a version-1 shape. And
 * it costs a cliff nobody would see: a release that bumped the number would silently move
 * every dictionary back onto the 3230 ms path with no test failing and no warning.
 *
 * What the gate was really reaching for is a format whose shape is unchanged but whose
 * MEANING differs -- a future flag marking an entry deleted, say. A version check cannot
 * help there either, because this module's contract is agreement with THIS package's
 * `parseBinarySldd`, not with MATLAB. A semantic change needs that parser taught about it
 * too, and the day it is, the oracle is what catches the scanner still doing the old
 * thing. `test/slddScan.test.ts` pins the version-4 fixture for the same reason.
 */
export declare function scanDataSourceXml(xml: Uint8Array): SlddScanResult;
/**
 * Entry names and referenced sub-dictionaries of a `.sldd`, in document order.
 *
 * Equivalent to reading `readSlddContent` and taking `entries[].name` plus
 * `normalizeRefNames(content['Dictionary References'])`, and that equivalence is checked
 * over the whole corpus by `perf/oracle-run.mjs` rather than argued for here.
 *
 * Dispatches on the BYTES, never on the filename: both spellings of a dictionary carry
 * the same extension, so a reader that trusts the name reads the wrong file silently.
 *
 * `warnings` is this package's out-parameter convention and is forwarded to the full
 * parser on the paths that use one. The fast path raises none of its own: it either
 * scans, or refuses and lets the full parser have the file, warnings included.
 */
export declare function scanSldd(bytes: ArrayBuffer, warnings?: ParseWarning[]): SlddScanResult;
//# sourceMappingURL=SlddScan.d.ts.map