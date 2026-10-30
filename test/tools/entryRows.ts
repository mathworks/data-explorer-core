// Copyright 2026 The MathWorks, Inc.
//
// The rows a table builds of a dictionary's model, as far as core holds them, for the narrow === wide
// comparisons ported from data-explorer-vscode's host tests (step 6a C3). There a "row" is
// data-explorer-view's (buildRows / buildEntryRows), which core does not have: view builds each row
// from the node's own toRow() and stamps it with what the table knows (the entry's Status from its
// own baseline, clip marks, capability flags) and the dictionary's metadata columns. So here a row is
// the node's toRow(), with Status taken off (a baseline the table keeps, not the node: vscode's
// slddBaseline) and the entry's Last Modified and Modified By put on, in the order a table lists
// them: each entry, then its subtree depth first.

type Any = any;

const plain = (x: unknown) => JSON.parse(JSON.stringify(x));

/** One entry's rows: its own, then its subtree's, depth first. */
export function rowsOfEntry(entry: Any): Any[] {
  const out: Any[] = [];
  const walk = (node: Any) => {
    let row: Any;
    try {
      row = node.toRow?.();
    } catch (err) {
      row = { ID: node.id, threw: String((err as Error)?.message ?? err) };
    }
    if (row) {
      const copy = plain(row);
      delete copy.Status;
      if (node === entry) {
        copy.lastModified = entry.lastModified;
        copy.lastModifiedBy = entry.lastModifiedBy;
      }
      out.push(copy);
    }
    for (const child of (node.children ?? []) as Any[]) walk(child);
  };
  walk(entry);
  return out;
}

/** Every row of a dictionary: each section's header (by its name), then its entries' rows. */
export function rowsOf(root: Any): Any[] {
  const out: Any[] = [];
  for (const section of (root?.children ?? []) as Any[]) {
    out.push({ ID: `section:${section.name}` });
    for (const entry of (section.children ?? []) as Any[]) out.push(...rowsOfEntry(entry));
  }
  return out;
}

/** Each entry's serialize(), by id: what a save would write of it. */
export function recordsOf(root: Any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const section of (root?.children ?? []) as Any[]) {
    for (const entry of (section.children ?? []) as Any[]) {
      try {
        out[entry.id] = plain(entry.serialize());
      } catch (err) {
        out[entry.id] = { threw: String((err as Error)?.message ?? err) };
      }
    }
  }
  return out;
}
