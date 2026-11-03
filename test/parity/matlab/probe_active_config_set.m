% Copyright 2026 The MathWorks, Inc.
%
% Does MATLAB open a model whose active configuration set the session changed as it opens its own
% save of the same change? The session's save moves the one mark the package keeps of which set is
% active, and nothing else. Measured in every layout.
%
%   1. Copies the models of test/fixtures/active-config (gen_active_config.m): acs_sets, with
%      three sets of StopTime 10 (Configuration, active), 2 (Fast) and 5 (Slow), and acs_ref,
%      with Configuration (10, active) and RefFromDict, a Simulink.ConfigSetRef to dictCfg (7)
%      in acs_dict.sldd; each in R2027a and exported to R2025a, R2021a, R2018a and R2013b.
%   2. Runs probe_active_config_set.mjs, which writes a copy of each model per set that is not
%      active, made active through the session and saved (setActiveConfigSet, serializeSource: see
%      there), and one copy with no change (`none`); or, where the session refuses the change, its
%      reason.
%   3. For each copy, MATLAB makes the same change itself: opens the model, setActiveConfigSet,
%      and saves it in the copy's layout (save_system, with ExportToVersion for an older one).
%      Then opens both, with acs_dict.sldd on the path and, for acs_ref, without it too, and
%      holds the copy to MATLAB's save:
%        - it opens printing and warning what MATLAB's save does, its name and links left out;
%        - the set it makes active is active, its sets are in their order, and it opens unchanged
%          (Dirty off);
%        - it simulates as MATLAB's save does: the same error, or the last time step, which must
%          be the active set's StopTime.
%      Recorded beside the verdict: whether MATLAB's save holds the mark member byte for byte as
%      the copy does, and which members it changes beside it, against its save of the model as
%      it opened (`changed`).
%
% A change the session refuses is set beside MATLAB's: `BOTH-REFUSE` where MATLAB will not make it
% either, `CORE-REFUSES` where it does (the session is stricter than MATLAB there, which is not a
% failure); a change the session makes and MATLAB will not is a FAIL. Measured on R2027a
% (2026-11-03): MATLAB makes a Simulink.ConfigSetRef active only when it finds what the reference
% points to, the dictionary on the path (DictionaryNotFound without it), or in the R2013b layout,
% which keeps no dictionary, a base workspace variable (ConfigSetRef_SourceNameNotInBaseWorkspace),
% and the session, which can look for neither, makes none active.
%
% Run, after `npm run build`:
%   env PROBE_OUT=/tmp/acs PROBE_NODE=$(node -p process.execPath) mw -using Bmain matlab \
%       -nodesktop -batch "run('$PWD/test/parity/matlab/probe_active_config_set.m')"
% and on R2023b, which opens no model of a later layout:
%   env PROBE_OUT=/tmp/acs PROBE_NODE=$(node -p process.execPath) \
%       PROBE_ONLY='^acs_sets_R20(21a|18a|13b)$|^acs_ref_R2013b$' \
%       mw -using BR2023bd matlab -nodesktop -batch "run('$PWD/test/parity/matlab/probe_active_config_set.m')"
% Each run writes a new folder under PROBE_OUT. Prints `RESULT <id> PASS ...` or
% `RESULT <id> FAIL <why>` per case, then `REF <model> <where> <what MATLAB did>` for each
% reference made active by MATLAB with its dictionary on the path, without it, and (R2013b) with
% the set it points to in the base workspace, and `PROBE_ACTIVE_CONFIG_SET DONE pass=N fail=M
% both-refuse=K core-refuses=L`, and writes results.json beside the cases. fail=0 is the only acceptable result. The cases it opens
% without the dictionary judge only the file: MATLAB's save, made with it, opened without it.
here = fileparts(mfilename('fullpath'));
root = getenv('PROBE_OUT');
if isempty(root) || root(1) ~= '/', error('PROBE_OUT must be an absolute path.'); end
outdir = fullfile(root, char(datetime('now', 'Format', 'yyyyMMdd_HHmmss')));
gen = fullfile(outdir, 'gen');
dictdir = fullfile(outdir, 'dict');
mkdir(gen); mkdir(dictdir);
fprintf('VERSION %s\nOUT %s\n', version, outdir);
warning('off', 'backtrace');
bdclose('all');
Simulink.data.dictionary.closeAll('-discard');
fixtures = fullfile(here, '..', '..', 'fixtures', 'active-config');
copyfile(fullfile(fixtures, '*.slx'), gen);
copyfile(fullfile(fixtures, 'acs_dict.sldd'), dictdir);
% Out of every folder that holds one of the models, which would shadow each copy opened.
old = cd(outdir);
restore = onCleanup(@() cd(old));
stops = struct('Configuration', 10, 'Fast', 2, 'Slow', 5, 'RefFromDict', 7);

