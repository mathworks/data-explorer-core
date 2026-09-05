// Copyright 2026 The MathWorks, Inc.
//
// How a block-parameter expression is read: which names in it are references to
// definitions. Every usage answer this package gives rests on this one function —
// findUsages asks whether a parameter names a given definition, resolveLink asks what
// the name part of a target can mean — and it is now PUBLIC surface, because
// data-explorer-vscode has a resolver of its own for a scope this package does not
// cover (a whole workspace of files on disk, with MATLAB's shadowing over them) and
// that resolver has to read an expression the same way. While it had its own copy the
// two disagreed, so the same model yielded two different usage answers depending on
// which one was asked.
//
// The rule is deliberately a lexical scan and not an expression parser. The cases below
// are the boundary of that choice, in both directions: what it must credit, and what it
// must not.
import { describe, it, expect } from 'vitest';
import { identifiersIn } from '../src/index.js';

describe('identifiersIn', () => {
  it('reads a bare name', () => {
    expect(identifiersIn('Kp')).toEqual(['Kp']);
  });

  it('reads the names out of an expression, in order', () => {
    // Real values from the mdlcases fixture: a parameter is an expression as often as
    // it is a name, and every name in one is a reference.
    expect(identifiersIn('2*Tau_inf')).toEqual(['Tau_inf']);
    expect(identifiersIn('1/Uo')).toEqual(['Uo']);
    expect(identifiersIn('[tau 1]')).toEqual(['tau']);
    expect(identifiersIn('a*b+c')).toEqual(['a', 'b', 'c']);
  });

  it('reads nothing out of an expression with no names', () => {
    // A Sum block's `Inputs` is `|++`; a Gain's is often a literal. Neither refers to
    // anything, and answering with a phantom name would attach a usage to nothing.
    expect(identifiersIn('42')).toEqual([]);
    expect(identifiersIn('|++')).toEqual([]);
    expect(identifiersIn('')).toEqual([]);
  });

  it('credits a dotted reference to the base name and not to the field', () => {
    // `cfg.mode` refers to `cfg` — that is the name the model resolves, and the field is
    // reached from it. Crediting `mode` too would invent a usage for any entry that
    // happens to be named `mode`, and a phantom usage is worse than a missing one
    // because a user acts on it.
    expect(identifiersIn('cfg.mode')).toEqual(['cfg']);
    expect(identifiersIn('MyBus.x.y')).toEqual(['MyBus']);
    // A method or property call reads the same way: the object is the reference.
    expect(identifiersIn('obj.method(arg)')).toEqual(['obj', 'arg']);
  });

  it('does not mistake the tail of a numeric literal for a name', () => {
    // An identifier cannot begin after a digit in MATLAB, so a name-shaped run that
    // does is part of the number: `1e5` would otherwise offer `e5`.
    expect(identifiersIn('1e5')).toEqual([]);
    expect(identifiersIn('2.5e-3')).toEqual([]);
    expect(identifiersIn('3*x1')).toEqual(['x1']);
    // `x1` is one name, not `x` plus a stray digit — the digit is inside the token.
    expect(identifiersIn('x1')).toEqual(['x1']);
  });

  it('accepts the leading underscore MATLAB allows in a name', () => {
    expect(identifiersIn('_hidden + K_p')).toEqual(['_hidden', 'K_p']);
  });

  it('reports a repeated name once per occurrence, in order', () => {
    // The caller counts occurrences (a parameter naming the same entry twice is two
    // references to it), so this must not dedupe on the way out.
    expect(identifiersIn('Kp*Kp')).toEqual(['Kp', 'Kp']);
  });

  it('still credits a name inside what may be a char literal', () => {
    // Deliberate, and the one case where the lexical scan is knowingly generous. In
    // MATLAB `'` is both the char delimiter and the transpose operator, so no regular
    // scan can tell `A'*B'` from a quoted span — and guessing wrong would DROP real
    // usages, which is a worse failure than the rare phantom one a char literal holding
    // an entry's name adds.
    expect(identifiersIn("A'*B'")).toEqual(['A', 'B']);
    expect(identifiersIn("strcmp(mode,'fast')")).toEqual(['strcmp', 'mode', 'fast']);
  });

  it('is safe to call repeatedly on different expressions', () => {
    // The `/g` pattern is built per call rather than hoisted: a shared one carries
    // lastIndex and would resume mid-string on the next call, dropping the leading
    // names of every expression after the first.
    expect(identifiersIn('alpha')).toEqual(['alpha']);
    expect(identifiersIn('beta')).toEqual(['beta']);
    expect(identifiersIn('gamma*delta')).toEqual(['gamma', 'delta']);
  });
});
