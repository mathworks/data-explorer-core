// src/datamodel/parser/EntryMerge.ts
// Copyright 2026 The MathWorks, Inc.
//
// AN EDITED ENTRY KEEPS THE BYTES OF WHAT THE EDIT DID NOT TOUCH.
//
// A save writes an entry nobody edited as the bytes it was read from (EntrySource). An edited one
// was written whole from the model, so renaming an entry respelled every value in it that the
// writers spell otherwise than MATLAB did: an untouched `1.0NaNi` came back as `1.0+NaNi`, a cell's
// open tag gained a Dimension, a bus's untouched elements were all rewritten. Here an edited entry
// is written as the bytes it was read from, with only the parts the model changed written from the
// model (the maintainer's rulings D1-D3, 2026-10-13).
//
// What changed is found by comparing two writes of the entry, never by comparing the model with
// the bytes. Three texts, all of the one entry:
//
//   O  the bytes it was read from (EntrySource);
//   B  the writers' text for O as the reader reads it: O read again on its own (readEntryFragment)
//      and written from that model;
//   C  the writers' text for the entry as the model now holds it.
//
// Where B and C are the same text, the model says there what it said when the entry was read, and
// O's bytes are written. Where they differ, the model changed something there, and the part is
// written from C, or, where B and C are both elements with element children and the same open tag
// but for its Dimension, the same question is asked of each child. The children are paired as the
// reader reads them:
//
//   - a `<P>` or `<Field>` by its Name (an unnamed `<P>` by its Source, the saveobj envelope's):
//     one in B and not in C was deleted, one in C and not in B was added, after the one before it
//     in C, and one in O alone, which the reader does not read, is kept as it is (D13);
//   - an `<Element>` by its ORIGIN, never by its position (D1): the index among its parent's
//     elements in O of the element the model read it from, which the writers spell while a merge
//     asks for it (EntrySource.ORIGIN_ATTR) and which is removed from what is written. One in C
//     with none is an added element, written from C. The one element of a scalar value, which
//     neither B nor C gives an origin, is that value's own.
//
// Anything this cannot pair with certainty is written from C: a parent with a duplicate Name, an
// element whose origins are missing in B or repeated in C, a parent whose children are of both
// kinds, text beside its children, a comment, or markup the scan cannot account for. And every
// merge is checked before it is used: it must hold no origin (mergeEntry), and read again it must
// give the model's own text, C (BinarySlddSerializer). Otherwise the entry is written from C
// whole, as every edited entry was.
//
// So an edit then its undo writes O with only the LastMod line new (D2: the undo stamps it), and
// an untouched `1.0NaNi` in an edited entry is kept, an edited one written `1.0+NaNi` (D3). An
// edited entry read with no LastMod line gains the model's, as every edit stamps one: the writers'
// LastMod for bytes with none is the time it was written, which no comparison of B and C can read
// an edit from.

import { parseBinarySlddParts } from './BinarySlddParser.js';
import { inLayout, type ChunkLayout } from './ChunkLayout.js';
import { ORIGIN_ATTR, type EntrySource } from './EntrySource.js';
import type SectionNode from '../node/container/SectionNode.js';
import type DataNode from '../node/DataNode.js';
import type { SystemComposerCatalog } from './ScCatalog.js';
import type { ParseWarning } from './ParseWarning.js';

// ---- the scan -----------------------------------------------------------------------------

/** One attribute of a scanned tag: its name, and its value as the bytes spell it. */
export interface ScannedAttr {
  readonly name: string;
  readonly value: string;
}

/** One element of a scanned fragment, by where it sits in the text it was scanned from. */
export interface ScannedElement {
  readonly tag: string;
  readonly attrs: readonly ScannedAttr[];
  /** The `<` of its open tag. */
  readonly start: number;
  /** Just past its open tag. */
  readonly openEnd: number;
  /** The `<` of its close tag; `openEnd` for a self-closed one. */
  readonly closeStart: number;
  /** Just past its close tag. */
  readonly end: number;
  readonly children: readonly ScannedElement[];
  /**
   * Its content is more than its child elements and whitespace: text beside a child, a comment
   * or a CDATA section. Such an element is written whole, its bytes or the model's.
   */
  readonly opaque: boolean;
}

