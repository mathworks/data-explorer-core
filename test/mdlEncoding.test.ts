// Copyright 2026 The MathWorks, Inc.
//
// A classic `.mdl` records the character encoding it was saved in, and this suite is
// about honouring it.
//
// Before R2012 there was no expectation that a model file be UTF-8: `save_system`
// wrote block names, descriptions and creator names in whatever character set the
// platform was configured for, and recorded the name of that set in the Model block
// as `SavedCharacterEncoding`. A reader that decodes every byte as UTF-8 regardless
// does not fail — UTF-8 decoding is lenient by default — it quietly substitutes
// U+FFFD for every byte it cannot make sense of, so a model from a Japanese or a
// Western European locale opens with mojibake where its labels should be. Shift_JIS
// costs more than legibility: its trail bytes reach down into ASCII, and `表` is
// 0x95 0x5C, whose second byte read as ASCII is a BACKSLASH — so a block name ending
// in that character escapes its own closing quote and the value runs on into the
// property that follows it.
//
// THE FIXTURES ARE MATLAB'S OWN. `test/parity/matlab/probe_mdl_encoding.m` sets
// `slCharacterEncoding` and saves the same one-Constant model twice per encoding —
// once at the current release, once with `'ExportToVersion', 'R2011b'` — so the bytes
// under test are what a Japanese or a German locale's Simulink actually writes, down
// to the spelling of the label. Three files came out of it:
//
//   mdlenc_shift_jis_R2011b.mdl     classic, `SavedCharacterEncoding "Shift_JIS"`,
//                                   block named `日本語表`, whose last character is
//                                   the backslash trap above.
//   mdlenc_windows_1252_R2011b.mdl  classic, `"windows-1252"`, block named `Größe`.
//   mdlenc_shift_jis.mdl            the same model at the current release: a modern
//                                   OPC text package, whose parts are UTF-8.
//
// Three things the harvest settled that the synthesized fixtures it replaced could
// only assume:
//
//   * MATLAB writes exactly the WHATWG labels — `Shift_JIS` and `windows-1252`, the
//     spellings a `TextDecoder` takes rather than `SJIS` or a platform name — and
//     encodes the WHOLE file in them: the name bytes are `93 fa 96 7b 8c ea 95 5c`
//     and `47 72 f6 df 65`, not escapes and not ASCII.
//   * MATLAB REFUSES to save a `.mdl` holding a character the session encoding cannot
//     represent ("contains characters that are not valid in the current character
//     encoding"), so the two files cannot carry the same block name. Hence two names.
//   * An R2011b export does carry its MODEL WORKSPACE through as a `MatData` stream,
//     which is the one part of the file whose survival across a re-decode had to be
//     measured rather than reasoned about.
//
// What a fixture cannot be is a file whose label MATLAB would never write, so the
// cases about labels the reader cannot honour take a harvested file and rewrite ONLY
// its recorded label, leaving every other byte MATLAB's. Nor can it be a modern `.mdl`
// carrying the parameter: R2027a writes no `SavedCharacterEncoding` into the
// compatibility stub at all, which the last describe block both relies on and asserts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMdl } from '../src/datamodel/parser/MdlParser.js';

const SJIS = 'mdlenc_shift_jis_R2011b.mdl';
const W1252 = 'mdlenc_windows_1252_R2011b.mdl';
const MODERN = 'mdlenc_shift_jis.mdl';

function detach(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function bytesOf(file: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`./parity/artifacts/mdl/${file}`, import.meta.url))));
}

/** A fixture's bytes as characters one-for-one, for looking at the file as a file. */
function latin1(file: string): string {
  return Buffer.from(bytesOf(file)).toString('latin1');
}

function read(file: string) {
  return parseMdl(detach(bytesOf(file)), file);
}

