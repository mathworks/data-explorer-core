% What does MATLAB read of a binary dictionary core saved before two of its fixes, and of what
% core copies now from a binary dictionary into a text one? (M4 and M7 of the 2026-10-13
% save-fidelity plan, the last of its MATLAB read-backs, and D15's binary-to-text reopen.)
%
% For each row of cases.json, which old_saves.mjs writes:
%
%   an old save, an untouched save of a binary fixture by core built before #93 ('pre93'),
%   before #93's last commit ('pre69664b0') or before 90caf06 ('pre90caf06'), each of which
%   wrote every entry from its model:
%     (1) every entry reads as it does in the original: the same class, isequaln, and the same
%         `sig` (wbcompare.m's fullsig, which here also names the fields of a struct, so that a
%         struct of no element keeps them in its signature); an entry the original is not
%         isequaln to itself in, read twice, is held to its class and sig alone (`notSelfEqual`:
%         a config set, a handle, is equal to no other);
%     (2) each dynamic property the original holds (M4), as get_param reads it of the config
%         set in the original and in the save, and whether the save's target component holds it
%         as a dynamic property (findprop gives a matlab.metadata.DynamicProperty);
%     (3) each struct of no element the original holds at an entry (M7), as MATLAB reads it in
%         the save: its class, size and field names;
%     (4) and whether the save opens and reads with no error or warning;
%   a paste, core's copy of entries of a binary dictionary (old_saves_r2027a_binary.sldd, or its
%   pre90caf06 save) into old_saves_r2027a_text.sldd, MATLAB's text twin of it, under new names:
%     (1) and (4) for every entry of the text twin; (2) for each pasted config set; and
%     (5) each pasted entry as the entry it was copied from reads (class, isequaln, sig; a
%         config set's Name aside, which is its entry's name), its shape, and its object array's
%         class and the class of each element in order, beside the source's.
%
% Opens only files in OLD_SAVES_OUT: the saves and the pastes, and the copies of the originals
% old_saves.mjs writes beside them. Nothing is saved: every dictionary is closed with
% discardChanges and Simulink.data.dictionary.closeAll('-discard').
%
%   node test/parity/matlab/old_saves.mjs cases /tmp/oldsaves
%   env OLD_SAVES_OUT=/tmp/oldsaves mw -using Bmain matlab -nodesktop \
%        -batch "run('$PWD/test/parity/matlab/probe_old_saves_readback.m')"
%   cp /tmp/oldsaves/old_saves_readback.truth.json test/parity/matlab/
%
% Prints OLD_SAVES_READBACK OK on its last line. Output: old_saves_readback.truth.json, {version,
% release, date, originals, cases}: `originals` one row per original or source ({file, opened,
% warnings, entries, notSelfEqual, shapes}), `shapes` each entry's class, size and, for a
% struct, field names; `cases` each row of cases.json, with `matlab`: {opened, warnings,
% asOriginal, entries: {checked, same, differ}, dynamic: [{entry, name, original, save,
% dynamicInSave}], emptyStructs: [{entry, shape}], pasted: [{to, same, why, shape, kids,
% sourceKids}], error}. Messages name files without the directory.
% test/parity/oldSaves.truth.test.ts reads it.

