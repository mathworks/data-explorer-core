// src/datamodel/parser/ChunkLayout.ts
// Copyright 2026 The MathWorks, Inc.
//
// THE LAYOUT OF A CHUNK, FOR WHAT A SAVE WRITES INTO IT FROM THE MODEL.
//
// The writers lay out what they write with LF line ends and four spaces a level, an entry
// at one level inside `<DataSource>`. A save that keeps the file's own frame
// (BinarySlddSerializer) writes an edited or added entry, and regenerated dictionary-level
// objects, into a file that may be laid out otherwise: one dictionary in the local corpus
// is CRLF with two spaces a level, and two fixtures are written on one line. Written in the
// writers' layout, those entries made a file of two layouts: renaming one entry of the CRLF
// dictionary left 44 of its 50 lines ending in a bare LF.
//
// So what the writers wrote is laid out as the file is, here, before it goes in. Only the
// whitespace BETWEEN tags is layout. The text of a value is the value's, line breaks and
// leading spaces and all, and is never touched: that is any text that is not whitespace, and
// any whitespace that is the whole content of an element (between its open tag and its own
// close tag), which a reader can keep as the value.
/** The layout the writers write in. Text in it is laid out as they write it, untouched. */
export const WRITER_LAYOUT = Object.freeze({ nl: '\n', base: '    ', unit: '    ' });
/**
 * The layout of a chunk, read off the `<Object>` that starts at `at`: the line end and
 * indentation before it, and the indentation of the first line inside it. The writers' own
 * layout is `WRITER_LAYOUT` itself; null when the chunk does not show one this can follow
 * (no object, an object with nothing inside it, tabs and spaces mixed, a line end that
 * changes from one to the next), and what is written then is the writers' text as it is.
 */
export function layoutOf(xml, at) {
    if (at < 0 || !xml.startsWith('<Object', at)) {
        return null;
    }
    const before = trailingSpace(xml, at);
    const inside = xml.indexOf('>', at) + 1;
    if (inside <= 0 || xml.charCodeAt(inside - 2) === 0x2f) {
        return null;
    }
    let end = inside;
    while (end < xml.length && isSpace(xml.charCodeAt(end)))
        end++;
    const first = xml.substring(inside, end);
    if (xml.startsWith('</', end)) {
        return null;
    }
    const outer = split(before);
    const inner = split(first);
    if (!outer || !inner || outer.nl !== inner.nl || !inner.indent.startsWith(outer.indent)) {
        return null;
    }
    const unit = inner.indent.substring(outer.indent.length);
    if (outer.nl === '' ? unit !== '' || outer.indent !== '' : unit === '') {
        return null;
    }
    if (outer.nl === WRITER_LAYOUT.nl && outer.indent === WRITER_LAYOUT.base && unit === WRITER_LAYOUT.unit) {
        return WRITER_LAYOUT;
    }
    return { nl: outer.nl, base: outer.indent, unit };
}
/**
 * Text the writers wrote, laid out in `layout`: every run of whitespace between two tags
 * that is one LF and four spaces a level becomes the layout's line end and its indentation
 * for that level. A run that is the whole content of an element, and any run of another
 * shape, is left as it is; so is text with a comment or CDATA section in it, which the
 * writers do not write. `WRITER_LAYOUT` returns the text itself.
 */
export function inLayout(xml, layout) {
    if (layout === WRITER_LAYOUT || xml.indexOf('<!') >= 0) {
        return xml;
    }
    // The writers escape `<` and `>` in every text and attribute they write (escapeXml), so
    // each `<…>` is one tag and what lies between two of them is text.
    const tag = /<[^<>]*>/g;
    let out = '';
    let last = 0;
    let previous = null;
    for (let m = tag.exec(xml); m !== null; m = tag.exec(xml)) {
        const between = xml.substring(last, m.index);
        out += previous !== null && isLayoutRun(between) && !(opens(previous) && m[0].startsWith('</'))
            ? layout.nl + indentAt(layout, (between.length - 1) / 4)
            : between;
        out += m[0];
        previous = m[0];
        last = tag.lastIndex;
    }
    return out + xml.substring(last);
}
function indentAt(layout, level) {
    return level === 0 ? '' : layout.base + layout.unit.repeat(level - 1);
}
// One LF, then four spaces a level: the only whitespace the writers put between two tags.
function isLayoutRun(text) {
    if (text.length === 0 || text.charCodeAt(0) !== 0x0a || (text.length - 1) % 4 !== 0) {
        return false;
    }
    for (let i = 1; i < text.length; i++) {
        if (text.charCodeAt(i) !== 0x20) {
            return false;
        }
    }
    return true;
}
// An open tag, which a close tag straight after it (with only whitespace between) closes.
function opens(tag) {
    return !tag.startsWith('</') && !tag.startsWith('<?') && !tag.endsWith('/>');
}
function isSpace(c) {
    return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
}
function trailingSpace(xml, end) {
    let start = end;
    while (start > 0 && isSpace(xml.charCodeAt(start - 1)))
        start--;
    return xml.substring(start, end);
}
// A run of whitespace as a line end and the indentation after it: '' and '' for no run at
// all, and null for one with more than one line end, a line end other than LF or CRLF, or
// tabs and spaces mixed in its indentation.
function split(run) {
    const lf = run.lastIndexOf('\n');
    if (lf < 0) {
        return run === '' ? { nl: '', indent: '' } : null;
    }
    const crlf = lf > 0 && run.charCodeAt(lf - 1) === 0x0d;
    const nl = crlf ? '\r\n' : '\n';
    const head = run.substring(0, lf - (crlf ? 1 : 0));
    if (head.indexOf('\n') >= 0 || head.indexOf('\r') >= 0) {
        return null;
    }
    const indent = run.substring(lf + 1);
    if (indent.indexOf('\r') >= 0 || (indent.indexOf(' ') >= 0 && indent.indexOf('\t') >= 0)) {
        return null;
    }
    return { nl, indent };
}
//# sourceMappingURL=ChunkLayout.js.map