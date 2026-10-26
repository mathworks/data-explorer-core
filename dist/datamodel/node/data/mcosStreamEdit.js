// Copyright 2026 The MathWorks, Inc.
import DataNode from '../DataNode.js';
import * as NodeRegistry from '../NodeRegistry.js';
import MatlabVariableNode from './MatlabVariableNode.js';
import { setMcosStreamGate } from '../mcosStream.js';
import { mcosEnumerationOf, mcosPlaceOf } from '../mcosPlace.js';
import { classRefusal, memberRefusal, mirrorTwins, nodeFollowedDataType, nodePropertyValue, objectEditsOf, objectNodeAt, objectNodesUnder, objectStateOf, objectSubsystemEdit, propertyAt, shownDataType, twinGroupByNode, twinGroupsOf, twinMasterRefusal, twinsTouching, McosPropertyVerdicts, } from './mcosObjectEdit.js';
import { hasEditRules, objectEditCells, savedNameOf } from '../../parser/McosEditRules.js';
import { objectIdOf, readMcosSubsystem } from '../../parser/McosSubsystemEdit.js';
import { mcosStreamParts, rewrittenHex, sameBytes, streamWithSubsystem } from '../../parser/McosStreamEdit.js';
import { encodedStream, encodedXml, hexValue, matStreamPrefix } from '../../parser/EncodedValue.js';
import { uudecode, uuencode } from '../../parser/CdataCodec.js';
import { decodeMatStream } from '../../parser/MatParser.js';
import { objectElementOf, subsystemCellsDiffer, variableDifference } from '../../parser/MatFileWriter.js';
import { MatWriteError, encodeMatVariable, withObjectMembers } from '../../parser/MatWriter.js';
/**
 * Makes `holder`, the node a dictionary value's MAT stream decoded into, the gate of every edit
 * inside it (mcosStream) and the writer of its stream: as read while its value is the stream it
 * was read from (`_encoded` still set), and rewritten, with the edited properties' cells swapped,
 * after. For MatlabVariableNode.parseEncoded and _parseCdataObjects, through the registry.
 */
