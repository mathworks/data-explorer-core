% Copyright 2026 The MathWorks, Inc.
%
% Does a .slx need simulink/modelDictionary.xml, which lists its workspace's parameters and signals
% by name, to agree with its model workspace part? Each case edits ONLY the workspace part of a
% model MATLAB saved (a value, a variable added, renamed, deleted, a Parameter added), re-zips the
% package, and opens it: what loads, what Simulink says, what its code mappings list, and what MATLAB
% writes into modelDictionary.xml when it saves the model again. The second half does the same in a
% model with Embedded Coder code mappings, a workspace Parameter mapped to ExportedGlobal.
%
% Measured on R2027a (2026-11-03): every such model opens with no warning; MATLAB's next save writes
% modelDictionary.xml up to date (the variable added listed, the one deleted not); the mappings keep
% the mapped Parameter's storage class, list a Parameter added as Auto and drop one deleted; and
% update succeeds but where a block names a variable renamed away. So ModelFileWriter leaves
% modelDictionary.xml as it was read.
%
% Run: env MODEL_DICTIONARY_OUT=/tmp/mdsync mw -using Bmain matlab -nodesktop \
%          -batch "run('$PWD/test/parity/matlab/probe_model_dictionary_sync.m')"
% Writes md_sync.json and md_codegen.json there.
outdir0 = getenv('MODEL_DICTIONARY_OUT');
if isempty(outdir0), outdir0 = fullfile(tempdir, 'mdsync'); end
outdir = fullfile(outdir0, 'plain');
if ~exist(outdir, 'dir'), mkdir(outdir); end
cd(outdir);
bdclose('all');
base = 'mdbase';
new_system(base);
add_block('simulink/Sources/Constant', [base '/C'], 'Value', 'a');
add_block('simulink/Sinks/Terminator', [base '/T']);
add_line(base, 'C/1', 'T/1');
ws = get_param(base, 'ModelWorkspace');
assignin(ws, 'a', 1);
assignin(ws, 'p', Simulink.Parameter(2));
assignin(ws, 's', Simulink.Signal);
basefile = fullfile(outdir, [base '.slx']);
save_system(base, basefile, 'OverwriteIfChangedOnDisk', true);
bdclose('all');
edits = {'none', 'value', 'add', 'rename', 'delete', 'addParam'};
report = struct('edit', {}, 'loadOutput', {}, 'warning', {}, 'vars', {}, 'a', {}, 'mappings', {}, 'mdBefore', {}, 'mdAfterResave', {});
for i = 1:numel(edits)
  e = edits{i};
  mdl = ['mdedit_' e];
  dir_ = fullfile(outdir, ['unz_' e]);
  unzip(basefile, dir_);
  part = fullfile(dir_, 'simulink', 'modelWorkspace.mxarray');
  fid = fopen(part, 'r'); bytes = fread(fid, inf, '*uint8'); fclose(fid);
  S = getArrayFromByteStream(bytes);
  switch e
    case 'value', S.a = 5;
    case 'add', S.b = 7;
    case 'rename', S.a2 = S.a; S = rmfield(S, 'a');
    case 'delete', S = rmfield(S, 'p');
    case 'addParam', S.q = Simulink.Parameter(9);
  end
  if ~strcmp(e, 'none')
    S = orderfields(S);
    fid = fopen(part, 'w'); fwrite(fid, getByteStreamFromArray(S)); fclose(fid);
  end
  md = fileread(fullfile(dir_, 'simulink', 'modelDictionary.xml'));
  target = fullfile(outdir, [mdl '.slx']);
  oldd = cd(dir_);
  zip(fullfile(outdir, [mdl '.zip']), {'*', '_rels/*', '[Content_Types].xml'});
  cd(oldd);
  movefile(fullfile(outdir, [mdl '.zip']), target, 'f');
  r = struct('edit', e, 'loadOutput', '', 'warning', '', 'vars', {{}}, 'a', '', 'mappings', '', 'mdBefore', md, 'mdAfterResave', '');
  lastwarn('');
  try
    r.loadOutput = strtrim(evalc('load_system(target)'));
    [w, id] = lastwarn; r.warning = [id ': ' w];
    loaded = get_param(bdroot, 'Name');
    ws = get_param(loaded, 'ModelWorkspace');
    v = whos(ws); r.vars = {v.name};
    if hasVariable(ws, 'a'), r.a = mat2str(getVariable(ws, 'a')); end
    try
      cm = coder.mapping.api.get(loaded);
      r.mappings = strjoin(cellstr(string(find(cm, 'ModelParameters'))), ',');
    catch err
      r.mappings = ['n/a: ' err.message];
    end
    set_param(loaded, 'SimulationCommand', 'update');
    save_system(loaded, fullfile(outdir, [mdl '_resaved.slx']), 'OverwriteIfChangedOnDisk', true);
    unzip(fullfile(outdir, [mdl '_resaved.slx']), fullfile(outdir, ['unz_resaved_' e]));
    r.mdAfterResave = fileread(fullfile(outdir, ['unz_resaved_' e], 'simulink', 'modelDictionary.xml'));
  catch err
    r.loadOutput = ['ERROR: ' err.message];
  end
  bdclose('all');
  report(end+1) = r; %#ok<SAGROW>
