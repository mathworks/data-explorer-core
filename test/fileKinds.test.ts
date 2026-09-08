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
  isModelFile,
  isSlddFile,
  isMatFile,
  isProjectFile,
} from '../src/index.js';

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
