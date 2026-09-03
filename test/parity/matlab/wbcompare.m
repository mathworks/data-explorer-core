function nfail = wbcompare(outdir, showsig)
%WBCOMPARE  The comparison engine both write-back gates run on.
%
%   nfail = wbcompare(outdir)
%   nfail = wbcompare(outdir, true)   % print both signatures for EVERY case
%
% The second form is how you check that a PASS is not vacuous. `fullsig` reaches an
% object's contents through `properties()`, and a class that reports none would
% compare equal on class and size alone — a green verdict that checked nothing. The
% printed signature is the only way to see the difference.
%
% `outdir` holds two files written by the JS half of a gate:
%   manifest.json   one record per CASE (see the field list below)
%   controls.json   paths that must open cleanly for any verdict to mean anything
%
% A case is one entry in one dictionary our writer produced, compared against the
% same entry in a dictionary MATLAB produced — or, when `refexpr` is set, against a
% MATLAB expression, which is how a grammar question gets answered with our writer
% out of the loop entirely.
%
% Record fields (every record carries every key, empty where it does not apply:
% MATLAB's jsondecode gives a struct ARRAY only for homogeneous objects, and a
% heterogeneous list arrives as a cell array of structs, which reads e(k).name as an
% error rather than as a value):
%   batch    grouping label, printed only
%   file     the dictionary OUR writer produced
%   ref      the dictionary MATLAB produced        (ignored when refexpr is set)
%   refexpr  a MATLAB expression to compare against instead of `ref`
%   name     the entry to compare
%   label    what to print
%   kind     'same'    -> the value must be identical, to the leaf
%            'edited'  -> the value MUST differ (that is the edit); only its shape
%                         and class signature are compared, and every element is
%                         printed so an edit that landed in the wrong cell shows
%            'skipped' -> our writer could not produce it at all, which is a
%                         failure of the gate and is counted as one
%   extract  a MATLAB expression appended to `v` to reach the value being compared
%   expect   prose, printed next to the verdict
%   why      the reason, for a skipped case
%
% Prints one block per case and, last, `WRITEBACK FAILURES n of m`. Zero is the
% only acceptable result.
%
% Comparison is `fullsig`, not `isequal`: isequal is NUMERIC and blind to a value
% that came back retyped (isequal(single(3.5), 3.5) is true, isequal({int32(1)},
% {1}) is true), and it compares two handle objects by identity, which is false for
% any two distinct objects however equal their contents. fullsig walks to every
% leaf and spells class, size, complexity and exact value at each one, so a
% dictionary that reopens with a uint64 field demoted to char fails on the field
% rather than passing on the container.

if nargin < 1 || isempty(outdir)
    error('wbcompare: outdir is required and must be the ABSOLUTE path the JS half wrote to.');
end
if nargin < 2 || isempty(showsig)
    showsig = false;
end
m = jsondecode(fileread(fullfile(outdir, 'manifest.json')));
controls = jsondecode(fileread(fullfile(outdir, 'controls.json')));

Simulink.data.dictionary.closeAll('-discard');
% One dictionary can hold many cases — cases.sldd holds seventy-three — so opening
% per case would open the same file seventy-three times. Opened dictionaries are
% cached here and closed together at the end.
open = containers.Map('KeyType', 'char', 'ValueType', 'any');

fprintf('##### CONTROLS\n');
for c = 1:numel(controls)
    [~, cname] = fileparts(controls{c});
    try
        d = Simulink.data.dictionary.open(controls{c});
        n = numel(find(d.getSection('Design Data'))); %#ok<MXFND>
        d.close();
        fprintf('  %-52s OK (%d entries)\n', cname, n);
    catch ME
        fprintf('  %-52s FAILED %s | %s\n', cname, ME.identifier, ME.message);
    end
end