outdir = getenv('OLD_SAVES_OUT');
if isempty(outdir), error('set OLD_SAVES_OUT to the directory old_saves.mjs wrote'); end
here = fileparts(mfilename('fullpath'));
fixtures = fullfile(here, '..', '..', 'fixtures');
addpath(fullfile(fixtures, 'mcos'));      % GearMode, Widget, WidgetPart, NdHolder, +dexdata
addpath(fullfile(fixtures, 'display'));   % DispLevel, DispWidget
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
read = containers.Map();
for i = 1:numel(cases)
  c = cases{i};
  t0 = tic;
  if ~read.isKey(c.original)
    r = readAll(fullfile(outdir, c.original));
    again = readAll(fullfile(outdir, c.original));
    r.notSelfEqual = {};
    for k = 1:numel(r.keys)
      a = r.vals(r.keys{k});
      if again.vals.isKey(r.keys{k}) && isempty(a.error)
        b = again.vals(r.keys{k});
        if ~isequaln(a.value, b.value) || ~strcmp(a.sig, b.sig)
          r.notSelfEqual{end+1} = r.keys{k};
        end
      end
    end
    read(c.original) = r;
    originals{end+1} = struct('file', c.original, 'opened', r.opened, 'warnings', {r.warnings}, 'entries', numel(r.keys), ...
      'notSelfEqual', {r.notSelfEqual}, 'shapes', {shapesOf(r)}); %#ok<SAGROW>
    fprintf('ORIGINAL %-40s opened=%d entries=%d warnings=%d notSelfEqual=%s %s\n', c.original, r.opened, numel(r.keys), numel(r.warnings), strjoin(r.notSelfEqual, ','), r.error);
  end
  base = read(c.original);
  m = struct('opened', false, 'warnings', {{}}, 'asOriginal', false, 'entries', struct(), 'dynamic', {{}}, 'emptyStructs', {{}}, 'pasted', {{}}, 'error', '');
  try
    got = readAll(fullfile(outdir, c.file));
    m.opened = got.opened;
    m.warnings = got.warnings;
    if ~got.opened, error('oldsaves:open', '%s', got.error); end
    % (1) every entry of the original
    differ = {};
    nsame = 0;
    for k = 1:numel(base.keys)
      key = base.keys{k};
      if ~got.vals.isKey(key)
        differ{end+1} = [key ': not in the save']; %#ok<SAGROW>
        continue
      end
      [same, why] = sameValue(got.vals(key), base.vals(key), ismember(key, base.notSelfEqual));
      nsame = nsame + same;
      if ~same, differ{end+1} = [key ': ' why]; end %#ok<SAGROW>
    end
    pastedKeys = {};
    from = base;
    if strcmp(c.kind, 'paste')
      p = c.pasted;
      if isstruct(p), p = num2cell(p); end
      pastedKeys = reshape(cellfun(@(x) [x.section '|' x.to], p, 'UniformOutput', false), 1, []);
      % (5) the pasted entry, as the entry it was copied from reads
      if ~read.isKey(c.source), read(c.source) = readAll(fullfile(outdir, c.source)); end
      from = read(c.source);
      for k = 1:numel(p)
        to = [p{k}.section '|' p{k}.to];
        key = [p{k}.section '|' p{k}.from];
        row = struct('to', p{k}.to, 'same', false, 'why', '', 'shape', '', 'kids', '', 'sourceKids', '');
        if ~got.vals.isKey(to)
          row.why = 'not in the save';
        elseif ~from.vals.isKey(key)
          row.why = 'not in the source';
        else
          g = got.vals(to);
          % A config set's Name is its entry's: the paste's is the new one.
          if isa(g.value, 'Simulink.ConfigSet')
            g.value.Name = from.vals(key).value.Name;
            g.sig = safesig(g.value);
          end
          [row.same, row.why] = sameValue(g, from.vals(key), true);
          row.shape = g.shape;
          row.kids = arrayOf(g.value);
          row.sourceKids = arrayOf(from.vals(key).value);
        end
        m.pasted{end+1} = row;
      end
    end
    extra = setdiff(got.keys, [base.keys, pastedKeys]);
    for k = 1:numel(extra), differ{end+1} = [extra{k} ': only in the save']; end %#ok<SAGROW>
    m.entries = struct('checked', numel(base.keys), 'same', nsame, 'differ', {differ});
    % (2) each dynamic property, as get_param reads it in the original (or the pasted entry's
    % source) and in the save
    d = c.dynamic;
    if isstruct(d), d = num2cell(d); end
    for k = 1:numel(d)
      key = ['config|' d{k}.entry];
      to = ['config|' d{k}.to];
      m.dynamic{end+1} = struct('entry', d{k}.to, 'name', d{k}.name, 'original', paramOf(from, key, d{k}.name), 'save', paramOf(got, to, d{k}.name), ...
        'dynamicInSave', isDynamic(got, to, d{k}.name));
    end
    if strcmp(c.kind, 'old save')
      % (3) each struct of no element, as MATLAB reads it in the save
      e = c.emptyStructs;
      if isstruct(e), e = num2cell(e); end
      for k = 1:numel(e)
        key = ['design|' e{k}.entry];
        shape = '';
        if got.vals.isKey(key), shape = got.vals(key).shape; end
        m.emptyStructs{end+1} = struct('entry', e{k}.entry, 'shape', shape);
      end
    end
    m.asOriginal = got.opened && numel(got.warnings) == numel(base.warnings) && isempty(differ) && ...
      all(cellfun(@(x) x.same, m.pasted));
  catch err
    m.error = strrep(err.message, newline, ' ');
  end
  Simulink.data.dictionary.closeAll('-discard');
  c.matlab = m;
  cases{i} = c;
  fprintf('%-4s %-40s %5.1fs %s\n', tern(m.asOriginal, 'OK', 'NOT'), c.file, toc(t0), summary(m));
end
for i = 1:numel(cases)
  cases{i}.matlab.error = unrooted(cases{i}.matlab.error, outdir);
  cases{i}.matlab.warnings = unrooted(cases{i}.matlab.warnings, outdir);
end
for i = 1:numel(originals)
  originals{i}.warnings = unrooted(originals{i}.warnings, outdir);
end
truth = struct('version', version, 'release', version('-release'), 'date', char(datetime('now', 'Format', 'yyyy-MM-dd')), ...
  'originals', {originals}, 'cases', {cases});
