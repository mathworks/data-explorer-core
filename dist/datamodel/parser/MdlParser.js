// Copyright 2026 The MathWorks, Inc.
// Parser for `.mdl`, the other on-disk form of a Simulink model. A `.mdl` opens to
// the SAME data model a `.slx` does — same sections, same nodes — because it holds
// the same information in different framing.
//
// There are two framings in the wild, both legitimately named `.mdl`, and this file
// reads both:
//
//   1. The MODERN `.mdl` — what `save_system(mdl, 'x.mdl')` writes today. It is an
//      OPC package like a `.slx`, but written as TEXT rather than zipped: a banner
//      line, a small legacy `Model { Version ... }` stub for tools that would
//      otherwise choke, then the parts one after another between
//      `__MWOPC_PART_BEGIN__` delimiters, with binary parts base64'd. The part set
//      is byte-for-byte the one a `.slx` carries, so once the framing is off, this
//      hands straight to SlxParser's parseModelParts and NOTHING else is duplicated.
//
//   2. The CLASSIC `.mdl` — the pre-R2012 nested-brace text format, and the reason
//      `.mdl` support matters at all: a model that was never migrated still looks
//      like this, and MATLAB still writes one on `save_system(..., 'ExportToVersion',
//      'R2011b')`. Nothing about it resembles OPC. It carries the same facts in a
//      brace grammar (`Model { Name "x" ... }`), and the model workspace as a
//      UUENCODED mxarray in a top-level MatData section. Everything below the OPC
//      decoder is about reading that.
//
// Both flavours are held to the .slx of the same diagram by the parity suite —
// see test/parity/mdl.parity.test.ts and test/parity/matlab/gen_mdl.m.
import { configSetIdentity, isParamReference, normalizeBlockName, parseModelParts } from './SlxParser.js';
import { parseMxArray, readMxArrayRecords } from './MxArrayParser.js';
export function parseMdl(buffer, filename) {
    const bytes = new Uint8Array(buffer);
    // What the OPC text framing itself claimed and could not deliver, which is a
    // different kind of loss from an unreadable part: here the part is not even
    // recoverable from the file, so the part readers below never see it and cannot
    // report it. Only the framing scan can.
    const framing = [];
    // Sniffing is folded into the decode: one scan decides, so there is no way for a
    // separate "is it a package?" test to disagree with the reader that follows.
    const parts = decodeOpcTextPackage(bytes, framing);
    // A package marker with no readable part after it is a truncated file, not a
    // package, so it falls through to the grammar reader rather than opening as a model
    // with nothing in it. That reader finds the legacy `Model { Version ... }` stub a
    // modern `.mdl` always opens with — and if the file was cut before even that, it
    // rejects it, which is the whole point of the guard down there.
    if (parts && Object.keys(parts).length > 0) {
        const parsed = parseModelParts(parts, filename);
        // Framing losses first: a part that never made it out of the text stream is a
        // larger loss than anything the part readers went on to report about the parts
        // that did, and a host that shows only the first line should show that one.
        parsed.warnings = [...framing, ...parsed.warnings];
        return parsed;
    }
    const parsed = parseClassicMdl(bytes, filename);
    if (parts !== null) {
        // A package marker WAS found, and not one part survived the scan. What
        // `parseClassicMdl` just read is the compatibility stub at the top of a modern
        // `.mdl` — a Version number and a few properties, deliberately there so old tools
        // do not choke — and not the model. So this is the one place in these readers
        // where the whole SOURCE is the thing that could not be read, and the only place
        // `source-unreadable` is right for a `.mdl`.
        //
        // The framing warnings collected above are DISCARDED rather than added to, on
        // purpose: they describe the same single loss in more detail, and two or three
        // warnings for one unreadable file teaches a host's user that the count is
        // noise. Whatever the classic reader itself reported goes too — those are facts
        // about the stub, and the stub is not this model. A genuine classic `.mdl`
        // (`parts === null`) never reaches here, so nothing legitimate is being
        // silenced: its own warnings are returned untouched below.
        parsed.warnings = [
            {
                code: 'source-unreadable',
                message: `"${filename}" begins an OPC text package that holds no readable part, `
                    + 'so none of this model was read.',
            },
        ];
    }
    return parsed;
}
// ---------------------------------------------------------------------------
// The modern `.mdl`: an OPC package in text framing
// ---------------------------------------------------------------------------
const PACKAGE_BEGIN = '__MWOPC_PACKAGE_BEGIN__';
// Each marker is matched WITH its leading newline, so only a marker at the start of
// a line counts. A part's own bytes may contain the literal text (an XML attribute
// value, a base64 run) and must not be mistaken for a boundary.
const NL_PART_BEGIN = '\n__MWOPC_PART_BEGIN__';
const NL_PACKAGE_END = '\n__MWOPC_PACKAGE_END__';
const PART_BEGIN_LEN = NL_PART_BEGIN.length - 1;
// How far in to look for the package marker before concluding this is a classic
// `.mdl`. It follows a banner line and a Model stub of a few properties, so it sits
// within the first few hundred bytes; 4 KB is slack for a long Description.
const SNIFF_BYTES = 4096;
const LF = 0x0a;
const CR = 0x0d;
function indexOfAscii(bytes, text, from, limit) {
    const first = text.charCodeAt(0);
    const end = Math.min(limit ?? bytes.length, bytes.length) - text.length;
    for (let i = from; i <= end; i++) {
        if (bytes[i] !== first)
            continue;
        let k = 1;
        while (k < text.length && bytes[i + k] === text.charCodeAt(k))
            k++;
        if (k === text.length)
            return i;
    }
    return -1;
}
/**
 * Split a modern `.mdl` into the OPC part map a `.slx` unzips to, or return null if
 * this is not a text package (i.e. it is a classic `.mdl`).
 *
 * Reports, in `warnings`, the part markers this scan could not turn into a part.
 * Those are the only losses the caller cannot see for itself: a part that makes it
 * into the map is handed to the same readers a `.slx` uses and reported by them,
 * whereas a header the scan gave up on leaves nothing behind at all.
 */
