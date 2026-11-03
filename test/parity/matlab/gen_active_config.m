% Copyright 2026 The MathWorks, Inc.
%
% Fixtures of a model's configuration sets in every layout: two models, written in this release
% and exported to R2025a, R2021a, R2018a and R2013b:
%
%   acs_sets  three sets, Configuration (StopTime 10, active), Fast (2) and Slow (5), each a
%             fixed-step solver of step 1, so a simulation's last time step says which is active
%   acs_ref   Configuration (10, active) and RefFromDict, a Simulink.ConfigSetRef to the set
%             dictCfg (7) in the model's dictionary acs_dict.sldd, written beside them
%
% Measured on R2027a (2026-11-03): an export to R2013b keeps the sets inline in blockdiagram.xml,
% the active one named by the ObjectID of <Object PropName="ActiveConfigurationSet">, and ALSO
% writes simulink/configSetInfo.xml, which holds its XML declaration and nothing else.
%
% Run: mw -using Bmain matlab -nodesktop -batch "run('$PWD/test/parity/matlab/gen_active_config.m')"
% Writes test/fixtures/active-config/*.slx, acs_dict.sldd and truth.json: per model, its release
% and its sets as MATLAB opens them (in order, each with its class and StopTime, and the active
% one). Prints GEN_ACTIVE_CONFIG OK.

here = fileparts(mfilename('fullpath'));
outdir = fullfile(here, '..', '..', 'fixtures', 'active-config');
if ~exist(outdir, 'dir'), mkdir(outdir); end
outdir = char(java.io.File(outdir).getCanonicalPath());
old = cd(outdir);
cleanup = onCleanup(@() cd(old));
warning('off', 'backtrace');
bdclose('all');
Simulink.data.dictionary.closeAll('-discard');

eras = {'', 'R2025a', 'R2021a', 'R2018a', 'R2013b'};
solver = {'SolverType', 'Fixed-step', 'Solver', 'FixedStepDiscrete', 'FixedStep', '1', ...
    'SaveTime', 'on', 'ReturnWorkspaceOutputs', 'on'};

mdl = 'acs_sets';
newModel(mdl);
cs = getActiveConfigSet(mdl);
set_param(cs, solver{:}, 'StopTime', '10');
stops = {'Fast', '2'; 'Slow', '5'};
for i = 1:size(stops, 1)
    c = copy(cs);
    set_param(c, 'Name', stops{i, 1}, 'StopTime', stops{i, 2});
    attachConfigSet(mdl, c);
end
saveEras(mdl, outdir, eras);

ddfile = fullfile(outdir, 'acs_dict.sldd');
if exist(ddfile, 'file'), delete(ddfile); end
dd = Simulink.data.dictionary.create(ddfile);
section = getSection(dd, 'Configurations');
dictCfg = copy(cs);
set_param(dictCfg, 'Name', 'dictCfg', 'StopTime', '7');
addEntry(section, 'dictCfg', dictCfg);
saveChanges(dd);
clear section; dd.close();
close_system(mdl, 0);

rmdl = 'acs_ref';
newModel(rmdl);
set_param(getActiveConfigSet(rmdl), solver{:}, 'StopTime', '10');
set_param(rmdl, 'DataDictionary', 'acs_dict.sldd');
ref = Simulink.ConfigSetRef;
ref.Name = 'RefFromDict';
ref.SourceName = 'dictCfg';
attachConfigSet(rmdl, ref);
saveEras(rmdl, outdir, eras);
bdclose('all');
Simulink.data.dictionary.closeAll('-discard');

% What MATLAB opens of each: its sets in order, each set's class and StopTime, and the active one.
truth = struct('file', {}, 'release', {}, 'sets', {}, 'active', {});
files = dir(fullfile(outdir, '*.slx'));
for i = 1:numel(files)
    bdclose('all');
    name = files(i).name(1:end-4);
    evalc('load_system(fullfile(outdir, files(i).name))');
    names = getConfigSets(name);
    sets = struct('name', {}, 'class', {}, 'stopTime', {});
    for j = 1:numel(names)
        s = getConfigSet(name, names{j});
        sets(j).name = names{j};
        sets(j).class = class(s);
        sets(j).stopTime = get_param(s, 'StopTime');
    end
    info = Simulink.MDLInfo(fullfile(outdir, files(i).name));
    truth(end+1) = struct('file', files(i).name, 'release', info.ReleaseName, 'sets', sets, ...
        'active', get_param(getActiveConfigSet(name), 'Name')); %#ok<SAGROW>
end
bdclose('all');
Simulink.data.dictionary.closeAll('-discard');
fid = fopen(fullfile(outdir, 'truth.json'), 'w');
fprintf(fid, '%s\n', jsonencode(truth, 'PrettyPrint', true));
fclose(fid);
fprintf('GEN_ACTIVE_CONFIG OK\n');

function newModel(mdl)
    new_system(mdl);
    add_block('simulink/Sources/Constant', [mdl '/C'], 'Value', '1');
    add_block('simulink/Sinks/Out1', [mdl '/O']);
    add_line(mdl, 'C/1', 'O/1');
end

function saveEras(mdl, outdir, eras)
    for i = 1:numel(eras)
        if isempty(eras{i})
            save_system(mdl, fullfile(outdir, [mdl '.slx']), 'OverwriteIfChangedOnDisk', true);
        else
            save_system(mdl, fullfile(outdir, sprintf('%s_%s.slx', mdl, eras{i})), ...
                'ExportToVersion', eras{i}, 'OverwriteIfChangedOnDisk', true);
        end
    end
end
