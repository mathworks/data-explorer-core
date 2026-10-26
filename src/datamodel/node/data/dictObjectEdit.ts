// Copyright 2026 The MathWorks, Inc.
//
// The properties of a dictionary's objects that a MAT-file's objects take an edit of (MatNode's
// offered editors, matObjectEdit), offered in a text and a binary dictionary alike: a Simulink
// Parameter's DataType and Unit; a Signal's DataType, Unit, Dimensions, InitialValue, SampleTime
// and SamplingMode; a BusElement's and a ValueType's DataType, Unit and Dimensions; a Bus's
// DataScope, HeaderFile, Alignment and PreserveElementDimensions; an AliasType's DataScope and
// HeaderFile. A dictionary showed each as a label ("read-only here") where a MAT-file took it
// (S12 of the 2026-10-26 edit bash).
//
// ONE RULE. An edit is held to the rules a MAT-file's save holds the same edit to
// (McosPropertyRules.planPropertyEdits): what MATLAB refuses, or loads otherwise, or warns of, is
// refused in the words a MAT-file gives, naming the row; and what MATLAB's own setter changes with
// it is changed too. The rules read the object as its node holds it now: each property from the
// node's field where it has one (its DataType, Unit, bounds), else from its property bag, else at
// MATLAB's class default, which a text dictionary does not write.
//
// WHAT IS WRITTEN. The bag holds the names MATLAB saves (DocUnits, DataType_internal), in the
// same form in both dictionaries (a number, a row of numbers, text, true or false), and both
// writers save it as MATLAB writes it, measured against MATLAB R2027a's own edit of the same
// property saved into a text and a binary dictionary: `"SampleTime": [0.2, 0.1]` and `<P
// Name="SampleTime" Class="double" Dimension="1*2">0.2 0.1</P>`. A node field that shows the
// property is set too, as the writers write the field over the bag.

import type BaseNode from '../BaseNode.js';
import { encodedHolderOf, type SourceOfferedEditor, type SourceSetResult } from '../BaseNode.js';
import type DataNode from '../DataNode.js';
import type { MatVariable } from '../../parser/MatParser.js';
import {
  planPropertyEdits,
  propertyRowOf,
  type McosHeldKind,
  type McosHeldValue,
  type McosRuleObject,
  type McosTripleOp,
} from '../../parser/McosPropertyRules.js';
import { mcosStreamGateOf } from '../mcosStream.js';
import { BINARY_EMPTY_KEY } from '../../parser/XmlUtils.js';
import { matBagEditorOf, numericTypeGate, offeredEditorOf, offeredValue, type MatBagEditor } from './matObjectEdit.js';
import { nodePropertyValue } from './mcosObjectEdit.js';

/** An editor a dictionary offers: the property the rules know it by, and how its text is read. */
interface DictEditor {
  property: string;
  kind: MatBagEditor['kind'];
}

// The classes whose node shows a DataType and a Unit, which a MAT-file offers an editor of through
// the node's own setter (MatNode._offeredEditor) and a dictionary as text.
const TYPED: readonly string[] = ['Simulink.Parameter', 'Simulink.Signal', 'Simulink.BusElement', 'Simulink.ValueType'];

// The properties the rules read of an object of each class, by the rules' names: every row of
// its class's, what an edit is judged with.
const HELD: Readonly<Record<string, readonly string[]>> = {
  'Simulink.Parameter': ['Value', 'Min', 'Max', 'Description', 'Unit', 'DataType'],
  'Simulink.Signal': ['Min', 'Max', 'Description', 'Unit', 'InitialValue', 'DataType', 'Dimensions', 'DimensionsMode', 'Complexity', 'SamplingMode', 'SampleTime'],
  'Simulink.BusElement': ['Name', 'DataType', 'Dimensions', 'DimensionsMode', 'Complexity', 'Min', 'Max', 'Unit', 'Description'],
  'Simulink.ValueType': ['DataType', 'Min', 'Max', 'Unit', 'Description', 'Complexity', 'DimensionsMode', 'Dimensions'],
  'Simulink.Bus': ['Description', 'HeaderFile', 'DataScope', 'Alignment', 'PreserveElementDimensions'],
  'Simulink.AliasType': ['BaseType', 'Description', 'HeaderFile', 'DataScope'],
  'Simulink.NumericType': ['DataTypeMode', 'Signedness', 'WordLength', 'FixedExponent', 'SlopeAdjustmentFactor', 'Bias', 'IsAlias', 'DataTypeOverride', 'DataScope', 'Description', 'HeaderFile'],
};

