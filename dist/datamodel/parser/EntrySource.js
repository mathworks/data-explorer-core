// src/datamodel/parser/EntrySource.ts
// Copyright 2026 The MathWorks, Inc.
//
// WHERE AN ENTRY'S BYTES CAME FROM, FOR THE SAVE THAT KEEPS THEM.
//
// A save of a compressed-binary dictionary writes an entry nobody edited as the bytes
// it was read from, in the place it was read from, inside the document it was read
// from. Everything else in the file is MATLAB's, and none of it passes through a reader
// or a writer: the per-value writers are reached only for what the user changed, which
// is the only place their spelling is anybody's choice.
//
// That needs two facts the model does not otherwise hold, and both are recorded here:
//
//   - the chunk's FRAME: the text of `data/chunk0.xml`, where each entry sits in it,
//     and the dictionary-level fields as they were read, so a save can tell whether the
//     objects after the last entry still say what they said;
//   - each entry's SOURCE: which of those spans it is, and the span's text.
//
// Both are attached only by the reader that saw the bytes, and only through these
// WeakMaps, keyed by object identity. That is what keeps them from being FORGED from a
// record: a JSON round trip, a spread or a clone of the content, an `entry.serialize()`
// pasted into a section, or a host's undo record rebuilt into a node, is a different
// object and carries nothing — so it is regenerated, as before. A key or a field on the
// object would have travelled with a copy, and claimed bytes for a value nobody had
// checked against them.
//
// The reader attaches a source only when it has VERIFIED the pairing of spans to
// entries (BinarySlddParser.entryFrame), and withholds every one of them otherwise:
// one misaligned pair would have an entry written as another entry's bytes.
//
// The source holds the fragment's TEXT as well as its index, so a one-fragment read that
// is not part of a whole-chunk read can still attach the bytes it read.
//
// Bytes are kept only for an entry that still says what they say, and that is asked twice,
// of the same set of facts: its name, its section, and every metadata field the entry writer
// writes (WRITTEN_METADATA: the UUID, Namespace, LastMod, LastModBy and IsDerived lines).
//
//   - When the model is built. The reader's content is a plain object a host can change
//     before it builds a model from it, and the bytes are recorded on that very object. So
//     the raw entry has to still hold, when the model is built from it, the name, the value
//     object and every written metadata field it held when it was read (its Namespace and
//     IsDerived between them pick its section). One that does not is given its place and no
//     bytes, and is written from the model there: one renamed in place would otherwise show
//     the new name and save the old one.
//   - When the save writes it. A node is a plain object too, and its name, its metadata and
//     its place in a section can all be changed without the API that marks it: `node.name =`,
//     a field of `node.metadata` set, or the node moved to another section by removeChild and
//     addChild. The node is held to what it was when its bytes were attached (keptFragmentOf),
//     and one that has changed keeps its place and is written from the model, as it was
//     before bytes were kept at all.
//
// A change made deeper inside the value object is not seen by either.
/**
 * The metadata keys the entry writer (BinarySlddSerializer.regenerateEntryXml) writes an
 * entry's lines outside its Value from: `uuid`, `namespace` and `isderived` for the UUID,
 * Namespace and IsDerived lines, `_rawLastMod` or else `lastmod` for LastMod, and
 * `lastModifiedBy` or else `modifiedby` for LastModBy. An entry is held to every one of them,
 * so a change to any field the writer would write is a change to the entry.
 * test/binarySaveKeepsUnedited.test.ts holds the writer to this list.
 */
export const WRITTEN_METADATA = ['uuid', 'namespace', '_rawLastMod', 'lastmod', 'lastModifiedBy', 'modifiedby', 'isderived'];
// The value of each WRITTEN_METADATA key, in that order: undefined for a key the metadata
// does not hold, and for every key when there is no metadata at all.
function writtenMetadataOf(metadata) {
    const bag = metadata !== null && typeof metadata === 'object' ? metadata : undefined;
    return WRITTEN_METADATA.map((key) => bag?.[key]);
}
// Object.is, not ===: the value of a NaN scalar is the number NaN, which no === holds for.
function sameValues(a, b) {
    return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}
