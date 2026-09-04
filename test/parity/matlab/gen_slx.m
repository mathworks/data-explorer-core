% Copyright 2026 The MathWorks, Inc.
%
% Ground-truth generator for the LEGACY `.slx` layout suite.
%
% The `.slx` part layout is not one format. The JSON parts the parser was first
% written against arrived in R2026b; every release before that wrote XML, and the
% part set changed four more times on the way there. This script writes one file
% per era so each of those layouts has something to be parsed against:
%
%   slxcases.slx          current release -- blockDiagram.json, configSetInfo.json,
%                         graphicalInterface.json, modelWorkspace.mxarray,
%                         systems/*.xml. The reference every other file is
%                         compared to.
%   slxcases_R2025a.slx   graphicalInterface is JSON, but blockDiagram and
%                         configSetInfo are still XML. The R2024b-R2026a era.
%   slxcases_R2021a.slx   all three XML; blocks in systems/*.xml; workspace in
%                         modelWorkspace.mxarray. The R2020a-R2024a era, which
%                         held for five years and is the most likely file to meet.
%   slxcases_R2018a.slx   blocks live INSIDE blockdiagram.xml (no systems/ parts)
%                         and the workspace is modelworkspace.mat, a plain
%                         MAT-file. The R2015a-R2019a era.
%   slxcases_R2013b.slx   oldest supported export: no configSetInfo part and no
%                         graphicalInterface part at all. Predates data
%                         dictionaries (R2014a), so the link is dropped on export
%                         -- a genuine limit of the release, not a parser bug.
%
% Run:  matlab -nodesktop -batch "run('<abs path>/gen_slx.m')"
%
% Prints `GEN_SLX OK`. Honours an `outdir` set by the caller, like gen_truth.m and
% gen_mdl.m, so the corpus can be regenerated somewhere harmless and diffed.

here = fileparts(mfilename('fullpath'));
if ~exist('outdir', 'var') || isempty(outdir)
    outdir = fullfile(here, '..', 'artifacts');
end
artdir = outdir;
slxdir = fullfile(artdir, 'slx_layouts');
if ~exist(artdir, 'dir'), mkdir(artdir); end
if ~exist(slxdir, 'dir'), mkdir(slxdir); end

scratch = fullfile(tempdir, 'gen_slx_scratch');
if exist(scratch, 'dir'), rmdir(scratch, 's'); end
mkdir(scratch);

truth = struct();

%% ---- the dictionary the model links to ------------------------------------
% Only its NAME is recorded in a model file, so this exists purely so that
% set_param(..., 'DataDictionary', ...) has something to accept.
Simulink.data.dictionary.closeAll('-discard');
bdclose('all');
dictfile = fullfile(scratch, 'slxparams.sldd');
dd = Simulink.data.dictionary.create(dictfile);
ds = getSection(dd, 'Design Data');
addEntry(ds, 'Kp', Simulink.Parameter(3.5));
addEntry(ds, 'Ki', Simulink.Parameter(int32(7)));
saveChanges(dd);
clear ds; dd.close();

%% ---- the referenced child model -------------------------------------------
child = 'slx_child';
if bdIsLoaded(child), close_system(child, 0); end
new_system(child);
add_block('simulink/Ports & Subsystems/In1',  [child '/In1']);
add_block('simulink/Ports & Subsystems/Out1', [child '/Out1']);
add_line(child, 'In1/1', 'Out1/1');
save_system(child, fullfile(scratch, [child '.slx']), 'OverwriteIfChangedOnDisk', true);
close_system(child, 0);
addpath(scratch);

%% ---- slxcases -------------------------------------------------------------
% The same diagram gen_mdl.m builds, for the same reasons -- see its header for
% why each block is here. Keeping the two corpora on one diagram means a finding
% in either suite is directly comparable to the other.
mdl = 'slxcases';
if bdIsLoaded(mdl), close_system(mdl, 0); end
new_system(mdl);

add_block('simulink/Sources/Constant', [mdl '/Const'], 'Value', 'Kp');
add_block('simulink/Math Operations/Gain', [mdl '/Gain'], 'Gain', 'Ki');
add_block('simulink/Continuous/Transfer Fcn', [mdl '/TF'], ...
          'Numerator', '[1]', 'Denominator', '[tau 1]');
add_block('simulink/Discontinuities/Saturation', [mdl '/Sat'], ...
          'UpperLimit', 'Inf', 'LowerLimit', '-Inf');
add_block('simulink/Math Operations/Sum', [mdl '/Sum'], 'Inputs', '|++');
add_block('simulink/Sources/Constant', [mdl '/Two' char(10) 'Lines'], 'Value', 'span');
add_block('built-in/Subsystem', [mdl '/Sub']);
add_block('simulink/Math Operations/Gain', [mdl '/Sub/InnerGain'], 'Gain', 'inner');
add_block('built-in/ModelReference', [mdl '/Child'], 'ModelNameDialog', child);
add_line(mdl, 'Const/1', 'Gain/1');

set_param(mdl, 'DataDictionary', 'slxparams.sldd');

% Plain values only. A Simulink data object in the workspace makes the oldest
% exports give up on the workspace entirely and repoint it at a .m file, which
% would leave the modelworkspace.mat path with nothing to parse -- the same
% lesson gen_mdl.m records for R2011b.
ws = get_param(mdl, 'ModelWorkspace');
assignin(ws, 'tau',    0.25);
assignin(ws, 'inner',  int32(7));
assignin(ws, 'span',   3);
assignin(ws, 'label',  'hello');
assignin(ws, 'flag',   true);
assignin(ws, 'grid',   [1 2 3; 4 5 6]);
assignin(ws, 'names',  {'alpha','beta'});
assignin(ws, 'cfg',    struct('mode', 'fast', 'gain', 2));

cs = getConfigSet(mdl, 'Configuration');
csCopy = cs.copy(); csCopy.Name = 'Fast';
attachConfigSet(mdl, csCopy, true);

% The current-release file, written normally. ExportToVersion needs the model on
% disk under its final name first, which this save does.
modern = fullfile(slxdir, [mdl '.slx']);
save_system(mdl, modern, 'OverwriteIfChangedOnDisk', true);

truth.slxcases = modelTruth(mdl, modern);

%% ---- one export per layout era --------------------------------------------
% Exporting RENAMES the block diagram to the target file name, so each legacy
% file carries `slxcases_R20xxy` as the model name and as the prefix of every
% block path. The test normalises that away -- see gen_mdl.m, same behaviour.
eras = {'R2025a', 'R2021a', 'R2018a', 'R2013b'};
exports = struct('version', {}, 'file', {}, 'lastWarning', {});
for i = 1:numel(eras)
    ver = eras{i};
    target = fullfile(slxdir, sprintf('%s_%s.slx', mdl, ver));
    bdclose('all');
    open_system(modern);
    lastwarn('');
    save_system(mdl, target, 'ExportToVersion', ver, 'OverwriteIfChangedOnDisk', true);
    [wmsg, ~] = lastwarn;
    exports(i).version     = ver;
    exports(i).file        = sprintf('%s_%s.slx', mdl, ver);
    exports(i).lastWarning = strtrim(wmsg);
    fprintf('exported %s\n', exports(i).file);
end
truth.exports = exports;
bdclose('all');

%% ---- slxws: a model workspace backed by an external MAT-file ---------------
% A separate model because it is a different STORAGE choice, not a different
% diagram: `WSDataSource = 'MAT-File'` is where the parser learns that a model
% depends on a .mat, and it is the one fact recorded in the block diagram part
% rather than in a part of its own. Two legacy eras are enough to place it --
% R2021a (the long-lived all-XML era) and R2018a (which ALSO has the workspace
% living in a modelworkspace.mat part, so the two must not be confused).
wsmdl = 'slxws';
if bdIsLoaded(wsmdl), close_system(wsmdl, 0); end

matfile = fullfile(slxdir, 'slxws_data.mat');
Kwp = 1.25; Kwi = 4; %#ok<NASGU>
save(matfile, 'Kwp', 'Kwi');

new_system(wsmdl);
add_block('simulink/Sources/Constant', [wsmdl '/WsConst'], 'Value', 'Kwp');
add_block('simulink/Math Operations/Gain', [wsmdl '/WsGain'], 'Gain', 'Kwi');

% The .mat is named RELATIVELY, which is what a real model does -- so it only
% resolves once the model itself is on disk in the same directory. Saving first
% and setting the data source second is therefore the required order, not a
% preference; reload() on an unsaved model cannot find the file and errors.
wsModern = fullfile(slxdir, [wsmdl '.slx']);
save_system(wsmdl, wsModern, 'OverwriteIfChangedOnDisk', true);
addpath(slxdir);

wsw = get_param(wsmdl, 'ModelWorkspace');
wsw.DataSource = 'MAT-File';
wsw.FileName = 'slxws_data.mat';
wsw.reload();
save_system(wsmdl, wsModern, 'OverwriteIfChangedOnDisk', true);
truth.slxws = modelTruth(wsmdl, wsModern);

wsExports = struct('version', {}, 'file', {}, 'lastWarning', {});
wsEras = {'R2021a', 'R2018a'};
for i = 1:numel(wsEras)
    ver = wsEras{i};
    target = fullfile(slxdir, sprintf('%s_%s.slx', wsmdl, ver));
    bdclose('all');
    open_system(wsModern);
    lastwarn('');
    save_system(wsmdl, target, 'ExportToVersion', ver, 'OverwriteIfChangedOnDisk', true);
    [wmsg, ~] = lastwarn;
    wsExports(i).version     = ver;
    wsExports(i).file        = sprintf('%s_%s.slx', wsmdl, ver);
    wsExports(i).lastWarning = strtrim(wmsg);
    fprintf('exported %s\n', wsExports(i).file);
end
truth.wsExports = wsExports;
bdclose('all');

%% ---- what MATLAB itself is -----------------------------------------------
truth.matlab = struct('version', version, 'release', version('-release'));

writeJson(fullfile(slxdir, 'slx_truth.json'), truth);

rmpath(scratch);
if ~isempty(strfind(path, slxdir)), rmpath(slxdir); end
Simulink.data.dictionary.closeAll('-discard');
disp('GEN_SLX OK');


% ---------------------------------------------------------------------------
% The truth for the model, recorded from the MODEL rather than from any one file,
% so it is the shared expectation every era's file is held to. Same shape as
% gen_mdl.m's modelTruth, minus the classic-file list.
function t = modelTruth(mdl, modernFile)
    open_system(modernFile);
    t = struct();
    t.name           = get_param(mdl, 'Name');
    t.release        = version('-release');
    t.dataDictionary = get_param(mdl, 'DataDictionary');
    t.wsDataSource   = get_param(mdl, 'ModelWorkspace').DataSource;

    csNames = getConfigSets(mdl);
    active  = getActiveConfigSet(mdl).Name;
    cfgs = struct('name', {}, 'active', {});
    for i = 1:numel(csNames)
        cfgs(i).name   = csNames{i};
        cfgs(i).active = strcmp(csNames{i}, active);
    end
    t.configSets = cfgs;

    refs = {};
    blks = find_system(mdl, 'LookUnderMasks', 'all', 'FollowLinks', 'on', ...
                       'BlockType', 'ModelReference');
    for i = 1:numel(blks)
        refs{end+1} = get_param(blks{i}, 'ModelName'); %#ok<AGROW>
    end
    t.modelReferences = refs;

    blocks = struct('name', {}, 'type', {}, 'params', {});
    blks = find_system(mdl, 'LookUnderMasks', 'all', 'FollowLinks', 'on', 'Type', 'block');
    for i = 1:numel(blks)
        blocks(i).name = get_param(blks{i}, 'Name');
        blocks(i).type = get_param(blks{i}, 'BlockType');
        p = struct();
        for pn = {'Value','Gain','Numerator','Denominator','UpperLimit','LowerLimit','Inputs','ModelNameDialog'}
            try
                p.(pn{1}) = get_param(blks{i}, pn{1});
            catch
            end
        end
        blocks(i).params = p;
    end
    t.blocks = blocks;

    ws = get_param(mdl, 'ModelWorkspace');
    w = ws.whos;
    vnames = sort({w.name});
    vars = struct();
    for i = 1:numel(vnames)
        n = vnames{i};
        v = getVariable(ws, n);
        e = struct('class', class(v), 'size', size(v), 'isobject', isobject(v));
        try
            e.mat2str = mat2str(v);
        catch err
            e.mat2str_error = err.message;
        end
        try
            e.disp = strtrim(formattedDisplayText(v, 'SuppressMarkup', true));
        catch err
            e.disp = ['<error: ' err.message '>'];
        end
        vars.(n) = e;
    end
    t.workspace = vars;
    close_system(mdl, 0);
end

function writeJson(path, data)
    fid = fopen(path, 'w');
    fprintf(fid, '%s', jsonencode(data, 'PrettyPrint', true));
    fclose(fid);
end