// A Parameter's properties its setters change with an edit of another, which no row of the rules
// names: its Dimensions and Complexity follow its Value (McosPropertyRules' coWrites).
const PARAMETER_CO_WRITTEN: Readonly<Record<string, { saved: string; kind: McosHeldKind }>> = {
  Dimensions: { saved: 'Dimensions', kind: 'cell' },
  Complexity: { saved: 'Complexity', kind: 'str' },
};

// MATLAB R2027a's default of each property an edit is judged with, by its saved name, as its binary
// dictionary holds a default object's (every property: the text one writes none of these): what a
// property a text dictionary does not write loads as.
const DEFAULTS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  'Simulink.Parameter': { Value: [], Complexity: 'real', Dimensions: [0, 0], Description: '', DataType: 'auto', Min: [], Max: [], DocUnits: '' },
  'Simulink.Signal': {
    Dimensions: -1, DimensionsMode: 'auto', Complexity: 'auto', SampleTime: -1, SamplingMode: 'auto', InitialValue: '', Description: '',
    DataType: 'auto', Min: [], Max: [], DocUnits: '',
  },
  'Simulink.BusElement': {
    Min_internal: [], Max_internal: [], DimensionsMode: 'Fixed', Description: '', DocUnits: '', Name: '', DataType_internal: 'double',
    Complexity: 'real', Dimensions: 1,
  },
  'Simulink.ValueType': { DataType: 'double', Min: [], Max: [], Unit: '', Complexity: 'real', Dimensions: 1, DimensionsMode: 'Fixed', Description: '' },
  'Simulink.Bus': { Alignment: -1, PreserveElementDimensions: false, Description: '', DataScope: 'Auto', HeaderFile: '' },
  'Simulink.AliasType': { BaseType: 'double', Description: '', DataScope: 'Auto', HeaderFile: '' },
  'Simulink.NumericType': {
    DataTypeMode: 'Double', SignednessBool: true, WordLength: 64, FixedExponent: 0, SlopeAdjustmentFactor: 1, Bias: 0, DataTypeOverride: 'Inherit',
    IsAlias: false, Description: '', DataScope: 'Auto', HeaderFile: '',
  },
};

// The node field that shows the property saved under a name, where the node has it: the writers
// write the field over the bag (ParameterNode._getSerializedProperties, BusElementNode.
// _applyElementOverrides, ValueTypeNode._serializedOverrides).
const FIELD_OF: Readonly<Record<string, string>> = {
  DataType: 'DataType',
  DataType_internal: 'DataType',
  DocUnits: 'Unit',
  Unit: 'Unit',
  Min: 'Min',
  Max: 'Max',
  Min_internal: 'Min',
  Max_internal: 'Max',
  Description: 'Description',
  Complexity: 'Complexity',
  DimensionsMode: 'DimensionsMode',
  Dimensions: 'Dimensions',
};

/** The editor a dictionary offers of `key` at `node`, of `entry` (BaseNode.sourceOfferedEditor), or null. */
export function dictOfferedEditor(entry: BaseNode, node: BaseNode, key: string): SourceOfferedEditor | null {
  const editor = editorAt(entry, node, key);
  if (!editor) {
    return null;
  }
  // A Parameter's DataType over a Value that is not a double is its Value's class (the rules refuse
  // another), as a MAT-file offers none.
  if (classOf(node) === 'Simulink.Parameter' && editor.property === 'DataType' && classOfValue(nodePropertyValue(node, 'Value')) !== 'double') {
    return null;
  }
  // A NumericType's property its DataTypeMode keeps as the mode's setter left it, as a MAT-file
  // offers none.
  if (modeGate(node, editor.property)) {
    return null;
  }
  return offeredEditorOf(classOf(node), editor);
}

/**
 * The edit of `key` at `node` (of `entry`) to `text`, of a property a dictionary offers an editor of
 * (dictOfferedEditor): judged by the rules a MAT-file's save holds it to, and written into the
 * node's bag, and its field where it has one, with what MATLAB's setter changes beside it. Null for
 * a key it offers no editor of, which the node's own setter takes.
 */
