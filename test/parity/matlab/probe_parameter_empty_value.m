% What MATLAB's p.Value = v does to a Simulink.Parameter's Dimensions and Complexity where v, or
% the Value it replaces, is empty. Pinned as parameter_empty_value.truth.json, which
% test/parameterEmptyValue.test.ts holds core's edits to (McosPropertyRules' Parameter co-writes,
% ParameterNode._followValueShape).
%
% Run, with PEV_OUT a new directory:
%   env PEV_OUT=/tmp/pev matlab -batch "run('test/parity/matlab/probe_parameter_empty_value.m')"
% Writes parameter_empty_value.truth.json into PEV_OUT, and prints PARAMETER_EMPTY_VALUE OK last.
out = getenv('PEV_OUT');
if isempty(out), error('set PEV_OUT'); end
pairs = {'[1+2i 3-4i]', '[]'; '[1+2i 3-4i]', 'zeros(0,3)'; '[1+2i 3-4i]', '7'; '5', 'zeros(0,3)'; '5', '[]';
  '[1 2 3]', 'zeros(1,0)'; 'zeros(0,3)', '[1 2]'; '[1+2i 3-4i]', 'single([])'; 'zeros(0,3)', 'zeros(2,0)';
  'zeros(1,0)', '[]'; 'complex(zeros(0,3))', '[]'; '[1+2i 3-4i]', 'false(1,0)'};
rows = cell(1, size(pairs, 1));
for i = 1:size(pairs, 1)
  p = Simulink.Parameter(eval(pairs{i, 1}));
  d0 = p.Dimensions; c0 = p.Complexity;
  p.Value = eval(pairs{i, 2});
  rows{i} = struct('from', pairs{i, 1}, 'to', pairs{i, 2}, 'dimensionsBefore', d0, 'dimensions', p.Dimensions, ...
    'complexityBefore', c0, 'complexity', p.Complexity);
  fprintf('PEV %-20s -> %-12s Dimensions %s -> %s, Complexity %s -> %s\n', pairs{i, 1}, pairs{i, 2}, mat2str(d0), mat2str(p.Dimensions), c0, p.Complexity);
end
% And chains of them, each step as above, and again with the Parameter saved to a MAT-file and
% loaded back between steps: what the Dimensions are after each.
chainSteps = {{'5', 'zeros(0,3)', '[]'}; {'5', 'zeros(0,3)', 'zeros(2,0)'}; {'[1 2 3]', 'zeros(1,0)', '[]'}; {'zeros(0,3)', '[]', 'zeros(2,0)'}};
chains = cell(1, 2 * numel(chainSteps));
for i = 1:numel(chainSteps)
  for reloaded = [false true]
    steps = chainSteps{i};
    p = Simulink.Parameter(eval(steps{1}));
    dims = {p.Dimensions}; cx = {p.Complexity};
    for k = 2:numel(steps)
      if reloaded
        f = [tempname '.mat']; save(f, 'p'); q = load(f); p = q.p; delete(f);
      end
      p.Value = eval(steps{k});
      dims{end + 1} = p.Dimensions; cx{end + 1} = p.Complexity; %#ok<SAGROW>
    end
    chains{2 * i - 2 + 1 + reloaded} = struct('steps', {steps}, 'reloaded', reloaded, 'dimensions', {dims}, 'complexity', {cx});
    between = ''; if reloaded, between = ' (saved and loaded between)'; end
    fprintf('CHAIN %s%s: %s\n', strjoin(steps, ' -> '), between, strjoin(cellfun(@mat2str, dims, 'UniformOutput', false), ' -> '));
  end
end
% The CONTROL: a non-empty Value does set both, so the probe tells the two apart.
p = Simulink.Parameter([1+2i 3-4i]); p.Value = 7;
if ~isequal(p.Dimensions, [1 1]) || ~strcmp(p.Complexity, 'real'), error('CONTROL not caught'); end
truth = struct('release', ['(R' version('-release') ')'], 'cases', {rows}, 'chains', {chains});
fid = fopen(fullfile(out, 'parameter_empty_value.truth.json'), 'w');
fwrite(fid, jsonencode(truth, 'PrettyPrint', true));
fclose(fid);
fprintf('PARAMETER_EMPTY_VALUE OK %d pairs, control caught\n', size(pairs, 1));
