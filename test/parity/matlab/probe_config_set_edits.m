% Copyright 2026 The MathWorks, Inc.
%
% Does MATLAB open a model whose configuration sets the session edited as it opens its own save of
% the same edits? The gate of ConfigSetsWriter, in every layout.
%
%   1. Copies the models of test/fixtures/active-config (gen_active_config.m), and acs_dict.sldd,
%      to which it adds a second set, dictCfg2 (StopTime 3), for a reference to be pointed at.
%   2. Runs probe_config_set_edits.mjs, which makes each edit through the session and saves it.
%   3. For each case, MATLAB makes the same edit itself (the same edits, by its own API) and saves
%      it in the case's layout; then opens both, with the sets references point to found where
%      MATLAB looks for them (the dictionary on the path; in R2013b's layout, which keeps no
%      dictionary, base workspace variables), and holds the session's save to MATLAB's:
%        - it opens printing and warning what MATLAB's save does, its name and links left out;
%        - its sets are MATLAB's: the same names in the same order, each of the same class, with
%          the same Description and, for a reference, the same SourceName, the same one active;
%        - it opens unchanged (Dirty off), and simulates as MATLAB's save does;
%        - each set it keeps has every parameter it had as the model was read (no edit here changes
%          one), and a set the edit adds every parameter of a fresh Simulink.ConfigSet in the MATLAB
%          opening it: the session writes an added set as its Name and Version alone, which MATLAB
%          opens as a fresh set of its own release, where MATLAB's export of its own writes the
%          export release's defaults into it. Held to the model as read, not to MATLAB's save:
%          MATLAB's export of an added set to R2018a's and R2013b's layouts writes every set anew,
%          and the sets it keeps lose their fixed-step solver (FixedStep gone, AbsTol, RelTol and
%          the other variable-step settings back). Where MATLAB's save of a kept set differs from
%          the model as read, a `NOTE` line says so, and the case is not failed for it.
%          In R2013b's layout the coverage settings are the model's, one copy of them (its
%          Verification block), which a MATLAB of a later release gives the active set as it opens
%          the model, and writes from the active set as it saves: a set the session makes active
%          there has the coverage settings the model was read with (R2023b shows it; R2027a gives
%          every set the same ones), where MATLAB's save gives it the set's own.
%
% Run, after `npm run build`:
%   env PROBE_OUT=/tmp/cse PROBE_NODE=$(node -p process.execPath) mw -using Bmain matlab \
%       -nodesktop -batch "run('$PWD/test/parity/matlab/probe_config_set_edits.m')"
% and on R2023b, which opens no model of a later layout, nor acs_ref's dictionary, which R2027a
% wrote ("not a valid Simulink data dictionary"):
%   env PROBE_OUT=/tmp/cse PROBE_NODE=$(node -p process.execPath) \
%       PROBE_ONLY='^acs_sets_R20(21a|18a|13b)$|^acs_ref_R2013b$' \
%       mw -using BR2023bd matlab -nodesktop -batch "run('$PWD/test/parity/matlab/probe_config_set_edits.m')"
% Prints `RESULT <id> PASS` or `RESULT <id> FAIL <why>` per case (after its `NOTE` lines), then
% `PROBE_CONFIG_SET_EDITS DONE pass=N fail=M`; fail=0 is the only acceptable result.
here = fileparts(mfilename('fullpath'));
root = getenv('PROBE_OUT');
if isempty(root) || root(1) ~= '/', error('PROBE_OUT must be an absolute path.'); end
outdir = fullfile(root, char(datetime('now', 'Format', 'yyyyMMdd_HHmmss')));
gen = fullfile(outdir, 'gen'); dictdir = fullfile(outdir, 'dict');
mkdir(gen); mkdir(dictdir);
fprintf('VERSION %s\nOUT %s\n', version, outdir);
warning('off', 'backtrace');
bdclose('all'); Simulink.data.dictionary.closeAll('-discard');
fixtures = fullfile(here, '..', '..', 'fixtures', 'active-config');
copyfile(fullfile(fixtures, '*.slx'), gen);
copyfile(fullfile(fixtures, 'acs_dict.sldd'), dictdir);
only = getenv('PROBE_ONLY');
keep = @(mdl) isempty(only) || ~isempty(regexp(mdl, only, 'once'));
solver = {'SolverType', 'Fixed-step', 'Solver', 'FixedStepDiscrete', 'FixedStep', '1', 'SaveTime', 'on', 'ReturnWorkspaceOutputs', 'on'};
sets = struct('dictCfg', 7, 'dictCfg2', 3);
try
    dd = Simulink.data.dictionary.open(fullfile(dictdir, 'acs_dict.sldd'));
    c = Simulink.ConfigSet; set_param(c, solver{:}, 'Name', 'dictCfg2', 'StopTime', '3');
    addEntry(getSection(dd, 'Configurations'), 'dictCfg2', c);
    saveChanges(dd); dd.close();
