% Copyright 2026 The MathWorks, Inc.
%
% Where a model workspace is a subset of a MAT-file, measured as MATLAB keeps it. ModelWorkspaceNode's
% limits are these.
%
%   1. What a model workspace stores: each candidate value assigned into a fresh model's workspace,
%      saved, reopened, read back (classes.json).
%   2. What MATLAB changes as a value goes in (assignin) and comes back, and what a block may use
%      of it (limits.json).
%   3. What MATLAB makes, as it opens a model, of a workspace part holding a value it would not
%      keep, and of a model argument whose variable is gone or of another kind (opened.json).
%
% Measured on R2027a (2026-11-03):
%   - every class tried is stored and read back: numbers, text, strings, cells, structs, sparse
%     arrays, function handles, every Simulink data class, fi, tables, containers.Map, classdef
%     objects, enumerations;
%   - a Simulink.Signal's storage class other than Auto is set to Auto, with a warning
%     (Simulink:Data:RemoveStorageClassOfMWSSimulinkSignalObject), as it is assigned and as a model
%     holding one opens; a Simulink.Parameter's custom storage class is set to Model default,
%     silently, both ways; ExportedGlobal and ImportedExtern on a Parameter are kept;
%   - a block uses no Simulink.Bus, ConnectionBus, ServiceBus, AliasType or enumeration definition
%     from a model workspace as its data type; a NumericType and a ValueType it does;
%   - a model argument whose variable is deleted, or holds a Signal or a cell, is dropped as the
%     model opens, with a warning (Simulink:Parameters:MissingOrderedParameterArgumentsRemoved); one
%     holding a string or a struct opens and does not update.
%
% Run: env WORKSPACE_LIMITS_OUT=/tmp/wslimits mw -using Bmain matlab -nodesktop \
%          -batch "run('$PWD/test/parity/matlab/probe_workspace_limits.m')"
% Prints PROBE_WORKSPACE_LIMITS OK.

outdir = getenv('WORKSPACE_LIMITS_OUT');
if isempty(outdir), outdir = fullfile(tempdir, 'wslimits'); end
if ~exist(outdir, 'dir'), mkdir(outdir); end
scratch = fullfile(outdir, 'scratch');
if ~exist(scratch, 'dir'), mkdir(scratch); end
addpath(scratch);
cd(scratch);

%% ---- 1. what a model workspace stores ---------------------------------------------------------
% Classes no MATLAB product defines, written fresh so the probe needs nothing on the path.
writeFile(fullfile(scratch, 'MyValue.m'), {'classdef MyValue', '  properties', '    x = 1', '  end', 'end'});
writeFile(fullfile(scratch, 'MyHandle.m'), {'classdef MyHandle < handle', '  properties', '    x = 1', '  end', 'end'});
writeFile(fullfile(scratch, 'MyIntEnum.m'), {'classdef MyIntEnum < Simulink.IntEnumType', '  enumeration', '    A(1)', '    B(2)', '  end', 'end'});
writeFile(fullfile(scratch, 'MyPlainEnum.m'), {'classdef MyPlainEnum < int32', '  enumeration', '    A(1)', '    B(2)', '  end', 'end'});
rehash;

