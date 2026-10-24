function make_shown_saved(outDir)
  % Copyright 2026 The MathWorks, Inc.
  % Authors shown_saved_text.sldd, shown_saved_binary.sldd and shown_saved.mat: the same objects
  % in a text dictionary, a binary one and a MAT-file, each holding a property MATLAB shows that
  % it saves under another name (test/shownSavedParity.test.ts). Run (one line: mw splits -batch
  % on newlines):
  %
  %   mw -using Bmain matlab -nodesktop -batch "cd('<this folder>'); make_shown_saved"
  %
  % `outDir` defaults to this folder. Verify by the WROTE lines and the trailing
  % MAKE_SHOWN_SAVED_DONE; a FAIL line means an entry below is not in the files. The SHOWN lines
  % are what MATLAB shows of each object, read back from each file, which the test holds every
  % file's rows to. A re-run gives new UUIDs and timestamps, and the same values.
  %
  % THE OBJECTS (Design Data, and variables of the MAT-file)
  %   ntBp    fixdt(1,16,8): Signedness, FractionLength and Slope saved as SignednessBool,
  %           FixedExponent and SlopeAdjustmentFactor
  %   ntSb    Unsigned, 8 bits, slope and bias scaling of Slope 0.375 (1.5 * 2^-2) and Bias 3
  %   ntAuto  binary point scaling, Signedness Auto (a 0x0 SignednessBool) and FractionLength 4
  %   pId     a Simulink.Parameter of ExportedGlobal storage whose Identifier is myId
  %   sId     a Simulink.Signal of ImportedExtern storage whose Identifier is ext_x
  if nargin < 1
    outDir = fileparts(mfilename('fullpath'));
  end
  objs = struct();
  objs.ntBp = fixdt(1, 16, 8);
  nt = Simulink.NumericType;
  nt.DataTypeMode = 'Fixed-point: slope and bias scaling';
  nt.Signedness = 'Unsigned';
  nt.WordLength = 8;
  nt.Slope = 0.375;
  nt.Bias = 3;
  objs.ntSb = nt;
  nt = Simulink.NumericType;
  nt.DataTypeMode = 'Fixed-point: binary point scaling';
  nt.Signedness = 'Auto';
  nt.FractionLength = 4;
  objs.ntAuto = nt;
  p = Simulink.Parameter(5);
  p.CoderInfo.StorageClass = 'ExportedGlobal';
  p.CoderInfo.Identifier = 'myId';
  objs.pId = p;
  s = Simulink.Signal;
  s.CoderInfo.StorageClass = 'ImportedExtern';
  s.CoderInfo.Identifier = 'ext_x';
  objs.sId = s;
  names = fieldnames(objs);

  matFile = fullfile(outDir, 'shown_saved.mat');
  save(matFile, '-struct', 'objs', '-v7');
  fprintf('WROTE %s\n', matFile);
  formats = {'uncompressed-text', 'text'; 'compressed-binary', 'binary'};
  for i = 1:size(formats, 1)
    fn = fullfile(outDir, ['shown_saved_' formats{i, 2} '.sldd']);
    if exist(fn, 'file'), delete(fn); end
    dd = Simulink.data.dictionary.create(fn);
    dd.FileFormat = formats{i, 1};
    ds = dd.getSection('Design Data');
    for k = 1:numel(names)
      try
        ds.addEntry(names{k}, objs.(names{k}));
      catch err
        fprintf('FAIL %s %s: %s\n', formats{i, 2}, names{k}, err.message);
      end
    end
    dd.saveChanges();
    dd.close();
    fprintf('WROTE %s\n', fn);
  end

  % What MATLAB shows of each, read back from each file.
  Simulink.data.dictionary.closeAll('-discard');
  loaded = load(matFile);
  shown('mat', loaded, names);
  for i = 1:size(formats, 1)
    dd = Simulink.data.dictionary.open(fullfile(outDir, ['shown_saved_' formats{i, 2} '.sldd']));
    ds = dd.getSection('Design Data');
    held = struct();
    for k = 1:numel(names)
      held.(names{k}) = ds.getEntry(names{k}).getValue();
    end
    dd.close();
    shown(formats{i, 2}, held, names);
  end
  Simulink.data.dictionary.closeAll('-discard');
  fprintf('MAKE_SHOWN_SAVED_DONE\n');
end

function shown(where, objs, names)
  for k = 1:numel(names)
    v = objs.(names{k});
    if isa(v, 'Simulink.NumericType')
      fprintf('SHOWN %s %s Signedness=%s WordLength=%d FractionLength=%g Slope=%g Bias=%g\n', where, names{k}, v.Signedness, v.WordLength, v.FractionLength, v.Slope, v.Bias);
    else
      fprintf('SHOWN %s %s StorageClass=%s Identifier=%s\n', where, names{k}, v.CoderInfo.StorageClass, v.CoderInfo.Identifier);
    end
  end
end
