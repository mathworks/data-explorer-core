function make_aligned_coderinfo(outDir)
  % Copyright 2026 The MathWorks, Inc.
  % Authors aligned_coderinfo.mat: a Simulink.Parameter and a Simulink.Signal whose CoderInfo
  % holds an Alignment and an Identifier, which MATLAB takes only under a storage class other
  % than Auto (test/pastedSavedKeys.test.ts). Run (one line: mw splits -batch on newlines):
  %
  %   mw -using Bmain matlab -nodesktop -batch "cd('<this folder>'); make_aligned_coderinfo"
  %
  % `outDir` defaults to this folder. Verify by the WROTE line and the SHOWN lines, what MATLAB
  % reads back of each.
  %
  %   pAl   Simulink.Parameter(5), ExportedGlobal, Alignment 8, Identifier myAl
  %   sAl   Simulink.Signal, ExportedGlobal, Alignment 16
  if nargin < 1
    outDir = fileparts(mfilename('fullpath'));
  end
  objs = struct();
  p = Simulink.Parameter(5);
  p.CoderInfo.StorageClass = 'ExportedGlobal';
  p.CoderInfo.Alignment = 8;
  p.CoderInfo.Identifier = 'myAl';
  objs.pAl = p;
  s = Simulink.Signal;
  s.CoderInfo.StorageClass = 'ExportedGlobal';
  s.CoderInfo.Alignment = 16;
  objs.sAl = s;
  matFile = fullfile(outDir, 'aligned_coderinfo.mat');
  save(matFile, '-struct', 'objs', '-v7');
  fprintf('WROTE %s\n', matFile);
  loaded = load(matFile);
  for n = fieldnames(loaded)'
    ci = loaded.(n{1}).CoderInfo;
    fprintf('SHOWN %s StorageClass=%s Alignment=%d Identifier=%s\n', n{1}, ci.StorageClass, ci.Alignment, ci.Identifier);
  end
end