node = getenv('PROBE_NODE');
if isempty(node), node = 'node'; end
[status, printed] = system(sprintf('"%s" "%s" "%s"', node, fullfile(here, 'probe_active_config_set.mjs'), outdir));
fprintf('%s', printed);
if status ~= 0, error('The Node half failed.'); end

manifest = jsondecode(fileread(fullfile(outdir, 'manifest.json')));
if isstruct(manifest), manifest = num2cell(manifest); end
% PROBE_ONLY, a regular expression, keeps the models whose name it matches: an older release
% opens only those of its own layout or older, and not acs_ref's dictionary, which R2027a wrote
% (R2023b: "not a valid Simulink data dictionary"), so on R2023b only the R2013b acs_ref, which
% keeps no dictionary.
only = getenv('PROBE_ONLY');
keep = @(mdl) isempty(only) || ~isempty(regexp(mdl, only, 'once'));
manifest = manifest(cellfun(@(c) keep(c.model), manifest));
results = {};
pass = 0; fail = 0; bothRefuse = 0; coreRefuses = 0;
for k = 1:numel(manifest)
    c = manifest{k};
    era = regexp(c.model, 'R\d{4}[ab]$', 'match', 'once');
    ours = fullfile(outdir, 'cases', c.id, c.file);
    theirs = fullfile(outdir, 'native', c.id, 'edited', c.file);
    member = ''; changed = ''; matlabRefuses = '';
    try
        if ~isempty(c.js), error('Node: %s', c.js); end
        addpath(dictdir);
        [member, changed] = native(c, era, gen, outdir);
    catch err
        matlabRefuses = [err.identifier ': ' regexprep(err.message, '<a [^>]*>|</a>|\s+', ' ')];
    end
    bdclose('all');
    Simulink.data.dictionary.closeAll('-discard');
    if ~isempty(c.refused)
        r = struct('id', c.id, 'model', c.model, 'era', era, 'from', c.from, 'to', c.to, 'refused', c.refused, 'matlabRefuses', matlabRefuses);
        results{end+1} = r; %#ok<SAGROW>
        if ~isempty(c.js)
            fail = fail + 1;
            fprintf('RESULT %s FAIL Node: %s\n', c.id, c.js);
        elseif isempty(matlabRefuses)
            coreRefuses = coreRefuses + 1;
            fprintf('RESULT %s CORE-REFUSES, where MATLAB makes it: %s\n', c.id, c.refused);
        else
            bothRefuse = bothRefuse + 1;
            fprintf('RESULT %s BOTH-REFUSE core=[%s] matlab=[%s]\n', c.id, c.refused, matlabRefuses);
        end
        continue
    end
    variants = {'dict'};
    if startsWith(c.model, 'acs_ref'), variants = {'dict', 'nodict'}; end
    for v = variants
        id = [c.id '__' v{1}];
        r = struct('id', id, 'model', c.model, 'era', era, 'from', c.from, 'to', c.to, 'dictionary', strcmp(v{1}, 'dict'), ...
            'opens', '', 'matlabOpens', '', 'active', '', 'sets', '', 'dirty', '', 'lastTime', NaN, ...
            'simError', '', 'matlabSimError', '', 'member', member, 'changed', changed, 'why', '');
        try
            if ~isempty(matlabRefuses), error('the session makes a change MATLAB refuses: %s', matlabRefuses); end
            if ~isempty(c.js), error('Node: %s', c.js); end
            if r.dictionary, addpath(dictdir); else, rmpath(dictdir); end
            mine = opened(ours, c.model);
            bdclose('all'); Simulink.data.dictionary.closeAll('-discard');
            matlab = opened(theirs, c.model);
            r.opens = mine.msg; r.matlabOpens = matlab.msg;
            r.active = mine.active; r.sets = mine.sets; r.dirty = mine.dirty;
            r.lastTime = mine.lastTime; r.simError = mine.simError; r.matlabSimError = matlab.simError;
            why = {};
            if ~strcmp(mine.msg, matlab.msg), why{end+1} = sprintf('opens with [%s], where MATLAB''s save opens with [%s]', mine.msg, matlab.msg); end
            if ~strcmp(mine.active, c.to), why{end+1} = sprintf('"%s" is active, not "%s"', mine.active, c.to); end
            if ~strcmp(matlab.active, c.to), why{end+1} = sprintf('MATLAB''s save has "%s" active, not "%s"', matlab.active, c.to); end
            if ~strcmp(mine.sets, strjoin(c.sets, ',')), why{end+1} = sprintf('its sets are %s, not %s', mine.sets, strjoin(c.sets, ',')); end
            if ~strcmp(mine.dirty, 'off'), why{end+1} = 'it opens changed (Dirty)'; end
            if ~strcmp(mine.simError, matlab.simError)
                why{end+1} = sprintf('it simulates with [%s], where MATLAB''s save does with [%s]', mine.simError, matlab.simError);
            elseif isempty(mine.simError) && (mine.lastTime ~= stops.(c.to) || matlab.lastTime ~= stops.(c.to))
                why{end+1} = sprintf('it simulates to %g and MATLAB''s save to %g, not the active set''s %g', mine.lastTime, matlab.lastTime, stops.(c.to));
            end
            r.why = strjoin(why, '; ');
        catch err
            r.why = err.message;
        end
        bdclose('all');
        Simulink.data.dictionary.closeAll('-discard');
        results{end+1} = r; %#ok<SAGROW>
        if isempty(r.why)
            pass = pass + 1;
            fprintf('RESULT %s PASS active=%s t=%g sim=[%s] member=%s changed=[%s] opens=[%s]\n', id, r.active, r.lastTime, r.simError, r.member, r.changed, r.opens);
        else
            fail = fail + 1;
            fprintf('RESULT %s FAIL %s | member=%s changed=[%s]\n', id, r.why, r.member, r.changed);
        end
    end
