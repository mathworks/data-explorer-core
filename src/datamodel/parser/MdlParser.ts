// Copyright 2026 The MathWorks, Inc.

// Parser for `.mdl`, the other on-disk form of a Simulink model. A `.mdl` opens to
// the SAME data model a `.slx` does — same sections, same nodes — because it holds
// the same information in different framing.
//
// There are two framings in the wild, both legitimately named `.mdl`, and this file
// reads both:
//
//   1. The MODERN `.mdl` — what `save_system(mdl, 'x.mdl')` writes today. It is an
//      OPC package like a `.slx`, but written as TEXT rather than zipped: a banner
//      line, a small legacy `Model { Version ... }` stub for tools that would
//      otherwise choke, then the parts one after another between
//      `__MWOPC_PART_BEGIN__` delimiters, with binary parts base64'd. The part set
//      is byte-for-byte the one a `.slx` carries, so once the framing is off, this
//      hands straight to SlxParser's parseModelParts and NOTHING else is duplicated.
//
//   2. The CLASSIC `.mdl` — the pre-R2012 nested-brace text format, and the reason
//      `.mdl` support matters at all: a model that was never migrated still looks
//      like this, and MATLAB still writes one on `save_system(..., 'ExportToVersion',
//      'R2011b')`. Nothing about it resembles OPC. It carries the same facts in a
//      brace grammar (`Model { Name "x" ... }`), and the model workspace as a
//      UUENCODED mxarray in a top-level MatData section. Everything below the OPC
//      decoder is about reading that.
//
// Both flavours are held to the .slx of the same diagram by the parity suite —
// see test/parity/mdl.parity.test.ts and test/parity/matlab/gen_mdl.m.

import { isParamReference, normalizeBlockName, parseModelParts } from './SlxParser.js';
import type { BlockParamUsage, ParsedSlx } from './SlxParser.js';
import { parseMxArray, readMxArrayRecords } from './MxArrayParser.js';
import type { MatVariable } from './MatParser.js';

/**
 * A `.mdl` parses to exactly the shape a `.slx` does. The alias exists so callers
 * can say what they opened without implying the result differs.
 */
export type ParsedMdl = ParsedSlx;

type WorkspaceVars = MatVariable[] & { _trailingElements: Uint8Array[] };

export function parseMdl(buffer: ArrayBuffer, filename: string): ParsedMdl {
  const bytes = new Uint8Array(buffer);
  // Sniffing is folded into the decode: one scan decides, so there is no way for a
  // separate "is it a package?" test to disagree with the reader that follows.
  const parts = decodeOpcTextPackage(bytes);
  // A package marker with no readable part after it is a truncated file, not a
  // package, so it falls through to the grammar reader rather than opening as a model
  // with nothing in it. That reader finds the legacy `Model { Version ... }` stub a
  // modern `.mdl` always opens with — and if the file was cut before even that, it
  // rejects it, which is the whole point of the guard down there.
  if (parts && Object.keys(parts).length > 0) {
    return parseModelParts(parts, filename);
  }
  return parseClassicMdl(bytes, filename);
}

// ---------------------------------------------------------------------------
// The modern `.mdl`: an OPC package in text framing
// ---------------------------------------------------------------------------

const PACKAGE_BEGIN = '__MWOPC_PACKAGE_BEGIN__';
// Each marker is matched WITH its leading newline, so only a marker at the start of
// a line counts. A part's own bytes may contain the literal text (an XML attribute
// value, a base64 run) and must not be mistaken for a boundary.
const NL_PART_BEGIN = '\n__MWOPC_PART_BEGIN__';
const NL_PACKAGE_END = '\n__MWOPC_PACKAGE_END__';
const PART_BEGIN_LEN = NL_PART_BEGIN.length - 1;
// How far in to look for the package marker before concluding this is a classic
// `.mdl`. It follows a banner line and a Model stub of a few properties, so it sits
// within the first few hundred bytes; 4 KB is slack for a long Description.
const SNIFF_BYTES = 4096;
const LF = 0x0a;
const CR = 0x0d;

