function make_coder_info(out)
% Copyright 2026 The MathWorks, Inc.
%
% Simulink.Parameter objects on both sides of CoderInfo.HasCoderInfo, written by MATLAB to a MAT-file,
% a compressed-binary dictionary and a JSON text dictionary. A Parameter read out of a model
% workspace holds HasCoderInfo false and an empty CustomAttributes, and MATLAB ignores its CoderInfo
% when it reads it back from a MAT-file or a binary dictionary: a StorageClass or an Identifier set
% on it is lost there (a text dictionary keeps it). One made in the base workspace holds true and
% MATLAB's default object, and keeps every CoderInfo edit everywhere.
%   pWs   a Parameter taken from a model workspace with getVariable (HasCoderInfo false), with a Value,
%         a Min, a Max, a Unit and a Description
%   pNew  a Parameter made in the base workspace (HasCoderInfo true), with a StorageClass, an
%         Identifier and an Alignment set
%   sWs   a Simulink.Signal taken from a model workspace, in the files only if MATLAB gives it
%         HasCoderInfo false (made.json says which)
% The model workspace is a scratch model, saved and loaded again so the objects are read out of a
% file as a user's would be, then removed; it is not a fixture.
%
% No account name in any file: USER is a fixed word while a dictionary is written, and every file,
% and every part of each package, is searched for the account name.
%
% Run from this folder; it writes r<release>/ (R2027a is the release these fixtures are for):
%   mw -using Bmain matlab -nodesktop -batch "make_coder_info(pwd)"
% It writes into r<release>/:
%   coder_info.mat           save -v7
%   coder_info_binary.sldd   Design Data, FileFormat 'compressed-binary'
%   coder_info_text.sldd     Design Data, FileFormat 'uncompressed-text'
%   made.json                for each name and file: HasCoderInfo and HasCoderInfoForCopy (from
%                            struct(CoderInfo)), StorageClass, the class of CustomAttributes, and
%                            whether it reads back isequal to what was written
% A re-run gives new UUIDs and timestamps, and the same values. Verify by the WROTE lines, no ACCOUNT
% NAME line, and the trailing MAKE_CODER_INFO_DONE.
folder = fullfile(out, ['r' version('-release')]);
if ~isfolder(folder), mkdir(folder); end
user = getenv('USER');
failures = {};
warning('off', 'Simulink:Data:UDDData_Inconsistent');

%% The values. pWs and sWs from a scratch model's workspace, saved and read back.
work = tempname;
mkdir(work);
cleanup = onCleanup(@() rmdir(work, 's')); %#ok<NASGU>
mdl = 'coder_info_scratch';
if bdIsLoaded(mdl), close_system(mdl, 0); end
new_system(mdl);
set_param(mdl, 'Creator', 'fixture', 'ModifiedByFormat', 'fixture');
ws = get_param(mdl, 'ModelWorkspace');
p = Simulink.Parameter(2.5);
p.Min = 0;
p.Max = 10;
p.Unit = 'm';
p.Description = 'a Parameter from a model workspace';
assignin(ws, 'pWs', p);
s = Simulink.Signal;
s.Description = 'a Signal from a model workspace';
assignin(ws, 'sWs', s);
clear ws
save_system(mdl, fullfile(work, [mdl '.slx']));
close_system(mdl, 0);
load_system(fullfile(work, [mdl '.slx']));
ws = get_param(mdl, 'ModelWorkspace');
pWs = getVariable(ws, 'pWs');
sWs = getVariable(ws, 'sWs');
clear ws
close_system(mdl, 0);

pNew = Simulink.Parameter(3);
pNew.Description = 'a Parameter made in the base workspace';
pNew.CoderInfo.StorageClass = 'ExportedGlobal';
pNew.CoderInfo.Identifier = 'pNewId';
pNew.CoderInfo.Alignment = 8;

names = {'pWs', 'pNew'};
values = {pWs, pNew};
sWsInfo = struct(sWs.CoderInfo);
if sWsInfo.HasCoderInfo
  left = sprintf('sWs: a model-workspace Signal holds HasCoderInfo true, so it is left out');
