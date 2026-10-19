// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import { readSaveobjField, writeIntoSaveobj, type SetPropertyResult } from '../DataNode.js';
import { SAVEOBJ_KEY } from '../../parser/XmlUtils.js';
import { recordPartialDecode } from '../../parser/EncodedValue.js';
import PropName from '../../prop/PropName.js';
import PropValue from '../../prop/PropValue.js';
import PropDataType from '../../prop/PropDataType.js';
import { formatReadValue } from '../../prop/PropVariantConditions.js';
import PropCoderInfoHeaderFile from '../../prop/PropCoderInfoHeaderFile.js';
import PropCoderInfoDefinitionFile from '../../prop/PropCoderInfoDefinitionFile.js';
import PropPreStatement from '../../prop/PropPreStatement.js';
import PropPostStatement from '../../prop/PropPostStatement.js';
import PropQualifier, { QUALIFIERS } from '../../prop/PropQualifier.js';
const CLASS_NAME = 'Simulink.VariantBankCoderInfo';
// MATLAB's Simulink.VariantBankCoderInfo has no Value (R2027a: `isprop(Simulink.VariantBankCoderInfo,
// 'Value')` is 0, and setting one fails with "Unrecognized property 'Value' for class
// 'Simulink.VariantBankCoderInfo'."). Its properties are HeaderFile, DefinitionFile, PreStatement,
// PostStatement and Qualifier, which are also the fields of the saveobj envelope a dictionary
// holds it as. So, as for VariantBankNode (and a bus element, BaseBusElementNode), the Value
// column offers no editor and a Value edit is refused. A Value key a file already carries, which
// only this package ever wrote (MATLAB reads such a file without a warning, builds the object
// with no Value, and drops the key on its next save), is shown and written back as it was read,
// read-only. Nor has the class a Description, so none is offered and an edit of one is refused.
//
// The five properties are read out of the envelope, shown, and edited by MATLAB's own rules
// (C-169 option (b); Simulink.VariantBankCoderInfo.md has the measurements). An edit is written
// into the envelope only, the one place MATLAB's loadobj reads, and a field no edit has set is
// written as it was read: VariantBankNode's arrangement, for the same reasons.
//
// Every edit is checked first, because MATLAB checks the file: a dictionary holding a HeaderFile
// or DefinitionFile its setter would refuse loads the WHOLE coder info as defaults, and one
// holding a Qualifier not spelled as MATLAB spells it loads 'None', both with no warning
// (measured). A file a hand edit left like that is shown as read, with a warning, and saved as
// read.
//
// A text dictionary R2026b wrote holds the five as plain properties, with no envelope
// (~/delite/textsldd/dd.sldd and mix/dd_json.sldd). R2027a reads that spelling property by
// property, through the setters: a value one refuses is read as that property's default, alone,
// and a Qualifier in any case as MATLAB's own (measured). So there the five are read from, and an
// edit written into, the plain property.

// The envelope fields this node shows, which are its own property names too.
const FIELDS = ['HeaderFile', 'DefinitionFile', 'PreStatement', 'PostStatement', 'Qualifier'];

// MATLAB R2027a's refusals, verbatim. A file name's first '.'-separated part, after any leading
// spaces or tabs, must be a C identifier that does not start with 'rt' (case sensitive); that is
// checked first. Then each '/'-separated part of a header file's name must be at most 255
// characters, a leading space counted and a character that decomposes counted as its parts (on
// macOS, where it was measured: 'é' counts 2, 'ǖ' 3, '€' and '中' 1, as the file system counts a
// name). Then a header file's extension, which is what follows the last '.' of the last part of
// its path (one trailing '/' dropped), must be exactly 'h' or 'hpp'. The rest of a name is not
// checked by MATLAB as far as was measured: it took 'a.c.h', 'a. .h', 'a.b/c.h' and 'a.h/'.
const fileNameRefusal = (field: string): string =>
    `'${field}' property for Simulink.VariantBankCoderInfo must be a valid C identifier that does not start with "rt".`;
const extensionRefusal = (ext: string): string => `Change file extension '${ext}' to header file extension '.h' or '.hpp'.`;
const lengthRefusal = (value: string): string =>
    `Check specified header file name '${value}' for invalid characters, invalid file name length, and trailing spaces.`;