// What the reader hands over with its content: the frame on the content bag, a source on
// each raw entry. Read by SlddNode.parse, which moves them onto the nodes it builds.
const readFrames = new WeakMap();
const readSources = new WeakMap();
// What the save reads: the frame of a dictionary node, the source of an entry node.
const frames = new WeakMap();
const sources = new WeakMap();
/** Record, on the content the reader returns, the frame it verified. */
export function recordReadFrame(content, frame) {
    readFrames.set(content, frame);
}
/** Record, on one raw entry the reader returns, the bytes it was read from. */
export function recordReadSource(rawEntry, source) {
    readSources.set(rawEntry, {
        source,
        name: rawEntry.name,
        value: rawEntry.value,
        metadata: writtenMetadataOf(rawEntry.metadata),
    });
}
/** The frame the reader recorded on this exact content object, if any. */
export function readFrameOf(content) {
    return readFrames.get(content);
}
/**
 * The source the reader recorded on this exact raw entry, if any. When the entry no longer
 * says what it said when it was read — the same Name, the same value object, and the same
 * value in every WRITTEN_METADATA key — it is its place alone, with no fragment.
 */
export function readSourceOf(rawEntry) {
    const read = readSources.get(rawEntry);
    if (!read) {
        return undefined;
    }
    return Object.is(rawEntry.name, read.name) && Object.is(rawEntry.value, read.value)
        && sameValues(writtenMetadataOf(rawEntry.metadata), read.metadata)
        ? read.source
        : { frame: read.source.frame, index: read.source.index, fragment: null };
}
/** Give a dictionary node the frame it was read from. */
export function attachChunkFrame(dictionary, frame) {
    frames.set(dictionary, frame);
}
/**
 * Give an entry node the bytes it was read from, and record what the node says as they are
 * attached — its name, the section it is in, and its WRITTEN_METADATA — for keptFragmentOf
 * to hold it to.
 */
export function attachEntrySource(entry, source) {
    sources.set(entry, { source, name: entry.name, section: entry.parent, metadata: writtenMetadataOf(entry.metadata) });
}
/** The frame a dictionary node was read from, if a verified one was. */
export function chunkFrameOf(dictionary) {
    return frames.get(dictionary);
}
/**
 * The bytes an entry node was read from, if verified ones were: its place among the frame's
 * spans, whatever the node says now. Whether the fragment may still be written as the node is
 * keptFragmentOf's to say.
 */
export function entrySourceOf(entry) {
    return sources.get(entry)?.source;
}
/**
 * The text an entry node was read from, when the node still says what it said when that text
 * was attached: the same name, in the same section object, and the same value in every
 * WRITTEN_METADATA key. Otherwise null, and the node is written from the model: each of those is
 * a line of the entry, or the section it is filed in, and a node changed around the API that
 * would have marked it would otherwise show the change and save the bytes it was read from.
 */
export function keptFragmentOf(entry) {
    const attached = sources.get(entry);
    if (!attached || attached.source.fragment === null) {
        return null;
    }
    return Object.is(entry.name, attached.name) && Object.is(entry.parent, attached.section)
        && sameValues(writtenMetadataOf(entry.metadata), attached.metadata)
        ? attached.source.fragment
        : null;
}
// The package around the chunk: each member's place in the archive, its time stamp and its
// compression, as read, keyed by the pass-through member bag the reader built (which the
// dictionary node holds as `_zipMetadata`, by identity). Zip-level metadata only — the
// members' bytes are the bag's — so a save can put the archive back together as it was.
const packages = new WeakMap();
/** Record how the archive a member bag was read from listed its members. */
export function recordPackageStamps(zipMetadata, stamps) {
    packages.set(zipMetadata, stamps);
}
/** How the archive this member bag was read from listed its members, if it is known. */
export function packageStampsOf(zipMetadata) {
    return zipMetadata ? packages.get(zipMetadata) : undefined;
}
// WHICH ELEMENT OF THE FILE AN ELEMENT OF THE MODEL IS, FOR THE SAVE THAT MERGES AN EDITED ENTRY.
//
// An entry that was edited is written as its bytes with only what the edit changed written from
// the model (EntryMerge). A property is found again in the bytes by its Name, but the elements of
// an array have none: a bus's BusElements, a struct array's, a cell's, an object array's. Paired
// by position, removing a bus's first element paired every later element with the one before it
// in the file, and kept bytes the model no longer holds. So each element is paired by ORIGIN: the
// index, among its parent's `<Element>` children in the file, of the element it was read from.
//
// The reader records it on the `_elements` array it builds (recordReadElements), as the index of
// each element in that array: element k is the file's k-th `<Element>` there. A node built from
// such an array records each element node's origin (recordOrigin), so a node that structural
// editing adds is one with none, and one it removes takes its origin with it. Whatever builds a
// new `_elements` array from those nodes, to write it, records their origins on it in turn
// (recordElementOrigins). As with the bytes above, only by object identity: a copy of the value,
// a paste or a record rebuilt into a node, carries no origin, and its elements are written from
// the model as added ones.
//
// The writers spell an origin only while a merge asks for them (withOriginTags): an attribute
// on the element's open tag (ORIGIN_ATTR), which EntryMerge pairs by and then removes. At any
// other time they write what they always wrote.
// For an array as the reader built it (element k came from the k-th <Element>), its length then,
// a number, so that the mark costs no object of its own; for one built from element nodes, the
// origin of each element, as long as the array was.
const elementOrigins = new WeakMap();
const holderOrigins = new WeakMap();
/** Record, on an `_elements` array the binary reader built, that its element k is the k-th `<Element>` it read. */
export function recordReadElements(elements) {
    elementOrigins.set(elements, elements.length);
}
/** Record, on an `_elements` array built to be written, the origin of each element (undefined for one with none). */
export function recordElementOrigins(elements, origins) {
    elementOrigins.set(elements, origins.slice(0, elements.length));
}
/**
 * The origin of element `k` of an `_elements` array, if one was recorded on it. An array whose
 * length is not what it was when its origins were recorded has none: an element spliced in or
 * out since would shift every origin after it.
 */
