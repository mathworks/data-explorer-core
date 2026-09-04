% How does a dictionary spell a TYPED numeric array — and a shaped char — at the
% top level, inside a struct field, and inside a cell?
%
% The parity corpus answers this only for the top level (i16Vec, u64Vec, scalarS,
% boolVec, ...), and only for the text flavour. Three gaps followed from that:
%
%   * a struct field holding int32([1 2]) serialized to a LIST of per-element typed
%     literals, [{"_type":"int32","_value":"1"}, ...], a form MATLAB never writes;
%     the XML writer then rendered it as `[object Object] [object Object]`, which is
%     a corrupt file, not a lossy one.
%   * a char array that is not a row vector loses its shape in three channels
%     (probe_char_shape.m). This probe adds the nested positions.
%   * nothing anywhere pins the XML Class= for a typed array, so `Class="double"`
%     on an int32 field went unnoticed.
%
% Run: mw -using Bmain matlab -nodesktop -batch "run('test/parity/matlab/probe_typed_shapes.m')"

outdir = getenv('TYPED_SHAPES_OUT');
if isempty(outdir), outdir = fullfile(tempdir, 'typedshapes'); end
if ~exist(outdir, 'dir'), mkdir(outdir); end

C = { ...
    'i32Vec',   int32([1 2 3]); ...
    'i32Col',   int32([1; 2; 3]); ...
    'i32Mat',   int32([1 2; 3 4]); ...
    'sglVec',   single([1.5 2.5]); ...
    'lglVec',   [true false true]; ...
    'u64Vec2',  uint64([1 2]); ...
    'sTyped',   struct('a', int32([1 2]), 'b', single(3.5), 'c', true, 'd', uint64([7 8])); ...
    'sCharMat', struct('m', reshape('abcdef', [2 3]), 'r', 'row'); ...
    'cTyped',   {{int32([1 2]), single(1.5), true, ['ab'; 'cd']}}};

Simulink.data.dictionary.closeAll('-discard');
for fmt = {'uncompressed-text', 'compressed-binary'}
    tag = fmt{1};
    fn = fullfile(outdir, ['typed_' strrep(tag, '-', '_') '.sldd']);
    if exist(fn, 'file'), delete(fn); end
    dd = Simulink.data.dictionary.create(fn);
    dd.FileFormat = tag;
    ds = dd.getSection('Design Data');
    for i = 1:size(C, 1)
        try
            ds.addEntry(C{i,1}, C{i,2});
        catch e
            fprintf('REJECTED %-10s %s\n', C{i,1}, e.message);
        end
    end
    clear ds
    dd.saveChanges();
    dd.close();
    fprintf('\nREAD BACK (%s)\n', tag);
    dd = Simulink.data.dictionary.open(fn);
    ds = dd.getSection('Design Data');
    for i = 1:size(C, 1)
        v = ds.getEntry(C{i,1}).getValue();
        fprintf('  %-10s class=%-8s size=%-8s %s\n', C{i,1}, class(v), mat2str(size(v)), describe(v));
    end
    clear ds
    dd.close();
    fprintf('FILE %s\n', fn);
end

fprintf('\nTEXT JSON\n');
txt = fileread(fullfile(outdir, 'typed_uncompressed_text.sldd'));
for i = 1:size(C, 1)
    k = strfind(txt, ['"name": "' C{i,1} '"']);
    if isempty(k), fprintf('  %-10s NOT FOUND\n', C{i,1}); continue, end
    seg = regexprep(txt(k(1):min(numel(txt), k(1) + 1200)), '\s+', ' ');
    seg = regexprep(seg, '"_value": "  %\)[^"]*"', '"_value": "<CDATA>"');
    stop = strfind(seg, '"name":');
    if numel(stop) > 1, seg = seg(1:stop(2) - 1); end
    seg = regexprep(seg, '"metadata": \{[^}]*\}, ', '');
    fprintf('  %s\n', seg);
end

fprintf('\nBINARY XML\n');
zdir = fullfile(outdir, 'unzipped');
if exist(zdir, 'dir'), rmdir(zdir, 's'); end
names = unzip(fullfile(outdir, 'typed_compressed_binary.sldd'), zdir);
for j = 1:numel(names)
    if exist(names{j}, 'file') ~= 2, continue, end
    body = fileread(names{j});
    if isempty(strfind(body, 'i32Vec')) %#ok<STREMP>
        continue
    end
    fprintf('  --- %s\n', names{j});
    body = regexprep(body, '>\s*<', '>\n<');
    lines = strsplit(body, newline);
    keep = false;
    for L = 1:numel(lines)
        s = strtrim(lines{L});
        if ~isempty(regexp(s, '<P Name="Name"', 'once'))
            keep = true;
            fprintf('\n  %s\n', s);
            continue
        end
        if keep && isempty(regexp(s, 'UUID|Namespace|LastMod|IsDerived', 'once'))
            fprintf('  %s\n', s);
        end
    end
end

disp('TYPEDSHAPES OK');

function s = describe(v)
    if ischar(v)
        s = ['text=''' reshape(v, 1, []) ''''];
    elseif iscell(v)
        parts = cellfun(@(x) {[class(x) mat2str(size(x))]}, reshape(v, 1, []));
        s = ['cells=' strjoin(parts, ',')];
    elseif isstruct(v)
        fn = fieldnames(v);
        parts = cell(1, numel(fn));
        for i = 1:numel(fn)
            x = v(1).(fn{i});
            parts{i} = [fn{i} '=' class(x) mat2str(size(x))];
        end
        s = ['fields ' strjoin(parts, ' ')];
    else
        s = ['flat=' mat2str(reshape(v, 1, []))];
    end
end
