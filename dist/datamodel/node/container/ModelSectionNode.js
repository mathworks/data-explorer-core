// Copyright 2026 The MathWorks, Inc.
import ContainerNode from '../ContainerNode.js';
import MatlabVariableNode from '../data/MatlabVariableNode.js';
import ModelBlockNode from '../data/ModelBlockNode.js';
import ConfigSetNode from '../data/ConfigSetNode.js';
import ConfigSetRefNode from '../data/ConfigSetRefNode.js';
import ModelReferenceNode from '../data/ModelReferenceNode.js';
import DataSourceNode from '../data/DataSourceNode.js';
export default class ModelSectionNode extends ContainerNode {
    constructor(name, parent, label, iconId) {
        super(name, parent);
        this.label = label;
        this.iconId = iconId;
    }
    get icon() {
        return this.iconId;
    }
    get displayName() {
        return this.label;
    }
    get tableColumnConfig() {
        switch (this.name) {
            case 'blocks':
                return { columns: ['Name', 'Value', 'DataType'], labels: { Value: 'Block Type', DataType: 'Uses' } };
            case 'workspace':
                return { columns: ['Name', 'Value', 'DataType', 'UsedBy'] };
            case 'config':
                return { columns: ['Name', 'Description'] };
            default:
                return { columns: ['Name', 'Value', 'DataType', 'UsedBy'] };
        }
    }
    addWorkspaceEntry(entry) {
        const node = MatlabVariableNode.parseMatVariable(entry, entry.name, this);
        this.addChild(node);
        return node;
    }
    addConfigSetEntry(cfg) {
        // The SLX config section uses the SAME node classes as the SLDD path
        // (ConfigSetNode / ConfigSetRefNode) so presentation is identical — empty,
        // non-editable Value and Data Type. The SLX-only "active" state is carried
        // on the shared node and surfaces through the icon, not a Value suffix.
        const objectClass = (cfg.data && cfg.data._object_class) === 'Simulink.ConfigSetRef'
            ? 'Simulink.ConfigSetRef'
            : 'Simulink.ConfigSet';
        const rawVal = {
            _array_class: objectClass,
            _array_type: 'MATLABArray',
            _dimensions: [1, 1],
            _mw_element_type: 'MATLABArray',
            _elements: [{ _properties: { Name: cfg.name } }],
        };
        const node = objectClass === 'Simulink.ConfigSetRef'
            ? ConfigSetRefNode.parse(rawVal, cfg.name, this)
            : ConfigSetNode.parse(rawVal, cfg.name, this);
        node.active = cfg.active;
        this.addChild(node);
        return node;
    }
    // A model file names its references WITHOUT an extension, but the entry has to be
    // a filename: it doubles as the link target used to jump to that model once it is
    // loaded. `defaultExt` is the parent model's own extension, because a reference is
    // far likelier to be the same generation of file as the model referencing it — a
    // legacy `.mdl` hierarchy is legacy throughout — and a `.mdl` model whose children
    // were all labelled `.slx` would link to nothing.
    addReferenceEntry(ref, defaultExt = '.slx') {
        const named = /\.(slx|mdl)$/i.test(ref.modelName);
        const node = new ModelReferenceNode(named ? ref.modelName : ref.modelName + defaultExt, this, ref.blockPath);
        this.addChild(node);
        return node;
    }
    addBlockEntry(blockName, blockType, paramUsages, modelSrcId, paramSourceId) {
        const node = new ModelBlockNode(blockName, this, blockType, paramUsages, modelSrcId, paramSourceId);
        this.addChild(node);
        return node;
    }
    addDataSourceEntry(path) {
        const filename = path.split('/').pop();
        const node = new DataSourceNode(filename, this, path);
        this.addChild(node);
        return node;
    }
}
//# sourceMappingURL=ModelSectionNode.js.map