export function dictSetOffered(entry: BaseNode, node: BaseNode, key: string, text: string): SourceSetResult | null {
  const editor = editorAt(entry, node, key);
  const bag = bagOf(node);
  if (!editor || !bag) {
    return null;
  }
  const cls = classOf(node);
  const path = objectPathOf(node);
  const named = path + '.' + editor.property;
  const shown = shownText(node, key);
  const refused = (why: string): SourceSetResult => ({ error: true, reason: 'Cannot edit "' + entry.name + '": ' + why + '.', invalidValue: text, validValue: shown });
  const parsed = offeredValue(text, editor.kind);
  if (typeof parsed === 'string') {
    return refused(named + ' ' + parsed);
  }
  // As a MAT-file says it of what it offers no editor of: a Parameter's DataType over a Value of
  // another class than double, a NumericType's property its mode keeps.
  const valueClass = cls === 'Simulink.Parameter' && editor.property === 'DataType' ? classOfValue(nodePropertyValue(node, 'Value')) : null;
  if (valueClass && valueClass !== 'double') {
    return refused(named + ' follows its Value, of class ' + valueClass + ': set to another, MATLAB converts the Value to double, with a warning on every load');
  }
  const gate = modeGate(node, editor.property);
  if (gate) {
    return refused(named + ' ' + gate);
  }
  const value = variableOf(parsed.value);
  const object = ruleObjectOf(node);
  if (!value || typeof object === 'string') {
    return refused(typeof object === 'string' ? object : named + ' is not a value this editor writes');
  }
  const plan = planPropertyEdits([{ key: path, object, edits: [{ property: editor.property, value }] }]);
  if (!plan.ok) {
    return refused(plan.message);
  }
  const own = node as unknown as Record<string, unknown>;
  const binary = isBinary(entry);
  for (const op of plan.objects[0]?.ops ?? []) {
    const written = writtenOf(op, cls, binary);
    bag[op.savedName] = written;
    const field = FIELD_OF[op.savedName];
    if (field && Object.prototype.hasOwnProperty.call(own, field)) {
      own[field] = field === 'Min' || field === 'Max' ? (typeof written === 'number' ? written : undefined) : written;
    }
  }
  (node as unknown as DataNode)._markModified();
  return true;
}

/**
 * What puts `key` of `node` (of `entry`) back as it stands now, a property a dictionary offers an
 * editor of: every key of its bag a plan of the rules can write (each one holding a value, and not
 * an object the bag nests, its CoderInfo or its Elements_internal, which no plan writes and other
 * nodes hold), a key absent then removed again, and every field the writers write over the bag.
 * Null for any other key.
 */
export function dictOfferedRestorer(entry: BaseNode, node: BaseNode, key: string): (() => void) | null {
  const bag = bagOf(node);
  if (!editorAt(entry, node, key) || !bag) {
    return null;
  }
  const own = node as unknown as Record<string, unknown>;
  const held = new Map(Object.entries(bag).filter(([, v]) => planWrites(v)).map(([k, v]) => [k, structuredClone(v)] as const));
  const fields = [...new Set(Object.values(FIELD_OF))].filter((f) => Object.prototype.hasOwnProperty.call(own, f)).map((f) => [f, structuredClone(own[f])] as const);
  return () => {
    for (const k of Object.keys(bag)) {
      if (!held.has(k) && planWrites(bag[k])) {
        delete bag[k];
      }
    }
    for (const [k, v] of held) {
      bag[k] = structuredClone(v);
    }
    for (const [f, v] of fields) {
      own[f] = structuredClone(v);
    }
    (node as unknown as DataNode)._markModified();
  };
}

// Whether `v`, a value of an object's bag, is of the forms a plan of the rules writes there (jsOf,
// writtenOf): text, a number, true or false, a row of them, an empty logical; not an object the bag
// nests.
function planWrites(v: unknown): boolean {
  return v === null || typeof v !== 'object' || Array.isArray(v) || isEmptyLogical(v);
}

// The editor of `key` at `node`, an object's own node in `entry` that a dictionary writes from its
// bag, or null: not one inside a value still in the encoded stream it was read from, nor one an
// object stream inside such a value holds (mcosStream), each of which its own gate answers for.
function editorAt(entry: BaseNode, node: BaseNode, key: string): DictEditor | null {
  const editor = editorOf(classOf(node), key);
  if (!editor || !entry || !bagOf(node) || encodedHolderOf(node)) {
    return null;
  }
  for (let n: BaseNode | null = node; n && n !== entry.parent; n = n.parent) {
    if (mcosStreamGateOf(n)) {
      return null;
    }
  }
  return editor;
}

