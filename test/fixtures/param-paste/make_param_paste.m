function make_param_paste(out)
% Copyright 2026 The MathWorks, Inc.
%
% Simulink.Parameter objects whose Value a paste into a MAT-file carried as its shown text, and so
% refused or changed: struct Values (shown as a summary such as `<1x1 struct>`, which no MATLAB text
% reads back as), integer and single scalars, and vectors (`<1x11 double>`). Written by MATLAB under
% the same names to a MAT-file, a JSON text dictionary and a compressed-binary dictionary, so a paste
% of each into a MAT-file, from each of the three, can be compared with MATLAB's own copy of it.
%
% One Parameter a Value, each with a Description: pNested is the shape of the case that found it
% (a struct holding a char and a struct of doubles); pInt16MinMax carries a DataType, a Min and a Max
% judged against the Value, and a Unit; pPlain held a double and pasted before. Beside them, the
% siblings a paste is to keep refusing: a struct Value holding a cell, and one holding an object.
% MATLAB makes no Parameter of either ("A valid structure must be numeric"), so each is recorded in
% made.json as not constructed, with MATLAB's error, and is in no file. A plain struct holding a cell,
% sCell, is in every file: a plain value, which a MAT-file holds, and a paste of it is to go on pasting.
%
% No account name in any file: USER is a fixed word while a dictionary is written, and every file,
% and every part of each package, is searched for the account name.
%
% Run from this folder; it writes r<release>/ (R2027a is the release these fixtures are for):
%   mw -using Bmain matlab -nodesktop -batch "make_param_paste(pwd)"
% It writes into r<release>/:
%   param_paste.mat          save -v7
%   param_paste_text.sldd    Design Data, FileFormat 'uncompressed-text'
%   param_paste_binary.sldd  Design Data, FileFormat 'compressed-binary'
%   made.json                for each name: its Value's class and size, and for each file 'same' (read
%                            back isequal in Value and every property, with the Value's class and
%                            size), 'differs: ...', or 'refused: <MATLAB's error>'; and the values
%                            MATLAB would not make
% A re-run gives new UUIDs and timestamps, and the same values. Verify by the WROTE lines, no
% ACCOUNT NAME line, and the trailing MAKE_PARAM_PASTE_DONE.
folder = fullfile(out, ['r' version('-release')]);
if ~isfolder(folder), mkdir(folder); end

names = {};
values = {};
notConstructed = struct('name', {}, 'error', {});
function add(name, value, description, varargin)
  % A Parameter MATLAB will not make is recorded, not written.
  try
    p = Simulink.Parameter;
    p.Value = value;
    p.Description = description;
    for k = 1:2:numel(varargin), p.(varargin{k}) = varargin{k + 1}; end
  catch e
    notConstructed(end + 1) = struct('name', name, 'error', e.message);
    return
  end
  names{end + 1} = name;
  values{end + 1} = p;
end

add('pNested', struct('m', 'x', 'g', struct('p', 1, 'q', 0.5, 'r', 0.25)), 'a struct holding a char and a struct of doubles');
add('pStructNest', struct('a', 1, 'b', struct('c', [1 2], 'd', 'x')), 'a nested struct');
add('pStructArr', struct('a', {1, 2}, 'b', {[1 2], [3 4]}), 'a 1x2 struct array');
add('pStructTyped', struct('k', int8(-5), 'u', uint16([1 2 3]), 'f', true, 's', single(1.5)), 'a struct of typed fields');
add('pInt16', int16(500), 'an int16');
add('pInt16MinMax', int16(50), 'an int16 with a type, a range and a unit', 'DataType', 'int16', 'Min', 0, 'Max', 100, 'Unit', 'm');
add('pSingle', single(2.5), 'a single');
add('pVec', 0:0.1:1, 'a 1x11 double vector');
add('pInt32Vec', int32([1 2 3 4]), 'an int32 vector');
add('pPlain', 5, 'a double, which pasted before');
% The siblings a paste is to keep refusing.
add('pStructCell', struct('a', 1, 'c', {{1, 'x'}}), 'a struct holding a cell');
add('pStructObj', struct('o', Simulink.Parameter(1)), 'a struct holding an object');
% A struct holding a cell as a plain variable, in every file: a MAT-file holds it, and a paste of it
% is to go on pasting.
names{end + 1} = 'sCell';
values{end + 1} = struct('a', 1, 'c', {{1, 'x'}});

