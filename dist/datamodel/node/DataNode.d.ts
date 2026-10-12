import BaseNode from './BaseNode.js';
import type { PropClass } from './BaseNode.js';
import type { ChildAddEdit, ChildUndoRedo } from './childEdit.js';
import { MatBudgetError } from '../parser/MatWriter.js';
import { type EncodedValue } from '../parser/EncodedValue.js';
export interface SetPropertyResult {
    error: boolean;
    reason: string;
    invalidValue: string;
    validValue: string;
}
/**
 * The ENTRY `node` belongs to — itself when it IS one, null when nothing above it is.
 *
 * Every entry-scoped operation asks this first, because an entry is the unit the formats
 * actually work in: a text splice rewrites one entry, deleting a bus element reserializes
 * the bus that holds it, a drag carries whole entries however many rows were selected. So
 * each consumer was walking `parent` until `isEntry` for itself, and both members are
 * ours — `isEntry` is DataNode's, `parent` is BaseNode's — which makes the walk a fact
 * about this model and not about whatever is asking.
 *
 * A FUNCTION as well as the `owningEntry` getter below, and duck-typed on purpose. Two
 * kinds of caller cannot use the getter: a node that is not a DataNode at all (a SECTION
 * and a source root are ContainerNodes, and carry no `isEntry` — read as falsy here, so a
 * section's answer is null rather than the section itself), and a host holding a stand-in
 * shaped like a node rather than an instance of one. Both already relied on `isEntry`
 * being read off the object, so narrowing to the class would not have tightened anything
 * — it would only have moved the walk back out to the callers.
 *
 * Walks `parent` and nothing else, which is what `_markModified` depends on: it clears
 * state on every node BETWEEN `this` and the answer, and identifies that stretch by
 * walking parents until it reaches what this returned.
 */
export declare function owningEntryOf(node: BaseNode | null | undefined): DataNode | null;
/**
 * Where a raw property value a writer is writing stands: the entry's name, and the MATLAB
 * path from it to the value (`pSp.Value`, `obj.Prop(2).field`, `obj.Cellprop{3}`).
 */
