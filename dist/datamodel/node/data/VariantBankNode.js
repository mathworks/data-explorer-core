// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import { readSaveobjField, writeIntoSaveobj } from '../DataNode.js';
import { SAVEOBJ_KEY } from '../../parser/XmlUtils.js';
import MatlabValueParser from '../../parser/MatlabValueParser.js';
import { recordPartialDecode } from '../../parser/EncodedValue.js';
import { checkVariantCondition, conditionCannotParse } from '../../variantCondition.js';
import PropName from '../../prop/PropName.js';
import PropValue from '../../prop/PropValue.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
import PropBankName from '../../prop/PropBankName.js';
import PropVariantConditions, { formatReadValue } from '../../prop/PropVariantConditions.js';
import PropAllChoicesCoderInfo from '../../prop/PropAllChoicesCoderInfo.js';
import PropActiveChoiceCoderInfo from '../../prop/PropActiveChoiceCoderInfo.js';
const CLASS_NAME = 'Simulink.VariantBank';
// MATLAB's Simulink.VariantBank has no Value (R2027a: `isprop(Simulink.VariantBank, 'Value')`
// is 0, and setting one fails with "Unrecognized property 'Value' for class
// 'Simulink.VariantBank'."). Its properties are Name, Description, VariantConditions,
// AllChoicesCoderInfo and ActiveChoiceCoderInfo, and the saveobj envelope a dictionary holds it
// as adds the Hidden BankCoderInfo. So the Value column offers no editor
// and a Value edit is refused, as a bus element's is (BaseBusElementNode). A Value key a file
// already carries, which only this package ever wrote (MATLAB reads such a file without a
// warning, builds a bank with no Value, and drops the key on its next save), is shown and
// written back as it was read, read-only.
//
// The five properties are read out of the envelope, shown, and edited by MATLAB's own rules
// (C-168 option (b); Simulink.VariantBank.md has the measurements). The bank's own Name is shown
// as Bank Name, because the entry's Name is the row's. An edit is written into the envelope
// only, the one place MATLAB's loadobj reads, and a field no edit has set is written as it was
// read. BankCoderInfo is Hidden in MATLAB, so it is not shown, and it is written as read.
//
// Every edit is checked first, because MATLAB checks the file: a dictionary holding a bank
// whose Name, coder info names or any condition its setter would refuse loads the WHOLE bank
// as defaults, with no warning (measured). A file a hand edit left like that is shown as read,
// with a warning, and saved as read.
//
// A text dictionary R2026b wrote holds a bank as plain properties, with no envelope, as it holds
// a coder info (VariantBankCoderInfoNode). R2027a reads that spelling property by property,
// through the setters, with no warning: a value one refuses is read as that property's default
// alone, not the whole bank's, a char VariantConditions (which the setter refuses) as no
// conditions, and BankCoderInfo independently of the two coder infos (measured:
// test/parity/matlab/probe_variantbank_plain.m). So there the fields are read from, and an edit
// written into, the plain property, and the warnings say what MATLAB does there.
// The envelope fields this node shows, by node property, with MATLAB's name for each.
const FIELDS = {
    BankName: 'Name',
    Description: 'Description',
    VariantConditions: 'VariantConditions',
    AllChoicesCoderInfo: 'AllChoicesCoderInfo',
    ActiveChoiceCoderInfo: 'ActiveChoiceCoderInfo',
};
// MATLAB R2027a's refusals, verbatim, and the rules they state (measured: a Name may be '', start
// with an underscore, be a C or MATLAB keyword and have any length, and may not start with 'rt',
// case sensitive; a coder info name may be '', 'end', 'rtX' and any length, and may not be '_a'
// or 'a.b').
const NAME_RULE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NAME_REFUSAL = `'Name' property for Simulink.VariantBank must be a valid C identifier that does not start with "rt".`;
const CODER_INFO_RULE = /^[A-Za-z][A-Za-z0-9_]*$/;
const coderInfoRefusal = (field, value) => `'${field}' value '${value}' must be a valid variable name corresponding to Simulink.VariantBankCoderInfo object.`;
const NOT_A_CELL = `'VariantConditions' property for Simulink.VariantBank must be a cell array.`;
const NOT_A_STRING = `Conditions defined in 'VariantConditions' property must be a scalar string.`;
function nameIsValid(value) {
    return value === '' || (NAME_RULE.test(value) && !value.startsWith('rt'));
}
function coderInfoIsValid(value) {
    return value === '' || CODER_INFO_RULE.test(value);
}
// A cell of conditions as MATLAB stores one: 1xN whatever shape it was typed in (a 2x1 is stored
// 1x2, a 2x2 1x4 in column order), and 1x0 for none.
function conditionsCell(conditions) {
    return { _array_type: 'Cell', _dimensions: [1, conditions.length], _elements: conditions };
}
// The text an edit types, as the cell it writes, or why it is refused: a cell (or a string
// array, which MATLAB also takes) of conditions, each checked and spelled by variantCondition.
function parseConditions(text) {
    const parsed = MatlabValueParser.parse(text);
    let items;
    if (parsed && parsed.type === 'cell') {
        items = parsed.value;
    }
    else if (parsed && (parsed.type === 'string' || parsed.type === 'string-array')) {
        items = Array.isArray(parsed.value) ? parsed.value : [parsed.value];
    }
    else {
        return { reason: NOT_A_CELL };
    }
    const conditions = [];
    for (const item of items) {
        // A cell's string element arrives as a one-element array (MatlabValueParser).
        const condition = typeof item === 'string' ? item : Array.isArray(item) && item.length === 1 && typeof item[0] === 'string' ? item[0] : null;
        if (condition === null) {
            return { reason: NOT_A_STRING };
        }
        const checked = checkVariantCondition(condition);
        if ('reason' in checked) {
            return { reason: checked.reason };
        }
        conditions.push(checked.condition);
    }
    return { cell: conditionsCell(conditions) };
}
// A hand edit's text can be anything, a whole line of it included.
function quoted(text) {
    return `'${text.length > 40 ? text.slice(0, 40) + '...' : text}'`;
}
const WHOLE_BANK = 'which MATLAB reads as a bank with every property at its default';
// A field as the file holds it: in the saveobj envelope R2027a writes, or, where the bag has no
// envelope, the plain property a text dictionary R2026b wrote (VariantBankCoderInfoNode's
// `fieldOf`). Undefined for a field the file does not have, which takes no edit (there is nowhere
// to write one).
function fieldOf(props, key) {
    if (!props) {
        return undefined;
    }
    if (SAVEOBJ_KEY in props) {
        return readSaveobjField(props, key);
    }
    return Object.prototype.hasOwnProperty.call(props, key) ? props[key] : undefined;
}
// What MATLAB does not read as written in a bank, one clause each, for the dictionary's warnings:
// empty for a bank MATLAB reads as it is. From the envelope, measured by the LOAD lines of
// make_variantbank_r2027a.m: a value the setter refuses makes MATLAB read the whole bank as
// defaults, a Name or Description that is not text is read as '', and a VariantConditions that
// is neither a cell nor text as no conditions. A char VariantConditions is read as a cell of that
// one condition, and an unspaced condition is read in MATLAB's own spelling, so neither is said;
// nor is a condition outside the editor's language that MATLAB can parse (conditionCannotParse).
// From R2026b's plain properties, measured by probe_variantbank_plain.m, each through its setter:
// a value it refuses is read as that property's default alone ('' for a name, no conditions for
// VariantConditions), a char VariantConditions included.
function unreadFields(props) {
    const found = [];
    const plain = !(SAVEOBJ_KEY in props);
    const refused = (byDefault) => (plain ? `which MATLAB reads as ${byDefault}` : WHOLE_BANK);
    const name = fieldOf(props, 'Name');
    if (typeof name === 'string' && !nameIsValid(name)) {
        found.push(`its Name ${quoted(name)} is not a valid C identifier that does not start with "rt", ${refused("''")}`);
    }
    else if (name !== undefined && typeof name !== 'string') {
        found.push(`its Name is not text, which MATLAB reads as ''`);
    }
    const description = fieldOf(props, 'Description');
    if (description !== undefined && typeof description !== 'string') {
        found.push(`its Description is not text, which MATLAB reads as ''`);
    }
    const vc = fieldOf(props, 'VariantConditions');
    if (typeof vc === 'string' && !plain) {
        if (conditionCannotParse(vc)) {
            found.push(`its condition ${quoted(vc)} does not parse, ${WHOLE_BANK}`);
        }
    }
    else if (vc !== undefined) {
        if (!vc || typeof vc !== 'object' || vc._array_type !== 'Cell' || !Array.isArray(vc._elements)) {
            found.push('its VariantConditions is not a cell, which MATLAB reads as no conditions');
        }
        else {
            vc._elements.forEach((c, i) => {
                if (typeof c !== 'string') {
                    found.push(`its condition at position ${i + 1} is not text, ${refused('no conditions')}`);
                }
                else if (c.trim() === '') {
                    found.push(`its condition at position ${i + 1} is empty, ${refused('no conditions')}`);
                }
                else if (conditionCannotParse(c)) {
                    found.push(`its condition ${quoted(c)} does not parse, ${refused('no conditions')}`);
                }
            });
        }
    }
    for (const field of ['AllChoicesCoderInfo', 'ActiveChoiceCoderInfo', 'BankCoderInfo']) {
        const value = fieldOf(props, field);
        if (typeof value === 'string' && !coderInfoIsValid(value)) {
            found.push(`its ${field} ${quoted(value)} is not a valid variable name, ${refused("''")}`);
        }
        else if (value !== undefined && typeof value !== 'string') {
            found.push(plain ? `its ${field} is not text, which MATLAB reads as ''` : `its ${field} is not text`);
        }
    }
    return found;
}
// A read field's text: '' for a field the envelope does not have.
function textOf(value) {
    return value === undefined ? '' : formatReadValue(value);
}
export default class VariantBankNode extends SimulinkObjectNode {
    constructor(name, parent, props, serial) {
        super(name, parent, serial);
        this._valueInFile = props.Value !== undefined;
        this.Value = this._valueInFile ? props.Value : '';
        this.BankName = textOf(fieldOf(props, 'Name'));
        // From the envelope, where MATLAB writes it, or R2026b's plain property. A Description key
        // beside the envelope, which no writer leaves and MATLAB does not read, is shown when the
        // envelope has none, rather than hidden: the Description row claims that key, so "Other"
        // does not list it.
        const description = fieldOf(props, 'Description');
        this.Description = description !== undefined ? textOf(description) : textOf(props.Description);
        const vc = fieldOf(props, 'VariantConditions');
        this.VariantConditions = vc === undefined ? VariantBankNode._emptyCell() : vc;
        this.AllChoicesCoderInfo = textOf(fieldOf(props, 'AllChoicesCoderInfo'));
        this.ActiveChoiceCoderInfo = textOf(fieldOf(props, 'ActiveChoiceCoderInfo'));
        this._editedFields = new Map();
    }
    get icon() { return 'wsParameters_bank'; }
    get className() { return CLASS_NAME; }
    get displayValue() { return this._valueInFile ? PropValue.format(this.Value) : ''; }
    // The column stays, read-only, for a Value a file already carries.
    get valueEditable() { return false; }
    getProperties() {
        return [
            PropName, PropValue, PropDataType, PropDescription,
            PropBankName, PropVariantConditions, PropAllChoicesCoderInfo, PropActiveChoiceCoderInfo,
        ];
    }
    // Of a class with no Value, said as its setter says it (DataNode._offerRefusal).
    _unofferedValueRefusal(stringValue) {
        return this._noValueRefusal(stringValue);
    }
    // PI layout: schema-driven "General" and "Variant Bank" groups (classes/variantBank.json).
    // A Value edit is refused rather than taken: DataNode's generic tail would keep the text,
    // mark the entry Modified and answer `true`, and the file would gain a key MATLAB ignores.
    // One still in the encoded stream it was read from keeps that refusal's own reason.
    _setProperty(propName, stringValue) {
        // One whose properties are held beside its class, which the save writes back as read, refuses
        // every edit but a rename in one message (DataNode._refuseInlineBagEdit).
        const inlineRefusal = this._refuseInlineBagEdit(propName, stringValue);
        if (inlineRefusal) {
            return inlineRefusal;
        }
        const resolved = this._resolveProperty(propName);
        if (resolved === 'Value') {
            return this._refuseEncodedEdit(propName, stringValue) ?? this._noValueRefusal(stringValue);
        }
        if (!Object.prototype.hasOwnProperty.call(FIELDS, resolved)) {
            return super._setProperty(propName, stringValue);
        }
        // Its own shown text, set back, is no edit (DataNode._isUnchangedCommit).
        if (this._isUnchangedCommit(propName, stringValue)) {
            return true;
        }
        const encodedRefusal = this._refuseEncodedEdit(propName, stringValue);
        if (encodedRefusal) {
            return encodedRefusal;
        }
        const field = FIELDS[resolved];
        const prop = this._propFor(resolved);
        const refuse = (reason) => ({
            error: true,
            reason,
            invalidValue: stringValue,
            validValue: this.getPropInfo(prop).displayValue,
        });
        // An edit is written into the field the file holds (the envelope's, or R2026b's plain
        // property), so a field the file does not have, which only a hand edit leaves, has
        // nowhere to go.
        if (fieldOf(this.serial._properties, field) === undefined) {
            return refuse(`'${this.displayName}' was read with no ${field} in its saved form, so a ${prop.displayName} edit has nowhere to be saved.`);
        }
        let written = stringValue;
        if (field === 'Name' && !nameIsValid(stringValue)) {
            return refuse(NAME_REFUSAL);
        }
        if ((field === 'AllChoicesCoderInfo' || field === 'ActiveChoiceCoderInfo') && !coderInfoIsValid(stringValue)) {
            return refuse(coderInfoRefusal(field, stringValue));
        }
        if (field === 'VariantConditions') {
            const parsed = parseConditions(stringValue);
            if ('reason' in parsed) {
                return refuse(parsed.reason);
            }
            written = parsed.cell;
        }
        this[resolved] = written;
        this._editedFields.set(field, written);
        this._markModified();
        return true;
    }
    // For DataModel.editProperty: what puts an envelope field back exactly as it is now, for the
    // undo of an edit about to be made. The text a field shows does not always set it back: a
    // hand edit's char VariantConditions shows as 'V==1', which an edit refuses as not a cell.
    _restorerFor(propName) {
        const resolved = this._resolveProperty(propName);
        if (!Object.prototype.hasOwnProperty.call(FIELDS, resolved)) {
            return null;
        }
        const field = FIELDS[resolved];
        const self = this;
        const shown = self[resolved];
        const edited = this._editedFields.has(field);
        const written = this._editedFields.get(field);
        return () => {
            self[resolved] = shown;
            if (edited) {
                this._editedFields.set(field, written);
            }
            else {
                this._editedFields.delete(field);
            }
            this._markModified();
        };
    }
    // Nothing beside the envelope: the bag is written as it was read, so a file's own Value key
    // (and only that) passes through `_mergeProps` unchanged, and no new one is ever written.
    _serializedOverrides() { return {}; }
    // Both save paths merge through here (SimulinkObjectNode), so the edited fields are written
    // into the envelope here, and only there: an override would also be written beside it by
    // `_mergeProps`, which is the invented key C-168(a) removed. Or, in a bag with no envelope,
    // into the plain property R2026b wrote, as VariantBankCoderInfoNode writes its own. Every
    // other field is the file's.
    _mergeProps(propOverrides) {
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
    static get defaultName() { return 'VariantBank'; }
    // A saveobj envelope, for the reason VariantVariableNode's carries one, and nothing beside
    // it: MATLAB has no `Value` property on this class at all, so the `{ Value: '' }` this used
    // to write was pure invention. Fields, order and defaults measured from a MATLAB-written
    // dictionary.
    static createDefault(name, parent) { const rawVal = VariantBankNode._defaultCustomSaveRawVal(CLASS_NAME, ['Name', 'Description', 'VariantConditions', 'AllChoicesCoderInfo', 'ActiveChoiceCoderInfo', 'BankCoderInfo'], { Name: '', Description: '', VariantConditions: VariantBankNode._emptyCell(), AllChoicesCoderInfo: '', ActiveChoiceCoderInfo: '', BankCoderInfo: '' }); const props = VariantBankNode._propsOf(rawVal); return new VariantBankNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
    // A bank MATLAB would not read as written is said so, for the dictionary's warnings, and
    // shown as read. Recorded as a value read in part, which SlddNode.parse files against the
    // entry it is reading, as notAnElement's report is; a paste has no sink, and drops it.
    static parse(rawVal, name, parent) {
        const props = VariantBankNode._propsOf(rawVal);
        const node = new VariantBankNode(name, parent, props, { _rawVal: rawVal, _properties: props });
        const unread = unreadFields(props);
        if (unread.length > 0) {
            recordPartialDecode(`"${name}" holds a ${CLASS_NAME} MATLAB does not read as written: ${unread.join('; ')}. `
                + 'It is shown as read, and saved as read unless edited.');
        }
        return node;
    }
}
//# sourceMappingURL=VariantBankNode.js.map