const NAME_MAX = 255;
const qualifierRefusal = (value: string): string =>
    `Error setting property 'Qualifier' of class 'VariantBankCoderInfo': There is no enumerated value named '${value}'.`;
// What an edit writes, of what MATLAB takes: a C identifier, then any '.'-separated parts of
// letters, digits and underscores, every shape of which MATLAB was measured to take (a header
// file's within the length above), ending in .h or .hpp for a header file. MATLAB takes some
// names beyond these (a space, a '/' or a '-' after the first part) and refuses others for a rule
// of its own not measured here (a '$' starts a token), so a name outside them is not written.
const HEADER_FILE_WRITTEN = /^[ \t]*[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]*)*\.(h|hpp)$/;
const DEFINITION_FILE_WRITTEN = /^[ \t]*[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]*)*$/;
const notCheckedRefusal = (value: string, what: string, shape: string): string =>
    `'${value}' is not a ${what} this editor can check, so it is not written: it takes a C identifier `
        + `that does not start with "rt", then any '.'-separated parts of letters, digits and underscores${shape}.`;

function firstPartRefused(value: string): boolean {
    const name = value.replace(/^[ \t]+/, '');
    const dot = name.indexOf('.');
    const first = dot < 0 ? name : name.slice(0, dot);
    return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(first) || first.startsWith('rt');
}

function headerNameTooLong(value: string): boolean {
    return value.split('/').some((part) => part.normalize('NFD').length > NAME_MAX);
}

function headerExtension(value: string): string {
    const path = value.endsWith('/') ? value.slice(0, -1) : value;
    const last = path.slice(path.lastIndexOf('/') + 1);
    const dot = last.lastIndexOf('.');
    return dot < 0 ? '' : last.slice(dot + 1);
}

// MATLAB's refusal of a file name, or null for one MATLAB takes.
function matlabRefusal(field: string, value: string): string | null {
    if (value === '') {
        return null;
    }
    if (firstPartRefused(value)) {
        return fileNameRefusal(field);
    }
    if (field === 'HeaderFile') {
        if (headerNameTooLong(value)) {
            return lengthRefusal(value);
        }
        const ext = headerExtension(value);
        if (ext !== 'h' && ext !== 'hpp') {
            return extensionRefusal(ext);
        }
    }
    return null;
}

// Why an edit of `field` to `value` is refused, or what it writes: the text as typed, but for a
// Qualifier, which MATLAB takes in any case and stores in its own.
function checkEdit(field: string, value: string): { written: string } | { reason: string } {
    if (field === 'Qualifier') {
        const canonical = QUALIFIERS.find((q) => q.toLowerCase() === value.toLowerCase());
        return canonical === undefined ? { reason: qualifierRefusal(value) } : { written: canonical };
    }
    if (field !== 'HeaderFile' && field !== 'DefinitionFile') {
        return { written: value };
    }
    const refusal = matlabRefusal(field, value);
    if (refusal !== null) {
        return { reason: refusal };
    }
    if (value !== '' && field === 'HeaderFile' && !HEADER_FILE_WRITTEN.test(value)) {
        return { reason: notCheckedRefusal(value, 'header file name', ', ending .h or .hpp') };
    }
    if (value !== '' && field === 'DefinitionFile' && !DEFINITION_FILE_WRITTEN.test(value)) {
        return { reason: notCheckedRefusal(value, 'definition file name', '') };
    }
    return { written: value };
}

// A field as the file holds it: in the saveobj envelope R2027a writes, or, where the bag has no
// envelope, the plain property a text dictionary R2026b wrote. Undefined for a field the file does
// not have, which takes no edit (there is nowhere to write one).
function fieldOf(props: Record<string, unknown> | undefined, key: string): unknown {
    if (!props) {
        return undefined;
    }
    if (SAVEOBJ_KEY in props) {
        return readSaveobjField(props, key);
    }
    return Object.prototype.hasOwnProperty.call(props, key) ? props[key] : undefined;
}

// A hand edit's text can be anything, a whole line of it included.
function quoted(text: string): string {
    return `'${text.length > 40 ? text.slice(0, 40) + '...' : text}'`;
}

