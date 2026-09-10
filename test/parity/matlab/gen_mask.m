function gen_mask(outDir, mdlDir)
% GEN_MASK  Write the masked-subsystem usage fixture and record MATLAB's truth.
%
% The mask workspace is a resolution scope of its own — innermost, ahead of the model
% workspace — and a mask parameter's VALUE is an expression evaluated in the mask
% block's own enclosing scope. Neither fact is derivable from the file without knowing
% what MATLAB does with it, so this writes one model that exercises every arm and
% records `Simulink.findVars` beside it.
%
%   gen_mask('<repo>/test/fixtures')
%       maskUsage.slx, mask_truth.json — the fixture test/maskWorkspace.test.ts asserts
%       against. Any release will do.
%
%   gen_mask('/tmp/scratch', '<repo>/test/parity/artifacts/mdl')
%       and additionally mdlmask.slx + mdlmask_R2011b.mdl, the same diagram in the two
%       container formats that spell a mask differently — one element per parameter in a
%       package, three flat `Mask*` properties in the classic nested-brace text. Needs a
%       release that can still `ExportToVersion` a pre-R2012 `.mdl`: R2025a can, R2027a
%       cannot. Point outDir somewhere harmless when regenerating just this pair.

if nargin < 1
    outDir = pwd;
end
name = 'maskUsage';

buildMaskModel(name);
file = fullfile(outDir, [name '.slx']);
if exist(file, 'file'); delete(file); end
save_system(name, file);
fprintf('wrote %s\n', file);

% ---- record MATLAB's truth ----------------------------------------------------
truth = struct();
truth.model = name;
vars = Simulink.findVars(name);
list = {};
for k = 1:numel(vars)
    v = vars(k);
    entry = struct();
    entry.name = v.Name;
    entry.sourceType = char(string(v.SourceType));
    entry.source = char(string(v.Source));
    users = {};
    u = v.Users;
    for j = 1:numel(u)
        users{end+1} = char(string(u{j}));  %#ok<AGROW>
    end
    entry.users = users;
    list{end+1} = entry;  %#ok<AGROW>
end
truth.vars = list;

% Every mask, as MATLAB reports it — the names are the SCOPE, the values are the
% expressions, and the two are read separately.
masks = {};
for blk = {[name '/MulAdd'], [name '/Outer'], [name '/Outer/Inner']}
    entry = struct();
    entry.block = blk{1};
    entry.sid = get_param(blk{1}, 'SID');
    entry.names = get_param(blk{1}, 'MaskNames');
    entry.values = get_param(blk{1}, 'MaskValues');
    entry.types = {};
    mm = Simulink.Mask.get(blk{1});
    for p = 1:numel(mm.Parameters)
        entry.types{end+1} = mm.Parameters(p).Type;  %#ok<AGROW>
    end
    masks{end+1} = entry;  %#ok<AGROW>
end
truth.masks = masks;

json = fullfile(outDir, 'mask_truth.json');
fid = fopen(json, 'w');
fprintf(fid, '%s\n', jsonencode(truth, 'PrettyPrint', true));
fclose(fid);
fprintf('wrote %s\n', json);

% ---- echo it, so the run itself is readable ----------------------------------
fprintf('\nrelease: %s\n', version('-release'));
fprintf('\n=== findVars ===\n');
for k = 1:numel(list)
    e = list{k};
    fprintf('%-14s %-18s %s\n', e.name, e.sourceType, e.source);
    for j = 1:numel(e.users)
        fprintf('        USER %s\n', e.users{j});
    end
end
fprintf('\n=== masks ===\n');
for k = 1:numel(masks)
    e = masks{k};
    fprintf('%s (SID %s)\n', e.block, e.sid);
    for j = 1:numel(e.names)
        fprintf('    %-10s %-10s = %s\n', e.names{j}, e.types{j}, e.values{j});
    end
end
close_system(name, 0);

if nargin < 2 || isempty(mdlDir)
    return
end