/**
 * windows-1252, which is what a `.mdl` saved on a Western European Windows says.
 *
 * Encoded through Buffer's `latin1`, which agrees with windows-1252 byte for byte on
 * every code point below U+0100 and disagrees only on 0x80-0x9F — a range nothing
 * here uses. Encoding with an implementation OTHER than the TextDecoder under test is
 * the point of doing it this way rather than writing the bytes out. Only the two cases
 * MATLAB cannot be asked for need it; the rest read a harvested file.
 */
function windows1252(text: string): Uint8Array {
  for (const ch of text) {
    if (ch.codePointAt(0)! > 0xff) {
      throw new Error(`windows1252(): U+${ch.codePointAt(0)!.toString(16)} is out of the range Buffer can encode`);
    }
  }
  return new Uint8Array(Buffer.from(text, 'latin1'));
}

const SAVED_ENCODING_RE = /^([ \t]*)SavedCharacterEncoding([ \t]+)"([^"\r\n]*)"/m;

/**
 * A harvested fixture with ONLY its recorded label rewritten.
 *
 * The round trip is latin1 in both directions, which maps every byte to one character
 * and back to the same byte — so the name bytes, the `MatData` stream and every brace
 * stay exactly what MATLAB wrote, and the single thing that differs from the file on
 * disk is the label the reader is being asked to honour. That is what makes these
 * cases evidence about a real file rather than about a re-encoding of one.
 */
function relabelled(file: string, label: string): ArrayBuffer {
  const text = latin1(file);
  const found = SAVED_ENCODING_RE.exec(text);
  if (!found) {
    throw new Error(`${file} no longer records SavedCharacterEncoding — see the header`);
  }
  const swapped = text.replace(found[0], `${found[1]}SavedCharacterEncoding${found[2]}"${label}"`);
  return detach(new Uint8Array(Buffer.from(swapped, 'latin1')));
}

/**
 * The one block-parameter row this model has — MATLAB's answer about these bytes and
 * not a line written by hand. The probe builds it as
 * `add_block('simulink/Sources/Constant', [mdl '/' name], 'Value', 'Kp')`, and the
 * value stays ASCII on purpose: what is under test is the encoding of the file, not
 * the identifier gate that decides which rows surface.
 */
function oneRow(blockName: string) {
  return [{ blockName, blockType: 'Constant', paramProperty: 'Value', paramValue: 'Kp' }];
}

/** The workspace, less the raw mxarray bytes — those are asserted by their decode. */
function workspaceOf(parsed: ReturnType<typeof parseMdl>) {
  return parsed.workspace.map((v) => ({
    name: v.name,
    className: v.className,
    dimensions: v.dimensions,
    value: v.value,
  }));
}

// What the probe assigns into the model workspace, and therefore what has to come back
// out of the encoded stream: `Kp = 3.5`, `grid = [1 2 3; 4 5 6]`, `label = 'plain ascii'`.
const WORKSPACE = [
  { name: 'Kp', className: 'double', dimensions: [1, 1], value: 3.5 },
  { name: 'grid', className: 'double', dimensions: [2, 3], value: [1, 2, 3, 4, 5, 6] },
  { name: 'label', className: 'char', dimensions: [1, 11], value: 'plain ascii' },
];

/**
 * Everything a wrong label could plausibly damage, less the raw text the label itself
 * appears in — so two parses of the same bytes under two different labels can be
 * compared for "did this fall back to the same read" without the labels themselves
 * making them differ.
 */
function content(parsed: ReturnType<typeof parseMdl>) {
  return {
    name: parsed.name,
    creator: parsed.creator,
    usages: parsed.blockParamUsages,
    workspace: workspaceOf(parsed),
    warnings: parsed.warnings,
  };
}

