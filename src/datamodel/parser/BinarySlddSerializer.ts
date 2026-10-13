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
// the file already had. Only an edited or added entry is written from the model, and the
// objects after the last entry only when the dictionary-level fields they hold changed;
// what is written from the model is laid out as the file is (parser/ChunkLayout). So a save
// that edits nothing gives back the chunk it read, and the per-value writers are reached
// only for what the user changed, which is the only place their spelling is anybody's
// choice. Writing every entry from the model used to respell values nobody touched (25,278
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
import { chunkFrameOf, entrySourceOf, keptFragmentOf, type ChunkFrame } from './EntrySource.js';
import { WRITER_LAYOUT, inLayout, layoutOf, type ChunkLayout } from './ChunkLayout.js';
import type SlddNode from '../node/container/SlddNode.js';
import type DataNode from '../node/DataNode.js';

export function serializeBinarySldd(slddNode: SlddNode): ArrayBuffer {
    const xmlString = buildDataChunkXml(slddNode);
    const encoder = new TextEncoder();

    const zipEntries: Record<string, Uint8Array> = {};
    if (slddNode._zipMetadata) {
        for (const [name, data] of Object.entries(slddNode._zipMetadata)) {
            zipEntries[name] = data as Uint8Array;
        }
    }
    zipEntries[DATA_PART_XML] = encoder.encode(xmlString);

    const zipped = zipSync(zipEntries, { level: 6 });
    return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
}

/**
 * The whole `data/chunk0.xml` of a dictionary: in the frame it was read in when there is
 * one, with every unedited entry as the bytes it was read from; otherwise generated, as
 * `regenerateChunkXml` does, still keeping an unedited entry's bytes where it has them.
 */
export function buildDataChunkXml(slddNode: SlddNode): string {
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
export function regenerateChunkXml(slddNode: SlddNode): string {
    return generatedChunkXml(slddNode, regenerateEntryXml);
}

function generatedChunkXml(slddNode: SlddNode, entryXml: (entryNode: DataNode) => string): string {
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
            xml += entryXml(entryNode as unknown as DataNode);
        });
    });

    return xml + generatedEpilog(slddNode);
}

