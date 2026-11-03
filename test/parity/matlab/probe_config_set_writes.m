% Copyright 2026 The MathWorks, Inc.
%
% What MATLAB writes into a model's package for each edit of its configuration sets, in every
% layout: the edit made by MATLAB itself and the model saved in its own layout (save_system, with
% ExportToVersion for an older one), beside a save of the model as it opened.
%
% On the models of test/fixtures/active-config (gen_active_config.m): acs_sets (Configuration,
% active; Fast; Slow) and acs_ref (Configuration; RefFromDict, a reference to dictCfg in
% acs_dict.sldd), each in R2027a and exported to R2025a, R2021a, R2018a and R2013b. The edits:
%
%   none      nothing (the save the others are set beside)
%   add       a fresh Simulink.ConfigSet named Added, attached
%   addref    a Simulink.ConfigSetRef named AddedRef, SourceName dictCfg, attached (acs_ref)
%   rename    Slow renamed Slower
%   describe  Fast's Description set to 'Quick runs'
%   delete    Slow detached
%   copy      a copy of Fast named FastCopy, attached
%
% Run: env PROBE_OUT=/tmp/csw mw -using Bmain matlab -nodesktop \
%        -batch "run('$PWD/test/parity/matlab/probe_config_set_writes.m')"
% Writes PROBE_OUT/<stamp>/native/<model>__<edit>/<model>.slx and, per save, the set's parameters
% MATLAB reads back (params.json: every set's name, class and every parameter's value); prints
% WROTE <model> <edit> or REFUSED <model> <edit> <why>, then PROBE_CONFIG_SET_WRITES DONE.
here = fileparts(mfilename('fullpath'));
root = getenv('PROBE_OUT');
if isempty(root) || root(1) ~= '/', error('PROBE_OUT must be an absolute path.'); end
outdir = fullfile(root, char(datetime('now', 'Format', 'yyyyMMdd_HHmmss')));
gen = fullfile(outdir, 'gen'); dictdir = fullfile(outdir, 'dict');
mkdir(gen); mkdir(dictdir);
fprintf('VERSION %s\nOUT %s\n', version, outdir);
warning('off', 'backtrace');
fixtures = fullfile(here, '..', '..', 'fixtures', 'active-config');
copyfile(fullfile(fixtures, '*.slx'), gen);
copyfile(fullfile(fixtures, 'acs_dict.sldd'), dictdir);
addpath(dictdir);
old = cd(outdir);
restore = onCleanup(@() cd(old));

% The set a reference points to, where R2013b's layout looks for it: the base workspace.
dictCfg = Simulink.ConfigSet;
set_param(dictCfg, 'Name', 'dictCfg', 'StopTime', '7', 'SolverType', 'Fixed-step', 'Solver', 'FixedStepDiscrete', ...
    'FixedStep', '1', 'SaveTime', 'on', 'ReturnWorkspaceOutputs', 'on');

edits = struct( ...
    'none', @(m) [], ...
    'add', @(m) attachConfigSet(m, named(Simulink.ConfigSet, 'Added')), ...
    'addref', @(m) attachConfigSet(m, refTo('AddedRef', 'dictCfg')), ...
    'rename', @(m) set_param(getConfigSet(m, 'Slow'), 'Name', 'Slower'), ...
    'describe', @(m) set_param(getConfigSet(m, 'Fast'), 'Description', 'Quick runs'), ...
    'delete', @(m) detachConfigSet(m, 'Slow'), ...
    'copy', @(m) attachConfigSet(m, named(copy(getConfigSet(m, 'Fast')), 'FastCopy')));
setsEdits = {'none', 'add', 'rename', 'describe', 'delete', 'copy'};
refEdits = {'none', 'addref'};

files = dir(fullfile(gen, '*.slx'));
for i = 1:numel(files)
    mdl = files(i).name(1:end-4);
    era = regexp(mdl, 'R\d{4}[ab]$', 'match', 'once');
    if startsWith(mdl, 'acs_ref'), these = refEdits; else, these = setsEdits; end
    for e = these
        bdclose('all'); Simulink.data.dictionary.closeAll('-discard');
        assignin('base', 'dictCfg', dictCfg);
        try
            evalc('load_system(fullfile(gen, files(i).name))');
            edits.(e{1})(mdl);
            dir1 = fullfile(outdir, 'native', [mdl '__' e{1}]);
            mkdir(dir1);
            target = fullfile(dir1, files(i).name);
            if isempty(era)
                evalc('save_system(mdl, target)');
            else
                evalc('save_system(mdl, target, ''ExportToVersion'', era)');
            end
            bdclose('all');
            % What MATLAB reads back of the save: each set, and every parameter of each.
            evalc('load_system(target)');
            writeJson(fullfile(dir1, 'params.json'), setsOf(mdl));
            fprintf('WROTE %s %s\n', mdl, e{1});
        catch err
            fprintf('REFUSED %s %s %s: %s\n', mdl, e{1}, err.identifier, regexprep(err.message, '<a [^>]*>|</a>|\s+', ' '));
        end
    end
end
bdclose('all'); Simulink.data.dictionary.closeAll('-discard'); evalin('base', 'clear dictCfg');
% A fresh set's parameters, as MATLAB makes one: what an added set must read back as.
writeJson(fullfile(outdir, 'fresh.json'), paramsOf(Simulink.ConfigSet));
fprintf('PROBE_CONFIG_SET_WRITES DONE\n');

function cs = named(cs, name)
    set_param(cs, 'Name', name);
end

function r = refTo(name, source)
    r = Simulink.ConfigSetRef;
    r.Name = name;
    r.SourceName = source;
end

% Every set of `mdl`, in order: its name, class, whether it is active, and its parameters.
function out = setsOf(mdl)
    names = getConfigSets(mdl);
    active = get_param(getActiveConfigSet(mdl), 'Name');
    out = cell(1, numel(names));
    for j = 1:numel(names)
        s = getConfigSet(mdl, names{j});
        entry = struct('name', names{j}, 'class', class(s), 'active', strcmp(names{j}, active), 'description', '', 'params', struct());
        if isa(s, 'Simulink.ConfigSetRef')
            entry.description = s.Description;
            entry.params = struct('SourceName', s.SourceName);
        else
            entry.description = get_param(s, 'Description');
            entry.params = paramsOf(s);
        end
        out{j} = entry;
    end
end

% Every parameter of the set `s` MATLAB lists, by name, its value as text.
function p = paramsOf(s)
    p = struct();
    names = fieldnames(get_param(s, 'ObjectParameters'));
    for k = 1:numel(names)
        try
            v = get_param(s, names{k});
        catch
            continue
        end
        if ischar(v) || isstring(v)
            p.(names{k}) = char(v);
        elseif isnumeric(v) || islogical(v)
            p.(names{k}) = mat2str(v);
        else
            p.(names{k}) = ['<' class(v) '>'];
        end
    end
end

function writeJson(file, value)
    fid = fopen(file, 'w');
    fprintf(fid, '%s', jsonencode(value, 'PrettyPrint', true));
    fclose(fid);
end
