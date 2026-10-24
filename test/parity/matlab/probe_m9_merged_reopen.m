% Does MATLAB reopen S2's merged saves of a binary dictionary, and read every entry as it should?
% (M9 of the 2026-10-13 save-fidelity plan, the last of its MATLAB read-backs.)
%
% Since S2 (core #143) an edited entry of a compressed-binary dictionary is saved as the bytes it
% was read from with only the parts the edit changed written from the model. For each save
% m9_merged_saves.mjs makes through core's API (one edit per save: a rename, a Description, a bus
% element's Description or a struct field, of one entry of each kind in every binary fixture, and
% in a copy of a fixture as an earlier core save left it, where the merge differs from writing the
% entry whole):
%
%   (1) every entry nobody edited reads as it does in the original file: the same class, isequal
%       (isequaln, so that a NaN is equal to itself), and the same `fullsig`, wbcompare.m's
%       leaf-by-leaf spelling of class, size, complexity and value, which isequal is blind to
%       (isequal({int32(1)}, {1}) is true). An entry the original is not isequaln to itself in,
%       read twice (an anonymous function handle is equal to no other), is held to its class and
%       fullsig alone, and said to be (`notSelfEqual`, `bySignature`);
%   (2) the edited entry reads as the original entry with the same edit made in MATLAB, on a copy
%       of the original opened here, the change then discarded: a property edit is getValue, the
%       property set, setValue, getValue again; a rename is held to the original's value under the
%       old name, and MATLAB's own rename, `entry.Name = new`, is made as well and whether the save
%       reads as it does said beside it (`sameAsMatlabEdit`): it also writes the new name into a
%       Name property of the value (a Simulink.VariantBank's, for one), which core's does not;
%   (3) the save opens, and every entry reads, with no error and no warning (lastwarn, and the
%       text the open and the reads print).
% The original is opened the same way, so that what (1) to (3) ask of a save is asked of the file
% it came from as well: a fixture MATLAB cannot open is said to be one, and where the original
% itself warns (a referenced dictionary or a class that is not there), `asOriginal` says whether
% the save warns as much and reads as it does.
%
% Opens only files in M9_OUT: the saves, and the copies of the repository's fixtures that
% m9_merged_saves.mjs writes beside them. Nothing is saved: every dictionary is closed with
% discardChanges and Simulink.data.dictionary.closeAll('-discard').
%
%   node test/parity/matlab/m9_merged_saves.mjs /tmp/m9saves
%   env M9_OUT=/tmp/m9saves mw -using Bmain matlab -nodesktop \
%        -batch "run('$PWD/test/parity/matlab/probe_m9_merged_reopen.m')"
%   cp /tmp/m9saves/m9_merged_saves.truth.json test/parity/matlab/
%
% Prints M9_MERGED_REOPEN OK on its last line. Output: m9_merged_saves.truth.json, {version,
% release, date, originals, cases}: `originals` one row per original's copy, with what MATLAB read
% of it ({file, opened, warnings, entries, notSelfEqual}); `cases` each row of cases.json, as it
% was, with `matlab`: {opened, warnings, asExpected, asOriginal, edited: {class, same,
% sameAsMatlabEdit, absentOld, bySignature, why, whyMatlab}, unedited: {checked, same, bySignature,
% differ}, error}, or {asked: false} for an edit core refused. Messages name files without the
% directory. test/parity/m9MergedSaves.truth.test.ts reads it.

outdir = getenv('M9_OUT');
if isempty(outdir), error('set M9_OUT to the directory m9_merged_saves.mjs wrote'); end
here = fileparts(mfilename('fullpath'));
fixtures = fullfile(here, '..', '..', 'fixtures');
addpath(fullfile(fixtures, 'mcos'));      % GearMode, Widget, WidgetPart, MyGadget, +dexdata
addpath(fullfile(fixtures, 'sparse'));    % +dexsparse
addpath(fullfile(fixtures, 'display'));   % DispLevel, DispWidget
addpath(fullfile(fixtures, 'subclasses')); % +dexsub
fid = fopen(fullfile(outdir, 'dProbeColors.m'), 'w');
fprintf(fid, 'classdef dProbeColors < Simulink.IntEnumType\n  enumeration\n    Red(0)\n    Green(1)\n    Blue(2)\n  end\nend\n');
fclose(fid);
addpath(outdir);
rehash;
warning('off', 'backtrace');
try
  Simulink.defineIntEnumType('DispColor', {'Red', 'Green', 'Blue'}, [1 2 3]);   % as probe_display.m
catch
end
Simulink.data.dictionary.closeAll('-discard');
fprintf('VERSION %s\n', version);

cases = jsondecode(fileread(fullfile(outdir, 'cases.json')));
if isstruct(cases), cases = num2cell(cases); end
originals = {};
read = containers.Map();   % original -> what MATLAB read of it
for i = 1:numel(cases)
  c = cases{i};
  if ~isempty(c.refused)
    c.matlab = struct('asked', false);
    cases{i} = c;
    continue
  end
  if ~read.isKey(c.original)
    % Read twice: an entry the original is not isequaln to itself in (an anonymous function
    % handle is equal to no other) is compared on its class and fullsig alone, and said to be.
    r = readAll(fullfile(outdir, c.original));
    again = readAll(fullfile(outdir, c.original));
    r.notSelfEqual = {};
    for k = 1:numel(r.keys)
      a = r.vals(r.keys{k});
      if again.vals.isKey(r.keys{k}) && isempty(a.error) && ~isequaln(a.value, again.vals(r.keys{k}).value)
        r.notSelfEqual{end+1} = r.keys{k};
      end
    end
    read(c.original) = r;
    originals{end+1} = struct('file', c.original, 'opened', r.opened, 'warnings', {r.warnings}, 'entries', numel(r.keys), 'notSelfEqual', {r.notSelfEqual}); %#ok<SAGROW>
    fprintf('ORIGINAL %-44s opened=%d entries=%d warnings=%d notSelfEqual=%s %s\n', c.original, r.opened, numel(r.keys), numel(r.warnings), strjoin(r.notSelfEqual, ','), r.error);
  end
  base = read(c.original);
  t0 = tic;
  m = struct('opened', false, 'warnings', {{}}, 'asExpected', false, 'asOriginal', false, 'edited', struct(), 'unedited', struct(), 'error', '');
  try
    if ~base.opened
      % Nothing to hold the save to; whether MATLAB opens it is said all the same.
      got = readAll(fullfile(outdir, c.file));
      m.opened = got.opened;
      m.warnings = got.warnings;
      error('m9:original', 'MATLAB cannot open the original: %s', base.error);
    end
    oldKey = [sectionKey(c.section) '|' c.entry];
    newKey = oldKey;
    if strcmp(c.edit, 'rename'), newKey = [sectionKey(c.section) '|' c.value]; end
    % The same edit in MATLAB. A rename is held to the original's value under the old name, and
    % MATLAB's own rename, which can change the value too (an object's Name), is said beside it.
    try
      mine = expected(fullfile(outdir, c.original), c);
    catch err
      % MATLAB cannot make the edit itself (it cannot read the value): a rename is still held
      % to the original's value under the old name.
      mine = struct('class', '', 'value', {[]}, 'sig', '', 'error', err.identifier);
    end
    want = mine;
    if strcmp(c.edit, 'rename'), want = base.vals(oldKey); end
    loose = ismember(oldKey, base.notSelfEqual);
    got = readAll(fullfile(outdir, c.file));
    m.opened = got.opened;
    m.warnings = got.warnings;
    if ~got.opened
      error('m9:save', '%s', got.error);
    end
    % (2) the edited entry
    e = struct('class', '', 'same', false, 'sameAsMatlabEdit', false, 'absentOld', true, 'bySignature', false, 'why', '', 'whyMatlab', '');
    if got.vals.isKey(newKey)
      g = got.vals(newKey);
      e.class = g.class;
      [e.same, e.why] = sameValue(g, want, loose);
      [e.sameAsMatlabEdit, e.whyMatlab] = sameValue(g, mine, loose);
      e.bySignature = loose;
    else
      e.why = 'not in the save';
    end
    if strcmp(c.edit, 'rename'), e.absentOld = ~got.vals.isKey(oldKey); end
    m.edited = e;
    % (1) every other entry
    others = setdiff(base.keys, {oldKey}, 'stable');
    differ = {};
    nsame = 0;
    for k = 1:numel(others)
      if ~got.vals.isKey(others{k})
        differ{end+1} = [others{k} ': not in the save']; %#ok<SAGROW>
        continue
      end
      [same, why] = sameValue(got.vals(others{k}), base.vals(others{k}), ismember(others{k}, base.notSelfEqual));
      nsame = nsame + same;
      if ~same, differ{end+1} = [others{k} ': ' why]; end %#ok<SAGROW>
    end
    extra = setdiff(got.keys, [others, {newKey}]);
    for k = 1:numel(extra), differ{end+1} = [extra{k} ': only in the save']; end %#ok<SAGROW>
    m.unedited = struct('checked', numel(others), 'same', nsame, 'bySignature', sum(ismember(others, base.notSelfEqual)), 'differ', {differ});
    % (3) and the save warns of nothing; or, where the original itself does not read cleanly, of
    % no more than it does
    readsAsShould = e.same && e.absentOld && isempty(differ);
    m.asExpected = got.opened && isempty(got.warnings) && readsAsShould;
    m.asOriginal = got.opened && numel(got.warnings) == numel(base.warnings) && readsAsShould;
  catch err
    m.error = strrep(err.message, newline, ' ');
  end
  Simulink.data.dictionary.closeAll('-discard');
  c.matlab = m;
  cases{i} = c;
  fprintf('%-4s %-40s %-24s %-12s %5.1fs %s\n', tern(m.asExpected, 'OK', tern(m.asOriginal, 'ASOR', 'NOT')), c.file, c.entry, c.edit, toc(t0), summary(m));
