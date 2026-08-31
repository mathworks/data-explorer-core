// Copyright 2026 The MathWorks, Inc.
//
// Serialize a compressed-binary .sldd model back to zip bytes. `buildDataChunkXml`
// rebuilds the whole data/chunk0.xml (used by the save gate to validate the whole
// document); `serializeEntryToXml` builds ONE entry's <Object> fragment (used by the
// entry-level splice edit path). Untouched bytes are preserved by the splice caller,
// not here.
import { zipSync } from 'fflate';
import { escapeXml } from './XmlUtils.js';
export function serializeBinarySldd(slddNode) {
    const xmlString = buildDataChunkXml(slddNode);
    const encoder = new TextEncoder();
    const zipEntries = {};
    if (slddNode._zipMetadata) {
        for (const [name, data] of Object.entries(slddNode._zipMetadata)) {
            zipEntries[name] = data;
        }
    }
    zipEntries['data/chunk0.xml'] = encoder.encode(xmlString);
    const zipped = zipSync(zipEntries, { level: 6 });
    return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
}
export function buildDataChunkXml(slddNode) {
    const attrs = slddNode._dataSourceAttrs || { FormatVersion: '1', MinRelease: 'R2014a', Arch: '' };
    const archAttr = attrs.Arch ? ' Arch="' + attrs.Arch + '"' : '';
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<DataSource FormatVersion="' + attrs.FormatVersion + '" MinRelease="' + attrs.MinRelease + '"' + archAttr + '>\n';
    slddNode.children.forEach(function (section) {
        section.children.forEach(function (entryNode) {
            xml += serializeEntryToXml(entryNode);
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
export function serializeEntryToXml(entryNode) {
    const meta = entryNode.metadata || {};
    const lastMod = meta._rawLastMod || formatDateNow();
    let xml = '    <Object Class="DD.ENTRY">\n';
    xml += '        <P Name="Name" Class="char">' + escapeXml(entryNode.name) + '</P>\n';
    xml += '        <P Name="UUID" Class="char">' + (meta.uuid || '') + '</P>\n';
    xml += '        <P Name="Namespace" Class="char">' + (meta.namespace || '') + '</P>\n';
    xml += '        <P Name="LastMod" Class="char">' + lastMod + '</P>\n';
    xml += '        <P Name="LastModBy" Class="char">' + escapeXml(meta.lastModifiedBy || '') + '</P>\n';
    xml += '        <P Name="IsDerived" Class="char">' + (meta.isderived || '0') + '</P>\n';
    xml += entryNode.serializeXml('P', { Name: 'Value' }, 2) + '\n';
    xml += '    </Object>\n';
    return xml;
}
function formatDateNow() {
    return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '.000000');
}
//# sourceMappingURL=BinarySlddSerializer.js.map