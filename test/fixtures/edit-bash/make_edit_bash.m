% Copyright 2026 The MathWorks, Inc.
% Authors the edit-bash parity fixtures: one set of small values, leaves of every class and
% containers and objects nesting them, written by MATLAB under the same names to MAT-files, a
% JSON text dictionary and a compressed-binary dictionary, so an edit of a nested value can be
% made in each format and compared with what MATLAB makes of the same assignment. A script, not
% a function: the caller sets `outDir`, a folder per release, then runs it (one line: mw splits
% -batch on newlines):
%
%   mw -using Bmain matlab -nodesktop -batch "outDir='<this folder>/r2027a'; run('<this folder>/make_edit_bash.m')"
%   mw -using BR2023bd matlab -nodesktop -batch "outDir='<this folder>/r2023b'; run('<this folder>/make_edit_bash.m')"
%
% It writes into outDir:
%   values.mat           every value but those holding a function handle, save -v7
%   handles.mat          those, save -v7 -nocompression: MATLAB writes its own matlabroot into a
%                        function handle it saves, and scrub_matlabroot (../sparse) replaces it
%                        with a token of the same length, which it can do in an uncompressed file
%                        only; the handles are made with str2func, so they record no file
%   values_text.sldd     every value a dictionary takes, Design Data, FileFormat 'uncompressed-text'
%                        (only where the release has that format)
%   values_binary.sldd   the same, FileFormat 'compressed-binary'
%   made.json            for each name: its group (the block below it is made in), class, size
%                        and MAT-file, and for each file 'same' (held, and read back isequaln
%                        with the same class, size, complexity and sign of zero), 'differs: ...'
%                        (held, read back otherwise), 'refused: <MATLAB's error>' or 'n/a: <why>';
%                        and the values MATLAB would not construct at all
% make_manifest.mjs then merges the releases' made.json into manifest.json. A re-run gives new
% UUIDs and timestamps, and the same values. Verify by the CONTROLS CAUGHT and WROTE lines and
% the trailing MAKE_EDIT_BASH_DONE.
if ~exist('outDir', 'var') || isempty(outDir)
  error('make_edit_bash:outDir', 'Set outDir to the folder to write into, then run this script.');
end
if ~exist(outDir, 'dir')
  mkdir(outDir);
end
fprintf('VERSION %s\n', version);

%% Controls: pairs the comparer below must tell apart, or its 'same' would mean nothing.
ctl = {3.5, 4; -0, 0; int8(1), 1; complex(1, 0), 1; "a", 'a'; struct('a', 1), struct('a', 2); ...
  {1, {2}}, {1, {3}}; Simulink.Parameter(1), Simulink.Parameter(2)};
for i = 1:size(ctl, 1)
  if strcmp(compareText(ctl{i, 1}, ctl{i, 2}), 'same')
    error('make_edit_bash:control', 'The comparer took control pair %d as the same value.', i);
  end
end
fprintf('CONTROLS CAUGHT %d of %d\n', size(ctl, 1), size(ctl, 1));

%% Leaves: one of each class and shape a user edits. They also fill sLeaves and cLeaves.
L = {
  'dScalar',     3.5
  'dRow',        [1 2 3]
  'd2x3',        [1 2 3; 4 5 6]
  'dNegZero',    -0
  'dInf',        Inf
  'dNaN',        NaN
  'dNonFinite',  [Inf -Inf NaN]
  'zScalar',     complex(1, 2)
  'zArray',      [1+2i, 3-4i]
  'zZeroImag',   complex(1, 0)
  'zInt8',       complex(int8(1), int8(-2))
  'i8',          int8(-8)
  'i16',         int16(-16)
  'i32',         int32(-32)
  'i64',         -(int64(2)^53 + 1)
  'i64Max',      intmax('int64')
  'u8',          uint8(8)
  'u16',         uint16(16)
  'u32',         uint32(32)
  'u64',         uint64(2)^53 + 1
  'u64Max',      intmax('uint64')
  'sgl',         single(1.5)
  'sglRow',      single([0.1 -2.5])
  'lScalar',     true
  'lArray',      [true false true]
  'chRow',       'hello'
  'chEmpty',     ''
  'ch2Row',      ['ab'; 'cd']
  'strScalar',   "text"
  'strEmpty',    ""
  'strRow',      ["a" "b"]
  'str2x2',      ["a" "b"; "c" "d"]
  'dEmpty0x3',   zeros(0, 3)
  'i8Empty1x0',  zeros(1, 0, 'int8')
  'cEmpty',      {}
  'sNoFields',   struct()
  'sEmpty0x0',   struct('a', {})
  'nd2x2x2',     reshape(1:8, [2 2 2])
  };

