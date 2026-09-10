// Copyright 2026 The MathWorks, Inc.

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
 * The two paths still MERGE that one list differently, and that was left exactly as it was.
 * `_getSerializedProperties` assigns the overrides straight over the stored bag;
 * `serializeValue` reaches `DataNode._mergeProps`, which knows about MATLAB's saveobj
 * envelope — it drops an EMPTY override rather than writing back a default MATLAB never
 * wrote, and writes a non-empty one INTO the envelope as well as beside it, because the
 * envelope is what MATLAB's loadobj actually reads (defects 40 and 46; `_mergeProps` carries
 * the full account). Making both paths merge the same way would change what one of them
 * writes for every class here, so it is a separate question from where the list of written
 * properties lives. `VariantVariableNode` is the one class whose BINARY path is
 * envelope-aware, and it says so by overriding `_getSerializedProperties` to put its own
 * `_serializedOverrides` through `_mergeProps`.
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
  _serializedOverrides(): Record<string, unknown> {
    return {};
  }

  _getSerializedProperties(): Record<string, unknown> {
    return Object.assign({}, this.serial._properties as Record<string, unknown>, this._serializedOverrides());
  }

  serializeValue(): unknown {
    return this._serializeSimulinkObject(this._serializedOverrides());
  }

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
  _gatedProps(candidates: Record<string, unknown>): Record<string, unknown> {
    const stored = this.serial._properties as Record<string, unknown>;
    const gated: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(candidates)) {
      if (key in stored || val) {
        gated[key] = val;
      }
    }
    return gated;
  }
}
