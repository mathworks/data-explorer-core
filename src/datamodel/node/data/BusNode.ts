// Copyright 2026 The MathWorks, Inc.

import { BaseBusNode, BaseBusElementNode, PropName, PropDataType, PropDescription, PropKind, PropClassAtom, withSourceKeys } from './BaseBusNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import type { SetPropertyResult } from '../DataNode.js';
import PropMin from '../../prop/PropMin.js';
import PropMax from '../../prop/PropMax.js';
import PropUnit from '../../prop/PropUnit.js';
import PropComplexity from '../../prop/PropComplexity.js';
import PropDimensions from '../../prop/PropDimensions.js';
import PropDimensionsMode from '../../prop/PropDimensionsMode.js';

const CLASS_NAME = 'Simulink.Bus';

export class BusElementNode extends BaseBusElementNode {
    _rawMin: unknown;
    _rawMax: unknown;
    Min: number | undefined;
    Max: number | undefined;
    Unit: string;
    DataType: string;
    // Verified against MATLAB (Simulink.BusElement): these are real element
    // properties that were not surfaced before, so their columns read empty.
    // Complexity {real|complex} and DimensionsMode {Fixed|Variable} are closed
    // enums and are now EDITABLE selects — validated against the enum below and
    // written back in _applyElementOverrides. Dimensions is a positive double
    // vector with a symbolic-char alternative and stays read-only: nothing in the
    // source claims its constraint was worked out, and an unlock is worth only as
    // much as the rule that refuses a bad value.
    Complexity: string;
    Dimensions: unknown;
    DimensionsMode: string;

    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) {
        super(name, parent, props, serial);
        this._rawMin = props.Min_internal !== undefined ? props.Min_internal : props.Min;
        this._rawMax = props.Max_internal !== undefined ? props.Max_internal : props.Max;
        this.Min = BusElementNode._normalizeMinMax(this._rawMin);
        this.Max = BusElementNode._normalizeMinMax(this._rawMax);
        this.Unit = (props.DocUnits as string) || (props.Unit as string) || '';
        // The element's data type is stored in DataType_internal (falling back to
        // DataType); an unset type means the Simulink default of 'double'.
        const rawDataType = props.DataType_internal !== undefined ? props.DataType_internal : props.DataType;
        this.DataType = (rawDataType as string) || 'double';
        this.Complexity = (props.Complexity as string) || '';
        this.Dimensions = props.Dimensions;
        this.DimensionsMode = (props.DimensionsMode as string) || '';
    }

    static _normalizeMinMax(val: unknown): number | undefined {
        if (Array.isArray(val) && val.length === 0) { return undefined; }
        return val as number | undefined;
    }

    // A StructType's elements use the struct-element icon; a derived
    // DataInterface's use the arch bus-element icon; a plain Design Data bus's
    // use the workspace bus-element icon.
    get icon(): string {
        const parent = this.parent as { isStructType?: boolean; isDerived?: boolean } | null;
        if (parent?.isStructType) { return 'typeStructElement'; }
        return parent?.isDerived ? 'typeBusElement' : 'wsBusElement';
    }
    // The element's Class is its object class (Simulink.BusElement), not its
    // mapped data type — that belongs in the Data Type column below.
    get className(): string { return 'Simulink.BusElement'; }
    // A bus element's mapped data type is a real data type — show it in the column.
    get dataType(): string { return this.DataType; }
    getProperties(): PropClass[] { return [PropName, PropDataType, PropDimensions, PropComplexity, PropDimensionsMode, PropMin, PropMax, PropUnit, PropDescription]; }
    // DataType/Min/Max read the `*_internal` aliased raw keys, so widen their
    // sourceKeys to both spellings — otherwise the alias leaks into "Other".
    getPILayout() {
        // A bus element shares its parent's className resolution path and reads
        // several props through `*_internal` aliases, so it stays override-driven
        // (not schema-keyed) — but opens with the common "General" identity group
        // like every other node, then a "Value Properties" group for its
        // value-semantics. DataType/Min/Max widen sourceKeys to both spellings so
        // the alias the node carries isn't leaked into "Other".
        return [
            { group: 'General', items: [
                PropName,
                withSourceKeys(PropDataType, ['DataType', 'DataType_internal']),
                PropKind, PropClassAtom,
            ] },
            { group: 'Value Properties', items: [
                PropDimensions, PropComplexity, PropDimensionsMode,
                withSourceKeys(PropMin, ['Min', 'Min_internal']),
                withSourceKeys(PropMax, ['Max', 'Max_internal']),
                PropUnit, PropDescription,
            ] },
        ];
    }

    // Route Min/Max through the shared, MATLAB-verified "finite real double
    // scalar" validator (verified error: "Minimum on element 'x' must be a finite
    // real double scalar value"). Without this override the edit falls through to
    // DataNode's generic numeric path, which wrongly accepts Inf/NaN.
    setProperty(propName: string, stringValue: string): true | SetPropertyResult {
        if (propName === 'Min' || propName === 'Max') {
            return this._setMinMax(propName, stringValue);
        }
        const notAnEnumeral = this._rejectUnknownEnumeral(propName, stringValue);
        if (notAnEnumeral) {
            return notAnEnumeral;
        }
        return super.setProperty(propName, stringValue);
    }

    // Refuse a value MATLAB's enum does not contain, for either element property
    // surfaced as a dropdown (Complexity, DimensionsMode). Without this the edit
    // reaches DataNode's generic branch for a string field, which stores whatever
    // text arrived: the table's own combobox can only offer legal choices, but the
    // Property Inspector has no combobox and seeds a plain text box, so 'Real' or
    // 'fixed' would be written into a file MATLAB then refuses to load — the
    // failure an unlock has to rule out before it is an unlock at all.
    //
    // The legal set is read off the prop atom's readOptions — the SAME call the
    // cell's dropdown is built from (BaseNode.getPropInfo) — rather than restated
    // here. Two copies of an enum is how a UI ends up offering two choices and
    // accepting three.
    //
    // The wording is MATLAB's own, from a probe of the live object (recorded in
    // Simulink.BusElement.md): assigning anything else raises "There is no
    // enumerated value named 'X'." Note this is MATLAB's message for a rejected
    // ASSIGNMENT; that the values we do accept produce a file MATLAB reopens with
    // the same values is the live tier's claim to make, and it has not been run
    // here (test/parity/matlab/writeback.live.test.ts, gated on DEX_MATLAB_CMD).
    _rejectUnknownEnumeral(propName: string, stringValue: string): SetPropertyResult | null {
        const prop = this._propFor(propName);
        if (!prop || prop.editor !== 'select' || !prop.readOptions) {
            return null;
        }
        // The empty string is a CLEAR, not an illegal enumeral — the same licence
        // _setMinMax takes for '' and '[]'. It has to be, because it is what UNDO
        // submits: an element that never carried the property reads as '' (see the
        // constructor's `|| ''`), DataModel.editProperty captures that as the prior
        // value, and refusing it would leave the undo of a perfectly good edit
        // silently unapplied. Storing '' restores absence rather than writing an
        // illegal value — _applyElementOverrides then omits the key entirely, so the
        // element goes back out exactly as it came in.
        if (stringValue === '') {
            return null;
        }
        const options = prop.readOptions(this);
        if (options.length === 0 || options.indexOf(stringValue) >= 0) {
            return null;
        }
        const current = (this as unknown as Record<string, unknown>)[prop.nodeProperty || prop.key];
        return {
            error: true,
            reason: "There is no enumerated value named '" + stringValue + "'.",
            invalidValue: stringValue,
            validValue: typeof current === 'string' ? current : '',
        };
    }

    _applyElementOverrides(props: Record<string, unknown>): void {
        const sp = this.serial._properties as Record<string, unknown>;
        const minKey = 'Min_internal' in sp ? 'Min_internal' : 'Min';
        const maxKey = 'Max_internal' in sp ? 'Max_internal' : 'Max';
        const unitKey = 'DocUnits' in sp ? 'DocUnits' : 'Unit';
        const dtKey = 'DataType_internal' in sp ? 'DataType_internal' : 'DataType';
        if (minKey in sp || this.Min !== undefined) { props[minKey] = this.Min !== undefined ? this.Min : this._rawMin; }
        if (maxKey in sp || this.Max !== undefined) { props[maxKey] = this.Max !== undefined ? this.Max : this._rawMax; }
        if (unitKey in sp || this.Unit) { props[unitKey] = this.Unit; }
        // Only write the data type back when the source had it or it differs from
        // the implicit 'double' default, so untyped elements stay untouched.
        if (dtKey in sp || this.DataType !== 'double') { props[dtKey] = this.DataType; }
        // The two enum props are editable, so their edited value has to reach the
        // property bag both writers serialize FROM — the JSON path dumps that bag
        // and serializeEntryToXml walks it — or the edit is silently dropped on
        // save while the live tree keeps showing it. Neither writer needed teaching
        // about these keys (a string property in the bag already goes out as
        // `<P Name="Complexity" Class="char">complex</P>` or as its JSON member);
        // what was missing was the copy from the node field into the bag, so the
        // serializer faithfully re-emitted the value parsed from the file.
        // Guarded the same way as Description above so an element that never
        // carried the key does not gain one on a clean round trip.
        if ('Complexity' in sp || this.Complexity) { props.Complexity = this.Complexity; }
        if ('DimensionsMode' in sp || this.DimensionsMode) { props.DimensionsMode = this.DimensionsMode; }
        if ('Description' in sp || this.Description) { props.Description = this.Description; }
    }
}

export class BusNode extends BaseBusNode {
    // A derived arch Simulink.Bus is a DataInterface by default, but the
    // systemcomposer catalog may classify it as a StructType (set at parse time).
    isStructType = false;

    get icon(): string {
        if (this.isStructType) { return 'typeStruct'; }
        return super.icon;
    }
    get className(): string { return CLASS_NAME; }
    _createElementNode(name: string, props: Record<string, unknown>, serial: Record<string, unknown>): BusElementNode { return new BusElementNode(name, this, props, serial); }
    static ELEMENT_CLASS_NAME = 'Simulink.BusElement';
    static get defaultName(): string { return 'Bus'; }
    static createDefault(name: string, parent: BaseNode | null): BusNode { return BaseBusNode._createDefaultBus(name, parent, BusNode, CLASS_NAME) as BusNode; }
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): BusNode { return BaseBusNode._parseElements(rawVal, name, parent, BusNode, BusElementNode) as BusNode; }
}

export default { BusNode, BusElementNode };