%% Kinds a dictionary may not take, kept out of sLeaves and cLeaves so those stay in every file.
%% Each is also held alone in a struct field and in a cell, <name>InStruct.v and <name>InCell{1}.
X = {
  'strMissing',  string(missing)
  'spMatrix',    sparse([1 0; 0 2])
  'fnHandle',    str2func('@(x) x + 1')
  'enumOn',      matlab.lang.OnOffSwitchState.on
  };

%% Containers.
sLeaves = struct();
for i = 1:size(L, 1)
  sLeaves.(L{i, 1}) = L{i, 2};
end
cLeaves = L(:, 2)';
C = {
  'sLeaves',     sLeaves                                          % one field of each leaf
  'sArr',        struct('a', {1, 2, 3}, 'b', {'x', "y", int8(3)}) % 1x3 struct array
  'cLeaves',     cLeaves                                          % one element of each leaf, in L's order
  'c2x2',        {1, 'a'; "b", int8(2)}
  'sNest',       struct('c', {{1, struct('s', struct('f', 7))}})  % sNest.c{2}.s.f
  'cNest',       {{1, {3, "s"}}}                                  % cNest{1}{2}{1}
  'saCell',      struct('c', {{1, 'a'}, {struct('x', 2)}})        % saCell(2).c{1}.x
  'deep4',       struct('a', struct('b', {{struct('c', struct('d', 4))}})) % deep4.a.b{1}.c.d
  };
for i = 1:size(X, 1)
  C(end + 1, :) = {[X{i, 1} 'InStruct'], struct('v', X{i, 2})};
  C(end + 1, :) = {[X{i, 1} 'InCell'], X(i, 2)};
end

%% Objects, with nested values in them.
O = {};
notConstructed = struct('name', {}, 'what', {}, 'error', {});
p = Simulink.Parameter;
p.Value = struct('a', 1, 'b', int8([1 2]), 'inner', struct('x', 2, 'y', [1 2 3]));
O(end + 1, :) = {'pStruct', p};
try
  p = Simulink.Parameter;
  p.Value = struct('a', 1, 'c', {{1, 2}});
  O(end + 1, :) = {'pStructCell', p};
catch e
  notConstructed(end + 1) = struct('name', 'pStructCell', 'what', ...
    'Simulink.Parameter whose Value is struct(''a'', 1, ''c'', {{1, 2}})', 'error', e.message);
end
p = Simulink.Parameter;
p.Value = struct('a', {1, 2});
O(end + 1, :) = {'pStructArr', p};
O(end + 1, :) = {'pInt8', Simulink.Parameter(int8([1 2 3]))};
O(end + 1, :) = {'pComplex', Simulink.Parameter([1+2i, 3-4i])};
O(end + 1, :) = {'pMatrix', Simulink.Parameter([1 2; 3 4])};
p = Simulink.Parameter(5);
p.DataType = 'single';
p.Min = 0;
p.Max = 10;
p.Unit = 'm';
p.Description = 'distance to the wall';
O(end + 1, :) = {'pProps', p};
s = Simulink.Signal;
s.DataType = 'int16';
s.Dimensions = [1 3];
s.Min = -5;
s.Max = 5;
s.InitialValue = '0';
s.Description = 'a signal';
O(end + 1, :) = {'sig', s};
O(end + 1, :) = {'sHoldsParam', struct('p', Simulink.Parameter(2), 'n', 1)};
O(end + 1, :) = {'cHoldsParam', {Simulink.Parameter(3), 'x'}};
e1 = Simulink.BusElement;
e1.Name = 'e1';
e1.DataType = 'double';
e1.Dimensions = [1 2];
e2 = Simulink.BusElement;
e2.Name = 'e2';
e2.DataType = 'int8';
b = Simulink.Bus;
b.Elements = [e1 e2];
O(end + 1, :) = {'bus', b};
O(end + 1, :) = {'numType', fixdt(1, 16, 4)};

