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
      { blockName: 'Filt', blockType: 'TransferFcn', paramProperty: 'Numerator', paramValue: '[1,W1]' },
      { blockName: 'Filt', blockType: 'TransferFcn', paramProperty: 'Denominator', paramValue: '[Tal,1]' },
    ]);
  });

  it('still captures a Gain param (allowlist behavior preserved)', () => {
    const usages = usagesFor(`<Block BlockType="Gain" Name="G1" SID="1"><P Name="Gain">Mq</P></Block>`);
    expect(usages).toEqual([{ blockName: 'G1', blockType: 'Gain', paramProperty: 'Gain', paramValue: 'Mq' }]);
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
    expect(usages).toEqual([{ blockName: 'G', blockType: 'Gain', paramProperty: 'Gain', paramValue: 'Kp' }]);
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
      { blockName: 'G', blockType: 'Gain', paramProperty: 'Gain', paramValue: 'Infinity' },
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
    });
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
      { blockName: 'G1', blockType: 'Gain', paramProperty: 'Gain', paramValue: 'Kp' },
    ]);
  });
});
