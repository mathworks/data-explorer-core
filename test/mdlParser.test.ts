// Copyright 2026 The MathWorks, Inc.
// Unit tests for MdlParser — the grammar and the framing, on hand-written files.
//
// A `.mdl` arrives in two shapes and this suite covers both from synthetic bytes,
// so a failure names the rule that broke rather than a whole model:
//
//   - the MODERN `.mdl`, an OPC package written as TEXT: the same parts a `.slx`
//     zips, delimited by `__MWOPC_PART_BEGIN__` lines with binary parts base64'd.
//     The assertions here are about FRAMING — where a part starts and stops — and
//     the strongest of them compares the result against `parseSlx` on a zip of the
//     very same parts, which is the whole claim of that flavour.
//   - the CLASSIC `.mdl`, the pre-R2012 nested-brace text format. The assertions
//     are about the GRAMMAR: escapes, wrapped values, bracket literals, `$` names,
//     and which nodes are diagram and which are bookkeeping.
//
// Whole MATLAB-authored models — where the two flavours are held against the `.slx`
// of the same diagram — are test/parity/mdl.parity.test.ts.
import { describe, it, expect } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { parseMdl } from '../src/datamodel/parser/MdlParser.js';
import { parseModel } from '../src/datamodel/parser/ModelParser.js';
import { parseSlx } from '../src/datamodel/parser/SlxParser.js';

