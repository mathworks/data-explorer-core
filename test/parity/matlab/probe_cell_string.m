% How does MATLAB spell a `string` INSIDE a cell, in each dictionary flavour?
%
% probe_cell_shapes.m asked this for the TEXT .sldd and got a flat answer: a 1x1
% string element is the one-element list `["a"]`, a string array is a String
% wrapper. The BINARY flavour was never asked, and it is the one where a string is
% not a JSON value at all -- it is an object with a saveobj payload. Three sites in
% BinarySlddParser nest one (entry value, object property, cell element) and the
% cell site had no branch for it, so `{"a"}` read as an OBJECT of class `string`:
% displayed `{<1x1 string>}`, and -- worse -- written back as an EMPTY
% `<Element Class="string"/>`, the text gone from the file on any save that rebuilt
% the chunk. Both halves are defect 52.
%
% The question this settles is the shape, because the fix is a reader branch and a
% branch keyed on the wrong shape is no fix: is a string element's class on the
% <Element> itself, the way every scalar element carries it
% (`<Element Class="int32">`), or is the element a CLASSLESS wrapper around the
% object's own <Element Class="string">? The two are one nesting level apart and
% only MATLAB can say which it writes.
%
% The answers, measured against R2027a:
%
%   BINARY. A cell element holding an OBJECT is a classless <Element> WRAPPER, and
%   the object's own <Element Class="..."> is its only child. So `{"a"}` is
%
%     <P Name="Value" Class="cell">
%       <Element>
%         <Element Class="string">
%           <P Source="saveobj" PropertyType="any" Class="cell">
%             <Element Class="char">a</Element>
%           </P>
%         </Element>
%       </Element>
%     </P>
%
%   -- the same two-level shape a cell element holding a Simulink.Parameter has
%   (cObj below), which is why the reader's object tail was RIGHT for every class
%   but this one and why the fix lifts `string` out of that tail rather than
%   replacing it. Note the saveobj cell carries NO Dimension at 1x1 and
%   `Dimension="1*2"` for a 1x2 (cStrArr), exactly as a top-level string entry
%   does; and that MATLAB omits Dimension on a 1x1 cell's own <P> (cStr, cObj)
%   while writing it for a 1x2 (cStrTwo).
%
%   A string in a STRUCT FIELD is the same object under a named <P> (sStr) -- that
%   site already had its branch and was never broken.
%
%   TEXT. Unchanged from probe_cell_shapes.m and recorded here only so the pair can
%   be compared: `{"a"}` is `["a"]` and `{["a" "b"]}` is the String wrapper. This is
%   the channel that was always right, and it is the reason the defect was visible
%   at all -- the same dictionary read two ways depending on which format it was
%   saved in.
%
% Outputs the committed fixtures test/fixtures/cellstr_text.sldd and
% test/fixtures/cellstr_binary.sldd.
%
% Run: mw -using Bmain matlab -nodesktop -batch "run('test/parity/matlab/probe_cell_string.m')"

outdir = getenv('CELL_STRING_OUT');
if isempty(outdir), outdir = fullfile(tempdir, 'cellstring'); end
if ~exist(outdir, 'dir'), mkdir(outdir); end

p = Simulink.Parameter(5);

C = { ...
    'cStr',     {"a"}; ...              % the reported case: a 1x1 string in a 1x1 cell
    'cStrArr',  {["a" "b"]}; ...        % a string ARRAY in a cell -- does the shape survive?
    'cStrTwo',  {"a", "b"}; ...         % two string elements: is each wrapped on its own?
    'cMixed',   {1, "a", 'b'}; ...      % string beside a double and a CHAR, which it must not become
    'cObj',     {p}; ...                % the control: a non-string object in a cell
    'sStr',     struct('f', "a")};      % the sibling site that already worked

% ---- both dictionary flavours -------------------------------------------------
Simulink.data.dictionary.closeAll('-discard');
for fmt = {'uncompressed-text', 'compressed-binary'}
    tag = fmt{1};
    fn = fullfile(outdir, ['cellstr_' strrep(tag, '-', '_') '.sldd']);
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

    % Read back through MATLAB's own API, so the class of each element is MATLAB's
    % answer and not ours. A cell element's class is the part the defect destroyed.
    fprintf('\nREAD BACK (%s)\n', tag);
    dd = Simulink.data.dictionary.open(fn);
    ds = dd.getSection('Design Data');
    for i = 1:size(C, 1)
        try
            v = ds.getEntry(C{i,1}).getValue();
            if iscell(v)
                parts = cell(1, numel(v));
                for k = 1:numel(v)
                    parts{k} = sprintf('%s%s', class(v{k}), mat2str(size(v{k})));
                end
                fprintf('  %-10s cell%s of {%s}\n', C{i,1}, mat2str(size(v)), strjoin(parts, ', '));
            elseif isstruct(v)
                f = fieldnames(v);
                fprintf('  %-10s struct with %s=%s\n', C{i,1}, f{1}, class(v.(f{1})));
            else
                fprintf('  %-10s class=%s\n', C{i,1}, class(v));
            end
        catch e
            fprintf('  %-10s UNREADABLE %s\n', C{i,1}, e.message);
        end
    end
    clear ds
    dd.close();
    fprintf('FILE %s\n', fn);
end

% ---- the bytes MATLAB actually wrote -----------------------------------------
fprintf('\nTEXT JSON\n');
txt = fileread(fullfile(outdir, 'cellstr_uncompressed_text.sldd'));
txt = regexprep(txt, '\s+', ' ');
for i = 1:size(C, 1)
    k = strfind(txt, ['"' C{i,1} '"']);
    if isempty(k)
        fprintf('  %-10s NOT FOUND\n', C{i,1});
        continue
    end
    fprintf('  %s\n', txt(k(1):min(numel(txt), k(1) + 400)));
end

% The binary flavour is a ZIP of XML. Print the whole chunk: the nesting IS the
% answer here, so an attribute-filtered view would hide the thing being measured.
fprintf('\nBINARY XML\n');
zdir = fullfile(outdir, 'unzipped');
if exist(zdir, 'dir'), rmdir(zdir, 's'); end
names = unzip(fullfile(outdir, 'cellstr_compressed_binary.sldd'), zdir);
for j = 1:numel(names)
    if exist(names{j}, 'file') ~= 2, continue, end
    body = fileread(names{j});
    if isempty(strfind(body, 'cStr')) %#ok<STREMP>
        continue
    end
    fprintf('  --- %s\n', names{j});
    disp(body);
end

disp('CELLSTRING OK');