end
nok = sum(cellfun(@(c) isfield(c.matlab, 'asExpected') && c.matlab.asExpected, cases));
nor = sum(cellfun(@(c) isfield(c.matlab, 'asOriginal') && c.matlab.asOriginal, cases));
nasked = sum(cellfun(@(c) ~isfield(c.matlab, 'asked'), cases));
fprintf('M9 AS EXPECTED %d, AS THE ORIGINAL %d, OF %d\n', nok, nor, nasked);
% The output directory, as MATLAB spells it in a message (on macOS /tmp is /private/tmp), is no
% part of what it read.
for i = 1:numel(cases)
  if isfield(cases{i}.matlab, 'error')
    cases{i}.matlab.error = unrooted(cases{i}.matlab.error, outdir);
    cases{i}.matlab.warnings = unrooted(cases{i}.matlab.warnings, outdir);
  end
end
for i = 1:numel(originals)
  originals{i}.warnings = unrooted(originals{i}.warnings, outdir);
end
truth = struct('version', version, 'release', version('-release'), 'date', char(datetime('now', 'Format', 'yyyy-MM-dd')), ...
  'originals', {originals}, 'cases', {cases});
fid = fopen(fullfile(outdir, 'm9_merged_saves.truth.json'), 'w', 'n', 'UTF-8');
fprintf(fid, '%s\n', jsonencode(truth, 'PrettyPrint', true));
fclose(fid);
fprintf('M9_MERGED_REOPEN OK\n');