nfail = 0;
for k = 1:numel(m)
    e = m(k);
    label = e.label;
    if strcmp(e.kind, 'skipped')
        fprintf('##### %-34s SKIPPED BY PROBE: %s\n', label, e.why);
        nfail = nfail + 1;
        continue
    end
    fprintf('##### %-34s (%s)\n', label, e.kind);
    ref = [];
    refok = false;
    try
        if ~isempty(e.refexpr)
            ref = eval(e.refexpr);
        else
            ref = applyExtract(getEntry(open, e.ref, e.name), e.extract);
        end
        refok = true;
        fprintf('  REF  %s\n', describe(ref));
    catch ME
        fprintf('  REF  UNREADABLE %s | %s\n', ME.identifier, ME.message);
    end
    try
        v = applyExtract(getEntry(open, e.file, e.name), e.extract);
        fprintf('  OURS %s\n', describe(v));
        fprintf('  EXPECT %s\n', e.expect);
        if strcmp(e.kind, 'same')
            sigv = fullsig(v);
            sigr = '';
            if refok, sigr = fullsig(ref); end
            same = refok && strcmp(sigv, sigr);
            if ~same || showsig
                fprintf('  SIG    ref  %s\n', trunc(sigr));
                fprintf('  SIG    ours %s\n', trunc(sigv));
            end
            fprintf('  VERDICT %s\n', verdict(same));
            if ~same, nfail = nfail + 1; end
        else
            % An edited value cannot be identical to the reference — that is the
            % point of the edit — so only the shape and class signature are
            % compared, and every element is printed.
            fprintf('  DEEP   %s\n', trunc(deepen(v)));
            okshape = refok && strcmp(deepsig(v), deepsig(ref));
            fprintf('  SHAPE  %s\n', verdict(okshape));
            if ~okshape, nfail = nfail + 1; end
        end
    catch ME
        fprintf('  OURS UNREADABLE %s | %s\n', ME.identifier, ME.message);
        nfail = nfail + 1;
    end
end

for key = open.keys()
    try
        d = open(key{1});
        d.close();
    catch
    end
end
Simulink.data.dictionary.closeAll('-discard');

fprintf('WRITEBACK FAILURES %d of %d\n', nfail, numel(m));
end

% ---- one entry's value, from a dictionary opened at most once ------------------
function v = getEntry(open, path, name)
    if ~open.isKey(path)
        open(path) = Simulink.data.dictionary.open(path); %#ok<NASGU>
    end
    v = open(path).getSection('Design Data').getEntry(name).getValue();
end

% The value inside the entry. An empty extract means the entry IS the value.
function x = applyExtract(v, ex)
    if isempty(ex)
        x = v;
    else
        x = eval(['v' ex]);
    end
end

% strjoin, but tolerant of the empty container. cellfun and arrayfun over zero
% elements return a 0x0 DOUBLE rather than an empty cell, and strjoin rejects that
% with MATLAB:strjoin:InvalidCellType — which threw inside `describe` and turned
% cellEmpty's verdict into 'REF UNREADABLE' on both sides, a gate bug that reads
% exactly like a real failure.
function s = joinparts(c)
    if isempty(c) || ~iscellstr(c) %#ok<ISCLSTR>
        s = '';
        return
    end
    s = strjoin(c, ', ');
end

function s = trunc(s)
    if numel(s) > 900
        s = [s(1:900) ' ...(' num2str(numel(s)) ' chars)'];
    end
end

function s = describe(v)
    s = sprintf('class=%-8s size=%-10s numel=%d', class(v), mat2str(size(v)), numel(v));
    if ischar(v)
        s = [s sprintf(' text=''%s''', trunc(reshape(v, 1, [])))];
    elseif iscell(v)
        s = [s ' cellclasses=' joinparts(cellfun(@(x) {class(x)}, reshape(v, 1, [])))];
    elseif isstruct(v)
        s = [s ' fields=' joinparts(reshape(fieldnames(v), 1, []))];
    elseif isinteger(v)
        s = [s ' colmajor=[' joinparts(reshape(arrayfun(@(x) {char(string(x))}, v), 1, [])) ']'];
    elseif isobject(v) || isa(v, 'handle')
        s = [s ' (object)'];
    else
        s = [s ' colmajor=' trunc(mat2str(reshape(v, 1, [])))];
    end
end