function decodeOpcTextPackage(bytes, warnings) {
    const begin = indexOfAscii(bytes, PACKAGE_BEGIN, 0, SNIFF_BYTES);
    if (begin < 0) {
        // Not a text package, so there is nothing here to be missing: a classic `.mdl`
        // has no part markers and is a complete file. Silent, and the caller's fall-back
        // to the grammar reader is a routing decision, not a failure.
        return null;
    }
    const parts = {};
    let at = indexOfAscii(bytes, NL_PART_BEGIN, begin);
    while (at >= 0) {
        const headerEnd = indexOfByte(bytes, LF, at + 1);
        if (headerEnd < 0) {
            // Truncated mid-header: the file ends inside the line that names the part, so
            // neither the part's path nor its bytes exist and nothing after this point can
            // be read either. No `part` on the warning because there is no name to give —
            // that is precisely what was lost.
            warnings.push({
                code: 'part-unreadable',
                message: `A part header at byte ${at + 1} of this OPC text package is cut off before its `
                    + 'path, so that part and anything after it were not read.',
            });
            break;
        }
        // `__MWOPC_PART_BEGIN__ /simulink/blockDiagram.json` — plus a trailing
        // ` BASE64` when the part is binary and was encoded to survive a text file.
        const header = decodeText(bytes.subarray(at + 1 + PART_BEGIN_LEN, headerEnd)).trim();
        const base64 = / BASE64$/.test(header);
        const path = (base64 ? header.slice(0, -' BASE64'.length) : header).trim().replace(/^\//, '');
        // A part runs from just after its header line to the byte before the newline
        // that introduces the next marker. That newline belongs to the FRAMING, not to
        // the part: the XML parts happen to end with one of their own (so the file shows
        // a blank line before the next header) while the JSON and mxarray parts do not,
        // and taking the framing newline as content corrupts both.
        const contentStart = headerEnd + 1;
        const next = nextBoundary(bytes, contentStart);
        let contentEnd = next < 0 ? bytes.length : next;
        if (next < 0 && contentEnd > contentStart && bytes[contentEnd - 1] === LF)
            contentEnd--;
        if (contentEnd > contentStart && bytes[contentEnd - 1] === CR)
            contentEnd--;
        const raw = bytes.subarray(contentStart, contentEnd);
        // `.slice()`, not the subarray: fflate hands every zip entry its own buffer, and
        // parseMxArray reaches through `entry.buffer`. A view into the whole `.mdl` would
        // give it the entire file to parse instead of the one part.
        if (path) {
            parts[path] = base64 ? decodeBase64(raw) : raw.slice();
        }
        else {
            // A header line that names no path. The bytes after it are a part of this
            // package — the marker says so — and there is no way to say which, so they are
            // dropped rather than stored under an invented key. Reported for the same reason
            // as the truncated header above: nothing downstream will ever see this part.
            warnings.push({
                code: 'part-unreadable',
                message: `A part header at byte ${at + 1} of this OPC text package names no path, `
                    + 'so the part that follows it was not read.',
            });
        }
        at = next < 0 ? -1 : indexOfAscii(bytes, NL_PART_BEGIN, next);
    }
    return parts;
}
function indexOfByte(bytes, byte, from) {
    for (let i = from; i < bytes.length; i++) {
        if (bytes[i] === byte)
            return i;
    }
    return -1;
}
// Where the current part stops: whichever comes first, the next part header or the
// end-of-package line. Returns the index of the introducing newline, or -1 if the
// file just stops (truncated — the part is then whatever is left).
function nextBoundary(bytes, from) {
    const part = indexOfAscii(bytes, NL_PART_BEGIN, from);
    const end = indexOfAscii(bytes, NL_PACKAGE_END, from);
    if (part < 0)
        return end;
    if (end < 0)
        return part;
    return Math.min(part, end);
}
// Base64, decoded here rather than through atob/Buffer: this package is consumed in
// both Node and a browser, and neither global is available in both.
const B64_VALUES = (function () {
    const table = new Int8Array(256).fill(-1);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    for (let i = 0; i < alphabet.length; i++) {
        table[alphabet.charCodeAt(i)] = i;
    }
    return table;
})();
function decodeBase64(bytes) {
    const out = new Uint8Array(Math.ceil((bytes.length * 3) / 4));
    let acc = 0;
    let bits = 0;
    let n = 0;
    for (let i = 0; i < bytes.length; i++) {
        // Anything outside the alphabet — the line breaks the encoder inserted, `=`
        // padding, stray CR — carries no bits and is simply not part of the stream.
        const value = B64_VALUES[bytes[i]];
        if (value < 0)
            continue;
        acc = (acc << 6) | value;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out[n++] = (acc >> bits) & 0xff;
        }
    }
    return out.slice(0, n);
}
function decodeText(buf) {
    return new TextDecoder().decode(buf);
}
const NAME_START_RE = /[A-Za-z_$]/;
const NAME_CHAR_RE = /[\w.$]/;
/**
 * Scan a classic `.mdl` into its brace tree.
 *
 * Iterative, with an explicit stack: a `.mdl` nests one level per subsystem and a
 * deep model would otherwise put the recursion depth of this scanner — and so the
 * stability of opening a file — in the hands of the file being opened.
 */
