% Copyright 2026 The MathWorks, Inc.
%
% The MATLAB half of the gate for an edit of an object's property inside a dictionary value's MAT
% stream: open every dictionary probe_sldd_stream_objects.mjs saved through the session, read every
% entry, and compare it, to the leaf, with the original read and edited by MATLAB itself.
%
% Run the JS half first, with the SAME absolute PROBE_OUT (and `npm run build` before it: the JS
% half reads dist/, so a stale build is a stale verdict):
%   env PROBE_OUT=/tmp/sldd-stream node test/parity/matlab/probe_sldd_stream_objects.mjs
%   env PROBE_OUT=/tmp/sldd-stream mw -using Bmain matlab -nodesktop \
%       -batch "run('$PWD/test/parity/matlab/probe_sldd_stream_objects.m')"
% PROBE_OUT may instead be set as a variable before the run: "PROBE_OUT='/tmp/x'; run(...)".
%
% For each case of the manifest (closeAll first, and every dictionary closed with its changes
% discarded, so nothing is ever saved but MATLAB's own edit, below, into a copy):
%   1. S0 = every Design Data entry of the original, which must open and read with no warning and
%      print nothing;
%   2. S  = the original read again (an object is a handle: S0's are not to be edited), with the
%      case's MATLAB statements applied to each edited entry's value `v`; it must differ from S0
%      for a case that edits, and equal it for a control;
%   3. T  = every entry of the save, which must open and read with no warning and print nothing;
%   4. T must be S: the same entries, each the same to the leaf (dcmp: class, size, sparsity,
%      complexity, isequaln on every value, field names in order, every element of a cell or a
%      struct array, every readable property of an object), and its handles shared as S's are;
%   5. for a binary case, MATLAB's own save of the same edit, into a copy of the original: whether
%      it writes each edited entry as the same hex (`bytes`), which is said, not judged.
% A case whose `expectFail` is set is a NEGATIVE control: its statements make another edit than the
% save does, and it passes only when step 4 reports the difference.
%
% Prints `RESULT <name> PASS` or `RESULT <name> FAIL <why>` per case, and last
% `PROBE_SLDD_STREAM_OBJECTS DONE pass=N fail=M`. fail=0 is the only acceptable result.
if exist('PROBE_OUT', 'var') && ~isempty(PROBE_OUT) %#ok<NODEF>
    outdir = PROBE_OUT;
else
    outdir = getenv('PROBE_OUT');
end
if isempty(outdir) || outdir(1) ~= '/'
    error('PROBE_OUT is not set to an ABSOLUTE path. It must be the one the .mjs half wrote to.');
end
% Everything this script writes (MATLAB's own edits) goes to outdir, never to the folder MATLAB
% was launched from.
cd(outdir);
warning('off', 'backtrace');
Simulink.data.dictionary.closeAll('-discard');
fprintf('VERSION %s\n', version);

cases = jsondecode(fileread(fullfile(outdir, 'manifest.json')));
if isstruct(cases)
    cases = num2cell(cases);
end
npass = 0;
nfail = 0;
for ci = 1:numel(cases)
    c = cases{ci};
    try
        [why, note] = runCase(c, outdir);
    catch err
        why = ['the probe itself failed: ' err.message];
        note = '';
        Simulink.data.dictionary.closeAll('-discard');
    end
    if c.expectFail
        if isempty(why)
            why = 'the negative control was not reported';
        elseif startsWith(why, 'differs:')
            why = '';
            note = ['reported, as it must be; ' note];
        end
    end
    if isempty(why)
        npass = npass + 1;
        fprintf('RESULT %s PASS %s\n', c.name, note);
    else
        nfail = nfail + 1;
        fprintf('RESULT %s FAIL %s %s\n', c.name, why, note);
    end
end
fprintf('PROBE_SLDD_STREAM_OBJECTS DONE pass=%d fail=%d\n', npass, nfail);

function [why, note] = runCase(c, outdir)
why = '';
note = '';
original = fullfile(outdir, c.original);
saved = fullfile(outdir, c.file);
[S0, m0, e0] = readAll(original);
if ~isempty(e0) || ~isempty(m0)
    why = ['the original does not read quietly: ' strjoin([{e0}, m0], ' | ')];
    return
end
[S, ~, ~] = readAll(original);
edits = c.edits;
if iscell(edits)
    edits = [edits{:}];
end
entries = {};
for k = 1:numel(edits)
    S.(edits(k).entry) = applyEdit(S.(edits(k).entry), edits(k).matlab);
    entries{end + 1} = edits(k).entry; %#ok<AGROW>
end
entries = unique(entries, 'stable');
changed = cmpAll(S0, S);
if c.control && ~isempty(changed)
    why = ['a control whose statements change the value: ' strjoin(changed, '; ')];
    return
end
if ~c.control && isempty(changed)
    why = 'the case''s statements change nothing';
    return
end
[T, m1, e1] = readAll(saved);
if ~isempty(e1)
    why = ['the save does not read: ' e1];
    return
end
if ~isempty(m1)
    why = ['the save does not read quietly: ' strjoin(m1, ' | ')];
    return
end
d = cmpAll(S, T);
if strcmp(c.format, 'bin') && ~c.control && ~c.expectFail
    note = ownBytes(c, original, saved, outdir, entries, S);
end
if ~isempty(d)
    why = ['differs: ' strjoin(d, '; ')];
end
end

% The value `v` with one case's statements applied, which name it `v`.
function v = applyEdit(v, statements)
eval(statements);
end

% Every entry of Design Data, with anything printed or warned while opening and reading it, and the
% first entry that did not read (the others are read all the same). Closed with its changes
% discarded.
function [S, msgs, err] = readAll(fn)
S = struct();
msgs = {};
err = '';
Simulink.data.dictionary.closeAll('-discard');
lastwarn('');
try
    txt = evalc('dd = Simulink.data.dictionary.open(fn);');
    if ~isempty(strtrim(txt))
        msgs{end + 1} = ['open: ' strtrim(txt)];
    end
    ds = getSection(dd, 'Design Data');
    ents = find(ds);
    bad = {};
    for i = 1:numel(ents)
        nm = ents(i).Name;
        try
            txt = evalc('S.(nm) = getValue(ents(i));');
        catch e
            bad{end + 1} = sprintf('getValue(%s): %s (%s)', nm, e.message, e.identifier); %#ok<AGROW>
            continue
        end
        if ~isempty(strtrim(txt))
            msgs{end + 1} = [nm ': ' strtrim(txt)]; %#ok<AGROW>
        end
    end
    if ~isempty(bad)
        err = strjoin(bad, '; ');
    end
    [w, wid] = lastwarn;
    if ~isempty(w)
        msgs{end + 1} = sprintf('lastwarn: %s (%s)', w, wid);
    end
    clear ents ds
    discardChanges(dd);
    close(dd);
    clear dd
catch e
    err = sprintf('open: %s (%s)', e.message, e.identifier);
end
Simulink.data.dictionary.closeAll('-discard');
if ~isempty(fieldnames(S))
    S = orderfields(S);
end
end

% MATLAB's own save of the edit, into a copy of the original, and whether it holds each edited
% entry as the save does, hex digit for hex digit.
function note = ownBytes(c, original, saved, outdir, entries, S)
own = fullfile(outdir, ['matlab_' c.file]);
copyfile(original, own);
Simulink.data.dictionary.closeAll('-discard');
dd = Simulink.data.dictionary.open(own);
ds = getSection(dd, 'Design Data');
for k = 1:numel(entries)
    setValue(getEntry(ds, entries{k}), S.(entries{k}));
end
saveChanges(dd);
clear ds
close(dd);
clear dd
Simulink.data.dictionary.closeAll('-discard');
ours = chunkOf(saved, outdir);
theirs = chunkOf(own, outdir);
parts = {};
for k = 1:numel(entries)
    a = hexOf(ours, entries{k});
    b = hexOf(theirs, entries{k});
    if isempty(b)
        parts{end + 1} = [entries{k} ' bytes: MATLAB writes it as XML']; %#ok<AGROW>
    elseif strcmp(a, b)
        parts{end + 1} = [entries{k} ' bytes: same as MATLAB''s']; %#ok<AGROW>
    else
        parts{end + 1} = sprintf('%s bytes: differ from MATLAB''s (%d vs %d)', entries{k}, numel(a) / 2, numel(b) / 2); %#ok<AGROW>
    end
end
note = ['(' strjoin(parts, '; ') ')'];
end

function xml = chunkOf(zipPath, outdir)
tmp = tempname(outdir);
mkdir(tmp);
cleanup = onCleanup(@() rmdir(tmp, 's'));
unzip(zipPath, tmp);
xml = fileread(fullfile(tmp, 'data', 'chunk0.xml'));
end

function digits = hexOf(xml, name)
digits = '';
objs = regexp(xml, '<Object Class="DD.ENTRY">.*?</Object>', 'match');
for k = 1:numel(objs)
    nm = regexp(objs{k}, '<P Name="Name" Class="char">([^<]*)</P>', 'tokens', 'once');
    if strcmp(nm{1}, name)
        body = regexp(objs{k}, '<P Name="Value"[^>]*Encoding="hex"[^>]*>([^<]*)</P>', 'tokens', 'once');
        if ~isempty(body)
            digits = regexprep(body{1}, '\s', '');
        end
        return
    end
end
end

function d = cmpAll(A, B)
d = {};
na = fieldnames(A);
nb = fieldnames(B);
if ~isequal(na, nb)
    d{end + 1} = sprintf('entries [%s] vs [%s]', strjoin(na', ','), strjoin(nb', ','));
end
common = intersect(na, nb, 'stable');
for i = 1:numel(common)
    d = [d, dcmp(A.(common{i}), B.(common{i}), common{i}, 0)]; %#ok<AGROW>
    [ha, pa] = walkHandles(A.(common{i}), common{i}, {}, {}, 0);
    [hb, pb] = walkHandles(B.(common{i}), common{i}, {}, {}, 0);
    if ~isequal(pa, pb) || ~isequal(aliasesOf(ha), aliasesOf(hb))
        d{end + 1} = sprintf('%s: its handles are shared otherwise', common{i}); %#ok<AGROW>
    end
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
elseif isenum(a) || isstring(a)
    if ~isequaln(a, b)
        d{end + 1} = sprintf('%s: %s vs %s', path, show(a), show(b));
    end
elseif isobject(a) || isa(a, 'handle')
    % By its properties, each to the leaf: not by isequaln, which is false between two reads of
    % one file for a handle, and numeric (it finds a single property equal to its double).
    p = properties(a);
    n = builtin('numel', a);
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
                d = [d, dcmp(va, vb, where, depth + 1)]; %#ok<AGROW>
            end
        end
    end
elseif ~isequaln(a, b)
    d{end + 1} = sprintf('%s: %s vs %s', path, show(a), show(b));
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

% Every handle object reachable from a value, in a fixed walk, with its path. A handle met again
% is listed again but not walked again.
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
    elseif isnumeric(v) || islogical(v)
        s = mat2str(full(v), 17);
    else
        s = ['<' class(v) '>'];
    end
catch
    s = ['<' class(v) '>'];
end
if numel(s) > 200
    s = [s(1:200) sprintf(' ...(%d chars)', numel(s))];
end
end