export function adoptMcosStream(holder, read) {
    const stream = new McosStream(holder, read);
    setMcosStreamGate(holder, stream);
    // In front of whichever writers the holder has (DataNode._adoptEncoded, and the cdata's
    // serializeValue): captured, as instance overrides, and the class's looked up when called, for
    // the reason _adoptEncoded gives. A stream not an entry's whole value writes as it did.
    const own = holder;
    const readValue = own.serializeValue;
    const readXml = own.serializeXml;
    own.serializeValue = function () {
        if (this._encoded || !this.isEntry) {
            return readValue.call(this);
        }
        return stream.valueOf(stream.rewritten());
    };
    own.serializeXml = function (tagName, attrs, indent) {
        if (this._encoded || !this.isEntry) {
            return readXml.call(this, tagName, attrs, indent);
        }
        const nameAttrs = attrs && attrs.Name !== undefined ? DataNode.pxAttrs(attrs.Name) : '';
        return encodedXml(tagName, nameAttrs, stream.hexOf(stream.rewritten(), indent), indent);
    };
    own._binaryEncoded = function () {
        if (this._encoded || !this.isEntry) {
            return Object.getPrototypeOf(this)._binaryEncoded.call(this);
        }
        return stream.hexOf(stream.rewritten(), 2);
    };
}
class McosStream {
    constructor(holder, read) {
        this.holder = holder;
        this.read = read;
        // The last stream rewritten that passed its self-check, and the value and the subsystem it was made with.
        this._written = null;
        // What the editor found of each object's node the first time it asked (mcosObjectEdit.objectStateOf),
        // kept for as long as the node is, as a MAT-file keeps it (MatNode._objectState).
        this._states = new WeakMap();
        // What the gate found of each object's property whatever its value (_editRefusal), kept until an
        // edit at or under the object's node (_nodeEdited), as a MAT-file keeps it.
        this._propertyVerdicts = new McosPropertyVerdicts();
    }
    /**
     * Why an edit of `key` at `node` is refused whatever its value, or null where the value decides
     * (_editValueRefusal). Taken: an allow-listed property of an object in the stream of an entry's
     * whole value (mcosObjectEdit.propertyAt), one the rules take whatever its value
     * (mcosObjectEdit.propertyRefusal), of a stream framed as a save rewrites one (_framing); and the
     * name of the node holding the stream, which is outside it. Refused, with the encoded value's
     * words, everything else, as before there was this.
     */
    _editRefusal(entry, node, key) {
        if (node === this.holder && (key === 'Name' || key === 'name')) {
            return null;
        }
        if (this.holder !== entry) {
            return this._encodedWhy();
        }
        // A part of the value that is no object, nor in one (_plainEditRefusal).
        const plain = this._plainEditRefusal(entry, node, key);
        if (plain !== undefined) {
            return plain;
        }
        const object = objectNodeAt(entry, node);
        const cls = object ? classOf(object) : '';
        // A part of the object refused is refused in the encoded value's words, so propertyAt's own
        // clause, a walk to the root for the node and one for its object, is not asked for.
        const at = object && hasEditRules(cls) ? propertyAt(object, node, key, false) : null;
        if (!object || !at || 'why' in at || savedNameOf(cls, at.property) === null) {
            return this._encodedWhy();
        }
        const framed = this._framing();
        if (typeof framed === 'string') {
            return cannotEdit(entry.name, framed);
        }
        const state = this._state(object);
        if (typeof state === 'string') {
            return cannotEdit(entry.name, state);
        }
        const refused = classRefusal(state, object) ?? this._propertyVerdicts.of(state, object, at.property) ?? this._twinRefusal(object);
        return refused ? cannotEdit(entry.name, refused) : null;
    }
    /**
     * Why an edit of `key` at `node`, a part of the stream's value that is no object nor in one, is
     * refused, or null where it is taken; undefined where `node` is at or under an object, whose own
     * rules answer (_editRefusal). A value edit, an Add and a removal at a struct or a cell of the
     * value, and a field's rename, which is its struct's edit: the save writes the value anew, each
     * object in it as the element it was read as, which names the same object of the subsystem
     * (MatFileWriter.objectElementOf, as a MAT-file's save writes a variable holding objects fresh),
     * and the subsystem as it was, with the edited objects' cells swapped (rewritten). Refused at or
     * under a member written only as it was read: an enumeration value, a string, an object of no
     * class this edits; and wherever the value as read would not be written so (_plainVerdict). A
     * binary dictionary's struct or cell holding a matlab.lang.OnOffSwitchState took no edit at all,
     * where a MAT-file's and a text dictionary's took one beside it.
     */
    _plainEditRefusal(entry, node, key) {
        const at = (key === 'Name' || key === 'name') && node !== this.holder && node.parent ? node.parent : node;
        if (objectNodeAt(entry, at)) {
            return undefined;
        }
        for (let n = at; n; n = n.parent) {
            if (MatlabVariableNode._objectMemberOf(n)) {
                const enumeration = mcosEnumerationOf(n);
                if (enumeration) {
                    return cannotEdit(entry.name, n.matlabPath + ' is a value of the enumeration ' + enumeration.className + ', which a save writes only as it was read, so its edit cannot be saved');
                }
                return cannotEdit(entry.name, n.matlabPath + ' is ' + (n === at ? '' : 'part of ') + 'an object of the file, which a save writes as it was read');
            }
            if (n === this.holder) {
                break;
            }
        }
        if (!['Value', 'Add', 'Name', 'name'].includes(key)) {
            return this._encodedWhy();
        }
        const framed = this._framing();
        if (typeof framed === 'string') {
            return cannotEdit(entry.name, framed);
        }
        const why = this._plainVerdict();
        return why ? cannotEdit(entry.name, why) : null;
    }
    // Why the value as read would not be written anew around its objects (_plainElement) as it reads,
    // as a clause, or null: judged once, of its rows that are no object's, with the subsystem as read
    // (an object edited before is the save's self-check's to hold to its edit).
    _plainVerdict() {
        if (this._plainWhy === undefined) {
            try {
                const element = this._plainElement();
                const { valueEnd } = this._framing();
                const wrong = this._plainReadBackWrong(this._withValue(element, this.bytes().subarray(valueEnd)), true);
                this._plainWhy = wrong ? 'its value would not be written as it reads: ' + wrong : null;
            }
            catch (e) {
                if (!(e instanceof MatWriteError)) {
                    throw e;
                }
                this._plainWhy = 'its value could not be written anew: ' + e.message;
            }
        }
        return this._plainWhy;
    }
    // The value element of the stream, written anew from the holder's rows with the empty name a
    // stream's value has, each object in it as the element it was read as (MatFileWriter.objectElementOf).
    _plainElement() {
        const v = this.holder._var;
        return withObjectMembers((member) => {
            const element = objectElementOf(member, '');
            return 'element' in element ? element.element : null;
        }, () => encodeMatVariable({ ...v, name: '' }));
    }
    // A stream of the header read, `value` as its value element, and `subsystem` after it.
    _withValue(value, subsystem) {
        return concatBytes(this.bytes().subarray(0, 8), value, subsystem);
    }
    // Where the stream `bytes` does not read back, as this package reads one (parseEncoded), as the
    // value its holder shows, row for row, in words; or null where it does. With `plainOnly`, the rows
    // at or under an object are not compared.
    _plainReadBackWrong(bytes, plainOnly = false) {
        const decoded = decodeMatStream(bytes, { whole: true });
        if (!decoded.ok || decoded.trailingElements.length !== 1) {
            return 'it does not decode' + (decoded.ok ? ' as one value and its objects' : ' (' + decoded.reason + ')');
        }
        let root;
        try {
            NodeRegistry.attachMcosDecoded(decoded.trailingElements[0], [decoded.variable], [], this.holder.name);
            root = MatlabVariableNode.parseMatVariable(decoded.variable, this.holder.name, null);
        }
        catch (e) {
            return 'it does not read back (' + (e instanceof Error ? e.message : String(e)) + ')';
        }
        const rows = (n) => plainOnly && mcosPlaceOf(n) ? [n.name + ' (an object)'] : [n.name + '=' + n.displayValue, ...n.children.flatMap(rows)];
        const [shown, back] = [rows(this.holder).slice(1), rows(root).slice(1)];
        let k = shown.findIndex((r, i) => r !== back[i]);
        if (k < 0) {
            if (shown.length === back.length) {
                return null;
            }
            // Every row shown reads back, and more do: the first of those is named, not "nothing".
            k = shown.length;
        }
        return k < shown.length ? 'a row shows ' + shown[k] + ', and reads back ' + (back[k] ?? 'as nothing') : 'a row reads back ' + back[k] + ', which no row shows';
    }
    /** An edit at `node`, a node of the stream (BaseNode._markSourceDirty): what was found of each object at or above it is forgotten. */
    _nodeEdited(node) {
        this._propertyVerdicts.forget(node);
    }
    // ---- A handle two fields share ---------------------------------------------------------------
    //
    // Two nodes of the stream's value holding one handle (`s.a = p; s.b = p`) are one object, as
    // MATLAB loads them, and are shown as one, as a MAT-file shows two variables holding one
    // (MatNode._twinGroups and the four after it): the first of them an edit is made at or under is
    // the one every later edit of the object is made through, and after each edit the session makes
    // or wraps (DataModel.mutateSubtree, addChildTo, deleteNodeById, and their undo and redo) the
    // others are copied into from it (mcosObjectEdit.mirrorTwins) and edited so, and take no edit of
    // their own; the save writes the edit once. The stream is the entry's whole value, so every node
    // of an object is in the entry, and none is outside the subtree an edit of it is made in.
    // Why no edit of the object at `object` is taken for another node of it, its master, having
    // been edited first (mcosObjectEdit.twinMasterRefusal), as a clause, or null.
    _twinRefusal(object) {
        const group = this._twinGroupOf(object);
        return group ? twinMasterRefusal(group, object, (n) => this._inStream(n)) : null;
    }
    // The nodes of each object two or more nodes of the stream are, found the first time an editor
    // asks about one of its objects, which is before any edit of one (mcosObjectEdit.twinGroupsOf).
    _twinGroups() {
        if (this._twins === undefined) {
            this._twins = this.holder.isEntry && typeof this._framing() !== 'string' ? twinGroupsOf(objectNodesUnder(this.holder), (n) => this._state(n)) : [];
            this._twinOf = twinGroupByNode(this._twins);
        }
        return this._twins;
    }
    _twinGroupOf(object) {
        this._twinGroups();
        return this._twinOf.get(object) ?? null;
    }
    // The nodes an edit at or under `root` is copied into that are not at or under it
    // (BaseNode.sourceTwinsOutside): the other nodes of every object it reaches.
    _twinsOutside(root) {
        const out = [];
        for (const group of this._twinsTouching(root)) {
            for (const { node } of group.members) {
                if (this._inStream(node) && !isAtOrUnder(node, root)) {
                    out.push(node);
                }
            }
        }
        return out;
    }
    // After an edit at or under `root`: every other node of an object it reached shows the object as
    // the edit left it, and is edited so (BaseNode.sourceMirrorTwins). Answers the nodes copied into.
    _mirrorTwins(root) {
        const copied = [];
        for (const group of this._twinsTouching(root)) {
            const members = group.members.filter((m) => this._inStream(m.node));
            if (members.length > 1) {
                copied.push(...mirrorTwins(group, members));
            }
        }
        return copied;
    }
    // The groups an edit at or under `root` can reach, found the first time this is asked, as a
    // MAT-file's (MatNode._twinsTouching); most streams have none.
    _twinsTouching(root) {
        const groups = this._twinGroups();
        return groups.length === 0 ? [] : twinsTouching(groups, root);
    }
    // Whether `node` is in the stream's value still.
    _inStream(node) {
        return isAtOrUnder(node, this.holder);
    }
    /**
     * Why `value`, what an edit of `key` at `node` is about to make the property hold, as the node
     * would hold it, cannot be written, or null where it can: judged with every other edit of the
     * same object as the save judges them (McosEditRules.objectEditCells), those of another node of
     * the one object included, a handle two fields of the value share (_objectEdits).
     */
    _editValueRefusal(entry, node, key, value) {
        const refused = this._editRefusal(entry, node, key);
        if (refused) {
            return refused;
        }
        const object = objectNodeAt(entry, node);
        const at = object ? propertyAt(object, node, key) : null;
        if (!object || !at || 'why' in at) {
            return null;
        }
        const pending = nodePropertyValue(object, at.property, { value });
        if (typeof pending === 'string') {
            return cannotEdit(entry.name, object.matlabPath + '.' + at.property + ' ' + pending);
        }
        const state = this._state(object);
        const edits = this._objectEdits(state, object, { property: at.property, value: pending });
        if (typeof edits === 'string') {
            return cannotEdit(entry.name, edits);
        }
        // The DataType the edit of the Value is about to follow to (mcosObjectEdit.nodeFollowedDataType).
        const followed = nodeFollowedDataType(state, object, at.property === 'Value' ? pending : undefined);
        const ruled = objectEditCells(state.held, edits, object.matlabPath, followed ?? undefined);
        return ruled.ok ? null : cannotEdit(entry.name, ruled.message);
    }
    /**
     * Why `value`, a node built of the text an edit typed in for `node`, cannot be written, or null
     * where it can: typed as a Simulink.Parameter's whole Value, on its Value row, it is the
     * object's, and judged as one (_editValueRefusal); typed into a field of its struct Value, as
     * what such a field may hold (mcosObjectEdit.memberRefusal), as a MAT-file judges it
     * (MatNode._valueRefusal).
     */
    _valueRefusal(entry, node, value) {
        const object = objectNodeAt(entry, node);
        if (object && object._valueNode === node) {
            return this._editValueRefusal(entry, node, 'Value', value);
        }
        // Not typed over the stream's whole value, whose class its hex states.
        if (node === this.holder) {
            return this._encodedWhy();
        }
        // Typed into a part of the value that is no object's, which the save writes anew
        // (_plainEditRefusal): what MatWriter writes, a plain value (MatlabVariableNode._isPlainTree), and
        // not a string, which it has no class for.
        if (!object && value instanceof MatlabVariableNode && !value._isPlainTree()) {
            return cannotEdit(entry.name, node.matlabPath + ' would hold ' + value._unplainPhrase() + ', which a save does not write into its MAT stream');
        }
        const refused = object ? memberRefusal(object, node, value) : null;
        return refused ? cannotEdit(entry.name, refused) : null;
    }
    /**
     * What `key` of `node` follows to once its edits are saved, for the node to show
     * (BaseNode.sourceFollowedProperty), or undefined: the DataType of a Simulink.Parameter's node
     * in the stream of an entry's whole value, as the save writes it with an edit of the Value
     * (mcosObjectEdit.shownDataType), as a MAT-file's does (MatNode._followedProperty).
     */
    _followedProperty(entry, node, key) {
        if (key !== 'DataType' || this.holder !== entry || objectNodeAt(entry, node) !== node) {
            return undefined;
        }
        const state = this._state(node);
        return typeof state === 'string' ? undefined : shownDataType(state, node) ?? undefined;
    }
    /**
     * The stream as a save writes it now: null where no edit of its objects is to be written (none
     * made, or each one undone), so that it is written as it was read; otherwise the value as it
     * was, followed by the subsystem with the edited cells swapped, re-read before it is handed back
     * (_selfCheck). Throws MatWriteError, naming the entry and why, for an edit it cannot write: one
     * of a part of the value that is no object's (an edit no gate asked about), and every refusal of
     * mcosObjectEdit.objectSubsystemEdit, the writer a MAT-file's save asks.
     */
    rewritten() {
        const holder = this.holder;
        const refuse = (why) => {
            throw new MatWriteError('Cannot write "' + holder.name + '": ' + why + '. Nothing was written.');
        };
        // An edit of a part of the value that is no object (_plainEditRefusal) writes the value anew.
        const plain = !!holder._plainEdited;
        if (plain && !(holder instanceof MatlabVariableNode)) {
            refuse(holder.matlabPath + ' holds an edit of a part of its value that is no object of it, which a save does not write into its stream');
        }
        const edited = objectNodesUnder(holder).filter((n) => n._objectEdited);
        if (edited.length === 0 && !plain) {
            return null;
        }
        const framed = this._framing();
        if (typeof framed === 'string') {
            return refuse(framed);
        }
        const written = edited.length > 0 ? objectSubsystemEdit(framed.subsystem, edited, (n) => this._state(n), () => holder.name) : null;
        if (!written && !plain) {
            return null;
        }
        const subsystem = written ? written.element : this.bytes().subarray(framed.valueEnd);
        const valueRead = this.bytes().subarray(8, framed.valueEnd);
        let value;
        try {
            value = plain ? this._plainElement() : valueRead;
        }
        catch (e) {
            if (!(e instanceof MatWriteError)) {
                throw e;
            }
            return refuse('its value could not be written anew: ' + e.message);
        }
        // A value written anew as the bytes it was read as (an Add undone), with no object edited: the
        // stream as read.
        if (plain && !written && sameBytes(value, valueRead)) {
            return null;
        }
        // One save asks for the stream more than once (the entry's merge reads its text back), and
        // the edits that make one value and one subsystem make one stream: what the self-check passed
        // is kept.
        if (this._written && sameBytes(this._written.element, subsystem) && sameBytes(this._written.value, value)) {
            return this._written.bytes;
        }
        const bytes = plain ? this._withValue(value, subsystem) : streamWithSubsystem(this.bytes(), framed.valueEnd, subsystem);
        const wrong = this._selfCheck(bytes, framed, subsystem, written?.cells ?? [], edited, plain);
        if (wrong) {
            refuse('the stream written for it did not read back as written: ' + wrong);
        }
        this._written = { element: subsystem, value, bytes };
        return bytes;
    }
    /** The stream as read, to its last byte (McosStreamRead.bytes), cut out once. */
    bytes() {
        if (this._stream === undefined) {
            const read = this.read;
            this._stream = read.format === 'cdata' ? matStreamPrefix(read.bytes) ?? read.bytes : read.bytes;
        }
        return this._stream;
    }
    /** The value a text dictionary and a copy are handed: the stream as read, or `bytes`, each in its own form. */
    valueOf(bytes) {
        if (this.read.format === 'hex') {
            return this.hexOf(bytes, 2);
        }
        return bytes ? { ...this.read.raw, _value: uuencode(bytes) } : this.read.raw;
    }
    /** The hex value a binary dictionary holds at `indent`: the stream as read, or `bytes`, its EncodedLength their byte count. */
    hexOf(bytes, indent) {
        const read = this.read;
        if (read.format === 'hex') {
            return bytes ? rewrittenHex(read.encoded, bytes, indent) : read.encoded;
        }
        return hexValue(bytes ?? this.bytes(), read.className, indent);
    }
    // The words a value still in its encoded stream refuses an edit with (DataNode._refuseEncodedEdit).
    _encodedWhy() {
        return `'${this.holder.displayName}' is stored as an encoded MATLAB value that this editor can show but not write, so it is read-only.`;
    }
    // The stream, split and its subsystem read, once; or why no edit of it can be written. A save
    // writes it again from what it holds, so it must hold its stream and nothing else: hex whose
    // digits are its EncodedLength's bytes, cdata whose text is the stream's own six-bit text, the
    // value and the subsystem and nothing after them.
    _framing() {
        if (this._framed === undefined) {
            this._framed = framingOf(this.read, this.bytes());
        }
        return this._framed;
    }
    _state(object) {
        let state = this._states.get(object);
        if (state === undefined) {
            const framed = this._framing();
            state = typeof framed === 'string' ? framed : objectStateOf(framed.subsystem, object);
            this._states.set(object, state);
        }
        return state;
    }
    // The edits of the object at `object` a save would write once `pending` is made, merged over
    // every node of the stream that is the one object (a handle two fields share), as
    // objectSubsystemEdit merges them; or why not, as a clause: one the object's node could not
    // write (objectEditsOf), and another node of it holding another value of the same property.
    _objectEdits(state, object, pending) {
        const own = objectEditsOf(state, object, pending);
        if ('why' in own) {
            return own.why;
        }
        // Once an edit of the object was made through `object`, its master, the others hold copies of
        // the master's edits made before this one (_mirrorTwins), and are copied into again after it.
        if (this._twinGroupOf(object)?.master === object) {
            return own.edits;
        }
        const merged = new Map(own.edits.map((e) => [e.property, { value: e.value, node: object }]));
        for (const other of objectNodesUnder(this.holder)) {
            const s = other === object ? null : this._state(other);
            if (!s || typeof s === 'string' || s.objectId !== state.objectId) {
                continue;
            }
            const theirs = objectEditsOf(s, other);
            if ('why' in theirs) {
                continue;
            }
            for (const { property, value } of theirs.edits) {
                const mine = merged.get(property);
                if (mine && variableDifference(value, mine.value, other.matlabPath + '.' + property)) {
                    return object.matlabPath + ' and ' + other.matlabPath + ' are one object, whose ' + property + ' ' + other.matlabPath + ' holds another value of';
                }
                merged.set(property, mine ?? { value, node: other });
            }
        }
        return [...merged].map(([property, { value }]) => ({ property, value }));
    }
    // Where `bytes`, the stream about to be written, is not the one planned, in words, or null: it
    // splits where the stream read did, its value element the bytes it was and its subsystem the
    // one written; it decodes whole, as the readers decode it; the subsystem is the one read with
    // only the planned cells changed (subsystemCellsDiffer); its hex or its cdata reads back as
    // these bytes, the hex's EncodedLength their count; and the objects this package shows of it
    // hold the values the edits made.
    // A value written anew (`plain`) is held to the rows its holder shows instead (_plainReadBackWrong).
    _selfCheck(bytes, framed, element, cells, edited, plain = false) {
        const parts = mcosStreamParts(bytes);
        if (!parts.ok) {
            return 'it ' + parts.message;
        }
        if (!plain && (parts.valueEnd !== framed.valueEnd || !sameBytes(bytes.subarray(0, parts.valueEnd), this.bytes().subarray(0, framed.valueEnd)))) {
            return 'its value is not the bytes it was read as';
        }
        if (plain) {
            const wrong = this._plainReadBackWrong(bytes);
            if (wrong) {
                return wrong;
            }
        }
        if (!sameBytes(parts.subsystem, element)) {
            return 'its objects are not the element written for them';
        }
        const decoded = decodeMatStream(bytes, { whole: true });
        if (!decoded.ok || decoded.trailingElements.length !== 1) {
            return 'it does not decode' + (decoded.ok ? ' as one value and its objects' : ' (' + decoded.reason + ')');
        }
        const cellsWrong = subsystemCellsDiffer(framed.subsystem.bytes, element, cells, 'its objects');
        if (cellsWrong) {
            return cellsWrong;
        }
        if (this.read.format === 'hex') {
            const hex = this.hexOf(bytes, 2);
            const back = encodedStream(hex);
            if (!back.bytes || !sameBytes(back.bytes, bytes) || hex._attrs.EncodedLength !== String(bytes.length)) {
                return 'its hex does not read back as its ' + bytes.length + ' bytes' + (back.reason ? ' (' + back.reason + ')' : '');
            }
        }
        else {
            const back = matStreamPrefix(uudecode(uuencode(bytes)));
            if (!back || !sameBytes(back, bytes)) {
                return 'its text does not read back as its ' + bytes.length + ' bytes';
            }
        }
        return this._readBackWrong(decoded.variable, decoded.trailingElements[0], edited);
    }
    // Where the objects this package shows of the stream written, its value `variable` decoded with
    // its subsystem `element` as the dictionary's reader decodes them (parseEncoded), do not hold
    // what the nodes `edited` hold of each property a save wrote, in words, or null where they do.
    _readBackWrong(variable, element, edited) {
        let root;
        try {
            const warnings = [];
            NodeRegistry.attachMcosDecoded(element, [variable], warnings, this.holder.name);
            root = MatlabVariableNode.parseMatVariable(variable, this.holder.name, null);
        }
        catch (e) {
            return 'its objects do not read back (' + (e instanceof Error ? e.message : String(e)) + ')';
        }
        const byId = new Map();
        for (const n of objectNodesUnder(root)) {
            const place = mcosPlaceOf(n);
            const id = place ? objectIdOf(place.variable.mcosHandle, place.index) : null;
            if (id !== null && !byId.has(id)) {
                byId.set(id, n);
            }
        }
        for (const node of edited) {
            const state = this._state(node);
            if (typeof state === 'string') {
                return state;
            }
            const found = objectEditsOf(state, node);
            if ('why' in found) {
                return found.why;
            }
            const back = byId.get(state.objectId);
            for (const { property, value } of found.edits) {
                const now = back ? nodePropertyValue(back, property) : 'is not among the objects read back';
                const wrong = typeof now === 'string' ? node.matlabPath + '.' + property + ' ' + now : variableDifference(value, now, node.matlabPath + '.' + property);
                if (wrong) {
                    return wrong;
                }
            }
        }
        return null;
    }
}
function framingOf(read, bytes) {
    if (read.format === 'hex') {
        const encoded = read.encoded;
        const digits = encoded._value.replace(/\s+/g, '').length;
        if (encoded._attrs.EncodedLength !== String(bytes.length) || digits !== 2 * bytes.length) {
            return 'its hex text is not the ' + bytes.length + ' bytes its EncodedLength says, and nothing more, which a save would have to write again';
        }
    }
    else if (typeof read.raw?._value !== 'string' || uuencode(bytes) !== read.raw._value) {
        return 'its encoded text is not its stream, and nothing more, which a save would have to write again';
    }
    const parts = mcosStreamParts(bytes);
    if (!parts.ok) {
        return 'its stream is not a value and its objects, which a save rewrites: ' + parts.message;
    }
    const subsystem = readMcosSubsystem(parts.subsystem);
    if (!subsystem.ok) {
        return "its stream's objects could not be read as a save rewrites them (" + subsystem.message + ')';
    }
    return { valueEnd: parts.valueEnd, subsystem: subsystem.subsystem };
}
function isAtOrUnder(node, root) {
    for (let n = node; n; n = n.parent) {
        if (n === root) {
            return true;
        }
    }
    return false;
}
function classOf(node) {
    return String(node.className || '');
}
function cannotEdit(name, why) {
    return 'Cannot edit "' + name + '": ' + why + '.';
}
function concatBytes(...parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}
//# sourceMappingURL=mcosStreamEdit.js.map