function parseClassicTree(text) {
    const root = { name: '', props: [], children: [] };
    const stack = [root];
    const c = { src: text, i: 0 };
    while (true) {
        skipSpace(c);
        if (c.i >= c.src.length)
            break;
        const ch = c.src[c.i];
        if (ch === '}') {
            c.i++;
            // An unmatched `}` cannot close the root; dropping it keeps the rest of the
            // file readable rather than reparenting everything after it.
            if (stack.length > 1)
                stack.pop();
            continue;
        }
        if (!NAME_START_RE.test(ch)) {
            // A value with no name in front of it: MATLAB writes these for the elements
            // of some Array blocks. Nothing here reads them, but they must be CONSUMED,
            // or the scanner would resynchronise in the middle of one.
            readValue(c);
            continue;
        }
        const name = readName(c);
        skipInlineSpace(c);
        if (c.src[c.i] === '{') {
            c.i++;
            const child = { name, props: [], children: [] };
            stack[stack.length - 1].children.push(child);
            stack.push(child);
            continue;
        }
        // A name alone on its line is a property with no value. Reading a value here
        // regardless would swallow the NEXT line, so the end of the line ends it.
        const value = atLineEnd(c) ? '' : readValue(c);
        stack[stack.length - 1].props.push({ name, value });
    }
    return root;
}
function skipSpace(c) {
    while (c.i < c.src.length) {
        const ch = c.src[c.i];
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
            c.i++;
        }
        else if (ch === '#') {
            // Not part of the classic grammar; this is the `# MathWorks OPC Text Package`
            // banner, reachable only if a modern `.mdl` lost its package marker and fell
            // through to here. Skipping the line beats reading it as a stray value.
            while (c.i < c.src.length && c.src[c.i] !== '\n')
                c.i++;
        }
        else {
            break;
        }
    }
}
function skipInlineSpace(c) {
    while (c.i < c.src.length && (c.src[c.i] === ' ' || c.src[c.i] === '\t'))
        c.i++;
}
function atLineEnd(c) {
    const ch = c.src[c.i];
    return c.i >= c.src.length || ch === '\n' || ch === '\r' || ch === '}';
}
function readName(c) {
    const start = c.i;
    while (c.i < c.src.length && NAME_CHAR_RE.test(c.src[c.i]))
        c.i++;
    return c.src.slice(start, c.i);
}
function readValue(c) {
    const ch = c.src[c.i];
    if (ch === '"')
        return readQuoted(c);
    if (ch === '[')
        return readBracketed(c);
    // A bare token: `off`, `7.8`, `DataTag0`. Taken to the end of the line rather
    // than to the next space, because that is what the value IS — the format puts
    // one property per line — and a bare value that happens to contain a space
    // therefore survives instead of being truncated.
    const start = c.i;
    while (c.i < c.src.length && c.src[c.i] !== '\n' && c.src[c.i] !== '\r')
        c.i++;
    return c.src.slice(start, c.i).trim();
}
/**
 * A quoted value, unescaped, with continuation lines folded in.
 *
 * MATLAB breaks a value longer than the model's MaxMDLFileLineLength into several
 * quoted chunks on consecutive lines, which are one value and must be concatenated —
 * the uuencoded model workspace arrives as ~15 of them. A following chunk is
 * unambiguous: every other thing that can appear here starts with a name or a brace.
 */
