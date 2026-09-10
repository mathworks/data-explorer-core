// Copyright 2026 The MathWorks, Inc.

import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { blockLabel, joinBlockPath } from '../blockIdentity.js';
import { ENUM_BLOCK_PARAMS } from './enumBlockParams.js';
import type { MaskScope } from '../maskScope.js';
import { parseMxArray, readMxArrayRecords } from './MxArrayParser.js';
import { parseMat } from './MatParser.js';
import type { MatVariable } from './MatParser.js';
import { reasonOf } from './ParseWarning.js';
import type { ParseWarning } from './ParseWarning.js';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
});

export interface BlockParamUsage {
  blockName: string;
  blockType: string;
  paramProperty: string;
  paramValue: string;
  /**
   * The block's SID — Simulink's own identity for it, unique within the MODEL where
   * the name is unique only within its system. '' for a classic `.mdl` older than
   * R2010b, which records none. See blockIdentity, which is where this is read.
   */
  sid: string;
  /**
   * The `/`-joined labels of the systems this block is INSIDE, model-relative — '' for
   * a block in the root system, `Controller` for one in that subsystem,
   * `Controller/Inner` two deep. Joined by blockIdentity.joinBlockPath, which owns the
   * escaping.
   *
   * The fact that tells two same-named blocks apart on screen, where the SID only tells
   * them apart in a link. Both model formats record the nesting and neither reader used
   * to carry it: every block arrived as though it sat at the root.
   */
  systemPath: string;
}

/**
 * One configuration set, or a REFERENCE to one, normalized across all five layouts.
 *
 * `objectClass` and `sourceName` are here rather than left for the node layer to dig
 * out of `data` because *where* they are recorded is era-specific, and hiding that is
 * this parser's job. Measured against R2027a, then exported to each era
 * (`test/parity/matlab/probe_configsetref.m` — item 15):
 *
 *   - R2026b+ JSON  `configSetN.json`  `"_object_class":"Simulink.ConfigSetRef"`
 *                                      `"SourceName":"dictCfg"`
 *   - R2015a–R2026a `configSetN.xml`   `<Object ClassName="Simulink.ConfigSetRef">`
 *                                      `<P Name="SourceName">` (R2021a and later)
 *                                      `<P Name="WSVarName">`  (R2018a and earlier)
 *   - R2014b and earlier               inline in `blockdiagram.xml`, same
 *                                      `ClassName=` attribute, `WSVarName`
 *
 * So the class is an ATTRIBUTE in every XML era and a FIELD in JSON, always spelled
 * with the full `Simulink.ConfigSetRef` — but the property naming what it points at
 * was renamed between R2018a and R2021a, which is the one fact here that could not
 * have been guessed. `sourceName` is `''` for an ordinary set, which has no source.
 *
 * NOT read: `SourceLocation`. It survives the export as the literal `Base Workspace`
 * in every XML era even when the set really came from a data dictionary (the JSON
 * layout says `Data Dictionary` for the same model), so on a file this reader might
 * be handed it is not a fact about the model.
 */
export interface ParsedConfigSet {
  name: string;
  active: boolean;
  data: unknown;
  objectClass: string;
  sourceName: string;
}

export interface ParsedSlx {
  name: string;
  release: string;
  creator: string;
  lastModified: string;
  uuid: string;
  dataDictionary: string | null;
  modelReferences: { blockPath: string; modelName: string }[];
  externalDataSources: string[];
  configSets: ParsedConfigSet[];
  workspace: MatVariable[] & { _trailingElements: Uint8Array[] };
  blockParamUsages: BlockParamUsage[];
  /**
   * Every masked subsystem's mask workspace — the names it defines for the blocks
   * inside it. The mask parameter VALUES are not here; they are in `blockParamUsages`
   * as parameters of the masked block, which is what they are. See maskScope.
   */
  masks: MaskScope[];
  // Null for a model that is not an OPC package at all: the classic `.mdl` is one
  // flat text file, with no parts to expose and no archive to write back. ModelNode
  // has always treated both as nullable.
  rawContents: Record<string, string> | null;
  zipEntries: Record<string, Uint8Array> | null;
  // What this file CLAIMED and this reader could not read. ALWAYS an array, empty for
  // a package read completely — never undefined, following ParsedProject.warnings so
  // that a caller never has to tell "clean" apart from "this reader does not report".
  //
  // A part a release never wrote is NOT in here, and that distinction is the whole
  // value of the field. An `.slx` from R2013b has no configSetInfo part, no
  // graphicalInterface part and no systems/ parts; a classic `.mdl` has no release
  // string and no UUID. Those files are complete and are read correctly, so they warn
  // about nothing. What warns is a part the package HOLDS and this reader could not
  // read, or one the package's own index NAMES and the package does not hold — see
  // test/parseWarnings.test.ts, which pins the silent cases as firmly as the loud ones.
  warnings: ParseWarning[];
}

function decodeText(buf: Uint8Array): string {
  return new TextDecoder().decode(buf);
}

function parseJSON(buf: Uint8Array): unknown {
  return JSON.parse(decodeText(buf));
}

function parseXml(buf: Uint8Array): unknown {
  return xmlParser.parse(decodeText(buf));
}

/**
 * One part, read or reported — every part read below goes through this.
 *
 * A part the package holds is a claim that it can be read, so a throw out of the XML
 * or JSON reader is a warning naming the part and what the model lost, after which the
 * caller carries on with whatever the other parts say. That is the difference between
 * a model that opens short and a file that does not open: before this, one corrupt part
 * threw out of parseSlx and took the other fifteen with it.
 *
 * Returns null both for a part that is ABSENT — which is how the reader asks which
 * layout it is looking at, and is silent — and for one that failed, which is not. The
 * caller branches on part presence, so the two never need telling apart.
 *
 * `lost` completes the sentence "…, so <lost>", and is the part of the message that
 * says what a user is now missing rather than which file offended.
 */
