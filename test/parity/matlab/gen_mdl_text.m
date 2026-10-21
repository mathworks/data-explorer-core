% Copyright 2026 The MathWorks, Inc.
%
% Ground-truth generator for the TEXT PACKAGE `.mdl` corpus: the framing R2027a
% writes for `save_system(mdl, 'x.mdl')` from build 27.1.0.3409468 on. It is a
% third `.mdl` flavour, beside the two gen_mdl.m covers, and it is neither of them:
%
%   # Simulink Text Package
%   Model {                                   the legacy stub, as before
%     Version  27.1
%     ...
%   }
%   __MWSL_PACKAGE_BEGIN__ R2027a
%   __MWSL_PART_BEGIN__ /slcoreProperties.json
%   {...}
%   __MWSL_PART_BEGIN__ /simulink/modelWorkspace.mxarray
%   {"_array_type":"Struct", ...}             the workspace as MATLAB-array JSON
%   ...
%   __MWSL_PACKAGE_END__
%
% Every part is text: the XML and JSON parts a `.slx` zips, and the model workspace
% as the MATLAB-array JSON a text dictionary's values are spelled in, where the
% earlier R2027a build's `__MWOPC_` package base64'd the binary mxarray. The OPC
% bookkeeping parts (`[Content_Types].xml`, `_rels/`, `metadata/`) are not written;
% `/slcoreProperties.json` names the release instead.
%
% Each model is written as that `.mdl` and as its `.slx` twin, and the truth is what
% MATLAB reports about the model opened from each, so a test can hold the two files
% to each other and to MATLAB:
%
%   mdltext.mdl / .slx        blocks whose parameters name workspace variables, a
%                             nested subsystem, a masked subsystem, a model
%                             reference, a linked data dictionary, two config sets
%                             (the second active), and a Model File workspace of
%                             double, matrix, struct, cell, char, int16, logical
%                             and a Simulink.Parameter
%   mdltext_empty.mdl / .slx  a model whose workspace holds nothing
%   mdltext_mat.mdl / .slx    a model whose workspace is kept in a MAT-file, so the
%                             file names the MAT-file and holds no workspace
%   mdltext_truth.json        what MATLAB says about each model, from each file
%
% Every model's Creator and ModifiedBy are set to `fixture` before it is saved, so
% no account name reaches a committed file.
%
% Run:  matlab -nodesktop -batch "run('<abs path>/gen_mdl_text.m')"
%
% Prints `GEN_MDL_TEXT OK`. Honours an `outdir` set by the caller, like gen_mdl.m,
% and writes only into `<outdir>/mdltext` and a scratch directory under tempdir.

here = fileparts(mfilename('fullpath'));
if ~exist('outdir', 'var') || isempty(outdir)
    outdir = fullfile(here, '..', 'artifacts');
end
txtdir = fullfile(outdir, 'mdltext');
if ~exist(txtdir, 'dir'), mkdir(txtdir); end

% The `.mdl` and its `.slx` twin are written to two scratch directories and moved
% in afterwards: save_system to <name>.slx beside <name>.mdl is an in-place format
% upgrade, which deletes the `.mdl`.
scratch = fullfile(tempdir, 'gen_mdl_text_scratch');
if exist(scratch, 'dir'), rmdir(scratch, 's'); end
mdlScratch = fullfile(scratch, 'mdl');
slxScratch = fullfile(scratch, 'slx');
mkdir(scratch); mkdir(mdlScratch); mkdir(slxScratch);
cd(scratch);
bdclose all;
Simulink.data.dictionary.closeAll('-discard');

%% ---- what the models point at, which is not part of the corpus ------------
% Only their NAMES are recorded in a model file.
dd = Simulink.data.dictionary.create(fullfile(scratch, 'mdltextparams.sldd'));
ds = getSection(dd, 'Design Data');
addEntry(ds, 'Kp', Simulink.Parameter(3.5));
saveChanges(dd);
clear ds; dd.close();

child = 'mdltext_child';
new_system(child);
add_block('simulink/Ports & Subsystems/In1',  [child '/In1']);
add_block('simulink/Ports & Subsystems/Out1', [child '/Out1']);
add_line(child, 'In1/1', 'Out1/1');
neutral(child);
save_system(child, fullfile(scratch, [child '.slx']));
close_system(child, 0);

a = 5; M = magic(3); %#ok<NASGU>
save(fullfile(mdlScratch, 'mdltext_mat_data.mat'), 'a', 'M');
copyfile(fullfile(mdlScratch, 'mdltext_mat_data.mat'), slxScratch);
addpath(scratch);

