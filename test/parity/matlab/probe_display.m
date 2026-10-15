% probe_display.m -- what MATLAB's Workspace browser shows, Value, Size and Class, for the
% 283 values probe_display_catalog.m names, and the three data files holding them.
%
% Run (one line: mw splits -batch on newlines):
%   mw -using Bmain matlab -nodesktop -batch "run('<repo>/test/parity/matlab/probe_display.m')"
% Writes under $DISPLAY_OUT, or tempdir/dexdisp: truth/*.json and files/{catalog.mat,
% dispcat_text.sldd,dispcat_bin.sldd}. test/fixtures/display/trim-display-fixtures.mjs cuts
% that output down to the fixtures and truth rows the display tests read.
%
% As run on 2026-10-15 (R2027a Prerelease 27.1.0.3400455) to produce those fixtures, but for
% where it reads and writes: it was /tmp/dexdisp/harness.m beside catalog.m and the two class
% files, and wrote into /tmp/dexdisp. The class files are test/fixtures/display/DispLevel.m
% and DispWidget.m now, and catalog() is probe_display_catalog().
% Run ONLY via run() from -batch, so it executes in base.
% Everything lives in a local function so the base workspace holds catalog values only.
harness_main();

function harness_main()
root     = displayRoot();
here     = fileparts(mfilename('fullpath'));
truthDir = fullfile(root, 'truth');
filesDir = fullfile(root, 'files');
addpath(here);
addpath(fullfile(here, '..', '..', 'fixtures', 'display'));
if ~exist(truthDir, 'dir'), mkdir(truthDir); end
if ~exist(filesDir, 'dir'), mkdir(filesDir); end
lg = fopen(fullfile(truthDir, 'harness.log'), 'w', 'n', 'UTF-8');
cl = onCleanup(@() fclose(lg));
warning('off', 'backtrace');
import internal.matlab.datatoolsservices.FormatDataUtils;
t0 = tic;
logf(lg, 'START %s  version=%s', char(datetime('now')), version);

% ------------------------------------------------------------- 0. environment
envErrs = {};
try
    Simulink.defineIntEnumType('DispColor', {'Red', 'Green', 'Blue'}, [1 2 3]);
catch err
    envErrs{end+1} = errRec('DispColor', 'defineIntEnumType', err);
end
evalin('base', 'clear');
userFormat = FormatDataUtils.getCurrentNumericFormat();
logf(lg, 'user NumericFormat setting = %s', char(userFormat));

% ------------------------------------------------------------- 1. build the catalog
E = probe_display_catalog();
n = size(E, 1);
logf(lg, 'catalog entries: %d', n);
V = struct();
ok = false(n, 1);
createErrs = {};
for k = 1:n
    name = E{k, 1};
    try
        V.(name) = E{k, 2}();
        ok(k) = true;
    catch err
        createErrs{end+1} = errRec(name, 'create', err); %#ok<AGROW>
        logf(lg, 'CREATE FAIL %s: %s', name, err.message);
    end
end
names  = E(ok, 1);
groups = E(ok, 3);
logf(lg, 'created %d of %d', numel(names), n);
for k = 1:numel(names)
    assignin('base', names{k}, V.(names{k}));
end

% ------------------------------------------------------------- 2. getWorkspaceDisplay
runs = { 'workspace_short.json',  '';       ...   % default NumericFormat (the user setting)
         'workspace_long.json',   'long';   ...
         'workspace_shortG.json', 'shortG'; ...
         'workspace_longG.json',  'longG' };
wsErrs = {};
for r = 1:size(runs, 1)
    fmt = runs{r, 2};
    try
        if isempty(fmt)
            s = matlab.internal.datatoolsservices.getWorkspaceDisplay('base', 'name', 'size', 'class', 'value');
        else
            s = matlab.internal.datatoolsservices.getWorkspaceDisplay('base', 'name', 'size', 'class', 'value', NumericFormat = fmt);
        end
        how = 'base';
    catch err
        wsErrs{end+1} = errRec(runs{r, 1}, 'getWorkspaceDisplay(base)', err); %#ok<AGROW>
        logf(lg, 'BASE CALL FAIL %s: %s -- falling back per variable', runs{r, 1}, err.message);
        s = perVariable(V, names, fmt, lg);
        how = 'per-variable';
    end
    writeJson(fullfile(truthDir, runs{r, 1}), s);
    logf(lg, 'wrote %s (%d rows, %s) t=%.1fs', runs{r, 1}, numel(s), how, toc(t0));
end

% ------------------------------------------------------------- 3. meta
M = cell(numel(names), 1);
for k = 1:numel(names)
    M{k} = metaOf(names{k}, groups{k}, V.(names{k}));
end
meta = struct();
meta.version          = version;
meta.release          = version('-release');
meta.matlabroot       = matlabroot;
meta.date             = char(datetime('now', 'Format', 'yyyy-MM-dd HH:mm:ss'));
meta.userNumericFormat = char(userFormat);
meta.formats          = struct('file', runs(:, 1)', 'numericFormat', runs(:, 2)');
meta.timesSymbol      = FormatDataUtils.TIMES_SYMBOL;
meta.maxDisplayElements = FormatDataUtils.MAX_DISPLAY_ELEMENTS;
meta.maxTextDisplayLength = FormatDataUtils.MAX_TEXT_DISPLAY_LENGTH;
meta.catalogCount     = n;
meta.createdCount     = numel(names);
meta.createErrors     = createErrs;
meta.envErrors        = envErrs;
meta.workspaceDisplayErrors = wsErrs;
meta.entries          = M;
writeJson(fullfile(truthDir, 'meta.json'), meta);
logf(lg, 'wrote meta.json t=%.1fs', toc(t0));

% ------------------------------------------------------------- 4. browser columns (ClassCol/SizeCol/ValueCol/ObjectValueSummary)
bruns = { 'browser_short.json', char(userFormat); 'browser_long.json', 'long' };
for r = 1:size(bruns, 1)
    B = cell(numel(names), 1);
    for k = 1:numel(names)
        B{k} = browserRow(names{k}, V.(names{k}), bruns{r, 2});
    end
    writeJson(fullfile(truthDir, bruns{r, 1}), B);
    logf(lg, 'wrote %s t=%.1fs', bruns{r, 1}, toc(t0));
end

% ------------------------------------------------------------- 5. data files
F = struct();
F.mat = doMat(fullfile(filesDir, 'catalog.mat'), V, names, lg);
writeJson(fullfile(truthDir, 'files.json'), F);
logf(lg, 'mat done t=%.1fs', toc(t0));
F.sldd_text = doSldd(fullfile(filesDir, 'dispcat_text.sldd'), '', V, names, lg);
writeJson(fullfile(truthDir, 'files.json'), F);
logf(lg, 'text sldd done t=%.1fs', toc(t0));
F.sldd_bin = doSldd(fullfile(filesDir, 'dispcat_bin.sldd'), 'compressed-binary', V, names, lg);
writeJson(fullfile(truthDir, 'files.json'), F);
logf(lg, 'binary sldd done t=%.1fs', toc(t0));

% ------------------------------------------------------------- 6. cross-check: the real data model's ObjectValueSummary split
X = struct('ok', false, 'error', '', 'rows', {{}});
try
    dm = internal.matlab.desktop_workspacebrowser.MLWorkspaceDataModel('base');
    d  = dm.updateData();
    fs = fieldnames(d);
    rows = cell(numel(fs), 1);
    for k = 1:numel(fs)
        x = d.(fs{k});
        rr = struct('name', fs{k}, 'storedClass', class(x), 'isObjectValueSummary', ...
            isa(x, 'internal.matlab.workspace.ObjectValueSummary'), ...
            'DisplayClass', '', 'DisplaySize', '', 'DisplayValue', '');
        if rr.isObjectValueSummary
            rr.DisplayClass = toStr(x.DisplayClass);
            rr.DisplaySize  = toStr(x.DisplaySize);
            rr.DisplayValue = toStr(x.DisplayValue);
        end
        rows{k} = rr;
    end
    X.ok = true;
    X.rows = rows;
catch err
    X.error = sprintf('%s | %s', err.identifier, err.message);
    logf(lg, 'DATA MODEL FAIL: %s', X.error);
end
writeJson(fullfile(truthDir, 'datamodel_crosscheck.json'), X);
logf(lg, 'DONE t=%.1fs', toc(t0));
end

% =============================================================== helpers
function s = perVariable(V, names, fmt, lg)
s = struct('Name', {}, 'Size', {}, 'Class', {}, 'Value', {}, 'IsSummary', {});
for k = 1:numel(names)
    try
        if isempty(fmt)
            r = matlab.internal.datatoolsservices.getWorkspaceDisplay({V.(names{k})}, 'name', 'size', 'class', 'value');
        else
            r = matlab.internal.datatoolsservices.getWorkspaceDisplay({V.(names{k})}, 'name', 'size', 'class', 'value', NumericFormat = fmt);
        end
        r.Name = string(names{k});
        s(end+1) = r; %#ok<AGROW>
    catch err
        logf(lg, 'DISPLAY FAIL %s: %s', names{k}, err.message);
        s(end+1) = struct('Name', string(names{k}), 'Size', "", 'Class', "", ...
            'Value', "ERROR: " + err.message, 'IsSummary', false); %#ok<AGROW>
    end
end
end

function b = isObjOrContainerVar(x)
% Copied from MLWorkspaceDataModel.m:745 (a file-local function there, so not callable).
try
    b = (isobject(x) || isstruct(x) || iscell(x)) && ~islogical(x) && ~isstring(x);
catch
    b = true;
end
end

function r = browserRow(name, v, fmt)
import internal.matlab.datatoolsservices.FormatDataUtils;
r = struct('Name', name, 'Path', '', 'Size', '', 'Class', '', 'Value', '', 'IsSummary', false, 'Error', '');
try
    [~, ~, m] = FormatDataUtils.formatDataBlockForMixedView(1, 1, 1, 1, {v}, fmt);
    r.IsSummary = m;
    if isObjOrContainerVar(v)
        r.Path  = 'ObjectValueSummary';
        vs      = internal.matlab.desktop_workspacebrowser.MLWorkspaceDataModel.getObjectValueSummary(v, fmt);
        r.Class = toStr(vs.DisplayClass);
        r.Size  = toStr(vs.DisplaySize);
        r.Value = toStr(vs.DisplayValue);
    else
        r.Path  = 'FieldColumns';
        r.Class = toStr(internal.matlab.variableeditor.FieldColumns.ClassCol.getClass(v, name, false, []));
        r.Size  = toStr(internal.matlab.variableeditor.FieldColumns.SizeCol.getSize(v, name, false, []));
        [val, isMeta] = internal.matlab.variableeditor.FieldColumns.ValueCol.getValue(v, name, false, [], fmt);
        r.Value = toStr(val);
        r.IsSummary = isMeta;
    end
catch err
    r.Error = sprintf('%s | %s', err.identifier, err.message);
end
end

function t = toStr(x)
try
    if iscell(x), x = x{1}; end
    t = char(string(x));
catch
    t = sprintf('<%s>', class(x));
end
end

function m = metaOf(name, group, v)
m = struct();
m.name = name;
m.group = group;
m.class = class(v);
m.size = size(v);
m.numel = tryv(@() numel(v), []);
m.ndims = ndims(v);
m.isreal = tryv(@() isreal(v), []);
m.issparse = tryv(@() issparse(v), []);
m.isobject = isobject(v);
m.isenum = tryv(@() isenum(v), []);
m.isnumeric = isnumeric(v);
m.islogical = islogical(v);
m.underlyingType = tryv(@() underlyingType(v), '');
m.mat2str = tryv(@() capped(mat2str(v)), []);
m.mat2str17 = tryv(@() capped(mat2str(v, 17)), []);
m.hex = [];
if (isa(v, 'double') || isa(v, 'single')) && isscalar(v) && isreal(v) && ~issparse(v)
    m.hex = num2hex(v);
end
m.disp = tryv(@() capped(char(formattedDisplayText(v))), []);
m.paramValue = [];
if isa(v, 'Simulink.Parameter') && isscalar(v)
    pv = v.Value;
    m.paramValue = struct('class', class(pv), 'size', size(pv), ...
        'isreal', tryv(@() isreal(pv), []), 'mat2str', tryv(@() capped(mat2str(pv)), []));
end
end

function s = capped(s)
if numel(s) > 4000
    s = [s(1:4000) sprintf('...<%d chars>', numel(s))];
end
end

function out = tryv(f, dflt)
try
    out = f();
catch
    out = dflt;
end
end

function R = doMat(path, V, names, lg)
R = struct('path', path, 'saveFlag', '-v7', 'accepted', {{}}, 'refused', {{}}, 'roundtrip', {{}}, 'error', '');
tmp = [tempname '.mat'];
acc = {};
for k = 1:numel(names)
    n = names{k};
    S1 = struct();
    S1.(n) = V.(n); %#ok<STRNU>  (struct(n, v) would make a struct ARRAY of a cell v)
    lastwarn('');
    try
        save(tmp, '-struct', 'S1', '-v7');
        [wm, wid] = lastwarn;
        if isempty(wm)
            acc{end+1} = n; %#ok<AGROW>
        else
            R.refused{end+1} = struct('name', n, 'kind', 'warning', 'id', wid, 'message', wm);
        end
    catch err
        R.refused{end+1} = struct('name', n, 'kind', 'error', 'id', err.identifier, 'message', err.message);
    end
end
if exist(tmp, 'file'), delete(tmp); end
R.accepted = acc;
try
    SA = struct();
    for k = 1:numel(acc), SA.(acc{k}) = V.(acc{k}); end %#ok<STRNU>
    if exist(path, 'file'), delete(path); end
    save(path, '-struct', 'SA', '-v7');
    L = load(path);
    for k = 1:numel(acc)
        n = acc{k};
        if isfield(L, n)
            R.roundtrip{end+1} = rtRec(n, V.(n), L.(n));
        else
            R.roundtrip{end+1} = struct('name', n, 'equal', false, 'classAfter', '<missing after load>');
        end
    end
catch err
    R.error = sprintf('%s | %s', err.identifier, err.message);
    logf(lg, 'MAT FAIL: %s', R.error);
end
end

function R = doSldd(path, fileFormat, V, names, lg)
R = struct('path', path, 'requestedFileFormat', fileFormat, 'FileFormat', '', 'magic', '', ...
    'accepted', {{}}, 'refused', {{}}, 'saveRefused', {{}}, 'roundtrip', {{}}, 'warnings', {{}}, 'error', '', ...
    'probe', {{}});
% Per-entry probe: each value alone in a scratch dictionary of the same format, so a save
% error or a save-time warning (which names no entry) is attributed to exactly one value.
P = cell(numel(names), 1);
saveable = true(numel(names), 1);
for k = 1:numel(names)
    P{k} = probeOne(names{k}, V.(names{k}), fileFormat);
    saveable(k) = isempty(P{k}.addError) && isempty(P{k}.saveError);
end
R.probe = P;
logf(lg, 'probe %s: %d of %d saveable alone', path, nnz(saveable), numel(names));
names = names(saveable);
try
    Simulink.data.dictionary.closeAll('-discard');
    if exist(path, 'file'), delete(path); end
    dd = Simulink.data.dictionary.create(path);
    if ~isempty(fileFormat), dd.FileFormat = fileFormat; end
    R.FileFormat = toStr(dd.FileFormat);
    secD = getSection(dd, 'Design Data');
    secO = getSection(dd, 'Other Data');
    for k = 1:numel(names)
        n = names{k};
        v = V.(n);
        lastwarn('');
        try
            addEntry(secD, n, v);
            R.accepted{end+1} = struct('name', n, 'section', 'Design Data');
        catch err1
            try
                addEntry(secO, n, v);
                R.accepted{end+1} = struct('name', n, 'section', 'Other Data', 'designDataError', err1.message);
            catch err2
                R.refused{end+1} = struct('name', n, 'designDataId', err1.identifier, 'designDataError', err1.message, ...
                    'otherDataId', err2.identifier, 'otherDataError', err2.message);
            end
        end
        [wm, wid] = lastwarn;
        if ~isempty(wm), R.warnings{end+1} = struct('name', n, 'id', wid, 'message', wm); end
    end
    lastwarn('');
    try
        saveChanges(dd);
        [wm, wid] = lastwarn;
        if ~isempty(wm), R.warnings{end+1} = struct('name', '<bulk save>', 'id', wid, 'message', wm); end
    catch errSave
        logf(lg, 'SLDD bulk save failed (%s): %s -- saving entry by entry', path, errSave.message);
        R.bulkSaveError = causeText(errSave);
        R = slddOneByOne(R, path, fileFormat, V, lg);
    end
    close(dd);
    Simulink.data.dictionary.closeAll('-discard');
    fid = fopen(path, 'r');
    b = fread(fid, 8, '*uint8')';
    fclose(fid);
    R.magic = sprintf('%02X', b);
    % read back
    dd = Simulink.data.dictionary.open(path);
    for k = 1:numel(R.accepted)
        a = R.accepted{k};
        try
            sec = getSection(dd, a.section);
            rv = getValue(getEntry(sec, a.name));
            R.roundtrip{end+1} = rtRec(a.name, V.(a.name), rv);
        catch err
            R.roundtrip{end+1} = struct('name', a.name, 'equal', false, 'classAfter', ['<read error: ' err.message '>']);
        end
    end
    close(dd);
    Simulink.data.dictionary.closeAll('-discard');
catch err
    R.error = sprintf('%s | %s', err.identifier, err.message);
    logf(lg, 'SLDD FAIL %s: %s', path, R.error);
    try, Simulink.data.dictionary.closeAll('-discard'); catch, end
end
end

function p = probeOne(n, v, fileFormat)
scratch = fullfile(displayRoot(), 'scratch');
if ~exist(scratch, 'dir'), mkdir(scratch); end
path = fullfile(scratch, 'dispprobe.sldd');
p = struct('name', n, 'section', '', 'designDataError', '', 'addError', '', 'saveWarning', '', ...
    'saveWarningId', '', 'saveError', '', 'saveErrorReport', '', 'readError', '', 'equal', [], ...
    'classAfter', '', 'sizeAfter', [], 'isrealAfter', [], 'bytes', []);
try
    Simulink.data.dictionary.closeAll('-discard');
    if exist(path, 'file'), delete(path); end
    dd = Simulink.data.dictionary.create(path);
    if ~isempty(fileFormat), dd.FileFormat = fileFormat; end
    try
        addEntry(getSection(dd, 'Design Data'), n, v);
        p.section = 'Design Data';
    catch err1
        p.designDataError = err1.message;
        try
            addEntry(getSection(dd, 'Other Data'), n, v);
            p.section = 'Other Data';
        catch err2
            p.addError = err2.message;
        end
    end
    if isempty(p.addError)
        lastwarn('');
        try
            saveChanges(dd);
        catch errS
            p.saveError = errS.message;
            p.saveErrorReport = causeText(errS);
        end
        [wm, wid] = lastwarn;
        p.saveWarning = wm;
        p.saveWarningId = wid;
    end
    close(dd);
    Simulink.data.dictionary.closeAll('-discard');
    if isempty(p.addError) && isempty(p.saveError)
        d = dir(path);
        p.bytes = d.bytes;
        try
            dd = Simulink.data.dictionary.open(path);
            rv = getValue(getEntry(getSection(dd, p.section), n));
            p.equal = tryv(@() isequaln(rv, v), []);
            p.classAfter = class(rv);
            p.sizeAfter = size(rv);
            p.isrealAfter = tryv(@() isreal(rv), []);
            close(dd);
        catch errR
            p.readError = errR.message;
        end
        Simulink.data.dictionary.closeAll('-discard');
    end
catch err
    p.addError = ['probe failed: ' err.message];
    try, Simulink.data.dictionary.closeAll('-discard'); catch, end
end
end

function t = causeText(err)
t = err.message;
for c = 1:numel(err.cause)
    t = [t ' || ' causeText(err.cause{c})]; %#ok<AGROW>
end
end

function r = rtRec(n, before, after)
r = struct('name', n, 'equal', tryv(@() isequaln(after, before), []), ...
    'classBefore', class(before), 'classAfter', class(after), ...
    'sizeBefore', size(before), 'sizeAfter', size(after), ...
    'isrealBefore', tryv(@() isreal(before), []), 'isrealAfter', tryv(@() isreal(after), []));
end

function R = slddOneByOne(R, path, fileFormat, V, lg)
Simulink.data.dictionary.closeAll('-discard');
if exist(path, 'file'), delete(path); end
dd = Simulink.data.dictionary.create(path);
if ~isempty(fileFormat), dd.FileFormat = fileFormat; end
keep = {};
for k = 1:numel(R.accepted)
    a = R.accepted{k};
    sec = getSection(dd, a.section);
    addEntry(sec, a.name, V.(a.name));
    try
        saveChanges(dd);
        keep{end+1} = a; %#ok<AGROW>
    catch err
        logf(lg, 'SLDD save refused %s: %s', a.name, err.message);
        R.saveRefused{end+1} = struct('name', a.name, 'id', err.identifier, 'message', causeText(err));
        try, deleteEntry(sec, a.name); saveChanges(dd); catch, end
    end
end
R.accepted = keep;
close(dd);
end

function writeJson(path, x)
txt = jsonencode(x, 'PrettyPrint', true);
fid = fopen(path, 'w', 'n', 'UTF-8');
fprintf(fid, '%s', txt);
fclose(fid);
end

function r = errRec(name, stage, err)
r = struct('name', name, 'stage', stage, 'id', err.identifier, 'message', err.message);
end

function logf(fid, fmt, varargin)
fprintf(fid, [fmt '\n'], varargin{:});
fprintf(1, [fmt '\n'], varargin{:});
end

function root = displayRoot()
% Where the probe writes: $DISPLAY_OUT, or tempdir/dexdisp.
root = getenv('DISPLAY_OUT');
if isempty(root), root = fullfile(tempdir, 'dexdisp'); end
end