cases = {
  'dScalar',   '3.5'
  'dComplex',  '1+2i'
  'dND',       'reshape(1:8,2,2,2)'
  'dEmpty',    '[]'
  'sSingle',   'single(1.5)'
  'i8',        'int8(-3)'
  'u64',       'intmax(''uint64'')'
  'lg',        'true'
  'ch',        '''hello'''
  'chMat',     '[''ab'';''cd'']'
  'str',       '"hi"'
  'strArr',    '["a" "b"]'
  'cel',       '{1,''a''}'
  'st',        'struct(''a'',1)'
  'stArr',     'struct(''a'',{1,2})'
  'sp',        'sparse([1 0;0 2])'
  'spL',       'sparse(logical([1 0;0 1]))'
  'fh',        '@sin'
  'fhAnon',    '@(x) x+1'
  'p',         'Simulink.Parameter(2)'
  'sig',       'Simulink.Signal'
  'bus',       'Simulink.Bus'
  'busEl',     'Simulink.BusElement'
  'alias',     'Simulink.AliasType(''double'')'
  'nt',        'Simulink.NumericType'
  'lut',       'Simulink.LookupTable'
  'bp',        'Simulink.Breakpoint'
  'vv',        'Simulink.VariantVariable'
  'vc',        'Simulink.VariantControl'
  'vb',        'Simulink.VariantBank'
  'vbci',      'Simulink.VariantBankCoderInfo'
  'cbus',      'Simulink.ConnectionBus'
  'sbus',      'Simulink.ServiceBus'
  'vt',        'Simulink.ValueType'
  'vcd',       'Simulink.VariantConfigurationData'
  've',        'Simulink.VariantExpression(''A==1'')'
  'cs',        'Simulink.ConfigSet'
  'csr',       'Simulink.ConfigSetRef'
  'mptP',      'mpt.Parameter'
  'mptS',      'mpt.Signal'
  'enumDef',   'Simulink.data.dictionary.EnumTypeDefinition'
  'fiObj',     'fi(pi)'
  'ntObj',     'numerictype(1,16,8)'
  'catg',      'categorical({''a'',''b''})'
  'dt',        'datetime(2020,1,1)'
  'dur',       'seconds(5)'
  'tbl',       'table([1;2])'
  'ttbl',      'timetable(seconds([1;2]),[1;2])'
  'map',       'containers.Map({''a''},{1})'
  'ts',        'timeseries([1 2],[0 1])'
  'dset',      'Simulink.SimulationData.Dataset'
  'myVal',     'MyValue'
  'myH',       'MyHandle'
  'myIntEnum', 'MyIntEnum.B'
  'myPlainEnum','MyPlainEnum.B'
  'cellOfP',   '{Simulink.Parameter(1)}'
  'stOfP',     'struct(''p'',Simulink.Parameter(1))'
  'cellFh',    '{@sin}'
  'stOfStr',   'struct(''s'',"x")'
  'pOfInt',    'Simulink.Parameter(int16([1 2 3]))'
  'pOfStruct', 'Simulink.Parameter(struct(''a'',1))'
  'pOfEnum',   'Simulink.Parameter(MyIntEnum.A)'
  'pOfFi',     'Simulink.Parameter(fi(pi))'
};

results = struct('name', {}, 'expr', {}, 'stage', {}, 'error', {}, 'warnings', {}, ...
                 'classIn', {}, 'classOut', {}, 'equal', {}, 'shownOut', {}, 'parts', {});
for i = 1:size(cases, 1)
  name = cases{i, 1};
  expr = cases{i, 2};
  r = struct('name', name, 'expr', expr, 'stage', 'ok', 'error', '', 'warnings', {{}}, ...
             'classIn', '', 'classOut', '', 'equal', false, 'shownOut', '', 'parts', {{}});
  mdl = ['mws_' name];
  file = fullfile(scratch, [mdl '.slx']);
  bdclose('all');
  try
    value = eval(expr);
    r.classIn = class(value);
  catch err
    r.stage = 'construct'; r.error = err.message; results(end+1) = r; continue; %#ok<SAGROW>
  end
  new_system(mdl);
  ws = get_param(mdl, 'ModelWorkspace');
  lastwarn('');
  try
    assignin(ws, name, value);
  catch err
    r.stage = 'assign'; r.error = err.message; r.warnings = warned(r.warnings);
    close_system(mdl, 0); results(end+1) = r; continue; %#ok<SAGROW>
  end
  r.warnings = warned(r.warnings);
  lastwarn('');
  try
    save_system(mdl, file, 'OverwriteIfChangedOnDisk', true);
  catch err
    r.stage = 'save'; r.error = err.message; r.warnings = warned(r.warnings);
    close_system(mdl, 0); results(end+1) = r; continue; %#ok<SAGROW>
  end
  r.warnings = warned(r.warnings);
  close_system(mdl, 0);
  r.parts = partsOf(file, scratch);
  lastwarn('');
  try
    load_system(file);
    ws = get_param(mdl, 'ModelWorkspace');
    if ~hasVariable(ws, name)
      r.stage = 'missing';
    else
      back = getVariable(ws, name);
      r.classOut = class(back);
      try
        r.equal = isequal(back, value);
      catch
        r.equal = false;
      end
      r.shownOut = strtrim(evalc('disp(back)'));
      if numel(r.shownOut) > 300, r.shownOut = r.shownOut(1:300); end
    end
  catch err
    r.stage = 'reopen'; r.error = err.message;
  end
  r.warnings = warned(r.warnings);
  bdclose('all');
  results(end+1) = r; %#ok<SAGROW>
  fprintf('%-12s %-8s %s\n', name, r.stage, r.classOut);