catch err
    fprintf('NO DICTCFG2 %s\n', err.message);  % an older release, which does not read the dictionary
end
Simulink.data.dictionary.closeAll('-discard');
old = cd(outdir);
restore = onCleanup(@() cd(old));
description = sprintf('Quick <runs> & "more" ''s''\nsecond line');
edits = struct( ...
    'rename', @(m) set_param(getConfigSet(m, 'Fast'), 'Name', 'Fast run-2'), ...
    'describe', @(m) set_param(getConfigSet(m, 'Fast'), 'Description', description), ...
    'add', @(m) attachConfigSet(m, named(Simulink.ConfigSet, 'Configuration1')), ...
    'delete', @(m) detachConfigSet(m, 'Slow'), ...
    'combo', @combo, ...
    'addref', @(m) attachConfigSet(m, refTo('Reference', 'dictCfg')), ...
    'source', @(m) setSource(getConfigSet(m, 'RefFromDict'), 'dictCfg2'));
added = struct('add', {{'Configuration1'}}, 'combo', {{'Newest'}});
renamed = struct('rename', {{'Fast run-2', 'Fast'}});  % a kept set's name after the edit, then as read

node = getenv('PROBE_NODE');
if isempty(node), node = 'node'; end
[status, printed] = system(sprintf('"%s" "%s" "%s"', node, fullfile(here, 'probe_config_set_edits.mjs'), outdir));
fprintf('%s', printed);
if status ~= 0, error('The Node half failed.'); end

manifest = jsondecode(fileread(fullfile(outdir, 'manifest.json')));
if isstruct(manifest), manifest = num2cell(manifest); end
manifest = manifest(cellfun(@(c) keep(c.model), manifest));
fresh = paramsOf(Simulink.ConfigSet);
pass = 0; fail = 0;
for k = 1:numel(manifest)
    c = manifest{k};
    era = regexp(c.model, 'R\d{4}[ab]$', 'match', 'once');
    why = {};
    try
        if ~isempty(c.js), error('Node: %s', c.js); end
        found(dictdir, era, sets, solver);
        read = opened(fullfile(gen, c.file), c.model);
        % MATLAB's own save of the same edit, in the case's layout.
        bdclose('all'); Simulink.data.dictionary.closeAll('-discard');
        found(dictdir, era, sets, solver);
        evalc('load_system(fullfile(gen, c.file))');
        edits.(c.edit)(c.model);
        theirs = fullfile(outdir, 'native', c.id, c.file);
        mkdir(fileparts(theirs));
        if isempty(era), evalc('save_system(c.model, theirs)'); else, evalc('save_system(c.model, theirs, ''ExportToVersion'', era)'); end
        bdclose('all'); Simulink.data.dictionary.closeAll('-discard');
        found(dictdir, era, sets, solver);
        mine = opened(fullfile(outdir, 'cases', c.id, c.file), c.model);
        bdclose('all'); Simulink.data.dictionary.closeAll('-discard');
        found(dictdir, era, sets, solver);
        matlab = opened(theirs, c.model);
        if ~strcmp(mine.msg, matlab.msg), why{end+1} = sprintf('opens with [%s], where MATLAB''s save opens with [%s]', mine.msg, matlab.msg); end
        if ~isequal(mine.sets, matlab.sets), why{end+1} = sprintf('its sets are [%s], where MATLAB''s are [%s]', mine.sets, matlab.sets); end
        if ~strcmp(mine.dirty, 'off'), why{end+1} = 'it opens changed (Dirty)'; end
        if ~strcmp(mine.sim, matlab.sim), why{end+1} = sprintf('it simulates to [%s], where MATLAB''s save does to [%s]', mine.sim, matlab.sim); end
        new = {};
        if isfield(added, c.edit), new = added.(c.edit); end
        for j = 1:numel(mine.params)
            name = mine.params{j}.name;
            if any(strcmp(name, new))
                want = fresh;
            else
                was = name;
                if isfield(renamed, c.edit) && strcmp(name, renamed.(c.edit){1}), was = renamed.(c.edit){2}; end
                want = paramsNamed(read.params, was);
                d = differing(paramsNamed(matlab.params, name), want);
                if ~isempty(d), fprintf('NOTE %s MATLAB''s save changes %d parameters of "%s" (%s)\n', c.id, numel(d), name, strjoin(d(1:min(5, end)), ', ')); end
            end
            if strcmp(era, 'R2013b') && strcmp(name, mine.active) && ~strcmp(name, read.active)
                want = withCoverage(want, paramsNamed(read.params, read.active));
            end
            d = differing(mine.params{j}.params, want);
            if ~isempty(d), why{end+1} = sprintf('"%s" differs in %d parameters (%s)', name, numel(d), strjoin(d(1:min(5, end)), ', ')); end %#ok<AGROW>
        end
    catch err
        why{end+1} = err.message;
    end
    bdclose('all'); Simulink.data.dictionary.closeAll('-discard');
    if isempty(why)
        pass = pass + 1;
        fprintf('RESULT %s PASS\n', c.id);
    else
        fail = fail + 1;
        fprintf('RESULT %s FAIL %s\n', c.id, strjoin(why, '; '));
    end