// The editor of `key` on a node of `cls`, by the key its row shows the property under (a table
// column's, a Property Inspector row's), or null: a MAT-file's (matObjectEdit.matBagEditorOf), but
// a CoderInfo's Identifier, and a DataType and a Unit of a class whose node shows them.
function editorOf(cls: string, key: string): DictEditor | null {
  if ((key === 'DataType' || key === 'Unit') && TYPED.includes(cls)) {
    return { property: key, kind: 'text' };
  }
  return key === 'identifier' ? null : matBagEditorOf(cls, key);
}

// Why a NumericType's `property` takes no edit in the DataTypeMode its node holds now, as a clause
// (matObjectEdit.numericTypeGate), or null; null for a node of any other class.
function modeGate(node: BaseNode, property: string): string | null {
  if (classOf(node) !== 'Simulink.NumericType') {
    return null;
  }
  const mode = bagOf(node)?.DataTypeMode ?? DEFAULTS['Simulink.NumericType'].DataTypeMode;
  return typeof mode === 'string' ? numericTypeGate(mode, property) : null;
}

// The MATLAB path of the object at `node`, as a MAT-file's rules name it: a bus element's as its
// bus's Elements(k), which a row shows by its name.
function objectPathOf(node: BaseNode): string {
  const bus = node.parent;
  return classOf(node) === 'Simulink.BusElement' && bus ? bus.matlabPath + '.Elements(' + (bus.children.indexOf(node) + 1) + ')' : node.matlabPath;
}

// The class of a value nodePropertyValue reads, logical apart; null for one it reads none of.
function classOfValue(v: MatVariable | string): string | null {
  return typeof v === 'string' ? null : v.isLogical ? 'logical' : v.className;
}

function classOf(node: BaseNode): string {
  return String((node as unknown as { className?: unknown }).className ?? '');
}

function bagOf(node: BaseNode): Record<string, unknown> | null {
  const bag = (node as unknown as { serial?: { _properties?: unknown } }).serial?._properties;
  return bag && typeof bag === 'object' && !Array.isArray(bag) ? (bag as Record<string, unknown>) : null;
}

// The saved name and the kind of each property the rules read of an object of `cls`.
function rowsOf(cls: string): { property: string; saved: string; kind: McosHeldKind }[] {
  const rows = (HELD[cls] ?? []).map((property) => {
    const row = propertyRowOf(cls, property)!;
    return { property, saved: row.savedName, kind: row.kind };
  });
  return cls === 'Simulink.Parameter' ? [...rows, ...Object.entries(PARAMETER_CO_WRITTEN).map(([property, r]) => ({ property, ...r }))] : rows;
}

/**
 * The object at `node` as the rules read it: each property it holds from the node's field where
 * it has one, else from its bag; one it holds neither way at its class default (a text dictionary
 * writes none). A Parameter's Value from its value node. Or why it cannot be read so.
 */
function ruleObjectOf(node: BaseNode): McosRuleObject | string {
  const cls = classOf(node);
  const bag = bagOf(node)!;
  const own = node as unknown as Record<string, unknown>;
  const held = new Map<string, McosHeldValue>();
  const defaults = new Map<string, MatVariable>();
  for (const { property, saved, kind } of rowsOf(cls)) {
    if (property === 'Value') {
      const v = nodePropertyValue(node, 'Value');
      if (typeof v === 'string') {
        return node.matlabPath + '.Value ' + v;
      }
      held.set(saved, { kind: 'cell', value: v });
      continue;
    }
    const field = FIELD_OF[saved];
    let x: unknown;
    if (field && Object.prototype.hasOwnProperty.call(own, field) && !(field === 'Dimensions' && own[field] === undefined)) {
      x = own[field] === undefined && (field === 'Min' || field === 'Max') ? [] : own[field];
    } else if (Object.prototype.hasOwnProperty.call(bag, saved)) {
      x = bag[saved];
    } else if (property === 'Name') {
      x = node.name;
    } else {
      const d = variableOf(DEFAULTS[cls]?.[saved]);
      if (d) {
        defaults.set(saved, d);
      }
      continue;
    }
    const value = heldOf(x, kind);
    if (value) {
      held.set(saved, value);
    }
  }
  return { className: cls, held, defaults };
}