describe('parseMdl — a classic .mdl decodes under its recorded SavedCharacterEncoding', () => {
  it('is holding the label MATLAB itself wrote, in MATLAB spelling', () => {
    // The premise of every test below: if the fixtures did not record these exact
    // strings, the suite would be asserting about a file that does not exist. Worth
    // its own test because the spellings are a FINDING and not a convention — the
    // reader takes the label to `new TextDecoder`, and MATLAB was equally free to
    // write `SJIS`, `ibm-943_P15A-2003`, or a platform name with no registration.
    expect(latin1(SJIS)).toMatch(/^[ \t]*SavedCharacterEncoding[ \t]+"Shift_JIS"/m);
    expect(latin1(W1252)).toMatch(/^[ \t]*SavedCharacterEncoding[ \t]+"windows-1252"/m);
  });

  it('reads windows-1252 text as the characters it is', () => {
    const parsed = read(W1252);
    expect(parsed.blockParamUsages).toEqual(oneRow('Größe'));
    expect(parsed.warnings).toEqual([]);
  });

  it('is asserting against bytes that a UTF-8 read really does get wrong', () => {
    // Without this the suite could pass on a fixture that happened to be ASCII, and
    // nobody would know. Both halves are pinned: the bytes are not valid UTF-8, and
    // the name IS recoverable from them under the encoding the file names.
    const raw = bytesOf(W1252);
    const asUtf8 = new TextDecoder().decode(raw);
    expect(asUtf8).not.toContain('Größe');
    expect(asUtf8).toContain('Gr��e');
    expect(new TextDecoder('windows-1252').decode(raw)).toContain('Größe');
  });

  it('reads Shift_JIS text, including the character whose trail byte is a backslash', () => {
    const parsed = read(SJIS);
    expect(parsed.blockParamUsages).toEqual(oneRow('日本語表'));
    expect(parsed.warnings).toEqual([]);
  });

  it('is the difference between a name and a name that ran past its closing quote', () => {
    // What the decode is FOR, measured on the same bytes rather than described. `表`
    // is 0x95 0x5C: read as UTF-8 the 0x95 becomes U+FFFD, `ea 95 5c` is a truncated
    // three-byte sequence so 0x5C is reprocessed on its own, and this grammar treats
    // a backslash as an escape — so the name escapes its own closing quote, produces
    // that quote as a literal character, and runs on to swallow the `SID` property
    // that follows. Note what does NOT happen: the block keeps its parameter row.
    // The damage is confined to the value holding the trap, which is why a "does it
    // contain the name" check would not notice and this one does.
    const wrong = parseMdl(relabelled(SJIS, 'UTF-8'), 'm.mdl');
    expect(wrong.blockParamUsages).toEqual(oneRow('���{��" SID'));
  });

  it('leaves the encoded model workspace byte-identical through the re-decode', () => {
    // The model workspace of a classic `.mdl` is an mxarray stream encoded into a
    // quoted `MatData` value, so it travels through this decode as TEXT — and a decode
    // that changed one character of it would not mojibake the workspace, it would stop
    // the stream parsing at all. It survives because the encoding alphabet is the
    // bytes 0x20-0x5F and every encoding a `.mdl` is written in leaves that range
    // alone (Shift_JIS lead bytes start at 0x81). Asserted three ways, because the
    // failure would be wholesale: the values are there under Shift_JIS, they are the
    // same under windows-1252, and they are still the same when the label is wrong and
    // the block name breaks — the stream does not care what the names did.
    expect(workspaceOf(read(SJIS))).toEqual(WORKSPACE);
    expect(workspaceOf(read(W1252))).toEqual(WORKSPACE);
    expect(workspaceOf(parseMdl(relabelled(SJIS, 'UTF-8'), 'm.mdl'))).toEqual(WORKSPACE);
  });

  it('reads the label whatever its case, and whatever alias names the same encoding', () => {
    // Encoding labels are case-insensitive and carry aliases in the standard's own
    // table. Nothing in the reader normalises them, and this pins that nothing has to.
    // Held to the DECODED row rather than to `read(SJIS)`: comparing the variants to
    // the file's own label would pass just as well if none of them decoded anything.
    for (const label of ['Shift_JIS', 'shift_jis', 'SHIFT-JIS', 'sjis']) {
      expect(parseMdl(relabelled(SJIS, label), 'm.mdl').blockParamUsages).toEqual(oneRow('日本語表'));
    }
  });

  it('leaves a UTF-8 file reading exactly as it did before any of this existed', () => {
    // The whole rest of the corpus is UTF-8 and must not so much as take a different
    // code path. Two files, because either alone leaves a gap: the classic fixture
    // that records `"UTF-8"` is pure ASCII, so on its own it could not tell a working
    // UTF-8 decode from no decode at all — and the current-release save of the
    // Shift_JIS model has the non-ASCII but records no encoding to short-circuit on.
    const classic = read('mdlcases_R2011b.mdl');
    expect(classic.creator).toBe('weiwang');
    expect(classic.blockParamUsages.some((u) => u.blockName === 'Const')).toBe(true);
    const modern = read(MODERN);
    expect(modern.blockParamUsages).toEqual(oneRow('日本語表'));
    expect(workspaceOf(modern)).toEqual(WORKSPACE);
    // The modern flavour of the very same model: a package, so it carries a release
    // and a UUID where the R2011b export carries neither.
    expect(modern.release).not.toBe('');
    expect(read(SJIS).release).toBe('');
  });
});

