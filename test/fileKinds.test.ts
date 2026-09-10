// Copyright 2026 The MathWorks, Inc.
//
// The shared file-kind tests, and the one property that is the whole reason they are
// shared: they are CASE-INSENSITIVE.
//
// MATLAB writes `Params.SLDD`, Windows preserves whatever a user typed, and a model
// records a linked file the way its author spelled it. Every reader that wrote its own
// `endsWith('.sldd')` got a stricter test than the glob or regex that ADMITTED the file,
// so such a file was found, opened, indexed — and then classified as nothing at all. That
// happened eight times downstream before these moved here, which is why the case tests
// below sit beside every kind test rather than in one block of their own.
import { describe, it, expect } from 'vitest';
import {
  extOf,
  basenameOf,
  refBasename,
  modelNameOf,
  refModelExt,
  projectNameOf,
  isModelFile,
  isSlddFile,
  isMatFile,
  isProjectFile,
} from '../src/index.js';
import ModelSectionNode from '../src/datamodel/node/container/ModelSectionNode.js';

describe('extOf', () => {
  it('returns the extension lower-cased, with the dot', () => {
    expect(extOf('params.sldd')).toBe('.sldd');
    expect(extOf('Params.SLDD')).toBe('.sldd');
    expect(extOf('engine.SLX')).toBe('.slx');
  });

  it('returns empty for a name with no extension', () => {
    expect(extOf('README')).toBe('');
    expect(extOf('')).toBe('');
  });

  it('takes the LAST dot, so a versioned name keeps its real extension', () => {
    expect(extOf('params.v2.sldd')).toBe('.sldd');
    // A dot-led name is all extension and no stem, which is what the filesystem says
    // too — and it is not a dictionary, which is the answer that matters here.
    expect(extOf('.sldd')).toBe('.sldd');
  });
});

describe('basenameOf', () => {
  it('drops a directory part, on either platform’s separator', () => {
    expect(basenameOf('/work/models/engine.slx')).toBe('engine.slx');
    expect(basenameOf('C:\\work\\models\\engine.slx')).toBe('engine.slx');
    expect(basenameOf('engine.slx')).toBe('engine.slx');
  });

  it('preserves case — a srcId is the host’s key, not a lookup', () => {
    expect(basenameOf('/work/Params.SLDD')).toBe('Params.SLDD');
  });

  it('answers with the input when there is nothing to strip', () => {
    expect(basenameOf('')).toBe('');
    // A trailing separator leaves no last segment; the input is a better answer than ''.
    expect(basenameOf('models/')).toBe('models/');
  });
});

describe('refBasename', () => {
  it('is the key two spellings of one file agree on', () => {
    // The case this exists for: a model links `Params.sldd`, the file on disk is
    // `params.sldd`, and macOS and Windows both consider those the same file. Matching
    // as-written makes the SAME reference resolve in one reader and silently not in
    // another.
    expect(refBasename('Params.SLDD')).toBe(refBasename('params.sldd'));
    expect(refBasename('/work/a/Params.sldd')).toBe(refBasename('C:\\other\\params.SLDD'));
  });

  it('reduces a path to the bare lower-cased name', () => {
    expect(refBasename('/work/models/Engine.SLX')).toBe('engine.slx');
  });
});

describe('modelNameOf', () => {
  it('strips a model extension, in either case and either container', () => {
    expect(modelNameOf('engine.slx')).toBe('engine');
    expect(modelNameOf('engine.mdl')).toBe('engine');
    expect(modelNameOf('Engine.SLX')).toBe('Engine');
  });

  it('is null for anything that is not a model file', () => {
    expect(modelNameOf('params.sldd')).toBe(null);
    expect(modelNameOf('data.mat')).toBe(null);
    expect(modelNameOf('engine')).toBe(null);
  });

  it('keeps the STEM’s case, and strips only the last extension', () => {
    // The stem is compared against a srcId, which is the host's own key: folding its
    // case would let two distinct open sources answer as one.
    expect(modelNameOf('MyEngine.slx')).toBe('MyEngine');
    expect(modelNameOf('engine.v2.slx')).toBe('engine.v2');
  });

  it('is how `.slx` and `.mdl` name the same model', () => {
    // A model reference is recorded with the PARENT's extension, so the same child is
    // 'child.mdl' from a `.mdl` and 'child.slx' from a `.slx'. The stem is what makes a
    // mixed hierarchy resolve at all.
    expect(modelNameOf('child.mdl')).toBe(modelNameOf('child.slx'));
  });
});

