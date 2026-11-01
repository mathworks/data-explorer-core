function make_param_paste_slx(out)
% Copyright 2026 The MathWorks, Inc.
%
% The model-workspace twin of param_paste.mat: an empty model whose model workspace (DataSource 'Model
% File') holds every variable of r<release>/param_paste.mat, under the same names, so a paste of each
% out of a model workspace can be compared with MATLAB's own copy of it. The variables are read from
% the MAT-file (make_param_paste.m makes it), so the two files cannot disagree on a value.
%
% A Parameter read back out of a model workspace holds CoderInfo.HasCoderInfo false and an empty
% CustomAttributes, where the same Parameter in a MAT-file holds true and MATLAB's default object;
% isequal does not see the difference. made.json records, per name, how getVariable reads each back
% (slx: 'same', 'differs: ...', 'refused: ...') and its HasCoderInfo (slxHasCoderInfo).
%
% No account name in the file: the model's Creator and ModifiedByFormat are a fixed word, and every
% part of the package is searched for the account name.
%
% Run from this folder, after make_param_paste.m:
%   mw -using Bmain matlab -nodesktop -batch "make_param_paste_slx(pwd)"
% It writes r<release>/param_paste.slx and adds the slx fields to r<release>/made.json. Verify by the
% WROTE lines, no ACCOUNT NAME line, and the trailing MAKE_PARAM_PASTE_SLX_DONE.
folder = fullfile(out, ['r' version('-release')]);
S = load(fullfile(folder, 'param_paste.mat'));
names = fieldnames(S);
user = getenv('USER');
failures = {};

% The model is named for the file it is saved to: save_system to another name renames it.
mdl = 'param_paste';
slxPath = fullfile(folder, [mdl '.slx']);
if bdIsLoaded(mdl), close_system(mdl, 0); end
if isfile(slxPath), delete(slxPath); end
new_system(mdl);
set_param(mdl, 'Creator', 'fixture', 'ModifiedByFormat', 'fixture');
ws = get_param(mdl, 'ModelWorkspace');
if ~strcmp(ws.DataSource, 'Model File')
  failures{end + 1} = sprintf('the new model workspace''s DataSource is %s', ws.DataSource);
end
refused = containers.Map();
for i = 1:numel(names)
  try
    assignin(ws, names{i}, S.(names{i}));
  catch e
    refused(names{i}) = e.message;
  end
end
save_system(mdl, slxPath);
close_system(mdl, 0);
clear ws
fprintf('WROTE %s\n', slxPath);
failures = zipNoUser(failures, slxPath, [mdl '.slx'], user);

% Read back, from the saved model.
load_system(slxPath);
ws = get_param(mdl, 'ModelWorkspace');
fprintf('DATASOURCE %s\n', ws.DataSource);
madeFile = fullfile(folder, 'made.json');
made = jsondecode(fileread(madeFile));
for i = 1:numel(made.values)
  n = made.values(i).name;
  if isKey(refused, n)
    made.values(i).slx = ['refused: ' refused(n)];
    made.values(i).slxHasCoderInfo = [];
    continue
  end
  v = getVariable(ws, n);
  made.values(i).slx = compareText(S.(n), v);
  if isa(v, 'Simulink.Parameter')
    s = struct(v.CoderInfo);
    made.values(i).slxHasCoderInfo = logical(s.HasCoderInfo);
  else
    made.values(i).slxHasCoderInfo = [];
  end
end
clear ws
close_system(mdl, 0);
fid = fopen(madeFile, 'w', 'n', 'UTF-8');
fprintf(fid, '%s\n', jsonencode(made, 'PrettyPrint', true));
fclose(fid);
fprintf('WROTE %s\n', madeFile);
for i = 1:numel(made.values)
  fprintf('REC %-12s slx=%s HasCoderInfo=%s\n', made.values(i).name, made.values(i).slx, mat2str(made.values(i).slxHasCoderInfo));
end
for i = 1:numel(failures)
  fprintf('ACCOUNT NAME %s\n', failures{i});
end
fprintf('MAKE_PARAM_PASTE_SLX_DONE %s\n', version);
end

function t = sizeText(v)
  t = strjoin(arrayfun(@num2str, size(v), 'UniformOutput', false), 'x');
end

function t = compareText(a, b)
  % make_param_paste.m's: 'same' when b is a Parameter isequal to a in its Value and every property,
  % with the Value's class and size (a plain value: isequaln, with its class and size).
  why = {};
  if ~isa(a, 'Simulink.Parameter')
    if ~strcmp(class(a), class(b)) || ~isequal(size(a), size(b)) || ~isequaln(a, b)
      why = {sprintf('read back %s %s, not isequaln', class(b), sizeText(b))};
    end
  elseif ~isa(b, 'Simulink.Parameter')
    why = {sprintf('read back as %s', class(b))};
  else
    ps = properties(a);
    for j = 1:numel(ps)
      va = a.(ps{j});
      vb = b.(ps{j});
      if ~strcmp(class(va), class(vb))
        why{end + 1} = sprintf('%s class %s, read back %s', ps{j}, class(va), class(vb)); %#ok<AGROW>
      elseif ~isequal(size(va), size(vb))
        why{end + 1} = sprintf('%s size %s, read back %s', ps{j}, sizeText(va), sizeText(vb)); %#ok<AGROW>
      elseif ~isequaln(va, vb)
        why{end + 1} = sprintf('%s not isequaln', ps{j}); %#ok<AGROW>
      end
    end
  end
  if isempty(why)
    t = 'same';
  else
    t = ['differs: ' strjoin(why, '; ')];
  end
end

function failures = noUser(failures, path, label, user)
  if isempty(user), return, end
  fid = fopen(path, 'r');
  bytes = fread(fid, Inf, 'uint8=>char')';
  fclose(fid);
  if contains(bytes, user)
    failures{end + 1} = sprintf('%s names the account that saved it', label);
  end
end

function failures = zipNoUser(failures, path, label, user)
  % A package: its deflated parts hide from a search of its bytes, so each is searched unpacked, in a
  % scratch folder removed again before this returns.
  tmp = tempname;
  mkdir(tmp);
  cleanup = onCleanup(@() rmdir(tmp, 's')); %#ok<NASGU>
  files = unzip(path, tmp);
  for k = 1:numel(files)
    if isfile(files{k})
      [~, part, ext] = fileparts(files{k});
      failures = noUser(failures, files{k}, sprintf('%s part %s%s', label, part, ext), user);
    end
  end
end
