function make_classes_r2027a(outDir)
  % Copyright 2026 The MathWorks, Inc.
  % Authors classes_r2027a_text.sldd and classes_r2027a_binary.sldd: one dictionary, in each
  % format, holding a MATLAB-written default (or lightly set) instance of each class below, so
  % a test can read what MATLAB itself stores for them. Run (one line: mw splits -batch on
  % newlines):
  %
  %   mw -using Bmain matlab -nodesktop -batch "cd('<this folder>'); make_classes_r2027a"
  %
  % `outDir` defaults to this folder. The committed files were written by R2027a
  % (27.1.0.3409468) on 2026-10-16; a re-run gives new UUIDs and timestamps, and the same
  % values.
  %
  % THE ENTRIES (Design Data):
  %   lutD, bpD    Simulink.LookupTable and Simulink.Breakpoint, defaults
  %   sigC         Simulink.Signal, Complexity 'complex', DimensionsMode 'Variable'
  %   sigR         Simulink.Signal, Complexity 'real', DimensionsMode 'Fixed'
  %   sigA         Simulink.Signal, Complexity set to 'complex' and back to 'auto'
  %   sigNo        Simulink.Signal, default
  %   pAl8         Simulink.Parameter(1), StorageClass 'ExportedGlobal', Alignment 8
  %   pAlM1        Simulink.Parameter(1), StorageClass 'ExportedGlobal', Alignment 8 and
  %                back to -1
  %   pSC          Simulink.Parameter(1), StorageClass 'ExportedGlobal'
  %   pNo          Simulink.Parameter(1)
  %   sAl16        Simulink.Signal, StorageClass 'ExportedGlobal', Alignment 16
  %   busAl8       Simulink.Bus, Alignment 8
  %   vbD          Simulink.VariantBank, default (a saveobj envelope, and no Value: the class
  %                has none)
  %   vbciD        Simulink.VariantBankCoderInfo, default
  if nargin < 1 || isempty(outDir)
    outDir = fileparts(mfilename('fullpath'));
  end
  Simulink.data.dictionary.closeAll('-discard');
  formats = {'uncompressed-text', 'text'; 'compressed-binary', 'binary'};
  for i = 1:size(formats, 1)
    fn = fullfile(outDir, ['classes_r2027a_' formats{i, 2} '.sldd']);
    if exist(fn, 'file'), delete(fn); end
    dd = Simulink.data.dictionary.create(fn);
    dd.FileFormat = formats{i, 1};
    ds = dd.getSection('Design Data');
    ds.addEntry('lutD', Simulink.LookupTable);
    ds.addEntry('bpD', Simulink.Breakpoint);
    sC = Simulink.Signal; sC.Complexity = 'complex'; sC.DimensionsMode = 'Variable';
    ds.addEntry('sigC', sC);
    sR = Simulink.Signal; sR.Complexity = 'real'; sR.DimensionsMode = 'Fixed';
    ds.addEntry('sigR', sR);
    sA = Simulink.Signal; sA.Complexity = 'complex'; sA.Complexity = 'auto';
    ds.addEntry('sigA', sA);
    ds.addEntry('sigNo', Simulink.Signal);
    pA = Simulink.Parameter(1); pA.CoderInfo.StorageClass = 'ExportedGlobal'; pA.CoderInfo.Alignment = 8;
    ds.addEntry('pAl8', pA);
    pM = Simulink.Parameter(1); pM.CoderInfo.StorageClass = 'ExportedGlobal'; pM.CoderInfo.Alignment = 8; pM.CoderInfo.Alignment = -1;
    pSC = Simulink.Parameter(1); pSC.CoderInfo.StorageClass = 'ExportedGlobal';
    ds.addEntry('pSC', pSC);
    ds.addEntry('pAlM1', pM);
    ds.addEntry('pNo', Simulink.Parameter(1));
    sAl = Simulink.Signal; sAl.CoderInfo.StorageClass = 'ExportedGlobal'; sAl.CoderInfo.Alignment = 16;
    ds.addEntry('sAl16', sAl);
    bA = Simulink.Bus; bA.Alignment = 8;
    ds.addEntry('busAl8', bA);
    ds.addEntry('vbD', Simulink.VariantBank);
    ds.addEntry('vbciD', Simulink.VariantBankCoderInfo);
    clear ds
    dd.saveChanges();
    dd.close();
    fprintf('WROTE %s\n', fn);
  end
  Simulink.data.dictionary.closeAll('-discard');
  fprintf('MAKE_CLASSES_R2027A_DONE\n');
end