truth = struct();

%% ---- mdltext: everything the readers report -------------------------------
mdl = 'mdltext';
new_system(mdl);
% The same catalog gen_mdl.m builds, for the same reasons -- see its header and
% the README -- plus a Parameter-valued Gain and a masked subsystem.
add_block('simulink/Sources/Constant', [mdl '/Const'], 'Value', 'Kp');
add_block('simulink/Math Operations/Gain', [mdl '/Gain'], 'Gain', 'gainP');
add_block('simulink/Continuous/Transfer Fcn', [mdl '/TF'], ...
          'Numerator', '[1]', 'Denominator', '[tau 1]');
add_block('simulink/Discontinuities/Saturation', [mdl '/Sat'], ...
          'UpperLimit', 'Inf', 'LowerLimit', '-Inf');
add_block('simulink/Math Operations/Sum', [mdl '/Sum'], 'Inputs', '|++');
add_block('simulink/Sources/Constant', [mdl '/Two' char(10) 'Lines'], 'Value', 'grid(2,3)');
add_block('built-in/Subsystem', [mdl '/Sub']);
add_block('simulink/Math Operations/Gain', [mdl '/Sub/InnerGain'], 'Gain', 'inner');
add_block('built-in/Subsystem', [mdl '/Masked']);
add_block('simulink/Math Operations/Gain', [mdl '/Masked/MGain'], 'Gain', 'g');
mk = Simulink.Mask.create([mdl '/Masked']);
mk.addParameter('Name', 'g', 'Type', 'edit', 'Value', 'cfg.gain');
mk.addParameter('Name', 'mode', 'Type', 'popup', 'TypeOptions', {'label', 'other'}, ...
    'Value', 'label');
add_block('built-in/ModelReference', [mdl '/Child'], 'ModelNameDialog', child);
add_line(mdl, 'Const/1', 'Gain/1');
set_param(mdl, 'DataDictionary', 'mdltextparams.sldd');

ws = get_param(mdl, 'ModelWorkspace');
assignin(ws, 'tau',   0.25);
assignin(ws, 'grid',  [1 2 3; 4 5 6]);
assignin(ws, 'cfg',   struct('mode', 'fast', 'gain', 2));
assignin(ws, 'names', {'alpha', 'beta'});
assignin(ws, 'label', 'hello');
assignin(ws, 'inner', int16(-3));
assignin(ws, 'flag',  true);
p = Simulink.Parameter(2.5);
p.Description = 'gain';
assignin(ws, 'gainP', p);

cs = getConfigSet(mdl, 'Configuration');
fast = cs.copy();
fast.Name = 'Fast';
attachConfigSet(mdl, fast, true);
setActiveConfigSet(mdl, 'Fast');
truth.mdltext = writePair(mdl, mdlScratch, slxScratch, txtdir);

%% ---- mdltext_empty: a workspace holding nothing ---------------------------
mdl = 'mdltext_empty';
new_system(mdl);
add_block('simulink/Sources/Constant', [mdl '/Const'], 'Value', 'Kp');
set_param(mdl, 'DataDictionary', 'mdltextparams.sldd');
truth.mdltext_empty = writePair(mdl, mdlScratch, slxScratch, txtdir);

%% ---- mdltext_mat: a workspace kept in a MAT-file --------------------------
mdl = 'mdltext_mat';
new_system(mdl);
add_block('simulink/Sources/Constant', [mdl '/Const'], 'Value', 'a');
add_block('simulink/Math Operations/Gain', [mdl '/Gain'], 'Gain', 'M(2,2)');
add_line(mdl, 'Const/1', 'Gain/1');
cd(mdlScratch);
ws = get_param(mdl, 'ModelWorkspace');
ws.DataSource = 'MAT-File';
ws.FileName = 'mdltext_mat_data.mat';
ws.reload;
truth.mdltext_mat = writePair(mdl, mdlScratch, slxScratch, txtdir);
cd(scratch);

%% ---- what MATLAB itself is ------------------------------------------------
truth.matlab = struct('version', version, 'release', version('-release'));
writeJson(fullfile(txtdir, 'mdltext_truth.json'), truth);

rmpath(scratch);
Simulink.data.dictionary.closeAll('-discard');
cd(tempdir);
disp('GEN_MDL_TEXT OK');


