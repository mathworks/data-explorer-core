/**
 * Why a subsystem was refused.
 *
 * - `malformed`: a layer or a blob section does not parse exactly — a byte count that does not
 *   tile its element, a section that does not end where the next starts, a list running past its
 *   section — or a record names what is not there: a string, a class row, an object, a list or a
 *   value cell past its table, or a value kind past the four MATLAB writes (and loads); or the null
 *   class row or object is not all zeros.
 * - `unsupported`: it parses, as something this codec was not measured on: a big-endian payload
 *   or blob, a blob version other than 4.0 or 5.0, or a file header holding more than the one
 *   table MATLAB R2027a writes there. (A 5.0 blob is read, for display; no edit takes one,
 *   measuredVersion.)
 * - `not-canonical`: every record reads, and writing them back gives other bytes: a padding byte
 *   that is not zero, a dims this codec restates in another shape, a class row's unused word that
 *   is not zero. An edit through this codec would change bytes no edit asked for.
 */
export type McosCodecRefusalReason = 'malformed' | 'unsupported' | 'not-canonical';
export interface McosCodecRefusal {
    ok: false;
    reason: McosCodecRefusalReason;
    message: string;
}
export type McosCodecRead = {
    ok: true;
    subsystem: McosSubsystemRecords;
} | McosCodecRefusal;
/** How a triple's value is read: a string-table index, a value index, an integer, an object id. */
export declare const McosValueKind: {
    readonly string: 0;
    readonly cell: 1;
    readonly integer: 2;
    readonly object: 3;
};
/** One (name, kind, value) triple of a property list, constructor-argument list or per-array map. */
export interface McosTripleRecord {
    name: number;
    flag: number;
    value: number;
}
/** A row of the class table. Row 0 is the null class. */
export interface McosClassRecord {
    namespace: number;
    name: number;
    version: [number, number, number, number];
}
/** A row of the object table; the object's id is its position. Row 0 is the null object. */
export interface McosObjectRecord {
    classIndex: number;
    child: number;
    sibling: number;
    ctorList: number;
    pvList: number;
    dynamicProps: number;
}
/** An entry of the removed-property map: an object and the string indices of the names it lost. */
export interface McosRemovedRecord {
    objectId: number;
    names: number[];
}
/** An entry of the per-array property map. */
export interface McosPerArrayRecord {
    index: number;
    triples: McosTripleRecord[];
}
/** The metadata blob as records. Lists are 0-based exactly as stored. */
export interface McosBlobRecords {
    major: number;
    minor: number;
    reserved: number;
    strings: string[];
    classes: McosClassRecord[];
    ctorLists: McosTripleRecord[][];
    objects: McosObjectRecord[];
    pvLists: McosTripleRecord[][];
    dynamicProps: number[][];
    valuePointers: Uint8Array[];
    removedProps: McosRemovedRecord[] | null;
    fileHeader: {
        perArray: McosPerArrayRecord[] | null;
    } | null;
}
/** A per-class cell whose entries are elements: a cell array [C 1], C the class rows. */
export interface McosElementCell {
    flags: Uint8Array;
    name: Uint8Array;
    entries: Uint8Array[];
}
/** A per-class cell whose entries are numbers: int32 [C 1] or uint32 [1 C]. */
export interface McosNumberCell {
    flags: Uint8Array;
    name: Uint8Array;
    entries: number[];
}
/**
 * A subsystem as records. The byte arrays are the sub-elements as read (views into the bytes
 * read, which this never writes to) or as an edit made them, each one whole sub-element, tag
 * and padding included; nothing here writes into one, an edit replaces it.
 */
export interface McosSubsystemRecords {
    outer: {
        flags: Uint8Array;
        name: Uint8Array;
    };
    preamble: Uint8Array;
    struct: {
        head: Uint8Array[];
        fields: (Uint8Array | null)[];
    };
    opaqueHead: Uint8Array[];
    cellArray: {
        flags: Uint8Array;
        name: Uint8Array;
    };
    blobCell: {
        flags: Uint8Array;
        name: Uint8Array;
    };
    blob: McosBlobRecords;
    reserved: Uint8Array;
    values: Uint8Array[];
    packages: McosNumberCell | null;
    classData: McosElementCell | null;
    aliases: McosNumberCell | null;
    defaults: McosElementCell | null;
    rest: Uint8Array;
}
/** The objects a descriptor names: [0xDD000000, ndims, dims…, ids…, class row]. */
export interface McosDescriptor {
    dims: number[];
    ids: number[];
    classIndex: number | null;
}
/**
 * Reads a subsystem element whole into records; or refuses it, when a layer or a section does not
 * parse exactly, a record names what is not there, it is a kind this codec was not measured on, or
 * writing its records back would not give its bytes.
 *
 * The records' byte arrays are views into `bytes`, not copies: nothing may write into `bytes`, or
 * transfer its buffer, while they are in use.
 */