V = [L; X; C; O];
names = V(:, 1);
values = V(:, 2);
groups = [repmat({'leaf'}, size(L, 1), 1); repmat({'dictionary-edge'}, size(X, 1), 1)
  repmat({'container'}, size(C, 1), 1); repmat({'object'}, size(O, 1), 1)];
rec = struct('name', names, 'group', groups, 'class', '', 'size', '', 'matFile', '', 'mat', '', ...
  'text', '', 'binary', '');
for i = 1:numel(names)
  rec(i).class = class(values{i});
  rec(i).size = sizeText(values{i});
end

%% The MAT-files, read back after the scrub, so the record is of the committed bytes.
addpath(fullfile(fileparts(mfilename('fullpath')), '..', 'sparse'));
isHandle = cellfun(@holdsHandle, values);
M = {'values.mat', ~isHandle, {'-v7'}; 'handles.mat', isHandle, {'-v7', '-nocompression'}};
for m = 1:size(M, 1)
  matFile = fullfile(outDir, M{m, 1});
  pick = find(M{m, 2});
  if exist(matFile, 'file'), delete(matFile); end
  S = cell2struct(values(pick), names(pick), 1);
  lastwarn('');
  save(matFile, '-struct', 'S', M{m, 3}{:});
  [w, wid] = lastwarn;
  if ~isempty(w), fprintf('SAVE WARNING %s %s\n', wid, w); end
  if strcmp(M{m, 1}, 'handles.mat')
    [~, n] = scrub_matlabroot(matFile);
    fprintf('SCRUBBED %d matlabroot occurrences from %s\n', n, matFile);
  end
  fprintf('WROTE %s\n', matFile);
  lastwarn('');
  T = load(matFile);
  [w, wid] = lastwarn;
  if ~isempty(w), fprintf('LOAD WARNING %s %s\n', wid, w); end
  for i = pick'
    rec(i).matFile = M{m, 1};
    if ~isfield(T, names{i})
      rec(i).mat = 'differs: not in the file';
    else
      rec(i).mat = compareText(values{i}, T.(names{i}));
    end
  end
end

%% The dictionaries. MATLAB keys open dictionaries by file name, and holding a section handle
%% counts as holding the dictionary open, so ds is cleared before each close.
F = {'text', 'uncompressed-text'; 'binary', 'compressed-binary'};
Simulink.data.dictionary.closeAll('-discard');
for f = 1:size(F, 1)
  tag = F{f, 1};
  fn = fullfile(outDir, ['values_' tag '.sldd']);
  if exist(fn, 'file'), delete(fn); end
  dd = Simulink.data.dictionary.create(fn);
  try
    dd.FileFormat = F{f, 2};
  catch e
    % A release without the property writes its one, binary, format.
    if ~strcmp(tag, 'binary')
      dd.close();
      clear dd
      Simulink.data.dictionary.closeAll('-discard');
      delete(fn);
      [rec.(tag)] = deal(['n/a: ' e.message]);
      fprintf('NO %s DICTIONARY: %s\n', tag, e.message);
      continue
    end
  end
  % Saved after each entry: some values are taken by addEntry and refused by the save, which
  % names no entry, so the one just added is the one taken out again.
  ds = dd.getSection('Design Data');
  for i = 1:numel(names)
    try
      ds.addEntry(names{i}, values{i});
    catch e
      rec(i).(tag) = ['refused: ' e.message];
      continue
    end
    try
      dd.saveChanges();
      rec(i).(tag) = 'held';
    catch e
      rec(i).(tag) = ['refused by saveChanges: ' e.cause{1}.message];
      ds.deleteEntry(names{i});
    end
  end
  clear ds
  dd.saveChanges();
  dd.close();
  clear dd
  Simulink.data.dictionary.closeAll('-discard');
  fprintf('WROTE %s\n', fn);
  dd = Simulink.data.dictionary.open(fn);
  ds = dd.getSection('Design Data');
  for i = 1:numel(names)
    if strcmp(rec(i).(tag), 'held')
      try
        rec(i).(tag) = compareText(values{i}, ds.getEntry(names{i}).getValue());
      catch e
        rec(i).(tag) = ['differs: getValue failed: ' e.message];
      end
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
fid = fopen(fullfile(outDir, 'made.json'), 'w', 'n', 'UTF-8');
fprintf(fid, '%s\n', jsonencode(made, 'PrettyPrint', true));
fclose(fid);
fprintf('WROTE %s\n', fullfile(outDir, 'made.json'));
for i = 1:numel(rec)
  fprintf('REC %-12s %-24s %-8s mat=%s | text=%s | binary=%s\n', rec(i).name, rec(i).class, ...
    rec(i).size, rec(i).mat, rec(i).text, rec(i).binary);
