// Copyright 2026 The MathWorks, Inc.
//
// A Description is a property: where the object has one, its row shows it and takes an edit that
// the save writes; where it has none, the row says so (`_descriptionApplies: false`, with no text
// and no editor, which a host draws as a grayed-out cell), the Property Inspector offers no
// Description field, and an edit of one is refused, naming the class. Before, every row took an
// edit of a Description, and 223 of those a dictionary showed went nowhere on the save.
//
// Whether an object has one is MATLAB's answer, isprop(obj, 'Description'), measured in MATLAB
// R2027a on 2026-10-24 for every class the fixtures hold an object of
// (test/parity/matlab/probe_description_isprop.m), with the fixtures' own class definitions on the
// path. Of the classes MATLAB cannot load (the fixtures hold no definition of Engine, Fleet, Garage,
// Vehicle, Level1-3, ProbeH, CesP, DynP, DexHue, TbColor, DispColor, dProbeColors), the object's
// stored property bag answers: it has a Description where the bag holds one, or where it holds the
// CoderInfo of a Simulink.Parameter or a Simulink.Signal (ObjectNode.descriptionApplies).
//
// Then over every row of every fixture, dictionaries and MAT-files, and every entry the Add gallery
// makes: a row says the object has a
// Description exactly where MATLAB does; a Description it offers an edit of is the text the file
// shows when it is saved and opened again; and where there is none, the edit is refused and
// nothing is written. And MATLAB R2027a reads what is written (2026-10-24): a dexdata.DerivedSignal's
// and a dexdata.DerivedParam's Description, one added where the file held none, and a
// dexsparse.NumAlias's, in a text and a binary dictionary, and a MAT-file's Simulink.Parameter,
// Signal and NumericType, each loaded with the Description typed, quotes and all, and no warning.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Any = any;

const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

// isprop(obj, 'Description') in MATLAB R2027a, by class (probe_description_isprop.m). A table's is
// the Description of its Properties, which isprop answers for.
const MATLAB_HAS_DESCRIPTION: Record<string, boolean> = {
  'Simulink.AliasType': true,
  'Simulink.Bus': true,
  'Simulink.BusElement': true,
  'Simulink.ConfigSet': true,
  'Simulink.ConfigSetRef': true,
  'Simulink.SolverCC': true,
  'Simulink.ConnectionBus': true,
  'Simulink.ConnectionElement': true,
  'Simulink.NumericType': true,
  'Simulink.Parameter': true,
  'Simulink.ServiceBus': true,
  'Simulink.Signal': true,
  'Simulink.ValueType': true,
  'Simulink.VariantBank': true,
  'Simulink.data.dictionary.EnumTypeDefinition': true,
  'mpt.Parameter': true,
  'mpt.Signal': true,
  'dexsparse.HolderAlias': true,
  'dexsparse.FhAlias': true,
  'dexsparse.NumAlias': true,
  'dexdata.DerivedSignal': true,
  'dexdata.DerivedParam': true,
  // A user's subclass of each class one is made of (fixtures/subclasses).
  'dexsub.Alias': true,
  'dexsub.Num': true,
  'dexsub.VT': true,
  'dexsub.Bus': true,
  'dexsub.Param': true,
  'dexsub.Sig': true,
  table: true,
  'Simulink.Breakpoint': false,
  'Simulink.CoderInfo': false,
  'Simulink.FunctionElement': false,
  'Simulink.LoggingInfo': false,
  'Simulink.LookupTable': false,
  'Simulink.VariableUsage': false,
  'Simulink.VariantBankCoderInfo': false,
  'Simulink.VariantConfigurations': false,
  'Simulink.VariantControl': false,
  'Simulink.VariantExpression': false,
  'Simulink.VariantVariable': false,
  'SimulinkCSC.AttribClass_Simulink_Default': false,
  'matlab.lang.OnOffSwitchState': false,
  DagNode: false,
  DispLevel: false,
  MyEngine: false,
  MyGadget: false,
  NdHolder: false,
  Widget: false,
  WidgetPart: false,
  GearMode: false,
  categorical: false,
  'containers.Map': false,
  datetime: false,
  ComplexHolder: false,
  'embedded.fi': false,
  double: false,
  single: false,
  int8: false,
  int16: false,
  int32: false,
  int64: false,
  uint8: false,
  uint16: false,
  uint32: false,
  uint64: false,
  logical: false,
  char: false,
  string: false,
  struct: false,
  cell: false,
  function_handle: false,
};

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(p));
    else if (e.name.endsWith('.sldd') || e.name.endsWith('.mat')) out.push(p);
  }
  return out.sort();
}

