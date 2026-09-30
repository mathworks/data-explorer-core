import DataNode from './DataNode.js';
/**
 * A dictionary entry that saves as a Simulink object: its live values are written back over
 * the property bag the FILE held.
 *
 * There are two save paths — `_getSerializedProperties`, iterated into `<P>` tags for a
 * compressed-binary `.sldd`, and `serializeValue`, whose override bag becomes the JSON of an
 * uncompressed-text one — and every class here used to state its written properties TWICE,
 * once per path. This class exists so that list is stated ONCE, in `_serializedOverrides`,
 * and both paths read it. The failure that shape rules out is a class whose two copies stop
 * agreeing: teach it a second property, or tighten one gate, and the same edit has to be
 * made in both methods with nothing objecting if only one moves. What comes out then is one
 * dictionary that saves differently in its two flavours — a key written into the binary file
 * and missing from the text one, from the same model in the same session — which is the
 * hardest kind of difference to notice, because either file on its own looks right.
 *
 * Both paths also MERGE that one list the same way, through `DataNode._mergeProps`, and that
 * is a correction MATLAB handed down rather than a tidy-up. `_mergeProps` knows about MATLAB's
 * saveobj envelope — it drops an EMPTY override rather than writing back a default MATLAB
 * never wrote, and writes a non-empty one INTO the envelope as well as beside it, because the
 * envelope is what MATLAB's loadobj actually reads (defects 40 and 46; `_mergeProps` carries
 * the full account). That used to be the TEXT path only, with `VariantVariableNode` overriding
 * `_getSerializedProperties` to opt its binary path in, and the asymmetry was recorded here as
 * a separate question. Reading the emitted binary bytes answered it: `Simulink.VariantBank`,
 * `Simulink.VariantBankCoderInfo` and `Simulink.VariantConfigurations` each came out carrying
 * `<P Name="Value" Class="char"/>` NEXT TO their envelope — a property none of those MATLAB
 * classes has, standing in for a default this node cannot see inside the envelope, written
 * into the binary flavour of a dictionary and absent from the text one. Exactly the divergence
 * the paragraph above says this class exists to rule out, surviving in the merge because only
 * the LIST had been unified. One class opting in was the tell: what was special about
 * `VariantVariableNode` was not the class, it was that somebody had looked at its bytes.
 *
 * `SignalNode` and `ParameterNode` are Simulink objects too and deliberately do not extend
 * this class: a Signal's two paths write different VALUES for a cleared bound (`[]` in
 * binary, `undefined` in text so `JSON.stringify` drops the key), which one shared list
 * cannot express, and a Parameter already funnels `serializeValue` through
 * `_getSerializedProperties`.
 */
