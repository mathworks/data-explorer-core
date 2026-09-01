// Copyright 2026 The MathWorks, Inc.
//
// Serialize a compressed-binary .sldd model back to zip bytes. `buildDataChunkXml`
// rebuilds the whole data/chunk0.xml (used by the save gate to validate the whole
// document); `serializeEntryToXml` builds ONE entry's <Object> fragment (used by the
// entry-level splice edit path). Untouched bytes are preserved by the splice caller,
// not here.

import { zipSync } from 'fflate';
import { escapeXml, matlabTimestampNow } from './XmlUtils.js';
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
    zipEntries['data/chunk0.xml'] = encoder.encode(xmlString);

    const zipped = zipSync(zipEntries, { level: 6 });
    return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
}

export function buildDataChunkXml(slddNode: SlddNode): string {
    const attrs = slddNode._dataSourceAttrs || { FormatVersion: '1', MinRelease: 'R2014a', Arch: '' };
    const archAttr = attrs.Arch ? ' Arch="' + attrs.Arch + '"' : '';
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<DataSource FormatVersion="' + attrs.FormatVersion + '" MinRelease="' + attrs.MinRelease + '"' + archAttr + '>\n';

    slddNode.children.forEach(function (section) {
        section.children.forEach(function (entryNode) {
            xml += serializeEntryToXml(entryNode as unknown as DataNode);
        });
    });

    // Referenced sub-dictionaries, if any, precede the dictionary object.
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

export function serializeEntryToXml(entryNode: DataNode): string {
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
    xml += '        <P Name="LastModBy" Class="char">' + escapeXml((meta.lastModifiedBy as string) || '') + '</P>\n';
    xml += '        <P Name="IsDerived" Class="char">' + ((meta.isderived as string) || '0') + '</P>\n';
    xml += entryNode.serializeXml('P', { Name: 'Value' }, 2) + '\n';
    xml += '    </Object>\n';
    return xml;
}
