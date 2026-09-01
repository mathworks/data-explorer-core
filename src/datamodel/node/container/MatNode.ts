// Copyright 2026 The MathWorks, Inc.

import ContainerNode from '../ContainerNode.js';
import MatlabVariableNode from '../data/MatlabVariableNode.js';
import { decodeMcosObjects, modelOpaqueMcosVariable } from '../data/mcosTypedNode.js';
import type BaseNode from '../BaseNode.js';
import type { PropClass, PIGroupDef } from '../BaseNode.js';
import type { MatVariable } from '../data/MatlabVariableNode.js';
import PropName from '../../prop/PropName.js';

export default class MatNode extends ContainerNode {
  header: string;
  dirty: boolean;
  _anonymousElements: MatVariable[];

  constructor(name: string) {
    super(name, null);
    this.header = '';
    this.dirty = false;
    this._anonymousElements = [];
  }

  get displayName(): string {
    return this.name;
  }

  get readOnly(): boolean {
    return true;
  }

  get icon(): string {
    return 'matlabWorkspaceFile';
  }

  get NumberOfEntries(): number {
    return this.children.length;
  }

  getProperties(): PropClass[] {
    return [PropName];
  }

  getPILayout(): PIGroupDef[] {
    return [{ group: 'General', items: [PropName] }];
  }

  getSection(): null {
    return null;
  }

  execAddEntry(_className?: string, entryName?: string): { node: BaseNode; undo: () => void; redo: () => void } {
    const name = entryName || this._uniqueName('var');
    const node = MatlabVariableNode.createDefault(name, this);
    this.addChild(node);
    this.dirty = true;
    return {
      node,
      undo: () => {
        this.removeChild(node);
        this.dirty = true;
      },
      redo: () => {
        this.addChild(node);
        this.dirty = true;
      },
    };
  }

  _uniqueName(baseName: string): string {
    const names = new Set(this.children.map((c) => c.name));
    if (!names.has(baseName)) {
      return baseName;
    }
    let i = 1;
    while (names.has(baseName + i)) {
      i++;
    }
    return baseName + i;
  }

  execRemoveEntry(node: BaseNode): { undo: () => void; redo: () => void } | null {
    const index = this.children.indexOf(node);
    if (index < 0) {
      return null;
    }
    this.removeChild(node);
    this.dirty = true;
    return {
      undo: () => {
        this.addChild(node, index);
        this.dirty = true;
      },
      redo: () => {
        this.removeChild(node);
        this.dirty = true;
      },
    };
  }

  getVariables(): MatVariable[] {
    const variables: MatVariable[] = [];
    for (const child of this.children) {
      // Typed Simulink nodes (ParameterNode, SignalNode) have no `_var` — they
      // come from the read-only MCOS path and are never serialized back.
      const v = (child as unknown as { _var?: MatVariable })._var;
      if (v) {
        variables.push(v);
      }
    }
    for (const anon of this._anonymousElements) {
      variables.push(anon);
    }
    return variables;
  }

  static fromParsed(parsed: { header: string; variables: MatVariable[] }, filename: string): MatNode {
    const node = new MatNode(filename);
    node.header = parsed.header;

    // A .mat file keeps the MCOS blob in an anonymous trailing element.
    const anonElement = parsed.variables.find((v) => v._anonymous);
    const mcosData = decodeMcosObjects(anonElement?._rawBytes, parsed.variables);

    for (const variable of parsed.variables) {
      if ((variable as unknown as { _anonymous?: boolean })._anonymous) {
        node._anonymousElements.push(variable);
        continue;
      }
      if (variable.isOpaque) {
        const mcosNode = modelOpaqueMcosVariable(variable, mcosData?.get(variable.name), node);
        if (mcosNode) {
          node.addChild(mcosNode);
          continue;
        }
      }
      const child = MatlabVariableNode.parseMatVariable(variable, variable.name, node);
      node.addChild(child);
    }

    return node;
  }
}