end

% The other data sources: what the saved file holds of the workspace, and what reopens.
sources = struct('source', {}, 'stage', {}, 'error', {}, 'parts', {}, 'reopened', {});
writeFile(fullfile(scratch, 'mws_init.m'), {'a = 1;', 'b = Simulink.Parameter(2);'});
a = 1; b = Simulink.Parameter(2); save(fullfile(scratch, 'mws_init.mat'), 'a', 'b'); clear a b;
srcCases = {'MATLAB Code', 'MATLAB File', 'MAT-File'};
for i = 1:numel(srcCases)
  s = struct('source', srcCases{i}, 'stage', 'ok', 'error', '', 'parts', {{}}, 'reopened', {{}});
  mdl = sprintf('mws_src%d', i);
  file = fullfile(scratch, [mdl '.slx']);
  bdclose('all');
  try
    new_system(mdl);
    save_system(mdl, file, 'OverwriteIfChangedOnDisk', true);
    ws = get_param(mdl, 'ModelWorkspace');
    ws.DataSource = srcCases{i};
    switch srcCases{i}
      case 'MATLAB Code', ws.MATLABCode = sprintf('a = 1;\nb = Simulink.Parameter(2);');
      case 'MATLAB File', ws.FileName = 'mws_init.m';
      case 'MAT-File',    ws.FileName = 'mws_init.mat';
    end
    ws.reload();
    % A variable assigned on top of what the source made: does the save keep it?
    assignin(ws, 'extra', 7);
    save_system(mdl, file, 'OverwriteIfChangedOnDisk', true);
    close_system(mdl, 0);
    s.parts = partsOf(file, scratch);
    load_system(file);
    ws = get_param(mdl, 'ModelWorkspace');
    vars = whos(ws);
    s.reopened = {vars.name};
  catch err
    s.stage = 'failed'; s.error = err.message;
  end
  bdclose('all');
  sources(end+1) = s; %#ok<SAGROW>
end

out = struct('release', version('-release'), 'cases', results, 'sources', sources);
fid = fopen(fullfile(outdir, 'classes.json'), 'w');
fwrite(fid, jsonencode(out, 'PrettyPrint', true));
fclose(fid);
clearvars -except outdir scratch

%% ---- 2. what goes in and comes back, and what a block may use --------------------------------
%% ---- property changes, in and back ----------------------------------------------------------
pE = Simulink.Parameter(1); pE.CoderInfo.StorageClass = 'ExportedGlobal';
pI = Simulink.Parameter(1); pI.CoderInfo.StorageClass = 'ImportedExtern';
pC = Simulink.Parameter(1); pC.CoderInfo.StorageClass = 'Custom'; pC.CoderInfo.CustomStorageClass = 'Const';
pM = Simulink.Parameter(1); pM.CoderInfo.StorageClass = 'Model default';
sE = Simulink.Signal; sE.CoderInfo.StorageClass = 'ExportedGlobal';
sI = Simulink.Signal; sI.CoderInfo.StorageClass = 'ImportedExtern';
mptP = mpt.Parameter;
mptS = mpt.Signal;
pArg = Simulink.Parameter(5);
props = {'pE', pE; 'pI', pI; 'pC', pC; 'pM', pM; 'sE', sE; 'sI', sI; 'mptP', mptP; 'mptS', mptS};