function x = unrooted(x, outdir)
  for root = {['/private' outdir], outdir}
    x = strrep(x, [root{1} filesep], '');
  end
end

% ---- every entry of a dictionary, read once, with what the open and the reads warned -----------
function r = readAll(path)
  Simulink.data.dictionary.closeAll('-discard');
  r = struct('opened', false, 'warnings', {{}}, 'error', '', 'keys', {{}}, 'vals', containers.Map());
  lastwarn('');
  dd = [];
  try
    printed = evalc('dd = Simulink.data.dictionary.open(path);');
    r.warnings = noted(r.warnings, printed);
    r.opened = true;
    for s = {'design', 'other', 'config'}
      sec = getSection(dd, sectionName(s{1}));
      entries = find(sec); %#ok<GTARG>
      for k = 1:numel(entries)
        key = [s{1} '|' entries(k).Name];
        v = struct('class', '', 'value', {[]}, 'sig', '', 'error', '');
        try
          x = [];
          printed = evalc('x = getValue(entries(k));');
          r.warnings = noted(r.warnings, printed);
          v.class = class(x);
          v.value = x;
          v.sig = safesig(x);
        catch err
          v.error = err.identifier;
          r.warnings{end+1} = sprintf('%s: %s', key, strrep(err.message, newline, ' '));
        end
        r.keys{end+1} = key;
        r.vals(key) = v;
      end
    end
  catch err
    r.error = strrep(err.message, newline, ' ');
  end
  [msg, id] = lastwarn;
  if ~isempty(msg), r.warnings{end+1} = sprintf('lastwarn %s: %s', id, strrep(msg, newline, ' ')); end
  if ~isempty(dd)
    try, discardChanges(dd); close(dd); catch, end
  end
  Simulink.data.dictionary.closeAll('-discard');