interface Building {
  tag: string;
  attrs: ScannedAttr[];
  start: number;
  openEnd: number;
  closeStart: number;
  end: number;
  children: Building[];
  text: boolean;
  special: boolean;
}

const LT = 0x3c;
const GT = 0x3e;
const SLASH = 0x2f;
const BANG = 0x21;
const QUESTION = 0x3f;
const EQUALS = 0x3d;
const QUOTE = 0x22;
const APOS = 0x27;

function isSpace(c: number): boolean {
  return c === 0x20 || c === 0x0a || c === 0x09 || c === 0x0d;
}

// The ASCII part of XML's name characters, which is every name a dictionary uses, as the chunk's
// own scan (BinarySlddParser.entrySpans) reads them.
function isNameStart(c: number): boolean {
  return (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a) || c === 0x5f || c === 0x3a;
}

function isNameChar(c: number): boolean {
  return isNameStart(c) || (c >= 0x30 && c <= 0x39) || c === 0x2d || c === 0x2e;
}

function onlySpace(xml: string, from: number, to: number): boolean {
  for (let i = from; i < to; i++) {
    if (!isSpace(xml.charCodeAt(i))) {
      return false;
    }
  }
  return true;
}

/**
 * The element tree of the one element `xml` holds from `from` to `to` (whitespace around it
 * allowed), read as XML reads it: comments and CDATA sections skipped to their ends, each tag read
 * attribute by attribute with each value skipped to its closing quote, every element closed by
 * name. Null for anything this cannot vouch for: a processing instruction, a DOCTYPE or any other
 * `<!`, a `<` that starts no tag, an attribute that is not a name, `=` and a quoted value, a close
 * tag that does not close the element open, text outside the element, or more than one element.
 * Linear in the length of the text.
 */
export function scanEntryTree(xml: string, from = 0, to = xml.length): ScannedElement | null {
  const stack: Building[] = [];
  let root: Building | null = null;
  let pos = from;
  for (;;) {
    let lt = xml.indexOf('<', pos);
    if (lt < 0 || lt >= to) {
      lt = to;
    }
    if (lt > pos && !onlySpace(xml, pos, lt)) {
      if (stack.length === 0) {
        return null;
      }
      stack[stack.length - 1].text = true;
    }
    if (lt >= to) {
      break;
    }
    const c = xml.charCodeAt(lt + 1);
    if (c === SLASH) {
      let k = lt + 2;
      while (k < to && isNameChar(xml.charCodeAt(k))) k++;
      const name = xml.substring(lt + 2, k);
      while (k < to && isSpace(xml.charCodeAt(k))) k++;
      const open = stack[stack.length - 1];
      if (!open || xml.charCodeAt(k) !== GT || k >= to || name !== open.tag) {
        return null;
      }
      open.closeStart = lt;
      open.end = k + 1;
      stack.pop();
      pos = k + 1;
      continue;
    }
    if (c === BANG) {
      const comment = xml.startsWith('!--', lt + 1);
      const cdata = !comment && xml.startsWith('![CDATA[', lt + 1);
      const end = comment ? xml.indexOf('-->', lt + 4) : cdata ? xml.indexOf(']]>', lt + 9) : -1;
      if (end < 0 || end + 3 > to || stack.length === 0) {
        return null;
      }
      stack[stack.length - 1].special = true;
      pos = end + 3;
      continue;
    }
    if (c === QUESTION || !isNameStart(c)) {
      return null;
    }
    let k = lt + 1;
    while (k < to && isNameChar(xml.charCodeAt(k))) k++;
    const tag = xml.substring(lt + 1, k);
    const attrs: ScannedAttr[] = [];
    let ch = xml.charCodeAt(k);
    for (;;) {
      const gap = k;
      while (k < to && isSpace(ch)) ch = xml.charCodeAt(++k);
      if (k >= to) {
        return null;
      }
      if (ch === GT || ch === SLASH) {
        break;
      }
      if (k === gap || !isNameStart(ch)) {
        return null;
      }
      const nameAt = k;
      while (k < to && isNameChar(xml.charCodeAt(k))) k++;
      const name = xml.substring(nameAt, k);
      ch = xml.charCodeAt(k);
      while (k < to && isSpace(ch)) ch = xml.charCodeAt(++k);
      if (ch !== EQUALS) {
        return null;
      }
      ch = xml.charCodeAt(++k);
      while (k < to && isSpace(ch)) ch = xml.charCodeAt(++k);
      if (ch !== QUOTE && ch !== APOS) {
        return null;
      }
      const close = xml.indexOf(ch === QUOTE ? '"' : "'", k + 1);
      if (close < 0 || close >= to) {
        return null;
      }
      attrs.push({ name, value: xml.substring(k + 1, close) });
      k = close + 1;
      ch = xml.charCodeAt(k);
    }
    const selfClosed = ch === SLASH;
    if (selfClosed && (k + 1 >= to || xml.charCodeAt(++k) !== GT)) {
      return null;
    }
    const element: Building = {
      tag, attrs, start: lt, openEnd: k + 1, closeStart: k + 1, end: k + 1, children: [], text: false, special: false,
    };
    if (stack.length === 0) {
      if (root !== null) {
        return null;
      }
      root = element;
    } else {
      stack[stack.length - 1].children.push(element);
    }
    if (!selfClosed) {
      stack.push(element);
    }
    pos = k + 1;
  }
  if (root === null || stack.length > 0) {
    return null;
  }
  return finish(root);
}

