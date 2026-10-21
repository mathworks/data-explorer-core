// Copyright 2026 The MathWorks, Inc.
import DataNode from '../DataNode.js';
import * as NodeRegistry from '../NodeRegistry.js';
import MatlabVariableNode from './MatlabVariableNode.js';
import { setMcosStreamGate } from '../mcosStream.js';
import { mcosPlaceOf } from '../mcosPlace.js';
import { classRefusal, memberRefusal, nodePropertyValue, objectEditsOf, objectNodeAt, objectNodesUnder, objectStateOf, objectSubsystemEdit, propertyAt, propertyRefusal, } from './mcosObjectEdit.js';
import { hasEditRules, objectEditCells, savedNameOf } from '../../parser/McosEditRules.js';
import { objectIdOf, readMcosSubsystem } from '../../parser/McosSubsystemEdit.js';
import { mcosStreamParts, rewrittenHex, sameBytes, streamWithSubsystem, subsystemCellsDiffer } from '../../parser/McosStreamEdit.js';
import { encodedStream, encodedXml, hexValue, matStreamPrefix } from '../../parser/EncodedValue.js';
import { uudecode, uuencode } from '../../parser/CdataCodec.js';
import { decodeMatStream } from '../../parser/MatParser.js';
import { variableDifference } from '../../parser/MatFileWriter.js';
import { MatWriteError } from '../../parser/MatWriter.js';
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
        // The last stream rewritten that passed its self-check, and the subsystem it was made with.
        this._written = null;
        // What the editor found of each object's node the first time it asked (mcosObjectEdit.objectStateOf),
        // kept for as long as the node is, as a MAT-file keeps it (MatNode._objectState).
        this._states = new WeakMap();
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
        const object = objectNodeAt(entry, node);
        const cls = object ? classOf(object) : '';
        const at = object && hasEditRules(cls) ? propertyAt(object, node, key) : null;
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
        const refused = classRefusal(state, object) ?? propertyRefusal(state, object, at.property);
        return refused ? cannotEdit(entry.name, refused) : null;
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
        const ruled = objectEditCells(state.held, edits, object.matlabPath);
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
        const refused = object ? memberRefusal(object, node, value) : null;
        return refused ? cannotEdit(entry.name, refused) : null;
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
        if (holder._plainEdited) {
            refuse(holder.matlabPath + ' holds an edit of a part of its value that is no object of it, which a save does not write into its stream');
        }
        const edited = objectNodesUnder(holder).filter((n) => n._objectEdited);
        if (edited.length === 0) {
            return null;
        }
        const framed = this._framing();
        if (typeof framed === 'string') {
            return refuse(framed);
        }
        const written = objectSubsystemEdit(framed.subsystem, edited, (n) => this._state(n), () => holder.name);
        if (!written) {
            return null;
        }
        // One save asks for the stream more than once (the entry's merge reads its text back), and
        // the edits that make one subsystem make one stream: what the self-check passed is kept.
        if (this._written && sameBytes(this._written.element, written.element)) {
            return this._written.bytes;
        }
        const bytes = streamWithSubsystem(this.read.bytes, framed.valueEnd, written.element);
        const wrong = this._selfCheck(bytes, framed, written.element, written.cells, edited);
        if (wrong) {
            refuse('the stream written for it did not read back as written: ' + wrong);
        }
        this._written = { element: written.element, bytes };
        return bytes;
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
        return hexValue(bytes ?? read.bytes, read.className, indent);
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
            this._framed = framingOf(this.read);
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
    _selfCheck(bytes, framed, element, cells, edited) {
        const parts = mcosStreamParts(bytes);
        if (!parts.ok) {
            return 'it ' + parts.message;
        }
        if (parts.valueEnd !== framed.valueEnd || !sameBytes(bytes.subarray(0, parts.valueEnd), this.read.bytes.subarray(0, framed.valueEnd))) {
            return 'its value is not the bytes it was read as';
        }
        if (!sameBytes(parts.subsystem, element)) {
            return 'its objects are not the element written for them';
        }
        const decoded = decodeMatStream(bytes, { whole: true });
        if (!decoded.ok || decoded.trailingElements.length !== 1) {
            return 'it does not decode' + (decoded.ok ? ' as one value and its objects' : ' (' + decoded.reason + ')');
        }
        const cellsWrong = subsystemCellsDiffer(framed.subsystem.bytes, element, cells);
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
function framingOf(read) {
    const bytes = read.bytes;
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
function classOf(node) {
    return String(node.className || '');
}
function cannotEdit(name, why) {
    return 'Cannot edit "' + name + '": ' + why + '.';
}
//# sourceMappingURL=mcosStreamEdit.js.map