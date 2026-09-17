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
    Min: number | undefined;
    Max: number | undefined;
    Unit: string;
    DataType: string;
    // Verified against MATLAB (Simulink.BusElement): these are real element
    // properties that were not surfaced before, so their columns read empty.
    // Complexity {real|complex} and DimensionsMode {Fixed|Variable} are closed
    // enums and are now EDITABLE selects — validated by
    // DataNode._rejectUnknownEnumeral and written back in _applyElementOverrides.
    // Dimensions is a positive double vector with a symbolic-char alternative and
    // stays read-only: nothing in the source claims its constraint was worked out,
    // and an unlock is worth only as much as the rule that refuses a bad value.
    Complexity: string;
    Dimensions: unknown;
    DimensionsMode: string;

    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) {
        super(name, parent, props, serial);
        // A bus element's bounds may arrive under either spelling; only the normalized
        // value is kept. The raw one was held in a field until the write-back stopped
        // falling back to it — nothing else ever read it, and while it existed a cleared
        // bound was silently restored from it on save.
        const rawMin = props.Min_internal !== undefined ? props.Min_internal : props.Min;
        const rawMax = props.Max_internal !== undefined ? props.Max_internal : props.Max;
        this.Min = BusElementNode._normalizeMinMax(rawMin);
        this.Max = BusElementNode._normalizeMinMax(rawMax);
        this.Unit = (props.DocUnits as string) || (props.Unit as string) || '';
        // The element's data type is stored in DataType_internal (falling back to
        // DataType); an unset type means the Simulink default of 'double'.
        const rawDataType = props.DataType_internal !== undefined ? props.DataType_internal : props.DataType;
        this.DataType = (rawDataType as string) || 'double';
        // MATLAB's own defaults for an element that declares neither (probed on a live
        // Simulink.BusElement): Complexity 'real', DimensionsMode 'Fixed' — the same pair
        // Simulink.ValueType defaults to, and NOT the 'auto' a Simulink.Signal uses. These
        // are DISPLAY values only: the write-back gates in _applyElementOverrides compare
        // against the same two literals, so an element the file left silent still saves
        // silent. Before this the fallback was '', which showed blanks where MATLAB shows
        // a value.
        this.Complexity = (props.Complexity as string) || 'real';
        this.Dimensions = props.Dimensions;
        this.DimensionsMode = (props.DimensionsMode as string) || 'Fixed';
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

    _applyElementOverrides(props: Record<string, unknown>): void {
        const sp = this.serial._properties as Record<string, unknown>;
        const minKey = 'Min_internal' in sp ? 'Min_internal' : 'Min';
        const maxKey = 'Max_internal' in sp ? 'Max_internal' : 'Max';
        const unitKey = 'DocUnits' in sp ? 'DocUnits' : 'Unit';
        const dtKey = 'DataType_internal' in sp ? 'DataType_internal' : 'DataType';
        // A cleared bound goes out as `[]` — MATLAB's own empty — under the key the file
        // used, and not as the value the file held there: falling back to that (what this
        // did) meant emptying the Minimum box blanked the row and saved the old number,
        // so the bound came back on reopen. `undefined` is not the alternative here
        // either; this bag reaches the XML writer, which spells `undefined` as
        // `Class="char"`. See ParameterNode._getSerializedProperties for the full note,
        // including the residual `"Min": []`-vs-omitted-key difference on the text path.
        if (minKey in sp || this.Min !== undefined) { props[minKey] = this.Min !== undefined ? this.Min : []; }
        if (maxKey in sp || this.Max !== undefined) { props[maxKey] = this.Max !== undefined ? this.Max : []; }
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
        // Guarded like DataType above — against the DEFAULT, not on truthiness — so an
        // element that never carried the key does not gain one on a clean round trip.
        // Truthiness was enough only while an absent enum read as ''; now that it reads as
        // MATLAB's default the same test is always true, and every untyped element in every
        // dictionary would come back with both keys added. The extra `this.X &&` covers the
        // CLEAR: emptying the cell stores '' (see DataNode._rejectUnknownEnumeral), which is
        // not a value either property has, so it means absence here too.
        if ('Complexity' in sp || (this.Complexity && this.Complexity !== 'real')) { props.Complexity = this.Complexity; }
        if ('DimensionsMode' in sp || (this.DimensionsMode && this.DimensionsMode !== 'Fixed')) { props.DimensionsMode = this.DimensionsMode; }
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
