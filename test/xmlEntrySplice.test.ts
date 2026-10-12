// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import {
  findEntryObjectSpan,
  findEntryElementSpan,
  findEntryInsertionPoint,
  pNodeText,
} from '../src/datamodel/parser/xmlEntrySplice.js';

function chunkXml(fixture: string): string {
  const p = fileURLToPath(new URL('./' + fixture, import.meta.url));
  const z = unzipSync(new Uint8Array(readFileSync(p)));
  return new TextDecoder().decode(z['data/chunk0.xml']);
}
const nested = chunkXml('fixtures/nested_objects.sldd');
// compressed.sldd writes its whole chunk0.xml on ONE line and its Name P-node
// carries no Class attribute — both are real writer shapes, and both used to
// break the splicer while the parser read the file fine.
const oneLine = chunkXml('fixtures/compressed.sldd');
// A single-line document that DOES carry a trailing dictionary object.
const oneLineWithDict = chunkXml('fixtures/object_array_binary.sldd').replace(
  '</DataSource>',
  '<Object Class="DD.Dictionary"><P Name="AccessBaseWorkspace" Class="logical">0</P></Object></DataSource>',
);

describe('findEntryObjectSpan', () => {
  it('finds an entry and returns a tight <Object>…</Object> span', () => {
    const span = findEntryObjectSpan(nested, 'StructWithParam');
    expect(span).not.toBeNull();
    const slice = nested.slice(span!.offset, span!.offset + span!.length);
    expect(slice.startsWith('<Object Class="DD.ENTRY">')).toBe(true);
    expect(slice.endsWith('</Object>')).toBe(true);
    expect(slice).toContain('<P Name="Name" Class="char">StructWithParam</P>');
    // Must not swallow the sibling entry.
    expect(slice).not.toContain('CellWithParam');
  });

  it('the fragment for a nested-object entry contains NO nested <Object> (invariant)', () => {
    for (const name of ['StructWithParam', 'CellWithParam']) {
      const span = findEntryObjectSpan(nested, name)!;
      const slice = nested.slice(span.offset, span.offset + span.length);
      const inner = slice.slice('<Object Class="DD.ENTRY">'.length, -'</Object>'.length);
      expect(inner).not.toContain('<Object');
    }
  });

  it('returns null for an unknown name', () => {
    expect(findEntryObjectSpan(nested, 'NoSuchEntry')).toBeNull();
  });

  // REGRESSION. The Name P-node was matched with `Class="char"` hard-coded, but the
  // parser identifies a P-node by its Name attribute ALONE. A writer that omits
  // Class therefore produced a file whose entries the table listed correctly while
  // every structural edit on them failed with 'Could not locate entry "Kp"' — the
  // row was visible but could not be renamed, deleted, or edited at all.
  it('finds an entry whose Name P-node carries no Class attribute', () => {
    expect(oneLine).toContain('<P Name="Name">Kp</P>');
    const span = findEntryObjectSpan(oneLine, 'Kp');
    expect(span).not.toBeNull();
    const slice = oneLine.slice(span!.offset, span!.offset + span!.length);
    expect(slice).toBe('<Object Class="DD.ENTRY"><P Name="Name">Kp</P></Object>');
  });

  // A self-closing Name P-node (how MATLAB writes an empty char) names NOTHING, so
  // the scan must skip past it. Matching it as a name would let a search for a real
  // entry stop on the wrong <Object> and splice the edit into an unrelated entry.
  it('skips a fragment whose Name P-node is self-closing rather than matching it', () => {
    const xml =
      '<DataSource>\n' +
      '    <Object Class="DD.ENTRY"><P Name="Name" Class="char"/></Object>\n' +
      '    <Object Class="DD.ENTRY"><P Name="Name" Class="char">Real</P></Object>\n' +
      '</DataSource>';
    const span = findEntryObjectSpan(xml, 'Real');
    expect(span).not.toBeNull();
    expect(xml.slice(span!.offset, span!.offset + span!.length)).toContain('>Real<');
    // The nameless fragment answers to no name at all, including the empty one.
    expect(findEntryObjectSpan(xml, '')).toBeNull();
  });

  // A document whose entry open tag has no matching close tag: the scan must give
  // up rather than run off the end. A truncated chunk0.xml still parses into a
  // model (the parser only reads whole fragments), so the host CAN hold a node
  // whose text is incomplete — asking to delete it must report "could not locate",
  // which the caller turns into an error message, not corrupt the remaining bytes.
  it('returns null when an entry open tag has no closing </Object>', () => {
    const truncated = '<DataSource>\n    <Object Class="DD.ENTRY">\n        <P Name="Name" Class="char">Half</P>\n';
    expect(findEntryObjectSpan(truncated, 'Half')).toBeNull();
    expect(findEntryElementSpan(truncated, 'Half')).toBeNull();
  });
});