function finish(b: Building): ScannedElement {
  const children = b.children.map(finish);
  return {
    tag: b.tag,
    attrs: b.attrs,
    start: b.start,
    openEnd: b.openEnd,
    closeStart: b.closeStart,
    end: b.end,
    children,
    opaque: b.special || (b.text && children.length > 0),
  };
}

// An attribute's value as XML reads it: its references decoded. Null where it holds an `&` that
// is not a reference, which no key is then read from.
function decoded(value: string): string | null {
  if (value.indexOf('&') < 0) {
    return value;
  }
  let bad = false;
  const out = value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);|&/g, (m: string, ref: string | undefined) => {
    if (ref === undefined) {
      bad = true;
      return m;
    }
    switch (ref) {
      case 'lt': return '<';
      case 'gt': return '>';
      case 'amp': return '&';
      case 'quot': return '"';
      case 'apos': return "'";
    }
    if (ref.charAt(0) !== '#') {
      bad = true;
      return m;
    }
    const code = ref.charAt(1) === 'x' ? parseInt(ref.substring(2), 16) : parseInt(ref.substring(1), 10);
    if (!(code >= 0 && code <= 0x10ffff)) {
      bad = true;
      return m;
    }
    return String.fromCodePoint(code);
  });
  return bad ? null : out;
}

// The one attribute of that name, decoded; undefined where there is none, null where there is
// more than one or it does not decode.
function attrOf(e: ScannedElement, name: string): string | null | undefined {
  let found: string | undefined;
  for (const a of e.attrs) {
    if (a.name === name) {
      if (found !== undefined) {
        return null;
      }
      found = a.value;
    }
  }
  return found === undefined ? undefined : decoded(found);
}

// ---- the merge ----------------------------------------------------------------------------

/** One of the three texts, and the tree of the entry in it. */
interface Side {
  readonly xml: string;
  readonly root: ScannedElement;
}

const ORIGIN_ATTRS = new RegExp(' ' + ORIGIN_ATTR + '="[0-9]+"', 'g');

/** `xml` with every origin the writers spelled removed. */
export function stripOrigins(xml: string): string {
  return xml.indexOf(ORIGIN_ATTR) < 0 ? xml : xml.replace(ORIGIN_ATTRS, '');
}

const text = (side: Side, e: ScannedElement): string => side.xml.substring(e.start, e.end);

// A child's key among its siblings: a <P> by its Name, the saveobj envelope by its Source, a
// <Field> by its Name. Null for anything else, and for a name that does not decode.
function keyOf(e: ScannedElement): string | null {
  if (e.tag === 'P') {
    const name = attrOf(e, 'Name');
    if (name !== undefined) {
      return name === null ? null : 'P\u0000' + name;
    }
    const source = attrOf(e, 'Source');
    return source === undefined || source === null ? null : 'S\u0000' + source;
  }
  if (e.tag === 'Field') {
    const name = attrOf(e, 'Name');
    return name === undefined || name === null ? null : 'F\u0000' + name;
  }
  return null;
}