const WHOLE_CODER_INFO = 'which MATLAB reads as a coder info with every property at its default';

// An earlier version of this package wrote a saveobj envelope back as `<P Name="undefined"
// Class="struct">`, in place of MATLAB's `<P Source="saveobj" PropertyType="any" Class="struct">`
// (DataNode.pxAttrs), so a dictionary it saved can hold a coder info whose five properties are in
// a property named 'undefined', with no envelope and none of the five beside it. Measured on
// R2027a (probe_coderinfo_undefined.m): a binary dictionary gives no coder info for that entry at
// all ("Data dictionary unable to create an object of class 'Simulink.VariantBankCoderInfo'."),
// and a text dictionary's plain bag so spelled is read as every default, both with no warning. A
// bag that holds any of the five as well is read from those it holds, the 'undefined' ignored
// (measured with all five, each of the five alone, and DefinitionFile and Qualifier), so it is
// not this; nor is an envelope with an 'undefined' beside it, which MATLAB reads from the
// envelope, nor a plain bag with no 'undefined' (measured too: none is warned of, by MATLAB or
// here).
const UNDEFINED_KEY = 'undefined';
function heldUnderUndefined(props: Record<string, unknown>): boolean {
    const own = (key: string) => Object.prototype.hasOwnProperty.call(props, key);
    return !(SAVEOBJ_KEY in props) && own(UNDEFINED_KEY) && !FIELDS.some(own);
}

// What MATLAB does not read as written in a coder info, one clause each, for the dictionary's
// warnings: empty for one MATLAB reads as it is. Measured by the coder info LOAD lines of
// make_variantbank_r2027a.m. From the envelope: a file name the setter refuses makes MATLAB read
// the whole coder info as defaults, a field that is not text is read as '' (a Qualifier as
// 'None'), and a Qualifier is read only in MATLAB's own spelling, so even 'const', which the
// setter takes, is read as 'None'. From R2026b's plain properties, each through its setter: a
// value it refuses is read as that property's default alone, and a Qualifier in any case as
// MATLAB's own, which is not reported. A file name MATLAB takes that an edit would not write is
// not reported either. One whose properties are held under 'undefined' (heldUnderUndefined) is
// said so, as MATLAB reads it in a binary dictionary (`binary`) or a text one.
function unreadFields(props: Record<string, unknown>, binary: boolean): string[] {
    const found: string[] = [];
    if (heldUnderUndefined(props)) {
        found.push(binary
            ? `its properties are held in a property named '${UNDEFINED_KEY}' instead of the saveobj envelope MATLAB reads, so MATLAB cannot read it at all (getting its value fails)`
            : `its properties are held in a property named '${UNDEFINED_KEY}' instead of as its own, ${WHOLE_CODER_INFO}`);
    }
    const plain = !(SAVEOBJ_KEY in props);
    for (const [field, what] of [['HeaderFile', 'header file name'], ['DefinitionFile', 'definition file name']]) {
        const value = fieldOf(props, field);
        const refusal = typeof value === 'string' ? matlabRefusal(field, value) : null;
        if (typeof value === 'string' && refusal !== null) {
            // The name is quoted cut short, so a refusal for its length says so.
            const why = refusal === lengthRefusal(value)
                ? ` (it is longer than the ${NAME_MAX} characters MATLAB takes in a file or folder name)` : '';
            found.push(`its ${field} ${quoted(value)} is not a ${what} MATLAB takes${why}, ${plain ? "which MATLAB reads as ''" : WHOLE_CODER_INFO}`);
        }
    }
    for (const field of FIELDS) {
        const value = fieldOf(props, field);
        if (value !== undefined && typeof value !== 'string') {
            found.push(`its ${field} is not text, which MATLAB reads as ${field === 'Qualifier' ? "'None'" : "''"}`);
        }
    }
    const qualifier = fieldOf(props, 'Qualifier');
    if (typeof qualifier === 'string') {
        if (plain && !QUALIFIERS.some((q) => q.toLowerCase() === qualifier.toLowerCase())) {
            found.push(`its Qualifier ${quoted(qualifier)} is not None, Const, Volatile or ConstVolatile, which MATLAB reads as 'None'`);
        } else if (!plain && !QUALIFIERS.includes(qualifier)) {
            found.push(`its Qualifier ${quoted(qualifier)} is not None, Const, Volatile or ConstVolatile as MATLAB spells them, which MATLAB reads as 'None'`);
        }
    }
    return found;
}

