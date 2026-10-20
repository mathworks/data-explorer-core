% Copyright 2026 The MathWorks, Inc.
%
% The MATLAB half of the MAT-file save gate: load every file probe_mat_writeback.mjs saved
% through the session, and compare it, to the leaf, with the original loaded and edited by
% MATLAB itself.
%
% Run the JS half first, with the SAME absolute PROBE_OUT (and `npm run build` before it:
% the JS half reads dist/, so a stale build is a stale verdict):
%   env PROBE_OUT=/tmp/matwb node test/parity/matlab/probe_mat_writeback.mjs
%   env PROBE_OUT=/tmp/matwb mw -using Bmain matlab -nodesktop \
%       -batch "run('$PWD/test/parity/matlab/probe_mat_writeback.m')"
% PROBE_OUT may instead be set as a variable before the run: "PROBE_OUT='/tmp/matwb'; run(...)".
%
% For each case of the manifest:
%   1. S0 = load(original), which must load with no warning and print nothing: a class the
%      fixtures need and this MATLAB lacks would otherwise read as our failure;
%   2. S  = load(original) with the case's MATLAB statements applied, which must differ from
%      S0 for a case that edits and equal it for one that does not;
%   3. T  = load(saved), which must load with no warning and print nothing;
%   4. T must be S: the same variables in the same order (load's, and whos -file's class,
%      size and global flag of each), and each variable the same to the leaf (dcmp below: class,
%      size, sparsity, complexity, isequaln on every value and the bits of every double and
%      single but a NaN's payload, field names in order, every element of
%      a cell or struct array, every readable property of an object, a function handle's text
%      and an anonymous one's workspace), and its handles shared as S's are (the same object
%      held twice is still one object);
%   5. a save with no edit is the original, byte for byte;
%   6. T saved again by MATLAB loads as T, with no warning.
% A case whose `expect` is 'control' is a NEGATIVE control: its statements make one change
% more than the save does, and it passes only when step 4 reports it (`differs`).
%
% Prints `RESULT <id> PASS` or `RESULT <id> FAIL <why>` per case, and last
% `PROBE_MAT_WRITEBACK DONE pass=N fail=M`. fail=0 is the only acceptable result: a FAIL here
% means MATLAB loads something other than what the session showed, or loads it with a warning.
if exist('PROBE_OUT', 'var') && ~isempty(PROBE_OUT) %#ok<NODEF>
    outdir = PROBE_OUT;
else
    outdir = getenv('PROBE_OUT');
end
if isempty(outdir) || outdir(1) ~= '/'
    error('PROBE_OUT is not set to an ABSOLUTE path. It must be the one the .mjs half wrote to.');
end
here = fileparts(mfilename('fullpath'));
fixtures = fullfile(here, '..', '..', 'fixtures');
% Everything this script writes (MATLAB's re-saves) goes to outdir, a temp directory, never
% to the folder MATLAB was launched from.
cd(outdir);
warning('off', 'backtrace');

% The classes the fixtures hold that MATLAB does not ship: the display enumerations, the
% dexsparse classes of hexobj_values.mat, and the DagNode of dag4.mat.
addpath(fullfile(fixtures, 'display'));
addpath(fullfile(fixtures, 'sparse'));
addpath(fullfile(fixtures, 'mcos', 'shared'));
try
    % As probe_display.m defines it for dispcat_opaque.mat.
    Simulink.defineIntEnumType('DispColor', {'Red', 'Green', 'Blue'}, [1 2 3]);
catch err
    fprintf('ENV DispColor: %s\n', err.message);
end

fprintf('VERSION %s\n', version);
m = jsondecode(fileread(fullfile(outdir, 'manifest.json')));
if iscell(m)
    m = [m{:}];
end
npass = 0;
nfail = 0;
for k = 1:numel(m)
    e = m(k);
    fprintf('CASE %s: %s\n', e.id, e.why);
    try
        why = runCase(e, outdir);
    catch err
        why = {sprintf('the probe itself threw: %s (%s)', err.message, err.identifier)};
    end
    if isempty(why)
        fprintf('RESULT %s PASS\n', e.id);
        npass = npass + 1;
    else
        if numel(why) > 12
            why = [why(1:12), {sprintf('... and %d more', numel(why) - 12)}];
        end
        fprintf('RESULT %s FAIL %s\n', e.id, strjoin(why, ' | '));
        nfail = nfail + 1;
    end
end
fprintf('PROBE_MAT_WRITEBACK DONE pass=%d fail=%d\n', npass, nfail);

% ---- one case ------------------------------------------------------------------------
function why = runCase(e, outdir)
why = {};
if ~isempty(e.js)
    why{end + 1} = ['the JS half: ' e.js];
end
if ~isempty(e.refused)
    why{end + 1} = ['core refused the save: ' e.refused];
end
if isempty(e.saved)
    return
end

[S0, w0, err0] = loadQuietly(e.original);
if ~isempty(err0)
    why{end + 1} = ['the ORIGINAL does not load here, so nothing can be judged: ' err0];
    return
end
if ~isempty(w0)
    % A warning the original gives itself is the fixture's, not the save's: dispcat_opaque.mat
    % holds an anonymous handle made in a file that no longer exists, and every load of it
    % says so. A save of it may give that warning again, word for word, and nothing else.
    fprintf('  INFO the original warns: %s\n', w0);
end

S = load(e.original);
stmts = e.statements;
if ischar(stmts)
    stmts = {stmts};
elseif isempty(stmts)
    stmts = {};
end
for i = 1:numel(stmts)
    eval(stmts{i});
end
edited = cmpVars(S0, S);
edits = any(strcmp(e.expect, {'changed', 'control'}));
if edits && isempty(edited)
    why{end + 1} = 'the MATLAB statements change nothing, so a PASS would be vacuous';
elseif ~edits && ~isempty(edited)
    why{end + 1} = ['the MATLAB statements change what this case says is unchanged: ' strjoin(edited, '; ')];
end

[T, wT, errT] = loadQuietly(e.saved);
if ~isempty(errT)
    why{end + 1} = ['load fails: ' errT];
    return
end
if ~isempty(wT) && ~strcmp(wT, w0)
    why{end + 1} = ['load warns: ' wT];
end

diffs = cmpVars(S, T);
if strcmp(e.expect, 'control')
    % A negative control: S holds one change the save does not, and the comparison must say
    % so, in so many words.
    if ~contains(strjoin(diffs, ' | '), e.differs)
        why{end + 1} = sprintf('the control''s planted difference "%s" was not reported; got: %s', e.differs, strjoin(diffs, ' | '));
    else
        fprintf('  CONTROL saw %s\n', strjoin(diffs, ' | '));
    end
else
    why = [why, diffs];
end

% whos -file, which reads the file's own record of each variable without loading it.
w = whos('-file', e.saved);
wn = {w.name};
tn = fieldnames(T);
if ~isequal(sort(wn(:)), sort(tn(:)))
    why{end + 1} = sprintf('whos -file lists [%s], load gives [%s]', strjoin(wn, ','), strjoin(tn', ','));
else
    for i = 1:numel(w)
        v = T.(w(i).name);
        if ~strcmp(w(i).class, class(v)) || ~isequal(w(i).size, size(v))
            why{end + 1} = sprintf('whos -file says %s is %s %s, load gives %s %s', w(i).name, ...
                w(i).class, mat2str(w(i).size), class(v), mat2str(size(v))); %#ok<AGROW>
        end
    end
end
% And global where the original's variable of that name was global: `save` marks a variable
% declared global, which is the variable's and not its value's, so load's struct does not show it.
wo = whos('-file', e.original);
for i = 1:numel(w)
    o = wo(strcmp({wo.name}, w(i).name));
    if (isempty(o) && w(i).global) || (~isempty(o) && o(1).global ~= w(i).global)
        why{end + 1} = sprintf('whos -file says %s is global %d, where the original''s is %d', w(i).name, w(i).global, ~isempty(o) && o(1).global); %#ok<AGROW>
    end
end

if strcmp(e.expect, 'identical') && ~isequal(bytesOf(e.original), bytesOf(e.saved))
    why{end + 1} = 'a save with no edit is not the original, byte for byte';
end

% MATLAB's own save of what it loaded, loaded again.
if ~isempty(fieldnames(T))
    resaved = fullfile(outdir, ['resave_' e.id '.mat']);
    lastwarn('');
    txt = evalc('save(resaved, ''-struct'', ''T'');');
    [ws, wsid] = lastwarn;
    if ~isempty(ws) || ~isempty(strtrim(txt))
        why{end + 1} = sprintf('MATLAB''s re-save warns: %s (%s) %s', ws, wsid, strtrim(txt));
    end
    [T2, w2, err2] = loadQuietly(resaved);
    if ~isempty(err2) || (~isempty(w2) && ~strcmp(w2, w0))
        why{end + 1} = ['MATLAB''s re-save does not load cleanly: ' err2 w2];
    else
        again = cmpVars(T, T2);
        if ~isempty(again)
            why{end + 1} = ['MATLAB''s re-save loads differently: ' strjoin(again, '; ')];
        end
    end
end
end

% load, with what it warns or prints, and its error, instead of letting either escape.
function [V, w, err] = loadQuietly(path)
V = struct();
w = '';
err = '';
lastwarn('');
try
    txt = evalc('V = load(path);');
catch ex
    err = sprintf('%s (%s)', ex.message, ex.identifier);
    return
end
[msg, id] = lastwarn;
if ~isempty(msg)
    w = sprintf('%s (%s)', msg, id);
end
txt = strtrim(txt);
if ~isempty(txt)
    w = strtrim([w ' printed: ' txt]);
end
end

function b = bytesOf(path)
fid = fopen(path, 'r');
b = fread(fid, Inf, '*uint8');
fclose(fid);
end

% ---- the comparison --------------------------------------------------------------------
% Two loaded files: the same variables, in the same order, each the same to the leaf, and
% their handles shared alike.
function d = cmpVars(A, B)
d = {};
na = fieldnames(A);
nb = fieldnames(B);
if ~isequal(na, nb)
    d{end + 1} = sprintf('variables [%s] vs [%s]', strjoin(na', ','), strjoin(nb', ','));
end
common = intersect(na, nb, 'stable');
for i = 1:numel(common)
    d = [d, dcmp(A.(common{i}), B.(common{i}), common{i}, 0)]; %#ok<AGROW>
end
[ha, pa] = handlesOf(A);
[hb, pb] = handlesOf(B);
if ~isequal(pa, pb)
    d{end + 1} = sprintf('handle sharing differs: %d handles reached vs %d', numel(pa), numel(pb));
elseif ~isequal(aliasesOf(ha), aliasesOf(hb))
    sa = aliasesOf(ha);
    sb = aliasesOf(hb);
    k = find(sa ~= sb, 1);
    d{end + 1} = sprintf('handle sharing differs at %s: one object with #%d vs #%d', pa{k}, sa(k), sb(k));
end
end

function d = dcmp(a, b, path, depth)
d = {};
if depth > 24
    return
end
if ~strcmp(class(a), class(b))
    d{end + 1} = sprintf('%s: class %s vs %s', path, class(a), class(b));
    return
end
if ~isequal(size(a), size(b))
    d{end + 1} = sprintf('%s: size %s vs %s', path, mat2str(size(a)), mat2str(size(b)));
    return
end
if (isnumeric(a) || islogical(a)) && ~isobject(a)
    if issparse(a) ~= issparse(b)
        d{end + 1} = sprintf('%s: sparse %d vs %d', path, issparse(a), issparse(b));
        return
    end
    if isreal(a) ~= isreal(b)
        d{end + 1} = sprintf('%s: real %d vs %d', path, isreal(a), isreal(b));
        return
    end
end
if isstruct(a)
    fa = fieldnames(a);
    fb = fieldnames(b);
    if ~isequal(fa, fb)
        d{end + 1} = sprintf('%s: fields [%s] vs [%s]', path, strjoin(fa', ','), strjoin(fb', ','));
        return
    end
    for i = 1:numel(a)
        for j = 1:numel(fa)
            d = [d, dcmp(a(i).(fa{j}), b(i).(fa{j}), sprintf('%s(%d).%s', path, i, fa{j}), depth + 1)]; %#ok<AGROW>
        end
    end
elseif iscell(a)
    for i = 1:numel(a)
        d = [d, dcmp(a{i}, b{i}, sprintf('%s{%d}', path, i), depth + 1)]; %#ok<AGROW>
    end
elseif isa(a, 'function_handle')
    if isempty(a)
        return
    end
    if ~strcmp(func2str(a), func2str(b))
        d{end + 1} = sprintf('%s: %s vs %s', path, func2str(a), func2str(b));
        return
    end
    fa = functions(a);
    fb = functions(b);
    if isfield(fa, 'workspace') ~= isfield(fb, 'workspace')
        d{end + 1} = sprintf('%s: a workspace on one side only', path);
    elseif isfield(fa, 'workspace')
        d = [d, dcmp(fa.workspace, fb.workspace, [path '<workspace>'], depth + 1)];
    end
elseif isenum(a)
    if ~isequal(a, b)
        d{end + 1} = sprintf('%s: %s vs %s', path, show(a), show(b));
    end
elseif isstring(a)
    if ~isequaln(a, b)
        d{end + 1} = sprintf('%s: %s vs %s', path, show(a), show(b));
    end
elseif isobject(a) || isa(a, 'handle')
    % By its properties, each to the leaf. Not by isequaln, which is numeric (it finds a
    % property retyped single equal to its double), and false between two loads of one file
    % for a handle (its identity) and for a value object holding an anonymous function handle
    % (hexobj_values.mat's FhAlias), however equal the contents.
    [dd, gotone] = dprops(a, b, path, depth);
    d = [d, dd];
    if ~gotone
        % Nothing readable (a categorical's properties are not public; a
        % Simulink.VariantVariable's throw on get): a value object by isequaln after all, and
        % either by its own display, as wbcompare.m does, so that it is not compared on its
        % class and size alone.
        if ~isa(a, 'handle') && ~isequaln(a, b)
            d{end + 1} = sprintf('%s: isequaln false', path);
        end
        if builtin('numel', a) == 1
            ta = displayOf(a);
            tb = displayOf(b);
            if ~strcmp(ta, tb)
                d{end + 1} = sprintf('%s: displays %s vs %s', path, trunc(ta), trunc(tb));
            end
        end
    end
elseif ~isequaln(a, b)
    d{end + 1} = sprintf('%s: %s vs %s', path, show(a), show(b));
elseif (isa(a, 'double') || isa(a, 'single')) && ~issparse(a) && ~sameBits(a, b)
    % isequaln holds -0 and 0 equal; the bits of a double or a single do not.
    d{end + 1} = sprintf('%s: equal, but not bit for bit (the sign of a zero): %s vs %s', path, bitsShown(a), bitsShown(b));
end
end

% Whether two doubles or singles of one size hold the same bits, part by part: the sign of a
% zero included, a NaN's payload not (MATLAB's own NaN and the one a JavaScript writer stores
% differ in it, and nothing MATLAB computes on a NaN reads it).
function same = sameBits(a, b)
cls = 'uint64';
if isa(a, 'single')
    cls = 'uint32';
end
same = true;
parts = {@real, @imag};
for i = 1:2
    pa = parts{i}(a(:));
    pb = parts{i}(b(:));
    keep = ~isnan(pa) & ~isnan(pb);
    if any(keep)
        same = same && isequal(typecast(pa(keep), cls), typecast(pb(keep), cls));
    end
end
end

function s = bitsShown(v)
s = mat2str(1 ./ [real(v(:)); imag(v(:))]');
end

% Every readable property of every element, and whether there was one. The elements are the
% object's own, builtin('numel'): a table or a categorical is one object whatever size it
% says it is, and t(i) is an error for a table.
function [d, gotone] = dprops(a, b, path, depth)
d = {};
p = properties(a);
gotone = false;
n = builtin('numel', a);
if builtin('numel', b) ~= n
    d{end + 1} = sprintf('%s: %d objects vs %d', path, n, builtin('numel', b));
    return
end
for i = 1:n
    if n == 1
        ai = a;
        bi = b;
    else
        ai = a(i);
        bi = b(i);
    end
    for j = 1:numel(p)
        [va, ea] = getProp(ai, p{j});
        [vb, eb] = getProp(bi, p{j});
        where = sprintf('%s(%d).%s', path, i, p{j});
        if ~strcmp(ea, eb)
            d{end + 1} = sprintf('%s: get throws <%s> vs <%s>', where, ea, eb); %#ok<AGROW>
        elseif isempty(ea)
            gotone = true;
            d = [d, dcmp(va, vb, where, depth + 1)]; %#ok<AGROW>
        end
    end
end
end

function [v, eid] = getProp(o, name)
v = [];
eid = '';
try
    v = o.(name);
catch ex
    eid = ex.identifier;
    if isempty(eid)
        eid = ex.message;
    end
end
end

function s = displayOf(v)
try
    s = strtrim(regexprep(char(formattedDisplayText(v, 'SuppressMarkup', true)), '\s+', ' '));
catch
    s = '<no display>';
end
end

% Every handle object reachable from the variables, in a fixed walk, with its path. A handle
% met again is listed again but not walked again, so a DAG costs its size, not its paths.
function [hs, ps] = handlesOf(V)
hs = {};
ps = {};
names = fieldnames(V);
for i = 1:numel(names)
    [hs, ps] = walkHandles(V.(names{i}), names{i}, hs, ps, 0);
end
end

function [hs, ps] = walkHandles(v, path, hs, ps, depth)
if depth > 12 || numel(hs) >= 400
    return
end
if isstruct(v)
    fn = fieldnames(v);
    for i = 1:numel(v)
        for j = 1:numel(fn)
            [hs, ps] = walkHandles(v(i).(fn{j}), sprintf('%s(%d).%s', path, i, fn{j}), hs, ps, depth + 1);
        end
    end
elseif iscell(v)
    for i = 1:numel(v)
        [hs, ps] = walkHandles(v{i}, sprintf('%s{%d}', path, i), hs, ps, depth + 1);
    end
elseif isobject(v) && ~isstring(v) && ~isenum(v)
    isHandle = isa(v, 'handle');
    p = properties(v);
    n = builtin('numel', v);
    for i = 1:n
        if n == 1
            h = v;
        else
            h = v(i);
        end
        walk = true;
        if isHandle
            for k = 1:numel(hs)
                if sameHandle(hs{k}, h)
                    walk = false;
                    break
                end
            end
            hs{end + 1} = h; %#ok<AGROW>
            ps{end + 1} = sprintf('%s(%d)', path, i); %#ok<AGROW>
        end
        if walk
            for j = 1:numel(p)
                [x, ex] = getProp(h, p{j});
                if isempty(ex)
                    [hs, ps] = walkHandles(x, sprintf('%s(%d).%s', path, i, p{j}), hs, ps, depth + 1);
                end
            end
        end
    end
end
end

% For each handle, the number of the first earlier one that is the same object, or 0.
function s = aliasesOf(hs)
s = zeros(1, numel(hs));
for k = 1:numel(hs)
    for j = 1:k - 1
        if sameHandle(hs{j}, hs{k})
            s(k) = j;
            break
        end
    end
end
end

function tf = sameHandle(a, b)
try
    tf = strcmp(class(a), class(b)) && isequal(size(a), size(b)) && all(a == b, 'all');
catch
    tf = false;
end
end

function s = show(v)
try
    if ischar(v)
        s = ['''' reshape(v, 1, []) ''''];
    elseif isstring(v)
        s = ['"' char(strjoin(reshape(v, 1, []), '","')) '"'];
    elseif isenum(v)
        s = strjoin(arrayfun(@char, reshape(v, 1, []), 'UniformOutput', false), ',');
    elseif isnumeric(v) || islogical(v)
        s = mat2str(full(v), 17);
    else
        s = ['<' class(v) '>'];
    end
catch
    s = ['<' class(v) '>'];
end
s = trunc(s);
end

function s = trunc(s)
if numel(s) > 200
    s = [s(1:200) sprintf(' ...(%d chars)', numel(s))];
end
end
