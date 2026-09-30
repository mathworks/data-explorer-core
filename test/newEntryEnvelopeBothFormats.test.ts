// Copyright 2026 The MathWorks, Inc.
//
// The custom-save envelope of a NEWLY ADDED entry, in BOTH file formats — defects 57 and 58,
// which were found by reading the bytes a MATLAB verification run was about to be handed, and
// which no test in either repo could have caught.
//
// Four classes here save through MATLAB's `saveobj` hook: their whole state is one struct, they
// have no ordinary properties at all, and MATLAB's `loadobj` destructures that struct. Getting
// it wrong is not lower fidelity — a property bag where the envelope belongs is what SEGFAULTED
// MATLAB on `Simulink.VariantVariable` (`_defaultCustomSaveRawVal` carries that account), and an
// envelope field holding the wrong KIND of empty is the same shape one level down.
//
//   57  The binary writer was not envelope-aware. `SimulinkObjectNode._getSerializedProperties`
//       did a plain `Object.assign(stored, overrides)` while the text path went through
//       `_mergeProps`, which knows to drop an EMPTY override rather than write back a default
//       MATLAB never wrote. So `Simulink.VariantBank`, `Simulink.VariantBankCoderInfo` and
//       `Simulink.VariantConfigurations` each came out carrying `<P Name="Value" Class="char"/>`
//       NEXT TO their envelope — a property none of those MATLAB classes has — in the binary
//       flavour of a dictionary and absent from the text one. `VariantVariableNode` was the only
//       class opted in, via an override, which was the tell: what was special about it was not
//       the class, it was that somebody had once looked at its bytes.
//
//   58  An empty struct or cell property survived the WRITE and was destroyed by the READ. Such
//       a property has no `<Element>` children — its field names are `<Field Name="…"/>`, which
//       is the only channel an empty struct has to state them — so `parsePropContent` fell
//       through to `parseTypedValue`, whose zero-total arm answers `''` for a non-numeric class.
//       `''` serializes back as `Class="char"`. The consequence is the bad one: merely OPENING a
//       dictionary and saving it hollowed out every variant entry in it, ours or MATLAB's, into
//       the shape that makes `loadobj` build an empty object.
//
// Why both channels are asserted from one table: the two spellings of this envelope have already
// drifted apart once (XmlUtils' CUSTOM_SAVE_KEY), and 57 is a third case of the same thing. The
// vscode-side parity test that was supposed to hold the line — "we do not invent properties
// MATLAB does not have" — read only the TEXT run, which is exactly how 57 survived it.
import { describe, it, expect } from 'vitest';
import '../src/datamodel/node/data/NodeClassMap.js';
import { serializeEntryToXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import { parseBinarySlddParts } from '../src/datamodel/parser/BinarySlddParser.js';
import { SAVEOBJ_KEY, CUSTOM_SAVE_KEY } from '../src/datamodel/parser/XmlUtils.js';
import DataModel from '../src/core/DataModel.js';
import VariantVariableNode from '../src/datamodel/node/data/VariantVariableNode.js';
import VariantBankNode from '../src/datamodel/node/data/VariantBankNode.js';
import VariantBankCoderInfoNode from '../src/datamodel/node/data/VariantBankCoderInfoNode.js';
import VariantConfigurationDataNode from '../src/datamodel/node/data/VariantConfigurationDataNode.js';
import ParameterNode from '../src/datamodel/node/data/ParameterNode.js';

/**
 * The four custom-saving classes, the field names their envelope declares, and the fields whose
 * default is an EMPTY container — every value measured off a binary dictionary MATLAB R2027a
 * wrote, because the binary format is the only one that states an empty struct's field names
 * (its text writer flattens all of them to `{"_type":"struct","_value":"[]"}`).
 *
 * `empties` is what defect 58 was about, and it is listed per class rather than derived so a
 * class that stops defaulting one of them fails here instead of silently losing the assertion.
 */
const CUSTOM_SAVERS = [
  {
    Node: VariantVariableNode,
    className: 'Simulink.VariantVariable',
    fields: ['Choices', 'Specification', 'Bank'],
    empties: [{ name: 'Choices', kind: 'Struct', dims: [0, 1], fields: ['Condition', 'Value'] }],
  },
  {
    Node: VariantBankNode,
    className: 'Simulink.VariantBank',
    fields: [
      'Name',
      'Description',
      'VariantConditions',
      'AllChoicesCoderInfo',
      'ActiveChoiceCoderInfo',
      'BankCoderInfo',
    ],
    empties: [{ name: 'VariantConditions', kind: 'Cell', dims: [1, 0], fields: [] }],
  },
  {
    Node: VariantBankCoderInfoNode,
    className: 'Simulink.VariantBankCoderInfo',
    // Not the StorageClass/CustomStorageClass/Alias names the rest of Simulink's CoderInfo
    // classes carry — this one is the five below, and `Qualifier` defaults to 'None' rather
    // than empty. Read back out of a dictionary MATLAB resaved for us, which is also why
    // `empties` is bare: every field here is a plain char.
    fields: ['HeaderFile', 'DefinitionFile', 'PreStatement', 'PostStatement', 'Qualifier'],
    empties: [],
  },
  {
    Node: VariantConfigurationDataNode,
    // The CONTAINER, not `Simulink.VariantConfigurationData` — see that node's header.
    className: 'Simulink.VariantConfigurations',
    fields: [
      'Configurations',
      'VariantConfigurations',
      'Constraints',
      'PreferredConfiguration',
      'DefaultConfigurationName',
      'DataDictionaryName',
      'DataDictionarySection',
      'AreSubModelConfigurationsMigrated',
      'ComponentConfigurationData',
      'Version',
    ],
    empties: [
      { name: 'Configurations', kind: 'Struct', dims: [1, 0], fields: ['Name', 'Description', 'ControlVariables'] },
      {
        name: 'VariantConfigurations',
        kind: 'Struct',
        dims: [1, 0],
        fields: ['Name', 'Description', 'ControlVariables', 'SubModelConfigurations'],
      },
      { name: 'Constraints', kind: 'Struct', dims: [1, 0], fields: ['Name', 'Condition', 'Description'] },
      {
        name: 'ComponentConfigurationData',
        kind: 'Struct',
        dims: [1, 0],
        fields: [
          'ConfigurationName',
          'ComponentName',
          'ComponentVariantConfigurationData',
          'ComponentConfigurationName',
          'ComponentControlVariablesInfo',
        ],
      },
    ],
  },
] as const;

/**
 * The property list of the OBJECT the entry holds — not the entry's own `<P>`s, and not the
 * envelope's fields, both of which a global match would sweep up.
 *
 * `serializeEntryToXml` returns the whole `<Object Class="DD.ENTRY">`, so the nesting is fixed
 * and four deep: the entry `<Object>`, its `<P Name="Value">`, the `<Element Class="…">` naming
 * the MATLAB class, and then the object's properties. For a custom saver that last level holds
 * the unnamed `<P Source="saveobj">` and must hold nothing else.
 */
const OBJECT_PROPS_DEPTH = 3;
function objectPropNames(entryXml: string): string[] {
  const names: string[] = [];
  let depth = 0;
  const tagRe = /<(\/?)([A-Za-z]+)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(entryXml)) !== null) {
    const [, close, tag, attrs, selfClose] = m;
    if (close) {
      depth -= 1;
      continue;
    }
    if (tag === 'P' && depth === OBJECT_PROPS_DEPTH) {
      const nameAttr = /Name="([^"]*)"/.exec(attrs);
      names.push(nameAttr ? nameAttr[1] : '<unnamed>');
    }
    if (!selfClose) {
      depth += 1;
    }
  }
  return names;
}