describe('findEntryInsertionPoint', () => {
  it('returns an offset just before the trailing DD.Dictionary object', () => {
    const off = findEntryInsertionPoint(nested);
    expect(off).not.toBeNull();
    expect(nested.slice(off!)).toContain('<Object Class="DD.Dictionary">');
    expect(nested.slice(0, off!)).toContain('<Object Class="DD.ENTRY">');
  });

  // A document carrying referenced sub-dictionaries must take the DICTIONARYREFERENCE
  // as its insertion point, not the DD.Dictionary that follows it: inserting between
  // them would put an entry after a reference object, which is not where entries live.
  it('prefers the DICTIONARYREFERENCE over the later DD.Dictionary', () => {
    // MATLAB-authored params.sldd is this repo's dictionary that references others; the
    // consumer this test came from named its own equivalent, and the shape being pinned
    // is the reference object, not the file.
    const withRef = chunkXml('parity/artifacts/binary/params.sldd');
    const off = findEntryInsertionPoint(withRef)!;
    expect(withRef.slice(off)).toMatch(/^\s*<Object Class="DD\.DICTIONARYREFERENCE">/);
    expect(withRef.slice(0, off)).not.toContain('DD.DICTIONARYREFERENCE');
  });

  // REGRESSION. The offset was always backed up to the start of the dictionary
  // object's line. On a single-line document there is no preceding newline, so that
  // landed on offset 0 and the new entry was written BEFORE the `<?xml` prolog —
  // producing a .sldd that no longer opens at all. Adding an entry must keep the
  // prolog and the DataSource open tag first.
  it('never backs up past the prolog on a single-line document', () => {
    const off = findEntryInsertionPoint(oneLineWithDict);
    expect(off).not.toBeNull();
    expect(off).toBeGreaterThan(0);
    const inserted =
      oneLineWithDict.slice(0, off!) + '<Object Class="DD.ENTRY">NEW</Object>' + oneLineWithDict.slice(off!);
    expect(inserted.startsWith('<?xml version="1.0" encoding="UTF-8"?><DataSource ')).toBe(true);
    // The new entry lands between the last existing entry and the dictionary.
    expect(inserted.indexOf('NEW')).toBeLessThan(inserted.indexOf('<Object Class="DD.Dictionary">'));
    expect(inserted.indexOf('usageArray')).toBeLessThan(inserted.indexOf('NEW'));
  });

  // A .sldd with neither trailing object has nowhere defined to put an entry. The
  // caller turns null into "Could not locate the insertion point." — an error the
  // user sees instead of a silently mangled file.
  it('returns null when the document has neither trailing object', () => {
    expect(oneLine).not.toContain('DD.Dictionary');
    expect(findEntryInsertionPoint(oneLine)).toBeNull();
  });
});