end
evalin('base', 'clear dictCfg dictCfg2');
fprintf('PROBE_CONFIG_SET_EDITS DONE pass=%d fail=%d\n', pass, fail);

function combo(m)
    attachConfigSet(m, named(Simulink.ConfigSet, 'Newest'));
    setActiveConfigSet(m, 'Newest');
    detachConfigSet(m, 'Configuration');
    set_param(getConfigSet(m, 'Fast'), 'Description', 'Quick runs');
end

function cs = named(cs, name)
    set_param(cs, 'Name', name);
end

function r = refTo(name, source)
    r = Simulink.ConfigSetRef;
    r.Name = name;
    r.SourceName = source;
end

function setSource(r, source)
    r.SourceName = source;
end

% The sets references point to, where MATLAB looks: the dictionary on the path, and in R2013b's
% layout, which keeps no dictionary, base workspace variables of the same sets, made anew.
function found(dictdir, era, sets, solver)
    evalin('base', 'clear dictCfg dictCfg2');
    addpath(dictdir);
    if ~strcmp(era, 'R2013b'), return; end
    for n = fieldnames(sets)'
        c = Simulink.ConfigSet;
        set_param(c, solver{:}, 'Name', n{1}, 'StopTime', num2str(sets.(n{1})));
        assignin('base', n{1}, c);
    end
end

% What the model at `file` says as it opens, its name and links left out, and what it is then.
function info = opened(file, mdl)
    lastwarn('');
    printed = strtrim(evalc('load_system(file)'));
    [w, wid] = lastwarn;
    said = @(t) regexprep(regexprep(regexprep(regexprep(strrep(t, char(8), ''), '\[> In [^\]]*\]', ''), '<a [^>]*"[^"]*"[^>]*>|<a [^>]*>|</a>', ''), ['\<' mdl '\>'], '<model>'), '\s+', ' ');
    info.msg = '';
    if ~isempty(w), info.msg = ['a warning: ' wid ': ' said(w)]; end
    if ~isempty(printed), info.msg = strtrim([info.msg ' and prints: ' said(printed)]); end
    names = getConfigSets(mdl);
    active = get_param(getActiveConfigSet(mdl), 'Name');
    parts = cell(1, numel(names));
    info.params = {};
    for j = 1:numel(names)
        s = getConfigSet(mdl, names{j});
        if isa(s, 'Simulink.ConfigSetRef')
            parts{j} = sprintf('%s:%s:%s:%s:%d', names{j}, class(s), s.Description, s.SourceName, strcmp(names{j}, active));
        else
            parts{j} = sprintf('%s:%s:%s::%d', names{j}, class(s), get_param(s, 'Description'), strcmp(names{j}, active));
            info.params{end+1} = struct('name', names{j}, 'params', paramsOf(s));
        end
    end
    info.sets = strjoin(parts, ' | ');
    info.active = active;
    info.dirty = get_param(mdl, 'Dirty');
    try
        out = sim(mdl);
        info.sim = num2str(out.tout(end));
    catch err
        info.sim = [err.identifier ': ' said(err.message)];
    end
end

function p = paramsOf(s)
    p = struct();
    names = fieldnames(get_param(s, 'ObjectParameters'));
    for k = 1:numel(names)
        try, v = get_param(s, names{k}); catch, continue; end
        if ischar(v) || isstring(v), p.(names{k}) = char(v); elseif isnumeric(v) || islogical(v), p.(names{k}) = mat2str(v); else, p.(names{k}) = ['<' class(v) '>']; end
    end
end

% `p` with the coverage settings of `model`: what R2013b's layout keeps of them, the model's.
function p = withCoverage(p, model)
    for n = fieldnames(model)'
        if ~isempty(regexp(n{1}, '^(Cov|RecordCoverage)', 'once')), p.(n{1}) = model.(n{1}); end
    end
end

function p = paramsNamed(list, name)
    p = struct();
    for j = 1:numel(list)
        if strcmp(list{j}.name, name), p = list{j}.params; return; end
    end
end

% The parameters `a` and `b` give different values, Name and Description aside (compared above).
function d = differing(a, b)
    keys = setdiff(union(fieldnames(a), fieldnames(b)), {'Name', 'Description'});
    d = {};
    for k = 1:numel(keys)
        x = ''; y = '';
        if isfield(a, keys{k}), x = a.(keys{k}); end
        if isfield(b, keys{k}), y = b.(keys{k}); end
        if ~isequal(x, y), d{end+1} = keys{k}; end %#ok<AGROW>
    end
end
