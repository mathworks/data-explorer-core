% The N-D shape fixtures: arrays, cells and string arrays of rank 3 and 4 that are vectors (one
% dimension past 1: 1x1x3, 1x1x1x3), which MATLAB's end+1 grows along it, and that are not
% (1x2x2, 2x1x2), which it refuses to grow; at the top, in a struct field and in a cell. Run once
% in each release; each writes into its own folder (r2027a/, r2023b/):
%   nd.mat          save -v7;
%   nd_text.sldd    the same in Design Data, FileFormat 'uncompressed-text' (where the release has it);
%   nd_binary.sldd  the same, FileFormat 'compressed-binary'.
here = fullfile(fileparts(mfilename('fullpath')), ['r' version('-release')]);
if ~exist(here, 'dir'), mkdir(here); end
S = struct();
S.c113 = reshape({1, 2, 3}, 1, 1, 3);
S.x113 = reshape([1 2 3], 1, 1, 3);
S.s113 = reshape(["a" "b" "c"], 1, 1, 3);
S.x1113 = reshape([1 2 3], 1, 1, 1, 3);
S.c122 = reshape({1, 2, 3, 4}, 1, 2, 2);
S.c212 = reshape({1, 2, 3, 4}, 2, 1, 2);
S.x122 = reshape(1:4, 1, 2, 2);
S.x212 = reshape(1:4, 2, 1, 2);
S.s122 = reshape(["a" "b" "c" "d"], 1, 2, 2);
S.st = struct('c113', {S.c113}, 'x113', S.x113);
S.cc = {S.c113, 7};
save(fullfile(here, 'nd.mat'), '-struct', 'S', '-v7');
names = fieldnames(S);
F = {'text', 'uncompressed-text'; 'binary', 'compressed-binary'};
Simulink.data.dictionary.closeAll('-discard');
for f = 1:size(F, 1)
  fn = fullfile(here, ['nd_' F{f, 1} '.sldd']);
  if exist(fn, 'file'), delete(fn); end
  dd = Simulink.data.dictionary.create(fn);
  try
    dd.FileFormat = F{f, 2};
  catch
    if ~strcmp(F{f, 1}, 'binary'), dd.close(); clear dd; Simulink.data.dictionary.closeAll('-discard'); delete(fn); continue; end
  end
  % Saved after each entry: a dictionary refuses some (R2027a's binary one an N-D string array,
  % 'expecting 2-D string array'), which are left out.
  ds = dd.getSection('Design Data');
  for i = 1:numel(names)
    ds.addEntry(names{i}, S.(names{i}));
    try
      dd.saveChanges();
    catch e
      fprintf('LEFT OUT %s of %s: %s\n', names{i}, fn, e.cause{1}.message);
      ds.deleteEntry(names{i});
    end
  end
  clear ds
  dd.saveChanges();
  dd.close();
  clear dd
  Simulink.data.dictionary.closeAll('-discard');
end
fprintf('WROTE %s\n', here);
