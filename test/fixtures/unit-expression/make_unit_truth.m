% Copyright 2026 The MathWorks, Inc.
% MATLAB's verdict on each text of texts.json as a unit expression: a Simulink.ValueType's Unit and
% a Simulink.LookupTable's Table.Unit set to it, taken or refused, and the refusal's words. A
% script: the caller sets `release`, a tag, then runs it from any folder (one line):
%
%   mw -using Bmain matlab -nodesktop -batch "release='r2027a'; run('<this folder>/make_unit_truth.m')"
%   mw -using BR2023bd matlab -nodesktop -batch "release='r2023b'; run('<this folder>/make_unit_truth.m')"
%
% It writes truth_<release>.json beside this file: for each text, in order, [ValueType's refusal,
% Table's refusal], null where taken. make_unit_truth.mjs then merges the releases into truth.json,
% which test/unitExpression.test.ts holds unitExpression.ts to. Text read and written as UTF-8.
if ~exist('release', 'var') || isempty(release)
  error('make_unit_truth:release', 'Set release to a tag, then run this script.');
end
release = char(release);
here = fileparts(mfilename('fullpath'));
fid = fopen(fullfile(here, 'texts.json'), 'r', 'n', 'UTF-8');
texts = jsondecode(fread(fid, '*char')');
fclose(fid);
out = cell(numel(texts), 1);
for i = 1:numel(texts)
  s = texts{i};
  if isempty(s), s = ''; end
  r = cell(1, 2);
  v = Simulink.ValueType;
  try
    v.Unit = s;
  catch e
    r{1} = e.message;
  end
  lut = Simulink.LookupTable;
  try
    lut.Table.Unit = s;
  catch e
    r{2} = e.message;
  end
  out{i} = r;
end
fid = fopen(fullfile(here, ['truth_' release '.json']), 'w', 'n', 'UTF-8');
fwrite(fid, jsonencode(struct('version', version, 'verdicts', {out})), 'char');
fclose(fid);
fprintf('VERSION %s\nWROTE %d\nMAKE_UNIT_TRUTH_DONE\n', version, numel(out));
