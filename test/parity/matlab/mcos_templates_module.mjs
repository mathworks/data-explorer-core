// Copyright 2026 The MathWorks, Inc.
//
// Turns gen_mcos_templates.m's output into src/datamodel/parser/mcosTemplates.ts, the templates
// core creates an MCOS object in a MAT-file from, and copies the truth next to the generator.
//
//   node test/parity/matlab/mcos_templates_module.mjs <the generator's outdir>
//
// Per class the module holds the template file's subsystem record as MATLAB compressed it
// (base64), the object reference its variable holds (dims, ids, class row) and the name that
// variable shows; for the whole set, the release and the saved-property orders. Nothing else of
// the file is kept: its header (a date and a platform) and its variable's name are not needed.
//
// Every record is inflated and searched before anything is written: a path or this machine's
// account name in a template would ship in a public package inside base64, where neither a
// grep nor the leak check could see it.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const outdir = process.argv[2];
if (!outdir) {
  console.error('usage: node mcos_templates_module.mjs <the generator outdir>');
  process.exit(2);
}
const HERE = fileURLToPath(new URL('.', import.meta.url));
const MODULE = join(HERE, '..', '..', '..', 'src', 'datamodel', 'parser', 'mcosTemplates.ts');
const truthText = readFileSync(join(outdir, 'mcos_templates.truth.json'), 'utf8');
const truth = JSON.parse(truthText);

