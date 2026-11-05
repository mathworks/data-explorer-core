% Copyright 2026 The MathWorks, Inc.
%
% The fixtures of test/fixtures/config-set-paste (test/configSetPaste.test.ts): one configuration
% set and one reference, each held by a model and by a dictionary, as MATLAB saves them, and MATLAB's
% own duplicate of the set in the model.
%
%   pm.slx        a model of R2027a's layout holding Configuration (active), Fast (fixed-step,
%                 StopTime 2, a Description of two lines) and R (a Simulink.ConfigSetRef to dictCfg,
%                 Description 'refdesc')
%   pd.sldd       a text dictionary holding the same Fast and R in its Configurations
%   pm__dup.slx   pm.slx with a copy of Fast attached as MATLAB names a duplicate (attachConfigSet's
%                 allowRename): Fast1
%
% Run: env FIXTURE_OUT=$PWD/test/fixtures/config-set-paste mw -using Bmain matlab -nodesktop \
%        -batch "run('$PWD/test/parity/matlab/gen_config_set_paste.m')"
out = getenv('FIXTURE_OUT');
if isempty(out) || out(1) ~= '/', error('FIXTURE_OUT must be an absolute path.'); end
if ~exist(out, 'dir'), mkdir(out); end
work = tempname; mkdir(work);
old = cd(work);
restore = onCleanup(@() cd(old));
bdclose('all'); Simulink.data.dictionary.closeAll('-discard');
cs = Simulink.ConfigSet;
set_param(cs, 'Name', 'Fast', 'SolverType', 'Fixed-step', 'Solver', 'FixedStepDiscrete', 'FixedStep', '1', 'StopTime', '2', ...
    'Description', sprintf('d1\nd2'));
r = Simulink.ConfigSetRef;
r.Name = 'R';
r.SourceName = 'dictCfg';
r.Description = 'refdesc';
new_system('pm');
attachConfigSet('pm', copy(cs));
attachConfigSet('pm', copy(r));
save_system('pm', fullfile(work, 'pm.slx'));
dd = Simulink.data.dictionary.create(fullfile(work, 'pd.sldd'));
section = getSection(dd, 'Configurations');
addEntry(section, 'Fast', copy(cs));
addEntry(section, 'R', copy(r));
saveChanges(dd);
close(dd);
attachConfigSet('pm', copy(getConfigSet('pm', 'Fast')), true);
save_system('pm', fullfile(work, 'pm__dup.slx'));
fprintf('NAMES %s\n', strjoin(getConfigSets('pm__dup')', ','));  % save_system renamed the model
bdclose('all');
for f = {'pm.slx', 'pd.sldd', 'pm__dup.slx'}
    copyfile(fullfile(work, f{1}), fullfile(out, f{1}));
end
fprintf('GEN_CONFIG_SET_PASTE DONE %s\n', out);