function readPart(
  entries: Record<string, Uint8Array>,
  path: string,
  lost: string,
  warnings: ParseWarning[],
): unknown | null {
  const buf = entries[path];
  if (!buf) {
    return null;
  }
  let doc: unknown;
  try {
    doc = path.endsWith('.json') ? parseJSON(buf) : parseXml(buf);
  } catch (err) {
    warnings.push({
      code: 'part-unreadable',
      message: `The model part "${path}" could not be read (${reasonOf(err)}), so ${lost}.`,
      part: path,
    });
    return null;
  }
  // fast-xml-parser is lenient and answers with an EMPTY object for input carrying no
  // markup at all — plain text, an empty part, binary — and that is the shape a
  // truncated or mis-encoded write actually takes. Same loss as a throw, so the same
  // report; ProjectParser.parseInfo already draws this line for the `.prj` store.
  if (doc === null || typeof doc !== 'object' || Object.keys(doc).length === 0) {
    warnings.push({
      code: 'part-unreadable',
      message: `The model part "${path}" holds nothing readable, so ${lost}.`,
      part: path,
    });
    return null;
  }
  return doc;
}

// The class of one configuration set, and what a reference points at — see
// `ParsedConfigSet` for the per-era evidence this encodes.
//
// Blank `objectClass` is not a failure: it means "this layout did not say", and every
// caller treats that as an ordinary `Simulink.ConfigSet`, which is what a file whose
// index lists a set and whose part records no class is. Only a POSITIVE
// `Simulink.ConfigSetRef` promotes a node to a reference, so no unreadable part can
// silently turn a set into one.
export function configSetIdentity(data: unknown): { objectClass: string; sourceName: string } {
  const blank = { objectClass: '', sourceName: '' };
  if (!data || typeof data !== 'object') return blank;
  const rec = data as Record<string, unknown>;

  // R2026b+ JSON: the class is a FIELD on the part's root object.
  if (typeof rec._object_class === 'string') {
    const props = (rec._properties || {}) as Record<string, unknown>;
    return {
      objectClass: rec._object_class,
      sourceName: String(props.SourceName ?? props.WSVarName ?? ''),
    };
  }

  // Every XML era: the class is an ATTRIBUTE of an `<Object>`. That element is the
  // record itself when `inlineConfigSets` hands over the `<Object>` it matched, and one
  // level down under `<ConfigSet>` in a `configSetN.xml` part — so take the first
  // `<Object>` at or below the root rather than assuming which. findAll does not
  // descend into an element it has already matched, so the component objects nested
  // inside a full set (`Simulink.SolverCC` and the rest) cannot be picked up by mistake.
  const obj =
    typeof rec['@_ClassName'] === 'string'
      ? rec
      : (findAll(rec, 'Object')[0] as Record<string, unknown> | undefined);
  if (!obj || typeof obj['@_ClassName'] !== 'string') return blank;
  const props = directProps(obj);
  // `SourceName` from R2021a, `WSVarName` in R2018a and earlier: one value, renamed.
  // Both are read in both directions, because a name is cheap to accept and a file
  // from a release this corpus does not sample is the case that would otherwise lose it.
  return { objectClass: obj['@_ClassName'], sourceName: props.SourceName ?? props.WSVarName ?? '' };
}

function extractConfigSets(
  entries: Record<string, Uint8Array>,
  configSetInfo: { PartName: string; ConfigSetName: string; Active: boolean }[],
  warnings: ParseWarning[],
): ParsedConfigSet[] {
  const configs: ParsedConfigSet[] = [];
  for (const info of configSetInfo) {
    const partPath = info.PartName.replace(/^\//, '');
    if (!entries[partPath]) {
      // The index part in THIS file names the part, so the package contradicts
      // itself and one configuration set is gone. That makes it the one absent part
      // in this reader that IS a warning: nothing about a release decides whether a
      // part its own index lists is present.
      warnings.push({
        code: 'part-unreadable',
        message: `The configuration set "${info.ConfigSetName}" is listed as part "${partPath}", `
          + 'which this package does not contain, so that set was not read.',
        part: partPath,
      });
      continue;
    }
    // The referenced part is `configSetN.json` from R2026b and `configSetN.xml`
    // before it. The info part names it either way, so the extension it points
    // at — not the release — decides how to read it.
    const data = readPart(entries, partPath, `the configuration set "${info.ConfigSetName}" was not read`, warnings);
    if (data === null) {
      // Dropped rather than kept with a null `data`, which is what an absent part has
      // always done here; the warning is what carries the name of what is missing.
      continue;
    }
    configs.push({
      name: info.ConfigSetName,
      active: !!info.Active,
      data: data,
      ...configSetIdentity(data),
    });
  }
  return configs;
}

function extractExternalDataSources(doc: unknown): string[] {
  const sources: string[] = [];
  const brokerSources = findAll(doc, 'ExplicitExternalBrokerSources');
  for (const el of brokerSources) {
    const pathVal = findText(el, 'fullPathToSource');
    if (pathVal) {
      sources.push(pathVal);
    }
  }
  return sources;
}

// Every value stored under `tagName`, at any depth, in document order. An empty
// element parses to '' rather than an object, so a caller that walks INTO a result
// (extractExternalDataSources does) hands a non-object straight back in — hence the
// base case, which is what keeps `<ExplicitExternalBrokerSources/>` from being a
// crash instead of "no sources".
function findAll(obj: unknown, tagName: string): unknown[] {
  const results: unknown[] = [];
  if (!obj || typeof obj !== 'object') {
    return results;
  }
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if (key === tagName) {
      results.push(...(Array.isArray(val) ? val : [val]));
    } else if (typeof val === 'object') {
      results.push(...findAll(val, tagName));
    }
  }
  return results;
}

