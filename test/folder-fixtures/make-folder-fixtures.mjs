// Copyright 2026 The MathWorks, Inc.
// Generates the folder-scan fixtures: a small workspace of models, dictionaries and one
// MAT-file whose relationships are the cases the shared source cache (src/folder/) and the
// usage scope are tested over. Run: node test/folder-fixtures/make-folder-fixtures.mjs
//
// These came here from the vscode extension's test/fixtures/make-fixtures.mjs with the code
// that reads them, and the committed files are that repo's bytes: a rerun writes the same
// parts with new zip timestamps. Key names are derived from the real parsers, as in
// test/fixtures/make-fixtures.mjs.
//
// A folder of their own, and not test/fixtures, because the sweeps over that folder hold every
// compressed dictionary in it to MATLAB's own read-back of an edit and a save (the M9 truth, and
// binarySaveKeepsUnedited.test.ts). These were written by hand to be a WORKSPACE — chain_top.sldd
// holds a reference and no entry at all, on purpose — and were never asked of MATLAB.
import { zipSync, zlibSync, strToU8 } from 'fflate';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (name) => fileURLToPath(new URL(name, import.meta.url));

// --- model_with_refs.slx: references plant.slx + a dictionary + a .mat ---
const slxParts = {
  'simulink/blockDiagram.json': strToU8(
    JSON.stringify({ BlockDiagram: { DataDictionary: 'params.sldd', ModelUUID: 'uuid-1' } }),
  ),
  'simulink/graphicalInterface.json': strToU8(
    JSON.stringify({
      ModelReferences: [{ BlockPath: 'ctrl/plant', ModelName: 'plant.slx' }],
    }),
  ),
  'simulink/ExternalDataSourceSettings.xml': strToU8(
    `<?xml version="1.0"?><ExternalDataSourceSettings><ExplicitExternalBrokerSources><fullPathToSource>signals.mat</fullPathToSource></ExplicitExternalBrokerSources></ExternalDataSourceSettings>`,
  ),
  'metadata/coreProperties.xml': strToU8(
    `<?xml version="1.0"?><coreProperties><version>R2026b</version></coreProperties>`,
  ),
};
writeFileSync(here('model_with_refs.slx'), zipSync(slxParts));

// --- nd_numeric.mat: rank-3 and rank-4 numeric arrays for the Variable Editor ---
//
// A Level-5 MAT-file, written by hand because no .mat fixture existed and the
// N-D grid path (the `(:,:,k)` page selector) had no end-to-end coverage. Layout
// per The MathWorks' "MAT-File Format" reference: a 128-byte header, then one
// element per variable. Each variable is wrapped in miCOMPRESSED, which is what
// MATLAB's own `save` emits, so this exercises the same branch of parseMat that
// real files do.
//
// Every subelement here uses the full 8-byte tag form. MATLAB would use the
// "small data element" form for a name of four characters or fewer; the long form
// is equally valid and keeps this writer to one code path.

const MI_INT8 = 1;
const MI_INT32 = 5;
const MI_UINT32 = 6;
const MI_DOUBLE = 9;
const MI_MATRIX = 14;
const MI_COMPRESSED = 15;
const MX_DOUBLE_CLASS = 6;

const pad8 = (n) => (8 - (n % 8)) % 8;

// tag (type, byteCount) + data, with `padding` bytes of alignment after it.
function tagged(type, data, padding) {
  const out = new Uint8Array(8 + data.length + padding);
  new DataView(out.buffer).setUint32(0, type, true);
  new DataView(out.buffer).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}

// A subelement inside a matrix: padded to the next 8-byte boundary, as the format
// requires, so the reader can walk from one subelement tag to the next.
const subelement = (type, data) => tagged(type, data, pad8(data.length));

// A top-level miCOMPRESSED element: NOT padded. The 8-byte alignment rule covers
// uncompressed data elements; MATLAB writes compressed ones flush, and readers
// advance by exactly 8 + byteCount. Padding these cost an afternoon — the first
// variable parsed fine and every later one vanished, because the extra bytes threw
// the top-level walk off by the padding width and the next tag read as garbage.
const compressed = (data) => tagged(MI_COMPRESSED, data, 0);

