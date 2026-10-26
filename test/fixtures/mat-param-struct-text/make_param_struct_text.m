% Copyright 2026 The MathWorks, Inc.
% Authors Simulink.Parameter objects whose struct Value holds text, as MATLAB writes them: a char
% field (MATLAB keeps a char there, of any shape, and refuses an empty one), a char field nested a
% level down, a two-row char, and a string field (which a MAT-file holds as an object of the file
% inside the Value). A script, not a function: the caller sets `outDir`, a folder per release:
%
%   mw -using Bmain matlab -nodesktop -batch "outDir='<this folder>/r2027a'; run('<this folder>/make_param_struct_text.m')"
%   mw -using BR2023bd matlab -nodesktop -batch "outDir='<this folder>/r2023b'; run('<this folder>/make_param_struct_text.m')"
%
% It writes param_text.mat (save -v7) and prints READBACK same per variable and
% MAKE_PARAM_STRUCT_TEXT_DONE last.
if ~exist('outDir', 'var') || isempty(outDir)
  error('make_param_struct_text:outDir', 'Set outDir to the folder to write into, then run this script.');
end
if ~exist(outDir, 'dir')
  mkdir(outDir);
end
fprintf('VERSION %s\n', version);
S = struct();
S.pChar = Simulink.Parameter;
S.pChar.Value = struct('a', 1, 'b', int8([1 2]));
S.pChar.Value.a = 'abc';
S.pNested = Simulink.Parameter;
S.pNested.Value = struct('k', 3, 'inner', struct('x', 2, 'y', [1 2 3]));
S.pNested.Value.inner.x = 'q';
S.pTwoRow = Simulink.Parameter;
S.pTwoRow.Value = struct('m', 5);
S.pTwoRow.Value.t = ['ab'; 'cd'];
S.pString = Simulink.Parameter;
S.pString.Value = struct('a', 1, 'b', int8([1 2]));
S.pString.Value.a = "abc";
S.plain = 1;
matFile = fullfile(outDir, 'param_text.mat');
if exist(matFile, 'file'), delete(matFile); end
save(matFile, '-struct', 'S', '-v7');
fprintf('WROTE %s\n', matFile);
lastwarn('');
T = load(matFile);
[w, wid] = lastwarn;
if ~isempty(w), fprintf('LOAD WARNING %s %s\n', wid, w); end
names = fieldnames(S);
for i = 1:numel(names)
  n = names{i};
  if isequaln(S.(n), T.(n))
    fprintf('READBACK same %s\n', n);
  else
    fprintf('READBACK DIFFERS %s\n', n);
  end
end
fprintf('MAKE_PARAM_STRUCT_TEXT_DONE\n');
