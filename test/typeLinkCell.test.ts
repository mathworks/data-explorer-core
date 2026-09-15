// Copyright 2026 The MathWorks, Inc.
//
// The Data Type cell's shape: which part of the text is looked up, and which part stays
// plain.
//
// `Bus: artFsAimCmd` must underline `artFsAimCmd` and leave `Bus: ` as text, so that the
// underline marks exactly the string that exists in the dictionary. Getting there needs a
// split, and the split is on the FIRST colon with only the remainder searched — one
// lookup, never two. An entry name cannot contain a colon, which is what makes that
// unambiguous AND what makes every qualifier work without being named: nothing in this
// module knows the strings `Bus` or `Enum`, and the invented-qualifier case below is here
// to fail if that ever stops being true.
import { describe, it, expect } from 'vitest';
import { splitTypeQualifier, typeLinkCell } from '../src/datamodel/node/typeLinkCell.js';

// Resolves exactly two names, so a test can distinguish "looked the right thing up" from
// "looked anything up at all", and counts its calls so "one lookup, never two" is an
// assertion rather than a comment.
function resolver(defined: string[]): ((name: string) => string | null) & { calls: string[] } {
  const calls: string[] = [];
  const fn = (name: string): string | null => {
    calls.push(name);
    return defined.includes(name) ? `${name}@d.sldd` : null;
  };
  return Object.assign(fn, { calls });
}

describe('splitTypeQualifier', () => {
  it('leaves a bare name whole', () => {
    expect(splitTypeQualifier('adtUint8')).toEqual({ prefix: '', name: 'adtUint8' });
  });

  it('keeps the qualifier AND the space after it in the prefix', () => {
    // The space is part of the prefix, not stripped and not re-added at render time:
    // `prefix + name` has to reproduce the cell the user was already reading.
    expect(splitTypeQualifier('Bus: artFsAimCmd')).toEqual({ prefix: 'Bus: ', name: 'artFsAimCmd' });
    expect(splitTypeQualifier('Enum: avtEngSt')).toEqual({ prefix: 'Enum: ', name: 'avtEngSt' });
  });

  it('works with no space after the colon', () => {
    expect(splitTypeQualifier('Bus:artFsAimCmd')).toEqual({ prefix: 'Bus:', name: 'artFsAimCmd' });
  });

  it('splits on the FIRST colon, so a qualifier it has never seen still works', () => {
    // Nothing here knows any qualifier by name. If someone adds a list of them, this is
    // the case that breaks.
    expect(splitTypeQualifier('Quaternion: qtBody')).toEqual({ prefix: 'Quaternion: ', name: 'qtBody' });
  });

  it('has nothing to search when the colon is last', () => {
    expect(splitTypeQualifier('Bus: ')).toEqual({ prefix: 'Bus: ', name: '' });
  });

  it('passes an empty string through', () => {
    expect(splitTypeQualifier('')).toEqual({ prefix: '', name: '' });
  });
});

describe('typeLinkCell', () => {
  it('links the whole cell for a bare name that resolves, and omits `prefix`', () => {
    // Omitted rather than `prefix: ''`: an unqualified linked cell must pool identically
    // to every other one, and an empty-string field is a second shape for one value.
    const r = resolver(['adtUint8']);
    expect(typeLinkCell('adtUint8', r)).toEqual({ text: 'adtUint8', linkTarget: 'adtUint8@d.sldd' });
    expect(r.calls).toEqual(['adtUint8']);
  });

  it('links only the name of a qualified cell', () => {
    const r = resolver(['artFsAimCmd']);
    expect(typeLinkCell('Bus: artFsAimCmd', r)).toEqual({
      prefix: 'Bus: ',
      text: 'artFsAimCmd',
      linkTarget: 'artFsAimCmd@d.sldd',
    });
  });

  it('looks up the remainder ONCE and never the whole string', () => {
    // The whole point of splitting first: two lookups would mean a dictionary that
    // happened to hold an entry literally named `Bus: artFsAimCmd` could win.
    const r = resolver([]);
    typeLinkCell('Bus: artFsAimCmd', r);
    expect(r.calls).toEqual(['artFsAimCmd']);
  });

  it('declines a name nothing defines, whatever it looks like', () => {
    const r = resolver(['adtUint8']);
    expect(typeLinkCell('single', r)).toBeNull();
    expect(typeLinkCell('auto', r)).toBeNull();
    expect(typeLinkCell('sint8', r)).toBeNull();
    expect(typeLinkCell('fixdt(1,16,3)', r)).toBeNull();
    expect(typeLinkCell('Bus: notDefined', r)).toBeNull();
  });

  it('declines an empty cell without asking the resolver at all', () => {
    const r = resolver(['adtUint8']);
    expect(typeLinkCell('', r)).toBeNull();
    expect(typeLinkCell('Bus: ', r)).toBeNull();
    expect(r.calls).toEqual([]);
  });

  it('declines a non-string cell rather than coercing it', () => {
    const r = resolver(['adtUint8']);
    expect(typeLinkCell(undefined as unknown as string, r)).toBeNull();
    expect(typeLinkCell({ text: 'adtUint8' } as unknown as string, r)).toBeNull();
    expect(r.calls).toEqual([]);
  });
});
