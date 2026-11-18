function make_definition_file(out)
% Copyright 2026 The MathWorks, Inc.
%
% A Simulink.Parameter's and a Simulink.Signal's Definition File, as MATLAB writes it to a JSON text
% dictionary and a MAT-file, for test/definitionFileColumn.test.ts and, as objects with a custom
% storage class, test/matCustomStorageClass.test.ts. A Definition File is not a property of the
% object: it is CoderInfo.CustomAttributes.DefinitionFile, which only a storage class that carries
% it has (ExportToFile here, not GetSet).
%   pExport   Simulink.Parameter 5, ExportToFile: HeaderFile p_export.h, DefinitionFile p_export.c
%   sExport   Simulink.Signal, ExportToFile: HeaderFile s_export.h, DefinitionFile s_export.c
%   pGetSet   Simulink.Parameter 3, GetSet: HeaderFile getset.h, GetFunction get_p, SetFunction set_p
%   pAuto     Simulink.Parameter 1, Auto: no attributes
%
% No binary dictionary: test/parity/m9MergedSaves.truth.test.ts holds every compressed-binary one
% in the tree to MATLAB's read-back of core's saves of it. data-explorer-view's
% test-integration/fixtures/cscattributes holds one MATLAB wrote with a Definition File.
%
% USER is a fixed word while the dictionary is written (each entry's LastModBy).
%
% Run from this folder; it writes r<release>/ (R2027a is the release these fixtures are for):
%   mw -using Bmain matlab -nodesktop -batch "make_definition_file(pwd)"
% It writes into r<release>/:
%   definition_file_text.sldd   Design Data, FileFormat 'uncompressed-text'
%   definition_file.mat         save -v7
%   made.json                   for each name and file, as MATLAB reads it back: the class, the
%                               storage class, and each attribute's name and value
% A re-run gives new UUIDs and timestamps, and the same values. Verify by the WROTE lines and the
% trailing MAKE_DEFINITION_FILE_DONE.
folder = fullfile(out, ['r' version('-release')]);
if ~isfolder(folder), mkdir(folder); end
user = getenv('USER');
setenv('USER', 'fixture');
restoreUser = onCleanup(@() setenv('USER', user));

pExport = Simulink.Parameter(5);
pExport.CoderInfo.StorageClass = 'Custom';
pExport.CoderInfo.CustomStorageClass = 'ExportToFile';
pExport.CoderInfo.CustomAttributes.HeaderFile = 'p_export.h';
pExport.CoderInfo.CustomAttributes.DefinitionFile = 'p_export.c';

sExport = Simulink.Signal;
sExport.CoderInfo.StorageClass = 'Custom';
sExport.CoderInfo.CustomStorageClass = 'ExportToFile';
sExport.CoderInfo.CustomAttributes.HeaderFile = 's_export.h';
sExport.CoderInfo.CustomAttributes.DefinitionFile = 's_export.c';

pGetSet = Simulink.Parameter(3);
pGetSet.CoderInfo.StorageClass = 'Custom';
pGetSet.CoderInfo.CustomStorageClass = 'GetSet';
pGetSet.CoderInfo.CustomAttributes.HeaderFile = 'getset.h';
pGetSet.CoderInfo.CustomAttributes.GetFunction = 'get_p';
pGetSet.CoderInfo.CustomAttributes.SetFunction = 'set_p';

pAuto = Simulink.Parameter(1);

V = {'pExport', pExport; 'sExport', sExport; 'pGetSet', pGetSet; 'pAuto', pAuto};

%% The dictionary.
Simulink.data.dictionary.closeAll('-discard');
sldd = fullfile(folder, 'definition_file_text.sldd');
if isfile(sldd), delete(sldd); end
dd = Simulink.data.dictionary.create(sldd);
dd.FileFormat = 'uncompressed-text';
section = getSection(dd, 'Design Data');
for i = 1:size(V, 1)
    addEntry(section, V{i, 1}, V{i, 2});
end
saveChanges(dd);
close(dd);
Simulink.data.dictionary.closeAll('-discard');
fprintf('WROTE %s\n', sldd);

%% The MAT-file.
mat = fullfile(folder, 'definition_file.mat');
S = struct();
for i = 1:size(V, 1)
    S.(V{i, 1}) = V{i, 2};
end
save(mat, '-struct', 'S', '-v7');
fprintf('WROTE %s\n', mat);

%% What MATLAB reads back of each, attribute by attribute.
dd = Simulink.data.dictionary.open(sldd);
section = getSection(dd, 'Design Data');
loaded = load(mat);
values = cell(1, size(V, 1));
for i = 1:size(V, 1)
    name = V{i, 1};
    values{i} = struct('name', name, 'class', class(V{i, 2}), ...
        'text', described(getValue(getEntry(section, name))), 'mat', described(loaded.(name)));
end
close(dd);
Simulink.data.dictionary.closeAll('-discard');

made = struct('version', version, 'release', version('-release'), 'values', {values});
fid = fopen(fullfile(folder, 'made.json'), 'w');
fprintf(fid, '%s\n', jsonencode(made, 'PrettyPrint', true));
fclose(fid);
fprintf('WROTE %s\n', fullfile(folder, 'made.json'));
clear restoreUser;
fprintf('MAKE_DEFINITION_FILE_DONE\n');
end

function d = described(obj)
% The storage class of OBJ, and each of its attributes' names and values, as text.
info = obj.CoderInfo;
d = struct('StorageClass', char(info.StorageClass), 'CustomStorageClass', char(info.CustomStorageClass), ...
    'attributes', struct());
attrs = info.CustomAttributes;
if isobject(attrs)
    names = properties(attrs);
    for k = 1:numel(names)
        value = attrs.(names{k});
        if ischar(value) || isstring(value)
            text = char(value);
        else
            text = mat2str(value);
        end
        d.attributes.(names{k}) = text;
        fprintf('ATTR %s %s = %s\n', char(info.CustomStorageClass), names{k}, text);
    end
end
end