describe('parseMdl — SavedCharacterEncoding the reader cannot honour', () => {
  it('falls back to UTF-8 for a label no decoder knows, instead of throwing', () => {
    // `new TextDecoder('...')` answers an unknown label with a RangeError, and letting
    // that out would turn "I cannot name this encoding" into "this file cannot be
    // opened" — a strictly worse answer than reading the file the way we always did.
    // The label does not have to be exotic to get here: a platform character set name
    // that never had an IANA registration is enough, and that is precisely the case a
    // harvested fixture cannot be, since MATLAB writes the registered spelling.
    //
    // Asserted as "identical to reading these bytes as UTF-8", which is what the
    // fallback claims to be, rather than against a hand-copied mojibake string.
    const unknown = parseMdl(relabelled(SJIS, 'Klingon-1'), 'm.mdl');
    expect(content(unknown)).toEqual(content(parseMdl(relabelled(SJIS, 'UTF-8'), 'm.mdl')));
    // And still a model, not a refusal: mojibake in the name, everything else intact.
    expect(workspaceOf(unknown)).toEqual(WORKSPACE);
  });

  it('falls back to UTF-8 for a label that would make the file unreadable', () => {
    // A label the runtime DOES know but that cannot be what the file is in. `UTF-16LE`
    // is the reachable case (the WHATWG "replacement" labels — `ISO-2022-CN`,
    // `HZ-GB-2312` — are the other one, and Node rejects those from the constructor so
    // they land in the test above instead). Decoding an ASCII-compatible file as
    // UTF-16 turns every pair of bytes into one unrelated character: the braces go,
    // the Model node goes with them, and the file that used to open as a model becomes
    // "Not a Simulink model". Honouring what the file says must not be able to make it
    // LESS readable than ignoring what it says — so these bytes have to come back
    // mojibake-but-whole, exactly as the UTF-8 read leaves them, and not as a throw.
    const wide = parseMdl(relabelled(SJIS, 'UTF-16LE'), 'm.mdl');
    expect(content(wide)).toEqual(content(parseMdl(relabelled(SJIS, 'UTF-8'), 'm.mdl')));
    expect(workspaceOf(wide)).toEqual(WORKSPACE);
  });

  it('reads a file that records no encoding at all as UTF-8', () => {
    // Every `.mdl` old enough to matter carries the parameter, but the reader of last
    // resort also gets hand-written text, truncated files and the legacy stub of a
    // modern `.mdl` — none of which says anything about an encoding.
    const parsed = parseMdl(detach(utf8('Model {\n  Name "unit"\n  Creator "Grün"\n}\n')), 'unit.mdl');
    expect(parsed.creator).toBe('Grün');
  });

  it('does not take the parameter out of the middle of a quoted value', () => {
    // The label is looked for at the start of a line, which is safe in this format in
    // a way it would not be in free-form text: MATLAB escapes a newline inside a
    // quoted value as the two characters `\n`, so nothing inside a Description can
    // present itself as a property at the start of a line. This file is UTF-8 and has
    // to stay read as UTF-8 even though it says the word.
    const text = String.raw`Model {
  Name                    "unit"
  Description             "a note that says\n  SavedCharacterEncoding \"Shift_JIS\" verbatim"
  Creator                 "Grün"
}
`;
    expect(parseMdl(detach(utf8(text)), 'unit.mdl').creator).toBe('Grün');
  });

  it('reads a file that declares its encoding beyond the sniff window as UTF-8', () => {
    // The bound, asserted rather than assumed. `SavedCharacterEncoding` is a property
    // of the Model block itself and sits within the first handful of lines of every
    // file MATLAB writes — in both harvested fixtures it is inside the first 300 bytes
    // — so the window is generous; a file that pushes it past the window reads the way
    // it did before this feature, which is the safe direction: mojibake, not a refusal.
    const text = 'Model {\n  Name "unit"\n  Description "' + 'x'.repeat(9000) + '"\n' +
      '  SavedCharacterEncoding "windows-1252"\n  Creator "Grün"\n}\n';
    const parsed = parseMdl(detach(windows1252(text)), 'unit.mdl');
    expect(parsed.creator).toBe('Gr�n');
  });

  it('finds the parameter where MATLAB puts it, well inside that window', () => {
    // The other half of the bound: the window is only generous if real files are
    // nowhere near it. Measured on the harvest rather than asserted of the format.
    for (const file of [SJIS, W1252]) {
      expect(SAVED_ENCODING_RE.exec(latin1(file))!.index).toBeLessThan(1024);
    }
  });
});