export declare function readSubsystem(bytes: Uint8Array): McosCodecRead;
/**
 * The subsystem element the records say, tag included: every offset of the blob, every dims and
 * every byte count around a record computed from the records, every other sub-element the bytes
 * it holds. Throws MatWriteError for records no subsystem can say: a per-class cell without one
 * entry per class row, or one the blob's version does not write; a string with a NUL in it; a
 * number past its field; a size past what an int32 dims word can say.
 */
export declare function writeSubsystem(sub: McosSubsystemRecords): Uint8Array;
/**
 * Whether edits of `sub` were measured against MATLAB: its blob is version 4.0, what MATLAB R2027a
 * writes. A version-5.0 blob is read, and written back as read, on the layout MATLAB's package
 * names are documented to take, but no MATLAB-written one was ever seen, so no edit of one was
 * judged: an added class could extend a per-class cell that is not per class.
 */
export declare function measuredVersion(sub: McosSubsystemRecords): boolean;
/** The qualified name of class row `classIndex`: 'Simulink.Parameter', or 'string' in no namespace. */
export declare function classNameOf(sub: McosSubsystemRecords, classIndex: number): string;
/** The first class row naming `qualifiedName`, or 0 when none does. */
export declare function findClass(sub: McosSubsystemRecords, qualifiedName: string): number;
/**
 * The index of `text` in the string table: the first entry that spells it, or a new last entry
 * when none does, which is how MATLAB's save interns a string. The empty string is index 0, which
 * the table does not hold.
 */
export declare function internString(sub: McosSubsystemRecords, text: string): number;
/** internString of each of `texts`, in order. */
export declare function internStrings(sub: McosSubsystemRecords, texts: readonly string[]): number[];
/** A class row to add, and what its entries in the per-class cells are. */
export interface McosClassSpec {
    name: string;
    version?: [number, number, number, number];
    classData?: Uint8Array;
    defaults?: Uint8Array;
    alias?: string;
    packageName?: string;
}
/**
 * A new class row for `spec.name`, with an entry in every per-class cell; returns its index.
 *
 * New even when the table holds the class already: MATLAB's `save -append` writes a row per class
 * per save session, and measured against MATLAB R2027a a reused row loads the same. So a caller
 * adding several objects of a class in one save uses the row it got for the first.
 *
 * Strings are interned in the order MATLAB's append interns them: the class name, its namespace,
 * the alias, the package name, then the field names of a defaults struct.
 */
export declare function addClass(sub: McosSubsystemRecords, spec: McosClassSpec): number;
/** The field names of a struct element, in order, or null for an element that is not a struct. */
export declare function structFieldNames(element: Uint8Array): string[] | null;
/**
 * A new object row, all zeros, for a caller that must hand out the object's id before it knows
 * the rest of the row: MATLAB numbers an object before the objects its properties hold, and adds
 * its class row and dynamic-property list after theirs. Returns its id.
 */
export declare function appendObjectRow(sub: McosSubsystemRecords): number;
/**
 * A new constructor-argument list holding `triples`; returns its index. In a subsystem with no
 * list yet the null list 0 is added first, as MATLAB adds it with the first list. (Measured
 * against MATLAB R2027a: a file whose objects all saved property lists, a ConfigSet's, has no
 * constructor-argument list at all, and a first list written there as list 0 made the `string`
 * it was for fail to load.)
 */
export declare function appendCtorList(sub: McosSubsystemRecords, triples?: readonly McosTripleRecord[]): number;
/** A new property list holding `triples`, after the null list 0 when there is none; returns its index. */
export declare function appendPvList(sub: McosSubsystemRecords, triples?: readonly McosTripleRecord[]): number;
/**
 * A new dynamic-property list holding the object ids `ids`, after the null list 0 when there is
 * none; returns its index. MATLAB gives every object it saves by property list one of its own,
 * empty for one with no dynamic properties, and writes none, null list and all, before the first.
 */
export declare function appendDynamicPropsList(sub: McosSubsystemRecords, ids?: readonly number[]): number;
/** An object to add. */
export interface McosObjectSpec {
    classIndex: number;
    ctor?: readonly McosTripleRecord[];
    pv?: readonly McosTripleRecord[];
    dynamicProps?: readonly number[];
    child?: number;
    sibling?: number;
}
/**
 * A new object, with its lists: a constructor-argument list when `ctor` is given, a property list
 * and a dynamic-property list of its own when `pv` is given. Returns its id.
 */
