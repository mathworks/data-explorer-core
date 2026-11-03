% Copyright 2026 The MathWorks, Inc.
%
% Fixtures for what a .slx records of its model workspace beside the variables: where they come
% from (its data source) and which of them are model arguments, in each part layout. A model is
% written per case, in this release and exported to R2025a, R2021a and R2018a:
%
%   wsf_model    the variables are kept in the model (MATLAB's default, which it records by
%                writing no data source at all), and one of them, k, a Simulink.Parameter, is a
%                model argument
%   wsf_plainarg the same, with k a plain 5, which an export to R2021a and R2018a keeps in the model
%   wsf_matfile  they come from a MAT-file, wsf_init.mat
%   wsf_mfile    from a MATLAB file, wsf_init.m
%   wsf_mcode    from MATLAB code kept in the model
%
% Measured on R2027a (2026-11-03): the data source is WSDataSource, `MAT-File`, `MATLAB File` or
% `MATLAB Code`, under ModelWorkspace in blockDiagram.json (R2026b+) or blockdiagram.xml; a model
% keeping its own writes none. The arguments are ParameterArgumentNames, a comma-separated list,
% under the model's ModelReferenceSettings in the same part. An export to R2021a or R2018a of a model whose workspace holds a Parameter
% argument moves the workspace into a MATLAB file, `<model>_saveas.m`, and says so.
%
% Run: mw -using Bmain matlab -nodesktop -batch "run('$PWD/test/parity/matlab/gen_workspace_facts.m')"
% Writes test/fixtures/workspace-facts/*.slx and truth.json. Prints GEN_WORKSPACE_FACTS OK.

here = fileparts(mfilename('fullpath'));
outdir = fullfile(here, '..', '..', 'fixtures', 'workspace-facts');
if ~exist(outdir, 'dir'), mkdir(outdir); end
old = cd(outdir);
cleanup = onCleanup(@() cd(old));
addpath(outdir);
a = 1; b = Simulink.Parameter(2); save(fullfile(outdir, 'wsf_init.mat'), 'a', 'b'); clear a b;
fid = fopen(fullfile(outdir, 'wsf_init.m'), 'w'); fprintf(fid, 'a = 1;\n'); fclose(fid);
cases = {'model', 'plainarg', 'matfile', 'mfile', 'mcode'};
eras = {'', 'R2025a', 'R2021a', 'R2018a'};
rows = struct('file', {}, 'era', {}, 'source', {}, 'sourceFile', {}, 'arguments', {}, 'variables', {}, 'message', {});
for i = 1:numel(cases)
  mdl = ['wsf_' cases{i}];
  bdclose('all');
  new_system(mdl);
  add_block('simulink/Sources/Constant', [mdl '/C'], 'Value', 'k');
  add_block('simulink/Sinks/Terminator', [mdl '/T']);
  add_line(mdl, 'C/1', 'T/1');
  file = fullfile(outdir, [mdl '.slx']);
  save_system(mdl, file, 'OverwriteIfChangedOnDisk', true);
  ws = get_param(mdl, 'ModelWorkspace');
  switch cases{i}
    case 'model'
      assignin(ws, 'k', Simulink.Parameter(5));
      assignin(ws, 'gain', 2);
      set_param(mdl, 'ParameterArgumentNames', 'k');
    case 'plainarg'
      assignin(ws, 'k', 5);
      assignin(ws, 'gain', 2);
      set_param(mdl, 'ParameterArgumentNames', 'k,gain');
    case 'matfile', ws.DataSource = 'MAT-File'; ws.FileName = 'wsf_init.mat'; ws.reload();
    case 'mfile', ws.DataSource = 'MATLAB File'; ws.FileName = 'wsf_init.m'; ws.reload();
    case 'mcode', ws.DataSource = 'MATLAB Code'; ws.MATLABCode = 'k = 3;'; ws.reload();
  end
  save_system(mdl, file, 'OverwriteIfChangedOnDisk', true);
  for j = 1:numel(eras)
    target = file;
    message = '';
    if ~isempty(eras{j})
      target = fullfile(outdir, sprintf('%s_%s.slx', mdl, eras{j}));
      message = strtrim(evalc('save_system(mdl, target, ''ExportToVersion'', eras{j}, ''OverwriteIfChangedOnDisk'', true)'));
      message = regexprep(message, '<[^>]*>', '');
      message = regexprep(message, '''[^'']*[/\\][^'']*''', '''<path>''');
    end
    bdclose('all');
    load_system(target);
    loaded = get_param(bdroot, 'Name');
    w = get_param(loaded, 'ModelWorkspace');
    v = whos(w);
    sourceFile = '';
    if any(strcmp(w.DataSource, {'MAT-File', 'MATLAB File'})), sourceFile = w.FileName; end
    [~, base, ext] = fileparts(target);
    rows(end+1) = struct('file', [base ext], 'era', char(string(eras{j})), 'source', w.DataSource, ...
                         'sourceFile', sourceFile, 'arguments', get_param(loaded, 'ParameterArgumentNames'), ...
                         'variables', {sort({v.name})}, 'message', message); %#ok<SAGROW>
    bdclose('all');
    load_system(file);
  end
  bdclose('all');
end
truth = struct('version', version, 'release', version('-release'), 'date', char(datetime('today', 'Format', 'yyyy-MM-dd')), 'models', rows);
fid = fopen(fullfile(outdir, 'truth.json'), 'w'); fwrite(fid, jsonencode(truth, 'PrettyPrint', true)); fclose(fid);
disp('GEN_WORKSPACE_FACTS OK');