function readQuoted(c) {
    let out = '';
    for (;;) {
        c.i++; // past the opening quote
        while (c.i < c.src.length) {
            const ch = c.src[c.i];
            if (ch === '\\') {
                out += unescapeChar(c.src[c.i + 1]);
                c.i += 2;
                continue;
            }
            if (ch === '"')
                break;
            out += ch;
            c.i++;
        }
        c.i++; // past the closing quote
        const resume = c.i;
        skipSpace(c);
        if (c.src[c.i] === '"')
            continue;
        c.i = resume;
        return out;
    }
}
// The escapes MATLAB writes. `\\` matters more than it looks: the uuencode alphabet
// includes both `\` and `"`, so the model workspace does not decode at all unless
// these are undone before the uudecode. An escape this does not know keeps its
// backslash — inventing a character is worse than passing one through.
function unescapeChar(ch) {
    switch (ch) {
        case 'n':
            return '\n';
        case 'r':
            return '\r';
        case 't':
            return '\t';
        case '"':
            return '"';
        case '\\':
            return '\\';
        case undefined:
            return '';
        default:
            return '\\' + ch;
    }
}
// A bracket literal, brackets included, exactly as `.slx` records the same value in
// its `<P>` text. Nesting and quotes are tracked so a `]` inside either does not end
// it early.
function readBracketed(c) {
    const start = c.i;
    let depth = 0;
    while (c.i < c.src.length) {
        const ch = c.src[c.i];
        if (ch === '"') {
            readQuoted(c);
            continue;
        }
        if (ch === '[') {
            depth++;
        }
        else if (ch === ']') {
            depth--;
            c.i++;
            if (depth <= 0)
                break;
            continue;
        }
        c.i++;
    }
    return c.src.slice(start, c.i);
}
function prop(node, name) {
    if (!node)
        return null;
    for (const p of node.props) {
        if (p.name === name)
            return p.value;
    }
    return null;
}
function childNamed(node, name) {
    if (!node)
        return null;
    return node.children.find((ch) => ch.name === name) || null;
}
function childrenNamed(node, name) {
    if (!node)
        return [];
    return node.children.filter((ch) => ch.name === name);
}
function flatProps(node) {
    const out = {};
    for (const p of node.props)
        out[p.name] = p.value;
    return out;
}
// ---------------------------------------------------------------------------
// The classic `.mdl`: which encoding its bytes are in
// ---------------------------------------------------------------------------
//
// A classic `.mdl` RECORDS the character encoding it was saved in, as an ordinary
// property of its Model block:
//
//   Model {
//     Name                    "engine"
//     Version                 7.8
//     SavedCharacterEncoding  "Shift_JIS"
//
// and it has to be honoured, because before R2012 there was no expectation that a
// model file be UTF-8: `save_system` wrote block names, descriptions and creator
// names in whatever character set the platform was configured for. Decoding those
// bytes as UTF-8 regardless does not FAIL — UTF-8 decoding is lenient by default —
// it quietly substitutes U+FFFD for every byte it cannot make sense of, so a model
// from a Japanese or a Western European locale opens with mojibake where its labels
// should be. Shift_JIS costs more than legibility: its trail bytes reach down into
// ASCII, and `表` is 0x95 0x5C, whose second byte read as ASCII is a BACKSLASH. A
// name ending in that character therefore escapes its own closing quote, the quoted
// value runs on into the properties that follow it, and the file loses whole rows
// rather than just the spelling of a name.
//
// Only THIS flavour of file needs this, and the other places in the package that
// decode bytes were each examined rather than changed on the strength of the same
// headline:
//
//   - the modern `.mdl` above, the `.slx`, the binary `.sldd` and the `.prj` are OPC
//     packages of XML and JSON parts (the `.prj` reaches its XML through fflate's
//     strFromU8 rather than a TextDecoder, but that is UTF-8 too). An XML part
//     declares its own encoding in its declaration and JSON is UTF-8 by definition
//     (RFC 8259 s8.1); every part in this repo's corpus is UTF-8, so a re-decode path
//     for them would be a branch no fixture reaches, on a container already right.
//   - `.mat` char data names its encoding in the SUBELEMENT type, and miUTF16 /
//     miUINT16 are already decoded as UTF-16 rather than as UTF-8 (MatParser.ts).
//     Level 5 has no file-level encoding field to consult for the miINT8 case, so
//     there is nothing to read even if we wanted to.
//   - the MCOS metadata table holds property NAMES, which are MATLAB identifiers, but
//     also string-valued property values (McosParser resolves a flag-0 override out
//     of the same table) — so it is not ASCII by construction the way the names are.
//     What it has no trace of is an encoding: not in the payload, and not in either
//     container it is lifted out of. There is nothing to honour, so it stays UTF-8,
//     and the evidence that it should not be will be a fixture rather than an
//     argument.
//
// The awkward part is that the encoding cannot be read before the file is decoded,
// and the file cannot be decoded before the encoding is read. It comes out because
// every encoding a `.mdl` is realistically saved in — windows-125x, Shift_JIS,
// EUC-JP, GBK, Big5, ISO-8859-x, UTF-8 — agrees with ASCII on the bytes that spell
// `SavedCharacterEncoding "..."`. So the head of the file is decoded once as latin1,
// which maps every single byte to some character and can therefore neither throw nor
// lose the parameter, the label is read out of that, and only then is the whole
// buffer decoded for real.
//
// That same ASCII agreement is what makes re-decoding safe for the MODEL WORKSPACE,
// which travels through here as text: the uuencode alphabet is the bytes 0x20-0x5F,
// a range every candidate encoding leaves alone (Shift_JIS lead bytes start at 0x81),
// so the mxarray stream comes out of a re-decoded file identical to before. A label
// that does not agree with ASCII would silently corrupt it instead, which is the
// second thing the check at the end of decodeClassicText is there for.
// How far into the file to look for the parameter. It is a property of the Model
// block itself and sits within the first handful of lines of every file MATLAB
// writes, so this is generous rather than tight; a file that pushes it beyond the
// window reads as UTF-8, which is what it did before any of this existed.
const ENCODING_SNIFF_BYTES = 8192;
// Anchored at the start of a line, which is safe in this format in a way it would not
// be in free-form text: MATLAB escapes a newline inside a quoted value as the two
// characters `\n`, so nothing inside a Description can present itself as a property
// at the start of a line. The quotes are optional and the value runs to the end of
// the line, because a bare token is a legal value for any property in this grammar.
const SAVED_ENCODING_RE = /^[ \t]*SavedCharacterEncoding[ \t]+"?([^"\r\n]*)"?/m;
/**
 * Decode a classic `.mdl` under the encoding it says it was saved in, falling back to
 * UTF-8 whenever the file does not say, or says something that cannot be honoured.
 *
 * Falling back rather than failing is the contract this rests on. `SavedCharacterEncoding`
 * holds whatever string the saving platform called its character set, and a label
 * `TextDecoder` does not know is a RangeError out of the constructor — letting that
 * escape would turn "I cannot name this encoding" into "this file cannot be opened",
 * which is a strictly worse answer than reading the file the way we always did.
 */
