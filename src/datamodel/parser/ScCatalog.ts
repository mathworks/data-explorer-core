// src/datamodel/parser/ScCatalog.ts
// Copyright 2026 The MathWorks, Inc.
//
// THE SYSTEM COMPOSER CATALOG — ONE VOCABULARY, TWO FILE FORMATS.
//
// An Architectural Data entry is stored as an ordinary Simulink object: a data
// interface and a struct type are BOTH a `Simulink.Bus` in `data/chunk0`, and
// nothing in the entry says which one it is. What says so is a second part of the
// dictionary — the System Composer interface dictionary — which lists each
// definition by NAME with the System Composer type that models it. Two storage
// forms, one catalog:
//
//   uncompressed-text `.sldd`  a JSON object at `__MW_TEXT_PARTS__/<SC_PART>`
//   compressed-binary `.sldd`  an MF0 XML member at `<SC_PART_XML>`
//
// The type map and the classification rule live HERE, once, so the two readers
// cannot answer differently about the same dictionary. What each reader owns is
// only the walk over its own syntax.
//
// The catalog is keyed by NAME because that is the only link the file has: an
// entry's uuid appears in `simulink/ArchitecturePart` but never in this part, and
// this part's uuids appear nowhere else. So a rename has to be carried into the
// catalog or it silently reclassifies the entry — which is what `scRenameEdits`
// (the file) and `renameInCatalog` (the tree) exist for, and why the scans record
// where each name SITS as well as what it is.

// The part path of the systemcomposer interface dictionary in an uncompressed-text
// dictionary, named once because it is used to look the part up and to name it in
// the warning raised when it is there and unreadable. A warning naming a different
// string from the one that was looked up would be a lie no reader could detect.
export const SC_PART = 'simulink/systemcomposer/interfaceDictionary';

// The same part as a member of a compressed-binary (zip) dictionary. The `.xml`
// suffix is part of the member name, and a host matching a warning's `part` against
// the package needs the name the package uses.
export const SC_PART_XML = `${SC_PART}.xml`;

// The systemcomposer interface dictionary classifies architectural entries
// (which are stored as ordinary Simulink objects) into interface/type kinds.
// Captured at parse time so the rest of the model can distinguish, e.g., a
// StructType from a DataInterface (both are Simulink.Bus).
export interface SystemComposerCatalog {
    // Interface name -> systemcomposer type, from the PortInterfaceCatalog
    // (e.g. CompositeDataInterface, CompositePhysicalInterface, ServiceInterface,
    // ValueTypeInterface).
    interfaces: Record<string, string>;
    // Modeled data type name -> systemcomposer type, from the TypeCatalog
    // (e.g. StructDataType, NumericType, EnumDataType, AliasType).
    modeledDataTypes: Record<string, string>;
}

// Maps a systemcomposer type string to the semantic classification token that
// drives the entry's Kind. The token is derived from the type, not the entry
// name (which is user-chosen), so it stays correct regardless of the name.
export const SC_TYPE_TO_CLASSIFICATION: Record<string, string> = {
    'systemcomposer.architecture.model.interface.CompositeDataInterface': 'DataInterface',
    'systemcomposer.architecture.model.interface.CompositePhysicalInterface': 'PhysicalInterface',
    'systemcomposer.architecture.model.swarch.ServiceInterface': 'ServiceInterface',
    'systemcomposer.architecture.model.interface.ValueTypeInterface': 'ValueType',
    'systemcomposer.property.StructDataType': 'StructType',
    'systemcomposer.property.NumericType': 'NumericType',
    'systemcomposer.property.EnumDataType': 'EnumType',
    'systemcomposer.property.AliasType': 'AliasType',
};

// Resolve the classification token (e.g. 'DataInterface', 'StructType') for an
// entry name, or null if the catalog doesn't classify it. Interfaces are checked
// before modeled data types.
export function classificationOf(
    catalog: SystemComposerCatalog | null | undefined,
    entryName: string,
): string | null {
    if (!catalog) {
        return null;
    }
    const scType = catalog.interfaces[entryName] || catalog.modeledDataTypes[entryName];
    return (scType && SC_TYPE_TO_CLASSIFICATION[scType]) || null;
}