function indexOfAscii(bytes: Uint8Array, text: string, from: number, limit?: number): number {
  const first = text.charCodeAt(0);
  const end = Math.min(limit ?? bytes.length, bytes.length) - text.length;
  for (let i = from; i <= end; i++) {
    if (bytes[i] !== first) continue;
    let k = 1;
    while (k < text.length && bytes[i + k] === text.charCodeAt(k)) k++;
    if (k === text.length) return i;
  }
  return -1;
}

/**
 * Split a modern `.mdl` into the OPC part map a `.slx` unzips to, or return null if
 * this is not a text package (i.e. it is a classic `.mdl`).
 */
function decodeOpcTextPackage(bytes: Uint8Array): Record<string, Uint8Array> | null {
  const begin = indexOfAscii(bytes, PACKAGE_BEGIN, 0, SNIFF_BYTES);
  if (begin < 0) {
    return null;
  }

  const parts: Record<string, Uint8Array> = {};
  let at = indexOfAscii(bytes, NL_PART_BEGIN, begin);
  while (at >= 0) {
    const headerEnd = indexOfByte(bytes, LF, at + 1);
    if (headerEnd < 0) break; // truncated mid-header: nothing further is readable
    // `__MWOPC_PART_BEGIN__ /simulink/blockDiagram.json` — plus a trailing
    // ` BASE64` when the part is binary and was encoded to survive a text file.
    const header = decodeText(bytes.subarray(at + 1 + PART_BEGIN_LEN, headerEnd)).trim();
    const base64 = / BASE64$/.test(header);
    const path = (base64 ? header.slice(0, -' BASE64'.length) : header).trim().replace(/^\//, '');

    // A part runs from just after its header line to the byte before the newline
    // that introduces the next marker. That newline belongs to the FRAMING, not to
    // the part: the XML parts happen to end with one of their own (so the file shows
    // a blank line before the next header) while the JSON and mxarray parts do not,
    // and taking the framing newline as content corrupts both.
    const contentStart = headerEnd + 1;
    const next = nextBoundary(bytes, contentStart);
    let contentEnd = next < 0 ? bytes.length : next;
    if (next < 0 && contentEnd > contentStart && bytes[contentEnd - 1] === LF) contentEnd--;
    if (contentEnd > contentStart && bytes[contentEnd - 1] === CR) contentEnd--;

    const raw = bytes.subarray(contentStart, contentEnd);
    // `.slice()`, not the subarray: fflate hands every zip entry its own buffer, and
    // parseMxArray reaches through `entry.buffer`. A view into the whole `.mdl` would
    // give it the entire file to parse instead of the one part.
    if (path) {
      parts[path] = base64 ? decodeBase64(raw) : raw.slice();
    }

    at = next < 0 ? -1 : indexOfAscii(bytes, NL_PART_BEGIN, next);
  }

  return parts;
}

function indexOfByte(bytes: Uint8Array, byte: number, from: number): number {
  for (let i = from; i < bytes.length; i++) {
    if (bytes[i] === byte) return i;
  }
  return -1;
}

// Where the current part stops: whichever comes first, the next part header or the
// end-of-package line. Returns the index of the introducing newline, or -1 if the
// file just stops (truncated — the part is then whatever is left).
function nextBoundary(bytes: Uint8Array, from: number): number {
  const part = indexOfAscii(bytes, NL_PART_BEGIN, from);
  const end = indexOfAscii(bytes, NL_PACKAGE_END, from);
  if (part < 0) return end;
  if (end < 0) return part;
  return Math.min(part, end);
}

// Base64, decoded here rather than through atob/Buffer: this package is consumed in
// both Node and a browser, and neither global is available in both.
const B64_VALUES = (function () {
  const table = new Int8Array(256).fill(-1);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < alphabet.length; i++) {
    table[alphabet.charCodeAt(i)] = i;
  }
  return table;
})();

