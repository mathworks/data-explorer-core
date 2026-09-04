% Copyright 2026 The MathWorks, Inc.
%
% Ground-truth generator for the MATLAB parity suite. Writes committed
% artifacts + truth JSON; the tests never launch MATLAB.
%
% Run:  matlab -nodesktop -batch "run('<abs path>/gen_truth.m')"
%
% Every array case is deliberately NON-SQUARE (2x3, never 2x2) and has a
% rank-3 sibling (2x3x2). A square fixture cannot distinguish row-major from
% column-major, and a rank-2 fixture cannot expose page handling; between them
% those two gaps hid six of the thirteen defects this suite exists to pin.

here = fileparts(mfilename('fullpath'));
% Honour an outdir set by the caller (drift.mjs, Phase 12) so the corpus can be
% regenerated to a scratch directory and diffed against what is committed.
if ~exist('outdir', 'var') || isempty(outdir)
    outdir = fullfile(here, '..', 'artifacts');
end
artdir = outdir;
for d = {artdir, fullfile(artdir,'mat'), fullfile(artdir,'slx'), ...
         fullfile(artdir,'text'), fullfile(artdir,'binary')}
    if ~exist(d{1}, 'dir'), mkdir(d{1}); end
end

%% ---- the catalog: {name, value} -------------------------------------------
C = {};
% primitives, scalar
% 'kp' is the plain scalar double Phase 12's live write-back tier edits; its
% starting value must differ from what that tier writes (42) or the test would
% pass without writing anything.
C(end+1,:) = {'kp',        1.5};
C(end+1,:) = {'scalarD',   pi};
C(end+1,:) = {'negD',      -2.5};
C(end+1,:) = {'bigD',      1e300};
C(end+1,:) = {'tinyD',     1e-300};
C(end+1,:) = {'scalarS',   single(pi)};
C(end+1,:) = {'boolT',     true};
C(end+1,:) = {'boolF',     false};
C(end+1,:) = {'charStr',   'it''s'};
C(end+1,:) = {'strScalar', "world"};
C(end+1,:) = {'cplxScalar',3+4i};
% non-finites
C(end+1,:) = {'infP',      Inf};
C(end+1,:) = {'infN',      -Inf};
C(end+1,:) = {'nanV',      NaN};
C(end+1,:) = {'nonFinVec', [1 Inf -Inf NaN 5]};
% every integer class, scalar + extremes (64-bit is where precision breaks)
for cls = {'int8','int16','int32','int64','uint8','uint16','uint32','uint64'}
    k = cls{1};
    C(end+1,:) = {['s_' k],   cast(7, k)};
    if strcmp(k, 'uint64')
        % ONE name for intmax('uint64'). Phase 10's int64 suite and Phase 12's
        % live write-back catalog both call it maxU64; a second 'max_uint64'
        % alias would be two entries to keep in step for no gain.
        C(end+1,:) = {'maxU64', intmax(k)};
    else
        C(end+1,:) = {['max_' k], intmax(k)};
    end
    C(end+1,:) = {['min_' k], intmin(k)};
