import { type ChunkLayout } from './ChunkLayout.js';
import { type EntrySource } from './EntrySource.js';
import type SectionNode from '../node/container/SectionNode.js';
import type DataNode from '../node/DataNode.js';
import type { SystemComposerCatalog } from './ScCatalog.js';
import type { ParseWarning } from './ParseWarning.js';
/** One attribute of a scanned tag: its name, and its value as the bytes spell it. */
export interface ScannedAttr {
    readonly name: string;
    readonly value: string;
}
/** One element of a scanned fragment, by where it sits in the text it was scanned from. */
export interface ScannedElement {
    readonly tag: string;
    readonly attrs: readonly ScannedAttr[];
    /** The `<` of its open tag. */
    readonly start: number;
    /** Just past its open tag. */
    readonly openEnd: number;
    /** The `<` of its close tag; `openEnd` for a self-closed one. */
    readonly closeStart: number;
    /** Just past its close tag. */
    readonly end: number;
    readonly children: readonly ScannedElement[];
    /**
     * Its content is more than its child elements and whitespace: text beside a child, a comment
     * or a CDATA section. Such an element is written whole, its bytes or the model's.
     */
    readonly opaque: boolean;
}
/**
 * The element tree of the one element `xml` holds from `from` to `to` (whitespace around it
 * allowed), read as XML reads it: comments and CDATA sections skipped to their ends, each tag read
 * attribute by attribute with each value skipped to its closing quote, every element closed by
 * name. Null for anything this cannot vouch for: a processing instruction, a DOCTYPE or any other
 * `<!`, a `<` that starts no tag, an attribute that is not a name, `=` and a quoted value, a close
 * tag that does not close the element open, text outside the element, or more than one element.
 * Linear in the length of the text.
 */
export declare function scanEntryTree(xml: string, from?: number, to?: number): ScannedElement | null;
/** `xml` with every origin the writers spelled removed. */
export declare function stripOrigins(xml: string): string;
/**
 * The entry `<Object>…</Object>` merged from O (the bytes it was read from), B (the writers' text
 * for O as read) and C (the writers' text for the model), the parts written from C laid out in
 * `layout`; null where the three cannot be merged with certainty. B and C are as the writers
 * write them, origins and all; what is returned holds none.
 */
export declare function mergeEntry(fragmentO: string, textB: string, textC: string, layout: ChunkLayout | null): string | null;
/**
 * Where `written`, the text written for an edited entry, changes a part of O that the edit did
 * not change: every child whose bytes differ from O's must be one where B and C differ too, and a
 * child the reader does not read must be O's as it is (D13). Paired as the merge pairs them, by
 * Name and by origin, and read with the scan alone, never the reader, since a reader and a writer
 * can lose the same thing. The entry's Name and LastMod lines may differ anywhere. Null when O, B
 * or C does not scan, which leaves nothing to hold `written` to.
 */
export declare function keptPartsOf(fragmentO: string, textB: string, textC: string, written: string): string[] | null;
/** How readEntryFragment reads a fragment. */
export interface ReadEntryOptions {
    /**
     * The section to read the entry into, as the file's own entries are read
     * (SectionNode._readEntry): it is added as that section's last child. Without one, it is read
     * into a dictionary of its own, which nothing else holds.
     */
    readonly section?: SectionNode;
    /** The System Composer catalog the entry's class is read against; the section's dictionary's by default. */
    readonly systemComposer?: SystemComposerCatalog | null;
    /**
     * An entry node whose place in its file the new one takes: given the bytes it was read from,
     * the new node is given the same place with `fragment` as its bytes, so that it is written as
     * them for as long as nothing edits it, and merged with them once something does. Only with
     * `section`, and only for a fragment the reader pairs with the entry it reads from it.
     */
    readonly inheritPlaceFrom?: DataNode;
    readonly warnings?: ParseWarning[];
}
/**
 * What builds the entry node from the content the binary reader read a one-entry chunk as, given
 * the fragment that chunk wraps. The node layer's to supply (SlddNode registers it), since a
 * parser may not reach the node classes.
 */
export type EntryFragmentReader = (content: Record<string, unknown>, fragment: string, options: ReadEntryOptions) => DataNode | null;
/** Install the node layer's half of readEntryFragment. */
export declare function setEntryFragmentReader(reader: EntryFragmentReader): void;
/**
 * The entry node one `<Object Class="DD.ENTRY">…</Object>` fragment reads as, read by the binary
 * reader in a chunk of its own; null when it does not read as exactly one entry. This is how the
 * merge reads O again (B), and how a host rebuilds an entry from the text it holds for one (an
 * undo of a binary edit) with the bytes it came from (`inheritPlaceFrom`).
 */
export declare function readEntryFragment(fragment: string, options?: ReadEntryOptions): DataNode | null;
/** The catalog an entry node's dictionary reads classes against. */
export declare function catalogOf(entry: DataNode): SystemComposerCatalog | null;
/**
 * B for an entry: the writers' text, origins spelled, for its bytes as the reader reads them; null
 * when they cannot be read or written on their own. Kept with the source, which never changes.
 */
export declare function baseOf(source: EntrySource, catalog: SystemComposerCatalog | null, write: (entry: DataNode) => string): string | null;
//# sourceMappingURL=EntryMerge.d.ts.map