% Every element, spelled out, so an edit that landed in the wrong cell is visible.
function s = deepen(v)
    parts = {};
    if iscell(v)
        flat = reshape(v, 1, []);
        for i = 1:numel(flat)
            x = flat{i};
            if ischar(x), parts{end+1} = ['''' x '''']; else, parts{end+1} = mat2str(x); end %#ok<AGROW>
        end
    elseif isstruct(v)
        fn = fieldnames(v);
        for i = 1:numel(v)
            bits = {};
            for f = 1:numel(fn)
                x = v(i).(fn{f});
                if ischar(x), bits{end+1} = [fn{f} '=''' x '''']; %#ok<AGROW>
                else, bits{end+1} = [fn{f} '=' mat2str(x)]; %#ok<AGROW>
                end
            end
            parts{end+1} = ['(' num2str(i) ') ' strjoin(bits, ' ')]; %#ok<AGROW>
        end
    else
        parts{1} = mat2str(reshape(v, 1, []));
    end
    s = strjoin(parts, ' | ');
end

% class and size at every level, with no values: the shape comparison an edited
% case gets, where equality is false by construction.
function s = deepsig(v)
    s = [class(v) mat2str(size(v))];
    parts = {};
    if isstruct(v)
        fn = fieldnames(v);
        for i = 1:numel(v)
            for f = 1:numel(fn)
                parts{end+1} = [fn{f} ':' deepsig(v(i).(fn{f}))]; %#ok<AGROW>
            end
        end
    elseif iscell(v)
        flat = reshape(v, 1, []);
        for i = 1:numel(flat)
            parts{end+1} = deepsig(flat{i}); %#ok<AGROW>
        end
    else
        return
    end
    s = [s '{' strjoin(parts, ',') '}'];
end

% class, size, complexity AND exact value, at every leaf, including inside a
% struct's fields, a cell's elements and an object's properties. Two values with the
% same fullsig are the same value in every respect a dictionary can carry; this is
% the whole equality test, replacing isequal (numeric, and handle-identity for
% objects) and class() (which only ever sees the container).
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
        % Column-major, which is how every channel stores it: ['ab'; 'cd'] is
        % 'acbd', so a transposed char fails here rather than comparing equal.
        s = [s '=''' reshape(v, 1, []) ''''];
        return
    elseif isstring(v)
        parts = arrayfun(@(x) {['"' char(x) '"']}, reshape(v, 1, []));
        s = [s '{' strjoin(parts, ',') '}'];
        return
    elseif isnumeric(v) || islogical(v)
        % Complexity is part of the value: a complex array that reopened real, or a
        % real one that grew an all-zero imaginary part, is not the value MATLAB
        % wrote. `isreal` is asked here and not at the top because it is not defined
        % for a struct, a cell or an object.
        if ~isreal(v), s = [s '/cplx']; end
        s = [s '=' valstr(v)];
        return
    elseif isenum(v)
        parts = arrayfun(@(x) {char(x)}, reshape(v, 1, []));
        s = [s '{' strjoin(parts, ',') '}'];
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
                    % A dependent property that throws on get is part of the
                    % signature too — the same throw on both sides compares equal.
                    parts{end+1} = [p{j} ':<' ME.identifier '>']; %#ok<AGROW>
                end
            end
        end
        % Data a class does not expose as a public property is data all the same.
        % Simulink.VariantVariable reports only Specification and Bank and BOTH throw
        % MATLAB:class:ObjectMustBeScalar on get, so a signature built from
        % properties() alone compares two variants on class and size — a PASS that
        % checks nothing, while the choices that ARE the value go unread.
        %
        % The last resort is the class's own display, which is deterministic, carries
        % the data (a variant prints its condition/value table) and is the same ground
        % truth this whole suite is built on. `struct(v)` was tried first and is
        % wrong: it exposes the framework internals a public property list
        % deliberately hides — a simulink.variant.Variable carries an
        % `mf.zero.meta.Class` metamodel graph, which recursing into does not
        % terminate in useful time, and a per-load `UUID`, which would fail every
        % comparison for a reason that has nothing to do with the value.
        if ~gotone && numel(v) == 1
            try
                % SuppressMarkup, or the signature carries the hyperlinks a class
                % puts in its own display and half of it is help-popup HTML.
                txt = formattedDisplayText(v, 'SuppressMarkup', true);
                parts{end+1} = ['disp:' strtrim(regexprep(char(txt), '\s+', ' '))];
            catch
                parts{end+1} = 'disp:<opaque>';
            end
        end
    else
        return
    end
    s = [s '{' strjoin(parts, ',') '}'];
end

% Exact text for a numeric value: every integer class printed in full (a uint64
% through %g would round, which is the very defect this gate exists to catch) and
% every float at %.17g, which round-trips a double exactly.
function s = valstr(v)
    if isempty(v)
        s = '[]';
        return
    end
    flat = reshape(v, 1, []);
    if isinteger(v) || islogical(v)
        s = strjoin(arrayfun(@(x) {char(string(x))}, flat), ',');
    elseif isreal(v)
        s = strjoin(arrayfun(@(x) {sprintf('%.17g', x)}, flat), ',');
    else
        s = strjoin(arrayfun(@(x) {sprintf('%.17g%+.17gi', real(x), imag(x))}, flat), ',');
    end
end

function s = verdict(tf)
    if tf, s = 'PASS'; else, s = 'FAIL'; end
end
