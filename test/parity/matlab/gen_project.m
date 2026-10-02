function gen_project(outDir)
% GEN_PROJECT  Write one small project in all four definition-file formats, and
% record what MATLAB says each of them holds.
%
% A project's metadata has no schema and four on-disk shapes, chosen by
% `matlab.project.convertDefinitionFiles`. Three are XML trees this package reads;
% the fourth is `matlab.toml`, which it does not. Until this generator existed the
% project suite's stores were hand-typed from reading a real project, which is the
% one thing `README.md` says never to do: a misread convention goes into the
% fixture and the test then agrees with it.
%
% So this builds a project carrying one of everything the seven collection readers
% look for — files, a folder, a label definition and two labelled files, a path
% folder, a referenced project, two startup files and a shutdown file, a shortcut,
% and three working folders — converts it four times, and harvests the whole tree
% each time. The projects are small enough to commit and complete enough to open:
% every `<Format>/parityProject/parityProject.prj` is a real project a host can be
% pointed at.
%
% Truth is recorded PER FORMAT, from the converted project, not once from the
% original. That is the part worth having: MATLAB itself saying all four shapes
% describe the same project is the authority a cross-format parity test needs, and
% it gives the unread Toml case an expectation too. `definitionFilesType` is
% MATLAB's own name for the layout, which is what keeps our `format` strings from
% being labels we invented.
%
% TWO STARTUP FILES on purpose: run order is a linked list in the store and
% MATLAB reports it as an ordered array, so one file of each kind would leave the
% ordering unasserted.
%
%   gen_project                      % writes ../artifacts/project/
%   gen_project('/tmp/scratch')      % somewhere harmless, to diff against it
%
% Prints GEN_PROJECT OK.

if nargin < 1 || isempty(outDir)
    outDir = fullfile(fileparts(mfilename('fullpath')), '..', 'artifacts', 'project');
end
if ~exist(outDir, 'dir'); mkdir(outDir); end

FORMATS = {'SingleFile', 'FixedPathMultiFile', 'MultiFile', 'Toml'};

scratch = tempname;
mkdir(scratch);
src = fullfile(scratch, 'src');
mkdir(src);

buildProjects(src);

truth = struct();
truth.release = version('-release');
truth.version = version();
truth.formats = struct();

for k = 1:numel(FORMATS)
    fmt = FORMATS{k};

    % Convert a COPY each time: the conversion is not reversible, and all four
    % formats have to come from one and the same project for the parity claim to
    % mean anything.
    work = fullfile(scratch, fmt);
    copyfile(src, work);
    root = fullfile(work, 'parityProject');

    % Capture MATLAB's own warning for the conversion. The Toml conversion is
    % LOSSY and says so; recording the sentence verbatim makes that MATLAB's
    % statement rather than our inference from a diff.
    lastwarn('');
    matlab.project.convertDefinitionFiles(root, matlab.project.DefinitionFiles.(fmt));
    [wmsg, wid] = lastwarn();

    truth.formats.(fmt) = recordTruth(root);
    truth.formats.(fmt).convertWarning = char(wmsg);
    truth.formats.(fmt).convertWarningId = char(wid);

    target = fullfile(outDir, fmt);
    if exist(target, 'dir'); rmdir(target, 's'); end
    copyfile(work, target);
    fprintf('wrote %s\n', target);
end

jsonFile = fullfile(outDir, 'project_truth.json');
fid = fopen(jsonFile, 'w');
fprintf(fid, '%s\n', jsonencode(truth, 'PrettyPrint', true));
fclose(fid);
fprintf('wrote %s\n', jsonFile);

rmdir(scratch, 's');
fprintf('GEN_PROJECT OK\n');
end

% -------------------------------------------------------------------------------
function buildProjects(parent)
% The referenced project first — a reference needs its target to exist on disk
% before `addReference` will take it.

libRoot = fullfile(parent, 'parityLib');
mkdir(libRoot);
writeFile(fullfile(libRoot, 'libfun.m'), { ...
    'function y = libfun(x)', ...
    'y = 2 * x;', ...
    'end'});
lib = matlab.project.createProject('Folder', libRoot, 'Name', 'parityLib');
addFile(lib, fullfile(libRoot, 'libfun.m'));
close(lib);

root = fullfile(parent, 'parityProject');
mkdir(root);
mkdir(fullfile(root, 'utils'));
mkdir(fullfile(root, 'cache'));
mkdir(fullfile(root, 'codegen'));
writeFile(fullfile(root, 'main.m'), {'disp(helper(1));'});
writeFile(fullfile(root, 'utils', 'helper.m'), { ...
    'function y = helper(x)', ...
    'y = x + 1;', ...
    'end'});
writeFile(fullfile(root, 'utils', 'notes.txt'), {'A member that is not code.'});
writeFile(fullfile(root, 'startup_one.m'), {'disp("parity startup one");'});
writeFile(fullfile(root, 'startup_two.m'), {'disp("parity startup two");'});
writeFile(fullfile(root, 'shutdown_parity.m'), {'disp("parity shutdown");'});