propOut = struct('name', {}, 'warnIn', {}, 'diffIn', {}, 'diffBack', {}, 'warnBack', {}, 'error', {});
for i = 1:size(props, 1)
  name = props{i, 1}; value = props{i, 2};
  r = struct('name', name, 'warnIn', '', 'diffIn', {{}}, 'diffBack', {{}}, 'warnBack', '', 'error', '');
  mdl = ['mwl_' name];
  file = fullfile(scratch, [mdl '.slx']);
  bdclose('all');
  try
    new_system(mdl);
    ws = get_param(mdl, 'ModelWorkspace');
    lastwarn('');
    assignin(ws, name, value);
    r.warnIn = lastwarn; lastwarn('');
    r.diffIn = diffOf(value, getVariable(ws, name));
    save_system(mdl, file, 'OverwriteIfChangedOnDisk', true);
    close_system(mdl, 0);
    load_system(file);
    ws = get_param(mdl, 'ModelWorkspace');
    r.diffBack = diffOf(value, getVariable(ws, name));
    r.warnBack = lastwarn;
  catch err
    r.error = err.message;
  end
  bdclose('all');
  propOut(end+1) = r; %#ok<SAGROW>
end

%% ---- what a model may use from its workspace ------------------------------------------------
% One model per use: a Constant block whose output data type, or value, names a workspace variable.
% Update diagram, and record what Simulink says.
uses = {
  'busType',    'Simulink.Bus', 'OutDataTypeStr', 'Bus: busType'
  'aliasType',  'Simulink.AliasType(''int16'')', 'OutDataTypeStr', 'aliasType'
  'numType',    'Simulink.NumericType', 'OutDataTypeStr', 'numType'
  'valType',    'Simulink.ValueType', 'OutDataTypeStr', 'ValueType: valType'
  'parValue',   'Simulink.Parameter(3)', 'Value', 'parValue'
  'plainValue', '4', 'Value', 'plainValue'
  'strValue',   '"abc"', 'Value', 'strValue'
  'tblValue',   'table([1;2])', 'Value', 'tblValue'
  'mapValue',   'containers.Map({''a''},{1})', 'Value', 'mapValue'
  'fiValue',    'fi(pi)', 'Value', 'fiValue'
  'cellValue',  '{1}', 'Value', 'cellValue'
  'myValValue', 'MyValue', 'Value', 'myValValue'
  'lutValue',   'Simulink.LookupTable', 'Value', 'lutValue'
  'csValue',    'Simulink.ConfigSet', 'Value', 'csValue'
};
useOut = struct('name', {}, 'param', {}, 'text', {}, 'result', {}, 'message', {});
for i = 1:size(uses, 1)
  name = uses{i, 1};
  r = struct('name', name, 'param', uses{i, 3}, 'text', uses{i, 4}, 'result', 'ok', 'message', '');
  mdl = ['mwu_' name];
  bdclose('all');
  try
    new_system(mdl);
    add_block('simulink/Sources/Constant', [mdl '/C']);
    add_block('simulink/Sinks/Terminator', [mdl '/T']);
    add_line(mdl, 'C/1', 'T/1');
    if strcmp(uses{i, 3}, 'OutDataTypeStr') && startsWith(uses{i, 4}, 'Bus')
      e = Simulink.BusElement; e.Name = 'x';
      bus = Simulink.Bus; bus.Elements = e;
      value = bus;
      set_param([mdl '/C'], 'Value', '0');
    else
      value = eval(uses{i, 2});
    end
    ws = get_param(mdl, 'ModelWorkspace');
    assignin(ws, name, value);
    set_param([mdl '/C'], uses{i, 3}, uses{i, 4});
    set_param(mdl, 'SimulationCommand', 'update');
  catch err
    r.result = 'error';
    r.message = flatten(err);
  end
  bdclose('all');
  useOut(end+1) = r; %#ok<SAGROW>
end

%% ---- a model argument ----------------------------------------------------------------------
argOut = struct('case', {}, 'result', {}, 'message', {});
argCases = {'parameter', 'Simulink.Parameter(5)'; 'plain', '5'; 'signal', 'Simulink.Signal'};
for i = 1:size(argCases, 1)
  r = struct('case', argCases{i, 1}, 'result', 'ok', 'message', '');
  mdl = sprintf('mwa_%d', i);
  bdclose('all');
  try
    new_system(mdl);
    add_block('simulink/Sources/Constant', [mdl '/C'], 'Value', 'k');
    add_block('simulink/Sinks/Terminator', [mdl '/T']);
    add_line(mdl, 'C/1', 'T/1');
    ws = get_param(mdl, 'ModelWorkspace');
    assignin(ws, 'k', eval(argCases{i, 2}));
    set_param(mdl, 'ParameterArgumentNames', 'k');
    set_param(mdl, 'SimulationCommand', 'update');
  catch err
    r.result = 'error';
    r.message = flatten(err);
  end
  bdclose('all');
  argOut(end+1) = r; %#ok<SAGROW>