describe('findEntryElementSpan', () => {
  it('span removal leaves the other entry and the dictionary intact', () => {
    const span = findEntryElementSpan(nested, 'StructWithParam')!;
    const after = nested.slice(0, span.offset) + nested.slice(span.offset + span.length);
    expect(after).not.toContain('StructWithParam');
    expect(after).toContain('CellWithParam');
    expect(after).toContain('<Object Class="DD.Dictionary">');
  });

  // The span swallows the entry's indentation AND its trailing newline, so deleting
  // a row removes the whole line. Leaving either behind accumulates blank/ragged
  // lines in the file every time the user deletes an entry.
  it('absorbs the leading indentation and the trailing newline', () => {
    const span = findEntryElementSpan(nested, 'StructWithParam')!;
    const removed = nested.slice(span.offset, span.offset + span.length);
    expect(removed.startsWith('    <Object Class="DD.ENTRY">')).toBe(true);
    expect(removed.endsWith('</Object>\n')).toBe(true);
    const after = nested.slice(0, span.offset) + nested.slice(span.offset + span.length);
    expect(after).not.toContain('\n\n');
    expect(after).not.toMatch(/\n[ \t]+\n/);
  });

  // On a single-line document there is no line to reclaim and no trailing newline to
  // absorb, so the removal span must be exactly the <Object> element. Extending it
  // either way here would eat the neighbouring entry's bytes or the prolog.
  it('is exactly the <Object> element when entry and prolog share a line', () => {
    const objectSpan = findEntryObjectSpan(oneLineWithDict, 'paramArray')!;
    const elementSpan = findEntryElementSpan(oneLineWithDict, 'paramArray')!;
    expect(elementSpan).toEqual(objectSpan);
    const after =
      oneLineWithDict.slice(0, elementSpan.offset) +
      oneLineWithDict.slice(elementSpan.offset + elementSpan.length);
    expect(after.startsWith('<?xml version="1.0" encoding="UTF-8"?><DataSource ')).toBe(true);
    expect(after).not.toContain('paramArray');
    expect(after).toContain('usageArray');
  });

  it('returns null for an unknown name rather than a bogus span', () => {
    expect(findEntryElementSpan(nested, 'NoSuchEntry')).toBeNull();
  });
});

describe('the Name and UUID reads, on fragments that are not well-formed entries', () => {
  // The two patterns `pNodeText` replaced, kept here as the specification it is held to.
  // Each is quadratic on a fragment holding many opens that no `>` follows soon, which is
  // why it is not the implementation; every input below is small enough for it to finish.
  const SPEC: Record<string, RegExp> = {
    '<P Name="Name"': /<P Name="Name"[^>]*>([^<]*)<\/P>/,
    '<P Name="UUID"': /<P Name="UUID"[^>]*>([^<]*)<\/P>/,
  };
  const viaRegex = (s: string, open: string): string | null => {
    const m = s.match(SPEC[open]);
    return m ? m[1] : null;
  };

  // Random strings over the pieces the patterns give meaning to, seeded so a failure
  // reproduces: opens with and without their `>`, closes, and the `<` that ends a text.
  it('reads what the regexes read, on random input', () => {
    let seed = 1;
    const rand = (n: number): number => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) % n;
    };
    const pieces = [
      '<P Name="Name"', '<P Name="UUID"', '</P>', '<', '>', '/', 'P', ' ', 'Name="Name"',
      'x', '\n', '<P Name="Name" Class="char">', '"', '<!-- ', ' -->',
    ];
    for (let k = 0; k < 20000; k++) {
      let s = '';
      for (let i = 1 + rand(30); i > 0; i--) {
        s += pieces[rand(pieces.length)];
      }
      for (const open of Object.keys(SPEC)) {
        expect(pNodeText(s, open), JSON.stringify([open, s])).toBe(viaRegex(s, open));
      }
    }
  });

  // An entry ahead of the one looked up, holding a comment of 25,000 Name opens. The
  // regex retried at each and walked from each to the comment's `>`: the lookup took
  // 4.1 s. Here it takes 0.4 ms over two full runs, so 1 s is past five times CI's time,
  // at 3.3 times this machine's (fe238c7).
  it('looks past an entry holding many Name opens at once', () => {
    const run = `<!-- ${'<P Name="Name"'.repeat(25_000)} -->`;
    const xml = nested.replace('<P Name="Name"', run + '<P Name="Name"');
    const t0 = performance.now();
    const span = findEntryObjectSpan(xml, 'StructWithParam');
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(xml.slice(span!.offset, span!.offset + span!.length)).toContain('>StructWithParam</P>');
  });

  // The same run of UUID opens, ahead of the UUID that breaks a tie between two entries
  // of one name, which is read only once the name has matched. With the regex the lookup
  // took 4.1 to 5.5 s; here it takes 1.1 ms over two full runs, under the same bound.
  it('reads the UUID that breaks a name tie past an entry holding many UUID opens, at once', () => {
    const run = `<!-- ${'<P Name="UUID"'.repeat(25_000)} -->`;
    const xml = nested.replace('<P Name="UUID"', run + '<P Name="UUID"');
    const uuid = /<P Name="UUID" Class="char">([^<]*)<\/P>/.exec(nested)![1];
    const t0 = performance.now();
    const span = findEntryObjectSpan(xml, { name: 'CellWithParam', uuid });
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(xml.slice(span!.offset, span!.offset + span!.length)).toContain(run);
  });
});