const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const int32s = (values) => {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setInt32(i * 4, v, true));
  return out;
};

const float64s = (values) => {
  const out = new Uint8Array(values.length * 8);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setFloat64(i * 8, v, true));
  return out;
};

// `values` is COLUMN-MAJOR, the order MATLAB stores and this format requires.
function matrixElement(name, dimensions, values) {
  const flags = new Uint8Array(8);
  // Byte 0 is the class; byte 1 carries the complex/global/logical flags, all
  // clear here. Bytes 2-7 are undefined per the spec.
  flags[0] = MX_DOUBLE_CLASS;
  const payload = concat([
    subelement(MI_UINT32, flags),
    subelement(MI_INT32, int32s(dimensions)),
    subelement(MI_INT8, new TextEncoder().encode(name)),
    subelement(MI_DOUBLE, float64s(values)),
  ]);
  return subelement(MI_MATRIX, payload);
}

function matFile(description, elements) {
  const header = new Uint8Array(128);
  header.fill(0x20, 0, 124); // the text field is space-padded, not zero-padded
  header.set(new TextEncoder().encode(description).slice(0, 116), 0);
  const hv = new DataView(header.buffer);
  hv.setUint16(124, 0x0100, true); // version
  header[126] = 0x49; // 'I'
  header[127] = 0x4d; // 'M'  — little-endian indicator
  // Each variable compressed independently, exactly as `save` writes them.
  const wrapped = elements.map((el) => compressed(zlibSync(el)));
  return concat([header, ...wrapped]);
}

// Chosen so a positional read of the grid is visibly WRONG rather than plausible:
// page 1 must display as `1 2 3 / 4 5 6`, which in column-major storage is
// interleaved. Reading the bytes in order would render `1 3 5 / 2 4 6`.
const nd = matrixElement('Nd', [2, 3, 2], [1, 4, 2, 5, 3, 6, 7, 10, 8, 11, 9, 12]);
// Rank 4, so the pager has two trailing subscripts and must step dim 3 fastest:
// (:,:,1,1) (:,:,2,1) (:,:,1,2) (:,:,2,2). Each page is filled with its own
// number, which makes a mis-ordered pager obvious at a glance.
const nd4 = matrixElement(
  'Nd4',
  [2, 2, 2, 2],
  [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4],
);
// A plain 2-D matrix and a vector in the same file: the vector must show NO glyph,
// so the gate is visible side by side with the cases that pass it.
const mat2d = matrixElement('Mat', [2, 3], [1, 4, 2, 5, 3, 6]);
const vec = matrixElement('Vec', [1, 4], [1, 2, 3, 4]);
writeFileSync(
  here('nd_numeric.mat'),
  matFile('MATLAB 5.0 MAT-file, hand-built fixture for the Variable Editor', [
    mat2d,
    nd,
    nd4,
    vec,
  ]),
);

// --- params.sldd + shared_gain.slx: the two-model usage set -------------------
//
// A dictionary and a model that uses it, so the Usage path can be driven over real
// bytes instead of hand-written summaries (in the vscode extension a classic
// legacy_ctrl.mdl links the same `params.sldd`). What that needs, and nothing more:
//
//   params.sldd     the dictionary the models link, holding Kp, Uo and an UNUSED
//                   Ki (so "no answer" is covered by a real entry, not a fake one)
//   shared_gain.slx a SECOND model using the same Kp, so the cell has to name two
//                   models — the case a bare block name cannot express, and the one
//                   that regressed
//
// shared_gain.slx links the dictionary as `Params.SLDD`: a model records a link as
// the user typed it, so the case-insensitive match belongs in the real-file path
// too, not only in the integration suite.

