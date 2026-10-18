// Copyright 2026 The MathWorks, Inc.
//
// Serialize a compressed-binary .sldd model back to zip bytes. `buildDataChunkXml`
// writes the whole data/chunk0.xml; `serializeEntryToXml` writes ONE entry's <Object>
// fragment (used by the entry-level splice edit path).
//
// WHAT NOBODY EDITED IS WRITTEN AS IT WAS READ. An entry whose bytes the reader verified
// (parser/EntrySource) and that has not been touched since — its status is neither
// 'Modified' nor 'New', and it still has the name, the section and the metadata it had when
// its bytes were attached — is written as those bytes, and a whole chunk is written in the
// reader's frame: the entries in document order, between the prolog, separators and tail
// the file already had. Only what was edited or added is written from the model: an added
// entry whole, an edited one as the bytes it was read from with the parts the edit changed
// written from the model (parser/EntryMerge), and the objects after the last entry only when
// the dictionary-level fields they hold changed; what is written from the model is laid out
// as the file is (parser/ChunkLayout). So a save that edits nothing gives back the chunk it
// read, and the per-value writers are reached only for what the user changed, which is the
// only place their spelling is anybody's choice. Writing every entry from the model used to respell values nobody touched (25,278
// of 242,089 entries over 57 real dictionaries), reorder interleaved sections, drop the
// trailing newline and add a DD.Dictionary the file never had.
//
// `regenerateEntryXml` and `regenerateChunkXml` are the full rewrite from the model,
// which is what every save did before: the writers' own entry points, for their tests and
// for scripts/save-fidelity.mjs, which measures what a full rewrite would cost.
import { zipSync } from 'fflate';
import { escapeXml, matlabTimestampNow } from './XmlUtils.js';
import { encodedXml } from './EncodedValue.js';
import { oneWrite } from './MatWriter.js';
import { DATA_PART_XML } from './SlddParts.js';
import { SC_PART_XML, catalogFunctionRenames, catalogRenames, scXmlWithRenames } from './ScCatalog.js';
import { chunkFrameOf, entrySourceOf, keptFragmentOf, packageStampsOf, withOriginTags } from './EntrySource.js';
import { WRITER_LAYOUT, inLayout, layoutOf } from './ChunkLayout.js';
import { baseOf, catalogOf, keptPartsOf, mergeEntry, readEntryFragment, stripOrigins } from './EntryMerge.js';
import { entrySpans } from './BinarySlddParser.js';
import { findEntryObjectSpan, pNodeText } from './xmlEntrySplice.js';
import { entrySelectorOf, toEntrySelector } from './entrySelector.js';
export function serializeBinarySldd(slddNode) {
    const xmlString = buildDataChunkXml(slddNode);
    const encoder = new TextEncoder();
    const zipEntries = {};
    if (slddNode._zipMetadata) {
        for (const [name, data] of Object.entries(slddNode._zipMetadata)) {
            zipEntries[name] = data;
        }
    }
    // The System Composer catalog names each architectural entry it models, so an entry
    // renamed since the read has to be renamed there too, or it reopens as its raw class
    // (a struct type as a data interface) and the catalog defines a name no entry has. The
    // member is written as read, with only the renamed definitions' name sites changed; a
    // service interface's renamed function, which the catalog keeps a copy of, likewise.
    const catalog = zipEntries[SC_PART_XML];
    const renames = catalogRenames(slddNode.systemComposer);
    const functionRenames = catalogFunctionRenames(slddNode.systemComposer);
    if (catalog && (renames.size > 0 || functionRenames.size > 0)) {
        const xml = new TextDecoder().decode(catalog);
        const renamed = scXmlWithRenames(xml, renames, functionRenames);
        if (renamed !== xml) {
            zipEntries[SC_PART_XML] = encoder.encode(renamed);
        }
    }
    zipEntries[DATA_PART_XML] = encoder.encode(xmlString);
    const zipped = zipSync(asRead(zipEntries, packageStampsOf(slddNode._zipMetadata)), { level: 6 });
    return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
}
/**
 * The members in the order the archive they were read from listed them, each with the time
 * stamp and the compression it had there: the zip-level metadata of the package, kept as
 * read, so a save neither reorders nor restamps it. Of 57 binary dictionaries measured, 51
 * stamp every member 1980-01-01 00:00 and 54 do not list `data/chunk0.xml` last, where this
 * writer put it; writing the save's own time also made two saves of one dictionary differ.
 * Members the archive did not list follow, as before; with nothing known about the archive,
 * the members go as they are.
 */