function decodeClassicText(bytes) {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, ENCODING_SNIFF_BYTES));
    const label = (SAVED_ENCODING_RE.exec(head)?.[1] ?? '').trim();
    // Short-circuited rather than merely handled, so the file every fixture in this
    // repo is takes byte for byte the path it took before this function existed.
    if (!label || /^utf-?8$/i.test(label))
        return decodeText(bytes);
    let decoded;
    try {
        decoded = new TextDecoder(label).decode(bytes);
    }
    catch {
        return decodeText(bytes);
    }
    // The re-decode has to AGREE with the sniff about the ASCII the sniff was based on.
    // It does for every ASCII-compatible encoding, which is all of the ones a `.mdl` is
    // written in; it does not for a label naming a wide encoding (`UTF-16LE`), nor for
    // the handful the WHATWG encoding standard maps to its "replacement" decoder
    // (`ISO-2022-CN`, `HZ-GB-2312`), either of which turns the entire file into one
    // unreadable run — no braces, no Model node, and a file that used to open reported
    // as not a model at all. Checking that the parameter is still legible is what stops
    // honouring the file's own claim from being able to make it LESS readable than
    // ignoring that claim would have been.
    if (!SAVED_ENCODING_RE.test(decoded.slice(0, ENCODING_SNIFF_BYTES)))
        return decodeText(bytes);
    return decoded;
}
// ---------------------------------------------------------------------------
// The classic `.mdl`: from brace tree to the same model a `.slx` gives
// ---------------------------------------------------------------------------
function parseClassicMdl(bytes, filename) {
    // Only one reader in this flavour can lose anything: the brace grammar has no
    // self-declared lengths and no encodings inside it, so a property either is there or
    // is not, and a property a release could not write is a limit of the file. The model
    // workspace is the exception — it is an encoded binary stream inside the text — and
    // it is the only thing that fills this in.
    const warnings = [];
    const root = parseClassicTree(decodeClassicText(bytes));
    // A `.mdl` holds either a model or a library, and the body is the same either way.
    const model = childNamed(root, 'Model') || childNamed(root, 'Library');
    // Neither means this text is not a model, and saying so is the parser's job. This
    // is the LAST reader in the dispatch — bytes that are not a zip and not a text
    // package land here — so whatever a caller hands in that no reader understands
    // (a truncated `.slx`, a `.txt` renamed, random bytes) arrives as brace text with
    // no diagram in it. The grammar reader tolerates anything by design, so without
    // this guard every one of those cases returned a model with no blocks, no
    // references and no workspace: a host cannot tell that apart from a genuinely
    // empty model, and shows a table of empty sections reading "this model is empty"
    // where it should report a file it could not read.
    if (!model) {
        throw new Error(`Not a Simulink model: "${filename}" is not a zip package, not an OPC text ` +
            'package, and has no Model or Library block');
    }
    // The model's own name, needed to rewrite block paths — and read from the FILE
    // rather than the filename because an ExportToVersion renames the diagram after
    // its target (`engine.slx` exports to `engine_R2011b.mdl`, whose block paths all
    // begin `engine_R2011b/`).
    const modelName = prop(model, 'Name') || '';
    // The model workspace, for the case where it lives in a MAT file instead of in
    // the model. Same relationship the `.slx` reads out of blockDiagram.json.
    const externalDataSources = [];
    const wsFile = prop(model, 'WSSourceFileName');
    if (prop(model, 'WSDataSource') === 'MAT-File' && wsFile) {
        externalDataSources.push(wsFile);
    }
    return {
        name: filename,
        // A classic `.mdl` has no release string. It records a Simulink VERSION number
        // (`Version 7.8`), which is not the release a `.slx` names in its
        // coreProperties, and no table maps one to the other — so this stays empty
        // rather than reporting a release the file never claimed.
        release: '',
        creator: prop(model, 'Creator') || '',
        // `Fri Sep 04 10:15:32 2026`, where a `.slx` gives ISO 8601. Both are passed
        // through as written; neither format is reinterpreted here.
        lastModified: prop(model, 'LastModifiedDate') || '',
        // Also absent before R2012: a model had no UUID to record.
        uuid: prop(model, 'ModelUUID') || '',
        // R2011b cannot use a data dictionary and drops the link on export (with a
        // warning); R2017b keeps it. Absent means absent.
        dataDictionary: prop(model, 'DataDictionary') || null,
        modelReferences: classicModelReferences(model, modelName),
        externalDataSources,
        configSets: classicConfigSets(model),
        workspace: classicWorkspace(root, model, warnings),
        blockParamUsages: classicBlockParamUsages(model),
        // There are no OPC parts to hand back: this flavour is one flat text file, not
        // an archive. ModelNode treats both as nullable and falls back to a summary.
        rawContents: null,
        zipEntries: null,
        warnings,
    };
}
/**
 * The referenced models, as the `.slx` path reports them.
 *
 * `ModelRefBlockPath "engine/Child|plant"` packs both halves into one string. It is
 * split at the LAST `|`: a block name may contain one, a model name may not.
 */