fid = fopen(fullfile(outdir, 'old_saves_readback.truth.json'), 'w', 'n', 'UTF-8');
fprintf(fid, '%s\n', jsonencode(truth, 'PrettyPrint', true));
fclose(fid);
fprintf('OLD_SAVES_READBACK OK\n');

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
        v = struct('class', '', 'value', {[]}, 'sig', '', 'shape', '', 'error', '');
        try
          x = [];
          printed = evalc('x = getValue(entries(k));');
          r.warnings = noted(r.warnings, printed);
          v.class = class(x);
          v.value = x;
          v.sig = safesig(x);
          v.shape = shapeOf(x);
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

% Each entry's shape, as {key, shape}, of a dictionary readAll read.
function out = shapesOf(r)
  out = {};
  for k = 1:numel(r.keys)
    out{end+1} = struct('key', r.keys{k}, 'shape', r.vals(r.keys{k}).shape); %#ok<AGROW>
  end
end

% A value's class and size, and for a struct its field names: `struct[0 2]{a,b}`.
function s = shapeOf(x)
  s = [class(x) mat2str(size(x))];
  if isstruct(x), s = [s '{' joinparts(fieldnames(x)') '}']; end
end

% The object array a pasted value holds, as its class, size and each element's class: an
% NdHolder's Kids, a config set's Components.
function s = arrayOf(x)
  s = '';
  try
    if isa(x, 'Simulink.ConfigSet')
      a = x.Components;
    elseif isprop(x, 'Kids')
      a = x.Kids;
    else
      return
    end
    s = [class(a) mat2str(size(a)) '{' joinparts(arrayfun(@(k) {class(a(k))}, 1:numel(a))) '}'];
  catch err
    s = ['<' err.identifier '>'];
  end
end

% A config set's parameter, as get_param reads it, as text; or what get_param threw.
function s = paramOf(r, key, name)
  s = '<no entry>';
  if ~r.vals.isKey(key), return, end
  v = r.vals(key);
  try
    x = get_param(v.value, name);
    if ischar(x), s = x; else, s = mat2str(x); end
  catch err
    s = ['<' err.identifier '>'];
  end
end

% Whether a config set's target component holds the property as a dynamic one, as MATLAB adds
% the options of a target file.
function b = isDynamic(r, key, name)
  b = false;
  if ~r.vals.isKey(key), return, end
  try
    t = r.vals(key).value.getComponent('Code Generation').getComponent('Target');
    b = isa(findprop(t, name), 'matlab.metadata.DynamicProperty');
  catch
  end
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
    why = sprintf('isequaln %d, sig %d: %s | wanted %s', eq, sg, trunc(firstDiff(got.sig, want.sig)), trunc(firstDiff(want.sig, got.sig)));
  end
end

% A signature from the first character where it differs from another, with a little before it.
function s = firstDiff(a, b)
  n = min(numel(a), numel(b));
  k = find(a(1:n) ~= b(1:n), 1);
  if isempty(k), k = n + 1; end
  s = a(max(1, k - 80):end);
end

function w = noted(w, printed)
  printed = strtrim(printed);
  if ~isempty(printed), w{end+1} = strrep(printed, newline, ' '); end
end

function s = sectionName(key)
  switch key
    case 'design', s = 'Design Data';
    case 'other', s = 'Other Data';
    case 'config', s = 'Configurations';
    otherwise, error('oldsaves:section', 'no section %s', key);
  end
end

function s = summary(m)
  if ~isempty(m.error), s = ['ERROR ' m.error]; return, end
  s = sprintf('entries %d/%d warnings=%d', m.entries.same, m.entries.checked, numel(m.warnings));
  if ~isempty(m.entries.differ), s = [s ' | ' strjoin(m.entries.differ, '; ')]; end
  for k = 1:numel(m.dynamic)
    d = m.dynamic{k};
    if ~strcmp(d.original, d.save), s = sprintf('%s | %s.%s %s -> %s', s, d.entry, d.name, d.original, d.save); end
  end
  for k = 1:numel(m.emptyStructs), s = sprintf('%s | %s %s', s, m.emptyStructs{k}.entry, m.emptyStructs{k}.shape); end
  for k = 1:numel(m.pasted), s = sprintf('%s | pasted %s same=%d %s %s', s, m.pasted{k}.to, m.pasted{k}.same, m.pasted{k}.kids, m.pasted{k}.why); end
  if ~isempty(m.warnings), s = [s ' | ' strjoin(m.warnings, '; ')]; end
end

function s = tern(b, y, n)
  if b, s = y; else, s = n; end
end

function s = trunc(s)
  if numel(s) > 400, s = [s(1:400) ' ...(' num2str(numel(s)) ' chars)']; end
end

function s = safesig(x)
  try
    s = fullsig(x);
  catch err
    s = ['<fullsig ' err.identifier '>'];
  end
end

function s = joinparts(c)
  if isempty(c) || ~iscell(c), s = ''; else, s = strjoin(c, ','); end
end

% wbcompare.m's fullsig and valstr, copied, with one change: a struct's signature names its
% fields first, so that a struct of no element that lost them differs from one that has them.
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
    s = [s '<' joinparts(fn') '>'];
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