// A read field's text: '' for a field the file does not have.
function textOf(value: unknown): string {
    return value === undefined ? '' : formatReadValue(value);
}

export default class VariantBankCoderInfoNode extends SimulinkObjectNode {
    Value: unknown;
    // Whether the file carried a Value key at all. MATLAB's own entries never do, and showing
    // their absent one as `''` implied a char value the class does not have.
    readonly _valueInFile: boolean;
    // The five fields, as shown: each its text as read, or as an edit wrote it.
    HeaderFile: string;
    DefinitionFile: string;
    PreStatement: string;
    PostStatement: string;
    Qualifier: string;
    // The fields an edit has set, with the value each is written as. Only these are written over
    // what the file held (_mergeProps).
    _editedFields: Map<string, unknown>;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) {
        super(name, parent, serial);
        this._valueInFile = props.Value !== undefined;
        this.Value = this._valueInFile ? props.Value : '';
        this.HeaderFile = textOf(fieldOf(props, 'HeaderFile'));
        this.DefinitionFile = textOf(fieldOf(props, 'DefinitionFile'));
        this.PreStatement = textOf(fieldOf(props, 'PreStatement'));
        this.PostStatement = textOf(fieldOf(props, 'PostStatement'));
        this.Qualifier = textOf(fieldOf(props, 'Qualifier'));
        this._editedFields = new Map();
    }
    get icon(): string { return 'wsParameters_bankCoderInfo'; }
    get className(): string { return CLASS_NAME; }
    get displayValue(): string { return this._valueInFile ? PropValue.format(this.Value) : ''; }
    // The column stays, read-only, for a Value a file already carries.
    get valueEditable(): boolean { return false; }
    // MATLAB's class has no Description (decision D11, as for a Variant Control): no editor is
    // offered, and DataNode's setProperty refuses one, which both save paths used to drop.
    get descriptionEditable(): boolean { return false; }
    getProperties(): PropClass[] {
        return [
            PropName, PropValue, PropDataType,
            PropCoderInfoHeaderFile, PropCoderInfoDefinitionFile, PropPreStatement, PropPostStatement, PropQualifier,
        ] as unknown as PropClass[];
    }
    // PI layout: schema-driven "General" and "Code Generation" groups (classes/variantBankCoderInfo.json).
    // A Value edit is refused rather than taken: DataNode's generic tail would keep the text, mark
    // the entry Modified and answer `true`, and the file would gain a key MATLAB ignores. One still
    // in the encoded stream it was read from keeps that refusal's own reason.
    setProperty(propName: string, stringValue: string): true | SetPropertyResult {
        // One whose properties are held beside its class, which the save writes back as read, refuses
        // every edit but a rename in one message (DataNode._refuseInlineBagEdit).
        const inlineRefusal = this._refuseInlineBagEdit(propName, stringValue);
        if (inlineRefusal) {
            return inlineRefusal;
        }
        const resolved = this._resolveProperty(propName);
        if (resolved === 'Value') {
            return (
                this._refuseEncodedEdit(propName, stringValue) ?? {
                    error: true,
                    reason: `'${this.displayName}' is a ${this.className}, which has no Value, so none can be set on it.`,
                    invalidValue: stringValue,
                    validValue: this.displayValue,
                }
            );
        }
        if (!FIELDS.includes(resolved)) {
            return super.setProperty(propName, stringValue);
        }
        // Its own shown text, set back, is no edit (DataNode._isUnchangedCommit).
        if (this._isUnchangedCommit(propName, stringValue)) {
            return true;
        }
        const encodedRefusal = this._refuseEncodedEdit(propName, stringValue);
        if (encodedRefusal) {
            return encodedRefusal;
        }
        const prop = this._propFor(resolved)!;
        const refuse = (reason: string): SetPropertyResult => ({
            error: true,
            reason,
            invalidValue: stringValue,
            validValue: this.getPropInfo(prop).displayValue,
        });
        // An edit is written into the field the file holds (the envelope's, or R2026b's plain
        // property), so a field the file does not have, which only a hand edit leaves, has
        // nowhere to go.
        if (fieldOf(this.serial._properties as Record<string, unknown>, resolved) === undefined) {
            return refuse(`'${this.displayName}' was read with no ${resolved} in its saved form, so a ${prop.displayName} edit has nowhere to be saved.`);
        }
        const checked = checkEdit(resolved, stringValue);
        if ('reason' in checked) {
            return refuse(checked.reason);
        }
        (this as unknown as Record<string, unknown>)[resolved] = checked.written;
        this._editedFields.set(resolved, checked.written);
        this._markModified();
        return true;
    }
    // For DataModel.editProperty: what puts an envelope field back exactly as it is now, for the
    // undo of an edit about to be made. The text a field shows does not always set it back: a hand
    // edit's number shows as '5', and its Qualifier 'const' would be set back as 'Const'.
    _restorerFor(propName: string): (() => void) | null {
        const resolved = this._resolveProperty(propName);
        if (!FIELDS.includes(resolved)) {
            return null;
        }
        const self = this as unknown as Record<string, unknown>;
        const shown = self[resolved];
        const edited = this._editedFields.has(resolved);
        const written = this._editedFields.get(resolved);
        return () => {
            self[resolved] = shown;
            if (edited) {
                this._editedFields.set(resolved, written);
            } else {
                this._editedFields.delete(resolved);
            }
            this._markModified();
        };
    }
    // Nothing beside the envelope: the bag is written as it was read, so a file's own Value key
    // (and only that) passes through `_mergeProps` unchanged, and no new one is ever written.
    _serializedOverrides(): Record<string, unknown> { return {}; }
    // Both save paths merge through here (SimulinkObjectNode), so the edited fields are written
    // into the envelope here, and only there, as VariantBankNode writes its own; or, in a bag with
    // no envelope, into the plain property R2026b wrote. Every other field is the file's.
    _mergeProps(propOverrides: Record<string, unknown>): Record<string, unknown> {
        const merged = super._mergeProps(propOverrides);
        if (this._editedFields.size === 0) {
            return merged;
        }
        if (!(SAVEOBJ_KEY in merged)) {
            for (const [field, value] of this._editedFields) {
                if (Object.prototype.hasOwnProperty.call(merged, field)) {
                    merged[field] = value;
                }
            }
            return merged;
        }
        let envelope = merged[SAVEOBJ_KEY];
        for (const [field, value] of this._editedFields) {
            envelope = writeIntoSaveobj(envelope, field, value);
        }
        merged[SAVEOBJ_KEY] = envelope;
        return merged;
    }
    static get defaultName(): string { return 'VariantBankCoderInfo'; }
    // A saveobj envelope, as VariantBankNode's is, and nothing beside it: MATLAB has no `Value`
    // property on this class, so none is written.
    // The only field here whose default is not empty is Qualifier, which MATLAB defaults to the
    // string 'None' — every field is a plain char, so this class's envelope is spelled
    // identically in both formats. Measured from a MATLAB-written dictionary.
    static createDefault(name: string, parent: BaseNode | null): VariantBankCoderInfoNode { const rawVal = VariantBankCoderInfoNode._defaultCustomSaveRawVal(CLASS_NAME, ['HeaderFile', 'DefinitionFile', 'PreStatement', 'PostStatement', 'Qualifier'], { HeaderFile: '', DefinitionFile: '', PreStatement: '', PostStatement: '', Qualifier: 'None' }); const props = VariantBankCoderInfoNode._propsOf(rawVal); return new VariantBankCoderInfoNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
    // A coder info MATLAB would not read as written is said so, for the dictionary's warnings, and
    // shown as read: recorded as a value read in part, as VariantBankNode.parse records a bank's.
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): VariantBankCoderInfoNode {
        const props = VariantBankCoderInfoNode._propsOf(rawVal);
        const node = new VariantBankCoderInfoNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>);
        const unread = unreadFields(props, node._ownerFormat() === 'xml');
        if (unread.length > 0) {
            recordPartialDecode(
                `"${name}" holds a ${CLASS_NAME} MATLAB does not read as written: ${unread.join('; ')}. `
                    + 'It is shown as read, and saved as read unless edited.',
            );
        }
        return node;
    }
}