// An element's origin, as the writers spelled it: undefined for none, NaN for one that is not one.
function originAttrOf(e: ScannedElement): number | undefined {
  const value = attrOf(e, ORIGIN_ATTR);
  if (value === undefined) {
    return undefined;
  }
  return value !== null && /^[0-9]+$/.test(value) ? Number(value) : NaN;
}

// The attributes of an open tag but its Dimension and its origin, as a comparable string.
function attrsBeyondDimension(e: ScannedElement): string {
  const kept = e.attrs.filter((a) => a.name !== 'Dimension' && a.name !== ORIGIN_ATTR);
  return JSON.stringify(kept.map((a) => [a.name, a.value]));
}

const LAST_MOD = 'P\u0000LastMod';

interface Piece {
  readonly key: string | null;
  readonly lead: string;
  readonly text: string;
}

class Merge {
  constructor(readonly o: Side, readonly b: Side, readonly c: Side, readonly layout: ChunkLayout | null) {}

  // C's text for one of its elements, laid out as the file is.
  written(e: ScannedElement): string {
    const own = stripOrigins(text(this.c, e));
    return this.layout ? inLayout(own, this.layout) : own;
  }

  node(o: ScannedElement, b: ScannedElement, c: ScannedElement, top = false): string {
    if (text(this.b, b) === text(this.c, c)) {
      return text(this.o, o);
    }
    if (this.recursable(o, b, c)) {
      const merged = this.children(o, b, c, top);
      if (merged !== null) {
        return merged;
      }
    }
    return this.written(c);
  }

  recursable(o: ScannedElement, b: ScannedElement, c: ScannedElement): boolean {
    return o.children.length > 0 && b.children.length > 0 && c.children.length > 0
      && !o.opaque && !b.opaque && !c.opaque
      && o.tag === b.tag && b.tag === c.tag
      && attrsBeyondDimension(b) === attrsBeyondDimension(c);
  }

  children(o: ScannedElement, b: ScannedElement, c: ScannedElement, top: boolean): string | null {
    const kind = (e: ScannedElement): string => {
      const elements = e.children.filter((k) => k.tag === 'Element').length;
      return elements === 0 ? 'keyed' : elements === e.children.length ? 'elements' : 'mixed';
    };
    const k = kind(o);
    if (k === 'mixed' || kind(b) !== k || kind(c) !== k) {
      return null;
    }
    const leads = o.children.map((child, i) => this.o.xml.substring(i === 0 ? o.openEnd : o.children[i - 1].end, child.start));
    const pieces = k === 'keyed' ? this.keyed(o, b, c, leads, top) : this.elements(o, b, c, leads);
    if (pieces === null) {
      return null;
    }
    const sameOpen = this.b.xml.substring(b.start, b.openEnd) === this.c.xml.substring(c.start, c.openEnd);
    const open = sameOpen ? this.o.xml.substring(o.start, o.openEnd) : stripOrigins(this.c.xml.substring(c.start, c.openEnd));
    let out = open;
    for (const piece of pieces) {
      out += piece.lead + piece.text;
    }
    return out + this.o.xml.substring(o.children[o.children.length - 1].end, o.end);
  }

