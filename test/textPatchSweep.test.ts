// Copyright 2026 The MathWorks, Inc.
//
// minimalReplacement over every shape of change at once, rather than one named shape at a time
// (textPatch.test.ts): pairs of texts drawn from a small alphabet that makes the trim's two hard
// cases common, a shared prefix and suffix that want the same units, and characters of two code
// units whose halves the two texts share. Three such characters share a high half or a low half
// with another, so a trim can stop between the halves of either. Seeded, so a failure names a
// pair that fails again.
//
// For every pair, the properties a host's write leans on: the document afterwards is the new
// text; the region is one of the old text, on a character boundary at both ends, and so is the
// text written into it; and it is no wider than the change, give or take the half of a pair a
// boundary was moved off.

import { describe, it, expect } from 'vitest';
import { applyTextPatch, minimalReplacement } from '../src/edit/textPatch.js';

// mulberry32: a small, seedable generator, so the sweep is the same sweep on every run.
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 😀 U+1F600 and 😁 U+1F601 share their high half; 🈀 U+1F200 shares 😀's low half.
const TOKENS = ['a', 'b', '\r\n', '\u{1F600}', '\u{1F601}', '\u{1F200}'];

const isHigh = (u: number) => u >= 0xd800 && u <= 0xdbff;
const isLow = (u: number) => u >= 0xdc00 && u <= 0xdfff;
const splitsAPair = (text: string, at: number) => at > 0 && at < text.length && isHigh(text.charCodeAt(at - 1)) && isLow(text.charCodeAt(at));

function textOf(random: () => number, max: number): string {
  let out = '';
  const n = Math.floor(random() * (max + 1));
  for (let i = 0; i < n; i++) {
    out += TOKENS[Math.floor(random() * TOKENS.length)];
  }
  return out;
}

// `from` with one region of whole tokens replaced, which is the change a structural edit makes.
function edited(random: () => number, from: string): string {
  const tokens = [...from];
  const at = Math.floor(random() * (tokens.length + 1));
  const cut = Math.floor(random() * (tokens.length - at + 1));
  return [...tokens.slice(0, at), textOf(random, 4), ...tokens.slice(at + cut)].join('');
}

// The common prefix and suffix of two texts in whole characters, which bounds the region from below.
function changedCharacters(from: string, to: string): number {
  const a = [...from];
  const b = [...to];
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return a.slice(p, a.length - s).join('').length;
}

describe('minimalReplacement, swept', () => {
  it('writes the new text, on character boundaries, no wider than the change, for 20,000 pairs', () => {
    const random = generator(0x5eed);
    for (let i = 0; i < 20_000; i++) {
      const from = textOf(random, 8);
      const to = random() < 0.75 ? edited(random, from) : textOf(random, 8);
      const label = `pair ${i}: ${JSON.stringify(from)} -> ${JSON.stringify(to)}`;
      const patch = minimalReplacement(from, to);
      expect(applyTextPatch(from, patch), label).toBe(to);
      expect(patch.offset, label).toBeGreaterThanOrEqual(0);
      expect(patch.length, label).toBeGreaterThanOrEqual(0);
      expect(patch.offset + patch.length, label).toBeLessThanOrEqual(from.length);
      expect(splitsAPair(from, patch.offset), label + ': start').toBe(false);
      expect(splitsAPair(from, patch.offset + patch.length), label + ': end').toBe(false);
      // The text written is whole characters too: it opens on no low half and ends on no high one.
      if (patch.text.length > 0) {
        expect(isLow(patch.text.charCodeAt(0)), label + ': text start').toBe(false);
        expect(isHigh(patch.text.charCodeAt(patch.text.length - 1)), label + ': text end').toBe(false);
      }
      if (from === to) {
        // Identical texts are said as the whole-document replace, as textPatch documents.
        expect(patch, label).toEqual({ offset: 0, length: from.length, text: to });
      } else {
        // At most one unit wider at each end than the change in whole characters: the half of a
        // pair a boundary was moved off. (A unit-wise trim can be narrower than a character-wise
        // one, never wider than this.)
        expect(patch.length, label).toBeLessThanOrEqual(changedCharacters(from, to) + 2);
      }
    }
  });
});