// The __MW_TEXT_PARTS__ shape both .sldd formats deserialize to (see
// datamodel/parser/SlddContent.ts).
const jsonSldd = (entries, refs = []) =>
  JSON.stringify(
    {
      __MW_TEXT_COREPROPERTIES__: { release: 'R2026b' },
      __MW_TEXT_PARTS__: {
        '__MW_TEXT_PART__/data/chunk0': {
          __MW_TEXT_content: {
            entries: entries.map((name, i) => ({
              name,
              metadata: { uuid: `fixture-uuid-${name}`, isderived: '0' },
              value: i + 1,
            })),
            'Dictionary References': refs,
            AllowAccessBWS: '0',
          },
        },
      },
    },
    null,
    '\t',
  );
writeFileSync(here('params.sldd'), jsonSldd(['Kp', 'Uo', 'Ki']));

// `Gain`/`Value` are absent from SlxParser's NON_PARAM_PROPS and both values are
// expressions rather than literals, so extractBlockParamUsages records both. `2*Kp`
// is deliberately an expression: identifiersIn has to reduce it to `Kp`.
writeFileSync(
  here('shared_gain.slx'),
  zipSync({
    'simulink/blockDiagram.json': strToU8(
      JSON.stringify({
        BlockDiagram: {
          DataDictionary: 'Params.SLDD',
          ModelUUID: 'uuid-shared-gain',
          System: { Ref: 'system_root' },
        },
      }),
    ),
    'simulink/systems/system_root.xml': strToU8(
      `<?xml version="1.0" encoding="utf-8"?>` +
        `<System>` +
        `<Block BlockType="Gain" Name="PlantGain" SID="1"><P Name="Gain">Kp</P></Block>` +
        `<Block BlockType="Constant" Name="Trim" SID="2"><P Name="Value">2*Kp</P></Block>` +
        `</System>`,
    ),
    'metadata/coreProperties.xml': strToU8(
      `<?xml version="1.0"?><coreProperties><version>R2026b</version></coreProperties>`,
    ),
  }),
);

// --- shadow_ws.slx: a model workspace variable that SHADOWS a dictionary entry ---
//
// The third model of the usage set, and the one that pins shadowing over real bytes:
// it links `params.sldd` like the other two, but its own model workspace ALSO defines
// `Kp`. MATLAB resolves a name once — workspace first — so `WsGain` reads the
// workspace's `Kp` and the dictionary's `Kp` is not used by it at all.
//
// `DictOnly` is the control, and the reason this fixture has two blocks: it reads `Uo`,
// which only the dictionary defines, so the dictionary is provably linked and reachable
// from this model. Without it, an empty cell for `Kp` would be equally well explained by
// a dictionary link that failed to resolve — which is the bug NEXT DOOR to the one under
// test, and would pass a one-block fixture.
//
// The workspace is written as the pre-R2019b `simulink/modelworkspace.mat` part (a whole
// Level-5 MAT-file, which SlxParser routes to parseMat) rather than the newer
// `simulink/modelWorkspace.mxarray`, because a MAT-file is what the writer above already
// emits. Which part carries it is SlxParser's concern, and both arrive as
// `ParsedSlx.workspace`.
writeFileSync(
  here('shadow_ws.slx'),
  zipSync({
    'simulink/blockDiagram.json': strToU8(
      JSON.stringify({
        BlockDiagram: {
          DataDictionary: 'params.sldd',
          ModelUUID: 'uuid-shadow-ws',
          System: { Ref: 'system_root' },
        },
      }),
    ),
    'simulink/systems/system_root.xml': strToU8(
      `<?xml version="1.0" encoding="utf-8"?>` +
        `<System>` +
        `<Block BlockType="Gain" Name="WsGain" SID="1"><P Name="Gain">Kp</P></Block>` +
        `<Block BlockType="Constant" Name="DictOnly" SID="2"><P Name="Value">Uo</P></Block>` +
        `</System>`,
    ),
    'simulink/modelworkspace.mat': matFile('MATLAB 5.0 MAT-file, hand-built model workspace', [
      matrixElement('Kp', [1, 1], [7]),
    ]),
    'metadata/coreProperties.xml': strToU8(
      `<?xml version="1.0"?><coreProperties><version>R2026b</version></coreProperties>`,
    ),
  }),
);