describe('refModelExt', () => {
  it('completes a reference with the PARENT model’s container', () => {
    expect(refModelExt('legacy.mdl')).toBe('.mdl');
    expect(refModelExt('modern.slx')).toBe('.slx');
  });

  it('is case-insensitive, like every other test in this module', () => {
    // The whole reason these live together: MATLAB and Windows both write `Legacy.MDL`,
    // and a case-sensitive copy of this rule labels a legacy hierarchy's children `.slx`,
    // so every reference in it resolves to a file that does not exist.
    expect(refModelExt('Legacy.MDL')).toBe('.mdl');
    expect(refModelExt('/work/models/LEGACY.MDL')).toBe('.mdl');
  });

  it('answers `.slx` for anything that is not a `.mdl`, including a bare name', () => {
    // `.slx` is the default because it is the modern container: a caller that hands over
    // a name with no extension (a model named the MATLAB way, `engine`) wants the
    // extension a fresh save_system would produce.
    expect(refModelExt('engine')).toBe('.slx');
    expect(refModelExt('')).toBe('.slx');
    expect(refModelExt('params.sldd')).toBe('.slx');
  });

  it('takes the LAST extension, so a name that merely contains .mdl is a .slx', () => {
    expect(refModelExt('legacy.mdl.slx')).toBe('.slx');
    expect(refModelExt('notes-about-mdl.slx')).toBe('.slx');
  });
});

// The seam this module exists to remove. `refModelExt` decides WHICH extension, and
// `addReferenceEntry` decides WHETHER to add one — two halves of completing a bare
// reference name, and until they were joined here each half was spelled twice (once in
// this package, once in its vscode host) with no test that could see both copies.
describe('refModelExt and addReferenceEntry complete a name together', () => {
  const ref = (modelName: string, parent: string) =>
    (
      new ModelSectionNode('references', null, 'Model References', 'modelReference').addReferenceEntry(
        { blockPath: 'top/ref', modelName },
        refModelExt(parent),
      ) as { name: string }
    ).name;

  it('gives a bare name the parent’s container, in both directions', () => {
    expect(ref('plant', 'legacy.mdl')).toBe('plant.mdl');
    expect(ref('plant', 'modern.slx')).toBe('plant.slx');
  });

  it('leaves an ALREADY-complete name alone, in either container and either case', () => {
    // The bug the `isModelFile` call replaced a local regex to prevent: a second opinion
    // about whether `plant.MDL` still needs an extension appends one, and `plant.MDL.slx`
    // is a link to nothing.
    expect(ref('plant.slx', 'legacy.mdl')).toBe('plant.slx');
    expect(ref('plant.mdl', 'modern.slx')).toBe('plant.mdl');
    expect(ref('plant.MDL', 'modern.slx')).toBe('plant.MDL');
    expect(ref('Plant.SLX', 'legacy.mdl')).toBe('Plant.SLX');
  });

  it('names the same child two ways, which is what modelNameOf reconciles', () => {
    // A mixed hierarchy is the case the guess exists to serve: the SAME child model is
    // `plant.mdl` seen from a `.mdl` parent and `plant.slx` seen from a `.slx` one, so a
    // resolver comparing full names finds nothing and one comparing stems finds it.
    const fromMdl = ref('plant', 'legacy.mdl');
    const fromSlx = ref('plant', 'modern.slx');
    expect(fromMdl).not.toBe(fromSlx);
    expect(modelNameOf(fromMdl)).toBe(modelNameOf(fromSlx));
  });
});