describe('parseMdl — the modern .mdl ignores the legacy stub encoding', () => {
  it('reads OPC parts as UTF-8 however the stub is labelled', () => {
    // A modern `.mdl` opens with a small classic `Model { ... }` stub for tools that
    // would otherwise choke, and such a stub could carry the parameter. It must not
    // reach the parts: they are the byte-for-byte part set a `.slx` zips, XML that
    // declares its own encoding in its declaration and JSON that is UTF-8 by
    // definition (RFC 8259 s8.1). A re-decode there would corrupt a package that is
    // already right — this is the assertion behind leaving SlxParser's decodeText
    // alone. Hand-built, and the test below is why it has to be.
    const pkg =
      '# MathWorks OPC Text Package\n' +
      'Model {\n  Version                 "27.1.0"\n  SavedCharacterEncoding  "Shift_JIS"\n}\n' +
      '__MWOPC_PACKAGE_BEGIN__ R2027a\n' +
      '__MWOPC_PART_BEGIN__ /simulink/blockDiagram.json\n' +
      JSON.stringify({ BlockDiagram: { ModelUUID: 'aaaa-bbbb', DataDictionary: 'paramètres.sldd' } }) +
      '\n__MWOPC_PACKAGE_END__\n';
    const parsed = parseMdl(detach(utf8(pkg)), 'm.mdl');
    expect(parsed.dataDictionary).toBe('paramètres.sldd');
    expect(parsed.uuid).toBe('aaaa-bbbb');
  });

  it('is hand-built because no modern .mdl MATLAB writes records the parameter at all', () => {
    // Measured across every modern `.mdl` in the corpus, including one saved by the
    // same probe run in a Shift_JIS session: R2027a puts no `SavedCharacterEncoding`
    // in the compatibility stub, so the case above is hypothetical by construction and
    // says so here rather than reading as harvested. It is still worth having — the
    // parameter is in the grammar the stub is written in, and a reader that let it
    // through would corrupt parts that are already correct. If a release ever does
    // write it, this is the test that will say so.
    for (const file of [MODERN, 'mdlcases.mdl', 'mdlmcos.mdl']) {
      expect(latin1(file)).not.toContain('SavedCharacterEncoding');
    }
    // And the classic ones do carry it, so the check above is discriminating and not
    // just a string that never appears anywhere.
    expect(latin1('mdlcases_R2011b.mdl')).toContain('SavedCharacterEncoding');
  });
});