function decodeBase64(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil((bytes.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let n = 0;
  for (let i = 0; i < bytes.length; i++) {
    // Anything outside the alphabet — the line breaks the encoder inserted, `=`
    // padding, stray CR — carries no bits and is simply not part of the stream.
    const value = B64_VALUES[bytes[i]];
    if (value < 0) continue;
    acc = (acc << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 0xff;
    }
  }
  return out.slice(0, n);
}

function decodeText(buf: Uint8Array): string {
  return new TextDecoder().decode(buf);
}

// ---------------------------------------------------------------------------
// The classic `.mdl`: a nested-brace text format
// ---------------------------------------------------------------------------
//
// The whole grammar, from the files MATLAB writes:
//
//   Model {                            a BLOCK: a name, then a brace body
//     Name                  "engine"   a PROPERTY: a name, whitespace, a value
//     Version               7.8        values are quoted strings, bracket
//     Position              [35, 180]  literals, or bare tokens
//     Description           "line one\nline two \"quoted\""
//     BlockDefaults {                  blocks nest, to any depth
//       ...
//     }
//     Array {
//       Type                "Handle"
//       Dimension           2
//       Simulink.ConfigSet {           a block name may contain dots
//         $ObjectID         3          a property name may start with $
//         ...
//       }
//       PropName            "ConfigurationSets"   <- names its OWN role, and comes
//     }                                              LAST, after the children
//   }
//   MatData {                          a SIBLING of Model, not a child: the model
//     NumRecords            1          workspace, uuencoded
//     DataRecord {
//       Tag                 DataTag0
//       Data                "chunk one"
//                           "chunk two"   <- one value, wrapped across lines
//     }
//   }

interface MdlNode {
  name: string;
  // An ordered list rather than a map because block parameters are read in file
  // order, and because a name may legitimately repeat within one body.
  props: { name: string; value: string }[];
  children: MdlNode[];
}

interface Cursor {
  src: string;
  i: number;
}

const NAME_START_RE = /[A-Za-z_$]/;
const NAME_CHAR_RE = /[\w.$]/;

/**
 * Scan a classic `.mdl` into its brace tree.
 *
 * Iterative, with an explicit stack: a `.mdl` nests one level per subsystem and a
 * deep model would otherwise put the recursion depth of this scanner — and so the
 * stability of opening a file — in the hands of the file being opened.
 */
function parseClassicTree(text: string): MdlNode {
  const root: MdlNode = { name: '', props: [], children: [] };
  const stack: MdlNode[] = [root];
  const c: Cursor = { src: text, i: 0 };

  while (true) {
    skipSpace(c);
    if (c.i >= c.src.length) break;
    const ch = c.src[c.i];

    if (ch === '}') {
      c.i++;
      // An unmatched `}` cannot close the root; dropping it keeps the rest of the
      // file readable rather than reparenting everything after it.
      if (stack.length > 1) stack.pop();
      continue;
    }

    if (!NAME_START_RE.test(ch)) {
      // A value with no name in front of it: MATLAB writes these for the elements
      // of some Array blocks. Nothing here reads them, but they must be CONSUMED,
      // or the scanner would resynchronise in the middle of one.
      readValue(c);
      continue;
    }

    const name = readName(c);
    skipInlineSpace(c);
    if (c.src[c.i] === '{') {
      c.i++;
      const child: MdlNode = { name, props: [], children: [] };
      stack[stack.length - 1].children.push(child);
      stack.push(child);
      continue;
    }
    // A name alone on its line is a property with no value. Reading a value here
    // regardless would swallow the NEXT line, so the end of the line ends it.
    const value = atLineEnd(c) ? '' : readValue(c);
    stack[stack.length - 1].props.push({ name, value });
  }

  return root;
}

function skipSpace(c: Cursor): void {
  while (c.i < c.src.length) {
    const ch = c.src[c.i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      c.i++;
    } else if (ch === '#') {
      // Not part of the classic grammar; this is the `# MathWorks OPC Text Package`
      // banner, reachable only if a modern `.mdl` lost its package marker and fell
      // through to here. Skipping the line beats reading it as a stray value.
      while (c.i < c.src.length && c.src[c.i] !== '\n') c.i++;
    } else {
      break;
    }
  }
}

function skipInlineSpace(c: Cursor): void {
  while (c.i < c.src.length && (c.src[c.i] === ' ' || c.src[c.i] === '\t')) c.i++;
}

function atLineEnd(c: Cursor): boolean {
  const ch = c.src[c.i];
  return c.i >= c.src.length || ch === '\n' || ch === '\r' || ch === '}';
}

function readName(c: Cursor): string {
  const start = c.i;
  while (c.i < c.src.length && NAME_CHAR_RE.test(c.src[c.i])) c.i++;
  return c.src.slice(start, c.i);
}

function readValue(c: Cursor): string {
  const ch = c.src[c.i];
  if (ch === '"') return readQuoted(c);
  if (ch === '[') return readBracketed(c);
  // A bare token: `off`, `7.8`, `DataTag0`. Taken to the end of the line rather
  // than to the next space, because that is what the value IS — the format puts
  // one property per line — and a bare value that happens to contain a space
  // therefore survives instead of being truncated.
  const start = c.i;
  while (c.i < c.src.length && c.src[c.i] !== '\n' && c.src[c.i] !== '\r') c.i++;
  return c.src.slice(start, c.i).trim();
}

/**
 * A quoted value, unescaped, with continuation lines folded in.
 *
 * MATLAB breaks a value longer than the model's MaxMDLFileLineLength into several
 * quoted chunks on consecutive lines, which are one value and must be concatenated —
 * the uuencoded model workspace arrives as ~15 of them. A following chunk is
 * unambiguous: every other thing that can appear here starts with a name or a brace.
 */
function readQuoted(c: Cursor): string {
  let out = '';
  for (;;) {
    c.i++; // past the opening quote
    while (c.i < c.src.length) {
      const ch = c.src[c.i];
      if (ch === '\\') {
        out += unescapeChar(c.src[c.i + 1]);
        c.i += 2;
        continue;
      }
      if (ch === '"') break;
      out += ch;
      c.i++;
    }
    c.i++; // past the closing quote
    const resume = c.i;
    skipSpace(c);
    if (c.src[c.i] === '"') continue;
    c.i = resume;
    return out;
  }
}

// The escapes MATLAB writes. `\\` matters more than it looks: the uuencode alphabet
// includes both `\` and `"`, so the model workspace does not decode at all unless
// these are undone before the uudecode. An escape this does not know keeps its
// backslash — inventing a character is worse than passing one through.
function unescapeChar(ch: string | undefined): string {
  switch (ch) {
    case 'n':
      return '\n';
    case 'r':
      return '\r';
    case 't':
      return '\t';
    case '"':
      return '"';
    case '\\':
      return '\\';
    case undefined:
      return '';
    default:
      return '\\' + ch;
  }
}

// A bracket literal, brackets included, exactly as `.slx` records the same value in
// its `<P>` text. Nesting and quotes are tracked so a `]` inside either does not end
// it early.
function readBracketed(c: Cursor): string {
  const start = c.i;
  let depth = 0;
  while (c.i < c.src.length) {
    const ch = c.src[c.i];
    if (ch === '"') {
      readQuoted(c);
      continue;
    }
    if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth--;
      c.i++;
      if (depth <= 0) break;
      continue;
    }
    c.i++;
  }
  return c.src.slice(start, c.i);
}

function prop(node: MdlNode | null, name: string): string | null {
  if (!node) return null;
  for (const p of node.props) {
    if (p.name === name) return p.value;
  }
  return null;
}

function childNamed(node: MdlNode | null, name: string): MdlNode | null {
  if (!node) return null;
  return node.children.find((ch) => ch.name === name) || null;
}

function childrenNamed(node: MdlNode | null, name: string): MdlNode[] {
  if (!node) return [];
  return node.children.filter((ch) => ch.name === name);
}

function flatProps(node: MdlNode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of node.props) out[p.name] = p.value;
  return out;
}