function detach(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

function bytes(text: string): ArrayBuffer {
  return detach(strToU8(text));
}

// ---------------------------------------------------------------------------
// the modern `.mdl`: an OPC package in text framing
// ---------------------------------------------------------------------------

interface Part {
  path: string;
  // A string part is written verbatim; a byte part is base64'd and its header
  // marked BASE64, exactly as MATLAB writes a binary part into a text package.
  body: string | Uint8Array;
}

// Base64 via Buffer, which the PARSER cannot use (it also runs in a browser) but a
// Node-only test happily can — encoding here with a different implementation than
// the one under test is the point.
function toBase64(u8: Uint8Array, wrapAt = 0): string {
  const b64 = Buffer.from(u8).toString('base64');
  if (!wrapAt) { return b64; }
  return (b64.match(new RegExp('.{1,' + wrapAt + '}', 'g')) || []).join('\n');
}

const BANNER = '# MathWorks OPC Text Package\n';
// The legacy stub a modern `.mdl` opens with, so a tool that only knows the classic
// grammar sees something it can read before the package proper starts.
const STUB = 'Model {\n  Version                 "27.1.0"\n}\n';

function textPackage(
  parts: Part[],
  opts: { eol?: string; end?: boolean; wrapAt?: number; stub?: string } = {},
): ArrayBuffer {
  const eol = opts.eol ?? '\n';
  let out = BANNER + (opts.stub ?? STUB) + '__MWOPC_PACKAGE_BEGIN__ R2027a' + eol;
  for (const part of parts) {
    const binary = typeof part.body !== 'string';
    out += '__MWOPC_PART_BEGIN__ /' + part.path + (binary ? ' BASE64' : '') + eol;
    out += (binary ? toBase64(part.body as Uint8Array, opts.wrapAt) : (part.body as string)) + eol;
  }
  if (opts.end !== false) { out += '__MWOPC_PACKAGE_END__' + eol; }
  return bytes(out);
}

// A minimal but COMPLETE part set: every part parseModelParts reads, so the
// comparison against the zipped twin exercises each extractor.
const MODEL_PARTS: Part[] = [
  {
    path: 'metadata/coreProperties.xml',
    body:
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<coreProperties xmlns:cp="x" xmlns:dc="y" xmlns:dcterms="z">' +
      '<cp:version>R2027a</cp:version><dc:creator>someone</dc:creator>' +
      '<dcterms:modified>2026-09-04T10:15:29Z</dcterms:modified></coreProperties>',
  },
  {
    path: 'simulink/blockDiagram.json',
    body: JSON.stringify({
      BlockDiagram: {
        ModelUUID: 'aaaa-bbbb',
        DataDictionary: 'params.sldd',
        ModelWorkspace: { WSDataSource: 'MAT-File', WSSourceFileName: 'wsdata.mat' },
      },
    }),
  },
  {
    path: 'simulink/graphicalInterface.json',
    body: JSON.stringify({ ModelReferences: [{ BlockPath: '$bdroot/Child', ModelName: 'child_model' }] }),
  },
  {
    path: 'simulink/configSetInfo.json',
    body: JSON.stringify({
      ConfigSetInfo: [
        { PartName: '/simulink/configSet0/configSet.json', ConfigSetName: 'Configuration', Active: true },
      ],
    }),
  },
  { path: 'simulink/configSet0/configSet.json', body: JSON.stringify({ StopTime: '10.0' }) },
  {
    path: 'simulink/systems/system_root.xml',
    body:
      '<?xml version="1.0" encoding="utf-8"?><System>' +
      '<Block BlockType="Gain" Name="G" SID="1"><P Name="Gain">Ki</P></Block>' +
      '</System>',
  },
];

function zipOf(parts: Part[]): ArrayBuffer {
  const store: Record<string, Uint8Array> = {};
  for (const part of parts) {
    store[part.path] = typeof part.body === 'string' ? strToU8(part.body) : part.body;
  }
  return detach(zipSync(store));
}

describe('parseMdl — modern .mdl (OPC text package)', () => {
  it('gives the SAME model as a .slx zipping the same parts', () => {
    // The claim the whole flavour rests on: text framing and zip framing carry the
    // identical part set, so once the framing is off there is one reader. Compared
    // whole rather than field by field, so a new field cannot quietly diverge.
    const fromMdl = parseMdl(textPackage(MODEL_PARTS), 'm.mdl');
    const fromSlx = parseSlx(zipOf(MODEL_PARTS), 'm.mdl');
    expect(fromMdl).toEqual(fromSlx);
    expect(fromMdl.release).toBe('R2027a');
    expect(fromMdl.dataDictionary).toBe('params.sldd');
    expect(fromMdl.blockParamUsages).toEqual([
      { blockName: 'G', blockType: 'Gain', paramProperty: 'Gain', paramValue: 'Ki' },
    ]);
  });

  it('decodes a base64 part to its exact bytes', () => {
    // The model workspace is a binary part; a single byte off and it does not parse
    // at all. Every byte value, so a sign- or masking bug shows up.
    const blob = new Uint8Array(256).map((_, i) => i);
    const parsed = parseMdl(textPackage([...MODEL_PARTS, { path: 'simulink/blob.bin', body: blob }]), 'm.mdl');
    expect(parsed.zipEntries!['simulink/blob.bin']).toEqual(blob);
  });

  it('decodes a base64 part the encoder broke across lines', () => {
    const blob = new Uint8Array(300).map((_, i) => (i * 7) & 0xff);
    const pkg = textPackage([{ path: 'simulink/blob.bin', body: blob }], { wrapAt: 76 });
    expect(parseMdl(pkg, 'm.mdl').zipEntries!['simulink/blob.bin']).toEqual(blob);
  });

  it('keeps a text part byte-exact, without the newline that frames the next header', () => {
    // The XML parts end with a newline of their OWN and the JSON parts do not, so a
    // reader that keeps the framing newline corrupts one and a reader that strips
    // one too many corrupts the other. Both shapes are asserted here.
    const xml = '<?xml version="1.0"?><System/>\n';
    const json = '{"a":1}';
    const parsed = parseMdl(
      textPackage([{ path: 'simulink/systems/system_root.xml', body: xml }, { path: 'x.json', body: json }]),
      'm.mdl',
    );
    expect(parsed.zipEntries!['simulink/systems/system_root.xml']).toEqual(strToU8(xml));
    expect(parsed.zipEntries!['x.json']).toEqual(strToU8(json));
  });

  it('handles CRLF framing', () => {
    // A `.mdl` that travelled through a Windows checkout has CRLF line endings; the
    // CR belongs to the framing, not to the part.
    const json = '{"a":1}';
    const parsed = parseMdl(textPackage([{ path: 'x.json', body: json }], { eol: '\r\n' }), 'm.mdl');
    expect(parsed.zipEntries!['x.json']).toEqual(strToU8(json));
  });

  it('does not split on a marker that is not at the start of a line', () => {
    // A part's own bytes may contain the delimiter text — an XML attribute value, a
    // base64 run — and only a line-start occurrence is a boundary.
    const json = '{"note":"__MWOPC_PART_BEGIN__ /fake.xml"}';
    const parsed = parseMdl(textPackage([{ path: 'x.json', body: json }]), 'm.mdl');
    expect(Object.keys(parsed.zipEntries!)).toEqual(['x.json']);
    expect(parsed.zipEntries!['x.json']).toEqual(strToU8(json));
  });

  it('reads the last part of a package that just stops (no PACKAGE_END)', () => {
    const json = '{"a":1}';
    const parsed = parseMdl(textPackage([{ path: 'x.json', body: json }], { end: false }), 'm.mdl');
    expect(parsed.zipEntries!['x.json']).toEqual(strToU8(json));
  });

  it('treats a package marker beyond the sniff window as a classic file', () => {
    // The marker follows a banner and a short stub, so it is always near the top. The
    // bound exists so a classic `.mdl` that mentions the text somewhere in its middle
    // is not mistaken for a package; a file that pushes its own marker past it reads
    // as classic, which is the safe direction — the grammar reader always has a Model
    // stub to work with.
    const padded = textPackage(MODEL_PARTS, {
      stub: 'Model {\n  Description             "' + 'x'.repeat(5000) + '"\n}\n',
    });
    const parsed = parseMdl(padded, 'm.mdl');
    expect(parsed.zipEntries).toBeNull();
    expect(parsed.rawContents).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// the classic `.mdl`: a nested-brace text format
// ---------------------------------------------------------------------------

// String.raw so the text below IS what the file holds: `\n` inside a quoted value is
// the two characters MATLAB wrote, not a line break in this source.
const CLASSIC = String.raw`# a stray banner line, which is not part of the grammar
Model {
  Name                    "unit"
  Version                 7.8
  Creator                 "someone"
  LastModifiedDate        "Fri Sep 04 10:15:29 2026"
  DataDictionary          "params.sldd"
  WSDataSource            "MAT-File"
  WSSourceFileName        "wsdata.mat"
  Description             "one\ntwo"
  BlockParameterDefaults {
    Block {
      BlockType             Gain
      Gain                  "defaultGain"
    }
  }
  GraphicalInterface {
    ModelReference {
      ModelRefBlockPath     "unit/Pipe|Weird|child_model"
      CopyOfModelName       "child_model"
    }
  }
  Array {
    Type                    "Handle"
    Dimension               2
    Simulink.ConfigSet {
      $ObjectID             3
      Name                  "Configuration"
      StopTime              "10.0"
    }
    Simulink.ConfigSetRef {
      $ObjectID             4
      Name                  "FromDict"
    }
    PropName                "ConfigurationSets"
  }
  Simulink.ConfigSet {
    $PropName               "ActiveConfigurationSet"
    $ObjectID               4
  }
  System {
    Name                    "unit"
    Block {
      BlockType             Constant
      Name                  "Two\nLines"
      SID                   "1"
      Position              [35, 180, 65, 210]
      ShowName              off
      Value                 "span"
    }
    Block {
      BlockType             TransferFcn
      Name                  "TF"
      SID                   "2"
      Numerator             "[1]"
      Denominator           "[tau 1]"
      Coeffs                [k1 k2]
      Nested                [[k3] k4]
    }
    "an orphaned value, which MATLAB writes for the elements of some Array blocks"
    Block {
      BlockType             SubSystem
      Name                  "Sub"
      SID                   "3"
      System {
        Name                "Sub"
        Block {
          BlockType         Gain
          Name              "InnerGain"
          SID               "4"
          Gain              "alpha"
                            "beta"
          Comment
          Note              "path\\to\"x\""
        }
      }
    }
  }
}
`;

describe('parseMdl — classic .mdl metadata', () => {
  const parsed = parseMdl(bytes(CLASSIC), 'unit.mdl');

  it('names the source by its filename, not by the diagram', () => {
    // An ExportToVersion renames the diagram after the target file, so the two can
    // disagree; the source id is the file, exactly as the `.slx` path reports it.
    expect(parsed.name).toBe('unit.mdl');
  });

  it('reads creator, modified date and linked dictionary', () => {
    expect(parsed.creator).toBe('someone');
    expect(parsed.lastModified).toBe('Fri Sep 04 10:15:29 2026');
    expect(parsed.dataDictionary).toBe('params.sldd');
  });

  it('reports no release and no uuid — a classic file records neither', () => {
    // `Version 7.8` is a Simulink version, not the release a `.slx` names in its
    // coreProperties, and nothing maps one to the other. Empty beats invented.
    expect(parsed.release).toBe('');
    expect(parsed.uuid).toBe('');
  });

  it('exposes no OPC parts — this flavour is one flat text file', () => {
    expect(parsed.rawContents).toBeNull();
    expect(parsed.zipEntries).toBeNull();
  });

  it('reads a model workspace kept in a MAT file as external data', () => {
    expect(parsed.externalDataSources).toEqual(['wsdata.mat']);
  });

  it('splits ModelRefBlockPath at the LAST bar and roots the path at $bdroot', () => {
    // A block name may contain a bar; a model name may not. The prefix stripped is
    // the name recorded IN the file, since an export renamed the diagram.
    expect(parsed.modelReferences).toEqual([{ blockPath: '$bdroot/Pipe|Weird', modelName: 'child_model' }]);
  });

  it('reads the config sets and resolves the active one by object id', () => {
    expect(parsed.configSets.map((c) => ({ name: c.name, active: c.active }))).toEqual([
      { name: 'Configuration', active: false },
      { name: 'FromDict', active: true },
    ]);
    // The class is the node's own name, which is what the config section renders —
    // a set that lives in a dictionary is a ConfigSetRef and gets its own icon.
    const classes = parsed.configSets.map((c) => (c.data as { _object_class: string })._object_class);
    expect(classes).toEqual(['Simulink.ConfigSet', 'Simulink.ConfigSetRef']);
    expect((parsed.configSets[0].data as { _properties: Record<string, string> })._properties.StopTime).toBe('10.0');
  });
});

describe('parseMdl — classic .mdl block parameters', () => {
  const usages = parseMdl(bytes(CLASSIC), 'unit.mdl').blockParamUsages;

  it('reads every referencing parameter, in file order, recursing into subsystems', () => {
    expect(usages).toEqual([
      // `"Two\nLines"` here, `Two&#xA;Lines` in the .slx — both flatten to one label.
      { blockName: 'Two Lines', blockType: 'Constant', paramProperty: 'Value', paramValue: 'span' },
      { blockName: 'TF', blockType: 'TransferFcn', paramProperty: 'Denominator', paramValue: '[tau 1]' },
      // An unquoted bracket literal, and one with a nested bracket — the `]` inside
      // must not end the value early.
      { blockName: 'TF', blockType: 'TransferFcn', paramProperty: 'Coeffs', paramValue: '[k1 k2]' },
      { blockName: 'TF', blockType: 'TransferFcn', paramProperty: 'Nested', paramValue: '[[k3] k4]' },
      // Wrapped across two quoted chunks: MATLAB breaks a long value at
      // MaxMDLFileLineLength, and the chunks are ONE value.
      { blockName: 'InnerGain', blockType: 'Gain', paramProperty: 'Gain', paramValue: 'alphabeta' },
      // `\\` and `\"` undone. `\\` is load-bearing well beyond this row: the uuencode
      // alphabet contains both characters, so the model workspace does not decode
      // unless escapes are undone first.
      { blockName: 'InnerGain', blockType: 'Gain', paramProperty: 'Note', paramValue: 'path\\to"x"' },
    ]);
  });

  it('skips BlockType/Name/SID — a .slx keeps those three as XML attributes', () => {
    expect(usages.some((u) => ['BlockType', 'Name', 'SID'].includes(u.paramProperty))).toBe(false);
  });

  it('ignores BlockParameterDefaults, which a .slx has no equivalent for', () => {
    // Factory defaults per block type, with no block behind them. Counting them gave
    // the classic flavour of a model rows its own `.slx` never reported.
    expect(usages.some((u) => u.paramValue === 'defaultGain')).toBe(false);
  });

  it('drops a numeric, an on/off and a value-less property', () => {
    expect(usages.some((u) => u.paramProperty === 'Numerator')).toBe(false); // "[1]"
    expect(usages.some((u) => u.paramProperty === 'ShowName')).toBe(false); // off
    expect(usages.some((u) => u.paramProperty === 'Comment')).toBe(false); // no value
  });

  it('drops the ModelReference block CopyOfModelName bookkeeping', () => {
    expect(usages.some((u) => u.paramProperty === 'CopyOfModelName')).toBe(false);
  });
});

describe('parseMdl — classic .mdl grammar edge cases', () => {
  it('reads a Library the same way as a Model', () => {
    const parsed = parseMdl(bytes('Library {\n  Name "lib"\n  Creator "someone"\n}\n'), 'lib.mdl');
    expect(parsed.creator).toBe('someone');
  });

  it('survives an unmatched closing brace without reparenting the file', () => {
    // A `}` that would pop the root is dropped instead, so the properties after it
    // are still read as the model's own.
    const parsed = parseMdl(bytes(CLASSIC + '}\nMatData {\n  NumRecords 0\n}\n'), 'unit.mdl');
    expect(parsed.creator).toBe('someone');
    expect(parsed.blockParamUsages).toHaveLength(6);
  });

  it('falls back to ExternalFileReference entries when there are no ModelReference nodes', () => {
    // R2014b and later list references BOTH ways; a file that carries only the second
    // list still has to report them. Non-model references are not model references.
    const parsed = parseMdl(
      bytes(String.raw`Model {
  Name                    "unit"
  GraphicalInterface {
    ExternalFileReference {
      Reference             "child_model"
      Path                  "unit/Child"
      Type                  "MODEL_BLOCK"
    }
    ExternalFileReference {
      Reference             "other"
      Path                  "unit"
      Type                  "MODEL_BLOCK"
    }
    ExternalFileReference {
      Reference             "params.sldd"
      Path                  "unit"
      Type                  "DATA_DICTIONARY"
    }
  }
}
`),
      'unit.mdl',
    );
    expect(parsed.modelReferences).toEqual([
      { blockPath: '$bdroot/Child', modelName: 'child_model' },
      // A reference hung on the model root itself: the path IS the model name.
      { blockPath: '$bdroot', modelName: 'other' },
    ]);
  });

  it('leaves a block path alone when it is not rooted at the model name', () => {
    const parsed = parseMdl(
      bytes('Model {\n  Name "unit"\n  GraphicalInterface {\n    ModelReference {\n' +
        '      ModelRefBlockPath "other/Child|child_model"\n    }\n  }\n}\n'),
      'unit.mdl',
    );
    expect(parsed.modelReferences).toEqual([{ blockPath: 'other/Child', modelName: 'child_model' }]);
  });

  it('reads a model that holds nothing but its own name', () => {
    // The tolerance the grammar reader is built on, and where its limit is: a model
    // with no diagram, no config sets and no workspace is a legal model, so every
    // section comes back empty and nothing is reported wrong. What makes it a model
    // is the `Model` node — see the rejections below.
    const parsed = parseMdl(bytes('Model {\n  Name "bare"\n}\n'), 'bare.mdl');
    expect(parsed.blockParamUsages).toEqual([]);
    expect(parsed.configSets).toEqual([]);
    expect(parsed.modelReferences).toEqual([]);
    expect(parsed.workspace).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// what is NOT a model
// ---------------------------------------------------------------------------

// This reader is the last one in the dispatch: anything that is not a zip and not a
// text package arrives here, so it is also where a file nobody can read is finally
// named as such. That matters because the grammar tolerates ANY text — no `Model`
// node just means no properties — so a reader without this guard answers a corrupt
// file with an empty model, and a host has no way to tell that from a model that is
// genuinely empty. It shows a table of empty sections, reading "this model is empty"
// where it should say the file could not be read.
describe('parseMdl — rejects text that is not a model at all', () => {
  const notAModel = /Not a Simulink model/;

  it('rejects an empty file', () => {
    expect(() => parseMdl(bytes(''), 'empty.mdl')).toThrow(notAModel);
  });

  it('rejects bytes that are not text in any encoding', () => {
    // The shape a truncated or corrupt `.slx` takes: it fails the zip sniff, so it
    // comes here as mojibake.
    const junk = new Uint8Array([0x50, 0x4b, 0x07, 0x08, 0xff, 0xfe, 0x00, 0x42]);
    expect(() => parseMdl(detach(junk), 'corrupt.slx')).toThrow(notAModel);
  });

  it('rejects text in a brace grammar that is not this one', () => {
    // Well-formed braces, parsed happily into a tree, with no diagram anywhere in it.
    expect(() => parseMdl(bytes('server {\n  listen 80;\n}\n'), 'nginx.mdl')).toThrow(notAModel);
  });

  it('names the file in the message, since a host reports it to a person', () => {
    expect(() => parseMdl(bytes('nothing'), 'engine_R2011b.mdl')).toThrow(/engine_R2011b\.mdl/);
  });

  it('rejects a text package cut off before its first part', () => {
    // A package marker with nothing after it is a truncated file, not a package. It
    // falls through to the grammar reader, which finds no Model — the banner alone is
    // not one — and rejects it, rather than opening a model with no parts in it.
    expect(() => parseMdl(bytes(BANNER + '__MWOPC_PACKAGE_BEGIN__ R2027a\n'), 'cut.mdl')).toThrow(notAModel);
  });

  it('accepts a truncated package that still carries its legacy stub', () => {
    // The same truncation, on a file whose stub survived: the stub IS a Model node, so
    // this opens as the (nearly empty) model the readable half describes. Tolerated
    // rather than rejected because the file does say what it is.
    const parsed = parseMdl(bytes(BANNER + STUB + '__MWOPC_PACKAGE_BEGIN__ R2027a\n'), 'cut.mdl');
    expect(parsed.zipEntries).toBeNull();
    expect(parsed.blockParamUsages).toEqual([]);
  });

  it('still reads a Library, which is a model in every way that matters here', () => {
    // The guard accepts two node names, and a library file has only the second one.
    // Rejecting it would make every legacy library unopenable — the exact failure the
    // guard is meant to prevent, inverted.
    expect(parseMdl(bytes('Library {\n  Name "lib"\n}\n'), 'lib.mdl').name).toBe('lib.mdl');
  });
});

describe('parseMdl — classic .mdl model workspace framing', () => {
  function withMatData(modelProps: string, matData: string): ReturnType<typeof parseMdl> {
    return parseMdl(bytes('Model {\n  Name "unit"\n' + modelProps + '}\n' + matData), 'unit.mdl');
  }

  it('is empty when the model names no MatData record', () => {
    const parsed = withMatData('', '');
    expect(parsed.workspace).toHaveLength(0);
    expect(parsed.workspace._trailingElements).toEqual([]);
  });

  it('is empty when the named record is absent', () => {
    const parsed = withMatData('  WSMdlFileData "DataTag0"\n', 'MatData {\n  NumRecords 0\n}\n');
    expect(parsed.workspace).toHaveLength(0);
  });

  it('is empty when a record with a DIFFERENT tag is present', () => {
    // The Model names its record by tag; another record's bytes are not the model
    // workspace and must not be read as one.
    const parsed = withMatData(
      '  WSMdlFileData "DataTag0"\n',
      'MatData {\n  NumRecords 1\n  DataRecord {\n    Tag DataTag9\n    Data "  IM"\n  }\n}\n',
    );
    expect(parsed.workspace).toHaveLength(0);
  });

  it('is empty, not an exception, when the record does not decode to an mxarray', () => {
    const parsed = withMatData(
      '  WSMdlFileData "DataTag0"\n',
      'MatData {\n  NumRecords 1\n  DataRecord {\n    Tag DataTag0\n    Data "not really encoded"\n  }\n}\n',
    );
    expect(parsed.workspace).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// the format-agnostic entry
// ---------------------------------------------------------------------------

describe('parseModel — sniffing on bytes', () => {
  it('routes zip bytes to the .slx reader', () => {
    const parsed = parseModel(zipOf(MODEL_PARTS), 'm.slx');
    expect(parsed.release).toBe('R2027a');
    expect(parsed.zipEntries).not.toBeNull();
  });

  it('routes a text package to the .mdl reader', () => {
    const parsed = parseModel(textPackage(MODEL_PARTS), 'm.mdl');
    expect(parsed.release).toBe('R2027a');
    expect(parsed.zipEntries).not.toBeNull();
  });

  it('routes classic brace text to the .mdl reader', () => {
    // Decided on the BYTES, not the extension: an in-place format upgrade leaves a
    // file whose name and content disagree, and a host that renamed a file still
    // expects it to open.
    const parsed = parseModel(bytes(CLASSIC), 'unit.slx');
    expect(parsed.creator).toBe('someone');
    expect(parsed.zipEntries).toBeNull();
  });

  it('rejects bytes that are none of the three forms', () => {
    // The host-facing half of the guard in the classic reader. Sniffing on bytes made
    // every reader reachable from every extension, and the reader of last resort
    // tolerates any text — so this entry point, which a host calls for anything named
    // `.slx` or `.mdl`, needs to still fail on a file that is neither. A host shows a
    // "could not read this file" banner from the exception; with no exception it shows
    // an empty table instead, and the user is told the model is empty.
    expect(() => parseModel(bytes('not a model'), 'corrupt.slx')).toThrow(/Not a Simulink model/);
    // A truncated zip keeps its magic, so it goes to the .slx reader and fails there —
    // unchanged, and named here so both halves of the dispatch are pinned as throwing.
    const truncatedZip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
    expect(() => parseModel(detach(truncatedZip), 'cut.slx')).toThrow();
  });
});