proj = matlab.project.createProject('Folder', root, 'Name', 'parityProject');

mainFile = addFile(proj, fullfile(root, 'main.m'));
addFolderIncludingChildFiles(proj, fullfile(root, 'utils'));
addFile(proj, fullfile(root, 'startup_one.m'));
addFile(proj, fullfile(root, 'startup_two.m'));
addFile(proj, fullfile(root, 'shutdown_parity.m'));

% A built-in category, and a custom one carrying data — the two shapes the label
% catalog reader has to tell apart.
addLabel(mainFile, 'Classification', 'Design');
cat = createCategory(proj, 'Review', 'char');
createLabel(cat, 'Checked');
helperFile = findFile(proj, fullfile(root, 'utils', 'helper.m'));
addLabel(helperFile, 'Review', 'Checked', 'by parity');

addPath(proj, fullfile(root, 'utils'));

% Order matters here and is asserted: MATLAB runs startup files top-down.
addStartupFile(proj, fullfile(root, 'startup_one.m'));
addStartupFile(proj, fullfile(root, 'startup_two.m'));
addShutdownFile(proj, fullfile(root, 'shutdown_parity.m'));

% A shortcut, so the entry-point reader's third kind is covered too.
addShortcut(proj, fullfile(root, 'main.m'));

addReference(proj, libRoot);

proj.SimulinkCacheFolder = fullfile(root, 'cache');
proj.SimulinkCodeGenFolder = fullfile(root, 'codegen');
proj.ProjectStartupFolder = fullfile(root, 'utils');

close(proj);
end

% -------------------------------------------------------------------------------
function truth = recordTruth(root)
% What MATLAB says this project holds. Every path is recorded RELATIVE to the
% project root with forward slashes, so the record is the same on any machine and
% in any temporary directory — an absolute path here would be a fixture that only
% ever matches the machine that generated it.

proj = matlab.project.loadProject(root);

truth = struct();
truth.name = char(proj.Name);
truth.definitionFilesType = char(string(proj.DefinitionFilesType));

files = {};
for k = 1:numel(proj.Files)
    f = proj.Files(k);
    abs = char(f.Path);
    entry = struct();
    entry.path = relPath(root, abs);
    entry.isFolder = isfolder(abs);
    labels = {};
    for j = 1:numel(f.Labels)
        L = f.Labels(j);
        lab = struct();
        lab.category = char(L.CategoryName);
        lab.name = char(L.Name);
        if isempty(L.Data)
            lab.data = '';
        else
            lab.data = char(string(L.Data));
        end
        labels{end+1} = lab; %#ok<AGROW>
    end
    entry.labels = sortByField(labels, 'name');
    files{end+1} = entry; %#ok<AGROW>
end
truth.files = sortByField(files, 'path');

truth.pathFolders = sortCell(relPaths(root, pathsOf(proj.PathFolders)));

% NOT sorted: these two are in MATLAB's run order, which is the thing being
% asserted. Sorting them would quietly delete the claim.
truth.startupFiles = relPaths(root, cellstr(string(proj.StartupFiles)));
truth.shutdownFiles = relPaths(root, cellstr(string(proj.ShutdownFiles)));

truth.shortcuts = sortCell(relPaths(root, pathsOf(proj.Shortcuts)));