end

% The edited entry as MATLAB makes the same edit to a copy of the original; the change discarded.
function v = expected(path, c)
  Simulink.data.dictionary.closeAll('-discard');
  dd = Simulink.data.dictionary.open(path);
  cleanup = onCleanup(@() discard(dd));
  sec = getSection(dd, sectionName(c.section));
  e = getEntry(sec, c.entry);
  switch c.edit
    case 'rename'
      e.Name = c.value;
      x = getValue(getEntry(sec, c.value));
    case 'description'
      x = getValue(e);
      x.Description = c.value;
      setValue(e, x);
      x = getValue(e);
    case 'element'
      x = getValue(e);
      x.Elements(c.path.index).Description = c.value;
      setValue(e, x);
      x = getValue(e);
    case 'field'
      x = getValue(e);
      x.(c.path.field) = str2double(c.value);
      setValue(e, x);
      x = getValue(e);
    otherwise
      error('m9:edit', 'no edit %s', c.edit);
  end
  v = struct('class', class(x), 'value', {x}, 'sig', safesig(x), 'error', '');
end

function discard(dd)
  try, discardChanges(dd); close(dd); catch, end
  Simulink.data.dictionary.closeAll('-discard');
end

% The same class, isequal (NaN equal to itself), and the same leaf-by-leaf signature; or the
% same error. `bySignature`, for a value the original is not isequaln to itself in: the class and
% the signature alone.
function [same, why] = sameValue(got, want, bySignature)
  if nargin < 3, bySignature = false; end
  why = '';
  if ~isempty(got.error) || ~isempty(want.error)
    same = strcmp(got.error, want.error);
    if ~same, why = sprintf('error %s, not %s', got.error, want.error); end
    return
  end
  if ~strcmp(got.class, want.class)
    same = false;
    why = sprintf('class %s, not %s', got.class, want.class);
    return
  end
  eq = bySignature || isequaln(got.value, want.value);
  sg = strcmp(got.sig, want.sig);
  same = eq && sg;
  if ~same
    why = sprintf('isequaln %d, fullsig %d: %s | wanted %s', eq, sg, trunc(got.sig), trunc(want.sig));
  end
end

function w = noted(w, printed)
  printed = strtrim(printed);
  if ~isempty(printed), w{end+1} = strrep(printed, newline, ' '); end
end

% The section a case names, as readAll keys it: an architectural entry is one of Design Data's.
function s = sectionKey(key)
  s = key;
  if strcmp(key, 'arch'), s = 'design'; end
end

function s = sectionName(key)
  switch key
    case {'design', 'arch'}, s = 'Design Data';
    case 'other', s = 'Other Data';
    case 'config', s = 'Configurations';
    otherwise, error('m9:section', 'no section %s', key);
  end
end

function s = summary(m)
  if ~isempty(m.error), s = ['ERROR ' m.error]; return, end
  s = sprintf('edited same=%d asMatlabEdit=%d unedited %d/%d warnings=%d', m.edited.same, m.edited.sameAsMatlabEdit, m.unedited.same, m.unedited.checked, numel(m.warnings));
  if ~m.edited.same, s = [s ' | edited: ' m.edited.why]; end
  if ~m.edited.sameAsMatlabEdit, s = [s ' | as MATLAB edits it: ' m.edited.whyMatlab]; end
  if ~isempty(m.unedited.differ), s = [s ' | ' strjoin(m.unedited.differ, '; ')]; end
  if ~isempty(m.warnings), s = [s ' | ' strjoin(m.warnings, '; ')]; end