let seq = 0;
/** A one-entry dictionary chunk, parsed back into a model, and the node it holds. */
function reopen(entryXml: string): any {
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<DataSource FormatVersion="1" MinRelease="R2014a">\n' +
    entryXml +
    '    <Object Class="DD.Dictionary">\n' +
    '        <P Name="AccessBaseWorkspace" Class="logical">0</P>\n' +
    '    </Object>\n' +
    '</DataSource>';
  const uri = 'mem://envelope' + ++seq;
  DataModel.removeDataSource(uri);
  const root: any = DataModel.addDataSource(uri, parseBinarySlddParts(xml, {}), {
    path: 'envelope.sldd',
  });
  const find = (n: any): any => {
    if (n.serial && n.serial._properties) {
      return n;
    }
    for (const c of n.children ?? []) {
      const found = find(c);
      if (found) {
        return found;
      }
    }
    return null;
  };
  return find(root);
}

describe('defect 57: a custom saver writes its envelope and nothing beside it', () => {
  // The claim below is "this list is exactly one unnamed entry", which a walker that found
  // nothing would also satisfy. So first: the same walker on an ordinary class, which has no
  // envelope and a long property list. Without this the four tests under it could go green by
  // breaking rather than by passing.
  it('reads a NON-custom-saver’s properties, so an empty answer means empty', () => {
    // A Parameter's three, which is every property whose default the binary writer states
    // rather than leaves to the class — the point being that they are NAMED, so a custom
    // saver's single unnamed `<P>` is a measured difference and not a walker that missed.
    const names = objectPropNames(serializeEntryToXml(ParameterNode.createDefault('p', null) as any));
    expect(names).toContain('CoderInfo');
    expect(names).not.toContain('<unnamed>');
    expect(names.length).toBeGreaterThan(1);
  });

  for (const spec of CUSTOM_SAVERS) {
    it(spec.className + ' writes exactly one unnamed saveobj property in the BINARY channel', () => {
      const node: any = spec.Node.createDefault('e', null);
      const xml = serializeEntryToXml(node);
      // The whole claim in one assertion: the object's property list is the envelope alone.
      // Before the fix this read ['<unnamed>', 'Value'] for three of the four, and the
      // invented `Value` was a `Class="char"` standing in for a default the node cannot see
      // inside the envelope.
      expect(objectPropNames(xml)).toEqual(['<unnamed>']);
      expect(xml).toContain('<P Source="saveobj" PropertyType="any" Class="struct">');
      expect(xml).toContain('<Element Class="' + spec.className + '">');
    });

    it(spec.className + ' writes the same property set in the TEXT channel', () => {
      const node: any = spec.Node.createDefault('e', null);
      const value: any = node.serializeValue();
      // The text spelling is element-level `_custom_save` and NO `_properties` at all — the
      // asymmetry is in where the envelope hangs, never in what is in it.
      const elem = value._elements[0];
      expect(Object.keys(elem)).toEqual([CUSTOM_SAVE_KEY]);
      expect(elem._properties).toBeUndefined();
      expect(Object.keys(elem[CUSTOM_SAVE_KEY]._elements[0])).toEqual([...spec.fields]);
    });

    it(spec.className + ' declares MATLAB’s field order in both channels', () => {
      // One list, two spellings, asserted against each other as well as against MATLAB's
      // order: `writeIntoSaveobj` writes only a field this list names, so a name missing from
      // one channel is a property no edit can reach in that format.
      const node: any = spec.Node.createDefault('e', null);
      const binary = node.serial._properties[SAVEOBJ_KEY];
      const text = (node.serializeValue() as any)._elements[0][CUSTOM_SAVE_KEY];
      expect(binary._fields).toEqual([...spec.fields]);
      expect(text._fields).toEqual([...spec.fields]);
      expect(Object.keys(binary._elements[0])).toEqual([...spec.fields]);
    });
  }
});