// The message both readers raise when the part is THERE and holds nothing readable.
// Present-and-unreadable is the file claiming the catalog is there: the tree still
// fills in, but every architectural entry's Kind quietly degrades to its raw
// Simulink class — a wrong answer that looks exactly like a right one. Absent is a
// different thing entirely (every `.sldd` that is not an interface dictionary), and
// stays quiet.
export function scPartUnreadableMessage(part: string): string {
    return `The dictionary part "${part}" holds nothing readable, so `
        + 'architectural entries are reported by their Simulink class rather than '
        + 'their System Composer type.';
}

// The two container keys a definition can be listed under. Scoping by KEY, not by
// type, is what keeps the catalog to actual definitions: a nested
// `p_OwnedDataInterface` is a ValueTypeInterface too, and the TypeCatalog's
// `p_BuiltInValueTypes` / `p_valueType` children are MATLAB's built-in types
// (`double`, `int16`, …) — none of them is a dictionary entry.
const IFACE_KEY = 'p_Interfaces';
const MODELED_KEY = 'p_ModeledDataTypes';

const DESCRIPTOR_TYPE = 'systemcomposer.property.ValueTypeDescriptor';

/** Where a name is written in the source text, as a half-open span. */
export interface ScNameSite {
    start: number;
    end: number;
}

/**
 * One catalog definition: what it is called, what models it, and every place the
 * source spells its name.
 *
 * `nameSites` is plural because a value type definition writes its name TWICE — on
 * the definition and on the value-type descriptor nested inside it, which MATLAB
 * keeps equal (11,964 of 11,964 in the customer dictionary this was measured on).
 * A rename that moved only one of them would leave the descriptor naming a type
 * that no longer exists.
 */
export interface ScDefinition {
    name: string;
    /** The systemcomposer type, e.g. `…interface.CompositeDataInterface`. */
    type: string;
    /** Whether the definition is an interface or a modeled data type. */
    container: 'interfaces' | 'modeledDataTypes';
    nameSites: ScNameSite[];
}

/** Fold definitions into the catalog the model classifies entries with. */
export function catalogFromDefinitions(defs: ScDefinition[]): SystemComposerCatalog {
    const catalog: SystemComposerCatalog = { interfaces: {}, modeledDataTypes: {} };
    defs.forEach((def) => {
        if (def.name) {
            catalog[def.container][def.name] = def.type;
        }
    });
    return catalog;
}