  keyed(o: ScannedElement, b: ScannedElement, c: ScannedElement, leads: string[], top: boolean): Piece[] | null {
    const index = (e: ScannedElement): Map<string, ScannedElement> | null => {
      const map = new Map<string, ScannedElement>();
      for (const child of e.children) {
        const key = keyOf(child);
        if (key === null || map.has(key)) {
          return null;
        }
        map.set(key, child);
      }
      return map;
    };
    const om = index(o);
    const bm = index(b);
    const cm = index(c);
    if (!om || !bm || !cm) {
      return null;
    }
    const out: Piece[] = [];
    o.children.forEach((oc, i) => {
      const key = keyOf(oc)!;
      const bc = bm.get(key);
      const cc = cm.get(key);
      if (bc && cc) {
        out.push({ key, lead: leads[i], text: this.node(oc, bc, cc) });
      } else if (!bc && cc) {
        // Not read from O, and written by the model now: the model's.
        out.push({ key, lead: leads[i], text: this.written(cc) });
      } else if (!bc) {
        // Not read from O at all, and so not the model's to change: kept as it is (D13).
        out.push({ key, lead: leads[i], text: text(this.o, oc) });
      }
      // In B and not in C: deleted.
    });
    // Added: in C and not in O. One the writers write for O too, as they write it now, is theirs
    // and not the edit's; but for the entry's LastMod, which the writers stamp with the time when
    // the bytes have none, and which an edit stamps (D2): an edited entry read with no LastMod
    // line is written with the model's.
    const at = new Map<string, number>();
    c.children.forEach((cc, j) => {
      const key = keyOf(cc)!;
      if (om.has(key)) {
        return;
      }
      const bc = bm.get(key);
      if (bc && text(this.b, bc) === text(this.c, cc) && !(top && key === LAST_MOD)) {
        return;
      }
      // After the one before it in C that is written, or first.
      at.clear();
      out.forEach((piece, n) => at.set(piece.key!, n));
      let place = 0;
      for (let p = j - 1; p >= 0; p--) {
        const n = at.get(keyOf(c.children[p])!);
        if (n !== undefined) {
          place = n + 1;
          break;
        }
      }
      const lead = out.length === 0 ? leads[0] : out[Math.max(place - 1, 0)].lead;
      out.splice(place, 0, { key, lead, text: this.written(cc) });
    });
    return out;
  }

  elements(o: ScannedElement, b: ScannedElement, c: ScannedElement, leads: string[]): Piece[] | null {
    const bOrigins = b.children.map(originAttrOf);
    const cOrigins = c.children.map(originAttrOf);
    if (bOrigins.every((x) => x === undefined) && cOrigins.every((x) => x === undefined)) {
      // A scalar value's one element, which is the value's own.
      if (o.children.length === 1 && b.children.length === 1 && c.children.length === 1) {
        return [{ key: null, lead: leads[0], text: this.node(o.children[0], b.children[0], c.children[0]) }];
      }
      return null;
    }
    // B is O read: each of O's elements, once, in O's order.
    if (b.children.length !== o.children.length || bOrigins.some((x, j) => x !== j)) {
      return null;
    }
    const seen = new Set<number>();
    for (const x of cOrigins) {
      if (x !== undefined && (!(x >= 0 && x < o.children.length) || seen.has(x))) {
        return null;
      }
      if (x !== undefined) {
        seen.add(x);
      }
    }
    return c.children.map((cc, k) => {
      const j = cOrigins[k];
      const lead = leads[Math.min(k, leads.length - 1)];
      return { key: null, lead, text: j === undefined ? this.written(cc) : this.node(o.children[j], b.children[j], cc) };
    });
  }
}

/**
 * The entry `<Object>…</Object>` merged from O (the bytes it was read from), B (the writers' text
 * for O as read) and C (the writers' text for the model), the parts written from C laid out in
 * `layout`; null where the three cannot be merged with certainty. B and C are as the writers
 * write them, origins and all; what is returned holds none.
 */
export function mergeEntry(fragmentO: string, textB: string, textC: string, layout: ChunkLayout | null): string | null {
  const o = scanEntryTree(fragmentO);
  const b = scanEntryTree(textB);
  const c = scanEntryTree(textC);
  if (!o || !b || !c || o.tag !== 'Object' || b.tag !== 'Object' || c.tag !== 'Object') {
    return null;
  }
  const merged = new Merge({ xml: fragmentO, root: o }, { xml: textB, root: b }, { xml: textC, root: c }, layout).node(o, b, c, true);
  return merged.indexOf(ORIGIN_ATTR) >= 0 ? null : merged;
}

// ---- what a merge must have kept ----------------------------------------------------------

