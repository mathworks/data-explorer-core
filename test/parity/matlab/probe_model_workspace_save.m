% Copyright 2026 The MathWorks, Inc.
%
% The MATLAB half of the model workspace save gate: open every model
% probe_model_workspace_save.mjs saved through the session, and compare its Model Workspace with
% the original's, opened and edited by MATLAB itself.
%
% Run the JS half first, with the SAME absolute PROBE_OUT (and `npm run build` before it):
%   env PROBE_OUT=/tmp/mwsave node test/parity/matlab/probe_model_workspace_save.mjs
%   env PROBE_OUT=/tmp/mwsave mw -using Bmain matlab -nodesktop \
%       -batch "run('$PWD/test/parity/matlab/probe_model_workspace_save.m')"
% and on R2023b, which opens no model of a later layout:
%   env PROBE_OUT=/tmp/mwsave PROBE_ONLY='^(r21|r18|first_r21|first_r18)' mw -using BR2023bd matlab \
%       -nodesktop -batch "run('$PWD/test/parity/matlab/probe_model_workspace_save.m')"
%
% For each case of the manifest:
%   1. S0 = the original's workspace variables;
%   2. S  = a copy of S0 (its objects copied: a Simulink data object is a handle) with the case's
%      MATLAB statements applied, which must differ from S0 for a case that edits and equal it
%      for one that does not;
%   3. T  = the save's workspace variables, opened with no warning and printing nothing that the
%      original does not (a fixture whose referenced model or dictionary is not beside it warns of
%      that, as its save does), the model's name aside;
%   4. T must be S: the same variable names, and each variable the same class, size and value
%      (isequaln; an object's every readable property);
%   5. the save updates (SimulationCommand update) wherever the original does;
%   6. the save's data source and model arguments are the original's.
% Prints `RESULT <id> PASS` or `RESULT <id> FAIL <why>` per case, and last
% `PROBE_MODEL_WORKSPACE_SAVE DONE pass=N fail=M`. fail=0 is the only acceptable result.
if exist('PROBE_OUT', 'var') && ~isempty(PROBE_OUT) %#ok<NODEF>
    outdir = PROBE_OUT;
else
    outdir = getenv('PROBE_OUT');
end
if isempty(outdir) || outdir(1) ~= '/'
    error('PROBE_OUT must be the absolute path the JS half wrote to.');
end
fprintf('VERSION %s\n', version);
manifest = jsondecode(fileread(fullfile(outdir, 'manifest.json')));
if isstruct(manifest), manifest = num2cell(manifest); end
% PROBE_ONLY, a regular expression, keeps the cases whose id it matches: an older release opens only
% the cases whose model is of its own layout or older (R2023b: the r21_, r18_ and first_r21/r18 ones).
only = getenv('PROBE_ONLY');
if ~isempty(only)
    manifest = manifest(cellfun(@(c) ~isempty(regexp(c.id, only, 'once')), manifest));
end
pass = 0; fail = 0;
for k = 1:numel(manifest)
    c = manifest{k};
    why = '';
    if ~isempty(c.js)
        why = ['JS: ' c.js];
    else
        try
            [S0, info0, msg0] = workspaceOf(c.original);
            S = copied(S0); %#ok<NASGU>
            eval(c.statements);
            if isempty(c.statements) ~= isequaln(S, S0)
                error('the case''s statements %s', ternary(isempty(c.statements), 'change nothing', 'change nothing of S'));
            end
            [T, info, msg] = workspaceOf(c.saved);
            if ~strcmp(msg, msg0), error('the save opens with [%s], where the original opens with [%s]', msg, msg0); end
            why = compareVars(S, T);
            if isempty(why) && info0.updates && ~info.updates
                why = ['the save does not update: ' info.updateError];
            end
            if isempty(why) && (~strcmp(info.source, info0.source) || ~strcmp(info.arguments, info0.arguments))
                why = sprintf('data source / arguments %s / %s, where the original has %s / %s', info.source, info.arguments, info0.source, info0.arguments);
            end
        catch err
            why = err.message;
        end
    end
    if isempty(why)
        pass = pass + 1;
        fprintf('RESULT %s PASS\n', c.id);
    else
        fail = fail + 1;
        fprintf('RESULT %s FAIL %s\n', c.id, why);
    end
end
fprintf('PROBE_MODEL_WORKSPACE_SAVE DONE pass=%d fail=%d\n', pass, fail);

function [S, info, msg] = workspaceOf(file)
    bdclose('all');
    lastwarn('');
    printed = strtrim(evalc('load_system(file)'));
    [w, id] = lastwarn;
    mdl = get_param(bdroot, 'Name');
    % What it said, with its own name and the links in it left out.
    % Its white space as one space, too: MATLAB wraps what it prints to the window's width.
    % And the stack trace MATLAB prints after a warning, which names this probe's own lines; first
    % the backspaces it frames a warning it prints with ([\b ... ]\b).
    said = @(t) regexprep(regexprep(regexprep(regexprep(strrep(t, char(8), ''), '\[> In [^\]]*\]', ''), '<a [^>]*"[^"]*"[^>]*>|<a [^>]*>|</a>', ''), ['\<' mdl '\>'], '<model>'), '\s+', ' ');
    msg = '';
    if ~isempty(w), msg = ['a warning: ' id ': ' said(w)]; end
    if ~isempty(printed), msg = strtrim([msg ' and prints: ' said(printed)]); end
    ws = get_param(mdl, 'ModelWorkspace');
    S = struct();
    v = whos(ws);
    for i = 1:numel(v)
        S.(v(i).name) = getVariable(ws, v(i).name);
    end
    info.source = ws.DataSource;
    info.arguments = get_param(mdl, 'ParameterArgumentNames');
    info.updates = true;
    info.updateError = '';
    try
        set_param(mdl, 'SimulationCommand', 'update');
    catch err
        info.updates = false;
        info.updateError = err.message;
    end
    bdclose('all');
end

function why = compareVars(S, T)
    why = '';
    a = sort(fieldnames(S)); b = sort(fieldnames(T));
    if ~isequal(a, b)
        why = sprintf('variables {%s}, where MATLAB''s edit makes {%s}', strjoin(b', ','), strjoin(a', ','));
        return;
    end
    for i = 1:numel(a)
        x = S.(a{i}); y = T.(a{i});
        if ~strcmp(class(x), class(y))
            why = sprintf('%s is a %s, where MATLAB''s edit makes a %s', a{i}, class(y), class(x));
            return;
        end
        if ~isequal(size(x), size(y))
            why = sprintf('%s is %s, where MATLAB''s edit makes it %s', a{i}, mat2str(size(y)), mat2str(size(x)));
            return;
        end
        if ~isequaln(x, y)
            why = sprintf('%s differs from MATLAB''s edit', a{i});
            return;
        end
    end
end

% A copy of the struct of variables `S`, each handle object in it copied, so that an edit of the
% copy leaves `S` as it was.
function out = copied(S)
    out = S;
    names = fieldnames(S);
    for i = 1:numel(names)
        out.(names{i}) = copiedValue(S.(names{i}));
    end
end

function v = copiedValue(v)
    if isa(v, 'handle') && ismethod(v, 'copy')
        v = copy(v);
    elseif isstruct(v)
        for j = 1:numel(v)
            f = fieldnames(v);
            for n = 1:numel(f), v(j).(f{n}) = copiedValue(v(j).(f{n})); end
        end
    elseif iscell(v)
        for j = 1:numel(v), v{j} = copiedValue(v{j}); end
    end
end

function out = ternary(c, a, b)
    if c, out = a; else, out = b; end
end