end
% shapes: row, column, NON-SQUARE matrix, rank 3, empty, over-threshold
C(end+1,:) = {'rowVec',  [1 2 3]};
C(end+1,:) = {'colVec',  [1; 2; 3]};
C(end+1,:) = {'mat2x3',  [1 2 3; 4 5 6]};
A = zeros(2,3,2); A(:,:,1) = [1 2 3; 4 5 6]; A(:,:,2) = [7 8 9; 10 11 12];
C(end+1,:) = {'nd2x3x2', A};
C(end+1,:) = {'emptyD',  []};
C(end+1,:) = {'long30',  1:30};
C(end+1,:) = {'exactly10', 1:10};
C(end+1,:) = {'eleven',  1:11};
C(end+1,:) = {'boolVec', [true false true]};
C(end+1,:) = {'i16Vec',  int16([1 2 3])};
% 64-bit ARRAYS. Phase 10's own fixtures cover .mat and .sldd only, so without
% these the shared corpus never exercises the 64-bit path in a .slx at all — and
% an array is where a per-element double conversion hides that a scalar special
% case papered over it. 2^53+1 is the smallest integer a double cannot represent.
C(end+1,:) = {'u64Vec',  [intmax('uint64') uint64(1) uint64(0)]};
C(end+1,:) = {'i64Vec',  [intmax('int64') intmin('int64') int64(-1)]};
C(end+1,:) = {'i64Unsafe', int64(9007199254740993)};
C(end+1,:) = {'cplxVec', [1+2i 3-4i]};
% char / string arrays
C(end+1,:) = {'strArray', ["a" "bb" "ccc"]};
C(end+1,:) = {'strMat',   ["a" "bb" "ccc"; "d" "ee" "fff"]};
C(end+1,:) = {'longChar', repmat('x', 1, 300)};
C(end+1,:) = {'hugeChar', repmat('y', 1, 1500)};
% cells
C(end+1,:) = {'cellFlat',  {1, 'two', [3 4]}};
C(end+1,:) = {'cellNest',  {1, {2, {3}}}};
C(end+1,:) = {'cell2x3',   {1 2 3; 4 5 6}};
% 2x3x2, not 2x2x2: a square page cannot distinguish row-major from column-major,
% which is the whole reason every other array case here is non-square.
Cnd = cell(2,3,2); for k = 1:12, Cnd{k} = k; end
C(end+1,:) = {'cellNd',    Cnd};
C(end+1,:) = {'cellEmpty', {}};
% structs
C(end+1,:) = {'structScalar', struct('a', 1, 'b', 'txt')};
C(end+1,:) = {'structNest',   struct('a', struct('b', 2))};
clear sa; for k = 1:3, sa(k).a = k; sa(k).b = k*10; end
C(end+1,:) = {'struct1x3', sa};
clear sm; for k = 1:6, sm(k).a = k; end
C(end+1,:) = {'struct2x3', reshape(sm, [2 3])};
clear sn; for k = 1:12, sn(k).a = k; end
C(end+1,:) = {'structNd',  reshape(sn, [2 3 2])};
C(end+1,:) = {'structEmpty', struct([])};

%% ---- objects: scalars of every known class, plus object ARRAYS ------------
% Known classes get non-default values on writable properties so a dropped or
% defaulted property is detectable.
p = Simulink.Parameter(5); p.Description = 'a param'; p.Min = -10; p.Max = 10;
p.Unit = 'm/s'; p.DataType = 'int16';
C(end+1,:) = {'aParam', p};
sg = Simulink.Signal; sg.Description = 'a signal'; sg.DataType = 'single';
sg.Unit = 'K'; sg.Min = 0; sg.Max = 100;
C(end+1,:) = {'aSignal', sg};
b = Simulink.Bus; b.Description = 'a bus';
e1 = Simulink.BusElement; e1.Name = 'x'; e1.DataType = 'double'; e1.Dimensions = 3;
e2 = Simulink.BusElement; e2.Name = 'y'; e2.DataType = 'int8';
b.Elements = [e1 e2];
C(end+1,:) = {'aBus', b};
lt = Simulink.LookupTable; lt.StructTypeInfo.Name = 'LtType';
C(end+1,:) = {'aLookup', lt};
% 'Choices' is a flat {condition, value, condition, value} cell. R2027a rejects an
% inline Simulink.Parameter as a value: "Value in 'Choices' array should be finite
% and numeric, or a variable name corresponding to a Simulink.Parameter object."
vv = Simulink.VariantVariable('Choices', {'V == 1', 1, 'V == 2', 2});
C(end+1,:) = {'aVariant', vv};
% object ARRAYS -- .mat ONLY. R2027a refuses them in a data dictionary AND in a
% model workspace; both refusals are recorded below rather than asserted here.
% Value = row*10 + col makes the label->value mapping self-describing, which is
% what catches a transposed read.
clear w; for i = 1:2, for j = 1:3, w(i,j) = Simulink.Parameter(i*10 + j); end, end
OBJARR = {'objRow', [Simulink.Parameter(1) Simulink.Parameter(2) Simulink.Parameter(3)]
          'objCol', [Simulink.Parameter(1); Simulink.Parameter(2); Simulink.Parameter(3)]
          'obj2x3', w
          'obj2x3x2', reshape(arrayfun(@(k) Simulink.Parameter(k), 1:12), [2 3 2])};

%% ---- truth ---------------------------------------------------------------
% Field names are load-bearing: loadTruth.ts's Truth interface and drift.mjs
% both read `vars`, `objArr` and `notes.slddRejected`. Do not rename them here
% without changing both. `notes.slxRejected` is the same idea for the model
% workspace, which turned out to have its own object-array limit.
truth = struct('vars', struct(), 'objArr', struct(), 'notes', struct());
for i = 1:size(C,1)
    truth.vars.(C{i,1}) = truthOf(C{i,1}, C{i,2});