end
% When MATLAB makes a reference active at all.
for f = dir(fullfile(gen, 'acs_ref*.slx'))'
    mdl = f.name(1:end-4);
    if ~keep(mdl), continue; end
    for where = {'dictionary', 'none', 'base workspace'}
        if strcmp(where{1}, 'base workspace') && ~endsWith(mdl, 'R2013b'), continue; end
        bdclose('all'); Simulink.data.dictionary.closeAll('-discard'); evalin('base', 'clear dictCfg');
        if strcmp(where{1}, 'dictionary'), addpath(dictdir); elseif contains(path, dictdir), rmpath(dictdir); end
        if strcmp(where{1}, 'base workspace')
            % The set the dictionary holds, made anew: an older release does not read the dictionary.
            dictCfg = Simulink.ConfigSet;
            set_param(dictCfg, 'Name', 'dictCfg', 'StopTime', '7', 'SolverType', 'Fixed-step', 'Solver', 'FixedStepDiscrete', ...
                'FixedStep', '1', 'SaveTime', 'on', 'ReturnWorkspaceOutputs', 'on');
            assignin('base', 'dictCfg', dictCfg);
        end
        evalc('load_system(fullfile(gen, f.name))');
        try
            setActiveConfigSet(mdl, 'RefFromDict');
            out = sim(mdl);
            did = sprintf('makes it active; it simulates to %g', out.tout(end));
        catch err
            did = ['refuses: ' err.identifier ': ' regexprep(err.message, '<a [^>]*>|</a>|\s+', ' ')];
        end
        fprintf('REF %s %s %s\n', mdl, strrep(where{1}, ' ', '_'), did);
    end