// The objects after the entries, and the close of the document: referenced
// sub-dictionaries, if any, precede the dictionary object.
function generatedEpilog(slddNode: SlddNode): string {
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
function framedChunkXml(slddNode: SlddNode, frame: ChunkFrame): string | null {
    const { xml, spans } = frame;
    const firstObject = spans.length > 0 ? spans[0][0] : frame.insertAt < 0 ? -1 : xml.indexOf('<Object', frame.insertAt);
    const layout = layoutOf(xml, firstObject);
    const placed: (string | undefined)[] = new Array(spans.length);
    const added: string[] = [];
    slddNode.children.forEach(function (section) {
        section.children.forEach(function (node) {
            const entryNode = node as unknown as DataNode;
            const source = entrySourceOf(entryNode);
            if (source && source.frame === frame && placed[source.index] === undefined) {
                placed[source.index] = entryObjectXml(entryNode, layout);
            } else {
                added.push(entryObjectXml(entryNode, layout));
            }
        });
    });
    const epilogKept = sameEpilog(frame, slddNode);

    let out: string;
    let tail: string;
    let lead: string;
    if (spans.length > 0) {
        // The whitespace before an entry is the entry's own: the first one's is whatever
        // ends the prolog, every other one's is what separates it from the one before.
        const prolog = xml.substring(0, spans[0][0]);
        const firstLead = prolog.substring(prolog.trimEnd().length);
        const leadOf = (i: number): string => (i === 0 ? firstLead : xml.substring(spans[i - 1][1], spans[i][0]));
        out = prolog.substring(0, prolog.length - firstLead.length);
        for (let i = 0; i < spans.length; i++) {
            if (placed[i] !== undefined) {
                out += leadOf(i) + placed[i];
            }
        }
        lead = leadOf(spans.length - 1);
        tail = xml.substring(spans[spans.length - 1][1]);
    } else {
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

function sameEpilog(frame: ChunkFrame, slddNode: SlddNode): boolean {
    const refs = slddNode.dictionaryReferences || [];
    return frame.allowAccessBWS === !!slddNode.allowAccessBWS
        && refs.length === frame.dictionaryReferences.length
        && refs.every((ref, i) => String(ref) === frame.dictionaryReferences[i]);
}

function sameDataSourceAttrs(frame: ChunkFrame, slddNode: SlddNode): boolean {
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
function uneditedBytes(entryNode: DataNode): string | undefined {
    if (entryNode.status === 'Modified' || entryNode.status === 'New') {
        return undefined;
    }
    return keptFragmentOf(entryNode) ?? undefined;
}

// One entry's `<Object>…</Object>`, without the line around it: its bytes when unedited,
// otherwise written from the model and laid out as the chunk it goes into is.
function entryObjectXml(entryNode: DataNode, layout: ChunkLayout | null): string {
    const bytes = uneditedBytes(entryNode);
    if (bytes !== undefined) {
        return bytes;
    }
    const line = regenerateEntryXml(entryNode);
    const object = line.substring(4, line.length - 1);
    return layout ? inLayout(object, layout) : object;
}

/**
 * One entry's `<Object>` as a line: four spaces, the object, a newline. An unedited entry
 * whose bytes the reader verified is those bytes; any other is regenerated.
 */
export function serializeEntryToXml(entryNode: DataNode): string {
    const bytes = uneditedBytes(entryNode);
    return bytes !== undefined ? '    ' + bytes + '\n' : regenerateEntryXml(entryNode);
}

/**
 * One entry's `<Object>` line written from the model, whatever bytes it was read from.
 * Internal: the writers' entry point, for their tests and the fidelity census.
 */
export function regenerateEntryXml(entryNode: DataNode): string {
    const meta = entryNode.metadata || {};
    // Prefer whichever raw timestamp the entry actually carries, in the same order
    // DataNode's `lastModified` getter reads them: `_rawLastMod` for an entry parsed
    // from a binary file, `lastmod` for one just added (addEntry stamps that key, and
    // _markModified refreshes whichever key is present). Only an entry with neither —
    // which nothing in the data model produces — falls back to now. Reading just
    // `_rawLastMod` used to display one timestamp in the Last Modified column and
    // write a different one to disk on every save of a newly added entry.
    const lastMod = (meta._rawLastMod as string) || (meta.lastmod as string) || matlabTimestampNow();
    // The text of every line is escaped, as the Name's and the Value's always were: the reader
    // decodes XML's references in all of them, so a UUID read from `x&amp;y` is `x&y`, and an
    // IsDerived read from a CDATA section can be `</P>`. Written back as they stood, those were
    // a bare `&`, a `<` that starts no tag, and a close tag too many.
    const field = (value: unknown): string => escapeXml(String(value));
    let xml = '    <Object Class="DD.ENTRY">\n';
    xml += '        <P Name="Name" Class="char">' + field(entryNode.name) + '</P>\n';
    xml += '        <P Name="UUID" Class="char">' + field((meta.uuid as string) || '') + '</P>\n';
    xml += '        <P Name="Namespace" Class="char">' + field((meta.namespace as string) || '') + '</P>\n';
    xml += '        <P Name="LastMod" Class="char">' + field(lastMod) + '</P>\n';
    // `modifiedby` is the same fact as a text dictionary's entry files it, for an entry
    // pasted in from one (DataNode's textDictionaryMetadata is the other direction).
    xml += '        <P Name="LastModBy" Class="char">' + field((meta.lastModifiedBy as string) || (meta.modifiedby as string) || '') + '</P>\n';
    xml += '        <P Name="IsDerived" Class="char">' + field((meta.isderived as string) || '0') + '</P>\n';
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