// A bag's value as a triple of `kind` holds it: text for an index, 0 or 1 for an integer, the
// variable for a cell; null for a value of another form, which the rules then read as absent.
function heldOf(x: unknown, kind: McosHeldKind): McosHeldValue | null {
  if (kind === 'str') {
    return typeof x === 'string' ? { kind: 'str', text: x } : null;
  }
  if (kind === 'int') {
    return typeof x === 'boolean' || typeof x === 'number' ? { kind: 'int', value: Number(x) } : null;
  }
  const v = variableOf(x);
  return v ? { kind: 'cell', value: v } : null;
}

// A bag's value as the variable MATLAB holds: text a char ('' a 0x0), true or false a logical, a
// number a double, a row of numbers a double row ([] a 0x0); null for any other form.
function variableOf(x: unknown): MatVariable | null {
  const of = (className: string, dimensions: number[], value: unknown, isLogical = false): MatVariable => ({
    name: '', className, dimensions, isComplex: false, isLogical, value, fields: null,
  });
  if (typeof x === 'string') {
    return of('char', x === '' ? [0, 0] : [1, x.length], x);
  }
  if (typeof x === 'boolean') {
    return of('logical', [1, 1], x ? 1 : 0, true);
  }
  if (typeof x === 'number') {
    return of('double', [1, 1], x);
  }
  if (Array.isArray(x) && x.every((e) => typeof e === 'number')) {
    return x.length === 0 ? of('double', [0, 0], []) : of('double', [1, x.length], x.length === 1 ? x[0] : x.slice());
  }
  // The empty logical a NumericType saves as the SignednessBool of its Signedness 'Auto', as a text
  // dictionary spells it ('[]') and a binary one ('Matrix(0,0)').
  if (isEmptyLogical(x)) {
    return of('logical', [0, 0], [], true);
  }
  return null;
}

function isEmptyLogical(x: unknown): boolean {
  const o = x as { _type?: unknown; _value?: unknown } | null;
  return !!o && typeof o === 'object' && o._type === 'logical' && (o._value === '[]' || o._value === 'Matrix(0,0)');
}

// Whether `entry` is a binary dictionary's (SlddNode.sourceFormat), whose reader spells an empty
// logical otherwise than a text one's.
function isBinary(entry: BaseNode): boolean {
  for (let n: BaseNode | null = entry; n; n = n.parent) {
    const format = (n as unknown as { sourceFormat?: unknown }).sourceFormat;
    if (format !== undefined) {
      return format === 'xml';
    }
  }
  return false;
}

// What the bag of an object of `cls` holds after `op`, a triple op the rules plan: a property
// removed at its class default, a cell's variable in the bag's form, an index's text, an integer as
// true or false.
function writtenOf(op: McosTripleOp, cls: string, binary: boolean): unknown {
  if (op.op === 'remove') {
    return DEFAULTS[cls][op.savedName];
  }
  if (op.kind === 'cell') {
    return jsOf(op.value, binary);
  }
  if (op.kind === 'str') {
    return op.text;
  }
  return op.value === 1;
}

// The bag's form of a variable the rules write: the inverse of variableOf, an empty logical as the
// reader of the dictionary `binary` says holds one.
function jsOf(v: MatVariable, binary: boolean): unknown {
  if (v.className === 'char') {
    return typeof v.value === 'string' ? v.value : '';
  }
  if (v.isLogical || v.className === 'logical') {
    if ((v.dimensions ?? []).includes(0)) {
      return binary ? { _type: 'logical', _value: 'Matrix(0,0)', [BINARY_EMPTY_KEY]: true } : { _type: 'logical', _value: '[]' };
    }
    return Array.isArray(v.value) ? v.value.map((b) => !!b) : !!v.value;
  }
  const xs = Array.isArray(v.value) ? (v.value as unknown[]).map(Number) : v.value === null || v.value === undefined ? [] : [Number(v.value)];
  return xs.length === 1 ? xs[0] : xs;
}

// The text the row of `key` shows now, for a refusal's valid value.
function shownText(node: BaseNode, key: string): string {
  const row = (node as unknown as { toRow?: () => Record<string, unknown> | null }).toRow?.();
  const cell = row ? row[key] : undefined;
  if (cell && typeof cell === 'object' && 'text' in (cell as Record<string, unknown>)) {
    return String((cell as Record<string, unknown>).text ?? '');
  }
  return cell === undefined || cell === null ? '' : String(cell);
}