function asRead(members, stamps) {
    if (!stamps) {
        return members;
    }
    const out = {};
    for (const stamp of stamps) {
        if (Object.prototype.hasOwnProperty.call(members, stamp.name) && !Object.prototype.hasOwnProperty.call(out, stamp.name)) {
            out[stamp.name] = [members[stamp.name], optionsOf(stamp)];
        }
    }
    for (const [name, data] of Object.entries(members)) {
        if (!Object.prototype.hasOwnProperty.call(out, name)) {
            out[name] = data;
        }
    }
    return out;
}
function optionsOf(stamp) {
    const options = stamp.method === 0 ? { level: 0 } : {};
    const mtime = dosDateTime(stamp.dosTime, stamp.dosDate);
    if (mtime) {
        options.mtime = mtime;
    }
    return options;
}
// The local time an MS-DOS time and date field pair names, or undefined for one that names
// none. The zip writer stores the Date's LOCAL fields, so the round trip is exact only for a
// pair whose every field is in range and that is not a local time a clock change skips; any
// other is written with the writer's own time, as every member used to be.
function dosDateTime(dosTime, dosDate) {
    const year = 1980 + (dosDate >> 9);
    const month = (dosDate >> 5) & 15;
    const day = dosDate & 31;
    const hours = dosTime >> 11;
    const minutes = (dosTime >> 5) & 63;
    const seconds = (dosTime & 31) * 2;
    const date = new Date(year, month - 1, day, hours, minutes, seconds);
    const exact = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
        && date.getHours() === hours && date.getMinutes() === minutes && date.getSeconds() === seconds;
    return exact && year <= 2099 ? date : undefined;
}
/**
 * The whole `data/chunk0.xml` of a dictionary: in the frame it was read in when there is
 * one, with every unedited entry as the bytes it was read from; otherwise generated, as
 * `regenerateChunkXml` does, still keeping an unedited entry's bytes where it has them.
 */
export function buildDataChunkXml(slddNode) {
    const frame = chunkFrameOf(slddNode);
    if (frame && frame.xml === slddNode.rawXml && sameDataSourceAttrs(frame, slddNode)) {
        const framed = framedChunkXml(slddNode, frame);
        if (framed !== null) {
            return framed;
        }
    }
    return generatedChunkXml(slddNode, serializeEntryToXml);
}
/**
 * The whole chunk written from the model: a fixed prolog, every entry regenerated in
 * section order, then the dictionary-level objects. Internal, and not what a save writes;
 * it is the writers' whole-document entry point, for the tests that exercise them and for
 * the fidelity census (scripts/save-fidelity.mjs).
 */
export function regenerateChunkXml(slddNode) {
    return generatedChunkXml(slddNode, regenerateEntryXml);
}
function generatedChunkXml(slddNode, entryXml) {
    const attrs = slddNode._dataSourceAttrs || { FormatVersion: '1', MinRelease: 'R2014a', Arch: '' };
    // Escaped as every attribute the writers write is: the reader decodes XML's references in
    // them, so an Arch read from `a&quot;b` is `a"b`, which written back as it stood ended the
    // attribute early.
    const archAttr = attrs.Arch ? ' Arch="' + escapeXml(String(attrs.Arch)) + '"' : '';
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<DataSource FormatVersion="' + escapeXml(String(attrs.FormatVersion)) + '" MinRelease="'
        + escapeXml(String(attrs.MinRelease)) + '"' + archAttr + '>\n';
    slddNode.children.forEach(function (section) {
        section.children.forEach(function (entryNode) {
            xml += entryXml(entryNode);
        });
    });
    return xml + generatedEpilog(slddNode);
}
// The objects after the entries, and the close of the document: referenced
// sub-dictionaries, if any, precede the dictionary object.
function generatedEpilog(slddNode) {
    let xml = '';
    for (const sub of slddNode.dictionaryReferences || []) {
        xml += '    <Object Class="DD.DICTIONARYREFERENCE">\n';
        xml += '        <P Name="Subdictionary" Class="char">' + escapeXml(String(sub)) + '</P>\n';
        xml += '    </Object>\n';
    }
    xml += '    <Object Class="DD.Dictionary">\n';
    xml += '        <P Name="AccessBaseWorkspace" Class="logical">' + (slddNode.allowAccessBWS ? '1' : '0') + '</P>\n';
    xml += '    </Object>\n';
    xml += '</DataSource>';
    return xml;
}
/**
 * The chunk in the frame it was read in, or null when this dictionary cannot be written
 * in it (a self-closed `<DataSource/>` that has gained an entry, or one whose
 * dictionary-level objects have to be regenerated).
 *
 * Every entry the frame holds is written at its own position, after the whitespace that
 * preceded it — its bytes when unedited, regenerated when edited — so a deleted entry
 * takes its separator with it. Entries the frame does not hold (added, or rebuilt from a
 * record) follow the last of them, with the separator the last one had, and before the
 * dictionary-level objects: the place a host's splice puts a new entry too.
 *
 * What is written from the model is laid out as the chunk is (ChunkLayout): its line ends
 * and its indentation, read off its first object. A chunk that shows no layout to follow
 * gets the writers' own.
 */
