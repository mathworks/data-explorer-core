// Copyright 2026 The MathWorks, Inc.
// Regression tests for block-parameter extraction (issue #9): the parser must
// capture parameter references from ANY block type, not just a hardcoded allowlist
// of Gain/Value/... props. A TransferFcn keeps its coefficients in
// Numerator/Denominator; those blocks used to be dropped entirely, so they never
// appeared as Modeling Elements and the workspace variables they referenced showed
// empty Usage. The fix scans every non-cosmetic <P> and keeps values that contain
// an identifier (so operator-only patterns like a Sum's `Inputs=|++` stay out).
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseSlx } from '../src/datamodel/parser/SlxParser.js';

// Build an in-memory .slx with a single systems file holding the given <Block>
// XML. Only the pieces parseSlx reads for block params are included.
function slxWithBlocks(blocksXml: string): ArrayBuffer {
  const parts: Record<string, Uint8Array> = {
    'simulink/blockDiagram.json': strToU8(JSON.stringify({ BlockDiagram: { ModelUUID: 'u1' } })),
    'simulink/systems/system_root.xml': strToU8(
      `<?xml version="1.0" encoding="utf-8"?><System>${blocksXml}</System>`,
    ),
    'metadata/coreProperties.xml': strToU8(`<?xml version="1.0"?><coreProperties><version>R2026b</version></coreProperties>`),
  };
  const zipped = zipSync(parts);
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

function usagesFor(blocksXml: string) {
  return parseSlx(slxWithBlocks(blocksXml), 'm.slx').blockParamUsages;
}

describe('block param usage extraction (blocklist + identifier gate)', () => {
  it('captures a TransferFcn Numerator/Denominator (not on the old allowlist)', () => {
    const usages = usagesFor(
      `<Block BlockType="TransferFcn" Name="Filt" SID="1">` +
        `<P Name="Numerator">[1,W1]</P><P Name="Denominator">[Tal,1]</P>` +
        `</Block>`,
    );
    expect(usages).toEqual([
      { blockName: 'Filt', blockType: 'TransferFcn', paramProperty: 'Numerator', paramValue: '[1,W1]', sid: '1', systemPath: '' },
      { blockName: 'Filt', blockType: 'TransferFcn', paramProperty: 'Denominator', paramValue: '[Tal,1]', sid: '1', systemPath: '' },
    ]);
  });

  it('still captures a Gain param (allowlist behavior preserved)', () => {
    const usages = usagesFor(`<Block BlockType="Gain" Name="G1" SID="1"><P Name="Gain">Mq</P></Block>`);
    expect(usages).toEqual([
      { blockName: 'G1', blockType: 'Gain', paramProperty: 'Gain', paramValue: 'Mq', sid: '1', systemPath: '' },
    ]);
  });

  it('captures an expression that contains an identifier (1/Uo)', () => {
    const usages = usagesFor(`<Block BlockType="Gain" Name="G" SID="1"><P Name="Gain">1/Uo</P></Block>`);
    expect(usages).toHaveLength(1);
    expect(usages[0].paramValue).toBe('1/Uo');
  });

  it("drops a Sum's operator-only Inputs pattern (|++) — no identifier, not a data ref", () => {
    const usages = usagesFor(`<Block BlockType="Sum" Name="S1" SID="1"><P Name="Inputs">|++</P></Block>`);
    expect(usages).toEqual([]);
  });

  it('drops purely numeric param values (Gain=22.8)', () => {
    const usages = usagesFor(`<Block BlockType="Gain" Name="G" SID="1"><P Name="Gain">22.8</P></Block>`);
    expect(usages).toEqual([]);
  });

  it('drops cosmetic/structural props even when they hold identifier-like text', () => {
    const usages = usagesFor(
      `<Block BlockType="Gain" Name="G" SID="1">` +
        `<P Name="Position">[35, 180, 65, 210]</P>` +
        `<P Name="FontName">Arial</P>` +
        `<P Name="OutDataTypeStr">Inherit: Inherit via internal rule</P>` +
        `<P Name="Gain">Kp</P>` +
        `</Block>`,
    );
    // Only the real parameter (Gain=Kp) survives; Position/FontName/OutDataTypeStr
    // are on the non-param skip list.
    expect(usages).toEqual([
      { blockName: 'G', blockType: 'Gain', paramProperty: 'Gain', paramValue: 'Kp', sid: '1', systemPath: '' },
    ]);
  });

  it('drops on/off toggle values', () => {
    const usages = usagesFor(`<Block BlockType="Gain" Name="G" SID="1"><P Name="SomeFlag">on</P></Block>`);
    expect(usages).toEqual([]);
  });

  // REGRESSION. A non-finite limit is a NUMBER, not a reference to a workspace
  // variable — but the filter compared against the three LOWERCASE spellings only,
  // so exactly the spellings MATLAB itself writes (`Inf`, `-Inf`, `NaN`) slipped
  // through the identifier gate. Every Saturation/Limit block in a real model then
  // reported a phantom usage of a variable named "Inf", and the Usage column of an
  // actual variable could show a block that never referenced it.
  it('drops non-finite limits in every MATLAB spelling, not just lowercase', () => {
    for (const v of ['inf', 'Inf', 'INF', '-inf', '-Inf', '+inf', 'nan', 'NaN', 'NAN']) {
      expect(
        usagesFor(`<Block BlockType="Saturate" Name="S" SID="1"><P Name="UpperLimit">${v}</P></Block>`),
      ).toEqual([]);
    }
  });

  it('still treats Infinity as an identifier — MATLAB cannot evaluate it', () => {
    // 'Infinity' is the JavaScript name; in MATLAB it can only be a variable, so it
    // stays a usage. This is what the anchors on the non-finite pattern buy.
    const usages = usagesFor(`<Block BlockType="Gain" Name="G" SID="1"><P Name="Gain">Infinity</P></Block>`);
    expect(usages).toEqual([
      { blockName: 'G', blockType: 'Gain', paramProperty: 'Gain', paramValue: 'Infinity', sid: '1', systemPath: '' },
    ]);
  });

  it('keeps a value that merely CONTAINS a non-finite token', () => {
    // `Inf` anchored means the whole value; `[1 Inf]` still names no variable, but
    // `InfGain` and `2*Tau_inf` do, and an unanchored pattern would have to be
    // careful not to eat them.
    const usages = usagesFor(`<Block BlockType="Gain" Name="G" SID="1"><P Name="Gain">2*Tau_inf</P></Block>`);
    expect(usages).toHaveLength(1);
    expect(usages[0].paramValue).toBe('2*Tau_inf');
  });

  describe('multi-line block-name normalization (&#xA; = newline)', () => {
    it('collapses a hex newline entity in the block name to a single space', () => {
      // Simulink wraps long labels; the raw SLX stores the break as &#xA;, which
      // fast-xml-parser leaves undecoded. It must render as one flat cell.
      const usages = usagesFor(
        `<Block BlockType="TransferFcn" Name="Alpha-sensor&#xA;Low-pass Filter" SID="1"><P Name="Denominator">[Tal,1]</P></Block>`,
      );
      expect(usages).toHaveLength(1);
      expect(usages[0].blockName).toBe('Alpha-sensor Low-pass Filter');
    });

    it('collapses multiple newline entities and surrounding whitespace', () => {
      const usages = usagesFor(
        `<Block BlockType="TransferFcn" Name="Proportional&#xA;plus integral&#xA;compensator" SID="1"><P Name="Numerator">[Ki]</P></Block>`,
      );
      expect(usages[0].blockName).toBe('Proportional plus integral compensator');
    });

    it('handles the decimal newline form (&#10;) too', () => {
      const usages = usagesFor(
        `<Block BlockType="Gain" Name="Line1&#10;Line2" SID="1"><P Name="Gain">Kp</P></Block>`,
      );
      expect(usages[0].blockName).toBe('Line1 Line2');
    });

    it('a name that is only a newline normalizes to empty (not a literal &#xA;)', () => {
      const usages = usagesFor(`<Block BlockType="Constant" Name="&#xA;" SID="1"><P Name="Value">Uo</P></Block>`);
      expect(usages[0].blockName).toBe('');
      // And the SID is still there, which is what such a row is named and keyed by
      // downstream — see blockIdentity.
      expect(usages[0].sid).toBe('1');
    });
  });

  // Every usage carries the block's SID, because a name does not identify a block: it is
  // unique within its own system only, and f14.slx holds four blocks called `Gain`.
  describe('the block SID', () => {
    it('reads the SID attribute, verbatim, onto every usage of the block', () => {
      const usages = usagesFor(
        `<Block BlockType="TransferFcn" Name="F" SID="42">` +
          `<P Name="Numerator">Kp</P><P Name="Denominator">[Ki 1]</P>` +
          `</Block>`,
      );
      expect(usages.map((u) => u.sid)).toEqual(['42', '42']);
    });

    it('keeps a numeric SID as the string the file wrote', () => {
      // fast-xml-parser coerces `"7"` to the NUMBER 7 when it looks numeric, and every
      // consumer treats a key as a string — one that came back as a number would build
      // the id `7` in one path and `'7'` in another and match neither.
      const [usage] = usagesFor(`<Block BlockType="Gain" Name="G" SID="7"><P Name="Gain">Kp</P></Block>`);
      expect(usage.sid).toBe('7');
    });

    it('reports no SID as empty, for a file that records none', () => {
      // A classic `.mdl` written before R2010b has no SIDs at all. Empty, so the fallback
      // to the block name happens in one place (blockIdentity) rather than here.
      const [usage] = usagesFor(`<Block BlockType="Gain" Name="G" ><P Name="Gain">Kp</P></Block>`);
      expect(usage.sid).toBe('');
    });

    it('tells two same-named blocks apart, which is the whole point', () => {
      const usages = usagesFor(
        `<Block BlockType="Gain" Name="Gain" SID="15"><P Name="Gain">Mq</P></Block>` +
          `<Block BlockType="Gain" Name="Gain" SID="24"><P Name="Gain">Zw</P></Block>`,
      );
      expect(usages.map((u) => `${u.blockName}/${u.sid}=${u.paramValue}`)).toEqual([
        'Gain/15=Mq',
        'Gain/24=Zw',
      ]);
    });
  });
});

// WHERE each block is, which is the fact neither the name nor the SID carries: a SID
// tells a machine two `Gain` blocks apart, and the enclosing subsystem is what tells a
// PERSON. Every era of `.slx` records the nesting differently, and the two shapes below
// are the only two there have ever been — a `<System Ref="system_7"/>` stub pointing at
// another part (R2020a on), or the child `<System>` nested inline (before that).
describe('the system path — which subsystems a block is inside', () => {
  // An .slx whose systems parts are given by ref name: `{ system_root: '<Block …/>' }`.
  // No blockDiagram.json content beyond the uuid, deliberately — the walk must not need
  // the diagram to find its root, because that part is XML in four eras and JSON in the
  // fifth and a path feature has no business depending on which.
  function slxWithSystems(systems: Record<string, string>): ArrayBuffer {
    const parts: Record<string, Uint8Array> = {
      'simulink/blockDiagram.json': strToU8(JSON.stringify({ BlockDiagram: { ModelUUID: 'u1' } })),
      'metadata/coreProperties.xml': strToU8(
        `<?xml version="1.0"?><coreProperties><version>R2026b</version></coreProperties>`,
      ),
    };
    for (const [ref, blocksXml] of Object.entries(systems)) {
      parts[`simulink/systems/${ref}.xml`] = strToU8(
        `<?xml version="1.0" encoding="utf-8"?><System>${blocksXml}</System>`,
      );
    }
    const zipped = zipSync(parts);
    return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
  }

  /** `Gain=Kp @ Sub/Inner` for every usage — the value, and where it was found. */
  function whereFrom(buf: ArrayBuffer): string[] {
    return parseSlx(buf, 'm.slx').blockParamUsages.map(
      (u) => `${u.blockName}:${u.paramValue}@${u.systemPath}`,
    );
  }

  it('is empty for a block in the root system', () => {
    // '' is the root, not a missing value: a root block's path is its label, and a
    // model-name prefix is what MATLAB's getfullname adds and this deliberately does not.
    expect(whereFrom(slxWithSystems({ system_root: `<Block BlockType="Gain" Name="G" SID="1"><P Name="Gain">Kp</P></Block>` })))
      .toEqual(['G:Kp@']);
  });

  it('names the subsystem for a block reached through a part reference', () => {
    // The R2020a-on layout: the SubSystem block holds a stub, and the blocks are in the
    // part it names.
    expect(
      whereFrom(
        slxWithSystems({
          system_root:
            `<Block BlockType="Gain" Name="Outer" SID="1"><P Name="Gain">Kp</P></Block>` +
            `<Block BlockType="SubSystem" Name="Sub" SID="2"><System Ref="system_7"/></Block>`,
          system_7: `<Block BlockType="Gain" Name="Inner" SID="3"><P Name="Gain">Ki</P></Block>`,
        }),
      ),
    ).toEqual(['Outer:Kp@', 'Inner:Ki@Sub']);
  });

  it('names every subsystem on the way down, however deep', () => {
    expect(
      whereFrom(
        slxWithSystems({
          system_root: `<Block BlockType="SubSystem" Name="Controller" SID="1"><System Ref="system_7"/></Block>`,
          system_7: `<Block BlockType="SubSystem" Name="Inner" SID="2"><System Ref="system_9"/></Block>`,
          system_9: `<Block BlockType="Gain" Name="G" SID="3"><P Name="Gain">Kp</P></Block>`,
        }),
      ),
    ).toEqual(['G:Kp@Controller/Inner']);
  });

  it('names the subsystem for a block nested INLINE, the pre-R2020a shape', () => {
    // The same claim about the other layout, and the reason `collect` recurses rather
    // than only following refs. Written into a systems part here so the two shapes are
    // compared in one place; the whole-file version of this is the R2018a fixture in
    // test/parity/slxLayouts.parity.test.ts.
    expect(
      whereFrom(
        slxWithSystems({
          system_root:
            `<Block BlockType="SubSystem" Name="Sub" SID="2">` +
            `<System><Block BlockType="Gain" Name="Inner" SID="3"><P Name="Gain">Ki</P></Block></System>` +
            `</Block>`,
        }),
      ),
    ).toEqual(['Inner:Ki@Sub']);
  });

  it('descends a SubSystem that has no parameters of its own', () => {
    // A subsystem is usually pure structure — no `<P>` at all. A walk that moved on from
    // a block the moment it found nothing to report would take the whole subsystem with
    // it, and the model would simply look smaller.
    expect(
      whereFrom(
        slxWithSystems({
          system_root: `<Block BlockType="SubSystem" Name="Sub" SID="2"><System Ref="system_7"/></Block>`,
          system_7: `<Block BlockType="Gain" Name="Inner" SID="3"><P Name="Gain">Ki</P></Block>`,
        }),
      ),
    ).toEqual(['Inner:Ki@Sub']);
  });

  it('uses the SID stand-in for a subsystem whose label the user cleared', () => {
    // blockLabel's case, one level up: the segment is what the subsystem READS as, so a
    // nameless one contributes `<SID: 2>` rather than an empty segment that would leave
    // the child's path starting with a bare `/`.
    expect(
      whereFrom(
        slxWithSystems({
          system_root: `<Block BlockType="SubSystem" Name="&#xA;" SID="2"><System Ref="system_7"/></Block>`,
          system_7: `<Block BlockType="Gain" Name="Inner" SID="3"><P Name="Gain">Ki</P></Block>`,
        }),
      ),
    ).toEqual(['Inner:Ki@<SID: 2>']);
  });

  it("doubles a `/` in a subsystem's own name, so the path stays splittable", () => {
    // Simulink allows `/` in a block name and escapes it by doubling — see
    // blockIdentity.joinBlockPath. Left alone, `A/B` would read as two subsystems.
    expect(
      whereFrom(
        slxWithSystems({
          system_root: `<Block BlockType="SubSystem" Name="A/B" SID="2"><System Ref="system_7"/></Block>`,
          system_7: `<Block BlockType="Gain" Name="Inner" SID="3"><P Name="Gain">Ki</P></Block>`,
        }),
      ),
    ).toEqual(['Inner:Ki@A//B']);
  });

  it('finds the root part whatever it is called — nothing points at it', () => {
    // The root is derived as the part no other part references, not matched against the
    // name `system_root`. That is what keeps the walk independent of the block diagram,
    // which names the root outright but spells it differently in every era.
    expect(
      whereFrom(
        slxWithSystems({
          system_top: `<Block BlockType="SubSystem" Name="Sub" SID="2"><System Ref="system_9"/></Block>`,
          system_9: `<Block BlockType="Gain" Name="Inner" SID="3"><P Name="Gain">Ki</P></Block>`,
        }),
      ),
    ).toEqual(['Inner:Ki@Sub']);
  });

  it('loses no block to a file whose part refs form a cycle', () => {
    // Two parts pointing at each other: neither is unreferenced, so neither is a derived
    // root and the first pass walks nothing at all. The sweep that follows walks whatever
    // is still unvisited from the root, which is why a path feature cannot cost a model
    // its blocks. The per-part visited set is what stops the cycle itself.
    const usages = whereFrom(
      slxWithSystems({
        system_a:
          `<Block BlockType="Gain" Name="Ga" SID="1"><P Name="Gain">Kp</P></Block>` +
          `<Block BlockType="SubSystem" Name="ToB" SID="2"><System Ref="system_b"/></Block>`,
        system_b:
          `<Block BlockType="Gain" Name="Gb" SID="3"><P Name="Gain">Ki</P></Block>` +
          `<Block BlockType="SubSystem" Name="ToA" SID="4"><System Ref="system_a"/></Block>`,
      }),
    );
    expect(usages.map((u) => u.split(':')[0]).sort()).toEqual(['Ga', 'Gb']);
  });

  it('reports each block once, however many refs reach its part', () => {
    // Two subsystems sharing one part is not a shape MATLAB writes, but a part walked
    // twice would report its blocks twice and double every usage count downstream. The
    // first ref to reach it settles its path.
    expect(
      whereFrom(
        slxWithSystems({
          system_root:
            `<Block BlockType="SubSystem" Name="One" SID="1"><System Ref="system_7"/></Block>` +
            `<Block BlockType="SubSystem" Name="Two" SID="2"><System Ref="system_7"/></Block>`,
          system_7: `<Block BlockType="Gain" Name="Inner" SID="3"><P Name="Gain">Ki</P></Block>`,
        }),
      ),
    ).toEqual(['Inner:Ki@One']);
  });

  it('names the subsystem in a legacy blockdiagram.xml, which has no systems parts at all', () => {
    // Before R2020a the whole block tree is inside this one part, nested inline. The
    // usages must carry the same paths a modern package gives, since it is the same
    // diagram — the claim the layout parity suite makes over MATLAB's own exports.
    const zipped = zipSync({
      'simulink/blockdiagram.xml': strToU8(
        `<?xml version="1.0"?><ModelInformation><Model><System>` +
          `<Block BlockType="Gain" Name="Outer" SID="1"><P Name="Gain">Kp</P></Block>` +
          `<Block BlockType="SubSystem" Name="Sub" SID="2"><System>` +
          `<Block BlockType="Gain" Name="Inner" SID="3"><P Name="Gain">Ki</P></Block>` +
          `</System></Block>` +
          `</System></Model></ModelInformation>`,
      ),
      'metadata/coreProperties.xml': strToU8(
        `<?xml version="1.0"?><coreProperties><version>R2018a</version></coreProperties>`,
      ),
    });
    const buf = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
    expect(whereFrom(buf)).toEqual(['Outer:Kp@', 'Inner:Ki@Sub']);
  });
});

describe('parseSlx — model workspace MAT-File source + edge cases', () => {
  // Simulink models can source their workspace data from a MAT file, recorded in
  // blockDiagram.json as ModelWorkspace.WSDataSource = 'MAT-File'. The parser
  // surfaces the filename as an external data source so the host knows to load it.
  function slxWith(overrides: Record<string, Uint8Array>): ArrayBuffer {
    const base: Record<string, Uint8Array> = {
      'simulink/blockDiagram.json': strToU8(JSON.stringify({ BlockDiagram: { ModelUUID: 'u1' } })),
      'metadata/coreProperties.xml': strToU8(`<?xml version="1.0"?><coreProperties><version>R2026b</version></coreProperties>`),
    };
    const parts = { ...base, ...overrides };
    const zipped = zipSync(parts);
    return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
  }

  it('includes a model-workspace MAT source in externalDataSources', () => {
    // When a model's workspace is sourced from a MAT file (not embedded mxarray),
    // the filename must appear in externalDataSources so the host resolves it.
    const buf = slxWith({
      'simulink/blockDiagram.json': strToU8(JSON.stringify({
        BlockDiagram: {
          ModelUUID: 'u1',
          ModelWorkspace: { WSDataSource: 'MAT-File', WSSourceFileName: 'model_data.mat' },
        },
      })),
    });
    const parsed = parseSlx(buf, 'test.slx');
    expect(parsed.externalDataSources).toContain('model_data.mat');
  });

  it('does not duplicate the MAT source if it already appears from ExternalDataSourceSettings', () => {
    // The MAT file might already be listed via ExternalDataSourceSettings.xml. The
    // parser must not add it twice or the host would attempt to load it twice.
    const buf = slxWith({
      'simulink/blockDiagram.json': strToU8(JSON.stringify({
        BlockDiagram: {
          ModelUUID: 'u1',
          ModelWorkspace: { WSDataSource: 'MAT-File', WSSourceFileName: 'data.mat' },
        },
      })),
      'simulink/ExternalDataSourceSettings.xml': strToU8(
        `<?xml version="1.0"?><ExternalDataSourceSettings>` +
        `<ExplicitExternalBrokerSources><fullPathToSource>data.mat</fullPathToSource></ExplicitExternalBrokerSources>` +
        `</ExternalDataSourceSettings>`,
      ),
    });
    const parsed = parseSlx(buf, 'test.slx');
    expect(parsed.externalDataSources.filter((s) => s === 'data.mat')).toHaveLength(1);
  });

  it('surfaces a numeric-only version tag via the String() fallback in findText', () => {
    // fast-xml-parser parses <version>42</version> as the number 42, not the string
    // "42". The findText helper must stringify it so the parser always returns a
    // string release, not a number that breaks downstream comparisons.
    const buf = slxWith({
      'metadata/coreProperties.xml': strToU8(
        `<?xml version="1.0"?><coreProperties><version>42</version></coreProperties>`,
      ),
    });
    const parsed = parseSlx(buf, 'test.slx');
    expect(typeof parsed.release).toBe('string');
    expect(parsed.release).toBe('42');
  });

  it('returns empty metadata when coreProperties.xml is absent', () => {
    // A stripped or minimal .slx might lack optional parts. The parser must not
    // throw — it just surfaces empty strings for the metadata fields.
    const zipped = zipSync({
      'simulink/blockDiagram.json': strToU8(JSON.stringify({ BlockDiagram: { ModelUUID: 'u1' } })),
    });
    const buf = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
    const parsed = parseSlx(buf, 'minimal.slx');
    expect(parsed.release).toBe('');
    expect(parsed.creator).toBe('');
    expect(parsed.uuid).toBe('u1');
  });

  it('reports no sources for an EMPTY broker-sources element', () => {
    // fast-xml-parser turns `<X/>` into the empty STRING, not an object, so the
    // per-element findText walks into a non-object. Without the base case that is a
    // crash on a legal (if pointless) .slx rather than "this model has no sources".
    const buf = slxWith({
      'simulink/ExternalDataSourceSettings.xml': strToU8(
        `<?xml version="1.0"?><ExternalDataSourceSettings>` +
        `<ExplicitExternalBrokerSources/></ExternalDataSourceSettings>`,
      ),
    });
    expect(parseSlx(buf, 'test.slx').externalDataSources).toEqual([]);
  });

  it('skips a broker-sources element whose path tag is empty', () => {
    // An empty <fullPathToSource/> names no file. Recording '' would make the host
    // try to resolve a source with no name.
    const buf = slxWith({
      'simulink/ExternalDataSourceSettings.xml': strToU8(
        `<?xml version="1.0"?><ExternalDataSourceSettings>` +
        `<ExplicitExternalBrokerSources><fullPathToSource/></ExplicitExternalBrokerSources>` +
        `<ExplicitExternalBrokerSources><fullPathToSource>real.mat</fullPathToSource></ExplicitExternalBrokerSources>` +
        `</ExternalDataSourceSettings>`,
      ),
    });
    expect(parseSlx(buf, 'test.slx').externalDataSources).toEqual(['real.mat']);
  });

  it('finds a metadata tag that carries attributes alongside its text', () => {
    // A tag with attributes parses to an object whose text sits under '#text'.
    const buf = slxWith({
      'metadata/coreProperties.xml': strToU8(
        `<?xml version="1.0"?><coreProperties><cp:version xsi:type="str">R2027a</cp:version></coreProperties>`,
      ),
    });
    expect(parseSlx(buf, 'test.slx').release).toBe('R2027a');
  });

  it('skips an EMPTY earlier spelling of a metadata tag and takes the later one', () => {
    // `findText(doc,'cp:version') || findText(doc,'version')` treats '' as absent,
    // so an empty <cp:version/> must not shadow a populated <version>. Pinning this
    // is what lets findText share findAll's traversal instead of keeping a second
    // recursion whose empty-value handling depended on match depth.
    const buf = slxWith({
      'metadata/coreProperties.xml': strToU8(
        `<?xml version="1.0"?><coreProperties><cp:version/><version>R2026b</version></coreProperties>`,
      ),
    });
    expect(parseSlx(buf, 'test.slx').release).toBe('R2026b');
  });

  it('skips a block that has no <P> children at all', () => {
    // A block element with attributes but no property children is valid (e.g. a
    // reference block with everything defaulted). The parser must continue past it
    // without throwing.
    const usages = usagesFor(
      `<Block BlockType="SubSystem" Name="Sub1" SID="1"></Block>` +
      `<Block BlockType="Gain" Name="G1" SID="2"><P Name="Gain">Kp</P></Block>`,
    );
    expect(usages).toEqual([
      { blockName: 'G1', blockType: 'Gain', paramProperty: 'Gain', paramValue: 'Kp', sid: '2', systemPath: '' },
    ]);
  });
});
