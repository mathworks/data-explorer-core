function make_enum_containers(outDir)
  % Copyright 2026 The MathWorks, Inc.
  % Authors test/fixtures/enum-containers/<release>/: enumeration values inside a cell and a struct,
  % a logical-backed one (matlab.lang.OnOffSwitchState) and an int32-backed one (GearMode,
  % test/fixtures/mcos), at the shapes a paste carries: a scalar, a row, a column, a 2x2, an empty,
  % two in one cell. As a MAT-file (values.mat), and as MATLAB's own text dictionary of the same
  % values (values_text.sldd), which says how MATLAB writes each there. No binary twin: every binary
  % fixture is one the M9 merged-saves truth asks MATLAB about (test/parity/m9MergedSaves.truth.test.ts).
  % test/pasteEnumContainers.test.ts pastes values.mat's into dictionaries (open-questions 14, B and C).
  % Run once, from a folder of its own (a dictionary is created in place):
  %
  %   mw -using Bmain matlab -nodesktop -batch "cd /tmp; addpath('<this folder>'); make_enum_containers('<this folder>/enum-containers/r2027a')"
  %
  % (One line: mw splits a -batch argument on newlines.) Verify by the WROTE lines and the
  % trailing MAKE_ENUM_CONTAINERS_DONE.
  addpath(fullfile(fileparts(mfilename('fullpath')), 'mcos'));
  if ~exist(outDir, 'dir')
    mkdir(outDir);
  end
  on = matlab.lang.OnOffSwitchState.on;
  off = matlab.lang.OnOffSwitchState.off;
  V = struct();
  V.cOn = {on};
  V.cOff = {off};
  V.cOnRow = {[on off]};
  V.cOnCol = {[on; off]};
  V.cOn2x2 = {[on off; off on]};
  V.cOnEmpty = {matlab.lang.OnOffSwitchState.empty(1, 0)};
  V.cTwo = {on, off};
  V.sOn = struct('v', on);
  V.sOn2x2 = struct('v', [on off; off on]);
  V.cGear = {GearMode.Reverse};
  V.cGearRow = {[GearMode.Park GearMode.Reverse]};
  V.sGear = struct('v', GearMode.Reverse);
  save(fullfile(outDir, 'values.mat'), '-struct', 'V');
  fprintf('WROTE %s\n', fullfile(outDir, 'values.mat'));
  names = fieldnames(V);
  F = {'values_text.sldd', 'uncompressed-text'};
  for f = 1:size(F, 1)
    fn = fullfile(outDir, F{f, 1});
    dd = Simulink.data.dictionary.create(fn);
    dd.FileFormat = F{f, 2};
    ds = getSection(dd, 'Design Data');
    for i = 1:numel(names)
      addEntry(ds, names{i}, V.(names{i}));
    end
    saveChanges(dd);
    close(dd);
    fprintf('WROTE %s\n', fn);
  end
  Simulink.data.dictionary.closeAll('-discard');
  fprintf('MAKE_ENUM_CONTAINERS_DONE %s\n', version);
end