// The first NON-EMPTY text under `tagName`, at any depth. Shares findAll's single
// traversal rather than keeping a second, near-identical recursion whose empty-value
// handling depended on match depth (an '' matched at the top level was returned; an
// '' matched while nested was skipped). Every caller already treats '' as absent —
// `findText(doc, 'cp:version') || findText(doc, 'version') || ''` — so "first
// non-empty" is the contract they all assume, applied uniformly.
function findText(obj: unknown, tagName: string): string | null {
  for (const val of findAll(obj, tagName)) {
    // A tag with attributes parses to an object whose text is under '#text'; a
    // plain tag parses to the string (or, for a bare number, to a number) itself.
    const text =
      val && typeof val === 'object'
        ? String((val as Record<string, unknown>)['#text'] ?? '')
        : String(val ?? '');
    if (text) {
      return text;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The legacy XML layout.
//
// A `.slx` is not one part layout. The JSON parts this file was first written
// against arrived in R2026b; every earlier release wrote XML, and the part set
// moved four more times before that — see the matrix in
// test/parity/matlab/README.md. So the XML readers below are not a nicety for
// museum pieces, they are the layout of essentially every `.slx` in existence.
//
// Every one of them is strictly a FALLBACK. `parseModelParts` tries the JSON part
// first and takes the XML path only when the JSON part is absent, so a
// current-release file cannot reach this code and its behaviour is unchanged by
// any of it.
//
// Where a release genuinely cannot express something the reader returns nothing
// rather than a guess: R2019b and earlier have no `ModelUUID` at all, and R2013b
// predates data dictionaries. Those are limits of the file, and the parity suite
// asserts them as such.
// ---------------------------------------------------------------------------

// The DIRECT `<P Name="x">v</P>` children of one element, as a map.
//
// Direct children only, deliberately: `findAll` recurses, and a `<Model>` carries
// hundreds of nested `<P>` elements under EditorSettings, ConfigManagerSettings
// and friends. A recursive lookup for `DataDictionary` would eventually match
// something else's property of the same name.
function directProps(el: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!el || typeof el !== 'object') return out;
  const p = (el as Record<string, unknown>).P;
  if (!p) return out;
  for (const entry of Array.isArray(p) ? p : [p]) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const name = rec['@_Name'];
    if (typeof name !== 'string') continue;
    out[name] = String(rec['#text'] ?? '');
  }
  return out;
}

// The `<Model>` element of a legacy `blockdiagram.xml`, or null.
//
// Null for three different reasons, only ONE of which is a warning. No part at all is
// a modern package, and a well-formed part with no `<Model>` in it is a LIBRARY —
// `blockdiagram.xml` carries `<Library>` there for a `.slx` library, which is a
// complete file this reader has never claimed to open as a model. Both stay silent.
// A part that is present and unreadable is the warning, and it is the biggest single
// loss in this file: before R2020a this one part carries the block diagram, the
// configuration sets, the model references and every block.
function legacyModel(
  entries: Record<string, Uint8Array>,
  warnings: ParseWarning[],
): Record<string, unknown> | null {
  const doc = readPart(
    entries,
    'simulink/blockdiagram.xml',
    "this model's blocks, configuration sets and model references are all missing",
    warnings,
  ) as Record<string, unknown> | null;
  if (!doc) return null;
  const info = doc.ModelInformation as Record<string, unknown> | undefined;
  const model = (info?.Model ?? null) as Record<string, unknown> | null;
  return model && typeof model === 'object' ? model : null;
}

// `configSetInfo.xml` in the shape the JSON reader already produces. The name is
// the element's TEXT here (it is a JSON field in the modern part) and `Active` is
// an attribute that is present only on the active one.
function legacyConfigSetInfo(doc: unknown): { PartName: string; ConfigSetName: string; Active: boolean }[] {
  const out: { PartName: string; ConfigSetName: string; Active: boolean }[] = [];
  for (const el of findAll(doc, 'ConfigSet')) {
    if (!el || typeof el !== 'object') continue;
    const rec = el as Record<string, unknown>;
    const partName = rec['@_PartName'];
    if (typeof partName !== 'string') continue;
    out.push({
      PartName: partName,
      ConfigSetName: String(rec['#text'] ?? ''),
      Active: String(rec['@_Active'] ?? '') === 'true',
    });
  }
  return out;
}

// Config sets for the oldest era, which has no `configSetInfo` part and no
// `configSetN` parts: R2014b and earlier carry them inline, as
// `<ConfigurationSet><Array PropName="ConfigurationSets"><Object ClassName=
// "Simulink.ConfigSet">`. Which one is active is recoverable rather than guessed —
// a sibling `<Object PropName="ActiveConfigurationSet">` points at one by
// ObjectID.
//
// A `Simulink.ConfigSetRef` sits in that same array, and this filter used to require
// exactly `Simulink.ConfigSet` and so DROPPED one — the entry vanished from the model's
// Configurations section with nothing said. Verified present in an R2013b export
// (`probe_configsetref.m`, item 15): a ref survives even into the era that cannot keep
// the data dictionary it points into, and it is recognisable there by the same
// `ClassName=` attribute a full set carries. The two classes are matched by name rather
// than by "anything with a Name property" because this array is also where
// `ActiveConfigurationSet` and the component objects live.
function inlineConfigSets(model: Record<string, unknown>): ParsedConfigSet[] {
  const container = model.ConfigurationSet;
  if (!container) return [];

  let activeId = '';
  for (const ref of findAll(model, 'Object')) {
    if (!ref || typeof ref !== 'object') continue;
    const rec = ref as Record<string, unknown>;
    if (rec['@_PropName'] === 'ActiveConfigurationSet') {
      activeId = String(rec['@_ObjectID'] ?? '');
      break;
    }
  }

  const out: ParsedConfigSet[] = [];
  for (const obj of findAll(container, 'Object')) {
    if (!obj || typeof obj !== 'object') continue;
    const rec = obj as Record<string, unknown>;
    const cls = rec['@_ClassName'];
    if (cls !== 'Simulink.ConfigSet' && cls !== 'Simulink.ConfigSetRef') continue;
    const name = directProps(rec).Name;
    if (!name) continue;
    const id = String(rec['@_ObjectID'] ?? '');
    out.push({ name, active: !!id && id === activeId, data: rec, ...configSetIdentity(rec) });
  }
  return out;
}

// The ref a systems part is linked by: `simulink/systems/system_7.xml` -> `system_7`,
// which is the string a `<System Ref="system_7"/>` stub names it with.
const SYSTEMS_DIR = 'simulink/systems/';
function partRef(key: string): string {
  return key.slice(SYSTEMS_DIR.length, -'.xml'.length);
}

// Every part ref named anywhere below `obj`, collected into `out`.
//
// A FULL descent, unlike findAll, which stops at each element it matches: the refs
// wanted here sit on a `<System Ref="…"/>` stub inside a SubSystem block, and a part can
// hold such a block at any depth. Matching on the element name as well as the attribute
// keeps this to system links — a `<Block Ref=…>` would be something else entirely.
function systemRefsIn(obj: unknown, out: Set<string>): void {
  if (!obj || typeof obj !== 'object') return;
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    for (const item of Array.isArray(val) ? val : [val]) {
      if (!item || typeof item !== 'object') continue;
      const ref = (item as Record<string, unknown>)['@_Ref'];
      if (key === 'System' && typeof ref === 'string') out.add(ref);
      systemRefsIn(item, out);
    }
  }
}