% ---------------------------------------------------------------------------
% Save one model as the text package `.mdl`, reopen that file and save it as the
% `.slx` twin, move both into the corpus, and record the truth from each.
function t = writePair(mdl, mdlScratch, slxScratch, txtdir)
    neutral(mdl);
    mdlFile = fullfile(mdlScratch, [mdl '.mdl']);
    save_system(mdl, mdlFile);
    close_system(mdl, 0);
    open_system(mdlFile);
    slxFile = fullfile(slxScratch, [mdl '.slx']);
    save_system(mdl, slxFile);
    close_system(mdl, 0);
    fromMdl = modelTruth(mdl, mdlFile);
    fromSlx = modelTruth(mdl, slxFile);
    % The two files are one model to MATLAB, or the corpus is not a pair.
    assert(isequal(jsonencode(fromMdl), jsonencode(fromSlx)), ...
        'MATLAB reads %s.mdl and %s.slx differently', mdl, mdl);
    t = fromMdl;
    t.files = struct('mdl', [mdl '.mdl'], 'slx', [mdl '.slx']);
    copyfile(mdlFile, fullfile(txtdir, [mdl '.mdl']), 'f');
    copyfile(slxFile, fullfile(txtdir, [mdl '.slx']), 'f');
end

% No account name in a committed file: the creator and the modifier MATLAB would
% otherwise take from the account that ran this.
function neutral(mdl)
    set_param(mdl, 'Creator', 'fixture', 'ModifiedByFormat', 'fixture');
end

% The shared modelTruth shape of gen_mdl.m and gen_slx.m (test/parity/matlab/
% loadTruth.ts), plus the workspace's source file and the Creator, each mask's names,
% values and types, and a level down into each value mat2str cannot spell whole.
function t = modelTruth(mdl, file)
    open_system(file);
    t = struct();
    t.name           = get_param(mdl, 'Name');
    t.release        = version('-release');
    t.dataDictionary = get_param(mdl, 'DataDictionary');
    t.wsDataSource   = get_param(mdl, 'ModelWorkspace').DataSource;
    t.wsFileName     = '';
    if ~strcmp(t.wsDataSource, 'Model File')
        t.wsFileName = get_param(mdl, 'ModelWorkspace').FileName;
    end
    t.creator        = get_param(mdl, 'Creator');

    csNames = getConfigSets(mdl);
    active  = getActiveConfigSet(mdl).Name;
    cfgs = struct('name', {}, 'active', {}, 'class', {}, 'sourceName', {});
    for i = 1:numel(csNames)
        c = getConfigSet(mdl, csNames{i});
        cfgs(i).name   = csNames{i};
        cfgs(i).active = strcmp(csNames{i}, active);
        cfgs(i).class  = class(c);
        src = '';
        try
            if isprop(c, 'SourceName'), src = c.SourceName; end
        catch
        end
        cfgs(i).sourceName = src;
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
    masks = struct('name', {}, 'names', {}, 'values', {}, 'types', {});
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
        if strcmp(get_param(blks{i}, 'Mask'), 'on')
            mm = Simulink.Mask.get(blks{i});
            k = numel(masks) + 1;
            masks(k).name   = get_param(blks{i}, 'Name');
            masks(k).names  = get_param(blks{i}, 'MaskNames');
            masks(k).values = get_param(blks{i}, 'MaskValues');
            masks(k).types  = arrayfun(@(q) q.Type, mm.Parameters, 'UniformOutput', false);
        end
    end
    t.blocks = blocks;
    t.masks = masks;

    ws = get_param(mdl, 'ModelWorkspace');
    vars = struct();
    if strcmp(t.wsDataSource, 'Model File')
        w = ws.whos;
        vnames = sort({w.name});
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
            % What mat2str cannot spell whole, spelled a level down: a struct's fields
            % in MATLAB's order, a cell's elements, a Parameter's Value.
            if isstruct(v) && isscalar(v)
                e.fields = struct();
                f = fieldnames(v);
                for j = 1:numel(f)
                    e.fields.(f{j}) = mat2str(v.(f{j}));
                end
            end
            if iscell(v)
                e.elements = cellfun(@mat2str, v(:)', 'UniformOutput', false);
            end
            if isa(v, 'Simulink.Parameter')
                e.value = mat2str(v.Value);
                e.description = v.Description;
            end
            vars.(n) = e;
        end
    end
    t.workspace = vars;
    close_system(mdl, 0);
end

function writeJson(path, data)
    fid = fopen(path, 'w');
    fprintf(fid, '%s', jsonencode(data, 'PrettyPrint', true));
    fclose(fid);
end