// The other reduction a consumer has to make before it can call a public parser, and the
// third rule in this module that was spelled once here and once in the vscode host.
describe('projectNameOf', () => {
  it('takes the `.prj` off, in either case', () => {
    expect(projectNameOf('work.prj')).toBe('work');
    expect(projectNameOf('Work.PRJ')).toBe('Work');
  });

  it('keeps the rest of the name exactly as written', () => {
    // The name is a LABEL — it goes in a tree row and a graph group heading — so its case
    // and its dots are the author's, not ours. Only the extension is ours to remove.
    expect(projectNameOf('My.Big.Project.prj')).toBe('My.Big.Project');
    expect(projectNameOf('Simulink_Model_Advisor.PRJ')).toBe('Simulink_Model_Advisor');
  });

  it('leaves a name with no `.prj` alone rather than returning null', () => {
    // Deliberately total, unlike modelNameOf: every caller wants a label, and a null here
    // would only be re-defaulted back to the filename at each of them.
    expect(projectNameOf('work')).toBe('work');
    expect(projectNameOf('')).toBe('');
    expect(projectNameOf('notes-about-prj.txt')).toBe('notes-about-prj.txt');
  });

  it('strips only the LAST extension', () => {
    expect(projectNameOf('work.prj.bak')).toBe('work.prj.bak');
    expect(projectNameOf('old.prj.prj')).toBe('old.prj');
  });

  it('composes with basenameOf the way its callers do', () => {
    // Neither this nor modelNameOf takes a path: a caller reduces the path first and the
    // name second, which is the composition `UsageIndex` already spells for models. Pinned
    // because the two halves live in the same module and could each look right alone —
    // `projectNameOf('/work/proj/thing.prj')` returning a path with the extension gone is
    // exactly the kind of half-answer that reads fine at a call site.
    expect(projectNameOf(basenameOf('/work/proj/thing.prj'))).toBe('thing');
    expect(projectNameOf(basenameOf('C:\\work\\proj\\Thing.PRJ'))).toBe('Thing');
    // And a project file is still recognisably one before the strip and not after, which is
    // what makes the order of the two calls matter.
    expect(isProjectFile(basenameOf('C:\\work\\Thing.PRJ'))).toBe(true);
    expect(isProjectFile(projectNameOf('Thing.PRJ'))).toBe(false);
  });
});

describe('the four kind tests', () => {
  it('classify each supported extension', () => {
    expect(isModelFile('engine.slx')).toBe(true);
    expect(isModelFile('engine.mdl')).toBe(true);
    expect(isSlddFile('params.sldd')).toBe(true);
    expect(isMatFile('data.mat')).toBe(true);
    expect(isProjectFile('work.prj')).toBe(true);
  });

  it('classify the SHOUTED spelling of each one the same way', () => {
    // The regression, in one test: MATLAB and Windows both produce these.
    expect(isModelFile('Engine.SLX')).toBe(true);
    expect(isModelFile('Engine.MDL')).toBe(true);
    expect(isSlddFile('Params.SLDD')).toBe(true);
    expect(isMatFile('Data.MAT')).toBe(true);
    expect(isProjectFile('Work.PRJ')).toBe(true);
  });

  it('are mutually exclusive, so a dispatch chain cannot double-classify', () => {
    const names = ['engine.slx', 'engine.mdl', 'params.sldd', 'data.mat', 'work.prj'];
    for (const name of names) {
      const kinds = [isModelFile(name), isSlddFile(name), isMatFile(name), isProjectFile(name)];
      expect(kinds.filter(Boolean), name).toHaveLength(1);
    }
  });

  it('reject a name that merely CONTAINS an extension', () => {
    // `endsWith` on the whole name, not `includes`: a folder named `params.sldd.bak` or
    // a text file about a dictionary is not a dictionary.
    expect(isSlddFile('params.sldd.bak')).toBe(false);
    expect(isSlddFile('sldd')).toBe(false);
    expect(isModelFile('notes-about-slx.txt')).toBe(false);
    expect(isModelFile('')).toBe(false);
  });

  it('accept a full path, since a caller often has one', () => {
    expect(isSlddFile('/work/data/Params.SLDD')).toBe(true);
    expect(isModelFile('C:\\work\\Engine.slx')).toBe(true);
  });
});