// Model references from a legacy `graphicalInterface`, which packs both facts into
// ONE string: `<P Name="ModelRefBlockPath">$bdroot/Child|slx_child</P>`. The
// modern part splits them into `BlockPath` and `ModelName`, so this splits on the
// last `|` — a model name cannot contain one, a block path conceivably could.
function legacyModelReferences(root: unknown): { blockPath: string; modelName: string }[] {
  const out: { blockPath: string; modelName: string }[] = [];
  for (const ref of findAll(root, 'ModelReference')) {
    const path = directProps(ref).ModelRefBlockPath;
    if (!path) continue;
    const cut = path.lastIndexOf('|');
    if (cut < 0) continue;
    out.push({ blockPath: path.slice(0, cut), modelName: path.slice(cut + 1) });
  }
  return out;
}

const NUMERIC_RE = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
// The MATLAB non-finite literals, in any case and with an optional sign. A
// Saturation block's `UpperLimit=Inf` is a NUMBER, not a reference to a workspace
// variable named Inf. This was a case-SENSITIVE comparison against the three
// lowercase spellings, so exactly the spellings MATLAB itself writes — `Inf`,
// `-Inf`, `NaN` — slipped past it and every such block reported a phantom variable
// usage. Anchored, so `Infinity` still counts as an identifier: that is the
// JavaScript name, MATLAB cannot evaluate it, and a variable may legally use it.
const NON_FINITE_RE = /^[+-]?(inf|nan)$/i;
// At least one MATLAB identifier char-run — i.e. the value could name a variable.
// Used to gate which block params count as data references (see below).
const IDENT_RE = /[A-Za-z_]\w*/;

// Block <P> properties that are cosmetic/structural, never a parameter
// EXPRESSION. Every OTHER property whose value contains an identifier is treated
// as a potential data reference. We use this SKIP set (a blocklist) rather than an
// allowlist of "known" param props because an allowlist silently drops any block
// type nobody enumerated: a TransferFcn keeps its coefficients in
// Numerator/Denominator, a StateSpace in A/B/C/D, etc. — none of which were on the
// old list, so those blocks never surfaced as Modeling Elements and the variables
// they referenced showed empty Usage (issue #9). The identifier gate below keeps
// pure operator/number values (a Sum's `Inputs=|++`, a `Gain=22.8`) out, so only
// blocks that actually reference named data become rows.
const NON_PARAM_PROPS = new Set([
  'Position',
  'ZOrder',
  'FontName',
  'FontSize',
  'ForegroundColor',
  'BackgroundColor',
  'NameLocation',
  'ShowName',
  'BlockMirror',
  'BlockRotation',
  'Orientation',
  'Ports',
  'MaskType',
  'SourceBlock',
  'SourceType',
  'IconShape',
  'RndMeth',
  'SaturateOnIntegerOverflow',
  'OutDataTypeStr',
  'ParamDataTypeStr',
  'DataTypeStr',
  'IOType',
  'GraphicalSettings',
  'WindowPosition',
  'MultipleDisplayCache',
  'LayoutDimensionsString',
  'DataLoggingSaveFormat',
  'OpenFcn',
  'Units',
  'WaveForm',
  'MinAlgLoopOccurrences',
  'TreatAsAtomicUnit',
  'RequestExecContextInheritance',
  // Bookkeeping a ModelReference block carries in the CLASSIC .mdl only: the name
  // the referenced model had when the block was last copied. It is not a parameter
  // expression, and leaving it in gave the classic flavour of a file an extra
  // `Child / CopyOfModelName` row the .slx flavour of the SAME model did not have.
  'CopyOfModelName',
]);

