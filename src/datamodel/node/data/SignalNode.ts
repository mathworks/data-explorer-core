// Copyright 2026 The MathWorks, Inc.

import DataNode, { objectValueClassOf } from '../DataNode.js';
import type { SetPropertyResult } from '../DataNode.js';
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import type { PropClass, PIGroupDef } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
import PropMin from '../../prop/PropMin.js';
import PropMax from '../../prop/PropMax.js';
import PropUnit from '../../prop/PropUnit.js';
import PropDescription from '../../prop/PropDescription.js';
import PropSignalComplexity from '../../prop/PropSignalComplexity.js';
import PropSignalDimensionsMode from '../../prop/PropSignalDimensionsMode.js';
import { withSourceKeys } from './BaseBusNode.js';
import { schemaColumns } from '../schemaBridge.js';
import { oneWrite, writeUnderWay } from '../../parser/MatWriter.js';

const CLASS_NAME = 'Simulink.Signal';

// Complexity and DimensionsMode are editable node fields, so the table and the Property Inspector
// read them through these atoms (the Signal's own enums, auto included) rather than through the
// schema descriptors, which read the source bag and are labels. In place, by key, so the column
// order and the schema layout's order stay what the schema authored. The schema keeps both
// descriptors: Parameter's complexity is one too, and stays a label, derived from its Value.
const ENUM_ATOMS = new Map<string, PropClass>([
    ['complexity', PropSignalComplexity as unknown as PropClass],
    ['dimensionsMode', PropSignalDimensionsMode as unknown as PropClass],
]);
const withEnumAtoms = (props: PropClass[]): PropClass[] => props.map((p) => ENUM_ATOMS.get(p.key) ?? p);

