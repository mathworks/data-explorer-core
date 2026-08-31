// src/core/dto.ts
// Copyright 2026 The MathWorks, Inc.
//
// Serializable snapshots of live data-model nodes. In-process clients (GUI, VS Code)
// hold live nodes directly; out-of-process consumers (the `dex --json` agent path,
// a future TUI-over-ssh) need a flat, JSON-safe projection with no methods and no
// live parent/child object links. `toDTO` is that projection, used only at the edge.
function propsOf(node) {
    if (typeof node.getProperties !== 'function')
        return [];
    return node.getProperties().map((pc) => {
        const info = node.getPropInfo(pc);
        return {
            key: info.key,
            displayName: info.displayName,
            value: info.displayValue,
            editable: info.editable,
        };
    });
}
export function toDTO(node, opts = {}) {
    const depth = opts.depth ?? 0;
    const kids = Array.isArray(node.children) ? node.children : [];
    const dto = {
        id: node.id,
        name: node.name,
        displayName: node.displayName,
        kind: node.kind,
        className: node.className,
        icon: node.icon,
        isContainer: !!node.isContainer,
        isEntry: !!node.isEntry,
        childIds: kids.map((c) => c.id),
        props: propsOf(node),
    };
    // Source-level nodes carry path/dirty/sourceFormat; surface them on the DTO
    // so the machine contract (SourceDTO) is actually produced.
    const asSource = node;
    if (typeof asSource.dirty === 'boolean') {
        const sdto = dto;
        sdto.dirty = asSource.dirty;
        if (asSource.meta?.path)
            sdto.path = asSource.meta.path;
        if (asSource.sourceFormat)
            sdto.sourceFormat = asSource.sourceFormat;
    }
    if (depth > 0) {
        dto.children = kids.map((c) => toDTO(c, { depth: depth - 1 }));
    }
    return dto;
}
//# sourceMappingURL=dto.js.map