end

function s = tern(b, y, n)
  if b, s = y; else, s = n; end
end

function s = trunc(s)
  if numel(s) > 400, s = [s(1:400) ' ...(' num2str(numel(s)) ' chars)']; end
end

% fullsig, or what it threw: a signature the probe cannot make is not a warning of the file's.
function s = safesig(x)
  try
    s = fullsig(x);
  catch err
    s = ['<fullsig ' err.identifier '>'];
  end
end

% strjoin, tolerant of no parts: arrayfun over nothing gives a 0x0 double, which strjoin refuses.
function s = joinparts(c)
  if isempty(c) || ~iscell(c), s = ''; else, s = strjoin(c, ','); end
end

% wbcompare.m's fullsig and valstr, copied: class, size, complexity and exact value at every leaf,
% inside a struct's fields, a cell's elements and an object's properties.
function s = fullsig(v, depth)
  if nargin < 2, depth = 0; end
  s = [class(v) mat2str(size(v))];
  if depth > 12
    s = [s '/DEPTHCAP'];
    return
  end
  parts = {};
  if isstruct(v)
    fn = fieldnames(v);
    for i = 1:numel(v)
      for f = 1:numel(fn)
        parts{end+1} = [fn{f} ':' fullsig(v(i).(fn{f}), depth + 1)]; %#ok<AGROW>
      end
    end
  elseif iscell(v)
    flat = reshape(v, 1, []);
    for i = 1:numel(flat)
      parts{end+1} = fullsig(flat{i}, depth + 1); %#ok<AGROW>
    end
  elseif ischar(v)
    s = [s '=''' reshape(v, 1, []) ''''];
    return
  elseif isstring(v)
    parts = arrayfun(@(x) {['"' char(x) '"']}, reshape(v, 1, []));
    s = [s '{' joinparts(parts) '}'];
    return
  elseif isnumeric(v) || islogical(v)
    if ~isreal(v), s = [s '/cplx']; end
    if issparse(v), s = [s '/sparse']; end
    s = [s '=' valstr(v)];
    return
  elseif isenum(v)
    parts = arrayfun(@(x) {char(x)}, reshape(v, 1, []));
    s = [s '{' joinparts(parts) '}'];
    return
  elseif isobject(v) || isa(v, 'handle')
    p = properties(v);
    gotone = false;
    for i = 1:numel(v)
      for j = 1:numel(p)
        try
          parts{end+1} = [p{j} ':' fullsig(v(i).(p{j}), depth + 1)]; %#ok<AGROW>
          gotone = true;
        catch ME
          parts{end+1} = [p{j} ':<' ME.identifier '>']; %#ok<AGROW>
        end
      end
    end
    if ~gotone && numel(v) == 1
      try
        txt = formattedDisplayText(v, 'SuppressMarkup', true);
        parts{end+1} = ['disp:' strtrim(regexprep(char(txt), '\s+', ' '))];
      catch
        parts{end+1} = 'disp:<opaque>';
      end
    end
  else
    return
  end
  s = [s '{' joinparts(parts) '}'];
end

function s = valstr(v)
  if isempty(v)
    s = '[]';
    return
  end
  if issparse(v)
    % Its non-zeros, where they are: pTall is 10000000x2, which spelled in full is 2e7 numbers.
    [ii, jj, xx] = find(v);
    s = ['nz:' joinparts(arrayfun(@(a, b) {sprintf('%d,%d', a, b)}, ii', jj')) '=' valstr(full(reshape(xx, 1, [])))];
    return
  end
  flat = reshape(v, 1, []);
  if isinteger(v) || islogical(v)
    s = joinparts(arrayfun(@(x) {char(string(x))}, flat));
  elseif isreal(flat)
    s = joinparts(arrayfun(@(x) {sprintf('%.17g', x)}, flat));
  else
    s = joinparts(arrayfun(@(x) {sprintf('%.17g%+.17gi', real(x), imag(x))}, flat));
  end
end
