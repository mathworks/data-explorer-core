% Copyright 2026 The MathWorks, Inc.
%
% Ground-truth generator for the `.mdl` parity suite. A `.mdl` comes in TWO
% on-disk flavours, both of which real users have, and this script writes one of
% each plus the `.slx` twin of the same block diagram so a test can assert that
% all three open to the same data model:
%
%   mdlcases.mdl          modern .mdl -- an OPC *text* package: the same parts a
%                         .slx carries, delimited by __MWOPC_PART_BEGIN__ lines
%                         instead of zipped, with binary parts base64'd. What
%                         save_system writes for a .mdl today.
%   mdlcases_R2011b.mdl   classic .mdl -- the pre-R2012 nested-brace text format,
%                         via 'ExportToVersion'. What a .mdl that was never
%                         migrated still looks like. The model workspace lives in
%                         a top-level MatData section, uuencoded.
%   mdlcases_R2017b.mdl   classic .mdl again, but from the LAST release that wrote
%                         one. Same grammar, different feature set: it keeps the
%                         linked data dictionary (R2011b silently drops it, with a
%                         warning) and records model references a second way, as
%                         ExternalFileReference entries. Both dialects are real
%                         files a user can still have, so both are parsed.
%   mdlcases.slx          the .slx twin, for the parity assertion.
%
% mdlcases' model workspace holds PLAIN values only. A Simulink data object in the
% workspace makes the R2011b export give up on the workspace entirely ("contains
% data that cannot be loaded in Simulink R2011b") and repoint it at a .m file, so
% the classic MatData path would have nothing to parse. MCOS-in-a-.mdl is covered
% by the second, modern-only pair:
%
%   mdlmcos.mdl / mdlmcos.slx   one Simulink.Parameter in the model workspace.
%
% Run:  matlab -nodesktop -batch "run('<abs path>/gen_mdl.m')"
%
% Prints `GEN_MDL OK`. Honours an `outdir` set by the caller, like gen_truth.m,
% so the corpus can be regenerated somewhere harmless and diffed.

here = fileparts(mfilename('fullpath'));
if ~exist('outdir', 'var') || isempty(outdir)
    outdir = fullfile(here, '..', 'artifacts');
end
artdir = outdir;
mdldir = fullfile(artdir, 'mdl');
if ~exist(artdir, 'dir'), mkdir(artdir); end
if ~exist(mdldir, 'dir'), mkdir(mdldir); end

% save_system to <name>.slx for a model already backed by <name>.mdl in the SAME
% directory is an in-place format upgrade: Simulink writes the .slx and removes
% the .mdl. The twin therefore goes to a scratch directory and is moved in after.
scratch = fullfile(tempdir, 'gen_mdl_scratch');
if exist(scratch, 'dir'), rmdir(scratch, 's'); end
mkdir(scratch);

truth = struct();

%% ---- the dictionary the models link to ------------------------------------
% Only its NAME is recorded in a model file, so this exists purely so that
% set_param(..., 'DataDictionary', ...) has something to accept.
Simulink.data.dictionary.closeAll('-discard');
dictfile = fullfile(scratch, 'mdlparams.sldd');
dd = Simulink.data.dictionary.create(dictfile);
ds = getSection(dd, 'Design Data');
addEntry(ds, 'Kp', Simulink.Parameter(3.5));
addEntry(ds, 'Ki', Simulink.Parameter(int32(7)));
saveChanges(dd);
clear ds; dd.close();

%% ---- the referenced child model -------------------------------------------
% Referenced by name only; nothing resolves it, so it is not part of the corpus.
child = 'mdl_child';
if bdIsLoaded(child), close_system(child, 0); end
new_system(child);
add_block('simulink/Ports & Subsystems/In1',  [child '/In1']);
add_block('simulink/Ports & Subsystems/Out1', [child '/Out1']);
add_line(child, 'In1/1', 'Out1/1');
save_system(child, fullfile(scratch, [child '.slx']), 'OverwriteIfChangedOnDisk', true);
close_system(child, 0);
addpath(scratch);

%% ---- mdlcases: the three-way case ----------------------------------------
mdl = 'mdlcases';
if bdIsLoaded(mdl), close_system(mdl, 0); end
new_system(mdl);

% Blocks chosen for what they prove about parameter-usage extraction:
%   Gain/Const      the ordinary case, a bare identifier
%   TF              coefficients in Numerator/Denominator -- no allowlist could
%                   have known to look there (issue #9)
%   Sat             UpperLimit=Inf, a NUMBER in MATLAB's own spelling, which must
%                   NOT be reported as a reference to a variable called Inf
%   Sum             Inputs=|++ , operator-only, must not be reported either
%   Two\nLines      a two-line block name, which .mdl escapes as \n and .slx as
%                   the numeric char ref &#xA;
%   Sub/InnerGain   a nested subsystem, so the walk must recurse
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

set_param(mdl, 'DataDictionary', 'mdlparams.sldd');

% Plain values only -- see the header. Non-square (2x3) so column-major order is
% observable, and one of every primitive container the workspace section renders.
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

modernMdl = fullfile(mdldir, [mdl '.mdl']);
save_system(mdl, modernMdl, 'OverwriteIfChangedOnDisk', true);
% ExportToVersion needs the model on disk under its final name first, which the
% save above has just done.
% Exporting RENAMES the block diagram to the target file name, so the classic
% files carry `mdlcases_R2011b` / `mdlcases_R2017b` as the model name and as the
% prefix of every block path -- see the parity test, which normalises it away.
classicMdl = fullfile(mdldir, [mdl '_R2011b.mdl']);
save_system(mdl, classicMdl, 'ExportToVersion', 'R2011b', 'OverwriteIfChangedOnDisk', true);
classic17 = fullfile(mdldir, [mdl '_R2017b.mdl']);
save_system(mdl, classic17, 'ExportToVersion', 'R2017b', 'OverwriteIfChangedOnDisk', true);
close_system(mdl, 0);

% The .slx twin: reopen the .mdl so the two files describe the same diagram.
open_system(modernMdl);
save_system(mdl, fullfile(scratch, [mdl '.slx']), 'OverwriteIfChangedOnDisk', true);
close_system(mdl, 0);
movefile(fullfile(scratch, [mdl '.slx']), fullfile(mdldir, [mdl '.slx']), 'f');

truth.mdlcases = modelTruth(mdl, modernMdl, {classicMdl, classic17});

%% ---- mdlmcos: a Simulink data object in the workspace ---------------------
mdl = 'mdlmcos';
if bdIsLoaded(mdl), close_system(mdl, 0); end
new_system(mdl);
add_block('simulink/Math Operations/Gain', [mdl '/Gain'], 'Gain', 'obj');
ws = get_param(mdl, 'ModelWorkspace');
assignin(ws, 'obj',   Simulink.Parameter(9.5));
assignin(ws, 'plain', 4);
mcosMdl = fullfile(mdldir, [mdl '.mdl']);
save_system(mdl, mcosMdl, 'OverwriteIfChangedOnDisk', true);
close_system(mdl, 0);
open_system(mcosMdl);
save_system(mdl, fullfile(scratch, [mdl '.slx']), 'OverwriteIfChangedOnDisk', true);
close_system(mdl, 0);
movefile(fullfile(scratch, [mdl '.slx']), fullfile(mdldir, [mdl '.slx']), 'f');

truth.mdlmcos = modelTruth(mdl, mcosMdl, {});

%% ---- what MATLAB itself is -----------------------------------------------
truth.matlab = struct('version', version, 'release', version('-release'));

writeJson(fullfile(mdldir, 'mdl_truth.json'), truth);

rmpath(scratch);
Simulink.data.dictionary.closeAll('-discard');
disp('GEN_MDL OK');


% ---------------------------------------------------------------------------
% The truth for one model: what MATLAB says about the diagram, recorded from the
% MODEL (not from any one file), so it is the shared expectation every flavour is
% held to. `classicMdls` is a cell array of the classic files written, for the
% drift check.
function t = modelTruth(mdl, modernMdl, classicMdls)
    open_system(modernMdl);
    t = struct();
    t.name         = get_param(mdl, 'Name');
    t.release      = version('-release');
    t.dataDictionary = get_param(mdl, 'DataDictionary');
    t.wsDataSource = get_param(mdl, 'ModelWorkspace').DataSource;

    % config sets: name + whether it is the active one
    csNames = getConfigSets(mdl);
    active  = getActiveConfigSet(mdl).Name;
    cfgs = struct('name', {}, 'active', {});
    for i = 1:numel(csNames)
        cfgs(i).name   = csNames{i};
        cfgs(i).active = strcmp(csNames{i}, active);
    end
    t.configSets = cfgs;

    % model references, as "<block path>|<model name>"
    refs = {};
    blks = find_system(mdl, 'LookUnderMasks', 'all', 'FollowLinks', 'on', ...
                       'BlockType', 'ModelReference');
    for i = 1:numel(blks)
        refs{end+1} = get_param(blks{i}, 'ModelName'); %#ok<AGROW>
    end
    t.modelReferences = refs;

    % every block, with the parameters this corpus deliberately set. Which of
    % them the parser is expected to SURFACE is the parser's own policy (a
    % blocklist plus an identifier gate), asserted in the test -- this records
    % only what MATLAB holds, so the test has something MATLAB-authored to
    % compare against.
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

    % model workspace variables
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

    classics = {};
    for i = 1:numel(classicMdls)
        classics{end+1} = fileName(classicMdls{i}); %#ok<AGROW>
    end
    t.files = struct('modern', fileName(modernMdl), 'classic', {classics});
    close_system(mdl, 0);
end

function n = fileName(p)
    [~, b, e] = fileparts(p);
    n = [b e];
end

function writeJson(path, data)
    fid = fopen(path, 'w');
    fprintf(fid, '%s', jsonencode(data, 'PrettyPrint', true));
    fclose(fid);
end