rec = struct('name', names, 'class', '', 'size', '', 'mat', '', 'text', '', 'binary', '');
for i = 1:numel(names)
  if isa(values{i}, 'Simulink.Parameter'), v = values{i}.Value; else, v = values{i}; end
  rec(i).class = class(v);
  rec(i).size = sizeText(v);
end
user = getenv('USER');
failures = {};

%% The MAT-file.
S = cell2struct(values, names, 2);
file = fullfile(folder, 'param_paste.mat');
save(file, '-struct', 'S', '-v7');
fprintf('WROTE %s\n', file);
failures = noUser(failures, file, 'param_paste.mat', user);
T = load(file);
for i = 1:numel(names)
  rec(i).mat = compareText(values{i}, T.(names{i}));
end

%% The dictionaries. MATLAB keys open dictionaries by file name, and holding a section handle
%% counts as holding the dictionary open, so ds is cleared before each close. USER is a fixed word
%% while each is written, which is what a dictionary records as who changed it.
F = {'text', 'uncompressed-text'; 'binary', 'compressed-binary'};
Simulink.data.dictionary.closeAll('-discard');
for f = 1:size(F, 1)
  tag = F{f, 1};
  name = ['param_paste_' tag '.sldd'];
  fn = fullfile(folder, name);
  if exist(fn, 'file'), delete(fn); end
  setenv('USER', 'fixture');
  restoreUser = onCleanup(@() setenv('USER', user));
  dd = Simulink.data.dictionary.create(fn);
  dd.FileFormat = F{f, 2};
  ds = dd.getSection('Design Data');
  for i = 1:numel(names)
    try
      ds.addEntry(names{i}, values{i});
      dd.saveChanges();
      rec(i).(tag) = 'held';
    catch e
      rec(i).(tag) = ['refused: ' e.message];
    end
  end
  clear ds
  dd.saveChanges();
  dd.close();
  clear dd
  Simulink.data.dictionary.closeAll('-discard');
  clear restoreUser
  if ~strcmp(getenv('USER'), user), failures{end + 1} = 'USER was not restored after a dictionary was written'; end %#ok<AGROW>
  fprintf('WROTE %s\n', fn);
  if strcmp(tag, 'binary')
    failures = zipNoUser(failures, fn, name, user);
  else
    failures = noUser(failures, fn, name, user);
  end
  dd = Simulink.data.dictionary.open(fn);
  ds = dd.getSection('Design Data');
  for i = 1:numel(names)
    if strcmp(rec(i).(tag), 'held')
      rec(i).(tag) = compareText(values{i}, ds.getEntry(names{i}).getValue());
    end
  end
  clear ds
  dd.close();
  clear dd
  Simulink.data.dictionary.closeAll('-discard');
end

%% The record.
made = struct('version', version, 'release', version('-release'), 'values', rec, ...
  'notConstructed', {num2cell(notConstructed)});
madeFile = fullfile(folder, 'made.json');
fid = fopen(madeFile, 'w', 'n', 'UTF-8');
fprintf(fid, '%s\n', jsonencode(made, 'PrettyPrint', true));
fclose(fid);
fprintf('WROTE %s\n', madeFile);
failures = noUser(failures, madeFile, 'made.json', user);
for i = 1:numel(rec)
  fprintf('REC %-12s %-8s %-6s mat=%s | text=%s | binary=%s\n', rec(i).name, rec(i).class, rec(i).size, ...
    rec(i).mat, rec(i).text, rec(i).binary);
end
for i = 1:numel(notConstructed)
  fprintf('NOT CONSTRUCTED %s: %s\n', notConstructed(i).name, notConstructed(i).error);
end
for i = 1:numel(failures)
  fprintf('ACCOUNT NAME %s\n', failures{i});
end
fprintf('MAKE_PARAM_PASTE_DONE %s\n', version);
end

function t = sizeText(v)
  t = strjoin(arrayfun(@num2str, size(v), 'UniformOutput', false), 'x');
end

function t = compareText(a, b)
  % 'same' when b is a Parameter isequal to a in its Value and every property, with the Value's
  % class and size (a plain value: isequaln, with its class and size); otherwise 'differs: ' and where.
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
  % Whether a file's bytes name the account that made it.
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