function framedChunkXml(slddNode, frame) {
    const { xml, spans } = frame;
    const firstObject = spans.length > 0 ? spans[0][0] : frame.insertAt < 0 ? -1 : xml.indexOf('<Object', frame.insertAt);
    const layout = layoutOf(xml, firstObject);
    const placed = new Array(spans.length);
    const added = [];
    slddNode.children.forEach(function (section) {
        section.children.forEach(function (node) {
            const entryNode = node;
            const source = entrySourceOf(entryNode);
            if (source && source.frame === frame && placed[source.index] === undefined) {
                placed[source.index] = entryObjectXml(entryNode, layout);
            }
            else {
                added.push(entryObjectXml(entryNode, layout));
            }
        });
    });
    const epilogKept = sameEpilog(frame, slddNode);
    let out;
    let tail;
    let lead;
    if (spans.length > 0) {
        // The whitespace before an entry is the entry's own: the first one's is whatever
        // ends the prolog, every other one's is what separates it from the one before.
        const prolog = xml.substring(0, spans[0][0]);
        const firstLead = prolog.substring(prolog.trimEnd().length);
        const leadOf = (i) => (i === 0 ? firstLead : xml.substring(spans[i - 1][1], spans[i][0]));
        out = prolog.substring(0, prolog.length - firstLead.length);
        for (let i = 0; i < spans.length; i++) {
            if (placed[i] !== undefined) {
                out += leadOf(i) + placed[i];
            }
        }
        lead = leadOf(spans.length - 1);
        tail = xml.substring(spans[spans.length - 1][1]);
    }
    else {
        if (frame.insertAt < 0) {
            return added.length === 0 && epilogKept ? xml : null;
        }
        out = xml.substring(0, frame.insertAt);
        lead = (layout ?? WRITER_LAYOUT).nl + (layout ?? WRITER_LAYOUT).base;
        tail = xml.substring(frame.insertAt);
    }
    for (const entry of added) {
        out += lead + entry;
    }
    if (epilogKept) {
        return out + tail;
    }
    // The dictionary-level objects are regenerated, after the whitespace the chunk had
    // before its first one, laid out as the chunk is, and the text after `</DataSource>`
    // (MATLAB's final newline) is kept.
    const close = tail.lastIndexOf('</DataSource>');
    if (close < 0) {
        return null;
    }
    const firstTag = tail.indexOf('<');
    const before = tail.substring(0, firstTag < 0 ? 0 : firstTag).replace(/[ \t]*$/, '');
    const epilog = generatedEpilog(slddNode);
    const laidOut = layout && layout !== WRITER_LAYOUT ? layout.base + inLayout(epilog.trimStart(), layout) : epilog;
    return out + before + laidOut + tail.substring(close + '</DataSource>'.length);
}
function sameEpilog(frame, slddNode) {
    const refs = slddNode.dictionaryReferences || [];
    return frame.allowAccessBWS === !!slddNode.allowAccessBWS
        && refs.length === frame.dictionaryReferences.length
        && refs.every((ref, i) => String(ref) === frame.dictionaryReferences[i]);
}
function sameDataSourceAttrs(frame, slddNode) {
    const now = slddNode._dataSourceAttrs || {};
    const then = frame.dataSourceAttrs;
    const keys = new Set([...Object.keys(now), ...Object.keys(then)]);
    return [...keys].every((k) => (now[k] ?? '') === (then[k] ?? ''));
}
// The bytes an entry was read from, if it has any and nothing has touched it since.
// Status is the first gate: every edit through the API reaches DataNode._markModified, which
// sets 'Modified' and is never undone, and an added entry is 'New'. The second is asked here,
// as the bytes are about to be written: the node must still have the name, the section and
// every metadata field the writer writes that it had when the bytes were attached
// (EntrySource.keptFragmentOf), since a change made around the API sets no status.
function uneditedBytes(entryNode) {
    if (entryNode.status === 'Modified' || entryNode.status === 'New') {
        return undefined;
    }
    return keptFragmentOf(entryNode) ?? undefined;
}
// An edited entry that has bytes it was read from, as those bytes with only what the model
// changed in them written from the model (EntryMerge), what is written from the model laid out in
// `layout`. `merged` is null where the entry has no bytes, or they cannot be merged with the
// model's text, and the entry is then regenerated whole, as every edited entry was: `line` is that
// regeneration when it has been written already, so that it is not written twice.
//
// The merge is used only when, read again on its own, it gives the model's own text: a merge that
// read as anything but what the model holds would save another value than the one shown.
function mergedEntry(entryNode, layout) {
    const source = entrySourceOf(entryNode);
    if (!source || source.fragment === null) {
        return { merged: null, line: null };
    }
    const tagged = withOriginTags(() => regenerateEntryXml(entryNode));
    const line = stripOrigins(tagged);
    const catalog = catalogOf(entryNode);
    const base = baseOf(source, catalog, (read) => withOriginTags(() => regenerateEntryXml(read)));
    const merged = base === null ? null : mergeEntry(source.fragment, base, tagged, layout);
    if (merged === null) {
        return { merged: null, line };
    }
    let again = null;
    try {
        const reread = readEntryFragment(merged, { systemComposer: catalog });
        again = reread ? regenerateEntryXml(reread) : null;
    }
    catch {
        again = null;
    }
    return { merged: again === line ? merged : null, line };
}
// One entry's `<Object>…</Object>`, without the line around it: its bytes when unedited,
// otherwise those bytes with what was edited written from the model, or, for an entry with no
// bytes, the whole of it written from the model; what is written from the model is laid out as
// the chunk it goes into is.
function entryObjectXml(entryNode, layout) {
    const bytes = uneditedBytes(entryNode);
    if (bytes !== undefined) {
        return bytes;
    }
    const { merged, line } = mergedEntry(entryNode, layout);
    if (merged !== null) {
        return merged;
    }
    const regenerated = line ?? regenerateEntryXml(entryNode);
    const object = regenerated.substring(4, regenerated.length - 1);
    return layout ? inLayout(object, layout) : object;
}
// The layout of the chunk an entry's bytes were read from, read off its first object as a save
// reads it (framedChunkXml).
const frameLayouts = new WeakMap();
function frameLayoutOf(frame) {
    if (!frameLayouts.has(frame)) {
        const first = frame.spans.length > 0 ? frame.spans[0][0] : -1;
        frameLayouts.set(frame, layoutOf(frame.xml, first));
    }
    return frameLayouts.get(frame);
}
/**
 * One entry's `<Object>` as a line: four spaces, the object, a newline. An unedited entry
 * whose bytes the reader verified is those bytes; an edited one is those bytes with what was
 * edited written from the model, laid out as the chunk it was read from is; any other is
 * regenerated.
 */
