function make_subclass_defaults(outDir)
  % Copyright 2026 The MathWorks, Inc.
  % Authors subclass_defaults_text.sldd and subclass_defaults_binary.sldd: one dictionary, in each
  % format, holding a default object of a user's subclass of each Simulink class a user subclasses
  % (+dexsub, beside this script), and a default Simulink.VariantConfigurations: what MATLAB saves of
  % an object it made with nothing set (test/descriptionApplies.test.ts). Run (one line):
  %
  %   mw -using Bmain matlab -nodesktop -batch "cd('<this folder>'); make_subclass_defaults"
  %
  % `outDir` defaults to this folder. Verify by the WROTE lines; the ISPROP lines are MATLAB's
  % isprop(obj, 'Description') of each. A re-run gives new UUIDs and timestamps, and the same values.
  if nargin < 1
    outDir = fileparts(mfilename('fullpath'));
  end
  addpath(fileparts(mfilename('fullpath')));
  cls = {'dexsub.Alias', 'dexsub.Num', 'dexsub.VT', 'dexsub.Bus', 'dexsub.Param', 'dexsub.Sig', 'Simulink.VariantConfigurations'};
  names = {'subAlias', 'subNum', 'subVT', 'subBus', 'subParam', 'subSig', 'vcDefault'};
  for k = 1:numel(cls)
    fprintf('ISPROP %s %d\n', cls{k}, isprop(feval(cls{k}), 'Description'));
  end
  Simulink.data.dictionary.closeAll('-discard');
  formats = {'uncompressed-text', 'text'; 'compressed-binary', 'binary'};
  for i = 1:size(formats, 1)
    fn = fullfile(outDir, ['subclass_defaults_' formats{i, 2} '.sldd']);
    if exist(fn, 'file'), delete(fn); end
    dd = Simulink.data.dictionary.create(fn);
    dd.FileFormat = formats{i, 1};
    ds = getSection(dd, 'Design Data');
    for k = 1:numel(cls)
      try
        addEntry(ds, names{k}, feval(cls{k}));
      catch err
        fprintf('FAIL %s %s: %s\n', formats{i, 2}, names{k}, err.message);
      end
    end
    saveChanges(dd);
    close(dd);
    fprintf('WROTE %s\n', fn);
  end
  Simulink.data.dictionary.closeAll('-discard');
end