function classicModelReferences(model, modelName) {
    const gi = childNamed(model, 'GraphicalInterface');
    const refs = [];
    for (const ref of childrenNamed(gi, 'ModelReference')) {
        const raw = prop(ref, 'ModelRefBlockPath');
        const cut = raw ? raw.lastIndexOf('|') : -1;
        if (!raw || cut < 0)
            continue;
        refs.push({ blockPath: rootRelativePath(raw.slice(0, cut), modelName), modelName: raw.slice(cut + 1) });
    }
    // R2014b and later ALSO list every reference as an ExternalFileReference, the
    // form a `.slx` keeps alongside its ModelReferences. The two agree, so this only
    // matters for a file that carries the second list and not the first.
    if (refs.length === 0) {
        for (const ext of childrenNamed(gi, 'ExternalFileReference')) {
            const name = prop(ext, 'Reference');
            if (!name || prop(ext, 'Type') !== 'MODEL_BLOCK')
                continue;
            refs.push({ blockPath: rootRelativePath(prop(ext, 'Path') || '', modelName), modelName: name });
        }
    }
    return refs;
}
// A `.slx` writes the root of a block path as the literal `$bdroot`; a classic
// `.mdl` writes the model's own name there. Same path, two spellings — and the
// exported name is not the model's original one, so the name recorded IN the file
// is the only prefix it is safe to strip.
function rootRelativePath(path, modelName) {
    if (!modelName)
        return path;
    if (path === modelName)
        return '$bdroot';
    if (path.startsWith(modelName + '/'))
        return '$bdroot/' + path.slice(modelName.length + 1);
    return path;
}
/**
 * The configuration sets, with the active one marked.
 *
 * They sit in the Model's `Array` whose `PropName` names the role it fills, and the
 * active one is a separate stub beside that array holding only a back-reference:
 *
 *   Array { Type "Handle" Dimension 2
 *           Simulink.ConfigSet { $ObjectID 3 ... Name "Configuration" }
 *           Simulink.ConfigSet { $ObjectID 4 ... Name "Fast" }
 *           PropName "ConfigurationSets" }
 *   Simulink.ConfigSet { $PropName "ActiveConfigurationSet" $ObjectID 3 }
 */