// Simulink stores a block's line breaks as the numeric char reference `&#xA;`
// (Simulink wraps long block labels across lines). fast-xml-parser decodes NAMED
// entities but not numeric ones (no htmlEntities option), so the raw name keeps
// the literal `&#xA;`. Decode CR/LF numeric refs and collapse any run of
// whitespace to a single space so a multi-line label reads as one flat cell
// (e.g. "Alpha-sensor&#xA;Low-pass Filter" -> "Alpha-sensor Low-pass Filter").
export function normalizeBlockName(name: string): string {
  return name
    .replace(/&#x0*(a|d);/gi, ' ') // hex: &#xA; &#x0A; &#xD; (LF, CR)
    .replace(/&#0*(10|13);/g, ' ') // decimal: &#10; &#13; (LF, CR)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Could this VALUE, whatever holds it, refer to named data?
 *
 * The half of the gate that is about the expression rather than about the property it
 * was written into — split out for the mask parameters, whose "property name" is a name
 * the mask's author chose and so cannot be judged by the blocklist above. A mask
 * parameter legitimately named `Units` or `Position` is a real reference; a block `<P>`
 * of either name never is.
 */
export function valueReferencesData(value: string): boolean {
  if (!value || NUMERIC_RE.test(value)) return false;
  if (NON_FINITE_RE.test(value)) return false;
  if (value === 'on' || value === 'off') return false;
  // Must contain an identifier that could name a variable. This excludes
  // operator-only sign patterns (Sum `Inputs=|++`) and enum-ish tokens
  // handled above, while keeping expressions like `[Tal,1]` or `1/Uo`.
  return IDENT_RE.test(value);
}

/**
 * Free-text parameters a block fills with something other than data, keyed by BlockType.
 *
 * The companion to ENUM_BLOCK_PARAMS and the part no scan can produce: these are ordinary
 * string parameters, so nothing in the dialog marks them, and nothing in the file does
 * either. Each is here because `Simulink.findVars` was asked directly, on a model built to
 * make the question sharp — see test/parity/matlab/probe_non_data_params.m.
 *
 *   BusSelector.OutputSignals    the names of the signals selected out of a bus. Measured
 *   BusAssignment.AssignedSignals  on wired models whose bus carries a signal `a` while
 *                                the model workspace ALSO holds a variable `a`: findVars
 *                                credits the control Gain's `kGain` and nothing else, and
 *                                `a` has no users at all. Pointed the other way — at
 *                                `a_var`, a variable that is NOT a signal on the bus —
 *                                it is still not credited, so the parameter is a signal
 *                                name in both directions and never an expression.
 *                                Admitting it put the Bus Selector on the Usage cell of a
 *                                variable it does not read: a false edge, not a spare row.
 *
 *   ModelReference.ModelNameDialog  the referenced model's FILE name — measured the same
 *   ModelReference.ModelFile        way (a parent whose workspace holds a variable named
 *   ModelReference.ModelName        exactly like the child model: not credited). And not
 *                                really a findVars question, because a file reference is
 *                                already surfaced, resolved, as `ParsedSlx.modelReferences`.
 *                                Left in, the same fact arrived a second time as a data
 *                                reference that resolves to nothing — and `child.slx`
 *                                passes the identifier gate, so a dictionary entry named
 *                                `child` would have collected a link from it. All three
 *                                names are one parameter under three spellings: a block
 *                                reporting `ModelNameDialog=child` also reports
 *                                `ModelFile=child.slx` and `ModelName=child`.
 *
 * `ParameterArgumentValues` and `ParameterArgumentNames` are deliberately NOT here: a
 * model argument's value is an expression in the parent's scope and is exactly the kind of
 * reference this column exists to show.
 */
const NON_DATA_BLOCK_PARAMS: Readonly<Record<string, readonly string[]>> = {
  BusSelector: ['OutputSignals'],
  BusAssignment: ['AssignedSignals'],
  ModelReference: ['ModelNameDialog', 'ModelFile', 'ModelName'],
};

// Both pair-keyed tables as one lookup, built once. `isParamReference` runs for every
// property of every block of every model in a workspace, so this is a Set membership test
// and not a scan of two record literals.
const NON_DATA_PARAMS: ReadonlyMap<string, ReadonlySet<string>> = (() => {
  const merged = new Map<string, Set<string>>();
  for (const table of [ENUM_BLOCK_PARAMS, NON_DATA_BLOCK_PARAMS]) {
    for (const [blockType, params] of Object.entries(table)) {
      const set = merged.get(blockType) ?? new Set<string>();
      for (const p of params) set.add(p);
      merged.set(blockType, set);
    }
  }
  return merged;
})();

/**
 * Does `propName = value` on a block of type `blockType` count as a reference to named data?
 *
 * The one gate both model formats go through, so a `.mdl` and the `.slx` of the
 * SAME diagram surface the same rows. Exported for MdlParser, which reads the
 * classic nested-brace flavour and has no `<P>` elements to work from.
 *
 * `blockType` narrows the two pair-keyed tables and nothing else, so a block type neither
 * table knows — every toolbox block, and every masked library link, which a file records
 * as `Reference` — is judged exactly as before. That is the safe direction: an unlisted
 * pair is admitted, and admitting a spare row costs less than hiding a real reference
 * (issue #9). An EMPTY blockType, which a hand-made file can have, matches no table.
 */
export function isParamReference(blockType: string, propName: string, value: string): boolean {
  if (!propName || NON_PARAM_PROPS.has(propName)) return false;
  if (NON_DATA_PARAMS.get(blockType)?.has(propName)) return false;
  return valueReferencesData(value);
}

/**
 * Mask parameter types whose `<Value>` is an EXPRESSION Simulink evaluates against
 * workspace data, as opposed to a widget state or a chosen option.
 *
 * An ALLOWLIST, which is the opposite of NON_PARAM_PROPS above and for the opposite
 * reason. A block `<P>` is usually an expression and the exceptions are enumerable; a
 * mask parameter is usually a SELECTION — most of the types below are — so a type
 * nobody has measured must not be assumed to hold an expression. Getting that backwards
 * is not a cosmetic miss: a popup's value is the option text the user picked, and
 * crediting it puts a block on the Usage cell of any variable that happens to share the
 * option's spelling. maskUsage.slx plants exactly that trap — a model workspace
 * variable `popupVar` and a popup whose selected option is the word `popupVar` — and
 * MATLAB ignores it.
 *
 * Measured with test/parity/matlab/probe_mask_types.m under R2027a: one parameter of
 * every type `Simulink.Mask.addParameter` accepts, each valued with the NAME of a model
 * workspace variable, then `Simulink.findVars` asked which of those names it resolved.
 *
 *   resolved      edit, slider, dial, min, max
 *   NOT resolved  checkbox, popup, combobox, listbox, radiobutton, unit, promote
 *
 * `spinbox` is here unmeasured — that release's addParameter would not accept it — on
 * the grounds that it is the same numeric-entry family as slider and dial, both of which
 * resolve. A missing `Type` attribute is read as `edit`: no MathWorks writer omits it,
 * so a file that does is a hand-made one, and `edit` is what a hand-made mask means.
 */
const EXPRESSION_MASK_TYPES = new Set(['edit', 'slider', 'dial', 'spinbox', 'min', 'max']);

/**
 * Does a mask parameter of this TYPE hold an expression? Exported for MdlParser, which
 * reads the same fact out of a classic `.mdl`'s `MaskStyleString` and must reach the same
 * answer — the type is spelled the same in both formats, so the set can be shared whole.
 */
export function isExpressionMaskType(type: string): boolean {
  return EXPRESSION_MASK_TYPES.has(type.trim().toLowerCase());
}

// `legacy` is the `<Model>` element of a legacy blockdiagram.xml, already parsed by
// the caller — that part is the largest in the package and every legacy branch
// wants something from it, so it is read once and passed around.
function extractBlockParamUsages(
  entries: Record<string, Uint8Array>,
  legacy: Record<string, unknown> | null,
  warnings: ParseWarning[],
): { usages: BlockParamUsage[]; masks: MaskScope[] } {
  const usages: BlockParamUsage[] = [];
  const masks: MaskScope[] = [];

  // The blocks of ONE system, each with the path of the systems enclosing it, and then
  // the systems its own subsystems own — the recursion that carries the path.
  //
  // `findAll` deliberately does not descend into an element it has already matched, so
  // one call answers with this system's OWN blocks and stops. A subsystem's blocks are
  // reached through the `<System>` its block owns, which is where the two layouts differ
  // and the only place they do: INLINE in every release before R2020a, a
  // `<System Ref="system_7"/>` stub pointing at another part in every release since.
  // Both are handled, because a package can be either and this reader is handed both.
  //
  // Scoping to `<System>` rather than to the whole document is what keeps this honest: a
  // legacy blockdiagram.xml also carries `<BlockDefaults>` and `<BlockParameterDefaults>`,
  // which are TEMPLATE blocks — every block type Simulink knows, with placeholder values
  // like `<Enter Model Name>`. Walking the document would report every one of them as a
  // real block using real parameters.
  const collect = (system: unknown, path: string, descend: (ref: string, into: string) => void): void => {
    for (const block of findAll(system, 'Block')) {
      const b = block as Record<string, unknown>;
      const blockName = normalizeBlockName((b['@_Name'] as string) || '');
      const blockType = (b['@_BlockType'] as string) || '';
      // String() rather than a cast: the SID is an attribute and this parser leaves
      // attributes as text, but a SID is digits and one option flip away from
      // arriving as a number.
      const sid = b['@_SID'] === undefined || b['@_SID'] === null ? '' : String(b['@_SID']);
      const props = b['P'];
      for (const p of props ? (Array.isArray(props) ? props : [props]) : []) {
        const pObj = p as Record<string, unknown>;
        const propName = pObj['@_Name'] as string;
        const val = (pObj['#text'] as string) || '';
        if (!isParamReference(blockType, propName, val)) continue;
        usages.push({ blockName, blockType, paramProperty: propName, paramValue: val, sid, systemPath: path });
      }
      // A MASK, if this block wears one. Its parameters are read on the same terms as
      // the `<P>` properties above and pushed onto the same list — a mask parameter's
      // value is a parameter expression OF THIS BLOCK, evaluated where this block sits,
      // so `path` (the enclosing system, not the block's own) is already the right
      // scope for it. The NAMES go somewhere else entirely; see maskScope.
      const mask = b['Mask'] as Record<string, unknown> | undefined;
      if (mask) {
        const names: string[] = [];
        // `MaskParameter` only: a `<Mask>` also holds `<DialogControl>` elements which
        // carry a `Type` attribute of their own and a `Name` matching the parameter they
        // present, so a document-wide search would read every parameter twice, the
        // second time with a widget's notion of its type (`Edit`, capitalised).
        const params = mask['MaskParameter'];
        for (const one of params ? (Array.isArray(params) ? params : [params]) : []) {
          const mp = one as Record<string, unknown>;
          const paramName = mp['@_Name'] === undefined ? '' : String(mp['@_Name']);
          if (paramName === '') continue;
          // Occupies the name whether or not its value is an expression, so that a
          // checkbox cannot leave a model-workspace variable of the same name visible
          // to the blocks this mask encloses.
          names.push(paramName);
          const type = mp['@_Type'] === undefined ? 'edit' : String(mp['@_Type']);
          if (!isExpressionMaskType(type)) continue;
          // A parameter with Evaluate OFF is handed to the mask as the LITERAL TEXT the
          // user typed, so a value that reads like a variable name is a string and not a
          // reference. Measured: an `edit` valued `v_off` with Evaluate off gets no usage
          // from findVars where the same edit with Evaluate on does. Absent means on,
          // which is the default and the only spelling in most files. The classic `.mdl`
          // records the same fact as `&` instead of `@` in MaskVariables.
          if (String(mp['@_Evaluate'] ?? 'on') === 'off') continue;
          // `<Value>` has no attributes, so it arrives as the text itself rather than as
          // an object with a '#text' — and as a NUMBER when it looks like one, this
          // parser leaving tag values converted. Both are the same string to the gate.
          const raw = mp['Value'];
          if (raw === undefined || raw === null) continue;
          const val = String(raw);
          if (!valueReferencesData(val)) continue;
          usages.push({ blockName, blockType, paramProperty: paramName, paramValue: val, sid, systemPath: path });
        }
        if (names.length > 0) {
          // The mask's OWN path — one level deeper than the usages above, because this
          // is the scope INSIDE the block, and the values were expressions outside it.
          masks.push({ sid, blockName, blockPath: joinBlockPath(path, blockLabel(blockName, sid)), names });
        }
      }
      // Reached whether or not this block had a single parameter of its own: a SubSystem
      // is usually all structure, and skipping a block with no `<P>` would skip the
      // system underneath it and with it every block in the subsystem.
      const inner = b.System;
      if (!inner) continue;
      const childPath = joinBlockPath(path, blockLabel(blockName, sid));
      for (const one of Array.isArray(inner) ? inner : [inner]) {
        const ref = (one as Record<string, unknown> | null)?.['@_Ref'];
        if (typeof ref === 'string') {
          descend(ref, childPath);
        } else {
          collect(one, childPath, descend);
        }
      }
    }
  };

  // `simulink/systems/*.xml` from R2020a on, one part per system, linked to each other by
  // ref. Before that the block tree lived inside blockdiagram.xml, so when there are no
  // systems parts the diagram's own `<System>` is the root to walk instead.
  //
  // One unreadable systems part is one subsystem's blocks, not the model, so the loop
  // reports it and carries on through the rest — a model organised into ten subsystems
  // should not lose nine of them to the tenth. Note that having NO systems parts at all
  // is not a loss and not reported: that is every release before R2020a, and the legacy
  // branch below is how those files are read.
  const parts = new Map<string, unknown>();
  for (const key in entries) {
    if (key.startsWith(SYSTEMS_DIR) && key.endsWith('.xml')) {
      const root = readPart(entries, key, 'the blocks it holds are missing', warnings);
      if (root !== null) {
        parts.set(partRef(key), root);
      }
    }
  }

  if (parts.size > 0) {
    const visited = new Set<string>();
    const descend = (ref: string, into: string): void => {
      // Each part is walked ONCE, which is both what it was before there were paths and
      // what stops a file whose refs form a cycle from recursing for ever.
      if (visited.has(ref)) return;
      visited.add(ref);
      const part = parts.get(ref);
      if (part !== undefined) collect(part, into, descend);
    };
    // The ROOT is the part nothing else points at. That is `system_root` in every package
    // MathWorks writes, and the block diagram names it outright — but deriving it costs a
    // set of the refs this reader has already got, and then no era's spelling of the
    // diagram (XML before R2026b, JSON after) has to be right for a single block to be
    // read. Note that only the PARTS are scanned, so the diagram's own link to the root
    // does not make the root look referenced.
    const referenced = new Set<string>();
    for (const part of parts.values()) systemRefsIn(part, referenced);
    for (const ref of parts.keys()) {
      if (!referenced.has(ref)) descend(ref, '');
    }
    // Whatever the walk did not reach — a part referenced only from a part that failed to
    // read, or from one whose ref this reader could not see — contributes its blocks at
    // the root, exactly as it did when every part was walked as its own root. A path is
    // worth having; it is not worth losing blocks over.
    for (const ref of parts.keys()) descend(ref, '');
  } else if (legacy && legacy.System) {
    for (const system of Array.isArray(legacy.System) ? legacy.System : [legacy.System]) {
      // No parts, so nothing to descend INTO: this era nests inline, which `collect`
      // handles itself.
      collect(system, '', () => undefined);
    }
  }
  return { usages, masks };
}

function extractModelReferences(
  graphicalInterface: Record<string, unknown> | null,
): { blockPath: string; modelName: string }[] {
  if (!graphicalInterface) {
    return [];
  }
  // Two JSON shapes. R2024b-R2026a — the releases that moved this part to JSON while
  // the block diagram was still XML — WRAP the content in a `GraphicalInterface`
  // object; R2026b flattened it and marks the element with `_mw_element_name`
  // instead. Reading only the flat shape silently lost every model reference from a
  // three-release window, which is the same wrapping `blockDiagram.json` is already
  // unwrapped for above.
  const gi = (graphicalInterface.GraphicalInterface as Record<string, unknown>) || graphicalInterface;
  const refs = gi.ModelReferences;
  if (!refs) {
    return [];
  }
  return (refs as { BlockPath: string; ModelName: string }[]).map(function (ref) {
    return { blockPath: ref.BlockPath, modelName: ref.ModelName };
  });
}

export function parseSlx(buffer: ArrayBuffer, filename: string): ParsedSlx {
  return parseModelParts(unzipSync(new Uint8Array(buffer)), filename);
}

/**
 * The model behind an OPC part map — everything `parseSlx` does except unzipping.
 *
 * A `.slx` is a ZIP OPC package; the modern `.mdl` is the SAME part set written as
 * a TEXT OPC package (`__MWOPC_PART_BEGIN__` delimiters, binary parts base64'd).
 * The two formats differ only in how the bytes of each part are framed, so the
 * reading of those parts belongs in one place — see MdlParser, which decodes the
 * text framing and calls straight in here.
 */
export function parseModelParts(entries: Record<string, Uint8Array>, filename: string): ParsedSlx {
  // Everything this package claimed and could not hand over. Built here and returned
  // whatever happens below, because a short parse is still a parse: a host has to be
  // able to open the model AND say what is missing from it.
  const warnings: ParseWarning[] = [];

  // Core metadata
  let release = '';
  let creator = '';
  let lastModified = '';
  const core = readPart(
    entries,
    'metadata/coreProperties.xml',
    "this model's release, creator and last-modified date are missing",
    warnings,
  );
  if (core) {
    release = findText(core, 'cp:version') || findText(core, 'version') || '';
    creator = findText(core, 'dc:creator') || findText(core, 'creator') || '';
    lastModified = findText(core, 'dcterms:modified') || findText(core, 'modified') || '';
  }

  // The legacy block diagram part, read once: several branches below need it, and
  // it is the largest part in the package. Null for a current-release file, which
  // has `blockDiagram.json` instead and never touches the legacy paths.
  const legacy = legacyModel(entries, warnings);

  // Block diagram (linked dictionary, UUID, model-workspace data source)
  let dataDictionary: string | null = null;
  let uuid = '';
  let workspaceMatFile: string | null = null;
  if (entries['simulink/blockDiagram.json']) {
    // Branching on the part being PRESENT rather than on the read succeeding, so that
    // an unreadable modern part is reported as itself and does not fall through to the
    // legacy reader, which would report a second, misleading loss for a part that a
    // current-release package was never going to contain.
    const bd = readPart(
      entries,
      'simulink/blockDiagram.json',
      "this model's dictionary link, its UUID and its model-workspace source are missing",
      warnings,
    ) as Record<string, unknown> | null;
    const diagram = bd ? ((bd.BlockDiagram as Record<string, unknown>) || bd) : {};
    dataDictionary = (diagram.DataDictionary as string) || null;
    uuid = (diagram.ModelUUID as string) || '';
    // Model workspace sourced from a MAT file (model -> mat relationship). MATLAB
    // records this here, NOT in ExternalDataSourceSettings.xml.
    const ws = diagram.ModelWorkspace as Record<string, unknown> | undefined;
    if (ws && ws.WSDataSource === 'MAT-File' && typeof ws.WSSourceFileName === 'string') {
      workspaceMatFile = ws.WSSourceFileName;
    }
  } else if (legacy) {
    // The same three facts, as `<P Name="...">` children of `<Model>`. `ModelUUID`
    // arrived in R2020a, so it stays '' for anything older — the file does not
    // have one to read.
    const props = directProps(legacy);
    dataDictionary = props.DataDictionary || null;
    uuid = props.ModelUUID || '';
    const wsProps = directProps(legacy.ModelWorkspace);
    if (wsProps.WSDataSource === 'MAT-File' && wsProps.WSSourceFileName) {
      workspaceMatFile = wsProps.WSSourceFileName;
    }
  }

  // Config sets. Three layouts: a JSON index (R2026b+), an XML index (R2015a-R2026a)
  // — both of which point at one `configSetN` part each — and, before R2015a, no
  // index part at all because the sets are inline in the block diagram.
  let configSets: ParsedConfigSet[] = [];
  if (entries['simulink/configSetInfo.json']) {
    // One warning for an unreadable index, not one per set: the index is what names the
    // sets, so when it is gone their number and their names are gone with it and there
    // is nothing left to count. `extractConfigSets` is still called with an empty list
    // so the rest of the model is read normally.
    const info = readPart(
      entries,
      'simulink/configSetInfo.json',
      'no configuration sets were read',
      warnings,
    ) as Record<string, unknown> | null;
    configSets = extractConfigSets(
      entries,
      (info?.ConfigSetInfo as { PartName: string; ConfigSetName: string; Active: boolean }[]) || [],
      warnings,
    );
  } else if (entries['simulink/configSetInfo.xml']) {
    const info = readPart(entries, 'simulink/configSetInfo.xml', 'no configuration sets were read', warnings);
    configSets = extractConfigSets(entries, legacyConfigSetInfo(info), warnings);
  } else if (legacy) {
    configSets = inlineConfigSets(legacy);
  }

  // Graphical interface (model references). JSON from R2024b, XML from R2014b, and
  // inline in the block diagram before that.
  let modelReferences: { blockPath: string; modelName: string }[] = [];
  const REFS_LOST = "this model's references to other models are missing";
  if (entries['simulink/graphicalInterface.json']) {
    const gi = readPart(entries, 'simulink/graphicalInterface.json', REFS_LOST, warnings) as Record<
      string,
      unknown
    > | null;
    modelReferences = gi ? extractModelReferences(gi) : [];
  } else if (entries['simulink/graphicalInterface.xml']) {
    modelReferences = legacyModelReferences(
      readPart(entries, 'simulink/graphicalInterface.xml', REFS_LOST, warnings),
    );
  } else if (legacy && legacy.GraphicalInterface) {
    // Read out of the block diagram, which has already been reported if it failed —
    // reaching here at all means it parsed. Nothing to warn about a second time.
    modelReferences = legacyModelReferences(legacy.GraphicalInterface);
  }

  // External data sources (.mat files)
  let externalDataSources: string[] = [];
  const eds = readPart(
    entries,
    'simulink/ExternalDataSourceSettings.xml',
    "this model's external data sources are missing",
    warnings,
  );
  if (eds) {
    externalDataSources = extractExternalDataSources(eds);
  }
  // Model-workspace MAT source (from blockDiagram.json) is also external data.
  if (workspaceMatFile && !externalDataSources.includes(workspaceMatFile)) {
    externalDataSources.push(workspaceMatFile);
  }

  // Model workspace (binary mxarray)
  let workspace: MatVariable[] & { _trailingElements: Uint8Array[] } = [] as unknown as MatVariable[] & {
    _trailingElements: Uint8Array[];
  };
  (workspace as unknown as { _trailingElements: Uint8Array[] })._trailingElements = [];
  if (entries['simulink/modelWorkspace.mxarray']) {
    const part = entries['simulink/modelWorkspace.mxarray'];
    workspace = parseMxArray(part.buffer);
    if (workspace.length === 0) {
      // An mxarray that decodes to no variables is the ordinary shape of an EMPTY model
      // workspace — a `1x1 struct` with zero fields — and a model whose workspace is
      // empty has lost nothing. So zero variables on its own must not warn, or every
      // model without a workspace would carry a count.
      //
      // What separates the two is the FRAMING: re-reading the records tells whether this
      // part holds a struct at all. No outer element, or one with no field table, means
      // the bytes are not an mxarray, and then a workspace that may well have had
      // variables in it was not read. `parseMxArray` cannot report this itself — it
      // answers with an empty array either way, which is exactly the ambiguity item 3 is
      // about — so the distinction is drawn here, at the one call site that knows the
      // part was present.
      const { outer } = readMxArrayRecords(part.buffer);
      if (!outer || !outer.fields) {
        warnings.push({
          code: 'part-unreadable',
          message:
            'The model part "simulink/modelWorkspace.mxarray" does not hold a decodable '
            + "workspace, so this model's workspace variables were not read.",
          part: 'simulink/modelWorkspace.mxarray',
        });
      }
    }
  } else if (entries['simulink/modelworkspace.mat']) {
    // Before R2019b the workspace part is a whole `MATLAB 5.0 MAT-file` — same
    // record framing `parseMat` already reads for a standalone `.mat`, one top-level
    // variable per workspace variable, rather than the mxarray's single struct whose
    // FIELDS are the variables. So this is routing, not a second decoder.
    const buf = entries['simulink/modelworkspace.mat'];
    try {
      // Slice rather than hand over `.buffer`: the entry may be a view into a larger
      // allocation, and parseMat reads its header from offset 0.
      const mat = parseMat(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
      workspace = mat.variables as MatVariable[] & { _trailingElements: Uint8Array[] };
      // `parseMat` refuses a file that is not a MAT-file at all and reports everything
      // short of that in its own warnings. Those are about a part of THIS package, so
      // they are re-parted onto the path the package knows: a host showing them next to
      // the model has to be able to say which of its parts they came from, and
      // "legacyObj" alone does not say that. The inner name is kept after a `#`, the way
      // a fragment names something inside a document, so nothing is lost in the move.
      for (const inner of mat.warnings) {
        warnings.push({
          ...inner,
          part: inner.part
            ? `simulink/modelworkspace.mat#${inner.part}`
            : 'simulink/modelworkspace.mat',
        });
      }
    } catch (err) {
      warnings.push({
        code: 'part-unreadable',
        message:
          `The model part "simulink/modelworkspace.mat" could not be read (${reasonOf(err)}), `
          + "so this model's workspace variables were not read.",
        part: 'simulink/modelworkspace.mat',
      });
    }
    // No mxarray framing here, so there is nothing trailing to preserve. The field
    // is still set because every consumer reads it unconditionally.
    (workspace as unknown as { _trailingElements: Uint8Array[] })._trailingElements = [];
  }

  // Block parameter usages (which blocks reference which params by name), and the mask
  // workspaces the same walk passed through
  const { usages: blockParamUsages, masks } = extractBlockParamUsages(entries, legacy, warnings);

  const rawContents: Record<string, string> = {};
  for (const key in entries) {
    if (key.endsWith('.xml') || key.endsWith('.json')) {
      rawContents[key] = decodeText(entries[key]);
    }
  }

  return {
    name: filename,
    release,
    creator,
    lastModified,
    uuid,
    dataDictionary,
    modelReferences,
    externalDataSources,
    configSets,
    workspace,
    blockParamUsages,
    masks,
    rawContents,
    zipEntries: entries,
    warnings,
  };
}
