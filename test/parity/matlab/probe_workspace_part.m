% Copyright 2026 The MathWorks, Inc.
%
% What MATLAB writes of a .slx's model workspace part as a model gains its first variable and loses
% its last, in this release's layout and each export's (R2025a, R2021a, R2018a), and the order it
% writes variables in. ModelFileWriter writes a save so.
%
% Measured on R2027a (2026-11-03):
%   - a model that keeps no variable holds no workspace part; its first variable adds three things,
%     the part (simulink/modelWorkspace.mxarray, before R2019b simulink/modelworkspace.mat), a
%     Default of the part's extension in [Content_Types].xml (mxarray+binary, mat+binary) and a
%     `modelWorkspace` Relationship in _rels/.rels, each in its file's order (by extension, by id),
%     one per line; nothing else in the package changes, and deleting the last takes all three away;
%   - variables are written in the order of their characters' codes: A_, Alpha, Beta, a1, a10, a2,
%     a_, alpha, b, beta, zeta.
%
% Run: env WORKSPACE_PART_OUT=/tmp/wspart mw -using Bmain matlab -nodesktop \
%          -batch "run('$PWD/test/parity/matlab/probe_workspace_part.m')"
% Writes part_life.json there. Prints PROBE_PART_LIFE OK.
outdir = getenv('WORKSPACE_PART_OUT');
if isempty(outdir), outdir = fullfile(tempdir, 'wspart'); end
if ~exist(outdir, 'dir'), mkdir(outdir); end
cd(outdir); bdclose('all');
report = struct('era', {}, 'state', {}, 'members', {}, 'contentTypes', {}, 'rels', {});
eras = {'', 'R2025a', 'R2021a', 'R2018a'};
states = {'none', 'one', 'emptied'};
mdl = 'plife';
new_system(mdl);
add_block('simulink/Sources/Constant', [mdl '/C'], 'Value', '1');
add_block('simulink/Sinks/Terminator', [mdl '/T']);
add_line(mdl, 'C/1', 'T/1');
for s = 1:numel(states)
  ws = get_param(mdl, 'ModelWorkspace');
  switch states{s}
    case 'one', assignin(ws, 'k', 1);
    case 'emptied', clear(ws, 'k');
  end
  base = fullfile(outdir, sprintf('%s_%s.slx', mdl, states{s}));
  save_system(mdl, base, 'OverwriteIfChangedOnDisk', true);
  for e = 1:numel(eras)
    target = base;
    if ~isempty(eras{e})
      target = fullfile(outdir, sprintf('%s_%s_%s.slx', mdl, states{s}, eras{e}));
      save_system(get_param(bdroot, 'Name'), target, 'ExportToVersion', eras{e}, 'OverwriteIfChangedOnDisk', true);
      bdclose('all'); load_system(base); mdl = get_param(bdroot, 'Name');
    end
    unz = fullfile(outdir, ['unz_' states{s} '_' eras{e}]);
    files = unzip(target, unz);
    members = sort(strrep(files, [unz filesep], ''));
    ct = fileread(fullfile(unz, '[Content_Types].xml'));
    rels = {};
    for k = 1:numel(members)
      if endsWith(members{k}, '.rels')
        rels{end+1} = [members{k} ': ' regexprep(fileread(fullfile(unz, members{k})), '\s+', ' ')]; %#ok<AGROW>
      end
    end
    era = eras{e}; if isempty(era), era = 'R2027a'; end
    report(end+1) = struct('era', era, 'state', states{s}, 'members', {members}, 'contentTypes', regexprep(ct, '\s+', ' '), 'rels', {rels}); %#ok<SAGROW>
  end
end
bdclose('all');
% Field order: variables assigned out of order, the order the part holds them in.
new_system('porder');
ws = get_param('porder', 'ModelWorkspace');
names = {'zeta', 'Alpha', 'alpha', 'beta', 'Beta', 'a1', 'a10', 'a2', 'A_', 'a_', 'b'};
for k = numel(names):-1:1, assignin(ws, names{k}, k); end
save_system('porder', fullfile(outdir, 'porder.slx'), 'OverwriteIfChangedOnDisk', true);
unzip(fullfile(outdir, 'porder.slx'), fullfile(outdir, 'unz_order'));
fid = fopen(fullfile(outdir, 'unz_order', 'simulink', 'modelWorkspace.mxarray'), 'r'); b = fread(fid, inf, '*uint8'); fclose(fid);
S = getArrayFromByteStream(b);
order = fieldnames(S)';
bdclose('all');
fid = fopen(fullfile(outdir, 'part_life.json'), 'w'); fwrite(fid, jsonencode(struct('lifecycle', report, 'order', {order}), 'PrettyPrint', true)); fclose(fid);
disp('PROBE_PART_LIFE OK');