export default class SimulinkObjectNode extends DataNode {
    /**
     * The live values this node writes over the file's own property bag — the single place a
     * subclass names what it saves.
     *
     * Insertion order matters and is preserved by both paths: the binary writer emits one
     * `<P>` per key in iteration order and the text path is serialized by `JSON.stringify`, so
     * a key the stored bag already carries keeps its position on disk and a NEW key lands in
     * the order named here. Build the object in the order the file should read.
     *
     * Empty by default, which is the right answer for a node that adds nothing to what the
     * file already held.
     */
    _serializedOverrides(): Record<string, unknown>;
    _getSerializedProperties(): Record<string, unknown>;
    serializeValue(): unknown;
    /**
     * The write-back gate for properties whose absence from the file is meaningful: keep a
     * candidate when the FILE already carried its key, or when the node now holds a value for
     * it. Everything else is dropped, so a save invents no key the file did not have.
     *
     * Both halves fail in opposite directions — lose `key in stored` and a key the file
     * carried whose value happens to be empty vanishes from the saved bag, so opening a
     * dictionary and saving it with no edits produces a diff in source control; lose the value
     * half and an edit just made in the Property Inspector is silently discarded on save,
     * surviving only until the file is reopened. The rule is about the FILE's key set, not
     * about what the writer upstream of us meant by leaving a key out —
     * `test/absentPropertyWriteBack.test.ts` states it that way and records which format
     * really omits a key for an empty value and which does not.
     *
     * The truthiness test is what scopes this helper: it fits a property whose "nothing to
     * say" state really is falsy, which for this cluster means the empty-string Descriptions.
     * A property whose absent state is a non-empty DEFAULT must state its own predicate
     * instead — a `Simulink.ValueType` with no `DataType` key IS a double, and 'double' is
     * truthy, so routing it through here would write that default into every dictionary saved
     * without edits.
     */
    _gatedProps(candidates: Record<string, unknown>): Record<string, unknown>;
    /**
     * The property bag inside a Simulink object's rawVal — its first element's `_properties`,
     * or an empty bag when the file carries neither.
     *
     * Stated once here because every subclass's `static parse` needs it and all of them used to
     * spell it out identically; a reader who wants to know where a saved object keeps its
     * properties should find one answer, not fourteen.
     *
     * A custom-saving class has no `_properties` in a TEXT dictionary — its whole state is in a
     * `_custom_save` envelope alongside, which this lifts into the bag under SAVEOBJ_KEY so the
     * rest of the model sees the envelope in the same place for both formats (XmlUtils'
     * CUSTOM_SAVE_KEY carries the full account). Until it did, `serial._properties` for a
     * `Simulink.VariantVariable` read from a text dictionary was `{}` — indistinguishable from
     * an object that genuinely has nothing in it, which is why `_mergeProps`' envelope handling
     * silently did not engage for text and an edit went only to a sibling MATLAB ignores.
     */
    static _propsOf(rawVal: Record<string, unknown>): Record<string, unknown>;
    /**
     * A fresh single-element rawVal envelope for a new Simulink object of `className`, carrying
     * `properties` as its element's property bag.
     *
     * The envelope is what MATLAB writes around every scalar object — a 1x1 MATLABArray holding
     * one element — and every class here minted it identically. Stated once so a new class gets
     * the shape right by construction rather than by copying a neighbour.
     *
     * There is deliberately no `_array_type` key. We used to write `_array_type: 'MATLABArray'`
     * here, and MATLAB writes it on NONE of the fifteen object entries of a dictionary it
     * authored itself — `_array_class` is what says "this is an object", and `_array_type` is the
     * tag for the three container shapes ('Struct', 'Cell', 'String') that have no class. Nothing
     * in this package ever read the value 'MATLABArray' back, so it was a key we invented,
     * emitted, and then ignored.
     *
     * Nor is there an `_id`. MATLAB stamps one on every element ("1", "2", … a document-wide
     * counter) and we leave it out on purpose: it exists to let two properties reference one
     * shared object, a fresh scalar entry shares nothing, and minting ids correctly would mean
     * knowing the highest one already in the document. MATLAB loaded all 28 emitted entries with
     * no `_id` anywhere, so it is not load-bearing for anything the Add gallery can produce.
     *
     * The returned object OWNS `properties` by reference: callers rely on
     * `rawVal._elements[0]._properties` being the same object they passed in, because that
     * aliasing is how a later edit to the node's property bag reaches the bytes written back.
     *
     * This and `_propsOf` are the two members here that are plain `static` rather than
     * `protected`: `SignalNode`, `ParameterNode` and `EnumTypeNode` mint the same envelope while
     * deliberately NOT extending this class (see the class header for why), so `protected` would
     * shut out exactly the callers that need it most.
     */
    static _defaultRawVal(className: string, properties?: Record<string, unknown>): Record<string, unknown>;
    /**
     * The same envelope for a class that serializes through MATLAB's custom save/load hook:
     * its whole state goes in a saveobj struct, and it has no ordinary properties at all.
     *
     * This exists because a default built the ordinary way **crashed MATLAB**. Given an element
     * with a property bag and no envelope, `SlVariantVariable::loadObj` asks `mxGetField` for
     * the fields its struct is supposed to declare, gets NULL, and dereferences it — a
     * segmentation fault in MATLAB, from a dictionary the Add gallery wrote. So for this family
     * the envelope is not an optimisation or a fidelity detail; it is the only shape that loads.
     *
     * `fields` is MATLAB's own DECLARATION order, which is not the alphabetical order its text
     * writer happens to emit the element in, and `writeIntoSaveobj` will only write a field this
     * list names — so a name missing here is a property no edit can ever reach.
     *
     * Both formats are served by this one shape: the binary writer spells a `_array_type:
     * 'Struct'` bag as `<P Source="saveobj" Class="struct">`, and the text writer moves it to the
     * element-level `_custom_save` MATLAB reads (DataNode._serializeSimulinkObject). Stating it
     * once is the point — the two spellings of this envelope have already drifted apart once,
     * which is the whole of XmlUtils' CUSTOM_SAVE_KEY note.
     */
    static _defaultCustomSaveRawVal(className: string, fields: string[], element: Record<string, unknown>): Record<string, unknown>;
    /**
     * An EMPTY MATLAB struct array of the given shape, with its field names declared.
     *
     * A field of an envelope often defaults to one of these — `Simulink.VariantVariable`'s
     * `Choices` is an empty 0x1 struct of Condition/Value — and it has no simpler spelling: a
     * plain `[]` is a double, and MATLAB's loadobj destructures the field expecting a struct.
     *
     * MATLAB's own TEXT writer loses the field names here (it emits `{"_type":"struct",
     * "_value":"[]"}`) and reads that back without complaint, so the names are not load-critical
     * and carrying them is strictly more than MATLAB keeps. They are kept anyway because the
     * binary format does state them and a default that can round-trip through either format
     * unchanged is worth more than one that matches MATLAB's lossier path byte for byte.
     */
    static _emptyStruct(fields: string[], dimensions?: number[]): Record<string, unknown>;
    /**
     * An EMPTY MATLAB cell array of the given shape — `Simulink.VariantBank`'s
     * `VariantConditions` default, and the same reasoning as `_emptyStruct`: `[]` would be a
     * double where MATLAB's loadobj expects a cell. This shape is spelled identically in both
     * formats, so unlike the struct above there is nothing lost either way.
     */
    static _emptyCell(dimensions?: number[]): Record<string, unknown>;
    /**
     * The nested `Simulink.CoderInfo` a newly created object carries — every value measured from
     * what MATLAB R2027a writes for a default-constructed one, not inferred. `parameterOrSignal`
     * is the only field that differs by owner: 'Parameter' for `Simulink.Parameter`,
     * `Simulink.Breakpoint` and `Simulink.LookupTable`, 'Signal' for `Simulink.Signal`.
     *
     * That is FOUR classes minting one literal, and it was spelled out verbatim in each. The
     * failure that invites is a copy drifting: MATLAB loads a CoderInfo through `loadobj`, which
     * fills whatever is missing from its own defaults rather than complaining, so a bag that has
     * lost `CustomAttributes` or spells `CustomStorageClass` differently loads as a DIFFERENT
     * storage class with nothing raised anywhere — and it would load wrong for one newly added
     * entry class while the other three stayed right, which is the version of the bug nobody goes
     * looking for. Stated once so the next correction reaches all four.
     *
     * A FRESH object per call, and that is load-bearing rather than incidental: `_defaultRawVal`
     * documents that the bag it is handed is owned by reference, because the aliasing is how a
     * later edit reaches the saved bytes. One module-level constant shared here would give two new
     * entries ONE CoderInfo, so a Storage Class set on either would silently move on both.
     */
    static _defaultCoderInfo(parameterOrSignal: string): Record<string, unknown>;
}
//# sourceMappingURL=SimulinkObjectNode.d.ts.map