export declare function addObject(sub: McosSubsystemRecords, spec: McosObjectSpec): number;
/** `cell`, one whole miMATRIX element, appended after every value cell; returns its value index. */
export declare function addValueCell(sub: McosSubsystemRecords, cell: Uint8Array): number;
/** How an edit that replaces a value cell may treat object references. */
export interface McosCellOptions {
    objectReference?: boolean;
    handleOpaque?: boolean;
}
/**
 * Value cell `valueIndex` replaced by `cell`: what changes a stored property, and, with a
 * descriptorCell and `objectReference`, what re-points one at other objects.
 */
export declare function replaceValueCell(sub: McosSubsystemRecords, valueIndex: number, cell: Uint8Array, options?: McosCellOptions): void;
/** How many triples, of every list and the per-array map, name value cell `valueIndex`. */
export declare function valueCellUsers(sub: McosSubsystemRecords, valueIndex: number): number;
/** One triple of an object's property list, by its saved name. */
export interface McosProperty {
    savedName: string;
    flag: number;
    value: number;
}
/**
 * The triples of object `objectId`'s property list, in order, by saved name; [] for an object
 * that saved itself as one payload and has no property list.
 */
export declare function propertiesOf(sub: McosSubsystemRecords, objectId: number): McosProperty[];
/**
 * `triple` inserted into object `objectId`'s property list at `position` (its end by default):
 * a property that was at its class default, which MATLAB saves no triple for, given a value.
 * Returns the position. Refuses a property the list holds already.
 */
export declare function insertPvTriple(sub: McosSubsystemRecords, objectId: number, triple: McosTripleRecord, position?: number): number;
/**
 * The triple for `savedName` removed from object `objectId`'s property list, and returned; null
 * when the list holds none. The property loads as its class default, as when MATLAB's own save
 * finds it back at the default. A value cell the triple named stays where it is, named by nothing.
 */
export declare function removePvTriple(sub: McosSubsystemRecords, objectId: number, savedName: string): McosTripleRecord | null;
/** What setProperty did: swapped a stored cell, or gave the property a value cell. */
export interface McosSetResult {
    op: 'swap' | 'retype' | 'insert';
    valueIndex: number;
    position: number;
}
/**
 * Property `savedName` of object `objectId` given the value `cell`, one whole miMATRIX element:
 * its value cell replaced when it has one; otherwise the cell appended after every other and the
 * property's triple made to name it, in place when the list holds one, inserted at `position`
 * (the list's end by default) when the property was at its class default. Refuses a cell another
 * triple names too, which a replacement would change for both; and, without `objectReference`, an
 * object reference given or replaced (McosCellOptions).
 */
export declare function setProperty(sub: McosSubsystemRecords, objectId: number, savedName: string, cell: Uint8Array, position?: number, options?: McosCellOptions): McosSetResult;
/**
 * The value cell of an object reference: the uint32 column [0xDD000000, ndims, dims…, ids…,
 * class row], nameless, as MATLAB writes the property of an object that holds other objects (a
 * Parameter's CoderInfo) and the inside of every class-17 element. `ids` are column-major; a
 * deleted handle is id 0.
 */
export declare function descriptorCell(d: McosDescriptor): Uint8Array;
/**
 * The objects a value cell or a class-17 element names, or null when it is not an object
 * reference: a uint32 column whose first word is 0xDD000000 and that holds what its dims say,
 * plus at most the class row.
 */
export declare function readDescriptor(element: Uint8Array): McosDescriptor | null;
/**
 * A class-17 element naming objects of the subsystem: what a variable holding them is, or a
 * struct field or a cell holding them in a variable (name ''). `className` is the name the
 * variable shows, the class's oldest name for a renamed class.
 */
export declare function objectReferenceElement(name: string, className: string, d: McosDescriptor): Uint8Array;
/**
 * The value cell of a `string` array: a uint64 row [1, ndims, dims…, one length per element
 * (UTF-16 code units; 2^64 - 1 for <missing>), then every element's code units packed, zero-padded
 * to 8 bytes]. `texts` are column-major, null for <missing>.
 */
export declare function stringPayloadCell(texts: readonly (string | null)[], dims: readonly number[]): Uint8Array;
/** The texts a `string` value cell holds, column-major (null for <missing>), and its dims; or null. */
export declare function readStringPayload(cell: Uint8Array): {
    dims: number[];
    texts: (string | null)[];
} | null;
/**
 * A new `string` object holding the array `texts` (column-major, null for <missing>) of `dims`:
 * one object holds the whole array, saved as one constructor argument of type 'any' naming its
 * payload cell. `classIndex` is the string class row to use, a new one by default. Strings are
 * interned as MATLAB interns them, 'any' before 'string'. Returns the object's id, its class row
 * and its payload's value index; the variable naming it is a class-17 element of dims [1 1]
 * whatever the array's (objectReferenceElement).
 */
