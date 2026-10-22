import DataNode from '../DataNode.js';
import type { SetPropertyResult, ValueShape } from '../DataNode.js';
import type { PropClass, MatlabVariableKind } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import type { ChildAddEdit, ChildUndoRedo } from '../childEdit.js';
import PropDescription from '../../prop/PropDescription.js';
import PropKind from '../../prop/PropKind.js';
import type { ParsedValue } from '../../parser/MatlabValueParser.js';
import { type MatVariable } from '../../parser/MatParser.js';
import { type EncodedValue } from '../../parser/EncodedValue.js';
import { MatBudgetError, MatWriteError } from '../../parser/MatWriter.js';
import { type SparseData } from '../../parser/SparseData.js';
export type { MatVariable };
export default class MatlabVariableNode extends DataNode {
    _kind: MatlabVariableKind;
    _scalarValue: unknown;
    _scalarType: string;
    _elements: unknown[];
    _dims: number[];
    _rawBytes: Uint8Array | null;
    _matVar: MatVariable | null;
    _varStale: boolean;
    _isOpaque: boolean;
    _mcosString?: boolean;
    _sparse: SparseData | null;
    _sparseEdited: boolean;
    _undecoded: boolean;
    _opaqueClassName: string | null;
    _mcosProperties: Record<string, unknown> | null;
    _mcosValue: unknown;
    _mcosDimensions: number[] | null;
    _preCollapseDims: number[] | null;
    _cellDimsBefore: WeakMap<BaseNode, number[]> | null;
    _preCollapseType: string | null;
    _collapsedClass: string | null;
    _elementType: string | null;
    _readFromStream?: true;
    _cutByCeiling?: number;
    _emptyStructFields?: string[];
    constructor(name: string, parent: BaseNode | null, serial?: Record<string, unknown>);
    get Value(): unknown;
    set Value(v: unknown);
    get elements(): unknown[];
    /**
     * MATLAB's issparse(): is this a sparse array? One is held as its non-zeros alone
     * (parser/SparseData), shows its summary, `<10x10 sparse double>`, has one element row per
     * non-zero, labelled `name(r,c)` in column-major order, and has no Variable Editor grid:
     * displayElements answers null for it. This is how a host tells one apart, to offer it
     * no grid in the first place.
     */
    get isSparse(): boolean;
    /**
     * Every element of this array as it stands, edits included, row-major: the value the
     * writers and the projections read. Off the child rows where they are the elements —
     * an edit lands in the row first — and off `_elements` otherwise, an array never
     * expanded. Not for a sparse array, whose elements are not held (_sparseFallback says
     * what its writers do instead).
     */
    _liveElements(): unknown[];
    get dims(): number[];
    get arrayType(): string;
    get icon(): string;
    get className(): string;
    _classColumn(): string;
    get dataType(): string;
    get kind(): string;
    get fixesChildNames(): boolean;
    _holdsFields(): boolean;
    _renameField(from: string, to: string): void;
    get nameEditable(): boolean;
    get valueEditable(): boolean;
    get isScalarNumeric(): boolean;
    get displayValue(): string;
    /**
     * This node's Value text as the runaway length guard measures it where it is an element of a
     * cell's literal: its displayValue, but with each control character of a char or a string in
     * it counted as the one character it is (controlsAsOneChar). A summary is itself.
     */
    _guardText(): string;
    /** `asMeasured`: the text the length guard measures (_guardText), not the one shown. */
    _formatScalar(asMeasured?: boolean): string;
    _textDims(text: string): number[];
    _formatArray(): string;
    _formatEmptyArray(): string;
    /** `asMeasured`: the text the length guard measures (_guardText), not the one shown. */
    _formatCell(asMeasured?: boolean): string;
    _cellLiteralElement(child: BaseNode, asMeasured?: boolean): string;
    /**
     * Is this cell's one-line literal its value written out? Not when an element's token in
     * it is a summary — a sparse array's `<1x3 sparse double>` at any size, a large array's
     * `<4x3 double>`, a struct's, an object's — or a nested cell's literal holds one: a
     * summary is not the value, and the literal read back as text makes it char cells.
     *
     * Nor when an element is an object that takes no editor of its own, whatever its token: an
     * enumeration value shows `GearMode.Reverse` (ObjectNode.displayValue), and `{1,
     * GearMode.Reverse}` reads back as a cell holding that char.
     *
     * Nor when an element is a complex number whose imaginary part is 0 (_isZeroImaginaryComplex).
     */
    _literalRoundTrips(): boolean;
    /**
     * Is this a complex scalar whose imaginary part is 0 (or -0), such as a file's complex(1, 0)?
     * It shows `1+0i`, and a cell literal reads that text as the real double MATLAB makes of it
     * (MatlabValueParser's zeroImaginaryAsReal): `{1+0i, 5}` is {1, 5} in MATLAB. So a cell
     * holding one is not its literal: with only the 5 retyped, the literal set back wrote the
     * member nobody changed as a real 1, in both formats. Its elements are edited one at a time.
     */
    _isZeroImaginaryComplex(): boolean;
    /** Does this cell hold such an element (_isZeroImaginaryComplex), itself or in a nested cell? */
    _holdsZeroImaginaryElement(): boolean;
    /** `asMeasured`: the text the length guard measures (_guardText), not the one shown. */
    _formatString(asMeasured?: boolean): string;
    /**
     * Every element's label and displayed value — the two strings an element ROW
     * carries — whether or not this array was expanded into element children.
     *
     * The consuming extension's Variable Editor grid is drawn from these. It used to
     * read them off the child nodes, which tied a read-only panel the user opens
     * deliberately to a decision made for the TABLE: MAX_EXPANDED_ELEMENTS stops a
     * 1000x1000 from becoming a million rows nobody scrolls, and took the grid's data
     * with it. This accessor is the separation. The table's limit stays where it is,
     * and the panel asks for the elements when it is opened — so the cost of a million
     * of them is paid by the gesture that wanted them, and by nothing else.
     *
     * `label` is the subscript form, from the same function BaseNode.displayName calls
     * and with the same order/bracket rules; `value` is the element's displayValue.
     * Where the children DO exist they ARE the answer — not a second derivation of it —
     * so the two paths cannot drift apart. test/displayElements.test.ts pins that
     * agreement rather than either path alone.
     *
     * One exception, and it is the cell literal's: a cell's element is spelled as
     * _cellLiteralElement spells it, an object by its `<mxn Class>` summary, because the grid
     * is part of the cell's own presentation. The element's ROW shows the object; the grid and
     * the one-line literal agree with each other.
     *
     * null for a kind that has no elements (a scalar, a struct, an object): an empty
     * list is a different and also true answer, meaning an array with nothing in it.
     *
     * And null for a sparse array, which offers no grid. Its elements are not held — its
     * non-zeros are, and they are its rows — so a grid of it would be the one place a sparse
     * array is laid out densely: spTall's would be twenty million cells. The grid places a
     * cell by its label and draws nothing for a matrix with a cell unlabelled, so a list of
     * the non-zeros alone would draw nothing either; a host asks `isSparse` and offers no
     * grid.
     */
    displayElements(): Array<{
        label: string;
        value: string;
    }> | null;
    get descriptionEditable(): boolean;
    getProperties(): PropClass[];
    getPILayout(): {
        group: string;
        items: (typeof PropKind | typeof PropDescription)[];
    }[];
    _ofMcosString(): boolean;
    setProperty(propName: string, stringValue: string): true | SetPropertyResult;
    /**
     * For DataModel.editProperty: what puts this value back exactly as it is now, for the
     * undo of an edit of `propName` about to be made — or null, where the text the property
     * shows is what restores it.
     *
     * The session undid a Value edit by setting the Value back to the text it showed
     * (readPropertyValue), and for a value that text is not always the value. Every empty
     * shows `[ ]`, whatever its size and class, and `[ ]` is a 0x0 double: zeros(1,0),
     * zeros(0,2), int8(zeros(0,3)), an enumeration's empty and a 0x0x2 empty all came back as
     * a 0x0 double, which the next save wrote. No text this package reads says any of them
     * (MatlabValueParser has no zeros(...)), and nor does the value's JSON form, in which a
     * rank-2 empty is `[]`. The node's own state does, and it is what a Value edit replaces:
     * _applyParsed assigns every field it changes and changes nothing it found in place. So
     * the undo is that state, held and put back, `_rawInput` with it, so a value undone is
     * written as it was read.
     *
     * Every own field but the node's place (name, parent) and the entry's bookkeeping
     * (status, metadata), which an undo leaves as any other edit does: Modified, and stamped.
     * Not for an element of an array, whose edit also writes into the array
     * (_setConstrainedValue), and whose text is the scalar it holds.
     */
    _restorerFor(propName: string): (() => void) | null;
    /**
     * The node at or above this one that parseCdata read out of a MAT stream, when it is in a
     * text dictionary, or null.
     *
     * The maintainer's ruling on C-012 (2026-10-15): editing is for a value parsed from a
     * dictionary's XML or JSON. A value a text dictionary holds as a MAT stream is shown and not
     * edited. MATLAB keeps a stream there only for a value its JSON cannot spell: every rank >= 3
     * value, every complex one and a sparse array. Edited, such a value has to be
     * written as a new stream, and MatWriter cannot write every value one can hold: an N-D cell
     * element typed as "str" was refused ("no MAT class for string"), and `["a" "b"]` went out as
     * the char 'ab'. Unedited, it is written as the stream it was read from.
     *
     * So at and under such a node the value takes no editor (valueEditable), the setter refuses
     * it (_refuseStreamEdit, and ParameterNode for a Parameter's Value), and no row is added or
     * removed (canAddChild, canRemoveChild). The name of the node holding the stream is outside
     * it, so the node can still be renamed, and its entry deleted. Every node under it is a
     * MatlabVariableNode: a stream holding an MCOS object is built otherwise
     * (_parseCdataObjects) and is read-only by DataNode._adoptEncoded.
     *
     * Only in a text dictionary, which is what the ruling is about. The MCOS decoder hands over
     * a sparse value of a .mat or a model workspace as the same stream (McosParser), and nothing
     * edits those files; a binary dictionary keeps its own MAT streams as hex, read-only already.
     * So a stream pasted into a binary dictionary is as editable there as it was.
     */
    _streamHolder(): MatlabVariableNode | null;
    /** The refusal of a Value edit at or under a value read from a MAT stream, or null (_streamHolder). */
    _refuseStreamEdit(stringValue: string): SetPropertyResult | null;
    /**
     * The refusal of `parsed`, typed in as this node's value, by a source that could not write
     * what it makes of it, or null. A MAT-file's save writes no string, and writes a variable
     * holding one only as it was read (MatNode._valueRefusal, MatFileWriter.freshRefusal), so a
     * `"abc"` typed in, or a `{1, "abc"}`, would make a variable no save could write: it is refused
     * here, before the edit, which a source that writes it (a dictionary) never asks.
     *
     * Judged of a node made of the text alone (_applyParsed, as the edit applies it), so that a
     * refused edit leaves this one, its entry and its file as they were.
     *
     * A dictionary value that is a MAT stream holding objects is asked first (BaseNode
     * streamValueRefusal): its save writes a Simulink.Parameter's Value into the object's cell, and
     * judges a Value typed in as a MAT-file does.
     */
    _refuseUnwritableValue(parsed: ParsedValue, stringValue: string): SetPropertyResult | null;
    /**
     * The refusal of a Value edit by the value this one is part of, or null. Asked of the nearest
     * node above this one that is not a struct, so that a field of a struct, at any depth and in
     * any element of a struct array, is answered by what holds the outermost struct: for a
     * Parameter's struct Value, the Parameter (ParameterNode._refuseValueBelow). The Value row of a
     * Parameter asks it too, being its Value: typed there, a cell the Parameter's own Value cell
     * refused was taken.
     *
     * Asked only of a node that answers, as ParameterNode asks its value node about a stream
     * (_refuseStreamValue): a Parameter is the one class with rules here, and naming it would
     * import it into the class it holds.
     */
    _valueHolderRefusal(parsed: ParsedValue, stringValue: string): SetPropertyResult | null;
    /**
     * Would the edit leave this field unlike its twin in another element of a struct array, at or
     * below `root`? The twin is the node at the same path under the other element, and "unlike" is
     * MATLAB's rule for a Simulink.Parameter's array of structures (probe_parameter_value.m): a
     * field has to agree across the elements in class, in complexity and in size, except that a
     * char field may differ in length (`struct('a', {'x', 'yz'})` is accepted). A struct array
     * nested in a field is held to it too, at every level the path crosses.
     *
     * The class after the edit is the one _applyParsed gives (classAfterEdit), so a number typed
     * into an int8 field is an int8, as the field then is.
     */
    _differsFromTwinsAfter(parsed: ParsedValue, root: BaseNode): boolean;
    /**
     * The class of a complex value is its own (_complexClass), not the 'double' its className
     * reports for a complex scalar (DataNode._valueShape).
     */
    _valueShape(): ValueShape;
    /**
     * The shape Add or a removal would leave (DataNode._shapeAfterChildEdit): a struct one field
     * more (_addStructField); an untyped `[]` a struct of one field (_convertToStructAndAddField);
     * an array or a string array one element more or fewer, shaped as _updateDimsForCount shapes
     * it, or as the collapse to one element does. Not a cell's: a Parameter refuses a cell Value
     * whole, and does not judge what is in one, a value edit there included.
     */
    _shapeAfterChildEdit(op: 'add' | 'remove'): ValueShape | null;
    /** Class, complexity and size of this value once `parsed` is applied, as _applyParsed applies it. */
    _shapeAfter(parsed: ParsedValue): ValueShape;
    _isConstrainedChild(): boolean;
    _setConstrainedValue(stringValue: string): true | SetPropertyResult;
    _markModified(edit?: 'value' | 'name'): void;
    _syncElementFromChild(child: BaseNode): void;
    _applyParsed(parsed: {
        type: string;
        value: unknown;
        dims?: number[];
    }): void;
    _buildMatrixString(dims: number[], elements: (number | string)[], type?: string): string;
    _buildArrayChildren(elementType?: string): void;
    private _buildSparseChildren;
    private _makeStringElement;
    _buildStringChildren(): void;
    _buildCellChildren(elements: unknown[], unread?: ReadonlyMap<number, MatVariable | null>): void;
    canAddChild(): boolean;
    addChildNode(): BaseNode | null;
    private _becomeStruct;
    _convertToStructAndAddField(): MatlabVariableNode;
    _addStructField(): MatlabVariableNode;
    _addArrayChild(): MatlabVariableNode;
    _addCellChild(): MatlabVariableNode;
    _addStringChild(): MatlabVariableNode;
    canRemoveChild(): boolean;
    removeChildNode(child: BaseNode): void;
    _updateArrayAfterRemove(): void;
    _updateCellAfterRemove(): void;
    _updateStringAfterRemove(): void;
    restoreChildNode(child: BaseNode, index: number): void;
    execAddChild(): ChildAddEdit | null;
    private _addFirstStructField;
    execRemoveChild(child?: BaseNode): ChildUndoRedo | null;
    private _updateDimsForCount;
    private _syncArraySerial;
    _reindexChildren(): void;
    _reindexPositional(): void;
    serializeValue(): unknown;
    /**
     * Is this a complex value? The two tests are the two shapes complexity arrives
     * in: a complex SCALAR carries `_scalarType === 'complex'`, while a complex ARRAY
     * is a plain `double` whose per-element values are the literal text `'1+2i'` —
     * the element nodes are the complex ones, not the parent. `_buildVarObject` has
     * always had to make the same distinction to set `isComplex`, and it asks here so
     * the projection and the serialization cannot disagree about what is complex; a
     * disagreement would mean writing a cdata stream built from a non-complex `_var`.
     *
     * A sparse array is the third shape, and says so itself: its non-zeros carry their
     * imaginary parts or none (SparseData.im). Its complexity used to ride on the text of
     * its zeros, `0+0i`, which kept it complex after every non-zero was set to a real
     * number; it has no zeros to hold now.
     */
    _isComplexValue(): boolean;
    /**
     * The MATLAB class of a complex value: what its writers spell, where the node's own
     * type says nothing about it. An ARRAY carries it as its `_scalarType` (int16, single,
     * …), as every reader sets it. A SCALAR's type is 'complex', which has no class, so the
     * class is read off what the value was read from, while that is still the value: the
     * variable a .mat or a text dictionary's stream gave (`_matVar`), or the envelope a
     * binary dictionary or the MCOS decoder gave (`_rawInput`). Or, first, off the complex
     * array a removal cut it down from (`_collapsedClass`, the F2-5 ruling): the removal
     * clears `_rawInput` (_markModified), and an int16 vector with one element left is
     * still an int16. A value edit clears all three (_applyParsed), and an edited complex
     * scalar is a double, as the literal typed for it is in MATLAB. Not `_var`: a rename
     * marks the snapshot stale without changing the value, and the rebuilt variable is
     * where this class is needed, not where it is read.
     */
    _complexClass(): string;
    _serializeCdata(refuse?: boolean): unknown | null;
    /**
     * The MAT stream this value is — `getByteStreamFromArray(value)` — or null when this
     * package cannot make it. In order:
     *   - the stream it was read from, while that is still the value (a text dictionary's
     *     cdata, untouched or only renamed);
     *   - for a value the reader recorded without decoding (`_undecoded`), the element it was
     *     read from, re-framed as a stream (MatWriter.matStreamOfElement) — nothing else holds
     *     its values. A copy or a save of such a value itself never asks: it is refused
     *     (serializeValue, _undecodedRefusal);
     *   - for a sparse array no element row has edited, the element it was read from, the same
     *     way: its own bytes, which for every array MATLAB wrote are the bytes MatWriter would
     *     write, and for one MatWriter refuses — a dims word damaged, a class MATLAB never
     *     stores sparse — the only ones there are. So copying one, at any size, never
     *     re-encodes it;
     *   - otherwise what MatWriter writes for the live value, which is MATLAB's own bytes for
     *     a sparse array, written from its non-zeros (MatWriter.encodeSparse); null for what
     *     MatWriter has no spelling for, or writes as what it is not (_matWritable: a string
     *     read from a file, as its char), which a caller writes its own way.
     *
     * Except past the unbacked-bytes budget: that refusal is final, and it is thrown, restated
     * with the entry and the path (_budgetFailure), so the copy or the save asking fails and
     * nothing else is written in the value's place. And, when `refuse` is set — a value a text
     * dictionary can hold only as its stream (serializeValue) — any other refusal of
     * MatWriter's, restated the same way (_streamRefusal).
     */
    _matStream(refuse?: boolean): Uint8Array | null;
    /**
     * MatWriter's refusal `e` of this value's stream, restated for a user as a budget refusal is
     * (_budgetFailure): the entry, the path and what stands there, and MatWriter's reason.
     */
    _streamRefusal(e: MatWriteError): MatWriteError;
    /**
     * MatWriter's refusal of the MAT stream this value, or one under it, would be written as in the
     * text dictionary it is in, or null (DataNode._unwritableStream). Asked of a value handed in to
     * a text dictionary, whose paste is refused with it (the maintainer's ruling A1, 2026-10-15
     * evening).
     *
     * A text dictionary holds a rank >= 3 value only as its MAT stream. A pasted value is written
     * as it came until an edit (`_rawInput`), and only an edited one asks MatWriter (serializeValue,
     * _matStream), so one MatWriter cannot write went in as the bag it came as, with rank >= 3 dims:
     * a binary dictionary's 2x2x2 cell holding a string, unedited, or edited there before the copy.
     * This asks MatWriter what the save of it, edited, asks, and words the refusal as that save
     * does (_streamRefusal).
     *
     * A string read from a dictionary's JSON or XML (a bag's `["str"]`) is handed to MatWriter as a
     * char (_buildVarObject), so the stream it writes for one holds a char, which is not the value;
     * for that reason the binary writer does not ask it about one (_matWritable). MatWriter has no
     * MAT class for a string, and the save refuses a string scalar typed into such a cell so. A
     * string at or under the value is refused the same way (classRefusal).
     *
     * Not a refusal for the unbacked-bytes budget: the value is held as it came, and the copy or
     * the save that writes it as its stream refuses it, as before (SectionNode.parseEntry). And only
     * of a cell, a struct or a string, which a bag carries in as it came: an N-D numeric or logical
     * literal is turned into its stream on the way in (MatWriter.textDictionaryForm), and one it
     * cannot turn, whose element count is not its size, is held as it came, as before.
     */
    _unwritableStream(): MatWriteError | null;
    /**
     * Is there a MATLAB string at or under this cell or struct? A string array and its elements
     * alike say 'string' (_matWritable). None was read out of a MAT stream, which holds a string as
     * an MCOS object (_isOpaque): each is a dictionary's own, read from its JSON or XML.
     */
    _holdsString(): boolean;
    /**
     * Is this a struct array past MAX_EXPANDED_ELEMENTS whose elements hold no field — one with
     * no fields, which _createFromMatStruct builds no element rows for? Its value is its size
     * alone, and no struct value listing its elements one by one can be made of the 1e8 that a
     * 208-byte file declares, so it is written as its MAT stream wherever it goes: a text
     * dictionary and a copy take the stream (serializeValue), a binary dictionary its hex
     * (serializeXml, _hexValue), as a sparse array does. Not a value the reader recorded without
     * decoding, which is written as it was before.
     */
    _unexpandedStruct(): boolean;
    /** A budget refusal of a write that began at this node, restated for a user. */
    /**
     * Why MatWriter could not write this sparse array once an element of it were edited — its
     * file declares more columns than its column index held, or its class is one MATLAB never
     * stores sparse — or null when it could, and for anything not sparse. Such an array is
     * written as the bytes it was read from, so its rows take no edit (valueEditable,
     * _setConstrainedValue): one would never reach the file.
     */
    _sparseRefusal(): string | null;
    /**
     * A sparse array's every element, row-major, as a full array's are held — for the writers'
     * fallbacks alone (_serializeArray, _serializeArrayXml), which spell a value as a literal
     * when it has no stream: a sparse array MatWriter will not write, of a class or a rank
     * MATLAB never stores sparse, which only a damaged file holds — never one refused for the
     * budget, which is final (_matStream). Null past SparseData.MAX_DENSE_ELEMENTS, where there
     * is nothing to spell the elements with. Never the value itself, which is the non-zeros.
     *
     * Every element it does not hold is a zero no data backs, so they come out of the write's
     * budget (MatWriter.spendUnbacked), at eight bytes apiece, what each costs in the list, and
     * past it the write fails as any refused for the budget does (_budgetFailure): a cell of
     * int8 sparse arrays a host built, none of which MatWriter can write sparse, was a million
     * zeros apiece.
     */
    _sparseFallback(): (number | string)[] | null;
    _serializeScalar(): unknown;
    /**
     * The JSON form of an array holding no element: `[]`, a double 0x0, but for the 0x0 of an
     * integer or single class, which is that class's `[]` literal, `{"_type": "int8", "_value":
     * "[]"}`, as MATLAB writes one in a text dictionary. Both readers take that for the 0x0 of its
     * class (parseTypedVector), and the property and cell writers spell it `Class="int8"
     * Dimension="0*0"/>`, as _serializeArrayXml spells the same node at an entry.
     *
     * An edit to `[]` keeps such a class (classAfterEdit), so the node shows it, and an entry of a
     * binary dictionary, written from the node, was saved with it. Everything else is written from
     * this form, and it was `[]` for every class: an int8 or int16 property edited to `[]`, in a
     * binary dictionary, and an entry or a property in a text one, showed its class and was saved,
     * and reopened, as a double.
     *
     * Only the classes classAfterEdit keeps, and only the 0x0, which is all `[]` makes, in MATLAB's
     * own spelling of one (a binary dictionary's shaped empty is spelled by MatWriter.heldTextSpelling).
     */
    _serializeEmpty(): unknown;
    _serializeArray(): unknown;
    _serializeStructValue(): unknown;
    _serializeCell(): unknown;
    _serializeString(): unknown;
    serializeXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string;
    _serializeScalarXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string;
    _serializeArrayXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string;
    _serializeCellXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string;
    _serializeStringXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string;
    get _var(): MatVariable;
    /**
     * For a sparse array read out of a MAT stream — a text dictionary's cdata, a binary one's
     * hex — the element in it, as one read out of a file keeps it (MatParser's `_rawBytes`):
     * while nothing edits the array it is what it is written as, alone (_matStream) and as a
     * member of a cell or a struct written whole (MatWriter.memberElement). Without it, a cell
     * of 80,000 of them pasted into a binary dictionary re-encoded each one from its non-zeros.
     */
    _keepStreamElement(stream: Uint8Array): void;
    /**
     * Refuses a variable with no own bytes whose dims are no size — a host's bigints, which
     * show as not decoded (parseMatVariable) — as every writer must: finally, naming it, and
     * never as the text of its placeholder.
     */
    _refuseNoSize(): void;
    /**
     * The refusal of a write of a value the reader recorded without decoding (`_undecoded`) that
     * has no form of its own to be written as: one out of a .mat or a model workspace, a member of
     * a stream, a text dictionary's own pasted into a binary one. Nothing this package holds is
     * its value. Written as the text of its placeholder, `<2x3 double, not decoded>`, it was
     * another value: a char in a text or a binary dictionary, a double 0 as XML, and a struct
     * whose field names lie past its end a valid struct of no elements. The maintainer's group F
     * ruling of 2026-10-18 (F1-10) refuses it rather than write it wrong: final, as a budget
     * refusal is, so nothing is written in its place, and named the same way (_budgetFailure),
     * with why it was not decoded — the reader's reason (MatVariable.undecoded), or what its
     * warning says of a value with no data or of a class the reader does not model.
     */
    _undecodedRefusal(): MatBudgetError;
    /**
     * Is this a struct array with fields or a cell, read from a MAT stream, that declares elements
     * and whose bytes hold none of them — the reader's `"v" declares 3 cell(s) and only 0 could be
     * read`? One holding SOME of them is written at its declared size beside those it holds, and
     * MATLAB R2027a reads that back with the rest `[]`, its field names kept, in a text and a binary
     * dictionary (short_array_copy_readback.truth.json, B-26). One holding none has no such form: a
     * struct array's bag names its fields from its element rows, so it named none, and MATLAB read a
     * 1x3 struct with no fields; a cell's XML was `Dimension="0*0"`, a 0x0 cell. The maintainer's
     * group F ruling (theme 1: a save the writer cannot spell is refused rather than written wrong)
     * refuses it, as a value the reader did not decode is (_undecodedRefusal). Its MAT stream, which
     * MatWriter writes padded (an N-D one's copy, measured too), is not refused. Nor is a container
     * the node ceiling built without its rows (_cutByCeiling), which is written from a twin with
     * them, nor a struct with no fields, which holds every element it declares.
     */
    _heldNone(): boolean;
    /** The refusal of a struct array or a cell none of whose elements could be read (_heldNone). */
    _heldNoneRefusal(): MatBudgetError;
    /**
     * The variable a member of a cell or a struct is written from. A member of another class
     * — a struct a text dictionary read as a StructNode, a Simulink object — has none here: it
     * stands in as one MatWriter refuses (`_unwritable`), with the dims it declares, so that a
     * container written whole as one stream is refused rather than writing it as a hole, `[]`,
     * and a member whose dims are not a size is refused as that, finally, naming it.
     */
    static _memberVar(node: BaseNode): MatVariable;
    /**
     * What a MAT-file's save writes for `node`, a member of a cell or a struct it writes fresh, when
     * the member is an MCOS object: the class-17 element the object was read as, which names the same
     * objects of the file's subsystem, and the variable read of it; or why the object cannot be
     * written so, as a clause naming it; or null for a member that is no object of the file's.
     *
     * An object's node is placed (mcosPlace) where it was built of its variable: a typed object's
     * node, the element rows of an object array's node (each its element of the one variable), and
     * an opaque one's node (a `string`, an object of a class with no typed node), which holds its
     * variable itself. Which element of it a save passes through, and which it refuses, is
     * MatFileWriter.objectElementOf's to say.
     */
    static _objectMemberOf(node: BaseNode): {
        variable: MatVariable;
        element: Uint8Array;
    } | {
        why: string;
    } | null;
    /** _objectMemberOf of `member`, a member of this cell or struct (for MatFileWriter, which imports no node class). */
    _objectMember(member: BaseNode): {
        variable: MatVariable;
        element: Uint8Array;
    } | {
        why: string;
    } | null;
    _buildVarObject(): MatVariable;
    static parseMatVariable(variable: MatVariable, name: string, parent: BaseNode | null): DataNode;
    static _createOpaque(variable: MatVariable, name: string, parent: BaseNode | null): MatlabVariableNode;
    static _createFromMatHandle(variable: MatVariable, text: string | null, name: string, parent: BaseNode | null): MatlabVariableNode;
    static _createUndecoded(variable: MatVariable, name: string, parent: BaseNode | null): MatlabVariableNode;
    /**
     * A slot of a cell under an MCOS object that the decoder could not read (McosParser.unreadCellSlots),
     * as not decoded: no editor, no value, and a copy refused (_undecodedRefusal). It was the double 0,
     * editable, built from the `undefined` the decoder left in the slot. `variable` is what MatParser
     * read there: one it recorded without decoding is the row it is at the top of a .mat, its
     * placeholder (_createUndecoded); any other, of a class no arm spells or holding no data, is its
     * class and size (createNotDecoded). Null is an element that is not a matrix, of no class or size
     * the bytes say: `<unknown, not decoded>`, as a value whose dims are no numbers is spelled without
     * them (parseMatVariable). At the top of a .mat that slot is a hole, `[ ]`, a value it never held.
     */
    static _createUnreadSlot(variable: MatVariable | null, name: string, parent: BaseNode | null): MatlabVariableNode;
    static createNotDecoded(variable: MatVariable, name: string, parent: BaseNode | null, cls?: string): MatlabVariableNode;
    static createFromMcosDecoded(variable: MatVariable, decoded: {
        value: unknown;
        properties: Record<string, unknown>;
        dimensions: number[];
        stringElements?: (string | null)[] | null;
    }, parent: BaseNode | null, name?: string): MatlabVariableNode;
    private _adoptStringPayload;
    static _createFromMatNumeric(variable: MatVariable, name: string, parent: BaseNode | null): MatlabVariableNode;
    static _createFromMatChar(variable: MatVariable, name: string, parent: BaseNode | null): MatlabVariableNode;
    static _createFromMatStruct(variable: MatVariable, name: string, parent: BaseNode | null): MatlabVariableNode;
    static _createFromMatCell(variable: MatVariable, name: string, parent: BaseNode | null): MatlabVariableNode;
    /**
     * `ask` of this container as it is with its rows, for one the node ceiling built without them
     * (_cutByCeiling): rebuilt from the variable it was read from, with no ceiling, or, `shallow`,
     * with its own rows and none under them, which is all its literal needs (_formatCell). It
     * stands in this node's place under its parent while it answers, so that what it says of
     * where it is (matlabPath, a refusal naming it) is said of this node, and it is dropped after.
     * One whose rows could not be built, which the ceiling kept from failing in the file, is the
     * not-decoded value the file shows in its place uncut (MatNode.fromParsed), refused as one.
     */
    _withCeilingTwin<T>(shallow: boolean, ask: (twin: MatlabVariableNode) => T): T;
    static get defaultName(): string;
    static createDefault(name: string, parent: BaseNode | null): MatlabVariableNode;
    static _createScalar(value: unknown, type: string, name: string, parent: BaseNode | null): MatlabVariableNode;
    static parse(rawVal: unknown, name: string, parent: BaseNode | null): MatlabVariableNode;
    static parseScalar(rawVal: unknown, name: string, parent: BaseNode | null): MatlabVariableNode;
    /**
     * Does this scalar hold, untouched, the JSON object of no shape MATLAB writes that it was read
     * as (parseScalar's last arm)? `{"foo": 1}`, `{}`, or a class marker left with no class,
     * `{"_array_class": null, ...}`, which only a hand edit leaves in a text dictionary (see
     * unshapedValue). It is shown as the JSON it holds (_formatScalar), written back to a text
     * dictionary as read (serializeValue replays `_rawInput`), and refused by the XML writers
     * (serializeXml), where it was the text `[object Object]` in a double's spelling.
     */
    _unshapedObject(): boolean;
    /**
     * struct([]) out of a text dictionary. Deliberately the same node
     * `_createFromMatStruct` builds for the same value — scalar kind, 'struct' class,
     * a null scalar value and the real extents — so `<0x0 struct>` is what all four
     * channels show and `displayValue`'s struct arm needs no empty case of its own.
     */
    static parseEmptyStruct(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): MatlabVariableNode;
    /**
     * A function handle: `{_type: 'function_handle', _value: 'sin'}` — a text dictionary's
     * spelling of one, and the MCOS decoder's for a handle stored as an object's property
     * (McosParser.functionHandleText). Shown as MATLAB shows it, `@sin`, and read-only: the
     * only writer that spells one is this node replaying the literal it was read from.
     */
    static parseFunctionHandle(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): MatlabVariableNode;
    static parseTypedScalar(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): MatlabVariableNode;
    /**
     * A value a binary dictionary stored as an encoded byte stream (parser/EncodedValue),
     * decoded into the node the same value gets everywhere else.
     *
     * The bytes are `getByteStreamFromArray(value)`: the same MAT stream a text dictionary
     * carries as cdata (parseCdata) and a model workspace as its .mxarray part, so they go
     * through the reader those use — MatParser.decodeMatStream for the framing and the
     * array, and, for an MCOS object, the stream's own trailing subsystem element decoded
     * exactly as ModelNode decodes a workspace's (attachMcosDecoded, reached through the
     * registry). parseMatVariable then builds what it builds for that variable anywhere: a
     * sparse array is a numeric array, a struct a struct, a Simulink.Parameter the
     * ParameterNode a text dictionary's twin of it is.
     *
     * Whatever node comes back writes the stream back as it was read, for as long as nothing
     * changes the value (DataNode._adoptEncoded), and everything at or under it is read-only
     * (DataNode._refuseEncodedEdit): nothing in this package writes a new one for every value
     * a stream can hold. But for an allow-listed property of a Simulink.Parameter or a
     * Simulink.Signal in it, where the stream is an entry's whole value, which is where MATLAB
     * writes one: the stream is the gate of every edit inside it, and the save writes it again
     * with only that property's cell of its subsystem swapped (mcosStreamEdit).
     *
     * A stream that does not read — not hex, not a MAT stream, shorter than it says, or an
     * array class MatParser does not model — is the placeholder below, never a number. An
     * MCOS object whose subsystem does not decode is the opaque `<1x1 CLASS>` it is
     * everywhere else.
     *
     * And one that reads but does not DECODE — whose bytes are framed right and say
     * something the readers or the node builders below cannot make sense of — is the same
     * placeholder: the stream is one entry's value, and a throw out of here failed the open
     * of the whole dictionary, every other entry with it, where 1.36.1 opened it (it read
     * the hex as a number) and a text dictionary's cdata reader catches the same throw. The
     * failure is recorded for the dictionary's warnings (EncodedValue.recordDecodeFailure,
     * which SlddNode.parse collects per entry), and the bytes are written back unchanged.
     */
    static parseEncoded(encoded: EncodedValue, name: string, parent: BaseNode | null): DataNode;
    /**
     * An encoded value whose bytes say nothing this reader can show: one row, `<CLASS, not
     * decoded>` — `<RxC CLASS, not decoded>` when the stream got as far as its size — and no
     * children. The class is the one the element names, which is MATLAB's `class(value)`.
     * Angle-bracketed like every summary (MatParser's `undecodedValue` is the same
     * spelling), so it is styled as one and offered no editor; it would be refused one anyway
     * (_refuseEncodedEdit). What it must never be is a number read out of the text, which is
     * what every hex value used to show.
     */
    static _createEncodedPlaceholder(encoded: EncodedValue, name: string, parent: BaseNode | null, dims: number[] | null): MatlabVariableNode;
    /**
     * A text dictionary's MAT stream that a binary dictionary can only hold as hex, as the
     * hex MATLAB writes for it — or null.
     *
     * MATLAB writes a binary dictionary entry as `Encoding="hex"` exactly when its value holds
     * a sparse array or a function handle anywhere inside it (make_sparse_fixtures.m grades
     * that on every entry), and an MCOS object rides in the same stream with its subsystem.
     * Such a value in a TEXT dictionary is a cdata stream of the very same bytes (character
     * for character: the fixture's text twin of spDiag is uuencode of the binary's hex), so
     * an untouched one pasted from text into binary goes in as those bytes, under MATLAB's
     * own `Class` — class(value) — and layout. Rebuilt as XML instead it would be the full
     * array, a different variable; and the XML spelling it had before this, `Class="sparse"`,
     * made MATLAB's reader segfault (measured).
     *
     * That is while the stream is still the value — untouched, or only renamed (DataNode
     * keeps `_rawInput` across a rename and drops it for every other edit). Once anything
     * else has changed it, or for a value that never was a stream (a cell bag, a variable
     * out of a .mat), the stream is the one MatWriter writes for the live value: MATLAB's
     * own bytes for a sparse array (MatWriter.encodeSparse) and for the cell around one.
     * Without that, an element edit or a rename of a pasted sparse array wrote it full, and
     * one too large to decode wrote the text of its placeholder. A value MatWriter cannot
     * write — an MCOS object, a function handle — has no hex this package can make, and
     * takes its XML as before.
     */
    _binaryEncoded(): EncodedValue | null;
    /**
     * This value as a binary dictionary's hex element at `indent`, when it can only be one
     * and this package can make it — see _binaryEncoded for the entry, serializeXml for one
     * further down — or null.
     */
    _hexValue(indent: number): EncodedValue | null;
    /**
     * Is there a sparse array at or under this node? Asked of the nodes rather than of
     * `_var`, so that a save does not rebuild every entry's variable to find out: only a
     * cell and a struct hold values of their own, and an array's children are its elements.
     */
    _holdsSparse(): boolean;
    /**
     * Can MatWriter write this value as the value it is? Not an MCOS object (it refuses
     * one), and not a value whose rebuilt variable (_var) is not the value: a string, which
     * it writes as a char; a function handle; a reader's placeholder for a value it did not
     * decode; and, inside a cell or a struct, any node of another class — a Simulink object,
     * a struct read from a dictionary — which has no `_var` at all and went out as a 0x0
     * double.
     */
    _matWritable(): boolean;
    /** Is there a value still in an encoded stream of its own under this cell or struct? */
    _holdsEncoded(): boolean;
    /**
     * An object whose class nothing in the file names: `<1x1 object>`, the summary of an
     * object of no known class, with the object glyph and no editor. Its bag is replayed
     * untouched, as every value read from a file is.
     */
    static createUnnamedObject(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): MatlabVariableNode;
    static parseCdata(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): DataNode;
    /**
     * A text dictionary's MAT stream that does not decode (`reason`), shown as the char of its
     * six-bit text and written back as it was read, by replaying `_rawInput`.
     *
     * It is still a MAT stream, so it is display-only, as every value read from one is
     * (_readFromStream, the C-012 ruling) but an allow-listed property of an object a stream that
     * decodes holds (mcosStreamEdit), of which this has none: an edit would have saved what was
     * typed in place of the stream. And it says so, for the dictionary's warnings, as a binary dictionary's hex of
     * the same bytes does (EncodedValue.recordDecodeFailure, which SlddNode.parse collects for
     * the entry). It used to be shown with no warning, and it took edits.
     */
    static _createUndecodableCdata(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null, reason: string): MatlabVariableNode;
    /**
     * A text dictionary's MAT stream holding an MCOS object anywhere in it, decoded with the
     * stream's own subsystem, as a binary dictionary's hex of the same bytes is (parseEncoded)
     * — or null, when building it so fails and the variable is built without the decode.
     *
     * MATLAB's own text dictionary writes a Simulink object natively and keeps cdata for a
     * value its JSON cannot spell, but this package writes a hex entry it pastes into one as the
     * cdata of the same stream (MatWriter.textDictionaryForm), which MATLAB reads back as the
     * object: a Simulink.Parameter whose Value is sparse, an alias type with a function-handle
     * property, a struct or a cell of objects. Read without the subsystem, as it was, the
     * stream's object was the opaque `<1x1 Simulink.Parameter>`: no Value, no properties, and
     * as a plain variable it took a Value edit that wrote a number over the whole object.
     *
     * Like the hex, it is read-only but for its objects' allow-listed properties, and written
     * back as it was read for as long as nothing changes it (DataNode._adoptEncoded), and with
     * only their cells of its subsystem swapped after (mcosStreamEdit). A text dictionary and a
     * copy are handed the cdata itself, character for character; the envelope the adoption keeps
     * is the hex a binary dictionary holds for the same bytes, under MATLAB's Class, which is
     * what one this is pasted into writes, as it wrote it for the opaque node before.
     */
    static _parseCdataObjects(rawVal: Record<string, unknown>, bytes: Uint8Array, variable: MatVariable, trailingElements: Uint8Array[], name: string, parent: BaseNode | null): DataNode | null;
    /**
     * A binary dictionary's complex empty: MATLAB writes `complex(zeros(1,0))` as
     * `<P Name="Value" Class="double" IsComplex="1" Dimension="1*0"/>`, and an int16 or single
     * one with its own Class, and BinarySlddParser.complexCdata hands it over as a cdata
     * envelope with no text and a shape that holds no element. The test above admits no text,
     * and _isComplexText none with no element in it, so it went to parseCdata's char arm and
     * showed `''`, class char (C-040). It is the empty of its class, shown `[ ]` as MATLAB's
     * Workspace browser shows every numeric empty.
     */
    static _isComplexEmpty(rawVal: Record<string, unknown>): boolean;
    static _parseComplexEmpty(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): MatlabVariableNode;
    /**
     * Complex text with an Inf or NaN part, which the test above does not admit: every
     * element is one XmlUtils.parseComplexNum reads. A binary dictionary's own text, in the
     * spellings MATLAB writes there — `Inf`, `-Inf` and `NaN` for a part, an imaginary NaN
     * unsigned (complex_binary.sldd's pNonFinite is `Inf-Infi NaN+1.0i 1.0NaNi -Inf+2.0i`) or
     * signed, as this package writes it (`1.0+NaNi`) — and the MCOS decoder's, which spells
     * such a part with formatComplexNum and marks the envelope `_nonFinite`.
     *
     * Only the decoder's marked text was admitted. A binary dictionary's went to the quoted
     * char below, so MATLAB's own pNonFinite and pMixedNF, [1+2i NaN 3-4i], showed as one
     * char, class char, with no element rows, and since #82 typing `1+Infi` into an element
     * of a binary dictionary's complex array, then saving, reopened the whole array as the
     * text `'1.0+Infi 2.5-3.5i'`. The value read is the one MATLAB wrote, which a text
     * dictionary's twin holds as its stream. MATLAB's own reader (R2027a) takes `1.0NaNi
     * -Inf+2.0i` back as two REAL elements, 1 and NaN (complex_binary_sldd.truth.json),
     * which is why this package's writer signs the NaN (XmlUtils.formatComplexBodyXml).
     *
     * A MAT stream is never taken for this: its six-bit characters have no lowercase
     * letter, and an element ends in `i`. So its first token fails and the text is read no
     * further, which matters because every stream a text dictionary holds comes through here:
     * split into its tokens first, as the test did for the decoder's marked text only, one of
     * hundreds of megabytes would cost what the stream does. What a save writes does not
     * change, because complex text nobody edited is written back from the text it was read
     * from (serializeXml).
     */
    static _isComplexText(rawVal: Record<string, unknown>): boolean;
    static _parseCdataText(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): MatlabVariableNode;
    static parseTypedVector(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): MatlabVariableNode;
    /**
     * MATLAB's `mxchar` literal: a char array of rank >= 2, spelled as character CODES
     * under a `Matrix(r,c)` header with one bracketed group per ROW.
     *
     * It becomes the same node a .mat or a binary dictionary produces for the same value
     * — one char-KIND scalar holding the whole text in MATLAB's column-major storage
     * order, with the real extents on _dims. So `['ab'; 'cd']` reads identically out of
     * all three channels, and the writers (_serializeScalar, _serializeScalarXml,
     * _buildVarObject) each spell it their own way from that single representation.
     *
     * Read as a numeric array instead — which is what the Matrix() dispatch did before
     * this arm existed — the value came back as a 2x2 of 97/98/99/100 with dataType
     * 'mxchar', displayed `[97 98; 99 100]`, and had no char anything about it.
     */
    static parseMxChar(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): MatlabVariableNode;
    static parseFlatArray(rawVal: unknown[], name: string, parent: BaseNode | null): MatlabVariableNode;
    static parseTypedArray(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): MatlabVariableNode;
    static parseCell(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): MatlabVariableNode;
    static parseStructuredString(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): MatlabVariableNode;
    static parsePlainStringArray(rawVal: string[], name: string, parent: BaseNode | null): MatlabVariableNode;
}
//# sourceMappingURL=MatlabVariableNode.d.ts.map