refs = {};
for k = 1:numel(proj.ProjectReferences)
    r = proj.ProjectReferences(k);
    entry = struct();
    entry.path = relPath(root, char(r.File));
    entry.storedLocation = strrep(char(r.StoredLocation), '\', '/');
    entry.type = char(string(r.Type));
    refs{end+1} = entry; %#ok<AGROW>
end
truth.references = sortByField(refs, 'path');

truth.simulinkCacheFolder = relPath(root, char(proj.SimulinkCacheFolder));
truth.simulinkCodeGenFolder = relPath(root, char(proj.SimulinkCodeGenFolder));
truth.projectStartupFolder = relPath(root, char(proj.ProjectStartupFolder));

% Closed BEFORE the ownership probe: that probe loads a copy of this same project
% — same name, same UUIDs — and two of those open at once is a question about
% MATLAB rather than about the fixture.
close(proj);

truth.categories = recordCategories(root);
end

% -------------------------------------------------------------------------------
function cats = recordCategories(root)
% The label catalog, including WHO OWNS each entry — MATLAB's seven built-in
% `Classification` labels versus the ones this project added.
%
% There is no property to read. `properties(matlab.project.Category)` is
% {SingleValued, DataType, Name, LabelDefinitions} and a `LabelDefinition` is
% {Name, FilePatterns, CategoryName}; neither says read-only. What MATLAB does
% say is a REFUSAL: removing one of its own throws
% `MATLAB:project:management:CanNotModifyReadOnlyLabel` (or ...Category). So
% ownership is recorded by ASKING, which is destructive — the attempt that
% succeeds removes the definition it asked about — and therefore asked of a COPY
% nobody keeps, after the fixture tree has been read.
%
% The error IDENTIFIER goes into the record next to the answer. A refusal for some
% other reason must not read as "MATLAB owns this", and writing the id down is
% what makes that visible in the fixture instead of silently true.

work = [tempname '_ownership'];
copyfile(root, work);
proj = matlab.project.loadProject(work);

catNames = {};
for k = 1:numel(proj.Categories)
    catNames{end+1} = char(proj.Categories(k).Name); %#ok<AGROW>
end

cats = {};
for k = 1:numel(catNames)
    c = findCategory(proj, catNames{k});
    entry = struct();
    entry.name = char(c.Name);
    entry.dataType = char(c.DataType);
    entry.singleValued = logical(c.SingleValued);

    labNames = {};
    for j = 1:numel(c.LabelDefinitions)
        labNames{end+1} = char(c.LabelDefinitions(j).Name); %#ok<AGROW>
    end
    labNames = sortCell(labNames);

    labels = {};
    for j = 1:numel(labNames)
        lab = struct();
        lab.name = labNames{j};
        [lab.readOnly, lab.removeError] = refuses(@() ...
            removeLabel(findCategory(proj, catNames{k}), labNames{j}), ...
            'MATLAB:project:management:CanNotModifyReadOnlyLabel');
        labels{end+1} = lab; %#ok<AGROW>
    end
    entry.labels = labels;

    % The category last: removing it takes its labels with it.
    [entry.readOnly, entry.removeError] = refuses(@() ...
        removeCategory(proj, catNames{k}), ...
        'MATLAB:project:management:CanNotModifyReadOnlyCategory');

    cats{end+1} = entry; %#ok<AGROW>
end
cats = sortByField(cats, 'name');

close(proj);
rmdir(work, 's');
end

function out = findCategory(proj, name)
out = [];
for k = 1:numel(proj.Categories)
    if strcmp(char(proj.Categories(k).Name), name)
        out = proj.Categories(k);
        return
    end
end
error('gen_project:noCategory', 'category "%s" is gone', name);
end

function [readOnly, errId] = refuses(fn, expectedId)
% Did MATLAB refuse, and with which identifier? `readOnly` is true only for the
% identifier that means ownership; any other failure is reported as itself.
try
    fn();
    readOnly = false;
    errId = '';
catch e
    readOnly = strcmp(e.identifier, expectedId);
    errId = e.identifier;
end
end

% -------------------------------------------------------------------------------
function writeFile(path, lines)
fid = fopen(path, 'w');
for k = 1:numel(lines)
    fprintf(fid, '%s\n', lines{k});
end
fclose(fid);
end

function out = relPath(root, path)
root = canon(root);
path = canon(path);
if strcmp(path, root)
    out = '';
elseif startsWith(path, [root '/'])
    out = extractAfter(path, [root '/']);
else
    % Outside the project root — a referenced project is that case. Keep it
    % relative to the root's PARENT so the record still says nothing about the
    % machine that wrote it.
    parent = canon(fileparts(root));
    if startsWith(path, [parent '/'])
        out = ['../' char(extractAfter(path, [parent '/']))];
    else
        out = ['<outside>/' path];
    end
end
out = char(out);
end

function out = canon(p)
% Resolve symlinks before comparing: on macOS `tempname` hands back /var/...,
% which is a link to /private/var, and MATLAB reports the resolved form for some
% paths and not others. Comparing unresolved strings makes every path look
% "outside" the project root.
p = char(p);
if isfolder(p)
    w = what(p);
    if ~isempty(w); p = w(1).path; end
end
out = strrep(p, '\', '/');
while endsWith(out, '/'); out = char(extractBefore(out, strlength(out))); end
out = char(out);
end

function out = pathsOf(v)
% `PathFolders` and `Shortcuts` are string arrays of absolute paths; the
% `ProjectPath` and `ProjectReferences` arrays are objects carrying a `File`. Both
% shapes turn up on the same object, so ask rather than assume.
if isstring(v) || ischar(v)
    out = cellstr(string(v));
elseif isempty(v)
    out = {};
else
    out = cell(1, numel(v));
    for k = 1:numel(v); out{k} = char(v(k).File); end
end
out = reshape(out, 1, numel(out));
end

function out = relPaths(root, paths)
out = cell(1, numel(paths));
for k = 1:numel(paths)
    out{k} = relPath(root, char(paths{k}));
end
end

function out = sortCell(c)
if isempty(c); out = {}; return; end
out = sort(c);
out = reshape(out, 1, numel(out));
end

function out = sortByField(c, field)
if isempty(c); out = {}; return; end
keys = cell(1, numel(c));
for k = 1:numel(c); keys{k} = c{k}.(field); end
[~, idx] = sort(keys);
out = c(idx);
end