function opened(file: string, bytes: Uint8Array) {
  const session = createSession();
  const root: Any = file.endsWith('.mat') ? session.addMatSource('f.mat', ab(bytes)) : ingest(session, ab(bytes), { filename: file.split('/').pop()! });
  const save = (): Uint8Array => {
    const out: Any = session.serializeSource(root.name);
    return out.kind === 'text' ? new TextEncoder().encode(out.text) : new Uint8Array(out.bytes);
  };
  return { session, root, save };
}

const isSection = (n: Any) => n.constructor.name === 'SectionNode';
const nodesOf = (root: Any): Any[] => (root.flatten() as Any[]).filter((n) => n.parent && !isSection(n));
const pathOf = (n: Any): number[] => {
  const p: number[] = [];
  for (let x = n; x && x.parent; x = x.parent) p.unshift(x.parent.children.indexOf(x));
  return p;
};
const nodeAt = (root: Any, path: number[]): Any => path.reduce((n, i) => n?.children?.[i], root);

/**
 * Whether MATLAB says the object `node` stands for has a Description: the class's answer above; no
 * value but an object's (a number, a struct, an empty or a whole object array, an enumeration
 * value) has one; and of a class MATLAB could not load, the stored bag's.
 */
function matlabSays(node: Any): boolean {
  const kind = node.constructor.name;
  if (kind === 'MatlabVariableNode' || kind === 'StructNode' || kind === 'ConstantNode' || node._isElementArray) {
    return false;
  }
  if (kind === 'EnumValueNode') {
    // An enumeral of a Simulink.data.dictionary.EnumTypeDefinition: appendEnumeral takes its
    // Description, which the definition holds beside its name and value.
    return true;
  }
  if (Object.prototype.hasOwnProperty.call(MATLAB_HAS_DESCRIPTION, node.className)) {
    return MATLAB_HAS_DESCRIPTION[node.className];
  }
  const bag = node._storedProperties?.() ?? node.serial?._properties ?? {};
  if (node._isEnumValue?.()) return false;
  const ci = bag.CoderInfo?._properties ?? bag.CoderInfo?._elements?.[0]?._properties;
  return 'Description' in bag || ((ci?.ParameterOrSignal === 'Parameter' || ci?.ParameterOrSignal === 'Signal') && !('Table' in bag) && !('Breakpoints' in bag));
}

// The one object the fixtures hold whose file says nothing of it: a user's subclass of
// Simulink.ValueType, every property at its default, which a text dictionary saves as no property
// at all (`_properties: {}`), as it saves an object of a class with none. MATLAB says it has a
// Description; this package, which cannot load the class, cannot tell, and shows none, the side on
// which an edit cannot write a key into a class that may have no such property. Its binary twin
// saves every property, its Description among them, and is decided by it.
const UNDECIDABLE: Record<string, boolean> = { 'subclass_defaults_text.sldd subVT': false };

const PI_DESCRIPTION = (node: Any) => (node.getPILayout?.() ?? []).flatMap((g: Any) => g.items).some((p: Any) => p.key === 'Description');

