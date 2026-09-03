% What does a dictionary do with a char array whose shape is not 1xN?
%
% Every char in the parity corpus is a row vector (charStr 1x4, longChar 1x300,
% hugeChar 1x1500), so three channels have never been asked the shape question for
% this class:
%
%   * the text .sldd, which spells a char as a bare JSON string -- a form with
%     nowhere to put a second extent. Does MATLAB fall back to cdata for a char
%     MATRIX the way it does for every rank >= 3 value (defect 22)?
%   * the binary .sldd / .slx XML, where a numeric array carries Dimension="2*3".
%     Does a char? Our writer emits <P Class="char">abcdefghijkl</P> with no
%     Dimension at all, so a 2x3x2 char loses its shape in that channel.
%   * the display convention: mat2str(['ab';'cd']) is a legal 2-D literal, so a
%     char matrix may have a literal form where a rank-3 char cannot.
%
% Run: mw -using Bmain matlab -nodesktop -batch "run('test/parity/matlab/probe_char_shape.m')"

outdir = getenv('CHAR_SHAPE_OUT');
if isempty(outdir), outdir = fullfile(tempdir, 'charshape'); end
if ~exist(outdir, 'dir'), mkdir(outdir); end

charRow   = 'it''s';
charMat   = ['ab'; 'cd'];
charMat23 = reshape('abcdef', [2 3]);
charCol   = ['a'; 'b'; 'c'];
charEmpty = '';
ndChar    = reshape('abcdefghijkl', [2 3 2]);
ndDouble  = reshape(1:12, [2 3 2]);          % the control: a class with a known answer

C = { ...
    'charRow',   charRow; ...
    'charMat',   charMat; ...
    'charMat23', charMat23; ...
    'charCol',   charCol; ...
    'charEmpty', charEmpty; ...
    'ndChar',    ndChar; ...
    'ndDouble',  ndDouble};

% ---- the display convention: what a literal would say, and when there is none ---
fprintf('\nDISPLAY\n');
for i = 1:size(C, 1)
    v = C{i,2};
    try
        s = mat2str(v);
    catch e
        s = ['<mat2str error: ' e.message '>'];
    end
    fprintf('  %-10s class=%-6s size=%-8s mat2str=%s\n', C{i,1}, class(v), mat2str(size(v)), s);
end

% ---- both dictionary flavours -------------------------------------------------
Simulink.data.dictionary.closeAll('-discard');
for fmt = {'uncompressed-text', 'compressed-binary'}
    tag = fmt{1};
    fn = fullfile(outdir, ['char_' strrep(tag, '-', '_') '.sldd']);
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
        try
            v = ds.getEntry(C{i,1}).getValue();
            if ischar(v)
                shown = ['''' reshape(v, 1, []) ''''];
            else
                shown = mat2str(reshape(v, 1, []));
            end
            fprintf('  %-10s class=%-6s size=%-8s flat=%s\n', C{i,1}, class(v), mat2str(size(v)), shown);
        catch e
            fprintf('  %-10s UNREADABLE %s\n', C{i,1}, e.message);
        end
    end
    clear ds
    dd.close();
    fprintf('FILE %s\n', fn);
end

% ---- the bytes MATLAB actually wrote -----------------------------------------
% The text flavour is JSON on disk: print each entry's raw value spelling, with a
% long cdata body elided so the form is readable.
fprintf('\nTEXT JSON\n');
txt = fileread(fullfile(outdir, 'char_uncompressed_text.sldd'));
for i = 1:size(C, 1)
    k = strfind(txt, ['"name": "' C{i,1} '"']);
    if isempty(k)
        k = strfind(txt, ['"' C{i,1} '"']);
    end
    if isempty(k)
        fprintf('  %-10s NOT FOUND\n', C{i,1});
        continue
    end
    seg = txt(k(1):min(numel(txt), k(1) + 900));
    seg = regexprep(seg, '\s+', ' ');
    seg = regexprep(seg, '"_value": "  %\)[^"]*"', '"_value": "<CDATA>"');
    stop = strfind(seg, '"name":');
    if numel(stop) > 1
        seg = seg(1:stop(2) - 1);
    end
    fprintf('  %s\n', seg);
end

% The binary flavour is a ZIP of XML: unzip it and print every <P ...> tag that
% mentions one of these entries, which is where a Dimension= would have to appear.
fprintf('\nBINARY XML\n');
zdir = fullfile(outdir, 'unzipped');
if exist(zdir, 'dir'), rmdir(zdir, 's'); end
names = unzip(fullfile(outdir, 'char_compressed_binary.sldd'), zdir);
for j = 1:numel(names)
    if exist(names{j}, 'file') ~= 2, continue, end
    body = fileread(names{j});
    if isempty(strfind(body, 'ndChar')) %#ok<STREMP>
        continue
    end
    fprintf('  --- %s\n', names{j});
    body = regexprep(body, '>\s*<', '>\n<');
    lines = strsplit(body, newline);
    for L = 1:numel(lines)
        if ~isempty(regexp(lines{L}, 'char|Dimension|ndDouble|cdata', 'once'))
            fprintf('  %s\n', strtrim(lines{L}));
        end
    end
end

% ---- the fourth channel: what MATLAB makes of the literal a user can TYPE -------
%
% The table shows a char matrix as ['ab'; 'cd'] and seeds its editor with that text,
% so committing it unchanged has to be a no-op. That only holds if our parser reads
% the literal the way MATLAB does, and the difference is the QUOTE: eval each
% spelling here and record the class and size, including the ones MATLAB refuses.
fprintf('\nLITERALS\n');
lits = { ...
    '[''ab''; ''cd'']', ...
    '["ab"; "cd"]', ...
    '["ab", "cd"]', ...
    '[''a'', ''b'']', ...
    '[''ab'' ''cd'']', ...
    '[''ab''; ''c'' ''d'']', ...
    '[''ab''; ''c'']', ...
    '[''ab''; "cd"]', ...
    '[''a''; ''b''; ''c'']', ...
    '['''']', ...
    '[''it''''s''; ''okay'']'};
for i = 1:numel(lits)
    try
        v = eval(lits{i});
        if ischar(v)
            flat = ['''' reshape(v, 1, []) ''''];
        else
            flat = strjoin(cellstr(reshape(string(v), 1, [])), '|');
        end
        fprintf('  %-22s class=%-6s size=%-8s colmajor=%s\n', lits{i}, class(v), mat2str(size(v)), flat);
    catch e
        fprintf('  %-22s ERROR %s\n', lits{i}, e.message);
    end
end

disp('CHARSHAPE OK');