export function elementOriginAt(elements, k) {
    if (elements === null || typeof elements !== 'object') {
        return undefined;
    }
    const recorded = elementOrigins.get(elements);
    const length = elements.length;
    if (recorded === undefined || k < 0 || k >= length) {
        return undefined;
    }
    if (typeof recorded === 'number') {
        return recorded === length ? k : undefined;
    }
    return recorded.length === length ? recorded[k] : undefined;
}
/** Record the origin of an element node (or of whatever object stands for one element); undefined records none. */
export function recordOrigin(holder, origin) {
    if (origin !== undefined) {
        holderOrigins.set(holder, origin);
    }
}
/** The origin recorded on an element node, if any. */
export function originOf(holder) {
    return holder !== null && typeof holder === 'object' ? holderOrigins.get(holder) : undefined;
}
// A scalar value's own element: a struct's one `<Element>`, which its node writes itself and
// holds no node for.
const ownOrigins = new WeakMap();
/** Record the origin of the one element a scalar value's node writes for itself. */
export function recordOwnElementOrigin(node, origin) {
    if (origin !== undefined) {
        ownOrigins.set(node, origin);
    }
}
/** The origin of the one element a scalar value's node writes for itself, if one was recorded. */
export function ownElementOriginOf(node) {
    return ownOrigins.get(node);
}
/**
 * The attribute an element's open tag carries its origin in while a merge asks for one. Not a
 * name MATLAB writes, and a name EntryMerge refuses to find in what it writes.
 */
export const ORIGIN_ATTR = 'dex-core-origin';
let originTags = 0;
/** Whether the writers are to spell origins now (inside withOriginTags). */
export function taggingOrigins() {
    return originTags > 0;
}
/** Run `write` with the writers spelling each element's origin, where it has one. */
export function withOriginTags(write) {
    originTags++;
    try {
        return write();
    }
    finally {
        originTags--;
    }
}
/** The origin attribute, with its leading space, for an open tag: '' unless origins are being spelled and there is one. */
export function originAttr(origin) {
    return originTags > 0 && origin !== undefined ? ' ' + ORIGIN_ATTR + '="' + origin + '"' : '';
}
/**
 * `xml`, one element a writer wrote (`<Element …`, after its indentation), with its origin
 * spelled on its open tag; `xml` itself when origins are not being spelled, there is none, or
 * the text is not an element's.
 */
export function withOrigin(xml, origin) {
    const attr = originAttr(origin);
    if (attr === '') {
        return xml;
    }
    let at = 0;
    while (at < xml.length && xml.charCodeAt(at) === 0x20)
        at++;
    if (!xml.startsWith('<Element', at)) {
        return xml;
    }
    const next = xml.charCodeAt(at + 8);
    if (next !== 0x20 && next !== 0x3e && next !== 0x2f) {
        return xml;
    }
    return xml.substring(0, at + 8) + attr + xml.substring(at + 8);
}
//# sourceMappingURL=EntrySource.js.map