end
for i = 1:numel(notConstructed)
  fprintf('NOT CONSTRUCTED %s: %s\n', notConstructed(i).name, notConstructed(i).error);
end
fprintf('MAKE_EDIT_BASH_DONE %s\n', version);

%% Local functions.
function t = sizeText(v)
  t = strjoin(arrayfun(@num2str, size(v), 'UniformOutput', false), 'x');
end

function tf = holdsHandle(v)
  % Whether v is a function handle or a struct or cell with one anywhere in it.
  if isa(v, 'function_handle')
    tf = true;
  elseif isstruct(v)
    c = struct2cell(v);
    tf = any(cellfun(@holdsHandle, c(:)));
  elseif iscell(v)
    tf = any(cellfun(@holdsHandle, v(:)));
  else
    tf = false;
  end
end

function t = compareText(a, b)
  % 'same', or 'differs: ' and each difference sameValue finds.
  why = sameValue(a, b, '');
  if isempty(why)
    t = 'same';
  else
    t = ['differs: ' strjoin(why, '; ')];
  end
end

function why = sameValue(a, b, at)
  % {} when b is a as MATLAB holds it: class, size, complexity, sparsity, the sign of a zero,
  % and the same recursively for fields, elements and properties. Otherwise where and how not.
  if isempty(at), here = 'value'; else, here = at; end
  why = {};
  if ~strcmp(class(a), class(b))
    why = {sprintf('%s class %s, read back %s', here, class(a), class(b))};
  elseif ~isequal(size(a), size(b))
    why = {sprintf('%s size %s, read back %s', here, sizeText(a), sizeText(b))};
  elseif isa(a, 'function_handle')
    if ~strcmp(func2str(a), func2str(b))
      why = {sprintf('%s %s, read back %s', here, func2str(a), func2str(b))};
    end
  elseif isstruct(a)
    fa = fieldnames(a);
    if ~isequal(fa, fieldnames(b))
      why = {sprintf('%s fields {%s}, read back {%s}', here, strjoin(fa', ','), strjoin(fieldnames(b)', ','))};
      return
    end
    for k = 1:numel(a)
      for j = 1:numel(fa)
        why = [why, sameValue(a(k).(fa{j}), b(k).(fa{j}), sprintf('%s(%d).%s', at, k, fa{j}))]; %#ok<AGROW>
      end
    end
  elseif iscell(a)
    for k = 1:numel(a)
      why = [why, sameValue(a{k}, b{k}, sprintf('%s{%d}', at, k))]; %#ok<AGROW>
    end
  elseif isobject(a) && ~isenum(a) && ~isstring(a)
    ps = properties(a);
    for k = 1:numel(a)
      for j = 1:numel(ps)
        why = [why, sameValue(a(k).(ps{j}), b(k).(ps{j}), sprintf('%s(%d).%s', at, k, ps{j}))]; %#ok<AGROW>
      end
    end
  elseif ~isequaln(a, b)
    why = {sprintf('%s not isequaln', here)};
  elseif isnumeric(a) && isreal(a) ~= isreal(b)
    why = {sprintf('%s isreal %d, read back %d', here, isreal(a), isreal(b))};
  elseif isnumeric(a) && issparse(a) ~= issparse(b)
    why = {sprintf('%s issparse %d, read back %d', here, issparse(a), issparse(b))};
  elseif isfloat(a) && ~isequaln(1 ./ real(full(a)), 1 ./ real(full(b)))
    why = {sprintf('%s the sign of a zero differs', here)};
  elseif isfloat(a) && ~isreal(a) && ~isequaln(1 ./ imag(full(a)), 1 ./ imag(full(b)))
    why = {sprintf('%s the sign of an imaginary zero differs', here)};
  end
end
