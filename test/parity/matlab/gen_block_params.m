% Copyright 2026 The MathWorks, Inc.
%
% Generator for the CHOICE-PARAMETER table: every (BlockType, parameter) pair in the
% standard libraries whose dialog restricts the value to a fixed set of options, so no
% value it can ever hold names workspace data.
%
% Run:  matlab -nodesktop -batch "run('<abs path>/gen_block_params.m')"
%
% Writes `enumBlockParams.ts` — the RUNTIME table, generated straight into src/ because
% the parser needs it at parse time, not a fixture a test reads. `outdir` overrides the
% destination so drift.mjs can regenerate into a scratch directory and diff.
%
% WHY THE TABLE IS THE PARAMETER TYPE AND NOT SOMETHING CLEVERER
%
% The question this answers is "can `<P Name="Operator">square</P>` be a reference to
% data?", and the file records nothing that says. Three rules were measured; two are
% wrong, and both wrong ones fail by HIDING REAL REFERENCES — the direction that costs a
% user a Usage cell they needed (issue #9), which is why the parser's own gate is a
% blocklist and not an allowlist. They are recorded here so they are not re-derived:
%
%   1. `Attributes` contains `dont-eval`.  REFUTED. findVars credits a variable used in a
%      dont-eval `SampleTime` and in a dont-eval `OutMin`. 654 parameter names carry the
%      attribute and blocklisting them would have deleted `SampleTime = Ts`.
%
%   2. `set_param(blk, param, 'anIdentifier')` throws.  REFUTED, twice over. With the
%      identifier UNDEFINED, seven expression parameters throw for the wrong reason —
%      `Scope|TimeSpan` refuses with "Variable 'x' must be defined in the base
%      workspace", which is Simulink confirming the parameter IS an expression. Defining
%      it first fixes those and breaks the scan a second way: a set_param that now
%      succeeds mutates the block, so later parameters of the same block are probed in a
%      state the earlier ones changed and the refusal count moves with scan ORDER
%      (682 -> 765 pairs). An order-dependent measurement cannot be a committed table.
%
%   3. `DialogParameters.(param).Type` is `enum` or `dynamic enum`.  WHAT THIS USES.
%      Read-only, so it mutates nothing and cannot depend on scan order — measured
%      byte-identically by two independent scans (1905 pairs, 343 of them enum-family,
%      zero disagreements). And it is the fact that matters rather than a proxy for it:
%      an enum parameter's value space IS its option list, which set_param enforces
%      ("Invalid setting in Math block for parameter 'Operator'"), so a model file cannot
%      hold a variable there and still load.
%
% NOT COVERED, deliberately: a free-text parameter that happens never to name data, such
% as a Bus Selector's `OutputSignals` (signal names) or a Model block's `ModelNameDialog`
% (a file name). Those are not derivable from any dialog property — they are findVars
% behaviour — so they are a hand list in SlxParser with the measurement recorded beside
% them. This generator must not guess at them.
%
% SCOPE: `simulink` and `simulink_extras`. A toolbox block outside them contributes
% nothing, which is the safe direction: an unknown (BlockType, parameter) pair is simply
% not in the table, so nothing about it is suppressed.

here = fileparts(mfilename('fullpath'));
if ~exist('outdir', 'var') || isempty(outdir)
    outdir = fullfile(here, '..', '..', '..', 'src', 'datamodel', 'parser');
end
outfile = fullfile(outdir, 'enumBlockParams.ts');

libs = {'simulink', 'simulink_extras'};
% A scratch model holds one copy of every library block: DialogParameters is only
% answerable on an instance, and a library block's own handle refuses most queries.
%
% Two tallies rather than one, because a BlockType has MANY instances in the libraries and
% they need not agree. `SubSystem|OutDataTypeStr` is the case that forced this: a masked
% subsystem promoting that parameter presents it as an option list, while a plain
% SubSystem's is free text that can name a `Simulink.NumericType`. A pair is emitted only
% when it was an option list on EVERY instance that has it — one free-text sighting
% disqualifies it, since suppressing a real expression is the expensive direction.
enumSeen = containers.Map();
otherSeen = containers.Map();
scratch = 'genBlockParams';
if bdIsLoaded(scratch), bdclose(scratch); end
new_system(scratch); load_system(scratch);
nblocks = 0;
for L = libs
    lib = L{1};
    try
        load_system(lib);
    catch e
        fprintf('SKIP library %s: %s\n', lib, e.message);
        continue;
    end
    blks = find_system(lib, 'LookUnderMasks', 'all', 'FollowLinks', 'on', 'Type', 'block');
    for b = 1:numel(blks)
        nblocks = nblocks + 1;
        tgt = sprintf('%s/x%d', scratch, nblocks);
        % A block that will not copy, will not report a BlockType, or has no dialog at
        % all contributes nothing. None of the three is worth failing the generator over:
        % a pair this scan misses is a pair the parser simply does not suppress.
        try, add_block(blks{b}, tgt); catch, continue; end
        try, bt = get_param(tgt, 'BlockType'); catch, continue; end
        try, dp = get_param(tgt, 'DialogParameters'); catch, continue; end
        if isempty(dp) || isempty(bt), continue; end
        for f = fieldnames(dp)'
            n = f{1};
            key = [bt '|' n];
            if strcmp(dp.(n).Type, 'enum') || strcmp(dp.(n).Type, 'dynamic enum')
                enumSeen(key) = 1;
            else
                otherSeen(key) = 1;
            end
        end
    end
end
bdclose(scratch);

% Unanimous option-list pairs, regrouped by BlockType.
found = containers.Map();
disqualified = {};
for K = keys(enumSeen)
    key = K{1};
    parts = strsplit(key, '|');
    if isKey(otherSeen, key)
        disqualified{end+1} = key; %#ok<AGROW>
        continue;
    end
    bt = parts{1};
    if isKey(found, bt), params = found(bt); else, params = {}; end
    params{end+1} = parts{2}; %#ok<AGROW>
    found(bt) = params;
end
if ~isempty(disqualified)
    fprintf('not emitted (an option list on some instances, free text on others):\n');
    for i = 1:numel(disqualified), fprintf('    %s\n', disqualified{i}); end
end

types = sort(keys(found));
npairs = 0;
for i = 1:numel(types), npairs = npairs + numel(found(types{i})); end

fid = fopen(outfile, 'w');
fprintf(fid, '// Copyright 2026 The MathWorks, Inc.\n');
fprintf(fid, '//\n');
fprintf(fid, '// GENERATED by test/parity/matlab/gen_block_params.m — do not hand-edit.\n');
fprintf(fid, '// Regenerate with:\n');
fprintf(fid, '//   matlab -nodesktop -batch "run(''<repo>/test/parity/matlab/gen_block_params.m'')"\n');
fprintf(fid, '// That generator''s header carries the measurement, its scope, and the two rules\n');
fprintf(fid, '// that were tried and refuted. Read it before changing anything here.\n');
fprintf(fid, '//\n');
fprintf(fid, '// Written by MATLAB %s from libraries: %s.\n', version('-release'), strjoin(libs, ', '));
fprintf(fid, '// %d block types, %d parameters.\n', numel(types), npairs);
fprintf(fid, '\n');
fprintf(fid, '/**\n');
fprintf(fid, ' * Parameters whose dialog restricts the value to a fixed option list, per BlockType.\n');
fprintf(fid, ' *\n');
fprintf(fid, ' * A value drawn from an option list never names data, however much it may LOOK like a\n');
fprintf(fid, ' * variable: a Math block''s `Operator` reads `square`, and crediting that would put the\n');
fprintf(fid, ' * block on the Usage cell of any variable spelled the same way. Simulink itself enforces\n');
fprintf(fid, ' * the option list, so no loadable model can hold a reference here.\n');
fprintf(fid, ' *\n');
fprintf(fid, ' * Keyed on the (BlockType, parameter) PAIR rather than the bare name, because the same\n');
fprintf(fid, ' * name can be an option list on one block and an expression on another — `Format`,\n');
fprintf(fid, ' * `SimulateUsing`, `TriggerType`, `OutDataTypeStr` and `IntermediateResultsDataTypeStr`\n');
fprintf(fid, ' * are each measured both ways. A name-keyed table would suppress the expression too.\n');
fprintf(fid, ' */\n');
fprintf(fid, 'export const ENUM_BLOCK_PARAMS: Readonly<Record<string, readonly string[]>> = {\n');
for i = 1:numel(types)
    bt = types{i};
    params = sort(found(bt));
    quoted = cellfun(@(p) ['''' p ''''], params, 'UniformOutput', false);
    fprintf(fid, '  %s: [%s],\n', tsKey(bt), strjoin(quoted, ', '));
end
fprintf(fid, '};\n');
fclose(fid);

fprintf('GEN_BLOCK_PARAMS OK  %d block types, %d parameters from %d blocks -> %s\n', ...
    numel(types), npairs, nblocks, outfile);

function k = tsKey(name)
% A BlockType that is not a bare JS identifier has to be quoted (`M-S-Function`).
if isempty(regexp(name, '^[A-Za-z_$][A-Za-z0-9_$]*$', 'once'))
    k = ['''' name ''''];
else
    k = name;
end
end