const account = userInfo().username;
const LEAKS = [/\/Users\/[A-Za-z0-9._-]+/, /\/home\/[A-Za-z0-9._-]+/, /\/tmp\//, /\/private\//, /[A-Za-z]:\\/, /sandbox/i, new RegExp(account, 'i')];

function searched(bytes, where) {
  const b = Buffer.from(bytes);
  for (const view of [b.toString('latin1'), b.subarray(0, b.length & ~1).toString('utf16le'), b.subarray(1, 1 + ((b.length - 1) & ~1)).toString('utf16le')]) {
    for (const re of LEAKS) {
      const m = re.exec(view);
      if (m) throw new Error(`${where} holds ${JSON.stringify(m[0])}: not shipped`);
    }
  }
  return bytes;
}

/** The records after the 128-byte header: { at, type, payload (as stored), element (inflated) }. */
function records(file) {
  const d = readFileSync(file);
  const out = [];
  for (let at = 128; at + 8 <= d.length; ) {
    const type = d.readUInt32LE(at);
    const size = d.readUInt32LE(at + 4);
    const payload = d.subarray(at + 8, at + 8 + size);
    const element = type === 15 ? inflateSync(payload) : d.subarray(at, at + 8 + size);
    out.push({ at, type, payload, element: searched(element, `${file} record at ${at}`) });
    at += 8 + size + (type === 15 ? 0 : (8 - (size % 8)) % 8);
  }
  return { header: d, records: out };
}

/** The sub-elements of an miMATRIX element: [{ type, bytes, at, end }], `at`/`end` its whole extent. */
function subs(element) {
  const out = [];
  const end = 8 + element.readUInt32LE(4);
  for (let p = 8; p < end; ) {
    const word = element.readUInt32LE(p);
    if (word >>> 16) {
      out.push({ type: word & 0xffff, bytes: element.subarray(p + 4, p + 4 + (word >>> 16)), at: p, end: p + 8 });
      p += 8;
    } else {
      const n = element.readUInt32LE(p + 4);
      const next = p + 8 + n + ((8 - (n % 8)) % 8);
      out.push({ type: word, bytes: element.subarray(p + 8, p + 8 + n), at: p, end: next });
      p = next;
    }
  }
  return out;
}

/** A class-17 variable element: the class name it shows and the object reference it holds. */
function objectVariable(element) {
  const [flags, , kind, cls, ref] = subs(element);
  if (flags.bytes[0] !== 17 || kind.bytes.toString('latin1') !== 'MCOS' || !ref) {
    throw new Error('the template variable is not an MCOS object');
  }
  const words = subs(element.subarray(ref.at, ref.end))[3].bytes;
  const w = [];
  for (let i = 0; i < words.length; i += 4) w.push(words.readUInt32LE(i));
  if (w[0] !== 0xdd000000) throw new Error('the template variable holds no object reference');
  const nd = w[1];
  const dims = w.slice(2, 2 + nd);
  const numel = dims.reduce((a, x) => a * x, 1);
  return { className: cls.bytes.toString('latin1'), dims, ids: w.slice(2 + nd, 2 + nd + numel), classIndex: w[2 + nd + numel] };
}

const templates = [];
for (const t of truth.templates) {
  const file = join(outdir, t.file);
  const { header, records: recs } = records(file);
  const subAt = Number(header.readBigUInt64LE(116));
  const sub = recs.find((r) => r.at === subAt);
  const vars = recs.filter((r) => r.at !== subAt);
  if (!sub || sub.type !== 15 || vars.length !== 1) throw new Error(`${file}: not one compressed variable and a compressed subsystem`);
  const ref = objectVariable(vars[0].element);
  if (ref.className !== t.class) throw new Error(`${file}: the variable shows ${ref.className}, the truth says ${t.class}`);
  templates.push({ className: t.class, variableClass: ref.className, dims: ref.dims, ids: ref.ids, classIndex: ref.classIndex, subsystem: Buffer.from(sub.payload).toString('base64') });
}

const order = Object.fromEntries(Object.entries(truth.savedOrder).map(([k, v]) => [k.replace(/__/g, '.'), Array.isArray(v) ? v : [v]]));

// A TypeScript literal in the repo's style: single quotes, a space after each comma.
const q = (text) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const list = (xs) => `[${xs.map((x) => (typeof x === 'string' ? q(x) : String(x))).join(', ')}]`;

const lines = [];
lines.push('// Copyright 2026 The MathWorks, Inc.');
lines.push('//');
lines.push('// GENERATED by test/parity/matlab/mcos_templates_module.mjs from gen_mcos_templates.m, run in');
lines.push(`// MATLAB ${truth.version}. Do not edit: regenerate (test/parity/matlab/README.md).`);
lines.push('//');
lines.push('// Per class, the subsystem record of a MAT-file holding one default-constructed object of it, as');
lines.push("// MATLAB compressed it (base64), and the object reference the file's one variable holds.");
lines.push('');
lines.push('/** The release the templates were saved by: what an object merged from them looks saved by. */');
lines.push(`export const MCOS_TEMPLATE_RELEASE = ${q('R' + truth.release)};`);
lines.push(`export const MCOS_TEMPLATE_VERSION = ${q(truth.version)};`);
lines.push('');
lines.push('export interface McosTemplateAsset {');
lines.push('  // The class the variable shows, and the object reference it holds into the subsystem.');
lines.push('  variableClass: string;');
lines.push('  dims: readonly number[];');
lines.push('  ids: readonly number[];');
lines.push('  classIndex: number;');
lines.push("  // The zlib stream of the file's subsystem record: the uint8 [1 N] element, deflated.");
lines.push('  subsystem: string;');
lines.push('}');
lines.push('');
lines.push('export const MCOS_TEMPLATES: Readonly<Record<string, McosTemplateAsset>> = {');
for (const t of templates) {
  lines.push(`  ${q(t.className)}: {`);
  lines.push(`    variableClass: ${q(t.variableClass)},`);
  lines.push(`    dims: ${list(t.dims)},`);
  lines.push(`    ids: ${list(t.ids)},`);
  lines.push(`    classIndex: ${t.classIndex},`);
  lines.push('    subsystem:');
  const chunks = t.subsystem.match(/.{1,96}/g);
  chunks.forEach((c, i) => lines.push(`      '${c}'${i === chunks.length - 1 ? ',' : ' +'}`));
  lines.push('  },');
}
lines.push('};');
lines.push('');
lines.push('/**');
lines.push(" * Per class the templates hold an MCOS object of, the order that release saves its properties in:");
lines.push(' * metaclass PropertyList order without Transient, Dependent and Constant properties.');
lines.push(' */');
lines.push('export const MCOS_SAVED_ORDER: Readonly<Record<string, readonly string[]>> = {');
for (const [k, v] of Object.entries(order).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
  lines.push(`  ${q(k)}: ${list(v)},`);
}
lines.push('};');
lines.push('');
writeFileSync(MODULE, lines.join('\n'));
writeFileSync(join(HERE, 'mcos_templates.truth.json'), truthText);
console.log(`MCOS_TEMPLATES_MODULE ${templates.length} templates from ${truth.version} -> ${MODULE}`);
