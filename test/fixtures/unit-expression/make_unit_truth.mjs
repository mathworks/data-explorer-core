// Copyright 2026 The MathWorks, Inc.
//
// Merges truth_r2027a.json and truth_r2023b.json (make_unit_truth.m) into truth.json: each text of
// texts.json with MATLAB's refusal of it as a unit expression, null where taken. Refuses to write
// one where the releases, or a ValueType's Unit and a lookup table's, disagree on any text: the
// truth is one rule. Run from anywhere: node <this folder>/make_unit_truth.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const texts = JSON.parse(readFileSync(here + 'texts.json', 'utf8'));
const releases = ['r2027a', 'r2023b'].map((r) => JSON.parse(readFileSync(here + 'truth_' + r + '.json', 'utf8')));
const verdictOf = (v) => (v === null || v === undefined || (Array.isArray(v) && v.length === 0) ? null : String(v));
// A ValueType's refusal is formatted with the text in it, so a % there garbles it ('m% s' is said
// as 'm): its verdict is held to the others, and the Table's words, which are whole, are kept.
const cases = texts.map((text, i) => {
  const all = releases.flatMap((r) => r.verdicts[i].map(verdictOf));
  const words = text.includes('%') ? releases.map((r) => verdictOf(r.verdicts[i][1])) : all;
  if (new Set(all.map((v) => v === null)).size !== 1 || new Set(words).size !== 1) {
    throw new Error('the verdicts on ' + JSON.stringify(text) + ' disagree: ' + JSON.stringify(all));
  }
  return [text, words[0]];
});
writeFileSync(here + 'truth.json', JSON.stringify({ releases: releases.map((r) => r.version), cases }, null, 1) + '\n');
console.log('wrote', cases.length, 'cases,', cases.filter((c) => c[1] !== null).length, 'refused');