function classicConfigSets(model) {
    let activeId = null;
    for (const node of model.children) {
        if (prop(node, '$PropName') === 'ActiveConfigurationSet') {
            activeId = prop(node, '$ObjectID');
        }
    }
    const configs = [];
    for (const array of childrenNamed(model, 'Array')) {
        if (prop(array, 'PropName') !== 'ConfigurationSets')
            continue;
        for (const cs of array.children) {
            const name = prop(cs, 'Name');
            if (!name)
                continue;
            // The class is the node's own name — `Simulink.ConfigSet`, or
            // `Simulink.ConfigSetRef` for a set that lives elsewhere. The properties come
            // along because the `.slx` path hands over the whole config set too.
            //
            // Shaped as the JSON layout deliberately, so that `configSetIdentity` reads this
            // era with the branch it already has rather than gaining a fourth: in the classic
            // grammar the class is neither an attribute nor a field but the NODE NAME, and
            // this is the one place that difference has to be absorbed. The source property
            // is `WSVarName` in every release that wrote this format, which that helper
            // accepts alongside `SourceName`.
            const data = { _object_class: cs.name, _properties: flatProps(cs) };
            configs.push({
                name,
                active: activeId !== null && prop(cs, '$ObjectID') === activeId,
                data,
                ...configSetIdentity(data),
            });
        }
    }
    return configs;
}
// A block's identity is three ordinary properties here. In a `.slx` the same three
// are XML ATTRIBUTES of <Block> and so never reach the parameter loop at all —
// skipping them is what keeps the two flavours of one model reporting the same rows.
const BLOCK_IDENTITY_PROPS = new Set(['BlockType', 'Name', 'SID']);
function classicBlockParamUsages(model) {
    const usages = [];
    // Walk the DIAGRAM, not the whole tree: `BlockParameterDefaults` also holds nodes
    // named `Block` — one per block type, carrying that type's factory defaults and no
    // name — and a `.slx` has no equivalent section, so counting them would give a
    // `.mdl` rows that the same model's `.slx` never reports. Breadth-first, appending
    // each subsystem's own `System` as it is met, so nesting costs no recursion.
    const systems = childrenNamed(model, 'System');
    for (let s = 0; s < systems.length; s++) {
        for (const block of childrenNamed(systems[s], 'Block')) {
            // `"Two\nLines"` here, `Two&#xA;Lines` in the `.slx`; both normalise to one
            // flat label. The unescaping already happened in the scanner.
            const blockName = normalizeBlockName(prop(block, 'Name') || '');
            const blockType = prop(block, 'BlockType') || '';
            for (const p of block.props) {
                if (BLOCK_IDENTITY_PROPS.has(p.name))
                    continue;
                if (!isParamReference(p.name, p.value))
                    continue;
                usages.push({ blockName, blockType, paramProperty: p.name, paramValue: p.value });
            }
            for (const inner of childrenNamed(block, 'System'))
                systems.push(inner);
        }
    }
    return usages;
}
/**
 * The model workspace.
 *
 * A `.slx` keeps it in its own part; a classic `.mdl` keeps the very same mxarray
 * stream UUENCODED in a top-level MatData section, and the Model's `WSMdlFileData`
 * property names which record holds it:
 *
 *   Model   { ... WSMdlFileData "DataTag0" ... }
 *   MatData { NumRecords 1 DataRecord { Tag DataTag0 Data "<uuencoded>" } }
 *
 * `WSMdlFileData` is what makes the losses here reportable. A model with no such
 * property has no workspace stored in the file and has lost nothing; once the property
 * is there, the file has NAMED a record it holds, and every way of not arriving at that
 * record's variables is the file contradicting itself. Each of those warnings carries
 * the tag as its `part`, because the tag is how this format names that piece — there is
 * no path to give.
 */