% ---- the parity pair: the same diagram in both container formats ---------------
% A second model, named for what it is, because these two files are asserted against
% each other and not against the truth JSON. save_system to <name>.slx beside an
% existing <name>.mdl is an in-place format upgrade that REMOVES the .mdl, so the
% package goes down first and the classic export second.
pair = 'mdlmask';
buildMaskModel(pair);
if ~exist(mdlDir, 'dir'); mkdir(mdlDir); end
slx = fullfile(mdlDir, [pair '.slx']);
if exist(slx, 'file'); delete(slx); end
save_system(pair, slx);
fprintf('\nwrote %s\n', slx);
classic = fullfile(mdlDir, [pair '_R2011b.mdl']);
if exist(classic, 'file'); delete(classic); end
save_system(pair, classic, 'ExportToVersion', 'R2011b');
fprintf('wrote %s (%d bytes)\n', classic, dir(classic).bytes);
close_system(pair, 0);
end

function buildMaskModel(name)
% One diagram, every arm of the rule. Kept in one place so the fixture and the
% cross-format parity pair cannot drift apart.
close_system(name, 0);
new_system(name);

% ---- model workspace ----------------------------------------------------------
hws = get_param(name, 'ModelWorkspace');
hws.assignin('g1_param', 2);
hws.assignin('g2_param', 3);
hws.assignin('g3_param', 4);
hws.assignin('shadowed', 99);
hws.assignin('outer_param', 5);
hws.assignin('popupVar', 7);

% ---- a plain root block: the control case, ordinary model-workspace usage ------
add_block('built-in/Gain', [name '/RootGain'], 'Gain', 'g1_param', ...
    'Position', [50 50 80 80]);

% ---- MulAdd: one mask, every parameter flavour --------------------------------
add_block('built-in/SubSystem', [name '/MulAdd'], 'Position', [150 40 260 140]);
add_block('built-in/Gain', [name '/MulAdd/Gain'], 'Gain', 'g1', 'Position', [50 20 80 50]);
add_block('built-in/Gain', [name '/MulAdd/Gain1'], 'Gain', 'g2', 'Position', [50 80 80 110]);
add_block('built-in/Constant', [name '/MulAdd/Const'], 'Value', 'shadowed', 'Position', [50 140 80 170]);

m = Simulink.Mask.create([name '/MulAdd']);
m.addParameter('Name', 'g1', 'Type', 'edit', 'Value', 'g1_param');
m.addParameter('Name', 'g2', 'Type', 'edit', 'Value', '2*g2_param');
m.addParameter('Name', 'g3', 'Type', 'edit', 'Value', 'g3_param');   % never used inside
m.addParameter('Name', 'g5', 'Type', 'edit', 'Value', '5');          % numeric, no usage
m.addParameter('Name', 'shadowed', 'Type', 'edit', 'Value', '10');   % collides with a ws var
m.addParameter('Name', 'mode', 'Type', 'popup', 'TypeOptions', {'popupVar', 'other'}, ...
    'Value', 'popupVar');                                            % selection text, not a var
m.addParameter('Name', 'flag', 'Type', 'checkbox', 'Value', 'on');

% ---- Outer/Inner: nested masks ------------------------------------------------
add_block('built-in/SubSystem', [name '/Outer'], 'Position', [320 40 430 140]);
add_block('built-in/Gain', [name '/Outer/OuterGain'], 'Gain', 'o1', 'Position', [50 20 80 50]);
add_block('built-in/SubSystem', [name '/Outer/Inner'], 'Position', [150 20 260 120]);
add_block('built-in/Gain', [name '/Outer/Inner/Gain'], 'Gain', 'i1', 'Position', [50 20 80 50]);
add_block('built-in/Gain', [name '/Outer/Inner/Gain1'], 'Gain', 'o1', 'Position', [50 80 80 110]);

mo = Simulink.Mask.create([name '/Outer']);
mo.addParameter('Name', 'o1', 'Type', 'edit', 'Value', 'outer_param');

mi = Simulink.Mask.create([name '/Outer/Inner']);
mi.addParameter('Name', 'i1', 'Type', 'edit', 'Value', 'o1');  % reads the OUTER mask
mi.addParameter('Name', 'o1', 'Type', 'edit', 'Value', '7');   % shadows the OUTER mask
end
