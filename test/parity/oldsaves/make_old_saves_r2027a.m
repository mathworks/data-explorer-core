function make_old_saves_r2027a(outDir)
  % Copyright 2026 The MathWorks, Inc.
  % Authors old_saves_r2027a_binary.sldd and old_saves_r2027a_text.sldd: one dictionary, in
  % each format, holding the shapes no other binary fixture holds that the read-back of core's
  % older saves asks about (probe_old_saves_readback.m). Run (one line: mw splits -batch on
  % newlines):
  %
  %   mw -using Bmain matlab -nodesktop -batch "cd('<this folder>'); make_old_saves_r2027a"
  %
  % `outDir` defaults to this folder. Verify by the WROTE lines and the trailing
  % MAKE_OLD_SAVES_R2027A_DONE; a FAIL line means a shape below is not in the file. The
  % committed files were written by R2027a (27.1.0.3409468) on 2026-10-18; a re-run gives new
  % UUIDs and timestamps, and the same values. The old saves beside them were made from the
  % committed binary file (test/parity/matlab/old_saves.mjs), so a re-run here asks for them,
  % and for MATLAB's read-back, again.
  %
  % THE ENTRIES
  %   Configurations
  %     csAutosar   a default Simulink.ConfigSet switched to autosar.tlc: its target component
  %                 is a Simulink.STFCustomTargetCC, and the options autosar.tlc adds to it are
  %                 written as dynamic properties (Source="dynamic" PropertyType="...") in a
  %                 binary dictionary, and under _dynamic_properties in a text one
  %     csSimscape  a default Simulink.ConfigSet with an SSC.SimscapeCC attached, a component
  %                 no text dictionary lists under Simulink.ConfigComponent, where Simscape is
  %                 installed
  %   Other Data
  %     holdsMixed  an NdHolder whose Kids is [dexdata.DerivedSignal, Simulink.Signal]: a
  %                 Simulink.Signal array whose first element is a user's subclass of it (a
  %                 dictionary refuses a Simulink.Signal array as an entry's value, and Design
  %                 Data a value of a user's class; Other Data takes one, whose property may hold
  %                 the array)
  %     holdsBase   the same with the base class first, [Simulink.Signal, dexdata.DerivedSignal]
  %   Design Data
  %     sE00        struct([]), a 0x0 struct with no fields
  %     sE02        a 0x2 struct with no fields
  %     sE20        a 2x0 struct with no fields
  %     sE002       a 0x0x2 struct with no fields
  %     sE10ab      a 1x0 struct with fields a and b
  %     sHolds      a 1x1 struct whose field e is a 0x0 struct with field a, and whose field
  %                 none is a 0x0 struct with no fields
  here = fileparts(mfilename('fullpath'));
  if nargin < 1 || isempty(outDir)
    outDir = here;
  end
  addpath(fullfile(here, '..', '..', 'fixtures', 'mcos'));   % NdHolder, +dexdata
  Simulink.data.dictionary.closeAll('-discard');
  configs = {};
  try
    cs = Simulink.ConfigSet;
    cs.Name = 'csAutosar';
    switchTarget(cs, 'autosar.tlc', []);
    target = cs.getComponent('Code Generation').getComponent('Target');
    fprintf('CONFIG csAutosar target %s components %s\n', class(target), classesOf(cs.Components));
    configs(end + 1, :) = {'csAutosar', cs};
  catch err
    fprintf('FAIL csAutosar: %s\n', err.message);
  end
  try
    cs = Simulink.ConfigSet;
    cs.Name = 'csSimscape';
    attachComponent(cs, SSC.SimscapeCC);
    fprintf('CONFIG csSimscape components %s\n', classesOf(cs.Components));
    configs(end + 1, :) = {'csSimscape', cs};
  catch err
    fprintf('FAIL csSimscape: %s\n', err.message);
  end
  other = {};
  try
    mixed = NdHolder;
    mixed.Tag = 'mixed';
    mixed.Kids = [dexdata.DerivedSignal, Simulink.Signal];
    base = NdHolder;
    base.Tag = 'base';
    base.Kids = [Simulink.Signal, dexdata.DerivedSignal];
    fprintf('MIXED %s %s; BASE %s %s\n', class(mixed.Kids), classesOf(mixed.Kids), class(base.Kids), classesOf(base.Kids));
    other = {'holdsMixed', mixed; 'holdsBase', base};
  catch err
    fprintf('FAIL mixed signals: %s\n', err.message);
  end
  design = {};
  design(end + 1, :) = {'sE00', struct([])};
  design(end + 1, :) = {'sE02', repmat(struct(), 0, 2)};
  design(end + 1, :) = {'sE20', repmat(struct(), 2, 0)};
  design(end + 1, :) = {'sE002', repmat(struct(), [0 0 2])};
  design(end + 1, :) = {'sE10ab', struct('a', cell(1, 0), 'b', cell(1, 0))};
  design(end + 1, :) = {'sHolds', struct('x', 1, 'e', struct('a', {}), 'none', struct([]))};
  formats = {'uncompressed-text', 'text'; 'compressed-binary', 'binary'};
  for i = 1:size(formats, 1)
    fn = fullfile(outDir, ['old_saves_r2027a_' formats{i, 2} '.sldd']);
    if exist(fn, 'file'), delete(fn); end
    dd = Simulink.data.dictionary.create(fn);
    dd.FileFormat = formats{i, 1};
    ds = dd.getSection('Design Data');
    for k = 1:size(design, 1)
      try
        ds.addEntry(design{k, 1}, design{k, 2});
      catch err
        fprintf('FAIL %s %s: %s\n', formats{i, 2}, design{k, 1}, err.message);
      end
    end
    os = dd.getSection('Other Data');
    for k = 1:size(other, 1)
      try
        os.addEntry(other{k, 1}, other{k, 2});
      catch err
        fprintf('FAIL %s %s: %s\n', formats{i, 2}, other{k, 1}, err.message);
      end
    end
    cfg = dd.getSection('Configurations');
    for k = 1:size(configs, 1)
      try
        cfg.addEntry(configs{k, 1}, configs{k, 2});
      catch err
        fprintf('FAIL %s %s: %s\n', formats{i, 2}, configs{k, 1}, err.message);
      end
    end
    clear ds os cfg
    dd.saveChanges();
    dd.close();
    fprintf('WROTE %s\n', fn);
  end
  % What MATLAB reads of each entry, back from the binary file.
  dd = Simulink.data.dictionary.open(fullfile(outDir, 'old_saves_r2027a_binary.sldd'));
  for s = {'Design Data', 'Other Data', 'Configurations'}
    entries = find(getSection(dd, s{1})); %#ok<GTARG>
    for k = 1:numel(entries)
      v = getValue(entries(k));
      fprintf('READ %s %s %s %s\n', s{1}, entries(k).Name, class(v), mat2str(size(v)));
    end
  end
  close(dd);
  Simulink.data.dictionary.closeAll('-discard');
  fprintf('MAKE_OLD_SAVES_R2027A_DONE\n');
end

function s = classesOf(objects)
  s = strjoin(arrayfun(@(k) {class(objects(k))}, 1:numel(objects)), ',');
end
