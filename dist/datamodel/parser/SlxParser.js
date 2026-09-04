// Copyright 2026 The MathWorks, Inc.
import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { parseMxArray } from './MxArrayParser.js';
import { parseMat } from './MatParser.js';
const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
});
function decodeText(buf) {
    return new TextDecoder().decode(buf);
}
function parseJSON(buf) {
    return JSON.parse(decodeText(buf));
}
function parseXml(buf) {
    return xmlParser.parse(decodeText(buf));
}
function extractConfigSets(entries, configSetInfo) {
    const configs = [];
    for (const info of configSetInfo) {
        const partPath = info.PartName.replace(/^\//, '');
        const buf = entries[partPath];
        if (buf) {
            // The referenced part is `configSetN.json` from R2026b and `configSetN.xml`
            // before it. The info part names it either way, so the extension it points
            // at — not the release — decides how to read it.
            const data = partPath.endsWith('.json') ? parseJSON(buf) : parseXml(buf);
            configs.push({
                name: info.ConfigSetName,
                active: !!info.Active,
                data: data,
            });
        }
    }
    return configs;
}
function extractExternalDataSources(doc) {
    const sources = [];
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
function findAll(obj, tagName) {
    const results = [];
    if (!obj || typeof obj !== 'object') {
        return results;
    }
    for (const [key, val] of Object.entries(obj)) {
        if (key === tagName) {
            results.push(...(Array.isArray(val) ? val : [val]));
        }
        else if (typeof val === 'object') {
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
function findText(obj, tagName) {
    for (const val of findAll(obj, tagName)) {
        // A tag with attributes parses to an object whose text is under '#text'; a
        // plain tag parses to the string (or, for a bare number, to a number) itself.
        const text = val && typeof val === 'object'
            ? String(val['#text'] ?? '')
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
function directProps(el) {
    const out = {};
    if (!el || typeof el !== 'object')
        return out;
    const p = el.P;
    if (!p)
        return out;
    for (const entry of Array.isArray(p) ? p : [p]) {
        if (!entry || typeof entry !== 'object')
            continue;
        const rec = entry;
        const name = rec['@_Name'];
        if (typeof name !== 'string')
            continue;
        out[name] = String(rec['#text'] ?? '');
    }
    return out;
}
// The `<Model>` element of a legacy `blockdiagram.xml`, or null.
function legacyModel(entries) {
    const buf = entries['simulink/blockdiagram.xml'];
    if (!buf)
        return null;
    const doc = parseXml(buf);
    const info = doc.ModelInformation;
    const model = (info?.Model ?? null);
    return model && typeof model === 'object' ? model : null;
}
// `configSetInfo.xml` in the shape the JSON reader already produces. The name is
// the element's TEXT here (it is a JSON field in the modern part) and `Active` is
// an attribute that is present only on the active one.
function legacyConfigSetInfo(buf) {
    const doc = parseXml(buf);
    const out = [];
    for (const el of findAll(doc, 'ConfigSet')) {
        if (!el || typeof el !== 'object')
            continue;
        const rec = el;
        const partName = rec['@_PartName'];
        if (typeof partName !== 'string')
            continue;
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
function inlineConfigSets(model) {
    const container = model.ConfigurationSet;
    if (!container)
        return [];
    let activeId = '';
    for (const ref of findAll(model, 'Object')) {
        if (!ref || typeof ref !== 'object')
            continue;
        const rec = ref;
        if (rec['@_PropName'] === 'ActiveConfigurationSet') {
            activeId = String(rec['@_ObjectID'] ?? '');
            break;
        }
    }
    const out = [];
    for (const obj of findAll(container, 'Object')) {
        if (!obj || typeof obj !== 'object')
            continue;
        const rec = obj;
        if (rec['@_ClassName'] !== 'Simulink.ConfigSet')
            continue;
        const name = directProps(rec).Name;
        if (!name)
            continue;
        const id = String(rec['@_ObjectID'] ?? '');
        out.push({ name, active: !!id && id === activeId, data: rec });
    }
    return out;
}
// Every `<System>` reachable from one, the outermost included.
//
// A subsystem's blocks live in a `<System>` nested INSIDE the `<Block
// BlockType="SubSystem">` that owns it; from R2020a each system got a
// `systems/system_N.xml` part of its own instead, so the parts loop already sees
// them all and never needs this. `findAll` deliberately does not descend into an
// element it has already matched, so one `findAll(system, 'Block')` returns that
// system's own blocks and stops — walking the systems first is what makes an inner
// block reachable at all. Without it a legacy file dropped every nested block, which
// for a model organised into subsystems is most of the model.
function legacySystems(system) {
    const out = [];
    const stack = [system];
    while (stack.length > 0) {
        const current = stack.pop();
        if (!current || typeof current !== 'object')
            continue;
        out.push(current);
        for (const block of findAll(current, 'Block')) {
            if (!block || typeof block !== 'object')
                continue;
            const inner = block.System;
            if (inner)
                stack.push(...(Array.isArray(inner) ? inner : [inner]));
        }
    }
    return out;
}
// Model references from a legacy `graphicalInterface`, which packs both facts into
// ONE string: `<P Name="ModelRefBlockPath">$bdroot/Child|slx_child</P>`. The
// modern part splits them into `BlockPath` and `ModelName`, so this splits on the
// last `|` — a model name cannot contain one, a block path conceivably could.
function legacyModelReferences(root) {
    const out = [];
    for (const ref of findAll(root, 'ModelReference')) {
        const path = directProps(ref).ModelRefBlockPath;
        if (!path)
            continue;
        const cut = path.lastIndexOf('|');
        if (cut < 0)
            continue;
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
export function normalizeBlockName(name) {
    return name
        .replace(/&#x0*(a|d);/gi, ' ') // hex: &#xA; &#x0A; &#xD; (LF, CR)
        .replace(/&#0*(10|13);/g, ' ') // decimal: &#10; &#13; (LF, CR)
        .replace(/\s+/g, ' ')
        .trim();
}
/**
 * Does `propName = value` on a block count as a reference to named data?
 *
 * The one gate both model formats go through, so a `.mdl` and the `.slx` of the
 * SAME diagram surface the same rows. Exported for MdlParser, which reads the
 * classic nested-brace flavour and has no `<P>` elements to work from.
 */
export function isParamReference(propName, value) {
    if (!propName || NON_PARAM_PROPS.has(propName))
        return false;
    if (!value || NUMERIC_RE.test(value))
        return false;
    if (NON_FINITE_RE.test(value))
        return false;
    if (value === 'on' || value === 'off')
        return false;
    // Must contain an identifier that could name a variable. This excludes
    // operator-only sign patterns (Sum `Inputs=|++`) and enum-ish tokens
    // handled above, while keeping expressions like `[Tal,1]` or `1/Uo`.
    return IDENT_RE.test(value);
}
// `legacy` is the `<Model>` element of a legacy blockdiagram.xml, already parsed by
// the caller — that part is the largest in the package and every legacy branch
// wants something from it, so it is read once and passed around.
function extractBlockParamUsages(entries, legacy) {
    // `simulink/systems/*.xml` from R2020a on. Before that the block tree lived
    // inside blockdiagram.xml, so when there are no systems parts the diagram's own
    // `<System>` is the root to walk instead.
    //
    // Scoping to `<System>` rather than to the whole document is what keeps this
    // honest: a legacy blockdiagram.xml also carries `<BlockDefaults>` and
    // `<BlockParameterDefaults>`, which are TEMPLATE blocks — every block type
    // Simulink knows, with placeholder values like `<Enter Model Name>`. Walking the
    // document would report every one of them as a real block using real parameters.
    const roots = [];
    for (const key in entries) {
        if (key.startsWith('simulink/systems/') && key.endsWith('.xml')) {
            roots.push(parseXml(entries[key]));
        }
    }
    if (roots.length === 0 && legacy && legacy.System) {
        roots.push(...legacySystems(legacy.System));
    }
    const usages = [];
    for (const root of roots) {
        const blocks = findAll(root, 'Block');
        for (const block of blocks) {
            const b = block;
            const blockName = normalizeBlockName(b['@_Name'] || '');
            const blockType = b['@_BlockType'] || '';
            const props = b['P'];
            if (!props)
                continue;
            const propList = Array.isArray(props) ? props : [props];
            for (const p of propList) {
                const pObj = p;
                const propName = pObj['@_Name'];
                const val = pObj['#text'] || '';
                if (!isParamReference(propName, val))
                    continue;
                usages.push({ blockName, blockType, paramProperty: propName, paramValue: val });
            }
        }
    }
    return usages;
}
function extractModelReferences(graphicalInterface) {
    if (!graphicalInterface) {
        return [];
    }
    // Two JSON shapes. R2024b-R2026a — the releases that moved this part to JSON while
    // the block diagram was still XML — WRAP the content in a `GraphicalInterface`
    // object; R2026b flattened it and marks the element with `_mw_element_name`
    // instead. Reading only the flat shape silently lost every model reference from a
    // three-release window, which is the same wrapping `blockDiagram.json` is already
    // unwrapped for above.
    const gi = graphicalInterface.GraphicalInterface || graphicalInterface;
    const refs = gi.ModelReferences;
    if (!refs) {
        return [];
    }
    return refs.map(function (ref) {
        return { blockPath: ref.BlockPath, modelName: ref.ModelName };
    });
}
export function parseSlx(buffer, filename) {
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
export function parseModelParts(entries, filename) {
    // Core metadata
    let release = '';
    let creator = '';
    let lastModified = '';
    if (entries['metadata/coreProperties.xml']) {
        const doc = parseXml(entries['metadata/coreProperties.xml']);
        release = findText(doc, 'cp:version') || findText(doc, 'version') || '';
        creator = findText(doc, 'dc:creator') || findText(doc, 'creator') || '';
        lastModified = findText(doc, 'dcterms:modified') || findText(doc, 'modified') || '';
    }
    // The legacy block diagram part, read once: several branches below need it, and
    // it is the largest part in the package. Null for a current-release file, which
    // has `blockDiagram.json` instead and never touches the legacy paths.
    const legacy = legacyModel(entries);
    // Block diagram (linked dictionary, UUID, model-workspace data source)
    let dataDictionary = null;
    let uuid = '';
    let workspaceMatFile = null;
    if (entries['simulink/blockDiagram.json']) {
        const bd = parseJSON(entries['simulink/blockDiagram.json']);
        const diagram = bd.BlockDiagram || bd;
        dataDictionary = diagram.DataDictionary || null;
        uuid = diagram.ModelUUID || '';
        // Model workspace sourced from a MAT file (model -> mat relationship). MATLAB
        // records this here, NOT in ExternalDataSourceSettings.xml.
        const ws = diagram.ModelWorkspace;
        if (ws && ws.WSDataSource === 'MAT-File' && typeof ws.WSSourceFileName === 'string') {
            workspaceMatFile = ws.WSSourceFileName;
        }
    }
    else if (legacy) {
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
    let configSets = [];
    if (entries['simulink/configSetInfo.json']) {
        const info = parseJSON(entries['simulink/configSetInfo.json']);
        configSets = extractConfigSets(entries, info.ConfigSetInfo || []);
    }
    else if (entries['simulink/configSetInfo.xml']) {
        configSets = extractConfigSets(entries, legacyConfigSetInfo(entries['simulink/configSetInfo.xml']));
    }
    else if (legacy) {
        configSets = inlineConfigSets(legacy);
    }
    // Graphical interface (model references). JSON from R2024b, XML from R2014b, and
    // inline in the block diagram before that.
    let modelReferences = [];
    if (entries['simulink/graphicalInterface.json']) {
        const gi = parseJSON(entries['simulink/graphicalInterface.json']);
        modelReferences = extractModelReferences(gi);
    }
    else if (entries['simulink/graphicalInterface.xml']) {
        modelReferences = legacyModelReferences(parseXml(entries['simulink/graphicalInterface.xml']));
    }
    else if (legacy && legacy.GraphicalInterface) {
        modelReferences = legacyModelReferences(legacy.GraphicalInterface);
    }
    // External data sources (.mat files)
    let externalDataSources = [];
    if (entries['simulink/ExternalDataSourceSettings.xml']) {
        const doc = parseXml(entries['simulink/ExternalDataSourceSettings.xml']);
        externalDataSources = extractExternalDataSources(doc);
    }
    // Model-workspace MAT source (from blockDiagram.json) is also external data.
    if (workspaceMatFile && !externalDataSources.includes(workspaceMatFile)) {
        externalDataSources.push(workspaceMatFile);
    }
    // Model workspace (binary mxarray)
    let workspace = [];
    workspace._trailingElements = [];
    if (entries['simulink/modelWorkspace.mxarray']) {
        workspace = parseMxArray(entries['simulink/modelWorkspace.mxarray'].buffer);
    }
    else if (entries['simulink/modelworkspace.mat']) {
        // Before R2019b the workspace part is a whole `MATLAB 5.0 MAT-file` — same
        // record framing `parseMat` already reads for a standalone `.mat`, one top-level
        // variable per workspace variable, rather than the mxarray's single struct whose
        // FIELDS are the variables. So this is routing, not a second decoder.
        const buf = entries['simulink/modelworkspace.mat'];
        // Slice rather than hand over `.buffer`: the entry may be a view into a larger
        // allocation, and parseMat reads its header from offset 0.
        const mat = parseMat(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
        workspace = mat.variables;
        // No mxarray framing here, so there is nothing trailing to preserve. The field
        // is still set because every consumer reads it unconditionally.
        workspace._trailingElements = [];
    }
    // Block parameter usages (which blocks reference which params by name)
    const blockParamUsages = extractBlockParamUsages(entries, legacy);
    const rawContents = {};
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
        rawContents,
        zipEntries: entries,
    };
}
//# sourceMappingURL=SlxParser.js.map