export default class SignalNode extends DataNode {
    DataType: string;
    Min: number | undefined;
    Max: number | undefined;
    Unit: string;
    Description: string;
    // MATLAB's default for both is 'auto', and a text dictionary leaves the key out at 'auto'
    // (measured in R2027a), so an absent key reads as 'auto'.
    Complexity: string;
    DimensionsMode: string;

    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) {
        super(name, parent, serial);
        // A Signal's declared data type, on the same terms as ParameterNode's:
        // 'auto' when the key is absent, because that is MATLAB's default and not a
        // missing value. Both `DataType_internal` and `DataType` are read for the
        // same reason BusNode reads both — a .sldd may store either spelling.
        // Display-only; _getSerializedProperties copies the on-disk bag, so this
        // default is never written back into a file that did not have it.
        const rawDataType = props.DataType_internal !== undefined ? props.DataType_internal : props.DataType;
        this.DataType = (rawDataType as string) || 'auto';
        this.Min = props.Min as number | undefined;
        this.Max = props.Max as number | undefined;
        this.Unit = (props.DocUnits as string) || (props.Unit as string) || '';
        this.Description = (props.Description as string) || '';
        this.Complexity = (props.Complexity as string) || 'auto';
        this.DimensionsMode = (props.DimensionsMode as string) || 'auto';
    }

    get icon(): string { return this.isDerived ? 'serviceInterfaces' : 'wsSignal'; }
    // Report the class the FILE actually holds — same reason as ParameterNode's:
    // mpt.Signal is parsed by this node and must still show as mpt.Signal in the
    // Class column, inheriting only the treatment. CLASS_NAME is the fallback for a
    // node with no parsed value behind it.
    get className(): string { const raw = this.serial._rawVal as Record<string, unknown> | undefined; return (raw && objectValueClassOf(raw)) || CLASS_NAME; }
    // A Signal has no scalar "value" — the Value column is empty and not editable.
    get displayValue(): string { return ''; }
    get valueEditable(): boolean { return false; }

    // Same argument as ParameterNode.dataType: a Signal's DataType IS a real data
    // type ('single', 'boolean', 'auto', an AliasType name), so it belongs in the
    // Data Type column. Without this the column and the PI row were blank for
    // every Signal in every channel even though all four carry the key.
    get dataType(): string { return this.DataType; }

    getProperties(): PropClass[] { return [PropName, withSourceKeys(PropDataType, ['DataType', 'DataType_internal']), PropMin, PropMax, PropUnit, PropDescription, ...withEnumAtoms(schemaColumns(this.className))]; }
    // PI layout is declarative (schema/classes/signal.json `layout`, resolved by buildPILayout),
    // with the two enum atoms in place of their descriptors, so an edit the table makes shows in
    // the PI too (ValueTypeNode.getPILayout gives the full account of that gap).
    getPILayout(): PIGroupDef[] | null {
        const layout = super.getPILayout();
        return layout && layout.map((g) => ({ ...g, items: withEnumAtoms(g.items) }));
    }

    setProperty(propName: string, stringValue: string): true | SetPropertyResult {
        // Its own shown text, set back, is no edit (DataNode._isUnchangedCommit).
        if (this._isUnchangedCommit(propName, stringValue)) {
            return true;
        }
        // A value still in the encoded stream it was read from is read-only (DataNode._refuseEncodedEdit).
        const encodedRefusal = this._refuseEncodedEdit(propName, stringValue);
        if (encodedRefusal) {
            return encodedRefusal;
        }
        if (propName === 'Min' || propName === 'Max') {
            return this._setMinMax(propName, stringValue);
        }
        // Complexity and DimensionsMode take only the Signal's own enumerals, as MATLAB does;
        // the shared check reads the set off the atom the dropdown is built from. Only these
        // two: Storage Class is a select too, and the schema path refuses it in its own words.
        if (ENUM_ATOMS.has(propName)) {
            const notAnEnumeral = this._rejectUnknownEnumeral(propName, stringValue);
            if (notAnEnumeral) {
                return notAnEnumeral;
            }
        }
        return DataNode.prototype.setProperty.call(this, propName, stringValue);
    }

    _getSerializedProperties(): Record<string, unknown> {
        const sp = this.serial._properties as Record<string, unknown>;
        const unitKey = 'DocUnits' in sp ? 'DocUnits' : 'Unit';
        const props = { ...sp };
        if ('Min' in sp || this.Min !== undefined) { props.Min = this.Min !== undefined ? this.Min : []; }
        if ('Max' in sp || this.Max !== undefined) { props.Max = this.Max !== undefined ? this.Max : []; }
        if (unitKey in sp || this.Unit) { props[unitKey] = this.Unit; }
        if ('Description' in sp || this.Description) { props.Description = this.Description; }
        Object.assign(props, this._enumOverrides(sp));
        return props;
    }

    serializeValue(): unknown {
        if (!writeUnderWay()) {
            return oneWrite(() => this.serializeValue());
        }
        const sp = this.serial._properties as Record<string, unknown>;
        const unitKey = 'DocUnits' in sp ? 'DocUnits' : 'Unit';
        const overrides: Record<string, unknown> = {};
        if ('Min' in sp || this.Min !== undefined) { overrides.Min = this.Min; }
        if ('Max' in sp || this.Max !== undefined) { overrides.Max = this.Max; }
        if (unitKey in sp || this.Unit) { overrides[unitKey] = this.Unit; }
        if ('Description' in sp || this.Description) { overrides.Description = this.Description; }
        Object.assign(overrides, this._enumOverrides(sp));
        return this._serializeSimulinkObject(overrides);
    }

    // Complexity and DimensionsMode, as both save paths write them: the key when the file had
    // it, or when the value is not MATLAB's default. MATLAB's text form has a non-default value
    // as a top-level key and no key at 'auto', even for a Signal set to 'complex' and back
    // (measured in R2027a), so a Signal whose text file had no key saves with none until it
    // leaves 'auto'. A key the file had stays, at 'auto' if set there, which MATLAB reads the
    // same; a binary file always has both keys. A clear stores '' (DataNode._rejectUnknownEnumeral),
    // which is no value either property has, so it is written as 'auto', what an absent key
    // means, and never as ''.
    _enumOverrides(sp: Record<string, unknown>): Record<string, unknown> {
        const overrides: Record<string, unknown> = {};
        const complexity = this.Complexity || 'auto';
        if ('Complexity' in sp || complexity !== 'auto') { overrides.Complexity = complexity; }
        const dimensionsMode = this.DimensionsMode || 'auto';
        if ('DimensionsMode' in sp || dimensionsMode !== 'auto') { overrides.DimensionsMode = dimensionsMode; }
        return overrides;
    }

    static get defaultName(): string { return 'Signal'; }

    static createDefault(name: string, parent: BaseNode | null): SignalNode {
        // Verified property-for-property against MATLAB R2027a's own default `Simulink.Signal`:
        // these two nested objects, in this order, and nothing else — no Dimensions, no
        // Complexity, no DataType. Left exactly as it was; only the CoderInfo literal moved to the
        // shared helper.
        const rawVal = SimulinkObjectNode._defaultRawVal(CLASS_NAME, { CoderInfo: SimulinkObjectNode._defaultCoderInfo('Signal'), LoggingInfo: { _object_class: 'Simulink.LoggingInfo', _properties: {} } });
        const props = SimulinkObjectNode._propsOf(rawVal);
        return new SignalNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>);
    }

    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): SignalNode {
        const elem = rawVal._elements && (rawVal._elements as unknown[])[0];
        const props = ((elem && (elem as Record<string, unknown>)._properties) || {}) as Record<string, unknown>;
        const serial = { _rawVal: rawVal, _properties: props };
        return new SignalNode(name, parent, props, serial as Record<string, unknown>);
    }
}
