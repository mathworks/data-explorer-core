// Copyright 2026 The MathWorks, Inc.
//
// A JSON object of no shape MATLAB writes, where a text dictionary holds a value: `{"foo": 1}`,
// `{}`, or a class marker left with no class, `{"_array_class": null, ...}` or
// `{"_object_class": null, ...}`. Only a hand edit leaves one. NodeClassMap.parseValue finds no
// shape in it and MatlabVariableNode.parseScalar holds it as it came, a scalar of no value
// (MatlabVariableNode._unshapedObject).
//
// It was shown as String() of it, `[object Object]`, which shows nothing that was read, with an
// editor and no warning. MATLAB (R2027a) opens the file and reads no value from it: a 1x0 double
// at an entry, the struct without the field at a struct field, a 0x0 char in a cell (measured on
// dictionaries generated from test/fixtures/typed_text.sldd). So it is shown as the JSON it holds,
// and the dictionary's warnings say so (the maintainer's group F ruling of 2026-10-18, theme 1:
// warn and show what was read). A text save writes it back as read; the XML writers refuse it.
//
// The node layer has no warnings sink, so the first one met and a count are recorded here, and
// SlddNode.parse, which builds each entry and holds the sink, takes the record before and after
// it, as it takes writtenSpelling's. The path is asked of the node when the record is taken, once
// the entry is built. Recorded outside a dictionary's read (a paste), the record holds that one
// node until the next read takes it, unreported.
import type { ParseWarning } from '../../parser/ParseWarning.js';

// A hand edit can leave an object of any size; the row and the warning show its start.
const SHOWN_MAX = 60;

/**
 * The JSON `value` is, cut at SHOWN_MAX characters. A value JSON cannot spell, which only a host
 * can hand in (a bigint in it), is named by its first keys. Never throws.
 */
export function unshapedText(value: object): string {
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    text = undefined;
  }
  if (text === undefined) {
    const keys = Object.keys(value);
    text = '{' + keys.slice(0, 5).map((k) => JSON.stringify(k)).join(', ') + (keys.length > 5 ? ', ...' : '') + '}';
  }
  return text.length > SHOWN_MAX ? text.slice(0, SHOWN_MAX) + '...' : text;
}

/** The first object recorded since the last take, the node holding it and its text, and how many there were. */
let first: { at: { readonly matlabPath: string }; text: string } | null = null;
let count = 0;

/** Record one object of no shape MATLAB writes, held by the node `at`. */
export function recordUnshapedValue(at: { readonly matlabPath: string }, value: object): void {
  if (count++ === 0) {
    first = { at, text: unshapedText(value) };
  }
}

/** What a warning names: how many, and the first one's path and text. */
export interface UnshapedValues {
  count: number;
  path: string;
  text: string;
}

/** The objects recorded since the last call, which clears them, or null if there were none. */
export function takeUnshapedValues(): UnshapedValues | null {
  const taken = first && { count, path: first.at.matlabPath, text: first.text };
  first = null;
  count = 0;
  return taken;
}

/** The one warning for entry `part` whose read recorded `taken`. */
export function unshapedValueWarning(part: string, taken: UnshapedValues): ParseWarning {
  const at = taken.path === part ? '' : ` at ${taken.path}`;
  const message = taken.count === 1
    ? `"${part}" holds ${taken.text}${at}, which is not a value MATLAB writes; it is shown as read.`
    : `"${part}" holds ${taken.count} values that are not values MATLAB writes; the first is ${taken.text}${at}, `
      + 'and each is shown as read.';
  return { code: 'part-unreadable', message, part };
}