end
for i = 1:size(OBJARR,1)
    truth.objArr.(OBJARR{i,1}) = truthOf(OBJARR{i,1}, OBJARR{i,2});
end

%% ---- .mat ---------------------------------------------------------------
matvars = struct();
for i = 1:size(C,1),      matvars.(C{i,1})      = C{i,2}; end
for i = 1:size(OBJARR,1), matvars.(OBJARR{i,1}) = OBJARR{i,2}; end
save(fullfile(artdir,'mat','cases.mat'), '-struct', 'matvars');

%% ---- .slx model workspace ------------------------------------------------
% The model is named 'cases' because that is the file it is saved to: save_system
% to a new filename RENAMES the block diagram, so a model called anything else
% would leave close_system chasing a name that no longer exists.
%
% A model workspace turns out to refuse object arrays too -- "Creating an array of
% Simulink data or data type objects in the model workspace is not allowed." -- so
% each assignin is guarded and the refusal is recorded as truth, exactly like the
% dictionary's. Object-array parity is a .mat question ONLY.
mdl = 'cases';
if bdIsLoaded(mdl), close_system(mdl, 0); end
new_system(mdl);
ws = get_param(mdl, 'ModelWorkspace');
slxRejected = struct();
for i = 1:size(C,1)
    try
        assignin(ws, C{i,1}, C{i,2});
    catch e
        slxRejected.(C{i,1}) = e.message;
    end
end
for i = 1:size(OBJARR,1)
    try
        assignin(ws, OBJARR{i,1}, OBJARR{i,2});
        slxRejected.(OBJARR{i,1}) = 'ACCEPTED';
    catch e
        slxRejected.(OBJARR{i,1}) = e.message;
    end
end
save_system(mdl, fullfile(artdir,'slx','cases.slx'), 'OverwriteIfChangedOnDisk', true);
close_system(mdl, 0);
truth.notes.slxRejected = slxRejected;

%% ---- .sldd, both formats -------------------------------------------------
% Format is a PROPERTY; there is no format argument to create().
% Both dictionaries are called cases.sldd, in different directories, and MATLAB
% keys open dictionaries by FILE NAME alone: with the text one still open, creating
% the binary one fails with "...because another dictionary with the same file name
% is already open or is being referenced by another open dictionary." Holding the
% section handle (ds) counts as referencing it, so ds is cleared before close().
Simulink.data.dictionary.closeAll('-discard');
rejected = struct();
for fmt = {'uncompressed-text', 'compressed-binary'}
    f = fmt{1};
    sub = strrep(strrep(f, 'uncompressed-', ''), 'compressed-', '');
    fn = fullfile(artdir, sub, 'cases.sldd');   % artifacts/text/, artifacts/binary/
    if exist(fn, 'file'), delete(fn); end
    dd = Simulink.data.dictionary.create(fn);
    dd.FileFormat = f;
    ds = dd.getSection('Design Data');
    for i = 1:size(C,1)
        try
            ds.addEntry(C{i,1}, C{i,2});
        catch e
            rejected.(sub).(C{i,1}) = e.message;
        end
    end
    % Record the object-array boundary as truth rather than as a comment.
    for i = 1:size(OBJARR,1)
        try
            ds.addEntry(OBJARR{i,1}, OBJARR{i,2});
            rejected.(sub).(OBJARR{i,1}) = 'ACCEPTED';
        catch e
            rejected.(sub).(OBJARR{i,1}) = e.message;
        end
    end
    dd.saveChanges();
    clear ds
    dd.close();
    clear dd
    Simulink.data.dictionary.closeAll('-discard');
end
truth.notes.slddRejected = rejected;

%% ---- write truth JSON ---------------------------------------------------
% ONE truth file, not one per format. A value's class, size and display are
% properties of the value, not of the container it was stored in; the per-format
% differences are all in notes.slddRejected. Four copies of the same JSON would
% just be four things to keep in sync.
writeJson(fullfile(artdir,'truth.json'), truth);
writeJson(fullfile(artdir,'meta.json'), ...
          struct('version', version, 'release', version('-release')));
disp('GEN_TRUTH OK');