// ---------------------------------------------------------------------------
// The classic `.mdl`: from brace tree to the same model a `.slx` gives
// ---------------------------------------------------------------------------

function parseClassicMdl(bytes: Uint8Array, filename: string): ParsedMdl {
  const root = parseClassicTree(decodeText(bytes));
  // A `.mdl` holds either a model or a library, and the body is the same either way.
  const model = childNamed(root, 'Model') || childNamed(root, 'Library');
  // Neither means this text is not a model, and saying so is the parser's job. This
  // is the LAST reader in the dispatch — bytes that are not a zip and not a text
  // package land here — so whatever a caller hands in that no reader understands
  // (a truncated `.slx`, a `.txt` renamed, random bytes) arrives as brace text with
  // no diagram in it. The grammar reader tolerates anything by design, so without
  // this guard every one of those cases returned a model with no blocks, no
  // references and no workspace: a host cannot tell that apart from a genuinely
  // empty model, and shows a table of empty sections reading "this model is empty"
  // where it should report a file it could not read.
  if (!model) {
    throw new Error(
      `Not a Simulink model: "${filename}" is not a zip package, not an OPC text ` +
        'package, and has no Model or Library block',
    );
  }
  // The model's own name, needed to rewrite block paths — and read from the FILE
  // rather than the filename because an ExportToVersion renames the diagram after
  // its target (`engine.slx` exports to `engine_R2011b.mdl`, whose block paths all
  // begin `engine_R2011b/`).
  const modelName = prop(model, 'Name') || '';

  // The model workspace, for the case where it lives in a MAT file instead of in
  // the model. Same relationship the `.slx` reads out of blockDiagram.json.
  const externalDataSources: string[] = [];
  const wsFile = prop(model, 'WSSourceFileName');
  if (prop(model, 'WSDataSource') === 'MAT-File' && wsFile) {
    externalDataSources.push(wsFile);
  }

  return {
    name: filename,
    // A classic `.mdl` has no release string. It records a Simulink VERSION number
    // (`Version 7.8`), which is not the release a `.slx` names in its
    // coreProperties, and no table maps one to the other — so this stays empty
    // rather than reporting a release the file never claimed.
    release: '',
    creator: prop(model, 'Creator') || '',
    // `Fri Sep 04 10:15:32 2026`, where a `.slx` gives ISO 8601. Both are passed
    // through as written; neither format is reinterpreted here.
    lastModified: prop(model, 'LastModifiedDate') || '',
    // Also absent before R2012: a model had no UUID to record.
    uuid: prop(model, 'ModelUUID') || '',
    // R2011b cannot use a data dictionary and drops the link on export (with a
    // warning); R2017b keeps it. Absent means absent.
    dataDictionary: prop(model, 'DataDictionary') || null,
    modelReferences: classicModelReferences(model, modelName),
    externalDataSources,
    configSets: classicConfigSets(model),
    workspace: classicWorkspace(root, model),
    blockParamUsages: classicBlockParamUsages(model),
    // There are no OPC parts to hand back: this flavour is one flat text file, not
    // an archive. ModelNode treats both as nullable and falls back to a summary.
    rawContents: null,
    zipEntries: null,
  };
}