// --- sid_blocks.slx: a block's identity is its SID, not its name ---------------
//
// The fourth model of the usage set, shaped after a shipped Simulink demo model, which
// is where both halves of this were found:
//
//   two blocks named `Gain`, in DIFFERENT systems (SIDs 15 and 24). A block name is
//   unique only within its own system, and that model has four `Gain` blocks; keyed by name
//   they collapsed into ONE row reading `Gain=Mq, Gain=Zw, Gain=Kf, Gain=Zw` and all
//   four shared the id `<model>.slx/blocks/Gain`. Here they read different variables
//   (`Kp` and `Ki`) precisely so a merge is visible: each row must show its own.
//
//   a block with NO name (SID 65). Simulink wrote its `Name` attribute as a lone line
//   break, which normalizes to the empty string, so it displayed as a blank Name, an
//   id of `<model>.slx/blocks/`, and an EMPTY Usage link the user could not click. It
//   reads `Uo` — the same parameter, and the same block, the user asked about.
//
// The nameless block is written as `&#xA;` rather than `Name=""`: that is the byte
// sequence in the real file, and an empty attribute would test a case Simulink does
// not actually produce.
//
// The subsystem carries its blocks in a `systems/system_1.xml` part of its own, as
// R2020a-and-later files do; the parts loop is what makes both systems reachable.
// `params.sldd` (Kp, Uo, Ki) is linked, so every parameter here resolves to a real
// entry in a real dictionary and the reverse direction has something to credit.
writeFileSync(
  here('sid_blocks.slx'),
  zipSync({
    'simulink/blockDiagram.json': strToU8(
      JSON.stringify({
        BlockDiagram: {
          DataDictionary: 'params.sldd',
          ModelUUID: 'uuid-sid-blocks',
          System: { Ref: 'system_root' },
        },
      }),
    ),
    'simulink/systems/system_root.xml': strToU8(
      `<?xml version="1.0" encoding="utf-8"?>` +
        `<System>` +
        `<Block BlockType="Gain" Name="Gain" SID="15"><P Name="Gain">Kp</P></Block>` +
        `<Block BlockType="SubSystem" Name="Inner" SID="61"><System Ref="system_1"/></Block>` +
        `</System>`,
    ),
    'simulink/systems/system_1.xml': strToU8(
      `<?xml version="1.0" encoding="utf-8"?>` +
        `<System>` +
        `<Block BlockType="Gain" Name="Gain" SID="24"><P Name="Gain">Ki</P></Block>` +
        `<Block BlockType="Constant" Name="&#xA;" SID="65"><P Name="Value">Uo</P></Block>` +
        `</System>`,
    ),
    'metadata/coreProperties.xml': strToU8(
      `<?xml version="1.0"?><coreProperties><version>R2026b</version></coreProperties>`,
    ),
  }),
);

// --- chain_*: a model whose dictionary chain runs THROUGH A COMPRESSED dictionary ---
//
// The set that pins the cheap tier's one real hazard. Scoping a Usage answer to "the models
// whose chain reaches this file" has to READ each dictionary's references to know what a
// chain reaches, and a compressed dictionary keeps its references inside a zip:
//
//   chain_model.slx  →  chain_top.sldd (ZIP)  →  chain_leaf.sldd  defines ChainVar
//
// Nothing in `chain_model.slx` names `chain_leaf.sldd`, and nothing in `chain_top.sldd`
// names it in plain text. So a tier that scraped references out of the bytes as text would
// report that `chain_top.sldd` inherits nothing, conclude no model reaches `chain_leaf.sldd`,
// and answer that `ChainVar` is unused — a WRONG answer, arrived at quickly, for the file the
// user is looking at. Reading a dictionary through core's own summariser (which is the same
// `scanSldd` either way, so it costs nothing extra) is what makes the link visible.
//
// `chain_top.sldd` deliberately defines no entry of its own: the only thing it contributes is
// the edge, so a test cannot pass by accidentally resolving the name somewhere closer.
writeFileSync(
  here('chain_top.sldd'),
  zipSync({
    'data/chunk0.xml': strToU8(
      `<?xml version="1.0" encoding="utf-8"?>` +
        `<DataSource FormatVersion="4" MinRelease="R2026b" Arch="glnxa64">` +
        `<Object Class="DD.DICTIONARYREFERENCE"><P Name="Subdictionary">chain_leaf.sldd</P></Object>` +
        `</DataSource>`,
    ),
    'metadata/mwcoreProperties.xml': strToU8(`<x><matlabRelease>R2026b</matlabRelease></x>`),
  }),
);

