// Copyright 2026 The MathWorks, Inc.
//
// Loads the MATLAB-authored corpus and the artifacts it describes. One place, so
// the parity suites cannot drift apart in how they find a node.
//
// The truth JSON is written by gen_truth.m (Phase 2) and is the ONLY source of
// expected values. Nothing here reads the data model.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadFile, flatten, findEntry } from '../loadFile.js';

export { flatten, findEntry as entry };

const ARTIFACTS = fileURLToPath(new URL('../artifacts/', import.meta.url));

// These names mirror gen_truth.m's truthOf() and propTruth() EXACTLY — MATLAB's
// jsonencode uses the struct's field names verbatim, so a rename on either side
// silently breaks the other.
export interface PropTruth {
  class: string;
  size: number[];
  numel: number;
  isempty: boolean;
  disp: string;
  mat2str?: string;
  mat2str_error?: string;
}

export interface VarTruth {
  name: string;
  class: string;
  size: number[];
  numel: number;
  iscomplex: boolean;
  islogical: boolean;
  isobject: boolean;
  isempty: boolean;
  disp: string;
  /** absent for rank >= 3 — mat2str errors there, and that error is the point */
  mat2str?: string;
  mat2str_error?: string;
  /** present only when 1 < numel <= 64; MATLAB's own column-major order */
  linearSubs?: string[];
  /**
   * MATLAB's COMMAND WINDOW text per element (formattedDisplayText). NOT the table
   * cell convention: it prints `1` for a logical, `1.0000 + 2.0000i` for a complex,
   * `3     4` for [3 4] and unquoted text for a string. Use linearElems to check a
   * cell; this is here because it is what MATLAB shows at the prompt.
   */
  linearValues?: string[];
  /**
   * Per-element truth, measured on the value the element ROW displays — the cell
   * content for a cell, `.Value` for a Simulink data object, the 1x1 struct itself
   * for a struct array. Same fields as this interface, so an element goes through
   * the same expectedDisplay() as an entry.
   */
  linearElems?: VarTruth[];
  properties?: Record<string, PropTruth | { error: string }>;
}

export interface Truth {
  vars: Record<string, VarTruth>;
  /** object arrays. `.mat` ONLY — both .sldd formats and the .slx model workspace refuse them. */
  objArr: Record<string, VarTruth>;
  notes: {
    /** per format ('text' | 'binary') -> per entry -> 'ACCEPTED' or MATLAB's message */
    slddRejected: Record<string, Record<string, string>>;
    /** ONE level: per entry -> 'ACCEPTED' or MATLAB's message. Not per format — there is one .slx. */
    slxRejected: Record<string, string>;
  };
}

export function truth(): Truth {
  return JSON.parse(readFileSync(ARTIFACTS + 'truth.json', 'utf8')) as Truth;
}

export type Artifact = 'sldd-text' | 'sldd-binary' | 'slx' | 'mat';

const FILES: Record<Artifact, string> = {
  'sldd-text': 'text/cases.sldd',
  'sldd-binary': 'binary/cases.sldd',
  slx: 'slx/cases.slx',
  mat: 'mat/cases.mat',
};

/** Every artifact the corpus defines, in the order the suites report them. */
export const ARTIFACT_KINDS: Artifact[] = ['sldd-text', 'sldd-binary', 'slx', 'mat'];

/** True when the generator produced this artifact — a suite skips rather than fails. */
export function hasArtifact(a: Artifact): boolean {
  return existsSync(ARTIFACTS + FILES[a]);
}

/**
 * Load a corpus artifact and return its root node. `loadFile` resolves relative
 * to test/parity/, hence the './artifacts/…' prefix; it goes through `ingest`, so
 * format sniffing is under test too. The basename carries the real extension,
 * which is what `ingest` dispatches on.
 */
export function loadArtifact(a: Artifact): any {
  return loadFile('./artifacts/' + FILES[a]);
}

/**
 * MATLAB's own verdict on whether this artifact could hold this entry at all.
 * 'ACCEPTED', or the message MATLAB raised. Undefined when the generator never
 * tried, which for `.mat` is every entry — a `.mat` refuses nothing.
 */
export function verdict(t: Truth, a: Artifact, name: string): string | undefined {
  if (a === 'slx') { return t.notes.slxRejected[name]; }
  if (a === 'sldd-text') { return t.notes.slddRejected.text?.[name]; }
  if (a === 'sldd-binary') { return t.notes.slddRejected.binary?.[name]; }
  return undefined;
}

/** True when MATLAB itself refused to put this entry in this artifact. */
export function refused(t: Truth, a: Artifact, name: string): boolean {
  const v = verdict(t, a, name);
  return v !== undefined && v !== 'ACCEPTED';
}

/** Element rows of a container, keyed by their subscript label. */
export function elementsByLabel(node: any): Map<string, any> {
  return new Map((node.children || []).map((c: any) => [c.displayName, c]));
}

/** Child rows of a container, keyed by `name` — property rows, not elements. */
export function childrenByName(node: any): Map<string, any> {
  return new Map((node.children || []).map((c: any) => [c.name, c]));
}

/**
 * The node's PROPERTY surface, which is the Property Inspector — not its child
 * rows. An object's properties are not tree children: `aParam` has no children at
 * all, and `aBus`'s children are its bus ELEMENTS. `toPIObject()` is the accessor,
 * and it returns two kinds of entry:
 *
 *   - a curated/schema group prop, keyed by its own key ('Value', 'dimensions')
 *   - the "Other" catch-all, keyed 'Other.<raw path>' ('Other.CoderInfo.StorageClass')
 *
 * Both are flattened here into `path -> text`, with the 'Other.' prefix dropped, so
 * a caller sees one namespace. Empty when the node has no PI layout at all.
 */
export function piProperties(node: any): Map<string, string> {
  const pi = node.toPIObject?.();
  const out = new Map<string, string>();
  if (!pi) { return out; }
  for (const [k, v] of Object.entries(pi.objects[0] as Record<string, unknown>)) {
    if (k === '_id') { continue; }
    out.set(k.startsWith('Other.') ? k.slice(6) : k, String(v));
  }
  return out;
}

/**
 * The PI entry for a property MATLAB calls `prop`, or undefined.
 *
 * Matched case-insensitively on the LAST path segment, because the PI keys a prop
 * by its own lowercase-initial key ('dimensions' for MATLAB's `Dimensions`) and
 * keys a nested sub-property by its full raw path ('CoderInfo.StorageClass'). The
 * case fold is deliberate and narrow: it is the one difference between an internal
 * prop key and MATLAB's property name, and the user-facing label (`displayName`)
 * already carries MATLAB's own capitalization.
 */
export function piLookup(props: Map<string, string>, prop: string): { path: string; text: string } | undefined {
  const want = prop.toLowerCase();
  for (const [path, text] of props) {
    const leaf = path.slice(path.lastIndexOf('.') + 1);
    if (leaf.toLowerCase() === want) { return { path, text }; }
  }
  return undefined;
}