/**
 * The referenced models, as the `.slx` path reports them.
 *
 * `ModelRefBlockPath "engine/Child|plant"` packs both halves into one string. It is
 * split at the LAST `|`: a block name may contain one, a model name may not.
 */
function classicModelReferences(model: MdlNode, modelName: string): { blockPath: string; modelName: string }[] {
  const gi = childNamed(model, 'GraphicalInterface');
  const refs: { blockPath: string; modelName: string }[] = [];
  for (const ref of childrenNamed(gi, 'ModelReference')) {
    const raw = prop(ref, 'ModelRefBlockPath');
    const cut = raw ? raw.lastIndexOf('|') : -1;
    if (!raw || cut < 0) continue;
    refs.push({ blockPath: rootRelativePath(raw.slice(0, cut), modelName), modelName: raw.slice(cut + 1) });
  }
  // R2014b and later ALSO list every reference as an ExternalFileReference, the
  // form a `.slx` keeps alongside its ModelReferences. The two agree, so this only
  // matters for a file that carries the second list and not the first.
  if (refs.length === 0) {
    for (const ext of childrenNamed(gi, 'ExternalFileReference')) {
      const name = prop(ext, 'Reference');
      if (!name || prop(ext, 'Type') !== 'MODEL_BLOCK') continue;
      refs.push({ blockPath: rootRelativePath(prop(ext, 'Path') || '', modelName), modelName: name });
    }
  }
  return refs;
}