end
bdclose('all'); Simulink.data.dictionary.closeAll('-discard'); evalin('base', 'clear dictCfg');
if contains(path, dictdir), rmpath(dictdir); end
fid = fopen(fullfile(outdir, 'results.json'), 'w');
fprintf(fid, '%s', jsonencode(results, 'PrettyPrint', true));
fclose(fid);
fprintf('PROBE_ACTIVE_CONFIG_SET DONE pass=%d fail=%d both-refuse=%d core-refuses=%d\n', pass, fail, bothRefuse, coreRefuses);

% What the model at `file` says as it opens, its name and links left out, and what it is then.
function info = opened(file, mdl)
    lastwarn('');
    printed = strtrim(evalc('load_system(file)'));
    [w, wid] = lastwarn;
    said = @(t) regexprep(regexprep(regexprep(regexprep(strrep(t, char(8), ''), '\[> In [^\]]*\]', ''), '<a [^>]*"[^"]*"[^>]*>|<a [^>]*>|</a>', ''), ['\<' mdl '\>'], '<model>'), '\s+', ' ');
    info.msg = '';
    if ~isempty(w), info.msg = ['a warning: ' wid ': ' said(w)]; end
    if ~isempty(printed), info.msg = strtrim([info.msg ' and prints: ' said(printed)]); end
    info.active = get_param(getActiveConfigSet(mdl), 'Name');
    names = getConfigSets(mdl);
    info.sets = strjoin(names(:)', ',');
    info.dirty = get_param(mdl, 'Dirty');
    info.lastTime = NaN;
    info.simError = '';
    try
        out = sim(mdl);
        info.lastTime = out.tout(end);
    catch err
        info.simError = [err.identifier ': ' said(err.message)];
    end
end

% MATLAB's own save of the case's change, in the case's layout, beside its save of the model as
% it opened: whether its mark member is the copy's, and the members it changes.
function [member, changed] = native(c, era, gen, outdir)
    base = fullfile(outdir, 'native', c.id);
    asIs = fullfile(base, 'as_is'); edited = fullfile(base, 'edited');
    mkdir(asIs); mkdir(edited);
    evalc('load_system(fullfile(gen, c.file))');
    evalc('saveIn(c.model, fullfile(asIs, c.file), era)');
    setActiveConfigSet(c.model, c.to);
    evalc('saveIn(c.model, fullfile(edited, c.file), era)');
    bdclose('all');
    A = members(fullfile(asIs, c.file), fullfile(asIs, 'x'));
    B = members(fullfile(edited, c.file), fullfile(edited, 'x'));
    oursFile = fullfile(outdir, 'cases', c.id, c.file);
    if isfile(oursFile), ours = members(oursFile, fullfile(base, 'ours')); else, ours = containers.Map(); end
    if ~isKey(ours, c.member)
        member = 'no save';
    elseif ~isKey(B, c.member)
        member = 'absent';
    elseif isequal(B(c.member), ours(c.member))
        member = 'same';
    else
        member = 'differs';
        fid = fopen(fullfile(base, 'member_matlab.txt'), 'w'); fwrite(fid, B(c.member)); fclose(fid);
        fid = fopen(fullfile(base, 'member_ours.txt'), 'w'); fwrite(fid, ours(c.member)); fclose(fid);
    end
    names = union(keys(A), keys(B));
    diff = {};
    for i = 1:numel(names)
        n = names{i};
        if ~isKey(A, n) || ~isKey(B, n) || ~isequal(A(n), B(n)), diff{end+1} = n; end %#ok<AGROW>
    end
    changed = strjoin(diff, ',');
end

function saveIn(mdl, file, era)
    if isempty(era)
        save_system(mdl, file);
    else
        save_system(mdl, file, 'ExportToVersion', era);
    end
end

% Every member of the package `file`, by its name in the package, unpacked under `dir`.
function m = members(file, dir)
    names = unzip(file, dir);
    m = containers.Map();
    for i = 1:numel(names)
        if isfolder(names{i}), continue; end
        fid = fopen(names{i}, 'r'); bytes = fread(fid, Inf, '*uint8')'; fclose(fid);
        m(strrep(names{i}(numel(dir) + 2:end), filesep, '/')) = bytes;
    end
end