else
  names{end + 1} = 'sWs';
  values{end + 1} = sWs;
  left = '';
end

rec = struct('name', names, 'class', '', 'made', [], 'mat', [], 'binary', [], 'text', []);
for i = 1:numel(names)
  rec(i).class = class(values{i});
  rec(i).made = info(values{i}, values{i});
end

%% The MAT-file.
S = cell2struct(values, names, 2);
file = fullfile(folder, 'coder_info.mat');
save(file, '-struct', 'S', '-v7');
fprintf('WROTE %s\n', file);
failures = noUser(failures, file, 'coder_info.mat', user);
T = load(file);
for i = 1:numel(names), rec(i).mat = info(values{i}, T.(names{i})); end

%% The dictionaries. MATLAB keys open dictionaries by file name, and holding a section handle counts
%% as holding the dictionary open, so ds is cleared before each close.
F = {'binary', 'compressed-binary'; 'text', 'uncompressed-text'};
Simulink.data.dictionary.closeAll('-discard');
for f = 1:size(F, 1)
  tag = F{f, 1};
  name = ['coder_info_' tag '.sldd'];
  fn = fullfile(folder, name);
  if isfile(fn), delete(fn); end
  setenv('USER', 'fixture');
  restoreUser = onCleanup(@() setenv('USER', user));
  dd = Simulink.data.dictionary.create(fn);
  dd.FileFormat = F{f, 2};
  ds = dd.getSection('Design Data');
  for i = 1:numel(names), ds.addEntry(names{i}, values{i}); end
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
  for i = 1:numel(names), rec(i).(tag) = info(values{i}, ds.getEntry(names{i}).getValue()); end
  clear ds
  dd.close();
  clear dd
  Simulink.data.dictionary.closeAll('-discard');
end

%% The record.
made = struct('version', version, 'release', version('-release'), 'values', rec, 'leftOut', left, ...
  'sWsAsRead', info(sWs, sWs));
madeFile = fullfile(folder, 'made.json');
fid = fopen(madeFile, 'w', 'n', 'UTF-8');
fprintf(fid, '%s\n', jsonencode(made, 'PrettyPrint', true));
fclose(fid);
fprintf('WROTE %s\n', madeFile);
failures = noUser(failures, madeFile, 'made.json', user);
for i = 1:numel(rec)
  for where = {'made', 'mat', 'binary', 'text'}
    r = rec(i).(where{1});
    fprintf('REC %-5s %-7s HasCoderInfo=%d HasCoderInfoForCopy=%d StorageClass=%s Identifier=%s Alignment=%d CustomAttributes=%s same=%d\n', ...
      rec(i).name, where{1}, r.HasCoderInfo, r.HasCoderInfoForCopy, r.StorageClass, r.Identifier, r.Alignment, r.CustomAttributes, r.same);
  end
end
if ~isempty(left), fprintf('LEFT OUT %s\n', left); end
for i = 1:numel(failures)
  fprintf('ACCOUNT NAME %s\n', failures{i});
end
fprintf('MAKE_CODER_INFO_DONE %s\n', version);
end

function r = info(written, read)
  % What struct(CoderInfo) says of `read`, and whether it is isequal to `written`.
  w = warning('off', 'MATLAB:structOnObject');
  s = struct(read.CoderInfo);
  warning(w);
  ca = s.CustomAttributes;
  if isobject(ca), caClass = class(ca); else, caClass = sprintf('[] (%s)', class(ca)); end
  r = struct('HasCoderInfo', logical(s.HasCoderInfo), 'HasCoderInfoForCopy', logical(s.HasCoderInfoForCopy), ...
    'StorageClass', read.CoderInfo.StorageClass, 'Identifier', read.CoderInfo.Identifier, ...
    'Alignment', read.CoderInfo.Alignment, 'CustomAttributes', caClass, 'same', isequal(written, read));
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