// A tag: `<name attrs>`, `</name>` or `<name attrs/>`. Attribute values are quoted,
// so `[^>"]|"[^"]*"` skips a `>` inside a value rather than ending the tag on it.
const TAG_RE = /<(\/?)([A-Za-z_][\w.-]*)((?:[^>"]|"[^"]*")*?)(\/?)>/g;

const attrOf = (attrs: string, name: string): string => {
    const m = new RegExp(`${name}="([^"]*)"`).exec(attrs);
    return m ? m[1] : '';
};

interface XmlFrame {
    tag: string;
    type: string;
    /** Text span of this element's own direct-child `<p_Name>`, once seen. */
    nameSite?: ScNameSite;
    /** Direct-child value-type descriptors, which carry a second copy of the name. */
    descriptorSites: ScNameSite[];
    /** Where this element's text content starts (used only by `p_Name` itself). */
    textStart: number;
}

/**
 * Scan the MF0 XML of a compressed-binary dictionary's interface dictionary.
 *
 * A tag walk rather than a DOM parse for two reasons: the part is 20 MB in a real
 * customer dictionary, and a rename has to know the BYTE RANGE of each name so the
 * member can be patched in place instead of re-serialized (which would rewrite 20 MB
 * of a file the user did not touch).
 *
 * Names are compared and returned raw. Dictionary entry names are MATLAB
 * identifiers, so there is nothing for XML escaping to do to them.
 */
export function scanScXml(xml: string): ScDefinition[] {
    const defs: ScDefinition[] = [];
    const stack: XmlFrame[] = [];
    TAG_RE.lastIndex = 0;
    let tag: RegExpExecArray | null;

    while ((tag = TAG_RE.exec(xml))) {
        const [whole, closing, name, attrs, selfClosing] = tag;
        if (selfClosing) {
            // An empty element carries no name text, so it can only be a descriptor
            // with nothing in it — nothing to record either way.
            continue;
        }
        if (!closing) {
            stack.push({
                tag: name,
                type: attrOf(attrs, 'type'),
                descriptorSites: [],
                textStart: tag.index + whole.length,
            });
            continue;
        }

        const frame = stack.pop();
        if (!frame) {
            continue;
        }
        const parent = stack[stack.length - 1];
        if (frame.tag === 'p_Name') {
            if (parent) {
                parent.nameSite = { start: frame.textStart, end: tag.index };
            }
            continue;
        }
        if (frame.type === DESCRIPTOR_TYPE && frame.nameSite && parent) {
            parent.descriptorSites.push(frame.nameSite);
            continue;
        }
        if (frame.tag !== IFACE_KEY && frame.tag !== MODELED_KEY) {
            continue;
        }
        if (!frame.nameSite) {
            continue;
        }
        defs.push(definitionOf(
            xml.slice(frame.nameSite.start, frame.nameSite.end),
            frame.type,
            frame.tag === IFACE_KEY ? 'interfaces' : 'modeledDataTypes',
            frame.nameSite,
            frame.descriptorSites.map((site) => ({ site, text: xml.slice(site.start, site.end) })),
        ));
    }

    return defs;
}

// Assemble a definition, keeping only the nested descriptor names that ARE this
// definition's name. A descriptor naming something else is naming something else:
// it is a reference to another type, and renaming this definition must not touch it.
function definitionOf(
    name: string,
    type: string,
    container: 'interfaces' | 'modeledDataTypes',
    nameSite: ScNameSite,
    descriptors: { site: ScNameSite; text: string }[],
): ScDefinition {
    const sites = [nameSite];
    descriptors.forEach((d) => {
        if (d.text === name) {
            sites.push(d.site);
        }
    });
    return { name, type, container, nameSites: sites };
}

/**
 * Scan the JSON text of an uncompressed-text dictionary's interface dictionary.
 *
 * The text and not the parsed object, because that is what the host holds: a textual
 * `.sldd` is an open TEXT DOCUMENT, edited by splicing spans, and a rename has to
 * become a span replacement in it. Re-serializing the part instead would rewrite 20 MB
 * of a customer's file — and reformat every line of it — to change one name.
 *
 * The walk is deliberately shallow: it finds the two container keys, then reads only
 * what a definition is (its type, its name, and the value-type descriptor nested
 * directly in it), skipping every other value wholesale. Whitespace is irrelevant to
 * it, so it reads MATLAB's tab-indented layout and a re-saved minified one alike.
 */
export function scanScJsonText(text: string): ScDefinition[] {
    const region = scPartRegion(text);
    if (!region) {
        return [];
    }
    const defs: ScDefinition[] = [];
    ([[IFACE_KEY, 'interfaces'], [MODELED_KEY, 'modeledDataTypes']] as const).forEach(
        ([key, container]) => {
            eachKeyedArray(text, region, key, (elemStart) => {
                const def = readJsonDefinition(text, elemStart, container);
                if (def) {
                    defs.push(def);
                }
            });
        },
    );
    return defs;
}

// The span of the interface dictionary part's VALUE inside the whole document text.
// Scoping the scan to it keeps `p_Interfaces` from being looked for in 40 MB of entry
// data that cannot contain one.
function scPartRegion(text: string): ScNameSite | null {
    const key = `"__MW_TEXT_PART__/${SC_PART}"`;
    const at = text.indexOf(key);
    if (at < 0) {
        return null;
    }
    const colon = skipWs(text, at + key.length);
    if (text[colon] !== ':') {
        return null;
    }
    const start = skipWs(text, colon + 1);
    if (text[start] !== '{') {
        return null;
    }
    return { start, end: skipValue(text, start) };
}

// Every element of every array under `key` within the region. A quoted string
// followed by a colon is a KEY and nothing else in JSON, which is the whole test:
// `p_Interfaces` names the interface catalog's list wherever it appears.
function eachKeyedArray(
    text: string,
    region: ScNameSite,
    key: string,
    onElement: (start: number) => void,
): void {
    const quoted = `"${key}"`;
    let at = text.indexOf(quoted, region.start);
    while (at >= 0 && at < region.end) {
        const colon = skipWs(text, at + quoted.length);
        if (text[colon] === ':') {
            const value = skipWs(text, colon + 1);
            if (text[value] === '[') {
                eachElement(text, value, onElement);
            }
        }
        at = text.indexOf(quoted, at + quoted.length);
    }
}

// Read one definition object: `{ "content": { "p_Name": …, <descriptor>: {…} }, "type": … }`.
function readJsonDefinition(
    text: string,
    objStart: number,
    container: 'interfaces' | 'modeledDataTypes',
): ScDefinition | null {
    if (text[objStart] !== '{') {
        return null;
    }
    let type = '';
    let contentStart = -1;
    eachMember(text, objStart, (key, valueStart) => {
        if (key === 'type' && text[valueStart] === '"') {
            type = text.slice(valueStart + 1, skipValue(text, valueStart) - 1);
        } else if (key === 'content' && text[valueStart] === '{') {
            contentStart = valueStart;
        }
    });
    if (contentStart < 0) {
        return null;
    }

    let nameSite: ScNameSite | undefined;
    const descriptors: { site: ScNameSite; text: string }[] = [];
    eachMember(text, contentStart, (key, valueStart) => {
        if (key === 'p_Name' && text[valueStart] === '"') {
            nameSite = { start: valueStart + 1, end: skipValue(text, valueStart) - 1 };
        } else if (text[valueStart] === '{') {
            // A direct child object: the second place a value type's name is written
            // is the descriptor nested here. Deeper objects are other definitions'
            // business — a data element's owned interface, a struct element's
            // descriptor — and their names are their own.
            const site = descriptorNameSite(text, valueStart);
            if (site) {
                descriptors.push({ site, text: text.slice(site.start, site.end) });
            }
        }
    });
    if (!nameSite) {
        return null;
    }
    return definitionOf(text.slice(nameSite.start, nameSite.end), type, container, nameSite, descriptors);
}

// The name span of a value-type descriptor object, or null if this object is not one.
function descriptorNameSite(text: string, objStart: number): ScNameSite | null {
    let isDescriptor = false;
    let contentStart = -1;
    eachMember(text, objStart, (key, valueStart) => {
        if (key === 'type' && text[valueStart] === '"') {
            isDescriptor = text.slice(valueStart + 1, skipValue(text, valueStart) - 1) === DESCRIPTOR_TYPE;
        } else if (key === 'content' && text[valueStart] === '{') {
            contentStart = valueStart;
        }
    });
    if (!isDescriptor || contentStart < 0) {
        return null;
    }
    let site: ScNameSite | null = null;
    eachMember(text, contentStart, (key, valueStart) => {
        if (key === 'p_Name' && text[valueStart] === '"') {
            site = { start: valueStart + 1, end: skipValue(text, valueStart) - 1 };
        }
    });
    return site;
}

const skipWs = (text: string, i: number): number => {
    let at = i;
    while (at < text.length && (text[at] === ' ' || text[at] === '\t' || text[at] === '\n' || text[at] === '\r')) {
        at++;
    }
    return at;
};

// The index just past the value starting at `i`. Strings are skipped with escape
// awareness, so a `}` or a `"` inside one does not end anything.
function skipValue(text: string, i: number): number {
    const ch = text[i];
    if (ch === '"') {
        return skipString(text, i);
    }
    if (ch === '{' || ch === '[') {
        const close = ch === '{' ? '}' : ']';
        let depth = 0;
        let at = i;
        while (at < text.length) {
            const c = text[at];
            if (c === '"') {
                at = skipString(text, at);
                continue;
            }
            if (c === '{' || c === '[') {
                depth++;
            } else if (c === '}' || c === ']') {
                depth--;
                if (depth === 0) {
                    return c === close ? at + 1 : at + 1;
                }
            }
            at++;
        }
        return text.length;
    }
    // A number, true/false/null: everything up to whatever ends a value.
    let at = i;
    while (at < text.length && !',}] \t\n\r'.includes(text[at])) {
        at++;
    }
    return at;
}

function skipString(text: string, i: number): number {
    let at = i + 1;
    while (at < text.length) {
        if (text[at] === '\\') {
            at += 2;
            continue;
        }
        if (text[at] === '"') {
            return at + 1;
        }
        at++;
    }
    return text.length;
}

// Each `"key": value` of the object starting at `objStart`, without descending.
function eachMember(
    text: string,
    objStart: number,
    onMember: (key: string, valueStart: number) => void,
): void {
    let at = skipWs(text, objStart + 1);
    while (at < text.length && text[at] !== '}') {
        if (text[at] !== '"') {
            return;
        }
        const keyEnd = skipString(text, at);
        const key = text.slice(at + 1, keyEnd - 1);
        const colon = skipWs(text, keyEnd);
        if (text[colon] !== ':') {
            return;
        }
        const valueStart = skipWs(text, colon + 1);
        onMember(key, valueStart);
        at = skipWs(text, skipValue(text, valueStart));
        if (text[at] === ',') {
            at = skipWs(text, at + 1);
        }
    }
}

// Each element of the array starting at `arrStart`, without descending.
function eachElement(text: string, arrStart: number, onElement: (start: number) => void): void {
    let at = skipWs(text, arrStart + 1);
    while (at < text.length && text[at] !== ']') {
        onElement(at);
        at = skipWs(text, skipValue(text, at));
        if (text[at] === ',') {
            at = skipWs(text, at + 1);
        }
    }
}

/** One replacement in a source text, as a half-open span and the text to put there. */
export interface ScTextEdit {
    start: number;
    end: number;
    text: string;
}

/**
 * The edits that carry a rename into the catalog: every place the definition named
 * `oldName` spells that name, and nothing else.
 *
 * Nothing else is the point. In a real dictionary a catalog name occurs three times
 * in this part — on the definition, on the definition's own value-type descriptor,
 * and on a bus element in ANOTHER interface that happens to be named after the type
 * it references. The first two are the definition's name and move with it; the third
 * is an element's name in someone else's interface and must not move. A global
 * string replace gets that wrong every time.
 *
 * Returns edits in ascending position, or an empty array when no definition carries
 * the name (the overwhelming majority of renames: an entry no catalog classifies).
 */
export function scRenameEdits(
    defs: ScDefinition[],
    oldName: string,
    newName: string,
): ScTextEdit[] {
    const edits: ScTextEdit[] = [];
    defs.forEach((def) => {
        if (def.name !== oldName) {
            return;
        }
        def.nameSites.forEach((site) => edits.push({ start: site.start, end: site.end, text: newName }));
    });
    return edits.sort((a, b) => a.start - b.start);
}

/** Apply non-overlapping edits to a text, back to front so earlier spans stay valid. */
export function applyScEdits(text: string, edits: ScTextEdit[]): string {
    let out = text;
    [...edits].sort((a, b) => b.start - a.start).forEach((edit) => {
        out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    });
    return out;
}

/**
 * Move a definition's key in a catalog the model is holding, to follow a rename.
 *
 * The other half of `scRenameEdits`, and the one that is about the TREE rather than the
 * file: the catalog is keyed by name, and every narrow repaint rebuilds an entry through
 * `parseEntry(record, catalog)`, so a catalog left keyed by the old name re-derives a
 * Kind the renamed entry no longer has. The host writes the part; this keeps the tree it
 * is holding saying the same thing.
 *
 * Returns whether anything moved, so a caller can tell "the catalog classified this
 * entry" from "there was nothing to follow" — which is also the gate on carrying the
 * rename into the file at all.
 */
export function renameInCatalog(
    catalog: SystemComposerCatalog | null | undefined,
    oldName: string,
    newName: string,
): boolean {
    if (!catalog || oldName === newName) {
        return false;
    }
    let moved = false;
    ([catalog.interfaces, catalog.modeledDataTypes] as Record<string, string>[]).forEach((bag) => {
        if (!Object.prototype.hasOwnProperty.call(bag, oldName)) {
            return;
        }
        bag[newName] = bag[oldName];
        delete bag[oldName];
        moved = true;
    });
    return moved;
}