// A path to a child, as keptPartsViolations names it.
function step(path: string, e: ScannedElement, origin?: number): string {
  const at = path === '' ? '' : path + '/';
  if (e.tag === 'Element') {
    return at + 'Element[' + (origin ?? 0) + ']';
  }
  const key = keyOf(e);
  return at + e.tag + '[' + (key === null ? '?' : key.substring(2)) + ']';
}

/**
 * Where `written`, the text written for an edited entry, changes a part of O that the edit did
 * not change: every child whose bytes differ from O's must be one where B and C differ too, and a
 * child the reader does not read must be O's as it is (D13). Paired as the merge pairs them, by
 * Name and by origin, and read with the scan alone, never the reader, since a reader and a writer
 * can lose the same thing. The entry's Name and LastMod lines may differ anywhere. Null when O, B
 * or C does not scan, which leaves nothing to hold `written` to.
 */
export function keptPartsOf(fragmentO: string, textB: string, textC: string, written: string): string[] | null {
  const o = scanEntryTree(fragmentO);
  const b = scanEntryTree(textB);
  const c = scanEntryTree(textC);
  if (!o || !b || !c) {
    return null;
  }
  const w = scanEntryTree(written);
  if (!w) {
    return ['the entry as written is not one element the scan can read'];
  }
  const sides = { o: { xml: fragmentO, root: o }, b: { xml: textB, root: b }, c: { xml: textC, root: c }, w: { xml: written, root: w } };
  const merge = new Merge(sides.o, sides.b, sides.c, null);
  const out: string[] = [];
  const walk = (oe: ScannedElement, be: ScannedElement, ce: ScannedElement, we: ScannedElement, path: string, top: boolean): void => {
    if (text(sides.o, oe) === text(sides.w, we)) {
      return;
    }
    if (text(sides.b, be) === text(sides.c, ce)) {
      out.push(path === '' ? 'the entry' : path);
      return;
    }
    if (!merge.recursable(oe, be, ce) || we.children.length === 0 || we.opaque) {
      return;
    }
    // The open tag too, where the model did not change it.
    if (sides.b.xml.substring(be.start, be.openEnd) === sides.c.xml.substring(ce.start, ce.openEnd)
      && sides.o.xml.substring(oe.start, oe.openEnd) !== sides.w.xml.substring(we.start, we.openEnd)) {
      out.push((path === '' ? 'the entry' : path) + ' (open tag)');
    }
    const elements = oe.children.some((k) => k.tag === 'Element');
    if (!elements) {
      const index = (e: ScannedElement): Map<string, ScannedElement> | null => {
        const map = new Map<string, ScannedElement>();
        for (const child of e.children) {
          const key = keyOf(child);
          if (key === null || map.has(key)) {
            return null;
          }
          map.set(key, child);
        }
        return map;
      };
      const bm = index(be);
      const cm = index(ce);
      const wm = index(we);
      if (!bm || !cm) {
        return;
      }
      if (!wm) {
        out.push((path === '' ? '' : path + ': ') + 'a child of it is written twice or cannot be named');
        return;
      }
      for (const oc of oe.children) {
        const key = keyOf(oc);
        if (key === null) {
          continue;
        }
        if (top && (key === 'P\u0000Name' || key === 'P\u0000LastMod')) {
          continue;
        }
        const bc = bm.get(key);
        const cc = cm.get(key);
        const wc = wm.get(key);
        if (bc && cc) {
          if (wc) {
            walk(oc, bc, cc, wc, step(path, oc), false);
          } else if (text(sides.b, bc) === text(sides.c, cc)) {
            out.push(step(path, oc) + ' (not written)');
          }
        } else if (!bc && !cc && (!wc || text(sides.w, wc) !== text(sides.o, oc))) {
          out.push(step(path, oc) + ' (not read, and not kept)');
        }
      }
      return;
    }
    const cOrigins = ce.children.map(originAttrOf);
    if (cOrigins.every((x) => x === undefined) && be.children.every((k) => originAttrOf(k) === undefined)) {
      if (oe.children.length === 1 && be.children.length === 1 && ce.children.length === 1 && we.children.length === 1) {
        walk(oe.children[0], be.children[0], ce.children[0], we.children[0], step(path, oe.children[0], 0), false);
      }
      return;
    }
    if (we.children.length !== ce.children.length) {
      out.push((path === '' ? '' : path + ': ') + 'written with ' + we.children.length + ' elements where the model holds ' + ce.children.length);
      return;
    }
    ce.children.forEach((cc, k) => {
      const j = cOrigins[k];
      if (j !== undefined && j >= 0 && j < oe.children.length && j < be.children.length) {
        walk(oe.children[j], be.children[j], cc, we.children[k], step(path, oe.children[j], j), false);
      }
    });
  };
  walk(o, b, c, w, '', true);
  return out;
}

