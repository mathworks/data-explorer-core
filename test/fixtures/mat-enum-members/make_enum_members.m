% Copyright 2026 The MathWorks, Inc.
% Authors the enumeration-member fixtures: structs, cells and struct arrays that hold an
% enumeration value (MATLAB's matlab.lang.OnOffSwitchState, and GearMode, a custom one, from
% ../mcos) beside plain members, at every depth, so that an edit of a plain member beside one can
% be made by this package and compared with what MATLAB makes of the same assignment. A
% MAT-file stores an enumeration value as a class-17 element whose fourth part is an instance
% struct (MatParser.enumerationInstanceOf), not the object handle every other object has. A
% script, not a function: the caller sets `outDir`, a folder per release, then runs it (one
% line: mw splits -batch on newlines):
%
%   mw -using Bmain matlab -nodesktop -batch "outDir='<this folder>/r2027a'; run('<this folder>/make_enum_members.m')"
%   mw -using BR2023bd matlab -nodesktop -batch "outDir='<this folder>/r2023b'; run('<this folder>/make_enum_members.m')"
%
% It writes into outDir enum_members.mat (save -v7) and enum_members_nc.mat (save -v7
% -nocompression), the same variables, and prints READBACK same for each variable of each, and
% MAKE_ENUM_MEMBERS_DONE last. Loading either needs ../mcos on the path, for GearMode.
if ~exist('outDir', 'var') || isempty(outDir)
  error('make_enum_members:outDir', 'Set outDir to the folder to write into, then run this script.');
end
if ~exist(outDir, 'dir')
  mkdir(outDir);
end
here = fileparts(mfilename('fullpath'));
addpath(fullfile(here, '..', 'mcos'));
fprintf('VERSION %s\n', version);

on = matlab.lang.OnOffSwitchState.on;
off = matlab.lang.OnOffSwitchState.off;
S = struct();
S.sEnum = struct('e', on, 'd', 1, 'c', 'abc', 'i', int8(3), 'z', 2 + 3i, 'l', true, 'v', [1 2 3]);
S.cEnum = {off, 2, 'y', [1 2 3], int16(4)};
S.cEnumCol = {on; 5};
S.c2x2Enum = {on, 1; 'z', off};
S.sEnumVec = struct('e', [on off on], 'd', 5);
S.cEnumVec = {[on off], 6};
S.sEnumEmpty = struct('e', matlab.lang.OnOffSwitchState.empty(1, 0), 'd', 1);
S.sCellEnum = struct('inner', {{on, 7}}, 'k', 3);
S.cStructEnum = {struct('e', on, 'd', 1), 4};
S.deepEnum = struct('a', struct('b', {{struct('e', off, 'x', 1), 2}}));
S.saEnum = struct('e', {on, off}, 'd', {1, 2});
S.gearInStruct = struct('g', GearMode.Reverse, 'd', 1);
S.gearInCell = {GearMode.Drive, 'w'};
S.enumAndParam = struct('e', on, 'p', Simulink.Parameter(2), 'd', 1);
S.enumAndString = struct('e', on, 's', "str", 'd', 1);
S.topEnum = on;
S.topGear = GearMode.Park;
S.plain = 1;

files = {'enum_members.mat', {'-v7'}; 'enum_members_nc.mat', {'-v7', '-nocompression'}};
names = fieldnames(S);
for f = 1:size(files, 1)
  matFile = fullfile(outDir, files{f, 1});
  if exist(matFile, 'file'), delete(matFile); end
  lastwarn('');
  save(matFile, '-struct', 'S', files{f, 2}{:});
  [w, wid] = lastwarn;
  if ~isempty(w), fprintf('SAVE WARNING %s %s\n', wid, w); end
  fprintf('WROTE %s\n', matFile);
  lastwarn('');
  T = load(matFile);
  [w, wid] = lastwarn;
  if ~isempty(w), fprintf('LOAD WARNING %s %s\n', wid, w); end
  for i = 1:numel(names)
    n = names{i};
    if isfield(T, n) && isequaln(S.(n), T.(n)) && strcmp(class(S.(n)), class(T.(n)))
      fprintf('READBACK same %s %s\n', files{f, 1}, n);
    else
      fprintf('READBACK DIFFERS %s %s\n', files{f, 1}, n);
    end
  end
end
fprintf('MAKE_ENUM_MEMBERS_DONE\n');