end
fid = fopen(fullfile(outdir0, 'md_sync.json'), 'w'); fwrite(fid, jsonencode(report, 'PrettyPrint', true)); fclose(fid);
disp('PROBE_MD_SYNC OK');

% Nothing of the first half left beside the second's blocks, whose values name `p` and `r`.
clearvars -except outdir0
outdir = fullfile(outdir0, 'codegen');
if ~exist(outdir, 'dir'), mkdir(outdir); end
cd(outdir); bdclose('all');
base = 'cgbase';
new_system(base);
add_block('simulink/Sources/Constant', [base '/C'], 'Value', 'p');
add_block('simulink/Sources/Constant', [base '/C2'], 'Value', 'r');
add_block('simulink/Sinks/Terminator', [base '/T']);
add_block('simulink/Sinks/Terminator', [base '/T2']);
add_line(base, 'C/1', 'T/1'); add_line(base, 'C2/1', 'T2/1');
set_param(base, 'SystemTargetFile', 'ert.tlc');
ws = get_param(base, 'ModelWorkspace');
assignin(ws, 'p', Simulink.Parameter(2));
assignin(ws, 'r', Simulink.Parameter(3));
out = struct('step', {}, 'text', {});
try
  coder.mapping.utils.create(base);
  cm = coder.mapping.api.get(base);
  setModelParameter(cm, 'p', 'StorageClass', 'ExportedGlobal');
  out(end+1) = struct('step', 'mapped', 'text', getModelParameter(cm, 'p', 'StorageClass'));
catch err
  out(end+1) = struct('step', 'map failed', 'text', err.message);
end
basefile = fullfile(outdir, [base '.slx']);
save_system(base, basefile, 'OverwriteIfChangedOnDisk', true);
bdclose('all');
edits = {'none', 'value', 'addParam', 'deleteUnmapped'};
for i = 1:numel(edits)
  e = edits{i};
  mdl = ['cgedit_' e];
  d = fullfile(outdir, ['unz_' e]);
  unzip(basefile, d);
  part = fullfile(d, 'simulink', 'modelWorkspace.mxarray');
  fid = fopen(part, 'r'); bytes = fread(fid, inf, '*uint8'); fclose(fid);
  S = getArrayFromByteStream(bytes);
  switch e
    case 'value', S.p.Value = 5;
    case 'addParam', S.q = Simulink.Parameter(9);
    case 'deleteUnmapped', set_param_r = 1; S = rmfield(S, 'r');
  end
  if ~strcmp(e, 'none')
    S = orderfields(S);
    fid = fopen(part, 'w'); fwrite(fid, getByteStreamFromArray(S)); fclose(fid);
  end
  target = fullfile(outdir, [mdl '.slx']);
  od = cd(d); zip(fullfile(outdir, [mdl '.zip']), {'*', '_rels/*', '[Content_Types].xml'}); cd(od);
  movefile(fullfile(outdir, [mdl '.zip']), target, 'f');
  lastwarn('');
  try
    txt = strtrim(evalc('load_system(target)'));
    [w, id] = lastwarn;
    loaded = get_param(bdroot, 'Name');
    cm = coder.mapping.api.get(loaded);
    params = string(find(cm, 'ModelParameters'));
    sc = strings(size(params));
    for k = 1:numel(params), sc(k) = string(getModelParameter(cm, params(k), 'StorageClass')); end
    v = whos(get_param(loaded, 'ModelWorkspace'));
    pv = '';
    if hasVariable(get_param(loaded, 'ModelWorkspace'), 'p'), pv = mat2str(getVariable(get_param(loaded, 'ModelWorkspace'), 'p').Value); end
    if strcmp(e, 'deleteUnmapped')
      set_param([loaded '/C2'], 'Value', '3');
    end
    upd = 'ok';
    try, set_param(loaded, 'SimulationCommand', 'update'); catch err2, upd = err2.message; end
    out(end+1) = struct('step', e, 'text', sprintf('load:[%s] warn:[%s %s] vars:[%s] p.Value=%s mappings:[%s] update:[%s]', txt, id, w, strjoin({v.name}, ','), pv, strjoin(params + "=" + sc, ','), upd)); %#ok<SAGROW>
  catch err
    out(end+1) = struct('step', e, 'text', ['ERROR ' err.message]); %#ok<SAGROW>
  end
  bdclose('all');
end
fid = fopen(fullfile(outdir0, 'md_codegen.json'), 'w'); fwrite(fid, jsonencode(out, 'PrettyPrint', true)); fclose(fid);
disp('PROBE_MD_CODEGEN OK');
