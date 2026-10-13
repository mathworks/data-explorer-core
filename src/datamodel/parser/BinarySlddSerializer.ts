// Copyright 2026 The MathWorks, Inc.
//
// Serialize a compressed-binary .sldd model back to zip bytes. `buildDataChunkXml`
// rebuilds the whole data/chunk0.xml (used by the save gate to validate the whole
// document); `serializeEntryToXml` builds ONE entry's <Object> fragment (used by the
// entry-level splice edit path). Untouched bytes are preserved by the splice caller,
// not here.
//
// `regenerateEntryXml` and `regenerateChunkXml` are the same writes, named for what they
// do: every entry written from the model. They are the writers' own entry points, for
// their tests and for scripts/save-fidelity.mjs, which measures what a full rewrite of a
// real dictionary costs; a save is free to write less than they do.

import { zipSync } from 'fflate';
import { escapeXml, matlabTimestampNow } from './XmlUtils.js';
import { encodedXml } from './EncodedValue.js';
import { oneWrite } from './MatWriter.js';
import { DATA_PART_XML } from './SlddParts.js';
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

export function buildDataChunkXml(slddNode: SlddNode): string {
    return generatedChunkXml(slddNode, serializeEntryToXml);
}

/**
 * The whole chunk written from the model: a fixed prolog, every entry regenerated in
 * section order, then the dictionary-level objects. Internal: the writers' whole-document
 * entry point, for the tests that exercise them and for the fidelity census
 * (scripts/save-fidelity.mjs).
 */
export function regenerateChunkXml(slddNode: SlddNode): string {
    return generatedChunkXml(slddNode, regenerateEntryXml);
}

function generatedChunkXml(slddNode: SlddNode, entryXml: (entryNode: DataNode) => string): string {
    const attrs = slddNode._dataSourceAttrs || { FormatVersion: '1', MinRelease: 'R2014a', Arch: '' };
    const archAttr = attrs.Arch ? ' Arch="' + attrs.Arch + '"' : '';
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<DataSource FormatVersion="' + attrs.FormatVersion + '" MinRelease="' + attrs.MinRelease + '"' + archAttr + '>\n';

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

/** One entry's `<Object>` as a line: four spaces, the object, a newline. */
export function serializeEntryToXml(entryNode: DataNode): string {
    return regenerateEntryXml(entryNode);
}

/**
 * One entry's `<Object>` line written from the model. Internal: the writers' entry point,
 * for their tests and the fidelity census.
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
    let xml = '    <Object Class="DD.ENTRY">\n';
    xml += '        <P Name="Name" Class="char">' + escapeXml(entryNode.name) + '</P>\n';
    xml += '        <P Name="UUID" Class="char">' + ((meta.uuid as string) || '') + '</P>\n';
    xml += '        <P Name="Namespace" Class="char">' + ((meta.namespace as string) || '') + '</P>\n';
    xml += '        <P Name="LastMod" Class="char">' + lastMod + '</P>\n';
    // `modifiedby` is the same fact as a text dictionary's entry files it, for an entry
    // pasted in from one (DataNode's textDictionaryMetadata is the other direction).
    xml += '        <P Name="LastModBy" Class="char">' + escapeXml((meta.lastModifiedBy as string) || (meta.modifiedby as string) || '') + '</P>\n';
    xml += '        <P Name="IsDerived" Class="char">' + ((meta.isderived as string) || '0') + '</P>\n';
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
