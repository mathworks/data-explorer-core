// Copyright 2026 The MathWorks, Inc.
//
// The mask workspace: a masked subsystem's parameters, and the scope they put around the
// blocks inside it.
//
// Before this, a masked model's Usage cells were wrong in BOTH directions and for two
// unrelated reasons. `SlxParser` read only the direct `<P>` children of a `<Block>`, so
// `<Mask><MaskParameter><Value>g1_param</Value>` was never seen and the model-workspace
// variable `g1_param` collected no usage from anything. And `resolveName` knew three
// scopes, none of them the mask, so the inner `Gain`'s `Gain = g1` resolved to nothing and
// rendered as the bare unlinked text `g1` — a name that appears nowhere in the model
// workspace the user was looking at.
//
// The rules asserted here were MEASURED against `Simulink.findVars`, not derived from the
// file format: test/parity/matlab/gen_mask.m builds maskUsage.slx and records MATLAB's own
// answer beside it in mask_truth.json, and test/parity/matlab/probe_mask_types.m asks one
// parameter of every mask type whether MATLAB resolves its value. R2025a and R2027a agree
// on all of it. See src/datamodel/maskScope.ts, which states the four rules and cites the
// arm of the fixture each one comes from.
//
// The last describe is the one that matters most: it derives its expectations FROM
// mask_truth.json rather than restating them, so the suite fails if our answer stops being
// MATLAB's — including the two arms that are about what MATLAB does NOT credit.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { parseSlx } from '../src/datamodel/parser/SlxParser.js';
import { parseModel } from '../src/datamodel/parser/ModelParser.js';
import { isInsideBlockPath, blockKey, blockLabel, joinBlockPath } from '../src/datamodel/blockIdentity.js';
import { maskDefining } from '../src/datamodel/maskScope.js';
import { maskParamReferencesData } from './parity/paramPolicy.js';
import { buildUsageIndex } from '../src/index.js';
import type { ParamOrigin, UsageFile } from '../src/index.js';