export declare function addStringObject(sub: McosSubsystemRecords, texts: readonly (string | null)[], dims: readonly number[], classIndex?: number): {
    objectId: number;
    classIndex: number;
    valueIndex: number;
};
/** The texts and dims of `string` object `objectId`, or null when it is not one. */
export declare function stringObjectOf(sub: McosSubsystemRecords, objectId: number): {
    valueIndex: number;
    dims: number[];
    texts: (string | null)[];
} | null;
/** What a value cell names of its subsystem's objects: none, or them as a whole, or some deeper in. */
export type McosCellReferences = 'none' | 'descriptor' | 'nested';
/**
 * Whether value cell `cell` names objects of its subsystem: 'descriptor' for an object reference
 * (readDescriptor reads it), 'nested' for an MCOS opaque, an enumeration or an object reference
 * anywhere inside a struct or a cell (and for an element of a kind not looked into), 'none' for a
 * value, a 'handle' opaque included.
 */
export declare function valueCellReferences(cell: Uint8Array): McosCellReferences;
/**
 * `element` with every object reference inside it — itself, or in a field or a cell at any depth
 * — replaced by `rename(reference)`, called once per reference in the order they lie: how the
 * objects a class's defaults struct holds are given their rows in another subsystem. A new
 * reference must have the old one's dims and its class row or none, so that it takes the bytes
 * the old one took. Throws MatWriteError, writing nothing, for a reference this cannot reach:
 * one inside an MCOS opaque or an enumeration, or an element of a kind not looked into.
 */
export declare function mapObjectReferences(element: Uint8Array, rename: (d: McosDescriptor) => McosDescriptor): Uint8Array;
/**
 * The fields of a 1x1 struct element, in order, each with its value element (tag included); []
 * for a struct with no fields (the 1x0 one MATLAB writes for a class with no defaults); null for
 * anything else. What a class's defaults struct says its properties default to.
 */
export declare function structFields(element: Uint8Array): {
    name: string;
    value: Uint8Array;
}[] | null;
/**
 * The class systems the subsystem's stream holds objects of: the field names of the struct in
 * its trailing element, ['MCOS'] as MATLAB R2027a writes it, ['MCOS', 'handle'] once a 'handle'
 * opaque is saved; null when the trailing element is not that shape.
 */
export declare function classSystemsOf(sub: McosSubsystemRecords): string[] | null;
/**
 * Each of `names` the stream's trailing struct does not hold given to it as a field, last, holding
 * [] — what MATLAB R2023b writes there in a file a 'handle' opaque is saved in. The fields it
 * holds keep their values; the field-name width is restated, the longest name and its NUL.
 */
export declare function addClassSystems(sub: McosSubsystemRecords, names: readonly string[]): void;
/** A 'handle' opaque as records: its own small subsystem. */
export interface McosHandleRecords {
    head: Uint8Array[];
    cellArray: {
        flags: Uint8Array;
        name: Uint8Array;
    };
    blobCell: {
        flags: Uint8Array;
        name: Uint8Array;
        row: boolean;
    };
    blob: McosBlobRecords;
    root: Uint8Array;
    values: Uint8Array[];
}
export type McosHandleRead = {
    ok: true;
    opaque: McosHandleRecords;
} | McosCodecRefusal;
/** Whether `cell` is a 'handle' opaque element, whether or not the rest of it reads. */
export declare function isHandleOpaque(cell: Uint8Array): boolean;
/**
 * Reads a 'handle' opaque value cell whole into records; or refuses it, as readSubsystem refuses a
 * subsystem: a layer or section that does not parse exactly, a record naming what is not there, a
 * kind not measured, or records that would not write back as its bytes.
 */
export declare function readHandleOpaque(cell: Uint8Array): McosHandleRead;
/** The 'handle' opaque value cell the records say: the blob's offsets and every dims and size restated. */
export declare function writeHandleOpaque(h: McosHandleRecords): Uint8Array;
/** A CoderInfo's code-generation settings, as saved. */
export interface McosCoderInfoSettings {
    StorageClass: string;
    Identifier: string;
    Alignment: number;
}
/**
 * The StorageClass, Identifier and Alignment a 'handle' opaque CoderInfo holds, for display; or why
 * not: an opaque that does not read, or holds another class (a Signal's LoggingInfo), or a CoderInfo
 * that saves one of the three in a form not measured.
 */