end

out = struct('release', version('-release'), 'properties', propOut, 'uses', useOut, 'arguments', argOut);
fid = fopen(fullfile(outdir, 'limits.json'), 'w');
fwrite(fid, jsonencode(out, 'PrettyPrint', true));
fclose(fid);
clearvars -except outdir scratch

%% ---- 3. what a model opens of a part holding what it would not keep ---------------------------
cd(scratch); bdclose('all');
res = struct('case', {}, 'result', {});
e = Simulink.BusElement; e.Name = 'x';
types = {
  'bus',   'Bus: T',              @() setfield(Simulink.Bus, 'Elements', e) %#ok<SFLD>
  'cbus',  'Bus: T',              @() Simulink.ConnectionBus
  'sbus',  'Bus: T',              @() Simulink.ServiceBus
  'alias', 'T',                   @() Simulink.AliasType('int16')
  'nt',    'T',                   @() Simulink.NumericType
  'vt',    'ValueType: T',        @() Simulink.ValueType
  'enumdef','Enum: T',            @() Simulink.data.dictionary.EnumTypeDefinition
};
for i = 1:size(types, 1)
  mdl = ['lt_' types{i, 1}];
  new_system(mdl);
  add_block('simulink/Sources/Constant', [mdl '/C'], 'Value', '0');
  add_block('simulink/Sinks/Terminator', [mdl '/T']);
  add_line(mdl, 'C/1', 'T/1');
  r = 'ok';
  try
    assignin(get_param(mdl, 'ModelWorkspace'), 'T', types{i, 3}());
    set_param([mdl '/C'], 'OutDataTypeStr', types{i, 2});
    set_param(mdl, 'SimulationCommand', 'update');
  catch err
    r = err.message; for k = 1:numel(err.cause), r = [r ' | ' err.cause{k}.message]; end %#ok<AGROW>
  end
  res(end+1) = struct('case', ['use ' types{i, 1}], 'result', r); %#ok<SAGROW>
  bdclose('all');
end
% (b)/(c): a saved model, its workspace part replaced by a struct MATLAB serialises itself.
base = 'lbase';
new_system(base);
add_block('simulink/Sources/Constant', [base '/C'], 'Value', 'k');
add_block('simulink/Sinks/Terminator', [base '/T']);
add_line(base, 'C/1', 'T/1');
assignin(get_param(base, 'ModelWorkspace'), 'k', Simulink.Parameter(5));
assignin(get_param(base, 'ModelWorkspace'), 'g', 2);
set_param(base, 'ParameterArgumentNames', 'k');
basefile = fullfile(outdir, [base '.slx']);
save_system(base, basefile, 'OverwriteIfChangedOnDisk', true);
bdclose('all');
sE = Simulink.Signal; sE.CoderInfo.StorageClass = 'ExportedGlobal';
sI = Simulink.Signal; sI.CoderInfo.StorageClass = 'ImportedExtern';
pC = Simulink.Parameter(1); pC.CoderInfo.StorageClass = 'Custom'; pC.CoderInfo.CustomStorageClass = 'Const';
pE = Simulink.Parameter(1); pE.CoderInfo.StorageClass = 'ExportedGlobal';
parts = {
  'signal_exported', @(S) setfield(S, 'sE', sE)
  'signal_imported', @(S) setfield(S, 'sI', sI)
  'param_custom',    @(S) setfield(S, 'pC', pC)
  'param_exported',  @(S) setfield(S, 'pE', pE)
  'arg_deleted',     @(S) rmfield(S, 'k')
  'arg_string',      @(S) setfield(S, 'k', "text")
  'arg_signal',      @(S) setfield(S, 'k', Simulink.Signal)
  'arg_struct',      @(S) setfield(S, 'k', struct('a', 1))
  'arg_cell',        @(S) setfield(S, 'k', {1})
};
for i = 1:size(parts, 1)
  id = parts{i, 1};
  d = fullfile(outdir, ['unz_' id]);
  unzip(basefile, d);
  part = fullfile(d, 'simulink', 'modelWorkspace.mxarray');
  fid = fopen(part, 'r'); b = fread(fid, inf, '*uint8'); fclose(fid);
  S = getArrayFromByteStream(b);
  S = orderfields(parts{i, 2}(S));
  fid = fopen(part, 'w'); fwrite(fid, getByteStreamFromArray(S)); fclose(fid);
  target = fullfile(outdir, [id '.slx']);
  od = cd(d); zip(fullfile(outdir, [id '.zip']), {'*', '_rels/*', '[Content_Types].xml'}); cd(od);
  movefile(fullfile(outdir, [id '.zip']), target, 'f');
  lastwarn('');
  r = '';
  try
    printed = strtrim(evalc('load_system(target)'));
    [w, wid] = lastwarn;
    mdl = get_param(bdroot, 'Name');
    ws = get_param(mdl, 'ModelWorkspace');
    v = whos(ws);
    r = sprintf('load warn:[%s %s] printed:[%s] vars:[%s] args:[%s]', wid, w, regexprep(printed, '\s+', ' '), strjoin({v.name}, ','), get_param(mdl, 'ParameterArgumentNames'));
    for n = {'sE', 'sI', 'pC', 'pE'}
      if hasVariable(ws, n{1}), x = getVariable(ws, n{1}); r = [r sprintf(' %s.StorageClass=%s', n{1}, x.CoderInfo.StorageClass)]; end %#ok<AGROW>
    end
    try, set_param(mdl, 'SimulationCommand', 'update'); r = [r ' update:ok']; catch err, r = [r ' update:' err.message]; end %#ok<AGROW>
  catch err
    r = ['ERROR ' err.message];
  end
  res(end+1) = struct('case', id, 'result', r); %#ok<SAGROW>
  bdclose('all');
