% What does a `.slx` write for a `Simulink.ConfigSetRef`, in each layout era?
%
% docs/TODO.md item 15. The modern (R2026b+) JSON layout tells a config set REFERENCE
% from a config set by an `_object_class` field in `configSetN.json`, which
% `ModelSectionNode.addConfigSetEntry` reads. No file in the parity corpus contains a
% ConfigSetRef in ANY layout, so for the four XML eras nothing says what MATLAB puts
% there -- and `addConfigSetEntry` falls through to 'Simulink.ConfigSet' for all of
% them, while the oldest era's reader (`inlineConfigSets`, SlxParser.ts) filters on
% `ClassName == 'Simulink.ConfigSet'` and would DROP a ref entirely.
%
% Guessing is what item 15 forbids: the guess is `ClassName="Simulink.ConfigSetRef"`
% by analogy with the inline pre-R2015a form, and a synthesized fixture would only
% assert that guess against itself. So this probe asks MATLAB.
%
% What it must settle, per era (R2027a current, then R2025a / R2021a / R2018a / R2013b):
%   1. Does the ref SURVIVE the export at all? R2013b predates data dictionaries and
%      already drops the DataDictionary link (gen_slx.m records this), so it may drop
%      or resolve-and-inline the ref too. "Dropped" is a legitimate answer and would
%      mean the era needs no parser branch.
%   2. Which part carries it, and under what name -- configSetInfo + configSetN, or
%      inline in blockdiagram.xml.
%   3. Where the CLASS is recorded: an attribute (`ClassName=`?), an element, or
%      nowhere. "Nowhere" is also an answer, and would close item 15 as impossible
%      rather than unwritten.
%   4. Whether SourceName -- the thing a ref has and a set does not -- is written, since
%      that is a second, independent way to recognise one.
%
% Run: mw -using Bmain matlab -nodesktop -batch "run('test/parity/matlab/probe_configsetref.m')"

outdir = getenv('CFGREF_OUT');
if isempty(outdir), outdir = fullfile(tempdir, 'cfgref'); end
if exist(outdir, 'dir'), rmdir(outdir, 's'); end
mkdir(outdir);

Simulink.data.dictionary.closeAll('-discard');
bdclose('all');

fprintf('MATLAB %s\n', version);

%% ---- the config set a ref can point AT --------------------------------------
% Two candidate sources, because the API admits both and the probe should not
% presume which one a real model uses: a base-workspace variable, and an entry in a
% data dictionary's Configurations section. Whichever attaches is the one used.
srcName = '';
dictfile = fullfile(outdir, 'cfgref_dict.sldd');
% On the path BEFORE any set_param('DataDictionary', <bare filename>) below, or
% Simulink warns "unable to find data dictionary" and the ref resolves against
% nothing -- which then surfaces much later as an unexplained export failure.
addpath(outdir);
try
    dd = Simulink.data.dictionary.create(dictfile);
    cfgSec = getSection(dd, 'Configurations');
    % A Configurations entry's NAME is not free: it must equal the Name of the
    % ConfigSet it holds. MATLAB rejects the mismatch outright -- "Entry name
    % 'dictCfg' does not match the name of its value 'Configuration'" -- so the set
    % is renamed BEFORE it is added, not after.
    dictCfg = Simulink.ConfigSet;
    dictCfg.Name = 'dictCfg';
    addEntry(cfgSec, 'dictCfg', dictCfg);
    saveChanges(dd);
    clear cfgSec
    dd.close();
    fprintf('DICT ok  %s\n', dictfile);
catch e
    fprintf('DICT FAILED  %s\n', e.message);
end

baseCfg = Simulink.ConfigSet;         %#ok<NASGU>
baseCfg.Name = 'baseCfg';
assignin('base', 'baseCfg', baseCfg);

%% ---- a model carrying one ordinary set and one REF ---------------------------
mdl = 'cfgrefcases';
if bdIsLoaded(mdl), close_system(mdl, 0); end
new_system(mdl);
add_block('simulink/Sources/Constant', [mdl '/Const'], 'Value', '1');

modern = fullfile(outdir, [mdl '.slx']);
save_system(mdl, modern, 'OverwriteIfChangedOnDisk', true);

% Try the dictionary source first, then the base-workspace one. `attachConfigSet`
% with a ref is the documented call, but if it refuses, print why -- a refusal is
% itself a finding, since it would mean this model shape cannot exist.
attached = '';
try
    set_param(mdl, 'DataDictionary', 'cfgref_dict.sldd');
    csr = Simulink.ConfigSetRef;
    csr.Name = 'RefFromDict';
    csr.SourceName = 'dictCfg';
    attachConfigSet(mdl, csr);
    attached = 'RefFromDict';
    srcName = 'dictCfg';
    fprintf('ATTACH dict-sourced ref ok\n');
catch e
    fprintf('ATTACH dict-sourced ref FAILED  %s\n', e.message);
end
if isempty(attached)
    try
        set_param(mdl, 'DataDictionary', '');
        csr = Simulink.ConfigSetRef;
        csr.Name = 'RefFromBase';
        csr.SourceName = 'baseCfg';
        attachConfigSet(mdl, csr);
        attached = 'RefFromBase';
        srcName = 'baseCfg';
        fprintf('ATTACH base-sourced ref ok\n');
    catch e
        fprintf('ATTACH base-sourced ref FAILED  %s\n', e.message);
    end
end
if isempty(attached)
    disp('CFGREF NO REF ATTACHED -- nothing further to probe');
    return
end

