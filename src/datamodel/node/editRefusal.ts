// Copyright 2026 The MathWorks, Inc.

import { propNamed } from './BaseNode.js';
import type { PropClass } from './BaseNode.js';

/** What editRefusalText reads of the node an edit was made at. */
export interface EditedRow {
  name: string;
  readonly matlabPath?: string;
  getProperties?(): PropClass[];
}

// A refusal that names its row already: `Cannot <verb ...> "<row>"`, as `Cannot edit "s": ...`,
// `Cannot add a field to "s": ...`, `Cannot edit the Value of "s": ...` (session.valueEditRefusal),
// `Cannot paste "a" into "f.mat": ...`. Not MATLAB's own words that start so and name no row:
// "Cannot set Alignment when StorageClass is 'Auto'."
const NAMES_A_ROW = /^Cannot (?:[A-Za-z]+ )+"[^"]+"/;

/**
 * A refusal of an edit of `key` at `node` as a host shows it, naming the row: `reason` itself where
 * it names one already (NAMES_A_ROW), and otherwise `Cannot edit "<row>": <reason>.`, or
 * `Cannot rename "<row>": <reason>.` for its Name, the row its MATLAB path (an entry's name), the
 * reason's own words with one full stop at its end. session.editProperty answers every refusal so;
 * this is for a host that calls a node's setProperty itself, as a dictionary's editor does.
 *
 * Most setters say why and not where: "Invalid MATLAB expression", "Minimum must be a finite real
 * double scalar value", "'x' already exists in values.mat". Shown so, they named no row, and the
 * sweep of the edits a user can make found 6,700 such refusals.
 */
export function editRefusalText(node: EditedRow, key: string, reason: string): string {
  const said = reason.trim();
  if (NAMES_A_ROW.test(said)) {
    return said;
  }
  // Its closing full stops (and the space between them) dropped, one by one: a pattern anchored at
  // the end only is tried from every place in the text, which is slow on a long run of spaces.
  let end = said.length;
  while (end > 0 && (said[end - 1] === '.' || said[end - 1].trim() === '')) {
    end--;
  }
  const body = said.slice(0, end);
  const verb = isNameKey(node, key) ? 'rename' : 'edit';
  return `Cannot ${verb} "${node.matlabPath || node.name}": ${body}${/[!?]$/.test(body) ? '' : '.'}`;
}

/** Whether `key` names the node's Name, by its key or its column, as session.editProperty reads one. */
export function isNameKey(node: EditedRow, key: string): boolean {
  if (key === 'Name') {
    return true;
  }
  try {
    return propNamed(node.getProperties?.() ?? [], key)?.key === 'Name';
  } catch {
    return false;
  }
}