export interface PropertyAt {
    entry: string;
    path: string;
}
export default class DataNode extends BaseNode {
    metadata: Record<string, unknown> | null;
    serial: Record<string, unknown>;
    status: string;
    Description?: string;
    _rawInput?: unknown;
    _encoded?: EncodedValue;
    rawXml?: string;
    classification?: string;
    constructor(name: string, parent: BaseNode | null, serial?: Record<string, unknown>);
    get kind(): string;
    get dataType(): string;
    get isEntry(): boolean;
    /** The entry this node belongs to — itself when it IS one, null when none is above it. */
    get owningEntry(): DataNode | null;
    get isDerived(): boolean;
    get lastModified(): string;
    get lastModifiedBy(): string;
    get disabled(): boolean;
    _propFor(propName: string): PropClass | undefined;
    _resolveProperty(propName: string): string;
    setProperty(propName: string, stringValue: string): true | SetPropertyResult;
    _setMinMax(propName: 'Min' | 'Max', stringValue: string): true | SetPropertyResult;
    static _normalizeMinMax(val: unknown): number | undefined;
    _rejectUnknownEnumeral(propName: string, stringValue: string): SetPropertyResult | null;
    execAddChild(): ChildAddEdit | null;
    execRemoveChild(_child?: BaseNode): ChildUndoRedo | null;
    _renameField(from: string, to: string): void;
    _markModified(): void;
    _stampLastModified(): void;
    serialize(): unknown;
    /**
     * The format of the file this node is in, as the nearest container above it states it
     * (SlddNode: 'json' for a text dictionary, 'xml' for a binary one), or undefined for a
     * node in no file — a payload being built, a value the XML writer re-reads.
     */
    _ownerFormat(): string | undefined;
    /**
     * This node's rawVal with its live property bag written into the first element — the value
     * half of an entry in an uncompressed-text `.sldd`.
     *
     * The envelope is spelled out again on the way out. `_propsOf` lifted a text dictionary's
     * `_custom_save` into the bag under SAVEOBJ_KEY so everything between parse and save sees
     * one spelling; here it goes back to being an element-level `_custom_save`, because that is
     * where MATLAB's loadobj looks and a `_properties._saveobj` is a key MATLAB has no reader
     * for. The two are the same envelope — see XmlUtils' CUSTOM_SAVE_KEY.
     *
     * `_properties` is then OMITTED when the envelope was all it held, because that is what
     * MATLAB writes: a custom-saving class's element is `{_custom_save: …, _id: …}` with no
     * property bag at all, and emitting `"_properties": {}` beside the envelope would invent a
     * key no MATLAB-written dictionary has. A class with no envelope keeps its bag
     * unconditionally, empty or not — that path is unchanged.
     */
    _serializeSimulinkObject(propOverrides: Record<string, unknown>): unknown;
    /**
     * The stored property bag with this node's live values written over it.
     *
     * The subtlety is the saveobj envelope. When a class serializes through `saveobj`,
     * MATLAB stores its whole state inside one unnamed `<P Source="saveobj">` and the
     * individual properties are NOT siblings of it — so a node that reads such a property
     * finds nothing, substitutes its own default (VariantVariableNode's
     * `(props.Specification as string) || ''`), and then writes that default back as a
     * sibling. cases.sldd's aVariant grew a `<P Name="Specification" Class="char"/>` next
     * to its envelope for exactly that reason: an empty string MATLAB had never written,
     * standing in for an empty 0x0 double it could not see.
     *
     * So under an envelope an EMPTY override is dropped: it is a default rather than an
     * edit, and the envelope is already the authority on that property.
     *
     * A non-empty override goes to BOTH places, and the reason it is both is defect 46.
     * The sibling used to be the only place it went, on the reasoning that silently
     * discarding a real edit is worse than writing a property MATLAB's loadobj *may*
     * ignore. The live gate settled the "may": MATLAB does ignore it. Editing a
     * VariantVariable's Specification to 'myNewVar' in a binary dictionary produced a file
     * MATLAB reopened with Specification '' — the edit was written, and written somewhere
     * nothing reads. Our own reader agreed with us because it reads the sibling too, which
     * is exactly the shape of failure this tier exists to catch: a value written wrongly
     * and read back with the same wrong assumption looks fine from inside.
     *
     * So the value is now also written INTO the envelope, which is what MATLAB actually
     * loads. The sibling is KEPT rather than replaced, because it is the only copy this
     * package's own reader can see — decoding the envelope back into node properties is
     * the other half of defect 40 and is not done here. Writing both keeps every consumer
     * correct and is strictly additive over the old behaviour.
     */
    _mergeProps(propOverrides: Record<string, unknown>): Record<string, unknown>;
    serializeValue(): unknown;
    /**
     * Make `encoded` — the byte stream this node was decoded from — what the node writes, for
     * as long as nothing changes the value (_markModified drops it; a rename keeps it).
     *
     * Every writer of a value is a method of the node's class: `serializeValue` for a text
     * dictionary, a copy payload and a parent's property bag, `serializeXml` for a binary
     * dictionary. A stream can decode into a node of ANY class — a sparse array is a
     * MatlabVariableNode, a Simulink.Parameter holding one is a ParameterNode, an object of a
     * class this package does not know is an ObjectNode — and every one of those classes
     * has its own pair. So the replay is installed on the instance, in front of whichever
     * pair its class has, rather than added to each class: one place, which a class written
     * tomorrow cannot forget to call. The class's own writer is looked up when it is called,
     * not captured here, so a node whose class changes after it is built (ConstantNode
     * reclasses a derived variable in place) still falls back to the right one.
     *
     * What each one hands back:
     *   - serializeValue: the envelope itself. DataNode.serialize turns it into the MAT
     *     stream a TEXT dictionary carries for the same value (MatWriter.textDictionaryForm),
     *     and a binary one writes it back through the property and cell-element writers'
     *     encoded arms below — so a copy payload is right for whichever dictionary it lands in.
     *   - serializeXml: the element as it was read, attribute for attribute and byte for byte,
     *     under whatever name and tag the caller is writing it at.
     */
    _adoptEncoded(encoded: EncodedValue): void;
    /**
     * The refusal for an edit to a value that is still an encoded byte stream, or null when
     * the edit may go ahead. Every setProperty asks this first, the overrides included.
     *
     * A value read from a stream is written back AS the stream (_adoptEncoded), and nothing
     * in this package can write a new one for all it may hold: MatWriter writes a sparse
     * array's stream, but not a function handle's or an MCOS object's subsystem, and the XML
     * this package can spell for the decoded value is not the value — `Class="sparse"` makes
     * MATLAB's reader crash outright, and a dense matrix is a different variable. So an edit
     * anywhere at or under such a node is refused, and the one edit that leaves the value
     * alone is let through: renaming the node that holds the stream, whose name lives
     * outside it.
     */
    /**
     * The encoded element a compressed-binary dictionary has to hold this ENTRY's value as,
     * when it has no XML spelling and its bytes are at hand — or null, for every value whose
     * own serializeXml is the right answer. Asked by serializeEntryToXml; see the
     * MatlabVariableNode override for the one case there is.
     */
    _binaryEncoded(): EncodedValue | null;
    /**
     * Is this node at or under one whose value is still an encoded stream? The structural
     * gates (canAddChild, canRemoveChild) of every class that has them ask this, for the
     * reason _refuseEncodedEdit gives: a child added or removed there could not reach the file.
     */
    get _encodedReadOnly(): boolean;
    _refuseEncodedEdit(propName: string, stringValue: string): SetPropertyResult | null;
    serializeXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string;
    _serializeSimulinkObjectXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string;
    _getSerializedProperties(): Record<string, unknown>;
    /** Where this node's property `propName` stands, for a writer that writes it from its raw value. */
    _propertyAt(propName: string): PropertyAt;
    /**
     * A raw value read back into a node of its own to write its XML — a MAT stream, this
     * package's sparse literal — which has no parent to say where it is: told `at`, so that a
     * write it refuses names the entry and the path, not the property alone.
     */
    static _detachedXml(value: unknown, name: string, tagName: string, attrs: Record<string, string>, indent: number, at: PropertyAt | undefined): string;
    /**
     * The identifying attributes of a `<P>`.
     *
     * Almost always `Name="x"`. The exception is MATLAB's saveobj envelope, which a class
     * that serializes through `saveobj` uses to carry its whole state: MATLAB writes
     * `<P Source="saveobj" PropertyType="any" Class="struct">` with NO Name at all, and the
     * reader files it under SAVEOBJ_KEY because a property bag needs a key. Written back as
     * `Name="undefined"` — what an absent @_Name used to produce — MATLAB's loadobj finds
     * no envelope and builds an EMPTY object: cases.sldd's aVariant reopened as a
     * Simulink.VariantVariable with 0 choices where MATLAB wrote 2 (defect 28).
     *
     * Every `<P>` in this file goes through here, so the envelope survives whichever arm of
     * serializePropertyXml its payload takes.
     */
    static pxAttrs(name: string): string;
    static serializePropertyXml(name: string, value: unknown, indent: number, ownerNode: DataNode | null, at?: PropertyAt): string;
    /**
     * The `Class="char" Dimension="r*c"` attributes and body of an mxchar literal, or
     * null for anything else — shared by the property and cell-element writers below.
     *
     * mxchar is MATLAB's TEXT-dictionary spelling of a shaped char (character codes, one
     * bracketed group per row); XML wants the plain column-major text under a Dimension
     * (defect 25). Written through the generic typed-value path instead, a char field of
     * a struct went out as `Class="mxchar" Dimension="2*2">97 99 98 100` — a class MATLAB
     * does not have, holding numbers where its characters were.
     */
    static _mxCharXml(value: Record<string, unknown>): {
        dimAttr: string;
        body: string;
    } | null;
    /**
     * MATLAB's spelling of a string value, from the `<Element Class="string">` down: a
     * saveobj CELL of chars, one `<Element Class="char">` per element, carrying the cell's
     * Dimension for every shape but 1x1.
     *
     * Copied from the string entries of the MATLAB-authored dictionaries in
     * test/parity/artifacts/binary — `strScalar` writes an undimensioned cell around one
     * char, `strArray` a `Dimension="1*3"` one around three. Those are dictionary ENTRIES
     * rather than object properties, and the corpus has no MATLAB-authored object holding a
     * string, but BinarySlddParser decodes both through the same parseStringValue, so there
     * is one envelope to write and not two.
     *
     * Shared with MatlabVariableNode._serializeStringXml, which writes the same envelope
     * for an entry, for the same reason _mxCharXml is shared: this is the second and last
     * place that spells it, and two copies of a format are how one of them goes stale.
     */
    static _stringEnvelopeXml(elements: unknown[], dims: number[], indent: number): string;
    static _serializeStringPropertyXml(name: string, elements: unknown[], dims: number[], indent: number): string;
    static _stringXml(tag: string, attrs: string, elements: unknown[], dims: number[], indent: number): string;
    static _serializeTypedPropertyXml(name: string, value: Record<string, unknown>, indent: number, at?: PropertyAt): string;
    /**
     * A typed `Matrix(d1,…,dn)` literal — `{_type: 'int8', _value: 'Matrix(2,2)\n[[1, 2]; [3,
     * 4]]'}` — as the one element MATLAB holds it in, under `tag`: its class, every extent, and
     * the elements in MATLAB's column-major order. Null for any other literal, which the
     * caller's later arms spell. Shared by the property writer and the cell-element writer.
     *
     * Rank 3 and up spells its header Matrix(2,3,2) — MATLAB's own binary dictionary writes
     * such an entry as Dimension="2*3*2" with a flat column-major body, so every extent has to
     * survive the round trip. The two-group form was the only one matched, so an N-D literal
     * fell through to the scalar branch and was written out as the single number 0. The
     * cell-element writer had no arm for the literal at all, so a matrix of any rank in a cell
     * that is an object's property went out as that 0: cellarr_binary.sldd's 2x3x2 cNd, lifted
     * into one, was saved as `<Element Class="double">0.0</Element>`.
     *
     * parseCellElement states an EMPTY numeric element as the bare header, `Matrix(0,3)`: there
     * are no elements to carry the shape any other way. It is written as MATLAB writes an
     * empty, self-closed with its Dimension, where the scalar tail made it `NaN`. A bare header
     * that declares elements is not a literal this reads.
     */
    static _matrixLiteralXml(tag: string, attrs: string, name: string, type: string, raw: string, indent: number, at: PropertyAt | undefined): string | null;
    /**
     * A complex value in its plain-text form — `{_type: 'cdata', _value: '1+2i 5+6i 3+4i
     * 7+8i', _dimensions: [2, 2], _class?}`, what BinarySlddParser reads out of a binary
     * dictionary and McosParser.complexPropertyValue builds for a .mat or a model workspace
     * — as the one XML element a binary dictionary holds it in: its class, `IsComplex="1"`,
     * every extent unless it is a scalar (MATLAB writes none on one), and the body for its
     * class. Shared by the property writer and the cell-element writer.
     *
     * Both used to drop half of that. The property writer wrote `Class="double"
     * IsComplex="1"` and nothing else whatever the value was, so any save that wrote a
     * complex Value it had not edited lost its shape and its class: MATLAB read
     * `[1+2i 3+4i 5+6i]` back as 1+2i, a 2x2 and a 2x2x2 as their first element, and
     * int64(complex(intmax('int64'), 1)) as the double 9.22337203685478e+18+1i — on a
     * no-op save of MATLAB's own file, and on editing any other property of the entry.
     * The cell-element writer wrote `Class="cdata"`, a class MATLAB does not have.
     */
    static _complexTextXml(tag: string, attrs: string, value: Record<string, unknown>, indent: number): string;
    static _serializeObjectPropertyXml(name: string, value: Record<string, unknown>, indent: number, ownerNode: DataNode | null, at?: PropertyAt): string;
    /**
     * An object bag (`{_array_class, _dimensions, _elements: [{_properties}]}`) under `tag`: a
     * property's `<P Name="…">`, or the classless `<Element>` a cell element holding an object
     * is — cellarr_binary.sldd's cObj is `<Element>` around one `<Element
     * Class="Simulink.Parameter">`, its cObjArr `<Element Dimension="1*2">` around two.
     */
    static _objectXml(tag: string, attrs: string, name: string, value: Record<string, unknown>, indent: number, ownerNode: DataNode | null, at: PropertyAt | undefined): string;
    /**
     * Refuses to write a raw property value whose dims no Dimension can spell (parser/Size): a
     * raw cell, struct, object or string bag, an mxchar's or a typed literal's `Matrix(…)`
     * header, a complex text's `_dimensions`. A binary dictionary's reader passes every finite
     * non-negative extent through as read, so one of those is written back as read; what is
     * refused — NaN, an infinity, a negative, a string, an object, a bigint — came from a text
     * dictionary or a host, and `Dimension="1*x"` is no spelling of anything. A header's
     * digits are taken `exact`ly: one past 2^53 would be written rounded, as another size.
     */
    static _sizeOrRefuse(dims: unknown, cls: string, name: string, at: PropertyAt | undefined, exact?: boolean): void;
    /** The extents of a `Matrix(…)` header of digit runs, as numbers, or undefined. */
    static _headerDims(text: string): number[] | undefined;
    /**
     * A refusal of a write that began at this node, restated for a user: the entry — the one
     * above, or, for a node a writer built on its own to write a raw property value
     * (_detachedXml), the one it was built for — and the path to it.
     */
    _budgetFailure(e: MatBudgetError): MatBudgetError;
    /**
     * Refuses to write this node's XML when its dims are not what a Dimension can spell — the
     * same rule as for a raw property value (_sizeOrRefuse) — naming the entry and the path.
     */
    _spellableOrRefuse(dims: unknown, cls: string): void;
    /**
     * `at` one level down: element `k` of `n` — its MATLAB subscript, `(k+1)`, unless it is
     * the only one — then `rest`, a field or a property.
     */
    static _within(at: PropertyAt | undefined, n: number, k: number, rest: string): PropertyAt | undefined;
    static _serializeStructPropertyXml(name: string, value: Record<string, unknown>, indent: number, at?: PropertyAt): string;
    /**
     * A struct bag under `tag`: a property's `<P Name="…" Class="struct">`, or a cell element's
     * `<Element Class="struct">`. MATLAB states a struct in a cell the way it states a struct
     * property, shape and all: cellarr_binary.sldd's cStruct is `<Element Class="struct">` over
     * one `<Element>`, its cStructArr2D `<Element Class="struct" Dimension="2*2">` over four.
     */
    static _structXml(tag: string, attrs: string, name: string, value: Record<string, unknown>, indent: number, at: PropertyAt | undefined): string;
    static _serializeCellPropertyXml(name: string, value: Record<string, unknown>, indent: number, at?: PropertyAt): string;
    /**
     * A cell bag under `tag`: a property's `<P Name="…" Class="cell">`, or a cell element's
     * `<Element Class="cell">`, whose own elements go back through the element writer below, to
     * any depth.
     *
     * A 1x1 cell states no Dimension, at either site, because MATLAB writes none: the corpus's
     * binary dictionaries hold 81 cell properties that are 1x1 and carry no Dimension, and
     * cases.sldd a nested one (cellNest), and no cell MATLAB wrote says `Dimension="1*1"`. Both
     * reading sites take an absent Dimension as 1xN for N elements, so only a cell of exactly
     * one element goes without.
     */
    static _cellXml(tag: string, attrs: string, name: string, value: Record<string, unknown>, indent: number, at: PropertyAt | undefined): string;
    /**
     * One element of a cell held as a raw value — an object's property, a struct field, or a
     * cell inside either — which is what every save of a binary dictionary writes such a cell
     * from, edited or not. It takes every shape BinarySlddParser.parseCellElement reads an
     * element as, and writes each in the spelling MATLAB gives it in a cell.
     *
     * It used to take only the scalars, a flat numeric row, the typed scalars and vectors,
     * complex text and an encoded stream. Everything else MATLAB writes in a cell — a nested
     * cell, a struct, an object, a string, a matrix — was written wrong on a save that touched
     * nothing, measured with every element of the entry-level cells in cellarr_binary.sldd,
     * cellstr_binary.sldd, typed_binary.sldd and cases.sldd lifted into an object's property: a
     * nested cell, a struct or an object as `<Element Class="char">[object Object]</Element>`, a
     * 2x3x2 double as `0.0`, a string as `Class="double" Dimension="1*1">a`. The containers are
     * written by the property writers' own code, under `<Element>` where a property has `<P
     * Name="…">`, so the two sites cannot disagree on a spelling.
     */
    static _serializeCellElementXml(elem: unknown, indent: number, at?: PropertyAt): string;
    /**
     * One number out of a typed literal: '3.14159274F', '18446744073709551615U', '-1'.
     *
     * A 64-bit integer comes back as exact decimal TEXT rather than a number, because
     * every value MATLAB's int64/uint64 range holds past 2^53 is one a double does not
     * (XmlUtils.parseExactNum). This routine is the single re-parse point of the XML write
     * path, and it used to be `parseMatlabNum` at four separate call sites: a uint64 read
     * losslessly by BinarySlddParser was still rounded here, one step before the file, so
     * maxU64 went out as 18446744073709552000U — a token now OUT of uint64 range, at which
     * MATLAB's reader abandons the rest of the body and zeroes the value's remaining
     * elements (defects 29 and 30).
     */
    static _numToken(text: string, type: string): number | string;
    static _parseMatrixNums(body: string, type?: string): (number | string)[];
}
//# sourceMappingURL=DataNode.d.ts.map