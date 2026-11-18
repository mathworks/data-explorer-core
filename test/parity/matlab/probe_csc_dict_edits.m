% Copyright 2026 The MathWorks, Inc.
%
% Does MATLAB read core's save of a CoderInfo edit of a dictionary object with a custom storage
% class as it makes the same edit itself? csc_dict_edits.mjs writes the saves: pExport, a
% Simulink.Parameter under ExportToFile, its StorageClass set to Auto, ExportedGlobal,
% ImportedExtern or SimulinkGlobal, or its Alignment to 8, one edit per file, in a text dictionary
% and (where given one) a binary one. Core writes the property alone, the CustomStorageClass and
% the CustomAttributes left as the file held them; MATLAB's own StorageClass edit sets the
% CustomStorageClass to Default.
%
% For each save: the same edit made in MATLAB on the original's object (getValue, the CoderInfo
% property set), and the save opened and its pExport read; each object's StorageClass,
% CustomStorageClass, Alignment, and its CustomAttributes' class and values; whether the two are
% isequal; and any warning or printed text of the edit and of the open and read.
%
%   node test/parity/matlab/csc_dict_edits.mjs /tmp/cscdict [<binary .sldd with pExport>]
%   env CSC_DICT_OUT=/tmp/cscdict mw -using Bmain matlab -nodesktop \
%        -batch "run('$PWD/test/parity/matlab/probe_csc_dict_edits.m')"
%   cp /tmp/cscdict/csc_dict_edits.truth.json test/parity/matlab/
%
% Opens only the files in CSC_DICT_OUT, and saves nothing. Prints CSC_DICT_EDITS OK on its last
% line. Graded by ../cscDictEdits.truth.test.ts.

outdir = getenv('CSC_DICT_OUT');
if isempty(outdir), error('set CSC_DICT_OUT to the directory csc_dict_edits.mjs wrote'); end
cases = jsondecode(fileread(fullfile(outdir, 'cases.json')));
warning('off', 'backtrace');
rows = cell(1, numel(cases));
for i = 1:numel(cases)
    c = cases(i);
    r = c;
    if isempty(c.file)
        rows{i} = r;
        continue
    end
    % MATLAB's own edit, on the original's object.
    Simulink.data.dictionary.closeAll('-discard');
    orig = Simulink.data.dictionary.open(fullfile(outdir, c.original));
    mine = getValue(getEntry(getSection(orig, 'Design Data'), 'pExport'));
    lastwarn('');
    try
        printed = evalc('mine = cscEdit(mine, c.key, c.value);');
        r.matlab = cscDescribed(mine, printed);
    catch e
        r.matlab = struct('error', [e.identifier ' ' e.message]);
        mine = [];
    end
    close(orig);
    Simulink.data.dictionary.closeAll('-discard');
    % Core's save.
    lastwarn('');
    try
        printed = evalc('dd = Simulink.data.dictionary.open(fullfile(outdir, c.file)); saved = getValue(getEntry(getSection(dd, ''Design Data''), ''pExport''));');
        r.saved = cscDescribed(saved, printed);
        r.sameAsMatlab = ~isempty(mine) && isequal(saved, mine);
        close(dd);
    catch e
        r.saved = struct('error', [e.identifier ' ' e.message]);
        r.sameAsMatlab = false;
    end
    Simulink.data.dictionary.closeAll('-discard');
    fprintf('CASE %s %s=%s sameAsMatlab=%d\n', c.format, c.key, c.value, r.sameAsMatlab);
    rows{i} = r;
end
truth = struct('version', version, 'release', version('-release'), 'date', char(datetime('today', 'Format', 'yyyy-MM-dd')), 'cases', {rows});
fid = fopen(fullfile(outdir, 'csc_dict_edits.truth.json'), 'w');
fprintf(fid, '%s\n', jsonencode(truth, 'PrettyPrint', true));
fclose(fid);
fprintf('CSC_DICT_EDITS OK\n');

function obj = cscEdit(obj, key, value)
switch key
    case 'storageClass'
        obj.CoderInfo.StorageClass = value;
    case 'alignment'
        obj.CoderInfo.Alignment = str2double(value);
end
end

function d = cscDescribed(obj, printed)
info = obj.CoderInfo;
[msg, id] = lastwarn;
d = struct('StorageClass', char(info.StorageClass), 'CustomStorageClass', char(info.CustomStorageClass), ...
    'Alignment', double(info.Alignment), 'attributesClass', class(info.CustomAttributes), 'attributes', struct(), ...
    'warning', strtrim([id ' ' msg]), 'printed', strtrim(printed));
attrs = info.CustomAttributes;
if isobject(attrs)
    names = properties(attrs);
    for k = 1:numel(names)
        v = attrs.(names{k});
        if ischar(v) || isstring(v), d.attributes.(names{k}) = char(v); else, d.attributes.(names{k}) = mat2str(v); end
    end
end
end