% What MATLAB itself thinks is attached, so the file dumps below have a truth to be
% read against.
sets = getConfigSets(mdl);
fprintf('\nSETS ON THE MODEL\n');
for i = 1:numel(sets)
    c = getConfigSet(mdl, sets{i});
    extra = '';
    try
        if isprop(c, 'SourceName') || isfield(c, 'SourceName')
            extra = sprintf(' SourceName=%s', c.SourceName);
        end
    catch
    end
    fprintf('  %-14s class=%-24s active=%d%s\n', sets{i}, class(c), ...
            strcmp(sets{i}, getActiveConfigSet(mdl).Name), extra);
end

save_system(mdl, modern, 'OverwriteIfChangedOnDisk', true);

%% ---- the current release, then one export per era ----------------------------
dumpSlx('R2027a-current', modern, outdir, attached, srcName);

eras = {'R2025a', 'R2021a', 'R2018a', 'R2013b'};
for i = 1:numel(eras)
    ver = eras{i};
    target = fullfile(outdir, sprintf('%s_%s.slx', mdl, ver));
    bdclose('all');
    % Refer to the model by the name the LOADED file actually has, never by `mdl`:
    % save_system(sys, newpath) renames the in-memory model to the new basename, so
    % after one export `mdl` no longer names anything and every later
    % getConfigSets(mdl) throws -- which this loop's own catch would then misreport
    % as the export having failed.
    h = load_system(modern);
    mname = get_param(h, 'Name');
    lastwarn('');
    try
        save_system(mname, target, 'ExportToVersion', ver, 'OverwriteIfChangedOnDisk', true);
        [wmsg, ~] = lastwarn;
        fprintf('\nEXPORT %s ok  warning=%s\n', ver, strtrim(wmsg));
        % What the exported file itself believes, reopened: this is how "the ref was
        % silently resolved into a plain set" would show up, which no byte dump of
        % ours could distinguish from a naming difference.
        bdclose('all');
        try
            h2 = load_system(target);
            rname = get_param(h2, 'Name');
            rs = getConfigSets(rname);
            for k = 1:numel(rs)
                c = getConfigSet(rname, rs{k});
                src = '';
                try
                    if isprop(c, 'SourceName'), src = sprintf(' SourceName=%s', c.SourceName); end
                catch
                end
                fprintf('  reopened set %-14s class=%-24s%s\n', rs{k}, class(c), src);
            end
        catch e2
            % A ref that cannot be resolved on reopen is a FINDING, not a probe
            % failure: it means the era kept the reference but lost its target.
            fprintf('  REOPEN %s reported: %s\n', ver, e2.message);
        end
        bdclose('all');
        dumpSlx(ver, target, outdir, attached, srcName);
    catch e
        fprintf('\nEXPORT %s FAILED  %s\n', ver, e.message);
    end
end

bdclose('all');
if ~isempty(strfind(path, outdir)), rmpath(outdir); end
Simulink.data.dictionary.closeAll('-discard');
fprintf('\nFILES IN %s\n', outdir);
listing = dir(fullfile(outdir, '*.slx'));
for i = 1:numel(listing)
    fprintf('  %-40s %d bytes\n', listing(i).name, listing(i).bytes);
end
disp('CFGREF OK');


% ---------------------------------------------------------------------------
% Unzip one .slx and print every part that could carry a config set, plus every
% line of it that mentions the ref by name, its source, or a class attribute.
% Prints the whole part when it is small, because for the oldest era the QUESTION
% is what the surrounding structure looks like, not just one line of it.
function dumpSlx(label, file, outdir, refName, srcName)
    fprintf('\n===== %s : %s\n', label, file);
    % NOT `exist(file,'file') ~= 2`: exist() answers 4, not 2, for a Simulink model
    % file (.slx/.mdl), so that test calls every file this probe writes MISSING.
    % dir() has no such special case.
    if isempty(dir(file))
        fprintf('  MISSING\n');
        return
    end
    zdir = fullfile(outdir, ['unzip_' matlab.lang.makeValidName(label)]);
    if exist(zdir, 'dir'), rmdir(zdir, 's'); end
    try
        names = unzip(file, zdir);
    catch e
        fprintf('  UNZIP FAILED %s\n', e.message);
        return
    end
    fprintf('  PARTS:\n');
    for j = 1:numel(names)
        if exist(names{j}, 'file') ~= 2, continue, end
        d = dir(names{j});
        fprintf('    %-52s %d bytes\n', strrep(names{j}, [zdir filesep], ''), d.bytes);
    end
    for j = 1:numel(names)
        if exist(names{j}, 'file') ~= 2, continue, end
        [~, base, ext] = fileparts(names{j});
        if isempty(regexpi([base ext], 'config|blockdiagram|blockDiagram', 'once')), continue, end
        body = '';
        try
            body = fileread(names{j});
        catch
            fprintf('  --- %s%s UNREADABLE (binary?)\n', base, ext);
            continue
        end
        rel = strrep(names{j}, [zdir filesep], '');
        pretty = regexprep(body, '>\s*<', sprintf('>\n<'));
        lines = strsplit(pretty, newline);
        hits = {};
        for L = 1:numel(lines)
            if ~isempty(regexpi(lines{L}, ['ConfigSetRef|ClassName|_object_class|SourceName|' ...
                                           regexptranslate('escape', refName) '|' ...
                                           regexptranslate('escape', srcName) '|ActiveConfigurationSet|ConfigurationSet'], 'once'))
                hits{end+1} = strtrim(lines{L}); %#ok<AGROW>
            end
        end
        if isempty(hits) && numel(body) > 4000, continue, end
        fprintf('  --- %s (%d bytes)\n', rel, numel(body));
        if numel(body) <= 3000
            fprintf('%s\n', pretty);
        else
            for h = 1:min(numel(hits), 40)
                fprintf('      %s\n', hits{h});
            end
        end
    end
end