writeFileSync(here('chain_leaf.sldd'), jsonSldd(['ChainVar']));

writeFileSync(
  here('chain_model.slx'),
  zipSync({
    'simulink/blockDiagram.json': strToU8(
      JSON.stringify({
        BlockDiagram: {
          DataDictionary: 'chain_top.sldd',
          ModelUUID: 'uuid-chain-model',
          System: { Ref: 'system_root' },
        },
      }),
    ),
    'simulink/systems/system_root.xml': strToU8(
      `<?xml version="1.0" encoding="utf-8"?>` +
        `<System>` +
        `<Block BlockType="Gain" Name="ChainGain" SID="1"><P Name="Gain">ChainVar</P></Block>` +
        `</System>`,
    ),
    'metadata/coreProperties.xml': strToU8(
      `<?xml version="1.0"?><coreProperties><version>R2026b</version></coreProperties>`,
    ),
  }),
);

// --- shadow_pair_*: TWO dictionaries defining the same name, on one model's chain ---
//
// The other hazard in scoping a Usage answer, and the one a corpus otherwise has no case for.
// MATLAB resolves a name once, in order, first hit wins:
//
//   shadow_pair.slx  →  shadow_first.sldd  (defines PairVar)  ← the usage lands HERE
//                    →  shadow_second.sldd (defines PairVar)  ← and NOT here
//
// So opening `shadow_second.sldd` has to carry `shadow_first.sldd` into the set even though
// nothing about `shadow_second.sldd` names it. Left out, core cannot see what shadowed the
// name and moves the usage DOWN the order onto `shadow_second.sldd` — a usage the whole folder
// says it does not have. Which is a wrong answer in the harder direction: a cell that gained a
// user, not one that lost one.
//
// `shadow_first.sldd` is the linked dictionary and `shadow_second.sldd` an external data
// source, because that is how a model comes to have two dictionaries on one chain at all
// (`ModelSummary.slddRefs` = the linked one, then the externals).
writeFileSync(here('shadow_first.sldd'), jsonSldd(['PairVar']));
writeFileSync(here('shadow_second.sldd'), jsonSldd(['PairVar']));

writeFileSync(
  here('shadow_pair.slx'),
  zipSync({
    'simulink/blockDiagram.json': strToU8(
      JSON.stringify({
        BlockDiagram: {
          DataDictionary: 'shadow_first.sldd',
          ModelUUID: 'uuid-shadow-pair',
          System: { Ref: 'system_root' },
        },
      }),
    ),
    'simulink/ExternalDataSourceSettings.xml': strToU8(
      `<?xml version="1.0"?><ExternalDataSourceSettings><ExplicitExternalBrokerSources>` +
        `<fullPathToSource>shadow_second.sldd</fullPathToSource>` +
        `</ExplicitExternalBrokerSources></ExternalDataSourceSettings>`,
    ),
    'simulink/systems/system_root.xml': strToU8(
      `<?xml version="1.0" encoding="utf-8"?>` +
        `<System>` +
        `<Block BlockType="Gain" Name="PairGain" SID="1"><P Name="Gain">PairVar</P></Block>` +
        `</System>`,
    ),
    'metadata/coreProperties.xml': strToU8(
      `<?xml version="1.0"?><coreProperties><version>R2026b</version></coreProperties>`,
    ),
  }),
);
console.log(
  'wrote model_with_refs.slx, nd_numeric.mat, params.sldd, shared_gain.slx, shadow_ws.slx, sid_blocks.slx, ' +
    'chain_top.sldd, chain_leaf.sldd, chain_model.slx, shadow_first.sldd, shadow_second.sldd, shadow_pair.slx',
);