%% ---- local functions ----------------------------------------------------
function t = truthOf(name, v)
    t = struct();
    t.name = name;
    t.class = class(v);
    t.size = size(v);
    t.numel = numel(v);
    % MATLAB's own answer, verbatim, INCLUDING the surprise: isreal() is false for
    % cell, struct, string and MCOS objects, so iscomplex comes out true for
    % cellEmpty, structEmpty, strArray, aParam... A consumer that wants "has an
    % imaginary part" must also check the class is numeric.
    t.iscomplex = ~isreal(v);
    t.islogical = islogical(v);
    t.isobject = isobject(v);
    t.isempty = isempty(v);
    % SuppressMarkup, or `disp` is HTML. Without it R2027a hands back the
    % Command Window's hyperlinks -- struct1x3 came out as
    % '1x3 <a href="matlab:helpPopup(''struct'')" style="font-weight:bold">struct</a>
    % array with fields:' -- and it is NOT uniform: Simulink.Parameter's own disp
    % emits none, Simulink.Bus's emits them, so a consumer cannot strip them with
    % one rule.
    %
    % KEEP EVERY CALL IN THIS FILE SuppressMarkup. Simulink.VariantVariable's
    % display is STICKY: probed in one -batch session, if a markup-enabled
    % formattedDisplayText runs first, its trailing 'Use getChoice, setChoice,
    % ... to access, modify, add or remove choices' sentence comes back with
    % <a href="matlab:helpPopup(...)"> links that SuppressMarkup then only
    % word-wraps, newlines landing INSIDE the tags. With every call suppressed --
    % which is what `matlab -batch "run('gen_truth.m')"` does -- aVariant's disp
    % is plain text. Mixing in one unsuppressed call would silently change it.
    t.disp = strtrim(formattedDisplayText(v, 'SuppressMarkup', true));
    % mat2str ERRORS on rank >= 3 ("Input matrix must be 2-D"). That error IS
    % ground truth: it is why the fix collapses N-D to <2x3x2 double> instead
    % of inventing a multi-page literal.
    try
        t.mat2str = mat2str(v);
    catch e
        t.mat2str_error = e.message;
    end
    % One subscript label per element, in MATLAB's own column-major linear
    % order, so a transposed read is detectable element by element.
    %
    % char is excluded: DESIGN.md's convention says "char does not expand", and
    % the data model agrees (a char entry is a leaf). MATLAB will happily label
    % charStr(1)..charStr(4), but recording that would make Phase 11's
    % structure.test.ts -- which asserts children.length == numel for every entry
    % carrying linearValues -- demand one child row per CHARACTER. A string ARRAY
    % does expand, so string is not excluded.
    n = numel(v);
    if n > 1 && n <= 64 && ~ischar(v)
        subs = cell(1, n);
        vals = cell(1, n);
        elems = cell(1, n);
        for k = 1:n
            subs{k} = subLabel(name, size(v), k, iscell(v));
            vals{k} = elemText(v, k);
            elems{k} = elemTruth(name, v, k);
        end
        t.linearSubs = subs;
        t.linearValues = vals;
        t.linearElems = elems;
    end
    % MATLAB says isobject("a") is TRUE -- string is an object, not a fundamental
    % type -- and properties() then reads a string as a CLASS NAME: properties("world")
    % answers {} and properties(["a" "bb"]) errors "Argument must be a text scalar."
    % t.isobject stays MATLAB's own answer (Phase 9 cares); only the property walk
    % is gated.
    %
    % isscalar too: in R2027a `arr.Prop` on a NONSCALAR Simulink data array does
    % not error, it silently yields the FIRST element's value. Probed on a 1x3
    % [Simulink.Parameter(1) Parameter(2) Parameter(3)]: `ar.Value` returns a 1x1
    % double 1. Recording that under objRow.properties.Value would read as "this
    % array's Value is 1" with nothing to say it means element 1 only. An object
    % array's per-element truth is linearSubs/linearValues; the property truth for
    % the class is on the scalar case (aParam) already.
    if t.isobject && ~isstring(v) && isscalar(v)
        t.properties = propTruth(v);
    end
end