export function serializeEntryToXml(entryNode) {
    const bytes = uneditedBytes(entryNode);
    if (bytes !== undefined) {
        return '    ' + bytes + '\n';
    }
    const frame = entrySourceOf(entryNode)?.frame;
    const { merged, line } = mergedEntry(entryNode, frame ? frameLayoutOf(frame) : null);
    return merged !== null ? '    ' + merged + '\n' : line ?? regenerateEntryXml(entryNode);
}
/**
 * One entry's `<Object>` line written from the model, whatever bytes it was read from.
 * Internal: the writers' entry point, for their tests and the fidelity census, and the text
 * (C, and B for the bytes as read) an edited entry is merged from (mergedEntry).
 */
export function regenerateEntryXml(entryNode) {
    const meta = entryNode.metadata || {};
    // Prefer whichever raw timestamp the entry actually carries, in the same order
    // DataNode's `lastModified` getter reads them: `_rawLastMod` for an entry parsed
    // from a binary file, `lastmod` for one just added (addEntry stamps that key, and
    // _markModified refreshes whichever key is present). Only an entry with neither —
    // which nothing in the data model produces — falls back to now. Reading just
    // `_rawLastMod` used to display one timestamp in the Last Modified column and
    // write a different one to disk on every save of a newly added entry.
    const lastMod = meta._rawLastMod || meta.lastmod || matlabTimestampNow();
    // The text of every line is escaped, as the Name's and the Value's always were: the reader
    // decodes XML's references in all of them, so a UUID read from `x&amp;y` is `x&y`, and an
    // IsDerived read from a CDATA section can be `</P>`. Written back as they stood, those were
    // a bare `&`, a `<` that starts no tag, and a close tag too many.
    const field = (value) => escapeXml(String(value));
    let xml = '    <Object Class="DD.ENTRY">\n';
    xml += '        <P Name="Name" Class="char">' + field(entryNode.name) + '</P>\n';
    xml += '        <P Name="UUID" Class="char">' + field(meta.uuid || '') + '</P>\n';
    xml += '        <P Name="Namespace" Class="char">' + field(meta.namespace || '') + '</P>\n';
    xml += '        <P Name="LastMod" Class="char">' + field(lastMod) + '</P>\n';
    // `modifiedby` is the same fact as a text dictionary's entry files it, for an entry
    // pasted in from one (DataNode's textDictionaryMetadata is the other direction).
    xml += '        <P Name="LastModBy" Class="char">' + field(meta.lastModifiedBy || meta.modifiedby || '') + '</P>\n';
    xml += '        <P Name="IsDerived" Class="char">' + field(meta.isderived || '0') + '</P>\n';
    // A value whose only binary spelling is hex, and whose bytes the node still holds
    // (DataNode._binaryEncoded), goes in as the hex MATLAB writes for it; everything else
    // writes itself. A value READ from hex replays it through serializeXml already. Either
    // way it is one write of one value (MatWriter.oneWrite): a cell refused as one stream,
    // and written as XML instead, does not get a fresh budget for each element.
    xml += oneWrite(() => {
        const encoded = entryNode._binaryEncoded?.();
        return encoded ? encodedXml('P', ' Name="Value"', encoded, 2) : entryNode.serializeXml('P', { Name: 'Value' }, 2);
    }) + '\n';
    xml += '    </Object>\n';
    return xml;
}
/**
 * Where the text written for one entry, `writtenObject` (its `<Object>…</Object>`, as a host holds
 * it in the chunk it is about to save), changes what nobody edited, by path: empty when it keeps
 * every part of the bytes the entry was read from that the model has not changed. An entry nobody
 * edited must be exactly those bytes. An edited one may differ from them only where the model
 * differs from what the bytes read as, and in its Name and LastMod lines (EntryMerge.keptPartsOf):
 * read with a structure-aware scan of the text, never with the reader, which can lose what the
 * writer loses. Empty for an entry with no bytes it was read from, which nothing holds it to.
 * A binary save gate refuses a save this finds anything in (the maintainer's D12 addendum).
 */