describe('defect 58: an empty struct or cell survives the binary round trip', () => {
  for (const spec of CUSTOM_SAVERS) {
    if (spec.empties.length === 0) {
      continue;
    }
    it(spec.className + ' writes a <Field> per name of every empty struct', () => {
      const xml = serializeEntryToXml(spec.Node.createDefault('e', null) as any);
      for (const empty of spec.empties) {
        const dim = empty.dims.join('*');
        const cls = empty.kind === 'Struct' ? 'struct' : 'cell';
        expect(xml).toContain(
          '<P Name="' + empty.name + '" Class="' + cls + '" Dimension="' + dim + '">',
        );
        for (const field of empty.fields) {
          expect(xml).toContain('<Field Name="' + field + '"/>');
        }
      }
      // A cell states no names and must not grow any: `<Field>` is a struct's channel only.
      const cellNames = spec.empties.filter((e) => e.kind === 'Cell').map((e) => e.name);
      for (const name of cellNames) {
        const seg = xml.slice(xml.indexOf('Name="' + name + '"'));
        expect(seg.slice(0, seg.indexOf('</P>'))).not.toContain('<Field');
      }
    });

    it(spec.className + ' reads every empty back as a container, never as a char', () => {
      const node: any = reopen(serializeEntryToXml(spec.Node.createDefault('e', null) as any));
      const elem = node.serial._properties[SAVEOBJ_KEY]._elements[0];
      for (const empty of spec.empties) {
        const got = elem[empty.name];
        // The defect's own signature, stated first because it is the one that matters: the
        // empty STRING is what came back, and an empty string writes itself out as
        // `Class="char"` on the next save.
        expect(got, empty.name).not.toBe('');
        expect(got._array_type, empty.name).toBe(empty.kind);
        expect(got._dimensions, empty.name).toEqual(empty.dims);
        expect(got._elements, empty.name).toEqual([]);
        if (empty.kind === 'Struct') {
          // Read back off `<Field>`, which is the only place an empty struct's names can be:
          // a non-empty one states them through each `<Element>`'s own `<P Name="…">`.
          expect(got._fields, empty.name).toEqual([...empty.fields]);
        }
      }
    });
  }

  it('and writing what was read back reproduces the same bytes', () => {
    // The user-visible form of defect 58, and the assertion that needs no knowledge of the
    // shapes above: opening a dictionary and saving it unchanged must not change it. Before the
    // fix the second write differed from the first on every one of these entries, because the
    // read had turned four structs and a cell into empty chars on the way in.
    for (const spec of CUSTOM_SAVERS) {
      const first = serializeEntryToXml(spec.Node.createDefault('e', null) as any);
      const again = serializeEntryToXml(reopen(first));
      // LastMod is a timestamp the writer stamps, and the only key allowed to differ.
      const stable = (xml: string): string => xml.replace(/<P Name="LastMod"[^<]*<\/P>/, '');
      expect(stable(again), spec.className).toBe(stable(first));
    }
  });
});