// A `.slx` writes the root of a block path as the literal `$bdroot`; a classic
// `.mdl` writes the model's own name there. Same path, two spellings — and the
// exported name is not the model's original one, so the name recorded IN the file
// is the only prefix it is safe to strip.
function rootRelativePath(path: string, modelName: string): string {
  if (!modelName) return path;
  if (path === modelName) return '$bdroot';
  if (path.startsWith(modelName + '/')) return '$bdroot/' + path.slice(modelName.length + 1);
  return path;
}

/**
 * The configuration sets, with the active one marked.
 *
 * They sit in the Model's `Array` whose `PropName` names the role it fills, and the
 * active one is a separate stub beside that array holding only a back-reference:
 *
 *   Array { Type "Handle" Dimension 2
 *           Simulink.ConfigSet { $ObjectID 3 ... Name "Configuration" }
 *           Simulink.ConfigSet { $ObjectID 4 ... Name "Fast" }
 *           PropName "ConfigurationSets" }
 *   Simulink.ConfigSet { $PropName "ActiveConfigurationSet" $ObjectID 3 }
 */
function classicConfigSets(model: MdlNode): { name: string; active: boolean; data: unknown }[] {
  let activeId: string | null = null;
  for (const node of model.children) {
    if (prop(node, '$PropName') === 'ActiveConfigurationSet') {
      activeId = prop(node, '$ObjectID');
    }
  }

  const configs: { name: string; active: boolean; data: unknown }[] = [];
  for (const array of childrenNamed(model, 'Array')) {
    if (prop(array, 'PropName') !== 'ConfigurationSets') continue;
    for (const cs of array.children) {
      const name = prop(cs, 'Name');
      if (!name) continue;
      configs.push({
        name,
        active: activeId !== null && prop(cs, '$ObjectID') === activeId,
        // The class is the node's own name — `Simulink.ConfigSet`, or
        // `Simulink.ConfigSetRef` for a set that lives in a dictionary. That is the
        // one field the config section reads off `data`; the properties come along
        // because the `.slx` path hands over the whole config set too.
        data: { _object_class: cs.name, _properties: flatProps(cs) },
      });
    }
  }
  return configs;
}

// A block's identity is three ordinary properties here. In a `.slx` the same three
// are XML ATTRIBUTES of <Block> and so never reach the parameter loop at all —
// skipping them is what keeps the two flavours of one model reporting the same rows.
const BLOCK_IDENTITY_PROPS = new Set(['BlockType', 'Name', 'SID']);