export function keptPartsViolations(entryNode, writtenObject) {
    const source = entrySourceOf(entryNode);
    if (!source || source.fragment === null) {
        return [];
    }
    const object = writtenObject.trim();
    if (uneditedBytes(entryNode) !== undefined) {
        return object === source.fragment ? [] : ['the entry, which nobody edited, is not the bytes it was read from'];
    }
    const tagged = withOriginTags(() => regenerateEntryXml(entryNode));
    const base = baseOf(source, catalogOf(entryNode), (read) => withOriginTags(() => regenerateEntryXml(read)));
    return base === null ? [] : keptPartsOf(source.fragment, base, tagged, object) ?? [];
}
/**
 * `chunkXml` with one entry's `<Object>…</Object>` replaced by what a save writes for it now
 * (entryObjectXml: its bytes, merged with the edit, or regenerated), laid out as the chunk is, and
 * every byte around it as it was; null when the chunk holds no such entry. The entry is found by
 * `selectorBefore`, the name (and, where two share it, the UUID) it has in the chunk, which a
 * rename has changed in the model; the entry's own by default. Found by the structure-aware scan
 * a save reads spans with (BinarySlddParser.entrySpans), or, in a chunk that scan cannot vouch
 * for, by findEntryObjectSpan. For a host that keeps a chunk as text and splices each edit into
 * it: the whitespace before and after the object is the chunk's, so no edit moves it.
 */
export function spliceEntryObject(chunkXml, entryNode, selectorBefore) {
    const selector = toEntrySelector(selectorBefore ?? entrySelectorOf(entryNode));
    const { spans, clean } = entrySpans(chunkXml);
    let span = null;
    if (clean) {
        let first = null;
        for (const [start, end] of spans) {
            const fragment = chunkXml.substring(start, end);
            if (pNodeText(fragment, '<P Name="Name"') !== selector.name) {
                continue;
            }
            const here = { offset: start, length: end - start };
            if (!selector.uuid || pNodeText(fragment, '<P Name="UUID"') === selector.uuid) {
                span = here;
                break;
            }
            first ??= here;
        }
        span ??= first;
    }
    else {
        span = findEntryObjectSpan(chunkXml, selector);
    }
    if (!span) {
        return null;
    }
    const firstObject = clean && spans.length > 0 ? spans[0][0] : span.offset;
    const object = entryObjectXml(entryNode, layoutOf(chunkXml, firstObject));
    return chunkXml.substring(0, span.offset) + object + chunkXml.substring(span.offset + span.length);
}
//# sourceMappingURL=BinarySlddSerializer.js.map