// ---- one entry, read on its own -----------------------------------------------------------

/** How readEntryFragment reads a fragment. */
export interface ReadEntryOptions {
  /**
   * The section to read the entry into, as the file's own entries are read
   * (SectionNode._readEntry): it is added as that section's last child. Without one, it is read
   * into a dictionary of its own, which nothing else holds.
   */
  readonly section?: SectionNode;
  /** The System Composer catalog the entry's class is read against; the section's dictionary's by default. */
  readonly systemComposer?: SystemComposerCatalog | null;
  /**
   * An entry node whose place in its file the new one takes: given the bytes it was read from,
   * the new node is given the same place with `fragment` as its bytes, so that it is written as
   * them for as long as nothing edits it, and merged with them once something does. Only with
   * `section`, and only for a fragment the reader pairs with the entry it reads from it.
   */
  readonly inheritPlaceFrom?: DataNode;
  readonly warnings?: ParseWarning[];
}

/**
 * What builds the entry node from the content the binary reader read a one-entry chunk as, given
 * the fragment that chunk wraps. The node layer's to supply (SlddNode registers it), since a
 * parser may not reach the node classes.
 */
export type EntryFragmentReader = (content: Record<string, unknown>, fragment: string, options: ReadEntryOptions) => DataNode | null;

let fragmentReader: EntryFragmentReader | null = null;

/** Install the node layer's half of readEntryFragment. */
export function setEntryFragmentReader(reader: EntryFragmentReader): void {
  fragmentReader = reader;
}

const WRAP_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<DataSource FormatVersion="1" MinRelease="R2014a">\n    ';
const WRAP_TAIL = '\n</DataSource>';

/**
 * The entry node one `<Object Class="DD.ENTRY">…</Object>` fragment reads as, read by the binary
 * reader in a chunk of its own; null when it does not read as exactly one entry. This is how the
 * merge reads O again (B), and how a host rebuilds an entry from the text it holds for one (an
 * undo of a binary edit) with the bytes it came from (`inheritPlaceFrom`).
 */
export function readEntryFragment(fragment: string, options: ReadEntryOptions = {}): DataNode | null {
  if (!fragmentReader) {
    return null;
  }
  const content = parseBinarySlddParts(WRAP_HEAD + fragment + WRAP_TAIL, {}, options.warnings) as Record<string, unknown>;
  return fragmentReader(content, fragment, options);
}

// ---- what a save writes for an edited entry -----------------------------------------------

/** The writers' text for an entry's bytes as read (B), by the bytes' source, or null where there is none. */
const bases = new WeakMap<EntrySource, string | null>();

/** The catalog an entry node's dictionary reads classes against. */
export function catalogOf(entry: DataNode): SystemComposerCatalog | null {
  const dictionary = (entry.parent as { parent?: unknown } | null)?.parent as { systemComposer?: SystemComposerCatalog | null } | undefined;
  return dictionary?.systemComposer ?? null;
}

/**
 * B for an entry: the writers' text, origins spelled, for its bytes as the reader reads them; null
 * when they cannot be read or written on their own. Kept with the source, which never changes.
 */
export function baseOf(source: EntrySource, catalog: SystemComposerCatalog | null, write: (entry: DataNode) => string): string | null {
  if (bases.has(source)) {
    return bases.get(source)!;
  }
  let base: string | null = null;
  try {
    const read = source.fragment === null ? null : readEntryFragment(source.fragment, { systemComposer: catalog });
    base = read ? write(read) : null;
  } catch {
    base = null;
  }
  bases.set(source, base);
  return base;
}