end
fid = fopen(fullfile(outdir, 'opened.json'), 'w'); fwrite(fid, jsonencode(res, 'PrettyPrint', true)); fclose(fid);
disp('PROBE_WORKSPACE_LIMITS OK');

function writeFile(path, lines)
  fid = fopen(path, 'w');
  fprintf(fid, '%s\n', lines{:});
  fclose(fid);
end

function list = warned(list)
  [msg, id] = lastwarn;
  if ~isempty(msg)
    list{end+1} = [id ': ' msg];
  end
  lastwarn('');
end

function parts = partsOf(file, scratch)
  [~, base] = fileparts(file);
  tmp = fullfile(scratch, ['unz_' base '_' char(java.util.UUID.randomUUID())]);
  files = unzip(file, tmp);
  parts = {};
  for k = 1:numel(files)
    rel = strrep(files{k}, [tmp filesep], '');
    if contains(lower(rel), 'workspace') || endsWith(rel, '.m')
      parts{end+1} = rel; %#ok<AGROW>
    end
  end
end

function d = diffOf(a, b)
  d = {};
  fa = flat(a, ''); fb = flat(b, '');
  keys = union(fieldnames(fa), fieldnames(fb));
  for k = 1:numel(keys)
    key = keys{k};
    va = ''; vb = '';
    if isfield(fa, key), va = fa.(key); end
    if isfield(fb, key), vb = fb.(key); end
    if ~isequal(va, vb)
      d{end+1} = sprintf('%s: %s -> %s', strrep(key, '__', '.'), va, vb); %#ok<AGROW>
    end
  end
end

function s = flat(v, prefix)
  s = struct();
  if isobject(v) || isstruct(v)
    if isobject(v)
      names = properties(v);
    else
      names = fieldnames(v);
    end
    for k = 1:numel(names)
      try
        sub = v.(names{k});
      catch
        continue;
      end
      key = [prefix names{k}];
      if (isobject(sub) || isstruct(sub)) && isscalar(sub) && ~isa(sub, 'embedded.fi')
        inner = flat(sub, [key '__']);
        f = fieldnames(inner);
        for j = 1:numel(f), s.(f{j}) = inner.(f{j}); end
      else
        try
          s.(key) = strtrim(evalc('disp(sub)'));
        catch
          s.(key) = class(sub);
        end
      end
    end
  end
end

function m = flatten(err)
  m = err.message;
  for k = 1:numel(err.cause)
    m = [m ' | ' flatten(err.cause{k})]; %#ok<AGROW>
  end
end