function classicWorkspace(root, model, warnings) {
    const empty = [];
    empty._trailingElements = [];
    const tag = prop(model, 'WSMdlFileData');
    // No property, no claim: a model whose workspace was never populated simply does not
    // write one, and that is the common case rather than an error. Silent.
    if (!tag)
        return empty;
    const matData = childNamed(root, 'MatData');
    if (!matData) {
        warnings.push({
            code: 'part-unreadable',
            message: `This model's workspace is stored as record "${tag}", but the file has no MatData `
                + 'section, so its workspace variables were not read.',
            part: tag,
        });
        return empty;
    }
    let encoded = null;
    let found = false;
    for (const record of childrenNamed(matData, 'DataRecord')) {
        if (prop(record, 'Tag') === tag) {
            found = true;
            encoded = prop(record, 'Data');
            break;
        }
    }
    if (!encoded) {
        // Two shapes, one loss, so one message: no record carries the tag the model named,
        // or the record is there and its Data is empty. Both mean the named workspace is
        // not in the file, and neither is something a release ever wrote deliberately.
        warnings.push({
            code: 'part-unreadable',
            message: found
                ? `This model's workspace record "${tag}" holds no data, so its workspace `
                    + 'variables were not read.'
                : `This model's workspace is stored as record "${tag}", which the file's MatData `
                    + 'section does not contain, so its workspace variables were not read.',
            part: tag,
        });
        return empty;
    }
    const stream = uudecode(encoded);
    const { outer, trailingElements } = readMxArrayRecords(stream.buffer);
    if (!outer || !outer.fields) {
        // The record is present and decodes to something that is not an mxarray: wrong
        // magic, too short, or an outer element that is not a matrix. Unlike the `.slx`
        // mxarray part, an EMPTY workspace cannot land here — MATLAB writes no
        // `WSMdlFileData` at all in that case, so reaching this line means the uuencoded
        // stream itself did not survive.
        warnings.push({
            code: 'part-unreadable',
            message: `This model's workspace record "${tag}" does not decode to a workspace, so its `
                + 'variables were not read.',
            part: tag,
        });
        return empty;
    }
    // The classic record is NOT the struct-of-variables a `.slx` keeps: it is a 1xN
    // struct ARRAY of Name/Value pairs, one element per workspace variable. Same
    // bytes, same framing, different shape — so read the pairs off it instead of
    // mistaking the two field names for the two variables.
    //
    // A stream WITHOUT that pair is not a failure and does not warn: it is the `.slx`
    // struct-of-variables shape, which some files carry here, and `parseMxArray` reads it
    // correctly. A careless reader would warn on "the fields I expected are not there";
    // the fields being different is the format having two spellings, not a loss.
    if (!outer.fields.Name || !outer.fields.Value) {
        return parseMxArray(stream.buffer);
    }
    const result = [];
    result._trailingElements = trailingElements;
    const names = elementsOf(outer.fields.Name);
    const values = elementsOf(outer.fields.Value);
    for (let i = 0; i < names.length && i < values.length; i++) {
        const name = typeof names[i].value === 'string' ? names[i].value : '';
        if (!name)
            continue;
        values[i].name = name;
        result.push(values[i]);
    }
    return result;
}
// A struct field holds one MatVariable per element of a struct array — and the
// variable itself, not a one-element array, when the struct is 1x1. A model
// workspace with a single variable takes that second form.
function elementsOf(field) {
    return Array.isArray(field) ? field : [field];
}
/**
 * Undo the uuencoding of a MatData record: six bits per character, biased by 32,
 * most significant group first.
 *
 * This is the body encoding of historic `uuencode` without its per-line length
 * prefixes — MATLAB emits one unbroken run and lets the quoted-value wrapping do
 * the line breaking. Note that a SPACE encodes zero and is data, not padding: the
 * stream begins `\x00\x01IM`, which is written as two leading spaces.
 */
function uudecode(text) {
    const out = new Uint8Array(Math.ceil((text.length * 6) / 8));
    let acc = 0;
    let bits = 0;
    let n = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code === LF || code === CR)
            continue;
        acc = (acc << 6) | ((code - 32) & 0x3f);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out[n++] = (acc >> bits) & 0xff;
        }
    }
    // Exact-length, because readMxArrayRecords is handed `.buffer` and would
    // otherwise be given the slack bytes as part of the stream.
    return out.slice(0, n);
}
//# sourceMappingURL=MdlParser.js.map