export declare function handleCoderInfoOf(cell: Uint8Array): {
    ok: true;
    settings: McosCoderInfoSettings;
} | McosCodecRefusal;
/**
 * The 'handle' opaque CoderInfo value cell `cell` with `edits` made, written as MATLAB's own edit
 * writes it (above): StorageClass as HANDLE_STORAGE_CLASSES says, a string index or a char cell;
 * Identifier as the Alias char cell; Alignment as a double cell. Only a storage class written so
 * was measured, and any other is refused ('unsupported'), as is any edit of a CoderInfo whose
 * storage class is another now (a custom one, whose attributes an edit may change too); no other
 * value is judged here (whether MATLAB takes it, under that storage class, is the caller's to
 * judge). None is made in place: the cell is new. Or why not: an opaque that does not read, holds
 * another class, or does not save the property edited.
 */
export declare function editHandleCoderInfo(cell: Uint8Array, edits: Partial<McosCoderInfoSettings>): {
    ok: true;
    cell: Uint8Array;
} | McosCodecRefusal;
/**
 * A subsystem with no class and no object, for a file that has none, in the shape MATLAB R2027a
 * writes one: a version-4.0 blob of null records (class row 0, object 0, property list 0, no
 * constructor-argument or dynamic-property list), an empty removed-property map and per-array
 * map, a struct 1x0 or 0 in each per-class cell for the null class, and after the struct the
 * stream's own uint8 [1 88] element holding struct{MCOS: []}. Measured against MATLAB R2027a: a
 * `string` added to it is MATLAB's own subsystem for that one variable, byte for byte.
 *
 * Or, given `shape`, an empty subsystem in that subsystem's shape instead: its layers, its blob's
 * version, the sections it writes, and the null entry 0 of each of its per-class cells. The
 * shape's struct fields other than MCOS and the rest of its payload (the stream's own trailing
 * element) are copied as they are: a shape that holds another subsystem's data there carries it
 * over.
 */
export declare function createSubsystem(shape?: McosSubsystemRecords): McosSubsystemRecords;
/**
 * A copy of `sub` an edit of which leaves `sub` as it was: every record and list its own, the byte
 * arrays shared (no edit writes into one).
 */
export declare function cloneSubsystem(sub: McosSubsystemRecords): McosSubsystemRecords;
/**
 * What verifySubsystem found: nothing; or the written bytes refused, or reading back as records
 * other than meant; or records that break a rule of the subsystem ('broken': an object reference
 * naming what is not there, or, against the subsystem as read, a record an edit renumbered).
 */
export type McosVerdict = {
    ok: true;
} | {
    ok: false;
    reason: 'refused' | 'differs' | 'broken';
    message: string;
};
/** What the edits verifySubsystem checks were meant to change, besides appending. */
export interface McosVerifyOptions {
    edited?: readonly {
        objectId: number;
        properties?: readonly string[];
    }[];
    variables?: {
        created: readonly Uint8Array[];
        kept?: readonly Uint8Array[];
    };
}
/**
 * Whether `written` reads back as exactly the records `intended`: every layer and section parsed
 * exactly, every reference landing, every record — every string in its place, every row, list,
 * triple and value cell — the one meant. The check a writer runs on what it writes, since MATLAB
 * loads a subsystem whose offsets are stale with no warning and its records misassigned.
 *
 * And whether the records keep the rules no byte count shows: every value cell that is an object
 * reference names objects the table holds, one object of the class row it names. Given `original`,
 * the subsystem as read before the edits, also that they only appended (APPEND ONLY, above): its
 * strings, rows and per-class entries in place; no record no edit writes changed (the removed
 * properties, the file header, the layers; the stream's trailing element only given class
 * systems); a new object's lists its own; every reference cell an edit wrote naming distinct
 * objects of the table, from 1, each of its class row and none the object that holds it; a
 * 'handle' opaque replaced only by one of its objects, classes and references, of a storage class
 * measured. And, with `options`, that the edits stayed on the objects they were for and that the
 * variables created name what they should (McosVerifyOptions). A writer always passes `original`
 * and the objects it edited: a string moved, a row spliced in or a cell shifted reads back as
 * meant, and MATLAB loads an enumeration variable naming the moved string, or a property naming
 * its neighbour's cell, as something else, with no warning.
 */
export declare function verifySubsystem(written: Uint8Array, intended: McosSubsystemRecords, original?: McosSubsystemRecords, options?: McosVerifyOptions): McosVerdict;
//# sourceMappingURL=McosSubsystemCodec.d.ts.map