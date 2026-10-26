// Copyright 2026 The MathWorks, Inc.

import BaseNode, { UNWORDED } from './BaseNode.js';

export interface TableColumnConfig {
  columns: string[];
  labels?: Record<string, string>;
}

export default class ContainerNode extends BaseNode {
  get isContainer(): boolean {
    return true;
  }

  get tableColumnConfig(): TableColumnConfig {
    return { columns: ['Name', 'Value', 'DataType', 'Status', 'UsedBy'] };
  }

  toRow(): null {
    return null;
  }

  // A dictionary, a section, a model, a .mat file or a project holds entries and has no
  // Value of its own, so it takes no editor there. Its displayValue is the blank BaseNode
  // gives, which BaseNode.valueEditable leaves editable for a node that can hold a value.
  // It takes no edit either: a container has no setProperty, which DataModel.editProperty
  // answers with a refusal.
  get valueEditable(): boolean {
    return false;
  }

  // A file or a section holds entries, which an Add of an entry makes (addEntry), not a child.
  _addChildRefusal(describe = true): string | null {
    return describe ? 'it holds entries, and takes an entry added, not a child' : UNWORDED;
  }

  // Of a child that is no entry (an entry is deleted by its container's execRemoveEntry): a
  // section, which every file of its kind has.
  _removeChildRefusal(_child?: BaseNode, describe = true): string | null {
    return describe ? 'it is a part of "' + this.name + '" that every file of its kind has' : UNWORDED;
  }

  flatten(): BaseNode[] {
    const result: BaseNode[] = [];
    const stack: BaseNode[] = [];
    for (let i = this.children.length - 1; i >= 0; i--) {
      stack.push(this.children[i]);
    }
    while (stack.length > 0) {
      const node = stack.pop()!;
      result.push(node);
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i]);
      }
    }
    return result;
  }
}
