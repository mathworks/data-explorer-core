// Copyright 2026 The MathWorks, Inc.

import DataNode from '../DataNode.js';
import type { SetPropertyResult } from '../DataNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
import PropMin from '../../prop/PropMin.js';
import PropMax from '../../prop/PropMax.js';
import PropUnit from '../../prop/PropUnit.js';
import PropDescription from '../../prop/PropDescription.js';
import { withSourceKeys } from './BaseBusNode.js';
import { schemaColumns } from '../schemaBridge.js';

const CLASS_NAME = 'Simulink.Signal';

export default class SignalNode extends DataNode {
    DataType: string;
    Min: number | undefined;
    Max: number | undefined;
    Unit: string;
    Description: string;

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
    }

    get icon(): string { return this.isDerived ? 'serviceInterfaces' : 'wsSignal'; }
    get className(): string { return CLASS_NAME; }
    // A Signal has no scalar "value" — the Value column is empty and not editable.
    get displayValue(): string { return ''; }
    get valueEditable(): boolean { return false; }

    // Same argument as ParameterNode.dataType: a Signal's DataType IS a real data
    // type ('single', 'boolean', 'auto', an AliasType name), so it belongs in the
    // Data Type column. Without this the column and the PI row were blank for
    // every Signal in every channel even though all four carry the key.
    get dataType(): string { return this.DataType; }

    getProperties(): PropClass[] { return [PropName, withSourceKeys(PropDataType, ['DataType', 'DataType_internal']), PropMin, PropMax, PropUnit, PropDescription, ...schemaColumns(this.className)]; }
    // PI layout is now declarative — see schema/classes/signal.json `layout`,
    // resolved by the inherited BaseNode.getPILayout via buildPILayout.

    setProperty(propName: string, stringValue: string): true | SetPropertyResult {
        if (propName === 'Min' || propName === 'Max') {
            return this._setMinMax(propName, stringValue);
        }
        return DataNode.prototype.setProperty.call(this, propName, stringValue);
    }

    _getSerializedProperties(): Record<string, unknown> {
        const sp = this.serial._properties as Record<string, unknown>;
        const unitKey = 'DocUnits' in sp ? 'DocUnits' : 'Unit';
        const props = Object.assign({}, sp);
        if ('Min' in sp || this.Min !== undefined) { props.Min = this.Min !== undefined ? this.Min : []; }
        if ('Max' in sp || this.Max !== undefined) { props.Max = this.Max !== undefined ? this.Max : []; }
        if (unitKey in sp || this.Unit) { props[unitKey] = this.Unit; }
        if ('Description' in sp || this.Description) { props.Description = this.Description; }
        return props;
    }

    serializeValue(): unknown {
        const sp = this.serial._properties as Record<string, unknown>;
        const unitKey = 'DocUnits' in sp ? 'DocUnits' : 'Unit';
        const overrides: Record<string, unknown> = {};
        if ('Min' in sp || this.Min !== undefined) { overrides.Min = this.Min; }
        if ('Max' in sp || this.Max !== undefined) { overrides.Max = this.Max; }
        if (unitKey in sp || this.Unit) { overrides[unitKey] = this.Unit; }
        if ('Description' in sp || this.Description) { overrides.Description = this.Description; }
        return this._serializeSimulinkObject(overrides);
    }

    static get defaultName(): string { return 'Signal'; }

    static createDefault(name: string, parent: BaseNode | null): SignalNode {
        const rawVal = { _array_class: CLASS_NAME, _array_type: 'MATLABArray', _dimensions: [1, 1], _mw_element_type: 'MATLABArray', _elements: [{ _properties: { CoderInfo: { _object_class: 'Simulink.CoderInfo', _properties: { CSCPackageName: 'Simulink', CustomAttributes: { _object_class: 'SimulinkCSC.AttribClass_Simulink_Default', _properties: {} }, CustomStorageClass: 'Default', ParameterOrSignal: 'Signal', StorageClass: 'Auto' } }, LoggingInfo: { _object_class: 'Simulink.LoggingInfo', _properties: {} } } }] };
        const props = rawVal._elements[0]._properties;
        const serial = { _rawVal: rawVal, _properties: props };
        return new SignalNode(name, parent, props as unknown as Record<string, unknown>, serial as unknown as Record<string, unknown>);
    }

    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): SignalNode {
        const elem = rawVal._elements && (rawVal._elements as unknown[])[0];
        const props = ((elem && (elem as Record<string, unknown>)._properties) || {}) as Record<string, unknown>;
        const serial = { _rawVal: rawVal, _properties: props };
        return new SignalNode(name, parent, props, serial as Record<string, unknown>);
    }
}
