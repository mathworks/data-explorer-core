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
// Maps a systemcomposer type string to the semantic classification token that
// drives the entry's Kind. The token is derived from the type, not the entry
// name (which is user-chosen), so it stays correct regardless of the name.
export const SC_TYPE_TO_CLASSIFICATION = {
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
//
// Every lookup is of an OWN key. The names are user-chosen MATLAB identifiers, and
// `toString`, `constructor`, `valueOf` and the rest of `Object.prototype`'s members are
// all valid ones: on a plain object `interfaces['toString']` is the inherited function,
// which is truthy, so a struct type of that name never reached `modeledDataTypes` and
// read as a Data Interface. The two readers build prototype-less bags, but the shape is
// public and a host's own catalog — or a clone of ours — has a prototype again.
export function classificationOf(catalog, entryName) {
    if (!catalog) {
        return null;
    }
    const scType = ownValue(catalog.interfaces, entryName) || ownValue(catalog.modeledDataTypes, entryName);
    return (scType && ownValue(SC_TYPE_TO_CLASSIFICATION, scType)) || null;
}
function ownValue(bag, key) {
    return Object.prototype.hasOwnProperty.call(bag, key) ? bag[key] : undefined;
}
/**
 * An empty name-keyed bag for the catalog: no prototype, so a name is only ever an own
 * key. `__proto__` in particular is stored like any other name rather than handed to
 * `Object.prototype`'s setter, which drops a string without a word.
 */
export function emptyCatalogBag() {
    return Object.create(null);
}
// NEITHER reader warns when the catalog yields no definitions, whether the part is
// absent or present-and-empty. Both used to raise `part-unreadable` here, on the
// reasoning that a lost catalog silently downgrades every architectural entry's Kind.
// Measured against MATLAB (R2027a, 2026-09-30), that reasoning was wrong twice over:
//
//   - Nothing but `Simulink.Bus` is ambiguous. Over 14,668 derived entries in four real
//     dictionaries, every other class is 1:1 with its classification, so `IsDerived`
//     plus the class already yields the identical Kind. `IsDerived` also drives the
//     Architectural-vs-Design section split on its own (see `getSectionKey`), so a
//     missing catalog costs nothing there either.
//   - For `Simulink.Bus`, the fallback IS what MATLAB does. Removing this part from a
//     dictionary holding a StructType and a DataInterface and reopening it in MATLAB
//     reports BOTH as `Simulink.dictionary.archdata.DataInterface`
//     (`getDataTypeNames` empty, `getInterfaceNames` listing both) — which is exactly
//     `DERIVED_KIND_BY_CLASS['Simulink.Bus'] = 'Data Interface'`. MATLAB does not
//     regenerate the part on save, and it ignores `simulink/ArchitecturePart.xml`,
//     which still records the struct type under `DataTypes` and is therefore a truth
//     we deliberately do NOT read: agreeing with MATLAB beats being right alone.
//
// So an empty catalog is a dictionary with nothing to classify, not a damaged one, and
// a banner over it claims a loss the user cannot act on and that MATLAB does not report.
// The two container keys a definition can be listed under. Scoping by KEY, not by
// type, is what keeps the catalog to actual definitions: a nested
// `p_OwnedDataInterface` is a ValueTypeInterface too, and the TypeCatalog's
// `p_BuiltInValueTypes` / `p_valueType` children are MATLAB's built-in types
// (`double`, `int16`, …) — none of them is a dictionary entry.
const IFACE_KEY = 'p_Interfaces';
const MODELED_KEY = 'p_ModeledDataTypes';
const DESCRIPTOR_TYPE = 'systemcomposer.property.ValueTypeDescriptor';
/**
 * Fold definitions into the catalog the model classifies entries with.
 *
 * The bag is chosen by comparing `container`, never by indexing with it: this function
 * is public, a JS caller is not held to the union, and `catalog['__proto__'][name] = type`
 * writes onto `Object.prototype` itself. A container outside the union names no bag and
 * is skipped.
 */
export function catalogFromDefinitions(defs) {
    const catalog = { interfaces: emptyCatalogBag(), modeledDataTypes: emptyCatalogBag() };
    defs.forEach((def) => {
        if (!def.name) {
            return;
        }
        if (def.container === 'interfaces') {
            catalog.interfaces[def.name] = def.type;
        }
        else if (def.container === 'modeledDataTypes') {
            catalog.modeledDataTypes[def.name] = def.type;
        }
    });
    return catalog;
}
const SLASH = 0x2f;
// `[A-Za-z_]`
const isNameStart = (c) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f;
// `[\w.-]`, where `\w` is ASCII `[A-Za-z0-9_]` (no `u` flag on the old regex).
const isNameChar = (c) => isNameStart(c) || (c >= 0x30 && c <= 0x39) || c === 0x2d || c === 0x2e;
export class XmlTagScanner {
    constructor(xml) {
        this.xml = xml;
        this.pos = 0;
        // Next-occurrence caches: `at` is the first `ch` at or after `from` (-1: none).
        this.gtFrom = 0;
        this.gtAt = -2;
        this.qtFrom = 0;
        this.qtAt = -2;
        // A walk from `deadFrom` found no terminator. Every later start an EVEN number of
        // quotes past it is on that same walk and fails too; `parityAt` / `parityOdd` count
        // the quotes in [deadFrom, parityAt), and `parityNext` is the first quote at or after
        // `parityAt` (-2: not looked for yet).
        this.deadFrom = -1;
        this.parityAt = 0;
        this.parityOdd = false;
        this.parityNext = -2;
    }
    next() {
        const xml = this.xml;
        for (;;) {
            const index = xml.indexOf('<', this.pos);
            if (index < 0) {
                return null;
            }
            this.pos = index + 1;
            let nameStart = index + 1;
            const closing = xml.charCodeAt(nameStart) === SLASH;
            if (closing) {
                nameStart++;
            }
            // charCodeAt past the end is NaN, which is neither.
            if (!isNameStart(xml.charCodeAt(nameStart))) {
                continue;
            }
            let nameEnd = nameStart + 1;
            while (isNameChar(xml.charCodeAt(nameEnd))) {
                nameEnd++;
            }
            const gt = this.terminator(nameEnd);
            if (gt < 0) {
                continue;
            }
            // Never the name's own last character, which is not a `/`.
            const selfClosing = xml.charCodeAt(gt - 1) === SLASH;
            this.pos = gt + 1;
            return {
                index,
                end: gt + 1,
                closing,
                name: xml.slice(nameStart, nameEnd),
                attrs: xml.slice(nameEnd, selfClosing ? gt - 1 : gt),
                selfClosing,
            };
        }
    }
    // The `>` that ends a tag whose attributes start at `start`, or -1 for none.
    //
    // There are only two walks through the rest of the input, the one that treats the
    // next `"` as opening a value and the one that treats it as closing one, and every
    // start lies on one of them. Once one has failed, a start on it is answered by
    // parity alone, so the retries the regex made at each later `<` cost a quote count
    // instead of a walk to the end. The other walk needs no memory of its own: every `>`
    // past `deadFrom` is one the dead walk skipped as quoted, so the other walk takes the
    // first one it reaches, and fails only where none is left, which the cached `nextGt`
    // then answers for every later start at once.
    terminator(start) {
        if (this.deadFrom >= 0) {
            return this.oddSinceDead(start) ? this.walk(start) : -1;
        }
        const gt = this.walk(start);
        if (gt < 0) {
            this.deadFrom = start;
            this.parityAt = start;
        }
        return gt;
    }
    walk(start) {
        let at = start;
        for (;;) {
            const gt = this.nextGt(at);
            if (gt < 0) {
                return -1;
            }
            const open = this.nextQuote(at);
            if (open < 0 || gt < open) {
                return gt;
            }
            const close = this.nextQuote(open + 1);
            if (close < 0) {
                return -1;
            }
            at = close + 1;
        }
    }
    // Whether an odd number of quotes lies in [deadFrom, at). Starts arrive in
    // ascending order, so the count only ever moves forward.
    oddSinceDead(at) {
        for (;;) {
            if (this.parityNext === -2) {
                this.parityNext = this.xml.indexOf('"', this.parityAt);
            }
            if (this.parityNext < 0 || this.parityNext >= at) {
                break;
            }
            this.parityOdd = !this.parityOdd;
            this.parityAt = this.parityNext + 1;
            this.parityNext = -2;
        }
        this.parityAt = at;
        return this.parityOdd;
    }
    nextGt(at) {
        if (this.gtAt === -2 || at < this.gtFrom || (this.gtAt >= 0 && at > this.gtAt)) {
            this.gtFrom = at;
            this.gtAt = this.xml.indexOf('>', at);
        }
        return this.gtAt;
    }
    nextQuote(at) {
        if (this.qtAt === -2 || at < this.qtFrom || (this.qtAt >= 0 && at > this.qtAt)) {
            this.qtFrom = at;
            this.qtAt = this.xml.indexOf('"', at);
        }
        return this.qtAt;
    }
}
const attrOf = (attrs, name) => {
    const m = new RegExp(`${name}="([^"]*)"`).exec(attrs);
    return m ? m[1] : '';
};
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
export function scanScXml(xml) {
    const defs = [];
    const stack = [];
    const tags = new XmlTagScanner(xml);
    let tag;
    while ((tag = tags.next())) {
        const { closing, name, attrs, selfClosing } = tag;
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
                textStart: tag.end,
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
        defs.push(definitionOf(xml.slice(frame.nameSite.start, frame.nameSite.end), frame.type, frame.tag === IFACE_KEY ? 'interfaces' : 'modeledDataTypes', frame.nameSite, frame.descriptorSites.map((site) => ({ site, text: xml.slice(site.start, site.end) }))));
    }
    return defs;
}
// Assemble a definition, keeping only the nested descriptor names that ARE this
// definition's name. A descriptor naming something else is naming something else:
// it is a reference to another type, and renaming this definition must not touch it.
function definitionOf(name, type, container, nameSite, descriptors) {
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
export function scanScJsonText(text) {
    const region = scPartRegion(text);
    if (!region) {
        return [];
    }
    const defs = [];
    [[IFACE_KEY, 'interfaces'], [MODELED_KEY, 'modeledDataTypes']].forEach(([key, container]) => {
        eachKeyedArray(text, region, key, (elemStart) => {
            const def = readJsonDefinition(text, elemStart, container);
            if (def) {
                defs.push(def);
            }
        });
    });
    return defs;
}
// The span of the interface dictionary part's VALUE inside the whole document text.
// Scoping the scan to it keeps `p_Interfaces` from being looked for in 40 MB of entry
// data that cannot contain one.
function scPartRegion(text) {
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
function eachKeyedArray(text, region, key, onElement) {
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
function readJsonDefinition(text, objStart, container) {
    if (text[objStart] !== '{') {
        return null;
    }
    let type = '';
    let contentStart = -1;
    eachMember(text, objStart, (key, valueStart) => {
        if (key === 'type' && text[valueStart] === '"') {
            type = text.slice(valueStart + 1, skipValue(text, valueStart) - 1);
        }
        else if (key === 'content' && text[valueStart] === '{') {
            contentStart = valueStart;
        }
    });
    if (contentStart < 0) {
        return null;
    }
    let nameSite;
    const descriptors = [];
    eachMember(text, contentStart, (key, valueStart) => {
        if (key === 'p_Name' && text[valueStart] === '"') {
            nameSite = { start: valueStart + 1, end: skipValue(text, valueStart) - 1 };
        }
        else if (text[valueStart] === '{') {
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
function descriptorNameSite(text, objStart) {
    let isDescriptor = false;
    let contentStart = -1;
    eachMember(text, objStart, (key, valueStart) => {
        if (key === 'type' && text[valueStart] === '"') {
            isDescriptor = text.slice(valueStart + 1, skipValue(text, valueStart) - 1) === DESCRIPTOR_TYPE;
        }
        else if (key === 'content' && text[valueStart] === '{') {
            contentStart = valueStart;
        }
    });
    if (!isDescriptor || contentStart < 0) {
        return null;
    }
    let site = null;
    eachMember(text, contentStart, (key, valueStart) => {
        if (key === 'p_Name' && text[valueStart] === '"') {
            site = { start: valueStart + 1, end: skipValue(text, valueStart) - 1 };
        }
    });
    return site;
}
const skipWs = (text, i) => {
    let at = i;
    while (at < text.length && (text[at] === ' ' || text[at] === '\t' || text[at] === '\n' || text[at] === '\r')) {
        at++;
    }
    return at;
};
// The index just past the value starting at `i`. Strings are skipped with escape
// awareness, so a `}` or a `"` inside one does not end anything.
function skipValue(text, i) {
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
            }
            else if (c === '}' || c === ']') {
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
function skipString(text, i) {
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
function eachMember(text, objStart, onMember) {
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
function eachElement(text, arrStart, onElement) {
    let at = skipWs(text, arrStart + 1);
    while (at < text.length && text[at] !== ']') {
        onElement(at);
        at = skipWs(text, skipValue(text, at));
        if (text[at] === ',') {
            at = skipWs(text, at + 1);
        }
    }
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
export function scRenameEdits(defs, oldName, newName) {
    const edits = [];
    defs.forEach((def) => {
        if (def.name !== oldName) {
            return;
        }
        def.nameSites.forEach((site) => edits.push({ start: site.start, end: site.end, text: newName }));
    });
    return edits.sort((a, b) => a.start - b.start);
}
/** Apply non-overlapping edits to a text, back to front so earlier spans stay valid. */
export function applyScEdits(text, edits) {
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
export function renameInCatalog(catalog, oldName, newName) {
    if (!catalog || oldName === newName) {
        return false;
    }
    let moved = false;
    [catalog.interfaces, catalog.modeledDataTypes].forEach((bag) => {
        if (!Object.prototype.hasOwnProperty.call(bag, oldName)) {
            return;
        }
        bag[newName] = bag[oldName];
        delete bag[oldName];
        moved = true;
    });
    return moved;
}
//# sourceMappingURL=ScCatalog.js.map