function bytesOf(url: URL): ArrayBuffer {
  const u8 = new Uint8Array(readFileSync(fileURLToPath(url)));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

const fixture = (name: string): ArrayBuffer => bytesOf(new URL(`./fixtures/${name}`, import.meta.url));
const artifact = (rel: string): ArrayBuffer => bytesOf(new URL(`./parity/artifacts/${rel}`, import.meta.url));

// An in-memory `.slx` holding just the blocks given, optionally linking a dictionary — the
// builder blockParamUsages.test.ts and usageIndex.test.ts use, so these cases go through
// the REAL parser and the real summariser. A hand-built summary would hide a reader that
// looks at the wrong field.
function slxWithBlocks(blocksXml: string, dictionary?: string): ArrayBuffer {
  const diagram: Record<string, unknown> = { ModelUUID: 'u1' };
  if (dictionary) {
    diagram.DataDictionary = dictionary;
  }
  const zipped = zipSync({
    'simulink/blockDiagram.json': strToU8(JSON.stringify({ BlockDiagram: diagram })),
    'simulink/systems/system_root.xml': strToU8(
      `<?xml version="1.0" encoding="utf-8"?><System>${blocksXml}</System>`,
    ),
    'metadata/coreProperties.xml': strToU8(
      `<?xml version="1.0"?><coreProperties><version>R2026b</version></coreProperties>`,
    ),
  });
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

function slddBytes(names: string[]): ArrayBuffer {
  const u8 = strToU8(
    JSON.stringify({
      __MW_TEXT_PARTS__: {
        '__MW_TEXT_PART__/data/chunk0': {
          __MW_TEXT_content: {
            entries: names.map((name) => ({ name, class: 'Simulink.Parameter' })),
            'Dictionary References': [],
            AllowAccessBWS: false,
          },
        },
      },
    }),
  );
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

/** `<MaskParameter Name Type Evaluate><Value>…</Value></MaskParameter>`. */
function maskParam(name: string, value: string, type?: string, evaluate?: string): string {
  const attrs = [`Name="${name}"`];
  if (type !== undefined) {
    attrs.push(`Type="${type}"`);
  }
  if (evaluate !== undefined) {
    attrs.push(`Evaluate="${evaluate}"`);
  }
  return `<MaskParameter ${attrs.join(' ')}><Value>${value}</Value></MaskParameter>`;
}

/** A masked SubSystem whose own `<System>` is inline, which is how a package before R2020a nests. */
function masked(name: string, sid: string, params: string, inner: string): string {
  return (
    `<Block BlockType="SubSystem" Name="${name}" SID="${sid}">`
    + `<Mask><Display/>${params}</Mask>`
    + `<System>${inner}</System>`
    + `</Block>`
  );
}

const gain = (name: string, sid: string, value: string): string =>
  `<Block BlockType="Gain" Name="${name}" SID="${sid}"><P Name="Gain">${value}</P></Block>`;

/** `path|property=value` for every block parameter usage a parse found. */
function usageLines(bytes: ArrayBuffer, filename = 'm.slx'): string[] {
  return parseModel(bytes, filename).blockParamUsages.map(
    (u) => joinBlockPath(u.systemPath, blockLabel(u.blockName, u.sid)) + '|' + u.paramProperty + '=' + u.paramValue,
  );
}

/** `path|names` for every mask workspace a parse found. */
function maskLines(bytes: ArrayBuffer, filename = 'm.slx'): string[] {
  return parseModel(bytes, filename).masks.map((m) => m.blockPath + '|' + m.names.join(','));
}

// ---------------------------------------------------------------------------
// the parser: a mask parameter is a value here and a name there
// ---------------------------------------------------------------------------

describe('SlxParser — <Mask><MaskParameter> as block parameters of the masked block', () => {
  it('credits the mask parameter VALUE to the masked block, under the parameter name', () => {
    // The reverse direction, and the whole of the first defect: `g1_param` had no usage at
    // all because nothing ever read a `<Mask>`. MATLAB credits `maskUsage/MulAdd` — the
    // masked block, not the inner Gain — so the usage belongs on this row and the property
    // it appears under is the mask parameter's own name.
    const usages = parseSlx(
      slxWithBlocks(masked('MulAdd', '2', maskParam('g1', 'g1_param', 'edit'), gain('Gain', '3', 'g1'))),
      'm.slx',
    ).blockParamUsages;
    expect(usages).toEqual([
      {
        blockName: 'MulAdd',
        blockType: 'SubSystem',
        paramProperty: 'g1',
        paramValue: 'g1_param',
        sid: '2',
        // The system the MASKED BLOCK sits in, which is the scope its value is evaluated
        // in — one level out from the scope its name defines.
        systemPath: '',
      },
      {
        blockName: 'Gain',
        blockType: 'Gain',
        paramProperty: 'Gain',
        paramValue: 'g1',
        sid: '3',
        systemPath: 'MulAdd',
      },
    ]);
  });

  it('records the parameter NAMES as a scope at the masked block’s own path', () => {
    const masks = parseSlx(
      slxWithBlocks(masked('MulAdd', '2', maskParam('g1', 'g1_param'), gain('Gain', '3', 'g1'))),
      'm.slx',
    ).masks;
    expect(masks).toEqual([{ sid: '2', blockName: 'MulAdd', blockPath: 'MulAdd', names: ['g1'] }]);
  });

  it('credits a parameter no inner block reads — the mask dialog evaluates it anyway', () => {
    // R1. `g3 = g3_param` with nothing inside using `g3`: MATLAB still gives `g3_param` the
    // user `maskUsage/MulAdd`. A reader that collected mask values only when some inner
    // block referenced the parameter would lose this, and it is the common case for a mask
    // parameter wired to an icon or a callback.
    expect(usageLines(slxWithBlocks(masked('S', '1', maskParam('g3', 'g3_param'), gain('G', '2', '1'))))).toEqual([
      'S|g3=g3_param',
    ]);
  });

  it('credits only the expression-valued TYPES, and keeps every name in scope', () => {
    // R2, measured by probe_mask_types.m. `popupVar` is planted as a real variable name and
    // the popup's selected option is the same word — MATLAB resolves neither the popup nor
    // the checkbox. Both names are still IN SCOPE: a checkbox named `flag` hides a
    // model-workspace `flag` from the blocks inside just as an edit would.
    const bytes = slxWithBlocks(
      masked(
        'S',
        '1',
        maskParam('e', 'editVar', 'edit')
          + maskParam('s', 'sliderVar', 'slider')
          + maskParam('d', 'dialVar', 'dial')
          + maskParam('lo', 'minVar', 'min')
          + maskParam('hi', 'maxVar', 'max')
          + maskParam('mode', 'popupVar', 'popup')
          + maskParam('flag', 'checkboxVar', 'checkbox')
          + maskParam('c', 'comboVar', 'combobox')
          + maskParam('l', 'listVar', 'listbox')
          + maskParam('r', 'radioVar', 'radiobutton')
          + maskParam('u', 'unitVar', 'unit')
          + maskParam('p', 'promoteVar', 'promote'),
        gain('G', '2', '1'),
      ),
    );
    expect(usageLines(bytes)).toEqual([
      'S|e=editVar',
      'S|s=sliderVar',
      'S|d=dialVar',
      'S|lo=minVar',
      'S|hi=maxVar',
    ]);
    expect(maskLines(bytes)).toEqual(['S|e,s,d,lo,hi,mode,flag,c,l,r,u,p']);
  });

  it('does not credit a parameter with Evaluate="off", whose value is literal text', () => {
    // Measured (probe_evaluate.m): an `edit` valued `v_off` with Evaluate off gets no usage
    // where the same edit with Evaluate on does. The value is handed to the mask as the
    // string the user typed, so it names nothing however much it looks like a variable.
    const bytes = slxWithBlocks(
      masked('S', '1', maskParam('on', 'v_on', 'edit') + maskParam('off', 'v_off', 'edit', 'off'), gain('G', '2', '1')),
    );
    expect(usageLines(bytes)).toEqual(['S|on=v_on']);
    expect(maskLines(bytes)).toEqual(['S|on,off']);
  });

  it('applies the ordinary value gate: a numeric or on/off value is not a reference', () => {
    const bytes = slxWithBlocks(
      masked('S', '1', maskParam('g5', '5') + maskParam('flag', 'on') + maskParam('g', 'Kp'), gain('G', '2', '1')),
    );
    expect(usageLines(bytes)).toEqual(['S|g=Kp']);
    expect(maskLines(bytes)).toEqual(['S|g5,flag,g']);
  });

  it('does NOT apply the block-property blocklist to a mask parameter’s name', () => {
    // `Position` and `Units` are cosmetic as `<P>` properties of a block and are always
    // skipped there. A mask parameter's name is chosen by the mask's author, so the same
    // word carries none of that meaning — and a mask really named `Units` referring to
    // `unitTable` is a reference. This is why the gate is split in two.
    const bytes = slxWithBlocks(
      masked('S', '1', maskParam('Position', 'posVector') + maskParam('Units', 'unitTable'), gain('G', '2', '1')),
    );
    expect(usageLines(bytes)).toEqual(['S|Position=posVector', 'S|Units=unitTable']);
  });

  it('treats a MaskParameter with no Type as an edit', () => {
    // No MathWorks writer omits it, so a file that does is hand-made — and a hand-made mask
    // parameter means an edit. The alternative, skipping it, silently drops every
    // parameter of such a file.
    expect(usageLines(slxWithBlocks(masked('S', '1', maskParam('g', 'Kp'), gain('G', '2', '1'))))).toEqual([
      'S|g=Kp',
    ]);
  });

  it('reads the MaskParameter elements only, not the DialogControls beside them', () => {
    // A `<Mask>` also holds `<DialogControl Type="Edit" Name="g">` — the widget that
    // presents the parameter, carrying a Type of its own with a different spelling. A
    // document-wide search for `Type` would report the parameter twice.
    const bytes = slxWithBlocks(
      `<Block BlockType="SubSystem" Name="S" SID="1">`
        + `<Mask><Display/>${maskParam('g', 'Kp', 'edit')}`
        + `<DialogControl Type="Group" Name="ParameterGroupVar">`
        + `<DialogControl Type="Edit" Name="g"><Prompt/></DialogControl>`
        + `</DialogControl></Mask>`
        + `<System>${gain('G', '2', 'g')}</System>`
        + `</Block>`,
    );
    expect(usageLines(bytes)).toEqual(['S|g=Kp', 'S/G|Gain=g']);
    expect(maskLines(bytes)).toEqual(['S|g']);
  });

  it('records no scope for a mask that declares no parameters', () => {
    // A mask with only an icon is a real thing and defines no names. An entry with an empty
    // name list would be a scope that shadows nothing and costs a containment test per
    // block parameter.
    const bytes = slxWithBlocks(
      `<Block BlockType="SubSystem" Name="S" SID="1"><Mask><Display>plot(0)</Display></Mask>`
        + `<System>${gain('G', '2', 'Kp')}</System></Block>`,
    );
    expect(maskLines(bytes)).toEqual([]);
    expect(usageLines(bytes)).toEqual(['S/G|Gain=Kp']);
  });

  it('records one scope per mask when masks are nested, each at its own path', () => {
    const bytes = slxWithBlocks(
      masked(
        'Outer',
        '6',
        maskParam('o1', 'outer_param'),
        gain('OuterGain', '7', 'o1') + masked('Inner', '8', maskParam('i1', 'o1'), gain('Gain', '9', 'i1')),
      ),
    );
    expect(maskLines(bytes)).toEqual(['Outer|o1', 'Outer/Inner|i1']);
    // R4 read off the paths: `Inner`'s own parameter value sits at systemPath `Outer`, so it
    // is resolved OUTSIDE the mask it belongs to.
    expect(usageLines(bytes)).toEqual([
      'Outer|o1=outer_param',
      'Outer/OuterGain|Gain=o1',
      'Outer/Inner|i1=o1',
      'Outer/Inner/Gain|Gain=i1',
    ]);
  });
});

// ---------------------------------------------------------------------------
// the scope rule itself
// ---------------------------------------------------------------------------

describe('isInsideBlockPath — containment, with the `/` escape honoured', () => {
  it('holds for a block at the path and for one beneath it', () => {
    expect(isInsideBlockPath('Outer', 'Outer')).toBe(true);
    expect(isInsideBlockPath('Outer', 'Outer/Inner')).toBe(true);
    expect(isInsideBlockPath('Outer/Inner', 'Outer/Inner/Deeper')).toBe(true);
  });

  it('does not hold for a sibling, or outwards', () => {
    expect(isInsideBlockPath('Outer', 'Other')).toBe(false);
    expect(isInsideBlockPath('Outer', 'OuterGain')).toBe(false);
    expect(isInsideBlockPath('Outer/Inner', 'Outer')).toBe(false);
  });

  it('does not mistake a DOUBLED slash inside one name for a separator', () => {
    // `A//B/C` is a block `C` inside a block NAMED `a/b` — one segment. The naive
    // `startsWith(ancestor + '/')` says a mask on a sibling block `A` contains it, which
    // would credit a usage to a scope that does not hold the block at all.
    expect(isInsideBlockPath('A', 'A//B/C')).toBe(false);
    expect(isInsideBlockPath('A//B', 'A//B/C')).toBe(true);
  });

  it('treats the root as containing everything', () => {
    expect(isInsideBlockPath('', 'Outer/Inner')).toBe(true);
  });
});

describe('maskDefining — innermost mask wins', () => {
  const outer = { sid: '6', blockName: 'Outer', blockPath: 'Outer', names: ['o1'] };
  const inner = { sid: '8', blockName: 'Inner', blockPath: 'Outer/Inner', names: ['i1', 'o1'] };
  const other = { sid: '9', blockName: 'Other', blockPath: 'Other', names: ['o1'] };
  const masks = [outer, inner, other];

  it('takes the nearest enclosing mask that declares the name', () => {
    // R3. Both masks declare `o1`; a block inside `Inner` reads Inner's.
    expect(maskDefining(masks, 'Outer/Inner', 'o1')).toBe(inner);
    expect(maskDefining(masks, 'Outer', 'o1')).toBe(outer);
  });

  it('reaches outwards for a name the nearest mask does not declare', () => {
    expect(maskDefining(masks, 'Outer/Inner', 'i1')).toBe(inner);
    expect(maskDefining([outer, { ...inner, names: ['i1'] }], 'Outer/Inner', 'o1')).toBe(outer);
  });

  it('ignores a mask that does not enclose the block, however deep it is', () => {
    expect(maskDefining(masks, 'Other', 'i1')).toBeUndefined();
    expect(maskDefining(masks, '', 'o1')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// the index: the mask as a resolution scope
// ---------------------------------------------------------------------------

describe('buildUsageIndex — the mask workspace resolves first', () => {
  // A dictionary entry `shadowed` and a mask parameter of the same name, which is the
  // shadowing arm expressible without hand-writing a model workspace part.
  const files = (): UsageFile[] => [
    {
      srcId: 'm.slx',
      filename: 'm.slx',
      bytes: slxWithBlocks(
        masked(
          'S',
          '1',
          maskParam('g1', 'Kp') + maskParam('shadowed', '10'),
          gain('G', '2', 'g1') + gain('H', '3', 'shadowed'),
        ),
        'params.sldd',
      ),
    },
    { srcId: 'params.sldd', filename: 'params.sldd', bytes: slddBytes(['Kp', 'shadowed']) },
  ];

  it('resolves a name the mask defines to the MASKED BLOCK, not to a file', () => {
    // The second defect, fixed. `Gain = g1` used to resolve to nothing and render as bare
    // unlinked text; it now points at the mask that gives `g1` its value, which is the one
    // place a reader can go on from. `linkTarget` is the block's KEY here, not a name —
    // `kind` is what tells the two grammars apart.
    const [origin] = buildUsageIndex(files()).paramsOf('m.slx', '2');
    expect(origin).toEqual<ParamOrigin>({
      property: 'Gain',
      expression: 'g1',
      name: 'g1',
      kind: 'mask',
      originSrcId: 'm.slx',
      linkTarget: '1@m.slx',
      maskBlock: { sid: '1', blockName: 'S', blockPath: 'S', names: ['g1', 'shadowed'] },
    });
  });

  it('gives the mask parameter’s own value the ordinary origin, one scope out', () => {
    // `S`'s `g1 = Kp` is resolved where `S` sits, so it reaches the dictionary — the two
    // hops MATLAB models, seen from the near end.
    expect(buildUsageIndex(files()).paramsOf('m.slx', '1')).toEqual<ParamOrigin[]>([
      {
        property: 'g1',
        expression: 'Kp',
        name: 'Kp',
        kind: 'sldd',
        originSrcId: 'params.sldd',
        linkTarget: 'Kp@params.sldd',
        maskBlock: null,
      },
    ]);
  });

  it('credits the definition the mask SHADOWS with nothing', () => {
    // The inner `H` reads the mask's `shadowed`, whose value is `10`. The dictionary's
    // `shadowed` is not the value that block reads, so a usage against it is a claim about
    // a value that never arrives — the same rule a model workspace variable shadowing a
    // dictionary entry already followed, applied one scope further in. MATLAB withholds
    // exactly this credit on maskUsage.slx.
    expect(buildUsageIndex(files()).usagesOf('params.sldd', 'shadowed')).toEqual([]);
  });

  it('still credits the definition the mask parameter’s own value reaches', () => {
    expect(buildUsageIndex(files()).usagesOf('params.sldd', 'Kp').map((u) => u.blockPath)).toEqual(['S']);
  });
});

// ---------------------------------------------------------------------------
// against MATLAB
// ---------------------------------------------------------------------------

interface MaskTruth {
  model: string;
  vars: { name: string; sourceType: string; source: string; users: string[] }[];
  masks: { block: string; sid: string; names: string[]; values: string[]; types: string[] }[];
}

describe('maskUsage.slx — MATLAB’s own answer, from mask_truth.json', () => {
  const TRUTH: MaskTruth = JSON.parse(
    readFileSync(fileURLToPath(new URL('./fixtures/mask_truth.json', import.meta.url)), 'utf8'),
  );
  const SRC = 'maskUsage.slx';
  const parsed = parseSlx(fixture('maskUsage.slx'), SRC);
  const index = buildUsageIndex([{ srcId: SRC, filename: SRC, bytes: fixture('maskUsage.slx') }]);

  /** A MATLAB block path (`maskUsage/Outer/Inner`) as this package spells it (`Outer/Inner`). */
  const rel = (matlabPath: string): string =>
    matlabPath === TRUTH.model ? '' : matlabPath.slice(TRUTH.model.length + 1);

  // Every block the parse saw, by path — how a truth entry's block path is turned into the
  // key paramsOf is asked with.
  const keyByPath = new Map<string, string>(
    parsed.blockParamUsages.map((u) => [
      joinBlockPath(u.systemPath, blockLabel(u.blockName, u.sid)),
      blockKey(u.blockName, u.sid),
    ]),
  );

  it('finds the mask workspaces MATLAB reports, with the same names in the same order', () => {
    expect(parsed.masks.map((m) => `${m.blockPath} [${m.sid}] ${m.names.join(',')}`)).toEqual(
      TRUTH.masks.map((m) => `${rel(m.block)} [${m.sid}] ${m.names.join(',')}`),
    );
  });

  it('credits each MODEL WORKSPACE variable to exactly the blocks MATLAB credits', () => {
    // Derived, both ways round: a variable MATLAB lists with `sourceType: model workspace`
    // must have those users, and a variable it does not list that way must have NONE. The
    // second half is where the mask earns its keep — `shadowed` is a model workspace
    // variable read by name inside a mask that redefines it, and `popupVar` is one whose
    // spelling appears as a popup's selected option.
    const expected = new Map(
      TRUTH.vars
        .filter((v) => v.sourceType === 'model workspace')
        .map((v) => [v.name, v.users.map(rel).sort()] as const),
    );
    const actual = new Map(
      parsed.workspace.map(
        (v) => [v.name, index.usagesOf(SRC, v.name).map((u) => u.blockPath).sort()] as const,
      ),
    );
    expect([...actual].map(([name, paths]) => `${name}: ${paths.join(' ')}`)).toEqual(
      [...actual.keys()].map((name) => `${name}: ${(expected.get(name) ?? []).join(' ')}`),
    );
    // …and the fixture really does hold the two arms this is about.
    expect(expected.has('shadowed')).toBe(false);
    expect(expected.has('popupVar')).toBe(false);
    expect(parsed.workspace.map((v) => v.name)).toContain('shadowed');
    expect(parsed.workspace.map((v) => v.name)).toContain('popupVar');
  });

  it('resolves each MASK WORKSPACE user to the mask MATLAB names as its source', () => {
    // The forward direction, derived from the same list read the other way: for every
    // `sourceType: mask workspace` variable, each of its users must hold a parameter that
    // resolved to THAT mask. `maskUsage/Outer/Inner` appearing as a user of `Outer`'s `o1`
    // is R4 — a mask block reading its own parent's mask.
    const expected: string[] = [];
    const actual: string[] = [];
    for (const v of TRUTH.vars.filter((x) => x.sourceType === 'mask workspace')) {
      for (const user of v.users) {
        const key = keyByPath.get(rel(user));
        expect(key, `no block parsed at ${user}`).toBeDefined();
        const origin = index.paramsOf(SRC, key!).find((p) => p.name === v.name);
        expected.push(`${rel(user)} ${v.name} <- ${rel(v.source)}`);
        actual.push(
          `${rel(user)} ${v.name} <- ${origin?.kind === 'mask' ? origin.maskBlock?.blockPath : origin?.kind ?? 'unresolved'}`,
        );
      }
    }
    expect(actual.sort()).toEqual(expected.sort());
  });

  it('shows each mask parameter as a row of the masked block, expression-valued ones linked', () => {
    // The mask parameters EXPOSED, which is the other half of the feature: `MulAdd` had no
    // row at all before — a masked subsystem carries no ordinary `<P>` worth reporting — so
    // there was nowhere for `g1 = g1_param` to be seen. The rows come from MATLAB's own
    // MaskNames/MaskValues/Type triples put through the policy as paramPolicy states it,
    // never read off the parser: the two must agree independently.
    for (const mask of TRUTH.masks) {
      const expected = mask.names
        .map((name, i) => ({ name, value: mask.values[i], type: mask.types[i] }))
        // Everything gen_mask writes is evaluated; probe_evaluate.m covers the other case,
        // and the in-memory test above pins it.
        .filter((p) => maskParamReferencesData(p.type, 'on', p.value))
        .map((p) => `${p.name}=${p.value}`);
      const key = parsed.masks.find((m) => m.blockPath === rel(mask.block))!;
      const rows = index
        .paramsOf(SRC, blockKey(key.blockName, key.sid))
        .map((p) => `${p.property}=${p.expression}`);
      expect(rows, `parameters of ${mask.block}`).toEqual(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// one rule, two container formats
// ---------------------------------------------------------------------------

describe('mdlmask — a classic .mdl mask reads as its .slx twin does', () => {
  // The classic `.mdl` spells a mask as flat properties (`MaskVariables "g1=@1;"`,
  // `MaskStyleString`, `MaskValueString`) where a `.slx` has one element per parameter, so
  // the two readers are entirely separate code reaching for the same answer — the shape of
  // defect this repo keeps rediscovering. Both files were written by MATLAB R2025a from ONE
  // diagram (test/parity/matlab/gen_mask.m), so any difference in the rows is ours.
  //
  // It also pins the format's own gate: `MaskValueString` is an ordinary property here, so
  // before this the classic flavour credited the masked block ONE row reading
  // `MaskValueString = "g1_param|2*g2_param|g3_param|5|10|popupVar|on"` — every value
  // lumped together including the ones that are not expressions — where the `.slx` of the
  // same diagram credited nothing at all.
  const CLASSIC = 'mdl/mdlmask_R2011b.mdl';
  const SLX = 'mdl/mdlmask.slx';

  it('finds the same mask workspaces', () => {
    expect(maskLines(artifact(CLASSIC), 'mdlmask_R2011b.mdl')).toEqual(maskLines(artifact(SLX), 'mdlmask.slx'));
  });

  it('finds the same block parameter rows', () => {
    expect(usageLines(artifact(CLASSIC), 'mdlmask_R2011b.mdl').sort()).toEqual(
      usageLines(artifact(SLX), 'mdlmask.slx').sort(),
    );
  });

  it('resolves them the same way, mask origins included', () => {
    const originsOf = (rel_: string, name: string): string[] => {
      const bytes = artifact(rel_);
      const idx = buildUsageIndex([{ srcId: name, filename: name, bytes }]);
      const parse = parseModel(bytes, name);
      return parse.blockParamUsages
        .map((u) => {
          const path = joinBlockPath(u.systemPath, blockLabel(u.blockName, u.sid));
          const origins = idx
            .paramsOf(name, blockKey(u.blockName, u.sid))
            .map((p) => `${p.property}=${p.expression} -> ${p.kind}:${p.maskBlock?.blockPath ?? p.name}`);
          return `${path} ${origins.join(' ')}`;
        })
        .sort();
    };
    expect(originsOf(CLASSIC, 'mdlmask_R2011b.mdl')).toEqual(originsOf(SLX, 'mdlmask.slx'));
  });

  it('leaves no lumped MaskValueString row behind', () => {
    const props = usageLines(artifact(CLASSIC), 'mdlmask_R2011b.mdl').join('\n');
    expect(props).not.toContain('MaskValueString');
    expect(props).not.toContain('MaskVariables');
    expect(props).not.toContain('MaskStyleString');
  });
});