describe('a Description, over every row of every fixture', () => {
  it('applies exactly where MATLAB says the object has one; an edit offered survives a save; one where none is, is refused', { timeout: 900_000 }, () => {
    const wrong: string[] = [];
    const counts = { nodes: 0, applies: 0, refused: 0, edited: 0, aliased: 0 };
    for (const file of filesUnder('test')) {
      const bytes = new Uint8Array(readFileSync(file));
      let o: ReturnType<typeof opened>;
      try {
        o = opened(file, bytes);
      } catch {
        continue;
      }
      const edits: { path: number[]; text: string; label: string }[] = [];
      for (const node of nodesOf(o.root)) {
        counts.nodes++;
        const row = node.toRow();
        const label = file + ' ' + node.matlabPath + ' (' + node.className + ', ' + node.constructor.name + ')';
        const undecided = UNDECIDABLE[file.split('/').pop() + ' ' + node.matlabPath];
        const says = undecided ?? matlabSays(node);
        if (row._descriptionApplies !== says) {
          wrong.push(label + ': applies ' + row._descriptionApplies + ', MATLAB ' + says);
          continue;
        }
        if (!says) {
          if (row.Description !== '' || row._descriptionEditable !== false || PI_DESCRIPTION(node)) {
            wrong.push(label + ': no Description, yet ' + JSON.stringify({ text: row.Description, editable: row._descriptionEditable, pi: PI_DESCRIPTION(node) }));
          }
          o.session.setActive(o.root, node);
          // Through the session, as a host edits; or the node's own setter, where two nodes of the
          // file answer to the id and the session addresses neither (a file holding two variables
          // of one name).
          const asked: Any = o.session.editProperty(node.id, 'Description', 'zz');
          const r: Any = asked === false ? node.setProperty('Description', 'zz') : asked;
          // In the codebase's words, or MATLAB's own for the two classes refused in them.
          if (r === true || !/^Cannot edit ".*": an? .+ has no Description\.$|^Cannot edit "[^"]*": Unrecognized property 'Description' for class '[^']+'\.$/.test(r?.reason ?? '') || o.root.dirty) {
            wrong.push(label + ': an edit of its Description answered ' + JSON.stringify(r));
          }
          counts.refused++;
          continue;
        }
        counts.applies++;
        if (row._descriptionEditable) {
          edits.push({ path: pathOf(node), text: 'desc ' + edits.length, label });
        }
      }
      if (edits.length === 0) continue;
      const e = opened(file, bytes);
      // Two references to one object (a handle MATLAB saved once, held by two variables or
      // fields) are one Description: the object takes the edit through the first, and the second
      // refuses one of its own, saying so; the second then shows the first's.
      const taken: typeof edits = [];
      const aliased = new Set<number[]>();
      for (const edit of edits) {
        const node = nodeAt(e.root, edit.path);
        e.session.setActive(e.root, node);
        const r: Any = e.session.editProperty(node.id, 'Description', edit.text);
        if (r === true) {
          taken.push(edit);
        } else if (/ is one object with .+ holds an edit of it/.test(r?.reason ?? '')) {
          aliased.add(edit.path);
        } else {
          wrong.push(edit.label + ': an edit offered answered ' + JSON.stringify(r));
        }
      }
      let again: Any;
      try {
        again = opened(file, e.save()).root;
      } catch (err) {
        wrong.push(file + ': the save of its Description edits failed: ' + (err as Error).message);
        continue;
      }
      for (const { path, text, label } of taken) {
        counts.edited++;
        const shown = nodeAt(again, path)?.toRow().Description;
        // One the file holds as the same object as another edited after it shows that one's.
        const later = taken.slice(taken.findIndex((t) => t.path === path) + 1).map((t) => t.text);
        if (shown !== text && !(aliased.size > 0 && later.includes(shown))) {
          wrong.push(label + ': saved and opened again, its Description is ' + JSON.stringify(shown) + ', not ' + JSON.stringify(text));
        }
      }
      counts.aliased += aliased.size;
    }
    expect(wrong).toEqual([]);
    expect(counts.nodes).toBeGreaterThan(100_000);
    expect(counts.edited).toBeGreaterThan(500);
  });

  it('and of every entry the Add gallery makes, in a text and a binary dictionary', () => {
    const wrong: string[] = [];
    let made = 0;
    for (const file of ['test/parity/artifacts/text/cases.sldd', 'test/parity/artifacts/binary/cases.sldd']) {
      const bytes = new Uint8Array(readFileSync(file));
      const sections = (opened(file, bytes).root.children as Any[]).map((s) => [s.name, s.getAllowedTypes()] as [string, string[]]);
      for (const [section, classes] of sections) {
        for (const cls of classes) {
          const o = opened(file, bytes);
          o.session.setActiveContext(o.root);
          const node: Any = o.session.addEntry(section, cls, 'madeEntry');
          if (!node) continue;
          made++;
          const label = file + ' ' + section + ' ' + cls + ' (' + node.className + ', ' + node.constructor.name + ')';
          const row = node.toRow();
          const says = matlabSays(node);
          if (row._descriptionApplies !== says) {
            wrong.push(label + ': applies ' + row._descriptionApplies + ', MATLAB ' + says);
            continue;
          }
          o.session.setActive(o.root, node);
          const r: Any = o.session.editProperty(node.id, 'Description', 'made desc');
          if (!says) {
            if (r === true || PI_DESCRIPTION(node) || row.Description !== '') wrong.push(label + ': no Description, yet ' + JSON.stringify({ r, pi: PI_DESCRIPTION(node) }));
            continue;
          }
          if (!row._descriptionEditable) {
            wrong.push(label + ': a Description, and no edit of it');
            continue;
          }
          if (r !== true) {
            wrong.push(label + ': an edit offered answered ' + JSON.stringify(r));
            continue;
          }
          const again = opened(file, o.save()).root;
          const back = (again.flatten() as Any[]).find((n) => n.name === 'madeEntry');
          if (back?.toRow().Description !== 'made desc') wrong.push(label + ': saved and opened again, its Description is ' + JSON.stringify(back?.toRow().Description));
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(made).toBeGreaterThan(40);
  });
});