function classicBlockParamUsages(model: MdlNode): BlockParamUsage[] {
  const usages: BlockParamUsage[] = [];
  // Walk the DIAGRAM, not the whole tree: `BlockParameterDefaults` also holds nodes
  // named `Block` — one per block type, carrying that type's factory defaults and no
  // name — and a `.slx` has no equivalent section, so counting them would give a
  // `.mdl` rows that the same model's `.slx` never reports. Breadth-first, appending
  // each subsystem's own `System` as it is met, so nesting costs no recursion.
  const systems = childrenNamed(model, 'System');
  for (let s = 0; s < systems.length; s++) {
    for (const block of childrenNamed(systems[s], 'Block')) {
      // `"Two\nLines"` here, `Two&#xA;Lines` in the `.slx`; both normalise to one
      // flat label. The unescaping already happened in the scanner.
      const blockName = normalizeBlockName(prop(block, 'Name') || '');
      const blockType = prop(block, 'BlockType') || '';
      for (const p of block.props) {
        if (BLOCK_IDENTITY_PROPS.has(p.name)) continue;
        if (!isParamReference(p.name, p.value)) continue;
        usages.push({ blockName, blockType, paramProperty: p.name, paramValue: p.value });
      }
      for (const inner of childrenNamed(block, 'System')) systems.push(inner);
    }
  }
  return usages;
}

/**
 * The model workspace.
 *
 * A `.slx` keeps it in its own part; a classic `.mdl` keeps the very same mxarray
 * stream UUENCODED in a top-level MatData section, and the Model's `WSMdlFileData`
 * property names which record holds it:
 *
 *   Model   { ... WSMdlFileData "DataTag0" ... }
 *   MatData { NumRecords 1 DataRecord { Tag DataTag0 Data "<uuencoded>" } }
 */
function classicWorkspace(root: MdlNode, model: MdlNode): WorkspaceVars {
  const empty = [] as unknown as WorkspaceVars;
  empty._trailingElements = [];

  const tag = prop(model, 'WSMdlFileData');
  if (!tag) return empty;
  const matData = childNamed(root, 'MatData');
  if (!matData) return empty;

  let encoded: string | null = null;
  for (const record of childrenNamed(matData, 'DataRecord')) {
    if (prop(record, 'Tag') === tag) {
      encoded = prop(record, 'Data');
      break;
    }
  }
  if (!encoded) return empty;

  const stream = uudecode(encoded);
  const { outer, trailingElements } = readMxArrayRecords(stream.buffer);
  if (!outer || !outer.fields) return empty;

  // The classic record is NOT the struct-of-variables a `.slx` keeps: it is a 1xN
  // struct ARRAY of Name/Value pairs, one element per workspace variable. Same
  // bytes, same framing, different shape — so read the pairs off it instead of
  // mistaking the two field names for the two variables.
  if (!outer.fields.Name || !outer.fields.Value) {
    return parseMxArray(stream.buffer);
  }

  const result = [] as unknown as WorkspaceVars;
  result._trailingElements = trailingElements;
  const names = elementsOf(outer.fields.Name);
  const values = elementsOf(outer.fields.Value);
  for (let i = 0; i < names.length && i < values.length; i++) {
    const name = typeof names[i].value === 'string' ? (names[i].value as string) : '';
    if (!name) continue;
    values[i].name = name;
    result.push(values[i]);
  }
  return result;
}

// A struct field holds one MatVariable per element of a struct array — and the
// variable itself, not a one-element array, when the struct is 1x1. A model
// workspace with a single variable takes that second form.
function elementsOf(field: MatVariable | MatVariable[]): MatVariable[] {
  return Array.isArray(field) ? field : [field];
}

/**
 * Undo the uuencoding of a MatData record: six bits per character, biased by 32,
 * most significant group first.
 *
 * This is the body encoding of historic `uuencode` without its per-line length
 * prefixes — MATLAB emits one unbroken run and lets the quoted-value wrapping do
 * the line breaking. Note that a SPACE encodes zero and is data, not padding: the
 * stream begins `\x00\x01IM`, which is written as two leading spaces.
 */
function uudecode(text: string): Uint8Array {
  const out = new Uint8Array(Math.ceil((text.length * 6) / 8));
  let acc = 0;
  let bits = 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === LF || code === CR) continue;
    acc = (acc << 6) | ((code - 32) & 0x3f);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 0xff;
    }
  }
  // Exact-length, because readMxArrayRecords is handed `.buffer` and would
  // otherwise be given the slack bytes as part of the stream.
  return out.slice(0, n);
}