function s = subLabel(name, sz, k, isCell)
    % Drop trailing singleton dimensions but never go below rank 2, which is what
    % ind2sub itself assumes. (The plan's `find([sz 2] > 1, 1, 'last')` indexed one
    % past the end of sz for any 1xN, e.g. sz=[1 5] -> index 3: "Index exceeds the
    % number of array elements. Index must not exceed 2.")
    last = find(sz > 1, 1, 'last');
    if isempty(last), last = 2; end
    sz = sz(1:max(2, last));
    if sum(sz > 1) <= 1
        idx = sprintf('%d', k);
    else
        c = cell(1, numel(sz));
        [c{:}] = ind2sub(sz, k);
        idx = strjoin(cellfun(@(x) sprintf('%d', x), c, 'UniformOutput', false), ',');
    end
    if isCell
        s = sprintf('%s{%s}', name, idx);
    else
        s = sprintf('%s(%s)', name, idx);
    end
end

function s = elemSubject(v, k)
    % The value the ELEMENT ROW displays. Not always element k itself:
    %   cell    -> the content, v{k}, because the row shows the content
    %   object  -> v(k).Value, because a Simulink data object's row shows its value
    %   struct  -> v(k), the 1x1 struct itself, which is what MATLAB summarizes
    %   else    -> v(k)
    % isstring is checked before isobject because isobject("a") is TRUE, and the
    % object branch would then ask a string for a 'Value' property.
    if iscell(v)
        s = v{k};
    elseif isstring(v)
        s = v(k);
    elseif isobject(v) && isprop(v(k), 'Value')
        s = v(k).Value;
    else
        s = v(k);
    end
end

function e = elemTruth(name, v, k)
    % The same measurements truthOf takes, taken on elemSubject -- so an element is
    % just another value and Phase 11 can put it through the SAME expectedDisplay().
    %
    % This exists alongside linearValues because the two answer different questions.
    % linearValues is formattedDisplayText, MATLAB's COMMAND WINDOW format: `1` for
    % a logical, `1.0000 + 2.0000i` for a complex, `3     4` for [3 4], unquoted
    % text for a string. A table cell follows the mat2str convention instead --
    % `true`, `1+2i`, `[3 4]`, `"a"` -- so comparing a cell against the command
    % window would fail for every one of those and prove nothing about the model.
    % Both are MATLAB's own output; only mat2str is the one the cell claims to match.
    x = elemSubject(v, k);
    e = struct();
    e.name = subLabel(name, size(v), k, iscell(v));
    e.class = class(x);
    e.size = size(x);
    e.numel = numel(x);
    e.iscomplex = ~isreal(x);
    e.islogical = islogical(x);
    e.isobject = isobject(x);
    e.isempty = isempty(x);
    e.disp = strtrim(formattedDisplayText(x, 'SuppressMarkup', true));
    try
        e.mat2str = mat2str(x);
    catch err
        e.mat2str_error = err.message;
    end
end

function txt = elemText(v, k)
    % SuppressMarkup everywhere, for the reason given at t.disp.
    try
        if iscell(v)
            txt = strtrim(formattedDisplayText(v{k}, 'SuppressMarkup', true));
        elseif isstring(v)
            % isobject(string) is true, so the object branch below would ask a
            % string array for a 'Value' property; take the element directly.
            txt = strtrim(formattedDisplayText(v(k), 'SuppressMarkup', true));
        elseif isobject(v) && isprop(v(k), 'Value')
            txt = strtrim(formattedDisplayText(v(k).Value, 'SuppressMarkup', true));
        elseif isstruct(v)
            f = fieldnames(v);
            txt = strtrim(formattedDisplayText(v(k).(f{1}), 'SuppressMarkup', true));
        else
            txt = strtrim(formattedDisplayText(v(k), 'SuppressMarkup', true));
        end
    catch e
        txt = ['<error: ' e.message '>'];
    end
end

function p = propTruth(v)
    p = struct();
    names = properties(v);
    for i = 1:numel(names)
        n = names{i};
        try
            val = v.(n);
            p.(n) = struct('class', class(val), 'size', size(val), ...
                           'numel', numel(val), 'isempty', isempty(val), ...
                           'disp', strtrim(formattedDisplayText(val, 'SuppressMarkup', true)));
            % A property's literal matters as much as an entry's — without it
            % expect.ts has nothing to compare and would summarize every
            % property, including a char like BaseType='int32'.
            try
                p.(n).mat2str = mat2str(val);
            catch e2
                p.(n).mat2str_error = e2.message;
            end
        catch e
            p.(n) = struct('error', e.message);
        end
    end
end

function writeJson(path, data)
    fid = fopen(path, 'w');
    fprintf(fid, '%s', jsonencode(data, 'PrettyPrint', true));
    fclose(fid);
end
